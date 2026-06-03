// Core types — no React Flow / Tone.js / Paper.js dependencies.
// Designed to map 1:1 to Swift Codable structs for future migration.

export type SignalType = 'audio' | 'control' | 'trigger' | 'sample' | 'geometry' | 'geometryList'
export type PortDirection = 'input' | 'output'
export type NodeCategory = 'audio' | 'control' | 'geometry' | 'operator' | 'display' | 'utility' | 'output'

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue }

export interface PortDefinition {
  id: string
  label: string
  direction: PortDirection
  signalType: SignalType
}

export interface PatchNodeDefinition {
  type: string
  label: string
  category: NodeCategory
  inputs: PortDefinition[]
  outputs: PortDefinition[]
  defaultParams: Record<string, JSONValue>
  description?: string
  arguments?: JSONValue[]
  attributes?: Record<string, JSONValue>
  messages?: string[]
  processingRate?: 'event' | 'control' | 'signal' | 'geometry'
}

export interface PatchNodeInstance {
  id: string
  type: string
  position: { x: number; y: number }
  params: Record<string, JSONValue>
}

export interface PatchEdge {
  id: string
  fromNodeId: string
  fromPortId: string
  toNodeId: string
  toPortId: string
  signalType: SignalType
}

export interface GeometryStyle {
  stroke: string
  strokeWidth: number
  fill: string
  opacity?: number
}

export type GeometryType = 'circle' | 'path' | 'point' | 'way'

export interface GeometryObject {
  id: string
  type: GeometryType
  role?: 'base' | 'derived'
  sourceNodeId?: string
  sampleId?: string | null
  params: Record<string, JSONValue>
  style: GeometryStyle
}

export interface SampleAsset {
  id: string
  name: string
  objectUrl: string
  fileType: string
  sourcePath?: string
}

export interface ModularProject {
  version: '0.1.0'
  meta: { name: string; createdAt: string; updatedAt: string }
  transport: { bpm: number }
  nodes: PatchNodeInstance[]
  edges: PatchEdge[]
  geometry: GeometryObject[]
  samples: SampleAsset[]
  /** Optional app-level state for PlanetSynth project export/import. */
  planetSynth?: unknown
}

export function makeDefaultProject(): ModularProject {
  const now = new Date().toISOString()
  return {
    version: '0.1.0',
    meta: { name: 'Sampler Drawing', createdAt: now, updatedAt: now },
    transport: { bpm: 120 },

    nodes: [],
    edges: [],

    geometry: [
      {
        id: 'sampler_path_1',
        type: 'path',
        role: 'base',
        sampleId: null,
        params: {
          svgPath: 'M 180 300 C 280 120, 420 460, 580 250',
          samplerRole: 'path-sampler',
          speed: 120,
        },
        style: { stroke: '#111827', strokeWidth: 2, fill: 'none' },
      },
    ],
    samples: [],
  }
}
