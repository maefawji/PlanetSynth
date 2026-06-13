import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { PlanetSimParams } from './planetStore'
import { useControlSetStore } from './controlSetStore'

/**
 * A "planet preset" is a reusable body sound configuration: an instrument
 * control-set plus the per-instrument parameter overrides captured from a body.
 * Presets are cycled by the body control orbit's "preset" node and can be
 * registered ahead of time by the user (capture the current body's config).
 */
export interface PlanetPreset {
  id: string
  name: string
  instrument: string                 // instrument control-set id
  params: Partial<PlanetSimParams>   // instrument-slot override params
}

const STORAGE_KEY = 'planet-presets-v1'

/** Built-in presets so the preset node does something before the user saves any. */
function builtinPresets(): PlanetPreset[] {
  return [
    { id: 'builtin-sampler',      name: 'Sampler',      instrument: 'instrument-sampler',       params: {} },
    { id: 'builtin-wave-lab',     name: 'Wave Lab',     instrument: 'instrument-wave-lab',      params: {} },
    { id: 'builtin-long-sampler', name: 'Long Sampler', instrument: 'instrument-long-sampler',  params: {} },
    { id: 'builtin-oneshot',      name: 'One-Shot',     instrument: 'instrument-oneshot',       params: {} },
  ]
}

function loadPresets(): PlanetPreset[] {
  if (typeof localStorage === 'undefined') return builtinPresets()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return builtinPresets()
    const parsed = JSON.parse(raw) as PlanetPreset[]
    if (!Array.isArray(parsed) || parsed.length === 0) return builtinPresets()
    return parsed
  } catch {
    return builtinPresets()
  }
}

function persist(presets: PlanetPreset[]) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(presets)) } catch { /* ignore quota */ }
}

interface PlanetPresetState {
  presets: PlanetPreset[]
  /** Capture the selected body's current instrument + override params as a new preset. */
  capturePreset: (bodyId: string, name?: string) => string | null
  removePreset: (id: string) => void
  /** Apply a preset to a body: set its instrument and override params. */
  applyPreset: (bodyId: string, presetId: string) => void
  /** Apply the preset following the body's current config (cycles the list). Returns the applied preset. */
  cycleNext: (bodyId: string) => PlanetPreset | null
}

export const usePlanetPresetStore = create<PlanetPresetState>((set, get) => ({
  presets: loadPresets(),

  capturePreset(bodyId, name) {
    const cs = useControlSetStore.getState()
    const rack = cs.getBodyEffectiveRack(bodyId)
    const instrument = rack.instrument
    if (!instrument) return null
    // Capture the instrument-slot override params (body-specific first, then global).
    const overrides = cs.rackParamOverrides
    const params = { ...(overrides[`b:${bodyId}:instrument`] ?? overrides['g:instrument'] ?? {}) }
    const preset: PlanetPreset = {
      id: nanoid(8),
      name: name?.trim() || `Preset ${get().presets.length + 1}`,
      instrument,
      params,
    }
    const next = [...get().presets, preset]
    persist(next)
    set({ presets: next })
    return preset.id
  },

  removePreset(id) {
    const next = get().presets.filter(p => p.id !== id)
    persist(next)
    set({ presets: next })
  },

  applyPreset(bodyId, presetId) {
    const preset = get().presets.find(p => p.id === presetId)
    if (!preset) return
    const cs = useControlSetStore.getState()
    // Set the body's instrument (clears its instrument override), then apply params.
    cs.setBodySlot(bodyId, 'instrument', preset.instrument)
    if (Object.keys(preset.params).length > 0) {
      cs.setSlotOverride(`b:${bodyId}:instrument`, preset.params)
    }
  },

  cycleNext(bodyId) {
    const { presets } = get()
    if (presets.length === 0) return null
    const cs = useControlSetStore.getState()
    const currentInstrument = cs.getBodyEffectiveRack(bodyId).instrument
    // Find the preset matching the body's current instrument; advance to the next one.
    const curIdx = presets.findIndex(p => p.instrument === currentInstrument)
    const nextIdx = (curIdx + 1) % presets.length
    const preset = presets[nextIdx]
    get().applyPreset(bodyId, preset.id)
    return preset
  },
}))
