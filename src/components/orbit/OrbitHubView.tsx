import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import { usePlanetStore, type PlanetBody } from '../../store/planetStore'
import { computeOrbitTelemetry } from '../../lib/orbitTelemetry'
import { WHOLE_ORBIT_SOURCES } from '../../lib/wholeOrbitSources'
import { getPlanetLiveBodySnapshot } from '../planet/PlanetCanvas'

type LivePlanetBody = PlanetBody & { ax?: number; ay?: number }

// Rolling average buffer per body per metric
type BodyMetricKey = 'x' | 'y' | 'z' | 'vx' | 'vy' | 'speed' | 'distance' | 'angleDeg'
const AVG_WINDOW = 120 // ~2s at 60fps
type AvgBuffers = Map<string, Map<BodyMetricKey, number[]>>

function pushAvg(buf: AvgBuffers, id: string, key: BodyMetricKey, val: number) {
  if (!buf.has(id)) buf.set(id, new Map())
  const m = buf.get(id)!
  if (!m.has(key)) m.set(key, [])
  const arr = m.get(key)!
  arr.push(val)
  if (arr.length > AVG_WINDOW) arr.shift()
}

function getAvg(buf: AvgBuffers, id: string, key: BodyMetricKey): number | null {
  const arr = buf.get(id)?.get(key)
  if (!arr || arr.length === 0) return null
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function Meter({ value, color }: { value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, value * 100))
  return (
    <div style={{ height: 5, borderRadius: 3, background: 'var(--oh-input)', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color }} />
    </div>
  )
}

export function OrbitHubView() {
  const storeBodies = usePlanetStore(s => s.bodies)
  const mono = useCanvasSettingsStore(s => s.monochromeMode)
  const inverted = useCanvasSettingsStore(s => s.monochromeInverted)
  const [liveBodies, setLiveBodies] = useState<LivePlanetBody[]>(storeBodies)
  const avgBuf = useRef<AvgBuffers>(new Map())
  const [avgSnap, setAvgSnap] = useState<AvgBuffers>(new Map())
  const [showAvg, setShowAvg] = useState(false)

  useEffect(() => {
    let raf = 0
    let frameCount = 0
    function frame() {
      const live = getPlanetLiveBodySnapshot()
      const byId = new Map(storeBodies.map(b => [b.id, b]))
      const bodies = live.length > 0
        ? live.map(b => ({ ...(byId.get(b.id) ?? {
            id: b.id, name: b.id, type: 'planet' as const, color: '#888', sampleId: null,
          }), ...b, z: byId.get(b.id)?.z ?? b.z ?? 0 }))
        : storeBodies
      setLiveBodies(bodies)
      // update rolling buffers
      for (const b of bodies) {
        const tel = b as Record<string, number>
        for (const key of ['x','y','z','vx','vy','speed','distance','angleDeg'] as BodyMetricKey[]) {
          const v = tel[key]
          if (typeof v === 'number') pushAvg(avgBuf.current, b.id, key, v)
        }
      }
      // snapshot avg every 10 frames
      frameCount++
      if (frameCount % 10 === 0) setAvgSnap(new Map(avgBuf.current))
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [storeBodies])

  const telemetry = useMemo(() => computeOrbitTelemetry(liveBodies), [liveBodies])
  const bg = mono ? (inverted ? '#050505' : '#fff') : '#080a12'
  const fg = mono ? (inverted ? '#f7f7f7' : '#050505') : '#e5e7eb'
  const dim = mono ? (inverted ? '#a8a8a8' : '#777') : '#94a3b8'
  const panel = mono ? (inverted ? '#0d0d0d' : '#f7f7f7') : '#0d111c'
  const border = mono ? (inverted ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.14)') : 'rgba(148,163,184,0.18)'
  const input = mono ? (inverted ? '#171717' : '#ececec') : '#172033'

  return (
    <div
      style={{
        width: '100%', height: '100%', background: bg, color: fg,
        display: 'grid', gridTemplateRows: '42px 1fr', overflow: 'hidden',
        ['--oh-input' as string]: input,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', borderBottom: `0.5px solid ${border}`, background: panel }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#22d3ee' }}>Orbit Hub</span>
        <span style={{ fontSize: 10, color: dim, fontFamily: 'monospace' }}>telemetry monitor · routing source bank · {telemetry.whole.bodyCount} bodies</span>
      </div>

      <div style={{ minHeight: 0, display: 'grid', gridTemplateColumns: '340px 1fr 260px', gap: 14, padding: 14 }}>
        <section style={{ minHeight: 0, border: `0.5px solid ${border}`, background: panel, borderRadius: mono ? 1 : 8, padding: 12, overflow: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: dim, marginBottom: 10 }}>Whole Source Bank</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {WHOLE_ORBIT_SOURCES.map(source => {
              const norm = source.value(telemetry)
              const raw = source.rawValue(telemetry)
              return (
                <div key={source.key} style={{ border: `0.5px solid ${border}`, borderRadius: mono ? 1 : 7, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: source.color }}>{source.label}</span>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: fg }}>{norm.toFixed(2)}</span>
                  </div>
                  <div style={{ marginTop: 5, fontSize: 9, color: dim, fontFamily: 'monospace' }}>
                    raw {raw.toFixed(source.key === 'count' ? 0 : source.key === 'speed' ? 2 : 1)}
                  </div>
                  <div style={{ marginTop: 8 }}><Meter value={norm} color={source.color} /></div>
                </div>
              )
            })}
          </div>
        </section>

        <section style={{ minHeight: 0, border: `0.5px solid ${border}`, background: panel, borderRadius: mono ? 1 : 8, padding: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: dim }}>Per Body Telemetry</div>
            <button onClick={() => setShowAvg(v => !v)} style={{
              fontSize: 8, padding: '2px 8px', borderRadius: 4, fontFamily: 'inherit', cursor: 'pointer',
              border: `0.5px solid ${showAvg ? '#22d3ee88' : border}`,
              background: showAvg ? 'rgba(34,211,238,0.12)' : 'transparent',
              color: showAvg ? '#22d3ee' : dim,
            }}>{showAvg ? '⌀ avg ON' : '⌀ avg'}</button>
            {showAvg && <span style={{ fontSize: 8, color: dim, fontFamily: 'monospace' }}>~{AVG_WINDOW} frames</span>}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: `0.5px solid ${border}`, borderRadius: mono ? 1 : 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
              <thead style={{ position: 'sticky', top: 0, background: panel }}>
                <tr>
                  {['body','type','m','x','y','z','vx','vy','speed','dist','angle'].map(h => (
                    <th key={h} style={{ textAlign: h === 'body' ? 'left' : 'right', padding: '7px 8px', color: dim, fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `0.5px solid ${border}` }}>{h}</th>
                  ))}
                  {showAvg && (['⌀x','⌀y','⌀spd','⌀dist'].map(h => (
                    <th key={h} style={{ textAlign: 'right', padding: '7px 8px', color: '#22d3ee88', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `0.5px solid ${border}` }}>{h}</th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {telemetry.bodies.map(body => {
                  const avgX    = getAvg(avgSnap, body.id, 'x')
                  const avgY    = getAvg(avgSnap, body.id, 'y')
                  const avgSpd  = getAvg(avgSnap, body.id, 'speed')
                  const avgDist = getAvg(avgSnap, body.id, 'distance')
                  return (
                    <tr key={body.id}>
                      <td style={{ padding: '6px 8px', borderBottom: `0.5px solid ${border}`, fontWeight: 800 }}>{body.name}</td>
                      <td style={{ padding: '6px 8px', borderBottom: `0.5px solid ${border}`, textAlign: 'right', color: dim }}>{body.type}</td>
                      {[body.mass, body.x, body.y, body.z, body.vx, body.vy, body.speed, body.distance, body.angleDeg].map((v, i) => (
                        <td key={i} style={{ padding: '6px 8px', borderBottom: `0.5px solid ${border}`, textAlign: 'right', fontFamily: 'monospace' }}>{v.toFixed(i >= 4 && i <= 6 ? 2 : 1)}</td>
                      ))}
                      {showAvg && [avgX, avgY, avgSpd, avgDist].map((v, i) => (
                        <td key={`avg${i}`} style={{ padding: '6px 8px', borderBottom: `0.5px solid ${border}`, textAlign: 'right', fontFamily: 'monospace', color: '#22d3ee' }}>
                          {v !== null ? v.toFixed(i >= 2 ? 2 : 1) : '—'}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ minHeight: 0, border: `0.5px solid ${border}`, background: panel, borderRadius: mono ? 1 : 8, padding: 12, overflow: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: dim, marginBottom: 10 }}>Routing Outputs</div>
          {['Whole Instrument', 'Ableton / MIDI CC', 'OSC / Max for Live', 'Snapshot Export'].map((label, i) => (
            <div key={label} style={{ border: `0.5px solid ${border}`, borderRadius: mono ? 1 : 7, padding: 10, marginBottom: 9, opacity: i === 0 ? 1 : 0.6 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: i === 0 ? '#22d3ee' : fg }}>{label}</div>
              <div style={{ marginTop: 5, fontSize: 9, color: dim, lineHeight: 1.45 }}>
                {i === 0 ? 'Whole Lab reads these normalized source values.' : 'Reserved routing surface.'}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
