// ── PadDroneEngine ─────────────────────────────────────────────────────────────
// Web Audio API — uses shared Tone.js AudioContext.
// Layered oscillator drone with slow LFO modulation, lowpass filter, long reverb.
//
// Signal flow:
//   [sine/tri/saw oscs] → gainNodes → filter → dry gain → master → pan → bodyOut
//                                             → reverb   → wet gain ↗
//   bodyOut is NOT connected here — caller connects it to the rack bus input node.

import * as Tone from 'tone'

export interface PadDroneParams {
  rootFreq:   number   // Hz, e.g. 110 = A2
  volume:     number   // 0–1
  brightness: number   // filter cutoff Hz, 200–8000
  melt:       number   // 0–1, LFO depth + filter Q
  detune:     number   // cents spread between voices
  attack:     number   // seconds
  release:    number   // seconds
  reverbMix:  number   // 0–1 dry/wet
  motion:     number   // 0–1 LFO speed multiplier
}

const VOICE_SPEC: Array<{ type: OscillatorType; freqMul: number; detuneScale: number; gain: number }> = [
  { type: 'sine',     freqMul: 1,   detuneScale:  0,    gain: 0.55 },
  { type: 'triangle', freqMul: 1,   detuneScale:  1.0,  gain: 0.35 },
  { type: 'sawtooth', freqMul: 0.5, detuneScale: -0.6,  gain: 0.18 },
  { type: 'sine',     freqMul: 1.5, detuneScale:  0.4,  gain: 0.16 },
  { type: 'triangle', freqMul: 2,   detuneScale: -0.3,  gain: 0.12 },
]

interface Voice { osc: OscillatorNode; gain: GainNode }

function noteToFreq(note: string): number {
  const noteMap: Record<string, number> = {
    C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,
  }
  const m = note.match(/^([A-G][b#]?)(-?\d)$/)
  if (!m) return 110
  const midi = 12 * (Number(m[2]) + 1) + (noteMap[m[1]] ?? 0)
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function makeImpulseResponse(ctx: AudioContext, duration = 16, decay = 4): AudioBuffer {
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

export class PadDroneEngine {
  private ctx:     AudioContext | null = null
  private master:  GainNode    | null = null
  private bodyOut: GainNode    | null = null
  private panner:  StereoPannerNode | null = null
  private filter:  BiquadFilterNode | null = null
  private voices:  Voice[]     = []
  private lfos:    OscillatorNode[] = []
  private outputVolumeScale = 1
  private outputPan = 0

  isPlaying = false

  params: PadDroneParams = {
    rootFreq:   110,
    volume:     0.35,
    brightness: 1200,
    melt:       0.5,
    detune:     8,
    attack:     6.0,
    release:    12.0,
    reverbMix:  0.55,
    motion:     0.4,
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  private async init() {
    if (this.ctx) return
    // Share the Tone.js AudioContext so rack bus cross-connections are valid
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
    this.filter.Q.value = 0.7

    const dry    = this.ctx.createGain()
    const wet    = this.ctx.createGain()
    const reverb = this.ctx.createConvolver()
    reverb.buffer = makeImpulseResponse(this.ctx, 18, 3.5)

    dry.gain.value = 1 - this.params.reverbMix
    wet.gain.value = this.params.reverbMix

    this.filter.connect(dry);    dry.connect(this.master)
    this.filter.connect(reverb); reverb.connect(wet); wet.connect(this.master)
    this.master.connect(this.panner)
    this.panner.connect(this.bodyOut)
    // bodyOut is intentionally left unconnected here.
    // The layer component connects it to the rack bus via getBusInputNode().
  }

  async start() {
    await this.init()
    if (!this.ctx || !this.master || !this.filter) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (this.isPlaying) return

    const now = this.ctx.currentTime
    const p   = this.params

    this.voices = []
    this.lfos   = []

    for (const spec of VOICE_SPEC) {
      const osc  = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = spec.type
      osc.frequency.value = p.rootFreq * spec.freqMul
      osc.detune.value    = p.detune * spec.detuneScale
      gain.gain.value     = spec.gain
      osc.connect(gain)
      gain.connect(this.filter)
      osc.start(now)
      this.voices.push({ osc, gain })
    }

    this.buildLfos()

    // Use setTargetAtTime for attack so subsequent setParams calls can
    // override the volume without being blocked by a scheduled ramp end-point.
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(0.0001, now)
    this.master.gain.setTargetAtTime(p.volume, now, Math.max(0.1, p.attack / 3))
    this.isPlaying = true
  }

  stop() {
    if (!this.ctx || !this.master || !this.isPlaying) return
    const now = this.ctx.currentTime
    const end = now + this.params.release

    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(Math.max(this.master.gain.value, 0.0001), now)
    this.master.gain.exponentialRampToValueAtTime(0.0001, end)

    for (const { osc } of this.voices) try { osc.stop(end + 0.1) } catch { /* noop */ }
    for (const lfo      of this.lfos)  try { lfo.stop(end + 0.1) } catch { /* noop */ }

    setTimeout(() => {
      this.voices = []
      this.lfos   = []
      this.isPlaying = false
    }, (this.params.release + 0.3) * 1000)
  }

  // ── LFO modulation ───────────────────────────────────────────────────────────

  private buildLfos() {
    if (!this.ctx || !this.filter) return
    const p = this.params

    // Filter cutoff LFO
    const fLfo  = this.ctx.createOscillator()
    const fGain = this.ctx.createGain()
    fLfo.type = 'sine'
    fLfo.frequency.value = 0.015 + p.motion * 0.035
    fGain.gain.value     = 300 + p.melt * 900
    fLfo.connect(fGain)
    fGain.connect(this.filter.frequency)
    fLfo.start()
    this.lfos.push(fLfo)

    // Per-voice pitch drift
    this.voices.forEach(({ osc }, i) => {
      const pLfo  = this.ctx!.createOscillator()
      const pGain = this.ctx!.createGain()
      pLfo.type = 'sine'
      pLfo.frequency.value = 0.006 + i * 0.004
      pGain.gain.value     = p.melt * 4
      pLfo.connect(pGain)
      pGain.connect(osc.detune)
      pLfo.start()
      this.lfos.push(pLfo)
    })
  }

  // ── Parameter updates ─────────────────────────────────────────────────────────

  setParams(patch: Partial<PadDroneParams>) {
    this.params = { ...this.params, ...patch }
    if (!this.ctx) return
    const now = this.ctx.currentTime
    const p   = this.params

    this.master?.gain.setTargetAtTime(p.volume, now, 0.8)

    if (this.filter) {
      this.filter.frequency.setTargetAtTime(p.brightness, now, 1.5)
      this.filter.Q.setTargetAtTime(0.5 + p.melt * 1.4, now, 1.5)
    }

    this.voices.forEach(({ osc }, i) => {
      const spec = VOICE_SPEC[i]
      osc.detune.setTargetAtTime(p.detune * (spec?.detuneScale ?? 0), now, 1.2)
    })
  }

  /**
   * Final body-track output stage.
   * Instrument volume stays in params.volume; this gain represents downstream
   * rack/output processing such as standpoint attenuation.
   */
  setOutputSpatial(volumeScale: number, pan = 0) {
    this.outputVolumeScale = Math.max(0, Math.min(1, Number.isFinite(volumeScale) ? volumeScale : 1))
    this.outputPan = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0))
    if (!this.ctx) return
    const now = this.ctx.currentTime
    this.bodyOut?.gain.setTargetAtTime(this.outputVolumeScale, now, 0.08)
    this.panner?.pan.setTargetAtTime(this.outputPan, now, 0.08)
  }

  /** Return the final output GainNode to connect to a rack bus input. */
  getOutputNode(): GainNode { return this.bodyOut! }

  setRootNote(note: string) {
    const freq = noteToFreq(note)
    this.setParams({ rootFreq: freq })
    if (!this.ctx || !this.isPlaying) return
    const now = this.ctx.currentTime
    this.voices.forEach(({ osc }, i) => {
      osc.frequency.setTargetAtTime(freq * (VOICE_SPEC[i]?.freqMul ?? 1), now, 2.0)
    })
  }
}
