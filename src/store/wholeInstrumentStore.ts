import { create } from 'zustand'

export type WholeInstrumentType = 'off' | 'wave-drone' | 'sampler'
export type WholeInstrumentSource = 'count' | 'mass' | 'speed' | 'spread' | 'z' | 'nearest' | 'center-x' | 'center-y'

export interface WholeInstrumentSettings {
  type: WholeInstrumentType
  source: WholeInstrumentSource
  volume: number
  rootNote: number
  width: number
  motion: number
  brightness: number
  samplerSampleId: string | null
  samplerDensity: number
}

interface WholeInstrumentState extends WholeInstrumentSettings {
  panelOpen: boolean
  updateWholeInstrument: (patch: Partial<WholeInstrumentSettings>) => void
  setPanelOpen: (open: boolean) => void
}

export const useWholeInstrumentStore = create<WholeInstrumentState>(set => ({
  panelOpen: false,
  type: 'off',
  source: 'spread',
  volume: 0.22,
  rootNote: 45,
  width: 0.55,
  motion: 0.45,
  brightness: 1200,
  samplerSampleId: null,
  samplerDensity: 0.45,
  updateWholeInstrument: patch => set(patch),
  setPanelOpen: panelOpen => set({ panelOpen }),
}))
