import { create } from 'zustand'
import type { PlanetSimParams } from './planetStore'

// ── Control Set definition ────────────────────────────────────────────────────

export type ControlSetCategory = 'trigger' | 'instrument' | 'effect'

export interface ControlSet {
  id: string
  name: string
  /** Emoji or single-char symbol */
  icon: string
  color: string
  description: string
  category: ControlSetCategory
  /** PlanetSimParams keys this set sets when assigned to the rack */
  params: Partial<PlanetSimParams>
}

// ── Built-in sets ─────────────────────────────────────────────────────────────

export const BUILTIN_CONTROL_SETS: ControlSet[] = [
  // ── Trigger ────────────────────────────────────────────────────────────────
  // Trigger modes: Empty / Rendezvous / Orbit / Manual
  {
    id: 'trigger-empty',
    name: 'Empty',
    icon: '∅',
    color: '#6b7280',
    category: 'trigger',
    description:
      'グローバルトリガーを上書きするための空スロット。\n' +
      'このボディにだけトリガーを無効にしたいときに使う。',
    params: {
      orbitTriggerMode: 'none',
      rendezvousDistance: 0,
    },
  },
  {
    id: 'rendezvous',
    name: 'Rendezvous',
    icon: '⊙',
    color: '#a78bfa',
    category: 'trigger',
    description:
      '2天体が設定距離内に接近したときにMIDI Note Onを送信。\n' +
      'modeをoneshot（一度だけ）/ toggle（on/off切替）で選択。',
    params: {
      rendezvousTriggerMode: 'oneshot',   // 'oneshot' | 'toggle'
      rendezvousDistance: 50,
      orbitTriggerMode: 'none',
      orbitStretchMode: false,
    },
  },
  {
    id: 'orbit',
    name: 'Orbit',
    icon: '↺',
    color: '#60a5fa',
    category: 'trigger',
    description:
      '公転完了のたびにMIDI Note Onを送信。\n' +
      'divで1周期に何回トリガーするか細分割できる。',
    params: {
      orbitTriggerType: 'tperiod',
      orbitTriggerMode: 'orbit-complete',
      orbitTriggerDivision: 1,
      showOrbitTriggerMarkers: false,
      rendezvousDistance: 0,
      orbitStretchMode: false,
    },
  },
  {
    id: 'trigger-manual',
    name: 'Manual',
    icon: '▶',
    color: '#fb923c',
    category: 'trigger',
    description:
      'ラック上の ▶ TRIGGER ボタンを押すとMIDI Note Onを手動送信。\n' +
      'デバッグや任意タイミングでのワンショット確認に。',
    params: {
      orbitTriggerMode: 'none',
      rendezvousDistance: 0,
    },
  },
  // ── Instrument ─────────────────────────────────────────────────────────────
  {
    id: 'instrument-sampler',
    name: 'Sampler',
    icon: '▶',
    color: '#06b6d4',
    category: 'instrument',
    description:
      'サンプルを再生するインストゥルメント。\n' +
      'ループ/ワンショット/ピンポン、スタート/エンドポイント、逆再生などをサポート。',
    params: {
      samplerType:        'sampler',
      samplerMode:        'auto',
      samplerSampleId:    null,
      samplerVolume:      0.7,
      samplerPlayMode:    'loop',
      samplerSampleStart: 0,
      samplerSampleEnd:   1,
      samplerLoopStart:   0,
      samplerLoopEnd:     1,
      samplerReverse:     false,
      samplerDetune:      0,
      samplerAttack:      0.01,
      samplerRelease:     1.0,
      samplerReverbMix:   0.3,
      orbitStretchMode:   false,
    },
  },
  {
    id: 'instrument-pad-drone',
    name: 'Pad Drone',
    icon: '♪',
    color: '#8b5cf6',
    category: 'instrument',
    description:
      'このbodyに持続するドローンパッドを割り当てる。\n' +
      '軌道しながら常時発音するウォームなパッド音源。',
    params: {
      droneType: 'pad',
      droneMode: 'orbit',
      droneRootNote: 'A2',
      droneVolume: 0.35,
      droneBrightness: 1200,
      droneMelt: 0.5,
      droneDetune: 8,
      droneMotion: 0.4,
      droneAttack: 6.0,
      droneRelease: 12.0,
      droneReverbMix: 0.55,
    },
  },
  // ── Effect ─────────────────────────────────────────────────────────────────
  {
    id: 'effect-reverb',
    name: 'Reverb',
    icon: '〜',
    color: '#f97316',
    category: 'effect',
    description:
      'このbodyをリバーブエフェクターとして機能させる。\n' +
      '範囲内の他の天体の音にリバーブがかかる。',
    params: {
      effectorType: 'reverb',
      effectorDistance: 200,
      effectorMaxWet: 0.7,
      effectorDecay: 2.5,
    },
  },
  {
    id: 'effect-delay',
    name: 'Delay',
    icon: '↔',
    color: '#a78bfa',
    category: 'effect',
    description:
      'このbodyをディレイエフェクターとして機能させる。\n' +
      '範囲内の天体の音にフィードバックディレイをかける。',
    params: {
      effectorType: 'delay',
      effectorDistance: 200,
      effectorMaxWet: 0.6,
      effectorDelayDivision: 0.25,
      effectorFeedback: 0.9,
    },
  },
  {
    id: 'effect-distortion',
    name: 'Distortion',
    icon: '⚡',
    color: '#ef4444',
    category: 'effect',
    description:
      'このbodyをディストーションエフェクターとして機能させる。',
    params: {
      effectorType: 'distortion',
      effectorDistance: 150,
      effectorMaxWet: 0.7,
      effectorDistortion: 0.4,
    },
  },
  {
    id: 'effect-chorus',
    name: 'Chorus',
    icon: '≋',
    color: '#10b981',
    category: 'effect',
    description:
      'このbodyをコーラスエフェクターとして機能させる。',
    params: {
      effectorType: 'chorus',
      effectorDistance: 200,
      effectorMaxWet: 0.6,
      effectorChorusFreq: 1.5,
      effectorChorusDepth: 0.5,
    },
  },
  {
    id: 'effect-standpoint',
    name: 'Standpoint Distance',
    icon: '⊕',
    color: '#06b6d4',
    category: 'effect',
    description:
      'スタンドポイント（基準天体）からの距離で音量を制御。\n' +
      'InspectorでSPボタンを押してスタンドポイントを設定。',
    params: {
      standpointMode: true,
      standpointMaxDist: 400,
      standpointMinVol: 0,
    },
  },
  {
    id: 'effect-phaser',
    name: 'Phaser',
    icon: '∿',
    color: '#c084fc',
    category: 'effect',
    description:
      'このbodyをフェイザーエフェクターとして機能させる。\n' +
      '位相変調でフランジャー的なうねりを生み出す。',
    params: {
      effectorType: 'phaser',
      effectorDistance: 250,
      effectorMaxWet: 0.7,
      effectorPhaserRate: 0.5,
      effectorPhaserOctaves: 3,
    },
  },
  {
    id: 'effect-autofilter',
    name: 'Auto-Filter',
    icon: '⌇',
    color: '#22d3ee',
    category: 'effect',
    description:
      'このbodyをオートフィルターエフェクターとして機能させる。\n' +
      'LFOでフィルターをゆっくりスウィープして動くアンビエント感を生む。',
    params: {
      effectorType: 'autofilter',
      effectorDistance: 300,
      effectorMaxWet: 0.8,
      effectorAutoFilterFreq: 0.5,
      effectorAutoFilterDepth: 1.0,
      effectorAutoFilterBaseFreq: 200,
    },
  },
  {
    id: 'effect-bitcrush',
    name: 'Bit Crush',
    icon: '⊞',
    color: '#fb923c',
    category: 'effect',
    description:
      'このbodyをビットクラッシャーエフェクターとして機能させる。\n' +
      'サンプル深度を下げてローファイなグリッチ感を生む。',
    params: {
      effectorType: 'bitcrush',
      effectorDistance: 180,
      effectorMaxWet: 0.65,
      effectorBitDepth: 8,
    },
  },
  {
    id: 'effect-freeze',
    name: 'Freeze Reverb',
    icon: '❄',
    color: '#7dd3fc',
    category: 'effect',
    description:
      'このbodyをフリーズリバーブエフェクターとして機能させる。\n' +
      '極端に長いリバーブ（30秒）で音を無限に持続させる。',
    params: {
      effectorType: 'freeze',
      effectorDistance: 400,
      effectorMaxWet: 0.5,
      effectorFreezeDecay: 30,
    },
  },
  {
    id: 'effect-microphone',
    name: 'Microphone',
    icon: '🎙',
    color: '#38bdf8',
    category: 'effect',
    description:
      'このbodyをミキサーとして機能させる。\n' +
      'Input 1: 左のinstrumentスロットの音。\n' +
      'Input 2: 設定距離内の他のbodyのrack出力（距離に応じて音量調整）。\n' +
      'Output: 右のエフェクタースロットへ渡す。',
    params: {
      effectorType: 'microphone',
      effectorDistance: 200,   // Input 2 pickup radius
      micSelfGain: 1.0,        // Input 1: own instrument gain
      micPickupGain: 1.0,      // Input 2: max gain at distance=0
    },
  },
  // ── Instrument (Granular / FM / Noise) ─────────────────────────────────────
  {
    id: 'instrument-granular',
    name: 'Granular',
    icon: '⋯',
    color: '#a3e635',
    category: 'instrument',
    description:
      '読み込み済みサンプルをマイクログレインに分解してリアルタイム再生。\n' +
      '粒子感のある霞・雲のようなアンビエントテクスチャを生み出す。',
    params: {
      droneType: 'none',
      granularType: 'grain',
      granularVolume: 0.6,
      granularGrainSize: 0.08,
      granularOverlap: 0.04,
      granularDetune: 0,
      granularReverbMix: 0.5,
    },
  },
  {
    id: 'instrument-fm-drone',
    name: 'FM Drone',
    icon: '⌁',
    color: '#f59e0b',
    category: 'instrument',
    description:
      '2オペレーターFM合成による持続ドローン。\n' +
      '軌道の離心率でFMインデックスが変化し、金属的・ガラス的な倍音を生む。',
    params: {
      droneType: 'none',
      fmDroneType: 'fm',
      fmDroneRootNote: 'A2',
      fmDroneRatio: 3,
      fmDroneIndex: 3,
      fmDroneVolume: 0.35,
      fmDroneAttack: 4.0,
      fmDroneRelease: 8.0,
      fmDroneReverbMix: 0.5,
    },
  },
  {
    id: 'instrument-noise-pad',
    name: 'Noise Pad',
    icon: '≈',
    color: '#94a3b8',
    category: 'instrument',
    description:
      'ブラウンノイズを共鳴バンドパスフィルターで整形した持続パッド。\n' +
      '風・息・宇宙的なアトモスフィアを生む。軌道に合わせてフィルターが動く。',
    params: {
      droneType: 'none',
      noisePadType: 'noise',
      noisePadVolume: 0.3,
      noisePadFreq: 600,
      noisePadQ: 8,
      noisePadAttack: 3.0,
      noisePadRelease: 6.0,
      noisePadReverbMix: 0.6,
    },
  },
  {
    id: 'instrument-oneshot',
    name: 'One-Shot',
    icon: '◆',
    color: '#06b6d4',
    category: 'instrument',
    description:
      'シンプルなワンショットサンプラー。\n' +
      'トリガーされるたびに先頭から1回再生。再生中のトリガーで即リスタート。\n' +
      '↗ ボタンでサンプルのロードとトリガーパネルを開く。',
    params: {
      oneShotType: 'oneshot',
    },
  },
  {
    id: 'instrument-oneshot-stretch',
    name: 'Oneshot Stretch',
    icon: '⟳',
    color: '#f59e0b',
    category: 'instrument',
    description:
      '軌道周期に同期してストレッチ再生するワンショットサンプラー。\n' +
      'Rate stretch: 再生速度を軌道周期に合わせて調整。\n' +
      'Time stretch: ピッチ固定のまま再生時間を軌道周期に同期。',
    params: {
      oneShotType:          'oneshot',
      sampleStretchMode:    'rate',
      orbitLoopNumer:       1,
      orbitLoopDenom:       1,
      sampleOrbitSource:    'current',
      samplePitchCorrection: false,
    },
  },
]

// ── Rack types ────────────────────────────────────────────────────────────────

/**
 * A body's complete rack state (resolved — no nulls in effects).
 * `triggers` is an ordered list of trigger CS IDs; may be empty.
 */
export interface BodyRack {
  /** Ordered list of trigger ControlSet IDs (multiple allowed, each fires independently) */
  triggers:   string[]
  /** ControlSet ID for the instrument slot, or null */
  instrument: string | null
  /** Ordered list of effect ControlSet IDs */
  effects:    string[]
}

/**
 * Per-body override.  undefined = inherit from global rack.
 * null is a valid value meaning "explicitly none".
 */
export interface BodyRackOverride {
  triggers?:   string[]   // if present, replaces global triggers list
  instrument?: string | null
  effects?:    string[]   // if present, replaces global effects list
}

export const MAX_EFFECTS  = 6
export const MAX_TRIGGERS = 4

export const DEFAULT_BODY_RACKS: Record<string, BodyRackOverride> = {
  sun: { instrument: null },
}

/** Blank rack — used when clearing. Empty trigger list = no trigger. */
function emptyRack(): BodyRack {
  return { triggers: [], instrument: 'instrument-oneshot', effects: [] }
}

/** Initial global rack — orbit trigger pre-assigned so app starts with timing. */
function defaultGlobalRack(): BodyRack {
  return { triggers: ['orbit'], instrument: 'instrument-oneshot', effects: [] }
}

function defaultBodyRacks(): Record<string, BodyRackOverride> {
  return Object.fromEntries(
    Object.entries(DEFAULT_BODY_RACKS).map(([id, rack]) => {
      const clone: BodyRackOverride = { ...rack }
      if (rack.effects) clone.effects = [...rack.effects]
      return [id, clone]
    }),
  )
}

// ── Param override key helpers ────────────────────────────────────────────────

// Format: "g:trigger:N" | "g:instrument" | "g:effect:N"
//         "b:{id}:trigger:N" | "b:{id}:instrument" | "b:{id}:effect:N"

type SlotSuffix = 'instrument' | `trigger:${number}` | `effect:${number}`

function gKey(slot: SlotSuffix): string {
  return `g:${slot}`
}
function bKey(bodyId: string, slot: SlotSuffix): string {
  return `b:${bodyId}:${slot}`
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface ControlSetState {
  // ── Global rack ─────────────────────────────────────────────────────────
  globalRack: BodyRack

  /** Set the instrument slot (id=null to clear). For legacy trigger compat: sets triggers=[id]. */
  setGlobalSlot:      (slot: 'instrument', id: string | null) => void
  addGlobalTrigger:   (id: string) => void
  removeGlobalTrigger:(index: number) => void
  addGlobalEffect:    (id: string) => void
  removeGlobalEffect: (index: number) => void
  clearGlobalRack:    () => void

  // ── Per-body racks ───────────────────────────────────────────────────────
  bodyRacks: Record<string, BodyRackOverride>

  /** Set the instrument slot override for a body.  Pass null to explicitly clear. */
  setBodySlot:      (bodyId: string, slot: 'instrument', id: string | null) => void
  /** Remove the instrument override (reverts to global) */
  clearBodySlot:    (bodyId: string, slot: 'instrument') => void
  addBodyTrigger:   (bodyId: string, id: string) => void
  removeBodyTrigger:(bodyId: string, index: number) => void
  clearBodyTriggers:(bodyId: string) => void
  addBodyEffect:    (bodyId: string, id: string) => void
  removeBodyEffect: (bodyId: string, index: number) => void
  clearBodyRack:    (bodyId: string) => void
  resetBodyRacksToDefaults: () => void

  // ── Per-slot param overrides ─────────────────────────────────────────────
  rackParamOverrides: Record<string, Partial<PlanetSimParams>>
  setSlotOverride:  (slotKey: string, patch: Partial<PlanetSimParams>) => void
  resetSlotParam:   (slotKey: string, paramKey: string) => void

  // ── Computed ─────────────────────────────────────────────────────────────
  getBodyEffectiveRack:       (bodyId: string) => BodyRack
  getBodyEffectiveParams:     (bodyId: string) => Partial<PlanetSimParams>
  /** Returns per-trigger params for each trigger in the body's effective rack. */
  getBodyTriggerParamsList:   (bodyId: string) => Partial<PlanetSimParams>[]
  getGlobalEffectiveParams:   () => Partial<PlanetSimParams>

  // ── Backwards compat shims (used by PlanetCanvas) ─────────────────────────
  getEffectiveParams: () => Partial<PlanetSimParams>
}

// ── Merge helpers ─────────────────────────────────────────────────────────────

function csParams(id: string | null): Partial<PlanetSimParams> {
  if (!id) return {}
  const cs = BUILTIN_CONTROL_SETS.find(c => c.id === id)
  return cs?.params ?? {}
}

function mergeWithOverride(
  base: Partial<PlanetSimParams>,
  overrideKey: string,
  overrides: Record<string, Partial<PlanetSimParams>>,
): Partial<PlanetSimParams> {
  const ov = overrides[overrideKey]
  return ov ? { ...base, ...ov } : base
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useControlSetStore = create<ControlSetState>((set, get) => ({
  globalRack: defaultGlobalRack(),
  bodyRacks: defaultBodyRacks(),
  rackParamOverrides: {},

  // ── Global rack mutations ────────────────────────────────────────────────

  setGlobalSlot(slot, id) {
    set(s => ({
      globalRack: { ...s.globalRack, [slot]: id },
      rackParamOverrides: (() => {
        const next = { ...s.rackParamOverrides }
        delete next[gKey(slot)]
        return next
      })(),
    }))
  },

  addGlobalTrigger(id) {
    set(s => {
      if (s.globalRack.triggers.length >= MAX_TRIGGERS) return s
      return { globalRack: { ...s.globalRack, triggers: [...s.globalRack.triggers, id] } }
    })
  },

  removeGlobalTrigger(index) {
    set(s => {
      const next = s.globalRack.triggers.filter((_, i) => i !== index)
      // Re-key overrides for global triggers
      const overrides: Record<string, Partial<PlanetSimParams>> = {}
      for (const [key, val] of Object.entries(s.rackParamOverrides)) {
        if (!key.startsWith('g:trigger:')) { overrides[key] = val; continue }
        const i = parseInt(key.split(':')[2])
        if (i === index) continue
        overrides[gKey(`trigger:${i > index ? i - 1 : i}`)] = val
      }
      return { globalRack: { ...s.globalRack, triggers: next }, rackParamOverrides: overrides }
    })
  },

  addGlobalEffect(id) {
    set(s => {
      if (s.globalRack.effects.length >= MAX_EFFECTS) return s
      return { globalRack: { ...s.globalRack, effects: [...s.globalRack.effects, id] } }
    })
  },

  removeGlobalEffect(index) {
    set(s => {
      const next = s.globalRack.effects.filter((_, i) => i !== index)
      const overrides: Record<string, Partial<PlanetSimParams>> = {}
      for (const [key, val] of Object.entries(s.rackParamOverrides)) {
        if (!key.startsWith('g:effect:')) { overrides[key] = val; continue }
        const i = parseInt(key.split(':')[2])
        if (i === index) continue
        overrides[gKey(`effect:${i > index ? i - 1 : i}`)] = val
      }
      return { globalRack: { ...s.globalRack, effects: next }, rackParamOverrides: overrides }
    })
  },

  clearGlobalRack() {
    set(s => {
      const overrides: Record<string, Partial<PlanetSimParams>> = {}
      for (const [key, val] of Object.entries(s.rackParamOverrides)) {
        if (!key.startsWith('g:')) overrides[key] = val
      }
      return { globalRack: emptyRack(), rackParamOverrides: overrides }
    })
  },

  // ── Per-body rack mutations ──────────────────────────────────────────────

  setBodySlot(bodyId, slot, id) {
    set(s => {
      const prev = s.bodyRacks[bodyId] ?? {}
      const overrides = { ...s.rackParamOverrides }
      delete overrides[bKey(bodyId, slot)]
      return {
        bodyRacks: { ...s.bodyRacks, [bodyId]: { ...prev, [slot]: id } },
        rackParamOverrides: overrides,
      }
    })
  },

  clearBodySlot(bodyId, slot) {
    set(s => {
      const prev = s.bodyRacks[bodyId] ?? {}
      const next = { ...prev }
      delete next[slot]
      const overrides = { ...s.rackParamOverrides }
      delete overrides[bKey(bodyId, slot)]
      return { bodyRacks: { ...s.bodyRacks, [bodyId]: next } }
    })
  },

  addBodyTrigger(bodyId, id) {
    set(s => {
      const prev = s.bodyRacks[bodyId] ?? {}
      // Start from the body's own list (never inherit global here).
      // Inheriting would silently prepend global triggers when first adding a body trigger.
      const prevTriggers = prev.triggers ?? []
      if (prevTriggers.length >= MAX_TRIGGERS) return s
      return {
        bodyRacks: {
          ...s.bodyRacks,
          [bodyId]: { ...prev, triggers: [...prevTriggers, id] },
        },
      }
    })
  },

  removeBodyTrigger(bodyId, index) {
    set(s => {
      const current = (s.bodyRacks[bodyId]?.triggers) ?? []
      const next = current.filter((_, i) => i !== index)
      const overrides: Record<string, Partial<PlanetSimParams>> = {}
      for (const [key, val] of Object.entries(s.rackParamOverrides)) {
        if (!key.startsWith(`b:${bodyId}:trigger:`)) { overrides[key] = val; continue }
        const i = parseInt(key.split(':')[3])
        if (i === index) continue
        overrides[bKey(bodyId, `trigger:${i > index ? i - 1 : i}`)] = val
      }
      return {
        bodyRacks: {
          ...s.bodyRacks,
          [bodyId]: { ...(s.bodyRacks[bodyId] ?? {}), triggers: next },
        },
        rackParamOverrides: overrides,
      }
    })
  },

  clearBodyTriggers(bodyId) {
    set(s => {
      const prev = s.bodyRacks[bodyId] ?? {}
      const next = { ...prev }
      delete next.triggers
      const overrides: Record<string, Partial<PlanetSimParams>> = {}
      for (const [key, val] of Object.entries(s.rackParamOverrides)) {
        if (!key.startsWith(`b:${bodyId}:trigger:`)) overrides[key] = val
      }
      return { bodyRacks: { ...s.bodyRacks, [bodyId]: next }, rackParamOverrides: overrides }
    })
  },

  addBodyEffect(bodyId, id) {
    set(s => {
      const prev = s.bodyRacks[bodyId] ?? {}
      const prevEffects = prev.effects ?? []
      if (prevEffects.length >= MAX_EFFECTS) return s
      return {
        bodyRacks: {
          ...s.bodyRacks,
          [bodyId]: { ...prev, effects: [...prevEffects, id] },
        },
      }
    })
  },

  removeBodyEffect(bodyId, index) {
    set(s => {
      const currentEffects = (s.bodyRacks[bodyId]?.effects) ?? []
      const next = currentEffects.filter((_, i) => i !== index)
      const overrides: Record<string, Partial<PlanetSimParams>> = {}
      for (const [key, val] of Object.entries(s.rackParamOverrides)) {
        if (!key.startsWith(`b:${bodyId}:effect:`)) { overrides[key] = val; continue }
        const i = parseInt(key.split(':')[3])
        if (i === index) continue
        overrides[bKey(bodyId, `effect:${i > index ? i - 1 : i}`)] = val
      }
      return {
        bodyRacks: {
          ...s.bodyRacks,
          [bodyId]: { ...(s.bodyRacks[bodyId] ?? {}), effects: next },
        },
        rackParamOverrides: overrides,
      }
    })
  },

  clearBodyRack(bodyId) {
    set(s => {
      const nextRacks = { ...s.bodyRacks }
      delete nextRacks[bodyId]
      const overrides: Record<string, Partial<PlanetSimParams>> = {}
      for (const [key, val] of Object.entries(s.rackParamOverrides)) {
        if (!key.startsWith(`b:${bodyId}:`)) overrides[key] = val
      }
      return { bodyRacks: nextRacks, rackParamOverrides: overrides }
    })
  },

  resetBodyRacksToDefaults() {
    set(s => {
      // Keep only global-slot overrides (g:*), discard all body overrides (b:*)
      const overrides: Record<string, Partial<PlanetSimParams>> = {}
      for (const [key, val] of Object.entries(s.rackParamOverrides)) {
        if (key.startsWith('g:')) overrides[key] = val
      }
      return {
        globalRack: defaultGlobalRack(),
        bodyRacks: defaultBodyRacks(),
        rackParamOverrides: overrides,
      }
    })
  },

  // ── Param overrides ──────────────────────────────────────────────────────

  setSlotOverride(slotKey, patch) {
    set(s => ({
      rackParamOverrides: {
        ...s.rackParamOverrides,
        [slotKey]: { ...(s.rackParamOverrides[slotKey] ?? {}), ...patch },
      },
    }))
  },

  resetSlotParam(slotKey, paramKey) {
    set(s => {
      const existing = s.rackParamOverrides[slotKey]
      if (!existing) return s
      const next = { ...(existing as Record<string, unknown>) }
      delete next[paramKey]
      const allOverrides = { ...s.rackParamOverrides }
      if (Object.keys(next).length === 0) delete allOverrides[slotKey]
      else allOverrides[slotKey] = next as Partial<PlanetSimParams>
      return { rackParamOverrides: allOverrides }
    })
  },

  // ── Computed ─────────────────────────────────────────────────────────────

  getBodyEffectiveRack(bodyId) {
    const { globalRack, bodyRacks } = get()
    const ov = bodyRacks[bodyId] ?? {}
    // Fall back to global only when the body slot is empty (not just absent).
    // Rules:
    //   triggers/effects — use body's list if it has ≥1 entry; otherwise use global
    //   instrument       — use body's value if non-null; otherwise use global
    return {
      triggers:   (ov.triggers   != null && ov.triggers.length   > 0) ? ov.triggers   : globalRack.triggers,
      instrument: (ov.instrument != null)                              ? ov.instrument : globalRack.instrument,
      effects:    (ov.effects    != null && ov.effects.length    > 0) ? ov.effects    : globalRack.effects,
    }
  },

  getBodyEffectiveParams(bodyId) {
    const state = get()
    const { rackParamOverrides } = state
    const rack = state.getBodyEffectiveRack(bodyId)
    const merged: Partial<PlanetSimParams> = {}

    const bodyOvMap  = state.bodyRacks[bodyId] ?? {}
    const trigIsBody = bodyOvMap.triggers   != null && bodyOvMap.triggers.length   > 0
    const instIsBody = bodyOvMap.instrument != null
    const effIsBody  = bodyOvMap.effects    != null && bodyOvMap.effects.length    > 0

    function applySlot(
      csId: string,
      effectiveKey: string,
      isBodySlot: boolean,
      slotSuffix: SlotSuffix,
    ) {
      Object.assign(merged, mergeWithOverride(csParams(csId), effectiveKey, rackParamOverrides))
      if (!isBodySlot) {
        const bodyOv = rackParamOverrides[bKey(bodyId, slotSuffix)]
        if (bodyOv) Object.assign(merged, bodyOv)
      }
    }

    // Triggers (all merged in order — last wins for conflicting keys)
    rack.triggers.forEach((id, i) => {
      applySlot(id,
        trigIsBody ? bKey(bodyId, `trigger:${i}`) : gKey(`trigger:${i}`),
        trigIsBody, `trigger:${i}`)
    })
    // Instrument
    if (rack.instrument) {
      applySlot(rack.instrument,
        instIsBody ? bKey(bodyId, 'instrument') : gKey('instrument'),
        instIsBody, 'instrument')
    }
    // Effects
    rack.effects.forEach((id, i) => {
      applySlot(id,
        effIsBody ? bKey(bodyId, `effect:${i}`) : gKey(`effect:${i}`),
        effIsBody, `effect:${i}`)
    })

    return merged
  },

  getBodyTriggerParamsList(bodyId) {
    const state = get()
    const { rackParamOverrides } = state
    const rack = state.getBodyEffectiveRack(bodyId)
    const bodyOvMap  = state.bodyRacks[bodyId] ?? {}
    const trigIsBody = bodyOvMap.triggers != null && bodyOvMap.triggers.length > 0

    return rack.triggers.map((id, i) => {
      const effectiveKey = trigIsBody ? bKey(bodyId, `trigger:${i}`) : gKey(`trigger:${i}`)
      const merged = { ...mergeWithOverride(csParams(id), effectiveKey, rackParamOverrides) }
      if (!trigIsBody) {
        const bodyOv = rackParamOverrides[bKey(bodyId, `trigger:${i}`)]
        if (bodyOv) Object.assign(merged, bodyOv)
      }
      return merged
    })
  },

  getGlobalEffectiveParams() {
    const { globalRack, rackParamOverrides } = get()
    const merged: Partial<PlanetSimParams> = {}
    globalRack.triggers.forEach((id, i) => {
      Object.assign(merged, mergeWithOverride(csParams(id), gKey(`trigger:${i}`), rackParamOverrides))
    })
    if (globalRack.instrument) {
      Object.assign(merged, mergeWithOverride(csParams(globalRack.instrument), gKey('instrument'), rackParamOverrides))
    }
    globalRack.effects.forEach((id, i) => {
      Object.assign(merged, mergeWithOverride(csParams(id), gKey(`effect:${i}`), rackParamOverrides))
    })
    return merged
  },

  // Backwards compat alias
  getEffectiveParams() { return get().getGlobalEffectiveParams() },
}))
