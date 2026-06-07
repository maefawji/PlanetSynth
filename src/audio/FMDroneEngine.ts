// ── FMDroneEngine ──────────────────────────────────────────────────────────────
// 2-operator FM synthesis drone using the Web Audio API.
// Uses the shared Tone.js AudioContext so it can connect to the rack bus.
// Creates metallic, bell-like, or glassy timbres modulated by orbital mechanics.
//
// Signal flow:
//   ModOsc → ModGain(index × carrierFreq) → CarrierOsc.frequency
//   CarrierOsc → CarrierGain → LowpassFilter → DryGain ─────── → Master
//                                             → Reverb → WetGain → Master
//   Master → Panner → BodyOut  (unconnected — caller wires to rack bus)

import * as Tone from 'tone'

export interface FMDroneParams {
  rootFreq:   number   // carrier base frequency Hz
  ratio:      number   // modulator/carrier ratio (0.5–8)
  index:      number   // FM index — modulation depth = index × rootFreq (0–8)
  volume:     number   // 0–1
  brightness: number   // post lowpass cutoff Hz (200–8000)
  attack:     number   // gain envelope attack seconds
  release:    number   // gain envelope release seconds
  reverbMix:  number   // 0–1
}

const NOTE_MAP: Record<string, number> = {
  C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,
}

function noteToFreq(note: string): number {
  const m = note.match(/^([A-G][b#]?)(-?\d)$/)
  if (!m) return 110
  const midi = 12 * (Number(m[2]) + 1) + (NOTE_MAP[m[1]] ?? 0)
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function makeImpulseResponse(ctx: AudioContext, duration = 14, decay = 4.5): AudioBuffer {
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

export class FMDroneEngine {
  private ctx:       AudioContext      | null = null
  private master:    GainNode          | null = null
  private bodyOut:   GainNode          | null = null
  private panner:    StereoPannerNode  | null = null
  private filter:    BiquadFilterNode  | null = null
  private carrier:   OscillatorNode    | null = null
  private modulator: OscillatorNode    | null = null
  private modGain:   GainNode          | null = null
  private carGain:   GainNode          | null = null
  private dry:       GainNode          | null = null
  private wet:       GainNode          | null = null
  private reverb:    ConvolverNode     | null = null
  private lfo:       OscillatorNode    | null = null
  private lfoGain:   GainNode          | null = null

  private outputVolumeScale = 1
  private outputPan         = 0

  isPlaying = false

  params: FMDroneParams = {
    rootFreq:   110,
    ratio:      3,
    index:      3,
    volume:     0.35,
    brightness: 2000,
    attack:     4.0,
    release:    8.0,
    reverbMix:  0.5,
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  private async init(): Promise<void> {
    if (this.ctx) return
    await Tone.start()
    this.ctx    = Tone.getContext().rawContext as AudioContext
    this.master = this.ctx.createGain()
    this.master.gain.value = 0
    this.bodyOut = this.ctx.createGain()
    this.bodyOut.gain.value = this.outputVolumeScale
    this.panner = this.ctx.createStereoPanner()
    this.panner.pan.value = this.outputPan

    this.filter = this.ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = this.params.brightness
    this.filter.Q.value = 0.8

    this.dry    = this.ctx.createGain()
    this.wet    = this.ctx.createGain()
    this.reverb = this.ctx.createConvolver()
    this.reverb.buffer = makeImpulseResponse(this.ctx)

    const p = this.params
    this.dry.gain.value = 1 - p.reverbMix
    this.wet.gain.value = p.reverbMix

    this.filter.connect(this.dry);    this.dry.connect(this.master)
    this.filter.connect(this.reverb); this.reverb.connect(this.wet); this.wet.connect(this.master)
    this.master.connect(this.panner)
    this.panner.connect(this.bodyOut)
    // bodyOut is intentionally left unconnected here.
    // The layer component connects it to the rack bus via getBusInputNode().
  }

  async start(): Promise<void> {
    await this.init()
    if (!this.ctx || !this.master || !this.filter) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (this.isPlaying) return

    const now = this.ctx.currentTime
    const p   = this.params

    // ── Carrier oscillator ─────────────────────────────────────────────────
    this.carrier  = this.ctx.createOscillator()
    this.carGain  = this.ctx.createGain()
    this.carrier.type = 'sine'
    this.carrier.frequency.value = p.rootFreq
    this.carGain.gain.value = 0.7
    this.carrier.connect(this.carGain)
    this.carGain.connect(this.filter)

    // ── Modulator oscillator ───────────────────────────────────────────────
    this.modulator = this.ctx.createOscillator()
    this.modGain   = this.ctx.createGain()
    this.modulator.type = 'sine'
    this.modulator.frequency.value = p.rootFreq * p.ratio
    this.modGain.gain.value = p.index * p.rootFreq  // FM depth in Hz
    this.modulator.connect(this.modGain)
    this.modGain.connect(this.carrier.frequency)

    // ── Slow index LFO (wobble) ────────────────────────────────────────────
    this.lfo     = this.ctx.createOscillator()
    this.lfoGain = this.ctx.createGain()
    this.lfo.type = 'sine'
    this.lfo.frequency.value = 0.03 + Math.random() * 0.02
    this.lfoGain.gain.value  = p.index * p.rootFreq * 0.25
    this.lfo.connect(this.lfoGain)
    this.lfoGain.connect(this.modGain.gain)

    this.carrier.start(now)
    this.modulator.start(now)
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

    try { this.carrier?.stop(end + 0.1)   } catch { /* noop */ }
    try { this.modulator?.stop(end + 0.1) } catch { /* noop */ }
    try { this.lfo?.stop(end + 0.1)       } catch { /* noop */ }

    setTimeout(() => {
      this.carrier   = null
      this.modulator = null
      this.lfo       = null
      this.modGain   = null
      this.carGain   = null
      this.lfoGain   = null
      this.isPlaying = false
    }, (this.params.release + 0.3) * 1000)
  }

  // ── Parameter updates ─────────────────────────────────────────────────────────

  setParams(patch: Partial<FMDroneParams>): void {
    this.params = { ...this.params, ...patch }
    if (!this.ctx || !this.isPlaying) return
    const now = this.ctx.currentTime
    const p   = this.params

    if (this.master)   this.master.gain.setTargetAtTime(p.volume, now, 0.8)
    if (this.filter) {
      this.filter.frequency.setTargetAtTime(p.brightness, now, 1.5)
    }
    if (this.modGain)   this.modGain.gain.setTargetAtTime(p.index * p.rootFreq, now, 1.0)
    if (this.lfoGain)   this.lfoGain.gain.setTargetAtTime(p.index * p.rootFreq * 0.25, now, 1.0)
    if (this.dry)       this.dry.gain.setTargetAtTime(1 - p.reverbMix, now, 0.8)
    if (this.wet)       this.wet.gain.setTargetAtTime(p.reverbMix, now, 0.8)
  }

  setRootNote(note: string): void {
    const freq = noteToFreq(note)
    this.params.rootFreq = freq
    if (!this.ctx || !this.isPlaying) return
    const now = this.ctx.currentTime
    this.carrier?.frequency.setTargetAtTime(freq, now, 2.0)
    this.modulator?.frequency.setTargetAtTime(freq * this.params.ratio, now, 2.0)
    this.modGain?.gain.setTargetAtTime(this.params.index * freq, now, 1.0)
    this.lfoGain?.gain.setTargetAtTime(this.params.index * freq * 0.25, now, 1.0)
  }

  setRatio(ratio: number): void {
    this.params.ratio = ratio
    if (!this.ctx || !this.isPlaying) return
    const now = this.ctx.currentTime
    this.modulator?.frequency.setTargetAtTime(this.params.rootFreq * ratio, now, 0.5)
  }

  /** Return the final output GainNode to connect to a rack bus input. */
  getOutputNode(): GainNode { return this.bodyOut! }

  setOutputSpatial(volumeScale: number, pan = 0): void {
    this.outputVolumeScale = Math.max(0, Math.min(1, Number.isFinite(volumeScale) ? volumeScale : 1))
    this.outputPan = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0))
    if (!this.ctx) return
    const now = this.ctx.currentTime
    this.bodyOut?.gain.setTargetAtTime(this.outputVolumeScale, now, 0.08)
    this.panner?.pan.setTargetAtTime(this.outputPan, now, 0.08)
  }
}
