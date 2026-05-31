// ── AmbientOscillatorLayer ────────────────────────────────────────────────────
// Headless component: manages one AmbientOscillatorEngine per body that has
// instrument = 'instrument-ambient-osc' in its effective rack.
//
// Each active body holds one continuous note (ambientOscNote param).
// Engine output is wired to the rack bus so effects apply normally.
//
// noteOn / noteOff are also exposed via getBodyAmbientOscEngine() so that
// the rack UI test button and future MIDI triggers can call them directly.

import { useEffect, useRef } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import { useControlSetStore } from '../../store/controlSetStore'
import {
  AmbientOscillatorEngine,
  type AmbientOscillatorParams,
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

// ── Module-level registry ─────────────────────────────────────────────────────
// Lets PlanetRack UI test button and future MIDI code reach engines.

const _engines    = new Map<string, AmbientOscillatorEngine>()
const _heldNotes  = new Map<string, number>()   // bodyId → currently held MIDI note

export function getBodyAmbientOscEngine(
  bodyId: string,
): AmbientOscillatorEngine | undefined {
  return _engines.get(bodyId)
}

// ── Sync ──────────────────────────────────────────────────────────────────────

type EngineMap = Map<string, AmbientOscillatorEngine>

async function syncEngines(engines: EngineMap): Promise<void> {
  const { bodies } = usePlanetStore.getState()
  const { getBodyEffectiveParams } = useControlSetStore.getState()

  const activeIds = new Set<string>()

  for (const body of bodies) {
    const ep   = getBodyEffectiveParams(body.id) as Record<string, unknown>
    const type = String(ep.ambientOscType ?? 'off')
    if (type !== 'ambient-osc' || body.muted) continue

    activeIds.add(body.id)

    const p: AmbientOscillatorParams = {
      waveform:         (ep.ambientOscWaveform as OscillatorType) ?? 'sine',
      attack:           Number(ep.ambientOscAttack          ?? 1.5),
      release:          Number(ep.ambientOscRelease         ?? 3.0),
      filterCutoff:     Number(ep.ambientOscFilterCutoff    ?? 1200),
      filterResonance:  Number(ep.ambientOscFilterResonance ?? 0.3),
      level:            Number(ep.ambientOscLevel           ?? 0.5),
    }
    const note    = Math.round(Number(ep.ambientOscNote ?? 60))
    const bodyVol = Math.max(0, Math.min(1, body.volume ?? 1))

    let eng = engines.get(body.id)

    if (!eng) {
      // First time: create, wire, start note
      eng = new AmbientOscillatorEngine()
      await eng.init()
      eng.setParams(p)
      // Engine outputs at unity — volume & localization handled entirely by rack bus
      eng.setOutputSpatial(1, 0)
      engines.set(body.id, eng)
      _engines.set(body.id, eng)
      retainBus(body.id)
      eng.getOutputNode().connect(getBusInputNode(body.id))
      eng.noteOn(note)
      _heldNotes.set(body.id, note)
    } else {
      // Subsequent: just update params
      eng.setParams(p)

      // Re-trigger if the held note changed
      const prevNote = _heldNotes.get(body.id)
      if (prevNote !== note) {
        if (prevNote !== undefined) eng.noteOff(prevNote)
        eng.noteOn(note)
        _heldNotes.set(body.id, note)
      }
    }

    // Body volume fader → rack bus (Volume Slider in diagram)
    setBusVolume(body.id, body.muted ? 0 : bodyVol)

    // VU meter (pre-localization estimate)
    const vu = p.level * bodyVol
    setBodyOutputLevel(body.id, 'ambient-osc', vu, 900)
  }

  // Stop engines for bodies that are no longer active
  for (const [id, eng] of engines) {
    if (!activeIds.has(id)) {
      const note = _heldNotes.get(id)
      if (note !== undefined) eng.noteOff(note)
      _heldNotes.delete(id)
      engines.delete(id)
      _engines.delete(id)
      releaseBus(id)
      clearBodyOutputLevel(id, 'ambient-osc')
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AmbientOscillatorLayer() {
  const enginesRef     = useRef<EngineMap>(new Map())
  const syncRunningRef = useRef(false)

  useEffect(() => {
    registerRealtimeSync('ambient-osc', () => {
      if (syncRunningRef.current) return
      syncRunningRef.current = true
      syncEngines(enginesRef.current).finally(() => {
        syncRunningRef.current = false
      })
    })
    return () => unregisterRealtimeSync('ambient-osc')
  }, [])

  // Stop all on unmount
  useEffect(() => {
    const engines = enginesRef.current
    return () => {
      for (const [id, eng] of engines) {
        const note = _heldNotes.get(id)
        if (note !== undefined) eng.noteOff(note)
        _heldNotes.delete(id)
        _engines.delete(id)
        releaseBus(id)
        clearBodyOutputLevel(id, 'ambient-osc')
      }
      engines.clear()
    }
  }, [])

  return null
}
