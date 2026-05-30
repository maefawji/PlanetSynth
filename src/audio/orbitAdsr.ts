export interface AdsrEnvelope {
  attack: number
  decay: number
  sustain: number
  release: number
}

export interface OrbitAdsrBody {
  id: string
  mass: number
  x: number
  y: number
  vx: number
  vy: number
}

export const ADSR_OFF: AdsrEnvelope = {
  attack: 0,
  decay: 0,
  sustain: 1,
  release: 0,
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function dist(a: OrbitAdsrBody, b: OrbitAdsrBody): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function fallbackAdsr(body: OrbitAdsrBody): AdsrEnvelope {
  const speed = Math.hypot(body.vx, body.vy)
  return {
    attack: clamp(0.7 / (speed + 0.35), 0.02, 1.2),
    decay: 0.45,
    sustain: 0.75,
    release: clamp(1.2 / (speed + 0.4), 0.2, 2.2),
  }
}

export function computeOrbitAdsr(
  body: OrbitAdsrBody,
  bodies: OrbitAdsrBody[],
  G: number,
): AdsrEnvelope {
  const central = bodies
    .filter(b => b.id !== body.id)
    .sort((a, b) => b.mass - a.mass)[0]

  if (!central || central.mass <= 0 || G <= 0) return fallbackAdsr(body)

  const rx = body.x - central.x
  const ry = body.y - central.y
  const vx = body.vx - central.vx
  const vy = body.vy - central.vy
  const r = Math.max(0.001, Math.hypot(rx, ry))
  const v = Math.hypot(vx, vy)
  const mu = G * (central.mass + body.mass)
  const energy = (v * v) / 2 - mu / r

  if (!isFinite(energy) || energy >= -0.000001) return fallbackAdsr(body)

  const a = -mu / (2 * energy)
  if (!isFinite(a) || a <= 0) return fallbackAdsr(body)

  const h = rx * vy - ry * vx
  const e = clamp(Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu))), 0, 0.98)
  const peri = Math.max(0.001, a * (1 - e))
  const apo = Math.max(peri + 0.001, a * (1 + e))
  const periSpeed = Math.sqrt(Math.max(0.001, mu * (2 / peri - 1 / a)))
  const circularSpeedHere = Math.sqrt(Math.max(0.001, mu / r))
  const speedRatio = clamp(periSpeed / circularSpeedHere, 0.25, 8)
  const period = 2 * Math.PI * Math.sqrt((a * a * a) / mu)

  const distanceScale = clamp(peri / Math.max(1, dist(body, central)), 0.1, 2)
  const attack = clamp(0.55 * distanceScale / Math.pow(speedRatio, 1.35), 0.012, 1.4)
  const decay = clamp(0.08 + Math.pow(e, 0.75) * 2.4, 0.04, 2.8)
  const sustain = clamp(peri / apo, 0.12, 1)
  const release = clamp(period * 0.004, 0.15, 5)

  return { attack, decay, sustain, release }
}
