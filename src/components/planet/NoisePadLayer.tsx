// ── NoisePadLayer ──────────────────────────────────────────────────────────────
// Headless component — renders nothing.
// Manages one NoisePadEngine per body whose effective noisePadType === 'noise'.
//
// Orbital mappings:
//   orbital period    → filter center frequency (fast orbit = high freq)
//   eccentricity      → filter Q (eccentric = more resonant)
//   distance from sun → motion LFO depth (far = slower, quieter)
//
// Performance: no React state, no store subscriptions.
// Sync runs at ~15fps via RealtimeSyncManager → syncAllNoisePadEngines().

import { useEffect, useRef } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import { useControlSetStore } from '../../store/controlSetStore'
import { setBodyOutputLevel, clearBodyOutputLevel } from '../../audio/bodyOutputMeter'
import { computeBodyRackOutputSpatial } from '../../audio/bodyRackOutput'
import { getBusInputNode, setBusVolume, retainBus, releaseBus } from '../../audio/rackBusMixer'
import { registerRealtimeSync, unregisterRealtimeSync } from '../../audio/realtimeSyncManager'
import { getPlanetLiveBodySnapshot } from './PlanetCanvas'
import { computeOrbitStats } from './DroneLayer'
import type { NoisePadEngine as NoisePadEngineType } from '../../audio/NoisePadEngine'

// ── Lazy import ───────────────────────────────────────────────────────────────

let NoisePadEngineCtor: typeof NoisePadEngineType | null = null
async function ensureCtor(): Promise<typeof NoisePadEngineType> {
  if (!NoisePadEngineCtor) {
    const m = await import('../../audio/NoisePadEngine')
    NoisePadEngineCtor = m.NoisePadEngine
  }
  return NoisePadEngineCtor
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }
function lerp(a: number, b: number, t: number) { return a + (b - a) * clamp(t, 0, 1) }

// ── Engine sync (module-level — reads store via getState, no React re-renders) ─

type EngineMap = Map<string, NoisePadEngineType>

async function syncAllNoisePadEngines(engines: EngineMap): Promise<void> {
  const { bodies, simParams } = usePlanetStore.getState()
  const { getBodyEffectiveParams } = useControlSetStore.getState()
  const G = simParams.G

  const activeIds     = new Set<string>()
  const liveBodies    = getPlanetLiveBodySnapshot()
  const liveById      = new Map(liveBodies.map(b => [b.id, b]))
  const effectiveBodies = bodies.map(body => {
    const live = liveById.get(body.id)
    return live ? { ...body, x: live.x, y: live.y, vx: live.vx, vy: live.vy, ax: live.ax, ay: live.ay } : body
  })

  for (const body of effectiveBodies) {
    const ep = getBodyEffectiveParams(body.id) as Record<string, unknown>
    const noisePadType = String(ep.noisePadType ?? 'off')
    if (noisePadType !== 'noise' || body.muted) continue

    activeIds.add(body.id)

    const volume    = Number(ep.noisePadVolume    ?? 0.3)
    let   freq      = Number(ep.noisePadFreq      ?? 600)
    let   q         = Number(ep.noisePadQ         ?? 8)
    let   motion    = 0.4
    const attack    = Number(ep.noisePadAttack    ?? 3.0)
    const release   = Number(ep.noisePadRelease   ?? 6.0)
    const reverbMix = Number(ep.noisePadReverbMix ?? 0.6)

    // Orbit-driven modulation
    const orbitStats = computeOrbitStats(body, effectiveBodies, G)
    if (orbitStats) {
      const { T_real, ecc, r } = orbitStats
      const tNorm = clamp((T_real - 0.3) / 24.7, 0, 1)
      const rNorm = clamp(r / 600, 0, 1)
      freq   = Math.round(lerp(3200, 120, tNorm * 0.6 + rNorm * 0.4))
      q      = clamp(2 + ecc * 16, 1, 20)
      motion = clamp(0.8 - rNorm * 0.5, 0.1, 0.9)
    }

    const outputSpatial = computeBodyRackOutputSpatial(body.id, effectiveBodies, simParams, ep as never)
    const bodyVol       = Math.max(0, Math.min(1, body.volume ?? 1))
    const finalLevel    = body.muted ? 0 : Math.max(0, Math.min(1, volume * outputSpatial.volume * bodyVol))
    setBodyOutputLevel(body.id, 'noisepad', finalLevel, 900)
    setBusVolume(body.id, body.muted ? 0 : bodyVol)

    let eng = engines.get(body.id)
    if (!eng) {
      const Ctor = await ensureCtor()
      eng = new Ctor()
      eng.setParams({ volume, freq, q, attack, release, reverbMix, motion })
      eng.setOutputSpatial(1, 0)   // rack bus handles standpoint spatial
      engines.set(body.id, eng)
      await eng.start()
      retainBus(body.id)
      eng.getOutputNode().connect(getBusInputNode(body.id))
    } else {
      eng.setParams({ volume, freq, q, attack, release, reverbMix, motion })
      eng.setOutputSpatial(1, 0)   // rack bus handles standpoint spatial
    }
  }

  for (const [id, eng] of engines) {
    if (!activeIds.has(id)) {
      eng.stop()
      engines.delete(id)
      releaseBus(id)
      clearBodyOutputLevel(id, 'noisepad')
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NoisePadLayer() {
  const enginesRef     = useRef<EngineMap>(new Map())
  const syncRunningRef = useRef(false)

  // 66ms sync via shared RealtimeSyncManager — no React state, no subscriptions
  useEffect(() => {
    registerRealtimeSync('noisepad', () => {
      if (syncRunningRef.current) return
      syncRunningRef.current = true
      syncAllNoisePadEngines(enginesRef.current).finally(() => { syncRunningRef.current = false })
    })
    return () => unregisterRealtimeSync('noisepad')
  }, [])

  // Stop all on unmount
  useEffect(() => {
    const engines = enginesRef.current
    return () => {
      for (const [id, eng] of engines) {
        eng.stop()
        releaseBus(id)
        clearBodyOutputLevel(id, 'noisepad')
      }
      engines.clear()
    }
  }, [])

  return null
}
