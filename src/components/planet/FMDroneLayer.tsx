// ── FMDroneLayer ───────────────────────────────────────────────────────────────
// Headless component — renders nothing.
// Manages one FMDroneEngine per body whose effective fmDroneType === 'fm'.
//
// Orbital mappings (auto-computed from body mechanics):
//   eccentricity → fmIndex (eccentric orbit = richer FM timbre)
//   orbital period → brightness (fast orbit = bright filter)
//   distance → slight frequency drift
//
// Performance: no React state, no store subscriptions.
// Sync runs at ~15fps via RealtimeSyncManager → syncAllFMDroneEngines().

import { useEffect, useRef } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import { useControlSetStore } from '../../store/controlSetStore'
import { setBodyOutputLevel, clearBodyOutputLevel } from '../../audio/bodyOutputMeter'
import { computeBodyRackOutputSpatial } from '../../audio/bodyRackOutput'
import { getBusInputNode, setBusVolume, retainBus, releaseBus } from '../../audio/rackBusMixer'
import { registerRealtimeSync, unregisterRealtimeSync } from '../../audio/realtimeSyncManager'
import { getPlanetLiveBodySnapshot } from './PlanetCanvas'
import { computeOrbitStats } from './DroneLayer'
import type { FMDroneEngine as FMDroneEngineType } from '../../audio/FMDroneEngine'

// ── Lazy import ───────────────────────────────────────────────────────────────

let FMDroneEngineCtor: typeof FMDroneEngineType | null = null
async function ensureCtor(): Promise<typeof FMDroneEngineType> {
  if (!FMDroneEngineCtor) {
    const m = await import('../../audio/FMDroneEngine')
    FMDroneEngineCtor = m.FMDroneEngine
  }
  return FMDroneEngineCtor
}

function noteToFreq(note: string): number {
  const noteMap: Record<string, number> = {
    C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,
  }
  const m = note.match(/^([A-G][b#]?)(-?\d)$/)
  if (!m) return 110
  const midi = 12 * (Number(m[2]) + 1) + (noteMap[m[1]] ?? 0)
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }
function lerp(a: number, b: number, t: number) { return a + (b - a) * clamp(t, 0, 1) }

// ── Engine sync (module-level — reads store via getState, no React re-renders) ─

type EngineMap = Map<string, FMDroneEngineType>

async function syncAllFMDroneEngines(engines: EngineMap): Promise<void> {
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
    const fmType = String(ep.fmDroneType ?? 'off')
    if (fmType !== 'fm' || body.muted) continue

    activeIds.add(body.id)

    const rootNote  = String(ep.fmDroneRootNote  ?? 'A2')
    const rootFreq  = noteToFreq(rootNote)
    const   ratio     = Number(ep.fmDroneRatio    ?? 3)
    let   index     = Number(ep.fmDroneIndex    ?? 3)
    let   brightness = 2000
    const volume    = Number(ep.fmDroneVolume   ?? 0.35)
    const attack    = Number(ep.fmDroneAttack   ?? 4.0)
    const release   = Number(ep.fmDroneRelease  ?? 8.0)
    const reverbMix = Number(ep.fmDroneReverbMix ?? 0.5)

    // Orbit-driven modulation
    const orbitStats = computeOrbitStats(body, effectiveBodies, G)
    if (orbitStats) {
      const { T_real, ecc } = orbitStats
      const tNorm = clamp((T_real - 0.3) / 24.7, 0, 1)
      index      = clamp(index * (0.5 + ecc * 1.5), 0.2, 8)
      brightness = Math.round(lerp(4500, 400, tNorm))
    }

    const outputSpatial = computeBodyRackOutputSpatial(body.id, effectiveBodies, simParams, ep as never)
    const bodyVol       = Math.max(0, Math.min(1, body.volume ?? 1))
    const finalLevel    = body.muted ? 0 : Math.max(0, Math.min(1, volume * outputSpatial.volume * bodyVol))
    setBodyOutputLevel(body.id, 'fmdrone', finalLevel, 900)
    setBusVolume(body.id, body.muted ? 0 : bodyVol)

    let eng = engines.get(body.id)
    if (!eng) {
      const Ctor = await ensureCtor()
      eng = new Ctor()
      eng.setParams({ rootFreq, ratio, index, volume, brightness, attack, release, reverbMix })
      eng.setOutputSpatial(1, 0)   // rack bus handles standpoint spatial
      engines.set(body.id, eng)
      await eng.start()
      retainBus(body.id)
      eng.getOutputNode().connect(getBusInputNode(body.id))
    } else {
      eng.setRootNote(rootNote)
      eng.setRatio(ratio)
      eng.setParams({ rootFreq, index, volume, brightness, attack, release, reverbMix })
      eng.setOutputSpatial(1, 0)   // rack bus handles standpoint spatial
    }
  }

  for (const [id, eng] of engines) {
    if (!activeIds.has(id)) {
      eng.stop()
      engines.delete(id)
      releaseBus(id)
      clearBodyOutputLevel(id, 'fmdrone')
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FMDroneLayer() {
  const enginesRef     = useRef<EngineMap>(new Map())
  const syncRunningRef = useRef(false)

  // 66ms sync via shared RealtimeSyncManager — no React state, no subscriptions
  useEffect(() => {
    registerRealtimeSync('fmdrone', () => {
      if (syncRunningRef.current) return
      syncRunningRef.current = true
      syncAllFMDroneEngines(enginesRef.current).finally(() => { syncRunningRef.current = false })
    })
    return () => unregisterRealtimeSync('fmdrone')
  }, [])

  // Stop all on unmount
  useEffect(() => {
    const engines = enginesRef.current
    return () => {
      for (const [id, eng] of engines) {
        eng.stop()
        releaseBus(id)
        clearBodyOutputLevel(id, 'fmdrone')
      }
      engines.clear()
    }
  }, [])

  return null
}
