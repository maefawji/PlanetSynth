// ── instrumentTrigger.ts ──────────────────────────────────────────────────────
// Central routing layer: "trigger rack fires → instrument rack plays".
//
// Called by PlanetCanvas at every trigger event (rendezvous, orbit-complete).
// Returns true if an instrument engine consumed the trigger, so the caller can
// skip the legacy triggerBodySound path.

import { useControlSetStore } from '../store/controlSetStore'
import { usePlanetStore } from '../store/planetStore'
import { getBodyOneShotEngine } from './OneShotSamplerEngine'
import { getBodyStretchSamplerEngine } from './StretchSamplerEngine'
import { getBodyLongSamplerEngine } from './LongSamplerEngine'
import type { StretchSamplerTimingSnapshot } from './StretchSamplerEngine'
import { getBodyOscSynthEngine } from '../components/planet/OscSynthLayer'
import {
  getBodyWaveLabEngine,
  refreshBodyWaveLabWaveform,
} from '../components/planet/WaveLabInstrumentLayer'
import { computeOrbitStats } from '../components/planet/DroneLayer'
import { resolveOrbitDurationSource } from '../lib/orbitDurationSource'

const _scheduledNoteOffs = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleNoteOff(key: string, releaseMs: number, off: () => void): void {
  const prev = _scheduledNoteOffs.get(key)
  if (prev) clearTimeout(prev)
  const timer = setTimeout(() => {
    _scheduledNoteOffs.delete(key)
    off()
  }, releaseMs)
  _scheduledNoteOffs.set(key, timer)
}

/**
 * Fire a trigger event on the body's active instrument engine.
 *
 * Returns true  → instrument engine was ready and consumed the trigger
 *                 (caller should skip the legacy triggerBodySound path)
 * Returns false → no engine ready; caller should fall through to legacy path
 *
 * IMPORTANT: only returns true when the engine EXISTS and has a loaded buffer.
 * If the instrument slot is set to oneshot but no sample is loaded yet, we
 * fall through so the legacy path can still attempt playback.
 */
/**
 * Fire a trigger event on the body's active instrument engine.
 *
 * @param bodyId     The body whose instrument rack slot should fire.
 * @param playbackRate Optional playback rate for oneshot instruments.
 *   instrument-oneshot:         rate is ignored (always plays at 1×).
 *   instrument-oneshot-stretch: rate is the orbit-stretch rate computed by PlanetCanvas.
 *
 * Returns true  → instrument engine was ready and consumed the trigger
 * Returns false → no engine ready; caller should fall through to legacy path
 */
export function fireBodyInstrumentTrigger(
  bodyId: string,
  playbackRate = 1,
  noteOverride?: number,
  samplerTiming?: Omit<StretchSamplerTimingSnapshot, 'capturedAt'>,
): boolean {
  const rack = useControlSetStore.getState().getBodyEffectiveRack(bodyId)

  if (rack.instrument === 'instrument-oneshot') {
    const eng = getBodyOneShotEngine(bodyId)
    if (eng?.hasBuffer) {
      eng.trigger(1)   // no stretch — always 1×
      return true
    }
    return false
  }

  if (rack.instrument === 'instrument-oneshot-stretch') {
    const eng = getBodyOneShotEngine(bodyId)
    if (eng?.hasBuffer) {
      eng.trigger(playbackRate)
      return true
    }
    return false
  }

  if (rack.instrument === 'instrument-sampler') {
    const eng = getBodyStretchSamplerEngine(bodyId)
    if (eng?.hasBuffer) {
      let timing = samplerTiming
      let rate = playbackRate
      const params = useControlSetStore.getState().getBodyEffectiveParams(bodyId) as Record<string, unknown>
      if (!timing) {
        const state = usePlanetStore.getState()
        const body = state.bodies.find(candidate => candidate.id === bodyId)
        if (body) {
          const expression = String(params.sampleTargetExpression ?? 'T')
          if (expression.trim().toLowerCase() === 'sampledur') {
            // "sampledur" keyword: play at natural sample speed (rate = 1)
            const bufDur = eng.bufferDuration
            if (bufDur > 0) {
              timing = { expression, sourceDuration: bufDur, targetDuration: bufDur }
              rate = 1
            }
          } else {
            const resolved = resolveOrbitDurationSource(expression, body, state.bodies)
            const sourceDuration =
              (computeOrbitStats(resolved.body, state.bodies, state.simParams.G)?.T_real ?? 0) *
              resolved.multiplier
            const numer = Math.max(1, Number(params.orbitLoopNumer ?? 1))
            const denom = Math.max(1, Number(params.orbitLoopDenom ?? 1))
            const targetDuration = sourceDuration * (numer / denom)
            if (targetDuration > 0) {
              timing = { expression, sourceDuration, targetDuration }
              rate = eng.bufferDuration / targetDuration
            }
          }
        }
      }
      // Retrigger: when off, skip if already playing
      if (!Boolean(params.samplerRetrigger ?? true) && eng.state === 'playing') {
        return true
      }
      // Note tracking: when on, pitch-shift relative to C3 (MIDI 48)
      if (noteOverride !== undefined && Boolean(params.samplerNoteTracking)) {
        rate = rate * Math.pow(2, (noteOverride - 48) / 12)
      }
      eng.trigger(rate, timing)
      return true
    }
    return false
  }

  if (rack.instrument === 'instrument-long-sampler') {
    const engine = getBodyLongSamplerEngine(bodyId)
    if (!engine?.hasBuffer) return false
    const state = usePlanetStore.getState()
    const body = state.bodies.find(candidate => candidate.id === bodyId)
    const params = useControlSetStore.getState().getBodyEffectiveParams(bodyId) as Record<string, unknown>
    if (!body) return false
    const durationMode = String(params.longSamplerDurationMode ?? 'seconds')
    const expression = durationMode === 'orbit'
      ? String(params.longSamplerDurationExpression ?? 'T')
      : `${Math.max(0.1, Number(params.longSamplerDurationSec ?? 30))}s`
    let duration = Math.max(0.1, Number(params.longSamplerDurationSec ?? 30))
    if (durationMode === 'orbit') {
      const resolved = resolveOrbitDurationSource(expression, body, state.bodies)
      duration =
        (computeOrbitStats(resolved.body, state.bodies, state.simParams.G)?.T_real ?? duration) *
        resolved.multiplier
    }
    return engine.trigger({
      duration,
      durationExpression: expression,
      startMode: String(params.longSamplerStartMode ?? 'random') === 'fixed' ? 'fixed' : 'random',
      start: Number(params.longSamplerStart ?? 0),
      pitchSemitones: Number(params.longSamplerPitch ?? 0),
      fadeIn: Number(params.longSamplerFadeIn ?? 3),
      fadeOut: Number(params.longSamplerFadeOut ?? 5),
      retrigger: String(params.longSamplerRetrigger ?? 'ignore') === 'restart' ? 'restart' : 'ignore',
      endMode: String(params.longSamplerEndMode ?? 'oneshot') === 'wander' ? 'wander' : 'oneshot',
    })
  }

  if (rack.instrument === 'instrument-osc-synth-orbit') {
    const eng = getBodyOscSynthEngine(bodyId)
    if (!eng) return false
    const ep      = useControlSetStore.getState().getBodyEffectiveParams(bodyId) as Record<string, unknown>
    const bodies  = usePlanetStore.getState().bodies
    const body    = bodies.find(b => b.id === bodyId)
    const note    = noteOverride ?? (body?.midiNote ?? 60)
    const release = Number(ep.oscSynthRelease ?? 1.5)
    eng.noteOn(note, (body?.midiVelocity ?? 100) / 127)
    // Schedule noteOff after 2× release (the engine's release envelope takes care of the tail)
    scheduleNoteOff(`osc:${bodyId}:${note}`, Math.max(300, release * 2000), () => eng.noteOff(note))
    return true
  }

  if (rack.instrument === 'instrument-wave-lab') {
    const eng = getBodyWaveLabEngine(bodyId)
    if (!eng) return false
    const body    = usePlanetStore.getState().bodies.find(b => b.id === bodyId)
    const ep      = useControlSetStore.getState().getBodyEffectiveParams(bodyId) as Record<string, unknown>
    const note    = noteOverride ?? (body?.midiNote ?? 60)
    const release = Number(ep.oscSynthRelease ?? 1.5)
    if (!eng.hasOrbitWaveform) return false
    eng.noteOn(note, (body?.midiVelocity ?? 100) / 127)
    scheduleNoteOff(`wave-lab:${bodyId}:${note}`, Math.max(300, release * 2000), () => eng.noteOff(note))
    return true
  }

  // Drone / granular / noise-pad are continuous — triggers don't apply
  return false
}
