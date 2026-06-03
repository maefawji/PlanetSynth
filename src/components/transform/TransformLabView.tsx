import { useEffect, useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import { useOrbitTransformStore, type OrbitTransformCurve, type OrbitTransformOutput } from '../../store/orbitTransformStore'
import { usePlanetStore, type PlanetBody } from '../../store/planetStore'
import { computeOrbitTelemetry } from '../../lib/orbitTelemetry'
import { evaluateOrbitTransform } from '../../lib/orbitTransform'
import { wholeFeatureValues } from '../../lib/wholeInstrumentMapping'
import { WHOLE_ORBIT_SOURCES } from '../../lib/wholeOrbitSources'
import { getPlanetLiveBodySnapshot } from '../planet/PlanetCanvas'

type LivePlanetBody = PlanetBody & { ax?: number; ay?: number }

const CURVES: OrbitTransformCurve[] = ['linear', 'ease-in', 'ease-out', 'smooth', 'invert']

const DESTINATIONS: Record<OrbitTransformOutput, string> = {
  level: 'instrument level',
  cutoff: 'filter cutoff',
  motion: 'lfo / motion',
  depth: 'lfo depth',
  pan: 'stereo pan',
  root: 'root/register',
  width: 'stereo width',
  tension: 'resonance / chord color',
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo))
}

function Meter({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ height: 4, borderRadius: 3, overflow: 'hidden', background: 'var(--tf-input)' }}>
      <div style={{ width: `${Math.round(clamp(value, 0, 1) * 100)}%`, height: '100%', background: color }} />
    </div>
  )
}

function NumberSlider({ label, value, min, max, step, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr 48px', gap: 8, alignItems: 'center' }}>
      <span style={{ fontSize: 8, color: 'var(--tf-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(2))}
        onChange={e => onChange(clamp(Number(e.target.value), min, max))}
        style={{
          minWidth: 0,
          border: 'none',
          borderRadius: 4,
          padding: '3px 5px',
          background: 'var(--tf-input)',
          color: 'var(--tf-text)',
          fontSize: 9,
          fontFamily: 'monospace',
        }}
      />
    </label>
  )
}

export function TransformLabView() {
  const storeBodies = usePlanetStore(s => s.bodies)
  const mono = useCanvasSettingsStore(s => s.monochromeMode)
  const inverted = useCanvasSettingsStore(s => s.monochromeInverted)
  const nodes = useOrbitTransformStore(s => s.nodes)
  const selectedNodeId = useOrbitTransformStore(s => s.selectedNodeId)
  const selectNode = useOrbitTransformStore(s => s.selectNode)
  const updateNode = useOrbitTransformStore(s => s.updateNode)
  const setWeight = useOrbitTransformStore(s => s.setWeight)
  const resetNode = useOrbitTransformStore(s => s.resetNode)
  const resetAll = useOrbitTransformStore(s => s.resetAll)
  const [liveBodies, setLiveBodies] = useState<LivePlanetBody[]>(storeBodies)

  useEffect(() => {
    let raf = 0
    function frame() {
      const live = getPlanetLiveBodySnapshot()
      const byId = new Map(storeBodies.map(b => [b.id, b]))
      setLiveBodies(live.length > 0
        ? live.map(b => ({ ...(byId.get(b.id) ?? {
            id: b.id, name: b.id, type: 'planet' as const, color: '#888', sampleId: null,
          }), ...b, z: byId.get(b.id)?.z ?? b.z ?? 0 }))
        : storeBodies)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [storeBodies])

  const telemetry = useMemo(() => computeOrbitTelemetry(liveBodies), [liveBodies])
  const sourceValues = useMemo(() => wholeFeatureValues(telemetry), [telemetry])
  const transformValues = useMemo(() => evaluateOrbitTransform(nodes, sourceValues), [nodes, sourceValues])
  const selectedNode = nodes[selectedNodeId]

  const bg = mono ? (inverted ? '#050505' : '#fff') : '#080a12'
  const fg = mono ? (inverted ? '#f7f7f7' : '#050505') : '#e5e7eb'
  const dim = mono ? (inverted ? '#a8a8a8' : '#777') : '#94a3b8'
  const panel = mono ? (inverted ? '#0d0d0d' : '#f7f7f7') : '#0d111c'
  const border = mono ? (inverted ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.14)') : 'rgba(148,163,184,0.18)'
  const input = mono ? (inverted ? '#171717' : '#ececec') : '#172033'
  const accent = '#a78bfa'

  return (
    <div
      style={{
        width: '100%', height: '100%', background: bg, color: fg,
        display: 'grid', gridTemplateRows: '42px 1fr', overflow: 'hidden',
        ['--tf-text' as string]: fg,
        ['--tf-dim' as string]: dim,
        ['--tf-input' as string]: input,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', borderBottom: `0.5px solid ${border}`, background: panel }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: accent }}>Transform Lab</span>
        <span style={{ fontSize: 10, color: dim, fontFamily: 'monospace' }}>orbit hub → transform nodes → instrument · {telemetry.whole.bodyCount} bodies</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={resetAll}
          style={{ display: 'flex', alignItems: 'center', gap: 5, border: `0.5px solid ${border}`, borderRadius: mono ? 1 : 5, background: input, color: dim, cursor: 'pointer', padding: '4px 8px', fontSize: 9, fontFamily: 'inherit' }}
        >
          <RotateCcw size={12} /> Reset
        </button>
      </div>

      <div style={{ minHeight: 0, display: 'grid', gridTemplateColumns: '285px 1fr 320px', gap: 14, padding: 14 }}>
        <section style={{ minHeight: 0, border: `0.5px solid ${border}`, background: panel, borderRadius: mono ? 1 : 8, padding: 12, overflow: 'auto' }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: dim, marginBottom: 10 }}>Orbit Hub</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {WHOLE_ORBIT_SOURCES.map(source => (
              <div key={source.key} style={{ border: `0.5px solid ${border}`, borderRadius: mono ? 1 : 6, padding: 9 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: source.color }}>{source.label}</span>
                  <span style={{ fontSize: 10, fontFamily: 'monospace' }}>{sourceValues[source.key].toFixed(3)}</span>
                </div>
                <div style={{ marginTop: 7 }}><Meter value={sourceValues[source.key]} color={source.color} /></div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ minHeight: 0, border: `0.5px solid ${border}`, background: panel, borderRadius: mono ? 1 : 8, overflow: 'hidden', position: 'relative' }}>
          <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <line x1="10%" y1="50%" x2="29%" y2="50%" stroke="#22d3ee" strokeOpacity="0.45" strokeWidth="2" />
            <line x1="70%" y1="50%" x2="91%" y2="50%" stroke="#a78bfa" strokeOpacity="0.45" strokeWidth="2" />
          </svg>
          <div style={{ position: 'absolute', left: '5%', top: '50%', transform: 'translateY(-50%)', width: 120, border: `0.5px solid #22d3ee88`, borderRadius: mono ? 1 : 7, background: bg, padding: 10 }}>
            <div style={{ fontSize: 8, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>source</div>
            <div style={{ marginTop: 6, fontSize: 13, color: '#22d3ee', fontWeight: 800 }}>Orbit Hub</div>
            <div style={{ marginTop: 4, fontSize: 9, color: dim, fontFamily: 'monospace' }}>{WHOLE_ORBIT_SOURCES.length} signals</div>
          </div>

          <div style={{ position: 'absolute', left: '31%', top: '8%', bottom: '8%', width: '38%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            {(Object.keys(nodes) as OrbitTransformOutput[]).map(id => {
              const node = nodes[id]
              const selected = id === selectedNodeId
              const value = transformValues[id]
              return (
                <button
                  key={id}
                  onClick={() => selectNode(id)}
                  style={{
                    textAlign: 'left',
                    border: `0.5px solid ${selected ? accent : border}`,
                    borderRadius: mono ? 1 : 7,
                    background: selected ? 'rgba(167,139,250,0.18)' : bg,
                    color: fg,
                    cursor: 'pointer',
                    padding: 10,
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 11, fontWeight: 800 }}>{node.label}</span>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: selected ? accent : dim }}>{value.toFixed(2)}</span>
                  </div>
                  <div style={{ marginTop: 7 }}><Meter value={value} color={selected ? accent : '#64748b'} /></div>
                  <div style={{ marginTop: 5, fontSize: 8, color: dim, fontFamily: 'monospace' }}>{node.curve}</div>
                </button>
              )
            })}
          </div>

          <div style={{ position: 'absolute', right: '5%', top: '50%', transform: 'translateY(-50%)', width: 140, border: `0.5px solid #a78bfa88`, borderRadius: mono ? 1 : 7, background: bg, padding: 10 }}>
            <div style={{ fontSize: 8, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>destination</div>
            <div style={{ marginTop: 6, fontSize: 13, color: accent, fontWeight: 800 }}>Instrument</div>
            <div style={{ marginTop: 4, fontSize: 9, color: dim, fontFamily: 'monospace' }}>whole params</div>
          </div>
        </section>

        <section style={{ minHeight: 0, border: `0.5px solid ${border}`, background: panel, borderRadius: mono ? 1 : 8, padding: 12, overflow: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: dim }}>Transform Node</div>
              <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color: accent }}>{selectedNode.label}</div>
            </div>
            <button onClick={() => resetNode(selectedNodeId)} style={{ border: `0.5px solid ${border}`, borderRadius: mono ? 1 : 5, background: input, color: dim, cursor: 'pointer', padding: '4px 7px', fontSize: 9, fontFamily: 'inherit' }}>Reset Node</button>
          </div>

          <div style={{ border: `0.5px solid ${border}`, borderRadius: mono ? 1 : 6, padding: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 8, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, marginBottom: 8 }}>Output</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontSize: 11, color: fg }}>{DESTINATIONS[selectedNodeId]}</span>
              <span style={{ fontSize: 16, color: accent, fontFamily: 'monospace', fontWeight: 800 }}>{transformValues[selectedNodeId].toFixed(3)}</span>
            </div>
            <div style={{ marginTop: 8 }}><Meter value={transformValues[selectedNodeId]} color={accent} /></div>
          </div>

          <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
            <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 8, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>Curve</span>
              <select
                value={selectedNode.curve}
                onChange={e => updateNode(selectedNodeId, { curve: e.target.value as OrbitTransformCurve })}
                style={{ border: 'none', borderRadius: 4, padding: '5px 7px', background: input, color: fg, fontSize: 10, fontFamily: 'inherit' }}
              >
                {CURVES.map(curve => <option key={curve} value={curve}>{curve}</option>)}
              </select>
            </label>
            <NumberSlider label="bias" value={selectedNode.bias} min={-1} max={1} step={0.01} onChange={bias => updateNode(selectedNodeId, { bias })} />
          </div>

          <div style={{ fontSize: 8, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, marginBottom: 8 }}>Source Weights</div>
          <div style={{ display: 'grid', gap: 7 }}>
            {WHOLE_ORBIT_SOURCES.map(source => (
              <NumberSlider
                key={source.key}
                label={source.label}
                value={selectedNode.weights[source.key] ?? 0}
                min={-1}
                max={1}
                step={0.01}
                onChange={weight => setWeight(selectedNodeId, source.key, weight)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
