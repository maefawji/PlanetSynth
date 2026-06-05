// Sigil generator: topology-first skeletons with attachable motif slots.
// Variation should come from structure topology, not full-symbol repetition.

export type StructuralType =
  | 'single-axis' | 'dual-axis' | 'ring-core' | 'enclosed-frame'
  | 'branching-trunk' | 'radial-hub' | 'orbital-track' | 'wave-band'
  | 'loop-knot' | 'stack-totem' | 'grid-trace' | 'fragment-relic'
  | 'cross-axis' | 'arch-gate' | 'chevron-mark' | 'ladder-stem'
  | 'broken-ring' | 'vessel-cup' | 'terminal-row'

export type CoreMotif =
  | 'axis' | 'ring' | 'triangle' | 'loop' | 'wave'
  | 'branch' | 'hook' | 'eye' | 'shield' | 'knot'

export type TerminalMotif =
  | 'none' | 'dot' | 'bar' | 'hook' | 'fork' | 'trident'
  | 'asterisk' | 'star-trident' | 'fan-trident'
  | 'ball' | 'cut' | 'cap' | 'curl' | 'split'

export type InteriorMotif =
  | 'dot' | 'small-ring' | 'cross' | 'slash' | 'pupil' | 'seed'
  | 'star' | 'small-triangle' | 'hole' | 'vertical-mark' | 'horizontal-mark' | 'offset-dot'

export type StructureSlot =
  | 'top' | 'upper-left' | 'upper-right' | 'center' | 'left' | 'right'
  | 'lower-left' | 'lower-right' | 'bottom' | 'interior' | 'orbit' | 'terminal'
  | 'branch-tip' | 'node'

export type TopologyProfile = {
  axes: 0 | 1 | 2
  closedLoops: 0 | 1 | 2
  branches: 0 | 1 | 2 | 3
  crossings: 0 | 1 | 2
  radialArms: 0 | 2 | 3 | 4 | 6 | 8
  stackLevels: 1 | 2 | 3
  enclosure: boolean
  symmetry: 'none' | 'vertical' | 'horizontal' | 'radial' | 'partial'
}

export type StructureOperator =
  | 'none' | 'split' | 'enclose' | 'offset' | 'stretch' | 'crop' | 'bridge'
  | 'invert' | 'flip-horizontal' | 'flip-vertical'
  | 'orbitize' | 'radialize' | 'hollow' | 'stackify' | 'break-symmetry'

export type StructureCompositionMode =
  | 'none' | 'embed' | 'replace' | 'fuse' | 'wrap' | 'interrupt'

export type StructureDefinition = {
  id: StructuralType
  topology: TopologyProfile
  slots: StructureSlot[]
  defaultSymmetry: TopologyProfile['symmetry']
  complexityRisk: 1 | 2 | 3
}

export type SigilComplexity = 1 | 2 | 3
export type SigilStrokeWeight = 'thin' | 'normal' | 'bold'
export type SigilRole = 'primary' | 'secondary' | 'accent' | 'structure'
export type SigilRenderMode = 'stroke' | 'fill' | 'stroke-fill'

export const STRUCTURES: StructuralType[] = [
  'single-axis', 'dual-axis', 'ring-core', 'enclosed-frame',
  'branching-trunk', 'radial-hub', 'orbital-track', 'wave-band',
  'loop-knot', 'stack-totem', 'grid-trace', 'fragment-relic',
  'cross-axis', 'arch-gate', 'chevron-mark', 'ladder-stem',
  'broken-ring', 'vessel-cup', 'terminal-row',
]

export const CORE_MOTIFS: CoreMotif[] = [
  'axis', 'ring', 'triangle', 'loop', 'wave',
  'branch', 'hook', 'eye', 'shield', 'knot',
]

export const TERMINAL_MOTIFS: TerminalMotif[] = [
  'none', 'dot', 'bar', 'hook', 'fork', 'trident',
  'asterisk', 'star-trident', 'fan-trident',
  'ball', 'cut', 'cap', 'curl', 'split',
]

export const INTERIOR_MOTIFS: InteriorMotif[] = [
  'dot', 'small-ring', 'cross', 'slash', 'pupil', 'seed',
  'star', 'small-triangle', 'hole', 'vertical-mark', 'horizontal-mark', 'offset-dot',
]

export const STRUCTURE_OPERATORS: StructureOperator[] = [
  'none', 'split', 'enclose', 'offset', 'stretch', 'crop', 'bridge',
  'invert', 'flip-horizontal', 'flip-vertical',
  'orbitize', 'radialize', 'hollow', 'stackify', 'break-symmetry',
]

export const COMPOSITION_MODES: StructureCompositionMode[] = [
  'none', 'embed', 'replace', 'fuse', 'wrap', 'interrupt',
]

export const STRUCTURE_DEFINITIONS: Record<StructuralType, StructureDefinition> = {
  'single-axis': {
    id: 'single-axis',
    topology: { axes: 1, closedLoops: 0, branches: 0, crossings: 0, radialArms: 0, stackLevels: 1, enclosure: false, symmetry: 'vertical' },
    slots: ['top', 'center', 'bottom', 'upper-left', 'upper-right', 'terminal'],
    defaultSymmetry: 'vertical',
    complexityRisk: 1,
  },
  'dual-axis': {
    id: 'dual-axis',
    topology: { axes: 2, closedLoops: 0, branches: 0, crossings: 0, radialArms: 0, stackLevels: 1, enclosure: false, symmetry: 'vertical' },
    slots: ['top', 'center', 'bottom', 'left', 'right', 'terminal'],
    defaultSymmetry: 'vertical',
    complexityRisk: 2,
  },
  'ring-core': {
    id: 'ring-core',
    topology: { axes: 0, closedLoops: 1, branches: 0, crossings: 0, radialArms: 0, stackLevels: 1, enclosure: false, symmetry: 'vertical' },
    slots: ['top', 'bottom', 'left', 'right', 'interior', 'center'],
    defaultSymmetry: 'vertical',
    complexityRisk: 1,
  },
  'enclosed-frame': {
    id: 'enclosed-frame',
    topology: { axes: 0, closedLoops: 1, branches: 0, crossings: 0, radialArms: 0, stackLevels: 1, enclosure: true, symmetry: 'vertical' },
    slots: ['top', 'bottom', 'left', 'right', 'interior', 'center'],
    defaultSymmetry: 'vertical',
    complexityRisk: 1,
  },
  'branching-trunk': {
    id: 'branching-trunk',
    topology: { axes: 1, closedLoops: 0, branches: 2, crossings: 0, radialArms: 0, stackLevels: 1, enclosure: false, symmetry: 'partial' },
    slots: ['top', 'center', 'bottom', 'branch-tip', 'upper-left', 'upper-right', 'terminal'],
    defaultSymmetry: 'partial',
    complexityRisk: 2,
  },
  'radial-hub': {
    id: 'radial-hub',
    topology: { axes: 0, closedLoops: 0, branches: 0, crossings: 1, radialArms: 4, stackLevels: 1, enclosure: false, symmetry: 'radial' },
    slots: ['center', 'top', 'right', 'bottom', 'left', 'terminal'],
    defaultSymmetry: 'radial',
    complexityRisk: 3,
  },
  'orbital-track': {
    id: 'orbital-track',
    topology: { axes: 0, closedLoops: 1, branches: 0, crossings: 1, radialArms: 0, stackLevels: 1, enclosure: false, symmetry: 'partial' },
    slots: ['orbit', 'interior', 'center', 'top', 'bottom', 'terminal'],
    defaultSymmetry: 'partial',
    complexityRisk: 2,
  },
  'wave-band': {
    id: 'wave-band',
    topology: { axes: 0, closedLoops: 0, branches: 0, crossings: 0, radialArms: 0, stackLevels: 2, enclosure: false, symmetry: 'horizontal' },
    slots: ['left', 'center', 'right', 'upper-left', 'lower-right', 'terminal'],
    defaultSymmetry: 'horizontal',
    complexityRisk: 2,
  },
  'loop-knot': {
    id: 'loop-knot',
    topology: { axes: 0, closedLoops: 2, branches: 0, crossings: 1, radialArms: 0, stackLevels: 1, enclosure: false, symmetry: 'partial' },
    slots: ['left', 'right', 'center', 'interior', 'terminal'],
    defaultSymmetry: 'partial',
    complexityRisk: 3,
  },
  'stack-totem': {
    id: 'stack-totem',
    topology: { axes: 1, closedLoops: 0, branches: 0, crossings: 0, radialArms: 0, stackLevels: 3, enclosure: false, symmetry: 'vertical' },
    slots: ['top', 'center', 'bottom', 'interior', 'terminal'],
    defaultSymmetry: 'vertical',
    complexityRisk: 1,
  },
  'grid-trace': {
    id: 'grid-trace',
    topology: { axes: 0, closedLoops: 0, branches: 1, crossings: 1, radialArms: 0, stackLevels: 2, enclosure: false, symmetry: 'none' },
    slots: ['node', 'center', 'upper-left', 'lower-right', 'terminal'],
    defaultSymmetry: 'none',
    complexityRisk: 2,
  },
  'fragment-relic': {
    id: 'fragment-relic',
    topology: { axes: 1, closedLoops: 0, branches: 1, crossings: 0, radialArms: 0, stackLevels: 2, enclosure: false, symmetry: 'none' },
    slots: ['top', 'center', 'bottom', 'left', 'lower-right', 'terminal'],
    defaultSymmetry: 'none',
    complexityRisk: 2,
  },
  'cross-axis': {
    id: 'cross-axis',
    topology: { axes: 2, closedLoops: 0, branches: 0, crossings: 1, radialArms: 4, stackLevels: 1, enclosure: false, symmetry: 'radial' },
    slots: ['top', 'bottom', 'left', 'right', 'center', 'terminal'],
    defaultSymmetry: 'radial',
    complexityRisk: 2,
  },
  'arch-gate': {
    id: 'arch-gate',
    topology: { axes: 2, closedLoops: 0, branches: 0, crossings: 0, radialArms: 0, stackLevels: 1, enclosure: false, symmetry: 'vertical' },
    slots: ['top', 'center', 'bottom', 'left', 'right', 'interior', 'terminal'],
    defaultSymmetry: 'vertical',
    complexityRisk: 1,
  },
  'chevron-mark': {
    id: 'chevron-mark',
    topology: { axes: 0, closedLoops: 0, branches: 1, crossings: 0, radialArms: 2, stackLevels: 2, enclosure: false, symmetry: 'vertical' },
    slots: ['top', 'center', 'bottom', 'upper-left', 'upper-right', 'terminal'],
    defaultSymmetry: 'vertical',
    complexityRisk: 1,
  },
  'ladder-stem': {
    id: 'ladder-stem',
    topology: { axes: 2, closedLoops: 0, branches: 0, crossings: 0, radialArms: 0, stackLevels: 3, enclosure: false, symmetry: 'vertical' },
    slots: ['top', 'center', 'bottom', 'left', 'right', 'terminal'],
    defaultSymmetry: 'vertical',
    complexityRisk: 2,
  },
  'broken-ring': {
    id: 'broken-ring',
    topology: { axes: 0, closedLoops: 1, branches: 0, crossings: 0, radialArms: 0, stackLevels: 1, enclosure: false, symmetry: 'partial' },
    slots: ['top', 'bottom', 'left', 'right', 'interior', 'orbit', 'terminal'],
    defaultSymmetry: 'partial',
    complexityRisk: 1,
  },
  'vessel-cup': {
    id: 'vessel-cup',
    topology: { axes: 1, closedLoops: 0, branches: 2, crossings: 0, radialArms: 0, stackLevels: 2, enclosure: false, symmetry: 'vertical' },
    slots: ['top', 'center', 'bottom', 'left', 'right', 'interior', 'terminal'],
    defaultSymmetry: 'vertical',
    complexityRisk: 1,
  },
  'terminal-row': {
    id: 'terminal-row',
    topology: { axes: 1, closedLoops: 0, branches: 0, crossings: 0, radialArms: 0, stackLevels: 3, enclosure: false, symmetry: 'vertical' },
    slots: ['top', 'center', 'bottom', 'terminal'],
    defaultSymmetry: 'vertical',
    complexityRisk: 1,
  },
}

export type SigilGrammar = {
  seed: number
  structure: StructuralType
  secondaryStructure?: StructuralType
  compositionMode?: StructureCompositionMode
  structureOperator?: StructureOperator
  primaryMotif: CoreMotif
  terminalMotif?: TerminalMotif
  interiorMotif?: InteriorMotif
  complexity: SigilComplexity
  strokeWeight: SigilStrokeWeight
  allowFullRepetition?: boolean
}

export type SigilShape =
  | { kind: 'path'; d: string; renderMode: SigilRenderMode; role: SigilRole; strokeWidth?: number; opacity?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; renderMode: SigilRenderMode; role: SigilRole; strokeWidth?: number; opacity?: number }
  | { kind: 'polygon'; points: { x: number; y: number }[]; renderMode: SigilRenderMode; role: SigilRole; strokeWidth?: number; opacity?: number }

export type SigilLayer = {
  name: string
  family: 'structure' | 'composition' | 'operator' | 'primary' | 'secondary' | 'terminal' | 'interior'
}

export type GeneratedSigil = {
  shapes: SigilShape[]
  grammar: SigilGrammar
  layers: SigilLayer[]
  warnings: string[]
  topology: TopologyProfile
  slots: StructureSlot[]
}

type Pt = { x: number; y: number }
type Anchor = { p: Pt; angle: number }
type Slot = { name: StructureSlot; p: Pt; angle: number; scale: number }
type Draft = { shapes: SigilShape[]; terminals: Anchor[]; interiors: Pt[]; slots: Slot[] }

const CX = 50
const CY = 50
const f = (n: number) => n.toFixed(2)
const fp = (p: Pt) => `${f(p.x)},${f(p.y)}`
const deg = (a: number) => a * Math.PI / 180
const strokeOf = (_w: SigilStrokeWeight) => 1.55

function makePrng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
  }
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]
}

function polar(r: number, a: number, c: Pt = { x: CX, y: CY }): Pt {
  return { x: c.x + r * Math.cos(deg(a)), y: c.y + r * Math.sin(deg(a)) }
}

function line(a: Pt, b: Pt, role: SigilRole, w: number, opacity = 1): SigilShape {
  return { kind: 'path', d: `M ${fp(a)} L ${fp(b)}`, renderMode: 'stroke', role, strokeWidth: w, opacity }
}

function poly(points: Pt[], role: SigilRole, w: number, closed = false, opacity = 1): SigilShape {
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${fp(p)}`).join(' ') + (closed ? ' Z' : '')
  return { kind: 'path', d, renderMode: 'stroke', role, strokeWidth: w, opacity }
}

function curve(points: Pt[], role: SigilRole, w: number, opacity = 1): SigilShape {
  if (points.length < 3) return poly(points, role, w, false, opacity)
  let d = `M ${fp(points[0])}`
  for (let i = 1; i < points.length - 1; i++) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 }
    d += ` Q ${fp(points[i])} ${fp(mid)}`
  }
  d += ` L ${fp(points[points.length - 1])}`
  return { kind: 'path', d, renderMode: 'stroke', role, strokeWidth: w, opacity }
}

function arc(c: Pt, r: number, start: number, end: number, role: SigilRole, w: number, opacity = 1): SigilShape {
  const a = polar(r, start, c)
  const b = polar(r, end, c)
  const diff = Math.abs(end - start) % 360
  return {
    kind: 'path',
    d: `M ${fp(a)} A ${f(r)},${f(r)} 0 ${diff > 180 ? 1 : 0},1 ${fp(b)}`,
    renderMode: 'stroke',
    role,
    strokeWidth: w,
    opacity,
  }
}

function circle(c: Pt, r: number, role: SigilRole, w: number, mode: SigilRenderMode = 'stroke', opacity = 1): SigilShape {
  return { kind: 'circle', cx: c.x, cy: c.y, r, renderMode: mode, role, strokeWidth: mode === 'fill' ? 0 : w, opacity }
}

function filledPolygon(points: Pt[], role: SigilRole, opacity = 1): SigilShape {
  return { kind: 'polygon', points, renderMode: 'fill', role, opacity }
}

function tangentArc(p: Pt, tangentAngle: number, radius: number, sweep: number, role: SigilRole, w: number): SigilShape {
  const center = polar(radius, tangentAngle + 90, p)
  return arc(center, radius, tangentAngle - 90, tangentAngle - 90 + sweep, role, w)
}

function terminalRay(p: Pt, tangentAngle: number, length: number, role: SigilRole, w: number): SigilShape {
  return line(p, polar(length, tangentAngle, p), role, w)
}

function flipPoint(p: Pt, axis: 'horizontal' | 'vertical'): Pt {
  return axis === 'horizontal' ? { x: 100 - p.x, y: p.y } : { x: p.x, y: 100 - p.y }
}

function flipAngle(angle: number, axis: 'horizontal' | 'vertical'): number {
  return axis === 'horizontal' ? 180 - angle : -angle
}

function transformPathD(d: string, axis: 'horizontal' | 'vertical'): string {
  const arcMatch = d.match(/^M ([^ ]+) A ([^ ]+) 0 ([^ ]+) ([^ ]+)$/)
  if (arcMatch) {
    const start = parsePair(arcMatch[1])
    const end = parsePair(arcMatch[4])
    if (start && end) return `M ${fp(flipPoint(start, axis))} A ${arcMatch[2]} 0 ${arcMatch[3]} ${fp(flipPoint(end, axis))}`
  }
  return d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_m, x: string, y: string) => fp(flipPoint({ x: Number(x), y: Number(y) }, axis)))
}

function parsePair(pair: string): Pt | null {
  const [x, y] = pair.split(',').map(Number)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

function flipShape(s: SigilShape, axis: 'horizontal' | 'vertical'): SigilShape {
  if (s.kind === 'circle') {
    const p = flipPoint({ x: s.cx, y: s.cy }, axis)
    return { ...s, cx: p.x, cy: p.y }
  }
  if (s.kind === 'polygon') return { ...s, points: s.points.map(p => flipPoint(p, axis)).reverse() }
  return { ...s, d: transformPathD(s.d, axis) }
}

function flipDraft(d: Draft, axis: 'horizontal' | 'vertical'): void {
  d.shapes = d.shapes.map(s => flipShape(s, axis))
  d.terminals = d.terminals.map(t => ({ p: flipPoint(t.p, axis), angle: flipAngle(t.angle, axis) }))
  d.interiors = d.interiors.map(p => flipPoint(p, axis))
  d.slots = d.slots.map(s => ({ ...s, p: flipPoint(s.p, axis), angle: flipAngle(s.angle, axis) }))
}

function slot(name: StructureSlot, x: number, y: number, angle = 0, scale = 1): Slot {
  return { name, p: { x, y }, angle, scale }
}

function addTerminal(d: Draft, p: Pt, angle: number) {
  d.terminals.push({ p, angle })
  d.slots.push({ name: 'terminal', p, angle, scale: 0.72 })
}

function structureDraft(structure: StructuralType, rng: () => number, w: number): Draft {
  const d: Draft = { shapes: [], terminals: [], interiors: [{ x: CX, y: CY }], slots: [] }
  d.slots.push(slot('center', CX, CY, -90, 0.72))

  switch (structure) {
    case 'single-axis':
      d.shapes.push(line({ x: 50, y: 18 }, { x: 50, y: 82 }, 'structure', w))
      d.slots.push(slot('top', 50, 20, -90, 0.52), slot('bottom', 50, 80, 90, 0.52), slot('upper-left', 36, 38, 180, 0.42), slot('upper-right', 64, 38, 0, 0.42))
      addTerminal(d, { x: 50, y: 18 }, -90); addTerminal(d, { x: 50, y: 82 }, 90)
      break
    case 'dual-axis':
      d.shapes.push(line({ x: 38, y: 20 }, { x: 38, y: 80 }, 'structure', w), line({ x: 62, y: 20 }, { x: 62, y: 80 }, 'structure', w), line({ x: 38, y: 50 }, { x: 62, y: 50 }, 'structure', w * 0.85))
      d.slots.push(slot('left', 38, 50, 180, 0.45), slot('right', 62, 50, 0, 0.45), slot('top', 50, 22, -90, 0.46), slot('bottom', 50, 78, 90, 0.46))
      addTerminal(d, { x: 38, y: 20 }, -90); addTerminal(d, { x: 62, y: 80 }, 90)
      break
    case 'ring-core':
      d.shapes.push(circle({ x: CX, y: CY }, 25, 'structure', w))
      d.slots.push(slot('interior', 50, 50, -90, 0.48), slot('top', 50, 25, -90, 0.42), slot('bottom', 50, 75, 90, 0.42), slot('left', 25, 50, 180, 0.42), slot('right', 75, 50, 0, 0.42))
      addTerminal(d, { x: 50, y: 25 }, -90); addTerminal(d, { x: 75, y: 50 }, 0)
      break
    case 'enclosed-frame':
      d.shapes.push(curve([{ x: 50, y: 15 }, { x: 78, y: 25 }, { x: 78, y: 66 }, { x: 50, y: 86 }, { x: 22, y: 66 }, { x: 22, y: 25 }, { x: 50, y: 15 }], 'structure', w))
      d.slots.push(slot('interior', 50, 51, -90, 0.52), slot('top', 50, 21, -90, 0.38), slot('bottom', 50, 79, 90, 0.38), slot('left', 25, 50, 180, 0.36), slot('right', 75, 50, 0, 0.36))
      addTerminal(d, { x: 50, y: 15 }, -90); addTerminal(d, { x: 50, y: 86 }, 90)
      break
    case 'branching-trunk':
      d.shapes.push(line({ x: 46, y: 20 }, { x: 46, y: 82 }, 'structure', w), line({ x: 46, y: 40 }, { x: 68, y: 25 }, 'structure', w * 0.86), line({ x: 46, y: 57 }, { x: 70, y: 70 }, 'structure', w * 0.86))
      d.slots.push(slot('center', 46, 51, -90, 0.48), slot('branch-tip', 68, 25, -35, 0.38), slot('branch-tip', 70, 70, 35, 0.38), slot('bottom', 46, 82, 90, 0.44))
      addTerminal(d, { x: 46, y: 20 }, -90); addTerminal(d, { x: 68, y: 25 }, -35); addTerminal(d, { x: 70, y: 70 }, 35)
      break
    case 'radial-hub':
      for (const a of [-90, 0, 90, 180]) {
        d.shapes.push(line({ x: CX, y: CY }, polar(32, a), 'structure', w * 0.9))
        addTerminal(d, polar(32, a), a)
      }
      d.shapes.push(circle({ x: CX, y: CY }, 4.5, 'structure', w * 0.75))
      d.slots.push(slot('top', 50, 22, -90, 0.36), slot('right', 78, 50, 0, 0.36), slot('bottom', 50, 78, 90, 0.36), slot('left', 22, 50, 180, 0.36))
      break
    case 'orbital-track':
      d.shapes.push(arc({ x: CX, y: CY }, 31, 200, 525, 'structure', w), line({ x: 31, y: 67 }, { x: 70, y: 31 }, 'structure', w * 0.7, 0.78))
      d.slots.push(slot('orbit', 72, 32, -20, 0.42), slot('interior', 50, 50, -90, 0.48), slot('top', 50, 22, -90, 0.38), slot('bottom', 50, 78, 90, 0.38))
      addTerminal(d, { x: 22, y: 61 }, 160); addTerminal(d, { x: 73, y: 33 }, -20)
      break
    case 'wave-band':
      d.shapes.push(curve([{ x: 16, y: 44 }, { x: 31, y: 31 }, { x: 50, y: 44 }, { x: 69, y: 57 }, { x: 84, y: 44 }], 'structure', w), curve([{ x: 18, y: 58 }, { x: 33, y: 47 }, { x: 50, y: 58 }, { x: 67, y: 69 }, { x: 82, y: 58 }], 'structure', w * 0.82, 0.82))
      d.slots.push(slot('left', 18, 51, 180, 0.38), slot('center', 50, 51, -90, 0.44), slot('right', 82, 51, 0, 0.38), slot('upper-left', 33, 38, -120, 0.34), slot('lower-right', 67, 63, 45, 0.34))
      addTerminal(d, { x: 16, y: 44 }, 180); addTerminal(d, { x: 84, y: 44 }, 0)
      break
    case 'loop-knot':
      d.shapes.push(arc({ x: 40, y: 50 }, 15, -70, 285, 'structure', w), arc({ x: 60, y: 50 }, 15, -250, 105, 'structure', w))
      d.slots.push(slot('left', 39, 50, 180, 0.4), slot('right', 61, 50, 0, 0.4), slot('interior', 50, 50, -90, 0.42))
      addTerminal(d, { x: 30, y: 40 }, -135); addTerminal(d, { x: 70, y: 60 }, 45)
      break
    case 'stack-totem':
      d.shapes.push(line({ x: 50, y: 17 }, { x: 50, y: 84 }, 'structure', w), line({ x: 35, y: 31 }, { x: 65, y: 31 }, 'structure', w * 0.78), line({ x: 38, y: 53 }, { x: 62, y: 53 }, 'structure', w * 0.78), line({ x: 41, y: 74 }, { x: 59, y: 74 }, 'structure', w * 0.78))
      d.slots.push(slot('top', 50, 27, -90, 0.38), slot('center', 50, 52, -90, 0.44), slot('bottom', 50, 76, 90, 0.38), slot('interior', 50, 52, -90, 0.42))
      addTerminal(d, { x: 50, y: 17 }, -90); addTerminal(d, { x: 50, y: 84 }, 90)
      break
    case 'grid-trace': {
      const pts = [{ x: 26, y: 28 }, { x: 60, y: 28 }, { x: 42, y: 52 }, { x: 72, y: 72 }]
      d.shapes.push(poly(pts, 'structure', w))
      pts.forEach((p, i) => {
        d.slots.push(slot('node', p.x, p.y, i === 0 ? 180 : 0, 0.34))
        addTerminal(d, p, i === 0 ? 180 : 0)
      })
      d.interiors.push({ x: 42, y: 52 })
      break
    }
    case 'fragment-relic':
      d.shapes.push(line({ x: 31, y: 24 }, { x: 58, y: 24 }, 'structure', w), line({ x: 44, y: 39 }, { x: 70, y: 65 }, 'structure', w), line({ x: 27, y: 77 }, { x: 55, y: 77 }, 'structure', w * 0.82))
      d.slots.push(slot('top', 48, 24, -90, 0.38), slot('center', 56, 52, 45, 0.44), slot('left', 31, 77, 180, 0.36), slot('lower-right', 70, 65, 45, 0.36))
      addTerminal(d, { x: 58, y: 24 }, 0); addTerminal(d, { x: 70, y: 65 }, 45); addTerminal(d, { x: 27, y: 77 }, 180)
      break
    case 'cross-axis':
      d.shapes.push(line({ x: 50, y: 20 }, { x: 50, y: 80 }, 'structure', w), line({ x: 23, y: 50 }, { x: 77, y: 50 }, 'structure', w))
      d.slots.push(slot('top', 50, 22, -90, 0.36), slot('right', 76, 50, 0, 0.36), slot('bottom', 50, 78, 90, 0.36), slot('left', 24, 50, 180, 0.36), slot('center', 50, 50, -90, 0.44))
      addTerminal(d, { x: 50, y: 20 }, -90); addTerminal(d, { x: 77, y: 50 }, 0); addTerminal(d, { x: 50, y: 80 }, 90); addTerminal(d, { x: 23, y: 50 }, 180)
      break
    case 'arch-gate':
      d.shapes.push(line({ x: 32, y: 82 }, { x: 32, y: 45 }, 'structure', w), line({ x: 68, y: 82 }, { x: 68, y: 45 }, 'structure', w), arc({ x: 50, y: 45 }, 18, 180, 360, 'structure', w))
      d.slots.push(slot('top', 50, 27, -90, 0.38), slot('interior', 50, 58, -90, 0.46), slot('left', 32, 59, 180, 0.34), slot('right', 68, 59, 0, 0.34), slot('bottom', 50, 82, 90, 0.38))
      addTerminal(d, { x: 32, y: 82 }, 90); addTerminal(d, { x: 68, y: 82 }, 90); addTerminal(d, { x: 50, y: 27 }, -90)
      break
    case 'chevron-mark':
      d.shapes.push(poly([{ x: 28, y: 35 }, { x: 50, y: 58 }, { x: 72, y: 35 }], 'structure', w), poly([{ x: 34, y: 60 }, { x: 50, y: 76 }, { x: 66, y: 60 }], 'structure', w * 0.82))
      d.slots.push(slot('top', 50, 58, -90, 0.4), slot('upper-left', 28, 35, -135, 0.34), slot('upper-right', 72, 35, -45, 0.34), slot('bottom', 50, 76, 90, 0.34), slot('center', 50, 58, -90, 0.42))
      addTerminal(d, { x: 28, y: 35 }, -135); addTerminal(d, { x: 72, y: 35 }, -45); addTerminal(d, { x: 50, y: 76 }, 90)
      break
    case 'ladder-stem':
      d.shapes.push(line({ x: 38, y: 20 }, { x: 38, y: 82 }, 'structure', w), line({ x: 62, y: 20 }, { x: 62, y: 82 }, 'structure', w))
      for (const y of [32, 50, 68]) d.shapes.push(line({ x: 38, y }, { x: 62, y }, 'structure', w * 0.76))
      d.slots.push(slot('top', 50, 22, -90, 0.36), slot('center', 50, 50, -90, 0.42), slot('bottom', 50, 80, 90, 0.36), slot('left', 38, 50, 180, 0.34), slot('right', 62, 50, 0, 0.34))
      addTerminal(d, { x: 38, y: 20 }, -90); addTerminal(d, { x: 62, y: 20 }, -90); addTerminal(d, { x: 38, y: 82 }, 90); addTerminal(d, { x: 62, y: 82 }, 90)
      break
    case 'broken-ring':
      d.shapes.push(arc({ x: CX, y: CY }, 28, -35, 132, 'structure', w), arc({ x: CX, y: CY }, 28, 166, 318, 'structure', w))
      d.slots.push(slot('interior', 50, 50, -90, 0.48), slot('orbit', 72, 34, -35, 0.36), slot('top', 50, 22, -90, 0.34), slot('left', 24, 50, 180, 0.34), slot('right', 76, 50, 0, 0.34))
      addTerminal(d, polar(28, -35), -35); addTerminal(d, polar(28, 132), 132); addTerminal(d, polar(28, 166), 166); addTerminal(d, polar(28, 318), 318)
      break
    case 'vessel-cup':
      d.shapes.push(curve([{ x: 28, y: 38 }, { x: 33, y: 76 }, { x: 50, y: 82 }, { x: 67, y: 76 }, { x: 72, y: 38 }], 'structure', w), line({ x: 34, y: 38 }, { x: 66, y: 38 }, 'structure', w * 0.72))
      d.slots.push(slot('top', 50, 38, -90, 0.36), slot('interior', 50, 61, -90, 0.46), slot('left', 30, 46, 180, 0.34), slot('right', 70, 46, 0, 0.34), slot('bottom', 50, 82, 90, 0.36))
      addTerminal(d, { x: 28, y: 38 }, -150); addTerminal(d, { x: 72, y: 38 }, -30); addTerminal(d, { x: 50, y: 82 }, 90)
      break
    case 'terminal-row':
      for (const y of [24, 50, 76]) addTerminal(d, { x: 50, y }, y < 50 ? -90 : y > 50 ? 90 : 0)
      d.slots.push(slot('top', 50, 24, -90, 0.34), slot('center', 50, 50, 0, 0.38), slot('bottom', 50, 76, 90, 0.34))
      d.interiors.push({ x: 50, y: 50 })
      break
  }

  if (rng() > 0.62) d.interiors.push({ x: 50 + (rng() - 0.5) * 16, y: 50 + (rng() - 0.5) * 16 })
  return d
}

function operateStructure(d: Draft, op: StructureOperator, w: number, rng: () => number): void {
  if (op === 'none') return
  if (op === 'split') {
    d.shapes.push(line({ x: 50, y: 58 }, { x: 36, y: 80 }, 'structure', w * 0.72), line({ x: 50, y: 58 }, { x: 64, y: 80 }, 'structure', w * 0.72))
    addTerminal(d, { x: 36, y: 80 }, 125); addTerminal(d, { x: 64, y: 80 }, 55)
  } else if (op === 'enclose') {
    d.shapes.push(circle({ x: CX, y: CY }, 39, 'structure', w * 0.55, 'stroke', 0.58))
    d.slots.push(slot('interior', 50, 50, -90, 0.5))
  } else if (op === 'offset' || op === 'break-symmetry') {
    const side = rng() > 0.5 ? 1 : -1
    d.shapes.push(line({ x: 50, y: 42 }, { x: 50 + side * 18, y: 36 }, 'structure', w * 0.65, 0.86))
    d.slots.push(slot(side > 0 ? 'upper-right' : 'upper-left', 50 + side * 18, 36, side > 0 ? 0 : 180, 0.34))
  } else if (op === 'stretch') {
    d.shapes.push(line({ x: 50, y: 12 }, { x: 50, y: 18 }, 'structure', w * 0.6), line({ x: 50, y: 82 }, { x: 50, y: 88 }, 'structure', w * 0.6))
  } else if (op === 'crop') {
    d.shapes.push(line({ x: 34, y: 20 }, { x: 46, y: 20 }, 'structure', w * 0.7, 0.62), line({ x: 58, y: 80 }, { x: 70, y: 80 }, 'structure', w * 0.7, 0.62))
  } else if (op === 'bridge') {
    const a = d.slots.find(s => s.name === 'left' || s.name === 'upper-left')?.p
    const b = d.slots.find(s => s.name === 'right' || s.name === 'upper-right')?.p
    if (a && b) d.shapes.push(line(a, b, 'structure', w * 0.62, 0.76))
  } else if (op === 'invert') {
    d.shapes.push(line({ x: 38, y: 70 }, { x: 62, y: 70 }, 'structure', w * 1.05, 0.88))
  } else if (op === 'flip-horizontal') {
    flipDraft(d, 'horizontal')
  } else if (op === 'flip-vertical') {
    flipDraft(d, 'vertical')
  } else if (op === 'orbitize') {
    d.shapes.push(arc({ x: CX, y: CY }, 34, 210, 505, 'structure', w * 0.55, 0.66))
    d.slots.push(slot('orbit', 72, 34, -25, 0.34))
  } else if (op === 'radialize') {
    for (const a of [-60, 60]) d.shapes.push(line({ x: CX, y: CY }, polar(24, a), 'structure', w * 0.58, 0.74))
  } else if (op === 'hollow') {
    d.shapes.push(circle({ x: CX, y: CY }, 7, 'accent', w * 0.58, 'stroke', 0.9))
  } else if (op === 'stackify') {
    d.shapes.push(line({ x: 38, y: 34 }, { x: 62, y: 34 }, 'structure', w * 0.62), line({ x: 40, y: 66 }, { x: 60, y: 66 }, 'structure', w * 0.62))
    d.slots.push(slot('top', 50, 34, -90, 0.34), slot('bottom', 50, 66, 90, 0.34))
  }
}

function composeStructure(d: Draft, secondary: StructuralType | undefined, mode: StructureCompositionMode | undefined, w: number): void {
  if (!secondary || !mode || mode === 'none') return
  if (mode === 'wrap') {
    d.shapes.push(circle({ x: CX, y: CY }, 41, 'structure', w * 0.48, 'stroke', 0.52))
  } else if (mode === 'embed' || mode === 'interrupt') {
    d.shapes.push(circle({ x: CX, y: CY }, 11, 'structure', w * 0.62, 'stroke', 0.74))
    d.slots.push(slot('interior', 50, 50, -90, 0.34))
  } else if (mode === 'fuse') {
    d.shapes.push(line({ x: 36, y: 64 }, { x: 64, y: 36 }, 'structure', w * 0.58, 0.72))
  } else if (mode === 'replace') {
    d.shapes.push(arc({ x: CX, y: CY }, 18, 205, 515, 'structure', w * 0.62, 0.74))
  }
  const def = STRUCTURE_DEFINITIONS[secondary]
  if (def.topology.enclosure) d.shapes.push(circle({ x: CX, y: CY }, 31, 'structure', w * 0.42, 'stroke', 0.46))
}

function pickSlotFor(d: Draft, preferred: StructureSlot[], rng: () => number): Slot {
  const available = d.slots.filter(s => preferred.includes(s.name))
  return available.length ? pick(available, rng) : pick(d.slots, rng)
}

function coreMotif(motif: CoreMotif, role: SigilRole, w: number, slotDef: Slot): SigilShape[] {
  const c = slotDef.p
  const scale = slotDef.scale
  const sw = role === 'secondary' ? w * 0.8 : w
  const op = role === 'secondary' ? 0.86 : 1
  switch (motif) {
    case 'axis': return [line({ x: c.x, y: c.y - 21 * scale }, { x: c.x, y: c.y + 21 * scale }, role, sw, op)]
    case 'ring': return [circle(c, 18 * scale, role, sw, 'stroke', op)]
    case 'triangle': return [poly([polar(18 * scale, -90, c), polar(18 * scale, 30, c), polar(18 * scale, 150, c)], role, sw, true, op)]
    case 'loop': return [arc({ x: c.x - 8 * scale, y: c.y }, 12 * scale, -65, 285, role, sw, op), arc({ x: c.x + 8 * scale, y: c.y }, 12 * scale, -245, 105, role, sw, op)]
    case 'wave': return [curve([{ x: c.x - 22 * scale, y: c.y }, { x: c.x - 9 * scale, y: c.y - 12 * scale }, { x: c.x + 6 * scale, y: c.y + 10 * scale }, { x: c.x + 22 * scale, y: c.y }], role, sw, op)]
    case 'branch': return [line({ x: c.x, y: c.y + 18 * scale }, { x: c.x, y: c.y - 18 * scale }, role, sw, op), line(c, { x: c.x + 15 * scale, y: c.y - 9 * scale }, role, sw * 0.75, op)]
    case 'hook': return [arc({ x: c.x + 3 * scale, y: c.y - 4 * scale }, 16 * scale, 88, 260, role, sw, op)]
    case 'eye': return [arc(c, 18 * scale, 200, 340, role, sw, op), arc(c, 18 * scale, 20, 160, role, sw, op)]
    case 'shield': return [curve([{ x: c.x - 15 * scale, y: c.y - 14 * scale }, { x: c.x - 17 * scale, y: c.y + 9 * scale }, { x: c.x, y: c.y + 21 * scale }, { x: c.x + 17 * scale, y: c.y + 9 * scale }, { x: c.x + 15 * scale, y: c.y - 14 * scale }], role, sw, op)]
    case 'knot': return [poly([{ x: c.x - 18 * scale, y: c.y }, { x: c.x, y: c.y - 16 * scale }, { x: c.x + 18 * scale, y: c.y }, { x: c.x, y: c.y + 16 * scale }, { x: c.x - 18 * scale, y: c.y }], role, sw, false, op)]
  }
}

function addTerminalMotif(shapes: SigilShape[], terminals: Anchor[], motif: TerminalMotif, w: number): void {
  if (motif === 'none') return
  for (const { p, angle } of terminals.slice(0, 3)) {
    const tip = polar(7, angle, p)
    const left = polar(5, angle + 145, p)
    const right = polar(5, angle - 145, p)
    if (motif === 'dot') shapes.push(circle(p, 3.25, 'accent', w, 'fill'))
    else if (motif === 'ball') shapes.push(circle(p, 3.4, 'accent', w, 'stroke'))
    else if (motif === 'bar') shapes.push(line(polar(4, angle + 90, p), polar(4, angle - 90, p), 'accent', w * 0.78))
    else if (motif === 'cap') shapes.push(line(polar(6, angle + 90, p), polar(6, angle - 90, p), 'accent', w * 1.25))
    else if (motif === 'cut') shapes.push(line(polar(5, angle + 45, p), polar(5, angle - 135, p), 'accent', w * 0.75, 0.78))
    else if (motif === 'fork' || motif === 'split') {
      shapes.push(terminalRay(p, angle + 28, 8, 'accent', w * 0.7))
      shapes.push(terminalRay(p, angle - 28, 8, 'accent', w * 0.7))
    } else if (motif === 'trident') {
      shapes.push(terminalRay(p, angle, 7, 'accent', w * 0.7), terminalRay(p, angle + 35, 7, 'accent', w * 0.7), terminalRay(p, angle - 35, 7, 'accent', w * 0.7))
    } else if (motif === 'asterisk') {
      shapes.push(terminalRay(p, angle, 6, 'accent', w * 0.58))
      for (const a of [60, -60]) shapes.push(line(polar(3.8, angle + a, p), polar(3.8, angle + a + 180, p), 'accent', w * 0.58))
    } else if (motif === 'star-trident') {
      shapes.push(terminalRay(p, angle, 7, 'accent', w * 0.66), terminalRay(p, angle + 42, 7, 'accent', w * 0.66), terminalRay(p, angle - 42, 7, 'accent', w * 0.66))
      shapes.push(line(polar(3.8, angle + 90, p), polar(3.8, angle - 90, p), 'accent', w * 0.55))
    } else if (motif === 'fan-trident') {
      const fanCenter = polar(6, angle, p)
      shapes.push(arc(fanCenter, 5.5, angle - 72, angle + 72, 'accent', w * 0.58))
      shapes.push(terminalRay(p, angle, 8, 'accent', w * 0.62), terminalRay(p, angle + 48, 7, 'accent', w * 0.62), terminalRay(p, angle - 48, 7, 'accent', w * 0.62))
    } else if (motif === 'hook' || motif === 'curl') {
      shapes.push(tangentArc(p, angle, motif === 'curl' ? 5.8 : 5, motif === 'curl' ? 235 : 170, 'accent', w * 0.7))
    }
  }
}

function addInteriorMotif(shapes: SigilShape[], points: Pt[], motif: InteriorMotif, w: number): void {
  const p = points[0] ?? { x: CX, y: CY }
  if (motif === 'dot' || motif === 'pupil' || motif === 'seed' || motif === 'offset-dot') {
    const c = motif === 'offset-dot' ? { x: p.x + 7, y: p.y - 5 } : p
    shapes.push(circle(c, motif === 'pupil' ? 3.0 : 2.3, 'accent', w, 'fill'))
  } else if (motif === 'small-ring' || motif === 'hole') shapes.push(circle(p, 5.0, 'accent', w * 0.75, 'stroke'))
  else if (motif === 'cross') shapes.push(line({ x: p.x - 5, y: p.y }, { x: p.x + 5, y: p.y }, 'accent', w * 0.65), line({ x: p.x, y: p.y - 5 }, { x: p.x, y: p.y + 5 }, 'accent', w * 0.65))
  else if (motif === 'slash') shapes.push(line({ x: p.x - 6, y: p.y + 6 }, { x: p.x + 6, y: p.y - 6 }, 'accent', w * 0.75))
  else if (motif === 'star') shapes.push(line({ x: p.x - 5, y: p.y }, { x: p.x + 5, y: p.y }, 'accent', w * 0.55), line({ x: p.x, y: p.y - 5 }, { x: p.x, y: p.y + 5 }, 'accent', w * 0.55), line({ x: p.x - 4, y: p.y - 4 }, { x: p.x + 4, y: p.y + 4 }, 'accent', w * 0.55))
  else if (motif === 'small-triangle') shapes.push(poly([polar(5, -90, p), polar(5, 30, p), polar(5, 150, p)], 'accent', w * 0.62, true))
  else if (motif === 'vertical-mark') shapes.push(line({ x: p.x, y: p.y - 7 }, { x: p.x, y: p.y + 7 }, 'accent', w * 0.7))
  else if (motif === 'horizontal-mark') shapes.push(line({ x: p.x - 7, y: p.y }, { x: p.x + 7, y: p.y }, 'accent', w * 0.7))
}

function legibilityWarnings(shapes: SigilShape[], grammar: SigilGrammar, topology: TopologyProfile): string[] {
  const warnings: string[] = []
  if (shapes.length > 10) warnings.push('geometry count is high for an icon')
  if (shapes.filter(s => s.role === 'accent').length > 5) warnings.push('accent count is high')
  if (topology.radialArms >= 6 && grammar.complexity >= 3) warnings.push('radial structure may become dense')
  if (grammar.allowFullRepetition) warnings.push('full repetition is enabled')
  return warnings
}

function mergedTopology(primary: StructuralType, secondary?: StructuralType): TopologyProfile {
  const a = STRUCTURE_DEFINITIONS[primary].topology
  if (!secondary) return a
  const b = STRUCTURE_DEFINITIONS[secondary].topology
  return {
    axes: Math.min(2, Math.max(a.axes, b.axes)) as TopologyProfile['axes'],
    closedLoops: Math.min(2, a.closedLoops + b.closedLoops) as TopologyProfile['closedLoops'],
    branches: Math.min(3, a.branches + b.branches) as TopologyProfile['branches'],
    crossings: Math.min(2, a.crossings + b.crossings) as TopologyProfile['crossings'],
    radialArms: (Math.max(a.radialArms, b.radialArms) || 0) as TopologyProfile['radialArms'],
    stackLevels: Math.max(a.stackLevels, b.stackLevels) as TopologyProfile['stackLevels'],
    enclosure: a.enclosure || b.enclosure,
    symmetry: a.symmetry === b.symmetry ? a.symmetry : 'partial',
  }
}

export function generateFromGrammar(grammar: SigilGrammar): GeneratedSigil {
  const rng = makePrng(randomSeedFromGrammar(grammar))
  const w = strokeOf(grammar.strokeWeight)
  const draft = structureDraft(grammar.structure, rng, w)

  composeStructure(draft, grammar.secondaryStructure, grammar.compositionMode, w)
  operateStructure(draft, grammar.structureOperator ?? 'none', w, rng)

  const primarySlot = pickSlotFor(draft, ['center', 'interior', 'top', 'node'], rng)
  draft.shapes.push(...coreMotif(grammar.primaryMotif, 'primary', w, primarySlot))

  if (grammar.terminalMotif) addTerminalMotif(draft.shapes, draft.terminals, grammar.terminalMotif, w)
  if (grammar.interiorMotif) addInteriorMotif(draft.shapes, draft.interiors, grammar.interiorMotif, w)

  if (grammar.allowFullRepetition && STRUCTURE_DEFINITIONS[grammar.structure].defaultSymmetry === 'vertical') {
    draft.shapes.push(line({ x: 50, y: 18 }, { x: 50, y: 82 }, 'structure', w * 0.3, 0.24))
  }

  const topology = mergedTopology(grammar.structure, grammar.secondaryStructure)
  const layers: SigilLayer[] = [
    { name: grammar.structure, family: 'structure' },
    ...(grammar.secondaryStructure && grammar.compositionMode !== 'none' ? [{ name: `${grammar.compositionMode}:${grammar.secondaryStructure}`, family: 'composition' as const }] : []),
    ...(grammar.structureOperator && grammar.structureOperator !== 'none' ? [{ name: grammar.structureOperator, family: 'operator' as const }] : []),
    { name: grammar.primaryMotif, family: 'primary' },
  ]
  if (grammar.terminalMotif) layers.push({ name: grammar.terminalMotif, family: 'terminal' })
  if (grammar.interiorMotif) layers.push({ name: grammar.interiorMotif, family: 'interior' })

  return {
    shapes: draft.shapes,
    grammar,
    layers,
    warnings: legibilityWarnings(draft.shapes, grammar, topology),
    topology,
    slots: Array.from(new Set(draft.slots.map(s => s.name))),
  }
}

export function randomGrammar(seed: number, locks?: Partial<SigilGrammar>): SigilGrammar {
  const rng = makePrng(seed)
  const complexity: SigilComplexity = 1
  const structure = locks?.structure ?? pick(STRUCTURES, rng)
  const compositionMode = locks?.compositionMode ?? 'none'
  return {
    seed,
    structure,
    secondaryStructure: locks?.secondaryStructure ?? (compositionMode !== 'none' ? pick(STRUCTURES.filter(s => s !== structure), rng) : undefined),
    compositionMode,
    structureOperator: locks?.structureOperator ?? pick(['none', 'offset', 'bridge', 'break-symmetry', 'orbitize', 'flip-horizontal', 'flip-vertical'] as StructureOperator[], rng),
    primaryMotif: locks?.primaryMotif ?? pick(CORE_MOTIFS, rng),
    terminalMotif: locks?.terminalMotif ?? (rng() < 0.84 ? pick(TERMINAL_MOTIFS, rng) : undefined),
    interiorMotif: locks?.interiorMotif ?? (rng() < 0.72 ? pick(INTERIOR_MOTIFS, rng) : undefined),
    complexity,
    strokeWeight: 'normal',
    allowFullRepetition: locks?.allowFullRepetition ?? false,
  }
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xFFFFFFFF)
}

function randomSeedFromGrammar(grammar: SigilGrammar): number {
  const text = [
    grammar.seed,
    grammar.structure,
    grammar.secondaryStructure ?? '',
    grammar.compositionMode ?? '',
    grammar.structureOperator ?? '',
    grammar.primaryMotif,
    grammar.terminalMotif ?? '',
    grammar.interiorMotif ?? '',
    grammar.complexity,
    grammar.strokeWeight,
  ].join('|')
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
