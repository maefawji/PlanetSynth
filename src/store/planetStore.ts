import { create } from 'zustand'

// ── Domain types ──────────────────────────────────────────────────────────────

export type PlanetBodyType = 'sun' | 'planet'

export type EffectorType = 'none' | 'reverb' | 'delay' | 'distortion' | 'chorus' | 'phaser' | 'autofilter' | 'bitcrush' | 'freeze' | 'microphone'

export type DroneType = 'none' | 'pad'

export interface PlanetBody {
  id: string
  name: string
  type: PlanetBodyType
  /** Bayer-style designation: "Beta Umbrae". Stored for future detail view. */
  designation?: string
  /** Internal catalog ID: "PLSYN-0187". Always unique within the session. */
  catalogId?: string
  mass: number
  x: number
  y: number
  /** Visual depth. Physics stays 2D; z affects projected canvas size for now. */
  z: number
  vx: number
  vy: number
  fixed: boolean
  /** Manual facing angle used when this body becomes the standpoint listener. */
  standpointFacingAngle?: number
  color: string
  /** Legacy body-level sample id kept for project compatibility. New sample selection lives on instruments. */
  sampleId: string | null
  /** Orbit-stretch loop ratio: sample loops = orbitLoopNumer per orbitLoopDenom orbits.
   *  e.g. numer=1, denom=2 → 1 loop every 2 orbits (displayed "1/2"). */
  orbitLoopNumer: number
  orbitLoopDenom: number
  /** Effector: this body acts as an audio effect processor for nearby planets. */
  effectorType: EffectorType
  effectorDistance: number   // world-unit radius of effect zone
  effectorMaxWet: number     // wet amount at distance 0 (0-1)
  effectorDecay: number           // reverb decay (s)
  effectorDelayDivision: number   // delay time as orbit fraction (2, 1, 0.5, 0.25, 0.125, 0.0625)
  effectorFeedback: number        // delay feedback (0-0.95)
  effectorDistortion: number // distortion amount (0-1)
  effectorChorusFreq: number // chorus LFO rate (Hz)
  effectorChorusDepth: number // chorus depth (0-1)
  /** Per-body new effect params (defaults used when rack doesn't override) */
  effectorPhaserRate: number
  effectorPhaserOctaves: number
  effectorAutoFilterFreq: number
  effectorAutoFilterDepth: number
  effectorAutoFilterBaseFreq: number
  effectorBitDepth: number
  effectorFreezeDecay: number
  /** Microphone effector: gain for the body's own instrument signal (Input 1) */
  micSelfGain: number
  /** Microphone effector: max gain for proximity pickup (Input 2, at distance=0) */
  micPickupGain: number
  /** Instrument: this body produces a continuous drone pad sound */
  droneType: DroneType
  droneMode: DroneMode         // 'manual' = fixed params; 'orbit' = params from orbital state
  droneRootNote: string        // e.g. 'A2', 'C3'
  droneVolume: number          // 0–1
  droneBrightness: number      // filter cutoff Hz, 200–8000
  droneMelt: number            // 0–1 LFO depth
  droneDetune: number          // cents spread between voices
  droneMotion: number          // 0–1 LFO speed
  droneAttack: number          // seconds
  droneRelease: number         // seconds
  droneReverbMix: number       // 0–1 dry/wet
  /** Mute this body's audio output entirely */
  muted: boolean
  /** Per-body volume scale 0–1 */
  volume: number
  /** MIDI OUT: channel this body's trigger signal is sent on (1–16) */
  midiChannel: number
  /** MIDI OUT: note number to send when triggered (0–127) */
  midiNote: number
  /** MIDI OUT: velocity to send when triggered (1–127) */
  midiVelocity: number
}

export interface PlanetSimParams {
  G: number
  epsilon: number      // softening length (prevents singularity)
  dt: number           // integration time step
  trailLength: number  // number of trail samples stored per body
  showTrails: boolean
  showVelocityVectors: boolean
  showBodyOscilloscope: boolean
  showRackBodyOscilloscope: boolean
  bodyOscilloscopeStrokeWidth: number
  bodyOscilloscopeHeight: number
  bodyOscilloscopeGap: number
  showTriggerStars: boolean
  triggerStarShape: 'star' | 'dot'
  triggerStarSize: number
  triggerStarMaxCount: number
  triggerStarLifetimeMs: number
  triggerStarSpread: number
  triggerStarLineWidth: number
  triggerStarGlow: number
  triggerStarFadeStart: number
  rackBodyOscilloscopeStrokeWidth: number
  rackBodyOscilloscopeHeight: number
  rackBodyOscilloscopeGap: number
  paused: boolean
  simpleTheme: boolean       // light-background canvas look
  rendezvousDistance: number // world-units threshold that triggers body sounds
  collisionExcludeSun: boolean    // exclude fixed/sun bodies from collision checks
  collisionSpawnStar: boolean     // spawn trigger star on collision event
  collisionShowCircles: boolean   // show collision radius circles on canvas
  orbitTriggerMode: 'none' | 'orbit-complete'  // retrigger sample each completed orbit
  orbitTriggerDivision: number   // orbit fraction per trigger: 2=every2orbits, 0.5=twice/orbit
  orbitTriggerType: 'periodic' | 'cumulative' | 'tperiod'  // periodic=every N orbits; cumulative=charge→fire; tperiod=T seconds after last trigger
  showOrbitTriggerMarkers: boolean  // show trigger position dots on canvas
  orbitStretchMode: boolean  // stretch sample playback rate to match orbital period
  probeMass: number          // mass of the mouse-probe cursor (0 = measurement only)
  rendezvousTriggerMode: 'oneshot' | 'toggle'  // oneshot = one-shot play; toggle = loop on/off
  triggerPlaybackMode: 'restart' | 'layer'     // restart = retrigger same voice; layer = overlap one-shots
  showPredictedOrbit: boolean                   // show trajectory preview during drag placement
  autoSpawnPlanets: boolean                      // automatically add planet bodies inside the standpoint range
  autoSpawnIntervalSec: number                   // add one planet after this many seconds
  autoSpawnMinPlanets: number                    // add planets when count falls below this
  autoSpawnMaxPlanets: number                    // interval spawning stops at this many planets
  autoSpawnRadiusMin: number                     // spawn radius around standpoint body
  autoSpawnRadiusMax: number
  autoSpawnMassMin: number
  autoSpawnMassMax: number
  autoSpawnSpeedMin: number
  autoSpawnSpeedMax: number
  standpointMode: boolean       // enable standpoint distance volume control
  standpointBodyId: string | null  // which body is the "listener" standpoint
  standpointMaxDist: number     // world-units distance at which volume reaches standpointMinVol
  standpointMinVol: number      // minimum volume at max distance (0 = silent)
  /** Directional (cone) attenuation from the standpoint */
  showStandpointVisual: boolean            // show standpoint ring/cone on canvas
  standpointDirectional: boolean          // enable directional cone
  standpointFacing: 'velocity' | 'manual' // direction source
  standpointFacingAngle: number           // manual facing direction (degrees, 0 = right)
  standpointConeWidth: number             // full cone width (degrees, 0-360)
  standpointOuterVol: number              // volume at 180° from facing (0 = silent behind)
  standpointStereo: boolean               // pan sources left/right relative to standpoint facing
  standpointStereoWidth: number           // stereo pan strength 0–1 (1 = full ±1, 0 = center)
  standpointFrontBack: boolean            // attenuate sources behind the standpoint
  standpointRearVol: number               // volume at directly behind when front/back is enabled
  /** Effector params — used by the rack system when a body has an effector control set assigned */
  effectorType: EffectorType
  effectorDistance: number
  effectorMaxWet: number
  effectorDecay: number            // reverb decay (s)
  effectorDelayDivision: number    // delay time as orbit fraction (2, 1, 0.5, 0.25, 0.125, 0.0625)
  effectorFeedback: number         // delay feedback (0-0.95)
  effectorDistortion: number  // distortion amount (0-1)
  effectorChorusFreq: number  // chorus LFO rate (Hz)
  effectorChorusDepth: number // chorus depth (0-1)
  /** Microphone effector */
  micSelfGain: number         // Input 1: own instrument gain (0–2)
  micPickupGain: number       // Input 2: max pickup gain at distance=0 (0–2)
  /** Drone instrument — per-body pad synth params (overridable via body rack) */
  droneType: DroneType
  droneMode: DroneMode
  droneRootNote: string
  droneVolume: number
  droneBrightness: number
  droneMelt: number
  droneDetune: number
  droneMotion: number
  droneAttack: number
  droneRelease: number
  droneReverbMix: number
  /** ADSR envelope applied to every triggered / looping sample */
  adsrMode: 'off' | 'manual' | 'orbit'
  adsrAttack:  number   // 0–3s
  adsrDecay:   number   // 0–3s
  adsrSustain: number   // 0–1
  adsrRelease: number   // 0–5s
  /** Display: scale body radius from mass instead of cube-root sizing. */
  bodyRadiusFromMass: boolean
  /** Display radius scale for planets when bodyRadiusFromMass is enabled. */
  bodyRadiusMassScalePlanet: number
  /** Display radius scale for suns when bodyRadiusFromMass is enabled. */
  bodyRadiusMassScaleSun: number
  /** Display: show assigned sample name instead of body name on canvas */
  showSampleName: boolean

  // ── Sample Playback settings ──────────────────────────────────────────────
  /** How to stretch sample playback relative to the orbit:
   *  'off'  = no stretch, normal playback
   *  'rate' = rate-stretch: playbackRate varies so 1 loop = 1 orbit (speed-proportional)
   *  'time' = time-stretch: constant-speed playback stretched to orbit duration */
  sampleStretchMode: 'off' | 'rate' | 'time'
  /** Which orbit to base calculations on:
   *  'current'   = use instantaneous angular velocity (ω)
   *  'predicted' = use the smoothed/predicted period (stable, non-instantaneous) */
  sampleOrbitSource: 'current' | 'predicted'
  /** When stretch mode is active, apply pitch correction (detune to cancel rate shift) */
  samplePitchCorrection: boolean
  /** Whether to loop the sample or play oneshot when stretch mode is active */
  sampleLoopMode: 'loop' | 'oneshot'
  /** Sampler instrument source: 'auto' = stable hash from loaded samples, 'fixed' = samplerSampleId */
  samplerMode: 'auto' | 'fixed'
  /** Sampler instrument sample id to use when samplerMode = 'fixed' */
  samplerSampleId: string | null

  // ── New Sampler instrument ────────────────────────────────────────────────
  /** Whether the per-body sampler instrument is active */
  samplerType:        'off' | 'sampler'
  samplerVolume:      number   // 0–1
  samplerPlayMode:    'oneshot' | 'loop' | 'pingpong'
  samplerSampleStart: number   // normalized 0–1 within buffer
  samplerSampleEnd:   number   // normalized 0–1 (> sampleStart)
  samplerLoopStart:   number   // normalized 0–1 within [sampleStart, sampleEnd]
  samplerLoopEnd:     number   // normalized 0–1 within slice (> loopStart)
  samplerReverse:     boolean
  samplerDetune:      number   // semitones ±24
  samplerAttack:      number   // seconds
  samplerRelease:     number   // seconds
  samplerReverbMix:   number   // 0–1

  // ── Granular synth ────────────────────────────────────────────────────────
  granularType:      'off' | 'grain'
  granularVolume:    number   // 0–1
  granularGrainSize: number   // grain duration seconds (0.02–0.5)
  granularOverlap:   number   // crossfade seconds (0.001–0.1)
  granularDetune:    number   // semitones (-24 to +24)
  granularReverbMix: number   // 0–1

  // ── FM drone synth ────────────────────────────────────────────────────────
  fmDroneType:      'off' | 'fm'
  fmDroneRootNote:  string
  fmDroneRatio:     number   // modulator/carrier frequency ratio
  fmDroneIndex:     number   // FM modulation index (0–8)
  fmDroneVolume:    number   // 0–1
  fmDroneAttack:    number   // attack seconds
  fmDroneRelease:   number   // release seconds
  fmDroneReverbMix: number   // 0–1

  // ── Noise pad synth ───────────────────────────────────────────────────────
  noisePadType:      'off' | 'noise'
  noisePadVolume:    number
  noisePadFreq:      number   // bandpass center Hz (100–4000)
  noisePadQ:         number   // filter resonance (0.5–20)
  noisePadAttack:    number   // attack seconds
  noisePadRelease:   number   // release seconds
  noisePadReverbMix: number   // 0–1

  // ── One-shot sampler ──────────────────────────────────────────────────────
  /** Whether the one-shot sampler instrument is active for this body */
  oneShotType: 'off' | 'oneshot'

  // ── New effect params ─────────────────────────────────────────────────────
  effectorPhaserRate:          number   // LFO Hz (0.05–5)
  effectorPhaserOctaves:       number   // octaves above base (1–6)
  effectorAutoFilterFreq:      number   // LFO Hz (0.05–8)
  effectorAutoFilterDepth:     number   // LFO depth 0–1
  effectorAutoFilterBaseFreq:  number   // base filter Hz (80–2000)
  effectorBitDepth:            number   // bits (2–16)
  effectorFreezeDecay:         number   // reverb tail seconds (15–60)

  // ── Osc Synth instrument ─────────────────────────────────────────────────
  oscSynthType:            'off' | 'osc-synth'
  oscSynthWaveform:        OscillatorType
  oscSynthAttack:          number           // A: seconds (0.001–20)
  oscSynthDecay:           number           // D: seconds (0.01–20)
  oscSynthSustain:         number           // S: 0–1
  oscSynthRelease:         number           // R: seconds (0.01–30)
  oscSynthFilterCutoff:    number           // Hz (80–12000)
  oscSynthFilterResonance: number           // Q (0.01–15)
  oscSynthLevel:           number           // 0–1
  oscSynthLfoTarget:       'off' | 'pitch' | 'filter' | 'amplitude'
  oscSynthLfoRate:         number           // Hz (0.01–20)
  oscSynthLfoDepth:        number           // 0–1
  oscSynthLfoWaveform:     OscillatorType
  // Orbit-driven source selectors for OscSynth params
  oscSynthAttackSource:    OscOrbitSource
  oscSynthAttackRate:      number
  oscSynthDecaySource:     OscOrbitSource
  oscSynthDecayRate:       number
  oscSynthSustainSource:   OscOrbitSource
  oscSynthSustainRate:     number
  oscSynthReleaseSource:   OscOrbitSource
  oscSynthReleaseRate:     number
  oscSynthCutoffSource:    OscOrbitSource
  oscSynthCutoffRate:      number
  oscSynthLfoRateSource:   OscOrbitSource
  oscSynthLfoRateRate:     number
  oscSynthLfoDepthSource:  OscOrbitSource
  oscSynthLfoDepthRate:    number

  // ── Arpeggiator trigger ───────────────────────────────────────────────────
  arpMode:   boolean   // true = this trigger cycles through arp notes
  arpPlayMode: 'arp' | 'chord'
  arpLength: number    // active step count 1–4
  arpNote0:  number    // step 0 (default 48 = C3)
  arpNote1:  number    // step 1 (default 52 = E3)
  arpNote2:  number    // step 2 (default 55 = G3)
  arpNote3:  number    // step 3 (default 59 = B3)
  arpChordRoot: number
  arpChordQuality: 'Major' | 'Minor' | 'Sus2' | 'Sus4' | 'Dim' | 'Aug' | 'Maj7' | 'Min7' | 'Dom7'
  arpChordOctave: number
  arpChordInversion: number
  arpChordProgressionEnabled: boolean
  arpChordProgression: string
  arpChordScaleMode: 'major' | 'minor'
}

// ── Next-body placement defaults ──────────────────────────────────────────────

export interface NextBodyDefaults {
  mass: number
  color: string
  fixed: boolean
  randomColor: boolean   // true = generate a fresh hue on each placement
}

export const DEFAULT_NEXT_SUN: NextBodyDefaults = {
  mass: 1000, color: '#f59e0b', fixed: true, randomColor: true,
}
export const DEFAULT_NEXT_PLANET: NextBodyDefaults = {
  mass: 1, color: '#60a5fa', fixed: false, randomColor: true,
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export type DroneMode = 'manual' | 'orbit'

/** Which orbit metric drives an OscSynth param when not 'manual'. */
export type OscOrbitSource = 'manual' | 'period' | 'eccentricity' | 'distance' | 'velocity' | 'speed' | 'acceleration' | 'bound'

export const BODY_DRONE_DEFAULTS = {
  droneType: 'none' as DroneType,
  droneMode: 'manual' as DroneMode,
  droneRootNote: 'A2',
  droneVolume: 0.35,
  droneBrightness: 1200,
  droneMelt: 0.5,
  droneDetune: 8,
  droneMotion: 0.4,
  droneAttack: 6.0,
  droneRelease: 12.0,
  droneReverbMix: 0.55,
}

export const BODY_MIDI_DEFAULTS = {
  midiChannel:  1,
  midiNote:     60,   // middle C
  midiVelocity: 100,
}

const BODY_EFFECTOR_DEFAULTS = {
  effectorType: 'none' as EffectorType,
  effectorDistance: 200,
  effectorMaxWet: 0.7,
  effectorDecay: 2.5,
  effectorDelayDivision: 0.25,
  effectorFeedback: 0.9,
  effectorDistortion: 0.4,
  effectorChorusFreq: 1.5,
  effectorChorusDepth: 0.5,
  effectorPhaserRate: 0.5,
  effectorPhaserOctaves: 3,
  effectorAutoFilterFreq: 1.0,
  effectorAutoFilterDepth: 1.0,
  effectorAutoFilterBaseFreq: 200,
  effectorBitDepth: 8,
  effectorFreezeDecay: 30,
  micSelfGain: 1.0,
  micPickupGain: 1.0,
  muted: false,
  volume: 0.7,  // ≈ -3.1 dB (linear 0–1)
}

export const DEFAULT_BODIES: PlanetBody[] = [
  {
    id: 'sun', name: 'Sun', type: 'sun',
    mass: 1000, x: 0, y: 0, z: 0, vx: 0, vy: 0,
    fixed: true, color: '#f59e0b', sampleId: null,
    standpointFacingAngle: 270,
    orbitLoopNumer: 1, orbitLoopDenom: 1,
    ...BODY_EFFECTOR_DEFAULTS,
    ...BODY_DRONE_DEFAULTS,
    ...BODY_MIDI_DEFAULTS,
  },
  {
    id: 'planet', name: 'Planet', type: 'planet',
    mass: 1, x: 280, y: 0, z: 0, vx: 0, vy: 1.89,
    fixed: false, color: '#60a5fa', sampleId: null,
    orbitLoopNumer: 1, orbitLoopDenom: 1,
    ...BODY_EFFECTOR_DEFAULTS,
    ...BODY_DRONE_DEFAULTS,
    ...BODY_MIDI_DEFAULTS, midiNote: 62,
  },
  {
    id: 'perturber', name: 'Perturber', type: 'planet',
    mass: 80, x: -600, y: 180, z: 0, vx: 1.2, vy: 0,
    fixed: false, color: '#f472b6', sampleId: null,
    orbitLoopNumer: 1, orbitLoopDenom: 1,
    ...BODY_EFFECTOR_DEFAULTS,
    ...BODY_DRONE_DEFAULTS,
    ...BODY_MIDI_DEFAULTS, midiNote: 64,
  },
]

export const DEFAULT_SIM_PARAMS: PlanetSimParams = {
  G: 1,
  epsilon: 5,
  dt: 0.2,
  trailLength: 600,
  showTrails: true,
  showVelocityVectors: false,
  showBodyOscilloscope: true,
  showRackBodyOscilloscope: true,
  bodyOscilloscopeStrokeWidth: 0.5,
  bodyOscilloscopeHeight: 30,
  bodyOscilloscopeGap: 10,
  showTriggerStars: true,
  triggerStarShape: 'star' as const,
  triggerStarSize: 7,
  triggerStarMaxCount: 160,
  triggerStarLifetimeMs: 680,
  triggerStarSpread: 2.2,
  triggerStarLineWidth: 1.25,
  triggerStarGlow: 3.2,
  triggerStarFadeStart: 0.18,
  rackBodyOscilloscopeStrokeWidth: 1,
  rackBodyOscilloscopeHeight: 30,
  rackBodyOscilloscopeGap: 13,
  paused: false,
  simpleTheme: false,
  // ── Trigger defaults: OFF ─────────────────────────────────────────────────
  // The rack system's trigger CS drives triggers; simParams are the fallback.
  // Keeping these OFF ensures "empty trigger slot = no trigger".
  rendezvousDistance: 0,
  collisionExcludeSun: true,
  collisionSpawnStar: true,
  collisionShowCircles: true,
  orbitTriggerMode: 'none',
  orbitTriggerDivision: 1,
  orbitTriggerType: 'cumulative',
  showOrbitTriggerMarkers: false,
  orbitStretchMode: false,
  probeMass: 50,
  rendezvousTriggerMode: 'oneshot',
  triggerPlaybackMode: 'restart',
  showPredictedOrbit: true,
  autoSpawnPlanets: false,
  autoSpawnIntervalSec: 8,
  autoSpawnMinPlanets: 3,
  autoSpawnMaxPlanets: 12,
  autoSpawnRadiusMin: 80,
  autoSpawnRadiusMax: 650,
  autoSpawnMassMin: 1,
  autoSpawnMassMax: 10,
  autoSpawnSpeedMin: 0.4,
  autoSpawnSpeedMax: 2.4,
  standpointMode: true,
  standpointBodyId: 'sun',
  standpointMaxDist: 700,
  standpointMinVol: 0,
  showStandpointVisual: true,
  standpointDirectional: true,
  standpointFacing: 'velocity',
  standpointFacingAngle: 271,
  standpointConeWidth: 270,
  standpointOuterVol: 0.7,
  standpointStereo: false,
  standpointStereoWidth: 1.0,
  standpointFrontBack: true,
  standpointRearVol: 0.7,
  effectorType: 'none',
  effectorDistance: 200,
  effectorMaxWet: 0.7,
  effectorDecay: 2.5,
  effectorDelayDivision: 0.25,
  effectorFeedback: 0.9,
  effectorDistortion: 0.4,
  effectorChorusFreq: 1.5,
  effectorChorusDepth: 0.5,
  micSelfGain: 1.0,
  micPickupGain: 1.0,
  ...BODY_DRONE_DEFAULTS,
  adsrMode: 'manual',
  adsrAttack:  0.005,
  adsrDecay:   0.1,
  adsrSustain: 1.0,
  adsrRelease: 0.3,
  bodyRadiusFromMass: true,
  bodyRadiusMassScalePlanet: 0.1,
  bodyRadiusMassScaleSun: 0.03,
  showSampleName: false,
  sampleStretchMode: 'rate',
  sampleOrbitSource: 'current',
  samplePitchCorrection: false,
  sampleLoopMode: 'loop',
  samplerMode: 'auto',
  samplerSampleId: null,

  samplerType:        'off',
  samplerVolume:      0.7,
  samplerPlayMode:    'loop',
  samplerSampleStart: 0,
  samplerSampleEnd:   1,
  samplerLoopStart:   0,
  samplerLoopEnd:     1,
  samplerReverse:     false,
  samplerDetune:      0,
  samplerAttack:      0.01,
  samplerRelease:     1.0,
  samplerReverbMix:   0.3,

  granularType:      'off',
  granularVolume:    0.6,
  granularGrainSize: 0.08,
  granularOverlap:   0.04,
  granularDetune:    0,
  granularReverbMix: 0.5,

  fmDroneType:      'off',
  fmDroneRootNote:  'A2',
  fmDroneRatio:     3,
  fmDroneIndex:     3,
  fmDroneVolume:    0.35,
  fmDroneAttack:    4.0,
  fmDroneRelease:   8.0,
  fmDroneReverbMix: 0.5,

  noisePadType:      'off',
  noisePadVolume:    0.3,
  noisePadFreq:      600,
  noisePadQ:         8,
  noisePadAttack:    3.0,
  noisePadRelease:   6.0,
  noisePadReverbMix: 0.6,

  effectorPhaserRate:         0.5,
  effectorPhaserOctaves:      3,
  effectorAutoFilterFreq:     1.0,
  effectorAutoFilterDepth:    1.0,
  effectorAutoFilterBaseFreq: 200,
  effectorBitDepth:           8,
  effectorFreezeDecay:        30,

  oscSynthType:            'off',
  oscSynthWaveform:        'sine',
  oscSynthAttack:          0.05,
  oscSynthDecay:           0.3,
  oscSynthSustain:         0.8,
  oscSynthRelease:         1.5,
  oscSynthFilterCutoff:    2000,
  oscSynthFilterResonance: 0.5,
  oscSynthLevel:           0.7,
  oscSynthLfoTarget:       'off',
  oscSynthLfoRate:         1.0,
  oscSynthLfoDepth:        0.3,
  oscSynthLfoWaveform:     'sine',
  oscSynthAttackSource:    'manual',
  oscSynthAttackRate:      0.05,
  oscSynthDecaySource:     'manual',
  oscSynthDecayRate:       0.05,
  oscSynthSustainSource:   'manual',
  oscSynthSustainRate:     1.0,
  oscSynthReleaseSource:   'manual',
  oscSynthReleaseRate:     0.1,
  oscSynthCutoffSource:    'manual',
  oscSynthCutoffRate:      5.0,
  oscSynthLfoRateSource:   'manual',
  oscSynthLfoRateRate:     0.1,
  oscSynthLfoDepthSource:  'manual',
  oscSynthLfoDepthRate:    1.0,

  oneShotType: 'off',

  arpMode:   false,
  arpPlayMode: 'arp',
  arpLength: 4,
  arpNote0:  48,  // C3
  arpNote1:  52,  // E3
  arpNote2:  55,  // G3
  arpNote3:  59,  // B3
  arpChordRoot: 0,
  arpChordQuality: 'Maj7',
  arpChordOctave: 3,
  arpChordInversion: 0,
  arpChordProgressionEnabled: false,
  arpChordProgression: '1 2 5 7',
  arpChordScaleMode: 'major',
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface PlanetState {
  bodies: PlanetBody[]
  simParams: PlanetSimParams
  selectedBodyId: string | null
  /** Multi-selection set (e.g. from drag-rect). selectedBodyId is the primary. */
  selectedBodyIds: string[]
  /** Incremented to signal PlanetCanvas to reinitialize the simulation. */
  resetSeq: number

  nextSunDefaults: NextBodyDefaults
  nextPlanetDefaults: NextBodyDefaults

  cameraFollowBodyId: string | null
  updateBody: (id: string, patch: Partial<PlanetBody>) => void
  addBody: (body: PlanetBody) => void
  removeBody: (id: string) => void
  clearBodies: () => void
  applyPreset: (bodies: PlanetBody[], simPatch?: Partial<PlanetSimParams>) => void
  updateSimParams: (patch: Partial<PlanetSimParams>) => void
  updateNextSunDefaults: (patch: Partial<NextBodyDefaults>) => void
  updateNextPlanetDefaults: (patch: Partial<NextBodyDefaults>) => void
  setSelectedBodyId: (id: string | null) => void
  setSelectedBodyIds: (ids: string[]) => void
  setCameraFollowBodyId: (id: string | null) => void
  /** Reset bodies + params to defaults, then reinitialize simulation. */
  resetToDefaults: () => void
  /** Reinitialize simulation from current bodies/params (without resetting to defaults). */
  restartSim: () => void
}

export const usePlanetStore = create<PlanetState>(set => ({
  bodies: DEFAULT_BODIES.map(b => ({ ...b })),
  simParams: { ...DEFAULT_SIM_PARAMS },
  selectedBodyId: null,
  selectedBodyIds: [],
  cameraFollowBodyId: null,
  resetSeq: 0,

  nextSunDefaults:   { ...DEFAULT_NEXT_SUN },
  nextPlanetDefaults: { ...DEFAULT_NEXT_PLANET },

  updateBody: (id, patch) =>
    set(state => ({ bodies: state.bodies.map(b => b.id === id ? { ...b, ...patch } : b) })),

  addBody: body => set(state => ({ bodies: [...state.bodies, body] })),

  removeBody: id => set(state => {
    const nextBodies = state.bodies.filter(b => b.id !== id)
    return {
      bodies: nextBodies,
      selectedBodyId: state.selectedBodyId === id ? null : state.selectedBodyId,
      selectedBodyIds: state.selectedBodyIds.filter(i => i !== id),
      simParams: state.simParams.standpointBodyId === id
        ? { ...state.simParams, standpointBodyId: nextBodies[0]?.id ?? null }
        : state.simParams,
    }
  }),

  clearBodies: () => set({ bodies: [], selectedBodyId: null, selectedBodyIds: [], cameraFollowBodyId: null }),

  applyPreset: (bodies, simPatch = {}) => set(state => ({
    bodies: bodies.map(b => ({ ...b })),
    simParams: { ...state.simParams, ...simPatch },
    selectedBodyId: null,
    selectedBodyIds: [],
    cameraFollowBodyId: null,
    resetSeq: state.resetSeq + 1,
  })),

  updateSimParams: patch =>
    set(state => ({ simParams: { ...state.simParams, ...patch } })),

  updateNextSunDefaults: patch =>
    set(state => ({ nextSunDefaults: { ...state.nextSunDefaults, ...patch } })),

  updateNextPlanetDefaults: patch =>
    set(state => ({ nextPlanetDefaults: { ...state.nextPlanetDefaults, ...patch } })),

  setSelectedBodyId: id => set({ selectedBodyId: id, selectedBodyIds: id ? [id] : [] }),

  setSelectedBodyIds: ids => set({ selectedBodyIds: ids, selectedBodyId: ids[0] ?? null }),

  setCameraFollowBodyId: id => set({ cameraFollowBodyId: id }),

  resetToDefaults: () => set(state => ({
    bodies: DEFAULT_BODIES.map(b => ({ ...b })),
    simParams: { ...DEFAULT_SIM_PARAMS },
    selectedBodyId: null,
    selectedBodyIds: [],
    resetSeq: state.resetSeq + 1,
  })),

  restartSim: () => set(state => ({ resetSeq: state.resetSeq + 1 })),
}))
