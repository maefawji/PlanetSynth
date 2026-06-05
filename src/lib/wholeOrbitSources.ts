import type { OrbitTelemetrySnapshot } from './orbitTelemetry'
import type { WholeInstrumentSource } from '../store/wholeInstrumentStore'

export type WholeOrbitSourceDef = {
  key: WholeInstrumentSource
  label: string
  rawLabel: string
  color: string
  value: (telemetry: OrbitTelemetrySnapshot) => number
  rawValue: (telemetry: OrbitTelemetrySnapshot) => number
  detail: string
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
}

function signedNorm(v: number, scale: number): number {
  return clamp01(v / (scale * 2) + 0.5)
}

export const WHOLE_ORBIT_SOURCES: WholeOrbitSourceDef[] = [
  {
    key: 'count',
    label: 'body count',
    rawLabel: 'bodies',
    color: '#818cf8',
    value: t => clamp01(t.whole.bodyCount / 16),
    rawValue: t => t.whole.bodyCount,
    detail: 'count / 16',
  },
  {
    key: 'mass',
    label: 'total mass',
    rawLabel: 'total mass',
    color: '#fbbf24',
    value: t => t.whole.norm.totalMass,
    rawValue: t => t.whole.totalMass,
    detail: 'mass / 1600',
  },
  {
    key: 'speed',
    label: 'avg speed',
    rawLabel: 'average |v|',
    color: '#34d399',
    value: t => t.whole.norm.avgSpeed,
    rawValue: t => t.whole.avgSpeed,
    detail: 'avg speed / 4',
  },
  {
    key: 'spread',
    label: 'avg spread',
    rawLabel: 'avg distance from mass center',
    color: '#60a5fa',
    value: t => t.whole.norm.avgSpread,
    rawValue: t => t.whole.avgSpread,
    detail: 'spread / 900',
  },
  {
    key: 'z',
    label: 'z spread',
    rawLabel: 'max(z)-min(z)',
    color: '#f472b6',
    value: t => t.whole.norm.zSpread,
    rawValue: t => t.whole.zSpread,
    detail: 'z spread / 600',
  },
  {
    key: 'nearest',
    label: 'nearest',
    rawLabel: 'nearest body pair distance',
    color: '#fb923c',
    value: t => t.whole.norm.nearestDistance,
    rawValue: t => t.whole.nearestDistance,
    detail: '1 - nearest / 800',
  },
  {
    key: 'center-x',
    label: 'center x',
    rawLabel: 'mass center x',
    color: '#22d3ee',
    value: t => signedNorm(t.whole.centerX, 1000),
    rawValue: t => t.whole.centerX,
    detail: 'x mapped -1000..1000',
  },
  {
    key: 'center-y',
    label: 'center y',
    rawLabel: 'mass center y',
    color: '#a78bfa',
    value: t => signedNorm(t.whole.centerY, 1000),
    rawValue: t => t.whole.centerY,
    detail: 'y mapped -1000..1000',
  },
]

// ── Extended sources (heavier computation, but still O(n²) — fine for n<50) ──

export const WHOLE_ORBIT_SOURCES_EXTENDED: WholeOrbitSourceDef[] = [
  {
    key: 'mean-radius',
    label: 'mean radius',
    rawLabel: 'mean dist from sun',
    color: '#34d399',
    value: t => t.whole.norm.meanRadius,
    rawValue: t => t.whole.meanRadius,
    detail: 'mean |r| / 1000  →  pitch / LFO rate',
  },
  {
    key: 'radius-spread',
    label: 'radius spread',
    rawLabel: 'std-dev of radii',
    color: '#60a5fa',
    value: t => t.whole.norm.radiusSpread,
    rawValue: t => t.whole.radiusSpread,
    detail: 'σ(r) / 500  →  filter cutoff',
  },
  {
    key: 'center-offset',
    label: 'center offset',
    rawLabel: 'CoM distance from sun',
    color: '#22d3ee',
    value: t => t.whole.norm.centerOffset,
    rawValue: t => t.whole.centerOffset,
    detail: '|CoM – sun| / 600  →  pan / LFO depth',
  },
  {
    key: 'angular-momentum',
    label: 'angular mom.',
    rawLabel: 'Σ m(xVy−yVx) / M',
    color: '#a78bfa',
    value: t => t.whole.norm.angularMomentum,
    rawValue: t => t.whole.angularMomentum,
    detail: 'norm 0–2000  →  rotation / phaser',
  },
  {
    key: 'phase-entropy',
    label: 'phase entropy',
    rawLabel: 'angle bin entropy',
    color: '#f472b6',
    value: t => t.whole.norm.phaseEntropy,
    rawValue: t => t.whole.phaseEntropy,
    detail: 'Shannon H (8-bin) [0,1]  →  noise / reverb',
  },
  {
    key: 'close-pairs',
    label: 'close pairs',
    rawLabel: 'pairs < 200 units',
    color: '#fb923c',
    value: t => t.whole.norm.closePairCount,
    rawValue: t => t.whole.closePairCount,
    detail: 'count / 6  →  trigger density',
  },
  {
    key: 'kinetic-energy',
    label: 'kinetic energy',
    rawLabel: 'Σ ½mv²',
    color: '#fbbf24',
    value: t => t.whole.norm.kineticEnergy,
    rawValue: t => t.whole.kineticEnergy,
    detail: 'log1p(KE) / log1p(50k)  →  brightness / level',
  },
  {
    key: 'tension',
    label: 'tension',
    rawLabel: '1 / nearest distance',
    color: '#f87171',
    value: t => t.whole.norm.tension,
    rawValue: t => t.whole.tension,
    detail: '(1/nearest) / 0.05  →  distortion / transient',
  },
]

export const ALL_WHOLE_ORBIT_SOURCES = [...WHOLE_ORBIT_SOURCES, ...WHOLE_ORBIT_SOURCES_EXTENDED]
export const WHOLE_ORBIT_SOURCE_MAP = new Map(ALL_WHOLE_ORBIT_SOURCES.map(source => [source.key, source]))

export function wholeOrbitSourceDef(source: WholeInstrumentSource): WholeOrbitSourceDef {
  return WHOLE_ORBIT_SOURCE_MAP.get(source) ?? WHOLE_ORBIT_SOURCES[0]
}

export function wholeOrbitSourceValue(source: WholeInstrumentSource, telemetry: OrbitTelemetrySnapshot): number {
  return wholeOrbitSourceDef(source).value(telemetry)
}
