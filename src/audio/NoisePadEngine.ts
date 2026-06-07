// ── NoisePadEngine ─────────────────────────────────────────────────────────────
// Resonant noise drone using the Web Audio API.
// Uses the shared Tone.js AudioContext so it can connect to the rack bus.
// Brown noise through a slowly-sweeping resonant bandpass filter creates
// wind, breath, and atmospheric pad textures.
//
// Signal flow:
//   BrownNoise (buffer trick) → BandpassFilter → LFO(filter freq)
//   BandpassFilter → Master(gain) → Dry → Reverb → Wet → BodyOut
//   BodyOut is unconnected — caller wires to rack bus.

import * as Tone from 'tone'

export interface NoisePadParams {
  volume:    number   // 0–1
  freq:      number   // bandpass center Hz (100–4000)
  q:         number   // filter resonance (0.5–20)
  attack:    number   // fade-in seconds
  release:   number   // fade-out seconds
  reverbMix: number   // 0–1
  motion:    number   // LFO modulation depth (0–1)
}

function makeImpulseResponse(ctx: AudioContext, duration = 12, decay = 4): AudioBuffer {
  const length  = Math.floor(ctx.sampleRate * duration)
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
    }
  }
  return impulse
}

/** Create a stereo brown-noise buffer loop. */
function makeBrownNoiseBuffer(ctx: AudioContext, durationSecs = 4): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * durationSecs)
  const buf    = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    let lastOut = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      lastOut = (lastOut + 0.02 * white) / 1.02
      data[i] = lastOut * 3.5  // scale up a bit
    }
  }
  return buf
}

export class NoisePadEngine {
  private ctx:      AudioContext      | null = null
  private noise:    AudioBufferSourceNode | null = null
  private filter:   BiquadFilterNode  | null = null
  private master:   GainNode          | null = null
  private bodyOut:  GainNode          | null = null
  private panner:   StereoPannerNode  | null = null
  private dry:      GainNode          | null = null
  private wet:      GainNode          | null = null
  private reverb:   ConvolverNode     | null = null
  private lfo:      OscillatorNode    | null = null
  private lfoGain:  GainNode          | null = null
  private noiseBuffer: AudioBuffer    | null = null

  private outputVolumeScale = 1
  private outputPan         = 0

  isPlaying = false

  params: NoisePadParams = {
    volume:    0.3,
    freq:      600,
    q:         8,
    attack:    3.0,
    release:   6.0,
    reverbMix: 0.6,
    motion:    0.4,
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  private async init(): Promise<void> {
    if (this.ctx) return
    await Tone.start()
    this.ctx = Tone.getContext().rawContext as AudioContext

    this.noiseBuffer = makeBrownNoiseBuffer(this.ctx)

    this.filter = this.ctx.createBiquadFilter()
    this.filter.type = 'bandpass'
    this.filter.frequency.value = this.params.freq
    this.filter.Q.value = this.params.q

    this.master = this.ctx.createGain()
    this.master.gain.value = 0

    this.bodyOut = this.ctx.createGain()
    this.bodyOut.gain.value = this.outputVolumeScale

    this.panner = this.ctx.createStereoPanner()
    this.panner.pan.value = this.outputPan

    this.dry    = this.ctx.createGain()
    this.wet    = this.ctx.createGain()
    this.reverb = this.ctx.createConvolver()
    this.reverb.buffer = makeImpulseResponse(this.ctx)

    const p = this.params
    this.dry.gain.value = 1 - p.reverbMix
    this.wet.gain.value = p.reverbMix

    this.filter.connect(this.master)
    this.master.connect(this.dry);    this.dry.connect(this.bodyOut)
    this.master.connect(this.reverb); this.reverb.connect(this.wet); this.wet.connect(this.bodyOut)
    this.bodyOut.connect(this.panner)
    // panner is intentionally left unconnected here.
    // The layer component connects it to the rack bus via getBusInputNode().
  }

  async start(): Promise<void> {
    await this.init()
    if (!this.ctx || !this.master || !this.filter || !this.noiseBuffer) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (this.isPlaying) return

    const now = this.ctx.currentTime
    const p   = this.params

    // Noise source (looping buffer)
    this.noise = this.ctx.createBufferSource()
    this.noise.buffer = this.noiseBuffer
    this.noise.loop   = true
    this.noise.connect(this.filter)
    this.noise.start(now)

    // Filter sweep LFO
    this.lfo     = this.ctx.createOscillator()
    this.lfoGain = this.ctx.createGain()
    this.lfo.type = 'sine'
    this.lfo.frequency.value = 0.02 + p.motion * 0.08
    this.lfoGain.gain.value  = p.freq * p.motion * 0.5
    this.lfo.connect(this.lfoGain)
    this.lfoGain.connect(this.filter.frequency)
    this.lfo.start(now)

    // Attack — use setTargetAtTime so later setParams volume changes aren't blocked
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(0.0001, now)
    this.master.gain.setTargetAtTime(p.volume, now, Math.max(0.1, p.attack / 3))

    this.isPlaying = true
  }

  stop(): void {
    if (!this.ctx || !this.master || !this.isPlaying) return
    const now = this.ctx.currentTime
    const end = now + this.params.release

    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(Math.max(this.master.gain.value, 0.0001), now)
    this.master.gain.exponentialRampToValueAtTime(0.0001, end)

    try { this.noise?.stop(end + 0.1) } catch { /* noop */ }
    try { this.lfo?.stop(end + 0.1)   } catch { /* noop */ }

    setTimeout(() => {
      this.noise   = null
      this.lfo     = null
      this.lfoGain = null
      this.isPlaying = false
    }, (this.params.release + 0.3) * 1000)
  }

  // ── Parameter updates ─────────────────────────────────────────────────────────

  setParams(patch: Partial<NoisePadParams>): void {
    this.params = { ...this.params, ...patch }
    if (!this.ctx || !this.isPlaying) return
    const now = this.ctx.currentTime
    const p   = this.params

    if (this.master) this.master.gain.setTargetAtTime(p.volume, now, 0.8)
    if (this.filter) {
      this.filter.frequency.setTargetAtTime(p.freq, now, 1.0)
      this.filter.Q.setTargetAtTime(p.q, now, 1.0)
    }
    if (this.lfoGain) {
      this.lfoGain.gain.setTargetAtTime(p.freq * p.motion * 0.5, now, 0.8)
    }
    if (this.lfo) {
      this.lfo.frequency.setTargetAtTime(0.02 + p.motion * 0.08, now, 0.8)
    }
    if (this.dry) this.dry.gain.setTargetAtTime(1 - p.reverbMix, now, 0.8)
    if (this.wet) this.wet.gain.setTargetAtTime(p.reverbMix, now, 0.8)
  }

  /** Return the final output node to connect to a rack bus input. */
  getOutputNode(): AudioNode { return this.panner! }

  setOutputSpatial(volumeScale: number, pan = 0): void {
    this.outputVolumeScale = Math.max(0, Math.min(1, Number.isFinite(volumeScale) ? volumeScale : 1))
    this.outputPan = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0))
    if (!this.ctx) return
    const now = this.ctx.currentTime
    this.bodyOut?.gain.setTargetAtTime(this.outputVolumeScale, now, 0.08)
    this.panner?.pan.setTargetAtTime(this.outputPan, now, 0.08)
  }
}
