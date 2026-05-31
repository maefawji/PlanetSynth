// ── instrumentTrigger.ts ──────────────────────────────────────────────────────
// Central routing layer: "trigger rack fires → instrument rack plays".
//
// Called by PlanetCanvas at every trigger event (rendezvous, orbit-complete).
// Returns true if an instrument engine consumed the trigger, so the caller can
// skip the legacy triggerBodySound path.

import { useControlSetStore } from '../store/controlSetStore'
import { usePlanetStore } from '../store/planetStore'
import { getBodyOneShotEngine } from './OneShotSamplerEngine'
import { getBodyOscSynthEngine } from '../components/planet/OscSynthLayer'

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
export function fireBodyInstrumentTrigger(bodyId: string, playbackRate = 1, noteOverride?: number): boolean {
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

  if (rack.instrument === 'instrument-osc-synth' || rack.instrument === 'instrument-osc-synth-orbit') {
    const eng = getBodyOscSynthEngine(bodyId)
    if (!eng) return false
    const ep      = useControlSetStore.getState().getBodyEffectiveParams(bodyId) as Record<string, unknown>
    const bodies  = usePlanetStore.getState().bodies
    const body    = bodies.find(b => b.id === bodyId)
    const note    = noteOverride ?? (body?.midiNote ?? 60)
    const release = Number(ep.oscSynthRelease ?? 1.5)
    eng.noteOn(note, (body?.midiVelocity ?? 100) / 127)
    // Schedule noteOff after 2× release (the engine's release envelope takes care of the tail)
    setTimeout(() => eng.noteOff(note), Math.max(300, release * 2000))
    return true
  }

  // Drone / granular / noise-pad are continuous — triggers don't apply
  return false
}
