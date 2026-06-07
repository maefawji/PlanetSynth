import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const CONDUCTOR_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export const CONDUCTOR_GRID_RESOLUTIONS = ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64'] as const
export type GridResolution = typeof CONDUCTOR_GRID_RESOLUTIONS[number]

export const CONDUCTOR_SCALES = [
  'major',
  'minor',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'locrian',
  'pentatonic-major',
  'pentatonic-minor',
  'chromatic',
] as const

export const CONDUCTOR_CHORD_QUALITIES = [
  // Triads
  'Major',
  'Minor',
  'Sus2',
  'Sus4',
  'Dim',
  'Aug',
  // 7ths
  'Maj7',
  'Min7',
  'Dom7',
  '7sus4',
  // 9ths / add9 — Avril 14th palette
  'Add9',
  'Min-add9',
  'Maj9',
  'Min9',
  'Dom9',
  // Extended
  'Maj7add9',
  'Min11',
  'Maj7#11',
] as const

export const CHORD_QUALITY_INTERVALS: Record<ConductorChordQuality, number[]> = {
  'Major':      [0, 4, 7],
  'Minor':      [0, 3, 7],
  'Sus2':       [0, 2, 7],
  'Sus4':       [0, 5, 7],
  'Dim':        [0, 3, 6],
  'Aug':        [0, 4, 8],
  'Maj7':       [0, 4, 7, 11],
  'Min7':       [0, 3, 7, 10],
  'Dom7':       [0, 4, 7, 10],
  '7sus4':      [0, 5, 7, 10],
  'Add9':       [0, 4, 7, 2],   // major + 9th (2 mod 12)
  'Min-add9':   [0, 3, 7, 2],
  'Maj9':       [0, 4, 7, 11, 2],
  'Min9':       [0, 3, 7, 10, 2],
  'Dom9':       [0, 4, 7, 10, 2],
  'Maj7add9':   [0, 4, 7, 11, 2],
  'Min11':      [0, 3, 7, 10, 2, 5],
  'Maj7#11':    [0, 4, 7, 11, 2, 6],
}

export function getChordNotes(root: number, quality: ConductorChordQuality): number[] {
  const intervals = CHORD_QUALITY_INTERVALS[quality] ?? [0, 4, 7]
  return intervals.map(i => (root + i) % 12)
}

export function getChordNoteNames(root: number, quality: ConductorChordQuality): string {
  return getChordNotes(root, quality).map(n => CONDUCTOR_NOTE_NAMES[n]).join(' ')
}

const QUALITY_SHORT: Record<ConductorChordQuality, string> = {
  'Major': '', 'Minor': 'm', 'Sus2': 'sus2', 'Sus4': 'sus4',
  'Dim': '°', 'Aug': '+', 'Maj7': 'maj7', 'Min7': 'm7', 'Dom7': '7',
  '7sus4': '7sus4', 'Add9': 'add9', 'Min-add9': 'm(add9)',
  'Maj9': 'maj9', 'Min9': 'm9', 'Dom9': '9', 'Maj7add9': 'maj7(add9)',
  'Min11': 'm11', 'Maj7#11': 'maj7#11',
}

const SCALE_INTERVALS: Record<ConductorScale, number[]> = {
  'major':           [0, 2, 4, 5, 7, 9, 11],
  'minor':           [0, 2, 3, 5, 7, 8, 10],
  'dorian':          [0, 2, 3, 5, 7, 9, 10],
  'phrygian':        [0, 1, 3, 5, 7, 8, 10],
  'lydian':          [0, 2, 4, 6, 7, 9, 11],
  'mixolydian':      [0, 2, 4, 5, 7, 9, 10],
  'locrian':         [0, 1, 3, 5, 6, 8, 10],
  'pentatonic-major':[0, 2, 4, 7, 9],
  'pentatonic-minor':[0, 3, 5, 7, 10],
  'chromatic':       [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

export function getScaleDegree(root: number, quality: ConductorChordQuality, key: number, scale: ConductorScale): string {
  const intervals = SCALE_INTERVALS[scale]
  const semitones = ((root - key) + 12) % 12
  const degreeIndex = intervals.indexOf(semitones)
  if (degreeIndex === -1) {
    // chromatic — find nearest and prefix with b/#
    const flatSemitones = ((root - key + 1) + 12) % 12
    const nearestFlat = intervals.indexOf(flatSemitones)
    if (nearestFlat !== -1) {
      const roman = ROMAN[nearestFlat] ?? '?'
      const isMinor = ['Minor','Min7','Min-add9','Min9','Min11','Dim'].includes(quality)
      return `b${isMinor ? roman.toLowerCase() : roman}`
    }
    return '?'
  }
  const roman = ROMAN[degreeIndex] ?? '?'
  const isMinor = ['Minor','Min7','Min-add9','Min9','Min11','Dim'].includes(quality)
  return isMinor ? roman.toLowerCase() : roman
}

export function formatChordName(root: number, quality: ConductorChordQuality, bassRoot?: number | null): string {
  const rootName = CONDUCTOR_NOTE_NAMES[root]
  const suffix = QUALITY_SHORT[quality] ?? quality
  const base = `${rootName}${suffix}`
  if (bassRoot != null && bassRoot !== root) {
    return `${base}/${CONDUCTOR_NOTE_NAMES[bassRoot]}`
  }
  return base
}

export const HARMONIC_MODES = [
  'custom',
  'minor-add9',   // Avril 14th style: i(add9), i/b7, VImaj9, iv9
  'major-add9',   // Bright add9 voicings
  'dorian-sus',   // Dorian with sus flavours
  'ambient',      // Long, open, drone-based
] as const
export type HarmonicMode = typeof HARMONIC_MODES[number]

export type ConductorScale = typeof CONDUCTOR_SCALES[number]
export type ConductorChordQuality = typeof CONDUCTOR_CHORD_QUALITIES[number]

export interface ChordSlot {
  root: number
  quality: ConductorChordQuality
  octave: number
  bassRoot: number | null   // null = no slash bass; number = slash bass root (0-11)
}

export interface HarmonicPreset {
  name: string
  key: number
  scale: ConductorScale
  harmonicMode: HarmonicMode
  chords: ChordSlot[]
  tension: number
  density: number
  quantize: number
  sustain: number
  reverbSend: number
}

export const HARMONIC_PRESETS: HarmonicPreset[] = [
  {
    name: 'Minor Add9 Orbit',
    key: 5, // F
    scale: 'minor',
    harmonicMode: 'minor-add9',
    tension: 0.55,
    density: 0.38,
    quantize: 0.4,
    sustain: 0.75,
    reverbSend: 0.65,
    chords: [
      { root: 5,  quality: 'Min-add9', octave: 3, bassRoot: null },   // Fm(add9)
      { root: 5,  quality: 'Min-add9', octave: 3, bassRoot: 3  },     // Fm/Eb
      { root: 1,  quality: 'Maj9',     octave: 3, bassRoot: null },   // Dbmaj9
      { root: 10, quality: 'Min9',     octave: 3, bassRoot: null },   // Bbm9
    ],
  },
  {
    name: 'Frozen Cadence',
    key: 5, // F
    scale: 'minor',
    harmonicMode: 'ambient',
    tension: 0.35,
    density: 0.22,
    quantize: 0.25,
    sustain: 0.92,
    reverbSend: 0.78,
    chords: [
      { root: 5,  quality: 'Min-add9', octave: 3, bassRoot: null },   // Fm(add9)
      { root: 1,  quality: 'Maj9',     octave: 3, bassRoot: null },   // Dbmaj9
      { root: 8,  quality: 'Add9',     octave: 3, bassRoot: null },   // Ab(add9)
      { root: 0,  quality: '7sus4',    octave: 3, bassRoot: null },   // Cm7sus4
    ],
  },
  {
    name: 'Eccentric Piano',
    key: 9, // A
    scale: 'minor',
    harmonicMode: 'minor-add9',
    tension: 0.7,
    density: 0.5,
    quantize: 0.45,
    sustain: 0.6,
    reverbSend: 0.5,
    chords: [
      { root: 9,  quality: 'Min-add9', octave: 3, bassRoot: null },   // Am(add9)
      { root: 9,  quality: 'Min-add9', octave: 3, bassRoot: 7  },     // Am/G
      { root: 5,  quality: 'Maj9',     octave: 3, bassRoot: null },   // Fmaj9
      { root: 4,  quality: 'Min9',     octave: 3, bassRoot: null },   // Em9
    ],
  },
]

export interface UniversalConductorValues {
  bpm: number
  key: number
  scale: ConductorScale
  harmonicMode: HarmonicMode
  timeSignatureNumerator: number
  timeSignatureDenominator: number
  tuning: number
  gridResolution: GridResolution
  quantize: number
  maxPolyphony: number
  sustain: number
  reverbSend: number
  chordRoot: number
  chordQuality: ConductorChordQuality
  chordOctave: number
  density: number
  tension: number
  chordProgression: (ChordSlot | null)[]
  chordProgressionLength: number
  chordIndex: number
  autoAdvance: boolean
  autoAdvanceBars: number
  registerBassMin: number
  registerBassMax: number
  registerBodyMin: number
  registerBodyMax: number
  registerTensionMin: number
  registerTensionMax: number
}

const DIATONIC_QUALITIES: Record<ConductorScale, ConductorChordQuality[]> = {
  'major':           ['Add9',     'Min-add9', 'Min-add9', 'Add9',     'Add9',     'Min-add9', 'Dim'],
  'minor':           ['Min-add9', 'Dim',      'Add9',     'Min-add9', 'Min-add9', 'Add9',     'Add9'],
  'dorian':          ['Min-add9', 'Min-add9', 'Add9',     'Add9',     'Min-add9', 'Dim',      'Add9'],
  'phrygian':        ['Min-add9', 'Add9',     'Add9',     'Min-add9', 'Dim',      'Add9',     'Min-add9'],
  'lydian':          ['Add9',     'Add9',     'Min-add9', 'Dim',      'Add9',     'Min-add9', 'Min-add9'],
  'mixolydian':      ['Add9',     'Min-add9', 'Dim',      'Add9',     'Min-add9', 'Min-add9', 'Add9'],
  'locrian':         ['Dim',      'Add9',     'Min-add9', 'Min-add9', 'Add9',     'Add9',     'Min-add9'],
  'pentatonic-major':['Add9',     'Min-add9', 'Add9',     'Min-add9', 'Min-add9', 'Add9',     'Add9'],
  'pentatonic-minor':['Min-add9', 'Add9',     'Min-add9', 'Min-add9', 'Add9',     'Add9',     'Min-add9'],
  'chromatic':       ['Add9',     'Min-add9', 'Add9',     'Min-add9', 'Add9',     'Min-add9', 'Add9'],
}

interface UniversalConductorState extends UniversalConductorValues {
  update: (patch: Partial<UniversalConductorValues>) => void
  updateChordSlot: (index: number, slot: ChordSlot | null) => void
  applyPreset: (preset: HarmonicPreset) => void
  advanceChordIndex: () => void
  fillDiatonic: () => void
  reset: () => void
}

export const DEFAULT_UNIVERSAL_CONDUCTOR: UniversalConductorValues = {
  bpm: 80,
  key: 0,
  scale: 'major',
  harmonicMode: 'custom',
  timeSignatureNumerator: 4,
  timeSignatureDenominator: 4,
  tuning: 440,
  gridResolution: '1/16',
  quantize: 0.4,
  maxPolyphony: 5,
  sustain: 0.7,
  reverbSend: 0.55,
  chordRoot: 0,
  chordQuality: 'Maj7',
  chordOctave: 3,
  density: 0.5,
  tension: 0.25,
  chordProgression: Array(8).fill(null),
  chordProgressionLength: 4,
  chordIndex: 0,
  autoAdvance: false,
  autoAdvanceBars: 1,
  registerBassMin: 36,
  registerBassMax: 52,
  registerBodyMin: 52,
  registerBodyMax: 72,
  registerTensionMin: 72,
  registerTensionMax: 88,
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function normalizeUniversalConductor(
  patch: Partial<UniversalConductorValues>,
): Partial<UniversalConductorValues> {
  const next = { ...patch }
  if (patch.bpm !== undefined) next.bpm = clamp(Number(patch.bpm) || DEFAULT_UNIVERSAL_CONDUCTOR.bpm, 20, 300)
  if (patch.key !== undefined) next.key = clamp(Math.round(Number(patch.key) || 0), 0, 11)
  if (patch.chordRoot !== undefined) next.chordRoot = clamp(Math.round(Number(patch.chordRoot) || 0), 0, 11)
  if (patch.chordOctave !== undefined) next.chordOctave = clamp(Math.round(Number(patch.chordOctave) || 0), 0, 8)
  if (patch.density !== undefined) next.density = clamp(Number(patch.density) || 0, 0, 1)
  if (patch.tension !== undefined) next.tension = clamp(Number(patch.tension) || 0, 0, 1)
  if (patch.quantize !== undefined) next.quantize = clamp(Number(patch.quantize) || 0, 0, 1)
  if (patch.sustain !== undefined) next.sustain = clamp(Number(patch.sustain) || 0, 0, 1)
  if (patch.reverbSend !== undefined) next.reverbSend = clamp(Number(patch.reverbSend) || 0, 0, 1)
  if (patch.timeSignatureNumerator !== undefined) next.timeSignatureNumerator = clamp(Math.round(Number(patch.timeSignatureNumerator) || 4), 1, 16)
  if (patch.timeSignatureDenominator !== undefined) next.timeSignatureDenominator = clamp(Math.round(Number(patch.timeSignatureDenominator) || 4), 1, 32)
  if (patch.tuning !== undefined) next.tuning = clamp(Number(patch.tuning) || 440, 400, 480)
  if (patch.maxPolyphony !== undefined) next.maxPolyphony = clamp(Math.round(Number(patch.maxPolyphony) || 5), 1, 16)
  if (patch.chordProgressionLength !== undefined) next.chordProgressionLength = clamp(Math.round(Number(patch.chordProgressionLength) || 4), 1, 8)
  if (patch.chordIndex !== undefined) next.chordIndex = clamp(Math.round(Number(patch.chordIndex) || 0), 0, 7)
  if (patch.autoAdvanceBars !== undefined) next.autoAdvanceBars = clamp(Math.round(Number(patch.autoAdvanceBars) || 1), 1, 16)
  if (patch.registerBassMin !== undefined) next.registerBassMin = clamp(Math.round(Number(patch.registerBassMin)), 0, 127)
  if (patch.registerBassMax !== undefined) next.registerBassMax = clamp(Math.round(Number(patch.registerBassMax)), 0, 127)
  if (patch.registerBodyMin !== undefined) next.registerBodyMin = clamp(Math.round(Number(patch.registerBodyMin)), 0, 127)
  if (patch.registerBodyMax !== undefined) next.registerBodyMax = clamp(Math.round(Number(patch.registerBodyMax)), 0, 127)
  if (patch.registerTensionMin !== undefined) next.registerTensionMin = clamp(Math.round(Number(patch.registerTensionMin)), 0, 127)
  if (patch.registerTensionMax !== undefined) next.registerTensionMax = clamp(Math.round(Number(patch.registerTensionMax)), 0, 127)
  if (patch.scale !== undefined && !CONDUCTOR_SCALES.includes(patch.scale)) delete next.scale
  if (patch.chordQuality !== undefined && !CONDUCTOR_CHORD_QUALITIES.includes(patch.chordQuality)) delete next.chordQuality
  if (patch.gridResolution !== undefined && !CONDUCTOR_GRID_RESOLUTIONS.includes(patch.gridResolution)) delete next.gridResolution
  if (patch.harmonicMode !== undefined && !HARMONIC_MODES.includes(patch.harmonicMode)) delete next.harmonicMode
  return next
}

export function getUniversalConductorValues(): UniversalConductorValues {
  const s = useUniversalConductorStore.getState()
  return {
    bpm: s.bpm,
    key: s.key,
    scale: s.scale,
    harmonicMode: s.harmonicMode,
    timeSignatureNumerator: s.timeSignatureNumerator,
    timeSignatureDenominator: s.timeSignatureDenominator,
    tuning: s.tuning,
    gridResolution: s.gridResolution,
    quantize: s.quantize,
    maxPolyphony: s.maxPolyphony,
    sustain: s.sustain,
    reverbSend: s.reverbSend,
    chordRoot: s.chordRoot,
    chordQuality: s.chordQuality,
    chordOctave: s.chordOctave,
    density: s.density,
    tension: s.tension,
    chordProgression: s.chordProgression,
    chordProgressionLength: s.chordProgressionLength,
    chordIndex: s.chordIndex,
    autoAdvance: s.autoAdvance,
    autoAdvanceBars: s.autoAdvanceBars,
    registerBassMin: s.registerBassMin,
    registerBassMax: s.registerBassMax,
    registerBodyMin: s.registerBodyMin,
    registerBodyMax: s.registerBodyMax,
    registerTensionMin: s.registerTensionMin,
    registerTensionMax: s.registerTensionMax,
  }
}

export const useUniversalConductorStore = create<UniversalConductorState>()(
  persist(
    set => ({
      ...DEFAULT_UNIVERSAL_CONDUCTOR,
      update(patch) {
        set(normalizeUniversalConductor(patch))
      },
      updateChordSlot(index, slot) {
        set(state => {
          const next = [...state.chordProgression]
          next[index] = slot
          const isActive = index === state.chordIndex
          return {
            chordProgression: next,
            ...(isActive && slot ? { chordRoot: slot.root, chordQuality: slot.quality, chordOctave: slot.octave } : {}),
          }
        })
      },
      advanceChordIndex() {
        set(state => {
          const nextIndex = (state.chordIndex + 1) % state.chordProgressionLength
          const nextSlot = state.chordProgression[nextIndex]
          return {
            chordIndex: nextIndex,
            ...(nextSlot ? {
              chordRoot: nextSlot.root,
              chordQuality: nextSlot.quality,
              chordOctave: nextSlot.octave,
            } : {}),
          }
        })
      },
      applyPreset(preset) {
        const slots: (ChordSlot | null)[] = Array(8).fill(null)
        preset.chords.forEach((c, i) => { slots[i] = c })
        const first = preset.chords[0]
        set({
          key: preset.key,
          scale: preset.scale,
          harmonicMode: preset.harmonicMode,
          tension: preset.tension,
          density: preset.density,
          quantize: preset.quantize,
          sustain: preset.sustain,
          reverbSend: preset.reverbSend,
          chordProgression: slots,
          chordProgressionLength: preset.chords.length,
          chordIndex: 0,
          ...(first ? {
            chordRoot: first.root,
            chordQuality: first.quality,
            chordOctave: first.octave,
          } : {}),
        })
      },
      fillDiatonic() {
        const state = useUniversalConductorStore.getState()
        const intervals = SCALE_INTERVALS[state.scale]
        const qualities = DIATONIC_QUALITIES[state.scale]
        const slots: (ChordSlot | null)[] = Array(8).fill(null)
        const count = Math.min(state.chordProgressionLength, intervals.length)
        for (let i = 0; i < count; i++) {
          const root = (state.key + intervals[i]) % 12
          slots[i] = { root, quality: qualities[i] ?? 'Add9', octave: 3, bassRoot: null }
        }
        const first = slots[0]
        set({
          chordProgression: slots,
          chordIndex: 0,
          ...(first ? { chordRoot: first.root, chordQuality: first.quality, chordOctave: first.octave } : {}),
        })
      },
      reset() {
        set(DEFAULT_UNIVERSAL_CONDUCTOR)
      },
    }),
    {
      name: 'planetSynth.universalConductor.v2',
      partialize: state => ({
        bpm: state.bpm,
        key: state.key,
        scale: state.scale,
        harmonicMode: state.harmonicMode,
        timeSignatureNumerator: state.timeSignatureNumerator,
        timeSignatureDenominator: state.timeSignatureDenominator,
        tuning: state.tuning,
        gridResolution: state.gridResolution,
        quantize: state.quantize,
        maxPolyphony: state.maxPolyphony,
        sustain: state.sustain,
        reverbSend: state.reverbSend,
        chordRoot: state.chordRoot,
        chordQuality: state.chordQuality,
        chordOctave: state.chordOctave,
        density: state.density,
        tension: state.tension,
        chordProgression: state.chordProgression,
        chordProgressionLength: state.chordProgressionLength,
        chordIndex: state.chordIndex,
        autoAdvance: state.autoAdvance,
        autoAdvanceBars: state.autoAdvanceBars,
        registerBassMin: state.registerBassMin,
        registerBassMax: state.registerBassMax,
        registerBodyMin: state.registerBodyMin,
        registerBodyMax: state.registerBodyMax,
        registerTensionMin: state.registerTensionMin,
        registerTensionMax: state.registerTensionMax,
      }),
    },
  ),
)
