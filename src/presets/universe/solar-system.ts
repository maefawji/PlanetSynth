// ── Universe Preset: Solar System ─────────────────────────────────────────────
// 太陽系をモデルにした7体構成（Sun + Mercury〜Saturn）。

import type { UniversePreset } from '../types'
import type { PlanetBody } from '../../store/planetStore'
import {
  BODY_DRONE_DEFAULTS,
  BODY_MIDI_DEFAULTS,
} from '../../store/planetStore'

// ── Body factory ──────────────────────────────────────────────────────────────

const PRESET_BODY_DEFAULTS = {
  orbitLoopNumer: 1,
  orbitLoopDenom: 1,
  effectorType:         'none'  as const,
  effectorDistance:     200,
  effectorMaxWet:       0.7,
  effectorDecay:        2.5,
  effectorDelayDivision: 0.25,
  effectorFeedback:     0.9,
  effectorDistortion:   0.4,
  effectorChorusFreq:   1.5,
  effectorChorusDepth:  0.5,
  ...BODY_DRONE_DEFAULTS,
  ...BODY_MIDI_DEFAULTS,
  muted:  false,
  volume: 1,
}

function planet(
  id: string,
  name: string,
  mass: number,
  distance: number,
  eccentricity: number,
  color: string,
  sunMass = 1000,
): PlanetBody {
  const perihelion = distance * (1 - eccentricity)
  const speed = Math.sqrt(sunMass * (1 + eccentricity) / Math.max(1, perihelion))
  return {
    id, name, type: 'planet', mass,
    x: perihelion, y: 0, z: 0,
    vx: 0, vy: speed,
    fixed: false, color, sampleId: null,
    ...PRESET_BODY_DEFAULTS,
  }
}

// ── Preset definition ─────────────────────────────────────────────────────────

export const solarSystem: UniversePreset = {
  id:          'universe-solar-system',
  name:        'Solar System',
  description: '太陽系モデル。Sun + Mercury, Venus, Earth, Mars, Jupiter, Saturn',
  icon:        '☀',
  bodies: [
    {
      id: 'sun', name: 'Sun', type: 'sun', mass: 1000,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, fixed: true,
      color: '#f59e0b', sampleId: null,
      ...PRESET_BODY_DEFAULTS,
    },
    planet('mercury', 'Mercury', 0.12,  95, 0.21, '#a3a3a3'),
    planet('venus',   'Venus',   0.82, 145, 0.01, '#eab308'),
    planet('earth',   'Earth',   1.00, 195, 0.02, '#38bdf8'),
    planet('mars',    'Mars',    0.25, 255, 0.09, '#ef4444'),
    planet('jupiter', 'Jupiter', 12.0, 390, 0.05, '#d97706'),
    planet('saturn',  'Saturn',  9.00, 520, 0.06, '#facc15'),
  ],
  simParams: {
    G: 1, epsilon: 8, dt: 0.16,
    trailLength: 1200, showTrails: true, showVelocityVectors: false, paused: false,
    rendezvousDistance:   50,
    orbitTriggerMode:     'orbit-complete',
    sampleStretchMode:    'rate',
    sampleOrbitSource:    'predicted',
    sampleLoopMode:       'loop',
  },
}
