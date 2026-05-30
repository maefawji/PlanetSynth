// ── SamplerLayer ───────────────────────────────────────────────────────────────
// Headless component — renders nothing.
// Manages one SamplerEngine per body whose effective samplerType === 'sampler'.
//
// Sample resolution (same priority as GranularLayer):
//   1. Rack samplerMode 'fixed' + samplerSampleId
//   2. Body's explicit sampleId
//   3. First loaded sample (index-stable hash per body)
//
// The engine output is wired into the per-body rack bus (rackBusMixer).
// body.volume (mixer fader) is applied via setBusVolume each tick.
//
// Performance: the component has NO React state and NO store subscriptions.
// Audio-param sync runs at ~15 fps via syncAllEngines(), which reads store
// values directly through getState() inside the RAF loop — no re-renders.

import { useEffect, useRef } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import { useProjectStore } from '../../store/projectStore'
import { useControlSetStore } from '../../store/controlSetStore'
import { setBodyOutputLevel, clearBodyOutputLevel } from '../../audio/bodyOutputMeter'
import { computeBodyRackOutputSpatial } from '../../audio/bodyRackOutput'
import { getBusInputNode, setBusVolume, retainBus, releaseBus } from '../../audio/rackBusMixer'
import { setSamplerPlayhead, clearSamplerPlayhead, setSamplerRawDuration } from '../../audio/samplerPlayhead'
import { registerRealtimeSync, unregisterRealtimeSync } from '../../audio/realtimeSyncManager'
import { getPlanetLiveBodySnapshot } from './PlanetCanvas'
import type { SamplerEngine as SamplerEngineType } from '../../audio/SamplerEngine'
import type { SampleAsset } from '../../patch/types'

// ── Lazy import ───────────────────────────────────────────────────────────────

let SamplerEngineCtor: typeof SamplerEngineType | null = null
async function ensureCtor(): Promise<typeof SamplerEngineType> {
  if (!SamplerEngineCtor) {
    const m = await import('../../audio/SamplerEngine')
    SamplerEngineCtor = m.SamplerEngine
  }
  return SamplerEngineCtor
}

// ── Sample resolution ─────────────────────────────────────────────────────────

function stableIndexFromId(id: string, length: number): number {
  if (length <= 0) return 0
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  return Math.abs(hash) % length
}

function resolveSample(bodyId: string, bodySampleId: string | null | undefined, samples: SampleAsset[]): SampleAsset | null {
  const ep = useControlSetStore.getState().getBodyEffectiveParams(bodyId) as Record<string, unknown>
  const samplerMode = String(ep.samplerMode ?? 'auto')
  if (samplerMode === 'fixed') {
    const fixedId = String(ep.samplerSampleId ?? '')
    return fixedId ? (samples.find(s => s.id === fixedId) ?? null) : null
  }
  if (bodySampleId) return samples.find(s => s.id === bodySampleId) ?? null
  if (samples.length === 0) return null
  return samples[stableIndexFromId(bodyId, samples.length)] ?? null
}

// ── Engine sync (module-level — reads store via getState, no React re-renders) ─

type EngineMap = Map<string, SamplerEngineType>

async function syncAllEngines(engines: EngineMap): Promise<void> {
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
    const samplerType = String(ep.samplerType ?? 'off')
    if (samplerType !== 'sampler' || body.muted) continue

    // Resolve sample
    const sample = resolveSample(body.id, body.sampleId, samples)
    if (!sample?.objectUrl) continue  // no sample → skip

    activeIds.add(body.id)

    // Read params
    const volume      = Number(ep.samplerVolume      ?? 0.7)
    const playMode    = String(ep.samplerPlayMode    ?? 'loop')  as 'oneshot' | 'loop' | 'pingpong'
    const sampleStart = Number(ep.samplerSampleStart ?? 0)
    const sampleEnd   = Number(ep.samplerSampleEnd   ?? 1)
    const loopStart   = Number(ep.samplerLoopStart   ?? 0)
    const loopEnd     = Number(ep.samplerLoopEnd     ?? 1)
    const reverse     = Boolean(ep.samplerReverse    ?? false)
    const detune      = Number(ep.samplerDetune      ?? 0)
    const attack      = Number(ep.samplerAttack      ?? 0.01)
    const release     = Number(ep.samplerRelease     ?? 1.0)
    const reverbMix   = Number(ep.samplerReverbMix   ?? 0.3)

    const outputSpatial = computeBodyRackOutputSpatial(body.id, effectiveBodies, simParams, ep as never)
    const bodyVol       = Math.max(0, Math.min(1, body.volume ?? 1))
    const finalLevel    = body.muted ? 0 : Math.max(0, Math.min(1, volume * outputSpatial.volume * bodyVol))
    setBodyOutputLevel(body.id, 'sampler', finalLevel, 900)
    setBusVolume(body.id, body.muted ? 0 : bodyVol)

    let eng = engines.get(body.id)
    const isNew = !eng
    if (isNew) {
      const Ctor = await ensureCtor()
      eng = new Ctor()
      engines.set(body.id, eng)
    }

    eng.setParams({ volume, playMode, sampleStart, sampleEnd, loopStart, loopEnd, reverse, detune, attack, release, reverbMix })
    eng.setOutputSpatial(outputSpatial.volume, outputSpatial.pan)

    // If the sample URL changed while the engine is playing, stop it so
    // it restarts with the new URL.  We'll re-wire the bus below.
    let sampleChanged = false
    if (eng.isPlaying && eng.sampleUrl !== sample.objectUrl) {
      eng.stop()
      releaseBus(body.id)
      clearBodyOutputLevel(body.id, 'sampler')
      sampleChanged = true
    }

    if (!eng.isPlaying) {
      // Await start so that AudioContext nodes (incl. panner) are initialized
      // before we try to connect to the rack bus below.
      await eng.start(sample.objectUrl)
    }

    if (isNew || sampleChanged) {
      // Wire persistent output node into the rack bus.
      // getOutputNode() is safe here because start() → init() has now completed.
      if (eng.isPlaying) {
        retainBus(body.id)
        eng.getOutputNode().connect(getBusInputNode(body.id))
      } else {
        // start() failed (no sample, decode error, etc.) — clean up
        if (isNew) engines.delete(body.id)
        continue
      }
    }
  }

  // Stop engines for bodies no longer active
  for (const [id, eng] of engines) {
    if (!activeIds.has(id)) {
      eng.stop()
      engines.delete(id)
      releaseBus(id)
      clearBodyOutputLevel(id, 'sampler')
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SamplerLayer() {
  const enginesRef     = useRef<EngineMap>(new Map())
  const syncRunningRef = useRef(false)

  // Per-frame RAF — playhead only (smooth scrubbing, no React state)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      for (const [id, eng] of enginesRef.current) {
        const rawDur = eng.getRawDuration()
        if (rawDur > 0) setSamplerRawDuration(id, rawDur)
        const pos    = eng.getPlayheadNormalized()
        const posSec = eng.getPlayheadSeconds()
        if (pos !== null && posSec !== null) {
          setSamplerPlayhead(id, {
            normPosInPlay: pos,
            rawDuration:   rawDur,
            sampleStart:   eng.params.sampleStart,
            sampleEnd:     eng.params.sampleEnd,
            positionSec:   posSec,
          })
        } else {
          clearSamplerPlayhead(id)
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // 66ms sync via shared RealtimeSyncManager — no React state, no subscriptions
  useEffect(() => {
    registerRealtimeSync('sampler', () => {
      if (syncRunningRef.current) return
      syncRunningRef.current = true
      syncAllEngines(enginesRef.current).finally(() => { syncRunningRef.current = false })
    })
    return () => unregisterRealtimeSync('sampler')
  }, [])

  // Stop all on unmount
  useEffect(() => {
    return () => {
      for (const [id, eng] of enginesRef.current) {
        eng.stop()
        releaseBus(id)
        clearBodyOutputLevel(id, 'sampler')
      }
      enginesRef.current.clear()
    }
  }, [])

  return null
}
