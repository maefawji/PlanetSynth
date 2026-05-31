// ── Chord Geometry Lab ────────────────────────────────────────────────────────
// A mode for exploring chord geometry on a 12-note circle.
// Chords are drawn as polygons; progressions animate as transformations.
// Includes a Progression Suggester with music theory explanations.

import { useState, useEffect, useRef, useCallback } from 'react'
import * as Tone from 'tone'

// ── Types ─────────────────────────────────────────────────────────────────────

type PitchClass = 0|1|2|3|4|5|6|7|8|9|10|11
type ChordPresetKey = 'Major'|'Minor'|'Sus2'|'Sus4'|'Dim'|'Aug'|'Maj7'|'Min7'|'Dom7'
type CircleMode = 'chromatic' | 'fifths'
type LabMode = 'build' | 'suggest'
type FunctionLabel = 'T' | 'S' | 'D'
type MoodTag = 'happy' | 'sad' | 'tense' | 'peaceful' | 'epic' | 'romantic'

interface ChordStep {
  id: string
  root: PitchClass
  preset: ChordPresetKey | 'Custom'
  intervals: number[]
  durationBars: number
}

interface AnnotatedChordStep extends ChordStep {
  roman: string
  func: FunctionLabel
  tension: number
}

interface ProgressionTemplate {
  id: string
  name: string
  degrees: number[]
  scaleMode: 'major' | 'minor'
  qualityOverrides?: Partial<Record<number, ChordPresetKey>>
  moods: MoodTag[]
  difficulty: 'beginner' | 'intermediate'
  description: string
}

interface ProgressionSuggestion {
  id: string
  name: string
  key: { root: PitchClass; mode: 'major' | 'minor' }
  steps: AnnotatedChordStep[]
  description: string
  tensionCurve: number[]
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
const LABEL_R  = VB * 0.445
const DOT_R    = 5

// ── Music Theory Constants ────────────────────────────────────────────────────

interface ScaleDegreeEntry {
  semitones: number
  quality: ChordPresetKey
  roman: string
  func: FunctionLabel
  tension: number
}

const MAJOR_SCALE_DEGREES: ScaleDegreeEntry[] = [
  { semitones: 0,  quality: 'Major', roman: 'I',    func: 'T', tension: 0.0 },
  { semitones: 2,  quality: 'Minor', roman: 'ii',   func: 'S', tension: 0.5 },
  { semitones: 4,  quality: 'Minor', roman: 'iii',  func: 'T', tension: 0.3 },
  { semitones: 5,  quality: 'Major', roman: 'IV',   func: 'S', tension: 0.4 },
  { semitones: 7,  quality: 'Major', roman: 'V',    func: 'D', tension: 0.8 },
  { semitones: 9,  quality: 'Minor', roman: 'vi',   func: 'T', tension: 0.2 },
  { semitones: 11, quality: 'Dim',   roman: 'vii°', func: 'D', tension: 0.9 },
]

const MINOR_SCALE_DEGREES: ScaleDegreeEntry[] = [
  { semitones: 0,  quality: 'Minor', roman: 'i',    func: 'T', tension: 0.0 },
  { semitones: 2,  quality: 'Dim',   roman: 'ii°',  func: 'S', tension: 0.6 },
  { semitones: 3,  quality: 'Major', roman: 'III',  func: 'T', tension: 0.2 },
  { semitones: 5,  quality: 'Minor', roman: 'iv',   func: 'S', tension: 0.4 },
  { semitones: 7,  quality: 'Minor', roman: 'v',    func: 'D', tension: 0.6 },
  { semitones: 8,  quality: 'Major', roman: 'VI',   func: 'T', tension: 0.3 },
  { semitones: 10, quality: 'Major', roman: 'VII',  func: 'D', tension: 0.7 },
]

const FUNC_COLORS: Record<FunctionLabel, string> = {
  T: '#86efac',
  S: '#93c5fd',
  D: '#fca5a5',
}

const FUNC_LABELS: Record<FunctionLabel, string> = {
  T: 'Tonic',
  S: 'Subdominant',
  D: 'Dominant',
}

const FUNC_DESCS: Record<FunctionLabel, string> = {
  T: 'Stable home — restful, resolved',
  S: 'Movement away — openness, lift',
  D: 'Tension — strong pull back to tonic',
}

const MOOD_LABELS: Record<MoodTag, string> = {
  happy:    '☀ Happy',
  sad:      '☁ Sad',
  tense:    '⚡ Tense',
  peaceful: '〜 Peaceful',
  epic:     '★ Epic',
  romantic: '♡ Romantic',
}

const PROGRESSION_TEMPLATES: ProgressionTemplate[] = [
  {
    id: 'pop-axis', name: 'Pop Axis',
    degrees: [1, 5, 6, 4], scaleMode: 'major',
    moods: ['happy', 'romantic'], difficulty: 'beginner',
    description: 'I → V → vi → IV. The most popular modern pop progression. The vi gives a brief emotional dip before IV brings it home.',
  },
  {
    id: 'classic-1451', name: 'I-IV-V',
    degrees: [1, 4, 5, 1], scaleMode: 'major',
    moods: ['happy', 'epic'], difficulty: 'beginner',
    description: 'I → IV → V → I. Three-chord foundation of rock, country and blues. Tonic → Subdominant → Dominant → home.',
  },
  {
    id: 'fifties', name: '50s Ballad',
    degrees: [1, 6, 4, 5], scaleMode: 'major',
    moods: ['happy', 'romantic'], difficulty: 'beginner',
    description: 'I → vi → IV → V. Classic doo-wop / 50s rock sound. Tonic, relative minor, subdominant, dominant.',
  },
  {
    id: 'jazz-251', name: 'Jazz ii-V-I',
    degrees: [2, 5, 1], scaleMode: 'major',
    moods: ['romantic', 'peaceful'], difficulty: 'intermediate',
    description: 'ii → V → I. The cornerstone of jazz harmony. Maximally smooth voice leading with strong dominant resolution.',
  },
  {
    id: 'pachelbel', name: 'Canon',
    degrees: [1, 5, 6, 3, 4, 1, 4, 5], scaleMode: 'major',
    moods: ['romantic', 'peaceful'], difficulty: 'beginner',
    description: 'I → V → vi → iii → IV → I → IV → V. Pachelbel\'s famous descending bass line. Extremely smooth voice leading.',
  },
  {
    id: 'minor-epic', name: 'Minor Epic',
    degrees: [1, 7, 6, 7], scaleMode: 'minor',
    moods: ['epic', 'tense'], difficulty: 'beginner',
    description: 'i → VII → VI → VII. Dark and driving. Circles around the subtonic creating persistent tension.',
  },
  {
    id: 'natural-minor', name: 'Natural Minor',
    degrees: [1, 4, 7, 3], scaleMode: 'minor',
    moods: ['sad', 'peaceful'], difficulty: 'beginner',
    description: 'i → iv → VII → III. Pure aeolian mode — flows naturally through the natural minor scale.',
  },
  {
    id: 'andalusian', name: 'Andalusian',
    degrees: [1, 7, 6, 5], scaleMode: 'minor',
    moods: ['tense', 'epic'], difficulty: 'beginner',
    description: 'i → VII → VI → v. Descending bass line. Creates flamenco / film-score drama.',
  },
  {
    id: 'minor-ballad', name: 'Minor Ballad',
    degrees: [1, 6, 3, 7], scaleMode: 'minor',
    moods: ['sad', 'romantic'], difficulty: 'beginner',
    description: 'i → VI → III → VII. Melancholic minor ballad with a sense of floating sadness.',
  },
  {
    id: 'blues-core', name: 'Blues Core',
    degrees: [1, 4, 1, 5], scaleMode: 'major',
    qualityOverrides: { 1: 'Dom7', 4: 'Dom7', 5: 'Dom7' },
    moods: ['sad', 'epic'], difficulty: 'intermediate',
    description: 'I7 → IV7 → I7 → V7. Blues foundation using dominant 7ths on all chords.',
  },
  {
    id: 'royal-road', name: 'Royal Road',
    degrees: [4, 7, 3, 6, 2, 5, 1], scaleMode: 'major',
    moods: ['peaceful', 'romantic'], difficulty: 'intermediate',
    description: 'IV → vii° → iii → vi → ii → V → I. Chain of descending fifths resolving home.',
  },
  {
    id: 'dorian-vamp', name: 'Dorian Vamp',
    degrees: [1, 4], scaleMode: 'minor',
    qualityOverrides: { 4: 'Major' },
    moods: ['peaceful', 'epic'], difficulty: 'intermediate',
    description: 'i → IV (major). Two-chord dorian vamp. The raised IV gives minor a bright, funky character.',
  },
]

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
  const mirrored = intervals.map(i => i === 0 ? 0 : (12 - i) % 12).sort((a, b) => a - b)
  return { root, intervals: mirrored }
}

function randomWalkChord(root: PitchClass, intervals: number[]) {
  return rotateChord(root, intervals, Math.random() < 0.5 ? 1 : -1)
}

// ── Theory Engine ─────────────────────────────────────────────────────────────

function buildSuggestion(template: ProgressionTemplate, keyRoot: PitchClass): ProgressionSuggestion {
  const scaleInfo = template.scaleMode === 'major' ? MAJOR_SCALE_DEGREES : MINOR_SCALE_DEGREES
  const steps: AnnotatedChordStep[] = template.degrees
    .map(degree => {
      const di = scaleInfo[degree - 1]
      if (!di) return null
      const root = ((keyRoot + di.semitones) % 12) as PitchClass
      const quality = template.qualityOverrides?.[degree] ?? di.quality
      return {
        id: genId(),
        root,
        preset: quality,
        intervals: [...CHORD_PRESETS[quality]],
        durationBars: 1,
        roman: di.roman,
        func: di.func,
        tension: di.tension,
      }
    })
    .filter((s): s is AnnotatedChordStep => s !== null)

  return {
    id: genId(),
    name: `${template.name} in ${NOTE_NAMES[keyRoot]} ${template.scaleMode === 'major' ? 'Major' : 'Minor'}`,
    key: { root: keyRoot, mode: template.scaleMode },
    steps,
    description: template.description,
    tensionCurve: steps.map(s => s.tension),
  }
}

function generateSuggestions(
  keyRoot: PitchClass,
  moods: MoodTag[],
  length: number | null,
  difficulty: 'beginner' | 'intermediate' | 'all'
): ProgressionSuggestion[] {
  let templates = [...PROGRESSION_TEMPLATES]
  if (moods.length > 0) templates = templates.filter(t => t.moods.some(m => moods.includes(m)))
  if (length !== null) templates = templates.filter(t => t.degrees.length === length)
  if (difficulty !== 'all') templates = templates.filter(t => t.difficulty === difficulty)
  if (templates.length === 0) templates = PROGRESSION_TEMPLATES.slice(0, 6)
  return templates.map(t => buildSuggestion(t, keyRoot))
}

function getSharedNotes(chord1: PitchClass[], chord2: PitchClass[]): PitchClass[] {
  return chord1.filter(n => chord2.includes(n))
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
  // ── Lab mode ───────────────────────────────────────────────────────────────
  const [labMode, setLabMode]  = useState<LabMode>('build')

  // ── Build mode state ───────────────────────────────────────────────────────
  const [root,       setRoot]       = useState<PitchClass>(0)
  const [preset,     setPreset]     = useState<ChordPresetKey | 'Custom'>('Major')
  const [intervals,  setIntervals]  = useState<number[]>([...CHORD_PRESETS['Major']])
  const [circleMode, setCircleMode] = useState<CircleMode>('chromatic')
  const [steps,         setSteps]         = useState<ChordStep[]>(DEFAULT_STEPS)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(DEFAULT_STEPS[0].id)

  // ── Suggest mode state ─────────────────────────────────────────────────────
  const [suggestKey,        setSuggestKey]        = useState<{ root: PitchClass; mode: 'major' | 'minor' }>({ root: 0, mode: 'major' })
  const [suggestMoods,      setSuggestMoods]      = useState<MoodTag[]>([])
  const [suggestLength,     setSuggestLength]     = useState<number | null>(4)
  const [suggestDifficulty, setSuggestDifficulty] = useState<'beginner' | 'intermediate' | 'all'>('all')
  const [suggestions,       setSuggestions]       = useState<ProgressionSuggestion[]>([])
  const [selectedSuggestion, setSelectedSuggestion] = useState<ProgressionSuggestion | null>(null)
  const [theoryStepIdx,     setTheoryStepIdx]     = useState<number | null>(null)

  // ── Transport ──────────────────────────────────────────────────────────────
  const [isPlaying,   setIsPlaying]   = useState(false)
  const [bpm,         setBpm]         = useState(120)
  const [playingStep, setPlayingStep] = useState(-1)

  // ── Synth ──────────────────────────────────────────────────────────────────
  const synthRef = useRef<Tone.PolySynth | null>(null)

  // Active steps: suggest mode previews suggestion, build mode uses own steps
  const activeSteps: ChordStep[] = (labMode === 'suggest' && selectedSuggestion)
    ? selectedSuggestion.steps
    : steps

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

  // Auto-generate suggestions when entering suggest mode for the first time
  useEffect(() => {
    if (labMode === 'suggest' && suggestions.length === 0) {
      const results = generateSuggestions(suggestKey.root, [], 4, 'all')
      setSuggestions(results)
      if (results.length > 0) {
        setSelectedSuggestion(results[0])
        const first = results[0].steps[0]
        if (first) { setRoot(first.root); setIntervals([...first.intervals]) }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labMode])

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
    for (const step of activeSteps) {
      const t = `${barOffset}:0`
      Tone.Transport.schedule(audioTime => {
        const freqs = buildChord(step.root, step.intervals).map(p => noteToFreq(p, 4))
        synthRef.current?.triggerAttackRelease(freqs, `${step.durationBars}m`, audioTime)
      }, t)
      barOffset += step.durationBars
    }

    const totalBars = activeSteps.reduce((s, st) => s + st.durationBars, 0)
    Tone.Transport.loopStart = 0
    Tone.Transport.loopEnd   = `${totalBars}:0`
    Tone.Transport.loop      = true
    Tone.Transport.start()
    setIsPlaying(true)
  }, [bpm, activeSteps, stopPlayback])

  // Stop on unmount
  useEffect(() => () => stopPlayback(), [stopPlayback])

  // Sync bpm live
  useEffect(() => {
    if (isPlaying) Tone.Transport.bpm.value = bpm
  }, [bpm, isPlaying])

  // RAF loop: track playing step via Transport.progress
  useEffect(() => {
    if (!isPlaying) return
    const totalBars = activeSteps.reduce((s, st) => s + st.durationBars, 0)
    let raf: number
    const tick = () => {
      const progress = Tone.Transport.progress
      const currentBar = progress * totalBars
      let acc = 0
      let idx = 0
      for (let i = 0; i < activeSteps.length; i++) {
        acc += activeSteps[i].durationBars
        if (currentBar < acc) { idx = i; break }
        if (i === activeSteps.length - 1) idx = i
      }
      setPlayingStep(idx)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, activeSteps])

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

  // ── Current chord (Build mode) ─────────────────────────────────────────────

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

  // ── Build mode progression ops ─────────────────────────────────────────────

  function addToProgression() {
    const step: ChordStep = {
      id: genId(), root, preset: matchPreset(intervals),
      intervals: [...intervals], durationBars: 1,
    }
    setSteps(prev => [...prev, step])
    setSelectedStepId(step.id)
    if (isPlaying) void startPlayback()
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

  // ── Suggest mode ops ───────────────────────────────────────────────────────

  function toggleMood(mood: MoodTag) {
    setSuggestMoods(prev => prev.includes(mood) ? prev.filter(m => m !== mood) : [...prev, mood])
  }

  function handleGenerate() {
    const results = generateSuggestions(suggestKey.root, suggestMoods, suggestLength, suggestDifficulty)
    setSuggestions(results)
    const first = results[0] ?? null
    setSelectedSuggestion(first)
    setTheoryStepIdx(null)
    if (first?.steps[0]) {
      setRoot(first.steps[0].root)
      setIntervals([...first.steps[0].intervals])
    }
  }

  function applySuggestion(sug: ProgressionSuggestion) {
    setSelectedSuggestion(sug)
    setTheoryStepIdx(null)
    stopPlayback()
    if (sug.steps[0]) {
      setRoot(sug.steps[0].root)
      setIntervals([...sug.steps[0].intervals])
    }
  }

  function handleSuggestStepClick(step: AnnotatedChordStep, idx: number) {
    setRoot(step.root)
    setIntervals([...step.intervals])
    setTheoryStepIdx(idx)
    void playChord(buildChord(step.root, step.intervals))
  }

  function loadSuggestionToTimeline() {
    if (!selectedSuggestion) return
    setSteps(selectedSuggestion.steps)
    setSelectedStepId(selectedSuggestion.steps[0]?.id ?? null)
    setLabMode('build')
    stopPlayback()
  }

  // ── SVG polygon points ─────────────────────────────────────────────────────

  const polygonPoints = activeNotes
    .map(p => pitchToPoint(p, circleMode))
    .map(pt => `${pt.x},${pt.y}`)
    .join(' ')

  // ── Theory panel data ──────────────────────────────────────────────────────

  // Determine which step to show theory for
  const theoryIdx = theoryStepIdx !== null
    ? theoryStepIdx
    : isPlaying ? playingStep : null

  const theoryStep = (labMode === 'suggest' && selectedSuggestion && theoryIdx !== null)
    ? (selectedSuggestion.steps[theoryIdx] ?? null)
    : null

  const theoryNextStep = (theoryStep && selectedSuggestion && theoryIdx !== null)
    ? (selectedSuggestion.steps[(theoryIdx + 1) % selectedSuggestion.steps.length] ?? null)
    : null

  const sharedWithNext = (theoryStep && theoryNextStep)
    ? getSharedNotes(
        buildChord(theoryStep.root, theoryStep.intervals),
        buildChord(theoryNextStep.root, theoryNextStep.intervals)
      )
    : []

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
        padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 12,
      }}>

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: 2 }}>
          {(['build', 'suggest'] as LabMode[]).map(m => (
            <button key={m} onClick={() => setLabMode(m)} style={tabBtn(labMode === m)}>
              {m === 'build' ? '⬡ Build' : '✦ Suggest'}
            </button>
          ))}
        </div>

        {/* ── BUILD MODE ────────────────────────────────────────────────────── */}
        {labMode === 'build' && (<>

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

        </>)}

        {/* ── SUGGEST MODE ──────────────────────────────────────────────────── */}
        {labMode === 'suggest' && (<>

          {/* Key selector */}
          <PanelSection label="Key">
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <select
                value={suggestKey.root}
                onChange={e => setSuggestKey(k => ({ ...k, root: Number(e.target.value) as PitchClass }))}
                style={{
                  flex: 1, fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
                  padding: '3px 4px', borderRadius: 4,
                  background: 'rgba(255,255,255,0.07)', border: '0.5px solid rgba(255,255,255,0.15)',
                  color: 'rgba(255,255,255,0.88)', outline: 'none', cursor: 'pointer',
                }}
              >
                {NOTE_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 2 }}>
                {(['major', 'minor'] as const).map(m => (
                  <button key={m} onClick={() => setSuggestKey(k => ({ ...k, mode: m }))}
                    style={{ ...tabBtn(suggestKey.mode === m), padding: '3px 6px', fontSize: 9 }}>
                    {m === 'major' ? 'Maj' : 'Min'}
                  </button>
                ))}
              </div>
            </div>
          </PanelSection>

          {/* Mood selector */}
          <PanelSection label="Mood (optional)">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {(Object.keys(MOOD_LABELS) as MoodTag[]).map(mood => (
                <button key={mood} onClick={() => toggleMood(mood)}
                  style={{
                    fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 10,
                    fontFamily: 'inherit', cursor: 'pointer',
                    border: suggestMoods.includes(mood)
                      ? '0.5px solid rgba(139,92,246,0.6)'
                      : '0.5px solid rgba(255,255,255,0.12)',
                    background: suggestMoods.includes(mood)
                      ? 'rgba(139,92,246,0.25)'
                      : 'rgba(255,255,255,0.04)',
                    color: suggestMoods.includes(mood) ? '#c4b5fd' : 'rgba(255,255,255,0.45)',
                  }}>
                  {MOOD_LABELS[mood]}
                </button>
              ))}
            </div>
          </PanelSection>

          {/* Length */}
          <PanelSection label="Length">
            <div style={{ display: 'flex', gap: 3 }}>
              {([null, 3, 4, 8] as (number | null)[]).map(len => (
                <button key={String(len)} onClick={() => setSuggestLength(len)}
                  style={{ ...tabBtn(suggestLength === len), fontSize: 9, padding: '3px 6px' }}>
                  {len === null ? 'Any' : `${len}`}
                </button>
              ))}
            </div>
          </PanelSection>

          {/* Difficulty */}
          <PanelSection label="Difficulty">
            <div style={{ display: 'flex', gap: 2 }}>
              {([['all', 'All'], ['beginner', 'Easy'], ['intermediate', 'Mid']] as const).map(([d, label]) => (
                <button key={d} onClick={() => setSuggestDifficulty(d)}
                  style={{ ...tabBtn(suggestDifficulty === d), fontSize: 9, padding: '3px 6px' }}>
                  {label}
                </button>
              ))}
            </div>
          </PanelSection>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            style={{
              ...geoBtn(), width: '100%', fontWeight: 700, fontSize: 11,
              background: 'rgba(139,92,246,0.22)',
              border: '0.5px solid rgba(139,92,246,0.45)',
              color: '#c4b5fd',
            }}>
            ⟳ Generate
          </button>

          {/* Suggestion cards */}
          {suggestions.length > 0 && (
            <PanelSection label={`Suggestions  ${suggestions.length}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {suggestions.map(sug => (
                  <SuggestionCard
                    key={sug.id}
                    suggestion={sug}
                    isSelected={selectedSuggestion?.id === sug.id}
                    onSelect={() => applySuggestion(sug)}
                  />
                ))}
              </div>
            </PanelSection>
          )}

          {suggestions.length === 0 && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textAlign: 'center', padding: '16px 0' }}>
              Set filters and press Generate
            </div>
          )}

        </>)}

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
                  onClick={() => labMode === 'build' && selectRoot(p)}>

                  {isRoot && (
                    <circle cx={pt.x} cy={pt.y} r={DOT_R + 5}
                      fill="none" stroke="rgba(196,181,253,0.35)" strokeWidth={1} />
                  )}

                  <circle
                    cx={pt.x} cy={pt.y}
                    r={isActive ? (isRoot ? DOT_R + 2 : DOT_R + 1) : DOT_R - 1}
                    fill={isActive ? (isRoot ? '#c4b5fd' : '#8b5cf6') : 'rgba(255,255,255,0.14)'}
                  />

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
              {labMode === 'suggest' && selectedSuggestion && theoryIdx !== null
                ? (selectedSuggestion.steps[theoryIdx]?.roman ?? presetLabel)
                : presetLabel}
            </text>
          </svg>
        </div>

        {/* ── Progression Timeline ─────────────────────────────────────────── */}
        <div style={{
          flexShrink: 0,
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

            {/* Suggest mode: Use this progression button */}
            {labMode === 'suggest' && selectedSuggestion && (
              <button
                onClick={loadSuggestionToTimeline}
                style={{
                  ...geoBtn(), fontSize: 10, fontWeight: 700,
                  background: 'rgba(34,197,94,0.15)',
                  border: '0.5px solid rgba(34,197,94,0.35)',
                  color: '#86efac',
                }}>
                ✓ Use this
              </button>
            )}

            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
              {activeSteps.length} steps · {activeSteps.reduce((s, st) => s + st.durationBars, 0)} bars
            </span>
          </div>

          {/* Steps row */}
          <div style={{
            height: 90, overflowX: 'auto', display: 'flex', alignItems: 'center',
            gap: 6, padding: '0 14px', flexShrink: 0,
          }}>
            {labMode === 'build' && steps.map((step, i) => {
              const isSel    = step.id === selectedStepId
              const isActive = playingStep === i
              return (
                <div key={step.id} style={{ flexShrink: 0, position: 'relative' }}>
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

            {/* Suggest mode: annotated steps */}
            {labMode === 'suggest' && selectedSuggestion && selectedSuggestion.steps.map((step, i) => {
              const isActive  = playingStep === i
              const isSel     = theoryStepIdx === i
              const funcColor = FUNC_COLORS[step.func]
              return (
                <div key={step.id}
                  onClick={() => handleSuggestStepClick(step, i)}
                  style={{
                    minWidth: 72, padding: '5px 9px', borderRadius: 7, flexShrink: 0,
                    border: `1px solid ${
                      isActive ? funcColor
                      : isSel  ? `${funcColor}88`
                      : 'rgba(255,255,255,0.09)'
                    }`,
                    background: isActive
                      ? `${funcColor}22`
                      : isSel ? `${funcColor}14` : 'rgba(255,255,255,0.04)',
                    cursor: 'pointer', transition: 'border-color 0.1s, background 0.1s',
                    position: 'relative',
                  }}>
                  {/* Roman numeral */}
                  <div style={{
                    fontSize: 8, fontWeight: 700, color: funcColor,
                    fontFamily: 'serif', marginBottom: 1, letterSpacing: '0.04em',
                  }}>
                    {step.roman}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: isActive ? '#e9d5ff' : 'rgba(255,255,255,0.88)', fontFamily: 'monospace' }}>
                    {NOTE_NAMES[step.root]}
                  </div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.40)', marginTop: 1 }}>
                    {step.preset}
                  </div>
                  {/* Tension bar */}
                  <div style={{ marginTop: 4, height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 1,
                      width: `${step.tension * 100}%`,
                      background: step.tension > 0.6 ? '#fca5a5' : step.tension > 0.3 ? '#fde68a' : '#86efac',
                    }} />
                  </div>
                </div>
              )
            })}

            {/* Add step (build mode only) */}
            {labMode === 'build' && (
              <button
                onClick={addToProgression}
                style={{
                  minWidth: 42, height: 64, borderRadius: 7, flexShrink: 0,
                  border: '1px dashed rgba(255,255,255,0.13)', background: 'transparent',
                  color: 'rgba(255,255,255,0.25)', fontSize: 20, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>+</button>
            )}
          </div>

          {/* ── Theory Panel (suggest mode only) ─────────────────────────── */}
          {labMode === 'suggest' && (
            <div style={{
              borderTop: '0.5px solid rgba(255,255,255,0.06)',
              padding: '8px 14px',
              display: 'flex', flexDirection: 'column', gap: 4,
              minHeight: 68, flexShrink: 0,
            }}>
              {theoryStep ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Function badge */}
                    <span style={{
                      fontSize: 8, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                      background: `${FUNC_COLORS[theoryStep.func]}22`,
                      border: `0.5px solid ${FUNC_COLORS[theoryStep.func]}66`,
                      color: FUNC_COLORS[theoryStep.func],
                      letterSpacing: '0.06em',
                    }}>
                      {FUNC_LABELS[theoryStep.func].toUpperCase()}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#e9d5ff', fontFamily: 'monospace' }}>
                      {NOTE_NAMES[theoryStep.root]} {theoryStep.preset}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: FUNC_COLORS[theoryStep.func],
                      fontFamily: 'serif',
                    }}>
                      {theoryStep.roman}
                    </span>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginLeft: 4 }}>
                      {buildChord(theoryStep.root, theoryStep.intervals).map(n => NOTE_NAMES[n]).join('  ')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.50)' }}>
                      {FUNC_DESCS[theoryStep.func]}
                    </span>
                    {theoryNextStep && (
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.30)' }}>
                        → {NOTE_NAMES[theoryNextStep.root]} {theoryNextStep.roman}
                        {sharedWithNext.length > 0 && (
                          <span style={{ color: '#fde68a', marginLeft: 4 }}>
                            {sharedWithNext.length} shared: {sharedWithNext.map(n => NOTE_NAMES[n]).join(', ')}
                          </span>
                        )}
                        {sharedWithNext.length === 0 && (
                          <span style={{ color: '#fca5a5', marginLeft: 4 }}>no shared tones</span>
                        )}
                      </span>
                    )}
                  </div>
                </>
              ) : selectedSuggestion ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#c4b5fd' }}>
                      {selectedSuggestion.name}
                    </span>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.30)', fontFamily: 'monospace' }}>
                      {selectedSuggestion.steps.map(s => s.roman).join(' · ')}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
                    {selectedSuggestion.description}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', paddingTop: 8 }}>
                  Click a chord in the timeline to see theory
                </div>
              )}
            </div>
          )}

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

interface SuggestionCardProps {
  suggestion: ProgressionSuggestion
  isSelected: boolean
  onSelect: () => void
}

function SuggestionCard({ suggestion, isSelected, onSelect }: SuggestionCardProps) {
  const romanPattern = suggestion.steps.map(s => s.roman).join(' · ')
  const chordNames   = suggestion.steps.map(s => NOTE_NAMES[s.root]).join('  ')
  const avgTension   = suggestion.tensionCurve.reduce((a, b) => a + b, 0) / (suggestion.tensionCurve.length || 1)

  return (
    <div
      onClick={onSelect}
      style={{
        padding: '7px 9px', borderRadius: 7, cursor: 'pointer',
        border: isSelected ? '0.5px solid rgba(139,92,246,0.55)' : '0.5px solid rgba(255,255,255,0.08)',
        background: isSelected ? 'rgba(139,92,246,0.14)' : 'rgba(255,255,255,0.03)',
        transition: 'border-color 0.12s, background 0.12s',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: isSelected ? '#c4b5fd' : 'rgba(255,255,255,0.80)' }}>
          {suggestion.name.split(' in ')[0]}
        </span>
        {/* Tension dot */}
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: avgTension > 0.5 ? '#fca5a5' : avgTension > 0.25 ? '#fde68a' : '#86efac',
          display: 'inline-block',
        }} />
      </div>
      <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.38)', fontFamily: 'serif', marginBottom: 2, letterSpacing: '0.04em' }}>
        {romanPattern}
      </div>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.50)', fontFamily: 'monospace', fontWeight: 600 }}>
        {chordNames}
      </div>
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
