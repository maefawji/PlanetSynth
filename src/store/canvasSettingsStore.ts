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
  monochromeInverted: boolean
  paperCanvasBackground: string
  paperCanvasInk: string
  paperCanvasTone: number
  paperCanvasTrailOpacity: number
  paperCanvasLabelOpacity: number
  paperCanvasKeepBodyColors: boolean
  orbitTrailStrokeWidth: number
  orbitTrailOpacity: number
  orbitTrailDash: number
  canvasBackgroundImageUrl: string
  canvasBackgroundImageOpacity: number
  canvasBackgroundImageFit: 'cover' | 'contain' | 'stretch'
  canvasBackgroundImageColorInMonochrome: boolean
  showCanvasBodyList: boolean
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
  monochromeMode: true,
  monochromeInverted: false,
  paperCanvasBackground: '#ffffff',
  paperCanvasInk: '#050505',
  paperCanvasTone: 0.72,
  paperCanvasTrailOpacity: 0.24,
  paperCanvasLabelOpacity: 0.50,
  paperCanvasKeepBodyColors: false,
  orbitTrailStrokeWidth: 1.2,
  orbitTrailOpacity: 0.30,
  orbitTrailDash: 0,
  canvasBackgroundImageUrl: '',
  canvasBackgroundImageOpacity: 0.35,
  canvasBackgroundImageFit: 'cover',
  canvasBackgroundImageColorInMonochrome: false,
  showCanvasBodyList: true,
  showModeBar: false,
  updateCanvasSettings(settings) {
    set(settings)
  },
}))
