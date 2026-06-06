import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { makeDefaultProject } from '../patch/types'
import { nodeRegistry } from '../patch/nodeRegistry'
import { canConnect } from '../patch/connectionRules'
import { useSelectionStore } from './selectionStore'
import { useSamplerModeStore } from './samplerModeStore'
import { autosaveProject, loadAutosavedProject } from '../persistence/projectSchema'
import { samplePathsMatch } from '../persistence/sampleLibrary'
import type { ModularProject, PatchNodeInstance, PatchEdge, GeometryObject, GeometryType, JSONValue, SampleAsset } from '../patch/types'

interface ProjectState {
  project: ModularProject
  isDirty: boolean
  addNode: (type: string, position: { x: number; y: number }) => void
  updateNodeParams: (nodeId: string, params: Record<string, JSONValue>) => void
  removeNode: (nodeId: string) => void
  moveNode: (nodeId: string, position: { x: number; y: number }) => void
  addEdge: (fromNodeId: string, fromPortId: string, toNodeId: string, toPortId: string) => void
  removeEdge: (edgeId: string) => void
  addGeometryObject: (obj: GeometryObject) => void
  updateGeometryObject: (id: string, params: Record<string, JSONValue>) => void
  updateGeometrySample: (id: string, sampleId: string | null) => void
  removeGeometryObject: (id: string) => void
  addSampleAsset: (sample: SampleAsset) => void
  addSampleAssets: (samples: SampleAsset[]) => void
  removeSampleAsset: (sampleId: string) => void
  setSampleObjectUrl: (sampleId: string, objectUrl: string) => void
  clearSamples: () => void
  randomAssignSamples: () => void
  loadProject: (project: ModularProject) => void
  markClean: () => void
}

// ── Initial state: restore autosave if present ────────────────────────────────
const _initialProject = loadAutosavedProject() ?? makeDefaultProject()

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: _initialProject,
  isDirty: false,

  addNode(type, position) {
    const def = nodeRegistry[type]
    if (!def) return
    const selectedGeometryId = useSelectionStore.getState().selectedGeometryId
    const selectedGeometry = get().project.geometry.find(g => g.id === selectedGeometryId)
    const selectedReferenceId = selectedGeometry && canReferenceGeometry(type, selectedGeometry.type)
      ? selectedGeometry.id
      : ''
    const node: PatchNodeInstance = {
      id: `node_${nanoid(6)}`,
      type,
      position,
      params: {
        ...def.defaultParams,
        ...(selectedReferenceId ? { geometryId: selectedReferenceId } : {}),
      },
    }
    set(s => {
      const nodes = [...s.project.nodes, node]
      return { project: { ...s.project, nodes }, isDirty: true }
    })
  },

  updateNodeParams(nodeId, params) {
    set(s => {
      const nodes = s.project.nodes.map(n =>
        n.id === nodeId ? { ...n, params: { ...n.params, ...params } } : n
      )
      return { project: { ...s.project, nodes }, isDirty: true }
    })
  },

  removeNode(nodeId) {
    set(s => ({
      project: {
        ...s.project,
        nodes: s.project.nodes.filter(n => n.id !== nodeId),
        edges: s.project.edges.filter(e => e.fromNodeId !== nodeId && e.toNodeId !== nodeId),
      },
      isDirty: true,
    }))
  },

  moveNode(nodeId, position) {
    set(s => ({
      project: {
        ...s.project,
        nodes: s.project.nodes.map(n => n.id === nodeId ? { ...n, position } : n),
      },
      isDirty: true,
    }))
  },

  addEdge(fromNodeId, fromPortId, toNodeId, toPortId) {
    const { project } = get()
    if (!canConnect(fromNodeId, fromPortId, toNodeId, toPortId, project)) return

    const fromDef  = nodeRegistry[project.nodes.find(n => n.id === fromNodeId)?.type ?? '']
    const fromPort = fromDef?.outputs.find(p => p.id === fromPortId)
    if (!fromPort) return

    const edge: PatchEdge = {
      id: `edge_${nanoid(6)}`,
      fromNodeId, fromPortId, toNodeId, toPortId,
      signalType: fromPort.signalType,
    }
    set(s => ({
      project: {
        ...s.project,
        edges: s.project.edges.some(e =>
          e.fromNodeId === fromNodeId
          && e.fromPortId === fromPortId
          && e.toNodeId === toNodeId
          && e.toPortId === toPortId
        ) ? s.project.edges : [...s.project.edges, edge],
      },
      isDirty: true,
    }))
  },

  removeEdge(edgeId) {
    set(s => ({
      project: { ...s.project, edges: s.project.edges.filter(e => e.id !== edgeId) },
      isDirty: true,
    }))
  },

  addGeometryObject(obj) {
    set(s => ({ project: { ...s.project, geometry: [...s.project.geometry, obj] }, isDirty: true }))
  },

  updateGeometryObject(id, params) {
    set(s => ({
      project: {
        ...s.project,
        geometry: s.project.geometry.map(g =>
          g.id === id ? { ...g, params: { ...g.params, ...params } } : g
        ),
      },
      isDirty: true,
    }))
  },

  updateGeometrySample(id, sampleId) {
    set(s => ({
      project: {
        ...s.project,
        geometry: s.project.geometry.map(g => g.id === id ? { ...g, sampleId } : g),
      },
      isDirty: true,
    }))
  },

  removeGeometryObject(id) {
    set(s => ({
      project: { ...s.project, geometry: s.project.geometry.filter(g => g.id !== id) },
      isDirty: true,
    }))
  },

  addSampleAsset(sample) {
    set(s => ({
      project: { ...s.project, samples: [...s.project.samples, sample] },
      isDirty: true,
    }))
  },

  addSampleAssets(incoming) {
    if (!incoming.length) return
    set(s => {
      let list = [...s.project.samples]
      let changed = false
      for (const inc of incoming) {
        // 1. Match by id → upsert objectUrl (fixes stale blob URLs on reload)
        const byId = list.findIndex(e => e.id === inc.id)
        if (byId >= 0) {
          const nextObjectUrl = inc.objectUrl || list[byId].objectUrl
          if (
            list[byId].objectUrl !== nextObjectUrl
            || list[byId].fileType !== inc.fileType
            || list[byId].name !== inc.name
            || list[byId].sourcePath !== inc.sourcePath
            || list[byId].source !== inc.source
          ) {
            list[byId] = { ...list[byId], ...inc, objectUrl: nextObjectUrl }
            changed = true
          }
          continue
        }
        // 2. Match by sourcePath → skip true duplicates (different session IDs, same file)
        const key = inc.sourcePath ?? inc.objectUrl
        if (key) {
          const bySource = list.findIndex(e =>
            samplePathsMatch(e.sourcePath ?? e.objectUrl, key)
            || samplePathsMatch(e.name, inc.sourcePath)
          )
          if (bySource >= 0) {
            const nextObjectUrl = inc.objectUrl || list[bySource].objectUrl
            if (
              list[bySource].objectUrl !== nextObjectUrl
              || list[bySource].fileType !== inc.fileType
              || list[bySource].name !== inc.name
              || list[bySource].source !== inc.source
            ) {
              list[bySource] = { ...list[bySource], name: inc.name, objectUrl: nextObjectUrl, fileType: inc.fileType, source: inc.source }
              changed = true
            }
            continue
          }
        }
        // 3. New sample
        list = [...list, inc]
        changed = true
      }
      if (!changed) return s
      return { project: { ...s.project, samples: list }, isDirty: true }
    })
  },

  removeSampleAsset(sampleId) {
    set(s => ({
      project: {
        ...s.project,
        samples: s.project.samples.filter(sample => sample.id !== sampleId),
        geometry: s.project.geometry.map(g =>
          g.sampleId === sampleId ? { ...g, sampleId: null } : g
        ),
      },
      isDirty: true,
    }))
  },

  setSampleObjectUrl(sampleId, objectUrl) {
    set(s => {
      const current = s.project.samples.find(sa => sa.id === sampleId)
      if (!current || current.objectUrl === objectUrl) return s
      return {
        project: {
          ...s.project,
          samples: s.project.samples.map(sa =>
            sa.id === sampleId ? { ...sa, objectUrl } : sa
          ),
        },
      }
    })
    // Don't set isDirty — this is an ephemeral restoration, not a user edit
  },

  clearSamples() {
    set(s => ({ project: { ...s.project, samples: [] }, isDirty: true }))
  },

  randomAssignSamples() {
    const { project } = get()
    const samples = project.samples
    const samplerMode = useSamplerModeStore.getState()
    if (!samples.length) return
    // Assign a random sample to every non-point, non-derived geometry
    const geometry = project.geometry.map(g => {
      if (g.type === 'point' || g.role === 'derived' || g.sourceNodeId) return g
      const sample = samples[Math.floor(Math.random() * samples.length)]
      const randomStartMin = Math.min(samplerMode.randomStartMinSeconds, samplerMode.randomStartMaxSeconds)
      const randomStartMax = Math.max(samplerMode.randomStartMinSeconds, samplerMode.randomStartMaxSeconds)
      const sampleStartSeconds = randomStartMin + Math.random() * Math.max(0, randomStartMax - randomStartMin)
      return { ...g, sampleId: sample.id, params: { ...g.params, sampleStartSeconds } }
    })
    set(s => ({ project: { ...s.project, geometry }, isDirty: true }))
  },

  loadProject(project) {
    set({ project, isDirty: false })
  },

  markClean() {
    set({ isDirty: false })
  },
}))

// ── Autosave: debounced write to localStorage on every dirty change ───────────
let _autosaveTimer = 0
useProjectStore.subscribe(state => {
  if (!state.isDirty) return
  clearTimeout(_autosaveTimer)
  _autosaveTimer = window.setTimeout(() => autosaveProject(state.project), 1500)
})

function canReferenceGeometry(nodeType: string, geometryType: GeometryType): boolean {
  if (nodeType === 'geometry.referenceCircle') return geometryType === 'circle'
  if (nodeType === 'geometry.referencePoint') return geometryType === 'point'
  if (nodeType === 'geometry.referenceCurve') return geometryType === 'path' || geometryType === 'circle' || geometryType === 'way'
  return false
}
