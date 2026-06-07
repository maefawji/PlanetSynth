// ── OneShotSamplerEngine ──────────────────────────────────────────────────────
// Minimal Web Audio API sampler — one-shot playback only.
//
// Design principles:
//  • trigger() always starts from the beginning of the buffer
//  • Re-triggering while playing fades out the previous source (3ms) then starts fresh
//  • Each trigger creates a new AudioBufferSourceNode (nodes are single-use per spec)
//  • No loop, no pitch change, no time-stretch
//  • Output → gain node → rack bus (connected by SamplerLayer)
//
// Signal flow:
//   AudioBufferSourceNode → fadeGain(5ms ramp) → outputGain → [rack bus]

import * as Tone from 'tone'

export type OneShotState = 'idle' | 'loading' | 'playing'

// ── Body engine registry ───────────────────────────────────────────────────────
// Lets OneShotSamplerPanel call trigger by bodyId without holding a direct ref.

const _bodyEngines = new Map<string, OneShotSamplerEngine>()

export function getBodyOneShotEngine(bodyId: string): OneShotSamplerEngine | null {
  return _bodyEngines.get(bodyId) ?? null
}
export function registerBodyOneShotEngine(bodyId: string, eng: OneShotSamplerEngine): void {
  _bodyEngines.set(bodyId, eng)
}
export function unregisterBodyOneShotEngine(bodyId: string): void {
  _bodyEngines.delete(bodyId)
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class OneShotSamplerEngine {
  private ctx:         AudioContext | null = null
  private buffer:      AudioBuffer  | null = null
  private outputGain:  GainNode     | null = null

  private currentSource:   AudioBufferSourceNode | null = null
  private currentFadeGain: GainNode              | null = null

  private _loadedUrl    = ''
  private _loadPromise: Promise<void> | null = null
  private _startWallMs  = 0
  private _bufferDurSec = 0

  state: OneShotState = 'idle'
  /** Called whenever state transitions. Safe to reassign at any time. */
  onStateChange?: (s: OneShotState) => void

  /** Normalized start offset [0,1]. Applies on next trigger(). */
  startOffset = 0
  /** Normalized end offset [0,1]. 1 = play to end. Applies on next trigger(). */
  endOffset   = 1

  // ── Internal helpers ────────────────────────────────────────────────────────

  private _setState(s: OneShotState): void {
    this.state = s
    this.onStateChange?.(s)
  }

  private async _ensureCtx(): Promise<AudioContext> {
    if (this.ctx) return this.ctx
    await Tone.start()
    this.ctx = Tone.getContext().rawContext as AudioContext
    this.outputGain = this.ctx.createGain()
    this.outputGain.gain.value = 1
    // Note: outputGain is intentionally left unconnected here.
    // SamplerLayer wires it to the rack bus via getOutputNode().
    return this.ctx
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Initialise the audio context/output without loading a sample yet. */
  async init(): Promise<void> {
    await this._ensureCtx()
  }

  /** Load sample from objectUrl. No-op if url is already loaded. */
  async loadSample(url: string): Promise<void> {
    if (url === this._loadedUrl && this.buffer) return
    if (this._loadPromise) { await this._loadPromise; return }

    this._setState('loading')
    this._loadPromise = (async () => {
      try {
        const ctx = await this._ensureCtx()
        const resp = await fetch(url)
        const ab   = await resp.arrayBuffer()
        this.buffer      = await ctx.decodeAudioData(ab)
        this._loadedUrl  = url
        this._bufferDurSec = this.buffer.duration
        this._setState('idle')
      } catch (e) {
        console.warn('[OneShotSamplerEngine] load failed', e)
        this._setState('idle')
      } finally {
        this._loadPromise = null
      }
    })()
    await this._loadPromise
  }

  /**
   * Trigger one-shot playback from buffer start. Stops any in-progress playback first.
   * @param playbackRate Optional playback rate (default 1.0). Pass the orbit-stretch
   *   rate here when using instrument-oneshot-stretch.
   */
  trigger(playbackRate = 1): void {
    if (!this.ctx || !this.buffer || !this.outputGain) return

    const now = this.ctx.currentTime

    // ── Fade out and disconnect previous source ──────────────────────────────
    if (this.currentSource && this.currentFadeGain) {
      const prev = this.currentFadeGain
      prev.gain.cancelScheduledValues(now)
      prev.gain.setValueAtTime(prev.gain.value, now)
      prev.gain.linearRampToValueAtTime(0, now + 0.003)   // 3ms fade-out
      const prevSrc = this.currentSource
      setTimeout(() => {
        try { prevSrc.stop() } catch { /* noop */ }
        prevSrc.disconnect()
        prev.disconnect()
      }, 20)
      this.currentSource   = null
      this.currentFadeGain = null
    }

    // ── Create new source ────────────────────────────────────────────────────
    const source   = this.ctx.createBufferSource()
    source.buffer  = this.buffer
    source.loop    = false
    source.playbackRate.value = Math.max(0.01, Math.min(8, Number.isFinite(playbackRate) ? playbackRate : 1))

    const fadeGain = this.ctx.createGain()
    fadeGain.gain.setValueAtTime(0, now)
    fadeGain.gain.linearRampToValueAtTime(1, now + 0.005) // 5ms fade-in

    source.connect(fadeGain)
    fadeGain.connect(this.outputGain)
    source.start(now)

    this.currentSource   = source
    this.currentFadeGain = fadeGain
    this._startWallMs    = performance.now()
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

  /** Stop playback with a short fade-out. */
  stop(): void {
    if (!this.ctx || !this.currentSource || !this.currentFadeGain) return
    const now = this.ctx.currentTime
    this.currentFadeGain.gain.cancelScheduledValues(now)
    this.currentFadeGain.gain.setValueAtTime(this.currentFadeGain.gain.value, now)
    this.currentFadeGain.gain.linearRampToValueAtTime(0, now + 0.01)
    const src  = this.currentSource
    const fade = this.currentFadeGain
    try { src.stop(now + 0.015) } catch { /* noop */ }
    setTimeout(() => { src.disconnect(); fade.disconnect() }, 50)
    this.currentSource   = null
    this.currentFadeGain = null
    this._setState('idle')
  }

  /** Normalised playback position 0–1, or null when idle/loading. */
  getPlayheadNorm(): number | null {
    if (this.state !== 'playing' || this._bufferDurSec <= 0) return null
    const elapsed = (performance.now() - this._startWallMs) / 1000
    return Math.min(1, Math.max(0, elapsed / this._bufferDurSec))
  }

  /** Duration of loaded buffer in seconds. 0 if not loaded. */
  get bufferDuration(): number { return this._bufferDurSec }

  /** URL of the currently loaded sample, empty string if none. */
  get sampleUrl(): string { return this._loadedUrl }

  /** True if a buffer is ready to play. */
  get hasBuffer(): boolean { return this.buffer !== null }

  /** The GainNode to wire into the rack bus. */
  getOutputNode(): GainNode { return this.outputGain! }

  dispose(): void {
    this.stop()
    try { this.outputGain?.disconnect() } catch { /* noop */ }
    this.buffer      = null
    this.outputGain  = null
    this.ctx         = null
    this._loadedUrl  = ''
  }
}
