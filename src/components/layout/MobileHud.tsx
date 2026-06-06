// ── MobileHud ─────────────────────────────────────────────────────────────────
// Minimal floating overlay for iPhone browser mode.
// Shows: Pause/Play, Reset, body count.

import { usePlanetStore } from '../../store/planetStore'
import { BUILTIN_CONTROL_SETS, useControlSetStore } from '../../store/controlSetStore'
import type { PlanetTool } from '../planet/PlanetCanvas'
import { unlockMobileAudio } from '../../audio/mobileAudioUnlock'

export function MobileHud({
  tool,
  onSetTool,
}: {
  tool: PlanetTool
  onSetTool: (tool: PlanetTool) => void
}) {
  const paused  = usePlanetStore(s => s.simParams.paused)
  const bodies  = usePlanetStore(s => s.bodies)
  const selectedBodyId = usePlanetStore(s => s.selectedBodyId)
  const updateSimParams = usePlanetStore(s => s.updateSimParams)
  const restartSim = usePlanetStore(s => s.restartSim)
  const globalRack = useControlSetStore(s => s.globalRack)
  const bodyRacks = useControlSetStore(s => s.bodyRacks)
  const userControlSets = useControlSetStore(s => s.userControlSets)
  const findControlSet = (id: string | null) => id
    ? BUILTIN_CONTROL_SETS.find(controlSet => controlSet.id === id)
      ?? userControlSets.find(controlSet => controlSet.id === id)
      ?? null
    : null
  const selectedBody = selectedBodyId ? bodies.find(body => body.id === selectedBodyId) ?? null : null
  const selectedBodyRack = selectedBody ? bodyRacks[selectedBody.id] : null
  const effectiveRack = selectedBodyRack
    ? {
        triggers: selectedBodyRack.triggers?.length ? selectedBodyRack.triggers : globalRack.triggers,
        note: selectedBodyRack.note ?? globalRack.note,
        instrument: selectedBodyRack.instrument ?? globalRack.instrument,
        effects: selectedBodyRack.effects?.length ? selectedBodyRack.effects : globalRack.effects,
      }
    : globalRack
  const instrumentName = findControlSet(effectiveRack.instrument)?.name ?? 'なし'
  const triggerMode = effectiveRack.triggers
    .map(id => findControlSet(id)?.name)
    .filter((name): name is string => Boolean(name))
    .join(' + ') || 'なし'

  const btnStyle: React.CSSProperties = {
    width: 44, height: 44, borderRadius: 22,
    border: '0.5px solid rgba(255,255,255,0.18)',
    background: 'rgba(15,15,28,0.75)',
    backdropFilter: 'blur(8px)',
    color: 'rgba(255,255,255,0.85)',
    fontSize: 18, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none',
  }
  const toolBtn = (target: 'add-sun' | 'add-planet', label: string, color: string) => {
    const active = tool === target
    return (
      <button
        key={target}
        style={{
          width: 44,
          height: 34,
          borderRadius: 17,
          border: `0.5px solid ${active ? color : 'rgba(255,255,255,0.16)'}`,
          background: active ? `${color}33` : 'rgba(15,15,28,0.68)',
          backdropFilter: 'blur(8px)',
          color: active ? color : 'rgba(255,255,255,0.55)',
          fontSize: 15,
          fontWeight: 800,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          WebkitTapHighlightColor: 'transparent',
          userSelect: 'none',
        }}
        onTouchEnd={e => { e.preventDefault(); void unlockMobileAudio(); onSetTool(target) }}
        onClick={() => { void unlockMobileAudio(); onSetTool(target) }}
        title={target === 'add-sun' ? 'Add Sun' : 'Add Planet'}
      >
        {label}
      </button>
    )
  }

  return (
    <>
      <div
        role="status"
        aria-label={`再生状態: ${paused ? '停止中' : '再生中'}。選択: ${selectedBody?.name ?? 'Universe'}。Instrument: ${instrumentName}。Trigger: ${triggerMode}`}
        style={{
          position: 'absolute', top: 14, left: 14, right: 72,
          zIndex: 100, pointerEvents: 'none',
          padding: '7px 9px', borderRadius: 8,
          border: '0.5px solid rgba(255,255,255,0.16)',
          background: 'rgba(15,15,28,0.72)',
          backdropFilter: 'blur(8px)',
          color: 'rgba(255,255,255,0.82)',
          fontSize: 10, lineHeight: 1.45,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ color: paused ? '#fbbf24' : '#4ade80', fontWeight: 800 }}>
            {paused ? '停止中' : '再生中'}
          </span>
          <span style={{ color: selectedBody?.color ?? 'rgba(255,255,255,0.72)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedBody?.name ?? 'Universe'}
          </span>
        </div>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'rgba(255,255,255,0.55)' }}>
          Instrument: {instrumentName} · Trigger: {triggerMode}
        </div>
      </div>

      {!selectedBodyId && (
        <div style={{
          position: 'absolute', left: 18, right: 72, bottom: 18,
          zIndex: 100, pointerEvents: 'none',
          color: 'rgba(255,255,255,0.62)',
          fontSize: 10, lineHeight: 1.4,
          textShadow: '0 1px 3px rgba(0,0,0,0.8)',
        }}>
          {tool === 'add-sun'
            ? 'まず: ドラッグして太陽を配置'
            : tool === 'add-planet'
              ? 'まず: ドラッグして惑星を配置'
              : '天体をタップして選択'}
        </div>
      )}

      <div style={{
        position: 'absolute', top: 14, right: 14,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        zIndex: 100,
        pointerEvents: 'auto',
      }}>
      {/* Pause / Play */}
      <button
        style={btnStyle}
        aria-label={paused ? '再生する' : '一時停止する'}
        onTouchEnd={e => { e.preventDefault(); void unlockMobileAudio(); updateSimParams({ paused: !paused }) }}
        onClick={() => { void unlockMobileAudio(); updateSimParams({ paused: !paused }) }}
      >
        {paused ? '▶' : '⏸'}
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {toolBtn('add-sun', '☀', '#f59e0b')}
        {toolBtn('add-planet', '●', '#60a5fa')}
      </div>

      {/* Reset */}
      <button
        style={{ ...btnStyle, fontSize: 15 }}
        aria-label="シミュレーションを再スタート"
        onTouchEnd={e => { e.preventDefault(); void unlockMobileAudio(); restartSim() }}
        onClick={() => { void unlockMobileAudio(); restartSim() }}
      >
        ↺
      </button>

      {/* Body count */}
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)',
        letterSpacing: '0.05em', lineHeight: 1, textAlign: 'center',
        userSelect: 'none',
      }}>
        {bodies.length}
      </div>
      </div>
    </>
  )
}
