import * as Tone from 'tone'

let _unlocked = false
let _pending: Promise<void> | null = null

export function unlockMobileAudio(): Promise<void> {
  if (_unlocked) return Promise.resolve()
  if (_pending) return _pending

  _pending = (async () => {
    await Tone.start()
    const ctx = Tone.getContext().rawContext as AudioContext
    if (ctx.state === 'suspended') await ctx.resume()

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    gain.gain.value = 0.00001
    osc.frequency.value = 440
    osc.connect(gain)
    gain.connect(ctx.destination)
    const now = ctx.currentTime
    osc.start(now)
    osc.stop(now + 0.03)
    window.setTimeout(() => {
      try { osc.disconnect(); gain.disconnect() } catch (_) {}
    }, 100)

    _unlocked = ctx.state === 'running'
  })().catch(() => {
    _unlocked = false
  }).finally(() => {
    _pending = null
  })

  return _pending
}

