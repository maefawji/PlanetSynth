// ── Planet presets registry ───────────────────────────────────────────────────
//
// PLANET_PRESETS    — ハードコードされた組み込みプリセット（このフォルダのファイル群）
// user preset utils — localStorage を使ったユーザーカスタムプリセットの読み書き
//
// 新しいプリセットを追加するには:
//   1. src/presets/planet/<name>.ts を作成して PlanetPreset をエクスポート
//   2. この配列に追加する

import type { PlanetPreset, UserPlanetPreset } from '../types'

/** 組み込みPlanetプリセット一覧（ハードコード・読み取り専用） */
export const PLANET_PRESETS: PlanetPreset[] = [
  // ここに個別プリセットファイルを追加していく
  // 例: import { arpOrbitSynth } from './arp-orbit-synth'
  //     → arpOrbitSynth を配列に追加
]

// ── User preset storage ──────────────────────────────────────────────────────

const STORAGE_KEY     = 'planet-synth:planet-user-v1'
const LEGACY_KEY      = 'planet-body-presets-v1'   // 旧キーからの移行用

export function loadUserPlanetPresets(): UserPlanetPreset[] {
  try {
    // 新キーにデータがあればそれを使う
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as UserPlanetPreset[]

    // 旧キーから移行（一度だけ）
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const migrated = JSON.parse(legacy) as UserPlanetPreset[]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      localStorage.removeItem(LEGACY_KEY)
      return migrated
    }
    return []
  } catch {
    return []
  }
}

export function saveUserPlanetPresets(presets: UserPlanetPreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
}
