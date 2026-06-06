import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import { useOrbitHubStore } from '../../store/orbitHubStore'
import { usePlanetStore } from '../../store/planetStore'
import { computeOrbitTelemetry } from '../../lib/orbitTelemetry'
import {
  ORBIT_HUB_FORMULA_DEFINITIONS,
  ORBIT_HUB_T_CALCULATION,
  ORBIT_HUB_TPERIOD_NOTE,
  ORBIT_HUB_VALUE_DEFINITIONS,
} from '../../lib/orbitDurationSource'
import { getPlanetLiveBodySnapshot } from './PlanetCanvas'

function Meter({ value, color = '#60a5fa' }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, value * 100))
  return (
    <div style={{ height: 4, borderRadius: 3, background: 'var(--oh-input)', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color }} />
    </div>
  )
}

function ValueCard({ label, value, norm, color }: { label: string; value: string; norm: number; color: string }) {
  return (
    <div style={{ border: '0.5px solid var(--oh-border)', borderRadius: 5, padding: '8px 9px' }}>
      <div style={{ fontSize: 7.5, color: 'var(--oh-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--oh-text)', fontFamily: 'monospace', fontWeight: 800, marginBottom: 6 }}>{value}</div>
      <Meter value={norm} color={color} />
    </div>
  )
}

export function OrbitHubPanel({ height }: { height: number }) {
  const simpleTheme = usePlanetStore(s => s.simParams.simpleTheme)
  const monochromeMode = useCanvasSettingsStore(s => s.monochromeMode)
  const storeBodies = usePlanetStore(s => s.bodies)
  const close = useOrbitHubStore(s => s.setPanelOpen)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (ts: number) => {
      if (ts - last > 120) {
        last = ts
        setTick(v => v + 1)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const telemetry = useMemo(() => {
    void tick
    const live = getPlanetLiveBodySnapshot()
    const liveById = new Map(live.map(b => [b.id, b]))
    return computeOrbitTelemetry(storeBodies.map(body => {
      const lb = liveById.get(body.id)
      return lb ? { ...body, x: lb.x, y: lb.y, vx: lb.vx, vy: lb.vy, ax: lb.ax, ay: lb.ay } : body
    }))
  }, [storeBodies, tick])

  const simple = simpleTheme || monochromeMode
  const bg = simple ? 'rgba(246,246,243,0.98)' : '#0d0d16'
  const border = simple ? 'rgba(0,0,0,0.11)' : 'rgba(255,255,255,0.08)'
  const text = simple ? '#111827' : 'rgba(255,255,255,0.9)'
  const dim = simple ? 'rgba(0,0,0,0.46)' : 'rgba(255,255,255,0.38)'
  const input = simple ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'

  return (
    <div
      style={{
        height,
        flexShrink: 0,
        background: bg,
        borderTop: `0.5px solid ${border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ['--oh-text' as string]: text,
        ['--oh-dim' as string]: dim,
        ['--oh-input' as string]: input,
        ['--oh-border' as string]: border,
      }}
    >
      <div style={{ height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderBottom: `0.5px solid ${border}` }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: text }}>Orbit Hub</div>
        <div style={{ fontSize: 9, color: dim, fontFamily: 'monospace' }}>telemetry monitor · normalized 0-1 · {telemetry.whole.bodyCount} bodies</div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 8.5, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: input, color: dim, border: `0.5px solid ${border}` }}>
          outputs disabled
        </div>
        <button
          onClick={() => close(false)}
          title="Close Orbit Hub"
          style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 4, background: input, color: dim, cursor: 'pointer' }}
        >
          <X size={13} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 285, flexShrink: 0, borderRight: `0.5px solid ${border}`, padding: 12, overflowY: 'auto' }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Whole Values</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <ValueCard label="count" value={String(telemetry.whole.bodyCount)} norm={Math.min(1, telemetry.whole.bodyCount / 16)} color="#818cf8" />
            <ValueCard label="mass" value={telemetry.whole.totalMass.toFixed(1)} norm={telemetry.whole.norm.totalMass} color="#fbbf24" />
            <ValueCard label="avg speed" value={telemetry.whole.avgSpeed.toFixed(2)} norm={telemetry.whole.norm.avgSpeed} color="#34d399" />
            <ValueCard label="avg spread" value={telemetry.whole.avgSpread.toFixed(1)} norm={telemetry.whole.norm.avgSpread} color="#60a5fa" />
            <ValueCard label="z spread" value={telemetry.whole.zSpread.toFixed(1)} norm={telemetry.whole.norm.zSpread} color="#f472b6" />
            <ValueCard label="near" value={telemetry.whole.nearestDistance.toFixed(1)} norm={telemetry.whole.norm.nearestDistance} color="#fb923c" />
          </div>
          <div style={{ fontSize: 8, color: dim, fontFamily: 'monospace', lineHeight: 1.55, marginTop: 10 }}>
            center = ({telemetry.whole.centerX.toFixed(1)}, {telemetry.whole.centerY.toFixed(1)})
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '10px 12px', overflow: 'hidden' }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Per Body Telemetry</div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: `0.5px solid ${border}`, borderRadius: 5 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9, color: text }}>
              <thead style={{ position: 'sticky', top: 0, background: bg, zIndex: 1 }}>
                <tr>
                  {['body', 'type', 'm', 'x', 'y', 'z', 'speed', 'dist', 'angle', 'norm'].map(h => (
                    <th key={h} style={{ textAlign: h === 'body' ? 'left' : 'right', padding: '6px 8px', color: dim, fontSize: 7.5, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `0.5px solid ${border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {telemetry.bodies.map(body => (
                  <tr key={body.id}>
                    <td style={{ padding: '5px 8px', borderBottom: `0.5px solid ${border}`, fontWeight: 700 }}>{body.name}</td>
                    <td style={{ padding: '5px 8px', borderBottom: `0.5px solid ${border}`, textAlign: 'right', color: dim }}>{body.type}</td>
                    <td style={{ padding: '5px 8px', borderBottom: `0.5px solid ${border}`, textAlign: 'right', fontFamily: 'monospace' }}>{body.mass.toFixed(1)}</td>
                    <td style={{ padding: '5px 8px', borderBottom: `0.5px solid ${border}`, textAlign: 'right', fontFamily: 'monospace' }}>{body.x.toFixed(1)}</td>
                    <td style={{ padding: '5px 8px', borderBottom: `0.5px solid ${border}`, textAlign: 'right', fontFamily: 'monospace' }}>{body.y.toFixed(1)}</td>
                    <td style={{ padding: '5px 8px', borderBottom: `0.5px solid ${border}`, textAlign: 'right', fontFamily: 'monospace' }}>{body.z.toFixed(1)}</td>
                    <td style={{ padding: '5px 8px', borderBottom: `0.5px solid ${border}`, textAlign: 'right', fontFamily: 'monospace' }}>{body.speed.toFixed(2)}</td>
                    <td style={{ padding: '5px 8px', borderBottom: `0.5px solid ${border}`, textAlign: 'right', fontFamily: 'monospace' }}>{body.distance.toFixed(1)}</td>
                    <td style={{ padding: '5px 8px', borderBottom: `0.5px solid ${border}`, textAlign: 'right', fontFamily: 'monospace' }}>{body.angleDeg.toFixed(1)}</td>
                    <td style={{ padding: '5px 8px', borderBottom: `0.5px solid ${border}`, minWidth: 86 }}>
                      <Meter value={body.norm.speed} color="#34d399" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ width: 245, flexShrink: 0, borderLeft: `0.5px solid ${border}`, padding: 12, overflowY: 'auto' }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Definitions</div>
          <div style={{ border: `0.5px solid ${border}`, borderRadius: 5, overflow: 'hidden', marginBottom: 12 }}>
            {ORBIT_HUB_VALUE_DEFINITIONS.map((definition, index) => (
              <div key={definition.symbol} style={{ padding: '7px 8px', borderTop: index ? `0.5px solid ${border}` : 'none', background: index % 2 ? 'transparent' : input }}>
                <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr auto', gap: 6, alignItems: 'baseline', marginBottom: 2 }}>
                  <span style={{ color: '#818cf8', fontFamily: 'monospace', fontSize: 11, fontWeight: 900 }}>{definition.symbol}</span>
                  <span style={{ color: text, fontSize: 8.5, fontWeight: 700 }}>{definition.label}</span>
                  <span style={{ color: dim, fontSize: 7, fontFamily: 'monospace' }}>{definition.unit}</span>
                </div>
                <div style={{ paddingLeft: 58, color: dim, fontSize: 7.5, lineHeight: 1.4 }}>{definition.description}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>T calculation</div>
          <div style={{ border: `0.5px solid ${border}`, borderRadius: 5, padding: 8, marginBottom: 12, background: input }}>
            {ORBIT_HUB_T_CALCULATION.map(line => (
              <div key={line} style={{ color: dim, fontSize: 7.5, fontFamily: 'monospace', lineHeight: 1.5 }}>{line}</div>
            ))}
            <div style={{ marginTop: 7, paddingTop: 7, borderTop: `0.5px solid ${border}`, color: '#818cf8', fontSize: 7.5, lineHeight: 1.45 }}>
              {ORBIT_HUB_TPERIOD_NOTE}
            </div>
          </div>
          <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Duration formulas</div>
          <div style={{ border: `0.5px solid ${border}`, borderRadius: 5, padding: 8, marginBottom: 12, background: input }}>
            {ORBIT_HUB_FORMULA_DEFINITIONS.map(definition => (
              <div key={definition.syntax} style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 7, marginBottom: 5 }}>
                <code style={{ color: '#818cf8', fontSize: 8.5 }}>{definition.syntax}</code>
                <span style={{ color: dim, fontSize: 7.5 }}>{definition.result}</span>
              </div>
            ))}
            <div style={{ marginTop: 7, paddingTop: 7, borderTop: `0.5px solid ${border}`, color: dim, fontSize: 7.5, lineHeight: 1.45 }}>
              Operators: * / ( )<br />
              Sampler update: evaluate on trigger, then hold until the next trigger.
            </div>
          </div>
          <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Outputs</div>
          {['Whole Instrument', 'MIDI CC', 'OSC / Max for Live', 'Export snapshot'].map((label, i) => (
            <div key={label} style={{ border: `0.5px solid ${border}`, borderRadius: 5, padding: 9, marginBottom: 8, opacity: i === 0 ? 1 : 0.55 }}>
              <div style={{ fontSize: 10, color: text, fontWeight: 700, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 8.5, color: dim, lineHeight: 1.45 }}>
                {i === 0 ? 'Reads whole normalized values internally.' : 'Reserved for external routing.'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
