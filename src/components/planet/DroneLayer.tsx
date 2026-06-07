// ── DroneLayer ────────────────────────────────────────────────────────────────
// Headless component — renders nothing.
// Watches planet bodies + rack assignments and keeps one PadDroneEngine
// instance alive per body whose effective droneType === 'pad'.
//
// Drone modes:
//   'manual' → use params as-is from rack / body fields
//   'orbit'  → compute brightness/melt/motion/detune/attack/release from orbital
//              mechanics; rootNote/volume/reverbMix remain manual

import { useEffect, useRef } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import { useControlSetStore } from '../../store/controlSetStore'
import type { PlanetBody } from '../../store/planetStore'
import type { PadDroneParams, PadDroneEngine as PadDroneEngineType } from '../../audio/PadDroneEngine'
import { setBodyOutputLevel, clearBodyOutputLevel } from '../../audio/bodyOutputMeter'
import { computeBodyRackOutputSpatial } from '../../audio/bodyRackOutput'
import { getBusInputNode, setBusVolume, retainBus, releaseBus } from '../../audio/rackBusMixer'
import { registerRealtimeSync, unregisterRealtimeSync } from '../../audio/realtimeSyncManager'
import { getPlanetLiveBodySnapshot } from './PlanetCanvas'

// ── Lazy import ───────────────────────────────────────────────────────────────

let PadDroneEngineCtor: typeof PadDroneEngineType | null = null
async function ensureCtor(): Promise<typeof PadDroneEngineType> {
  if (!PadDroneEngineCtor) {
    const m = await import('../../audio/PadDroneEngine')
    PadDroneEngineCtor = m.PadDroneEngine
  }
  return PadDroneEngineCtor
}

// ── Orbit-mode computation ────────────────────────────────────────────────────

function _clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }
function _lerp(a: number, b: number, t: number) { return a + (b - a) * _clamp(t, 0, 1) }

// ── Raw orbital statistics ─────────────────────────────────────────────────

/** Raw orbital state for a body, relative to the heaviest neighbour. */
export type OrbitStats = {
  /** Orbital period in real seconds (clamped 0.3 – 25 s) */
  T_real: number
  /** Eccentricity [0 = circular … 1 = parabolic escape] */
  ecc: number
  /** Distance to the gravitational centre (world units) */
  r: number
  /** Current speed magnitude */
  speed: number
  /** Current acceleration magnitude */
  acc: number
  /** True when specific orbital energy < 0 (gravitationally bound) */
  bound: boolean
  /** Name of the body acting as the gravitational centre */
  centerName: string
}

/**
 * Compute raw orbital statistics for `body` relative to the heaviest neighbour.
 * Returns null when the body is isolated (no other bodies present).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function computeOrbitStats(
  body: PlanetBody,
  bodies: PlanetBody[],
  G: number,
): OrbitStats | null {
  const others = bodies.filter(b => b.id !== body.id)
  if (others.length === 0) return null

  // Treat the heaviest body as the gravitational centre
  const center = others.reduce((best, b) => b.mass > best.mass ? b : best)
  const dx    = body.x - center.x
  const dy    = body.y - center.y
  const r     = Math.max(1, Math.hypot(dx, dy))
  const speed = Math.hypot(body.vx, body.vy)
  const motion = body as PlanetBody & { ax?: number; ay?: number }
  const acc   = Math.hypot(motion.ax ?? 0, motion.ay ?? 0)
  const mu    = G * (center.mass + body.mass)

  // Specific orbital energy (negative = bound)
  const energy = 0.5 * speed * speed - mu / r
  const bound  = energy < -0.001 && mu > 0.001

  let T_real: number
  let ecc: number

  if (bound) {
    const a    = Math.max(1, -mu / (2 * energy))
    const T_sim = 2 * Math.PI * Math.sqrt(a ** 3 / mu)
    // Sim-time → real seconds (default params: dt=0.2, SPF=4, ~60 fps ≈ /48)
    T_real = _clamp(T_sim / 48, 0.3, 25)
    // Angular momentum → eccentricity
    const h  = Math.abs(dx * body.vy - dy * body.vx)
    const e2 = _clamp(1 + (2 * energy * h * h) / (mu * mu), 0, 1)
    ecc = Math.sqrt(e2)
  } else {
    // Unbound / degenerate — rough estimate from current speed
    const vCirc = mu > 0.001 ? Math.sqrt(mu / r) : speed
    T_real = _clamp(2 * Math.PI * r / Math.max(speed, vCirc * 0.01) / 48, 0.3, 25)
    // Speed ratio to circular → proxy for eccentricity
    ecc = _clamp(Math.abs(speed / Math.max(0.01, vCirc) - 1) * 0.8, 0, 0.95)
  }

  return { T_real, ecc, r, speed, acc, bound, centerName: center.name }
}

/**
 * Compute PadDroneParams driven by a body's orbital state.
 * Maps: orbital period → attack/release/brightness/motion
 *       eccentricity  → melt/detune
 *       distance      → brightness tint
 * rootNote, volume, reverbMix remain caller-supplied.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function computeOrbitDroneParams(
  body: PlanetBody,
  bodies: PlanetBody[],
  G: number,
): Pick<PadDroneParams, 'brightness' | 'melt' | 'motion' | 'detune' | 'attack' | 'release'> {
  const defaults = { brightness: 600, melt: 0.25, motion: 0.2, detune: 5, attack: 5.0, release: 10.0 }
  const stats = computeOrbitStats(body, bodies, G)
  if (!stats) return defaults  // isolated body — slow atmospheric defaults

  const { T_real, ecc, r } = stats

  // ── Normalise ─────────────────────────────────────────────────────────────
  const tNorm = (T_real - 0.3) / 24.7   // [0 = fast 0.3 s, 1 = slow 25 s]
  const rNorm = _clamp(r / 600, 0, 1)   // [0 = close, 1 = far 600 world-units]

  // ── Audio mappings ────────────────────────────────────────────────────────
  // Brightness: close + fast orbit = bright; far + slow = dark
  const brightness = Math.round(_lerp(4200, 320, tNorm * 0.55 + rNorm * 0.45))

  // Melt: high eccentricity drives filter sweep depth
  const melt = _clamp(0.12 + ecc * 0.78, 0.1, 0.9)

  // Motion: fast orbit = fast LFO flutter
  const motion = _clamp(0.88 - tNorm * 0.68, 0.12, 0.88)

  // Detune: eccentric + distant = wider voice spread
  const detune = Math.round(_lerp(2, 22, ecc * 0.72 + rNorm * 0.28))

  // Attack / Release scale with period (short orbit → punchy, long orbit → slow fade)
  const attack  = _clamp(T_real * 0.15, 0.3, 6.0)
  const release = _clamp(T_real * 0.35, 0.8, 14.0)

  return { brightness, melt, motion, detune, attack, release }
}

// ── Engine sync (module-level — reads store via getState, no React re-renders) ─

type EngineMap = Map<string, PadDroneEngineType>

async function syncAllDroneEngines(engines: EngineMap): Promise<void> {
  const { bodies, simParams } = usePlanetStore.getState()
  const { getBodyEffectiveParams } = useControlSetStore.getState()
  const G = simParams.G

  const activeIds     = new Set<string>()
  const liveBodies    = getPlanetLiveBodySnapshot()
  const liveById      = new Map(liveBodies.map(b => [b.id, b]))
  const effectiveBodies = bodies.map(body => {
    const live = liveById.get(body.id)
    return live
      ? { ...body, x: live.x, y: live.y, vx: live.vx, vy: live.vy, ax: live.ax, ay: live.ay }
      : body
  })

  for (const body of effectiveBodies) {
    const ep = getBodyEffectiveParams(body.id) as Record<string, unknown>

    const droneType = String(ep.droneType ?? body.droneType ?? 'none')
    if (droneType !== 'pad' || body.muted) continue

    activeIds.add(body.id)

    const droneMode = String(ep.droneMode ?? body.droneMode ?? 'manual')

    // Resolve base params (rack override > body field > default)
    const rootNote  = String(ep.droneRootNote  ?? body.droneRootNote  ?? 'A2')
    const volume    = Number(ep.droneVolume     ?? body.droneVolume    ?? 0.35)
    const reverbMix = Number(ep.droneReverbMix  ?? body.droneReverbMix ?? 0.55)
    const outputSpatial   = computeBodyRackOutputSpatial(body.id, effectiveBodies, simParams, ep)
    const bodyVol         = Math.max(0, Math.min(1, body.volume ?? 1))
    const finalOutputLevel = body.muted ? 0 : Math.max(0, Math.min(1, volume * outputSpatial.volume * bodyVol))
    setBodyOutputLevel(body.id, 'drone', finalOutputLevel, 900)
    setBusVolume(body.id, body.muted ? 0 : bodyVol)

    // Timbral params — overridden by orbit mode if active
    let brightness = Number(ep.droneBrightness ?? body.droneBrightness ?? 1200)
    let melt       = Number(ep.droneMelt        ?? body.droneMelt       ?? 0.5)
    let detune     = Number(ep.droneDetune      ?? body.droneDetune     ?? 8)
    let motion     = Number(ep.droneMotion      ?? body.droneMotion     ?? 0.4)
    let attack     = Number(ep.droneAttack      ?? body.droneAttack     ?? 6.0)
    let release    = Number(ep.droneRelease     ?? body.droneRelease    ?? 12.0)

    if (droneMode === 'orbit') {
      const orb = computeOrbitDroneParams(body, effectiveBodies, G)
      brightness = orb.brightness
      melt       = orb.melt
      motion     = orb.motion
      detune     = orb.detune
      attack     = orb.attack
      release    = orb.release
    }

    let eng = engines.get(body.id)
    if (!eng) {
      const Ctor = await ensureCtor()
      eng = new Ctor()
      eng.setRootNote(rootNote)
      eng.setParams({ volume, brightness, melt, detune, motion, attack, release, reverbMix })
      eng.setOutputSpatial(outputSpatial.volume, outputSpatial.pan)
      engines.set(body.id, eng)
      await eng.start()
      retainBus(body.id)
      eng.getOutputNode().connect(getBusInputNode(body.id))
    } else {
      eng.setRootNote(rootNote)
      eng.setParams({ volume, brightness, melt, detune, motion, attack, release, reverbMix })
      eng.setOutputSpatial(outputSpatial.volume, outputSpatial.pan)
    }
  }

  for (const [id, eng] of engines) {
    if (!activeIds.has(id)) {
      eng.stop()
      engines.delete(id)
      releaseBus(id)
      clearBodyOutputLevel(id, 'drone')
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DroneLayer() {
  const enginesRef     = useRef<EngineMap>(new Map())
  const syncRunningRef = useRef(false)

  // 66ms sync via shared RealtimeSyncManager — no React state, no subscriptions
  useEffect(() => {
    registerRealtimeSync('drone', () => {
      if (syncRunningRef.current) return
      syncRunningRef.current = true
      syncAllDroneEngines(enginesRef.current).finally(() => { syncRunningRef.current = false })
    })
    return () => unregisterRealtimeSync('drone')
  }, [])

  // Stop all on unmount
  useEffect(() => {
    const engines = enginesRef.current
    return () => {
      for (const [id, eng] of engines) {
        eng.stop()
        releaseBus(id)
        clearBodyOutputLevel(id, 'drone')
      }
      engines.clear()
    }
  }, [])

  return null
}
