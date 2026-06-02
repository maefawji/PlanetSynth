import { useState, useRef, useEffect, useCallback } from 'react'
import * as Tone from 'tone'
import {
  AmbientOscillatorEngine,
  type AmbientOscillatorParams,
  type LfoTarget,
  midiToHz,
} from '../../audio/AmbientOscillatorEngine'

// ── Orbit + Trail data ────────────────────────────────────────────────────────

interface TrailPoint { x: number; y: number }

interface OrbitSnapshot {
  T: number; ecc: number; r: number; speed: number; accel: number
  omega: number; angleDeg: number; lfoPhase: number
  bound: boolean; centerName: string
}

type OrbitSrc = 'period' | 'eccentricity' | 'distance' | 'velocity' | 'accel'

interface OrbitMapping { src: OrbitSrc; rate: number }

const DEFAULT_MAPPINGS: Record<string, { src: OrbitSrc; rate: number; min: number; max: number; label: string }> = {
  attack:  { src: 'period',       rate: 0.06,  min: 0.001, max: 20,    label: 'A' },
  decay:   { src: 'eccentricity', rate: 8.0,   min: 0.01,  max: 10,    label: 'D' },
  sustain: { src: 'distance',     rate: 0.003, min: 0,     max: 1,     label: 'S' },
  release: { src: 'period',       rate: 0.2,   min: 0.01,  max: 30,    label: 'R' },
  cutoff:  { src: 'velocity',     rate: 600,   min: 80,    max: 12000, label: 'Cut' },
  lfoRate: { src: 'eccentricity', rate: 5.0,   min: 0.01,  max: 20,    label: 'LFO R' },
  lfoDepth:{ src: 'eccentricity', rate: 0.8,   min: 0,     max: 1,     label: 'LFO D' },
}

function orbitVal(src: OrbitSrc, orbit: OrbitSnapshot): number {
  if (src === 'period')       return isFinite(orbit.T) ? orbit.T : 4
  if (src === 'eccentricity') return orbit.ecc
  if (src === 'distance')     return orbit.r
  if (src === 'velocity')     return orbit.speed
  if (src === 'accel')        return orbit.accel * 100
  return 0
}
type Signal = 'x' | 'y' | 'r' | 'angle' | 'speed'

const SIGNAL_CFG = [
  { key: 'x'     as Signal, label: 'X',   color: '#60a5fa', desc: 'X world coord' },
  { key: 'y'     as Signal, label: 'Y',   color: '#34d399', desc: 'Y world coord' },
  { key: 'r'     as Signal, label: 'r',   color: '#a78bfa', desc: '√(x²+y²)' },
  { key: 'angle' as Signal, label: 'θ',   color: '#fbbf24', desc: 'atan2(y,x)' },
  { key: 'speed' as Signal, label: 'spd', color: '#f87171', desc: '|Δpos|' },
]

function extractSignal(pts: TrailPoint[], sig: Signal): number[] {
  if (sig === 'x')     return pts.map(p => p.x)
  if (sig === 'y')     return pts.map(p => p.y)
  if (sig === 'r')     return pts.map(p => Math.sqrt(p.x * p.x + p.y * p.y))
  if (sig === 'angle') return pts.map(p => Math.atan2(p.y, p.x))
  return pts.map((p, i) => {
    if (i === 0) return 0
    const dx = p.x - pts[i-1].x, dy = p.y - pts[i-1].y
    return Math.sqrt(dx*dx + dy*dy)
  })
}
function normalize(arr: number[]): number[] {
  const min = Math.min(...arr), max = Math.max(...arr), range = max - min || 1
  return arr.map(v => (v - min) / range * 2 - 1)
}

// ── Note helpers ──────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
const midiToName = (n: number) => `${NOTE_NAMES[n%12]}${Math.floor(n/12)-1}`
const isBlack    = (n: number) => [1,3,6,8,10].includes(n%12)

// ── Oscilloscope ──────────────────────────────────────────────────────────────

function Oscilloscope({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef(0)
  useEffect(() => {
    if (!analyser || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx2   = canvas.getContext('2d')!
    const buf    = new Float32Array(analyser.fftSize)
    function draw() {
      rafRef.current = requestAnimationFrame(draw)
      analyser.getFloatTimeDomainData(buf)
      const W = canvas.width, H = canvas.height, mid = H/2
      ctx2.fillStyle = '#080810'; ctx2.fillRect(0,0,W,H)
      ctx2.strokeStyle = 'rgba(129,140,248,0.07)'; ctx2.lineWidth = 0.5
      for (let g=0; g<=4; g++) { const y=(g/4)*H; ctx2.beginPath(); ctx2.moveTo(0,y); ctx2.lineTo(W,y); ctx2.stroke() }
      for (let g=0; g<=8; g++) { const x=(g/8)*W; ctx2.beginPath(); ctx2.moveTo(x,0); ctx2.lineTo(x,H); ctx2.stroke() }
      ctx2.strokeStyle = 'rgba(129,140,248,0.22)'; ctx2.lineWidth = 0.75
      ctx2.beginPath(); ctx2.moveTo(0,mid); ctx2.lineTo(W,mid); ctx2.stroke()
      let start = 0
      for (let i=1; i<buf.length-1; i++) { if (buf[i-1]<0 && buf[i]>=0) { start=i; break } }
      let peak = 0; for (const s of buf) peak = Math.max(peak, Math.abs(s))
      const clipping = peak >= 0.99, hot = peak > 0.92
      const waveColor = clipping ? '#ef4444' : hot ? '#fbbf24' : peak > 0.01 ? '#818cf8' : 'rgba(129,140,248,0.3)'
      ctx2.strokeStyle = waveColor; ctx2.lineWidth = 1.5
      ctx2.shadowColor = waveColor; ctx2.shadowBlur = peak > 0.01 ? 4 : 0
      ctx2.beginPath()
      const drawLen = Math.min(buf.length - start, W*2)
      for (let i=0; i<drawLen; i++) {
        const x = (i/drawLen)*W, y = mid - buf[start+i]*mid*0.9
        i===0 ? ctx2.moveTo(x,y) : ctx2.lineTo(x,y)
      }
      ctx2.stroke(); ctx2.shadowBlur = 0
      const barW = 3, levelH = Math.min(1,peak*1.2)*H
      ctx2.fillStyle = clipping ? '#ef4444' : hot ? '#fbbf24' : 'rgba(129,140,248,0.5)'
      ctx2.fillRect(W-barW, H-levelH, barW, levelH)
    }
    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [analyser])
  return <canvas ref={canvasRef} width={800} height={120} style={{ width:'100%', height:120, display:'block', borderRadius:4 }} />
}

// ── Trail waveform canvas ─────────────────────────────────────────────────────

function TrailWaveform({ pts, signals, zoom, offset }: {
  pts: TrailPoint[]; signals: Signal[]; zoom: number; offset: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0,0,W,H)
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5
    for (let y=0; y<=4; y++) { const py=H/4*y; ctx.beginPath(); ctx.moveTo(0,py); ctx.lineTo(W,py); ctx.stroke() }
    for (let x=0; x<=8; x++) { const px=W/8*x; ctx.beginPath(); ctx.moveTo(px,0); ctx.lineTo(px,H); ctx.stroke() }
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke()
    const total = pts.length, viewLen = Math.max(2, Math.floor(total/zoom))
    const start = Math.floor(offset*(total-viewLen))
    const slice = pts.slice(start, start+viewLen)
    signals.forEach(sig => {
      const cfg = SIGNAL_CFG.find(s => s.key === sig)!
      const norm = normalize(extractSignal(slice, sig))
      ctx.beginPath(); ctx.strokeStyle = cfg.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'
      norm.forEach((v,i) => {
        const px=(i/(norm.length-1))*W, py=((1-v)/2)*H
        i===0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py)
      })
      ctx.stroke()
    })
  }, [pts, signals, zoom, offset])
  return <canvas ref={canvasRef} width={1200} height={120} style={{ width:'100%', height:120, display:'block', borderRadius:4 }} />
}

// ── Synthesis waveform (sum of checked signals, normalized) ───────────────────

function makeFallbackPts(wf: string, n = 512): TrailPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / n
    let y: number
    if (wf === 'triangle') y = t < 0.5 ? 4*t-1 : 3-4*t
    else if (wf === 'sawtooth') y = 2*t - 1
    else if (wf === 'square')   y = t < 0.5 ? 1 : -1
    else                        y = Math.sin(2*Math.PI*t)  // sine default
    return { x: i, y }
  })
}

function SynthesisWaveform({ pts, signals, zoom, offset, dimColor, fallbackWaveformLeft, fallbackWaveformRight }: {
  pts: TrailPoint[]; signals: Signal[]; zoom: number; offset: number; dimColor: string; fallbackWaveformLeft?: string; fallbackWaveformRight?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0,0,W,H)
    ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(0,0,W,H)
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5
    for (let y=0;y<=4;y++){const py=H/4*y;ctx.beginPath();ctx.moveTo(0,py);ctx.lineTo(W,py);ctx.stroke()}
    ctx.strokeStyle='rgba(255,255,255,0.09)';ctx.beginPath();ctx.moveTo(0,H/2);ctx.lineTo(W,H/2);ctx.stroke()

    // fallback: draw standard waveform when no trail
    if (pts.length < 2 || signals.length === 0) {
      if (fallbackWaveformLeft) {
        const left = makeFallbackPts(fallbackWaveformLeft)
        const right = makeFallbackPts(fallbackWaveformRight ?? fallbackWaveformLeft)
        const drawFallback = (fbPts: TrailPoint[], color: string, alpha: number) => {
          ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.globalAlpha = alpha; ctx.lineJoin='round'
          fbPts.forEach((p,i) => {
            const px = (i/(fbPts.length-1))*W, py = ((1-p.y)/2)*H
            i===0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py)
          })
          ctx.stroke(); ctx.globalAlpha = 1
        }
        if (fallbackWaveformRight && fallbackWaveformRight !== fallbackWaveformLeft) {
          drawFallback(left, '#60a5fa', 0.55)
          drawFallback(right, '#34d399', 0.55)
        } else {
          drawFallback(left, '#a78bfa', 0.6)
        }
      } else {
        ctx.fillStyle = dimColor; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
        ctx.fillText('← paste trail JSON', W/2, H/2 + 4)
      }
      return
    }
    const total = pts.length, viewLen = Math.max(2, Math.floor(total/zoom))
    const start = Math.floor(offset*(total-viewLen))
    const slice = pts.slice(start, start+viewLen)
    // per-signal: normalize individually then sum
    const normed = signals.map(sig => normalize(extractSignal(slice, sig)))
    const summed = normed[0].map((_, i) => normed.reduce((acc, arr) => acc + arr[i], 0))
    const sum_norm = normalize(summed)
    // draw each original (faint) behind the sum
    signals.forEach((sig, si) => {
      const cfg = SIGNAL_CFG.find(s=>s.key===sig)!
      ctx.beginPath(); ctx.strokeStyle = cfg.color; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.25
      normed[si].forEach((v,i)=>{const px=(i/(normed[si].length-1))*W,py=((1-v)/2)*H;i===0?ctx.moveTo(px,py):ctx.lineTo(px,py)})
      ctx.stroke()
    })
    ctx.globalAlpha = 1
    // draw sum
    ctx.beginPath(); ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2; ctx.lineJoin='round'
    sum_norm.forEach((v,i)=>{const px=(i/(sum_norm.length-1))*W,py=((1-v)/2)*H;i===0?ctx.moveTo(px,py):ctx.lineTo(px,py)})
    ctx.stroke()
  }, [pts, signals, zoom, offset, dimColor, fallbackWaveformLeft, fallbackWaveformRight])
  return <canvas ref={canvasRef} width={1200} height={100} style={{width:'100%',height:100,display:'block',borderRadius:4}} />
}

// ── Mini keyboard ─────────────────────────────────────────────────────────────

function MiniKeyboard({ activeNote, onNoteOn, onNoteOff }: { activeNote: number|null; onNoteOn:(n:number)=>void; onNoteOff:(n:number)=>void }) {
  const loNote=48, hiNote=84
  const whites = Array.from({length:hiNote-loNote+1},(_,i)=>i+loNote).filter(n=>!isBlack(n))
  const accent = '#818cf8'
  return (
    <div style={{ position:'relative', height:52, display:'flex', userSelect:'none' }}>
      {whites.map(note => (
        <div key={note} onMouseDown={()=>onNoteOn(note)} onMouseUp={()=>onNoteOff(note)} onMouseLeave={()=>{ if(activeNote===note) onNoteOff(note) }}
          style={{ flex:1, height:'100%', border:'0.5px solid rgba(255,255,255,0.12)', borderRadius:'0 0 2px 2px', cursor:'pointer',
            background: activeNote===note ? `${accent}66` : 'rgba(255,255,255,0.86)', transition:'background 0.04s' }} />
      ))}
      {Array.from({length:hiNote-loNote+1},(_,i)=>i+loNote).filter(n=>isBlack(n)).map(note => {
        const whitesBefore = Array.from({length:note-loNote},(_,i)=>i+loNote).filter(n=>!isBlack(n)).length
        const left=(whitesBefore/whites.length)*100, width=(0.6/whites.length)*100
        return (
          <div key={note} onMouseDown={e=>{e.stopPropagation();onNoteOn(note)}} onMouseUp={e=>{e.stopPropagation();onNoteOff(note)}} onMouseLeave={()=>{ if(activeNote===note) onNoteOff(note) }}
            style={{ position:'absolute', top:0, left:`${left}%`, width:`${width}%`, height:'62%', borderRadius:'0 0 2px 2px', cursor:'pointer',
              background: activeNote===note ? accent : 'rgba(20,20,30,0.92)', zIndex:2 }} />
        )
      })}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function WaveLabView() {
  // Orbit + Trail state
  const [raw,       setRaw]       = useState('')
  const [trailPts,  setTrailPts]  = useState<TrailPoint[]>([])
  const [trailMeta, setTrailMeta] = useState<{body?:string;n?:number} | null>(null)
  const [orbitSnap, setOrbitSnap] = useState<OrbitSnapshot | null>(null)
  const [mappings,  setMappings]  = useState<Record<string, OrbitMapping>>(
    Object.fromEntries(Object.entries(DEFAULT_MAPPINGS).map(([k,v]) => [k, {src:v.src, rate:v.rate}]))
  )
  const [parseErr,  setParseErr]  = useState('')
  const [signals,   setSignals]   = useState<Signal[]>(['x','y'])
  const [zoom,      setZoom]      = useState(1)
  const [offset,    setOffset]    = useState(0)

  // Orbit waveform mode
  const [orbitWaveActive, setOrbitWaveActive] = useState(false)
  const [orbitSigs, setOrbitSigs] = useState<Signal[]>(['x'])

  // Osc state
  const engRef      = useRef<AmbientOscillatorEngine | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const [ready,     setReady]     = useState(false)
  const [heldNote,  setHeldNote]  = useState<number|null>(null)
  const [waveformLinked, setWaveformLinked] = useState(true)
  const [params,    setParams]    = useState<AmbientOscillatorParams>({
    waveform:'sine', waveformLeft:'sine', waveformRight:'sine', attack:1.5, decay:0.5, sustain:0.8, release:3.0, filterCutoff:1200,
    filterResonance:0.3, level:0.5, lfoTarget:'off', lfoRate:0.5, lfoDepth:0.3, lfoWaveform:'sine',
  })

  // Parse orbit + trail JSON
  useEffect(() => {
    if (!raw.trim()) return
    try {
      const obj = JSON.parse(raw)
      // Trail points
      const pts: TrailPoint[] = Array.isArray(obj) ? obj : (obj.trail ?? obj.points)
      if (!pts || !Array.isArray(pts) || pts.length === 0 || !('x' in pts[0])) throw new Error('trail points[] not found')
      setTrailPts(pts); setTrailMeta({ body: obj.body, n: pts.length }); setParseErr(''); setOffset(0)
      // Orbit snapshot
      if (obj.orbit && typeof obj.orbit.T === 'number') {
        setOrbitSnap(obj.orbit as OrbitSnapshot)
      } else {
        setOrbitSnap(null)
      }
    } catch(e) { setParseErr(String(e)); setTrailPts([]); setOrbitSnap(null) }
  }, [raw])

  // Apply orbit waveform whenever trail or orbit mode changes
  useEffect(() => {
    if (!engRef.current) return
    if (orbitWaveActive && trailPts.length >= 4 && orbitSigs.length > 0) {
      const arrays = orbitSigs.map(sig => extractSignal(trailPts, sig))
      const normed = arrays.map(arr => normalize(arr))
      const summed = normed[0].map((_, i) => normed.reduce((acc, arr) => acc + arr[i], 0) / normed.length)
      const mean = summed.reduce((a, b) => a + b, 0) / summed.length
      const pts = summed.map((v, i) => ({ x: i, y: v - mean }))
      engRef.current.setOrbitWaveform(pts)
    } else if (!orbitWaveActive) {
      engRef.current.clearOrbitWaveform()
    }
  }, [orbitWaveActive, trailPts, orbitSigs])

  // Init osc engine
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await Tone.start()
      const eng = new AmbientOscillatorEngine(); await eng.init()
      if (cancelled) { eng.dispose(); return }
      const ctx = Tone.getContext().rawContext as AudioContext
      const analyser = ctx.createAnalyser(); analyser.fftSize = 2048
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value=-0.5; limiter.knee.value=0; limiter.ratio.value=20
      limiter.attack.value=0.001; limiter.release.value=0.05
      eng.getOutputNode().connect(analyser); analyser.connect(limiter); limiter.connect(ctx.destination)
      analyserRef.current = analyser; eng.setParams(params); engRef.current = eng; setReady(true)
    })()
    return () => { cancelled=true; engRef.current?.dispose(); engRef.current=null; analyserRef.current=null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateParams = useCallback((patch: Partial<AmbientOscillatorParams>) => {
    setParams(prev => { const next={...prev,...patch}; engRef.current?.setParams(patch); return next })
  }, [])
  const noteOn  = useCallback((note: number) => { if(!engRef.current) return; if(heldNote!==null && heldNote!==note) engRef.current.noteOff(heldNote); engRef.current.noteOn(note,0.85); setHeldNote(note) }, [heldNote])
  const noteOff = useCallback((note: number) => { if(!engRef.current) return; engRef.current.noteOff(note); setHeldNote(prev=>prev===note?null:prev) }, [])

  const bg = '#0a0a14', border = 'rgba(255,255,255,0.07)', dim = 'rgba(255,255,255,0.35)', accent = '#818cf8'
  const panelStyle = { background:'rgba(255,255,255,0.03)', borderRadius:6, padding:'10px 12px', marginBottom:8 } as const

  function SliderRow({ label, value, min, max, step, fmt, onChange }: { label:string; value:number; min:number; max:number; step:number; fmt?:(v:number)=>string; onChange:(v:number)=>void }) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
        <span style={{ fontSize:9, color:dim, width:88, textAlign:'right', flexShrink:0 }}>{label}</span>
        <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(parseFloat(e.target.value))} style={{ flex:1, accentColor:accent }} />
        <span style={{ fontSize:9, fontFamily:'monospace', color:accent, width:52, textAlign:'right', flexShrink:0 }}>{fmt?fmt(value):value}</span>
      </div>
    )
  }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', background:bg, color:'#e0e0e0', fontFamily:'inherit', overflow:'hidden' }}>

      {/* Header */}
      <div style={{ padding:'6px 16px', borderBottom:`0.5px solid ${border}`, display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
        <span style={{ fontSize:11, fontWeight:700, color:accent, letterSpacing:'0.08em', textTransform:'uppercase' }}>∿ Wave Lab</span>
        {trailMeta && <span style={{ fontSize:9, color:dim }}>{trailMeta.body && <span style={{color:'#60a5fa',marginRight:6}}>{trailMeta.body}</span>}{trailPts.length} pts</span>}
        <div style={{ flex:1 }} />
        <div style={{ fontSize:8.5, fontWeight:700, padding:'2px 7px', borderRadius:4, background:ready?'rgba(34,197,94,0.12)':'rgba(255,255,255,0.06)', color:ready?'#22c55e':'rgba(255,255,255,0.3)', border:`0.5px solid ${ready?'rgba(34,197,94,0.3)':'rgba(255,255,255,0.1)'}` }}>
          {ready?'● osc ready':'○ init…'}
        </div>
      </div>

      {/* Body: 3-column layout */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>

        {/* ── Left: Trail input ── */}
        <div style={{ width:220, flexShrink:0, borderRight:`0.5px solid ${border}`, display:'flex', flexDirection:'column', overflowY:'auto', padding:'10px 10px' }}>

          <div style={{ fontSize:8, fontWeight:700, color:dim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:5 }}>Trail JSON</div>
          <textarea value={raw} onChange={e=>setRaw(e.target.value)}
            placeholder='{"body":"...","points":[{"x":0,"y":0},...]}'
            style={{ width:'100%', height:110, resize:'vertical', fontSize:8.5, fontFamily:'monospace',
              background:'rgba(255,255,255,0.04)', color:'#e0e0e0',
              border:`0.5px solid ${parseErr?'#f87171':border}`, borderRadius:4, padding:'5px 7px',
              outline:'none', boxSizing:'border-box', marginBottom:4 }} />
          {parseErr && <div style={{ fontSize:8, color:'#f87171', marginBottom:6 }}>{parseErr}</div>}

          <div style={{ fontSize:8, fontWeight:700, color:dim, textTransform:'uppercase', letterSpacing:'0.08em', marginTop:4, marginBottom:6 }}>Signals</div>
          {SIGNAL_CFG.map(s => (
            <label key={s.key} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', marginBottom:4 }}>
              <input type="checkbox" checked={signals.includes(s.key)} onChange={e=>setSignals(prev=>e.target.checked?[...prev,s.key]:prev.filter(x=>x!==s.key))} />
              <span style={{ fontSize:9.5, color:s.color, fontFamily:'monospace', width:22 }}>{s.label}</span>
              <span style={{ fontSize:8, color:dim }}>{s.desc}</span>
            </label>
          ))}

          <div style={{ fontSize:8, fontWeight:700, color:dim, textTransform:'uppercase', letterSpacing:'0.08em', marginTop:8, marginBottom:6 }}>View</div>
          <div style={{ fontSize:8, color:dim, marginBottom:2 }}>Zoom ×{zoom.toFixed(1)}</div>
          <input type="range" min={1} max={20} step={0.1} value={zoom} onChange={e=>setZoom(parseFloat(e.target.value))} style={{ width:'100%', marginBottom:8, accentColor:accent }} />
          <div style={{ fontSize:8, color:dim, marginBottom:2 }}>Offset {Math.round(offset*100)}%</div>
          <input type="range" min={0} max={1} step={0.001} value={offset} onChange={e=>setOffset(parseFloat(e.target.value))} style={{ width:'100%', accentColor:accent }} />
        </div>

        {/* ── Center: Waveforms ── */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, padding:'10px 12px', gap:8 }}>

          {/* Trail waveform */}
          <div>
            <div style={{ fontSize:8, color:dim, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>
              Orbit Trail
              {signals.map(sig => { const c=SIGNAL_CFG.find(s=>s.key===sig)!; return <span key={sig} style={{marginLeft:8,color:c.color,fontFamily:'monospace'}}>— {c.label}</span> })}
            </div>
            {trailPts.length >= 2
              ? <TrailWaveform pts={trailPts} signals={signals} zoom={zoom} offset={offset} />
              : <div style={{ height:120, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(255,255,255,0.03)', borderRadius:4, fontSize:10, color:dim }}>← paste trail JSON</div>
            }
          </div>

          {/* Signals synthesis — sum of checked signals, normalized */}
          <div>
            <div style={{ fontSize:8, color:dim, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>
              Synthesis
              {signals.map(sig => { const c=SIGNAL_CFG.find(s=>s.key===sig)!; return <span key={sig} style={{marginLeft:6,color:c.color,fontFamily:'monospace',fontSize:7}}>{c.label}</span> })}
              {signals.length > 1 && <span style={{marginLeft:6,color:'#a78bfa',fontSize:7}}>→ sum</span>}
              {/* Orbit Synthesisボタン */}
              <button
                onClick={() => {
                  if (trailPts.length < 4 || signals.length === 0) return
                  // Build summed signal and push to engine as PeriodicWave
                  const total = trailPts.length
                  const viewLen = Math.max(2, Math.floor(total / zoom))
                  const start = Math.floor(offset * (total - viewLen))
                  const slice = trailPts.slice(start, start + viewLen)
                  const arrays = signals.map(sig => extractSignal(slice, sig))
                  const summed = arrays[0].map((_, i) => arrays.reduce((acc, arr) => acc + arr[i], 0) / arrays.length)
                  const mean = summed.reduce((a,b)=>a+b,0)/summed.length
                  const pts = summed.map((v,i) => ({x:i, y: v - mean}))
                  engRef.current?.setOrbitWaveform(pts)
                  setOrbitWaveActive(true)
                }}
                title="Apply synthesized signal as wavetable"
                disabled={trailPts.length < 4 || signals.length === 0}
                style={{
                  marginLeft:10, fontSize:7.5, fontWeight:700, padding:'1px 7px', borderRadius:3,
                  border:'0.5px solid rgba(167,139,250,0.5)', background:'rgba(167,139,250,0.12)',
                  color:'#a78bfa', fontFamily:'inherit', cursor:'pointer',
                  opacity: trailPts.length < 4 ? 0.4 : 1,
                }}>
                ▶ use as wavetable
              </button>
            </div>
            <SynthesisWaveform
              pts={trailPts}
              signals={signals}
              zoom={zoom}
              offset={offset}
              dimColor={dim}
              fallbackWaveformLeft={params.waveformLeft ?? params.waveform}
              fallbackWaveformRight={params.waveformRight ?? params.waveformLeft ?? params.waveform}
            />
          </div>

          {/* Oscilloscope */}
          <div>
            <div style={{ fontSize:8, color:dim, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>Oscilloscope</div>
            <Oscilloscope analyser={analyserRef.current} />
          </div>

          {/* Keyboard */}
          <div style={{ marginTop:4 }}>
            <div style={{ fontSize:8, color:dim, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>
              Keyboard {heldNote!==null && <span style={{color:accent,fontWeight:700,textTransform:'none',marginLeft:6}}>♪ {midiToName(heldNote)} · {midiToHz(heldNote).toFixed(1)} Hz</span>}
            </div>
            <MiniKeyboard activeNote={heldNote} onNoteOn={noteOn} onNoteOff={noteOff} />
            <div style={{ display:'flex', gap:4, marginTop:6, flexWrap:'wrap' }}>
              {[36,48,60,72,84].map(n => (
                <button key={n} onMouseDown={()=>noteOn(n)} onMouseUp={()=>noteOff(n)} style={{
                  fontSize:9, fontWeight:600, padding:'3px 10px', borderRadius:4, fontFamily:'inherit', cursor:'pointer',
                  border:`0.5px solid ${heldNote===n?accent+'80':'rgba(255,255,255,0.12)'}`,
                  background:heldNote===n?`${accent}22`:'rgba(255,255,255,0.04)', color:heldNote===n?accent:'rgba(255,255,255,0.55)' }}>
                  {midiToName(n)}
                </button>
              ))}
              <button onClick={()=>{engRef.current?.noteOffAll();setHeldNote(null)}} style={{ fontSize:9, fontWeight:600, padding:'3px 10px', borderRadius:4, fontFamily:'inherit', cursor:'pointer', border:'0.5px solid rgba(239,68,68,0.35)', background:'rgba(239,68,68,0.07)', color:'rgba(239,68,68,0.7)', marginLeft:4 }}>■ Stop</button>
            </div>
          </div>
        </div>

        {/* ── Right: Osc params ── */}
        <div style={{ width:240, flexShrink:0, borderLeft:`0.5px solid ${border}`, overflowY:'auto', padding:'10px 12px' }}>

          <div style={{ ...panelStyle }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
              <div style={{ fontSize:8, fontWeight:700, color:dim, textTransform:'uppercase', letterSpacing:'0.07em', flex:1 }}>Waveform</div>
              <button
                onClick={() => {
                  setWaveformLinked(v => {
                    const next = !v
                    if (next) {
                      const left = params.waveformLeft ?? params.waveform
                      updateParams({ waveform:left, waveformLeft:left, waveformRight:left })
                    }
                    return next
                  })
                }}
                style={{
                  fontSize:7.5, fontWeight:700, padding:'2px 6px', borderRadius:3, fontFamily:'inherit', cursor:'pointer',
                  border:`0.5px solid ${waveformLinked ? accent+'80' : 'rgba(255,255,255,0.1)'}`,
                  background:waveformLinked ? `${accent}18` : 'transparent',
                  color:waveformLinked ? accent : 'rgba(255,255,255,0.45)',
                }}>
                link
              </button>
            </div>
            {([
              { side:'L', key:'waveformLeft', color:'#60a5fa' },
              { side:'R', key:'waveformRight', color:'#34d399' },
            ] as const).map(row => (
              <div key={row.side} style={{ display:'grid', gridTemplateColumns:'18px 1fr', gap:5, alignItems:'center', marginBottom:5 }}>
                <span style={{ fontSize:8, fontWeight:800, color:row.color, textAlign:'right' }}>{row.side}</span>
                <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
                  {(['sine','triangle','sawtooth','square'] as OscillatorType[]).map(w => {
                    const current = params[row.key] ?? params.waveform
                    const active = !orbitWaveActive && current === w
                    return (
                      <button key={w}
                        onClick={() => {
                          setOrbitWaveActive(false)
                          if (waveformLinked) updateParams({ waveform:w, waveformLeft:w, waveformRight:w })
                          else updateParams({ [row.key]:w, waveform: row.side === 'L' ? w : params.waveformLeft ?? params.waveform } as Partial<AmbientOscillatorParams>)
                        }}
                        style={{
                          fontSize:8.5, fontWeight:600, padding:'3px 7px', borderRadius:4, fontFamily:'inherit', cursor:'pointer',
                          border:`0.5px solid ${active ? row.color+'aa' : 'rgba(255,255,255,0.1)'}`,
                          background:active ? `${row.color}20` : 'transparent',
                          color:active ? row.color : 'rgba(255,255,255,0.45)',
                        }}>
                        {w==='sine'?'Sine':w==='triangle'?'Tri':w==='sawtooth'?'Saw':'Sq'}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            <div style={{ display:'flex', gap:3, flexWrap:'wrap', marginTop:2 }}>
              {/* Orbit Trail wavetable */}
              <button
                onClick={() => {
                  if (trailPts.length < 4) return
                  setOrbitWaveActive(v => !v)
                }}
                title={trailPts.length < 4 ? 'Paste trail JSON first' : `Use ${orbitSigs.join('+')} as wavetable`}
                style={{
                  fontSize:8.5, fontWeight:700, padding:'3px 8px', borderRadius:4, fontFamily:'inherit',
                  cursor: trailPts.length < 4 ? 'not-allowed' : 'pointer',
                  opacity: trailPts.length < 4 ? 0.4 : 1,
                  border:`0.5px solid ${orbitWaveActive ? '#34d39980' : 'rgba(255,255,255,0.1)'}`,
                  background: orbitWaveActive ? 'rgba(52,211,153,0.15)' : 'transparent',
                  color: orbitWaveActive ? '#34d399' : 'rgba(255,255,255,0.45)',
                }}>
                ∿ Orbit
              </button>
            </div>
            {/* Orbit signal selector — multi-select */}
            <div style={{ display:'flex', gap:3, flexWrap:'wrap', marginTop:5, alignItems:'center' }}>
              {SIGNAL_CFG.map(s => {
                const on = orbitSigs.includes(s.key)
                return (
                  <button key={s.key}
                    onClick={() => setOrbitSigs(prev =>
                      on ? (prev.length > 1 ? prev.filter(x => x !== s.key) : prev)
                         : [...prev, s.key]
                    )}
                    style={{
                      fontSize:8, fontWeight:700, padding:'2px 7px', borderRadius:3, fontFamily:'inherit', cursor:'pointer',
                      border:`0.5px solid ${on ? s.color+'bb' : 'rgba(255,255,255,0.08)'}`,
                      background: on ? `${s.color}28` : 'transparent',
                      color: on ? s.color : 'rgba(255,255,255,0.3)',
                    }}>
                    {s.label}
                  </button>
                )
              })}
              <span style={{ fontSize:7.5, color:'rgba(255,255,255,0.22)', marginLeft:2 }}>→ wavetable</span>
            </div>
            {orbitWaveActive && (
              <div style={{ fontSize:8, color:'#34d399', marginTop:4, opacity:0.85 }}>
                ∿ {orbitSigs.join(' + ')} · {trailPts.length} pts → PeriodicWave DFT
              </div>
            )}
          </div>

          <div style={{ ...panelStyle }}>
            <div style={{ fontSize:8, fontWeight:700, color:dim, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>Envelope / Filter</div>
            <SliderRow label="Level"   value={params.level}           min={0}   max={1}     step={0.01} fmt={v=>v.toFixed(2)}   onChange={v=>updateParams({level:v})} />
            <SliderRow label="Attack"  value={params.attack}          min={0.01}max={20}    step={0.1}  fmt={v=>`${v.toFixed(1)}s`} onChange={v=>updateParams({attack:v})} />
            <SliderRow label="Decay"   value={params.decay ?? 0.5}    min={0.01}max={10}    step={0.05} fmt={v=>`${v.toFixed(2)}s`} onChange={v=>updateParams({decay:v})} />
            <SliderRow label="Sustain" value={params.sustain ?? 0.8}  min={0}   max={1}     step={0.01} fmt={v=>v.toFixed(2)}        onChange={v=>updateParams({sustain:v})} />
            <SliderRow label="Release" value={params.release}         min={0.01}max={30}    step={0.1}  fmt={v=>`${v.toFixed(1)}s`} onChange={v=>updateParams({release:v})} />
            <SliderRow label="Cutoff"  value={params.filterCutoff}    min={80}  max={12000} step={50}   fmt={v=>`${v}Hz`}      onChange={v=>updateParams({filterCutoff:v})} />
            <SliderRow label="Q"       value={params.filterResonance} min={0.01}max={15}    step={0.05} fmt={v=>v.toFixed(2)}   onChange={v=>updateParams({filterResonance:v})} />
          </div>

          <div style={{ ...panelStyle }}>
            <div style={{ fontSize:8, fontWeight:700, color:dim, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>LFO</div>
            <div style={{ display:'flex', gap:3, flexWrap:'wrap', marginBottom:8 }}>
              {(['off','pitch','filter','amplitude'] as LfoTarget[]).map(t => (
                <button key={t} onClick={()=>updateParams({lfoTarget:t})} style={{
                  fontSize:8.5, fontWeight:600, padding:'3px 8px', borderRadius:4, fontFamily:'inherit', cursor:'pointer',
                  border:`0.5px solid ${params.lfoTarget===t?'#a78bfa80':'rgba(255,255,255,0.1)'}`,
                  background:params.lfoTarget===t?'rgba(167,139,250,0.18)':'transparent', color:params.lfoTarget===t?'#a78bfa':'rgba(255,255,255,0.45)' }}>
                  {t==='off'?'Off':t==='pitch'?'Pitch':t==='filter'?'Filt':'Amp'}
                </button>
              ))}
            </div>
            <div style={{ display:'flex', gap:3, flexWrap:'wrap', marginBottom:8 }}>
              {(['sine','triangle','sawtooth','square'] as OscillatorType[]).map(w => (
                <button key={w} onClick={()=>updateParams({lfoWaveform:w})} style={{
                  fontSize:8.5, fontWeight:600, padding:'3px 8px', borderRadius:4, fontFamily:'inherit', cursor:'pointer', opacity:params.lfoTarget==='off'?0.4:1,
                  border:`0.5px solid ${params.lfoWaveform===w?'#a78bfa80':'rgba(255,255,255,0.1)'}`,
                  background:params.lfoWaveform===w?'rgba(167,139,250,0.18)':'transparent', color:params.lfoWaveform===w?'#a78bfa':'rgba(255,255,255,0.45)' }}>
                  {w==='sine'?'Sine':w==='triangle'?'Tri':w==='sawtooth'?'Saw':'Sq'}
                </button>
              ))}
            </div>
            <SliderRow label="Rate"  value={params.lfoRate}  min={0.01} max={20} step={0.01} fmt={v=>`${v.toFixed(2)}Hz`} onChange={v=>updateParams({lfoRate:v})} />
            <SliderRow label="Depth" value={params.lfoDepth} min={0}    max={1}  step={0.01} fmt={v=>v.toFixed(2)}        onChange={v=>updateParams({lfoDepth:v})} />
          </div>
        </div>

        {/* ── Orbit → Synth mapping ── */}
        {orbitSnap && (
          <div style={{ ...panelStyle }}>
            <div style={{ fontSize:8, fontWeight:700, color:'#34d399', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>
              ◎ Orbit → Synth
            </div>

            {/* Orbit stats mini display */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px 8px', marginBottom:10 }}>
              {[
                { k:'T',    v: isFinite(orbitSnap.T) ? orbitSnap.T.toFixed(1)+'s' : '∞' },
                { k:'ecc',  v: orbitSnap.ecc.toFixed(2) },
                { k:'r',    v: Math.round(orbitSnap.r).toString() },
                { k:'spd',  v: orbitSnap.speed.toFixed(1) },
                { k:'ω',    v: orbitSnap.omega.toFixed(4) },
                { k: orbitSnap.bound ? '⟳' : '↗', v: orbitSnap.centerName },
              ].map(row => (
                <div key={row.k} style={{ display:'flex', gap:4, alignItems:'baseline' }}>
                  <span style={{ fontSize:7, color:dim, width:22, textAlign:'right', flexShrink:0 }}>{row.k}</span>
                  <span style={{ fontSize:8.5, fontFamily:'monospace', color:'#34d399' }}>{row.v}</span>
                </div>
              ))}
            </div>

            {/* Mapping rows */}
            {Object.entries(DEFAULT_MAPPINGS).map(([key, def]) => {
              const m = mappings[key] ?? { src: def.src, rate: def.rate }
              const raw_v = orbitVal(m.src, orbitSnap) * m.rate
              const v = Math.max(def.min, Math.min(def.max, raw_v))
              return (
                <div key={key} style={{ display:'flex', alignItems:'center', gap:4, marginBottom:5 }}>
                  <span style={{ fontSize:8, color:dim, width:36, textAlign:'right', flexShrink:0 }}>{def.label}</span>
                  <select value={m.src}
                    onChange={e => setMappings(prev => ({...prev, [key]: {...prev[key], src: e.target.value as OrbitSrc}}))}
                    style={{ fontSize:7.5, border:'none', borderRadius:3, padding:'1px 3px', background:'rgba(255,255,255,0.06)', color:dim, fontFamily:'inherit', flexShrink:0 }}>
                    {(['period','eccentricity','distance','velocity','accel'] as OrbitSrc[]).map(s => (
                      <option key={s} value={s}>{s.slice(0,4)}</option>
                    ))}
                  </select>
                  <span style={{ fontSize:7, color:'rgba(255,255,255,0.2)', flexShrink:0 }}>×</span>
                  <input type="number" value={m.rate} step={key==='cutoff'?50:0.01}
                    onChange={e => setMappings(prev => ({...prev, [key]: {...prev[key], rate: parseFloat(e.target.value)||0}}))}
                    style={{ width:46, fontSize:8, fontFamily:'monospace', border:'none', borderRadius:3, padding:'1px 4px', background:'rgba(255,255,255,0.06)', color:dim, textAlign:'right' }} />
                  <span style={{ fontSize:8.5, fontFamily:'monospace', color:'#34d399', marginLeft:'auto', flexShrink:0 }}>
                    {key === 'cutoff' ? `${Math.round(v)}Hz` : v.toFixed(key==='sustain'||key==='lfoDepth'?2:1) + (key.includes('Rate')||key==='attack'||key==='decay'||key==='release'?'s':'')}
                  </span>
                </div>
              )
            })}

            {/* Apply button */}
            <button
              onClick={() => {
                const computed: Partial<AmbientOscillatorParams> = {}
                const get = (key: string) => {
                  const m = mappings[key] ?? DEFAULT_MAPPINGS[key]
                  const def = DEFAULT_MAPPINGS[key]
                  return Math.max(def.min, Math.min(def.max, orbitVal(m.src, orbitSnap!) * m.rate))
                }
                computed.attack  = get('attack')
                computed.decay   = get('decay')
                computed.sustain = get('sustain')
                computed.release = get('release')
                computed.filterCutoff = get('cutoff')
                updateParams(computed)
              }}
              style={{ width:'100%', marginTop:6, padding:'4px', fontSize:8.5, fontWeight:700,
                border:'0.5px solid rgba(52,211,153,0.4)', borderRadius:4, cursor:'pointer',
                background:'rgba(52,211,153,0.1)', color:'#34d399', fontFamily:'inherit' }}>
              ▶ Apply to synth
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
