import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import { useProjectStore } from '../../store/projectStore'
import { useControlSetStore } from '../../store/controlSetStore'
import {
  triggerBodySound,
  startStandpointSound,
  stopStandpointSound,
  stopAllLoopingPlayers,
  getPlayerDuration,
  ensureEffectorBus,
  destroyEffectorBus,
  setEffectorOutputGain,
  setPlayerEffectorSend,
  clearPlayerEffectorSend,
  setBodySelfEffectorSend,
  setBodyProximityRackSend,
  clearBodyProximityRackSend,
  markBodyTriggered,
  setPlayerRate,
  setPlayerDetune,
  setPlayerPan,
} from '../../audio/intersectionSynth'
import type { PlanetBody, PlanetSimParams } from '../../store/planetStore'
import { BODY_DRONE_DEFAULTS, BODY_MIDI_DEFAULTS } from '../../store/planetStore'
import { ADSR_OFF, computeOrbitAdsr } from '../../audio/orbitAdsr'
import type { SampleAsset } from '../../patch/types'
import { setBodyOutputLevel, clearBodyOutputLevel } from '../../audio/bodyOutputMeter'
import { computeBodyRackOutputSpatial } from '../../audio/bodyRackOutput'
import { setBusStandpointSpatial } from '../../audio/rackBusMixer'
import { fireBodyInstrumentTrigger } from '../../audio/instrumentTrigger'
import { getBodyOneShotEngine } from '../../audio/OneShotSamplerEngine'
import { sendMidiNote } from '../../audio/midiManager'

export type PlanetTool = 'select' | 'add-sun' | 'add-planet' | 'probe'

// ── Orbit-preview snapshot (updated every RAF frame) ─────────────────────────
// Lets RightInspector compute next-orbit prediction without coupling to the
// component internals.

interface LiveBodySnap { id: string; mass: number; x: number; y: number; vx: number; vy: number; ax: number; ay: number; fixed: boolean }
let _liveBodiesSnap: LiveBodySnap[] = []
let _simParamsSnap: Pick<PlanetSimParams, 'G' | 'epsilon' | 'dt'> = { G: 1, epsilon: 5, dt: 0.2 }

export function getPlanetLiveBodySnapshot(): LiveBodySnap[] {
  return _liveBodiesSnap.map(b => ({ ...b }))
}

// ── Smoothed period cache (for time-stretch "constant speed" mode) ────────────
// Exponential moving average of each body's orbital period.
// Updated every RAF frame. Prevents rate jitter caused by instantaneous ω variation.
const _smoothedPeriods = new Map<string, number>()
const PERIOD_SMOOTH_ALPHA = 0.015  // slow alpha → stable rate for time-stretch

/** Returns the smoothed (EMA) orbital period for a body, in sim-time units. */
export function getSmoothedPeriod(bodyId: string): number | null {
  return _smoothedPeriods.get(bodyId) ?? null
}

/** Returns the predicted positions for `bodyId` over the next `steps` simulation steps. */
export function computeOrbitPreviewForBody(bodyId: string, steps: number): Array<{x: number; y: number}> | null {
  const body = _liveBodiesSnap.find(b => b.id === bodyId)
  if (!body || body.fixed) return null
  const cloned = _liveBodiesSnap.map(b => ({ ...b }))
  computeAccels(cloned, _simParamsSnap.G, _simParamsSnap.epsilon)
  const t = cloned.find(b => b.id === bodyId)!
  const pts: Array<{x: number; y: number}> = [{ x: t.x, y: t.y }]
  for (let i = 0; i < steps; i++) {
    verletStep(cloned, _simParamsSnap)
    pts.push({ x: t.x, y: t.y })
  }
  return pts
}

// ── Physics output cache ──────────────────────────────────────────────────────
// Covers every row in the 運動の情報 → 音の要素 mapping.
export interface PlanetBodyStats {
  // Position (world)
  x: number; y: number
  // Velocity
  vx: number; vy: number; speed: number
  // Acceleration
  ax: number; ay: number; accel: number
  // Orbital relative to system centre of mass
  r: number           // distance from CoM  → 音量, リバーブ, 低域
  angleDeg: number    // 0-360°             → パン, フィルター
  angleNorm: number   // 0-1
  omega: number       // rad / sim-unit     → LFO速度
  period: number      // sim-units / orbit  → LFO周期; Infinity when ω ≈ 0
  lfoPhase: number    // 0-1 fractional orbit
  totalOrbits: number // cumulative orbit count (never resets) — for cumulative trigger mode
  simTime: number          // accumulated simulation time (sum of dt steps, never resets)
  lastTriggerSimTime: number // simTime when T-period trigger last fired (0 = never)
  lastTriggerWallMs: number  // performance.now() when T-period last fired (0 = never armed)
  tperiodIntervalMs: number  // wall-clock ms for current T-period interval (0 = not armed)
  // Nearest other body
  nearestDist: number      // Infinity when alone → FM量, 干渉
  nearestRelSpeed: number
  // Mouse-probe cursor (Infinity when cursor not yet positioned)
  probeDist: number        // → 発音イベント, 接近
  probeAngleDeg: number    // 0-360°
  probeAngleNorm: number   // 0-1
}
export const planetBodyStatsCache = new Map<string, PlanetBodyStats>()

function computeSampleStretchRate(args: {
  sampleDuration: number
  period: number
  smoothedPeriod?: number
  dt: number
  frameSeconds: number
  stretchRatio: number
  stretchMode: string
  orbitSource?: string
}): number | null {
  if (args.stretchMode === 'off' || args.sampleDuration <= 0 || !isFinite(args.period) || args.period <= 0) return null
  const effectivePeriod = args.stretchMode === 'time'
    ? (args.smoothedPeriod ?? args.period)
    : args.orbitSource === 'predicted'
      ? (args.smoothedPeriod ?? args.period)
      : args.period
  const frameSeconds = Math.max(0.001, args.frameSeconds)
  const simStep = Math.max(0.000001, args.dt * STEPS_PER_FRAME)
  const realSecondsPerOrbit = effectivePeriod / simStep * frameSeconds
  if (!isFinite(realSecondsPerOrbit) || realSecondsPerOrbit <= 0) return null
  return Math.max(0.001, Math.min(4, args.sampleDuration * args.stretchRatio / realSecondsPerOrbit))
}

function detuneForRate(rate: number, enabled: boolean): number {
  return enabled ? -1200 * Math.log2(Math.max(0.001, rate)) : 0
}

function stableIndexFromId(id: string, length: number): number {
  if (length <= 0) return 0
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % length
}

function resolveBodySamplerSample(bodyId: string, explicitSampleId: string | null | undefined, samples: SampleAsset[]): SampleAsset | null {
  const rack = useControlSetStore.getState().getBodyEffectiveRack(bodyId)
  // Rack must have instrument-sampler — never fall back to raw body.sampleId otherwise
  if (rack.instrument !== 'instrument-sampler') return null
  const ep = useControlSetStore.getState().getBodyEffectiveParams(bodyId)
  const samplerMode = String((ep as Record<string, unknown>).samplerMode ?? 'auto')
  if (samplerMode === 'fixed') {
    const fixedId = String((ep as Record<string, unknown>).samplerSampleId ?? '')
    return fixedId ? (samples.find(s => s.id === fixedId) ?? null) : null
  }
  // auto: explicit body sampleId first, then stable hash
  if (explicitSampleId) return samples.find(s => s.id === explicitSampleId) ?? null
  if (samples.length === 0) return null
  return samples[stableIndexFromId(bodyId, samples.length)] ?? null
}

// ── Simulation types ──────────────────────────────────────────────────────────

interface LiveBody {
  id: string; mass: number; x: number; y: number
  vx: number; vy: number; ax: number; ay: number; fixed: boolean
}

interface TrailRing {
  xs: Float32Array; ys: Float32Array; head: number; count: number; capacity: number
}

interface DragPlaceState {
  bodyX: number; bodyY: number; dragX: number; dragY: number
  tool: 'add-sun' | 'add-planet'
}

// ── Physics ───────────────────────────────────────────────────────────────────

function computeAccels(bodies: LiveBody[], G: number, eps: number): void {
  for (const b of bodies) { b.ax = 0; b.ay = 0 }
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const bi = bodies[i], bj = bodies[j]
      const dx = bj.x - bi.x, dy = bj.y - bi.y
      const r2 = dx * dx + dy * dy + eps * eps
      const r  = Math.sqrt(r2)
      const f  = G / (r2 * r)
      if (!bi.fixed) { bi.ax += f * bj.mass * dx; bi.ay += f * bj.mass * dy }
      if (!bj.fixed) { bj.ax -= f * bi.mass * dx; bj.ay -= f * bi.mass * dy }
    }
  }
}

function verletStep(bodies: LiveBody[], params: Pick<PlanetSimParams, 'G' | 'epsilon' | 'dt'>): void {
  const { G, epsilon: eps, dt } = params
  for (const b of bodies) {
    if (b.fixed) continue
    b.x += b.vx * dt + 0.5 * b.ax * dt * dt
    b.y += b.vy * dt + 0.5 * b.ay * dt * dt
  }
  const prevAx = bodies.map(b => b.ax)
  const prevAy = bodies.map(b => b.ay)
  computeAccels(bodies, G, eps)
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].fixed) continue
    bodies[i].vx += 0.5 * (prevAx[i] + bodies[i].ax) * dt
    bodies[i].vy += 0.5 * (prevAy[i] + bodies[i].ay) * dt
  }
}

// ── Trail ring buffer ─────────────────────────────────────────────────────────

function makeTrail(capacity: number): TrailRing {
  return { xs: new Float32Array(capacity), ys: new Float32Array(capacity), head: 0, count: 0, capacity }
}

function pushTrail(ring: TrailRing, x: number, y: number): void {
  ring.xs[ring.head] = x; ring.ys[ring.head] = y
  ring.head = (ring.head + 1) % ring.capacity
  if (ring.count < ring.capacity) ring.count++
}

function trailToPoints(ring: TrailRing): string {
  if (ring.count < 2) return ''
  const parts = new Array<string>(ring.count)
  const start = ring.count < ring.capacity ? 0 : ring.head
  for (let i = 0; i < ring.count; i++) {
    const idx = (start + i) % ring.capacity
    parts[i] = `${ring.xs[idx].toFixed(1)},${ring.ys[idx].toFixed(1)}`
  }
  return parts.join(' ')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bodyScreenR(mass: number, type: PlanetBody['type'] = 'planet', fromMass = false): number {
  const base = fromMass
    ? Math.max(4, mass * 0.01 * 10)   // mass × 0.01 → display units, min 4
    : Math.max(4, Math.cbrt(mass) * 2)
  return type === 'sun' ? base * 1.25 : base
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS_PER_FRAME   = 4
const TRAIL_STEP_INTERVAL = 2
const VELOCITY_SCALE    = 0.02   // bow-and-arrow: velocity per world-unit of drag pullback
const PREDICT_STEPS     = 800    // forward-sim steps for drag-place orbit preview

// ── Predicted orbit ───────────────────────────────────────────────────────────

/** Run a forward simulation clone and return the preview body's trajectory as
 *  an SVG polyline points string. Safe to call every render frame. */
function computePredictedOrbit(
  liveBodies: LiveBody[],
  params: Pick<PlanetSimParams, 'G' | 'epsilon' | 'dt'>,
  previewBody: LiveBody,
  steps: number,
): string {
  // Clone existing bodies + append preview
  const cloned: LiveBody[] = liveBodies.map(b => ({ ...b }))
  cloned.push({ ...previewBody })
  computeAccels(cloned, params.G, params.epsilon)
  const preview = cloned[cloned.length - 1]
  const pts: string[] = [`${previewBody.x.toFixed(1)},${previewBody.y.toFixed(1)}`]
  for (let i = 0; i < steps; i++) {
    verletStep(cloned, params)
    pts.push(`${preview.x.toFixed(1)},${preview.y.toFixed(1)}`)
  }
  return pts.join(' ')
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PlanetCanvas({ tool = 'select', onSelectTool }: { tool?: PlanetTool; onSelectTool?: () => void }) {
  // Keep onSelectTool in a ref so the keydown closure doesn't need it in deps
  const onSelectToolRef = useRef(onSelectTool)
  useEffect(() => { onSelectToolRef.current = onSelectTool }, [onSelectTool])

  // ── Store subscriptions ──────────────────────────────────────────────────
  const { bodies: storeBodies, simParams: storeParams, selectedBodyId, selectedBodyIds, resetSeq, setSelectedBodyId } = usePlanetStore()

  // ── Simulation refs (declared first so all effects can use them) ─────────
  const storeBodiesRef  = useRef<PlanetBody[]>(storeBodies)
  const liveBodiesRef   = useRef<LiveBody[]>([])
  const trailsRef       = useRef<Map<string, TrailRing>>(new Map())
  const simParamsRef    = useRef<PlanetSimParams>(storeParams)
  const trailStepRef    = useRef(0)
  const prevInRef       = useRef<Map<string, boolean>>(new Map())
  const prevAngleRef    = useRef<Map<string, number>>(new Map())
  const lfoAccumRef     = useRef<Map<string, number>>(new Map())
  const simTimeRef      = useRef(0)                                // total accumulated sim time
  const lastTriggerSimTimeRef = useRef<Map<string, number>>(new Map()) // per-body T-period trigger time
  // Wall-clock T-period timing (performance.now() ms — independent of sim speed)
  // Keys: bodyId (single trigger) or `${bodyId}:${triggerIndex}` (multi-trigger)
  const lastTriggerWallMsRef  = useRef<Map<string, number>>(new Map())
  const tperiodIntervalMsRef  = useRef<Map<string, number>>(new Map())
  // Direct orbit-crossing measurement for accurate T estimate (avoids slow EMA warm-up)
  const lastOrbitCrossWallMsRef = useRef<Map<string, number>>(new Map())  // wall-clock of last full-orbit crossing
  const measuredRealTMsRef      = useRef<Map<string, number>>(new Map())  // measured wall-clock duration of last orbit
  // toggle mode: tracks whether each body's sample is currently looping (true = on)
  const toggleStateRef  = useRef<Map<string, boolean>>(new Map())

  // Sync storeBodiesRef + purge deleted bodies from live simulation
  useEffect(() => {
    const newIds = new Set(storeBodies.map(b => b.id))
    const removed = liveBodiesRef.current.filter(lb => !newIds.has(lb.id))
    if (removed.length > 0) {
      // Stop any looping/toggle samples for removed bodies before cleaning up
      for (const lb of removed) {
        const sb = storeBodiesRef.current.find(b => b.id === lb.id)
        if (sb?.sampleId) stopStandpointSound(sb.sampleId)
        useControlSetStore.getState().clearBodyRack(lb.id)
        destroyEffectorBus(lb.id)
      }
      liveBodiesRef.current = liveBodiesRef.current.filter(lb => newIds.has(lb.id))
      for (const lb of removed) {
        trailsRef.current.delete(lb.id)
        prevAngleRef.current.delete(lb.id)
        lfoAccumRef.current.delete(lb.id)
        lastTriggerSimTimeRef.current.delete(lb.id)
        lastTriggerWallMsRef.current.delete(lb.id)
        tperiodIntervalMsRef.current.delete(lb.id)
        lastOrbitCrossWallMsRef.current.delete(lb.id)
        measuredRealTMsRef.current.delete(lb.id)
        planetBodyStatsCache.delete(lb.id)
        toggleStateRef.current.delete(lb.id)
      }
      prevInRef.current.clear()
      if (liveBodiesRef.current.length > 0)
        computeAccels(liveBodiesRef.current, simParamsRef.current.G, simParamsRef.current.epsilon)
    }
    // Stop samples for bodies whose sampleId was replaced
    for (const newBody of storeBodies) {
      const oldBody = storeBodiesRef.current.find(b => b.id === newBody.id)
      if (oldBody?.sampleId && oldBody.sampleId !== newBody.sampleId) {
        stopStandpointSound(oldBody.sampleId)
      }
    }

    storeBodiesRef.current = storeBodies
  }, [storeBodies])

  const projectSamplesRef = useRef(useProjectStore.getState().project.samples)
  useEffect(() => {
    return useProjectStore.subscribe(s => { projectSamplesRef.current = s.project.samples })
  }, [])

  // Merge base simParams with rack overrides → simParamsRef
  useEffect(() => {
    simParamsRef.current = { ...storeParams, ...useControlSetStore.getState().getEffectiveParams() }
  }, [storeParams])
  useEffect(() => {
    return useControlSetStore.subscribe(() => {
      simParamsRef.current = { ...usePlanetStore.getState().simParams, ...useControlSetStore.getState().getEffectiveParams() }
    })
  }, [])

  // Stop looping players when orbit-stretch mode turns off
  useEffect(() => {
    if (!storeParams.orbitStretchMode) stopAllLoopingPlayers()
  }, [storeParams.orbitStretchMode])

  // Camera follow + tool refs for RAF access
  const cameraFollowBodyIdRef = useRef<string | null>(usePlanetStore.getState().cameraFollowBodyId)
  useEffect(() => {
    return usePlanetStore.subscribe(s => { cameraFollowBodyIdRef.current = s.cameraFollowBodyId })
  }, [])

  const toolRef = useRef<PlanetTool>(tool)
  useEffect(() => { toolRef.current = tool }, [tool])

  // Mouse world position for probe tool (null = not yet positioned)
  const mousePosWorldRef = useRef<{ x: number; y: number } | null>(null)

  // Frame timing (EMA) for real-time orbit-stretch rate calculation
  const frameTimeRef    = useRef(16.67)
  const lastFrameMsRef  = useRef(performance.now())
  const lastRenderMsRef = useRef(0)   // throttle React re-renders to ~30fps

  // ── Initialize / reinitialize ─────────────────────────────────────────────
  const initFromStore = useCallback(() => {
    const { bodies: sb, simParams: sp } = usePlanetStore.getState()
    const live: LiveBody[] = sb.map(b => ({
      id: b.id, mass: b.mass, x: b.x, y: b.y, vx: b.vx, vy: b.vy, ax: 0, ay: 0, fixed: b.fixed,
    }))
    computeAccels(live, sp.G, sp.epsilon)
    liveBodiesRef.current = live
    const trails = new Map<string, TrailRing>()
    for (const b of live) trails.set(b.id, makeTrail(sp.trailLength))
    trailsRef.current = trails
    trailStepRef.current = 0
    prevInRef.current.clear()
    prevAngleRef.current.clear()
    lfoAccumRef.current.clear()
    simTimeRef.current = 0
    lastTriggerSimTimeRef.current.clear()
    lastTriggerWallMsRef.current.clear()
    tperiodIntervalMsRef.current.clear()
    lastOrbitCrossWallMsRef.current.clear()
    measuredRealTMsRef.current.clear()
    toggleStateRef.current.clear()
    planetBodyStatsCache.clear()
  }, [])

  useEffect(() => { initFromStore() }, [resetSeq, initFromStore])

  // ── Camera ────────────────────────────────────────────────────────────────
  const [zoom, setZoom]             = useState(0.5)
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 })
  const zoomRef       = useRef(zoom)
  const viewOffsetRef = useRef(viewOffset)

  function setZoomSync(z: number) { zoomRef.current = z; setZoom(z) }
  function setViewOffsetSync(o: { x: number; y: number }) { viewOffsetRef.current = o; setViewOffset(o) }

  // ── Canvas size ───────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef       = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const sizeRef = useRef(size)
  useEffect(() => { sizeRef.current = size }, [size])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setSize({ w: Math.max(1, width), h: Math.max(1, height) })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // ── Wheel (non-passive) ───────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top
      const { w, h } = sizeRef.current
      const cx = w / 2, cy = h / 2
      const curZ = zoomRef.current, curO = viewOffsetRef.current

      if (e.ctrlKey) {
        // Trackpad pinch zoom (continuous)
        const wx = (sx - cx) / curZ + curO.x, wy = (sy - cy) / curZ + curO.y
        const nz = Math.max(0.02, Math.min(50, curZ * Math.exp(-e.deltaY * 0.006)))
        setZoomSync(nz)
        setViewOffsetSync({ x: wx - (sx - cx) / nz, y: wy - (sy - cy) / nz })
      } else if (Math.abs(e.deltaX) > 0.5 || Math.abs(e.deltaY) < 50) {
        // Two-finger trackpad pan:
        //   horizontal component → definitely trackpad
        //   small deltaY (< 50px) → smooth trackpad scroll (mouse wheel click ≈ 100px)
        setViewOffsetSync({ x: curO.x + e.deltaX / curZ, y: curO.y + e.deltaY / curZ })
      } else {
        // Mouse wheel zoom (large discrete deltaY, no horizontal component)
        const wx = (sx - cx) / curZ + curO.x, wy = (sy - cy) / curZ + curO.y
        const nz = Math.max(0.02, Math.min(50, curZ * Math.exp(-Math.sign(e.deltaY) * 0.13)))
        setZoomSync(nz)
        setViewOffsetSync({ x: wx - (sx - cx) / nz, y: wy - (sy - cy) / nz })
      }
    }
    svg.addEventListener('wheel', handler, { passive: false })
    return () => svg.removeEventListener('wheel', handler)
  }, [])

  // ── Interaction state ─────────────────────────────────────────────────────
  const [draggingBodyId, setDraggingBodyId] = useState<string | null>(null)
  const [isPanning, setIsPanning]           = useState(false)
  const [dragPlace, setDragPlace]           = useState<DragPlaceState | null>(null)
  const dragOffRef   = useRef({ dx: 0, dy: 0 })
  const panStartRef  = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const dragPlaceRef = useRef<DragPlaceState | null>(null)
  const [, setTick]  = useState(0)

  // ── Drag-rect multi-select ────────────────────────────────────────────────
  interface DragSelRect { sx: number; sy: number; ex: number; ey: number }
  const [dragSel, setDragSel]         = useState<DragSelRect | null>(null)
  const dragSelStartRef               = useRef<{ sx: number; sy: number } | null>(null)
  const pendingBodySelectRef          = useRef<{ sx: number; sy: number } | null>(null)

  // ── Esc cancels active drag, deselects body, and switches to select tool ─
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        dragPlaceRef.current = null
        setDragPlace(null)
        setDraggingBodyId(null)
        panStartRef.current = null
        setIsPanning(false)
        dragSelStartRef.current = null
        pendingBodySelectRef.current = null
        setDragSel(null)
        usePlanetStore.getState().setSelectedBodyId(null)
        onSelectToolRef.current?.()
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Ignore when focus is in a text input / select / textarea
        const tag = (document.activeElement as HTMLElement | null)?.tagName ?? ''
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return
        const { selectedBodyId, removeBody } = usePlanetStore.getState()
        if (selectedBodyId) removeBody(selectedBodyId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── RAF loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let rafId: number

    function frame() {
      // Frame-time tracking for orbit-stretch rate computation
      const nowMs = performance.now()
      const rawDt = nowMs - lastFrameMsRef.current
      lastFrameMsRef.current = nowMs
      frameTimeRef.current = frameTimeRef.current * 0.9 + rawDt * 0.1

      const params = simParamsRef.current
      const bodies = liveBodiesRef.current
      const trails = trailsRef.current

      // Update module-level snapshot for orbit-preview (every frame, cheap)
      _liveBodiesSnap = bodies.map(b => ({ ...b }))
      _simParamsSnap  = { G: params.G, epsilon: params.epsilon, dt: params.dt }

      if (!params.paused) {
        const probeMode = toolRef.current === 'probe'
        const mp = mousePosWorldRef.current

        for (let s = 0; s < STEPS_PER_FRAME; s++) {
          // Temporarily add mouse-probe as a virtual fixed body so it affects physics
          if (probeMode && params.probeMass > 0 && mp) {
            bodies.push({
              id: '__probe__', mass: params.probeMass,
              x: mp.x, y: mp.y, vx: 0, vy: 0, ax: 0, ay: 0, fixed: true,
            })
          }
          verletStep(bodies, params)
          trailStepRef.current++
          if (trailStepRef.current % TRAIL_STEP_INTERVAL === 0) {
            for (const b of bodies) {
              if (b.id === '__probe__') continue
              const ring = trails.get(b.id)
              if (ring) pushTrail(ring, b.x, b.y)
            }
          }
          if (probeMode && params.probeMass > 0 && mp) bodies.pop()
        }

        // ── Auto-delete escaped (unbound) bodies ───────────────────────────
        {
          const G = params.G
          let totalMass = 0, cmX = 0, cmY = 0
          for (const b of bodies) { totalMass += b.mass; cmX += b.mass * b.x; cmY += b.mass * b.y }
          if (totalMass > 0) { cmX /= totalMass; cmY /= totalMass }
          const toDelete: string[] = []
          for (const b of bodies) {
            if (b.fixed) continue
            const dx = b.x - cmX, dy = b.y - cmY
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < 4000) continue  // not far enough yet
            // Specific orbital energy = KE + PE (sum over all other bodies)
            const v2 = b.vx * b.vx + b.vy * b.vy
            let pe = 0
            for (const other of bodies) {
              if (other.id === b.id) continue
              const odx = other.x - b.x, ody = other.y - b.y
              const r = Math.sqrt(odx * odx + ody * ody)
              if (r > 0.001) pe -= G * other.mass / r
            }
            if (0.5 * v2 + pe > 0) toDelete.push(b.id)
          }
          if (toDelete.length > 0) {
            for (const id of toDelete) {
              usePlanetStore.getState().removeBody(id)
              liveBodiesRef.current = liveBodiesRef.current.filter(b => b.id !== id)
              trailsRef.current.delete(id)
              prevAngleRef.current.delete(id)
              lfoAccumRef.current.delete(id)
              lastTriggerSimTimeRef.current.delete(id)
              lastTriggerWallMsRef.current.delete(id)
              tperiodIntervalMsRef.current.delete(id)
              planetBodyStatsCache.delete(id)
              toggleStateRef.current.delete(id)
            }
            computeAccels(liveBodiesRef.current, params.G, params.epsilon)
          }
        }

        // ── Rendezvous triggers ────────────────────────────────────────────
        // Rack-only: a body participates only when its rack slot sets rendezvousDistance > 0.
        // There is no global fallback — global simParams values are ignored here.
        {
          const sb      = storeBodiesRef.current
          const samples = projectSamplesRef.current
          const prevIn  = prevInRef.current
          const togSt   = toggleStateRef.current
          const csStore = useControlSetStore.getState()

          // Helper: fire or toggle a sample for one body, using its effective params
          function fireOrToggle(bodyId: string, sampleId: string | null, rate: number, vol: number) {
            const sbi = sb.find(b => b.id === bodyId)
            if (sbi?.muted) return                     // body is muted — skip

            // ── MIDI OUT ─ Note On to instrument ─────────────────────────────
            // Send MIDI Note On regardless of which path handles audio playback.
            // Instrument slot (OneShotLayer) listens via MIDI IN to play.
            sendMidiNote(
              sbi?.midiChannel  ?? 1,
              sbi?.midiNote     ?? 60,
              sbi?.midiVelocity ?? 100,
              200,
            )

            // ── Instrument engine path (oneshot etc.) ─────────────────────────
            // If the body's instrument rack consumed the trigger, skip legacy path.
            if (fireBodyInstrumentTrigger(bodyId)) {
              markBodyTriggered(bodyId)
              return
            }

            // ── Legacy sample path ────────────────────────────────────────────
            const bodyVol = sbi?.volume ?? 1           // per-body volume scale
            const sample = resolveBodySamplerSample(bodyId, sampleId, samples)
            if (!sample) return
            // Per-body rack overrides global params for this body
            const bodyOverride = csStore.getBodyEffectiveParams(bodyId)
            const effectiveMode = (bodyOverride.rendezvousTriggerMode ?? 'oneshot') as string
            const triggerPlaybackMode = (bodyOverride.triggerPlaybackMode ?? params.triggerPlaybackMode) as string
            const spatial = computeBodyRackOutputSpatial(bodyId, bodies, params, bodyOverride)
            const scaledVol = vol * spatial.volume * bodyVol
            setBodyOutputLevel(bodyId, 'sampler', scaledVol, effectiveMode === 'toggle' ? 500 : 900)
            const liveBody = bodies.find(b => b.id === bodyId)
            const adsr = params.adsrMode === 'off'
              ? ADSR_OFF
              : params.adsrMode === 'orbit' && liveBody
                ? computeOrbitAdsr(liveBody, bodies, params.G)
                : undefined
            const stretchMode = (bodyOverride.sampleStretchMode ?? params.sampleStretchMode) as string
            const pitchCorrection = stretchMode === 'time' || Boolean(bodyOverride.samplePitchCorrection ?? params.samplePitchCorrection)
            const detuneCents = detuneForRate(rate, pitchCorrection)
            if (effectiveMode === 'toggle') {
              const on = !(togSt.get(bodyId) ?? false)
              togSt.set(bodyId, on)
              if (on) { startStandpointSound(sample, scaledVol, rate, adsr, spatial.pan); setPlayerDetune(sample.id, detuneCents); markBodyTriggered(bodyId) }
              else      { stopStandpointSound(sample.id); clearBodyOutputLevel(bodyId, 'sampler') }
            } else {
              triggerBodySound(sample, {
                playbackRate: rate,
                volume: scaledVol,
                adsr,
                overlap: triggerPlaybackMode === 'layer',
                pan: spatial.pan,
                detuneCents,
              })
              markBodyTriggered(bodyId)
            }
          }

          // Body-body rendezvous — check each pair using the effective rdDist for the pair
          for (let i = 0; i < bodies.length; i++) {
            for (let j = i + 1; j < bodies.length; j++) {
              const bi = bodies[i], bj = bodies[j]
              // Use the larger of the two bodies' effective rendezvous distance
              const biOverride = csStore.getBodyEffectiveParams(bi.id)
              const bjOverride = csStore.getBodyEffectiveParams(bj.id)
              const rdDistI = (biOverride.rendezvousDistance as number | undefined) ?? 0
              const rdDistJ = (bjOverride.rendezvousDistance as number | undefined) ?? 0
              const rdDist  = Math.max(rdDistI, rdDistJ)
              if (rdDist <= 0) continue
              const dx = bj.x - bi.x, dy = bj.y - bi.y
              const dist = Math.sqrt(dx * dx + dy * dy)
              const key  = `${bi.id}|${bj.id}`
              const wasIn = prevIn.get(key) ?? false
              const isIn  = dist <= rdDist
              if (isIn && !wasIn) {
                const sbi = sb.find(b => b.id === bi.id)
                const sbj = sb.find(b => b.id === bj.id)
                const relV = Math.sqrt((bi.vx - bj.vx) ** 2 + (bi.vy - bj.vy) ** 2)
                const rate = Math.max(0.3, Math.min(3.0, 0.5 + relV * 0.3))
                const vol  = Math.max(0.2, Math.min(1.0, 1.0 - dist / (rdDist * 2)))
                fireOrToggle(bi.id, sbi?.sampleId ?? null, rate, vol)
                fireOrToggle(bj.id, sbj?.sampleId ?? null, rate, vol)
              }
              prevIn.set(key, isIn)
            }
          }

          // Body-probe rendezvous (when probe is active)
          if (toolRef.current === 'probe' && mp) {
            for (const b of bodies) {
              const bOverride = csStore.getBodyEffectiveParams(b.id)
              const rdDist = (bOverride.rendezvousDistance as number | undefined) ?? 0
              if (rdDist <= 0) continue
              const dx = mp.x - b.x, dy = mp.y - b.y
              const dist = Math.sqrt(dx * dx + dy * dy)
              const key  = `__probe__|${b.id}`
              const wasIn = prevIn.get(key) ?? false
              const isIn  = dist <= rdDist
              if (isIn && !wasIn) {
                const sbi = sb.find(s => s.id === b.id)
                fireOrToggle(b.id, sbi?.sampleId ?? null, 1 + dist * 0.002, 0.85)
              }
              prevIn.set(key, isIn)
            }
          }
        }
      }

      // ── Orbital stats (always — even when paused) ──────────────────────────
      {
        const bodies = liveBodiesRef.current  // fresh read after potential verlet
        let totalMass = 0, cmX = 0, cmY = 0
        for (const b of bodies) { totalMass += b.mass; cmX += b.mass * b.x; cmY += b.mass * b.y }
        if (totalMass > 0) { cmX /= totalMass; cmY /= totalMass }

        const params   = simParamsRef.current

        // Advance simulation clock (only when running)
        if (!params.paused) simTimeRef.current += params.dt * STEPS_PER_FRAME
        const sbArr    = storeBodiesRef.current
        const smpArr   = projectSamplesRef.current
        const mp       = mousePosWorldRef.current
        // ── Per-frame store snapshot (read once, reuse for all bodies) ─────────
        const csStore  = useControlSetStore.getState()

        for (const b of bodies) {
          const dx = b.x - cmX, dy = b.y - cmY
          const r  = Math.sqrt(dx * dx + dy * dy)
          const angle = Math.atan2(dy, dx)

          // Angle accumulation (only advances when simulation is running)
          const prevAngle = prevAngleRef.current.get(b.id) ?? angle
          let dAngle = angle - prevAngle
          if (dAngle >  Math.PI) dAngle -= 2 * Math.PI
          if (dAngle < -Math.PI) dAngle += 2 * Math.PI
          prevAngleRef.current.set(b.id, angle)
          const prevAccum = lfoAccumRef.current.get(b.id) ?? 0
          const newAccum  = prevAccum + dAngle
          lfoAccumRef.current.set(b.id, newAccum)
          const lfoPhase = ((newAccum / (2 * Math.PI)) % 1 + 1) % 1

          const angleDeg  = ((angle * 180 / Math.PI) + 360) % 360
          const angleNorm = angleDeg / 360
          const speed     = Math.sqrt(b.vx * b.vx + b.vy * b.vy)
          const accel     = Math.sqrt(b.ax * b.ax + b.ay * b.ay)
          const vPerp     = r > 0.001 ? (b.vx * (-dy) + b.vy * dx) / r : 0
          const omega     = r > 0.001 ? vPerp / r : 0
          const period    = Math.abs(omega) > 0.0001 ? (2 * Math.PI / Math.abs(omega)) : Infinity

          // Nearest other body
          let nearestDist = Infinity, nearestRelSpeed = 0
          for (const other of bodies) {
            if (other.id === b.id) continue
            const odx = other.x - b.x, ody = other.y - b.y
            const od  = Math.sqrt(odx * odx + ody * ody)
            if (od < nearestDist) {
              nearestDist = od
              nearestRelSpeed = Math.sqrt((other.vx - b.vx) ** 2 + (other.vy - b.vy) ** 2)
            }
          }

          // Probe distance
          const pdx = mp ? mp.x - b.x : 0, pdy = mp ? mp.y - b.y : 0
          const probeDist       = mp ? Math.sqrt(pdx * pdx + pdy * pdy) : Infinity
          const probeAngleDeg   = mp ? ((Math.atan2(pdy, pdx) * 180 / Math.PI) + 360) % 360 : 0
          const probeAngleNorm  = probeAngleDeg / 360

          planetBodyStatsCache.set(b.id, {
            x: b.x, y: b.y, vx: b.vx, vy: b.vy, speed,
            ax: b.ax, ay: b.ay, accel,
            r, angleDeg, angleNorm, omega, period, lfoPhase,
            totalOrbits: newAccum / (2 * Math.PI),
            simTime: simTimeRef.current,
            lastTriggerSimTime: lastTriggerSimTimeRef.current.get(b.id) ?? 0,
            lastTriggerWallMs: lastTriggerWallMsRef.current.get(b.id) ?? 0,
            tperiodIntervalMs: tperiodIntervalMsRef.current.get(b.id) ?? 0,
            nearestDist, nearestRelSpeed,
            probeDist, probeAngleDeg, probeAngleNorm,
          })

          // Update smoothed period (EMA) for time-stretch "constant speed" mode
          if (isFinite(period) && period > 0) {
            const prev = _smoothedPeriods.get(b.id) ?? period
            _smoothedPeriods.set(b.id, prev * (1 - PERIOD_SMOOTH_ALPHA) + period * PERIOD_SMOOTH_ALPHA)
          }

          // Merge per-body rack on top of global params for this body
          // (computed ONCE per body per frame — reused in all trigger/spatial sections)
          const bodyOverride   = csStore.getBodyEffectiveParams(b.id)
          const bodyParams     = Object.keys(bodyOverride).length > 0
            ? { ...params, ...bodyOverride }
            : params

          // ── Standpoint spatial: applied at rack bus level every frame ──────────
          // Skip the Web Audio API call entirely when standpoint is off (common case).
          if (params.standpointMode && params.standpointBodyId) {
            const sp = computeBodyRackOutputSpatial(b.id, bodies, params, bodyParams)
            setBusStandpointSpatial(b.id, sp.volume, sp.pan)
          }

          // ── Per-trigger orbit evaluation ──────────────────────────────────────
          // Each trigger in the rack fires independently with its own params.
          // Using prevAccum / newAccum (already computed above) for orbit crossing detection.
          const sbi   = sbArr.find(s => s.id === b.id)
          if (!params.paused && sbi && !sbi.muted && newAccum !== 0) {
            const triggerParamsList = csStore.getBodyTriggerParamsList(b.id)
            const rack = csStore.getBodyEffectiveRack(b.id)

            for (let ti = 0; ti < triggerParamsList.length; ti++) {
              const tp       = triggerParamsList[ti]
              const tpOrbitMode = String(tp.orbitTriggerMode ?? '')
              const tpType      = String(tp.orbitTriggerType ?? 'cumulative')
              if (tpOrbitMode !== 'orbit-complete') continue

              if (tpType !== 'tperiod') {
                // ── Orbit-complete (angle-based) ──────────────────────────────
                const div = Math.max(0.0625, Number(tp.orbitTriggerDivision ?? 1))
                const unit = 2 * Math.PI * div
                const prevOrbit = Math.floor(Math.abs(prevAccum) / unit)
                const currOrbit = Math.floor(Math.abs(newAccum) / unit)
                if (currOrbit > prevOrbit) {
                  sendMidiNote(sbi.midiChannel ?? 1, sbi.midiNote ?? 60, sbi.midiVelocity ?? 100, 200)
                  // Only fire instrument on the FIRST (ti=0) trigger to avoid duplicate audio
                  if (ti === 0) {
                    const numer = Number((bodyParams as Record<string, unknown>).orbitLoopNumer ?? 1)
                    const denom = Number((bodyParams as Record<string, unknown>).orbitLoopDenom ?? 1)
                    const stretchRatio = denom > 0 ? numer / denom : 1
                    const oneShotDur = getBodyOneShotEngine(b.id)?.bufferDuration ?? 0
                    const instrRate = rack.instrument === 'instrument-oneshot-stretch'
                      ? (computeSampleStretchRate({
                          sampleDuration: oneShotDur, period,
                          smoothedPeriod: _smoothedPeriods.get(b.id),
                          dt: params.dt, frameSeconds: frameTimeRef.current / 1000,
                          stretchRatio, stretchMode: 'rate',
                          orbitSource: (bodyParams as Record<string, unknown>).sampleOrbitSource as string ?? 'current',
                        }) ?? 1)
                      : 1
                    if (fireBodyInstrumentTrigger(b.id, instrRate)) {
                      markBodyTriggered(b.id)
                    } else {
                      const sample = resolveBodySamplerSample(b.id, sbi.sampleId, smpArr)
                      if (sample) {
                        const spatial = computeBodyRackOutputSpatial(b.id, bodies, params, bodyParams)
                        const bodyVol = sbi.volume ?? 1
                        const finalVol = 0.85 * spatial.volume * bodyVol
                        const adsr = params.adsrMode === 'off' ? ADSR_OFF
                          : params.adsrMode === 'orbit' ? computeOrbitAdsr(b, bodies, params.G) : undefined
                        const tPlayMode = (bodyParams.triggerPlaybackMode as string | undefined) ?? params.triggerPlaybackMode
                        const stretchM  = (bodyParams.sampleStretchMode as string | undefined) ?? ((bodyParams.orbitStretchMode as boolean | undefined) ? 'rate' : 'off')
                        const lnumer = sbi.orbitLoopNumer ?? 1, ldenom = sbi.orbitLoopDenom ?? 1
                        const lstr = ldenom > 0 ? lnumer / ldenom : 1
                        const tRate = computeSampleStretchRate({
                          sampleDuration: getPlayerDuration(sample.id), period,
                          smoothedPeriod: _smoothedPeriods.get(b.id),
                          dt: params.dt, frameSeconds: frameTimeRef.current / 1000,
                          stretchRatio: lstr, stretchMode: stretchM,
                          orbitSource: (bodyParams.sampleOrbitSource as string | undefined) ?? 'current',
                        }) ?? 1
                        triggerBodySound(sample, {
                          playbackRate: tRate, volume: finalVol, adsr,
                          overlap: tPlayMode === 'layer', pan: spatial.pan,
                          detuneCents: detuneForRate(tRate, stretchM === 'time' || Boolean(bodyParams.samplePitchCorrection)),
                        })
                        setBodyOutputLevel(b.id, 'sampler', finalVol, 900)
                        markBodyTriggered(b.id)
                      }
                    }
                  }
                }

              } else {
                // ── T-period trigger (wall-clock timer) ───────────────────────
                // Timer key: bodyId for ti=0 (display compat), `${bodyId}:N` for extras
                const timerKey = ti === 0 ? b.id : `${b.id}:${ti}`
                const nowMs = performance.now()

                // Orbit-crossing measurement (shared for all T-period triggers of this body)
                // Only run once (ti === 0) to avoid redundant work
                if (ti === 0) {
                  const fullPrev = Math.floor(Math.abs(prevAccum) / (2 * Math.PI))
                  const fullCurr = Math.floor(Math.abs(newAccum) / (2 * Math.PI))
                  if (fullCurr > fullPrev) {
                    const lastCross = lastOrbitCrossWallMsRef.current.get(b.id)
                    if (lastCross !== undefined) {
                      const measured = nowMs - lastCross
                      if (measured >= 10 && measured <= 60_000)
                        measuredRealTMsRef.current.set(b.id, measured)
                    }
                    lastOrbitCrossWallMsRef.current.set(b.id, nowMs)
                  }
                }

                const tpDiv = Math.max(0.0625, Number(tp.orbitTriggerDivision ?? 1))
                const measuredT = measuredRealTMsRef.current.get(b.id)
                let intervalMs: number
                if (measuredT !== undefined) {
                  intervalMs = measuredT * tpDiv
                } else {
                  const smoothedP  = _smoothedPeriods.get(b.id)
                  const effectiveP = (smoothedP && isFinite(smoothedP) && smoothedP > 0) ? smoothedP
                    : (isFinite(period) && period > 0 ? period : 0)
                  if (effectiveP <= 0) continue
                  intervalMs = (effectiveP / (params.dt * STEPS_PER_FRAME)) * frameTimeRef.current * tpDiv
                }
                intervalMs = Math.max(16, intervalMs)

                const lastWall = lastTriggerWallMsRef.current.get(timerKey)
                if (ti === 0) tperiodIntervalMsRef.current.set(b.id, intervalMs)

                if (lastWall === undefined || (nowMs - lastWall) >= intervalMs) {
                  lastTriggerWallMsRef.current.set(timerKey, nowMs)
                  sendMidiNote(sbi.midiChannel ?? 1, sbi.midiNote ?? 60, sbi.midiVelocity ?? 100, 200)
                  if (ti === 0) {
                    const tpNumer = Number((bodyParams as Record<string, unknown>).orbitLoopNumer ?? 1)
                    const tpDenom = Number((bodyParams as Record<string, unknown>).orbitLoopDenom ?? 1)
                    const tpStr = tpDenom > 0 ? tpNumer / tpDenom : 1
                    const tpDur = getBodyOneShotEngine(b.id)?.bufferDuration ?? 0
                    const tpRate = rack.instrument === 'instrument-oneshot-stretch'
                      ? (computeSampleStretchRate({
                          sampleDuration: tpDur, period,
                          smoothedPeriod: _smoothedPeriods.get(b.id),
                          dt: params.dt, frameSeconds: frameTimeRef.current / 1000,
                          stretchRatio: tpStr, stretchMode: 'rate',
                          orbitSource: (bodyParams as Record<string, unknown>).sampleOrbitSource as string ?? 'current',
                        }) ?? 1)
                      : 1
                    if (fireBodyInstrumentTrigger(b.id, tpRate)) {
                      markBodyTriggered(b.id)
                    } else {
                      const sample = resolveBodySamplerSample(b.id, sbi.sampleId, smpArr)
                      if (sample) {
                        const spatial  = computeBodyRackOutputSpatial(b.id, bodies, params, bodyParams)
                        const bodyVol  = sbi.volume ?? 1
                        const finalVol = 0.85 * spatial.volume * bodyVol
                        const adsr = params.adsrMode === 'off' ? ADSR_OFF
                          : params.adsrMode === 'orbit' ? computeOrbitAdsr(b, bodies, params.G) : undefined
                        const tPlayMode = (bodyParams.triggerPlaybackMode as string | undefined) ?? params.triggerPlaybackMode
                        const stretchM  = (bodyParams.sampleStretchMode as string | undefined) ?? ((bodyParams.orbitStretchMode as boolean | undefined) ? 'rate' : 'off')
                        const lnumer = sbi.orbitLoopNumer ?? 1, ldenom = sbi.orbitLoopDenom ?? 1
                        const lstr = ldenom > 0 ? lnumer / ldenom : 1
                        const tRate = computeSampleStretchRate({
                          sampleDuration: getPlayerDuration(sample.id), period,
                          smoothedPeriod: _smoothedPeriods.get(b.id),
                          dt: params.dt, frameSeconds: frameTimeRef.current / 1000,
                          stretchRatio: lstr, stretchMode: stretchM,
                          orbitSource: (bodyParams.sampleOrbitSource as string | undefined) ?? 'current',
                        }) ?? 1
                        triggerBodySound(sample, {
                          playbackRate: tRate, volume: finalVol, adsr,
                          overlap: tPlayMode === 'layer', pan: spatial.pan,
                          detuneCents: detuneForRate(tRate, stretchM === 'time' || Boolean(bodyParams.samplePitchCorrection)),
                        })
                        setBodyOutputLevel(b.id, 'sampler', finalVol, 900)
                        markBodyTriggered(b.id)
                      }
                    }
                  }
                }
              }
            }  // end for (ti)
          }    // end if (!paused && sbi && !muted)

          // ── Sample playback: orbit-stretch and time-stretch modes ──────────────
          {
            // Resolve effective stretch mode: new sampleStretchMode takes priority,
            // falls back to legacy orbitStretchMode boolean.
            const stretchMode = (bodyParams.sampleStretchMode as string | undefined)
              ?? ((bodyParams.orbitStretchMode as boolean | undefined) ? 'rate' : 'off')
            const isActive = stretchMode !== 'off' && !params.paused && isFinite(period) && period > 0

            const sbi = sbArr.find(s => s.id === b.id)

            if (isActive) {
              if (sbi?.muted) {
                const sample = resolveBodySamplerSample(b.id, sbi.sampleId, smpArr)
                if (sample) { stopStandpointSound(sample.id); setPlayerDetune(sample.id, 0) }
                clearBodyOutputLevel(b.id, 'sampler')
              } else {
                const sample = resolveBodySamplerSample(b.id, sbi?.sampleId, smpArr)
                if (sample?.objectUrl) {
                  const dur = getPlayerDuration(sample.id)
                  if (dur > 0) {
                    const numer = sbi?.orbitLoopNumer ?? 1
                    const denom = sbi?.orbitLoopDenom ?? 1
                    const stretchRatio = denom > 0 ? numer / denom : 1

                    const orbitSrc = (bodyParams.sampleOrbitSource as string | undefined) ?? 'current'
                    const rate = computeSampleStretchRate({
                      sampleDuration: dur,
                      period,
                      smoothedPeriod: _smoothedPeriods.get(b.id),
                      dt: params.dt,
                      frameSeconds: frameTimeRef.current / 1000,
                      stretchRatio,
                      stretchMode,
                      orbitSource: orbitSrc,
                    }) ?? 1

                    const spatial = computeBodyRackOutputSpatial(b.id, bodies, params, bodyParams)
                    const bodyVol = sbi?.volume ?? 1
                    const vol     = 0.8 * spatial.volume * bodyVol
                    setBodyOutputLevel(b.id, 'sampler', vol, 500)

                    const loopMode = (bodyParams.sampleLoopMode as string | undefined) ?? 'loop'

                    if (loopMode === 'loop') {
                      // Loop: rate-stretch → instantaneous speed varies rate
                      //       time-stretch → smoothed period gives constant rate
                      const adsr = params.adsrMode === 'off'
                        ? ADSR_OFF
                        : params.adsrMode === 'orbit'
                          ? computeOrbitAdsr(b, bodies, params.G)
                          : undefined
                      startStandpointSound(sample, vol, rate, adsr, spatial.pan)
                    } else {
                      // Oneshot: just update playback rate (triggered by orbit-complete/rendezvous)
                      setPlayerRate(sample.id, rate)
                      setPlayerPan(sample.id, spatial.pan)
                    }

                    // Time stretch means "change duration without pitch shift", so it always
                    // uses correction. Rate stretch can stay tape-like unless enabled.
                    const pitchCorr = stretchMode === 'time' || Boolean(bodyParams.samplePitchCorrection)
                    setPlayerDetune(sample.id, detuneForRate(rate, pitchCorr))
                  }
                }
              }
            } else {
              // Stretch mode turned off — stop any looping player and reset detune
              const sample = resolveBodySamplerSample(b.id, sbi?.sampleId, smpArr)
              if (sample && !sbi?.muted) setPlayerDetune(sample.id, 0)
              clearBodyOutputLevel(b.id, 'sampler')
            }
          }
        }
      }

      // ── Effector proximity routing ────────────────────────────────────────
      // Every frame: for each effector body, route nearby planets' samples
      // into its reverb bus proportional to closeness (wet = maxWet × (1 - d/maxDist))
      {
        const sb      = storeBodiesRef.current
        const smpArr  = projectSamplesRef.current
        const csStore = useControlSetStore.getState()
        // A body is an effector if its per-body rack overrides effectorType to 'reverb',
        // OR if its direct body property effectorType is set.
        const effectors = sb.filter(b => {
          const eff = csStore.getBodyEffectiveParams(b.id)
          const effType = (eff.effectorType ?? b.effectorType ?? 'none') as string
          return effType !== 'none'
        })
        if (effectors.length > 0) {
          for (const eff of effectors) {
            const effLive = bodies.find(b => b.id === eff.id)
            if (!effLive) continue
            // Merge rack-level overrides on top of body properties
            const effOverride = csStore.getBodyEffectiveParams(eff.id)
            const effDist    = (effOverride.effectorDistance    ?? eff.effectorDistance    ?? 200)   as number
            const effMaxWet  = (effOverride.effectorMaxWet      ?? eff.effectorMaxWet      ?? 0.7)   as number
            const effType    = (effOverride.effectorType        ?? eff.effectorType        ?? 'reverb') as string
            // Orbit-synced delay time: T_real (seconds) × division ratio
            const rawDelayDivision = Number(effOverride.effectorDelayDivision ?? eff.effectorDelayDivision ?? 0.25)
            const delayDivision = Number.isFinite(rawDelayDivision)
              ? Math.max(0.03125, Math.min(2, rawDelayDivision))
              : 0.25
            const effSmoothedPeriod = _smoothedPeriods.get(eff.id) ?? (planetBodyStatsCache.get(eff.id)?.period ?? 0)
            const effT_real = effSmoothedPeriod > 0 && isFinite(effSmoothedPeriod)
              ? effSmoothedPeriod / (params.dt * STEPS_PER_FRAME) * (frameTimeRef.current / 1000)
              : 0.25  // fallback to 250ms if no orbit data
            const delayTime = Math.max(0.01, Math.min(7.5, effT_real * delayDivision))

            ensureEffectorBus(eff.id, {
              type:               effType,
              reverbMode:         (effOverride.reverbMode              ?? eff.reverbMode              ?? 'convolution') as string,
              decay:              (effOverride.effectorDecay           ?? eff.effectorDecay           ?? 2.5)  as number,
              delayTime,
              feedback:           Math.max(0, Math.min(0.9, Number(effOverride.effectorFeedback ?? eff.effectorFeedback ?? 0.4))),
              distortion:         (effOverride.effectorDistortion      ?? eff.effectorDistortion      ?? 0.4)  as number,
              chorusFreq:         (effOverride.effectorChorusFreq      ?? eff.effectorChorusFreq      ?? 1.5)  as number,
              chorusDepth:        (effOverride.effectorChorusDepth     ?? eff.effectorChorusDepth     ?? 0.5)  as number,
              phaserRate:         (effOverride.effectorPhaserRate      ?? eff.effectorPhaserRate      ?? 0.5)  as number,
              phaserOctaves:      (effOverride.effectorPhaserOctaves   ?? eff.effectorPhaserOctaves   ?? 3)    as number,
              autoFilterFreq:     (effOverride.effectorAutoFilterFreq  ?? eff.effectorAutoFilterFreq  ?? 1.0)  as number,
              autoFilterDepth:    (effOverride.effectorAutoFilterDepth ?? eff.effectorAutoFilterDepth ?? 1.0)  as number,
              autoFilterBaseFreq: (effOverride.effectorAutoFilterBaseFreq ?? eff.effectorAutoFilterBaseFreq ?? 200) as number,
              bitDepth:           (effOverride.effectorBitDepth        ?? eff.effectorBitDepth        ?? 8)    as number,
              freezeDecay:        (effOverride.effectorFreezeDecay     ?? eff.effectorFreezeDecay     ?? 30)   as number,
            })
            // Route body's own instruments through its own effector (Input 1).
            // For microphone: use micSelfGain; for other effectors: always 1.0.
            const selfSendGain = effType === 'microphone'
              ? Math.max(0, Number(effOverride.micSelfGain ?? eff.micSelfGain ?? 1.0))
              : 1.0
            setBodySelfEffectorSend(eff.id, selfSendGain)

            // ── outputGain = effector body's own volume/mute ──────────────────
            // The effected signal "comes from" the effector body:
            // muting the effector silences all wet output; its volume scales it.
            // This is the final body-track output, so standpoint attenuation also
            // applies here after the rack/effect chain.
            const effSpatial = computeBodyRackOutputSpatial(eff.id, bodies, params, effOverride)
            const effOutputGain = eff.muted ? 0 : Math.max(0, Math.min(1, (eff.volume ?? 1) * effSpatial.volume))
            setEffectorOutputGain(eff.id, effOutputGain)

            // ── Route nearby source bodies into the effect input (Input 2) ────
            // Two parallel send paths per body:
            //   1. Rack post-fader send  — captures all instrument layers (drone/FM/granular/etc.)
            //   2. Sample-player send    — captures the basic sampler (bypasses rack bus)
            //
            // For microphone: sendMaxGain = micPickupGain
            // For others:     sendMaxGain = effMaxWet
            // sendLevel = sendMaxGain × (1 − dist/effDist)  [0 at max distance]
            const sendMaxGain = effType === 'microphone'
              ? Math.max(0, Number(effOverride.micPickupGain ?? eff.micPickupGain ?? 1.0))
              : effMaxWet
            let maxWetInput = 0
            for (const b of bodies) {
              if (b.id === eff.id) continue
              const dx = b.x - effLive.x, dy = b.y - effLive.y
              const dist = Math.sqrt(dx * dx + dy * dy)
              const sbBody = sb.find(s => s.id === b.id)

              if (dist <= effDist) {
                const sendLevel = sendMaxGain * Math.max(0, 1 - dist / effDist)
                maxWetInput = Math.max(maxWetInput, sendLevel)

                // Rack output send (instrument layers)
                setBodyProximityRackSend(b.id, eff.id, sendLevel)

                // Sample-player send (basic sampler — goes direct-to-destination, not via rack bus)
                const sample = resolveBodySamplerSample(b.id, sbBody?.sampleId, smpArr)
                if (sample?.objectUrl) {
                  setPlayerEffectorSend(sample.id, eff.id, sendLevel)
                }
              } else {
                // Out of range — fade both sends to zero
                clearBodyProximityRackSend(b.id, eff.id)
                const sample = resolveBodySamplerSample(b.id, sbBody?.sampleId, smpArr)
                if (sample?.objectUrl) {
                  clearPlayerEffectorSend(sample.id, eff.id)
                }
              }
            }
            setBodyOutputLevel(eff.id, 'effect', maxWetInput * effOutputGain, 500)
          }
        }
      }

      // ── Camera follow (always active) ──────────────────────────────────────
      const followId = cameraFollowBodyIdRef.current
      if (followId) {
        const fb = liveBodiesRef.current.find(b => b.id === followId)
        if (fb) {
          viewOffsetRef.current = { x: fb.x, y: fb.y }
          setViewOffset({ x: fb.x, y: fb.y })
        }
      }

      if (nowMs - lastRenderMsRef.current >= 33) {
        lastRenderMsRef.current = nowMs
        setTick(t => t + 1)
      }
      rafId = requestAnimationFrame(frame)
    }

    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Mouse helpers ─────────────────────────────────────────────────────────
  function getSVGPos(e: React.MouseEvent) {
    const rect = svgRef.current!.getBoundingClientRect()
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top }
  }
  function screenToWorld(sx: number, sy: number) {
    const cx = sizeRef.current.w / 2, cy = sizeRef.current.h / 2
    return {
      wx: (sx - cx) / zoomRef.current + viewOffsetRef.current.x,
      wy: (sy - cy) / zoomRef.current + viewOffsetRef.current.y,
    }
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button === 1 || e.button === 2) {
      const { sx, sy } = getSVGPos(e)
      panStartRef.current = { sx, sy, ox: viewOffsetRef.current.x, oy: viewOffsetRef.current.y }
      setIsPanning(true)
      return
    }
    if (e.button !== 0) return
    const { sx, sy } = getSVGPos(e)
    const { wx, wy } = screenToWorld(sx, sy)

    if (tool === 'add-sun' || tool === 'add-planet') {
      // Begin bow-and-arrow drag; body placed on mouseUp
      const dp: DragPlaceState = { bodyX: wx, bodyY: wy, dragX: wx, dragY: wy, tool }
      dragPlaceRef.current = dp
      setDragPlace(dp)
      return
    }
    if (tool === 'probe') return  // probe mode: no body interaction on click

    const bodies = liveBodiesRef.current
    let hit: LiveBody | null = null
    for (const b of bodies) {
      const sb = storeBodiesRef.current.find(s => s.id === b.id)
      const wr = (bodyScreenR(b.mass, sb?.type, simParamsRef.current.bodyRadiusFromMass) + 6) / zoomRef.current
      const dx = b.x - wx, dy = b.y - wy
      if (dx * dx + dy * dy <= wr * wr) { hit = b; break }
    }
    if (hit) {
      setSelectedBodyId(hit.id)
      if (simParamsRef.current.paused && !hit.fixed) {
        setDraggingBodyId(hit.id)
        dragOffRef.current = { dx: hit.x - wx, dy: hit.y - wy }
      } else if (tool === 'select') {
        pendingBodySelectRef.current = { sx, sy }
      }
    } else {
      // Start drag-rect multi-select (on empty canvas, select tool)
      setSelectedBodyId(null)
      dragSelStartRef.current = { sx, sy }
      setDragSel({ sx, sy, ex: sx, ey: sy })
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    // Always track world position (used for probe stats + visualization)
    const { sx, sy } = getSVGPos(e)
    const { wx, wy } = screenToWorld(sx, sy)
    mousePosWorldRef.current = { x: wx, y: wy }

    if (panStartRef.current) {
      setViewOffsetSync({
        x: panStartRef.current.ox + (panStartRef.current.sx - sx) / zoomRef.current,
        y: panStartRef.current.oy + (panStartRef.current.sy - sy) / zoomRef.current,
      })
      return
    }
    if (dragPlaceRef.current) {
      const updated: DragPlaceState = { ...dragPlaceRef.current, dragX: wx, dragY: wy }
      dragPlaceRef.current = updated
      setDragPlace({ ...updated })
      return
    }
    if (dragSelStartRef.current) {
      setDragSel({ ...dragSelStartRef.current, ex: sx, ey: sy })
      return
    }
    if (pendingBodySelectRef.current && tool === 'select') {
      const start = pendingBodySelectRef.current
      if (Math.hypot(sx - start.sx, sy - start.sy) > 5) {
        dragSelStartRef.current = start
        pendingBodySelectRef.current = null
        setDragSel({ ...start, ex: sx, ey: sy })
        return
      }
    }
    if (draggingBodyId) {
      const body = liveBodiesRef.current.find(b => b.id === draggingBodyId)
      if (body) { body.x = wx + dragOffRef.current.dx; body.y = wy + dragOffRef.current.dy; body.vx = 0; body.vy = 0 }
    }
  }

  function handleMouseLeave() {
    // Keep last known position — probe cursor hides only when null
    // (we don't reset mousePosWorldRef to avoid cursor disappearing on slight exit)
  }

  function handleMouseUp(e: React.MouseEvent) {
    if (e.button === 1 || e.button === 2) { panStartRef.current = null; setIsPanning(false); return }
    pendingBodySelectRef.current = null

    // Finish drag-rect multi-select
    if (dragSelStartRef.current && e.button === 0) {
      const ds = dragSelStartRef.current
      dragSelStartRef.current = null
      setDragSel(null)
      const { sx, sy } = getSVGPos(e)
      if (Math.abs(sx - ds.sx) > 5 || Math.abs(sy - ds.sy) > 5) {
        // Convert screen rect to world coords
        const minSx = Math.min(ds.sx, sx), maxSx = Math.max(ds.sx, sx)
        const minSy = Math.min(ds.sy, sy), maxSy = Math.max(ds.sy, sy)
        const { wx: wx1, wy: wy1 } = screenToWorld(minSx, minSy)
        const { wx: wx2, wy: wy2 } = screenToWorld(maxSx, maxSy)
        const inRect = liveBodiesRef.current.filter(b => {
          const sb = storeBodiesRef.current.find(s => s.id === b.id)
          const radius = (bodyScreenR(b.mass, sb?.type, simParamsRef.current.bodyRadiusFromMass) + 6) / zoomRef.current
          return b.x + radius >= wx1 && b.x - radius <= wx2 && b.y + radius >= wy1 && b.y - radius <= wy2
        })
        const ids = inRect.map(b => b.id)
        usePlanetStore.getState().setSelectedBodyIds(ids)
      }
      return
    }

    if (dragPlaceRef.current && e.button === 0) {
      const dp = dragPlaceRef.current
      dragPlaceRef.current = null
      setDragPlace(null)
      const vx = (dp.bodyX - dp.dragX) * VELOCITY_SCALE
      const vy = (dp.bodyY - dp.dragY) * VELOCITY_SCALE
      const storeState  = usePlanetStore.getState()
      const starCount   = storeState.bodies.filter(b => b.type === 'sun').length
      const planetCount = storeState.bodies.filter(b => b.type === 'planet').length
      const defs = dp.tool === 'add-sun'
        ? storeState.nextSunDefaults
        : storeState.nextPlanetDefaults
      const resolvedColor = defs.randomColor
        ? (dp.tool === 'add-sun'
            ? `hsl(${35 + Math.floor(Math.random() * 25)},90%,55%)`
            : `hsl(${Math.floor(Math.random() * 360)},70%,62%)`)
        : defs.color
      const allSamples = projectSamplesRef.current
      const resolvedSampleId = defs.randomSample && allSamples.length > 0
        ? allSamples[Math.floor(Math.random() * allSamples.length)].id
        : null
      const newBody: PlanetBody = {
        id: `body_${Date.now().toString(36)}`,
        name: dp.tool === 'add-sun' ? `Sun ${starCount + 1}` : `Planet ${planetCount + 1}`,
        type: dp.tool === 'add-sun' ? 'sun' : 'planet',
        mass: defs.mass,
        x: dp.bodyX, y: dp.bodyY, vx, vy,
        fixed: defs.fixed,
        color: resolvedColor,
        sampleId: resolvedSampleId,
        orbitLoopNumer: 1,
        orbitLoopDenom: 1,
        effectorType: 'none',
        effectorDistance: 200,
        effectorMaxWet: 0.7,
        effectorDecay: 2.5,
        effectorDelayDivision: 0.25,
        effectorFeedback: 0.4,
        effectorDistortion: 0.4,
        effectorChorusFreq: 1.5,
        effectorChorusDepth: 0.5,
        ...BODY_DRONE_DEFAULTS,
        ...BODY_MIDI_DEFAULTS,
        muted: false,
        volume: 1,
      }
      storeState.addBody(newBody)
      storeBodiesRef.current = [...storeBodiesRef.current, newBody]
      liveBodiesRef.current.push({
        id: newBody.id, mass: newBody.mass, x: dp.bodyX, y: dp.bodyY,
        vx, vy, ax: 0, ay: 0, fixed: newBody.fixed,
      })
      trailsRef.current.set(newBody.id, makeTrail(simParamsRef.current.trailLength))
      computeAccels(liveBodiesRef.current, simParamsRef.current.G, simParamsRef.current.epsilon)
      setSelectedBodyId(newBody.id)

      // ── Initial launch trigger ─────────────────────────────────────────────
      // Fire once after a short delay to give instrument engines time to init.
      // Tries the instrument-rack path first; falls back to legacy sampler.
      const _launchId = newBody.id
      window.setTimeout(() => {
        const sbi = storeBodiesRef.current.find(b => b.id === _launchId)
        if (sbi?.muted) return
        sendMidiNote(sbi?.midiChannel ?? 1, sbi?.midiNote ?? 60, sbi?.midiVelocity ?? 100, 200)
        if (fireBodyInstrumentTrigger(_launchId)) {
          markBodyTriggered(_launchId)
          return
        }
        // Legacy sample path fallback
        const sample = resolveBodySamplerSample(_launchId, sbi?.sampleId ?? null, projectSamplesRef.current)
        if (sample) {
          const sp      = simParamsRef.current
          const bodyOv  = useControlSetStore.getState().getBodyEffectiveParams(_launchId)
          const spatial = computeBodyRackOutputSpatial(_launchId, liveBodiesRef.current, sp, bodyOv)
          const finalVol = 0.85 * Math.max(0, Math.min(1, (sbi?.volume ?? 1) * spatial.volume))
          triggerBodySound(sample, { playbackRate: 1, volume: finalVol, overlap: false, pan: spatial.pan, detuneCents: 0 })
          setBodyOutputLevel(_launchId, 'sampler', finalVol, 900)
        }
        markBodyTriggered(_launchId)
      }, 150)

      return
    }

    setDraggingBodyId(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const bodies   = liveBodiesRef.current
  const { w, h } = size

  // Predicted orbit preview (computed every frame while dragging)
  const predictOrbitPoints: string | null = (() => {
    if (!dragPlace || !storeParams.showPredictedOrbit) return null
    const vx = (dragPlace.bodyX - dragPlace.dragX) * VELOCITY_SCALE
    const vy = (dragPlace.bodyY - dragPlace.dragY) * VELOCITY_SCALE
    const previewBody: LiveBody = {
      id: '__preview__',
      mass: dragPlace.tool === 'add-sun' ? 500 : 1,
      x: dragPlace.bodyX, y: dragPlace.bodyY,
      vx, vy, ax: 0, ay: 0, fixed: false,
    }
    return computePredictedOrbit(liveBodiesRef.current, simParamsRef.current, previewBody, PREDICT_STEPS)
  })()
  const cx = w / 2, cy = h / 2
  const camTx = `translate(${cx},${cy}) scale(${zoom}) translate(${-viewOffset.x},${-viewOffset.y})`

  const simple       = storeParams.simpleTheme
  const bgColor      = simple ? '#fafaf9' : '#0a0a0f'
  const labelColor   = simple ? 'rgba(0,0,0,0.5)'   : 'rgba(255,255,255,0.5)'
  const hudColor     = simple ? 'rgba(0,0,0,0.38)'  : 'rgba(255,255,255,0.38)'
  const selStroke    = simple ? 'rgba(0,0,0,0.35)'  : 'rgba(255,255,255,0.45)'
  const trailOpacity = simple ? 0.45 : 0.30

  // Probe cursor params
  const probePos = tool === 'probe' ? mousePosWorldRef.current : null
  const probeWr  = probePos ? bodyScreenR(storeParams.probeMass, 'planet', storeParams.bodyRadiusFromMass) / zoom : 0
  const probeCol = '#a78bfa'

  // Drag-place overlay data
  const dpOverlay = dragPlace ? {
    col:     dragPlace.tool === 'add-sun' ? '#f59e0b' : '#60a5fa',
    wr:      bodyScreenR(dragPlace.tool === 'add-sun' ? 500 : 1,
               dragPlace.tool === 'add-sun' ? 'sun' : 'planet',
               storeParams.bodyRadiusFromMass) / zoom,
    arrowX:  dragPlace.bodyX + (dragPlace.bodyX - dragPlace.dragX) * 0.5,
    arrowY:  dragPlace.bodyY + (dragPlace.bodyY - dragPlace.dragY) * 0.5,
    hasDrag: dragPlace.dragX !== dragPlace.bodyX || dragPlace.dragY !== dragPlace.bodyY,
  } : null

  const cursorStyle = tool !== 'select'
    ? 'crosshair'
    : draggingBodyId ? 'grabbing'
    : isPanning ? 'grabbing'
    : dragSel ? 'crosshair'
    : 'default'

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden', background: bgColor, userSelect: 'none' }}
    >
      <svg
        ref={svgRef}
        width={w} height={h}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        onContextMenu={e => e.preventDefault()}
        style={{ display: 'block', cursor: cursorStyle }}
      >
        <defs>
          <marker id="velArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={simple ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.55)'} />
          </marker>
          <marker id="placeArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={dpOverlay?.col ?? '#888'} />
          </marker>
          {!simple && (
            <radialGradient id="bgGrad">
              <stop offset="0%" stopColor="#12121f" />
              <stop offset="100%" stopColor="#0a0a0f" />
            </radialGradient>
          )}
        </defs>

        <rect width={w} height={h} fill={simple ? '#fafaf9' : 'url(#bgGrad)'} />

        {!simple && Array.from({ length: 80 }, (_, i) => {
          const seed = i * 137.508
          const x  = (Math.sin(seed) * 0.5 + 0.5) * w
          const y  = (Math.cos(seed * 1.618) * 0.5 + 0.5) * h
          const r  = (Math.sin(seed * 2.3) * 0.5 + 0.5) * 1 + 0.3
          const op = (Math.cos(seed * 0.7) * 0.5 + 0.5) * 0.4 + 0.1
          return <circle key={i} cx={x} cy={y} r={r} fill="white" opacity={op} />
        })}

        <g transform={camTx}>
          {/* Trails */}
          {storeParams.showTrails && bodies.map(b => {
            const ring = trailsRef.current.get(b.id)
            if (!ring || ring.count < 2) return null
            const pts = trailToPoints(ring)
            if (!pts) return null
            const sb = storeBodiesRef.current.find(s => s.id === b.id)
            return (
              <polyline key={`trail-${b.id}`} points={pts} fill="none"
                stroke={sb?.color ?? '#888'} strokeWidth={1.2 / zoom} strokeOpacity={trailOpacity} />
            )
          })}

          {/* Velocity vectors */}
          {storeParams.showVelocityVectors && bodies.map(b => {
            const sb = storeBodiesRef.current.find(s => s.id === b.id)
            return (
              <line key={`vel-${b.id}`}
                x1={b.x} y1={b.y} x2={b.x + b.vx * 25} y2={b.y + b.vy * 25}
                stroke={sb?.color ?? '#888'} strokeWidth={1.5 / zoom} strokeOpacity={0.7}
                markerEnd="url(#velArrow)" />
            )
          })}

          {/* Bodies */}
          {bodies.map(b => {
            const sb        = storeBodiesRef.current.find(s => s.id === b.id)
            const type      = sb?.type  ?? 'planet'
            const color     = sb?.color ?? '#888'
            const samplerSample = resolveBodySamplerSample(b.id, sb?.sampleId, projectSamplesRef.current)
            const hasSample = Boolean(samplerSample)
            // Label: show sample name when enabled and sample is assigned
            const sampleLabel = storeParams.showSampleName && samplerSample
              ? samplerSample.name
              : (sb?.name ?? b.id)
            const name  = sampleLabel
            const wr        = bodyScreenR(b.mass, type, storeParams.bodyRadiusFromMass) / zoom
            const isSel     = b.id === selectedBodyId
            const isMultiSel = !isSel && selectedBodyIds.includes(b.id)

            return (
              <g key={b.id}>
                {!simple ? (
                  <circle cx={b.x} cy={b.y} r={wr * 2.5} fill={color} opacity={0.07} />
                ) : (
                  type === 'sun' && (
                    <circle cx={b.x} cy={b.y} r={wr * 1.6} fill={color} opacity={0.12} />
                  )
                )}
                {isSel && (
                  <circle cx={b.x} cy={b.y} r={wr + 5 / zoom} fill="none"
                    stroke={selStroke} strokeWidth={1 / zoom}
                    strokeDasharray={`${5 / zoom} ${3 / zoom}`} />
                )}
                {isMultiSel && (
                  <circle cx={b.x} cy={b.y} r={wr + 5 / zoom} fill="none"
                    stroke="rgba(139,92,246,0.65)" strokeWidth={1 / zoom}
                    strokeDasharray={`${4 / zoom} ${3 / zoom}`} />
                )}
                {/* Effector ring + influence radius */}
                {(() => {
                  const sb = storeBodiesRef.current.find(s => s.id === b.id)
                  const rackOv  = useControlSetStore.getState().getBodyEffectiveParams(b.id)
                  const effType = (rackOv.effectorType ?? sb?.effectorType ?? 'none') as string
                  if (effType === 'none') return null
                  const effDist = ((rackOv.effectorDistance ?? sb?.effectorDistance ?? 200) as number)
                  const effCol  = effType === 'delay'      ? '#a78bfa'
                               : effType === 'distortion'  ? '#ef4444'
                               : effType === 'chorus'      ? '#10b981'
                               : effType === 'phaser'      ? '#c084fc'
                               : effType === 'autofilter'  ? '#22d3ee'
                               : effType === 'bitcrush'    ? '#fb923c'
                               : effType === 'freeze'      ? '#7dd3fc'
                               : '#f97316'  // reverb = orange
                  const effLabel = effType === 'delay'      ? 'DLY'
                               : effType === 'distortion'  ? 'DST'
                               : effType === 'chorus'      ? 'CHO'
                               : effType === 'phaser'      ? 'PHS'
                               : effType === 'autofilter'  ? 'AFL'
                               : effType === 'bitcrush'    ? 'BIT'
                               : effType === 'freeze'      ? 'FRZ'
                               : 'FX'
                  return (
                    <>
                      <circle cx={b.x} cy={b.y} r={wr + 6 / zoom} fill="none"
                        stroke={effCol} strokeWidth={1.5 / zoom} strokeOpacity={0.65}
                        strokeDasharray={`${3 / zoom} ${2 / zoom}`} />
                      <circle cx={b.x} cy={b.y} r={effDist} fill="none"
                        stroke={effCol} strokeWidth={0.5 / zoom} strokeOpacity={0.20}
                        strokeDasharray={`${8 / zoom} ${5 / zoom}`} />
                      <text
                        x={b.x + wr + 10 / zoom} y={b.y - 2 / zoom}
                        fontSize={8 / zoom} fill={effCol} opacity={0.75}
                        style={{ pointerEvents: 'none', userSelect: 'none' }}>
                        {effLabel}
                      </text>
                    </>
                  )
                })()}
                {/* Standpoint listener ring + range + optional directional cone */}
                {storeParams.standpointBodyId === b.id && storeParams.showStandpointVisual !== false && (() => {
                  const r     = storeParams.standpointMaxDist
                  const dirOn = storeParams.standpointDirectional
                  // Facing angle for cone (from live velocity or manual)
                  let facingRad = storeParams.standpointFacingAngle * Math.PI / 180
                  if (dirOn && storeParams.standpointFacing === 'velocity') {
                    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy)
                    if (speed > 0.001) facingRad = Math.atan2(b.vy, b.vx)
                  }
                  const halfConeRad = (storeParams.standpointConeWidth / 2) * Math.PI / 180
                  const startAngle  = facingRad - halfConeRad
                  const endAngle    = facingRad + halfConeRad
                  const x1 = b.x + r * Math.cos(startAngle)
                  const y1 = b.y + r * Math.sin(startAngle)
                  const x2 = b.x + r * Math.cos(endAngle)
                  const y2 = b.y + r * Math.sin(endAngle)
                  const largeArc = halfConeRad * 2 > Math.PI ? 1 : 0

                  return (
                    <>
                      <circle cx={b.x} cy={b.y} r={wr + 7 / zoom} fill="none"
                        stroke="#06b6d4" strokeWidth={1.5 / zoom} strokeOpacity={0.75} />
                      {/* Range: cone sector if directional, full circle otherwise */}
                      {dirOn ? (
                        <path
                          d={`M ${b.x} ${b.y} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`}
                          fill="#06b6d422" stroke="#06b6d4" strokeWidth={0.5 / zoom} strokeOpacity={0.55}
                          strokeDasharray={`${7 / zoom} ${5 / zoom}`} />
                      ) : (
                        <circle cx={b.x} cy={b.y} r={r} fill="none"
                          stroke="#06b6d4" strokeWidth={0.5 / zoom} strokeOpacity={0.22}
                          strokeDasharray={`${7 / zoom} ${5 / zoom}`} />
                      )}
                      <text
                        x={b.x + wr + 11 / zoom} y={b.y + 3 / zoom}
                        fontSize={9 / zoom} fill="#06b6d4" opacity={0.75}
                        style={{ pointerEvents: 'none', userSelect: 'none' }}>
                        SP
                      </text>
                    </>
                  )
                })()}
                {/* Orbit trigger position markers */}
                {(() => {
                  const bodyOv = useControlSetStore.getState().getBodyEffectiveParams(b.id)
                  const bp = Object.keys(bodyOv).length > 0 ? { ...storeParams, ...bodyOv } : storeParams
                  if (!bp.showOrbitTriggerMarkers || bp.orbitTriggerMode !== 'orbit-complete') return null
                  const stats = planetBodyStatsCache.get(b.id)
                  if (!stats || stats.r < 5) return null
                  const r = stats.r
                  const bodyAngleRad = stats.angleDeg * Math.PI / 180
                  // CoM position inferred from body pos + r + angle
                  const cmX = b.x - r * Math.cos(bodyAngleRad)
                  const cmY = b.y - r * Math.sin(bodyAngleRad)
                  const div = Math.max(0.0625, Number((bp as Record<string,unknown>).orbitTriggerDivision ?? 1))
                  const nMarkers = div >= 1 ? 1 : Math.round(1 / div)
                  return Array.from({ length: nMarkers }, (_, k) => {
                    const a = bodyAngleRad + k * 2 * Math.PI / nMarkers
                    const mx = cmX + r * Math.cos(a)
                    const my = cmY + r * Math.sin(a)
                    return (
                      <g key={k}>
                        <circle cx={mx} cy={my} r={5 / zoom} fill="none"
                          stroke="#60a5fa" strokeWidth={1.2 / zoom} strokeOpacity={0.65} />
                        <line
                          x1={mx} y1={my - 5 / zoom} x2={mx} y2={my + 5 / zoom}
                          stroke="#60a5fa" strokeWidth={0.8 / zoom} strokeOpacity={0.40} />
                      </g>
                    )
                  })
                })()}
                {hasSample && storeParams.rendezvousDistance > 0 && (
                  <circle cx={b.x} cy={b.y} r={storeParams.rendezvousDistance} fill="none"
                    stroke={color} strokeWidth={0.5 / zoom} strokeOpacity={0.18}
                    strokeDasharray={`${8 / zoom} ${6 / zoom}`} />
                )}
                <circle cx={b.x} cy={b.y} r={wr} fill={color}
                  stroke={simple ? 'rgba(0,0,0,0.15)' : 'none'}
                  strokeWidth={simple ? 1 / zoom : 0}
                  style={{
                    cursor: storeParams.paused && !b.fixed ? 'grab' : 'default',
                    filter: !simple
                      ? `drop-shadow(0 0 ${type === 'sun' ? 8 : 4}px ${color}88)`
                      : type === 'sun' ? `drop-shadow(0 0 3px ${color}66)` : 'none',
                  }}
                />
                {simple && type === 'sun' && (
                  <>
                    <line x1={b.x - wr * 1.5} y1={b.y} x2={b.x + wr * 1.5} y2={b.y}
                      stroke={color} strokeWidth={1 / zoom} strokeOpacity={0.45} />
                    <line x1={b.x} y1={b.y - wr * 1.5} x2={b.x} y2={b.y + wr * 1.5}
                      stroke={color} strokeWidth={1 / zoom} strokeOpacity={0.45} />
                  </>
                )}
                {hasSample && (
                  <circle cx={b.x + wr * 0.7} cy={b.y - wr * 0.7} r={2.5 / zoom}
                    fill={simple ? '#2563eb' : '#60a5fa'} opacity={0.9} />
                )}
                <text x={b.x} y={b.y - wr - 5 / zoom} textAnchor="middle"
                  fontSize={10 / zoom} fill={labelColor}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {name}
                </text>
              </g>
            )
          })}

          {/* ── Probe cursor ───────────────────────────────────────────── */}
          {probePos && (
            <g>
              <circle cx={probePos.x} cy={probePos.y} r={probeWr * 3}
                fill={probeCol} opacity={0.06} />
              <circle cx={probePos.x} cy={probePos.y} r={probeWr} fill="none"
                stroke={probeCol} strokeWidth={1.5 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} />
              <circle cx={probePos.x} cy={probePos.y} r={3 / zoom}
                fill={probeCol} opacity={0.85} />
              {/* Crosshair */}
              {[[-1.6, 0, -0.55, 0], [0.55, 0, 1.6, 0], [0, -1.6, 0, -0.55], [0, 0.55, 0, 1.6]].map(([x1f, y1f, x2f, y2f], i) => (
                <line key={i}
                  x1={probePos.x + x1f * probeWr} y1={probePos.y + y1f * probeWr}
                  x2={probePos.x + x2f * probeWr} y2={probePos.y + y2f * probeWr}
                  stroke={probeCol} strokeWidth={1 / zoom} opacity={0.65} />
              ))}
              <text x={probePos.x} y={probePos.y - probeWr - 5 / zoom} textAnchor="middle"
                fontSize={9 / zoom} fill={probeCol} opacity={0.8}
                style={{ userSelect: 'none', pointerEvents: 'none' }}>
                probe m={storeParams.probeMass}
              </text>
            </g>
          )}

          {/* ── Predicted orbit preview ────────────────────────────────── */}
          {predictOrbitPoints && dpOverlay && (
            <polyline
              points={predictOrbitPoints}
              fill="none"
              stroke={dpOverlay.col}
              strokeWidth={1 / zoom}
              strokeOpacity={0.40}
              strokeDasharray={`${4 / zoom} ${4 / zoom}`}
            />
          )}

          {/* ── Drag-place bow-and-arrow overlay ───────────────────────── */}
          {dragPlace && dpOverlay && (
            <g>
              <line x1={dragPlace.bodyX} y1={dragPlace.bodyY}
                x2={dragPlace.dragX} y2={dragPlace.dragY}
                stroke={simple ? 'rgba(0,0,0,0.38)' : 'rgba(255,255,255,0.38)'}
                strokeWidth={1.5 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />
              {dpOverlay.hasDrag && (
                <line x1={dragPlace.bodyX} y1={dragPlace.bodyY}
                  x2={dpOverlay.arrowX} y2={dpOverlay.arrowY}
                  stroke={dpOverlay.col} strokeWidth={2 / zoom} markerEnd="url(#placeArrow)" />
              )}
              <circle cx={dragPlace.bodyX} cy={dragPlace.bodyY} r={dpOverlay.wr}
                fill={dpOverlay.col} opacity={0.72} />
            </g>
          )}
        </g>

        {storeParams.paused && (
          <g>
            <rect x={6} y={6} width={230} height={20} rx={3}
              fill={simple ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.4)'} />
            <text x={12} y={21} fontSize={11} fill={hudColor} fontFamily="monospace">
              ⏸  PAUSED — drag bodies to reposition
            </text>
          </g>
        )}
        <text x={8} y={h - 8} fontSize={9} fontFamily="monospace"
          fill={simple ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.18)'}>
          scroll: zoom · right-drag: pan
        </text>
        <text x={w - 8} y={h - 8} fontSize={9} fontFamily="monospace"
          textAnchor="end" fill={simple ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.18)'}>
          {bodies.length} bodies · speed={(storeParams.dt / 0.2).toFixed(storeParams.dt < 0.2 ? 2 : 1)}x · G={storeParams.G} · ε={storeParams.epsilon} · dt={storeParams.dt}
        </text>

        {/* Drag-rect multi-select overlay (screen coords, no camera transform) */}
        {dragSel && tool === 'select' && (() => {
          const rx = Math.min(dragSel.sx, dragSel.ex)
          const ry = Math.min(dragSel.sy, dragSel.ey)
          const rw = Math.abs(dragSel.ex - dragSel.sx)
          const rh = Math.abs(dragSel.ey - dragSel.sy)
          return (
            <rect x={rx} y={ry} width={rw} height={rh}
              fill="rgba(139,92,246,0.07)"
              stroke="rgba(139,92,246,0.55)"
              strokeWidth={1}
              strokeDasharray="5 3"
              style={{ pointerEvents: 'none' }} />
          )
        })()}
      </svg>
    </div>
  )
}
