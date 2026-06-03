import { create } from 'zustand'
import type { WholeInstrumentSource } from './wholeInstrumentStore'

export type OrbitTransformCurve = 'linear' | 'ease-in' | 'ease-out' | 'smooth' | 'invert'

export type OrbitTransformOutput =
  | 'level'
  | 'cutoff'
  | 'motion'
  | 'depth'
  | 'pan'
  | 'root'
  | 'width'
  | 'tension'

export type OrbitTransformNode = {
  id: OrbitTransformOutput
  label: string
  enabled: boolean
  bias: number
  curve: OrbitTransformCurve
  weights: Partial<Record<WholeInstrumentSource, number>>
}

type OrbitTransformState = {
  nodes: Record<OrbitTransformOutput, OrbitTransformNode>
  selectedNodeId: OrbitTransformOutput
  selectNode: (id: OrbitTransformOutput) => void
  updateNode: (id: OrbitTransformOutput, patch: Partial<Omit<OrbitTransformNode, 'id' | 'label'>>) => void
  setWeight: (id: OrbitTransformOutput, source: WholeInstrumentSource, weight: number) => void
  resetNode: (id: OrbitTransformOutput) => void
  resetAll: () => void
}

function node(id: OrbitTransformOutput, label: string, weights: Partial<Record<WholeInstrumentSource, number>>, curve: OrbitTransformCurve = 'linear', bias = 0): OrbitTransformNode {
  return { id, label, enabled: true, bias, curve, weights }
}

function defaultNodes(): Record<OrbitTransformOutput, OrbitTransformNode> {
  return {
    level:   node('level',   'Level',   { mass: 0.62, count: 0.38 }),
    cutoff:  node('cutoff',  'Cutoff',  { z: 0.58, speed: 0.42 }, 'ease-out'),
    motion:  node('motion',  'Motion',  { speed: 1.0 }),
    depth:   node('depth',   'Depth',   { spread: 0.55, nearest: 0.45 }),
    pan:     node('pan',     'Pan',     { 'center-x': 1.0 }),
    root:    node('root',    'Root',    { 'center-y': 1.0 }),
    width:   node('width',   'Width',   { spread: 1.0 }),
    tension: node('tension', 'Tension', { nearest: 0.72, speed: 0.28 }),
  }
}

export const useOrbitTransformStore = create<OrbitTransformState>((set, get) => ({
  nodes: defaultNodes(),
  selectedNodeId: 'level',
  selectNode: selectedNodeId => set({ selectedNodeId }),
  updateNode(id, patch) {
    set(s => ({ nodes: { ...s.nodes, [id]: { ...s.nodes[id], ...patch } } }))
  },
  setWeight(id, source, weight) {
    set(s => ({
      nodes: {
        ...s.nodes,
        [id]: {
          ...s.nodes[id],
          weights: { ...s.nodes[id].weights, [source]: weight },
        },
      },
    }))
  },
  resetNode(id) {
    set(s => ({ nodes: { ...s.nodes, [id]: defaultNodes()[id] } }))
  },
  resetAll() {
    set({ nodes: defaultNodes(), selectedNodeId: get().selectedNodeId })
  },
}))
