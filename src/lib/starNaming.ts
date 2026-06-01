// ── starNaming.ts ──────────────────────────────────────────────────────────────
// Planet Synth 独自の恒星命名システム。
// 歴史的な恒星命名（アラビア語・ラテン語・ギリシア語由来の固有名、バイエル符号）を
// 参考にした架空名をランダム生成する。
//
// 生成する識別子:
//   properName  — 画面表示用の固有名 (例: Zohrakel, Mirthalor)
//   designation — バイエル符号風補助名 (例: Beta Umbrae, Gamma Asterionis)
//   id          — アプリ内カタログID (例: PLSYN-0187, ORBX-4421)
//
// 将来の拡張: 質量・軌道・色などから命名を導く関数を追加する予定。
// 現時点では完全ランダム生成。

// ── Vocabularies ─────────────────────────────────────────────────────────────
// 後から語彙を追加しやすいよう export で公開している

export const PROPER_PREFIXES: string[] = [
  'Al', 'Mir', 'Zoh', 'Sa', 'Tar', 'Vel', 'Cor', 'An', 'El', 'Nur',
  'Ras', 'Bel', 'Vor', 'Ari', 'Kal', 'Lum',
]

export const PROPER_MIDDLES: string[] = [
  'na', 'ra', 'hai', 'mak', 'dor', 'bel', 'shi', 'lum', 'rak', 'ven',
  'tor', 'mir', 'thal', 'zar', 'kor', 'nis',
]

export const PROPER_SUFFIXES: string[] = [
  '', 'a', 'is', 'on', 'ar', 'el', 'um', 'eth', 'ia', 'or', 'eus',
]

export const GREEK_LETTERS: string[] = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta',
  'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu',
]

/**
 * 星座名とそのラテン語属格形 (Bayer designation に使われる形)
 * キー: 星座名 (nominative)
 * 値:  属格形 (genitive) — designation で使用
 */
export const CONSTELLATIONS: Record<string, string> = {
  Noctua:   'Noctuae',     // 1st decl.   (owl)
  Vulpes:   'Vulpis',      // 3rd decl.   (fox)
  Ferrum:   'Ferri',       // 2nd neuter  (iron)
  Lacuna:   'Lacunae',     // 1st decl.   (gap)
  Umbra:    'Umbrae',      // 1st decl.   (shadow)
  Asterion: 'Asterionis',  // Greek 3rd   (starry one)
  Thalassa: 'Thalassae',   // Greek 1st   (sea)
  Corvus:   'Corvi',       // 2nd masc.   (crow)
  Nebula:   'Nebulae',     // 1st decl.   (cloud)
  Draco:    'Draconis',    // Greek 3rd   (dragon)
  Aquila:   'Aquilae',     // 1st decl.   (eagle)
  Orbis:    'Orbis',       // 3rd decl.   (circle)
}

export const CATALOG_PREFIXES: string[] = [
  'PLSYN', 'ORBX', 'GRVX', 'PNX', 'SYNX',
]

// ── Internal helpers ──────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function padNum(n: number, digits: number): string {
  return String(n).padStart(digits, '0')
}

function _properName(): string {
  return pick(PROPER_PREFIXES) + pick(PROPER_MIDDLES) + pick(PROPER_SUFFIXES)
}

function _designation(): string {
  const letter    = pick(GREEK_LETTERS)
  const constKeys = Object.keys(CONSTELLATIONS)
  const genitive  = CONSTELLATIONS[pick(constKeys)]
  return `${letter} ${genitive}`
}

function _catalogId(): string {
  const prefix = pick(CATALOG_PREFIXES)
  const num    = padNum(Math.floor(Math.random() * 9000) + 1000, 4)
  return `${prefix}-${num}`
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface StarIdentity {
  id:          string   // "PLSYN-0187"
  properName:  string   // "Zohrakel"   ← UI 表示用
  designation: string   // "Beta Umbrae" ← 将来の詳細表示用
}

/**
 * 新しい星のアイデンティティを生成する。
 *
 * @param existingIds          既存カタログID の Set（重複排除）
 * @param existingProperNames  既存固有名 の Set（できるだけ重複回避）
 * @param existingDesignations 既存 designation の Set（任意、できるだけ重複回避）
 * @param maxAttempts          重複回避の最大試行回数（デフォルト 30）
 */
export function generateStarIdentity(
  existingIds:          Set<string> = new Set(),
  existingProperNames:  Set<string> = new Set(),
  existingDesignations: Set<string> = new Set(),
  maxAttempts = 30,
): StarIdentity {
  // properName: 重複を避けてリトライ
  let properName = _properName()
  for (let i = 0; i < maxAttempts && existingProperNames.has(properName); i++) {
    properName = _properName()
  }

  // designation: できるだけ重複を避けてリトライ
  let designation = _designation()
  for (let i = 0; i < maxAttempts && existingDesignations.has(designation); i++) {
    designation = _designation()
  }

  // id: 必ずユニークになるまでリトライ（タイムスタンプ補助付き）
  let id = _catalogId()
  let attempt = 0
  while (existingIds.has(id)) {
    id = _catalogId()
    attempt++
    // 万が一ループが長引く場合はタイムスタンプを末尾に混ぜる
    if (attempt > maxAttempts) {
      id = `${pick(CATALOG_PREFIXES)}-${padNum(Date.now() % 100000, 5)}`
      break
    }
  }

  return { id, properName, designation }
}

/**
 * 既存 PlanetBody の配列から各 Set を構築するユーティリティ。
 * commitDragPlace などで generateStarIdentity に渡す引数を作るために使う。
 */
export function collectExistingIdentities(bodies: Array<{
  name?: string
  designation?: string
  catalogId?: string
}>): {
  ids:          Set<string>
  properNames:  Set<string>
  designations: Set<string>
} {
  const ids          = new Set<string>()
  const properNames  = new Set<string>()
  const designations = new Set<string>()
  for (const b of bodies) {
    if (b.catalogId)   ids.add(b.catalogId)
    if (b.name)        properNames.add(b.name)
    if (b.designation) designations.add(b.designation)
  }
  return { ids, properNames, designations }
}
