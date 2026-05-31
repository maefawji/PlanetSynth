// ── AmbientOscillatorEngine ───────────────────────────────────────────────────
// Pure Web Audio API polyphonic oscillator instrument.
// Uses the shared Tone.js AudioContext so it integrates with the rack bus.
//
// Signal flow (per voice):
//   OscillatorNode → GainNode (amplitude envelope)
//     → BiquadFilterNode (low-pass) ─┐
//                                     ├─→ StereoPannerNode → bodyOut (GainNode)
//   (more voices) ───────────────────┘
//
// LFO (shared, engine-level):
//   LfoOscillatorNode → lfoDepthGain ──→ voice.osc.detune   (pitch / vibrato)
//                                    ──→ voice.filter.freq   (filter sweep)
//                                    ──→ bodyOut.gain        (tremolo)
//
// bodyOut is intentionally left unconnected.
// AmbientOscillatorLayer connects it to getBusInputNode(bodyId).
//
// MIDI / OSC / UI can call noteOn(note, velocity) and noteOff(note) freely.

import * as Tone from 'tone'

// ── Types ─────────────────────────────────────────────────────────────────────

export type LfoTarget = 'off' | 'pitch' | 'filter' | 'amplitude'

export type AmbientOscillatorParams = {
  waveform:         OscillatorType  // 'sine' | 'triangle' | 'sawtooth' | 'square'
  attack:           number          // A: time to reach peak (seconds)
  decay:            number          // D: time to fall from peak to sustain (seconds)
  sustain:          number          // S: sustain level relative to peak (0–1)
  release:          number          // R: time to fall to silence after noteOff (seconds)
  filterCutoff:     number          // low-pass cutoff Hz
  filterResonance:  number          // filter Q
  level:            number          // master amplitude 0–1
  // ── LFO ──
  lfoTarget:        LfoTarget
  lfoRate:          number          // Hz
  lfoDepth:         number          // 0–1
  lfoWaveform:      OscillatorType
}

interface Voice {
  osc:          OscillatorNode
  amp:          GainNode
  filter:       BiquadFilterNode
  targetLevel:  number   // peak gain (level × velocity)
  sustainLevel: number   // sustain gain (targetLevel × sustain)
}

// ── MIDI → Hz ─────────────────────────────────────────────────────────────────

export function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

// ── Engine class ──────────────────────────────────────────────────────────────

export class AmbientOscillatorEngine {
  private ctx:          AudioContext      | null = null
  private panner:       StereoPannerNode  | null = null
  private bodyOut:      GainNode          | null = null
  private voices        = new Map<number, Voice>()

  // LFO
  private lfoOsc:       OscillatorNode    | null = null
  private lfoDepthGain: GainNode          | null = null
  private _lfoTarget:   LfoTarget = 'off'

  // Oscilloscope analyser (parallel tap from panner output)
  private _analyser:    AnalyserNode      | null = null

  private _outputScale = 1
  private _outputPan   = 0

  params: AmbientOscillatorParams = {
    waveform:         'sine',
    attack:           1.5,
    decay:            0.5,
    sustain:          0.8,
    release:          3.0,
    filterCutoff:     1200,
    filterResonance:  0.3,
    level:            0.5,
    lfoTarget:        'off',
    lfoRate:          0.5,
    lfoDepth:         0.3,
    lfoWaveform:      'sine',
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.ctx) return
    await Tone.start()
    this.ctx     = Tone.getContext().rawContext as AudioContext
    this.panner  = this.ctx.createStereoPanner()
    this.bodyOut = this.ctx.createGain()
    this.panner.pan.value   = this._outputPan
    this.bodyOut.gain.value = this._outputScale
    this.panner.connect(this.bodyOut)

    // Oscilloscope: parallel tap from panner (no output — analysis only)
    this._analyser = this.ctx.createAnalyser()
    this._analyser.fftSize = 256
    this._analyser.smoothingTimeConstant = 0
    this.panner.connect(this._analyser)

    // LFO — always running; target determines what it modulates
    this.lfoOsc       = this.ctx.createOscillator()
    this.lfoDepthGain = this.ctx.createGain()
    this.lfoOsc.type            = this.params.lfoWaveform
    this.lfoOsc.frequency.value = this.params.lfoRate
    this.lfoDepthGain.gain.value = 0  // wired to zero until target is set
    this.lfoOsc.connect(this.lfoDepthGain)
    this.lfoOsc.start()
    // bodyOut intentionally left unconnected — caller wires to rack bus
  }

  // ── LFO helpers ───────────────────────────────────────────────────────────────

  /** Depth scale for each target type. */
  private _lfoDepthScale(): number {
    const p = this.params
    switch (p.lfoTarget) {
      case 'pitch':     return p.lfoDepth * 200           // ±200 cents (≈ ±1 semitone at 0.08)
      case 'filter':    return p.lfoDepth * p.filterCutoff // ±cutoff Hz sweep
      case 'amplitude': return p.lfoDepth * 0.45          // ±0.45 gain (tremolo)
      default:          return 0
    }
  }

  /** Disconnect lfoDepthGain from everything and reconnect to the new target. */
  private _applyLfoTarget(target: LfoTarget): void {
    if (!this.lfoDepthGain || !this.bodyOut) return
    try { this.lfoDepthGain.disconnect() } catch (_) {}

    this._lfoTarget = target
    if (target === 'off') {
      this.lfoDepthGain.gain.value = 0
      return
    }

    this.lfoDepthGain.gain.value = this._lfoDepthScale()

    if (target === 'amplitude') {
      this.lfoDepthGain.connect(this.bodyOut.gain)
    } else {
      for (const voice of this.voices.values()) {
        this._connectLfoToVoice(voice)
      }
    }
  }

  /** Wire lfoDepthGain to a specific voice's AudioParam (pitch or filter). */
  private _connectLfoToVoice(voice: Voice): void {
    if (!this.lfoDepthGain || this._lfoTarget === 'off') return
    if (this._lfoTarget === 'pitch')  this.lfoDepthGain.connect(voice.osc.detune)
    if (this._lfoTarget === 'filter') this.lfoDepthGain.connect(voice.filter.frequency)
  }

  // ── noteOn ─────────────────────────────────────────────────────────────────────

  noteOn(note: number, velocity = 0.8): void {
    if (!this.ctx || !this.panner) return

    // Retrigger: remove existing voice cleanly
    if (this.voices.has(note)) this._killVoice(note, 0)

    const ctx  = this.ctx
    const now  = ctx.currentTime
    const freq = midiToHz(note)
    const p    = this.params
    const targetLevel = p.level * Math.max(0, Math.min(1, velocity))

    const osc    = ctx.createOscillator()
    const amp    = ctx.createGain()
    const filter = ctx.createBiquadFilter()

    osc.type            = p.waveform
    osc.frequency.value = freq

    // ── ADSR envelope ────────────────────────────────────────────────────────
    // Minimum 5 ms attack to avoid click transients at note-on.
    const attack       = Math.max(0.005, p.attack)
    const decay        = Math.max(0.001, p.decay)
    const sustainLevel = Math.max(0.0001, targetLevel * Math.max(0, Math.min(1, p.sustain)))

    // Exponential ramp (vs linear) gives a smoother perceptual onset and
    // eliminates the zipper click that occurs when the gain step at t=now
    // is audible through a very fast ramp.
    amp.gain.setValueAtTime(0.0001, now)
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, targetLevel), now + attack)  // Attack
    amp.gain.setTargetAtTime(sustainLevel, now + attack, decay / 3)                     // Decay → Sustain

    filter.type            = 'lowpass'
    filter.frequency.value = p.filterCutoff
    filter.Q.value         = p.filterResonance

    osc.connect(amp)
    amp.connect(filter)
    filter.connect(this.panner)
    osc.start(now)

    const voice: Voice = { osc, amp, filter, targetLevel, sustainLevel }
    this.voices.set(note, voice)

    // Wire LFO to new voice if target is pitch or filter
    this._connectLfoToVoice(voice)
  }

  // ── noteOff ───────────────────────────────────────────────────────────────────

  noteOff(note: number): void {
    this._killVoice(note, this.params.release)
  }

  noteOffAll(): void {
    for (const note of [...this.voices.keys()]) {
      this._killVoice(note, this.params.release)
    }
  }

  private _killVoice(note: number, release: number): void {
    const voice = this.voices.get(note)
    if (!voice || !this.ctx) return
    this.voices.delete(note)

    const ctx = this.ctx
    const now = ctx.currentTime
    const { osc, amp, filter } = voice

    amp.gain.cancelScheduledValues(now)
    amp.gain.setValueAtTime(Math.max(amp.gain.value, 0.0001), now)

    if (release > 0.01) {
      amp.gain.setTargetAtTime(0.0001, now, Math.max(0.01, release / 3))
      const stopTime = now + release + 0.5
      try { osc.stop(stopTime) } catch (_) {}
      setTimeout(() => {
        try { osc.disconnect(); amp.disconnect(); filter.disconnect() } catch (_) {}
      }, (release + 0.8) * 1000)
    } else {
      amp.gain.setValueAtTime(0.0001, now)
      try { osc.stop(now + 0.01) } catch (_) {}
      setTimeout(() => {
        try { osc.disconnect(); amp.disconnect(); filter.disconnect() } catch (_) {}
      }, 50)
    }
  }

  // ── setParams (live update while playing) ─────────────────────────────────────

  setParams(patch: Partial<AmbientOscillatorParams>): void {
    const prev = this.params
    this.params = { ...this.params, ...patch }
    if (!this.ctx) return
    const now = this.ctx.currentTime
    const p   = this.params

    for (const voice of this.voices.values()) {
      if (patch.waveform !== undefined) {
        voice.osc.type = p.waveform
      }
      if (patch.filterCutoff !== undefined) {
        voice.filter.frequency.setTargetAtTime(p.filterCutoff, now, 0.05)
      }
      if (patch.filterResonance !== undefined) {
        voice.filter.Q.setTargetAtTime(p.filterResonance, now, 0.05)
      }
      if (patch.level !== undefined && prev.level !== p.level) {
        const ratio = p.level / Math.max(0.0001, prev.level)
        voice.targetLevel  = voice.targetLevel  * ratio
        voice.sustainLevel = voice.targetLevel  * Math.max(0, Math.min(1, p.sustain))
        voice.amp.gain.setTargetAtTime(Math.max(0.0001, voice.sustainLevel), now, 0.05)
      } else if (patch.sustain !== undefined) {
        voice.sustainLevel = voice.targetLevel * Math.max(0, Math.min(1, p.sustain))
        voice.amp.gain.setTargetAtTime(Math.max(0.0001, voice.sustainLevel), now, 0.05)
      }
    }

    // ── LFO param updates ────────────────────────────────────────────────────

    if (patch.lfoWaveform !== undefined && this.lfoOsc) {
      this.lfoOsc.type = p.lfoWaveform
    }
    if (patch.lfoRate !== undefined && this.lfoOsc) {
      this.lfoOsc.frequency.setTargetAtTime(p.lfoRate, now, 0.05)
    }
    // Re-wire if target changed
    if (patch.lfoTarget !== undefined && patch.lfoTarget !== prev.lfoTarget) {
      this._applyLfoTarget(p.lfoTarget)
    }
    // Update depth if depth, target, or filterCutoff changed
    if (
      (patch.lfoDepth !== undefined || patch.lfoTarget !== undefined || patch.filterCutoff !== undefined)
      && this.lfoDepthGain && this._lfoTarget !== 'off'
    ) {
      this.lfoDepthGain.gain.setTargetAtTime(this._lfoDepthScale(), now, 0.05)
    }
  }

  // ── Spatial output ─────────────────────────────────────────────────────────────

  setOutputSpatial(volumeScale: number, pan = 0): void {
    this._outputScale = Math.max(0, Math.min(2, isFinite(volumeScale) ? volumeScale : 1))
    this._outputPan   = Math.max(-1, Math.min(1, isFinite(pan) ? pan : 0))
    if (!this.ctx) return
    const now = this.ctx.currentTime
    this.bodyOut?.gain.setTargetAtTime(this._outputScale, now, 0.05)
    this.panner?.pan.setTargetAtTime(this._outputPan, now, 0.05)
  }

  getOutputNode(): GainNode {
    return this.bodyOut!
  }

  get analyserNode(): AnalyserNode | null {
    return this._analyser
  }

  get isActive(): boolean {
    return this.voices.size > 0
  }

  // ── Dispose ────────────────────────────────────────────────────────────────────

  dispose(): void {
    this.noteOffAll()
    try { this.lfoOsc?.stop(); this.lfoOsc?.disconnect(); this.lfoDepthGain?.disconnect() } catch (_) {}
    this.lfoOsc = null; this.lfoDepthGain = null
    try { this._analyser?.disconnect() } catch (_) {}
    this._analyser = null
    const release = this.params.release
    setTimeout(() => {
      try { this.panner?.disconnect(); this.bodyOut?.disconnect() } catch (_) {}
      this.ctx = null; this.panner = null; this.bodyOut = null
    }, (release + 1) * 1000)
  }
}
