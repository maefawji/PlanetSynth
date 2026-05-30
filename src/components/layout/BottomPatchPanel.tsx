import { ChevronDown, ChevronUp } from 'lucide-react'
import { PatchEditor } from '../patch/PatchEditor'
import { useProjectStore } from '../../store/projectStore'
import { useSelectionStore } from '../../store/selectionStore'

interface BottomPatchPanelProps {
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function BottomPatchPanel({ collapsed, onToggleCollapsed }: BottomPatchPanelProps) {
  const nodeCount  = useProjectStore(s => s.project.nodes.length)
  const edgeCount  = useProjectStore(s => s.project.edges.length)
  const selectedId = useSelectionStore(s => s.selectedNodeId)
  const removeNode = useProjectStore(s => s.removeNode)
  const clearAll   = useSelectionStore(s => s.clearAll)

  function deleteSelected() {
    if (selectedId) { removeNode(selectedId); clearAll() }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        height: 26, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
        background: '#212121',
        borderTop: '1px solid #111',
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'monospace' }}>
          Patch
        </span>
        <span style={{ fontSize: 9, color: '#444', marginLeft: 2, fontFamily: 'monospace' }}>
          {nodeCount} nodes · {edgeCount} edges
        </span>
        <div style={{ flex: 1 }} />
        {selectedId && (
          <button
            onClick={deleteSelected}
            style={{
              fontSize: 9, color: '#666', background: 'none', border: 'none',
              cursor: 'pointer', fontFamily: 'monospace', padding: '2px 6px',
            }}
          >
            delete
          </button>
        )}
        <button
          onClick={onToggleCollapsed}
          title={collapsed ? 'Show Patch' : 'Hide Patch'}
          style={{
            width: 20, height: 20, border: 'none', borderRadius: 3,
            background: 'transparent', color: '#555', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>
      {/* Canvas */}
      {!collapsed && <div style={{ flex: 1, minHeight: 0 }}>
        <PatchEditor />
      </div>}
    </div>
  )
}
