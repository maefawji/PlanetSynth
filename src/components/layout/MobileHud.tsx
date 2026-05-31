// ── MobileHud ─────────────────────────────────────────────────────────────────
// Minimal floating overlay for iPhone browser mode.
// Shows: Pause/Play, Reset, body count.

import { usePlanetStore } from '../../store/planetStore'

export function MobileHud() {
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
        onTouchEnd={e => { e.preventDefault(); updateSimParams({ paused: !paused }) }}
        onClick={() => updateSimParams({ paused: !paused })}
      >
        {paused ? '▶' : '⏸'}
      </button>

      {/* Reset */}
      <button
        style={{ ...btnStyle, fontSize: 15 }}
        onTouchEnd={e => { e.preventDefault(); restartSim() }}
        onClick={() => restartSim()}
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
