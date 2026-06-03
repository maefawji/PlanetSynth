import { useEffect, useRef, type MutableRefObject } from 'react'
import * as Tone from 'tone'
import { AmbientOscillatorEngine, type AmbientOscillatorParams } from '../../audio/AmbientOscillatorEngine'
import { registerRealtimeSync, unregisterRealtimeSync } from '../../audio/realtimeSyncManager'
import { usePlanetStore, type PlanetBody } from '../../store/planetStore'
import { useWholeInstrumentStore } from '../../store/wholeInstrumentStore'
import { computeOrbitTelemetry } from '../../lib/orbitTelemetry'
import { mapWholeInstrument, wholeFeatureValues, type WholeInstrumentFeatureValues } from '../../lib/wholeInstrumentMapping'
import { getPlanetLiveBodySnapshot } from './PlanetCanvas'

type WholeEngineState = {
  engine: AmbientOscillatorEngine
  output: Tone.Gain
  notes: number[]
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo))
}

function universeFeatures(): WholeInstrumentFeatureValues {
  const liveBodies = getPlanetLiveBodySnapshot()
  const storeBodies = usePlanetStore.getState().bodies
  const byId = new Map(storeBodies.map(b => [b.id, b]))
  const bodies = liveBodies.map(b => {
    const storeBody = byId.get(b.id)
    return {
      ...(storeBody ?? { id: b.id, name: b.id, type: 'planet' as const, color: '#888', sampleId: null }),
      ...b,
      z: storeBody?.z ?? b.z ?? 0,
    } as PlanetBody
  })
  return wholeFeatureValues(computeOrbitTelemetry(bodies))
}

async function ensureWholeEngine(stateRef: MutableRefObject<WholeEngineState | null>): Promise<WholeEngineState> {
  if (stateRef.current) return stateRef.current
  const engine = new AmbientOscillatorEngine()
  await engine.init()
  const output = new Tone.Gain(1)
  output.toDestination()
  engine.getOutputNode().connect(output.input as unknown as AudioNode)
  stateRef.current = { engine, output, notes: [] }
  return stateRef.current
}

function stopWholeEngine(state: WholeEngineState | null): void {
  if (!state) return
  for (const note of state.notes) state.engine.noteOff(note)
  state.notes = []
}

async function syncWholeInstrument(stateRef: MutableRefObject<WholeEngineState | null>): Promise<void> {
  const settings = useWholeInstrumentStore.getState()
  if (settings.type === 'off' || settings.volume <= 0) {
    stopWholeEngine(stateRef.current)
    return
  }

  const mapped = mapWholeInstrument(settings, universeFeatures())
  const state = await ensureWholeEngine(stateRef)
  const width = clamp(mapped.width, 0, 1)
  const nextNotes = mapped.notes

  const params: AmbientOscillatorParams = {
    waveform: 'sine',
    waveformLeft: 'sine',
    waveformRight: width > 0.15 ? 'triangle' : 'sine',
    attack: mapped.attack,
    decay: 1.2,
    sustain: 0.82,
    release: mapped.release,
    filterCutoff: mapped.cutoff,
    filterResonance: mapped.resonance,
    level: mapped.level,
    lfoTarget: 'filter',
    lfoRate: mapped.lfoRate,
    lfoDepth: mapped.lfoDepth,
    lfoWaveform: 'sine',
  }
  state.engine.setParams(params)
  state.engine.setOutputSpatial(mapped.outputScale, mapped.pan)

  const old = new Set(state.notes)
  const next = new Set(nextNotes)
  for (const note of state.notes) {
    if (!next.has(note)) state.engine.noteOff(note)
  }
  for (const note of nextNotes) {
    if (!old.has(note)) state.engine.noteOn(note, 0.55)
  }
  state.notes = nextNotes
}

export function WholeInstrumentLayer() {
  const stateRef = useRef<WholeEngineState | null>(null)
  const syncRunningRef = useRef(false)

  useEffect(() => {
    registerRealtimeSync('whole-instrument', () => {
      if (syncRunningRef.current) return
      syncRunningRef.current = true
      syncWholeInstrument(stateRef).finally(() => { syncRunningRef.current = false })
    })
    return () => unregisterRealtimeSync('whole-instrument')
  }, [])

  useEffect(() => {
    return () => {
      const state = stateRef.current
      if (!state) return
      stopWholeEngine(state)
      state.engine.dispose()
      state.output.dispose()
      stateRef.current = null
    }
  }, [])

  return null
}
