// ── Sampler Playhead Registry ─────────────────────────────────────────────────
// Module-level store updated by SamplerLayer each animation frame.
// SamplerInstrumentPanel reads from here to render the moving playhead.

export interface SamplerPlayheadInfo {
  normPosInPlay: number   // 0-1 within the play buffer (sampleStart→sampleEnd range)
  rawDuration:  number    // full decoded buffer duration (seconds)
  sampleStart:  number    // 0-1 normalized in raw buffer
  sampleEnd:    number    // 0-1 normalized in raw buffer
  positionSec:  number    // current playback position in seconds (within raw buffer)
}

const _infos      = new Map<string, SamplerPlayheadInfo>()
const _rawDurs    = new Map<string, number>()   // persists even when not playing

export function setSamplerPlayhead(bodyId: string, info: SamplerPlayheadInfo): void {
  _infos.set(bodyId, info)
  _rawDurs.set(bodyId, info.rawDuration)
}

export function clearSamplerPlayhead(bodyId: string): void {
  _infos.delete(bodyId)
}

export function getSamplerPlayhead(bodyId: string): SamplerPlayheadInfo | null {
  return _infos.get(bodyId) ?? null
}

/** Raw duration is retained even when playback stops (so the bar keeps its size). */
export function getSamplerRawDuration(bodyId: string): number {
  return _rawDurs.get(bodyId) ?? 0
}

export function setSamplerRawDuration(bodyId: string, duration: number): void {
  if (duration > 0) _rawDurs.set(bodyId, duration)
}
