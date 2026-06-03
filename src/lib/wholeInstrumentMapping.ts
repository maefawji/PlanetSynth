import type { OrbitTelemetrySnapshot } from './orbitTelemetry'
import type { WholeInstrumentSettings, WholeInstrumentSource } from '../store/wholeInstrumentStore'
import { WHOLE_ORBIT_SOURCES } from './wholeOrbitSources'

export type WholeInstrumentFeatureValues = Record<WholeInstrumentSource, number>

export type WholeInstrumentMappedParams = {
  level: number
  cutoff: number
  resonance: number
  lfoRate: number
  lfoDepth: number
  pan: number
  outputScale: number
  rootNote: number
  notes: number[]
  attack: number
  release: number
  width: number
  tension: number
  register: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo))
}

export function wholeFeatureValues(telemetry: OrbitTelemetrySnapshot): WholeInstrumentFeatureValues {
  return Object.fromEntries(WHOLE_ORBIT_SOURCES.map(source => [source.key, source.value(telemetry)])) as WholeInstrumentFeatureValues
}

export function mapWholeInstrument(settings: WholeInstrumentSettings, values: WholeInstrumentFeatureValues): WholeInstrumentMappedParams {
  const mass = values.mass
  const spread = values.spread
  const speed = values.speed
  const nearest = values.nearest
  const centerX = values['center-x']
  const centerY = values['center-y']
  const z = values.z
  const count = values.count

  const width = clamp(settings.width * (0.25 + spread * 0.75), 0, 1)
  const tension = clamp(nearest * 0.72 + speed * 0.28, 0, 1)
  const register = Math.round((centerY - 0.5) * 14)
  const rootNote = Math.round(clamp(settings.rootNote + register, 24, 76))
  const color = tension > 0.66 ? [0, 6, 10, 17] : spread > 0.52 ? [0, 7, 12, 19] : [0, 5, 12, 17]
  const noteCount = count > 0.72 ? 4 : count > 0.34 ? 3 : 2

  return {
    level: clamp(settings.volume * (0.38 + mass * 0.42 + count * 0.2), 0, 1),
    cutoff: clamp(settings.brightness * (0.45 + z * 0.95 + speed * 0.5), 80, 12000),
    resonance: clamp(0.16 + tension * 1.15, 0.16, 1.45),
    lfoRate: clamp(0.04 + settings.motion * 1.35 + speed * 2.4, 0.04, 5),
    lfoDepth: clamp(0.05 + settings.motion * 0.18 + spread * 0.26 + tension * 0.22, 0, 0.8),
    pan: clamp((centerX - 0.5) * 2 * width, -0.85, 0.85),
    outputScale: clamp(0.82 + mass * 0.36, 0.8, 1.28),
    rootNote,
    notes: color.slice(0, noteCount).map(n => rootNote + n),
    attack: clamp(2.2 + (1 - speed) * 5.2 + spread * 1.2, 1.5, 8.5),
    release: clamp(4.0 + spread * 3.5 + (1 - speed) * 1.4, 3, 9),
    width,
    tension,
    register,
  }
}
