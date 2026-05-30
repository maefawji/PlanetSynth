// ── GranularEngine ─────────────────────────────────────────────────────────────
// Granular sampler using Tone.GrainPlayer.
// Plays micro-grains from an audio sample, creating ambient "cloud" textures.
//
// Signal flow:
//   GrainPlayer → outputGain → reverb (wet=reverbMix) → panner → finalOut
//   finalOut is NOT connected here — the layer wires it to the rack bus input.
//   finalOut persists across stop/start cycles so the bus connection survives.

import * as Tone from 'tone'

export interface GranularParams {
  volume:      number   // 0–1
  grainSize:   number   // grain duration seconds (0.02–0.5)
  overlap:     number   // crossfade overlap seconds (0.001–0.15)
  detune:      number   // pitch offset semitones (-24 to +24)
  reverbMix:   number   // 0–1
  playbackRate: number  // 0.1–4 (speed/pitch multiplier)
}

const DEFAULTS: GranularParams = {
  volume:      0.6,
  grainSize:   0.08,
  overlap:     0.04,
  detune:      0,
  reverbMix:   0.5,
  playbackRate: 1,
}

export class GranularEngine {
  private player:     Tone.GrainPlayer | null = null
  private reverb:     Tone.Reverb      | null = null
  private outputGain: Tone.Gain        | null = null
  private panner:     Tone.Panner      | null = null
  /** Persistent output node — survives stop/start cycles. Connect to rack bus. */
  private finalOut:   Tone.Gain        | null = null

  private loadedUrl        = ''
  private outputVolumeScale = 1
  private outputPan         = 0

  isPlaying = false
  params: GranularParams = { ...DEFAULTS }

  // ── Graph ─────────────────────────────────────────────────────────────────

  private buildGraph(): void {
    // Ensure persistent output node exists (survives teardown/rebuild cycles)
    if (!this.finalOut) this.finalOut = new Tone.Gain(1)

    // Create transient nodes (torn down on stop)
    this.reverb     = new Tone.Reverb({ decay: 14, preDelay: 0.05 })
    this.reverb.wet.value = this.params.reverbMix
    this.outputGain = new Tone.Gain(this.params.volume * this.outputVolumeScale)
    this.panner     = new Tone.Panner(this.outputPan)

    // Route: outputGain → reverb → panner → finalOut (not to destination)
    this.outputGain.connect(this.reverb)
    this.reverb.connect(this.panner)
    this.panner.connect(this.finalOut)
  }

  private teardownGraph(): void {
    // Dispose transient nodes — finalOut is kept alive for the bus connection
    try { this.reverb?.dispose()     } catch (_) {}
    try { this.outputGain?.dispose() } catch (_) {}
    try { this.panner?.dispose()     } catch (_) {}
    this.reverb     = null
    this.outputGain = null
    this.panner     = null
  }

  /** Return the persistent output node to connect to a rack bus input. */
  getOutputNode(): Tone.Gain {
    if (!this.finalOut) this.finalOut = new Tone.Gain(1)
    return this.finalOut
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(sampleUrl: string): Promise<void> {
    if (Tone.getContext().state !== 'running') return
    if (this.isPlaying && this.loadedUrl === sampleUrl) return

    // Tear down existing player if sample changed
    if (this.player) {
      try { this.player.stop(); this.player.dispose() } catch (_) {}
      this.player   = null
      this.loadedUrl = ''
    }

    if (!this.outputGain) this.buildGraph()

    this.player = new Tone.GrainPlayer({
      url:          sampleUrl,
      loop:         true,
      grainSize:    Math.max(0.01, this.params.grainSize),
      overlap:      Math.max(0.001, this.params.overlap),
      detune:       this.params.detune * 100,
      playbackRate: Math.max(0.1, this.params.playbackRate),
    })

    // Player → outputGain
    this.player.connect(this.outputGain!)
    this.loadedUrl = sampleUrl

    // Wait for buffer to load, then start
    try {
      await Tone.loaded()
    } catch (_) {
      return
    }

    if (Tone.getContext().state !== 'running') return
    try {
      this.player.start()
      this.isPlaying = true
    } catch (_) {}
  }

  stop(): void {
    if (!this.isPlaying) return
    this.isPlaying = false
    try { this.player?.stop() } catch (_) {}

    // Schedule cleanup after reverb tail
    const tailMs = Math.round((this.params.reverbMix > 0.01 ? 3 : 0.3) * 1000)
    setTimeout(() => {
      try { this.player?.dispose() } catch (_) {}
      this.player   = null
      this.loadedUrl = ''
      this.teardownGraph()
    }, tailMs + 200)
  }

  // ── Parameter updates ─────────────────────────────────────────────────────

  setParams(patch: Partial<GranularParams>): void {
    this.params = { ...this.params, ...patch }
    const p = this.params

    if (!this.player || !this.isPlaying) return

    if (patch.grainSize   !== undefined) this.player.grainSize    = Math.max(0.01, p.grainSize)
    if (patch.overlap     !== undefined) this.player.overlap      = Math.max(0.001, p.overlap)
    if (patch.detune      !== undefined) this.player.detune       = p.detune * 100
    if (patch.playbackRate !== undefined) this.player.playbackRate = Math.max(0.1, p.playbackRate)

    const vol = p.volume * this.outputVolumeScale
    this.outputGain?.gain.rampTo(Math.max(0.0001, vol), 0.1)

    if (patch.reverbMix !== undefined) {
      this.reverb?.wet.rampTo(Math.max(0, Math.min(1, p.reverbMix)), 0.3)
    }
  }

  setOutputSpatial(volumeScale: number, pan = 0): void {
    this.outputVolumeScale = Math.max(0, Math.min(1, Number.isFinite(volumeScale) ? volumeScale : 1))
    this.outputPan         = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0))
    if (!this.isPlaying) return
    this.outputGain?.gain.rampTo(Math.max(0.0001, this.params.volume * this.outputVolumeScale), 0.08)
    this.panner?.pan.rampTo(this.outputPan, 0.08)
  }
}
