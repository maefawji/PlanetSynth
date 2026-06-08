// ── WaveLabInstrumentLayer ────────────────────────────────────────────────────
// Instrument: 'instrument-wave-lab'
// Uses the body's recorded trail data (past orbit) as a wavetable via DFT,
// with ADSR/LFO driven by orbit stats — same mapping as OscNextOrbit.
//
// Differences from OscNextOrbitLayer:
//   • Wavetable source: trail ring buffer (already computed, zero extra cost)
//   • Signal selector: wavLabSig param (x | y | r | angle | speed)
//   • Multi-signal additive: wavLabSigs (comma-separated, each normalized then summed)

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
  getBodyTrailPoints,
} from './PlanetCanvas'

// ── Signal extraction ─────────────────────────────────────────────────────────

type WavSig = 'x' | 'y' | 'r' | 'angle' | 'speed'

function extractSig(pts: Array<{x:number;y:number}>, sig: WavSig): number[] {
  if (sig === 'x')     return pts.map(p => p.x)
  if (sig === 'y')     return pts.map(p => p.y)
  if (sig === 'r')     return pts.map(p => Math.sqrt(p.x*p.x + p.y*p.y))
  if (sig === 'angle') return pts.map(p => Math.atan2(p.y, p.x))
  return pts.map((p, i) => {
    if (i === 0) return 0
    const dx = p.x - pts[i-1].x, dy = p.y - pts[i-1].y
    return Math.sqrt(dx*dx + dy*dy)
  })
}

function normArr(arr: number[]): number[] {
  const min = Math.min(...arr), max = Math.max(...arr), range = max - min || 1
  return arr.map(v => (v - min) / range * 2 - 1)
}

// Build summed+normalized signal from trail points and signal list
function buildTrailWaveform(
  pts: Array<{x:number;y:number}>,
  sigs: WavSig[],
): Array<{x:number;y:number}> {
  if (pts.length < 4 || sigs.length === 0) return []
  const normed = sigs.map(s => normArr(extractSig(pts, s)))
  const summed = normed[0].map((_, i) => normed.reduce((acc, arr) => acc + arr[i], 0) / normed.length)
  const mean   = summed.reduce((a, b) => a + b, 0) / summed.length
  return summed.map((v, i) => ({ x: i, y: v - mean }))
}

// ── Orbit-driven param helper ─────────────────────────────────────────────────

function orbitVal(
  source: string,
  manual: number,
  stats: ReturnType<typeof computeOrbitStats>,
  rate: number,
  min: number,
  max: number,
): number {
  if (source === 'manual' || !stats) return manual
  let raw: number
  switch (source) {
    case 'period':       raw = stats.T_real * rate; break
    case 'eccentricity': raw = stats.ecc    * rate; break
    case 'distance':     raw = stats.r      * rate; break
    case 'velocity':     raw = stats.speed  * rate; break
    case 'bound':        raw = (stats.bound ? 1 : 0) * rate; break
    default: return manual
  }
  if (!isFinite(raw)) return manual
  return Math.max(min, Math.min(max, raw))
}

// ── Module-level engine registry ──────────────────────────────────────────────

const _engines = new Map<string, AmbientOscillatorEngine>()
const _waveformRefreshListeners = new Set<(bodyId: string) => void>()

// eslint-disable-next-line react-refresh/only-export-components
export function getBodyWaveLabEngine(bodyId: string): AmbientOscillatorEngine | undefined {
  return _engines.get(bodyId)
}

// eslint-disable-next-line react-refresh/only-export-components
export function subscribeWaveLabWaveformRefresh(listener: (bodyId: string) => void): () => void {
  _waveformRefreshListeners.add(listener)
  return () => _waveformRefreshListeners.delete(listener)
}

function notifyWaveLabWaveformRefresh(bodyId: string): void {
  for (const listener of _waveformRefreshListeners) listener(bodyId)
}

// eslint-disable-next-line react-refresh/only-export-components
export function refreshBodyWaveLabWaveform(
  bodyId: string,
  opts: { applyToActive?: boolean } = { applyToActive: false },
): boolean {
  const eng = _engines.get(bodyId)
  if (!eng) return false

  const ep = useControlSetStore.getState().getBodyEffectiveParams(bodyId) as Record<string, unknown>
  const VALID = ['x','y','r','angle','speed']
  const parseSigs = (key: string, fallback: string) =>
    String(ep[key] ?? fallback).split(',').filter(s => VALID.includes(s)) as WavSig[]

  const sigsL = parseSigs('wavLabSigL', String(ep.wavLabSig ?? 'x'))
  const sigsR = parseSigs('wavLabSigR', String(ep.wavLabSig ?? 'x'))
  const stereo = sigsL.join(',') !== sigsR.join(',')

  const trailPts = getBodyTrailPoints(bodyId)
  if (!trailPts || trailPts.length < 4) return false

  if (stereo) {
    const wfL = buildTrailWaveform(trailPts, sigsL.length > 0 ? sigsL : ['x'])
    const wfR = buildTrailWaveform(trailPts, sigsR.length > 0 ? sigsR : ['x'])
    if (wfL.length < 4 || wfR.length < 4) return false
    eng.setOrbitWaveformStereo(wfL, wfR, opts)
  } else {
    const wfPts = buildTrailWaveform(trailPts, sigsL.length > 0 ? sigsL : ['x'])
    if (wfPts.length < 4) return false
    eng.setOrbitWaveform(wfPts, opts)
  }
  notifyWaveLabWaveformRefresh(bodyId)
  return true
}

// ── Sync ──────────────────────────────────────────────────────────────────────

type EngineMap = Map<string, AmbientOscillatorEngine>
const _sigsKeyCache = new Map<string, string>() // bodyId → last sigsKey

async function syncEngines(engines: EngineMap): Promise<void> {
  const { bodies }              = usePlanetStore.getState()
  const { getBodyEffectiveParams, getBodyEffectiveRack } = useControlSetStore.getState()
  const G  = usePlanetStore.getState().simParams.G

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
    if (rack.instrument !== 'instrument-wave-lab') continue
    if (body.muted) continue

    activeIds.add(body.id)

    const liveBody   = effectiveBodies.find(b => b.id === body.id) ?? body
    const orbitStats = computeOrbitStats(liveBody, effectiveBodies, G)

    const p: AmbientOscillatorParams = {
      waveform: 'sine',
      attack:  orbitVal(String(ep.oscSynthAttackSource   ?? 'period'),       Number(ep.oscSynthAttack  ?? 0.5), orbitStats, Number(ep.oscSynthAttackRate   ?? 0.06), 0.005, 20),
      decay:   orbitVal(String(ep.oscSynthDecaySource    ?? 'eccentricity'), Number(ep.oscSynthDecay   ?? 2.0), orbitStats, Number(ep.oscSynthDecayRate    ?? 8.0),  0.01,  20),
      sustain: orbitVal(String(ep.oscSynthSustainSource  ?? 'distance'),     Number(ep.oscSynthSustain ?? 0.8), orbitStats, Number(ep.oscSynthSustainRate  ?? 0.003), 0,    1),
      release: orbitVal(String(ep.oscSynthReleaseSource  ?? 'period'),       Number(ep.oscSynthRelease ?? 3.0), orbitStats, Number(ep.oscSynthReleaseRate  ?? 0.2),  0.01,  30),
      filterCutoff:    orbitVal(String(ep.oscSynthCutoffSource ?? 'manual'), Number(ep.oscSynthFilterCutoff ?? 1200), orbitStats, Number(ep.oscSynthCutoffRate ?? 600), 80, 12000),
      filterResonance: Number(ep.oscSynthFilterResonance ?? 0.3),
      level:           Number(ep.oscSynthLevel           ?? 0.5),
      lfoTarget:       (ep.oscSynthLfoTarget as LfoTarget) ?? 'filter',
      lfoRate:  orbitVal(String(ep.oscSynthLfoRateSource  ?? 'period'),   Number(ep.oscSynthLfoRate  ?? 2.0), orbitStats, Number(ep.oscSynthLfoRateRate  ?? 0.12), 0.01, 20),
      lfoDepth: orbitVal(String(ep.oscSynthLfoDepthSource ?? 'velocity'), Number(ep.oscSynthLfoDepth ?? 0.5), orbitStats, Number(ep.oscSynthLfoDepthRate ?? 0.18), 0,    1),
      lfoWaveform: (ep.oscSynthLfoWaveform as OscillatorType) ?? 'sine',
    }

    const sigsKey = `${String(ep.wavLabSigL ?? ep.wavLabSig ?? 'x')}|${String(ep.wavLabSigR ?? ep.wavLabSig ?? 'x')}`
    let eng = engines.get(body.id)
    if (!eng) {
      eng = new AmbientOscillatorEngine()
      await eng.init()
      eng.setParams(p)
      engines.set(body.id, eng)
      _engines.set(body.id, eng)
      retainBus(body.id)
      eng.getOutputNode().connect(getBusInputNode(body.id))
      // Build waveform for the first time (deferred so audio init isn't blocked)
      _sigsKeyCache.set(body.id, sigsKey)
      setTimeout(() => refreshBodyWaveLabWaveform(body.id, { applyToActive: false }), 0)
    } else {
      eng.setParams(p)
      // Rebuild waveform if signals changed (deferred to avoid blocking audio scheduler)
      if (_sigsKeyCache.get(body.id) !== sigsKey) {
        _sigsKeyCache.set(body.id, sigsKey)
        setTimeout(() => refreshBodyWaveLabWaveform(body.id, { applyToActive: false }), 0)
      }
    }

    setBusVolume(body.id, body.muted ? 0 : (body.volume ?? 1))
    setBodyOutputLevel(body.id, 'wave-lab', eng.isActive ? p.level * (body.volume ?? 1) : 0, 300)
  }

  for (const [id, eng] of engines) {
    if (!activeIds.has(id)) {
      eng.noteOffAll()
      engines.delete(id)
      _engines.delete(id)
      _sigsKeyCache.delete(id)
      releaseBus(id)
      clearBodyOutputLevel(id, 'wave-lab')
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WaveLabInstrumentLayer() {
  const enginesRef     = useRef<EngineMap>(new Map())
  const syncRunningRef = useRef(false)

  useEffect(() => {
    registerRealtimeSync('wave-lab', () => {
      if (syncRunningRef.current) return
      syncRunningRef.current = true
      syncEngines(enginesRef.current).finally(() => { syncRunningRef.current = false })
    })
    return () => unregisterRealtimeSync('wave-lab')
  }, [])

  useEffect(() => {
    const engines = enginesRef.current
    return () => {
      for (const [id, eng] of engines) {
        eng.noteOffAll()
        _engines.delete(id)
        releaseBus(id)
        clearBodyOutputLevel(id, 'wave-lab')
      }
      engines.clear()
    }
  }, [])

  return null
}
