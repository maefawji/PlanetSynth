// ── rackBusMixer.ts ────────────────────────────────────────────────────────────
// Per-body rack output bus.
//
// All instrument engines for a given body connect their final output to the
// body's "rack bus" input node.  The rack bus routes the summed audio through
// a volume fader (body.volume), then standpoint spatial processing, then on to
// the shared Tone.js master.
//
// Signal flow (per body):
//   [PadDrone]  ──┐
//   [FMDrone]   ──┤→ inputGain → faderGain(body.volume) → standpointGain(vol) → standpointPanner(pan) → toneGain → Destination
//   [NoisePad]  ──┤
//   [Granular]  ──┘
//
// All nodes share Tone.getContext().rawContext so cross-node connections are valid.

import * as Tone from 'tone'

interface BodyBus {
  inputGain:       GainNode          // instruments plug in here
  faderGain:       GainNode          // body.volume / mute control
  standpointGain:  GainNode          // standpoint volume attenuation
  standpointPanner: StereoPannerNode // standpoint stereo pan
  toneGain:        Tone.Gain         // bridge into the Tone.js master chain
  analyser:        AnalyserNode | null
  analyserBuf:     Float32Array | null
}

const _buses     = new Map<string, BodyBus>()
const _refCounts = new Map<string, number>()

export const WHOLE_INSTRUMENT_BUS_ID = '__whole_instrument__'

function ctx(): AudioContext {
  return Tone.getContext().rawContext as AudioContext
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Return (or create) the rack bus input GainNode for `bodyId`.
 *  Instrument engines should connect their final output here.
 *  Call retainBus() before connecting and releaseBus() on teardown. */
export function getBusInputNode(bodyId: string): GainNode {
  return _ensureBus(bodyId).inputGain
}

/** Increment ref-count for a body's bus (call once per connecting instrument). */
export function retainBus(bodyId: string): void {
  _refCounts.set(bodyId, (_refCounts.get(bodyId) ?? 0) + 1)
}

/** Decrement ref-count; destroy the bus when the last instrument releases it. */
export function releaseBus(bodyId: string): void {
  const n = (_refCounts.get(bodyId) ?? 1) - 1
  if (n <= 0) {
    _refCounts.delete(bodyId)
    destroyBus(bodyId)
  } else {
    _refCounts.set(bodyId, n)
  }
}

/** Set the body-level fader (0–1 linear, corresponds to body.volume). */
export function setBusVolume(bodyId: string, volume: number): void {
  const bus = _buses.get(bodyId)
  if (!bus) return
  const t = ctx().currentTime
  const v = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1))
  bus.faderGain.gain.setTargetAtTime(v, t, 0.04)
}

/**
 * Set the standpoint spatial processing for a body's rack bus output.
 * Called every frame from PlanetCanvas after computeBodyRackOutputSpatial().
 *   volume: 0–1 attenuation from standpoint distance/directionality
 *   pan:    -1..+1 stereo position from standpoint angle
 */
export function setBusStandpointSpatial(bodyId: string, volume: number, pan: number): void {
  const bus = _buses.get(bodyId)
  if (!bus) return
  const t = ctx().currentTime
  const v = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1))
  const p = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0))
  bus.standpointGain.gain.setTargetAtTime(v, t, 0.04)
  bus.standpointPanner.pan.setTargetAtTime(p, t, 0.04)
}

/** Tear down the bus when a body is removed. */
export function destroyBus(bodyId: string): void {
  const bus = _buses.get(bodyId)
  if (!bus) return
  try { bus.inputGain.disconnect()       } catch (_) {}
  try { bus.faderGain.disconnect()       } catch (_) {}
  try { bus.standpointGain.disconnect()  } catch (_) {}
  try { bus.standpointPanner.disconnect()} catch (_) {}
  try { bus.analyser?.disconnect()       } catch (_) {}
  try { bus.toneGain.dispose()           } catch (_) {}
  _buses.delete(bodyId)
}

/** True while at least one bus exists (useful for checking init state). */
export function hasBus(bodyId: string): boolean {
  return _buses.has(bodyId)
}

/**
 * Return the post-fader GainNode for `bodyId`, or null if no bus exists yet.
 * Use this to tap the body's instrument output (after the volume fader) for
 * routing into another body's effector bus as a proximity send.
 * Do NOT call _ensureBus here — the bus must already exist (created by getBusInputNode).
 */
export function getBusPostFaderNode(bodyId: string): GainNode | null {
  return _buses.get(bodyId)?.faderGain ?? null
}

export function getBusOscilloscopeData(bodyId: string): Float32Array | null {
  const bus = _buses.get(bodyId)
  if (!bus) return null
  if (!bus.analyser) {
    const analyser = ctx().createAnalyser()
    analyser.fftSize = 128
    analyser.smoothingTimeConstant = 0.15
    bus.standpointGain.connect(analyser)
    bus.analyser = analyser
    bus.analyserBuf = new Float32Array(analyser.fftSize)
  }
  if (!bus.analyserBuf) bus.analyserBuf = new Float32Array(bus.analyser.fftSize)
  bus.analyser.getFloatTimeDomainData(bus.analyserBuf)
  return bus.analyserBuf
}

export function clearBusOscilloscopeAnalysers(): void {
  for (const bus of _buses.values()) {
    try { bus.analyser?.disconnect() } catch (_) {}
    bus.analyser = null
    bus.analyserBuf = null
  }
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _ensureBus(bodyId: string): BodyBus {
  const existing = _buses.get(bodyId)
  if (existing) return existing

  const c = ctx()
  const inputGain       = c.createGain()
  const faderGain       = c.createGain()
  faderGain.gain.value  = 1
  const standpointGain  = c.createGain()
  standpointGain.gain.value = 1
  const standpointPanner = c.createStereoPanner()
  standpointPanner.pan.value = 0

  // Bridge raw Web Audio chain into the Tone.js master output.
  // Tone.Gain.input is the underlying GainNode (AudioNode), so a raw
  // AudioNode can connect to it directly.
  const toneGain = new Tone.Gain(1)
  toneGain.toDestination()

  inputGain.connect(faderGain)
  faderGain.connect(standpointGain)
  standpointGain.connect(standpointPanner)
  standpointPanner.connect(toneGain.input as unknown as AudioNode)

  const bus: BodyBus = { inputGain, faderGain, standpointGain, standpointPanner, toneGain, analyser: null, analyserBuf: null }
  _buses.set(bodyId, bus)
  return bus
}
