// ── GranularLayer ──────────────────────────────────────────────────────────────
// Headless component — renders nothing.
// Watches planet bodies + rack assignments and keeps one GranularEngine alive
// per body whose effective granularType === 'grain'.
//
// Sample resolution (priority order):
//   1. Instrument samplerMode 'fixed' + samplerSampleId
//   2. Instrument samplerMode 'auto' + first loaded sample (index-stable hash per body)
//
// Performance: no React state, no store subscriptions.
// Sync runs at ~15fps via RealtimeSyncManager → syncAllGranularEngines().

import { useEffect, useRef } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import { useProjectStore } from '../../store/projectStore'
import { useControlSetStore } from '../../store/controlSetStore'
import { setBodyOutputLevel, clearBodyOutputLevel } from '../../audio/bodyOutputMeter'
import { computeBodyRackOutputSpatial } from '../../audio/bodyRackOutput'
import { getBusInputNode, setBusVolume, retainBus, releaseBus } from '../../audio/rackBusMixer'
import { registerRealtimeSync, unregisterRealtimeSync } from '../../audio/realtimeSyncManager'
import { getPlanetLiveBodySnapshot } from './PlanetCanvas'
import type { GranularEngine as GranularEngineType } from '../../audio/GranularEngine'
import type { SampleAsset } from '../../patch/types'

// ── Lazy import ───────────────────────────────────────────────────────────────

let GranularEngineCtor: typeof GranularEngineType | null = null
async function ensureCtor(): Promise<typeof GranularEngineType> {
  if (!GranularEngineCtor) {
    const m = await import('../../audio/GranularEngine')
    GranularEngineCtor = m.GranularEngine
  }
  return GranularEngineCtor
}

// ── Stable hash → sample index ────────────────────────────────────────────────

function stableIndexFromId(id: string, length: number): number {
  if (length <= 0) return 0
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  return Math.abs(hash) % length
}

function resolveGrainSample(bodyId: string, samples: SampleAsset[]): SampleAsset | null {
  const ep = useControlSetStore.getState().getBodyEffectiveParams(bodyId) as Record<string, unknown>
  const samplerMode = String(ep.samplerMode ?? 'auto')
  if (samplerMode === 'fixed') {
    const fixedId = String(ep.samplerSampleId ?? '')
    return fixedId ? (samples.find(s => s.id === fixedId) ?? null) : null
  }
  if (samples.length === 0) return null
  return samples[stableIndexFromId(bodyId, samples.length)] ?? null
}

// ── Engine sync (module-level — reads store via getState, no React re-renders) ─

type EngineMap = Map<string, GranularEngineType>

async function syncAllGranularEngines(engines: EngineMap): Promise<void> {
  const { bodies, simParams } = usePlanetStore.getState()
  const { getBodyEffectiveParams } = useControlSetStore.getState()
  const { project: { samples } } = useProjectStore.getState()

  const activeIds     = new Set<string>()
  const liveBodies    = getPlanetLiveBodySnapshot()
  const liveById      = new Map(liveBodies.map(b => [b.id, b]))
  const effectiveBodies = bodies.map(body => {
    const live = liveById.get(body.id)
    return live ? { ...body, x: live.x, y: live.y, vx: live.vx, vy: live.vy } : body
  })

  for (const body of effectiveBodies) {
    const ep = getBodyEffectiveParams(body.id) as Record<string, unknown>
    const granularType = String(ep.granularType ?? 'off')
    if (granularType !== 'grain' || body.muted) continue

    const sample = resolveGrainSample(body.id, samples)
    if (!sample?.objectUrl) continue

    activeIds.add(body.id)

    const volume    = Number(ep.granularVolume    ?? 0.6)
    const grainSize = Number(ep.granularGrainSize ?? 0.08)
    const overlap   = Number(ep.granularOverlap   ?? 0.04)
    const detune    = Number(ep.granularDetune    ?? 0)
    const reverbMix = Number(ep.granularReverbMix ?? 0.5)

    const outputSpatial = computeBodyRackOutputSpatial(body.id, effectiveBodies, simParams, ep as never)
    const bodyVol       = Math.max(0, Math.min(1, body.volume ?? 1))
    const finalLevel    = body.muted ? 0 : Math.max(0, Math.min(1, volume * outputSpatial.volume * bodyVol))
    setBodyOutputLevel(body.id, 'granular', finalLevel, 900)
    setBusVolume(body.id, body.muted ? 0 : bodyVol)

    let eng = engines.get(body.id)
    const isNew = !eng
    if (isNew) {
      const Ctor = await ensureCtor()
      eng = new Ctor()
      engines.set(body.id, eng)
    }

    eng.setParams({ volume, grainSize, overlap, detune, reverbMix })
    eng.setOutputSpatial(1, 0)   // rack bus handles standpoint spatial

    if (!eng.isPlaying) {
      eng.start(sample.objectUrl)
    }

    if (isNew) {
      retainBus(body.id)
      eng.getOutputNode().connect(getBusInputNode(body.id))
    }
  }

  for (const [id, eng] of engines) {
    if (!activeIds.has(id)) {
      eng.stop()
      engines.delete(id)
      releaseBus(id)
      clearBodyOutputLevel(id, 'granular')
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GranularLayer() {
  const enginesRef     = useRef<EngineMap>(new Map())
  const syncRunningRef = useRef(false)

  // 66ms sync via shared RealtimeSyncManager — no React state, no subscriptions
  useEffect(() => {
    registerRealtimeSync('granular', () => {
      if (syncRunningRef.current) return
      syncRunningRef.current = true
      syncAllGranularEngines(enginesRef.current).finally(() => { syncRunningRef.current = false })
    })
    return () => unregisterRealtimeSync('granular')
  }, [])

  // Stop all on unmount
  useEffect(() => {
    return () => {
      for (const [id, eng] of enginesRef.current) {
        eng.stop()
        releaseBus(id)
        clearBodyOutputLevel(id, 'granular')
      }
      enginesRef.current.clear()
    }
  }, [])

  return null
}
