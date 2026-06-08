import React, { useEffect, useState } from 'react'
import * as Tone from 'tone'
import { useTheme } from '../../lib/theme'
import {
  CONDUCTOR_CHORD_QUALITIES,
  CONDUCTOR_GRID_RESOLUTIONS,
  CONDUCTOR_NOTE_NAMES,
  CONDUCTOR_SCALES,
  HARMONIC_MODES,
  HARMONIC_PRESETS,
  formatChordName,
  getChordNoteNames,
  getScaleDegree,
  useUniversalConductorStore,
  type ChordSlot,
  type ConductorChordQuality,
  type ConductorScale,
} from '../../store/universalConductorStore'

interface TransportSnapshot {
  bar: number
  beat: number
  tick: number
  state: 'PLAY' | 'PAUSE' | 'STOP'
}

function readTransportSnapshot(): TransportSnapshot {
  const transport = Tone.getTransport()
  const signature = transport.timeSignature
  const numerator = Array.isArray(signature) ? Number(signature[0]) : Number(signature)
  const denominator = Array.isArray(signature) ? Number(signature[1]) : 4
  const safeNum = Number.isFinite(numerator) && numerator > 0 ? numerator : 4
  const safeDen = Number.isFinite(denominator) && denominator > 0 ? denominator : 4
  const ppq = Math.max(1, Number(transport.PPQ) || 192)
  const ticksPerBeat = ppq * (4 / safeDen)
  const ticksPerBar = ticksPerBeat * safeNum
  const ticks = Math.max(0, Number(transport.ticks) || 0)
  const ticksIntoBar = ticks % ticksPerBar
  return {
    bar: Math.floor(ticks / ticksPerBar) + 1,
    beat: Math.floor(ticksIntoBar / ticksPerBeat) + 1,
    tick: Math.floor(ticksIntoBar % ticksPerBeat),
    state: transport.state === 'started' ? 'PLAY' : transport.state === 'paused' ? 'PAUSE' : 'STOP',
  }
}

interface Props {
  onClose: () => void
  anchorLeft: number
  anchorRight: number
  anchorTop: number
}

export function UniversalContextPanel({ onClose, anchorLeft, anchorRight, anchorTop }: Props) {
  const t = useTheme()
  const c = useUniversalConductorStore()
  const [transport, setTransport] = useState(readTransportSnapshot)

  useEffect(() => {
    const id = window.setInterval(() => setTransport(readTransportSnapshot()), 80)
    return () => window.clearInterval(id)
  }, [])

  // On open: if chordRoot/Quality diverges from the active progression slot, sync silently
  useEffect(() => {
    const slot = c.chordProgression[c.chordIndex]
    if (slot && (slot.root !== c.chordRoot || slot.quality !== c.chordQuality)) {
      c.update({ chordRoot: slot.root, chordQuality: slot.quality, chordOctave: slot.octave })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally run once on mount

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggleTransport() {
    if (transport.state === 'PLAY') {
      Tone.getTransport().pause()
    } else {
      void Tone.start().then(() => Tone.getTransport().start())
    }
  }

  function stopTransport() {
    Tone.getTransport().stop()
  }

  const inputCss: React.CSSProperties = {
    boxSizing: 'border-box',
    border: `0.5px solid ${t.panelBorder}`,
    borderRadius: 3,
    background: t.inputBg,
    color: t.inputText,
    fontFamily: 'inherit',
    fontSize: 10,
    padding: '3px 5px',
    outline: 'none',
    width: '100%',
    colorScheme: 'dark',
  }

  const optionCss: React.CSSProperties = {
    background: '#1d1c25',
    color: '#f3f0ff',
  }

  const accentColor = '#a78bfa'
  const dimSectionLabel: React.CSSProperties = {
    fontSize: 7.5,
    fontWeight: 800,
    letterSpacing: '0.14em',
    color: accentColor,
    textTransform: 'uppercase',
    opacity: 0.8,
    marginBottom: 7,
  }

  const isPlay = transport.state === 'PLAY'

  return (
    <>
      {/* backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 49 }}
        onMouseDown={onClose}
      />

      {/* panel */}
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: anchorTop,
          left: Math.min(anchorLeft, window.innerWidth - 580 - anchorRight),
          right: anchorRight,
          zIndex: 50,
          background: t.panelBg,
          border: `0.5px solid rgba(167,139,250,0.35)`,
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.38)',
          backdropFilter: 'blur(20px)',
          maxHeight: 'calc(100vh - 82px)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.5fr)', gap: 0 }}>

          {/* ── Left: context params ── */}
          <div style={{ padding: '13px 16px', borderRight: `0.5px solid ${t.divider}`, overflowY: 'auto' }}>
            <div style={dimSectionLabel}>Context</div>

            {/* Transport row */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12,
              padding: '7px 9px', borderRadius: 5,
              background: isPlay ? 'rgba(34,197,94,0.06)' : t.sectionBg,
              border: `0.5px solid ${isPlay ? 'rgba(34,197,94,0.25)' : t.panelBorder}`,
            }}>
              <button onClick={toggleTransport} style={{
                padding: '3px 11px', borderRadius: 3, fontFamily: 'inherit',
                fontSize: 10, fontWeight: 700, cursor: 'pointer',
                border: `0.5px solid ${isPlay ? 'rgba(34,197,94,0.45)' : t.panelBorder}`,
                background: isPlay ? 'rgba(34,197,94,0.12)' : t.inputBg,
                color: isPlay ? '#22c55e' : t.textMid,
              }}>
                {isPlay ? '⏸ Pause' : '▶ Play'}
              </button>
              <button onClick={stopTransport} style={{
                padding: '3px 8px', borderRadius: 3, fontFamily: 'inherit',
                fontSize: 10, fontWeight: 700, cursor: 'pointer',
                border: `0.5px solid ${t.panelBorder}`,
                background: t.inputBg, color: t.textDim,
              }}>
                ■
              </button>
              <span style={{
                marginLeft: 'auto',
                fontFamily: 'monospace', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                color: isPlay ? '#22c55e' : t.textDim,
              }}>
                {String(transport.bar).padStart(3, ' ')}.{transport.beat}.{String(transport.tick).padStart(3, '0')}
              </span>
              <span style={{
                fontSize: 8, fontWeight: 800, padding: '2px 5px', borderRadius: 3,
                letterSpacing: '0.08em',
                background: isPlay ? 'rgba(34,197,94,0.14)' : 'rgba(255,255,255,0.04)',
                color: isPlay ? '#22c55e' : transport.state === 'PAUSE' ? '#fbbf24' : t.textDim,
              }}>
                {transport.state}
              </span>
            </div>

            {/* BPM + Tuning */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 9 }}>
              <FG label="Tempo (BPM)">
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input type="range" min={20} max={300} step={1} value={c.bpm}
                    onChange={e => c.update({ bpm: Number(e.target.value) })}
                    style={{ flex: 1, minWidth: 0 }} />
                  <input type="number" min={20} max={300} value={c.bpm}
                    onChange={e => c.update({ bpm: Number(e.target.value) })}
                    style={{ ...inputCss, width: 46, textAlign: 'right', fontFamily: 'monospace' }} />
                </div>
              </FG>
              <FG label="Tuning A4 (Hz)">
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input type="range" min={400} max={480} step={1} value={c.tuning}
                    onChange={e => c.update({ tuning: Number(e.target.value) })}
                    style={{ flex: 1, minWidth: 0 }} />
                  <input type="number" min={400} max={480} value={c.tuning}
                    onChange={e => c.update({ tuning: Number(e.target.value) })}
                    style={{ ...inputCss, width: 46, textAlign: 'right', fontFamily: 'monospace' }} />
                </div>
              </FG>
            </div>

            {/* Key / Scale / Time Sig / Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr 1fr', gap: 6, marginBottom: 9 }}>
              <FG label="Key">
                <select value={c.key} onChange={e => c.transposeToKey(Number(e.target.value))} style={inputCss}>
                  {CONDUCTOR_NOTE_NAMES.map((n, i) => <option key={n} value={i} style={optionCss}>{n}</option>)}
                </select>
              </FG>
              <FG label="Scale">
                <select value={c.scale} onChange={e => c.update({ scale: e.target.value as typeof c.scale })} style={inputCss}>
                  {CONDUCTOR_SCALES.map(s => <option key={s} value={s} style={optionCss}>{s}</option>)}
                </select>
              </FG>
              <FG label="Time Sig">
                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                  <input type="number" min={1} max={16} value={c.timeSignatureNumerator}
                    onChange={e => c.update({ timeSignatureNumerator: Number(e.target.value) })}
                    style={{ ...inputCss, textAlign: 'center', fontFamily: 'monospace' }} />
                  <span style={{ color: t.textDim, fontWeight: 800, fontSize: 12, flexShrink: 0 }}>/</span>
                  <input type="number" min={1} max={32} value={c.timeSignatureDenominator}
                    onChange={e => c.update({ timeSignatureDenominator: Number(e.target.value) })}
                    style={{ ...inputCss, textAlign: 'center', fontFamily: 'monospace' }} />
                </div>
              </FG>
              <FG label="Grid">
                <select value={c.gridResolution} onChange={e => c.update({ gridResolution: e.target.value as typeof c.gridResolution })} style={inputCss}>
                  {CONDUCTOR_GRID_RESOLUTIONS.map(r => <option key={r} value={r} style={optionCss}>{r}</option>)}
                </select>
              </FG>
            </div>

            {/* Harmonic Mode */}
            <div style={{ marginBottom: 9 }}>
              <FG label="Harmonic Mode">
                <select value={c.harmonicMode} onChange={e => c.update({ harmonicMode: e.target.value as typeof c.harmonicMode })} style={inputCss}>
                  {HARMONIC_MODES.map(m => <option key={m} value={m} style={optionCss}>{m}</option>)}
                </select>
              </FG>
            </div>

            {/* Density / Tension / Quantize / Sustain / Reverb — 3 columns */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <SliderField label="Density" value={c.density} onChange={v => c.update({ density: v })} t={t} />
              <SliderField label="Tension" value={c.tension} onChange={v => c.update({ tension: v })} t={t} />
              <SliderField label="Quantize" value={c.quantize} onChange={v => c.update({ quantize: v })} t={t} />
              <SliderField label="Sustain" value={c.sustain} onChange={v => c.update({ sustain: v })} t={t} />
              <SliderField label="Reverb" value={c.reverbSend} onChange={v => c.update({ reverbSend: v })} t={t} />
            </div>

            {/* Max Polyphony */}
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(167,139,250,0.7)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Max Polyphony</span>
              <div style={{ display: 'flex', gap: 3 }}>
                {[2, 3, 4, 5, 6, 8].map(n => (
                  <button key={n} onClick={() => c.update({ maxPolyphony: n })} style={{
                    width: 22, height: 22, borderRadius: 3, fontFamily: 'monospace',
                    fontSize: 9, fontWeight: 700, cursor: 'pointer',
                    border: `0.5px solid ${c.maxPolyphony === n ? 'rgba(167,139,250,0.6)' : t.panelBorder}`,
                    background: c.maxPolyphony === n ? 'rgba(167,139,250,0.15)' : t.inputBg,
                    color: c.maxPolyphony === n ? accentColor : t.textDim,
                  }}>{n}</button>
                ))}
              </div>
            </div>

            {/* Register Map */}
            <div style={{ marginTop: 10 }}>
              <div style={{ ...dimSectionLabel, marginBottom: 6 }}>Register Map (MIDI)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr 1fr', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 7, color: t.textDim }} />
                <span style={{ fontSize: 7, color: t.textDim, textAlign: 'center' }}>min</span>
                <span style={{ fontSize: 7, color: t.textDim, textAlign: 'center' }}>max</span>
                {(
                  [
                    { label: 'Bass', min: 'registerBassMin', max: 'registerBassMax' },
                    { label: 'Body', min: 'registerBodyMin', max: 'registerBodyMax' },
                    { label: 'High', min: 'registerTensionMin', max: 'registerTensionMax' },
                  ] as const
                ).map(({ label, min, max }) => (
                  <React.Fragment key={label}>
                    <span style={{ fontSize: 8, color: t.textDim, fontWeight: 700, letterSpacing: '0.07em' }}>{label}</span>
                    <input type="number" min={0} max={127}
                      value={(c as Record<string, number>)[min]}
                      onChange={e => c.update({ [min]: Number(e.target.value) } as Parameters<typeof c.update>[0])}
                      style={{ ...inputCss, fontFamily: 'monospace', textAlign: 'center', fontSize: 9 }} />
                    <input type="number" min={0} max={127}
                      value={(c as Record<string, number>)[max]}
                      onChange={e => c.update({ [max]: Number(e.target.value) } as Parameters<typeof c.update>[0])}
                      style={{ ...inputCss, fontFamily: 'monospace', textAlign: 'center', fontSize: 9 }} />
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

          {/* ── Right: chord progression ── */}
          <div style={{ padding: '13px 12px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            {/* Header: title */}
            <div style={{ ...dimSectionLabel, marginBottom: 0 }}>Chord Progression</div>
            {/* Controls row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: -4 }}>
              <button
                onClick={c.advanceChordIndex}
                title="Advance to next chord"
                style={{
                  padding: '2px 7px', borderRadius: 3, fontFamily: 'inherit',
                  fontSize: 8, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em',
                  border: `0.5px solid rgba(167,139,250,0.4)`,
                  background: 'rgba(167,139,250,0.1)', color: accentColor, flexShrink: 0,
                }}
              >
                ▶ Next
              </button>
              <button
                onClick={() => c.update({ autoAdvance: !c.autoAdvance })}
                title={`Auto-advance every ${c.autoAdvanceBars} bar${c.autoAdvanceBars === 1 ? '' : 's'}`}
                style={{
                  padding: '2px 7px', borderRadius: 3, fontFamily: 'inherit',
                  fontSize: 8, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em',
                  border: `0.5px solid ${c.autoAdvance ? 'rgba(34,197,94,0.5)' : 'rgba(167,139,250,0.25)'}`,
                  background: c.autoAdvance ? 'rgba(34,197,94,0.1)' : t.inputBg,
                  color: c.autoAdvance ? '#22c55e' : t.textDim, flexShrink: 0,
                }}
              >
                ⟳ Auto
              </button>
              <input type="number" min={1} max={16} value={c.autoAdvanceBars}
                onChange={e => c.update({ autoAdvanceBars: Number(e.target.value) })}
                title="Bars per step"
                style={{ ...inputCss, width: 28, textAlign: 'center', fontFamily: 'monospace', fontSize: 9, flexShrink: 0 }} />
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                <button onClick={() => c.update({ chordProgressionLength: Math.max(1, c.chordProgressionLength - 1) })}
                  style={{ width: 16, height: 16, padding: 0, borderRadius: 3, border: `0.5px solid ${t.panelBorder}`, background: t.inputBg, color: t.textDim, fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', lineHeight: 1 }}>−</button>
                <span style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: t.text, minWidth: 12, textAlign: 'center' }}>{c.chordProgressionLength}</span>
                <button onClick={() => c.update({ chordProgressionLength: Math.min(8, c.chordProgressionLength + 1) })}
                  style={{ width: 16, height: 16, padding: 0, borderRadius: 3, border: `0.5px solid ${t.panelBorder}`, background: t.inputBg, color: t.textDim, fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', lineHeight: 1 }}>+</button>
              </div>
            </div>

            {/* Mini-timeline */}
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {Array.from({ length: c.chordProgressionLength }, (_, i) => {
                const slot = c.chordProgression[i]
                const isActive = c.chordIndex === i
                const label = slot
                  ? formatChordName(slot.root, slot.quality, slot.bassRoot)
                  : '—'
                const roman = slot
                  ? getScaleDegree(slot.root, slot.quality, c.key, c.scale)
                  : null
                return (
                  <button key={i} onClick={() => {
                    c.update({
                      chordIndex: i,
                      ...(slot ? { chordRoot: slot.root, chordQuality: slot.quality, chordOctave: slot.octave } : {}),
                    })
                  }} style={{
                    padding: '3px 7px', borderRadius: 4, cursor: 'pointer',
                    fontFamily: 'monospace', fontSize: 8, fontWeight: 700,
                    border: `0.5px solid ${isActive && c.autoAdvance ? 'rgba(34,197,94,0.5)' : isActive ? 'rgba(167,139,250,0.6)' : slot ? 'rgba(167,139,250,0.2)' : t.panelBorder}`,
                    background: isActive && c.autoAdvance ? 'rgba(34,197,94,0.1)' : isActive ? 'rgba(167,139,250,0.2)' : slot ? 'rgba(167,139,250,0.06)' : t.inputBg,
                    color: isActive && c.autoAdvance ? '#22c55e' : isActive ? '#c4b5fd' : slot ? 'rgba(167,139,250,0.75)' : t.textDim,
                    lineHeight: 1.2,
                  }}>
                    {isActive && c.autoAdvance && <span style={{ fontSize: 6.5, marginRight: 3 }}>⟳</span>}
                    {roman && !isActive && <span style={{ fontSize: 6.5, opacity: 0.7, marginRight: 3 }}>{roman}</span>}
                    {roman && isActive && <span style={{ fontSize: 6.5, opacity: 0.8, marginRight: 3 }}>{roman}</span>}
                    {label}
                  </button>
                )
              })}
            </div>

            {/* Preset buttons */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button onClick={c.fillDiatonic} style={{
                padding: '3px 8px', borderRadius: 3, fontFamily: 'inherit',
                fontSize: 8.5, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.03em',
                border: '0.5px solid rgba(167,139,250,0.35)', background: 'rgba(167,139,250,0.07)',
                color: 'rgba(167,139,250,0.8)',
              }} title="Fill slots with sequential diatonic chords">
                ✦ diatonic
              </button>
              <button onClick={c.randomizeDiatonic} style={{
                padding: '3px 8px', borderRadius: 3, fontFamily: 'inherit',
                fontSize: 8.5, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.03em',
                border: '0.5px solid rgba(167,139,250,0.25)', background: 'rgba(167,139,250,0.05)',
                color: 'rgba(167,139,250,0.65)',
              }} title="Randomize slots with diatonic chords from current scale">
                ⟳ random
              </button>
              {HARMONIC_PRESETS.map(p => {
                const isMatch = c.harmonicMode === p.harmonicMode && c.key === p.key && c.scale === p.scale
                return (
                  <button key={p.name} onClick={() => c.applyPreset(p)} style={{
                    padding: '3px 8px', borderRadius: 3, fontFamily: 'inherit',
                    fontSize: 8.5, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.03em',
                    border: `0.5px solid ${isMatch ? 'rgba(167,139,250,0.6)' : 'rgba(167,139,250,0.25)'}`,
                    background: isMatch ? 'rgba(167,139,250,0.18)' : 'rgba(167,139,250,0.06)',
                    color: isMatch ? '#c4b5fd' : accentColor,
                  }}>
                    {p.name}
                  </button>
                )
              })}
            </div>

            {/* Current chord */}
            <div style={{
              padding: '8px 10px', borderRadius: 5,
              background: t.sectionBg, border: `0.5px solid ${t.panelBorder}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 7.5, fontWeight: 800, color: t.textDim, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Current Chord
                </span>
                <span style={{
                  fontSize: 7, fontFamily: 'monospace', fontWeight: 700,
                  padding: '1px 5px', borderRadius: 2,
                  background: 'rgba(167,139,250,0.15)', color: '#a78bfa',
                }}>
                  step {c.chordIndex + 1}
                </span>
                {(() => {
                  const slot = c.chordProgression[c.chordIndex]
                  const inSync = slot && slot.root === c.chordRoot && slot.quality === c.chordQuality
                  return (
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      {slot && !inSync && (
                        <button
                          onClick={() => c.update({ chordRoot: slot.root, chordQuality: slot.quality, chordOctave: slot.octave })}
                          title="Load from slot"
                          style={{
                            padding: '1px 6px', borderRadius: 2, cursor: 'pointer',
                            fontSize: 7, fontWeight: 700, fontFamily: 'inherit',
                            border: '0.5px solid rgba(167,139,250,0.4)', background: 'rgba(167,139,250,0.1)',
                            color: '#a78bfa',
                          }}
                        >
                          ↻ load slot
                        </button>
                      )}
                      <button
                        onClick={() => c.updateChordSlot(c.chordIndex, { root: c.chordRoot, quality: c.chordQuality, octave: c.chordOctave, bassRoot: slot?.bassRoot ?? null })}
                        title="Save current chord to slot"
                        style={{
                          padding: '1px 6px', borderRadius: 2, cursor: 'pointer',
                          fontSize: 7, fontWeight: 700, fontFamily: 'inherit',
                          border: `0.5px solid ${inSync ? 'rgba(167,139,250,0.2)' : 'rgba(167,139,250,0.55)'}`,
                          background: inSync ? 'transparent' : 'rgba(167,139,250,0.14)',
                          color: inSync ? 'rgba(167,139,250,0.4)' : '#a78bfa',
                        }}
                      >
                        → save to slot
                      </button>
                    </div>
                  )
                })()}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr 34px 1fr', gap: 5, alignItems: 'center' }}>
                <select value={c.chordRoot} onChange={e => c.update({ chordRoot: Number(e.target.value) })} style={inputCss}>
                  {CONDUCTOR_NOTE_NAMES.map((n, i) => <option key={n} value={i} style={optionCss}>{n}</option>)}
                </select>
                <select value={c.chordQuality} onChange={e => c.update({ chordQuality: e.target.value as typeof c.chordQuality })} style={inputCss}>
                  {CONDUCTOR_CHORD_QUALITIES.map(q => <option key={q} value={q} style={optionCss}>{q}</option>)}
                </select>
                <input type="number" min={0} max={8} value={c.chordOctave}
                  onChange={e => c.update({ chordOctave: Number(e.target.value) })}
                  style={{ ...inputCss, fontFamily: 'monospace', textAlign: 'center' }} />
                <div style={{ fontSize: 8.5, color: '#a78bfa', fontFamily: 'monospace', whiteSpace: 'nowrap', letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {getChordNoteNames(c.chordRoot, c.chordQuality)}
                </div>
              </div>
            </div>

            {/* Progression slots */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '16px 14px 1fr 1.6fr 32px 1fr', gap: 4, alignItems: 'center', marginBottom: 2 }}>
                {['#', '', 'Root', 'Qual', 'Oct', 'Bass'].map(h => (
                  <span key={h} style={{ fontSize: 7, color: t.textDim, letterSpacing: '0.06em', textAlign: 'center' }}>{h}</span>
                ))}
              </div>

              {Array.from({ length: c.chordProgressionLength }, (_, i) => (
                <ChordProgressionSlot
                  key={i}
                  index={i}
                  isActive={c.chordIndex === i}
                  slot={c.chordProgression[i] ?? null}
                  contextKey={c.key}
                  contextScale={c.scale}
                  inputCss={inputCss}
                  optionCss={optionCss}
                  onChange={slot => c.updateChordSlot(i, slot)}
                  onActivate={() => {
                    const slot = c.chordProgression[i]
                    c.update({
                      chordIndex: i,
                      ...(slot ? { chordRoot: slot.root, chordQuality: slot.quality, chordOctave: slot.octave } : {}),
                    })
                  }}
                />
              ))}
            </div>

            {/* Footer */}
            <div style={{ marginTop: 'auto', display: 'flex', gap: 6 }}>
              <button onClick={c.reset} style={{
                flex: 1, padding: '4px 8px', borderRadius: 3,
                border: `0.5px solid ${t.panelBorder}`, background: t.btnBg,
                color: t.textDim, fontFamily: 'inherit', fontSize: 8.5, fontWeight: 700,
                cursor: 'pointer', letterSpacing: '0.04em',
              }}>
                Reset all
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}


function ChordProgressionSlot({
  index, isActive, slot, contextKey, contextScale, inputCss, optionCss, onChange, onActivate,
}: {
  index: number
  isActive: boolean
  slot: ChordSlot | null
  contextKey: number
  contextScale: ConductorScale
  inputCss: React.CSSProperties
  optionCss: React.CSSProperties
  onChange: (slot: ChordSlot | null) => void
  onActivate: () => void
}) {
  const enabled = slot !== null
  const cur = slot ?? { root: 0, quality: 'Min-add9' as ConductorChordQuality, octave: 3, bassRoot: null }
  const chordLabel = enabled ? formatChordName(cur.root, cur.quality, cur.bassRoot) : null
  const noteNames = enabled ? getChordNoteNames(cur.root, cur.quality) : null
  const romanNumeral = enabled ? getScaleDegree(cur.root, cur.quality, contextKey, contextScale) : null

  return (
    <div style={{
      opacity: enabled ? 1 : 0.32,
      borderRadius: 4,
      border: isActive ? '0.5px solid rgba(167,139,250,0.5)' : '0.5px solid transparent',
      background: isActive ? 'rgba(167,139,250,0.06)' : 'transparent',
      padding: '2px 3px',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '16px 14px 1fr 1.6fr 32px 1fr',
        gap: 4,
        alignItems: 'center',
      }}>
        <button
          onClick={onActivate}
          title="Set as active chord"
          style={{
            width: 16, height: 16, padding: 0, border: 'none', cursor: 'pointer',
            borderRadius: 2, fontFamily: 'monospace', fontSize: 8, fontWeight: 700,
            background: isActive ? 'rgba(167,139,250,0.25)' : enabled ? 'rgba(167,139,250,0.08)' : 'transparent',
            color: isActive ? '#a78bfa' : enabled ? 'rgba(167,139,250,0.5)' : 'transparent',
          }}
        >
          {index + 1}
        </button>
        <input
          type="checkbox" checked={enabled}
          onChange={e => onChange(e.target.checked ? { root: contextKey, quality: 'Min-add9', octave: 3, bassRoot: null } : null)}
          style={{ cursor: 'pointer', accentColor: '#a78bfa', justifySelf: 'center' }}
        />
        <select disabled={!enabled} value={cur.root}
          onChange={e => onChange({ ...cur, root: Number(e.target.value) })}
          style={{ ...inputCss, fontSize: 9 }}>
          {CONDUCTOR_NOTE_NAMES.map((n, i) => <option key={n} value={i} style={optionCss}>{n}</option>)}
        </select>
        <select disabled={!enabled} value={cur.quality}
          onChange={e => onChange({ ...cur, quality: e.target.value as ConductorChordQuality })}
          style={{ ...inputCss, fontSize: 9 }}>
          {CONDUCTOR_CHORD_QUALITIES.map(q => <option key={q} value={q} style={optionCss}>{q}</option>)}
        </select>
        <input type="number" min={0} max={8} disabled={!enabled} value={cur.octave}
          onChange={e => onChange({ ...cur, octave: Number(e.target.value) })}
          style={{ ...inputCss, fontFamily: 'monospace', textAlign: 'center', fontSize: 9 }} />
        <select disabled={!enabled} value={cur.bassRoot ?? ''}
          onChange={e => onChange({ ...cur, bassRoot: e.target.value === '' ? null : Number(e.target.value) })}
          style={{ ...inputCss, fontSize: 9 }}>
          <option value="" style={optionCss}>—</option>
          {CONDUCTOR_NOTE_NAMES.map((n, i) => <option key={n} value={i} style={optionCss}>{n}</option>)}
        </select>
      </div>
      {enabled && (
        <div style={{
          marginLeft: 34, marginTop: 2, display: 'flex', gap: 8, alignItems: 'baseline',
        }}>
          {romanNumeral && (
            <span style={{
              fontSize: 7.5, fontFamily: 'monospace', fontWeight: 800, letterSpacing: '0.04em',
              color: isActive ? 'rgba(167,139,250,0.9)' : 'rgba(167,139,250,0.5)',
              minWidth: 16,
            }}>
              {romanNumeral}
            </span>
          )}
          {chordLabel && (
            <span style={{
              fontSize: 8.5, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.03em',
              color: isActive ? '#c4b5fd' : 'rgba(167,139,250,0.8)',
            }}>
              {chordLabel}
            </span>
          )}
          {noteNames && (
            <span style={{
              fontSize: 7, fontFamily: 'monospace', letterSpacing: '0.05em',
              color: 'rgba(167,139,250,0.35)',
            }}>
              {noteNames}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function FG({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <span style={{
        fontSize: 7.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
        color: 'rgba(167,139,250,0.7)',
      }}>
        {label}
      </span>
      {children}
    </div>
  )
}

function SliderField({
  label, value, onChange, t,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  t: ReturnType<typeof import('../../lib/theme').useTheme>
}) {
  return (
    <FG label={label}>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <input type="range" min={0} max={1} step={0.01} value={value}
          onChange={e => onChange(Number(e.target.value))} style={{ flex: 1, minWidth: 0 }} />
        <span style={{ fontFamily: 'monospace', fontSize: 8.5, color: t.textDim, width: 26, textAlign: 'right' }}>
          {value.toFixed(2)}
        </span>
      </div>
    </FG>
  )
}
