// ── UI Theme ──────────────────────────────────────────────────────────────────
// Shared light / dark colour tokens used across all panel components.
// Panels follow the simpleTheme flag: false (default) = dark, true = light.

import { usePlanetStore } from '../store/planetStore'
import { useCanvasSettingsStore } from '../store/canvasSettingsStore'

export interface UITheme {
  /** Main panel background */
  panelBg:       string
  /** Panel outer border */
  panelBorder:   string
  /** Sticky header / rail background */
  headerBg:      string
  /** Thin divider lines inside panels */
  divider:       string
  /** Primary body text */
  text:          string
  /** Secondary / mid-emphasis text */
  textMid:       string
  /** Dim / hint text */
  textDim:       string
  /** Input / textarea background */
  inputBg:       string
  /** Input / select foreground */
  inputText:     string
  /** Inline button background */
  btnBg:         string
  /** Inline button border */
  btnBorder:     string
  /** Hover background overlay */
  hoverBg:       string
  /** Active / selected item background */
  activeBg:      string
  /** Subtle section background */
  sectionBg:     string
  /** Tag / badge background */
  tagBg:         string
  /** Tag / badge text */
  tagText:       string
}

export const DARK_THEME: UITheme = {
  panelBg:     '#0d0d16',
  panelBorder: 'rgba(255,255,255,0.07)',
  headerBg:    'rgba(255,255,255,0.04)',
  divider:     'rgba(255,255,255,0.06)',
  text:        'rgba(255,255,255,0.88)',
  textMid:     'rgba(255,255,255,0.50)',
  textDim:     'rgba(255,255,255,0.28)',
  inputBg:     'rgba(255,255,255,0.07)',
  inputText:   'rgba(255,255,255,0.82)',
  btnBg:       'rgba(255,255,255,0.07)',
  btnBorder:   'rgba(255,255,255,0.11)',
  hoverBg:     'rgba(255,255,255,0.09)',
  activeBg:    'rgba(139,92,246,0.18)',
  sectionBg:   'rgba(255,255,255,0.03)',
  tagBg:       'rgba(255,255,255,0.08)',
  tagText:     'rgba(255,255,255,0.60)',
}

export const LIGHT_THEME: UITheme = {
  panelBg:     '#fafaf9',
  panelBorder: 'rgba(0,0,0,0.10)',
  headerBg:    'rgba(255,255,255,0.55)',
  divider:     'rgba(0,0,0,0.07)',
  text:        '#1f1f1f',
  textMid:     '#555',
  textDim:     '#999',
  inputBg:     'rgba(0,0,0,0.045)',
  inputText:   '#333',
  btnBg:       'rgba(0,0,0,0.045)',
  btnBorder:   'rgba(0,0,0,0.12)',
  hoverBg:     'rgba(0,0,0,0.045)',
  activeBg:    'rgba(37,99,235,0.10)',
  sectionBg:   'rgba(0,0,0,0.015)',
  tagBg:       'rgba(0,0,0,0.06)',
  tagText:     '#666',
}

export const MONOCHROME_THEME: UITheme = {
  panelBg:     '#fff',
  panelBorder: 'rgba(0,0,0,0.16)',
  headerBg:    '#fff',
  divider:     'rgba(0,0,0,0.12)',
  text:        '#050505',
  textMid:     '#343434',
  textDim:     '#8a8a8a',
  inputBg:     '#f1f1f1',
  inputText:   '#050505',
  btnBg:       '#f4f4f4',
  btnBorder:   'rgba(0,0,0,0.18)',
  hoverBg:     '#ececec',
  activeBg:    '#111',
  sectionBg:   '#fff',
  tagBg:       '#efefef',
  tagText:     '#111',
}

export const MONOCHROME_INVERTED_THEME: UITheme = {
  panelBg:     '#050505',
  panelBorder: 'rgba(255,255,255,0.18)',
  headerBg:    '#050505',
  divider:     'rgba(255,255,255,0.14)',
  text:        '#f7f7f7',
  textMid:     '#d0d0d0',
  textDim:     '#787878',
  inputBg:     '#161616',
  inputText:   '#f7f7f7',
  btnBg:       '#151515',
  btnBorder:   'rgba(255,255,255,0.20)',
  hoverBg:     '#1f1f1f',
  activeBg:    '#f7f7f7',
  sectionBg:   '#070707',
  tagBg:       '#1c1c1c',
  tagText:     '#f7f7f7',
}

/** Returns the appropriate theme based on the current simpleTheme setting. */
export function useTheme(): UITheme {
  const simple = usePlanetStore(s => s.simParams.simpleTheme)
  const monochrome = useCanvasSettingsStore(s => s.monochromeMode)
  const inverted = useCanvasSettingsStore(s => s.monochromeInverted)
  if (monochrome) return inverted ? MONOCHROME_INVERTED_THEME : MONOCHROME_THEME
  return simple ? LIGHT_THEME : DARK_THEME
}
