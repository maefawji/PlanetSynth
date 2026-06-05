// ── CollisionPanel.tsx ────────────────────────────────────────────────────────
// Left panel for collision / rendezvous settings per body and globally.

import { useCallback } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import { useControlSetStore } from '../../store/controlSetStore'
import { useTheme } from '../../lib/theme'
import { getPlanetLiveBodySnapshot } from './PlanetCanvas'

export function CollisionPanel() {
  const t = useTheme()
  const bodies       = usePlanetStore(s => s.bodies)
  const simParams    = usePlanetStore(s => s.simParams)
  const updateSimParams = usePlanetStore(s => s.updateSimParams)
  const updateBody   = usePlanetStore(s => s.updateBody)
  const rackOverrides   = useControlSetStore(s => s.rackParamOverrides)
  const setSlotOverride = useControlSetStore(s => s.setSlotOverride)

  const { collisionExcludeSun, collisionSpawnStar, collisionShowCircles, rendezvousDistance } = simParams

  const getBodyRdDist = useCallback((bodyId: string) => {
    const key = `b:${bodyId}:trigger:0`
    const ov = rackOverrides[key] ?? rackOverrides['g:trigger:0'] ?? {}
    return Number((ov as Record<string, unknown>).rendezvousDistance ?? 0)
  }, [rackOverrides])

  const setBodyRdDist = useCallback((bodyId: string, dist: number) => {
    const key = `b:${bodyId}:trigger:0`
    setSlotOverride(key, { rendezvousDistance: dist } as never)
  }, [setSlotOverride])

  const dim    = t.textDim
  const border = t.divider
  const panel  = t.tagBg

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 9, color: dim, width: 90, flexShrink: 0, textAlign: 'right' }}>{label}</span>
      {children}
    </div>
  )

  const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: '#f87171' }} />
      <span style={{ fontSize: 9, color: t.textMid }}>{label}</span>
    </label>
  )

  return (
    <div style={{ padding: '10px 12px', overflowY: 'auto', height: '100%' }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#f87171', marginBottom: 12 }}>
        Collision / Rendezvous
      </div>

      {/* ── Global settings ── */}
      <div style={{ background: panel, border: `0.5px solid ${border}`, borderRadius: 6, padding: '10px 10px', marginBottom: 10 }}>
        <div style={{ fontSize: 8, fontWeight: 700, color: dim, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Global</div>

        <Row label="Base distance">
          <input type="range" min={0} max={500} step={10} value={rendezvousDistance}
            onChange={e => updateSimParams({ rendezvousDistance: Number(e.target.value) })}
            style={{ flex: 1, accentColor: '#f87171' }} />
          <span style={{ fontSize: 8.5, fontFamily: 'monospace', color: '#f87171', width: 32, textAlign: 'right' }}>{rendezvousDistance}</span>
        </Row>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <Toggle checked={collisionExcludeSun ?? true} onChange={v => updateSimParams({ collisionExcludeSun: v })}
            label="Exclude sun / fixed bodies" />
          <Toggle checked={collisionSpawnStar ?? true} onChange={v => updateSimParams({ collisionSpawnStar: v })}
            label="Spawn trigger star on hit" />
          <Toggle checked={collisionShowCircles !== false} onChange={v => updateSimParams({ collisionShowCircles: v })}
            label="Show radius circles" />
        </div>
      </div>

      {/* ── Per-body settings ── */}
      <div style={{ background: panel, border: `0.5px solid ${border}`, borderRadius: 6, padding: '10px 10px' }}>
        <div style={{ fontSize: 8, fontWeight: 700, color: dim, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Per Body</div>
        {bodies.length === 0 && (
          <div style={{ fontSize: 9, color: dim, fontStyle: 'italic' }}>No bodies</div>
        )}
        {bodies.map(body => {
          const rdDist = getBodyRdDist(body.id)
          const isFixed = body.fixed
          const isExcluded = isFixed && (collisionExcludeSun ?? true)
          return (
            <div key={body.id} style={{
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7,
              opacity: isExcluded ? 0.35 : 1,
            }}>
              {/* Color dot + name */}
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: body.color, flexShrink: 0 }} />
              <span style={{ fontSize: 9, color: t.text, width: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {body.name}
              </span>
              {isFixed && (
                <span style={{ fontSize: 7, color: dim, flexShrink: 0, fontStyle: 'italic' }}>fixed</span>
              )}
              {/* Distance slider */}
              <input type="range" min={0} max={600} step={10} value={rdDist}
                disabled={isExcluded}
                onChange={e => setBodyRdDist(body.id, Number(e.target.value))}
                style={{ flex: 1, accentColor: body.color, minWidth: 0 }} />
              <span style={{ fontSize: 8, fontFamily: 'monospace', color: rdDist > 0 ? '#f87171' : dim, width: 28, textAlign: 'right', flexShrink: 0 }}>
                {rdDist > 0 ? rdDist : '—'}
              </span>
              {/* Clear button */}
              {rdDist > 0 && (
                <button onClick={() => setBodyRdDist(body.id, 0)}
                  style={{ fontSize: 9, color: dim, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>×</button>
              )}
            </div>
          )
        })}

        {/* Quick-set all planets */}
        {bodies.filter(b => !b.fixed).length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, borderTop: `0.5px solid ${border}`, paddingTop: 8 }}>
            <span style={{ fontSize: 8, color: dim, alignSelf: 'center' }}>set all planets:</span>
            {[0, 100, 200, 300].map(v => (
              <button key={v} onClick={() => bodies.filter(b => !b.fixed).forEach(b => setBodyRdDist(b.id, v))}
                style={{ fontSize: 8, padding: '2px 7px', borderRadius: 3, fontFamily: 'inherit', cursor: 'pointer',
                  border: `0.5px solid ${border}`, background: 'transparent', color: v === 0 ? dim : '#f87171' }}>
                {v === 0 ? 'off' : v}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
