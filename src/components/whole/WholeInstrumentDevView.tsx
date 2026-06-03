import { useEffect, useMemo, useState } from 'react'
import { getPlanetLiveBodySnapshot } from '../planet/PlanetCanvas'
import { computeOrbitTelemetry } from '../../lib/orbitTelemetry'
import { usePlanetStore, type PlanetBody } from '../../store/planetStore'
import { useWholeInstrumentStore, type WholeInstrumentSource, type WholeInstrumentType } from '../../store/wholeInstrumentStore'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import { WHOLE_ORBIT_SOURCES, wholeOrbitSourceDef } from '../../lib/wholeOrbitSources'
import { mapWholeInstrument, wholeFeatureValues } from '../../lib/wholeInstrumentMapping'

type LivePlanetBody = PlanetBody & { ax?: number; ay?: number }

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
}

function meterColor(source: WholeInstrumentSource): string {
  return wholeOrbitSourceDef(source).color
}

function NumberControl({
  label, value, min, max, step, onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '76px 1fr 48px', gap: 8, alignItems: 'center', fontSize: 10 }}>
      <span style={{ opacity: 0.58, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(step < 1 ? 2 : 0))}
        onChange={e => onChange(Number(e.target.value))}
        style={{ minWidth: 0, fontSize: 10, fontFamily: 'monospace', padding: '4px 5px', borderRadius: 4, border: '0.5px solid rgba(148,163,184,0.25)', background: 'rgba(148,163,184,0.10)', color: 'inherit' }}
      />
    </label>
  )
}

export function WholeInstrumentDevView() {
  const storeBodies = usePlanetStore(s => s.bodies)
  const whole = useWholeInstrumentStore()
  const update = whole.updateWholeInstrument
  const mono = useCanvasSettingsStore(s => s.monochromeMode)
  const inverted = useCanvasSettingsStore(s => s.monochromeInverted)
  const [liveBodies, setLiveBodies] = useState<LivePlanetBody[]>(storeBodies)
  const [nodeZoom, setNodeZoom] = useState(0.82)

  useEffect(() => {
    let raf = 0
    function frame() {
      const live = getPlanetLiveBodySnapshot()
      const byId = new Map(storeBodies.map(b => [b.id, b]))
      setLiveBodies(live.length > 0
        ? live.map(b => ({ ...(byId.get(b.id) ?? storeBodies.find(s => s.id === b.id) ?? {
            id: b.id, name: b.id, type: 'planet' as const, color: '#888', sampleId: null,
          }), ...b }))
        : storeBodies)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [storeBodies])

  const telemetry = useMemo(() => computeOrbitTelemetry(liveBodies), [liveBodies])
  const values = wholeFeatureValues(telemetry)
  const activeValue = clamp01(values[whole.source])
  const activeSource = wholeOrbitSourceDef(whole.source)
  const mapped = mapWholeInstrument(whole, values)

  const bg = mono ? (inverted ? '#050505' : '#fff') : '#080a12'
  const fg = mono ? (inverted ? '#f7f7f7' : '#050505') : '#e5e7eb'
  const dim = mono ? (inverted ? '#a8a8a8' : '#777') : '#94a3b8'
  const panel = mono ? (inverted ? '#0d0d0d' : '#f7f7f7') : '#0d111c'
  const border = mono ? (inverted ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.14)') : 'rgba(148,163,184,0.18)'
  const activeColor = meterColor(whole.source)
  const setClampedNodeZoom = (next: number) => setNodeZoom(Math.max(0.45, Math.min(1.6, next)))

  return (
    <div style={{ width: '100%', height: '100%', background: bg, color: fg, display: 'grid', gridTemplateRows: '42px 1fr', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', borderBottom: `0.5px solid ${border}`, background: panel }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: activeColor }}>Whole Instrument Lab</span>
        <span style={{ fontSize: 10, color: dim, fontFamily: 'monospace' }}>orbit hub → node map → whole instrument · {telemetry.whole.bodyCount} bodies</span>
      </div>

      <div style={{ minHeight: 0, display: 'grid', gridTemplateColumns: '300px 1fr 300px', gap: 14, padding: 14 }}>
        <section style={{ minHeight: 0, border: `0.5px solid ${border}`, background: panel, borderRadius: mono ? 1 : 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: dim }}>Orbit Hub Sources</div>
          <div style={{ minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 2 }}>
          {WHOLE_ORBIT_SOURCES.map(source => {
            const selected = whole.source === source.key
            const color = source.color
            const value = clamp01(values[source.key])
            return (
              <button
                key={source.key}
                onClick={() => update({ source: source.key })}
                style={{
                  textAlign: 'left',
                  border: `0.5px solid ${selected ? color : border}`,
                  background: selected ? `${color}22` : 'transparent',
                  color: selected ? color : fg,
                  borderRadius: mono ? 1 : 6,
                  padding: '8px 9px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 800 }}>
                  <span>{source.label}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{value.toFixed(2)}</span>
                </div>
                <div style={{ marginTop: 3, fontSize: 8, color: selected ? color : dim, fontFamily: 'monospace' }}>
                  raw {source.rawValue(telemetry).toFixed(source.key === 'count' ? 0 : source.key === 'speed' ? 2 : 1)} · {source.detail}
                </div>
                <div style={{ height: 3, marginTop: 6, background: mono ? (inverted ? '#222' : '#ddd') : '#172033', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${value * 100}%`, background: color }} />
                </div>
              </button>
            )
          })}
          </div>
          <div style={{ marginTop: 'auto', fontSize: 9, color: dim, lineHeight: 1.45, fontFamily: 'monospace' }}>
            center {telemetry.whole.centerX.toFixed(1)}, {telemetry.whole.centerY.toFixed(1)}<br />
            near {telemetry.whole.nearestDistance.toFixed(1)} · mass {telemetry.whole.totalMass.toFixed(1)}
          </div>
        </section>

        <section
          onWheel={e => {
            e.preventDefault()
            setClampedNodeZoom(nodeZoom + (e.deltaY > 0 ? -0.06 : 0.06))
          }}
          style={{ position: 'relative', minHeight: 0, border: `0.5px solid ${border}`, background: mono ? bg : 'radial-gradient(circle at 50% 50%, rgba(96,165,250,0.08), transparent 58%), #070a12', borderRadius: mono ? 1 : 8, overflow: 'hidden' }}
        >
          <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 4, display: 'flex', alignItems: 'center', gap: 4, padding: 4, borderRadius: mono ? 1 : 6, border: `0.5px solid ${border}`, background: panel }}>
            <button onClick={() => setClampedNodeZoom(nodeZoom - 0.12)} style={{ width: 24, height: 22, border: 'none', borderRadius: mono ? 1 : 4, background: 'rgba(148,163,184,0.14)', color: fg, cursor: 'pointer', fontFamily: 'monospace' }}>-</button>
            <span style={{ width: 42, textAlign: 'center', fontSize: 10, color: dim, fontFamily: 'monospace' }}>{Math.round(nodeZoom * 100)}%</span>
            <button onClick={() => setClampedNodeZoom(nodeZoom + 0.12)} style={{ width: 24, height: 22, border: 'none', borderRadius: mono ? 1 : 4, background: 'rgba(148,163,184,0.14)', color: fg, cursor: 'pointer', fontFamily: 'monospace' }}>+</button>
            <button onClick={() => setNodeZoom(0.82)} style={{ height: 22, border: 'none', borderRadius: mono ? 1 : 4, background: 'rgba(148,163,184,0.14)', color: dim, cursor: 'pointer', fontSize: 9, fontFamily: 'inherit' }}>Reset</button>
          </div>
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 780,
              height: 620,
              transform: `translate(-50%, -50%) scale(${nodeZoom})`,
              transformOrigin: 'center center',
            }}
          >
            <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
              <line x1="20%" y1="42%" x2="50%" y2="42%" stroke={activeColor} strokeWidth="2" strokeOpacity="0.75" />
              <line x1="50%" y1="42%" x2="78%" y2="34%" stroke="#22d3ee" strokeWidth="2" strokeOpacity="0.55" />
              <line x1="50%" y1="42%" x2="78%" y2="50%" stroke="#a78bfa" strokeWidth="2" strokeOpacity="0.45" />
              <line x1="50%" y1="42%" x2="78%" y2="66%" stroke="#fbbf24" strokeWidth="2" strokeOpacity="0.35" />
            </svg>
            <div style={{ position: 'absolute', left: '8%', top: '31%', width: 170, border: `0.5px solid ${activeColor}`, background: panel, borderRadius: mono ? 1 : 8, padding: 12 }}>
              <div style={{ fontSize: 10, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>source node</div>
              <div style={{ marginTop: 8, fontSize: 18, fontWeight: 800, color: activeColor }}>{activeSource.label}</div>
              <div style={{ marginTop: 10, fontSize: 11, fontFamily: 'monospace' }}>norm {activeValue.toFixed(3)}</div>
              <div style={{ marginTop: 4, fontSize: 10, color: dim, fontFamily: 'monospace' }}>{activeSource.rawLabel}</div>
            </div>
            <div style={{ position: 'absolute', left: '39%', top: '32%', width: 180, border: `0.5px solid ${border}`, background: panel, borderRadius: mono ? 1 : 8, padding: 12 }}>
              <div style={{ fontSize: 10, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>mapper</div>
              <div style={{ marginTop: 8, display: 'grid', gap: 6, fontSize: 11, fontFamily: 'monospace' }}>
                <span>level = mass + count</span>
                <span>cutoff = z + speed</span>
                <span>lfo = speed + motion</span>
                <span>pan = center-x * spread</span>
                <span>root = root + center-y</span>
              </div>
            </div>
            <div style={{ position: 'absolute', right: '7%', top: '22%', width: 190, display: 'grid', gap: 10 }}>
              {[
                ['cutoff', `${Math.round(mapped.cutoff)} Hz`, '#22d3ee'],
                ['level', mapped.level.toFixed(2), '#34d399'],
                ['lfo rate', `${mapped.lfoRate.toFixed(2)} Hz`, '#a78bfa'],
                ['pan', mapped.pan.toFixed(2), '#fbbf24'],
                ['notes', mapped.notes.join(' '), '#f472b6'],
              ].map(([label, value, color]) => (
                <div key={label} style={{ border: `0.5px solid ${border}`, background: panel, borderRadius: mono ? 1 : 8, padding: 10 }}>
                  <div style={{ fontSize: 10, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>{label}</div>
                  <div style={{ marginTop: 6, fontSize: 15, fontWeight: 800, color }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section style={{ minHeight: 0, border: `0.5px solid ${border}`, background: panel, borderRadius: mono ? 1 : 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: dim }}>Mini Window Controls</span>
            <span style={{ fontSize: 10, color: activeColor, fontFamily: 'monospace' }}>{whole.source}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['off', 'wave-drone'] as WholeInstrumentType[]).map(type => (
              <button
                key={type}
                onClick={() => update({ type })}
                style={{
                  flex: 1,
                  border: `0.5px solid ${whole.type === type ? activeColor : border}`,
                  background: whole.type === type ? `${activeColor}1f` : 'transparent',
                  color: whole.type === type ? activeColor : fg,
                  borderRadius: mono ? 1 : 6,
                  padding: '7px 8px',
                  fontSize: 10,
                  fontWeight: 800,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >{type}</button>
            ))}
          </div>
          <NumberControl label="volume" value={whole.volume} min={0} max={1} step={0.01} onChange={volume => update({ volume })} />
          <NumberControl label="root" value={whole.rootNote} min={24} max={72} step={1} onChange={rootNote => update({ rootNote })} />
          <NumberControl label="width" value={whole.width} min={0} max={1} step={0.01} onChange={width => update({ width })} />
          <NumberControl label="motion" value={whole.motion} min={0} max={1} step={0.01} onChange={motion => update({ motion })} />
          <NumberControl label="bright" value={whole.brightness} min={80} max={8000} step={10} onChange={brightness => update({ brightness })} />
        </section>
      </div>
    </div>
  )
}
