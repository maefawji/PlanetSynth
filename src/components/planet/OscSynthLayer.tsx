// ── OscSynthLayer ─────────────────────────────────────────────────────────────
// Headless component: manages one AmbientOscillatorEngine per body that has
// instrument = 'instrument-osc-synth' in its effective rack.
//
// Unlike AmbientOscillatorLayer (always-on drone), this layer does NOT call
// noteOn automatically. It only creates/maintains the engine and keeps params
// in sync. noteOn / noteOff are fired externally by:
//   • instrumentTrigger.ts  (orbit / rendezvous / orbit-complete)
//   • InlineOscSynthContent test button (PlanetRack UI)
//   • InlineChordTestContent (trigger-chord-test buttons)
//
// Exports getBodyOscSynthEngine() so callers can reach the engine directly.

import { useEffect, useRef } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import { useControlSetStore } from '../../store/controlSetStore'
import {
  AmbientOscillatorEngine,
  type AmbientOscillatorParams,
  type LfoTarget,
} from '../../audio/AmbientOscillatorEngine'
import {
  getBusInputNode,
  setBusVolume,
  retainBus,
  releaseBus,
} from '../../audio/rackBusMixer'
import {
  setBodyOutputLevel,
  clearBodyOutputLevel,
} from '../../audio/bodyOutputMeter'
import {
  registerRealtimeSync,
  unregisterRealtimeSync,
} from '../../audio/realtimeSyncManager'
import { computeOrbitStats } from './DroneLayer'
import { getPlanetLiveBodySnapshot } from './PlanetCanvas'

// ── Orbit-driven param helper ─────────────────────────────────────────────────

function orbitVal(
  source: string,
  manualVal: number,
  stats: ReturnType<typeof computeOrbitStats>,
  rate: number,
  min: number,
  max: number,
): number {
  if (source === 'manual' || !stats) return manualVal
  let raw: number
  switch (source) {
    case 'period':       raw = stats.T_real * rate; break
    case 'eccentricity': raw = stats.ecc    * rate; break
    case 'distance':     raw = stats.r      * rate; break
    case 'velocity':     raw = stats.speed  * rate; break
    case 'bound':        raw = (stats.bound ? 1 : 0) * rate; break
    default: return manualVal
  }
  if (!isFinite(raw)) return manualVal
  return Math.max(min, Math.min(max, raw))
}

// ── Module-level registry ─────────────────────────────────────────────────────

const _engines = new Map<string, AmbientOscillatorEngine>()

export function getBodyOscSynthEngine(
  bodyId: string,
): AmbientOscillatorEngine | undefined {
  return _engines.get(bodyId)
}

// ── Sync ──────────────────────────────────────────────────────────────────────

type EngineMap = Map<string, AmbientOscillatorEngine>

async function syncEngines(engines: EngineMap): Promise<void> {
  const { bodies } = usePlanetStore.getState()
  const { getBodyEffectiveParams } = useControlSetStore.getState()
  const G = usePlanetStore.getState().simParams.G

  // Compute live body positions for orbit stats
  const liveBodies = getPlanetLiveBodySnapshot()
  const liveById   = new Map(liveBodies.map(b => [b.id, b]))
  const effectiveBodies = bodies.map(b => {
    const live = liveById.get(b.id)
    return live ? { ...b, x: live.x, y: live.y, vx: live.vx, vy: live.vy } : b
  })

  const activeIds = new Set<string>()

  for (const body of bodies) {
    const ep   = getBodyEffectiveParams(body.id) as Record<string, unknown>
    const type = String(ep.oscSynthType ?? 'off')
    if (type !== 'osc-synth' || body.muted) continue

    activeIds.add(body.id)

    // Compute orbit stats for this body (using live positions)
    const liveBody   = effectiveBodies.find(b => b.id === body.id) ?? body
    const orbitStats = computeOrbitStats(liveBody, effectiveBodies, G)

    // Read manual values
    const manualAttack   = Number(ep.oscSynthAttack          ?? 0.05)
    const manualDecay    = Number(ep.oscSynthDecay           ?? 0.3)
    const manualSustain  = Number(ep.oscSynthSustain         ?? 0.8)
    const manualRelease  = Number(ep.oscSynthRelease         ?? 1.5)
    const manualCutoff   = Number(ep.oscSynthFilterCutoff    ?? 2000)
    const manualLfoRate  = Number(ep.oscSynthLfoRate          ?? 1.0)
    const manualLfoDep   = Number(ep.oscSynthLfoDepth         ?? 0.3)

    const p: AmbientOscillatorParams = {
      waveform:  (ep.oscSynthWaveform as OscillatorType) ?? 'sine',
      attack:  orbitVal(String(ep.oscSynthAttackSource   ?? 'manual'), manualAttack,  orbitStats, Number(ep.oscSynthAttackRate   ?? 0.05), 0.001, 20),
      decay:   orbitVal(String(ep.oscSynthDecaySource    ?? 'manual'), manualDecay,   orbitStats, Number(ep.oscSynthDecayRate    ?? 0.05), 0.01,  20),
      sustain: orbitVal(String(ep.oscSynthSustainSource  ?? 'manual'), manualSustain, orbitStats, Number(ep.oscSynthSustainRate  ?? 1.0),  0,     1),
      release: orbitVal(String(ep.oscSynthReleaseSource  ?? 'manual'), manualRelease, orbitStats, Number(ep.oscSynthReleaseRate  ?? 0.1),  0.01,  30),
      filterCutoff:    orbitVal(String(ep.oscSynthCutoffSource  ?? 'manual'), manualCutoff, orbitStats, Number(ep.oscSynthCutoffRate  ?? 5.0), 80, 12000),
      filterResonance: Number(ep.oscSynthFilterResonance ?? 0.5),
      level:           Number(ep.oscSynthLevel           ?? 0.7),
      lfoTarget:       (ep.oscSynthLfoTarget as LfoTarget) ?? 'off',
      lfoRate:  orbitVal(String(ep.oscSynthLfoRateSource  ?? 'manual'), manualLfoRate, orbitStats, Number(ep.oscSynthLfoRateRate  ?? 0.1), 0.01, 20),
      lfoDepth: orbitVal(String(ep.oscSynthLfoDepthSource ?? 'manual'), manualLfoDep,  orbitStats, Number(ep.oscSynthLfoDepthRate ?? 1.0), 0,    1),
      lfoWaveform:     (ep.oscSynthLfoWaveform as OscillatorType) ?? 'sine',
    }
    const bodyVol = Math.max(0, Math.min(1, body.volume ?? 1))

    let eng = engines.get(body.id)

    if (!eng) {
      // First time: create engine and wire to rack bus (no noteOn — wait for trigger)
      eng = new AmbientOscillatorEngine()
      await eng.init()
      eng.setParams(p)
      // Engine outputs at unity — volume & localization handled by rack bus
      eng.setOutputSpatial(1, 0)
      engines.set(body.id, eng)
      _engines.set(body.id, eng)
      retainBus(body.id)
      eng.getOutputNode().connect(getBusInputNode(body.id))
    } else {
      eng.setParams(p)
    }

    // Body volume fader → rack bus (Volume Slider in diagram)
    setBusVolume(body.id, body.muted ? 0 : bodyVol)

    // VU meter — show level only while a voice is active
    const vu = eng.isActive ? p.level * bodyVol : 0
    setBodyOutputLevel(body.id, 'osc-synth', vu, 300)
  }

  // Tear down engines for bodies no longer active
  for (const [id, eng] of engines) {
    if (!activeIds.has(id)) {
      eng.noteOffAll()
      engines.delete(id)
      _engines.delete(id)
      releaseBus(id)
      clearBodyOutputLevel(id, 'osc-synth')
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OscSynthLayer() {
  const enginesRef     = useRef<EngineMap>(new Map())
  const syncRunningRef = useRef(false)

  useEffect(() => {
    registerRealtimeSync('osc-synth', () => {
      if (syncRunningRef.current) return
      syncRunningRef.current = true
      syncEngines(enginesRef.current).finally(() => {
        syncRunningRef.current = false
      })
    })
    return () => unregisterRealtimeSync('osc-synth')
  }, [])

  // Stop all on unmount
  useEffect(() => {
    const engines = enginesRef.current
    return () => {
      for (const [id, eng] of engines) {
        eng.noteOffAll()
        _engines.delete(id)
        releaseBus(id)
        clearBodyOutputLevel(id, 'osc-synth')
      }
      engines.clear()
    }
  }, [])

  return null
}
