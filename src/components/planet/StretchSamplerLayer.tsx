// ── StretchSamplerLayer ────────────────────────────────────────────────────────
// Headless component — renders nothing.
// Maintains one StretchSamplerEngine per body whose effective oneShotType === 'stretch-sampler'.
//
// Mirrors OneShotLayer but uses StretchSamplerEngine.
// Playback rate (= bufferDuration / orbitPeriodSec) is computed in PlanetCanvas
// and passed via fireBodyInstrumentTrigger → instrumentTrigger.ts.

import { useEffect, useRef } from 'react'
import * as Tone from 'tone'
import { usePlanetStore }     from '../../store/planetStore'
import { useProjectStore }    from '../../store/projectStore'
import { useControlSetStore } from '../../store/controlSetStore'
import { getBusInputNode, setBusVolume, retainBus, releaseBus } from '../../audio/rackBusMixer'
import { computeBodyRackOutputSpatial } from '../../audio/bodyRackOutput'
import { setBodyOutputLevel, clearBodyOutputLevel } from '../../audio/bodyOutputMeter'
import { getPlanetLiveBodySnapshot } from './PlanetCanvas'
import { registerRealtimeSync, unregisterRealtimeSync } from '../../audio/realtimeSyncManager'
import {
  StretchSamplerEngine,
  registerBodyStretchSamplerEngine,
  unregisterBodyStretchSamplerEngine,
} from '../../audio/StretchSamplerEngine'
import type { SampleAsset } from '../../patch/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

type EngineEntry = { eng: StretchSamplerEngine; busHeld: boolean }
type EngineMap   = Map<string, EngineEntry>

function stableIndexFromId(id: string, length: number): number {
  if (length <= 0) return 0
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  return Math.abs(hash) % length
}

function resolveStretchSamplerSample(
  bodyId: string,
  ep: Record<string, unknown>,
  samples: SampleAsset[],
): SampleAsset | null {
  const samplerMode = String(ep.samplerMode ?? 'auto')
  if (samplerMode === 'fixed') {
    const fixedId = String(ep.samplerSampleId ?? '')
    return fixedId ? (samples.find(s => s.id === fixedId) ?? null) : null
  }
  if (samples.length === 0) return null
  return samples[stableIndexFromId(bodyId, samples.length)] ?? null
}

// ── Sync loop ─────────────────────────────────────────────────────────────────

async function syncAllStretchEngines(engines: EngineMap): Promise<void> {
  const { bodies, simParams }               = usePlanetStore.getState()
  const { getBodyEffectiveParams }          = useControlSetStore.getState()
  const { project: { samples } }            = useProjectStore.getState()

  const liveBodies      = getPlanetLiveBodySnapshot()
  const liveById        = new Map(liveBodies.map(b => [b.id, b]))
  const effectiveBodies = bodies.map(b => {
    const live = liveById.get(b.id)
    return live ? { ...b, x: live.x, y: live.y, vx: live.vx, vy: live.vy } : b
  })

  const activeIds = new Set<string>()

  for (const body of effectiveBodies) {
    const ep           = getBodyEffectiveParams(body.id) as Record<string, unknown>
    const oneShotType  = String(ep.oneShotType ?? 'off')
    if (oneShotType !== 'stretch-sampler') continue

    activeIds.add(body.id)

    const sample = resolveStretchSamplerSample(body.id, ep, samples)

    let entry = engines.get(body.id)
    if (!entry) {
      const eng = new StretchSamplerEngine()
      entry = { eng, busHeld: false }
      engines.set(body.id, entry)
      registerBodyStretchSamplerEngine(body.id, eng)
    }

    const { eng } = entry

    if (sample?.objectUrl && sample.objectUrl !== eng.sampleUrl) {
      await eng.loadSample(sample.objectUrl)
      if (!entry.busHeld) {
        retainBus(body.id)
        eng.getOutputNode().connect(getBusInputNode(body.id))
        entry.busHeld = true
      }
    }

    if (entry.busHeld && eng.hasBuffer) {
      const busVol = body.muted ? 0 : Math.max(0, Math.min(1, body.volume ?? 1))
      setBusVolume(body.id, busVol)
      const engVol = body.muted ? 0 : 1
      try {
        const ctx = Tone.getContext().rawContext as AudioContext
        eng.getOutputNode().gain.setTargetAtTime(engVol, ctx.currentTime, 0.02)
      } catch { /* noop */ }

      const spatial         = computeBodyRackOutputSpatial(body.id, effectiveBodies, simParams, ep as never)
      const capturedBodyId  = body.id
      const capturedFinal   = busVol * spatial.volume
      eng.onStateChange = (s) => {
        if (s === 'playing') {
          setBodyOutputLevel(capturedBodyId, 'sampler', capturedFinal, 600)
        }
      }
    }
  }

  for (const [id, { eng, busHeld }] of engines) {
    if (!activeIds.has(id)) {
      eng.dispose()
      engines.delete(id)
      unregisterBodyStretchSamplerEngine(id)
      if (busHeld) releaseBus(id)
      clearBodyOutputLevel(id, 'sampler')
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function StretchSamplerLayer() {
  const enginesRef     = useRef<EngineMap>(new Map())
  const syncRunningRef = useRef(false)

  useEffect(() => {
    registerRealtimeSync('stretch-sampler', () => {
      if (syncRunningRef.current) return
      syncRunningRef.current = true
      syncAllStretchEngines(enginesRef.current).finally(() => {
        syncRunningRef.current = false
      })
    })
    return () => unregisterRealtimeSync('stretch-sampler')
  }, [])

  useEffect(() => {
    const engines = enginesRef.current
    return () => {
      for (const [id, { eng, busHeld }] of engines) {
        eng.dispose()
        unregisterBodyStretchSamplerEngine(id)
        if (busHeld) releaseBus(id)
      }
      engines.clear()
    }
  }, [])

  return null
}
