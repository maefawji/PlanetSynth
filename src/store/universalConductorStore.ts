import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const CONDUCTOR_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

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
  'Major',
  'Minor',
  'Sus2',
  'Sus4',
  'Dim',
  'Aug',
  'Maj7',
  'Min7',
  'Dom7',
] as const

export type ConductorScale = typeof CONDUCTOR_SCALES[number]
export type ConductorChordQuality = typeof CONDUCTOR_CHORD_QUALITIES[number]

export interface UniversalConductorValues {
  bpm: number
  key: number
  scale: ConductorScale
  chordRoot: number
  chordQuality: ConductorChordQuality
  chordOctave: number
  density: number
  tension: number
}

interface UniversalConductorState extends UniversalConductorValues {
  update: (patch: Partial<UniversalConductorValues>) => void
  reset: () => void
}

export const DEFAULT_UNIVERSAL_CONDUCTOR: UniversalConductorValues = {
  bpm: 80,
  key: 0,
  scale: 'major',
  chordRoot: 0,
  chordQuality: 'Maj7',
  chordOctave: 3,
  density: 0.5,
  tension: 0.25,
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
  if (patch.scale !== undefined && !CONDUCTOR_SCALES.includes(patch.scale)) delete next.scale
  if (patch.chordQuality !== undefined && !CONDUCTOR_CHORD_QUALITIES.includes(patch.chordQuality)) delete next.chordQuality
  return next
}

export function getUniversalConductorValues(): UniversalConductorValues {
  const state = useUniversalConductorStore.getState()
  return {
    bpm: state.bpm,
    key: state.key,
    scale: state.scale,
    chordRoot: state.chordRoot,
    chordQuality: state.chordQuality,
    chordOctave: state.chordOctave,
    density: state.density,
    tension: state.tension,
  }
}

export const useUniversalConductorStore = create<UniversalConductorState>()(
  persist(
    set => ({
      ...DEFAULT_UNIVERSAL_CONDUCTOR,
      update(patch) {
        set(normalizeUniversalConductor(patch))
      },
      reset() {
        set(DEFAULT_UNIVERSAL_CONDUCTOR)
      },
    }),
    {
      name: 'planetSynth.universalConductor.v1',
      partialize: state => ({
        bpm: state.bpm,
        key: state.key,
        scale: state.scale,
        chordRoot: state.chordRoot,
        chordQuality: state.chordQuality,
        chordOctave: state.chordOctave,
        density: state.density,
        tension: state.tension,
      }),
    },
  ),
)
