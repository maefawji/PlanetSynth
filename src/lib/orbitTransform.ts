import type { WholeInstrumentSource } from '../store/wholeInstrumentStore'
import type { OrbitTransformCurve, OrbitTransformNode, OrbitTransformOutput } from '../store/orbitTransformStore'
import type { WholeInstrumentFeatureValues } from './wholeInstrumentMapping'

export type OrbitTransformValues = Record<OrbitTransformOutput, number>

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
}

function curveValue(v: number, curve: OrbitTransformCurve): number {
  const x = clamp01(v)
  switch (curve) {
    case 'ease-in': return x * x
    case 'ease-out': return 1 - (1 - x) * (1 - x)
    case 'smooth': return x * x * (3 - 2 * x)
    case 'invert': return 1 - x
    default: return x
  }
}

export function evaluateOrbitTransformNode(node: OrbitTransformNode, values: WholeInstrumentFeatureValues): number {
  if (!node.enabled) return 0
  let weighted = node.bias
  let total = Math.abs(node.bias)
  for (const [source, weight] of Object.entries(node.weights) as [WholeInstrumentSource, number][]) {
    if (!Number.isFinite(weight) || weight === 0) continue
    weighted += values[source] * weight
    total += Math.abs(weight)
  }
  const mixed = total > 0 ? weighted / total : 0
  return curveValue(mixed, node.curve)
}

export function evaluateOrbitTransform(nodes: Record<OrbitTransformOutput, OrbitTransformNode>, values: WholeInstrumentFeatureValues): OrbitTransformValues {
  return {
    level: evaluateOrbitTransformNode(nodes.level, values),
    cutoff: evaluateOrbitTransformNode(nodes.cutoff, values),
    motion: evaluateOrbitTransformNode(nodes.motion, values),
    depth: evaluateOrbitTransformNode(nodes.depth, values),
    pan: evaluateOrbitTransformNode(nodes.pan, values),
    root: evaluateOrbitTransformNode(nodes.root, values),
    width: evaluateOrbitTransformNode(nodes.width, values),
    tension: evaluateOrbitTransformNode(nodes.tension, values),
  }
}
