import { create } from 'zustand'

export type SampleTriggerRule = 'shape-overlap' | 'point-enters-curve' | 'rendezvous' | 'manual'
export type SampleTriggerTarget = 'touched-curve' | 'source-curve'
export type SampleStartMode = 'fixed' | 'random'
export type SamplePitchMode = 'source-size' | 'center-distance'
export type SampleVolumeMode = 'target-size' | 'point-distance' | 'standpoint-distance'

interface SamplerModeState {
  activeRule: SampleTriggerRule
  triggerTarget: SampleTriggerTarget
  startMode: SampleStartMode
  startSeconds: number
  randomStartMinSeconds: number
  randomStartMaxSeconds: number
  rendezvousDistance: number
  pitchMode: SamplePitchMode
  volumeMode: SampleVolumeMode
  // Standpoint: a fixed reference point on the canvas.
  // When volumeMode === 'standpoint-distance', moving points far from it play quieter.
  standpoint: { x: number; y: number } | null
  standpointRadius: number    // distance at which volume reaches standpointVolumeMin
  standpointVolumeMin: number // volume at the radius edge (0–1); outside radius = silent
  showStandpointRadius: boolean
  showPointLabels: boolean
  showRendezvousDistance: boolean
  retrigger: boolean
  defaultVoice: 'click' | 'tone' | 'noise'
  ruleSensitivity: number
  updateSamplerMode: (patch: Partial<Omit<SamplerModeState, 'updateSamplerMode'>>) => void
}

export const useSamplerModeStore = create<SamplerModeState>(set => ({
  activeRule: 'rendezvous',
  triggerTarget: 'touched-curve',
  startMode: 'fixed',
  startSeconds: 0,
  randomStartMinSeconds: 0,
  randomStartMaxSeconds: 5,
  rendezvousDistance: 50,
  pitchMode: 'source-size',
  volumeMode: 'target-size',
  standpoint: null,
  standpointRadius: 200,
  standpointVolumeMin: 0,
  showStandpointRadius: true,
  showPointLabels: true,
  showRendezvousDistance: false,
  retrigger: true,
  defaultVoice: 'click',
  ruleSensitivity: 1,
  updateSamplerMode(patch) {
    set(patch)
  },
}))
