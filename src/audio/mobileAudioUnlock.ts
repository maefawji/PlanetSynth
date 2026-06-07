import * as Tone from 'tone'

let _unlocked = false
let _pending: Promise<void> | null = null

function kickSilent(ctx: AudioContext): void {
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
    try { osc.disconnect(); gain.disconnect() } catch { /* noop */ }
  }, 100)
}

export function unlockMobileAudio(): Promise<void> {
  if (_unlocked) return Promise.resolve()
  const ctx = Tone.getContext().rawContext as AudioContext

  try {
    void ctx.resume()
    kickSilent(ctx)
  } catch { /* noop */ }

  if (_pending) return _pending

  _pending = (async () => {
    await Tone.start()
    if (ctx.state === 'suspended') await ctx.resume()
    _unlocked = ctx.state === 'running'
  })().catch(() => {
    _unlocked = false
  }).finally(() => {
    _pending = null
  })

  return _pending
}
