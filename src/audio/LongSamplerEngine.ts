import * as Tone from 'tone'

export type LongSamplerState = 'idle' | 'loading' | 'playing'
export type LongSamplerRetriggerMode = 'ignore' | 'restart'
export type LongSamplerEndMode = 'oneshot' | 'wander'
export type LongSamplerStartMode = 'fixed' | 'random'

export type LongSamplerTriggerOptions = {
  duration: number
  durationExpression: string
  startMode: LongSamplerStartMode
  start: number
  pitchSemitones: number
  fadeIn: number
  fadeOut: number
  retrigger: LongSamplerRetriggerMode
  endMode: LongSamplerEndMode
}

export type LongSamplerPlaybackSnapshot = {
  durationExpression: string
  targetDuration: number
  actualDuration: number
  startOffset: number
  pitchSemitones: number
  capturedAt: number
}

const bodyEngines = new Map<string, LongSamplerEngine>()

export function getBodyLongSamplerEngine(bodyId: string): LongSamplerEngine | null {
  return bodyEngines.get(bodyId) ?? null
}

export function registerBodyLongSamplerEngine(bodyId: string, engine: LongSamplerEngine): void {
  bodyEngines.set(bodyId, engine)
}

export function unregisterBodyLongSamplerEngine(bodyId: string): void {
  bodyEngines.delete(bodyId)
}

export class LongSamplerEngine {
  private ctx: AudioContext | null = null
  private buffer: AudioBuffer | null = null
  private outputGain: GainNode | null = null
  private currentSource: AudioBufferSourceNode | null = null
  private currentFadeGain: GainNode | null = null
  private loadedUrl = ''
  private loadPromise: Promise<void> | null = null
  private generation = 0
  private startWallMs = 0
  private playDuration = 0
  private lastOptions: LongSamplerTriggerOptions | null = null
  private playbackSnapshot: LongSamplerPlaybackSnapshot | null = null

  state: LongSamplerState = 'idle'
  onStateChange?: (state: LongSamplerState) => void

  private setState(state: LongSamplerState): void {
    this.state = state
    this.onStateChange?.(state)
  }

  private async ensureContext(): Promise<AudioContext> {
    if (this.ctx) return this.ctx
    await Tone.start()
    this.ctx = Tone.getContext().rawContext as AudioContext
    this.outputGain = this.ctx.createGain()
    this.outputGain.gain.value = 1
    return this.ctx
  }

  async init(): Promise<void> {
    await this.ensureContext()
  }

  async loadSample(url: string): Promise<void> {
    if (url === this.loadedUrl && this.buffer) return
    if (this.loadPromise) {
      await this.loadPromise
      if (url === this.loadedUrl && this.buffer) return
    }
    this.setState('loading')
    this.loadPromise = (async () => {
      try {
        const ctx = await this.ensureContext()
        const response = await fetch(url)
        const data = await response.arrayBuffer()
        this.buffer = await ctx.decodeAudioData(data)
        this.loadedUrl = url
        this.setState('idle')
      } catch (error) {
        console.warn('[LongSamplerEngine] load failed', error)
        this.setState('idle')
      } finally {
        this.loadPromise = null
      }
    })()
    await this.loadPromise
  }

  trigger(options: LongSamplerTriggerOptions): boolean {
    if (!this.ctx || !this.buffer || !this.outputGain) return false
    if (this.state === 'playing' && options.retrigger === 'ignore') return true
    this.generation += 1
    this.stopCurrent(0.03, false)
    this.lastOptions = { ...options }
    this.startSegment(this.generation, options)
    return true
  }

  private startSegment(generation: number, options: LongSamplerTriggerOptions): void {
    if (!this.ctx || !this.buffer || !this.outputGain || generation !== this.generation) return

    const now = this.ctx.currentTime
    const rate = Math.pow(2, Math.max(-3, Math.min(3, options.pitchSemitones)) / 12)
    const requestedDuration = Math.max(0.1, options.duration)
    const sourceSpan = requestedDuration * rate
    const maxStart = Math.max(0, this.buffer.duration - Math.min(sourceSpan, this.buffer.duration))
    const normalizedStart = Math.max(0, Math.min(1, options.start))
    const startOffset = options.startMode === 'random'
      ? Math.random() * maxStart
      : normalizedStart * maxStart
    const availableSource = Math.max(0.01, this.buffer.duration - startOffset)
    const sourceDuration = Math.min(sourceSpan, availableSource)
    const actualDuration = sourceDuration / rate
    const fadeIn = Math.min(Math.max(0, options.fadeIn), actualDuration / 2)
    const fadeOut = Math.min(Math.max(0, options.fadeOut), actualDuration / 2)

    const source = this.ctx.createBufferSource()
    source.buffer = this.buffer
    source.playbackRate.value = rate

    const fade = this.ctx.createGain()
    fade.gain.setValueAtTime(fadeIn > 0 ? 0 : 1, now)
    if (fadeIn > 0) fade.gain.linearRampToValueAtTime(1, now + fadeIn)
    const fadeOutAt = Math.max(now + fadeIn, now + actualDuration - fadeOut)
    fade.gain.setValueAtTime(1, fadeOutAt)
    if (fadeOut > 0) fade.gain.linearRampToValueAtTime(0, now + actualDuration)

    source.connect(fade)
    fade.connect(this.outputGain)
    source.start(now, startOffset, sourceDuration)
    source.stop(now + actualDuration)

    this.currentSource = source
    this.currentFadeGain = fade
    this.startWallMs = performance.now()
    this.playDuration = actualDuration
    this.playbackSnapshot = {
      durationExpression: options.durationExpression,
      targetDuration: requestedDuration,
      actualDuration,
      startOffset,
      pitchSemitones: Math.max(-3, Math.min(3, options.pitchSemitones)),
      capturedAt: Date.now(),
    }
    this.setState('playing')

    source.onended = () => {
      source.disconnect()
      fade.disconnect()
      if (generation !== this.generation || this.currentSource !== source) return
      this.currentSource = null
      this.currentFadeGain = null
      if (options.endMode === 'wander' && this.lastOptions) {
        this.startSegment(generation, this.lastOptions)
      } else {
        this.setState('idle')
      }
    }
  }

  private stopCurrent(fadeSeconds: number, invalidate = true): void {
    if (invalidate) this.generation += 1
    const source = this.currentSource
    const fade = this.currentFadeGain
    this.currentSource = null
    this.currentFadeGain = null
    if (!source || !fade || !this.ctx) return
    const now = this.ctx.currentTime
    fade.gain.cancelScheduledValues(now)
    fade.gain.setValueAtTime(fade.gain.value, now)
    fade.gain.linearRampToValueAtTime(0, now + fadeSeconds)
    try { source.stop(now + fadeSeconds + 0.01) } catch { /* source already stopped */ }
  }

  stop(): void {
    this.stopCurrent(0.05)
    this.lastOptions = null
    this.setState('idle')
  }

  getPlayheadNorm(): number | null {
    if (this.state !== 'playing' || this.playDuration <= 0) return null
    return Math.min(1, Math.max(0, (performance.now() - this.startWallMs) / 1000 / this.playDuration))
  }

  getOutputNode(): GainNode { return this.outputGain! }
  get hasBuffer(): boolean { return this.buffer !== null }
  get sampleUrl(): string { return this.loadedUrl }
  get bufferDuration(): number { return this.buffer?.duration ?? 0 }
  get playbackDuration(): number { return this.playDuration }
  get snapshot(): LongSamplerPlaybackSnapshot | null { return this.playbackSnapshot }

  dispose(): void {
    this.stop()
    try { this.outputGain?.disconnect() } catch { /* node already disconnected */ }
    this.buffer = null
    this.outputGain = null
    this.ctx = null
    this.loadedUrl = ''
  }
}
