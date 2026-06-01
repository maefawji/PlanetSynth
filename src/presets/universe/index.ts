// ── Universe presets registry ─────────────────────────────────────────────────
//
// UNIVERSE_PRESETS   — ハードコードされた組み込みプリセット（このフォルダのファイル群）
// user preset utils  — localStorage を使ったユーザーカスタムプリセットの読み書き
//
// 新しいプリセットを追加するには:
//   1. src/presets/universe/<name>.ts を作成して UniversePreset をエクスポート
//   2. このファイルの UNIVERSE_PRESETS 配列に追加する

import type { UniversePreset, UserUniversePreset } from '../types'

export { defaultTrio }  from './default-trio'
export { solarSystem }  from './solar-system'

import { defaultTrio }  from './default-trio'
import { solarSystem }  from './solar-system'

/** 組み込みUniverseプリセット一覧（ハードコード・読み取り専用） */
export const UNIVERSE_PRESETS: UniversePreset[] = [
  defaultTrio,
  solarSystem,
]

// ── User preset storage ──────────────────────────────────────────────────────

const STORAGE_KEY = 'planet-synth:universe-user-v1'

export function loadUserUniversePresets(): UserUniversePreset[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as UserUniversePreset[]
  } catch {
    return []
  }
}

export function saveUserUniversePresets(presets: UserUniversePreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
}
