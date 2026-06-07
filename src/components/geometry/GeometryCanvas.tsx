import { useRef, useEffect, useState } from 'react'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import { useProjectStore } from '../../store/projectStore'
import { useSelectionStore } from '../../store/selectionStore'
import { useAudioStore } from '../../store/audioStore'
import { useSamplerModeStore } from '../../store/samplerModeStore'
import type { GeometryObject, SampleAsset } from '../../patch/types'
import { collectVisibleGeometry, highlightedGeometryIdsForNode } from '../../patch/geometryGraph'
import { nanoid } from 'nanoid'
import { triggerIntersectionSound, startStandpointSound, stopStandpointSound, setPlayerVolume, stopAllLoopingPlayers } from '../../audio/intersectionSynth'
import { processTriggerValues } from '../../audio/audioEngine'

export type GeometryTool = 'pan' | 'select' | 'boxSelect' | 'addCircle' | 'addPoint' | 'addPath' | 'addWay'

interface Point { x: number; y: number }
interface Box { x: number; y: number; width: number; height: number }

interface Props {
  tool: GeometryTool
  mode?: 'sampler' | 'patcher'
}

/** Flash the moving dot/playhead element to indicate a trigger. */
function flashDotEl(geomId: string, haloRadius?: number) {
  const candidates = [
    { el: document.getElementById(`sampler-dot-${geomId}`), flashR: '11', baseR: '7' },
    { el: document.getElementById(`point-dot-${geomId}`), flashR: '10', baseR: null },
    { el: document.getElementById(`orbit-dot-${geomId}`), flashR: '7', baseR: '4' },
    { el: document.getElementById(`way-dot-${geomId}`), flashR: '9', baseR: '6' },
  ]
  const target = candidates.find(item => item.el)
  const el = target?.el
  if (!el) return

  const baseFill = el.getAttribute('fill') ?? '#f59e0b'
  const baseStroke = el.getAttribute('stroke') ?? 'white'
  const baseStrokeWidth = el.getAttribute('stroke-width') ?? '1.5'
  const baseR = target.baseR ?? el.getAttribute('r') ?? '7'

  el.setAttribute('fill', '#ffffff')
  el.setAttribute('stroke', '#f59e0b')
  el.setAttribute('stroke-width', '3')
  el.setAttribute('r', String(haloRadius && haloRadius > 0 ? haloRadius : target.flashR))
  setTimeout(() => {
    if (!document.body.contains(el)) return
    el.setAttribute('fill', baseFill)
    el.setAttribute('stroke', baseStroke)
    el.setAttribute('stroke-width', baseStrokeWidth)
    el.setAttribute('r', baseR)
  }, 250)
}

export function GeometryCanvas({ tool, mode = 'sampler' }: Props) {
  const svgRef         = useRef<SVGSVGElement>(null)
  const project        = useProjectStore(s => s.project)
  const canvasSettings = useCanvasSettingsStore()
  const updateCanvasSettings = useCanvasSettingsStore(s => s.updateCanvasSettings)
  const [timeSeconds, setTimeSeconds] = useState(0)
  const geometry       = collectVisibleGeometry(project, timeSeconds)
  const bpm            = useProjectStore(s => s.project.transport.bpm)
  const samples        = useProjectStore(s => s.project.samples)
  const addGeom        = useProjectStore(s => s.addGeometryObject)
  const updateGeom     = useProjectStore(s => s.updateGeometryObject)
  const removeGeom     = useProjectStore(s => s.removeGeometryObject)
  const selectedGeomId = useSelectionStore(s => s.selectedGeometryId)
  const selectedGeomIds = useSelectionStore(s => s.selectedGeometryIds)
  const selectedNodeId = useSelectionStore(s => s.selectedNodeId)
  const selectGeometry = useSelectionStore(s => s.selectGeometry)
  const toggleGeometrySelection = useSelectionStore(s => s.toggleGeometrySelection)
  const selectGeometryRange = useSelectionStore(s => s.selectGeometryRange)
  const isRunning      = useAudioStore(s => s.isRunning)
  const samplerMode    = useSamplerModeStore()
  const updateSamplerMode = useSamplerModeStore(s => s.updateSamplerMode)
  const highlightedGeometryIds = highlightedGeometryIdsForNode(project, selectedNodeId, timeSeconds)
  const [viewOffset, setViewOffset] = useState<Point>({ x: 0, y: 0 })
  const zoom = canvasSettings.zoom
  const [drag, setDrag] = useState<null | {
    kind: 'pan' | 'box' | 'way' | 'circle'
    start: Point
    current: Point
    originOffset: Point
  }>(null)
  const [editDrag, setEditDrag] = useState<null | {
    id: string
    kind: 'move' | 'circleHandle' | 'pathNode' | 'wayEndpoint' | 'rotate'
    handle?: string
    start: Point
    startParams: Record<string, unknown>
  }>(null)
  // Standpoint drag: drag the ⊕ marker to reposition it
  const [standpointDrag, setStandpointDrag] = useState<null | {
    startCanvas: Point
    startPos: Point
  }>(null)

  // Mutable refs — RAF reads these without re-subscribing
  const anglesRef     = useRef<Record<string, number>>({})
  const prevInRef     = useRef<Record<string, Set<string>>>({})
  const rafRef        = useRef<number>(0)
  const lastTRef      = useRef<number>(0)
  const nowSRef       = useRef<number>(0)   // absolute time in seconds (for way scanner)
  const flashExpRef   = useRef<Record<string, number>>({})  // geomId → expiry ms timestamp
  const prevSpRef     = useRef<Map<string, boolean>>(new Map()) // standpoint zone inside-state per dot
  const prevSpSampleRef = useRef<Map<string, string>>(new Map()) // standpoint dot key → playing sample id
  const suppressBgClickRef = useRef(false)
  const geoRef        = useRef(geometry)
  const bpmRef        = useRef(bpm)
  const samplesRef    = useRef(samples)
  const runRef        = useRef(isRunning)
  const samplerModeRef = useRef(samplerMode)

  function triggerOptions(sourceGeom: GeometryObject, targetGeom: GeometryObject, pointX: number, pointY: number, pointDistance?: number, pointDistanceMax?: number) {
    const settings = samplerModeRef.current
    const randomMin = Math.min(settings.randomStartMinSeconds, settings.randomStartMaxSeconds)
    const randomMax = Math.max(settings.randomStartMinSeconds, settings.randomStartMaxSeconds)
    const storedStart = typeof targetGeom.params.sampleStartSeconds === 'number'
      ? targetGeom.params.sampleStartSeconds
      : undefined
    const startSeconds = storedStart ?? (settings.startMode === 'random'
      ? randomMin + Math.random() * Math.max(0, randomMax - randomMin)
      : settings.startSeconds)

    const center = geometryCenter(sourceGeom)
    const centerDistance = Math.hypot(pointX - center.x, pointY - center.y)
    const playbackRate = settings.pitchMode === 'center-distance'
      ? mapRangeClamped(centerDistance, 0, 420, 0.45, 2.0)
      : undefined
    const volume = (() => {
      if (settings.volumeMode === 'point-distance' && typeof pointDistance === 'number') {
        return mapRangeClamped(pointDistance, 0, pointDistanceMax ?? settings.rendezvousDistance, 1, 0.25)
      }
      if (settings.volumeMode === 'standpoint-distance' && settings.standpoint) {
        const d = Math.hypot(pointX - settings.standpoint.x, pointY - settings.standpoint.y)
        if (d >= settings.standpointRadius) return 0
        return mapRangeClamped(d, 0, settings.standpointRadius, 1, settings.standpointVolumeMin)
      }
      return undefined
    })()

    return { startSeconds, playbackRate, volume }
  }

  useEffect(() => { geoRef.current = geometry }, [geometry])
  useEffect(() => { bpmRef.current = bpm }, [bpm])
  useEffect(() => { samplesRef.current = samples }, [samples])
  useEffect(() => { samplerModeRef.current = samplerMode }, [samplerMode])
  useEffect(() => { prevInRef.current = {} }, [samplerMode.activeRule])
  useEffect(() => {
    if (samplerMode.volumeMode !== 'standpoint-distance') {
      prevSpRef.current.clear()
      prevSpSampleRef.current.clear()
      stopAllLoopingPlayers()
    }
  }, [samplerMode.volumeMode])
  useEffect(() => {
    runRef.current = isRunning
    // Clear stale intersection state so first contact retriggers on next play
    if (!isRunning) {
      prevInRef.current = {}
      prevSpRef.current.clear()
      prevSpSampleRef.current.clear()
      stopAllLoopingPlayers()
    }
  }, [isRunning])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (isTextEditingTarget(e.target)) return
      const ids = useSelectionStore.getState().selectedGeometryIds
      if (!ids.length) return

      e.preventDefault()
      for (const id of ids) removeGeom(id)
      selectGeometry(null)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [removeGeom, selectGeometry])

  // RAF orbit + intersection loop (mount/unmount only)
  useEffect(() => {
    function tick(now: number) {
      rafRef.current = requestAnimationFrame(tick)
      setTimeSeconds(now / 1000)
      nowSRef.current = now / 1000
      const dt = lastTRef.current ? (now - lastTRef.current) / 1000 : 0
      lastTRef.current = now
      const running = runRef.current
      if (running) processTriggerValues(useProjectStore.getState().project, now / 1000)

      const circles = geoRef.current.filter(o => o.type === 'circle')
      const curves = geoRef.current.filter(isCurveGeometry)
      const orbitCircles = circles.filter(hasOrbitParams)
      const activeRule = samplerModeRef.current.activeRule

      for (const obj of orbitCircles) {
        const r = Math.max(1, (obj.params.r as number) ?? 100)
        const distance = obj.params.orbitDistance as number
        const time = Math.max(0.001, obj.params.orbitTime as number)
        const linearSpeed = distance / time
        const dAngle = linearSpeed / r * dt
        anglesRef.current[obj.id] = (anglesRef.current[obj.id] ?? 0) + dAngle
      }
      for (const circA of orbitCircles) {
        const cx  = (circA.params.cx as number) ?? 0
        const cy  = (circA.params.cy as number) ?? 0
        const rA  = (circA.params.r  as number) ?? 100
        const ang = anglesRef.current[circA.id] ?? 0
        const dotX = cx + rA * Math.cos(ang)
        const dotY = cy + rA * Math.sin(ang)

        // Move dot and arm via direct DOM mutation (no React re-render)
        const dotEl = document.getElementById(`orbit-dot-${circA.id}`)
        dotEl?.setAttribute('cx', String(dotX))
        dotEl?.setAttribute('cy', String(dotY))
        const armEl = document.getElementById(`orbit-arm-${circA.id}`)
        armEl?.setAttribute('x2', String(dotX))
        armEl?.setAttribute('y2', String(dotY))

        if (!running || activeRule !== 'shape-overlap') continue

        // Rising-edge intersection: dot of circA enters circleB
        if (!prevInRef.current[circA.id]) prevInRef.current[circA.id] = new Set()
        const prev = prevInRef.current[circA.id]

        for (const circB of circles) {
          if (circB.id === circA.id) continue
          const bx = (circB.params.cx as number) ?? 0
          const by = (circB.params.cy as number) ?? 0
          const rB = (circB.params.r  as number) ?? 100
          const dx = dotX - bx, dy = dotY - by
          const inside = dx * dx + dy * dy < rB * rB

          if (inside && !prev.has(circB.id)) {
            if (samplerModeRef.current.volumeMode === 'standpoint-distance') {
              flashDotEl(circA.id)
            } else {
              const triggerCurve = samplerModeRef.current.triggerTarget === 'source-curve' ? circA : circB
              triggerIntersectionSound(circA, triggerCurve, samplesRef.current, triggerOptions(circA, triggerCurve, dotX, dotY))
              flashDotEl(circA.id)
            }
          }
          if (inside) { prev.add(circB.id) } else { prev.delete(circB.id) }
        }
      }

      // ── Way scanner ──────────────────────────────────────────
      const ways = geoRef.current.filter(o => o.type === 'way')
      for (const way of ways) {
        const ax = (way.params.ax as number) ?? 0
        const ay = (way.params.ay as number) ?? 0
        const bx = (way.params.bx as number) ?? 200
        const by = (way.params.by as number) ?? 0
        const speed = (way.params.speed as number) ?? 150
        const length = Math.hypot(bx - ax, by - ay)
        if (length < 1) continue

        // Bounce: ping-pong between A and B
        const cycle = 2 * length
        let d = ((nowSRef.current * speed) % cycle + cycle) % cycle
        if (d > length) d = cycle - d

        const t = d / length
        const dotX = ax + (bx - ax) * t
        const dotY = ay + (by - ay) * t

        document.getElementById(`way-dot-${way.id}`)?.setAttribute('cx', String(dotX))
        document.getElementById(`way-dot-${way.id}`)?.setAttribute('cy', String(dotY))

        if (!running || activeRule !== 'shape-overlap') continue

        const key = `way_${way.id}`
        if (!prevInRef.current[key]) prevInRef.current[key] = new Set()
        const wayPrev = prevInRef.current[key]

        for (const circle of circles) {
          const cx = (circle.params.cx as number) ?? 0
          const cy = (circle.params.cy as number) ?? 0
          const rC = (circle.params.r as number) ?? 100
          const dx = dotX - cx, dy = dotY - cy
          const inside = dx * dx + dy * dy < rC * rC

          if (inside && !wayPrev.has(circle.id)) {
            if (samplerModeRef.current.volumeMode === 'standpoint-distance') {
              flashDotEl(way.id)
            } else {
              const triggerCurve = samplerModeRef.current.triggerTarget === 'source-curve' ? way : circle
              triggerIntersectionSound(way, triggerCurve, samplesRef.current, triggerOptions(way, triggerCurve, dotX, dotY))
              flashDotEl(way.id)
            }
          }
          if (inside) { wayPrev.add(circle.id) } else { wayPrev.delete(circle.id) }
        }
      }

      if (activeRule === 'point-enters-curve') {
        // ── Point → Curve intersections ─────────────────────────
        // Covers base points and derived animated points. A curve is any non-point drawing.
        const points = geoRef.current.filter(o => o.type === 'point')
        for (const pt of points) {
          const px = (pt.params.x as number) ?? 0
          const py = (pt.params.y as number) ?? 0
          const key = `pt_${pt.id}`
          if (!prevInRef.current[key]) prevInRef.current[key] = new Set()
          const ptPrev = prevInRef.current[key]
          for (const curve of curves) {
            const inside = pointOverlapsCurve({ x: px, y: py }, curve, (pt.params.size as number) ?? 5)
            // Track state always; trigger only when running (so dragging while stopped doesn't retrigger on Play)
            if (inside && !ptPrev.has(curve.id) && running) {
              if (samplerModeRef.current.volumeMode === 'standpoint-distance') {
                flashDotEl(pt.id)
              } else {
                triggerIntersectionSound(curve, curve, samplesRef.current, triggerOptions(curve, curve, px, py))
                flashDotEl(pt.id)
              }
            }
            if (inside) { ptPrev.add(curve.id) } else { ptPrev.delete(curve.id) }
          }
        }

        // ── Sampler curve playhead → Curve intersections ─────────
        // The sampler playhead is not stored as geometry, but behaves like a moving point.
        for (const samplerCurve of curves) {
          if (!isSamplerPlayheadEnabled(samplerCurve)) continue
          const point = samplerPointAtTime(samplerCurve, nowSRef.current)
          const key = `sampler_pt_${samplerCurve.id}`
          if (!prevInRef.current[key]) prevInRef.current[key] = new Set()
          const samplerPrev = prevInRef.current[key]
          for (const curve of curves) {
            if (curve.id === samplerCurve.id) continue
            const inside = pointOverlapsCurve(point, curve, 7)
            if (inside && !samplerPrev.has(curve.id) && running) {
              if (samplerModeRef.current.volumeMode === 'standpoint-distance') {
                flashDotEl(samplerCurve.id)
              } else {
                const triggerCurve = samplerModeRef.current.triggerTarget === 'source-curve' ? samplerCurve : curve
                triggerIntersectionSound(samplerCurve, triggerCurve, samplesRef.current, triggerOptions(samplerCurve, triggerCurve, point.x, point.y))
                flashDotEl(samplerCurve.id)
              }
            }
            if (inside) { samplerPrev.add(curve.id) } else { samplerPrev.delete(curve.id) }
          }
        }
      }

      if (running && activeRule === 'rendezvous') {
        const movingPoints = [
          ...curves.filter(isSamplerPlayheadEnabled).map(curve => ({
            owner: curve,
            point: samplerPointAtTime(curve, nowSRef.current),
          })),
          ...geoRef.current.filter(o => o.type === 'point').map(pointGeom => ({
            owner: pointGeom,
            point: {
              x: (pointGeom.params.x as number) ?? 0,
              y: (pointGeom.params.y as number) ?? 0,
            },
          })),
        ]
        const rMode = samplerModeRef.current.triggerTarget
        for (let i = 0; i < movingPoints.length; i += 1) {
          const a = movingPoints[i]
          for (let j = i + 1; j < movingPoints.length; j += 1) {
            const b = movingPoints[j]
            const distance = Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y)
            const radiusA = rendezvousRadius(a.owner)
            const radiusB = rendezvousRadius(b.owner)
            // Rendezvous fires when the dashed radius circles around the points overlap.
            const collisionDistance = radiusA + radiusB
            const inside = distance <= collisionDistance
            const pairId = [a.owner.id, b.owner.id].sort().join('__')
            if (!prevInRef.current.rendezvous_pairs) prevInRef.current.rendezvous_pairs = new Set()
            const pairPrev = prevInRef.current.rendezvous_pairs
            if (inside && !pairPrev.has(pairId)) {
              flashDotEl(a.owner.id, radiusA)
              flashDotEl(b.owner.id, radiusB)
            }
            if (inside) { pairPrev.add(pairId) } else { pairPrev.delete(pairId) }

            // ── A's rising-edge ───────────────────────────────────────────────
            const keyA = `rendezvous_${a.owner.id}`
            if (!prevInRef.current[keyA]) prevInRef.current[keyA] = new Set()
            const prevA = prevInRef.current[keyA]
            if (inside && !prevA.has(b.owner.id)) {
              // source-curve → play A's sample; touched-curve (other owner) → play B's sample
              const triggerA = rMode === 'source-curve' ? a.owner : b.owner
              triggerIntersectionSound(a.owner, triggerA, samplesRef.current, triggerOptions(a.owner, triggerA, a.point.x, a.point.y, distance, collisionDistance))
            }
            if (inside) { prevA.add(b.owner.id) } else { prevA.delete(b.owner.id) }

            // ── B's rising-edge (mirror) ──────────────────────────────────────
            const keyB = `rendezvous_${b.owner.id}`
            if (!prevInRef.current[keyB]) prevInRef.current[keyB] = new Set()
            const prevB = prevInRef.current[keyB]
            if (inside && !prevB.has(a.owner.id)) {
              const triggerB = rMode === 'source-curve' ? b.owner : a.owner
              triggerIntersectionSound(b.owner, triggerB, samplesRef.current, triggerOptions(b.owner, triggerB, b.point.x, b.point.y, distance, collisionDistance))
            }
            if (inside) { prevB.add(a.owner.id) } else { prevB.delete(a.owner.id) }
          }
        }
      }

      // ── Standpoint proximity zone ─────────────────────────────────────────
      // When volumeMode is 'standpoint-distance', curve playheads/points inside
      // the standpoint circle play their geometry's sample in a loop, with volume
      // continuously scaled by distance from the standpoint center.
      const spSettings = samplerModeRef.current
      if (spSettings.volumeMode === 'standpoint-distance' && spSettings.standpoint) {
        const sp  = spSettings.standpoint
        const spR = spSettings.standpointRadius
        const spPrev = prevSpRef.current
        const spSamplePrev = prevSpSampleRef.current

        // Collect current dot positions
        const spDots: Array<{ key: string; geomId: string; x: number; y: number; sampleId: string | null | undefined }> = []

        for (const curve of curves.filter(isSamplerPlayheadEnabled)) {
          const point = samplerPointAtTime(curve, nowSRef.current)
          spDots.push({ key: `curve_${curve.id}`, geomId: curve.id, x: point.x, y: point.y, sampleId: curve.sampleId })
        }
        for (const pointGeom of geoRef.current.filter(o => o.type === 'point')) {
          spDots.push({
            key: `point_${pointGeom.id}`,
            geomId: pointGeom.id,
            x: (pointGeom.params.x as number) ?? 0,
            y: (pointGeom.params.y as number) ?? 0,
            sampleId: pointGeom.sampleId,
          })
        }

        for (const dot of spDots) {
          const dist   = Math.hypot(dot.x - sp.x, dot.y - sp.y)
          const inside = dist <= spR && running
          const wasIn  = spPrev.get(dot.key) ?? false
          const sample = dot.sampleId ? samplesRef.current.find(s => s.id === dot.sampleId) : null
          const previousSampleId = spSamplePrev.get(dot.key)

          if (inside && sample) {
            const vol = mapRangeClamped(dist, 0, spR, 1, spSettings.standpointVolumeMin)
            if (previousSampleId && previousSampleId !== sample.id) {
              stopStandpointSound(previousSampleId)
            }
            if (!wasIn || previousSampleId !== sample.id) {
              startStandpointSound(sample, vol)
              flashDotEl(dot.geomId)
            } else {
              setPlayerVolume(sample.id, vol)
            }
            spSamplePrev.set(dot.key, sample.id)
          } else if ((!inside || !sample) && wasIn && previousSampleId) {
            stopStandpointSound(previousSampleId)
            spSamplePrev.delete(dot.key)
          }

          spPrev.set(dot.key, inside && Boolean(sample))
        }
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      lastTRef.current = 0
    }
  }, [])

  function screenPoint(e: React.MouseEvent<SVGSVGElement>): Point {
    const svg  = svgRef.current!
    const rect = svg.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function canvasPoint(e: React.MouseEvent<SVGSVGElement>): Point {
    const p = screenPoint(e)
    return { x: (p.x - viewOffset.x) / zoom, y: (p.y - viewOffset.y) / zoom }
  }

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    if (tool === 'select' || tool === 'pan' || tool === 'boxSelect' || tool === 'addWay') return
    const { x, y } = canvasPoint(e)
    if (tool === 'addPoint') {
      addGeom({
        id: `geom_${nanoid(6)}`, type: 'point',
        role: 'base',
        params: { x, y, size: canvasSettings.pointSize },
        style: { stroke: canvasSettings.stroke, strokeWidth: canvasSettings.strokeWidth, fill: canvasSettings.fill === 'none' ? canvasSettings.stroke : canvasSettings.fill },
      })
    } else if (tool === 'addPath') {
      const rx = Math.round(x), ry = Math.round(y)
      const span = canvasSettings.pathSpan
      addGeom({
        id: `geom_${nanoid(6)}`, type: 'path',
        role: 'base',
        params: { svgPath: `M ${rx} ${ry} C ${rx + span * 0.3} ${ry - span * 0.3}, ${rx + span * 0.7} ${ry + span * 0.3}, ${rx + span} ${ry}` },
        style: { stroke: canvasSettings.stroke, strokeWidth: canvasSettings.strokeWidth, fill: 'none' },
      })
    }
  }

  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (e.button === 2) {
      e.preventDefault()
      setDrag({ kind: 'pan', start: screenPoint(e), current: screenPoint(e), originOffset: viewOffset })
      return
    }
    if (e.button !== 0) return
    if (tool === 'pan') {
      setDrag({ kind: 'pan', start: screenPoint(e), current: screenPoint(e), originOffset: viewOffset })
    } else if (tool === 'boxSelect' || tool === 'select') {
      const p = screenPoint(e)
      setDrag({ kind: 'box', start: p, current: p, originOffset: viewOffset })
    } else if (tool === 'addWay') {
      const p = screenPoint(e)
      setDrag({ kind: 'way', start: p, current: p, originOffset: viewOffset })
    } else if (tool === 'addCircle') {
      const p = screenPoint(e)
      setDrag({ kind: 'circle', start: p, current: p, originOffset: viewOffset })
    }
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (standpointDrag) {
      const current = canvasPoint(e)
      updateSamplerMode({
        standpoint: {
          x: standpointDrag.startPos.x + (current.x - standpointDrag.startCanvas.x),
          y: standpointDrag.startPos.y + (current.y - standpointDrag.startCanvas.y),
        },
      })
      return
    }
    if (editDrag) {
      const current = canvasPoint(e)
      updateGeom(editDrag.id, editGeometryParams(editDrag, current))
      return
    }
    if (!drag) return
    const current = screenPoint(e)
    setDrag({ ...drag, current })
    if (drag.kind === 'pan') {
      setViewOffset({
        x: drag.originOffset.x + current.x - drag.start.x,
        y: drag.originOffset.y + current.y - drag.start.y,
      })
    }
  }

  function handleMouseUp() {
    if (standpointDrag) {
      setStandpointDrag(null)
      return
    }
    if (editDrag) {
      setEditDrag(null)
      return
    }
    if (!drag) return
    if (drag.kind === 'box') {
      const screenBox = makeBox(drag.start, drag.current)
      const moved = Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y)
      if (moved > 3 || tool === 'boxSelect') {
        suppressBgClickRef.current = true
        const canvasBox = {
          x: (screenBox.x - viewOffset.x) / zoom,
          y: (screenBox.y - viewOffset.y) / zoom,
          width: screenBox.width / zoom,
          height: screenBox.height / zoom,
        }
        const ids = geometry.filter(obj => boxesIntersect(canvasBox, geometryBounds(obj))).map(obj => obj.id)
        selectGeometryRange(ids)
      }
    }
    if (drag.kind === 'way') {
      const a = { x: (drag.start.x - viewOffset.x) / zoom, y: (drag.start.y - viewOffset.y) / zoom }
      const b = { x: (drag.current.x - viewOffset.x) / zoom, y: (drag.current.y - viewOffset.y) / zoom }
      // Minimum drag distance = 20px to avoid accidental tiny ways
      if (Math.hypot(b.x - a.x, b.y - a.y) > 20) {
        addGeom({
          id: `geom_${nanoid(6)}`, type: 'way',
          role: 'base',
          params: { ax: a.x, ay: a.y, bx: b.x, by: b.y, speed: 150, mode: 'bounce' },
          style: { stroke: canvasSettings.stroke, strokeWidth: canvasSettings.strokeWidth, fill: 'none' },
        })
      }
    }
    if (drag.kind === 'circle') {
      const center = { x: (drag.start.x - viewOffset.x) / zoom, y: (drag.start.y - viewOffset.y) / zoom }
      const edge = { x: (drag.current.x - viewOffset.x) / zoom, y: (drag.current.y - viewOffset.y) / zoom }
      const r = Math.hypot(edge.x - center.x, edge.y - center.y)
      if (r > 3) {
        addGeom({
          id: `geom_${nanoid(6)}`, type: 'circle',
          role: 'base',
          params: { cx: center.x, cy: center.y, r },
          style: { stroke: canvasSettings.stroke, strokeWidth: canvasSettings.strokeWidth, fill: canvasSettings.fill },
        })
      }
    }
    setDrag(null)
  }

  function handleWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault()
    if (!e.ctrlKey && !e.metaKey) {
      setViewOffset(offset => ({
        x: offset.x - e.deltaX,
        y: offset.y - e.deltaY,
      }))
      return
    }

    const p = screenPoint(e)
    const nextZoom = Math.max(0.2, Math.min(5, zoom * Math.exp(-e.deltaY * 0.0022)))
    const world = { x: (p.x - viewOffset.x) / zoom, y: (p.y - viewOffset.y) / zoom }
    setViewOffset({
      x: p.x - world.x * nextZoom,
      y: p.y - world.y * nextZoom,
    })
    updateCanvasSettings({ zoom: Number(nextZoom.toFixed(3)) })
  }

  function handleShapeClick(e: React.MouseEvent, id: string) {
    // Allow selection with any tool — stopPropagation prevents background from creating geometry
    e.stopPropagation()
    if (e.shiftKey) {
      toggleGeometrySelection(id)
      return
    }
    selectGeometry(id)
  }

  function handleShapeMouseDown(e: React.MouseEvent, obj: GeometryObject) {
    if (e.button === 2) return
    if (obj.role === 'derived' || obj.sourceNodeId) return
    // Always stop propagation so drawing tools don't start a new draw on top of a shape
    e.stopPropagation()
    // Select the shape with any tool
    if (!selectedGeomIds.includes(obj.id) && obj.id !== selectedGeomId) {
      selectGeometry(obj.id)
    }
    setEditDrag({
      id: obj.id,
      kind: 'move',
      start: canvasPointFromMouseEvent(e),
      startParams: { ...obj.params },
    })
  }

  function handleEditHandleMouseDown(e: React.MouseEvent, obj: GeometryObject, kind: 'circleHandle' | 'pathNode' | 'wayEndpoint' | 'rotate', handle: string) {
    if (e.button === 2) return
    if (obj.role === 'derived' || obj.sourceNodeId) return
    e.stopPropagation()
    selectGeometry(obj.id)
    setEditDrag({
      id: obj.id,
      kind,
      handle,
      start: canvasPointFromMouseEvent(e),
      startParams: { ...obj.params },
    })
  }

  function canvasPointFromMouseEvent(e: React.MouseEvent): Point {
    const svg  = svgRef.current!
    const rect = svg.getBoundingClientRect()
    return { x: (e.clientX - rect.left - viewOffset.x) / zoom, y: (e.clientY - rect.top - viewOffset.y) / zoom }
  }

  function handleBgClick(e: React.MouseEvent) {
    if (suppressBgClickRef.current) {
      suppressBgClickRef.current = false
      return
    }
    // Place standpoint on first click when mode is active but not yet placed
    if (mode === 'sampler'
      && samplerModeRef.current.volumeMode === 'standpoint-distance'
      && !samplerModeRef.current.standpoint) {
      const p = canvasPoint(e as React.MouseEvent<SVGSVGElement>)
      updateSamplerMode({ standpoint: { x: p.x, y: p.y } })
    }
    selectGeometry(null)
  }

  const circles = geometry.filter(o => o.type === 'circle')
  const samplerCurves = mode === 'sampler' ? geometry.filter(isCurveGeometry) : []
  const activeSamplerCurves = samplerCurves.filter(isSamplerPlayheadEnabled)
  const rendezvousGuidePoints = mode === 'sampler'
    && samplerMode.activeRule === 'rendezvous'
    && samplerMode.showRendezvousDistance
    ? [
        ...activeSamplerCurves.map(obj => samplerPointAtTime(obj, timeSeconds)),
        ...geometry.filter(o => o.type === 'point').map(obj => ({
          x: (obj.params.x as number) ?? 0,
          y: (obj.params.y as number) ?? 0,
        })),
      ]
    : []
  const isPlacingStandpoint = mode === 'sampler'
    && samplerMode.volumeMode === 'standpoint-distance'
    && !samplerMode.standpoint
  const cursor = standpointDrag ? 'grabbing'
    : drag?.kind === 'pan' ? 'grabbing'
    : tool === 'pan' ? 'grab'
    : tool === 'boxSelect' ? 'crosshair'
    : tool === 'select' ? (isPlacingStandpoint ? 'cell' : 'default')
    : 'crosshair'
  const selectionBox = drag?.kind === 'box' ? makeBox(drag.start, drag.current) : null
  const circlePreview = drag?.kind === 'circle'
    ? {
        cx: (drag.start.x - viewOffset.x) / zoom,
        cy: (drag.start.y - viewOffset.y) / zoom,
        r: Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) / zoom,
      }
    : null

  return (
    <svg
      ref={svgRef}
      style={{ width: '100%', height: '100%', display: 'block', cursor }}
      onClick={handleSvgClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={e => e.preventDefault()}
      onWheel={handleWheel}
    >
      <defs>
        <pattern id="dotGrid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.08)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dotGrid)" onClick={handleBgClick} />

      <g transform={`translate(${viewOffset.x} ${viewOffset.y}) scale(${zoom})`}>
        {/* eslint-disable react-hooks/purity, react-hooks/refs */}
        {geometry.map(obj => (
          <GeomShape
            key={obj.id}
            obj={obj}
            selected={selectedGeomIds.includes(obj.id) || obj.id === selectedGeomId}
            highlighted={highlightedGeometryIds.has(obj.id)}
            flashed={Boolean(flashExpRef.current[obj.id] && Date.now() < flashExpRef.current[obj.id])}
            onSelect={handleShapeClick}
            onShapeMouseDown={handleShapeMouseDown}
            onEditHandleMouseDown={handleEditHandleMouseDown}
          />
        ))}
        {/* eslint-enable react-hooks/purity, react-hooks/refs */}

        {activeSamplerCurves.map(obj => (
          <SamplerCurvePlayhead
            key={`sampler-curve-${obj.id}`}
            obj={obj}
            timeSeconds={timeSeconds}
            samples={samples}
            showLabel={samplerMode.showPointLabels}
          />
        ))}

        {rendezvousGuidePoints.map((point, index) => (
          <circle
            key={`rendezvous-guide-${index}`}
            cx={point.x}
            cy={point.y}
            r={samplerMode.rendezvousDistance}
            fill="rgba(245,158,11,0.06)"
            stroke="#f59e0b"
            strokeWidth={1}
            strokeDasharray="5 4"
            pointerEvents="none"
          />
        ))}

        {/* Standpoint marker — draggable ⊕ reference point */}
        {mode === 'sampler' && samplerMode.volumeMode === 'standpoint-distance' && samplerMode.standpoint && (() => {
          const sp = samplerMode.standpoint
          const r  = samplerMode.standpointRadius
          const arm = 8 / zoom
          return (
            <g
              style={{ cursor: standpointDrag ? 'grabbing' : 'grab' }}
              onMouseDown={e => {
                if (e.button !== 0) return
                e.stopPropagation()
                // eslint-disable-next-line react-hooks/refs
                setStandpointDrag({ startCanvas: canvasPoint(e as React.MouseEvent<SVGSVGElement>), startPos: { x: sp.x, y: sp.y } })
              }}
            >
              {/* Falloff radius ring */}
              {samplerMode.showStandpointRadius && (
                <circle
                  cx={sp.x} cy={sp.y} r={r}
                  fill="none"
                  stroke="rgba(0,0,0,0.22)"
                  strokeWidth={1 / zoom}
                  strokeDasharray={`${5 / zoom} ${4 / zoom}`}
                  pointerEvents="none"
                />
              )}
              {/* Hit area */}
              <circle cx={sp.x} cy={sp.y} r={12 / zoom} fill="transparent" />
              {/* Crosshair arms */}
              <line x1={sp.x - arm} y1={sp.y} x2={sp.x + arm} y2={sp.y} stroke="#7c3aed" strokeWidth={1.5 / zoom} pointerEvents="none" />
              <line x1={sp.x} y1={sp.y - arm} x2={sp.x} y2={sp.y + arm} stroke="#7c3aed" strokeWidth={1.5 / zoom} pointerEvents="none" />
              {/* Center dot */}
              <circle cx={sp.x} cy={sp.y} r={4 / zoom} fill="white" stroke="#7c3aed" strokeWidth={1.5 / zoom} pointerEvents="none" />
            </g>
          )
        })()}

        {/* Orbit arms + dots — initial positions set here, then moved by RAF */}
        {circles.map(obj => {
          if (!hasOrbitParams(obj)) return null
          const cx = (obj.params.cx as number) ?? 0
          const cy = (obj.params.cy as number) ?? 0
          const r  = (obj.params.r  as number) ?? 100
          return (
            <g key={`orbit-${obj.id}`} style={{ pointerEvents: 'none' }}>
              <line
                id={`orbit-arm-${obj.id}`}
                x1={cx} y1={cy} x2={cx + r} y2={cy}
                stroke="rgba(0,0,0,0.18)" strokeWidth={0.8}
              />
              <circle
                id={`orbit-dot-${obj.id}`}
                cx={cx + r} cy={cy} r={4}
                fill="#f59e0b" stroke="white" strokeWidth={1}
              />
            </g>
          )
        })}

        {/* Way scanner dots — initial position at A, moved by RAF */}
        {geometry.filter(o => o.type === 'way').map(obj => {
          const ax = (obj.params.ax as number) ?? 0
          const ay = (obj.params.ay as number) ?? 0
          return (
            <circle
              key={`way-dot-${obj.id}`}
              id={`way-dot-${obj.id}`}
              cx={ax} cy={ay} r={6}
              fill="#f59e0b" stroke="white" strokeWidth={1.5}
              style={{ pointerEvents: 'none' }}
            />
          )
        })}

        {circlePreview && (
          <g pointerEvents="none">
            <circle
              cx={circlePreview.cx}
              cy={circlePreview.cy}
              r={3 / zoom}
              fill="#2563eb"
              stroke="white"
              strokeWidth={1 / zoom}
            />
            <circle
              cx={circlePreview.cx}
              cy={circlePreview.cy}
              r={circlePreview.r}
              fill={canvasSettings.fill}
              stroke={canvasSettings.stroke}
              strokeWidth={canvasSettings.strokeWidth}
              strokeDasharray={`${6 / zoom} ${4 / zoom}`}
              opacity={0.75}
            />
          </g>
        )}
      </g>

      {selectionBox && (
        <rect
          x={selectionBox.x}
          y={selectionBox.y}
          width={selectionBox.width}
          height={selectionBox.height}
          fill="rgba(37,99,235,0.08)"
          stroke="#2563eb"
          strokeWidth={1}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}

      {/* Way drag preview */}
      {drag?.kind === 'way' && (
        <line
          x1={drag.start.x} y1={drag.start.y}
          x2={drag.current.x} y2={drag.current.y}
          stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 4"
          pointerEvents="none"
        />
      )}
    </svg>
  )
}

function SamplerCurvePlayhead({ obj, timeSeconds, samples, showLabel }: {
  obj: GeometryObject
  timeSeconds: number
  samples: SampleAsset[]
  showLabel: boolean
}) {
  const point = samplerPointAtTime(obj, timeSeconds)
  const sampleLabel = sampleLabelForGeometry(obj, samples)

  return (
    <g id={`sampler-playhead-${obj.id}`} pointerEvents="none">
      <SamplerCurveTrack obj={obj} />
      <circle
        id={`sampler-dot-${obj.id}`}
        cx={point.x}
        cy={point.y}
        r={7}
        fill="#f59e0b"
        stroke="white"
        strokeWidth={2}
      />
      <circle
        cx={point.x}
        cy={point.y}
        r={12}
        fill="none"
        stroke="#f59e0b"
        strokeWidth={1.5}
        opacity={0.35}
      />
      {showLabel && sampleLabel && (
        <text
          x={point.x + 12}
          y={point.y - 10}
          fill="#92400e"
          fontSize={10}
          fontWeight={700}
          style={{ userSelect: 'none' }}
        >
          {sampleLabel}
        </text>
      )}
    </g>
  )
}

function sampleLabelForGeometry(obj: GeometryObject, samples: SampleAsset[]): string {
  if (!obj.sampleId) return ''
  return samples.find(sample => sample.id === obj.sampleId)?.name ?? 'missing sample'
}

function SamplerCurveTrack({ obj }: { obj: GeometryObject }) {
  const common = {
    id: `sampler-track-${obj.id}`,
    fill: 'none',
    stroke: '#f59e0b',
    strokeWidth: 5,
    opacity: 0.18,
  }

  if (obj.type === 'circle') {
    const cx = (obj.params.cx as number) ?? 0
    const cy = (obj.params.cy as number) ?? 0
    const r = (obj.params.r as number) ?? 0
    const rx = (obj.params.rx as number) ?? r
    const ry = (obj.params.ry as number) ?? r
    return <ellipse {...common} cx={cx} cy={cy} rx={rx} ry={ry} />
  }

  if (obj.type === 'way') {
    const ax = (obj.params.ax as number) ?? 0
    const ay = (obj.params.ay as number) ?? 0
    const bx = (obj.params.bx as number) ?? 0
    const by = (obj.params.by as number) ?? 0
    return <line {...common} x1={ax} y1={ay} x2={bx} y2={by} strokeLinecap="round" />
  }

  return (
    <path
      {...common}
      d={(obj.params.svgPath as string) ?? ''}
      strokeLinecap="round"
    />
  )
}

function hasOrbitParams(obj: GeometryObject): boolean {
  return typeof obj.params.orbitDistance === 'number'
    && typeof obj.params.orbitTime === 'number'
    && obj.params.orbitTime > 0
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
    || target.isContentEditable
}

function makeBox(a: Point, b: Point): Box {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

function boxesIntersect(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y
}

function isCurveGeometry(obj: GeometryObject): boolean {
  return obj.type !== 'point'
}

function pointOverlapsCurve(point: Point, curve: GeometryObject, pointRadius = 5): boolean {
  const tolerance = Math.max(8, pointRadius + curve.style.strokeWidth / 2)
  return distanceToCurve(point, curve) <= tolerance
}

function geometryCenter(geom: GeometryObject): Point {
  if (geom.type === 'circle') {
    return {
      x: (geom.params.cx as number) ?? 0,
      y: (geom.params.cy as number) ?? 0,
    }
  }
  if (geom.type === 'point') {
    return {
      x: (geom.params.x as number) ?? 0,
      y: (geom.params.y as number) ?? 0,
    }
  }
  if (geom.type === 'way') {
    const ax = (geom.params.ax as number) ?? 0
    const ay = (geom.params.ay as number) ?? 0
    const bx = (geom.params.bx as number) ?? 0
    const by = (geom.params.by as number) ?? 0
    return { x: (ax + bx) / 2, y: (ay + by) / 2 }
  }
  const bounds = pathBounds((geom.params.svgPath as string) ?? '')
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

function mapRangeClamped(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (value - inMin) / Math.max(0.0001, inMax - inMin)))
  return outMin + (outMax - outMin) * t
}

function rendezvousRadius(_: GeometryObject): number {
  return Math.max(0, useSamplerModeStore.getState().rendezvousDistance)
}

function distanceToCurve(point: Point, curve: GeometryObject): number {
  const points = sampleCurve(curve)
  if (points.length === 0) return Number.POSITIVE_INFINITY
  if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y)
  return distanceToPolyline(point, points)
}

function sampleCurve(curve: GeometryObject): Point[] {
  if (curve.type === 'circle') return sampleCircle(curve)
  if (curve.type === 'way') {
    const ax = (curve.params.ax as number) ?? 0
    const ay = (curve.params.ay as number) ?? 0
    const bx = (curve.params.bx as number) ?? 0
    const by = (curve.params.by as number) ?? 0
    return [{ x: ax, y: ay }, { x: bx, y: by }]
  }
  return sampleSvgPath((curve.params.svgPath as string) ?? '')
}

function sampleCircle(circle: GeometryObject): Point[] {
  const cx = (circle.params.cx as number) ?? 0
  const cy = (circle.params.cy as number) ?? 0
  const r = (circle.params.r as number) ?? 0
  const rx = (circle.params.rx as number) ?? r
  const ry = (circle.params.ry as number) ?? r
  const rotation = ((circle.params.rotation as number) ?? 0) * Math.PI / 180
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  if (rx <= 0 || ry <= 0) return [{ x: cx, y: cy }]

  return Array.from({ length: 129 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 128
    const localX = Math.cos(angle) * rx
    const localY = Math.sin(angle) * ry
    return {
      x: cx + localX * cos - localY * sin,
      y: cy + localX * sin + localY * cos,
    }
  })
}

function distanceToPolyline(point: Point, points: Point[]): number {
  let min = Number.POSITIVE_INFINITY
  for (let i = 1; i < points.length; i += 1) {
    min = Math.min(min, distanceToSegment(point, points[i - 1], points[i]))
  }
  return min
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const lengthSq = vx * vx + vy * vy
  if (lengthSq <= 0) return Math.hypot(point.x - a.x, point.y - a.y)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * vx + (point.y - a.y) * vy) / lengthSq))
  const x = a.x + vx * t
  const y = a.y + vy * t
  return Math.hypot(point.x - x, point.y - y)
}

function geometryBounds(obj: GeometryObject): Box {
  if (obj.type === 'circle') {
    const cx = (obj.params.cx as number) ?? 0
    const cy = (obj.params.cy as number) ?? 0
    const r = (obj.params.r as number) ?? 0
    const rx = (obj.params.rx as number) ?? r
    const ry = (obj.params.ry as number) ?? r
    return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 }
  }
  if (obj.type === 'point') {
    const x = (obj.params.x as number) ?? 0
    const y = (obj.params.y as number) ?? 0
    return { x: x - 5, y: y - 5, width: 10, height: 10 }
  }
  if (obj.type === 'way') {
    const ax = (obj.params.ax as number) ?? 0
    const ay = (obj.params.ay as number) ?? 0
    const bx = (obj.params.bx as number) ?? 0
    const by = (obj.params.by as number) ?? 0
    return { x: Math.min(ax, bx) - 10, y: Math.min(ay, by) - 10, width: Math.abs(bx - ax) + 20, height: Math.abs(by - ay) + 20 }
  }
  return pathBounds((obj.params.svgPath as string) ?? '')
}

function pathBounds(path: string): Box {
  const nums = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
  if (nums.length < 2) return { x: 0, y: 0, width: 0, height: 0 }
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < nums.length - 1; i += 2) {
    xs.push(nums[i])
    ys.push(nums[i + 1])
  }
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function editGeometryParams(editDrag: {
  kind: 'move' | 'circleHandle' | 'pathNode' | 'wayEndpoint' | 'rotate'
  handle?: string
  start: Point
  startParams: Record<string, unknown>
}, current: Point): Record<string, number | string> {
  const dx = current.x - editDrag.start.x
  const dy = current.y - editDrag.start.y
  const p = editDrag.startParams

  if (editDrag.kind === 'move') {
    if (typeof p.cx === 'number' && typeof p.cy === 'number') return { cx: p.cx + dx, cy: p.cy + dy }
    if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x + dx, y: p.y + dy }
    if (typeof p.svgPath === 'string') return { svgPath: translatePath(p.svgPath, dx, dy) }
    if (typeof p.ax === 'number') return {
      ax: (p.ax as number) + dx, ay: (p.ay as number) + dy,
      bx: (p.bx as number) + dx, by: (p.by as number) + dy,
    }
  }

  if (editDrag.kind === 'wayEndpoint') {
    if (editDrag.handle === 'a') return { ax: current.x, ay: current.y }
    if (editDrag.handle === 'b') return { bx: current.x, by: current.y }
  }

  if (editDrag.kind === 'circleHandle') {
    const cx = (p.cx as number) ?? 0
    const cy = (p.cy as number) ?? 0
    const r = (p.r as number) ?? 1
    const next = { rx: (p.rx as number) ?? r, ry: (p.ry as number) ?? r }
    if (editDrag.handle === 'east' || editDrag.handle === 'west') next.rx = Math.max(1, Math.abs(current.x - cx))
    if (editDrag.handle === 'south' || editDrag.handle === 'north') next.ry = Math.max(1, Math.abs(current.y - cy))
    return next
  }

  if (editDrag.kind === 'pathNode' && typeof p.svgPath === 'string' && editDrag.handle) {
    const parsed = parseCubicPath(p.svgPath)
    if (!parsed) return {}
    parsed[editDrag.handle] = current
    return { svgPath: cubicPathString(parsed) }
  }

  if (editDrag.kind === 'rotate') {
    const center = centerFromParams(p)
    const startAngle = Math.atan2(editDrag.start.y - center.y, editDrag.start.x - center.x)
    const currentAngle = Math.atan2(current.y - center.y, current.x - center.x)
    const delta = currentAngle - startAngle
    const deltaDeg = delta * 180 / Math.PI
    if (typeof p.cx === 'number' && typeof p.cy === 'number') {
      return { rotation: ((p.rotation as number) ?? 0) + deltaDeg }
    }
    if (typeof p.svgPath === 'string') {
      const parsed = parseCubicPath(p.svgPath)
      if (!parsed) return {}
      return {
        svgPath: cubicPathString({
          start: rotatePoint(parsed.start, center, delta),
          c1: rotatePoint(parsed.c1, center, delta),
          c2: rotatePoint(parsed.c2, center, delta),
          end: rotatePoint(parsed.end, center, delta),
        }),
      }
    }
    if (typeof p.ax === 'number') {
      const a = rotatePoint({ x: (p.ax as number) ?? 0, y: (p.ay as number) ?? 0 }, center, delta)
      const b = rotatePoint({ x: (p.bx as number) ?? 0, y: (p.by as number) ?? 0 }, center, delta)
      return { ax: a.x, ay: a.y, bx: b.x, by: b.y }
    }
  }

  return {}
}

function centerFromParams(params: Record<string, unknown>): Point {
  if (typeof params.cx === 'number' && typeof params.cy === 'number') return { x: params.cx, y: params.cy }
  if (typeof params.ax === 'number') {
    return {
      x: ((params.ax as number) + ((params.bx as number) ?? 0)) / 2,
      y: (((params.ay as number) ?? 0) + ((params.by as number) ?? 0)) / 2,
    }
  }
  if (typeof params.svgPath === 'string') {
    const bounds = pathBounds(params.svgPath)
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  }
  return { x: 0, y: 0 }
}

function rotatePoint(point: Point, center: Point, angle: number): Point {
  const dx = point.x - center.x
  const dy = point.y - center.y
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}

function translatePath(path: string, dx: number, dy: number): string {
  const parsed = parseCubicPath(path)
  if (!parsed) return path
  return cubicPathString({
    start: { x: parsed.start.x + dx, y: parsed.start.y + dy },
    c1: { x: parsed.c1.x + dx, y: parsed.c1.y + dy },
    c2: { x: parsed.c2.x + dx, y: parsed.c2.y + dy },
    end: { x: parsed.end.x + dx, y: parsed.end.y + dy },
  })
}

function parseCubicPath(path: string): Record<string, Point> | null {
  const nums = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
  if (nums.length < 8) return null
  return {
    start: { x: nums[0], y: nums[1] },
    c1: { x: nums[2], y: nums[3] },
    c2: { x: nums[4], y: nums[5] },
    end: { x: nums[6], y: nums[7] },
  }
}

function cubicPathString(points: Record<string, Point>): string {
  return `M ${round(points.start.x)} ${round(points.start.y)} C ${round(points.c1.x)} ${round(points.c1.y)}, ${round(points.c2.x)} ${round(points.c2.y)}, ${round(points.end.x)} ${round(points.end.y)}`
}

function isSamplerPlayheadEnabled(curve: GeometryObject): boolean {
  return curve.params.pointOnCurveEnabled !== false
}

function samplerPointAtTime(curve: GeometryObject, timeSeconds: number): Point {
  const speed = Math.max(0, (curve.params.speed as number) ?? 120)
  return pointOnSamplerCurve(curve, timeSeconds * speed)
}

function pointOnSamplerCurve(curve: GeometryObject, distance: number): Point {
  const points = sampleCurve(curve)
  const total = polylineLength(points)
  if (total <= 0) return points[0] ?? { x: 0, y: 0 }

  const motionMode = samplerMotionMode(curve, points)
  const reverse = curve.params.samplerReverse === true
  if (motionMode === 'bounce') {
    const d = pingPongDistance(points, distance)
    return pointOnPolyline(points, reverse ? total - d : d)
  }

  let d = distance % total
  if (d < 0) d += total
  if (reverse) d = total - d
  return pointOnPolyline(points, d)
}

function samplerMotionMode(curve: GeometryObject, points: Point[]): 'loop' | 'bounce' {
  const mode = curve.params.samplerMotionMode
  if (mode === 'loop' || mode === 'bounce') return mode
  return isClosedCurve(curve, points) ? 'loop' : 'bounce'
}

function pointOnPolyline(points: Point[], distance: number): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]

  const segments = points.slice(1).map((point, index) => {
    const prev = points[index]
    return {
      from: prev,
      to: point,
      length: Math.hypot(point.x - prev.x, point.y - prev.y),
    }
  })
  const total = segments.reduce((sum, segment) => sum + segment.length, 0)
  if (total <= 0) return points[0]

  let d = distance % total
  if (d < 0) d += total
  for (const segment of segments) {
    if (d > segment.length) {
      d -= segment.length
      continue
    }
    const t = segment.length === 0 ? 0 : d / segment.length
    return {
      x: segment.from.x + (segment.to.x - segment.from.x) * t,
      y: segment.from.y + (segment.to.y - segment.from.y) * t,
    }
  }
  return points[points.length - 1]
}

function isClosedCurve(curve: GeometryObject, points: Point[]): boolean {
  if (curve.type === 'circle') return true
  if (curve.type === 'way') return false
  const svgPath = (curve.params.svgPath as string) ?? ''
  if (/\bZ\b/i.test(svgPath)) return true
  if (points.length < 2) return false
  const first = points[0]
  const last = points[points.length - 1]
  return Math.hypot(first.x - last.x, first.y - last.y) < 0.001
}

function pingPongDistance(points: Point[], distance: number): number {
  const total = polylineLength(points)
  if (total <= 0) return 0
  const cycle = total * 2
  let d = distance % cycle
  if (d < 0) d += cycle
  return d > total ? cycle - d : d
}

function polylineLength(points: Point[]): number {
  return points.slice(1).reduce((sum, point, index) => {
    const prev = points[index]
    return sum + Math.hypot(point.x - prev.x, point.y - prev.y)
  }, 0)
}

function sampleSvgPath(svgPath: string): Point[] {
  const nums = svgPath.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
  if (nums.length < 2) return []
  const start = { x: nums[0], y: nums[1] }
  if (nums.length >= 8 && /\bC\b/i.test(svgPath)) {
    const c1 = { x: nums[2], y: nums[3] }
    const c2 = { x: nums[4], y: nums[5] }
    const end = { x: nums[6], y: nums[7] }
    return Array.from({ length: 65 }, (_, i) => cubic(start, c1, c2, end, i / 64))
  }

  const points: Point[] = []
  for (let i = 0; i < nums.length - 1; i += 2) points.push({ x: nums[i], y: nums[i + 1] })
  return points
}

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  return {
    x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Compute N−1 evenly-spaced perpendicular tick mark positions along a path.
 * `count` is the number of equal segments, so (count − 1) marks are returned
 * at arc-length positions 1/count, 2/count … (count−1)/count.
 * Each marker carries a unit normal vector (nx, ny) perpendicular to the path tangent.
 */
function getPathDivisionMarkers(
  pathData: string,
  count: number,
): Array<{ x: number; y: number; nx: number; ny: number }> {
  if (count < 2) return []
  const pts = sampleSvgPath(pathData)
  if (pts.length < 2) return []

  // Build cumulative arc-length table
  const cumLen: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    cumLen.push(cumLen[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  const totalLen = cumLen[cumLen.length - 1]
  if (totalLen <= 0) return []

  const result: Array<{ x: number; y: number; nx: number; ny: number }> = []

  for (let d = 1; d < count; d++) {
    const target = (d / count) * totalLen

    // Linear scan to find the segment that contains `target`
    let i = 1
    while (i < cumLen.length - 1 && cumLen[i] < target) i++

    const segLen = cumLen[i] - cumLen[i - 1]
    const t = segLen === 0 ? 0 : (target - cumLen[i - 1]) / segLen
    const x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t
    const y = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t

    // Tangent from this segment direction; normal is perpendicular
    const tx = pts[i].x - pts[i - 1].x
    const ty = pts[i].y - pts[i - 1].y
    const tLen = Math.hypot(tx, ty)
    result.push({
      x, y,
      nx: tLen > 0 ? -ty / tLen : 0,
      ny: tLen > 0 ?  tx / tLen : 1,
    })
  }

  return result
}

function RotationHandle({ center, handle, obj, onMouseDown }: {
  center: Point
  handle: Point
  obj: GeometryObject
  onMouseDown: (e: React.MouseEvent, obj: GeometryObject, kind: 'rotate', handle: string) => void
}) {
  return (
    <g>
      <line x1={center.x} y1={center.y} x2={handle.x} y2={handle.y} stroke="#2563eb" strokeWidth={0.8} opacity={0.35} />
      <circle
        cx={handle.x}
        cy={handle.y}
        r={6}
        fill="white"
        stroke="#2563eb"
        strokeWidth={1.5}
        style={{ cursor: 'grab' }}
        onMouseDown={e => onMouseDown(e, obj, 'rotate', 'rotate')}
      />
    </g>
  )
}

function GeomShape({ obj, selected, highlighted, flashed, onSelect, onShapeMouseDown, onEditHandleMouseDown }: {
  obj: GeometryObject
  selected: boolean
  highlighted: boolean
  flashed: boolean
  onSelect: (e: React.MouseEvent, id: string) => void
  onShapeMouseDown: (e: React.MouseEvent, obj: GeometryObject) => void
  onEditHandleMouseDown: (e: React.MouseEvent, obj: GeometryObject, kind: 'circleHandle' | 'pathNode' | 'wayEndpoint' | 'rotate', handle: string) => void
}) {
  const stroke  = flashed ? '#60a5fa' : selected ? '#2563eb' : obj.style.stroke
  const strokeW = flashed ? 3 : selected ? obj.style.strokeWidth + 1 : obj.style.strokeWidth
  const hitStrokeW = Math.max(14, strokeW + 10)
  const fill    = obj.style.fill === 'none' ? 'none' : obj.style.fill
  const opacity = obj.style.opacity ?? 1
  const clickable = {
    cursor: 'pointer',
    onClick: (e: React.MouseEvent) => onSelect(e, obj.id),
    onMouseDown: (e: React.MouseEvent) => onShapeMouseDown(e, obj),
  }

  switch (obj.type) {
    case 'circle': {
      const cx = (obj.params.cx as number) ?? 300
      const cy = (obj.params.cy as number) ?? 200
      const r  = (obj.params.r  as number) ?? 100
      const rx = (obj.params.rx as number) ?? r
      const ry = (obj.params.ry as number) ?? r
      const rotation = (obj.params.rotation as number) ?? 0
      const transform = `rotate(${rotation} ${cx} ${cy})`
      return (
        <g {...clickable}>
          <ellipse
            cx={cx} cy={cy} rx={rx} ry={ry}
            stroke="transparent" strokeWidth={hitStrokeW}
            fill="none"
            transform={transform}
          />
          {highlighted && (
            <ellipse
              cx={cx} cy={cy} rx={rx} ry={ry}
              stroke="#f59e0b" strokeWidth={Math.max(5, strokeW + 4)}
              fill="none" opacity={0.35}
              transform={transform}
            />
          )}
          <ellipse id={`geom-circle-${obj.id}`} cx={cx} cy={cy} rx={rx} ry={ry} stroke={stroke} strokeWidth={strokeW} fill={fill} opacity={opacity} transform={transform} />
          <line x1={cx-5} y1={cy} x2={cx+5} y2={cy} stroke={stroke} strokeWidth={0.8} opacity={0.5} />
          <line x1={cx} y1={cy-5} x2={cx} y2={cy+5} stroke={stroke} strokeWidth={0.8} opacity={0.5} />
          {selected && (
            <>
              {[
                ['east', cx + rx, cy],
                ['west', cx - rx, cy],
                ['south', cx, cy + ry],
                ['north', cx, cy - ry],
              ].map(([handle,hx,hy]) => (
                <circle
                  key={handle}
                  cx={hx as number}
                  cy={hy as number}
                  r={4}
                  fill="white"
                  stroke="#2563eb"
                  strokeWidth={1.5}
                  style={{ cursor: handle === 'east' || handle === 'west' ? 'ew-resize' : 'ns-resize' }}
                  onMouseDown={e => onEditHandleMouseDown(e, obj, 'circleHandle', handle as string)}
                />
              ))}
              <RotationHandle
                center={{ x: cx, y: cy }}
                handle={{ x: cx, y: cy - ry - 28 }}
                obj={obj}
                onMouseDown={onEditHandleMouseDown}
              />
            </>
          )}
        </g>
      )
    }
    case 'point': {
      const x = (obj.params.x as number) ?? 300
      const y = (obj.params.y as number) ?? 200
      const size = (obj.params.size as number) ?? 5
      return (
        <g {...clickable}>
          {highlighted && (
            <circle cx={x} cy={y} r={size + 5} fill="none" stroke="#f59e0b" strokeWidth={4} opacity={0.45} />
          )}
          <circle id={`point-dot-${obj.id}`} cx={x} cy={y} r={size} fill={selected ? '#2563eb' : stroke} stroke="white" strokeWidth={1.5} opacity={opacity} />
        </g>
      )
    }
    case 'path': {
      const d = (obj.params.svgPath as string) ?? ''
      const points = parseCubicPath(d)
      const bounds = pathBounds(d)
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      const divCount = typeof obj.params.divisionCount === 'number' ? Math.floor(obj.params.divisionCount as number) : 0
      const divMarkers = divCount >= 2 ? getPathDivisionMarkers(d, divCount) : []
      return (
        <g {...clickable}>
          <path
            d={d}
            stroke="transparent"
            strokeWidth={hitStrokeW}
            strokeLinecap="round"
            fill="none"
          />
          {highlighted && (
            <path d={d} stroke="#f59e0b" strokeWidth={Math.max(5, strokeW + 4)} fill="none" opacity={0.38} />
          )}
          <path d={d} stroke={stroke} strokeWidth={strokeW} fill={fill} opacity={opacity} />
          {/* Division marks */}
          {divMarkers.length > 0 && (
            <g pointerEvents="none">
              {divMarkers.map((m, i) => (
                <line
                  key={i}
                  x1={m.x + m.nx * 6} y1={m.y + m.ny * 6}
                  x2={m.x - m.nx * 6} y2={m.y - m.ny * 6}
                  stroke={stroke}
                  strokeWidth={1.5}
                  opacity={0.6}
                />
              ))}
            </g>
          )}
          {selected && points && (
            <g>
              <line x1={points.start.x} y1={points.start.y} x2={points.c1.x} y2={points.c1.y} stroke="#2563eb" strokeWidth={0.8} opacity={0.45} />
              <line x1={points.end.x} y1={points.end.y} x2={points.c2.x} y2={points.c2.y} stroke="#2563eb" strokeWidth={0.8} opacity={0.45} />
              {Object.entries(points).map(([handle, point]) => (
                <circle
                  key={handle}
                  cx={point.x}
                  cy={point.y}
                  r={handle === 'start' || handle === 'end' ? 4.5 : 3.5}
                  fill={handle === 'start' || handle === 'end' ? 'white' : '#dbeafe'}
                  stroke="#2563eb"
                  strokeWidth={1.5}
                  style={{ cursor: 'move' }}
                  onMouseDown={e => onEditHandleMouseDown(e, obj, 'pathNode', handle)}
                />
              ))}
              <RotationHandle
                center={center}
                handle={{ x: center.x, y: bounds.y - 28 }}
                obj={obj}
                onMouseDown={onEditHandleMouseDown}
              />
            </g>
          )}
        </g>
      )
    }
    case 'way': {
      const ax = (obj.params.ax as number) ?? 0
      const ay = (obj.params.ay as number) ?? 0
      const bx = (obj.params.bx as number) ?? 200
      const by = (obj.params.by as number) ?? 0
      const center = { x: (ax + bx) / 2, y: (ay + by) / 2 }
      const bounds = geometryBounds(obj)
      return (
        <g {...clickable}>
          <line
            x1={ax} y1={ay} x2={bx} y2={by}
            stroke="transparent"
            strokeWidth={hitStrokeW}
            strokeLinecap="round"
          />
          {highlighted && (
            <line x1={ax} y1={ay} x2={bx} y2={by}
              stroke="#f59e0b" strokeWidth={Math.max(6, strokeW + 4)} opacity={0.3} />
          )}
          {/* Track line */}
          <line x1={ax} y1={ay} x2={bx} y2={by}
            stroke={stroke} strokeWidth={strokeW} strokeDasharray="8 5" opacity={opacity} />
          {/* Endpoint markers */}
          <circle cx={ax} cy={ay} r={4} fill="white" stroke={stroke} strokeWidth={strokeW} />
          <circle cx={bx} cy={by} r={4} fill="white" stroke={stroke} strokeWidth={strokeW} />
          {/* Selection handles */}
          {selected && (
            <>
              <circle cx={ax} cy={ay} r={6} fill="white" stroke="#2563eb" strokeWidth={1.5}
                style={{ cursor: 'move' }}
                onMouseDown={e => onEditHandleMouseDown(e, obj, 'wayEndpoint', 'a')} />
              <circle cx={bx} cy={by} r={6} fill="white" stroke="#2563eb" strokeWidth={1.5}
                style={{ cursor: 'move' }}
                onMouseDown={e => onEditHandleMouseDown(e, obj, 'wayEndpoint', 'b')} />
              <RotationHandle
                center={center}
                handle={{ x: center.x, y: bounds.y - 28 }}
                obj={obj}
                onMouseDown={onEditHandleMouseDown}
              />
            </>
          )}
        </g>
      )
    }
    default:
      return null
  }
}
