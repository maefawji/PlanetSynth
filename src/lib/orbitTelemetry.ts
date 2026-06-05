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
    // Extended metrics
    meanRadius: number         // mean distance from sun (fixed body or origin)
    radiusSpread: number       // std-dev of radii
    centerOffset: number       // distance of center-of-mass from sun
    angularMomentum: number    // |Σ m*(x*vy - y*vx)|
    phaseEntropy: number       // Shannon entropy of angle distribution [0,1]
    closePairCount: number     // pairs within threshold distance
    kineticEnergy: number      // Σ 0.5*m*v²  (log-compressed)
    tension: number            // 1 / nearestDistance (compressed)
    norm: {
      totalMass: number
      avgSpeed: number
      avgSpread: number
      zSpread: number
      nearestDistance: number
      meanRadius: number
      radiusSpread: number
      centerOffset: number
      angularMomentum: number
      phaseEntropy: number
      closePairCount: number
      kineticEnergy: number
      tension: number
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
  const ZERO_WHOLE = {
    bodyCount: 0, totalMass: 0, centerX: 0, centerY: 0,
    avgSpeed: 0, avgSpread: 0, zSpread: 0, nearestDistance: 0,
    meanRadius: 0, radiusSpread: 0, centerOffset: 0,
    angularMomentum: 0, phaseEntropy: 0, closePairCount: 0,
    kineticEnergy: 0, tension: 0,
    norm: {
      totalMass: 0, avgSpeed: 0, avgSpread: 0, zSpread: 0, nearestDistance: 0,
      meanRadius: 0, radiusSpread: 0, centerOffset: 0,
      angularMomentum: 0, phaseEntropy: 0, closePairCount: 0,
      kineticEnergy: 0, tension: 0,
    },
  }

  if (bodies.length === 0) {
    return { bodies: [], whole: ZERO_WHOLE }
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

  // ── Extended metrics ──────────────────────────────────────────────────────

  // Sun position (use first fixed body, or origin)
  const sun = bodies.find(b => b.type === 'sun' || b.fixed) ?? { x: 0, y: 0, mass: 1 }

  // meanRadius: mean distance from sun
  const radii = bodies.filter(b => b !== sun).map(b => Math.hypot(b.x - sun.x, b.y - sun.y))
  const meanRadius = radii.length > 0 ? radii.reduce((s, r) => s + r, 0) / radii.length : 0

  // radiusSpread: std-dev of radii
  const radiusSpread = radii.length > 1
    ? Math.sqrt(radii.reduce((s, r) => s + (r - meanRadius) ** 2, 0) / radii.length)
    : 0

  // centerOffset: distance of center-of-mass from sun
  const centerOffset = Math.hypot(centerX - sun.x, centerY - sun.y)

  // angularMomentum: |Σ m*(x*vy - y*vx)| normalized by total mass
  const angMom = bodies.reduce((s, b) => s + b.mass * (b.x * b.vy - b.y * b.vx), 0)
  const angularMomentum = Math.abs(angMom) / Math.max(1, totalMass)

  // phaseEntropy: Shannon entropy of angle distribution (divide circle into 8 bins)
  const BINS = 8
  const angleBins = new Array(BINS).fill(0)
  const planetBodies = bodies.filter(b => b !== sun)
  if (planetBodies.length > 0) {
    for (const b of planetBodies) {
      const a = Math.atan2(b.y - sun.y, b.x - sun.x) // -π..π
      const bin = Math.floor(((a + Math.PI) / (2 * Math.PI)) * BINS) % BINS
      angleBins[bin]++
    }
    // normalize to probabilities
    const n = planetBodies.length
    let entropy = 0
    for (const cnt of angleBins) {
      if (cnt > 0) {
        const p = cnt / n
        entropy -= p * Math.log2(p)
      }
    }
    var phaseEntropy = entropy / Math.log2(BINS) // [0,1]
  } else {
    var phaseEntropy = 0
  }

  // closePairCount: pairs within threshold
  const CLOSE_THRESHOLD = 200
  let closePairCount = 0
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      if (Math.hypot(bodies[i].x - bodies[j].x, bodies[i].y - bodies[j].y) < CLOSE_THRESHOLD) closePairCount++
    }
  }

  // kineticEnergy: Σ 0.5*m*v², log-compressed
  const ke = bodies.reduce((s, b) => s + 0.5 * b.mass * (b.vx ** 2 + b.vy ** 2), 0)
  const kineticEnergy = ke

  // tension: 1/nearestDistance
  const tension = nearestDistance > 0.1 ? 1 / nearestDistance : 10

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
      totalMass, centerX, centerY,
      avgSpeed, avgSpread, zSpread, nearestDistance,
      meanRadius, radiusSpread, centerOffset,
      angularMomentum, phaseEntropy, closePairCount, kineticEnergy, tension,
      norm: {
        totalMass: clamp(totalMass / 1600),
        avgSpeed: clamp(avgSpeed / 4),
        avgSpread: clamp(avgSpread / 900),
        zSpread: clamp(zSpread / 600),
        nearestDistance: nearestDistance > 0 ? clamp(1 - nearestDistance / 800) : 0,
        meanRadius: clamp(meanRadius / 1000),
        radiusSpread: clamp(radiusSpread / 500),
        centerOffset: clamp(centerOffset / 600),
        angularMomentum: clamp(angularMomentum / 2000),
        phaseEntropy,  // already [0,1]
        closePairCount: clamp(closePairCount / 6),
        kineticEnergy: clamp(Math.log1p(kineticEnergy) / Math.log1p(50000)),
        tension: clamp(tension / 0.05),
      },
    },
  }
}
