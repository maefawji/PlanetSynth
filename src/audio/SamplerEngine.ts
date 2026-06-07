// ── SamplerEngine ──────────────────────────────────────────────────────────────
// Web Audio API sampler — uses shared Tone.js AudioContext.
// Loads an audio file into a buffer and plays it back with loop/oneshot/pingpong,
// configurable start/end points, loop points, reverse, attack/release, reverb.
//
// Signal flow:
//   AudioBufferSourceNode → masterGain(env) → dry ─────────────── → bodyOut
//                                           → convReverb → wet  ──↗
//   bodyOut → panner  (unconnected — SamplerLayer wires to rack bus)
//
// Buffer preprocessing (done on load/param change):
//   rawBuffer + sampleStart/End → slice → optionally reverse
//   pingpong mode: slice + reversed(slice), looped through naturally

import * as Tone from 'tone'

export interface SamplerParams {
  volume:      number           // 0–1
  playMode:    'oneshot' | 'loop' | 'pingpong'
  sampleStart: number           // normalized 0–1 within raw buffer
  sampleEnd:   number           // normalized 0–1 (must be > sampleStart)
  loopStart:   number           // normalized 0–1 within [sampleStart, sampleEnd] slice
  loopEnd:     number           // normalized 0–1 within slice (must be > loopStart)
  reverse:     boolean
  detune:      number           // semitones, ±24
  attack:      number           // gain envelope attack seconds
  release:     number           // gain envelope release seconds
  reverbMix:   number           // 0–1
}

// Helpers for impulse response
function makeImpulse(ctx: AudioContext, duration = 10, decay = 4): AudioBuffer {
  const len    = Math.floor(ctx.sampleRate * duration)
  const buf    = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

/** Slice + optional reverse + optional pingpong concatenation. */
function buildPlayBuffer(
  raw:    AudioBuffer,
  start:  number,   // normalized 0–1
  end:    number,   // normalized 0–1
  reverse: boolean,
  pingpong: boolean,
): AudioBuffer {
  const sr        = raw.sampleRate
  const nch       = raw.numberOfChannels
  const rawLen    = raw.length
  const startFr   = Math.max(0, Math.floor(start * rawLen))
  const endFr     = Math.min(rawLen, Math.ceil(end * rawLen))
  const sliceLen  = Math.max(2, endFr - startFr)

  // Build the base slice (forward or reversed)
  const sliceBuf = new OfflineAudioContext(nch, sliceLen, sr).createBuffer(nch, sliceLen, sr)
  for (let ch = 0; ch < nch; ch++) {
    const src = raw.getChannelData(ch)
    const dst = sliceBuf.getChannelData(ch)
    if (reverse) {
      for (let i = 0; i < sliceLen; i++) dst[i] = src[endFr - 1 - i] ?? 0
    } else {
      for (let i = 0; i < sliceLen; i++) dst[i] = src[startFr + i] ?? 0
    }
  }

  if (!pingpong) return sliceBuf

  // Pingpong: [forward slice] + [reverse of same slice]
  const totalLen    = sliceLen * 2
  const pingBuf     = new OfflineAudioContext(nch, totalLen, sr).createBuffer(nch, totalLen, sr)
  for (let ch = 0; ch < nch; ch++) {
    const fwd = sliceBuf.getChannelData(ch)
    const dst = pingBuf.getChannelData(ch)
    for (let i = 0; i < sliceLen; i++) dst[i]              = fwd[i] ?? 0
    for (let i = 0; i < sliceLen; i++) dst[sliceLen + i]   = fwd[sliceLen - 1 - i] ?? 0
  }
  return pingBuf
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class SamplerEngine {
  private ctx:        AudioContext           | null = null
  private source:     AudioBufferSourceNode | null = null
  private master:     GainNode              | null = null
  private bodyOut:    GainNode              | null = null
  private panner:     StereoPannerNode      | null = null
  private dry:        GainNode              | null = null
  private wet:        GainNode              | null = null
  private reverb:     ConvolverNode         | null = null

  private rawBuffer:  AudioBuffer           | null = null
  private playBuffer: AudioBuffer           | null = null
  private loadedUrl   = ''

  private outputVolumeScale   = 1
  private outputPan           = 0
  private _stopping           = false
  private _startWallTimeMs    = 0
  private _loadingPromise: Promise<boolean> | null = null   // deduplicates concurrent loads
  private _starting           = false                        // prevents concurrent start() calls

  isPlaying = false

  params: SamplerParams = {
    volume:      0.7,
    playMode:    'loop',
    sampleStart: 0,
    sampleEnd:   1,
    loopStart:   0,
    loopEnd:     1,
    reverse:     false,
    detune:      0,
    attack:      0.01,
    release:     1.0,
    reverbMix:   0.3,
  }

  // ── Initialisation ───────────────────────────────────────────────────────────

  private async init(): Promise<void> {
    if (this.ctx) return
    await Tone.start()
    this.ctx = Tone.getContext().rawContext as AudioContext

    this.master = this.ctx.createGain()
    this.master.gain.value = 0

    this.bodyOut = this.ctx.createGain()
    this.bodyOut.gain.value = this.outputVolumeScale

    this.panner = this.ctx.createStereoPanner()
    this.panner.pan.value = this.outputPan

    this.dry    = this.ctx.createGain()
    this.wet    = this.ctx.createGain()
    this.reverb = this.ctx.createConvolver()
    this.reverb.buffer = makeImpulse(this.ctx)

    const p = this.params
    this.dry.gain.value = 1 - p.reverbMix
    this.wet.gain.value = p.reverbMix

    this.master.connect(this.dry);    this.dry.connect(this.bodyOut)
    this.master.connect(this.reverb); this.reverb.connect(this.wet); this.wet.connect(this.bodyOut)
    this.bodyOut.connect(this.panner)
    // panner is intentionally left unconnected — SamplerLayer wires it to rack bus
  }

  // ── Sample loading ────────────────────────────────────────────────────────────

  private async _loadBuffer(url: string): Promise<boolean> {
    if (!this.ctx) return false
    if (this.loadedUrl === url && this.rawBuffer) return true
    // If a load is already in-flight for this URL, piggyback on it
    if (this._loadingPromise) return this._loadingPromise
    this._loadingPromise = (async () => {
      try {
        const resp   = await fetch(url)
        const ab     = await resp.arrayBuffer()
        this.rawBuffer  = await this.ctx!.decodeAudioData(ab)
        this.loadedUrl  = url
        this._rebuildPlayBuffer()
        // Restart immediately when a new sample is loaded while already playing
        if (this.isPlaying && !this._stopping) this._startSource()
        return true
      } catch {
        return false
      } finally {
        this._loadingPromise = null
      }
    })()
    return this._loadingPromise
  }

  private _rebuildPlayBuffer(): void {
    if (!this.rawBuffer) return
    const p = this.params
    const sStart = Math.max(0, Math.min(0.999, p.sampleStart))
    const sEnd   = Math.max(sStart + 0.001, Math.min(1, p.sampleEnd))
    this.playBuffer = buildPlayBuffer(
      this.rawBuffer,
      sStart, sEnd,
      p.reverse,
      p.playMode === 'pingpong',
    )
  }

  // ── Playback ──────────────────────────────────────────────────────────────────

  /** Load sample and start playback. Safe to call repeatedly with same URL. */
  async start(url: string): Promise<void> {
    // Prevent duplicate concurrent starts (SamplerLayer fires every 66 ms)
    if (this._starting) return
    if (this.isPlaying && !this._stopping) return
    this._starting = true
    try {
      await this.init()
      if (!this.ctx || !this.master) return
      if (this.ctx.state === 'suspended') await this.ctx.resume()

      const loaded = await this._loadBuffer(url)
      if (!loaded || !this.playBuffer) return

      // _loadBuffer already called _startSource() if the URL changed while playing.
      if (this.isPlaying && !this._stopping) return

      this._startSource()
    } finally {
      this._starting = false
    }
  }

  private _startSource(): void {
    if (!this.ctx || !this.master || !this.playBuffer) return

    // Stop existing source without fade
    try { this.source?.stop() } catch { /* noop */ }
    this.source = null

    const now = this.ctx.currentTime
    const p   = this.params
    const buf = this.playBuffer
    const dur = buf.duration

    // Compute loop points (normalized within slice → seconds in playBuffer)
    const loopS = Math.max(0, Math.min(0.999, p.loopStart))
    const loopE = Math.max(loopS + 0.001, Math.min(1, p.loopEnd))
    const loopStartSec = loopS * dur
    const loopEndSec   = loopE * dur

    this.source = this.ctx.createBufferSource()
    this.source.buffer = buf
    // detune AudioParam is absent in some Tone.js AudioContext builds
    if (this.source.detune !== undefined) this.source.detune.value = p.detune * 100

    const isLoop = p.playMode === 'loop' || p.playMode === 'pingpong'
    this.source.loop      = isLoop
    this.source.loopStart = loopStartSec
    this.source.loopEnd   = p.playMode === 'pingpong' ? dur : loopEndSec

    this.source.connect(this.master)

    if (!isLoop) {
      // Oneshot: stop naturally; the engine can be retriggered by the layer
      this.source.onended = () => {
        if (this._stopping) return
        this.isPlaying = false
        this.source = null
      }
    }

    // Attack envelope
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(0.0001, now)
    this.master.gain.setTargetAtTime(p.volume, now, Math.max(0.005, p.attack / 3))

    this.source.start(now, isLoop ? loopStartSec : 0)
    this._startWallTimeMs = performance.now()
    this._stopping = false
    this.isPlaying = true
  }

  /** Fade out and stop. */
  stop(): void {
    if (!this.ctx || !this.master || !this.isPlaying) return
    this._stopping = true
    const now = this.ctx.currentTime
    const end = now + this.params.release

    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(Math.max(this.master.gain.value, 0.0001), now)
    this.master.gain.exponentialRampToValueAtTime(0.0001, end)

    try { this.source?.stop(end + 0.05) } catch { /* noop */ }

    setTimeout(() => {
      this.source    = null
      this.isPlaying = false
      this._stopping = false
    }, (this.params.release + 0.2) * 1000)
  }

  /** Restart from current buffer with updated loop/play settings. */
  restart(): void {
    if (!this.isPlaying) return
    this._startSource()
  }

  // ── Parameter updates ─────────────────────────────────────────────────────────

  setParams(patch: Partial<SamplerParams>): void {
    const needsRebuild =
      patch.sampleStart !== undefined || patch.sampleEnd  !== undefined ||
      patch.reverse     !== undefined || patch.playMode   !== undefined

    this.params = { ...this.params, ...patch }

    if (needsRebuild) {
      this._rebuildPlayBuffer()
      if (this.isPlaying && !this._stopping) this._startSource()
      return
    }

    if (!this.ctx || !this.isPlaying) return
    const now = this.ctx.currentTime
    const p   = this.params

    if (this.master && patch.volume !== undefined)
      this.master.gain.setTargetAtTime(p.volume, now, 0.5)

    if (this.source && patch.detune !== undefined && this.source.detune !== undefined)
      this.source.detune.setTargetAtTime(p.detune * 100, now, 0.2)

    if (patch.loopStart !== undefined || patch.loopEnd !== undefined) {
      const dur    = this.playBuffer?.duration ?? 1
      const loopS  = Math.max(0, Math.min(0.999, p.loopStart))
      const loopE  = Math.max(loopS + 0.001, Math.min(1, p.loopEnd))
      if (this.source) {
        this.source.loopStart = loopS * dur
        this.source.loopEnd   = p.playMode === 'pingpong' ? dur : loopE * dur
      }
    }

    if (this.dry && this.wet && patch.reverbMix !== undefined) {
      this.dry.gain.setTargetAtTime(1 - p.reverbMix, now, 0.5)
      this.wet.gain.setTargetAtTime(p.reverbMix, now, 0.5)
    }
  }

  /** Standpoint spatial attenuation + pan (not the body.volume fader). */
  setOutputSpatial(volumeScale: number, pan = 0): void {
    this.outputVolumeScale = Math.max(0, Math.min(1, Number.isFinite(volumeScale) ? volumeScale : 1))
    this.outputPan = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0))
    if (!this.ctx) return
    const now = this.ctx.currentTime
    this.bodyOut?.gain.setTargetAtTime(this.outputVolumeScale, now, 0.08)
    this.panner?.pan.setTargetAtTime(this.outputPan, now, 0.08)
  }

  /**
   * Current playback position normalised 0–1 within the play buffer.
   * null when not playing.
   */
  getPlayheadNormalized(): number | null {
    if (!this.playBuffer || !this.isPlaying) return null
    const elapsed = (performance.now() - this._startWallTimeMs) / 1000
    const dur     = this.playBuffer.duration
    const p       = this.params
    const isLoop  = p.playMode === 'loop' || p.playMode === 'pingpong'
    if (isLoop) {
      const loopS   = Math.max(0, Math.min(0.999, p.loopStart)) * dur
      const loopEnd = p.playMode === 'pingpong' ? dur : Math.max(loopS + 0.001, p.loopEnd) * dur
      const loopLen = Math.max(0.001, loopEnd - loopS)
      const pos     = loopS + (elapsed % loopLen)
      return Math.min(1, pos / dur)
    }
    return Math.min(1, Math.max(0, elapsed / dur))
  }

  /** Duration of the full raw decoded buffer in seconds. */
  getRawDuration(): number {
    return this.rawBuffer?.duration ?? 0
  }

  /**
   * Current playback position in seconds within the raw buffer.
   * Returns null when not playing.
   */
  getPlayheadSeconds(): number | null {
    const norm = this.getPlayheadNormalized()
    if (norm === null) return null
    const rawDur = this.rawBuffer?.duration ?? 0
    if (rawDur <= 0) return null
    // norm is 0-1 within playBuffer (sampleStart→sampleEnd slice).
    // Convert back to raw-buffer seconds.
    const { sampleStart, sampleEnd } = this.params
    return (sampleStart + norm * (sampleEnd - sampleStart)) * rawDur
  }

  /** Connect to rack bus input node. */
  getOutputNode(): AudioNode { return this.panner! }

  /** URL of the currently loaded sample (empty string if none). */
  get sampleUrl(): string { return this.loadedUrl }
}
