// ── Chord Geometry Lab ────────────────────────────────────────────────────────
// A mode for exploring chord geometry on a 12-note circle.
// Chords are drawn as polygons; progressions animate as transformations.

import { useState, useEffect, useRef, useCallback } from 'react'
import * as Tone from 'tone'

// ── Types ─────────────────────────────────────────────────────────────────────

type PitchClass = 0|1|2|3|4|5|6|7|8|9|10|11
type ChordPresetKey = 'Major'|'Minor'|'Sus2'|'Sus4'|'Dim'|'Aug'|'Maj7'|'Min7'|'Dom7'
type CircleMode = 'chromatic' | 'fifths'

interface ChordStep {
  id: string
  root: PitchClass
  preset: ChordPresetKey | 'Custom'
  intervals: number[]
  durationBars: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

const CHROMATIC_ORDER: PitchClass[] = [0,1,2,3,4,5,6,7,8,9,10,11]
const FIFTHS_ORDER:    PitchClass[] = [0,7,2,9,4,11,6,1,8,3,10,5]

const CHORD_PRESETS: Record<ChordPresetKey, number[]> = {
  Major: [0,4,7],
  Minor: [0,3,7],
  Sus2:  [0,2,7],
  Sus4:  [0,5,7],
  Dim:   [0,3,6],
  Aug:   [0,4,8],
  Maj7:  [0,4,7,11],
  Min7:  [0,3,7,10],
  Dom7:  [0,4,7,10],
}

const PRESET_KEYS = Object.keys(CHORD_PRESETS) as ChordPresetKey[]

// Fixed SVG viewBox coordinate system
const VB = 500
const CX = VB / 2
const CY = VB / 2
const CIRCLE_R = VB * 0.355
const LABEL_R  = VB * 0.445   // label radius (beyond dots)
const DOT_R    = 5

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildChord(root: PitchClass, intervals: number[]): PitchClass[] {
  return intervals.map(i => ((root + i) % 12) as PitchClass)
}

function pitchToPoint(pitch: PitchClass, mode: CircleMode) {
  const order = mode === 'chromatic' ? CHROMATIC_ORDER : FIFTHS_ORDER
  const idx   = order.indexOf(pitch)
  const angle = (idx / 12) * Math.PI * 2 - Math.PI / 2
  return {
    x: CX + CIRCLE_R * Math.cos(angle),
    y: CY + CIRCLE_R * Math.sin(angle),
  }
}

function labelPoint(pitch: PitchClass, mode: CircleMode) {
  const order = mode === 'chromatic' ? CHROMATIC_ORDER : FIFTHS_ORDER
  const idx   = order.indexOf(pitch)
  const angle = (idx / 12) * Math.PI * 2 - Math.PI / 2
  return {
    x: CX + LABEL_R * Math.cos(angle),
    y: CY + LABEL_R * Math.sin(angle),
  }
}

function noteToFreq(pitchClass: PitchClass, octave = 4): number {
  const midi = 12 + octave * 12 + pitchClass
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function matchPreset(intervals: number[]): ChordPresetKey | 'Custom' {
  const sorted = [...intervals].sort((a, b) => a - b)
  return PRESET_KEYS.find(k => {
    const ps = [...CHORD_PRESETS[k]].sort((a, b) => a - b)
    return ps.length === sorted.length && ps.every((v, i) => v === sorted[i])
  }) ?? 'Custom'
}

// ── Geometry Operations ───────────────────────────────────────────────────────

function rotateChord(root: PitchClass, intervals: number[], delta: number) {
  return { root: ((root + delta + 12) % 12) as PitchClass, intervals: [...intervals] }
}

function mirrorChord(root: PitchClass, intervals: number[]) {
  // Reflect each interval: i → (12 - i) % 12
  const mirrored = intervals.map(i => i === 0 ? 0 : (12 - i) % 12).sort((a, b) => a - b)
  return { root, intervals: mirrored }
}

function randomWalkChord(root: PitchClass, intervals: number[]) {
  return rotateChord(root, intervals, Math.random() < 0.5 ? 1 : -1)
}

// ── Default Progression ───────────────────────────────────────────────────────

function makeStep(root: PitchClass, presetKey: ChordPresetKey, durationBars = 1): ChordStep {
  return {
    id: genId(), root, preset: presetKey,
    intervals: [...CHORD_PRESETS[presetKey]], durationBars,
  }
}

const DEFAULT_STEPS: ChordStep[] = [
  makeStep(0, 'Major'),
  makeStep(5, 'Major'),
  makeStep(7, 'Major'),
  makeStep(9, 'Minor'),
]

// ── Main Component ────────────────────────────────────────────────────────────

export function ChordGeometryLab() {
  // Left panel state
  const [root,       setRoot]       = useState<PitchClass>(0)
  const [preset,     setPreset]     = useState<ChordPresetKey | 'Custom'>('Major')
  const [intervals,  setIntervals]  = useState<number[]>([...CHORD_PRESETS['Major']])
  const [circleMode, setCircleMode] = useState<CircleMode>('chromatic')

  // Progression
  const [steps,         setSteps]         = useState<ChordStep[]>(DEFAULT_STEPS)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(DEFAULT_STEPS[0].id)

  // Transport
  const [isPlaying,   setIsPlaying]   = useState(false)
  const [bpm,         setBpm]         = useState(120)
  const [playingStep, setPlayingStep] = useState(-1)

  // Synth
  const synthRef = useRef<Tone.PolySynth | null>(null)

  // Init synth once
  useEffect(() => {
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.04, decay: 0.3, sustain: 0.45, release: 1.8 },
      volume: -12,
    }).toDestination()
    synthRef.current = synth
    return () => { synth.dispose(); synthRef.current = null }
  }, [])

  // ── Chord preview ──────────────────────────────────────────────────────────

  const playChord = useCallback(async (pitches: PitchClass[]) => {
    await Tone.start()
    const freqs = pitches.map(p => noteToFreq(p, 4))
    synthRef.current?.triggerAttackRelease(freqs, '4n')
  }, [])

  // ── Transport ──────────────────────────────────────────────────────────────

  const stopPlayback = useCallback(() => {
    Tone.Transport.stop()
    Tone.Transport.cancel()
    setIsPlaying(false)
    setPlayingStep(-1)
  }, [])

  const startPlayback = useCallback(async () => {
    await Tone.start()
    stopPlayback()

    Tone.Transport.bpm.value = bpm

    let barOffset = 0
    for (const step of steps) {
      const t = `${barOffset}:0`
      Tone.Transport.schedule(audioTime => {
        const freqs = buildChord(step.root, step.intervals).map(p => noteToFreq(p, 4))
        synthRef.current?.triggerAttackRelease(freqs, `${step.durationBars}m`, audioTime)
      }, t)
      barOffset += step.durationBars
    }

    const totalBars = steps.reduce((s, st) => s + st.durationBars, 0)
    Tone.Transport.loopStart = 0
    Tone.Transport.loopEnd   = `${totalBars}:0`
    Tone.Transport.loop      = true
    Tone.Transport.start()
    setIsPlaying(true)
  }, [bpm, steps, stopPlayback])

  // Stop on unmount
  useEffect(() => () => stopPlayback(), [stopPlayback])

  // Sync bpm live
  useEffect(() => {
    if (isPlaying) Tone.Transport.bpm.value = bpm
  }, [bpm, isPlaying])

  // RAF loop: track playing step via Transport.progress
  useEffect(() => {
    if (!isPlaying) return
    const totalBars = steps.reduce((s, st) => s + st.durationBars, 0)
    let raf: number
    const tick = () => {
      const progress = Tone.Transport.progress
      const currentBar = progress * totalBars
      let acc = 0
      let idx = 0
      for (let i = 0; i < steps.length; i++) {
        acc += steps[i].durationBars
        if (currentBar < acc) { idx = i; break }
        if (i === steps.length - 1) idx = i
      }
      setPlayingStep(idx)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, steps])

  // ── Geometry ops ──────────────────────────────────────────────────────────

  function applyGeo(op: 'rotate+1' | 'rotate-1' | 'mirror' | 'random') {
    let res = { root, intervals }
    if (op === 'rotate+1') res = rotateChord(root, intervals, 1)
    else if (op === 'rotate-1') res = rotateChord(root, intervals, -1)
    else if (op === 'mirror')   res = mirrorChord(root, intervals)
    else if (op === 'random')   res = randomWalkChord(root, intervals)
    setRoot(res.root)
    setIntervals(res.intervals)
    setPreset(matchPreset(res.intervals))
    void playChord(buildChord(res.root, res.intervals))
  }

  // ── Current chord ─────────────────────────────────────────────────────────

  const activeNotes = buildChord(root, intervals)

  function selectRoot(p: PitchClass) {
    setRoot(p)
    void playChord(buildChord(p, intervals))
  }

  function selectPreset(key: ChordPresetKey) {
    setPreset(key)
    const ivs = [...CHORD_PRESETS[key]]
    setIntervals(ivs)
    void playChord(buildChord(root, ivs))
  }

  // ── Progression ops ───────────────────────────────────────────────────────

  function addToProgression() {
    const step: ChordStep = {
      id: genId(), root, preset: matchPreset(intervals),
      intervals: [...intervals], durationBars: 1,
    }
    setSteps(prev => [...prev, step])
    setSelectedStepId(step.id)
    if (isPlaying) void startPlayback()   // restart to include new step
  }

  function deleteStep(id: string) {
    setSteps(prev => {
      const next = prev.filter(s => s.id !== id)
      if (selectedStepId === id) setSelectedStepId(next[0]?.id ?? null)
      return next
    })
    if (isPlaying) void startPlayback()
  }

  function loadStep(step: ChordStep) {
    setRoot(step.root)
    setIntervals([...step.intervals])
    setPreset(step.preset === 'Custom' ? matchPreset(step.intervals) : step.preset)
    setSelectedStepId(step.id)
    void playChord(buildChord(step.root, step.intervals))
  }

  function setStepDuration(id: string, bars: number) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, durationBars: Math.max(1, Math.min(8, bars)) } : s))
  }

  // ── SVG polygon points ─────────────────────────────────────────────────────

  const polygonPoints = activeNotes
    .map(p => pitchToPoint(p, circleMode))
    .map(pt => `${pt.x},${pt.y}`)
    .join(' ')

  // ── Render ─────────────────────────────────────────────────────────────────

  const presetLabel = preset === 'Custom' ? 'Custom' : preset
  const chordLabel  = `${NOTE_NAMES[root]}${presetLabel}`
  const noteLabel   = activeNotes.map(n => NOTE_NAMES[n]).join(' ')

  return (
    <div style={{
      flex: 1, display: 'flex', overflow: 'hidden',
      background: '#080810', color: 'rgba(255,255,255,0.88)',
      fontFamily: 'system-ui, sans-serif',
    }}>

      {/* ── Left Control Panel ─────────────────────────────────────────────── */}
      <div style={{
        width: 208, flexShrink: 0, overflowY: 'auto',
        borderRight: '0.5px solid rgba(255,255,255,0.07)',
        padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 16,
      }}>

        {/* Circle Mode */}
        <PanelSection label="Display">
          <div style={{ display: 'flex', gap: 4 }}>
            {(['chromatic', 'fifths'] as CircleMode[]).map(m => (
              <button key={m} onClick={() => setCircleMode(m)} style={tabBtn(circleMode === m)}>
                {m === 'chromatic' ? 'Chromatic' : 'Fifths'}
              </button>
            ))}
          </div>
        </PanelSection>

        {/* Root selector */}
        <PanelSection label="Root">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
            {NOTE_NAMES.map((name, i) => (
              <button key={i} onClick={() => selectRoot(i as PitchClass)}
                style={noteBtn(root === i, name.includes('#'))}>
                {name}
              </button>
            ))}
          </div>
        </PanelSection>

        {/* Chord type */}
        <PanelSection label="Chord">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {PRESET_KEYS.map(key => (
              <button key={key} onClick={() => selectPreset(key)} style={presetBtn(preset === key)}>
                <span style={{ fontWeight: 700, minWidth: 38, fontSize: 11 }}>{key}</span>
                <span style={{ color: 'rgba(255,255,255,0.30)', fontSize: 9, fontFamily: 'monospace' }}>
                  {CHORD_PRESETS[key].join('-')}
                </span>
              </button>
            ))}
          </div>
        </PanelSection>

        {/* Geometry ops */}
        <PanelSection label="Geometry">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {([
              ['rotate+1', '▲ +1'],
              ['rotate-1', '▼ −1'],
              ['mirror',   '↔ Mirror'],
              ['random',   '⚂ Walk'],
            ] as const).map(([op, label]) => (
              <button key={op} onClick={() => applyGeo(op)} style={geoBtn()}>{label}</button>
            ))}
          </div>
        </PanelSection>

        {/* Current chord info */}
        <PanelSection label="Current">
          <div style={{ fontSize: 11, fontWeight: 600, color: '#c4b5fd', marginBottom: 4 }}>
            {chordLabel}
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace', marginBottom: 8 }}>
            {noteLabel}
          </div>
          <button
            onClick={addToProgression}
            style={{
              ...geoBtn(), width: '100%',
              background: 'rgba(139,92,246,0.18)',
              border: '0.5px solid rgba(139,92,246,0.38)',
              color: '#c4b5fd', fontWeight: 700,
            }}>
            + Add to Progression
          </button>
        </PanelSection>

        <div style={{ flex: 1 }} />
      </div>

      {/* ── Main Area ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>

        {/* ── Circle SVG ──────────────────────────────────────────────────── */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg
            viewBox={`0 0 ${VB} ${VB}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: '100%', display: 'block' }}
          >
            {/* Outer guide ring */}
            <circle cx={CX} cy={CY} r={CIRCLE_R + 30}
              fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth={1} />

            {/* Main circle ring */}
            <circle cx={CX} cy={CY} r={CIRCLE_R}
              fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

            {/* Chord polygon fill */}
            {activeNotes.length >= 3 && (
              <polygon
                points={polygonPoints}
                fill="rgba(139,92,246,0.12)"
                stroke="none"
              />
            )}

            {/* Chord polygon stroke */}
            {activeNotes.length >= 2 && (
              <polygon
                points={polygonPoints}
                fill="none"
                stroke="#7c3aed"
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            )}

            {/* Spoke lines (subtle) */}
            {CHROMATIC_ORDER.map(p => {
              const pt = pitchToPoint(p, circleMode)
              return (
                <line key={`spoke-${p}`}
                  x1={CX} y1={CY}
                  x2={pt.x} y2={pt.y}
                  stroke="rgba(255,255,255,0.02)" strokeWidth={1}
                />
              )
            })}

            {/* Note dots & labels */}
            {CHROMATIC_ORDER.map(p => {
              const pt  = pitchToPoint(p, circleMode)
              const lpt = labelPoint(p, circleMode)
              const isActive = activeNotes.includes(p)
              const isRoot   = p === root
              return (
                <g key={`note-${p}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => selectRoot(p)}>

                  {/* Outer ring on root */}
                  {isRoot && (
                    <circle cx={pt.x} cy={pt.y} r={DOT_R + 5}
                      fill="none" stroke="rgba(196,181,253,0.35)" strokeWidth={1} />
                  )}

                  {/* Dot */}
                  <circle
                    cx={pt.x} cy={pt.y}
                    r={isActive ? (isRoot ? DOT_R + 2 : DOT_R + 1) : DOT_R - 1}
                    fill={isActive ? (isRoot ? '#c4b5fd' : '#8b5cf6') : 'rgba(255,255,255,0.14)'}
                  />

                  {/* Note label */}
                  <text
                    x={lpt.x} y={lpt.y}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={isActive ? 11 : 10}
                    fontWeight={isActive ? 700 : 400}
                    fill={isActive ? (isRoot ? '#e9d5ff' : '#a78bfa') : 'rgba(255,255,255,0.28)'}
                    fontFamily="system-ui, sans-serif"
                  >
                    {NOTE_NAMES[p]}
                  </text>
                </g>
              )
            })}

            {/* Centre chord label */}
            <text
              x={CX} y={CY - 12}
              textAnchor="middle"
              fontSize={28} fontWeight={800}
              fill="#c4b5fd" fontFamily="system-ui, sans-serif"
            >
              {NOTE_NAMES[root]}
            </text>
            <text
              x={CX} y={CY + 16}
              textAnchor="middle"
              fontSize={13} fontWeight={500}
              fill="rgba(255,255,255,0.35)" fontFamily="system-ui, sans-serif"
            >
              {presetLabel}
            </text>
          </svg>
        </div>

        {/* ── Progression Timeline ─────────────────────────────────────────── */}
        <div style={{
          height: 164, flexShrink: 0,
          borderTop: '0.5px solid rgba(255,255,255,0.07)',
          background: 'rgba(0,0,0,0.30)',
          display: 'flex', flexDirection: 'column',
        }}>

          {/* Transport bar */}
          <div style={{
            height: 42, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
            padding: '0 14px', borderBottom: '0.5px solid rgba(255,255,255,0.05)',
          }}>
            <button
              onClick={isPlaying ? stopPlayback : startPlayback}
              style={{
                ...geoBtn(),
                width: 76, fontWeight: 700, fontSize: 12,
                background: isPlaying ? 'rgba(239,68,68,0.15)' : 'rgba(139,92,246,0.18)',
                borderColor: isPlaying ? 'rgba(239,68,68,0.30)' : 'rgba(139,92,246,0.35)',
                color: isPlaying ? '#fca5a5' : '#c4b5fd',
              }}>
              {isPlaying ? '■ Stop' : '▶ Play'}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>BPM</span>
              <input
                type="number" value={bpm} min={40} max={300} step={1}
                onChange={e => setBpm(Math.max(40, Math.min(300, Number(e.target.value))))}
                style={{
                  width: 52, fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
                  padding: '2px 6px', borderRadius: 4,
                  background: 'rgba(255,255,255,0.07)',
                  border: '0.5px solid rgba(255,255,255,0.12)',
                  color: 'rgba(255,255,255,0.88)', outline: 'none',
                }}
              />
            </div>

            <div style={{ flex: 1 }} />

            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
              {steps.length} steps · {steps.reduce((s, st) => s + st.durationBars, 0)} bars
            </span>
          </div>

          {/* Steps row */}
          <div style={{
            flex: 1, overflowX: 'auto', display: 'flex', alignItems: 'center',
            gap: 6, padding: '0 14px',
          }}>
            {steps.map((step, i) => {
              const isSel    = step.id === selectedStepId
              const isActive = playingStep === i
              return (
                <div key={step.id} style={{ flexShrink: 0, position: 'relative' }}>
                  {/* Delete button on selected */}
                  {isSel && !isActive && (
                    <button
                      onClick={e => { e.stopPropagation(); deleteStep(step.id) }}
                      style={{
                        position: 'absolute', top: -6, right: -6, zIndex: 10,
                        width: 16, height: 16, borderRadius: '50%', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(239,68,68,0.80)', border: 'none',
                        color: '#fff', fontSize: 9, cursor: 'pointer', fontWeight: 700,
                      }}>×</button>
                  )}
                  <div
                    onClick={() => loadStep(step)}
                    style={{
                      minWidth: 68, padding: '6px 10px', borderRadius: 7,
                      border: `1px solid ${
                        isActive ? '#8b5cf6' : isSel ? 'rgba(139,92,246,0.50)' : 'rgba(255,255,255,0.09)'
                      }`,
                      background: isActive
                        ? 'rgba(139,92,246,0.28)'
                        : isSel
                          ? 'rgba(139,92,246,0.12)'
                          : 'rgba(255,255,255,0.04)',
                      cursor: 'pointer', transition: 'border-color 0.1s, background 0.1s',
                    }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: isActive ? '#e9d5ff' : 'rgba(255,255,255,0.88)', fontFamily: 'monospace' }}>
                      {NOTE_NAMES[step.root]}
                    </div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.40)', marginTop: 1 }}>
                      {step.preset}
                    </div>
                    {/* Duration adjuster */}
                    {isSel ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
                        <button onClick={e => { e.stopPropagation(); setStepDuration(step.id, step.durationBars - 1) }}
                          style={{ ...miniBtn(), padding: '0px 4px' }}>−</button>
                        <span style={{ fontSize: 9, color: 'rgba(139,92,246,0.80)', minWidth: 20, textAlign: 'center' }}>
                          {step.durationBars}b
                        </span>
                        <button onClick={e => { e.stopPropagation(); setStepDuration(step.id, step.durationBars + 1) }}
                          style={{ ...miniBtn(), padding: '0px 4px' }}>+</button>
                      </div>
                    ) : (
                      <div style={{ fontSize: 9, color: 'rgba(139,92,246,0.50)', marginTop: 3 }}>
                        {step.durationBars}bar
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Add step */}
            <button
              onClick={addToProgression}
              style={{
                minWidth: 42, height: 64, borderRadius: 7, flexShrink: 0,
                border: '1px dashed rgba(255,255,255,0.13)', background: 'transparent',
                color: 'rgba(255,255,255,0.25)', fontSize: 20, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>+</button>
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PanelSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.30)', marginBottom: 7,
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

// ── Button style helpers ──────────────────────────────────────────────────────

function tabBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: '4px 0', borderRadius: 4, fontSize: 10, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
    border: '0.5px solid rgba(255,255,255,0.10)',
    background: active ? 'rgba(139,92,246,0.25)' : 'rgba(255,255,255,0.05)',
    color: active ? '#c4b5fd' : 'rgba(255,255,255,0.42)',
  }
}

function noteBtn(active: boolean, isSharp: boolean): React.CSSProperties {
  return {
    padding: '4px 2px', borderRadius: 4, fontSize: 10, fontWeight: active ? 700 : 500,
    cursor: 'pointer', fontFamily: 'monospace',
    border: '0.5px solid rgba(255,255,255,0.08)',
    background: active ? 'rgba(139,92,246,0.30)' : isSharp ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
    color: active ? '#e9d5ff' : 'rgba(255,255,255,0.55)',
  }
}

function presetBtn(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '4px 8px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
    border: '0.5px solid rgba(255,255,255,0.08)',
    background: active ? 'rgba(139,92,246,0.22)' : 'rgba(255,255,255,0.03)',
    color: active ? '#d8b4fe' : 'rgba(255,255,255,0.60)',
  }
}

function geoBtn(): React.CSSProperties {
  return {
    padding: '5px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
    border: '0.5px solid rgba(255,255,255,0.11)',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.68)',
  }
}

function miniBtn(): React.CSSProperties {
  return {
    fontSize: 9, fontWeight: 700, borderRadius: 3, cursor: 'pointer',
    fontFamily: 'monospace', border: '0.5px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.60)',
  }
}
