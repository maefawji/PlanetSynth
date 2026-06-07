import * as Tone from 'tone'
import type { GeometryObject, SampleAsset } from '../patch/types'
import type { AdsrEnvelope } from './orbitAdsr'
import { getBusInputNode, getBusPostFaderNode } from './rackBusMixer'

const samplePlayers    = new Map<string, Tone.Player>()
const samplePlayerUrls = new Map<string, string>()
const sampleAmpEnvs    = new Map<string, Tone.AmplitudeEnvelope>()
const samplePitchShifts = new Map<string, Tone.PitchShift>()
const samplePanners    = new Map<string, Tone.Panner>()
// Tracks when each sample last started, to compute approximate playback position
const playerStartInfo  = new Map<string, { toneTime: number; offset: number }>()

// ── Global ADSR ───────────────────────────────────────────────────────────────
let globalAdsr = { attack: 0.005, decay: 0.1, sustain: 1.0, release: 0.3 }

export function setGlobalAdsr(patch: Partial<typeof globalAdsr>): void {
  globalAdsr = { ...globalAdsr, ...patch }
  for (const env of sampleAmpEnvs.values()) {
    if (patch.attack  !== undefined) env.attack  = patch.attack
    if (patch.decay   !== undefined) env.decay   = patch.decay
    if (patch.sustain !== undefined) env.sustain = patch.sustain
    if (patch.release !== undefined) env.release = patch.release
  }
}

// ── Per-body trigger tracking ──────────────────────────────────────────────────
const bodyTriggerTimes = new Map<string, number>()

/** Mark that a body was triggered right now (for activity indicators). */
export function markBodyTriggered(bodyId: string): void {
  bodyTriggerTimes.set(bodyId, Date.now())
}

/** True if the body was triggered within the last `withinMs` milliseconds. */
export function wasBodyRecentlyTriggered(bodyId: string, withinMs = 600): boolean {
  const t = bodyTriggerTimes.get(bodyId)
  return t !== undefined && (Date.now() - t) < withinMs
}

/** Milliseconds since the body was last triggered. Returns Infinity if never. */
export function getBodyTriggerAge(bodyId: string): number {
  const t = bodyTriggerTimes.get(bodyId)
  return t !== undefined ? Date.now() - t : Infinity
}

// ── Effector buses ─────────────────────────────────────────────────────────────
// Each effector body gets a wet-effect bus. Sample players send signal into it
// proportional to their distance from the effector body.
//
// Signal flow:
//   source player
//     └─ sendGain(proximity-based, 0→1)
//          └─ inputGain(1)
//               └─ effect (wet=1, pure processed)
//                    └─ outputGain(effBody.volume × !muted)   ← "sounds from the effector body"
//                         └─ Destination
//
// The effector body's own volume/mute scale outputGain, so the effected signal
// is conceptually "emitted" by the effector body — muting/quieting it silences
// all the wet output from that effector, while source bodies still play dry.

type EffectorEffect = Tone.Reverb | Tone.Freeverb | Tone.FeedbackDelay | Tone.Distortion | Tone.Chorus | Tone.Phaser | Tone.AutoFilter | Tone.BitCrusher | Tone.Gain

interface EffectorBus {
  inputGain:  Tone.Gain    // source signal enters here (send-level controlled)
  effect:     EffectorEffect // the active effect node (wet=1)
  outputGain: Tone.Gain    // scales final output by effector body's volume/mute
  effectType: string       // tracks which type is instantiated
  reverbMode: string       // 'convolution' | 'freeverb' — for reverb change detection
}

export interface EffectorBusParams {
  type: string
  // reverb / freeze
  decay?: number
  freezeDecay?: number
  reverbMode?: string   // 'convolution' (default) | 'freeverb'
  // delay
  delayTime?: number
  feedback?: number
  // distortion
  distortion?: number
  // chorus
  chorusFreq?: number
  chorusDepth?: number
  // phaser
  phaserRate?: number
  phaserOctaves?: number
  // autofilter
  autoFilterFreq?: number
  autoFilterDepth?: number
  autoFilterBaseFreq?: number
  // bitcrush
  bitDepth?: number
}

/** bodyId → effector bus */
const effectorBuses = new Map<string, EffectorBus>()

/** `${sampleId}:${effectorBodyId}` → send gain node */
const sendGains = new Map<string, Tone.Gain>()

/** bodyId → self-send gain from rack bus input → own effector bus input */
const selfSendGains = new Map<string, Tone.Gain>()

/**
 * `${sourceBodyId}:${effectorBodyId}` → send gain node
 * Routes source body's rack post-fader output into the effector body's effect input.
 * Unlike sendGains (which tap individual sample players), these tap the full rack bus
 * output — capturing all instrument layers (drone, FM, granular, etc.).
 */
const proximityRackSends = new Map<string, Tone.Gain>()

function destroyEffectNode(bus: EffectorBus) {
  try { bus.effect.disconnect(); bus.effect.dispose() } catch { /* noop */ }
  // Chorus and AutoFilter have internal clocks that need stopping
  if ((bus.effect as Tone.Chorus | Tone.AutoFilter).stop) {
    try { (bus.effect as Tone.Chorus | Tone.AutoFilter).stop() } catch { /* noop */ }
  }
}

/** Maps reverb decay time (s) to Freeverb roomSize (0–0.97). */
function decayToRoomSize(decay: number): number {
  // decay 0.5→0.45  /  2.5→0.58  /  7→0.72  /  15→0.97
  return Math.max(0.1, Math.min(0.97, 0.4 + (Math.min(decay, 15) / 15) * 0.57))
}

function createEffectNode(params: EffectorBusParams): EffectorEffect {
  switch (params.type) {
    case 'delay':
      return new Tone.FeedbackDelay({
        delayTime: safeDelayTime(params.delayTime),
        feedback:  safeDelayFeedback(params.feedback),
        maxDelay: 8,
        wet: 1,
      })
    case 'distortion':
      return new Tone.Distortion({ distortion: params.distortion ?? 0.4, wet: 1 })
    case 'chorus': {
      const chorus = new Tone.Chorus({
        frequency: params.chorusFreq  ?? 1.5,
        depth:     params.chorusDepth ?? 0.5,
        delayTime: 3.5,
        wet: 1,
      })
      chorus.start()
      return chorus
    }
    case 'phaser':
      return new Tone.Phaser({
        frequency:     params.phaserRate    ?? 0.5,
        octaves:       params.phaserOctaves ?? 3,
        baseFrequency: 400,
        wet: 1,
      })
    case 'autofilter': {
      const af = new Tone.AutoFilter({
        frequency:     params.autoFilterFreq    ?? 1.0,
        depth:         params.autoFilterDepth   ?? 1.0,
        baseFrequency: params.autoFilterBaseFreq ?? 200,
        wet: 1,
      })
      af.start()
      return af
    }
    case 'bitcrush':
      return new Tone.BitCrusher(Math.round(params.bitDepth ?? 8))
    case 'freeze':
      return new Tone.Reverb({ decay: params.freezeDecay ?? 30, preDelay: 0.1, wet: 1 })
    case 'microphone':
      // Pure passthrough mixer — no effect processing.
      // Input 1 (self-send) and Input 2 (proximity rack sends) are mixed
      // at inputGain and passed directly to outputGain → Destination.
      return new Tone.Gain(1)
    default: { // 'reverb'
      if ((params.reverbMode ?? 'convolution') === 'freeverb') {
        return new Tone.Freeverb({
          roomSize:   decayToRoomSize(params.decay ?? 2.5),
          dampening:  3000,
          wet: 1,
        })
      }
      return new Tone.Reverb({ decay: params.decay ?? 2.5, preDelay: 0.02, wet: 1 })
    }
  }
}

function safeDelayTime(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0.01, Math.min(7.5, value ?? 0.25)) : 0.25
}

function safeDelayFeedback(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(0.9, value ?? 0.4)) : 0.4
}

/**
 * Create (or update in-place) an effector bus for a body.
 * If the effect type changed, the old bus is torn down and recreated.
 */
export function ensureEffectorBus(bodyId: string, params: EffectorBusParams): void {
  const existing = effectorBuses.get(bodyId)

  if (existing) {
    const newReverbMode = params.reverbMode ?? 'convolution'
    const typeChanged   = existing.effectType !== params.type
    const reverbModeChanged = params.type === 'reverb' && existing.reverbMode !== newReverbMode
    if (typeChanged || reverbModeChanged) {
      // Type or reverb mode changed — destroy and recreate below
      destroyEffectNode(existing)
      try { existing.inputGain.disconnect();  existing.inputGain.dispose()  } catch { /* noop */ }
      try { existing.outputGain.disconnect(); existing.outputGain.dispose() } catch { /* noop */ }
      effectorBuses.delete(bodyId)
      // Disconnect all sends so they get recreated with the new bus
      for (const [key, gain] of sendGains) {
        if (key.endsWith(`:${bodyId}`)) {
          try { gain.disconnect(); gain.dispose() } catch { /* noop */ }
          sendGains.delete(key)
        }
      }
      // Disconnect self-send so it gets recreated with the new inputGain
      const oldSelfGain = selfSendGains.get(bodyId)
      if (oldSelfGain) {
        try { oldSelfGain.disconnect(); oldSelfGain.dispose() } catch { /* noop */ }
        selfSendGains.delete(bodyId)
      }
      // Disconnect proximity rack sends so they reconnect to the new inputGain
      for (const [key, gain] of proximityRackSends) {
        if (key.endsWith(`:${bodyId}`)) {
          try { gain.disconnect(); gain.dispose() } catch { /* noop */ }
          proximityRackSends.delete(key)
        }
      }
    } else {
      // Same type — update params in-place
      const fx = existing.effect
      switch (params.type) {
        case 'reverb':
          if ((existing.reverbMode ?? 'convolution') === 'freeverb') {
            if (params.decay !== undefined) {
              const rs = decayToRoomSize(params.decay)
              if (Math.abs((fx as Tone.Freeverb).roomSize.value - rs) > 0.01) {
                ;(fx as Tone.Freeverb).roomSize.rampTo(rs, 0.1)
              }
            }
          } else {
            if (params.decay !== undefined && Math.abs((fx as Tone.Reverb).decay as number - params.decay) > 0.05)
              (fx as Tone.Reverb).decay = params.decay
          }
          break
        case 'delay':
          if (params.delayTime !== undefined) {
            const delay = safeDelayTime(params.delayTime)
            if (Math.abs(Number((fx as Tone.FeedbackDelay).delayTime.value) - delay) > 0.01) {
              ;(fx as Tone.FeedbackDelay).delayTime.rampTo(delay, 0.08)
            }
          }
          if (params.feedback !== undefined) {
            const feedback = safeDelayFeedback(params.feedback)
            if (Math.abs((fx as Tone.FeedbackDelay).feedback.value - feedback) > 0.01) {
              ;(fx as Tone.FeedbackDelay).feedback.rampTo(feedback, 0.08)
            }
          }
          break
        case 'distortion':
          if (params.distortion !== undefined) (fx as Tone.Distortion).distortion = params.distortion
          break
        case 'chorus':
          if (params.chorusFreq   !== undefined) (fx as Tone.Chorus).frequency.value = params.chorusFreq
          if (params.chorusDepth  !== undefined) (fx as Tone.Chorus).depth           = params.chorusDepth
          break
        case 'phaser':
          if (params.phaserRate    !== undefined) (fx as Tone.Phaser).frequency.value = params.phaserRate
          if (params.phaserOctaves !== undefined) (fx as Tone.Phaser).octaves         = params.phaserOctaves
          break
        case 'autofilter':
          if (params.autoFilterFreq   !== undefined) (fx as Tone.AutoFilter).frequency.value = params.autoFilterFreq
          if (params.autoFilterDepth  !== undefined) {
            ;(fx as Tone.AutoFilter).depth.rampTo(params.autoFilterDepth, 0.1)
          }
          break
        case 'bitcrush':
          if (params.bitDepth !== undefined) {
            ;(fx as Tone.BitCrusher).bits.rampTo(Math.round(params.bitDepth), 0.1)
          }
          break
        case 'freeze':
          // Freeze reverb decay is baked at creation — no live update needed
          break
        case 'microphone':
          // Passthrough — no parameters to update
          break
      }
      return
    }
  }

  // Create new bus: inputGain → effect → outputGain → Destination
  const inputGain  = new Tone.Gain(1)
  const effect     = createEffectNode(params)
  const outputGain = new Tone.Gain(1)   // controlled by effector body volume/mute
  inputGain.connect(effect)
  effect.connect(outputGain)
  outputGain.toDestination()
  effectorBuses.set(bodyId, { inputGain, effect, outputGain, effectType: params.type, reverbMode: params.reverbMode ?? 'convolution' })
}

/** Tear down an effector bus and all its send connections. */
export function destroyEffectorBus(bodyId: string): void {
  // Disconnect all sends pointing at this bus
  for (const [key, gain] of sendGains) {
    if (key.endsWith(`:${bodyId}`)) {
      try { gain.disconnect(); gain.dispose() } catch { /* noop */ }
      sendGains.delete(key)
    }
  }
  // Disconnect self-send from rack bus
  const selfGain = selfSendGains.get(bodyId)
  if (selfGain) {
    try { selfGain.disconnect(); selfGain.dispose() } catch { /* noop */ }
    selfSendGains.delete(bodyId)
  }
  // Disconnect all proximity rack sends pointing at this bus
  for (const [key, gain] of proximityRackSends) {
    if (key.endsWith(`:${bodyId}`)) {
      try { gain.disconnect(); gain.dispose() } catch { /* noop */ }
      proximityRackSends.delete(key)
    }
  }
  const bus = effectorBuses.get(bodyId)
  if (!bus) return
  try { bus.inputGain.disconnect();  bus.inputGain.dispose()  } catch { /* noop */ }
  destroyEffectNode(bus)
  try { bus.outputGain.disconnect(); bus.outputGain.dispose() } catch { /* noop */ }
  effectorBuses.delete(bodyId)
}

/**
 * Set the output gain of an effector bus — controls how loud the
 * processed ("wet") signal is at destination.
 * Call every frame with:  effBody.muted ? 0 : (effBody.volume ?? 1)
 * This makes the effector body's own mute/volume govern the effect output,
 * i.e. the effected sounds "come from" the effector body.
 */
export function setEffectorOutputGain(bodyId: string, gain: number): void {
  const bus = effectorBuses.get(bodyId)
  if (!bus) return
  bus.outputGain.gain.rampTo(Math.max(0, Math.min(1, gain)), 0.05)
}

/**
 * Route a fraction of sampleId's player output into the effector bus.
 * Creates the send gain lazily if the player already exists.
 * Safe to call even before the player is created — silently does nothing until it exists.
 */
export function setPlayerEffectorSend(sampleId: string, effectorBodyId: string, wetLevel: number): void {
  const bus    = effectorBuses.get(effectorBodyId)
  const ampEnv = sampleAmpEnvs.get(sampleId)
  if (!bus || !ampEnv) return
  const source = samplePitchShifts.get(sampleId) ?? ampEnv

  const key = `${sampleId}:${effectorBodyId}`
  let sendGain = sendGains.get(key)
  if (!sendGain) {
    sendGain = new Tone.Gain(0)
    source.connect(sendGain)   // post-envelope/pitch so ADSR and pitch mode shape wet signal too
    sendGain.connect(bus.inputGain)
    sendGains.set(key, sendGain)
  }
  sendGain.gain.rampTo(Math.max(0, Math.min(1, wetLevel)), 0.04)
}

/** Fade the send gain for a sampleId→effector pair to zero. */
export function clearPlayerEffectorSend(sampleId: string, effectorBodyId: string): void {
  const key = `${sampleId}:${effectorBodyId}`
  const sendGain = sendGains.get(key)
  if (sendGain) sendGain.gain.rampTo(0, 0.1)
}

/**
 * Route the body's own rack bus input into its own effector bus.
 * This allows the body's instruments to be processed by its own effector.
 * Call every frame (or whenever ensureEffectorBus is called) with wetLevel = 1.0.
 */
export function setBodySelfEffectorSend(bodyId: string, wetLevel: number): void {
  const bus = effectorBuses.get(bodyId)
  if (!bus) return

  let selfGain = selfSendGains.get(bodyId)
  if (!selfGain) {
    // getBusInputNode returns a raw Web Audio GainNode.
    // Connect it to a Tone.Gain which then feeds into the effector bus.
    const rackInput = getBusInputNode(bodyId)
    selfGain = new Tone.Gain(0)
    // raw GainNode → Tone.Gain: connect via .input (same pattern as rackBusMixer)
    rackInput.connect(selfGain.input as unknown as AudioNode)
    selfGain.connect(bus.inputGain)
    selfSendGains.set(bodyId, selfGain)
  }
  selfGain.gain.rampTo(Math.max(0, Math.min(1, wetLevel)), 0.04)
}

/** Fade the self-send for a body to zero and dispose. */
export function clearBodySelfEffectorSend(bodyId: string): void {
  const selfGain = selfSendGains.get(bodyId)
  if (!selfGain) return
  selfGain.gain.rampTo(0, 0.1)
  selfSendGains.delete(bodyId)
  window.setTimeout(() => {
    try { selfGain.disconnect(); selfGain.dispose() } catch { /* noop */ }
  }, 200)
}

/**
 * Route a fraction of sourceBodyId's rack post-fader output into effectorBodyId's effect input.
 * This captures all instrument-layer output (drone, FM, granular, etc.) from the source body.
 * Call every frame for bodies within the effector's pickup distance.
 */
export function setBodyProximityRackSend(sourceBodyId: string, effectorBodyId: string, sendLevel: number): void {
  const bus = effectorBuses.get(effectorBodyId)
  if (!bus) return

  const key = `${sourceBodyId}:${effectorBodyId}`
  let sendGain = proximityRackSends.get(key)
  if (!sendGain) {
    // getBusPostFaderNode may return null if the source has no rack bus yet — skip silently
    const rackFader = getBusPostFaderNode(sourceBodyId)
    if (!rackFader) return
    sendGain = new Tone.Gain(0)
    // raw GainNode → Tone.Gain bridging (same pattern as rackBusMixer)
    rackFader.connect(sendGain.input as unknown as AudioNode)
    sendGain.connect(bus.inputGain)
    proximityRackSends.set(key, sendGain)
  }
  sendGain.gain.rampTo(Math.max(0, Math.min(1, sendLevel)), 0.04)
}

/**
 * Fade the proximity rack send from sourceBodyId → effectorBodyId to zero.
 * Call when the source body moves out of the effector's pickup range.
 */
export function clearBodyProximityRackSend(sourceBodyId: string, effectorBodyId: string): void {
  const key = `${sourceBodyId}:${effectorBodyId}`
  const sendGain = proximityRackSends.get(key)
  if (sendGain) sendGain.gain.rampTo(0, 0.1)
}

/** Dispose all send gains that belong to a sample (called when player is deleted). */
function disposeSampleSendGains(sampleId: string): void {
  for (const [key, gain] of sendGains) {
    if (key.startsWith(`${sampleId}:`)) {
      try { gain.disconnect(); gain.dispose() } catch { /* noop */ }
      sendGains.delete(key)
    }
  }
}

export interface TriggerSoundOptions {
  startSeconds?: number
  playbackRate?: number
  volume?: number
  adsr?: AdsrEnvelope
  overlap?: boolean
  pan?: number
  detuneCents?: number
}

function applyAdsr(sampleId: string, adsr?: AdsrEnvelope): void {
  if (!adsr) return
  const env = sampleAmpEnvs.get(sampleId)
  if (!env) return
  env.attack = adsr.attack
  env.decay = adsr.decay
  env.sustain = adsr.sustain
  env.release = adsr.release
}

function applyAdsrToEnv(env: Tone.AmplitudeEnvelope, adsr?: AdsrEnvelope): void {
  const next = adsr ?? globalAdsr
  env.attack = next.attack
  env.decay = next.decay
  env.sustain = next.sustain
  env.release = next.release
}

function clampDetuneCents(detuneCents: number): number {
  return Math.max(-2400, Math.min(2400, Number.isFinite(detuneCents) ? detuneCents : 0))
}

function triggerLayeredSample(sample: SampleAsset, options: TriggerSoundOptions): void {
  if (!sample.objectUrl) return
  const player = new Tone.Player({ autostart: false })
  const env = new Tone.AmplitudeEnvelope({
    attack: 0,
    decay: 0,
    sustain: 1,
    release: 0,
  })
  const panner = new Tone.Panner(Math.max(-1, Math.min(1, options.pan ?? 0))).toDestination()
  const pitchShift = new Tone.PitchShift({ pitch: clampDetuneCents(options.detuneCents ?? 0) / 100 })
  applyAdsrToEnv(env, options.adsr)
  player.connect(env)
  env.connect(pitchShift)
  pitchShift.connect(panner)
  player.playbackRate = Math.max(0.1, options.playbackRate ?? 1)
  player.volume.value = Tone.gainToDb(Math.max(0, Math.min(1, options.volume ?? 0.85)))
  player.load(sample.objectUrl).then(() => {
    const now = Tone.now()
    const duration = player.buffer.duration
    const offset = Math.max(0, Math.min(options.startSeconds ?? 0, Math.max(0, duration - 0.001)))
    env.triggerAttack(now)
    player.start(now, offset)
    const remaining = Math.max(0.02, (duration - offset) / player.playbackRate)
    const releaseAt = now + remaining
    env.triggerRelease(releaseAt)
    const releaseSeconds = typeof env.release === 'number' ? env.release : Number(env.release) || 0
    window.setTimeout(() => {
      try { player.stop() } catch { /* noop */ }
      try { player.dispose() } catch { /* noop */ }
      try { env.dispose() } catch { /* noop */ }
      try { pitchShift.dispose() } catch { /* noop */ }
      try { panner.dispose() } catch { /* noop */ }
    }, Math.ceil((remaining + releaseSeconds + 0.2) * 1000))
  }).catch(() => {
    try { player.dispose() } catch { /* noop */ }
    try { env.dispose() } catch { /* noop */ }
    try { pitchShift.dispose() } catch { /* noop */ }
    try { panner.dispose() } catch { /* noop */ }
  })
}

// Called when orbit dot / way scanner / point enters a geometry.
// If the target geometry has no sample assigned, plays nothing.
export function triggerIntersectionSound(
  sourceGeom: GeometryObject,
  targetGeom: GeometryObject,
  samples: SampleAsset[] = [],
  options: TriggerSoundOptions = {},
) {
  if (Tone.getContext().state !== 'running') return
  const sample = targetGeom.sampleId ? samples.find(s => s.id === targetGeom.sampleId) : null
  if (!sample) return  // no sample assigned → silent
  try {
    triggerSample(sample, sourceGeom, targetGeom, options)
  } catch { /* ignore stale context */ }
}

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)))
  return outMin + t * (outMax - outMin)
}

function triggerSample(sample: SampleAsset, sourceGeom: GeometryObject, targetGeom: GeometryObject, options: TriggerSoundOptions) {
  const player = getSamplePlayer(sample)
  const rA = (sourceGeom.params.r as number) ?? (sourceGeom.params.size as number) ?? 100
  const rB = (targetGeom.params.r as number) ?? (targetGeom.params.size as number) ?? 100
  player.playbackRate = options.playbackRate ?? mapRange(rA, 10, 320, 1.75, 0.45)
  setPlayerDetune(sample.id, options.detuneCents ?? 0)
  player.volume.value = Tone.gainToDb(options.volume ?? mapRange(rB, 10, 320, 0.35, 0.95))
  if (player.loaded) {
    const now = Tone.now()
    try { player.stop(now) } catch { /* ignore if not started */ }
    const duration = player.buffer.duration
    const offset = Math.max(0, Math.min(options.startSeconds ?? 0, Math.max(0, duration - 0.001)))
    player.start(now, offset)
    playerStartInfo.set(sample.id, { toneTime: now, offset })
  }
}

function getSamplePlayer(sample: SampleAsset): Tone.Player {
  if (!sample.objectUrl) throw new Error(`Sample "${sample.name}" is not loaded`)
  const cached = samplePlayers.get(sample.id)
  const cachedUrl = samplePlayerUrls.get(sample.id)
  if (cached && cachedUrl === sample.objectUrl) return cached
  if (cached) {
    try { cached.stop(); cached.dispose() } catch { /* ignore stale player */ }
    samplePlayers.delete(sample.id)
    samplePlayerUrls.delete(sample.id)
    playerStartInfo.delete(sample.id)
    const oldEnv = sampleAmpEnvs.get(sample.id)
    if (oldEnv) { try { oldEnv.dispose() } catch { /* noop */ } sampleAmpEnvs.delete(sample.id) }
    const oldPitchShift = samplePitchShifts.get(sample.id)
    if (oldPitchShift) { try { oldPitchShift.dispose() } catch { /* noop */ } samplePitchShifts.delete(sample.id) }
    const oldPanner = samplePanners.get(sample.id)
    if (oldPanner) { try { oldPanner.dispose() } catch { /* noop */ } samplePanners.delete(sample.id) }
  }

  const player = new Tone.Player({ url: sample.objectUrl, autostart: false })
  const ampEnv = new Tone.AmplitudeEnvelope({
    attack:  globalAdsr.attack,
    decay:   globalAdsr.decay,
    sustain: globalAdsr.sustain,
    release: globalAdsr.release,
  })
  const pitchShift = new Tone.PitchShift({ pitch: 0, windowSize: 0.08 })
  const panner = new Tone.Panner(0).toDestination()
  player.connect(ampEnv)
  ampEnv.connect(pitchShift)
  pitchShift.connect(panner)
  // Trigger immediately so the envelope is in sustain (open) until explicitly controlled
  ampEnv.triggerAttack(Tone.now())
  samplePlayers.set(sample.id, player)
  sampleAmpEnvs.set(sample.id, ampEnv)
  samplePitchShifts.set(sample.id, pitchShift)
  samplePanners.set(sample.id, panner)
  samplePlayerUrls.set(sample.id, sample.objectUrl)
  return player
}

/**
 * Directly trigger a sample asset without any geometry context.
 * Used by PlanetCanvas for body-rendezvous sounds.
 */
export function triggerBodySound(
  sample: SampleAsset,
  options: TriggerSoundOptions = {},
) {
  if (Tone.getContext().state !== 'running') return
  if (!sample?.objectUrl) return
  try {
    if (options.overlap) {
      triggerLayeredSample(sample, options)
      return
    }
    const player = getSamplePlayer(sample)
    const ampEnv = sampleAmpEnvs.get(sample.id)
    applyAdsr(sample.id, options.adsr)
    setPlayerPan(sample.id, options.pan ?? 0, 0)
    setPlayerDetune(sample.id, options.detuneCents ?? 0)
    player.playbackRate = Math.max(0.1, options.playbackRate ?? 1)
    player.volume.value = Tone.gainToDb(Math.max(0, Math.min(1, options.volume ?? 0.85)))
    if (player.loaded) {
      const now = Tone.now()
      try { player.stop(now) } catch { /* ignore if not started */ }
      if (ampEnv) {
        try { ampEnv.triggerRelease(now) } catch { /* noop */ }
        ampEnv.triggerAttack(now + 0.002)
      }
      const duration = player.buffer.duration
      const offset = Math.max(0, Math.min(options.startSeconds ?? 0, Math.max(0, duration - 0.001)))
      player.start(now, offset)
      playerStartInfo.set(sample.id, { toneTime: now, offset })
    }
  } catch { /* ignore stale context */ }
}

export function disposeIntersectionSynth() {
  // Dispose send gains
  for (const gain of sendGains.values()) { try { gain.dispose() } catch { /* noop */ } }
  sendGains.clear()
  // Dispose self-send gains
  for (const gain of selfSendGains.values()) { try { gain.disconnect(); gain.dispose() } catch { /* noop */ } }
  selfSendGains.clear()
  // Dispose proximity rack send gains
  for (const gain of proximityRackSends.values()) { try { gain.disconnect(); gain.dispose() } catch { /* noop */ } }
  proximityRackSends.clear()
  // Dispose effector buses
  for (const bus of effectorBuses.values()) {
    try { bus.inputGain.dispose()  } catch { /* noop */ }
    destroyEffectNode(bus)
    try { bus.outputGain.dispose() } catch { /* noop */ }
  }
  effectorBuses.clear()
  // Dispose players + envelopes
  samplePlayers.forEach(player => { try { player.dispose() } catch { /* noop */ } })
  sampleAmpEnvs.forEach(env    => { try { env.dispose()    } catch { /* noop */ } })
  samplePitchShifts.forEach(pitchShift => { try { pitchShift.dispose() } catch { /* noop */ } })
  samplePanners.forEach(panner => { try { panner.dispose() } catch { /* noop */ } })
  samplePlayers.clear()
  sampleAmpEnvs.clear()
  samplePitchShifts.clear()
  samplePanners.clear()
  samplePlayerUrls.clear()
  playerStartInfo.clear()
}

export function stopIntersectionSamples() {
  const now = Tone.now()
  samplePlayers.forEach(player => {
    try { player.stop(now) } catch { /* ignore if not started */ }
  })
  playerStartInfo.clear()
}

export async function prepareIntersectionSamples(samples: SampleAsset[]): Promise<void> {
  for (const sample of samples) {
    if (!sample.objectUrl) continue
    try { getSamplePlayer(sample) } catch { /* skip unloaded/missing samples */ }
  }
  await Tone.loaded()
}

export function forgetSamplePlayers(sampleIds?: string[]): void {
  const ids = sampleIds ?? Array.from(samplePlayers.keys())
  for (const id of ids) {
    disposeSampleSendGains(id)
    const player = samplePlayers.get(id)
    if (player) { try { player.stop(); player.dispose() } catch { /* noop */ } }
    const env = sampleAmpEnvs.get(id)
    if (env) { try { env.dispose() } catch { /* noop */ } }
    const pitchShift = samplePitchShifts.get(id)
    if (pitchShift) { try { pitchShift.dispose() } catch { /* noop */ } }
    const panner = samplePanners.get(id)
    if (panner) { try { panner.dispose() } catch { /* noop */ } }
    samplePlayers.delete(id)
    sampleAmpEnvs.delete(id)
    samplePitchShifts.delete(id)
    samplePanners.delete(id)
    samplePlayerUrls.delete(id)
    playerStartInfo.delete(id)
  }
}

// ── Standpoint zone: looping proximity sound ──────────────────────────────────

/**
 * Start a sample in looping mode for standpoint-distance proximity.
 * If the player is already looping, just updates the volume.
 */
export function startStandpointSound(sample: SampleAsset, volume: number, playbackRate = 1, adsr?: AdsrEnvelope, pan = 0): void {
  if (Tone.getContext().state !== 'running') return
  if (!sample?.objectUrl) return
  try {
    const player = getSamplePlayer(sample)
    const ampEnv = sampleAmpEnvs.get(sample.id)
    applyAdsr(sample.id, adsr)
    setPlayerPan(sample.id, pan)
    const vol = Math.max(0.0001, Math.min(1, volume))
    player.volume.value = Tone.gainToDb(vol)
    player.playbackRate = Math.max(0.001, playbackRate)
    if (player.state !== 'started') {
      player.loop = true
      const now = Tone.now()
      if (player.loaded) {
        player.start(now, 0)
        if (ampEnv) { try { ampEnv.triggerAttack(now) } catch { /* noop */ } }
        playerStartInfo.set(sample.id, { toneTime: now, offset: 0 })
      }
    }
  } catch { /* noop */ }
}

export function setPlayerPan(sampleId: string, pan: number, rampTime = 0.05): void {
  const panner = samplePanners.get(sampleId)
  if (!panner) return
  panner.pan.rampTo(Math.max(-1, Math.min(1, pan)), rampTime)
}

/** Stop a standpoint-zone looping sample, applying the ADSR release curve. */
export function stopStandpointSound(sampleId: string): void {
  const player = samplePlayers.get(sampleId)
  if (!player) return
  const ampEnv = sampleAmpEnvs.get(sampleId)
  player.loop = false
  const now = Tone.now()
  if (ampEnv) {
    try { ampEnv.triggerRelease(now) } catch { /* noop */ }
    try { player.stop(now + globalAdsr.release + 0.05) } catch { /* noop */ }
  } else {
    try { player.stop(now) } catch { /* noop */ }
  }
  playerStartInfo.delete(sampleId)
}

/** Returns the buffer duration of a loaded sample (0 if not loaded). */
export function getPlayerDuration(sampleId: string): number {
  const player = samplePlayers.get(sampleId)
  if (!player || !player.loaded) return 0
  return player.buffer.duration
}

/** Immediately set the playback rate of a player (used by orbit-stretch). */
export function setPlayerRate(sampleId: string, rate: number): void {
  const player = samplePlayers.get(sampleId)
  if (!player) return
  player.playbackRate = Math.max(0.001, Math.min(4, rate))
}

/**
 * Set detune on a player in cents.
 * Used for pitch correction: detune = -1200 * log2(rate) cancels the pitch shift
 * introduced by a playbackRate change, keeping the perceived pitch constant.
 */
export function setPlayerDetune(sampleId: string, detuneCents: number): void {
  const pitchShift = samplePitchShifts.get(sampleId)
  if (!pitchShift) return
  pitchShift.pitch = clampDetuneCents(detuneCents) / 100
}

/** Stop every currently-looping player (called when leaving standpoint mode). */
export function stopAllLoopingPlayers(): void {
  const now = Tone.now()
  samplePlayers.forEach(player => {
    if (player.loop) {
      player.loop = false
      try { player.stop(now) } catch { /* noop */ }
    }
  })
  playerStartInfo.clear()
}

/** Smoothly ramp the volume of a currently-playing player. */
export function setPlayerVolume(sampleId: string, volume: number): void {
  const player = samplePlayers.get(sampleId)
  if (!player || player.state !== 'started') return
  player.volume.rampTo(Tone.gainToDb(Math.max(0.0001, Math.min(1, volume))), 0.05)
}

/**
 * Returns current playback position and volume for the inspector.
 * Returns null if the sample has no player or is not playing.
 */
export function getPlayerState(sampleId: string): { currentTime: number; volume: number; playbackRate: number } | null {
  const player = samplePlayers.get(sampleId)
  if (!player || player.state !== 'started') return null
  const info = playerStartInfo.get(sampleId)
  const elapsed = info ? Tone.now() - info.toneTime + info.offset : 0
  const duration = player.loaded ? player.buffer.duration : 1
  const currentTime = player.loop
    ? elapsed % Math.max(0.001, duration)
    : Math.min(elapsed, duration)
  return {
    currentTime: Math.max(0, currentTime),
    volume: Math.max(0, Math.min(1, Tone.dbToGain(player.volume.value))),
    playbackRate: player.playbackRate,
  }
}

// ── Master volume ─────────────────────────────────────────────────────────────

/** Set the Tone.js master destination volume (0–1 linear). */
export function setMasterVolume(vol: number): void {
  Tone.getDestination().volume.rampTo(
    Tone.gainToDb(Math.max(0.0001, Math.min(1, vol))),
    0.05,
  )
}

/** Get the current master volume as a 0–1 linear value. */
export function getMasterVolume(): number {
  return Tone.dbToGain(Tone.getDestination().volume.value)
}

// Flash the target circle in the SVG DOM
export function flashCircleElement(geomId: string) {
  const el = document.getElementById(`geom-circle-${geomId}`)
  if (!el) return
  el.setAttribute('stroke', '#60a5fa')
  el.setAttribute('stroke-width', '3')
  setTimeout(() => {
    el.setAttribute('stroke', 'rgba(20,20,20,0.75)')
    el.setAttribute('stroke-width', '1.5')
  }, 280)
}
