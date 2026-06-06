// ── StretchSamplerEngine ──────────────────────────────────────────────────────
// Pitch-preserving time-stretch one-shot sampler.
//
// Design:
//  • trigger(playbackRate) starts playback with preservesPitch=true so the
//    browser applies phase-vocoder time-stretch: duration changes but pitch stays.
//  • Caller computes playbackRate = bufferDuration / targetPeriodSec.
//  • Re-triggering fades out the previous voice first (3ms).
//  • Output → fadeGain → outputGain → rack bus (wired by StretchSamplerLayer).

import * as Tone from 'tone'

export type StretchSamplerState = 'idle' | 'loading' | 'playing'
export type StretchSamplerTimingSnapshot = {
  expression: string
  sourceDuration: number
  targetDuration: number
  capturedAt: number
}

// ── Registry ──────────────────────────────────────────────────────────────────

const _engines = new Map<string, StretchSamplerEngine>()

export function getBodyStretchSamplerEngine(bodyId: string): StretchSamplerEngine | null {
  return _engines.get(bodyId) ?? null
}
export function registerBodyStretchSamplerEngine(bodyId: string, eng: StretchSamplerEngine): void {
  _engines.set(bodyId, eng)
}
export function unregisterBodyStretchSamplerEngine(bodyId: string): void {
  _engines.delete(bodyId)
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class StretchSamplerEngine {
  private ctx:         AudioContext | null = null
  private buffer:      AudioBuffer  | null = null
  private outputGain:  GainNode     | null = null

  private currentSource:   AudioBufferSourceNode | null = null
  private currentFadeGain: GainNode              | null = null

  private _loadedUrl    = ''
  private _loadPromise: Promise<void> | null = null
  private _startWallMs  = 0
  private _bufferDurSec = 0
  private _playDurSec   = 0
  private _timingSnapshot: StretchSamplerTimingSnapshot | null = null

  state: StretchSamplerState = 'idle'
  onStateChange?: (s: StretchSamplerState) => void

  startOffset = 0
  endOffset   = 1

  private _setState(s: StretchSamplerState): void {
    this.state = s
    this.onStateChange?.(s)
  }

  private async _ensureCtx(): Promise<AudioContext> {
    if (this.ctx) return this.ctx
    await Tone.start()
    this.ctx = Tone.getContext().rawContext as AudioContext
    this.outputGain = this.ctx.createGain()
    this.outputGain.gain.value = 1
    return this.ctx
  }

  async init(): Promise<void> {
    await this._ensureCtx()
  }

  async loadSample(url: string): Promise<void> {
    if (url === this._loadedUrl && this.buffer) return
    if (this._loadPromise) { await this._loadPromise; return }

    this._setState('loading')
    this._loadPromise = (async () => {
      try {
        const ctx = await this._ensureCtx()
        const resp = await fetch(url)
        const ab   = await resp.arrayBuffer()
        this.buffer        = await ctx.decodeAudioData(ab)
        this._loadedUrl    = url
        this._bufferDurSec = this.buffer.duration
        this._setState('idle')
      } catch (e) {
        console.warn('[StretchSamplerEngine] load failed', e)
        this._setState('idle')
      } finally {
        this._loadPromise = null
      }
    })()
    await this._loadPromise
  }

  /**
   * Trigger playback with pitch-preserving time-stretch.
   * @param playbackRate  bufferDuration / targetPeriodSec  (default 1 = no stretch)
   */
  trigger(playbackRate = 1, timing?: Omit<StretchSamplerTimingSnapshot, 'capturedAt'>): void {
    if (!this.ctx || !this.buffer || !this.outputGain) return

    const now = this.ctx.currentTime

    // Fade out previous voice
    if (this.currentSource && this.currentFadeGain) {
      const prev    = this.currentFadeGain
      const prevSrc = this.currentSource
      prev.gain.cancelScheduledValues(now)
      prev.gain.setValueAtTime(prev.gain.value, now)
      prev.gain.linearRampToValueAtTime(0, now + 0.003)
      setTimeout(() => {
        try { prevSrc.stop() } catch (_) {}
        prevSrc.disconnect()
        prev.disconnect()
      }, 20)
      this.currentSource   = null
      this.currentFadeGain = null
    }

    const source = this.ctx.createBufferSource()
    source.buffer = this.buffer
    source.loop   = false
    const rate = Math.max(0.01, Math.min(8, Number.isFinite(playbackRate) ? playbackRate : 1))
    source.playbackRate.value = rate

    // Pitch-preserving time stretch — browser applies phase vocoder
    const src = source as AudioBufferSourceNode & {
      preservesPitch?: boolean
      mozPreservesPitch?: boolean
      webkitPreservesPitch?: boolean
    }
    if ('preservesPitch' in src)        src.preservesPitch        = true
    if ('mozPreservesPitch' in src)     src.mozPreservesPitch     = true
    if ('webkitPreservesPitch' in src)  src.webkitPreservesPitch  = true

    const fadeGain = this.ctx.createGain()
    fadeGain.gain.setValueAtTime(0, now)
    fadeGain.gain.linearRampToValueAtTime(1, now + 0.005)

    source.connect(fadeGain)
    fadeGain.connect(this.outputGain)
    source.start(now)

    this.currentSource   = source
    this.currentFadeGain = fadeGain
    this._startWallMs    = performance.now()
    this._playDurSec     = this._bufferDurSec / rate
    this._timingSnapshot = timing
      ? { ...timing, targetDuration: this._playDurSec, capturedAt: Date.now() }
      : {
          expression: 'manual',
          sourceDuration: this._playDurSec,
          targetDuration: this._playDurSec,
          capturedAt: Date.now(),
        }
    this._setState('playing')

    source.onended = () => {
      if (this.currentSource === source) {
        source.disconnect()
        fadeGain.disconnect()
        this.currentSource   = null
        this.currentFadeGain = null
        this._setState('idle')
      }
    }
  }

  stop(): void {
    if (!this.ctx || !this.currentSource || !this.currentFadeGain) return
    const now = this.ctx.currentTime
    this.currentFadeGain.gain.cancelScheduledValues(now)
    this.currentFadeGain.gain.setValueAtTime(this.currentFadeGain.gain.value, now)
    this.currentFadeGain.gain.linearRampToValueAtTime(0, now + 0.01)
    const src  = this.currentSource
    const fade = this.currentFadeGain
    try { src.stop(now + 0.015) } catch (_) {}
    setTimeout(() => { src.disconnect(); fade.disconnect() }, 50)
    this.currentSource   = null
    this.currentFadeGain = null
    this._setState('idle')
  }

  /** Normalised position across the stretched output duration. */
  getPlayheadNorm(): number | null {
    if (this.state !== 'playing' || this._playDurSec <= 0) return null
    const elapsed = (performance.now() - this._startWallMs) / 1000
    return Math.min(1, Math.max(0, elapsed / this._playDurSec))
  }

  get bufferDuration(): number { return this._bufferDurSec }
  get playbackDuration(): number { return this._playDurSec }
  get timingSnapshot(): StretchSamplerTimingSnapshot | null { return this._timingSnapshot }
  get sampleUrl():      string { return this._loadedUrl }
  get hasBuffer():     boolean { return this.buffer !== null }

  getOutputNode(): GainNode { return this.outputGain! }

  dispose(): void {
    this.stop()
    try { this.outputGain?.disconnect() } catch (_) {}
    this.buffer     = null
    this.outputGain = null
    this.ctx        = null
    this._loadedUrl = ''
  }
}
