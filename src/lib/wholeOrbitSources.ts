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

export const WHOLE_ORBIT_SOURCE_MAP = new Map(WHOLE_ORBIT_SOURCES.map(source => [source.key, source]))

export function wholeOrbitSourceDef(source: WholeInstrumentSource): WholeOrbitSourceDef {
  return WHOLE_ORBIT_SOURCE_MAP.get(source) ?? WHOLE_ORBIT_SOURCES[0]
}

export function wholeOrbitSourceValue(source: WholeInstrumentSource, telemetry: OrbitTelemetrySnapshot): number {
  return wholeOrbitSourceDef(source).value(telemetry)
}
