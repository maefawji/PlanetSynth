// ── MobileHud ─────────────────────────────────────────────────────────────────
// Minimal floating overlay for iPhone browser mode.
// Shows: Pause/Play, Reset, body count.

import { usePlanetStore } from '../../store/planetStore'
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
  const updateSimParams = usePlanetStore(s => s.updateSimParams)
  const restartSim = usePlanetStore(s => s.restartSim)

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
    <div style={{
      position: 'absolute', top: 14, right: 14,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
      zIndex: 100,
      pointerEvents: 'auto',
    }}>
      {/* Pause / Play */}
      <button
        style={btnStyle}
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
  )
}
