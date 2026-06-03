import { X } from 'lucide-react'
import { useMemo } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import { useWholeInstrumentStore, type WholeInstrumentSource, type WholeInstrumentType } from '../../store/wholeInstrumentStore'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import { getPlanetLiveBodySnapshot } from './PlanetCanvas'
import { computeOrbitTelemetry, type OrbitTelemetrySnapshot } from '../../lib/orbitTelemetry'
import { WHOLE_ORBIT_SOURCES, wholeOrbitSourceDef } from '../../lib/wholeOrbitSources'
import { mapWholeInstrument, wholeFeatureValues } from '../../lib/wholeInstrumentMapping'

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo))
}

function NumberControl({ label, value, min, max, step, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '58px 1fr 52px', alignItems: 'center', gap: 7 }}>
      <span style={{ fontSize: 8, color: 'var(--wi-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="planet-fader"
      />
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(clamp(Number(e.target.value), min, max))}
        style={{
          minWidth: 0,
          border: 'none',
          borderRadius: 4,
          padding: '3px 5px',
          background: 'var(--wi-input)',
          color: 'var(--wi-text)',
          fontSize: 9,
          fontFamily: 'monospace',
        }}
      />
    </label>
  )
}

function MiniWave({ feature, color }: { feature: number; color: string }) {
  const pts = useMemo(() => {
    const out: string[] = []
    const amp = 18 + feature * 26
    const freq = 1.1 + feature * 3.2
    for (let i = 0; i < 96; i++) {
      const x = (i / 95) * 100
      const y = 50 + Math.sin((i / 95) * Math.PI * 2 * freq) * amp * (0.55 + Math.sin(i * 0.19) * 0.18)
      out.push(`${x.toFixed(2)},${y.toFixed(2)}`)
    }
    return out.join(' ')
  }, [feature])
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
      {[0.25, 0.5, 0.75].map(y => (
        <line key={y} x1="0" x2="100" y1={y * 100} y2={y * 100} stroke="var(--wi-grid)" strokeWidth="0.5" />
      ))}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.35" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function FeatureBars({ values, active }: {
  values: Record<WholeInstrumentSource, number>
  active: WholeInstrumentSource
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {WHOLE_ORBIT_SOURCES.map(row => (
        <div key={row.key} style={{ display: 'grid', gridTemplateColumns: '62px 1fr 34px', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 8, color: row.key === active ? row.color : 'var(--wi-dim)', fontFamily: 'monospace', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
          <div style={{ height: 4, borderRadius: 3, background: 'var(--wi-input)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(values[row.key] * 100)}%`, height: '100%', background: row.color, opacity: row.key === active ? 0.95 : 0.42 }} />
          </div>
          <span style={{ fontSize: 8, color: 'var(--wi-dim)', fontFamily: 'monospace', textAlign: 'right' }}>{values[row.key].toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}

function computeWholeFeatures() {
  const live = getPlanetLiveBodySnapshot()
  const storeBodies = usePlanetStore.getState().bodies
  const byId = new Map(storeBodies.map(b => [b.id, b]))
  const bodies = live.map(b => ({ ...(byId.get(b.id) ?? {
    id: b.id, name: b.id, type: 'planet' as const, color: '#888', sampleId: null,
  }), ...b, z: byId.get(b.id)?.z ?? b.z ?? 0 }))
  if (bodies.length === 0) {
    const telemetry = computeOrbitTelemetry([])
    return {
      values: Object.fromEntries(WHOLE_ORBIT_SOURCES.map(source => [source.key, 0])) as Record<WholeInstrumentSource, number>,
      count: 0,
      telemetry,
    }
  }
  const telemetry = computeOrbitTelemetry(bodies)
  const values = wholeFeatureValues(telemetry)
  return {
    values,
    count: bodies.length,
    telemetry,
  }
}

function MappingRow({ label, value, detail, color }: { label: string; value: string; detail: string; color?: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '62px 74px 1fr', gap: 8, alignItems: 'baseline' }}>
      <span style={{ fontSize: 7.5, color: 'var(--wi-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right' }}>{label}</span>
      <span style={{ fontSize: 10, color: color ?? 'var(--wi-text)', fontFamily: 'monospace', fontWeight: 700 }}>{value}</span>
      <span style={{ fontSize: 8.5, color: 'var(--wi-dim)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>
    </div>
  )
}

export function WholeInstrumentPanel({ height }: { height: number }) {
  const simpleTheme = usePlanetStore(s => s.simParams.simpleTheme)
  const monochromeMode = useCanvasSettingsStore(s => s.monochromeMode)
  const simple = simpleTheme || monochromeMode
  const whole = useWholeInstrumentStore()
  const update = whole.updateWholeInstrument
  const close = whole.setPanelOpen
  const features = computeWholeFeatures()
  const feature = features.values[whole.source]
  const meta = wholeOrbitSourceDef(whole.source)
  const rawSourceValue = meta.rawValue(features.telemetry as OrbitTelemetrySnapshot)
  const mapped = mapWholeInstrument(whole, features.values)
  const mappedSynthesis = clamp(mapped.tension * 0.52 + mapped.width * 0.34 + features.values.speed * 0.14, 0, 1)

  const bg = simple ? 'rgba(246,246,243,0.98)' : '#0d0d16'
  const border = simple ? 'rgba(0,0,0,0.11)' : 'rgba(255,255,255,0.08)'
  const text = simple ? '#111827' : 'rgba(255,255,255,0.9)'
  const dim = simple ? 'rgba(0,0,0,0.46)' : 'rgba(255,255,255,0.38)'
  const input = simple ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'
  const grid = simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)'
  const accent = simple ? '#111827' : '#e5e7eb'
  const signalColor = meta.color
  const ready = whole.type !== 'off' && whole.volume > 0

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
        ['--wi-text' as string]: text,
        ['--wi-dim' as string]: dim,
        ['--wi-input' as string]: input,
        ['--wi-grid' as string]: grid,
      }}
    >
      <div style={{ height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderBottom: `0.5px solid ${border}` }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: accent }}>
          ∿ Whole Instrument
        </div>
        <div style={{ fontSize: 9, color: dim, fontFamily: 'monospace' }}>
          orbit information bus · {features.count} bodies · source {whole.source}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{
          fontSize: 8.5,
          fontWeight: 700,
          padding: '2px 7px',
          borderRadius: 4,
          background: ready ? 'rgba(34,197,94,0.12)' : input,
          color: ready ? '#22c55e' : dim,
          border: `0.5px solid ${ready ? 'rgba(34,197,94,0.3)' : border}`,
        }}>
          {ready ? '● wave drone' : '○ off'}
        </div>
        <button
          onClick={() => close(false)}
          title="Close Whole Instrument panel"
          style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 4, background: input, color: dim, cursor: 'pointer' }}
        >
          <X size={13} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 230, flexShrink: 0, borderRight: `0.5px solid ${border}`, display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 10px', overflowY: 'auto' }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Orbit Information Input</div>
          <div style={{ border: `0.5px solid ${border}`, borderRadius: 5, padding: 8 }}>
            <FeatureBars values={features.values} active={whole.source} />
          </div>
          <div style={{ border: `0.5px solid ${border}`, borderRadius: 5, padding: 8, fontSize: 8.5, color: dim, lineHeight: 1.45 }}>
            <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Raw Read</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 8px', fontFamily: 'monospace' }}>
              <span>body count</span><span>{features.telemetry.whole.bodyCount}</span>
              <span>total mass</span><span>{features.telemetry.whole.totalMass.toFixed(1)}</span>
              <span>avg speed</span><span>{features.telemetry.whole.avgSpeed.toFixed(2)}</span>
              <span>avg spread</span><span>{features.telemetry.whole.avgSpread.toFixed(1)}</span>
              <span>z spread</span><span>{features.telemetry.whole.zSpread.toFixed(1)}</span>
              <span>nearest</span><span>{features.telemetry.whole.nearestDistance.toFixed(1)}</span>
              <span>center x</span><span>{features.telemetry.whole.centerX.toFixed(1)}</span>
              <span>center y</span><span>{features.telemetry.whole.centerY.toFixed(1)}</span>
            </div>
          </div>
          <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Source</div>
          {WHOLE_ORBIT_SOURCES.map(source => (
            <button
              key={source.key}
              onClick={() => update({ source: source.key })}
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: '5px 8px',
                borderRadius: 4,
                border: `0.5px solid ${whole.source === source.key ? source.color + 'aa' : border}`,
                background: whole.source === source.key ? `${source.color}22` : 'transparent',
                color: whole.source === source.key ? source.color : dim,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
              }}
            >
              {source.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '10px 12px', gap: 8 }}>
          <div>
            <div style={{ fontSize: 8, color: dim, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
              Whole Signal <span style={{ marginLeft: 8, color: signalColor, fontFamily: 'monospace' }}>{whole.source}</span>
            </div>
            <div style={{ height: 92, borderRadius: 4, overflow: 'hidden', background: simple ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.03)' }}>
              <MiniWave feature={feature} color={signalColor} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: dim, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Synthesis</div>
            <div style={{ height: 74, borderRadius: 4, overflow: 'hidden', background: simple ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.03)' }}>
              <MiniWave feature={mappedSynthesis} color="#a78bfa" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            {[
              ['root', whole.rootNote.toFixed(0)],
              ['heard', mapped.rootNote.toFixed(0)],
              ['cutoff', `${Math.round(mapped.cutoff)}Hz`],
              ['level', mapped.level.toFixed(2)],
            ].map(([label, value]) => (
              <div key={label} style={{ border: `0.5px solid ${border}`, borderRadius: 4, padding: '8px 10px' }}>
                <div style={{ fontSize: 7.5, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 15, color: text, fontFamily: 'monospace', fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ border: `0.5px solid ${border}`, borderRadius: 5, padding: 10, minHeight: 0 }}>
            <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Mapping
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <MappingRow
                label="read"
                value={rawSourceValue.toFixed(whole.source === 'count' ? 0 : whole.source === 'speed' ? 2 : 1)}
                detail={`${meta.rawLabel}`}
                color={signalColor}
              />
              <MappingRow
                label="norm"
                value={feature.toFixed(3)}
                detail={meta.detail}
                color={signalColor}
              />
              <MappingRow
                label="cutoff"
                value={`${Math.round(mapped.cutoff)}Hz`}
                detail={`brightness ← z + speed`}
              />
              <MappingRow
                label="level"
                value={mapped.level.toFixed(3)}
                detail={`volume ← mass + count`}
              />
              <MappingRow
                label="lfo"
                value={`${mapped.lfoRate.toFixed(2)}Hz`}
                detail={`motion ← speed`}
              />
              <MappingRow
                label="depth"
                value={mapped.lfoDepth.toFixed(3)}
                detail={`depth ← spread + nearest`}
              />
              <MappingRow
                label="pan"
                value={mapped.pan.toFixed(3)}
                detail={`pan ← center x`}
              />
              <MappingRow
                label="notes"
                value={mapped.notes.join(' ')}
                detail={`root/register ← center y`}
              />
            </div>
          </div>
        </div>

        <div style={{ width: 250, flexShrink: 0, borderLeft: `0.5px solid ${border}`, padding: '10px 12px', overflowY: 'auto' }}>
          <div style={{ border: `0.5px solid ${border}`, borderRadius: 5, padding: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Instrument</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 9 }}>
              {([
                ['off', 'Off'],
                ['wave-drone', 'Wave Drone'],
              ] as [WholeInstrumentType, string][]).map(([type, label]) => (
                <button
                  key={type}
                  onClick={() => update({ type })}
                  style={{
                    flex: 1,
                    fontSize: 8.5,
                    fontWeight: 700,
                    padding: '5px 7px',
                    borderRadius: 4,
                    border: `0.5px solid ${whole.type === type ? '#a78bfa88' : border}`,
                    background: whole.type === type ? 'rgba(167,139,250,0.18)' : 'transparent',
                    color: whole.type === type ? '#a78bfa' : dim,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <NumberControl label="Volume" value={whole.volume} min={0} max={1} step={0.05} onChange={volume => update({ volume })} />
            <NumberControl label="Root" value={whole.rootNote} min={24} max={72} step={1} onChange={rootNote => update({ rootNote })} />
          </div>

          <div style={{ border: `0.5px solid ${border}`, borderRadius: 5, padding: 10 }}>
            <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Shape</div>
            <NumberControl label="Width" value={whole.width} min={0} max={1} step={0.05} onChange={width => update({ width })} />
            <NumberControl label="Motion" value={whole.motion} min={0} max={1} step={0.05} onChange={motion => update({ motion })} />
            <NumberControl label="Bright" value={whole.brightness} min={80} max={8000} step={100} onChange={brightness => update({ brightness })} />
          </div>
        </div>
      </div>
    </div>
  )
}
