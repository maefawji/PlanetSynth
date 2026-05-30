import { useCallback, useMemo, useEffect, useRef, useState } from 'react'
import {
  ReactFlow, Background, Controls,
  useNodesState, useEdgesState, addEdge,
  type Edge, type Connection,
  type NodeChange, type EdgeChange,
  type ReactFlowInstance,
  MarkerType,
} from '@xyflow/react'
import { PatchNode } from './PatchNode'
import type { PatchRFNode } from './PatchNode'
import { useProjectStore } from '../../store/projectStore'
import { useSelectionStore } from '../../store/selectionStore'
import { canConnect } from '../../patch/connectionRules'
import { nodeRegistry } from '../../patch/nodeRegistry'
import type { PatchNodeInstance, PatchEdge } from '../../patch/types'

const nodeTypes = { patchNode: PatchNode }

function toRFNode(node: PatchNodeInstance, selectedId: string | null): PatchRFNode {
  return {
    id: node.id,
    type: 'patchNode',
    position: node.position,
    data: { nodeInstance: node, isSelected: node.id === selectedId },
    selected: node.id === selectedId,
  }
}

function toRFEdge(edge: PatchEdge): Edge {
  return {
    id: edge.id,
    source: edge.fromNodeId,
    target: edge.toNodeId,
    sourceHandle: edge.fromPortId,
    targetHandle: edge.toPortId,
    className: `edge-${edge.signalType}`,
    markerEnd: { type: MarkerType.Arrow, width: 7, height: 7, color: 'rgba(180,180,180,0.4)' },
  }
}

export function PatchEditor() {
  const project     = useProjectStore(s => s.project)
  const addNode     = useProjectStore(s => s.addNode)
  const moveNode    = useProjectStore(s => s.moveNode)
  const addEdgeFn   = useProjectStore(s => s.addEdge)
  const removeEdge  = useProjectStore(s => s.removeEdge)
  const removeNode  = useProjectStore(s => s.removeNode)
  const selectedNodeId = useSelectionStore(s => s.selectedNodeId)
  const selectNode  = useSelectionStore(s => s.selectNode)
  const clearAll    = useSelectionStore(s => s.clearAll)

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<PatchRFNode>([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [flow, setFlow] = useState<ReactFlowInstance<PatchRFNode, Edge> | null>(null)
  const [search, setSearch] = useState<{
    screen: { x: number; y: number }
    flow: { x: number; y: number }
    query: string
  } | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // Sync project → RF state
  useEffect(() => {
    setRfNodes(project.nodes.map(n => toRFNode(n, selectedNodeId)))
    setRfEdges(project.edges.map(toRFEdge))
  }, [project, selectedNodeId, setRfNodes, setRfEdges])

  const handleNodesChange = useCallback((changes: NodeChange<PatchRFNode>[]) => {
    onNodesChange(changes)
    for (const c of changes) {
      if (c.type === 'position' && c.dragging === false && c.position) {
        moveNode(c.id, c.position)
      }
      if (c.type === 'select') {
        if (c.selected) selectNode(c.id)
        else clearAll()
      }
      if (c.type === 'remove') {
        removeNode(c.id)
      }
    }
  }, [onNodesChange, moveNode, selectNode, clearAll, removeNode])

  const handleEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    onEdgesChange(changes)
    for (const c of changes) {
      if (c.type === 'remove') removeEdge(c.id)
    }
  }, [onEdgesChange, removeEdge])

  const isValidConnection = useCallback((conn: Edge | Connection) => {
    if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) return false
    return canConnect(conn.source, conn.sourceHandle, conn.target, conn.targetHandle, project)
  }, [project])

  const handleConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) return
    addEdgeFn(conn.source, conn.sourceHandle, conn.target, conn.targetHandle)
    // Also update RF edge state
    setRfEdges(es => addEdge({
      ...conn,
      className: `edge-${
        nodeRegistry[project.nodes.find(n => n.id === conn.source)?.type ?? '']
          ?.outputs.find(p => p.id === conn.sourceHandle)?.signalType ?? 'control'
      }`,
    }, es))
  }, [addEdgeFn, project.nodes, setRfEdges])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-patch-node')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('application/x-patch-node')
    if (!type || !flow) return
    addNode(type, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
  }, [addNode, flow])

  const nodeTypesInLibraryOrder = useMemo(() => {
    return Object.values(nodeRegistry)
  }, [])

  const searchResults = useMemo(() => {
    if (!search) return []
    const q = search.query.trim().toLowerCase()
    const score = (label: string, type: string, category: string) => {
      const haystack = `${label} ${type} ${category}`.toLowerCase()
      if (!q) return 1
      if (label.toLowerCase().startsWith(q)) return 4
      if (haystack.includes(q)) return 2
      return 0
    }
    return nodeTypesInLibraryOrder
      .map(def => ({ def, score: score(def.label, def.type, def.category) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.def.label.localeCompare(b.def.label))
      .slice(0, 8)
      .map(item => item.def)
  }, [nodeTypesInLibraryOrder, search])

  const openSearch = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!flow) return
    setSearch({
      screen: { x: e.clientX, y: e.clientY },
      flow: flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      query: '',
    })
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }, [flow])

  const handlePaneClick = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (e.detail >= 2) {
      openSearch(e)
      return
    }
    setSearch(null)
  }, [openSearch])

  const addNodeFromSearch = useCallback((type: string) => {
    if (!search) return
    addNode(type, search.flow)
    setSearch(null)
  }, [addNode, search])

  const defaultEdgeOptions = useMemo(() => ({
    animated: false,
    style: { strokeWidth: 1.5 },
  }), [])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1c1c1c' }}>
      <ReactFlow<PatchRFNode, Edge>
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onInit={setFlow}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onPaneClick={handlePaneClick}
        isValidConnection={isValidConnection}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        deleteKeyCode="Backspace"
        minZoom={0.3}
        maxZoom={2}
      >
        <Background gap={24} size={1} color="rgba(255,255,255,0.05)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {search && (
        <div
          className="nodrag nowheel"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: Math.min(search.screen.x, window.innerWidth - 230),
            top: Math.min(search.screen.y, window.innerHeight - 270),
            width: 220,
            background: '#252525',
            border: '1px solid #404040',
            borderRadius: 4,
            boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
            zIndex: 20,
            overflow: 'hidden',
          }}
        >
          <input
            ref={searchInputRef}
            value={search.query}
            placeholder="Search object…"
            onChange={e => setSearch(s => s ? { ...s, query: e.target.value } : s)}
            onKeyDown={e => {
              if (e.key === 'Escape') setSearch(null)
              if (e.key === 'Enter' && searchResults[0]) addNodeFromSearch(searchResults[0].type)
            }}
            style={{
              width: '100%',
              height: 30,
              border: 'none',
              borderBottom: '1px solid #383838',
              outline: 'none',
              padding: '0 10px',
              fontSize: 11,
              fontFamily: '"Menlo", "Monaco", "Consolas", monospace',
              background: '#1e1e1e',
              color: '#d8d8d8',
            }}
          />
          <div style={{ maxHeight: 218, overflowY: 'auto', padding: 3 }}>
            {searchResults.length > 0 ? searchResults.map((def, index) => (
              <button
                key={def.type}
                onClick={() => addNodeFromSearch(def.type)}
                style={{
                  width: '100%',
                  minHeight: 28,
                  border: 'none',
                  borderRadius: 2,
                  background: index === 0 ? 'rgba(78,142,247,0.18)' : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '3px 7px',
                  fontFamily: '"Menlo", "Monaco", "Consolas", monospace',
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 500, color: '#d0d0d0' }}>{def.label}</span>
                <span style={{ fontSize: 9, color: '#666' }}>{def.category}</span>
              </button>
            )) : (
              <div style={{ padding: '10px 8px', color: '#555', fontSize: 10 }}>No objects found</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
