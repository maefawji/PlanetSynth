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
// Instrument layers connect it to getBusInputNode(bodyId).
//
// MIDI / OSC / UI can call noteOn(note, velocity) and noteOff(note) freely.

import * as Tone from 'tone'

// ── Types ─────────────────────────────────────────────────────────────────────

export type LfoTarget = 'off' | 'pitch' | 'filter' | 'amplitude'

export type AmbientOscillatorParams = {
  waveform:         OscillatorType  // 'sine' | 'triangle' | 'sawtooth' | 'square'
  waveformLeft?:    OscillatorType
  waveformRight?:   OscillatorType
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
  oscRight?:    OscillatorNode
  amp:          GainNode
  filter:       BiquadFilterNode
  filterRight?: BiquadFilterNode
  panLeft?:     StereoPannerNode
  panRight?:    StereoPannerNode
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

  // Hard limiter — DynamicsCompressor in limiter config (20:1, -3 dB threshold)
  // Sits between panner and bodyOut; prevents multi-voice summing from clipping.
  private _limiter:     DynamicsCompressorNode | null = null

  // Optional orbit-derived PeriodicWave (set via setOrbitWaveform)
  // When _periodicWaveL/_periodicWaveR are both set, stereo orbit waveforms are used.
  private _periodicWave:  PeriodicWave    | null = null
  private _periodicWaveL: PeriodicWave    | null = null
  private _periodicWaveR: PeriodicWave    | null = null

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

    // Hard limiter between panner and bodyOut (20:1 ratio, -3 dB threshold).
    // Prevents multi-voice accumulation from clipping — especially important
    // for arpeggio + OscNextOrbit where 2–4 voices can briefly overlap.
    this._limiter = this.ctx.createDynamicsCompressor()
    this._limiter.threshold.value = -3    // dB: start compressing at -3 dB
    this._limiter.knee.value      =  0    // hard knee
    this._limiter.ratio.value     = 20    // 20:1 ≈ limiter
    this._limiter.attack.value    = 0.001 // 1 ms
    this._limiter.release.value   = 0.15  // 150 ms
    this.panner.connect(this._limiter)
    this._limiter.connect(this.bodyOut)

    // Oscilloscope: parallel tap from panner (before limiter — analysis only)
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
    try { this.lfoDepthGain.disconnect() } catch { /* noop */ }

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
    if (this._lfoTarget === 'pitch') {
      this.lfoDepthGain.connect(voice.osc.detune)
      if (voice.oscRight) this.lfoDepthGain.connect(voice.oscRight.detune)
    }
    if (this._lfoTarget === 'filter') {
      this.lfoDepthGain.connect(voice.filter.frequency)
      if (voice.filterRight) this.lfoDepthGain.connect(voice.filterRight.frequency)
    }
  }

  // ── noteOn ─────────────────────────────────────────────────────────────────────

  noteOn(note: number, velocity = 0.8): void {
    if (!this.ctx || !this.panner) return
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume()
    }

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
    const leftWave  = p.waveformLeft  ?? p.waveform
    const rightWave = p.waveformRight ?? leftWave
    const hasStereoOrbits = !!(this._periodicWaveL && this._periodicWaveR)
    const useStereoPair = hasStereoOrbits || (!this._periodicWave && rightWave !== leftWave)
    const voiceLevel = targetLevel * (useStereoPair ? 0.62 : 1)

    if (hasStereoOrbits) {
      osc.setPeriodicWave(this._periodicWaveL!)
    } else if (this._periodicWave) {
      osc.setPeriodicWave(this._periodicWave)
    } else {
      osc.type = leftWave
    }
    osc.frequency.value = freq

    // ── ADSR envelope ────────────────────────────────────────────────────────
    // Minimum 5 ms attack to avoid click transients at note-on.
    const attack       = Math.max(0.005, p.attack)
    const decay        = Math.max(0.001, p.decay)
    const sustainLevel = Math.max(0.0001, voiceLevel * Math.max(0, Math.min(1, p.sustain)))

    // Exponential ramp (vs linear) gives a smoother perceptual onset and
    // eliminates the zipper click that occurs when the gain step at t=now
    // is audible through a very fast ramp.
    amp.gain.setValueAtTime(0.0001, now)
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, voiceLevel), now + attack)   // Attack
    amp.gain.setTargetAtTime(sustainLevel, now + attack, decay / 3)                     // Decay → Sustain

    filter.type            = 'lowpass'
    filter.frequency.value = p.filterCutoff
    filter.Q.value         = p.filterResonance

    let voice: Voice
    if (useStereoPair) {
      const oscRight = ctx.createOscillator()
      const filterRight = ctx.createBiquadFilter()
      const panLeft = ctx.createStereoPanner()
      const panRight = ctx.createStereoPanner()

      if (hasStereoOrbits) {
        oscRight.setPeriodicWave(this._periodicWaveR!)
      } else {
        oscRight.type = rightWave
      }
      oscRight.frequency.value = freq
      filterRight.type = 'lowpass'
      filterRight.frequency.value = p.filterCutoff
      filterRight.Q.value = p.filterResonance
      panLeft.pan.value = -1
      panRight.pan.value = 1

      osc.connect(filter)
      oscRight.connect(filterRight)
      filter.connect(panLeft)
      filterRight.connect(panRight)
      panLeft.connect(amp)
      panRight.connect(amp)
      amp.connect(this.panner)
      oscRight.start(now)
      voice = { osc, oscRight, amp, filter, filterRight, panLeft, panRight, targetLevel: voiceLevel, sustainLevel }
    } else {
      osc.connect(amp)
      amp.connect(filter)
      filter.connect(this.panner)
      voice = { osc, amp, filter, targetLevel: voiceLevel, sustainLevel }
    }
    osc.start(now)
    this.voices.set(note, voice)

    // Wire LFO to new voice if target is pitch or filter
    this._connectLfoToVoice(voice)
  }

  // ── noteOff ───────────────────────────────────────────────────────────────────

  noteOff(note: number): void {
    this._killVoice(note, this.params.release)
  }

  /** Release all voices. Pass immediate=true for a short fade-out (e.g. when the body is
   *  deleted) instead of fading over the full configured release time. */
  noteOffAll(immediate = false): void {
    // Short fade on delete: gentle enough to avoid a click, but stops promptly.
    const release = immediate ? Math.min(0.25, this.params.release) : this.params.release
    for (const note of [...this.voices.keys()]) {
      this._killVoice(note, release)
    }
  }

  private _killVoice(note: number, release: number): void {
    const voice = this.voices.get(note)
    if (!voice || !this.ctx) return
    this.voices.delete(note)

    const ctx = this.ctx
    const now = ctx.currentTime
    const { osc, oscRight, amp, filter, filterRight, panLeft, panRight } = voice

    amp.gain.cancelScheduledValues(now)
    amp.gain.setValueAtTime(Math.max(amp.gain.value, 0.0001), now)

    if (release > 0.01) {
      amp.gain.setTargetAtTime(0.0001, now, Math.max(0.01, release / 3))
      const stopTime = now + release + 0.5
      try { osc.stop(stopTime) } catch { /* noop */ }
      try { oscRight?.stop(stopTime) } catch { /* noop */ }
      setTimeout(() => {
        try {
          osc.disconnect(); oscRight?.disconnect(); amp.disconnect(); filter.disconnect()
          filterRight?.disconnect(); panLeft?.disconnect(); panRight?.disconnect()
        } catch { /* noop */ }
      }, (release + 0.8) * 1000)
    } else {
      amp.gain.setValueAtTime(0.0001, now)
      try { osc.stop(now + 0.01) } catch { /* noop */ }
      try { oscRight?.stop(now + 0.01) } catch { /* noop */ }
      setTimeout(() => {
        try {
          osc.disconnect(); oscRight?.disconnect(); amp.disconnect(); filter.disconnect()
          filterRight?.disconnect(); panLeft?.disconnect(); panRight?.disconnect()
        } catch { /* noop */ }
      }, 50)
    }
  }

  // ── Orbit waveform (PeriodicWave from trajectory DFT) ────────────────────────

  /**
   * Compute a PeriodicWave from orbit trajectory points and apply it to all
   * current and future voices.
   *
   * The Y-coordinate of each point is used as the waveform signal; it is
   * centered (DC removed) and normalized to [-1, 1] before the DFT.
   */
  setOrbitWaveform(
    pts: ReadonlyArray<{ x: number; y: number }>,
    opts: { applyToActive?: boolean } = {},
  ): void {
    if (!this.ctx) return
    const N = pts.length
    if (N < 4) return

    this._periodicWaveL = null
    this._periodicWaveR = null
    this._periodicWave = this._buildPeriodicWave(pts)
    if (!this._periodicWave) return

    if (opts.applyToActive !== false) {
      for (const voice of this.voices.values()) {
        voice.osc.setPeriodicWave(this._periodicWave)
      }
    }
  }

  /** Set separate L/R orbit-derived PeriodicWaves. Clears the mono _periodicWave. */
  setOrbitWaveformStereo(
    ptsL: ReadonlyArray<{ x: number; y: number }>,
    ptsR: ReadonlyArray<{ x: number; y: number }>,
    opts: { applyToActive?: boolean } = {},
  ): void {
    if (!this.ctx) return
    this._periodicWave = null
    this._periodicWaveL = this._buildPeriodicWave(ptsL)
    this._periodicWaveR = this._buildPeriodicWave(ptsR)
    if (opts.applyToActive !== false && this._periodicWaveL && this._periodicWaveR) {
      for (const voice of this.voices.values()) {
        voice.osc.setPeriodicWave(this._periodicWaveL)
        if (voice.oscRight) voice.oscRight.setPeriodicWave(this._periodicWaveR)
      }
    }
  }

  private _buildPeriodicWave(pts: ReadonlyArray<{ x: number; y: number }>): PeriodicWave | null {
    if (!this.ctx || pts.length < 4) return null
    const N = pts.length
    let sumY = 0
    for (const p of pts) sumY += p.y
    const meanY = sumY / N
    let peak = 1e-9
    for (const p of pts) peak = Math.max(peak, Math.abs(p.y - meanY))
    const half = Math.min(Math.floor(N / 2) + 1, 257)
    const realCoef = new Float32Array(half)
    const imagCoef = new Float32Array(half)
    for (let k = 1; k < half; k++) {
      let re = 0, im = 0
      const twopiK = (2 * Math.PI * k) / N
      for (let n = 0; n < N; n++) {
        const sig = (pts[n].y - meanY) / peak
        const angle = twopiK * n
        re += sig * Math.cos(angle)
        im += sig * Math.sin(angle)
      }
      realCoef[k] = (2 * re) / N
      imagCoef[k] = (2 * im) / N
    }
    realCoef[0] = 0
    return this.ctx.createPeriodicWave(realCoef, imagCoef, { disableNormalization: false })
  }

  /** Clear any orbit-derived waveform and revert to params.waveform. */
  clearOrbitWaveform(): void {
    this._periodicWave  = null
    this._periodicWaveL = null
    this._periodicWaveR = null
    for (const voice of this.voices.values()) {
      voice.osc.type = this.params.waveform
      if (voice.oscRight) voice.oscRight.type = this.params.waveformRight ?? this.params.waveform
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
      if (patch.waveform !== undefined || patch.waveformLeft !== undefined || patch.waveformRight !== undefined) {
        if (this._periodicWave) {
          voice.osc.setPeriodicWave(this._periodicWave)
        } else {
          voice.osc.type = p.waveformLeft ?? p.waveform
          if (voice.oscRight) voice.oscRight.type = p.waveformRight ?? p.waveformLeft ?? p.waveform
        }
      }
      if (patch.filterCutoff !== undefined) {
        voice.filter.frequency.setTargetAtTime(p.filterCutoff, now, 0.05)
        voice.filterRight?.frequency.setTargetAtTime(p.filterCutoff, now, 0.05)
      }
      if (patch.filterResonance !== undefined) {
        voice.filter.Q.setTargetAtTime(p.filterResonance, now, 0.05)
        voice.filterRight?.Q.setTargetAtTime(p.filterResonance, now, 0.05)
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

  get hasOrbitWaveform(): boolean {
    return this._periodicWave !== null || (this._periodicWaveL !== null && this._periodicWaveR !== null)
  }

  // ── Dispose ────────────────────────────────────────────────────────────────────

  dispose(): void {
    this.noteOffAll()
    try { this.lfoOsc?.stop(); this.lfoOsc?.disconnect(); this.lfoDepthGain?.disconnect() } catch { /* noop */ }
    this.lfoOsc = null; this.lfoDepthGain = null
    try { this._analyser?.disconnect() } catch { /* noop */ }
    this._analyser = null
    const release = this.params.release
    setTimeout(() => {
      try { this.panner?.disconnect(); this._limiter?.disconnect(); this.bodyOut?.disconnect() } catch { /* noop */ }
      this.ctx = null; this.panner = null; this._limiter = null; this.bodyOut = null
    }, (release + 1) * 1000)
  }
}
