// ── Preset type definitions ────────────────────────────────────────────────────
//
// UniversePreset  — bodies[] + simParams のセット。Universe Presetsパネルで表示。
// PlanetPreset    — 個体のbody情報 + rackのセット。Planet Presetsパネルで表示。
//
// ハードコードプリセット: src/presets/universe/ / src/presets/planet/ に個別ファイルで保存
// ユーザープリセット:     localStorage に保存 (キーは各 index.ts で管理)

import type { PlanetBody, PlanetSimParams } from '../store/planetStore'

// ── Universe Preset ──────────────────────────────────────────────────────────

export interface UniversePreset {
  id:           string
  name:         string
  description?: string
  icon?:        string
  /** Initial bodies to place in the simulation. */
  bodies:       PlanetBody[]
  /** Partial simParams merged on top of the current state. */
  simParams:    Partial<PlanetSimParams>
}

/** User-saved universe preset (localStorage). Extends UniversePreset with metadata. */
export interface UserUniversePreset extends UniversePreset {
  createdAt: number  // Date.now()
}

// ── Planet Preset ────────────────────────────────────────────────────────────

export interface PlanetPreset {
  id:           string
  name:         string
  description?: string
  icon?:        string
  bodyInfo: {
    name:        string
    type:        'sun' | 'planet'
    mass:        number
    color:       string
    muted:       boolean
    volume:      number
    midiChannel: number
    midiNote:    number
    midiVelocity: number
  }
  rack: {
    triggers:   string[]
    instrument: string | null
    effects:    string[]
  }
  /** Per-slot param overrides (preserves knob positions, ADSR values etc.) */
  rackParamOverrides?: Record<string, Record<string, unknown>>
}

/** User-saved planet preset (localStorage). Extends PlanetPreset with metadata. */
export interface UserPlanetPreset extends PlanetPreset {
  createdAt: number  // Date.now()
}
