import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import { nodeRegistry } from '../../patch/nodeRegistry'
import { applyControlValues } from '../../audio/audioEngine'
import { useAudioStore } from '../../store/audioStore'
import { useProjectStore } from '../../store/projectStore'
import type { PatchNodeInstance, SignalType } from '../../patch/types'

export interface PatchNodeData extends Record<string, unknown> {
  nodeInstance: PatchNodeInstance
  isSelected: boolean
}

export type PatchRFNode = Node<PatchNodeData, 'patchNode'>

// Signal colors – brighter for dark background
const signalColor: Record<SignalType, string> = {
  audio:        '#c8c8c8',
  control:      '#5b9cf6',
  trigger:      '#f87171',
  sample:       '#f472b6',
  geometry:     '#4ade80',
  geometryList: '#a78bfa',
}

// Inlet/outlet handle style (Max/MSP rectangular tab)
function handleStyle(
  index: number,
  total: number,
  nodeWidth: number,
): React.CSSProperties {
  const spacing = nodeWidth / (total + 1)
  const left = spacing * (index + 1)
  return {
    position: 'absolute',
    left,
    width: 9,
    height: 5,
    borderRadius: '1px',
    border: 'none',
    transform: 'translateX(-50%)',
    cursor: 'crosshair',
  }
}

export const PatchNode = memo(({ data, selected }: NodeProps<PatchRFNode>) => {
  const node = data.nodeInstance
  const def  = nodeRegistry[node.type]
  const updateNodeParams = useProjectStore(s => s.updateNodeParams)
  const isRunning = useAudioStore(s => s.isRunning)
  if (!def) return null

  // Width: wide enough to give ~14 px per port slot, minimum 96 px
  const minByPorts = (Math.max(def.inputs.length, def.outputs.length) + 1) * 14 + 20
  const nodeWidth  = Math.max(96, Math.min(180, minByPorts))

  const hasInlineNumber = node.type === 'control.number' || node.type === 'number'
  const hasMessageText  = node.type === 'message'
  const nodeHeight = 26 + (hasInlineNumber || hasMessageText ? 22 : 0)

  function updateInlineNumber(value: number) {
    updateNodeParams(node.id, { value })
    if (isRunning) {
      setTimeout(() => applyControlValues(useProjectStore.getState().project), 0)
    }
  }

  function updateMessageText(text: string) {
    updateNodeParams(node.id, { text })
  }

  return (
    <div style={{
      width: nodeWidth,
      height: nodeHeight,
      background: '#272727',
      border: `1px solid ${selected ? '#4e8ef7' : '#424242'}`,
      borderRadius: 2,
      boxShadow: selected
        ? '0 0 0 1px #4e8ef7, 0 3px 8px rgba(0,0,0,0.55)'
        : '0 2px 6px rgba(0,0,0,0.55)',
      position: 'relative',
      userSelect: 'none',
      fontFamily: '"Menlo", "Monaco", "Consolas", monospace',
    }}>

      {/* ── Inlets (top) ── */}
      {def.inputs.map((port, i) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Top}
          id={port.id}
          title={port.label}
          style={{
            ...handleStyle(i, def.inputs.length, nodeWidth),
            top: -5,
            background: signalColor[port.signalType],
          }}
        />
      ))}

      {/* ── Label row ── */}
      <div style={{
        height: 26,
        display: 'flex',
        alignItems: 'center',
        padding: '0 7px',
        gap: 5,
      }}>
        <span style={{
          fontSize: 10,
          fontWeight: 500,
          color: '#d8d8d8',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1,
        }}>
          {def.label}
        </span>
        {/* signal-type dot for quick visual ID */}
        {def.outputs.length > 0 && (
          <span style={{
            width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
            background: signalColor[def.outputs[0].signalType],
            opacity: 0.6,
          }} />
        )}
      </div>

      {/* ── Inline number (number / control.number) ── */}
      {hasInlineNumber && (
        <div style={{ padding: '0 6px 5px' }}>
          <input
            className="nodrag nowheel"
            type="number"
            value={(node.params.value as number) ?? 0}
            step={0.01}
            onChange={e => updateInlineNumber(Number(e.target.value))}
            onPointerDown={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            style={{
              width: '100%',
              fontSize: 10,
              fontFamily: 'inherit',
              border: '1px solid #383838',
              borderRadius: 2,
              padding: '2px 5px',
              background: '#1a1a1a',
              color: '#d8d8d8',
              outline: 'none',
            }}
          />
        </div>
      )}

      {/* ── Message text box ── */}
      {hasMessageText && (
        <div style={{ padding: '0 6px 5px' }}>
          <input
            className="nodrag nowheel"
            type="text"
            value={(node.params.text as string) ?? '0'}
            onChange={e => updateMessageText(e.target.value)}
            onPointerDown={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            style={{
              width: '100%',
              fontSize: 10,
              fontFamily: 'inherit',
              border: '1px solid #383838',
              borderRadius: 2,
              padding: '2px 5px',
              background: '#1a1a1a',
              color: '#d8d8d8',
              outline: 'none',
            }}
          />
        </div>
      )}

      {/* ── Outlets (bottom) ── */}
      {def.outputs.map((port, i) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Bottom}
          id={port.id}
          title={port.label}
          style={{
            ...handleStyle(i, def.outputs.length, nodeWidth),
            bottom: -5,
            background: signalColor[port.signalType],
          }}
        />
      ))}
    </div>
  )
})

PatchNode.displayName = 'PatchNode'
