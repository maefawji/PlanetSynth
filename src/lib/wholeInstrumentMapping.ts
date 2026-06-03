import type { OrbitTelemetrySnapshot } from './orbitTelemetry'
import type { WholeInstrumentSettings, WholeInstrumentSource } from '../store/wholeInstrumentStore'
import { WHOLE_ORBIT_SOURCES } from './wholeOrbitSources'
import type { OrbitTransformValues } from './orbitTransform'

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

export function mapWholeInstrument(settings: WholeInstrumentSettings, values: WholeInstrumentFeatureValues, transform?: OrbitTransformValues): WholeInstrumentMappedParams {
  const mass = values.mass
  const speed = values.speed
  const count = values.count
  const levelBus = transform?.level ?? clamp(mass * 0.62 + count * 0.38, 0, 1)
  const cutoffBus = transform?.cutoff ?? clamp(values.z * 0.58 + speed * 0.42, 0, 1)
  const motionBus = transform?.motion ?? speed
  const depthBus = transform?.depth ?? clamp(values.spread * 0.55 + values.nearest * 0.45, 0, 1)
  const panBus = transform?.pan ?? values['center-x']
  const rootBus = transform?.root ?? values['center-y']
  const widthBus = transform?.width ?? values.spread
  const tensionBus = transform?.tension ?? clamp(values.nearest * 0.72 + speed * 0.28, 0, 1)

  const width = clamp(settings.width * (0.25 + widthBus * 0.75), 0, 1)
  const tension = clamp(tensionBus, 0, 1)
  const register = Math.round((rootBus - 0.5) * 14)
  const rootNote = Math.round(clamp(settings.rootNote + register, 24, 76))
  const color = tension > 0.66 ? [0, 6, 10, 17] : widthBus > 0.52 ? [0, 7, 12, 19] : [0, 5, 12, 17]
  const noteCount = count > 0.72 ? 4 : count > 0.34 ? 3 : 2

  return {
    level: clamp(settings.volume * (0.38 + levelBus * 0.62), 0, 1),
    cutoff: clamp(settings.brightness * (0.45 + cutoffBus * 1.45), 80, 12000),
    resonance: clamp(0.16 + tension * 1.15, 0.16, 1.45),
    lfoRate: clamp(0.04 + settings.motion * 1.35 + motionBus * 2.4, 0.04, 5),
    lfoDepth: clamp(0.05 + settings.motion * 0.18 + depthBus * 0.48, 0, 0.8),
    pan: clamp((panBus - 0.5) * 2 * width, -0.85, 0.85),
    outputScale: clamp(0.82 + levelBus * 0.36, 0.8, 1.28),
    rootNote,
    notes: color.slice(0, noteCount).map(n => rootNote + n),
    attack: clamp(2.2 + (1 - motionBus) * 5.2 + widthBus * 1.2, 1.5, 8.5),
    release: clamp(4.0 + widthBus * 3.5 + (1 - motionBus) * 1.4, 3, 9),
    width,
    tension,
    register,
  }
}
