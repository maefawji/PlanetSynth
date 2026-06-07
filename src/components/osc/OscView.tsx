// ── OscView ───────────────────────────────────────────────────────────────────
// Standalone development/test view for AmbientOscillatorEngine.
// Has its own engine instance — independent of the planet rack.
//
// Features:
//   • Play / Stop note button (hold while playing, release on click)
//   • All engine params as live-update sliders/selectors
//   • Simple keyboard (C3–B5) for note selection
//   • VU meter visualisation via Web Audio AnalyserNode

import { useEffect, useRef, useState, useCallback } from 'react'
import * as Tone from 'tone'
import {
  AmbientOscillatorEngine,
  type AmbientOscillatorParams,
  type LfoTarget,
  midiToHz,
} from '../../audio/AmbientOscillatorEngine'

// ── Note helpers ──────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function midiToName(n: number) {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`
}
function isBlack(n: number) { return [1, 3, 6, 8, 10].includes(n % 12) }

// ── Param row helper ──────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', width: 100, textAlign: 'right', flexShrink: 0 }}>
        {label}
      </span>
      {children}
    </div>
  )
}

function SliderRow({
  label, value, min, max, step, fmt, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number
  fmt?: (v: number) => string; onChange: (v: number) => void
}) {
  return (
    <Row label={label}>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: '#818cf8' }}
      />
      <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#818cf8', width: 54, textAlign: 'right', flexShrink: 0 }}>
        {fmt ? fmt(value) : value}
      </span>
    </Row>
  )
}

// ── Mini keyboard ─────────────────────────────────────────────────────────────

function MiniKeyboard({
  activeNote, onNoteOn, onNoteOff,
}: {
  activeNote: number | null
  onNoteOn: (note: number) => void
  onNoteOff: (note: number) => void
}) {
  const loNote = 48  // C3
  const hiNote = 84  // C6
  const whites = Array.from({ length: hiNote - loNote + 1 }, (_, i) => i + loNote)
    .filter(n => !isBlack(n))

  return (
    <div style={{ position: 'relative', height: 60, display: 'flex', userSelect: 'none' }}>
      {whites.map(note => {
        const isActive = activeNote === note
        return (
          <div
            key={note}
            onMouseDown={() => onNoteOn(note)}
            onMouseUp={() => onNoteOff(note)}
            onMouseLeave={() => { if (activeNote === note) onNoteOff(note) }}
            title={midiToName(note)}
            style={{
              flex: 1, height: '100%', border: '0.5px solid rgba(255,255,255,0.15)',
              borderRadius: '0 0 3px 3px', cursor: 'pointer',
              background: isActive ? 'rgba(129,140,248,0.5)' : 'rgba(255,255,255,0.88)',
              transition: 'background 0.04s',
            }}
          />
        )
      })}
      {/* Black keys — absolutely positioned */}
      {Array.from({ length: hiNote - loNote + 1 }, (_, i) => i + loNote)
        .filter(n => isBlack(n))
        .map(note => {
          // position: count white keys before this note
          const whitesBefore = Array.from({ length: note - loNote }, (_, i) => i + loNote)
            .filter(n => !isBlack(n)).length
          const totalWhites = whites.length
          const left = (whitesBefore / totalWhites) * 100
          const width = (0.6 / totalWhites) * 100
          const isActive = activeNote === note
          return (
            <div
              key={note}
              onMouseDown={e => { e.stopPropagation(); onNoteOn(note) }}
              onMouseUp={e => { e.stopPropagation(); onNoteOff(note) }}
              onMouseLeave={() => { if (activeNote === note) onNoteOff(note) }}
              title={midiToName(note)}
              style={{
                position: 'absolute', top: 0, left: `${left}%`, width: `${width}%`,
                height: '62%', borderRadius: '0 0 2px 2px', cursor: 'pointer',
                background: isActive ? '#818cf8' : 'rgba(20,20,30,0.92)',
                border: '0.5px solid rgba(255,255,255,0.08)',
                zIndex: 2, transition: 'background 0.04s',
              }}
            />
          )
        })}
    </div>
  )
}

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

      const W = canvas.width
      const H = canvas.height
      const mid = H / 2

      // Background
      ctx2.fillStyle = '#080810'
      ctx2.fillRect(0, 0, W, H)

      // Grid lines
      ctx2.strokeStyle = 'rgba(129,140,248,0.08)'
      ctx2.lineWidth = 0.5
      // Horizontal
      for (let g = 0; g <= 4; g++) {
        const y = (g / 4) * H
        ctx2.beginPath(); ctx2.moveTo(0, y); ctx2.lineTo(W, y); ctx2.stroke()
      }
      // Vertical
      for (let g = 0; g <= 8; g++) {
        const x = (g / 8) * W
        ctx2.beginPath(); ctx2.moveTo(x, 0); ctx2.lineTo(x, H); ctx2.stroke()
      }

      // Zero line
      ctx2.strokeStyle = 'rgba(129,140,248,0.25)'
      ctx2.lineWidth = 0.75
      ctx2.beginPath(); ctx2.moveTo(0, mid); ctx2.lineTo(W, mid); ctx2.stroke()

      // Waveform — find zero crossing for stable display
      let start = 0
      for (let i = 1; i < buf.length - 1; i++) {
        if (buf[i - 1] < 0 && buf[i] >= 0) { start = i; break }
      }

      // Peak for colour
      let peak = 0
      for (const s of buf) peak = Math.max(peak, Math.abs(s))

      const clipping = peak >= 0.99
      const hot      = peak > 0.92

      // Clip lines at ±1.0 (= top/bottom of the drawable area × 0.9 scale)
      const clipY0 = mid - mid * 0.9
      const clipY1 = mid + mid * 0.9
      ctx2.strokeStyle = clipping ? 'rgba(239,68,68,0.7)' : 'rgba(239,68,68,0.18)'
      ctx2.lineWidth = 0.75
      ctx2.setLineDash([4, 4])
      ctx2.beginPath(); ctx2.moveTo(0, clipY0); ctx2.lineTo(W, clipY0); ctx2.stroke()
      ctx2.beginPath(); ctx2.moveTo(0, clipY1); ctx2.lineTo(W, clipY1); ctx2.stroke()
      ctx2.setLineDash([])

      const waveColor = clipping ? '#ef4444'
        : hot          ? '#fbbf24'
        : peak > 0.01  ? '#818cf8'
        : 'rgba(129,140,248,0.3)'

      ctx2.strokeStyle = waveColor
      ctx2.lineWidth = 1.5
      ctx2.shadowColor = waveColor
      ctx2.shadowBlur = peak > 0.01 ? 6 : 0
      ctx2.beginPath()

      const drawLen = Math.min(buf.length - start, W * 2)
      for (let i = 0; i < drawLen; i++) {
        const x = (i / drawLen) * W
        const y = mid - buf[start + i] * mid * 0.9
        if (i === 0) ctx2.moveTo(x, y)
        else ctx2.lineTo(x, y)
      }
      ctx2.stroke()
      ctx2.shadowBlur = 0

      // Level bar (right edge) — colour-coded
      const barW = 4
      const levelH = Math.min(1, peak * 1.2) * H
      ctx2.fillStyle = clipping ? '#ef4444' : hot ? '#fbbf24' : 'rgba(129,140,248,0.5)'
      ctx2.fillRect(W - barW, H - levelH, barW, levelH)

      // CLIP label when over limit
      if (clipping) {
        ctx2.fillStyle = '#ef4444'
        ctx2.font = 'bold 9px monospace'
        ctx2.fillText('CLIP', W - barW - 32, 11)
      }
    }

    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [analyser])

  return (
    <canvas
      ref={canvasRef} width={800} height={160}
      style={{ width: '100%', height: 160, borderRadius: 6, display: 'block' }}
    />
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function OscView() {
  const engRef    = useRef<AmbientOscillatorEngine | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const [ready,     setReady]     = useState(false)
  const [heldNote,  setHeldNote]  = useState<number | null>(null)
  const [params, setParams] = useState<AmbientOscillatorParams>({
    waveform:         'sine',
    attack:           1.5,
    release:          3.0,
    filterCutoff:     1200,
    filterResonance:  0.3,
    level:            0.5,
    lfoTarget:        'off',
    lfoRate:          0.5,
    lfoDepth:         0.3,
    lfoWaveform:      'sine',
  })

  // ── Init engine on mount ──────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await Tone.start()
      const eng = new AmbientOscillatorEngine()
      await eng.init()
      if (cancelled) { eng.dispose(); return }

      const ctx = Tone.getContext().rawContext as AudioContext

      // Analyser — reads the signal for the oscilloscope (pre-limiter)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048

      // Limiter — brickwall at -0.5 dBFS to prevent audible clipping
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -0.5  // start limiting just below 0 dBFS
      limiter.knee.value      = 0     // hard knee
      limiter.ratio.value     = 20    // near-brickwall
      limiter.attack.value    = 0.001 // 1 ms — fast enough to catch transients
      limiter.release.value   = 0.05  // 50 ms

      // Chain: engine → analyser (scope reads here) → limiter → destination
      eng.getOutputNode().connect(analyser)
      analyser.connect(limiter)
      limiter.connect(ctx.destination)
      analyserRef.current = analyser

      eng.setParams(params)
      engRef.current = eng
      setReady(true)
    })()
    return () => {
      cancelled = true
      engRef.current?.dispose()
      engRef.current = null
      analyserRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Live param sync ───────────────────────────────────────────────────────

  const updateParams = useCallback((patch: Partial<AmbientOscillatorParams>) => {
    setParams(prev => {
      const next = { ...prev, ...patch }
      engRef.current?.setParams(patch)
      return next
    })
  }, [])

  // ── Note events ───────────────────────────────────────────────────────────

  const noteOn = useCallback((note: number) => {
    if (!engRef.current) return
    if (heldNote !== null && heldNote !== note) engRef.current.noteOff(heldNote)
    engRef.current.noteOn(note, 0.85)
    setHeldNote(note)
  }, [heldNote])

  const noteOff = useCallback((note: number) => {
    if (!engRef.current) return
    engRef.current.noteOff(note)
    setHeldNote(prev => prev === note ? null : prev)
  }, [])

  const stopAll = useCallback(() => {
    engRef.current?.noteOffAll()
    setHeldNote(null)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  const accent = '#818cf8'

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: '#0a0a14', color: '#e0e0e0',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 20px 8px',
        borderBottom: '0.5px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{ fontSize: 18, color: accent }}>∿</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0' }}>Ambient Oscillator</div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>
            Standalone engine — independent of planet rack
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{
          fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
          background: ready ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.06)',
          color: ready ? '#22c55e' : 'rgba(255,255,255,0.3)',
          border: `0.5px solid ${ready ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)'}`,
        }}>
          {ready ? '● ready' : '○ init…'}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>

        {/* Oscilloscope */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Oscilloscope
          </div>
          {/* eslint-disable-next-line react-hooks/refs */}
          <Oscilloscope analyser={analyserRef.current} />
        </div>

        {/* Params */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Parameters</div>

          {/* Waveform */}
          <Row label="Waveform">
            <div style={{ display: 'flex', gap: 4 }}>
              {(['sine', 'triangle', 'sawtooth', 'square'] as OscillatorType[]).map(w => (
                <button key={w} onClick={() => updateParams({ waveform: w })} style={{
                  fontSize: 9, fontWeight: 600, padding: '3px 9px', borderRadius: 4,
                  fontFamily: 'inherit', cursor: 'pointer',
                  border: `0.5px solid ${params.waveform === w ? accent + '80' : 'rgba(255,255,255,0.12)'}`,
                  background: params.waveform === w ? `${accent}20` : 'transparent',
                  color: params.waveform === w ? accent : 'rgba(255,255,255,0.5)',
                }}>
                  {w === 'sine' ? 'Sine' : w === 'triangle' ? 'Tri' : w === 'sawtooth' ? 'Saw' : 'Sq'}
                </button>
              ))}
            </div>
          </Row>

          <SliderRow label="Level" value={params.level} min={0} max={1} step={0.01}
            fmt={v => v.toFixed(2)} onChange={v => updateParams({ level: v })} />
          <SliderRow label="Attack" value={params.attack} min={0.01} max={20} step={0.1}
            fmt={v => `${v.toFixed(1)}s`} onChange={v => updateParams({ attack: v })} />
          <SliderRow label="Release" value={params.release} min={0.01} max={30} step={0.1}
            fmt={v => `${v.toFixed(1)}s`} onChange={v => updateParams({ release: v })} />
          <SliderRow label="Filter cutoff" value={params.filterCutoff} min={80} max={12000} step={50}
            fmt={v => `${v} Hz`} onChange={v => updateParams({ filterCutoff: v })} />
          <SliderRow label="Filter Q" value={params.filterResonance} min={0.01} max={15} step={0.05}
            fmt={v => v.toFixed(2)} onChange={v => updateParams({ filterResonance: v })} />
        </div>

        {/* LFO */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>LFO</div>

          {/* Target */}
          <Row label="Target">
            <div style={{ display: 'flex', gap: 4 }}>
              {(['off', 'pitch', 'filter', 'amplitude'] as LfoTarget[]).map(t => (
                <button key={t} onClick={() => updateParams({ lfoTarget: t })} style={{
                  fontSize: 9, fontWeight: 600, padding: '3px 9px', borderRadius: 4,
                  fontFamily: 'inherit', cursor: 'pointer',
                  border: `0.5px solid ${params.lfoTarget === t ? '#a78bfa80' : 'rgba(255,255,255,0.12)'}`,
                  background: params.lfoTarget === t ? 'rgba(167,139,250,0.18)' : 'transparent',
                  color: params.lfoTarget === t ? '#a78bfa' : 'rgba(255,255,255,0.5)',
                }}>
                  {t === 'off' ? 'Off' : t === 'pitch' ? 'Pitch' : t === 'filter' ? 'Filter' : 'Amp'}
                </button>
              ))}
            </div>
          </Row>

          {/* LFO Waveform */}
          <Row label="Shape">
            <div style={{ display: 'flex', gap: 4 }}>
              {(['sine', 'triangle', 'sawtooth', 'square'] as OscillatorType[]).map(w => (
                <button key={w} onClick={() => updateParams({ lfoWaveform: w })} style={{
                  fontSize: 9, fontWeight: 600, padding: '3px 9px', borderRadius: 4,
                  fontFamily: 'inherit', cursor: 'pointer',
                  border: `0.5px solid ${params.lfoWaveform === w ? '#a78bfa80' : 'rgba(255,255,255,0.12)'}`,
                  background: params.lfoWaveform === w ? 'rgba(167,139,250,0.18)' : 'transparent',
                  color: params.lfoWaveform === w ? '#a78bfa' : 'rgba(255,255,255,0.5)',
                  opacity: params.lfoTarget === 'off' ? 0.4 : 1,
                }}>
                  {w === 'sine' ? 'Sine' : w === 'triangle' ? 'Tri' : w === 'sawtooth' ? 'Saw' : 'Sq'}
                </button>
              ))}
            </div>
          </Row>

          <SliderRow label="Rate" value={params.lfoRate} min={0.01} max={20} step={0.01}
            fmt={v => `${v.toFixed(2)} Hz`} onChange={v => updateParams({ lfoRate: v })} />
          <SliderRow label="Depth" value={params.lfoDepth} min={0} max={1} step={0.01}
            fmt={v => v.toFixed(2)} onChange={v => updateParams({ lfoDepth: v })} />

          {/* Hint */}
          <div style={{ paddingLeft: 108, fontSize: 9, color: 'rgba(255,255,255,0.2)', lineHeight: 1.6 }}>
            {params.lfoTarget === 'pitch'     && '± 200 cent (vibrato)'}
            {params.lfoTarget === 'filter'    && `± ${Math.round(params.lfoDepth * params.filterCutoff)} Hz around cutoff`}
            {params.lfoTarget === 'amplitude' && '± 0.45 gain (tremolo)'}
          </div>
        </div>

        {/* Keyboard */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Keyboard {heldNote !== null && (
              <span style={{ color: accent, fontWeight: 700, textTransform: 'none', marginLeft: 6 }}>
                ♪ {midiToName(heldNote)} ({heldNote}) — {midiToHz(heldNote).toFixed(1)} Hz
              </span>
            )}
          </div>
          <MiniKeyboard activeNote={heldNote} onNoteOn={noteOn} onNoteOff={noteOff} />
        </div>

        {/* Quick note buttons */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quick notes</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {[36, 48, 60, 72, 84].map(n => (
              <button key={n}
                onMouseDown={() => noteOn(n)}
                onMouseUp={() => noteOff(n)}
                style={{
                  fontSize: 10, fontWeight: 600, padding: '5px 14px', borderRadius: 5,
                  fontFamily: 'inherit', cursor: 'pointer',
                  border: `0.5px solid ${heldNote === n ? accent + '80' : 'rgba(255,255,255,0.15)'}`,
                  background: heldNote === n ? `${accent}22` : 'rgba(255,255,255,0.04)',
                  color: heldNote === n ? accent : 'rgba(255,255,255,0.6)',
                }}>
                {midiToName(n)}
              </button>
            ))}
            <button onClick={stopAll} style={{
              fontSize: 10, fontWeight: 600, padding: '5px 14px', borderRadius: 5,
              fontFamily: 'inherit', cursor: 'pointer',
              border: '0.5px solid rgba(239,68,68,0.4)',
              background: 'rgba(239,68,68,0.08)',
              color: 'rgba(239,68,68,0.8)',
              marginLeft: 8,
            }}>■ Stop all</button>
          </div>
        </div>

      </div>
    </div>
  )
}
