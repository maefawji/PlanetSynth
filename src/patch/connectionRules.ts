import type { SignalType, ModularProject } from './types'
import { nodeRegistry } from './nodeRegistry'

export function canConnectSignals(from: SignalType, to: SignalType): boolean {
  if (from === to) return true
  if (from === 'geometry' && to === 'control') return true // geometry → control allowed
  return false
}

export function canConnect(
  fromNodeId: string, fromPortId: string,
  toNodeId: string,   toPortId: string,
  project: ModularProject,
): boolean {
  const fromNode = project.nodes.find(n => n.id === fromNodeId)
  const toNode   = project.nodes.find(n => n.id === toNodeId)
  if (!fromNode || !toNode) return false
  const fromDef = nodeRegistry[fromNode.type]
  const toDef   = nodeRegistry[toNode.type]
  if (!fromDef || !toDef) return false
  const fromPort = fromDef.outputs.find(p => p.id === fromPortId)
  const toPort   = toDef.inputs.find(p => p.id === toPortId)
  if (!fromPort || !toPort) return false
  return canConnectSignals(fromPort.signalType, toPort.signalType)
}

export function mapRange(
  value: number,
  inMin: number, inMax: number,
  outMin: number, outMax: number,
): number {
  if (inMax === inMin) return outMin
  const t = (value - inMin) / (inMax - inMin)
  return outMin + Math.max(0, Math.min(1, t)) * (outMax - outMin)
}
