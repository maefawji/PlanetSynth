// ── audioLatencySettings.ts ───────────────────────────────────────────────────
// Manages the Web Audio API latencyHint setting.
//
// latencyHint maps to AudioContext buffer size:
//   'interactive' — ~128 samples  (default, lowest latency, most prone to glitches)
//   'balanced'    — ~512 samples  (good compromise for multi-voice use)
//   'playback'    — ~1024+ samples (most stable, ~20ms extra latency)
//
// The setting is persisted in localStorage and applied once at app startup via
// initToneContext(). Changing it requires a page reload to take effect.

import * as Tone from 'tone'

export type AudioLatencyHint = 'interactive' | 'balanced' | 'playback'

const LS_KEY = 'synth_audio_latency_hint'

export const LATENCY_OPTIONS: { value: AudioLatencyHint; label: string; desc: string }[] = [
  { value: 'interactive', label: 'Low',     desc: '~128 samples · 最低遅延・音源が多いとぷつぷつしやすい' },
  { value: 'balanced',    label: 'Balanced', desc: '~512 samples · 応答性と安定性のバランス（推奨）' },
  { value: 'playback',    label: 'Stable',   desc: '~1024 samples · 最安定・トリガーに約20ms遅延' },
]

/** Read saved preference (defaults to 'balanced'). */
export function getAudioLatencyHint(): AudioLatencyHint {
  const saved = localStorage.getItem(LS_KEY) as AudioLatencyHint | null
  if (saved === 'interactive' || saved === 'balanced' || saved === 'playback') return saved
  return 'balanced'
}

/** Persist a new preference. Reload required for it to take effect. */
export function setAudioLatencyHint(hint: AudioLatencyHint): void {
  localStorage.setItem(LS_KEY, hint)
}

/**
 * Create and register a Tone.Context with the saved latency hint.
 * Call this ONCE at app startup, before any Tone.start() call.
 * Also sets lookAhead to 0.3s for scheduler stability.
 */
export function initToneContext(): void {
  const hint = getAudioLatencyHint()
  try {
    const ctx = new Tone.Context({
      latencyHint: hint,
      lookAhead: 0.3,
    })
    Tone.setContext(ctx)
  } catch (e) {
    console.warn('[audioLatencySettings] Failed to create Tone.Context:', e)
  }
}
