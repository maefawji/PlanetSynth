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
  {
    id: 'trigger-chord-test',
    name: 'Chord Test',
    icon: '♩',
    color: '#34d399',
    category: 'trigger',
    description:
      'C3 / E3 / G3 の3ボタンで各音をマニュアル送信。\n' +
      'Ambient Osc や One-Shot のテストに使う開発用トリガー。',
    params: {
      orbitTriggerMode: 'none',
      rendezvousDistance: 0,
    },
  },
  // ── Effect ─────────────────────────────────────────────────────────────────
  {
    id: 'effect-empty',
    name: 'Empty',
    icon: '∅',
    color: '#6b7280',
    category: 'effect',
    description:
      'グローバルエフェクトを上書きするための空スロット。\n' +
      'このボディにだけエフェクトを無効にしたいときに使う。',
    params: {
      effectorType: 'none',
    },
  },
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
      reverbMode:   'freeverb',      // lightweight default; switch to 'convolution' for HQ
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
  // ── Instrument ─────────────────────────────────────────────────────────────
  {
    id: 'instrument-empty',
    name: 'Empty',
    icon: '∅',
    color: '#6b7280',
    category: 'instrument',
    description:
      'グローバルインストゥルメントを上書きするための空スロット。\n' +
      'このボディにだけインストゥルメントを無効にしたいときに使う。',
    params: {
      oscSynthType:   'off',
      ambientOscType: 'off',
      oneShotType:    'off',
    },
  },
  {
    id: 'instrument-osc-synth',
    name: 'Osc Synth',
    icon: '∿',
    color: '#a78bfa',
    category: 'instrument',
    description:
      'AmbientOscillatorEngine をトリガー駆動で使うシンセ。\n' +
      'OscView と同じ仕様: 波形・フィルター・LFO (Pitch/Filter/Amp) を装備。\n' +
      'Manual / Chord Test / Orbit などのトリガーで noteOn/noteOff が発火。',
    params: {
      oscSynthType:            'osc-synth',
      oscSynthWaveform:        'sine',
      oscSynthAttack:          0.05,
      oscSynthDecay:           0.3,
      oscSynthSustain:         0.8,
      oscSynthRelease:         1.5,
      oscSynthFilterCutoff:    2000,
      oscSynthFilterResonance: 0.5,
      oscSynthLevel:           0.7,
      oscSynthLfoTarget:       'off',
      oscSynthLfoRate:         1.0,
      oscSynthLfoDepth:        0.3,
      oscSynthLfoWaveform:     'sine',
    },
  },
  {
    id: 'instrument-osc-synth-orbit',
    name: 'Osc Synth Orbit',
    icon: '⊙',
    color: '#c084fc',
    category: 'instrument',
    description:
      'ADSR・LFO の全パラメータを軌道情報から自動計算するOscSynth。\n' +
      'Attack/Release ← 公転周期 (T)  /  Decay・LFO ← 離心率 (ε)\n' +
      'Sustain ← 距離 (r)  /  Filter Cutoff ← 速度 (v)\n' +
      '各 rate はラックの orbit map から個別に調整できます。',
    params: {
      oscSynthType:            'osc-synth',
      oscSynthWaveform:        'sine',
      // Manual fallback values (used when orbit stats unavailable)
      oscSynthAttack:          0.5,
      oscSynthDecay:           2.0,
      oscSynthSustain:         0.8,
      oscSynthRelease:         3.0,
      oscSynthFilterCutoff:    1200,
      oscSynthFilterResonance: 0.5,
      oscSynthLevel:           0.7,
      oscSynthLfoTarget:       'filter',
      oscSynthLfoRate:         2.0,
      oscSynthLfoDepth:        0.5,
      oscSynthLfoWaveform:     'sine',
      // ── Orbit sources ────────────────────────────────────────────────────
      // Attack  ← period  (T 0.3–25s × 0.06 → A 0.02–1.5s)
      oscSynthAttackSource:    'period',
      oscSynthAttackRate:      0.06,
      // Decay   ← eccentricity  (ε 0–0.95 × 8.0 → D 0–7.6s)
      oscSynthDecaySource:     'eccentricity',
      oscSynthDecayRate:       8.0,
      // Sustain ← distance  (r ~280 × 0.003 → S ~0.84, clamped 0–1)
      oscSynthSustainSource:   'distance',
      oscSynthSustainRate:     0.003,
      // Release ← period  (T 0.3–25s × 0.2 → R 0.06–5s)
      oscSynthReleaseSource:   'period',
      oscSynthReleaseRate:     0.2,
      // Cutoff  ← velocity  (v ~1.89 × 600 → ~1134 Hz)
      oscSynthCutoffSource:    'velocity',
      oscSynthCutoffRate:      600,
      // LFO Rate ← eccentricity  (ε 0–0.95 × 5.0 → 0–4.75 Hz)
      oscSynthLfoRateSource:   'eccentricity',
      oscSynthLfoRateRate:     5.0,
      // LFO Depth ← eccentricity  (ε 0–0.95 × 0.8 → depth 0–0.76)
      oscSynthLfoDepthSource:  'eccentricity',
      oscSynthLfoDepthRate:    0.8,
    },
  },
  {
    id: 'instrument-ambient-osc',
    name: 'Ambient Osc',
    icon: '∿',
    color: '#818cf8',
    category: 'instrument',
    description:
      'シンプルな持続オシレーター。ゆっくりしたattack/releaseで滑らかなアンビエントサウンドを生む。\n' +
      'サイン波・三角波・ノコギリ波・矩形波をサポート。ローパスフィルター内蔵。\n' +
      'noteOn/noteOffをMIDIやトリガーから叩ける設計。',
    params: {
      ambientOscType:            'ambient-osc',
      ambientOscWaveform:        'sine',
      ambientOscAttack:          1.5,
      ambientOscRelease:         3.0,
      ambientOscFilterCutoff:    1200,
      ambientOscFilterResonance: 0.3,
      ambientOscLevel:           0.5,
      ambientOscNote:            60,
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
  sun:       { triggers: ['trigger-empty'], instrument: 'instrument-empty', effects: ['effect-empty'] },
  perturber: { triggers: ['trigger-empty'], instrument: 'instrument-osc-synth-orbit', effects: ['effect-empty'] },
}

/** Blank rack — used when clearing. Empty trigger list = no trigger. */
function emptyRack(): BodyRack {
  return { triggers: [], instrument: 'instrument-oneshot', effects: [] }
}

/** Initial global rack — orbit trigger pre-assigned so app starts with timing. */
function defaultGlobalRack(): BodyRack {
  return { triggers: ['orbit'], instrument: 'instrument-oneshot-stretch', effects: [] }
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
