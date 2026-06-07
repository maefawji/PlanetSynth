// ── CollisionPanel.tsx ────────────────────────────────────────────────────────
// Collision / rendezvous global settings.

import { usePlanetStore } from '../../store/planetStore'
import { useTheme } from '../../lib/theme'

function Toggle({ checked, onChange, label, textColor }: { checked: boolean; onChange: (v: boolean) => void; label: string; textColor: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: '#f87171' }} />
      <span style={{ fontSize: 9, color: textColor }}>{label}</span>
    </label>
  )
}

export function CollisionPanel() {
  const t = useTheme()
  const simParams       = usePlanetStore(s => s.simParams)
  const updateSimParams = usePlanetStore(s => s.updateSimParams)

  const { collisionExcludeSun, collisionSpawnStar, collisionShowCircles, rendezvousDistance } = simParams

  const dim    = t.textDim
  const border = t.divider
  const panel  = t.tagBg

  return (
    <div style={{ padding: '10px 12px', overflowY: 'auto', height: '100%' }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#f87171', marginBottom: 12 }}>
        Collision / Rendezvous
      </div>

      <div style={{ background: panel, border: `0.5px solid ${border}`, borderRadius: 6, padding: '10px 10px' }}>

        {/* Distance */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 9, color: dim, width: 72, flexShrink: 0, textAlign: 'right' }}>Distance</span>
          <input type="range" min={0} max={500} step={10} value={rendezvousDistance}
            onChange={e => updateSimParams({ rendezvousDistance: Number(e.target.value) })}
            style={{ flex: 1, accentColor: '#f87171' }} />
          <span style={{ fontSize: 8.5, fontFamily: 'monospace', color: '#f87171', width: 32, textAlign: 'right' }}>{rendezvousDistance}</span>
        </div>

        {/* Toggles */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <Toggle checked={collisionExcludeSun ?? true} onChange={v => updateSimParams({ collisionExcludeSun: v })}
            label="Exclude fixed bodies (sun)" textColor={t.textMid} />
          <Toggle checked={collisionSpawnStar ?? true} onChange={v => updateSimParams({ collisionSpawnStar: v })}
            label="Spawn trigger star on hit" textColor={t.textMid} />
          <Toggle checked={collisionShowCircles !== false} onChange={v => updateSimParams({ collisionShowCircles: v })}
            label="Show radius circles" textColor={t.textMid} />
        </div>
      </div>
    </div>
  )
}
