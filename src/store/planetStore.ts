import { create } from 'zustand'

// ── Domain types ──────────────────────────────────────────────────────────────

export type PlanetBodyType = 'sun' | 'planet'

export type EffectorType = 'none' | 'reverb' | 'delay' | 'distortion' | 'chorus' | 'phaser' | 'autofilter' | 'bitcrush' | 'freeze' | 'microphone'

export type DroneType = 'none' | 'pad'

export interface PlanetBody {
  id: string
  name: string
  type: PlanetBodyType
  mass: number
  x: number
  y: number
  vx: number
  vy: number
  fixed: boolean
  color: string
  sampleId: string | null  // assigned sample asset id
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
  paused: boolean
  simpleTheme: boolean       // light-background canvas look
  rendezvousDistance: number // world-units threshold that triggers body sounds
  orbitTriggerMode: 'none' | 'orbit-complete'  // retrigger sample each completed orbit
  orbitTriggerDivision: number   // orbit fraction per trigger: 2=every2orbits, 0.5=twice/orbit
  orbitTriggerType: 'periodic' | 'cumulative' | 'tperiod'  // periodic=every N orbits; cumulative=charge→fire; tperiod=T seconds after last trigger
  showOrbitTriggerMarkers: boolean  // show trigger position dots on canvas
  orbitStretchMode: boolean  // stretch sample playback rate to match orbital period
  probeMass: number          // mass of the mouse-probe cursor (0 = measurement only)
  rendezvousTriggerMode: 'oneshot' | 'toggle'  // oneshot = one-shot play; toggle = loop on/off
  triggerPlaybackMode: 'restart' | 'layer'     // restart = retrigger same voice; layer = overlap one-shots
  showPredictedOrbit: boolean                   // show trajectory preview during drag placement
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
  /** Display: scale body radius from mass (mass × 0.01 as extra multiplier) */
  bodyRadiusFromMass: boolean
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
  /** Sampler rack override: 'auto' = use body sampleId / folder hash, 'fixed' = always use samplerSampleId */
  samplerMode: 'auto' | 'fixed'
  /** Sampler rack override: sample id to use when samplerMode = 'fixed' */
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

  // ── Ambient Oscillator instrument ─────────────────────────────────────────
  ambientOscType:            'off' | 'ambient-osc'
  ambientOscWaveform:        OscillatorType   // 'sine' | 'triangle' | 'sawtooth' | 'square'
  ambientOscAttack:          number           // seconds (0.01–20)
  ambientOscRelease:         number           // seconds (0.01–30)
  ambientOscFilterCutoff:    number           // Hz (80–12000)
  ambientOscFilterResonance: number           // Q factor (0.01–20)
  ambientOscLevel:           number           // master level 0–1
  ambientOscNote:            number           // MIDI note 0–127

  // ── Osc Synth instrument (triggered, same engine as ambient-osc + LFO) ──
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

  // ── OSC Next Orbit instrument ─────────────────────────────────────────────
  /** Whether the osc-next-orbit instrument is active for this body */
  oscNextOrbitType: 'off' | 'osc-next-orbit'

  // ── Arpeggiator trigger ───────────────────────────────────────────────────
  arpMode:   boolean   // true = this trigger cycles through arp notes
  arpLength: number    // active step count 1–4
  arpNote0:  number    // step 0 (default 48 = C3)
  arpNote1:  number    // step 1 (default 52 = E3)
  arpNote2:  number    // step 2 (default 55 = G3)
  arpNote3:  number    // step 3 (default 59 = B3)
}

// ── Next-body placement defaults ──────────────────────────────────────────────

export interface NextBodyDefaults {
  mass: number
  color: string
  fixed: boolean
  randomColor: boolean   // true = generate a fresh hue on each placement
  randomSample: boolean  // true = pick a random loaded sample on placement
}

export const DEFAULT_NEXT_SUN: NextBodyDefaults = {
  mass: 500, color: '#f59e0b', fixed: true, randomColor: true, randomSample: true,
}
export const DEFAULT_NEXT_PLANET: NextBodyDefaults = {
  mass: 1, color: '#60a5fa', fixed: false, randomColor: true, randomSample: true,
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export type DroneMode = 'manual' | 'orbit'

/** Which orbit metric drives an OscSynth param when not 'manual'. */
export type OscOrbitSource = 'manual' | 'period' | 'eccentricity' | 'distance' | 'velocity' | 'bound'

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
  volume: 1,
}

export const DEFAULT_BODIES: PlanetBody[] = [
  {
    id: 'sun', name: 'Sun', type: 'sun',
    mass: 1000, x: 0, y: 0, vx: 0, vy: 0,
    fixed: true, color: '#f59e0b', sampleId: null,
    orbitLoopNumer: 1, orbitLoopDenom: 1,
    ...BODY_EFFECTOR_DEFAULTS,
    ...BODY_DRONE_DEFAULTS,
    ...BODY_MIDI_DEFAULTS,
  },
  {
    id: 'planet', name: 'Planet', type: 'planet',
    mass: 1, x: 280, y: 0, vx: 0, vy: 1.89,
    fixed: false, color: '#60a5fa', sampleId: null,
    orbitLoopNumer: 1, orbitLoopDenom: 1,
    ...BODY_EFFECTOR_DEFAULTS,
    ...BODY_DRONE_DEFAULTS,
    ...BODY_MIDI_DEFAULTS, midiNote: 62,
  },
  {
    id: 'perturber', name: 'Perturber', type: 'planet',
    mass: 80, x: -600, y: 180, vx: 1.2, vy: 0,
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
  paused: false,
  simpleTheme: false,
  // ── Trigger defaults: OFF ─────────────────────────────────────────────────
  // The rack system's trigger CS drives triggers; simParams are the fallback.
  // Keeping these OFF ensures "empty trigger slot = no trigger".
  rendezvousDistance: 0,
  orbitTriggerMode: 'none',
  orbitTriggerDivision: 1,
  orbitTriggerType: 'cumulative',
  showOrbitTriggerMarkers: false,
  orbitStretchMode: false,
  probeMass: 50,
  rendezvousTriggerMode: 'oneshot',
  triggerPlaybackMode: 'restart',
  showPredictedOrbit: true,
  standpointMode: true,
  standpointBodyId: 'sun',
  standpointMaxDist: 1000,
  standpointMinVol: 0,
  showStandpointVisual: false,
  standpointDirectional: false,
  standpointFacing: 'velocity',
  standpointFacingAngle: 0,
  standpointConeWidth: 270,
  standpointOuterVol: 0.25,
  standpointStereo: false,
  standpointFrontBack: false,
  standpointRearVol: 0.45,
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
  bodyRadiusFromMass: false,
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

  ambientOscType:            'off',
  ambientOscWaveform:        'sine',
  ambientOscAttack:          1.5,
  ambientOscRelease:         3.0,
  ambientOscFilterCutoff:    1200,
  ambientOscFilterResonance: 0.3,
  ambientOscLevel:           0.5,
  ambientOscNote:            60,

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

  oscNextOrbitType: 'off',

  arpMode:   false,
  arpLength: 4,
  arpNote0:  48,  // C3
  arpNote1:  52,  // E3
  arpNote2:  55,  // G3
  arpNote3:  59,  // B3
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
  randomAssignSamplesToPlanets: (sampleIds: string[]) => void
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

  removeBody: id => set(state => ({
    bodies: state.bodies.filter(b => b.id !== id),
    selectedBodyId: state.selectedBodyId === id ? null : state.selectedBodyId,
    selectedBodyIds: state.selectedBodyIds.filter(i => i !== id),
    simParams: state.simParams.standpointBodyId === id
      ? { ...state.simParams, standpointBodyId: null }
      : state.simParams,
  })),

  clearBodies: () => set({ bodies: [], selectedBodyId: null, selectedBodyIds: [], cameraFollowBodyId: null }),

  applyPreset: (bodies, simPatch = {}) => set(state => ({
    bodies: bodies.map(b => ({ ...b })),
    simParams: { ...state.simParams, ...simPatch },
    selectedBodyId: null,
    selectedBodyIds: [],
    cameraFollowBodyId: null,
    resetSeq: state.resetSeq + 1,
  })),

  randomAssignSamplesToPlanets: sampleIds => {
    if (sampleIds.length === 0) return
    set(state => ({
      bodies: state.bodies.map(b => {
        if (b.type !== 'planet') return b
        const sampleId = sampleIds[Math.floor(Math.random() * sampleIds.length)]
        return { ...b, sampleId }
      }),
    }))
  },

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
