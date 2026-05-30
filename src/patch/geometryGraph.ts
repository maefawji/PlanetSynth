import type { GeometryObject, ModularProject, PatchNodeInstance } from './types'

const derivedStyle = {
  stroke: 'rgba(37,99,235,0.78)',
  strokeWidth: 1.5,
  fill: 'none',
}

function incomingEdge(project: ModularProject, nodeId: string, portId: string) {
  const edges = incomingEdges(project, nodeId, portId)
  return edges[edges.length - 1] ?? null
}

function incomingEdges(project: ModularProject, nodeId: string, portId: string) {
  return project.edges.filter(e => e.toNodeId === nodeId && e.toPortId === portId)
}

function nodeById(project: ModularProject, nodeId: string): PatchNodeInstance | null {
  return project.nodes.find(n => n.id === nodeId) ?? null
}

function baseGeometry(project: ModularProject): GeometryObject[] {
  return project.geometry.filter(g => g.role !== 'derived' && !g.sourceNodeId)
}

export function resolveGeometryOutput(
  nodeId: string,
  portId: string,
  project: ModularProject,
  seen = new Set<string>(),
  timeSeconds = 0,
): GeometryObject | null {
  if (portId !== 'geometry' || seen.has(nodeId)) return null
  seen.add(nodeId)

  const node = nodeById(project, nodeId)
  if (!node) return null

  switch (node.type) {
    case 'geometry.referenceCircle': {
      const inputCircle = resolveGeometryInput(node.id, 'circle', project, seen, timeSeconds)
      if (inputCircle?.type === 'circle') return inputCircle
      const requestedId = typeof node.params.geometryId === 'string' ? node.params.geometryId : ''
      const bases = baseGeometry(project)
      return bases.find(g => g.id === requestedId && g.type === 'circle')
        ?? bases.find(g => g.type === 'circle')
        ?? null
    }
    case 'geometry.referencePoint': {
      const inputPoint = resolveGeometryInput(node.id, 'point', project, seen, timeSeconds)
      if (inputPoint?.type === 'point') return inputPoint
      const requestedId = typeof node.params.geometryId === 'string' ? node.params.geometryId : ''
      const bases = baseGeometry(project)
      return bases.find(g => g.id === requestedId && g.type === 'point')
        ?? bases.find(g => g.type === 'point')
        ?? null
    }
    case 'geometry.referenceCurve': {
      const requestedId = typeof node.params.geometryId === 'string' ? node.params.geometryId : ''
      const bases = baseGeometry(project)
      return bases.find(g => g.id === requestedId && isCurveGeometry(g))
        ?? bases.find(isCurveGeometry)
        ?? null
    }
    case 'geometry.drawCircle':
    case 'geometry.circle': {
      const point = resolveGeometryInput(node.id, 'point', project, seen, timeSeconds)
      const cx = point?.type === 'point'
        ? ((point.params.x as number) ?? 300)
        : resolveControlInput(node.id, 'cx', project, (node.params.cx as number) ?? 300, seen, timeSeconds)
      const cy = point?.type === 'point'
        ? ((point.params.y as number) ?? 200)
        : resolveControlInput(node.id, 'cy', project, (node.params.cy as number) ?? 200, seen, timeSeconds)
      const r = resolveControlInput(node.id, 'radius', project, (node.params.r as number) ?? 100, seen, timeSeconds)
      return {
        id: `derived_${node.id}`,
        type: 'circle',
        role: 'derived',
        sourceNodeId: node.id,
        params: {
          cx,
          cy,
          r,
        },
        style: derivedStyle,
      }
    }
    case 'geometry.circleFromPoint': {
      const point = resolveGeometryInput(node.id, 'point', project, seen, timeSeconds)
      if (!point || point.type !== 'point') return null
      const cx = (point.params.x as number) ?? 0
      const cy = (point.params.y as number) ?? 0
      const r = resolveControlInput(node.id, 'radius', project, (node.params.radius as number) ?? 60, seen, timeSeconds)
      return {
        id: `derived_${node.id}`,
        type: 'circle',
        role: 'derived',
        sourceNodeId: node.id,
        params: {
          cx,
          cy,
          r,
        },
        style: derivedStyle,
      }
    }
    case 'geometry.circleOrbit': {
      const circle = resolveGeometryInput(node.id, 'circle', project, seen, timeSeconds)
      if (!circle || circle.type !== 'circle') return null
      const r = (circle.params.r as number) ?? 100
      const orbitDistance = resolveControlInput(node.id, 'orbitDistance', project, (node.params.orbitDistance as number) ?? (2 * Math.PI * r), seen, timeSeconds)
      const orbitTime = resolveControlInput(node.id, 'orbitTime', project, (node.params.orbitTime as number) ?? 2, seen, timeSeconds)
      return {
        ...circle,
        id: `derived_${node.id}`,
        role: 'derived',
        sourceNodeId: node.id,
        params: { ...circle.params, orbitDistance, orbitTime },
      }
    }
    case 'geometry.drawPoint':
    case 'geometry.point': {
      const x = resolveControlInput(node.id, 'x', project, (node.params.x as number) ?? 300, seen, timeSeconds)
      const y = resolveControlInput(node.id, 'y', project, (node.params.y as number) ?? 200, seen, timeSeconds)
      return {
        id: `derived_${node.id}`,
        type: 'point',
        role: 'derived',
        sourceNodeId: node.id,
        params: { x, y },
        style: { ...derivedStyle, fill: 'rgba(37,99,235,0.78)' },
      }
    }
    case 'geometry.pointOnCurve': {
      const curve = resolveGeometryInput(node.id, 'curve', project, seen, timeSeconds)
      if (!curve || !isCurveGeometry(curve)) return null
      const speed = resolveControlInput(node.id, 'speed', project, (node.params.speed as number) ?? 80, seen, timeSeconds)
      const offset = (node.params.offset as number) ?? 0
      const point = pointOnCurveObject(curve, timeSeconds * speed + offset)
      return {
        id: `derived_${node.id}`,
        type: 'point',
        role: 'derived',
        sourceNodeId: node.id,
        params: { x: point.x, y: point.y },
        style: { ...derivedStyle, fill: 'rgba(37,99,235,0.78)' },
      }
    }
    case 'geometry.drawPath':
    case 'geometry.path':
      return {
        id: `derived_${node.id}`,
        type: 'path',
        role: 'derived',
        sourceNodeId: node.id,
        params: { svgPath: (node.params.svgPath as string) ?? '' },
        style: derivedStyle,
      }
    default:
      return null
  }
}

export function resolveGeometryListOutput(
  nodeId: string,
  portId: string,
  project: ModularProject,
  seen = new Set<string>(),
  _timeSeconds = 0,
): GeometryObject[] {
  if (portId !== 'geometryList' || seen.has(nodeId)) return []
  seen.add(nodeId)

  const node = nodeById(project, nodeId)
  if (!node) return []

  switch (node.type) {
    case 'geometry.referenceAllCurves':
    case 'curve-reader':
      return allCurveGeometry(project, seen, _timeSeconds)
    default:
      return []
  }
}

function allCurveGeometry(
  project: ModularProject,
  seen: Set<string>,
  timeSeconds: number,
): GeometryObject[] {
  const bases = baseGeometry(project).filter(isCurveGeometry)
  const derived = project.nodes
    .filter(node => !seen.has(node.id) && node.type !== 'geometry.referenceAllCurves' && node.type !== 'display.geometry')
    .map(node => resolveGeometryOutput(node.id, 'geometry', project, new Set(seen), timeSeconds))
    .filter((geom): geom is GeometryObject => Boolean(geom && isCurveGeometry(geom)))
  return uniqueGeometry([...bases, ...derived])
}

function isCurveGeometry(geom: GeometryObject): boolean {
  return geom.type !== 'point'
}

function resolveGeometryInput(
  nodeId: string,
  portId: string,
  project: ModularProject,
  seen: Set<string>,
  timeSeconds: number,
): GeometryObject | null {
  const edge = incomingEdge(project, nodeId, portId)
  if (!edge || edge.signalType !== 'geometry') return null
  return resolveGeometryOutput(edge.fromNodeId, edge.fromPortId, project, seen, timeSeconds)
}

function resolveGeometryInputs(
  nodeId: string,
  portId: string,
  project: ModularProject,
  seen: Set<string>,
  timeSeconds: number,
): GeometryObject[] {
  return incomingEdges(project, nodeId, portId)
    .filter(edge => edge.signalType === 'geometry')
    .map(edge => resolveGeometryOutput(edge.fromNodeId, edge.fromPortId, project, new Set(seen), timeSeconds))
    .filter((geom): geom is GeometryObject => Boolean(geom))
}

function resolveGeometryListInputs(
  nodeId: string,
  portId: string,
  project: ModularProject,
  seen: Set<string>,
  timeSeconds: number,
): GeometryObject[] {
  return incomingEdges(project, nodeId, portId)
    .filter(edge => edge.signalType === 'geometryList')
    .flatMap(edge => resolveGeometryListOutput(edge.fromNodeId, edge.fromPortId, project, new Set(seen), timeSeconds))
}

export function resolveControlOutput(
  nodeId: string,
  portId: string,
  project: ModularProject,
  seen = new Set<string>(),
  timeSeconds = 0,
): number | null {
  const node = nodeById(project, nodeId)
  if (!node) return null

  if (node.type === 'control.number' || node.type === 'number' || node.type === 'toggle' || node.type === 'receive') {
    return (node.params.value as number) ?? 0
  }

  if (node.type === 'message') {
    const value = Number(node.params.text)
    return Number.isFinite(value) ? value : 0
  }

  if (node.type === 'random') return Math.random() * ((node.params.max as number) ?? 1)

  if (node.type === 'counter') return (node.params.value as number) ?? 0

  if (node.type === 'pack') {
    const values = [
      resolveControlInput(node.id, 'a', project, 0, seen, timeSeconds),
      resolveControlInput(node.id, 'b', project, 0, seen, timeSeconds),
    ]
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }

  if (node.type === 'unpack') {
    const value = resolveControlInput(node.id, 'value', project, (node.params.value as number) ?? 0, seen, timeSeconds)
    if (portId === 'a' || portId === 'b') return value
  }

  if (node.type === 'geometry.circleParams') {
    const geom = resolveGeometryInput(node.id, 'geometry', project, seen, timeSeconds)
    if (!geom || geom.type !== 'circle') return null
    const cx = (geom.params.cx as number) ?? 0
    const cy = (geom.params.cy as number) ?? 0
    const r = (geom.params.r as number) ?? 0
    if (portId === 'cx') return cx
    if (portId === 'cy') return cy
    if (portId === 'radius') return r
    if (portId === 'area') return Math.PI * r * r
    if (portId === 'circumference') return 2 * Math.PI * r
    if (portId === 'orbitDistance') return (geom.params.orbitDistance as number) ?? (2 * Math.PI * r)
    if (portId === 'orbitTime') return (geom.params.orbitTime as number) ?? 2
    return null
  }

  if (node.type === 'geometry.drawCircle' || node.type === 'geometry.circle' || node.type === 'geometry.circleFromPoint') {
    const geom = resolveGeometryOutput(node.id, 'geometry', project, seen, timeSeconds)
    if (!geom) return null
    const r = (geom.params.r as number) ?? 0
    if (portId === 'radius') return r
    if (portId === 'area') return Math.PI * r * r
    if (portId === 'circumference') return 2 * Math.PI * r
  }

  if (node.type === 'geometry.drawPoint' || node.type === 'geometry.point' || node.type === 'geometry.pointOnCurve') {
    const geom = resolveGeometryOutput(node.id, 'geometry', project, seen, timeSeconds)
    if (geom?.type === 'point') {
      if (portId === 'x') return (geom.params.x as number) ?? 0
      if (portId === 'y') return (geom.params.y as number) ?? 0
    }
  }

  if (node.type === 'shape.area') {
    const geom = resolveGeometryInput(node.id, 'geometry', project, seen, timeSeconds)
    if (!geom) return null
    return geometryArea(geom)
  }

  if (node.type === 'path.length') {
    const geom = resolveGeometryInput(node.id, 'geometry', project, seen, timeSeconds)
    if (!geom || !isCurveGeometry(geom)) return null
    return curveLength(geom)
  }

  if (node.type === 'area-to-pitch') {
    const value = resolveControlInput(node.id, 'value', project, 0, seen, timeSeconds)
    const inMin = (node.params.inMin as number) ?? 0
    const inMax = (node.params.inMax as number) ?? 10000
    const outMin = (node.params.outMin as number) ?? 100
    const outMax = (node.params.outMax as number) ?? 1000
    if (inMax === inMin) return outMin
    const t = Math.max(0, Math.min(1, (value - inMin) / (inMax - inMin)))
    return outMin + (outMax - outMin) * t
  }

  if (node.type === 'geometry-lfo') {
    const rate = resolveControlInput(node.id, 'rate', project, (node.params.rate as number) ?? 1, seen, timeSeconds)
    const amount = (node.params.amount as number) ?? 1
    return ((Math.sin(timeSeconds * Math.PI * 2 * rate) + 1) / 2) * amount
  }

  return typeof node.params[portId] === 'number' ? (node.params[portId] as number) : null
}

export function resolveTriggerOutput(
  nodeId: string,
  portId: string,
  project: ModularProject,
  seen = new Set<string>(),
  timeSeconds = 0,
): boolean {
  if (portId !== 'trigger' || seen.has(nodeId)) return false
  seen.add(nodeId)

  const node = nodeById(project, nodeId)
  if (!node) return false

  if (node.type === 'control.trigger' || node.type === 'bang') return true

  if (node.type === 'toggle') return ((node.params.value as number) ?? 0) > 0

  if (node.type === 'metro') {
    // enabled defaults to true unless explicitly set false
    if (node.params.enabled === false) return false
    // interval can come from a connected control signal or from the node's own param
    const intervalMs = Math.max(
      20,
      resolveControlInput(node.id, 'interval', project, (node.params.interval as number) ?? 500, seen, timeSeconds),
    )
    const intervalSec = intervalMs / 1000
    // Brief pulse (10% duty) at the start of each interval.
    // The rising-edge detector in processTriggerValues fires exactly once per interval.
    const phase = (timeSeconds % intervalSec) / intervalSec
    return phase < 0.1
  }

  if (node.type === 'delay') {
    // Pass-through: delayed trigger is treated as immediate for MVP
    const edge = incomingEdge(project, nodeId, 'trigger')
    if (!edge) return false
    return resolveTriggerOutput(edge.fromNodeId, 'trigger', project, new Set(seen), timeSeconds)
  }

  if (node.type === 'select') {
    const input = resolveControlInput(node.id, 'value', project, 0, seen, timeSeconds)
    return input === ((node.params.match as number) ?? 1)
  }

  if (node.type === 'geometry.geoTrigger' || node.type === 'geo-trigger') {
    const geometries = ['a', 'b', 'c', 'd']
      .flatMap(port => resolveGeometryInputs(node.id, port, project, new Set(seen), timeSeconds))
    geometries.push(...resolveGeometryListInputs(node.id, 'geometryList', project, new Set(seen), timeSeconds))
    return anyGeometryOverlap(uniqueGeometry(geometries))
  }

  return false
}

function resolveControlInput(
  nodeId: string,
  portId: string,
  project: ModularProject,
  fallback: number,
  seen: Set<string>,
  timeSeconds: number,
): number {
  const values = resolveControlInputs(nodeId, portId, project, seen, timeSeconds)
  if (values.length === 0) return fallback
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function resolveControlInputs(
  nodeId: string,
  portId: string,
  project: ModularProject,
  seen = new Set<string>(),
  timeSeconds = 0,
): number[] {
  return incomingEdges(project, nodeId, portId)
    .filter(edge => edge.signalType === 'control' || edge.signalType === 'geometry')
    .map(edge => resolveControlOutput(edge.fromNodeId, edge.fromPortId, project, new Set(seen), timeSeconds))
    .filter((value): value is number => value !== null)
}

function uniqueGeometry(geometries: GeometryObject[]): GeometryObject[] {
  const seen = new Set<string>()
  return geometries.filter(geom => {
    if (seen.has(geom.id)) return false
    seen.add(geom.id)
    return true
  })
}

function anyGeometryOverlap(geometries: GeometryObject[]): boolean {
  for (let i = 0; i < geometries.length; i += 1) {
    for (let j = i + 1; j < geometries.length; j += 1) {
      if (geometriesOverlap(geometries[i], geometries[j])) return true
    }
  }
  return false
}

function geometriesOverlap(a: GeometryObject, b: GeometryObject): boolean {
  if (a.type === 'circle' && b.type === 'circle') return circlesOverlap(a, b)
  if (a.type === 'point' && b.type === 'circle') return pointInCircle(a, b)
  if (a.type === 'circle' && b.type === 'point') return pointInCircle(b, a)
  if (a.type === 'point' && b.type === 'point') {
    const ax = (a.params.x as number) ?? 0
    const ay = (a.params.y as number) ?? 0
    const bx = (b.params.x as number) ?? 0
    const by = (b.params.y as number) ?? 0
    const ar = ((a.params.size as number) ?? 5) + ((b.params.size as number) ?? 5)
    return Math.hypot(ax - bx, ay - by) <= ar
  }
  return boxesIntersect(geometryBounds(a), geometryBounds(b))
}

function circlesOverlap(a: GeometryObject, b: GeometryObject): boolean {
  const ax = (a.params.cx as number) ?? 0
  const ay = (a.params.cy as number) ?? 0
  const bx = (b.params.cx as number) ?? 0
  const by = (b.params.cy as number) ?? 0
  const ar = (a.params.rx as number) ?? (a.params.r as number) ?? 0
  const br = (b.params.rx as number) ?? (b.params.r as number) ?? 0
  return Math.hypot(ax - bx, ay - by) <= ar + br
}

function pointInCircle(point: GeometryObject, circle: GeometryObject): boolean {
  const x = (point.params.x as number) ?? 0
  const y = (point.params.y as number) ?? 0
  const cx = (circle.params.cx as number) ?? 0
  const cy = (circle.params.cy as number) ?? 0
  const rx = (circle.params.rx as number) ?? (circle.params.r as number) ?? 0
  const ry = (circle.params.ry as number) ?? (circle.params.r as number) ?? 0
  if (rx <= 0 || ry <= 0) return false
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
}

export function collectVisibleGeometry(project: ModularProject, timeSeconds = 0): GeometryObject[] {
  const base = baseGeometry(project)
  const derived = project.nodes
    .map(node => resolveGeometryOutput(node.id, 'geometry', project, new Set<string>(), timeSeconds))
    .filter((geom): geom is GeometryObject => Boolean(geom?.sourceNodeId))
  const display = project.nodes
    .filter(node => node.type === 'display.geometry')
    .flatMap(node => resolveDisplayGeometry(node, project, timeSeconds))
  return [...base, ...derived, ...display]
}

function resolveDisplayGeometry(
  node: PatchNodeInstance,
  project: ModularProject,
  timeSeconds: number,
): GeometryObject[] {
  const inputs = [
    ...resolveGeometryInputs(node.id, 'geometry', project, new Set<string>(), timeSeconds),
    ...resolveGeometryListInputs(node.id, 'geometryList', project, new Set<string>(), timeSeconds),
  ]
  return inputs.map(inputGeom => ({
    ...inputGeom,
    id: `display_${node.id}_${inputGeom.id}`,
    role: 'derived',
    sourceNodeId: node.id,
    style: {
      stroke: typeof node.params.stroke === 'string' ? node.params.stroke : inputGeom.style.stroke,
      fill: typeof node.params.fill === 'string' ? node.params.fill : inputGeom.style.fill,
      strokeWidth: typeof node.params.strokeWidth === 'number' ? node.params.strokeWidth : inputGeom.style.strokeWidth,
      opacity: typeof node.params.opacity === 'number' ? node.params.opacity : inputGeom.style.opacity,
    },
  }))
}

export function highlightedGeometryIdsForNode(
  project: ModularProject,
  nodeId: string | null,
  timeSeconds = 0,
): Set<string> {
  if (!nodeId) return new Set()
  const node = nodeById(project, nodeId)
  if (!node) return new Set()

  const ids = new Set<string>()
  const output = resolveGeometryOutput(node.id, 'geometry', project, new Set<string>(), timeSeconds)
  if (output) ids.add(output.id)
  const listOutput = resolveGeometryListOutput(node.id, 'geometryList', project, new Set<string>(), timeSeconds)
  for (const item of listOutput) ids.add(item.id)
  if (node.type === 'display.geometry') {
    const displayed = resolveDisplayGeometry(node, project, timeSeconds)
    for (const item of displayed) ids.add(item.id)
  }

  const defInputs = project.edges.filter(e => e.toNodeId === node.id && (e.signalType === 'geometry' || e.signalType === 'geometryList'))
  for (const edge of defInputs) {
    if (edge.signalType === 'geometry') {
      const input = resolveGeometryOutput(edge.fromNodeId, edge.fromPortId, project, new Set<string>(), timeSeconds)
      if (input) ids.add(input.id)
    } else {
      const input = resolveGeometryListOutput(edge.fromNodeId, edge.fromPortId, project, new Set<string>(), timeSeconds)
      for (const item of input) ids.add(item.id)
    }
  }

  return ids
}

interface Point { x: number; y: number }
interface Box { x: number; y: number; width: number; height: number }

function pointOnCurveObject(curve: GeometryObject, distance: number): Point {
  if (curve.type === 'circle') return pointOnCircle(curve, distance)
  if (curve.type === 'way') return pointOnWay(curve, distance)
  return pointOnPath((curve.params.svgPath as string) ?? '', distance)
}

function pointOnWay(way: GeometryObject, distance: number): Point {
  const ax = (way.params.ax as number) ?? 0
  const ay = (way.params.ay as number) ?? 0
  const bx = (way.params.bx as number) ?? 0
  const by = (way.params.by as number) ?? 0
  return pointOnPolyline([{ x: ax, y: ay }, { x: bx, y: by }], distance)
}

function pointOnCircle(circle: GeometryObject, distance: number): Point {
  const cx = (circle.params.cx as number) ?? 0
  const cy = (circle.params.cy as number) ?? 0
  const r = (circle.params.r as number) ?? 0
  const rx = (circle.params.rx as number) ?? r
  const ry = (circle.params.ry as number) ?? r
  if (rx <= 0 || ry <= 0) return { x: cx, y: cy }

  const samples = Array.from({ length: 129 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 128
    return {
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
    }
  })
  return pointOnPolyline(samples, distance)
}

function geometryArea(geom: GeometryObject): number {
  if (geom.type === 'circle') {
    const r = (geom.params.r as number) ?? 0
    const rx = (geom.params.rx as number) ?? r
    const ry = (geom.params.ry as number) ?? r
    return Math.PI * rx * ry
  }
  if (geom.type === 'path') {
    const points = samplePath((geom.params.svgPath as string) ?? '')
    if (points.length < 3) return 0
    let sum = 0
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      sum += a.x * b.y - b.x * a.y
    }
    return Math.abs(sum) / 2
  }
  return 0
}

function curveLength(geom: GeometryObject): number {
  if (geom.type === 'circle') {
    const r = (geom.params.r as number) ?? 0
    const rx = (geom.params.rx as number) ?? r
    const ry = (geom.params.ry as number) ?? r
    return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
  }
  if (geom.type === 'way') {
    const ax = (geom.params.ax as number) ?? 0
    const ay = (geom.params.ay as number) ?? 0
    const bx = (geom.params.bx as number) ?? 0
    const by = (geom.params.by as number) ?? 0
    return Math.hypot(bx - ax, by - ay)
  }
  const points = samplePath((geom.params.svgPath as string) ?? '')
  return points.slice(1).reduce((sum, point, index) => {
    const prev = points[index]
    return sum + Math.hypot(point.x - prev.x, point.y - prev.y)
  }, 0)
}

function pointOnPath(svgPath: string, distance: number): Point {
  const points = samplePath(svgPath)
  return pointOnPolyline(points, distance)
}

function pointOnPolyline(points: Point[], distance: number): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]

  const segments = points.slice(1).map((p, i) => {
    const prev = points[i]
    const length = Math.hypot(p.x - prev.x, p.y - prev.y)
    return { from: prev, to: p, length }
  })
  const total = segments.reduce((sum, seg) => sum + seg.length, 0)
  if (total <= 0) return points[0]

  let d = distance % total
  if (d < 0) d += total
  for (const seg of segments) {
    if (d > seg.length) {
      d -= seg.length
      continue
    }
    const t = seg.length === 0 ? 0 : d / seg.length
    return {
      x: seg.from.x + (seg.to.x - seg.from.x) * t,
      y: seg.from.y + (seg.to.y - seg.from.y) * t,
    }
  }
  return points[points.length - 1]
}

function samplePath(svgPath: string): Point[] {
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
    const size = (obj.params.size as number) ?? 5
    return { x: x - size, y: y - size, width: size * 2, height: size * 2 }
  }
  if (obj.type === 'way') {
    const ax = (obj.params.ax as number) ?? 0
    const ay = (obj.params.ay as number) ?? 0
    const bx = (obj.params.bx as number) ?? 0
    const by = (obj.params.by as number) ?? 0
    return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) }
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

function boxesIntersect(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y
}
