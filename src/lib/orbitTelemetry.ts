import type { PlanetBody } from '../store/planetStore'

export type OrbitTelemetryBody = {
  id: string
  name: string
  type: PlanetBody['type']
  mass: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  speed: number
  distance: number
  angleDeg: number
  norm: {
    mass: number
    x: number
    y: number
    z: number
    speed: number
    distance: number
    angle: number
  }
}

export type OrbitTelemetrySnapshot = {
  bodies: OrbitTelemetryBody[]
  whole: {
    bodyCount: number
    totalMass: number
    centerX: number
    centerY: number
    avgSpeed: number
    avgSpread: number
    zSpread: number
    nearestDistance: number
    norm: {
      totalMass: number
      avgSpeed: number
      avgSpread: number
      zSpread: number
      nearestDistance: number
    }
  }
}

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo))
}

function normSigned(v: number, scale: number): number {
  return clamp(v / (scale * 2) + 0.5)
}

export function computeOrbitTelemetry(bodies: Array<PlanetBody & { ax?: number; ay?: number }>): OrbitTelemetrySnapshot {
  if (bodies.length === 0) {
    return {
      bodies: [],
      whole: {
        bodyCount: 0,
        totalMass: 0,
        centerX: 0,
        centerY: 0,
        avgSpeed: 0,
        avgSpread: 0,
        zSpread: 0,
        nearestDistance: 0,
        norm: { totalMass: 0, avgSpeed: 0, avgSpread: 0, zSpread: 0, nearestDistance: 0 },
      },
    }
  }

  const totalMass = bodies.reduce((sum, b) => sum + Math.max(0, b.mass), 0)
  const centerX = bodies.reduce((sum, b) => sum + b.x * Math.max(0, b.mass), 0) / Math.max(0.0001, totalMass)
  const centerY = bodies.reduce((sum, b) => sum + b.y * Math.max(0, b.mass), 0) / Math.max(0.0001, totalMass)
  const speeds = bodies.map(b => Math.hypot(b.vx, b.vy))
  const avgSpeed = speeds.reduce((sum, speed) => sum + speed, 0) / bodies.length
  const spreads = bodies.map(b => Math.hypot(b.x - centerX, b.y - centerY))
  const avgSpread = spreads.reduce((sum, spread) => sum + spread, 0) / bodies.length
  const zValues = bodies.map(b => b.z ?? 0)
  const zSpread = Math.max(...zValues) - Math.min(...zValues)
  let nearestDistance = 0
  if (bodies.length > 1) {
    nearestDistance = Infinity
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        nearestDistance = Math.min(nearestDistance, Math.hypot(bodies[i].x - bodies[j].x, bodies[i].y - bodies[j].y))
      }
    }
  }
  if (!Number.isFinite(nearestDistance)) nearestDistance = 0

  const telemetryBodies = bodies.map((b, i) => {
    const distance = spreads[i]
    const angleDeg = Math.atan2(b.y - centerY, b.x - centerX) * 180 / Math.PI
    return {
      id: b.id,
      name: b.name,
      type: b.type,
      mass: b.mass,
      x: b.x,
      y: b.y,
      z: b.z ?? 0,
      vx: b.vx,
      vy: b.vy,
      speed: speeds[i],
      distance,
      angleDeg,
      norm: {
        mass: clamp(b.mass / 1000),
        x: normSigned(b.x, 1000),
        y: normSigned(b.y, 1000),
        z: normSigned(b.z ?? 0, 600),
        speed: clamp(speeds[i] / 4),
        distance: clamp(distance / 1000),
        angle: clamp((angleDeg + 180) / 360),
      },
    }
  })

  return {
    bodies: telemetryBodies,
    whole: {
      bodyCount: bodies.length,
      totalMass,
      centerX,
      centerY,
      avgSpeed,
      avgSpread,
      zSpread,
      nearestDistance,
      norm: {
        totalMass: clamp(totalMass / 1600),
        avgSpeed: clamp(avgSpeed / 4),
        avgSpread: clamp(avgSpread / 900),
        zSpread: clamp(zSpread / 600),
        nearestDistance: nearestDistance > 0 ? clamp(1 - nearestDistance / 800) : 0,
      },
    },
  }
}
