import { create } from 'zustand'

interface CanvasSettingsState {
  circleRadius: number
  stroke: string
  strokeWidth: number
  fill: string
  pointSize: number
  pathSpan: number
  wayLength: number
  zoom: number
  monochromeMode: boolean
  /** Show the mode-switcher bar in TopBar (planet / chord-lab / osc / dev). Default: hidden. */
  showModeBar: boolean
  updateCanvasSettings: (settings: Partial<Omit<CanvasSettingsState, 'updateCanvasSettings'>>) => void
}

export const useCanvasSettingsStore = create<CanvasSettingsState>(set => ({
  circleRadius: 60,
  stroke: 'rgba(20,20,20,0.75)',
  strokeWidth: 1.5,
  fill: 'none',
  pointSize: 5,
  pathSpan: 200,
  wayLength: 300,
  zoom: 1,
  monochromeMode: false,
  showModeBar: true,
  updateCanvasSettings(settings) {
    set(settings)
  },
}))
