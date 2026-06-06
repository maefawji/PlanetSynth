import { useEffect, useRef } from 'react'
import * as Tone from 'tone'
import { usePlanetStore } from '../../store/planetStore'
import { useProjectStore } from '../../store/projectStore'
import { useControlSetStore } from '../../store/controlSetStore'
import { getBusInputNode, setBusVolume, retainBus, releaseBus } from '../../audio/rackBusMixer'
import { clearBodyOutputLevel, setBodyOutputLevel } from '../../audio/bodyOutputMeter'
import { registerRealtimeSync, unregisterRealtimeSync } from '../../audio/realtimeSyncManager'
import {
  LongSamplerEngine,
  registerBodyLongSamplerEngine,
  unregisterBodyLongSamplerEngine,
} from '../../audio/LongSamplerEngine'
import type { SampleAsset } from '../../patch/types'

type EngineEntry = { engine: LongSamplerEngine; busHeld: boolean }
type EngineMap = Map<string, EngineEntry>

function stableIndex(id: string, length: number): number {
  if (length <= 0) return 0
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  return Math.abs(hash) % length
}

function resolveSample(bodyId: string, params: Record<string, unknown>, samples: SampleAsset[]): SampleAsset | null {
  if (String(params.samplerMode ?? 'auto') === 'fixed') {
    const id = String(params.samplerSampleId ?? '')
    return samples.find(sample => sample.id === id) ?? null
  }
  return samples[stableIndex(bodyId, samples.length)] ?? null
}

async function syncEngines(engines: EngineMap): Promise<void> {
  const { bodies } = usePlanetStore.getState()
  const { getBodyEffectiveRack, getBodyEffectiveParams } = useControlSetStore.getState()
  const samples = useProjectStore.getState().project.samples
  const active = new Set<string>()

  for (const body of bodies) {
    if (getBodyEffectiveRack(body.id).instrument !== 'instrument-long-sampler') continue
    active.add(body.id)
    const params = getBodyEffectiveParams(body.id) as Record<string, unknown>
    const sample = resolveSample(body.id, params, samples)
    let entry = engines.get(body.id)
    if (!entry) {
      entry = { engine: new LongSamplerEngine(), busHeld: false }
      engines.set(body.id, entry)
      registerBodyLongSamplerEngine(body.id, entry.engine)
    }
    const { engine } = entry
    if (sample?.objectUrl && sample.objectUrl !== engine.sampleUrl) {
      await engine.loadSample(sample.objectUrl)
      if (!entry.busHeld) {
        retainBus(body.id)
        engine.getOutputNode().connect(getBusInputNode(body.id))
        entry.busHeld = true
      }
    }
    if (entry.busHeld && engine.hasBuffer) {
      const level = body.muted ? 0 : Math.max(0, Math.min(1, body.volume ?? 1))
      setBusVolume(body.id, level)
      try {
        const ctx = Tone.getContext().rawContext as AudioContext
        engine.getOutputNode().gain.setTargetAtTime(body.muted ? 0 : 1, ctx.currentTime, 0.02)
      } catch { /* audio context is not ready yet */ }
      engine.onStateChange = state => {
        if (state === 'playing') setBodyOutputLevel(body.id, 'sampler', level, 1200)
      }
    }
  }

  for (const [bodyId, entry] of engines) {
    if (active.has(bodyId)) continue
    entry.engine.dispose()
    unregisterBodyLongSamplerEngine(bodyId)
    if (entry.busHeld) releaseBus(bodyId)
    clearBodyOutputLevel(bodyId, 'sampler')
    engines.delete(bodyId)
  }
}

export function LongSamplerLayer() {
  const engines = useRef<EngineMap>(new Map())
  const syncing = useRef(false)

  useEffect(() => {
    registerRealtimeSync('long-sampler', () => {
      if (syncing.current) return
      syncing.current = true
      syncEngines(engines.current).finally(() => { syncing.current = false })
    })
    return () => unregisterRealtimeSync('long-sampler')
  }, [])

  useEffect(() => () => {
    for (const [bodyId, entry] of engines.current) {
      entry.engine.dispose()
      unregisterBodyLongSamplerEngine(bodyId)
      if (entry.busHeld) releaseBus(bodyId)
    }
    engines.current.clear()
  }, [])

  return null
}
