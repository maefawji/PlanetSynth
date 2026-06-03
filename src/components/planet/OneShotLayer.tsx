// ── OneShotLayer ───────────────────────────────────────────────────────────────
// Headless component — renders nothing.
// Maintains one OneShotSamplerEngine per body whose effective oneShotType === 'oneshot'.
//
// Responsibilities:
//   • Create / destroy engines as bodies are added/removed or the slot changes
//   • Register each engine in the _bodyEngines registry (used by OneShotSamplerPanel)
//   • Load (or reload) the resolved sample URL whenever it changes
//   • Connect engine output to the rack bus once a sample is loaded
//
// Playback (trigger) is initiated externally — either by OneShotSamplerPanel
// or future trigger integrations — via getBodyOneShotEngine(bodyId).trigger().
//
// Performance: no React state, no store subscriptions.
// Sync runs at ~15fps via RealtimeSyncManager.

import { useEffect, useRef } from 'react'
import * as Tone from 'tone'
import { usePlanetStore } from '../../store/planetStore'
import { useProjectStore } from '../../store/projectStore'
import { useControlSetStore } from '../../store/controlSetStore'
import { getBusInputNode, setBusVolume, retainBus, releaseBus } from '../../audio/rackBusMixer'
import { computeBodyRackOutputSpatial } from '../../audio/bodyRackOutput'
import { setBodyOutputLevel, clearBodyOutputLevel } from '../../audio/bodyOutputMeter'
import { getPlanetLiveBodySnapshot } from './PlanetCanvas'
import { registerRealtimeSync, unregisterRealtimeSync } from '../../audio/realtimeSyncManager'
import {
  OneShotSamplerEngine,
  registerBodyOneShotEngine,
  unregisterBodyOneShotEngine,
} from '../../audio/OneShotSamplerEngine'
import { onMidiNoteOn } from '../../audio/midiManager'
import type { SampleAsset } from '../../patch/types'

// ── Engine map ────────────────────────────────────────────────────────────────

type EngineEntry = {
  eng: OneShotSamplerEngine
  /** True once the engine output has been connected to the rack bus. */
  busHeld: boolean
}
type EngineMap = Map<string, EngineEntry>

function stableIndexFromId(id: string, length: number): number {
  if (length <= 0) return 0
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  return Math.abs(hash) % length
}

function resolveOneShotSample(bodyId: string, ep: Record<string, unknown>, samples: SampleAsset[]): SampleAsset | null {
  const samplerMode = String(ep.samplerMode ?? 'auto')
  if (samplerMode === 'fixed') {
    const fixedId = String(ep.samplerSampleId ?? '')
    return fixedId ? (samples.find(s => s.id === fixedId) ?? null) : null
  }
  if (samples.length === 0) return null
  return samples[stableIndexFromId(bodyId, samples.length)] ?? null
}

// ── Module-level sync ─────────────────────────────────────────────────────────

async function syncAllOneShotEngines(engines: EngineMap): Promise<void> {
  const { bodies, simParams } = usePlanetStore.getState()
  const { getBodyEffectiveParams } = useControlSetStore.getState()
  const { project: { samples } } = useProjectStore.getState()

  // Build effective bodies with live physics positions (for standpoint computation)
  const liveBodies    = getPlanetLiveBodySnapshot()
  const liveById      = new Map(liveBodies.map(b => [b.id, b]))
  const effectiveBodies = bodies.map(body => {
    const live = liveById.get(body.id)
    return live ? { ...body, x: live.x, y: live.y, vx: live.vx, vy: live.vy } : body
  })

  const activeIds = new Set<string>()

  for (const body of effectiveBodies) {
    const ep = getBodyEffectiveParams(body.id) as Record<string, unknown>
    const oneShotType = String(ep.oneShotType ?? 'off')
    if (oneShotType !== 'oneshot') continue

    activeIds.add(body.id)

    // ── Resolve sample ────────────────────────────────────────────────────────
    const sample = resolveOneShotSample(body.id, ep, samples)

    // ── Create engine if needed ───────────────────────────────────────────────
    let entry = engines.get(body.id)
    if (!entry) {
      const eng = new OneShotSamplerEngine()
      entry = { eng, busHeld: false }
      engines.set(body.id, entry)
      registerBodyOneShotEngine(body.id, eng)
    }

    const { eng } = entry

    // ── Load / reload sample ──────────────────────────────────────────────────
    if (sample?.objectUrl && sample.objectUrl !== eng.sampleUrl) {
      await eng.loadSample(sample.objectUrl)
      // After loadSample the AudioContext and outputGain exist — connect to bus
      if (!entry.busHeld) {
        retainBus(body.id)
        eng.getOutputNode().connect(getBusInputNode(body.id))
        entry.busHeld = true
      }
    }

    // ── Apply volume per cycle — rack bus handles standpoint spatial ──────────
    if (entry.busHeld && eng.hasBuffer) {
      const busVol = body.muted ? 0 : Math.max(0, Math.min(1, body.volume ?? 1))
      setBusVolume(body.id, busVol)
      // Engine output is always full (mute handled via busVol=0 on fader)
      const engVol = body.muted ? 0 : 1
      try {
        const ctx = Tone.getContext().rawContext as AudioContext
        eng.getOutputNode().gain.setTargetAtTime(engVol, ctx.currentTime, 0.02)
      } catch (_) {}

      // VU meter: include standpoint attenuation for display purposes
      const spatial       = computeBodyRackOutputSpatial(body.id, effectiveBodies, simParams, ep as never)
      const capturedBodyId = body.id
      const capturedFinal  = busVol * spatial.volume
      eng.onStateChange = (s) => {
        if (s === 'playing') {
          setBodyOutputLevel(capturedBodyId, 'oneshot', capturedFinal, 600)
        }
      }
    }
  }

  // ── Teardown engines for bodies that are no longer active ─────────────────
  for (const [id, { eng, busHeld }] of engines) {
    if (!activeIds.has(id)) {
      eng.dispose()
      engines.delete(id)
      unregisterBodyOneShotEngine(id)
      if (busHeld) releaseBus(id)
      clearBodyOutputLevel(id, 'oneshot')
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OneShotLayer() {
  const enginesRef     = useRef<EngineMap>(new Map())
  const syncRunningRef = useRef(false)

  // 66ms sync via shared RealtimeSyncManager — no React state, no subscriptions
  useEffect(() => {
    registerRealtimeSync('oneshot', () => {
      if (syncRunningRef.current) return
      syncRunningRef.current = true
      syncAllOneShotEngines(enginesRef.current).finally(() => {
        syncRunningRef.current = false
      })
    })
    return () => unregisterRealtimeSync('oneshot')
  }, [])

  // MIDI IN → trigger matching one-shot engines
  useEffect(() => {
    return onMidiNoteOn((ch, note) => {
      const { bodies } = usePlanetStore.getState()
      for (const body of bodies) {
        if ((body.midiChannel ?? 1) === ch && (body.midiNote ?? 60) === note) {
          const entry = enginesRef.current.get(body.id)
          if (entry?.eng.hasBuffer) {
            entry.eng.trigger()
          }
        }
      }
    })
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const [id, { eng, busHeld }] of enginesRef.current) {
        eng.dispose()
        unregisterBodyOneShotEngine(id)
        if (busHeld) releaseBus(id)
      }
      enginesRef.current.clear()
    }
  }, [])

  return null
}
