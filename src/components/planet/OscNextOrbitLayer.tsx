// ── OscNextOrbitLayer ──────────────────────────────────────────────────────────
// Headless component: manages one AmbientOscillatorEngine per body that has
// instrument = 'instrument-osc-next-orbit' in its effective rack.
//
// On each realtime-sync tick:
//   1. Computes orbit preview points for the body (Verlet, ~1 period worth)
//   2. Calls engine.setOrbitWaveform(pts) to push a new PeriodicWave via DFT
//   3. Updates ADSR/filter/LFO params from orbit stats (same as OscSynthOrbit)
//
// noteOn / noteOff are triggered externally via instrumentTrigger.ts.

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
import {
  getPlanetLiveBodySnapshot,
  computeOrbitPreviewForBody,
  planetBodyStatsCache,
} from './PlanetCanvas'

// ── DFT: orbit trajectory → PeriodicWave ──────────────────────────────────────
//
// Extracts the Y-coordinate signal from orbit preview points,
// centers + normalizes it, then computes Fourier series coefficients
// for Web Audio PeriodicWave.
//
// PeriodicWave synthesis: x(θ) = Σ_k [ real[k]·cos(kθ) + imag[k]·sin(kθ) ]
// DFT → PeriodicWave is implemented in AmbientOscillatorEngine.setOrbitWaveform().
// Layer calls eng.setOrbitWaveform(pts) directly — no duplicate DFT here.

// ── Orbit-driven param helper (same as OscSynthLayer) ────────────────────────

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

// ── Module-level engine registry ──────────────────────────────────────────────

const _engines = new Map<string, AmbientOscillatorEngine>()

export function getBodyOscNextOrbitEngine(
  bodyId: string,
): AmbientOscillatorEngine | undefined {
  return _engines.get(bodyId)
}

// ── Sync ──────────────────────────────────────────────────────────────────────

type EngineMap = Map<string, AmbientOscillatorEngine>

// Throttle waveform recomputation: at most every 250 ms per body.
const _waveformLastMs = new Map<string, number>()

async function syncEngines(engines: EngineMap): Promise<void> {
  const { bodies }              = usePlanetStore.getState()
  const { getBodyEffectiveParams, getBodyEffectiveRack } = useControlSetStore.getState()
  const G = usePlanetStore.getState().simParams.G
  const dt = usePlanetStore.getState().simParams.dt

  const liveBodies = getPlanetLiveBodySnapshot()
  const liveById   = new Map(liveBodies.map(b => [b.id, b]))
  const effectiveBodies = bodies.map(b => {
    const live = liveById.get(b.id)
    return live ? { ...b, x: live.x, y: live.y, vx: live.vx, vy: live.vy } : b
  })

  const activeIds = new Set<string>()

  for (const body of bodies) {
    const ep   = getBodyEffectiveParams(body.id) as Record<string, unknown>
    const rack = getBodyEffectiveRack(body.id)
    if (rack.instrument !== 'instrument-osc-next-orbit') continue
    const type = String(ep.oscNextOrbitType ?? 'off')
    if (type !== 'osc-next-orbit' || body.muted) continue

    activeIds.add(body.id)

    // Orbit stats for orbit-driven ADSR
    const liveBody   = effectiveBodies.find(b => b.id === body.id) ?? body
    const orbitStats = computeOrbitStats(liveBody, effectiveBodies, G)

    // Manual ADSR fallbacks
    const manualAttack   = Number(ep.oscSynthAttack          ?? 0.05)
    const manualDecay    = Number(ep.oscSynthDecay           ?? 0.4)
    const manualSustain  = Number(ep.oscSynthSustain         ?? 0.75)
    const manualRelease  = Number(ep.oscSynthRelease         ?? 2.0)
    const manualCutoff   = Number(ep.oscSynthFilterCutoff    ?? 2000)
    const manualLfoRate  = Number(ep.oscSynthLfoRate          ?? 1.0)
    const manualLfoDep   = Number(ep.oscSynthLfoDepth         ?? 0.3)

    const p: AmbientOscillatorParams = {
      waveform:        'sine',   // placeholder; overridden by PeriodicWave below
      attack:  orbitVal(String(ep.oscSynthAttackSource   ?? 'period'),       manualAttack,  orbitStats, Number(ep.oscSynthAttackRate   ?? 0.06), 0.005, 20),
      decay:   orbitVal(String(ep.oscSynthDecaySource    ?? 'eccentricity'), manualDecay,   orbitStats, Number(ep.oscSynthDecayRate    ?? 8.0),  0.01,  20),
      sustain: orbitVal(String(ep.oscSynthSustainSource  ?? 'distance'),     manualSustain, orbitStats, Number(ep.oscSynthSustainRate  ?? 0.003), 0,    1),
      release: orbitVal(String(ep.oscSynthReleaseSource  ?? 'period'),       manualRelease, orbitStats, Number(ep.oscSynthReleaseRate  ?? 0.2),  0.01,  30),
      filterCutoff:    orbitVal(String(ep.oscSynthCutoffSource  ?? 'velocity'),     manualCutoff, orbitStats, Number(ep.oscSynthCutoffRate  ?? 600),  80, 12000),
      filterResonance: Number(ep.oscSynthFilterResonance ?? 0.4),
      level:           Number(ep.oscSynthLevel           ?? 0.7),
      lfoTarget:       (ep.oscSynthLfoTarget as LfoTarget) ?? 'off',
      lfoRate:  orbitVal(String(ep.oscSynthLfoRateSource  ?? 'eccentricity'), manualLfoRate, orbitStats, Number(ep.oscSynthLfoRateRate  ?? 5.0), 0.01, 20),
      lfoDepth: orbitVal(String(ep.oscSynthLfoDepthSource ?? 'eccentricity'), manualLfoDep,  orbitStats, Number(ep.oscSynthLfoDepthRate ?? 0.8), 0,    1),
      lfoWaveform:     (ep.oscSynthLfoWaveform as OscillatorType) ?? 'sine',
    }
    const bodyVol = Math.max(0, Math.min(1, body.volume ?? 1))

    let eng = engines.get(body.id)

    if (!eng) {
      eng = new AmbientOscillatorEngine()
      await eng.init()
      eng.setParams(p)
      eng.setOutputSpatial(1, 0)
      engines.set(body.id, eng)
      _engines.set(body.id, eng)
      retainBus(body.id)
      eng.getOutputNode().connect(getBusInputNode(body.id))
    } else {
      eng.setParams(p)
    }

    // ── Update orbit waveform (throttled to 250 ms) ──────────────────────────
    const nowMs = performance.now()
    const lastMs = _waveformLastMs.get(body.id) ?? 0
    if (nowMs - lastMs > 250) {
      _waveformLastMs.set(body.id, nowMs)

      // Compute steps ≈ 1 orbit, clamped [64, 512]
      const stats = planetBodyStatsCache.get(body.id)
      const periodSim = stats?.period ?? 0
      const steps = (periodSim > 0 && dt > 0)
        ? Math.max(64, Math.min(512, Math.round(periodSim / dt)))
        : 128

      const pts = computeOrbitPreviewForBody(body.id, steps)
      if (pts && pts.length >= 4) {
        eng.setOrbitWaveform(pts)
      }
    }

    setBusVolume(body.id, body.muted ? 0 : bodyVol)
    const vu = eng.isActive ? p.level * bodyVol : 0
    setBodyOutputLevel(body.id, 'osc-next-orbit', vu, 300)
  }

  // Tear down engines for bodies no longer active
  for (const [id, eng] of engines) {
    if (!activeIds.has(id)) {
      eng.noteOffAll()
      engines.delete(id)
      _engines.delete(id)
      _waveformLastMs.delete(id)
      releaseBus(id)
      clearBodyOutputLevel(id, 'osc-next-orbit')
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OscNextOrbitLayer() {
  const enginesRef     = useRef<EngineMap>(new Map())
  const syncRunningRef = useRef(false)

  useEffect(() => {
    registerRealtimeSync('osc-next-orbit', () => {
      if (syncRunningRef.current) return
      syncRunningRef.current = true
      syncEngines(enginesRef.current).finally(() => {
        syncRunningRef.current = false
      })
    })
    return () => unregisterRealtimeSync('osc-next-orbit')
  }, [])

  useEffect(() => {
    const engines = enginesRef.current
    return () => {
      for (const [id, eng] of engines) {
        eng.noteOffAll()
        _engines.delete(id)
        _waveformLastMs.delete(id)
        releaseBus(id)
        clearBodyOutputLevel(id, 'osc-next-orbit')
      }
      engines.clear()
    }
  }, [])

  return null
}
