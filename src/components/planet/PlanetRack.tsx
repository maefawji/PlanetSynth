import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePlanetStore } from '../../store/planetStore'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import type { PlanetBody, PlanetSimParams } from '../../store/planetStore'
import { useProjectStore } from '../../store/projectStore'
import {
  useControlSetStore,
  MAX_EFFECTS,
  MAX_TRIGGERS,
  type ControlSet,
  type ControlSetCategory,
} from '../../store/controlSetStore'
import { computeOrbitDroneParams, computeOrbitStats } from './DroneLayer'
import { getPlanetLiveBodySnapshot, planetBodyStatsCache, getBodyTrailPoints, type PlanetBodyStats, type PlanetTool } from './PlanetCanvas'
import { getBodyWaveLabEngine, subscribeWaveLabWaveformRefresh } from './WaveLabInstrumentLayer'
import { PlanetBodyInspector } from '../layout/RightInspector'
import { draggingControlSetId, setDraggingControlSetId } from '../../lib/dragControlSet'
import { computeBodyRackOutputSpatial } from '../../audio/bodyRackOutput'
import { getBodyTriggerAge, markBodyTriggered } from '../../audio/intersectionSynth'
import { sendMidiNote, getMidiSendAge, getMidiReceiveAge, getLastMidiSendInfo, getLastMidiReceiveInfo, isMidiReady } from '../../audio/midiManager'
import { getBodyOneShotEngine } from '../../audio/OneShotSamplerEngine'
import type { OneShotState } from '../../audio/OneShotSamplerEngine'
import { getBodyStretchSamplerEngine } from '../../audio/StretchSamplerEngine'
import { getBodyLongSamplerEngine } from '../../audio/LongSamplerEngine'
import { fireBodyInstrumentTrigger } from '../../audio/instrumentTrigger'
import { getBodyOutputLevel } from '../../audio/bodyOutputMeter'
import { getBodyOscSynthEngine } from './OscSynthLayer'
import { getBusOscilloscopeData } from '../../audio/rackBusMixer'
import { useArpProgressionStore } from '../../store/arpProgressionStore'
import { CONDUCTOR_NOTE_NAMES, useUniversalConductorStore } from '../../store/universalConductorStore'
import { ORBIT_T_DEFINITION, resolveOrbitDurationSource } from '../../lib/orbitDurationSource'
import { generateFromGrammar, randomGrammar } from '../../sigil/sigilGenerator'
import type { SigilGrammar } from '../../sigil/sigilGenerator'

// ── Param editor config ───────────────────────────────────────────────────────

type ParamCfgNum    = { type: 'number';  label: string; min?: number; max?: number; step: number }
type ParamCfgBool   = { type: 'boolean'; label: string }
type ParamCfgSel    = { type: 'select';  label: string; options: string[]; optionLabels?: string[]; numeric?: boolean }
type ParamCfgSample = { type: 'sample';  label: string }
type ParamCfg = ParamCfgNum | ParamCfgBool | ParamCfgSel | ParamCfgSample

const PARAM_CFG: Record<string, ParamCfg> = {
  // Trigger params
  rendezvousDistance:    { type: 'number',  label: 'dist',      step: 10,   min: 0 },
  rendezvousTriggerMode: { type: 'select',  label: 'rdv',       options: ['none', 'oneshot', 'toggle'] },
  orbitTriggerType:         { type: 'select',  label: 'type',    options: ['periodic', 'cumulative', 'tperiod'],  optionLabels: ['Periodic', 'Cumulative', 'T-period'] },
  orbitTriggerMode:         { type: 'select',  label: 'orbit',   options: ['none', 'orbit-complete'] },
  orbitTriggerDivision:     { type: 'select',  label: 'div', numeric: true,
    options:      ['2', '1', '0.5', '0.25', '0.125', '0.0625'],
    optionLabels: ['2', '1', '½', '¼', '⅛', '¹⁄₁₆'],
  },
  showOrbitTriggerMarkers:  { type: 'boolean', label: 'markers' },
  orbitStretchMode:         { type: 'boolean', label: 'stretch' },
  // Effect params
  standpointMode:        { type: 'boolean', label: 'sp mode' },
  standpointMaxDist:     { type: 'number',  label: 'sp dist',   step: 50,   min: 10 },
  standpointMinVol:      { type: 'number',  label: 'sp vol',    step: 0.05, min: 0,   max: 1 },
  effectorType:          { type: 'select',  label: 'fx type',   options: ['none', 'reverb', 'delay', 'distortion', 'chorus'] },
  reverbMode:            { type: 'select',  label: 'rvb mode',  options: ['convolution', 'freeverb'], optionLabels: ['Conv (HQ)', 'Freeverb (lite)'] },
  effectorDistance:      { type: 'number',  label: 'fx dist',   step: 20,   min: 10 },
  effectorMaxWet:        { type: 'number',  label: 'fx wet',    step: 0.05, min: 0,   max: 1 },
  effectorDecay:         { type: 'number',  label: 'decay',     step: 0.5,  min: 0.1, max: 15 },
  effectorDelayDivision: { type: 'select',  label: 'delay', numeric: true,
    options:      ['2', '1', '0.5', '0.25', '0.125', '0.0625'],
    optionLabels: ['2×', '1×', '1/2', '1/4', '1/8', '1/16'],
  },
  effectorFeedback:      { type: 'number',  label: 'feedback',  step: 0.05, min: 0,   max: 0.9 },
  effectorDistortion:    { type: 'number',  label: 'distort',   step: 0.05, min: 0,   max: 1 },
  effectorChorusFreq:    { type: 'number',  label: 'rate Hz',   step: 0.1,  min: 0.1, max: 20 },
  effectorChorusDepth:   { type: 'number',  label: 'depth',     step: 0.05, min: 0,   max: 1 },
  // Microphone effector params
  micSelfGain:           { type: 'number',  label: 'self gain', step: 0.05, min: 0,   max: 2 },
  micPickupGain:         { type: 'number',  label: 'pickup',    step: 0.05, min: 0,   max: 2 },
  // Sampler params
  samplerType:        { type: 'select', label: 'type',     options: ['off', 'sampler'], optionLabels: ['— off', 'Sampler'] },
  samplerMode:        { type: 'select', label: 'sample',   options: ['auto', 'fixed'],  optionLabels: ['Auto', 'Fixed'] },
  samplerSampleId:    { type: 'sample', label: 'file' },
  samplerVolume:      { type: 'number', label: 'vol',      step: 0.05, min: 0,    max: 1 },
  samplerPlayMode:    { type: 'select', label: 'mode',     options: ['oneshot', 'loop', 'pingpong'], optionLabels: ['Oneshot', 'Loop', 'Pingpong'] },
  samplerSampleStart: { type: 'number', label: 'start',    step: 0.01, min: 0,    max: 0.99 },
  samplerSampleEnd:   { type: 'number', label: 'end',      step: 0.01, min: 0.01, max: 1 },
  samplerLoopStart:   { type: 'number', label: 'lp start', step: 0.01, min: 0,    max: 0.99 },
  samplerLoopEnd:     { type: 'number', label: 'lp end',   step: 0.01, min: 0.01, max: 1 },
  samplerReverse:     { type: 'boolean', label: 'reverse' },
  samplerDetune:      { type: 'number', label: 'detune',   step: 1,    min: -24,  max: 24 },
  samplerAttack:      { type: 'number', label: 'attack',   step: 0.01, min: 0.001, max: 10 },
  samplerRelease:     { type: 'number', label: 'release',  step: 0.1,  min: 0.01, max: 20 },
  samplerReverbMix:   { type: 'number', label: 'reverb',   step: 0.05, min: 0,    max: 1 },
  // Granular params
  granularType:      { type: 'select', label: 'type',    options: ['off', 'grain'], optionLabels: ['— off', 'Grain'] },
  granularVolume:    { type: 'number', label: 'vol',     step: 0.05, min: 0,   max: 1 },
  granularGrainSize: { type: 'number', label: 'grain s', step: 0.01, min: 0.01, max: 0.5 },
  granularOverlap:   { type: 'number', label: 'overlap', step: 0.005, min: 0.001, max: 0.15 },
  granularDetune:    { type: 'number', label: 'detune',  step: 1,    min: -24, max: 24 },
  granularReverbMix: { type: 'number', label: 'reverb',  step: 0.05, min: 0,   max: 1 },
  // FM Drone params
  fmDroneType:      { type: 'select', label: 'type',    options: ['off', 'fm'], optionLabels: ['— off', 'FM'] },
  fmDroneRootNote:  { type: 'select', label: 'note',
    options: ['C2','D2','Eb2','F2','G2','Ab2','Bb2','C3','D3','Eb3','F3','G3','Ab3','Bb3','A2','A3'],
    optionLabels: ['C2','D2','Eb2','F2','G2','Ab2','Bb2','C3','D3','Eb3','F3','G3','Ab3','Bb3','A2','A3'] },
  fmDroneRatio:     { type: 'select', label: 'ratio',   options: ['0.5','1','1.5','2','3','5','7'], optionLabels: ['½','1','1½','2','3','5','7'], numeric: true },
  fmDroneIndex:     { type: 'number', label: 'index',   step: 0.5,  min: 0,   max: 8 },
  fmDroneVolume:    { type: 'number', label: 'vol',     step: 0.05, min: 0,   max: 1 },
  fmDroneAttack:    { type: 'number', label: 'attack',  step: 0.5,  min: 0.1, max: 20 },
  fmDroneRelease:   { type: 'number', label: 'release', step: 0.5,  min: 0.1, max: 25 },
  fmDroneReverbMix: { type: 'number', label: 'reverb',  step: 0.05, min: 0,   max: 1 },
  // Noise Pad params
  noisePadType:      { type: 'select', label: 'type',   options: ['off', 'noise'], optionLabels: ['— off', 'Noise'] },
  noisePadVolume:    { type: 'number', label: 'vol',    step: 0.05, min: 0,   max: 1 },
  noisePadFreq:      { type: 'number', label: 'freq Hz', step: 50,  min: 80,  max: 4000 },
  noisePadQ:         { type: 'number', label: 'Q',      step: 0.5,  min: 0.5, max: 20 },
  noisePadAttack:    { type: 'number', label: 'attack',  step: 0.5, min: 0.1, max: 20 },
  noisePadRelease:   { type: 'number', label: 'release', step: 0.5, min: 0.1, max: 25 },
  noisePadReverbMix: { type: 'number', label: 'reverb',  step: 0.05, min: 0,  max: 1 },
  // One-shot sampler params
  oneShotType:       { type: 'select', label: 'type',   options: ['off', 'oneshot'], optionLabels: ['— off', 'One-Shot'] },
  // Osc Synth params
  oscSynthType:            { type: 'select', label: 'type',    options: ['off', 'osc-synth'], optionLabels: ['— off', 'Osc Synth'] },
  oscSynthWaveform:        { type: 'select', label: 'wave',    options: ['sine', 'triangle', 'sawtooth', 'square'], optionLabels: ['Sine', 'Triangle', 'Saw', 'Square'] },
  oscSynthAttack:          { type: 'number', label: 'attack',  step: 0.01,  min: 0.001, max: 20 },
  oscSynthDecay:           { type: 'number', label: 'decay',   step: 0.01,  min: 0.01,  max: 20 },
  oscSynthSustain:         { type: 'number', label: 'sustain', step: 0.01,  min: 0,     max: 1 },
  oscSynthRelease:         { type: 'number', label: 'release', step: 0.1,   min: 0.01,  max: 30 },
  oscSynthFilterCutoff:    { type: 'number', label: 'cutoff',  step: 50,    min: 80,    max: 12000 },
  oscSynthFilterResonance: { type: 'number', label: 'Q',       step: 0.05,  min: 0.01,  max: 15 },
  oscSynthLevel:           { type: 'number', label: 'level',   step: 0.05,  min: 0,     max: 1 },
  oscSynthLfoTarget:       { type: 'select', label: 'lfo →',   options: ['off', 'pitch', 'filter', 'amplitude'], optionLabels: ['Off', 'Pitch', 'Filter', 'Amp'] },
  oscSynthLfoRate:         { type: 'number', label: 'lfo rate',  step: 0.01, min: 0.01, max: 20 },
  oscSynthLfoDepth:        { type: 'number', label: 'lfo depth', step: 0.01, min: 0,    max: 1 },
  oscSynthLfoWaveform:     { type: 'select', label: 'lfo wave',  options: ['sine', 'triangle', 'sawtooth', 'square'], optionLabels: ['Sine', 'Triangle', 'Saw', 'Square'] },
  // Oneshot-stretch params
  sampleStretchMode:    { type: 'select',  label: 'stretch', options: ['off', 'rate', 'time'], optionLabels: ['Off', 'Rate', 'Time'] },
  sampleOrbitSource:    { type: 'select',  label: 'orbit src', options: ['current', 'predicted'], optionLabels: ['Current ω', 'Predicted'] },
  orbitLoopNumer:       { type: 'number',  label: 'numer',   step: 1, min: 1 },
  orbitLoopDenom:       { type: 'number',  label: 'denom',   step: 1, min: 1 },
  samplePitchCorrection: { type: 'boolean', label: 'pitch fix' },
  // New effect params
  effectorPhaserRate:          { type: 'number', label: 'rate Hz',  step: 0.1,  min: 0.05, max: 5 },
  effectorPhaserOctaves:       { type: 'number', label: 'octaves',  step: 1,    min: 1,    max: 6 },
  effectorAutoFilterFreq:      { type: 'number', label: 'rate Hz',  step: 0.1,  min: 0.05, max: 8 },
  effectorAutoFilterDepth:     { type: 'number', label: 'depth',    step: 0.05, min: 0,    max: 1 },
  effectorAutoFilterBaseFreq:  { type: 'number', label: 'base Hz',  step: 20,   min: 80,   max: 2000 },
  effectorBitDepth:             { type: 'number', label: 'bits',    step: 1,    min: 2,    max: 16 },
  effectorFreezeDecay:          { type: 'number', label: 'decay s', step: 5,    min: 10,   max: 60 },
  // Instrument (Drone) params
  droneType:     { type: 'select', label: 'drone',
    options: ['none', 'pad'], optionLabels: ['— off', 'Pad'] },
  droneMode:     { type: 'select', label: 'mode',
    options: ['manual', 'orbit'], optionLabels: ['Manual', 'Orbit'] },
  droneRootNote: { type: 'select', label: 'note',
    options: ['C2','D2','Eb2','F2','G2','Ab2','Bb2','C3','D3','Eb3','F3','G3','Ab3','Bb3','C4'],
    optionLabels: ['C2','D2','Eb2','F2','G2','Ab2','Bb2','C3','D3','Eb3','F3','G3','Ab3','Bb3','C4'] },
  droneVolume:    { type: 'number', label: 'vol',     step: 0.05, min: 0,   max: 1 },
  droneBrightness:{ type: 'number', label: 'bright',  step: 100,  min: 200, max: 8000 },
  droneMelt:      { type: 'number', label: 'melt',    step: 0.05, min: 0,   max: 1 },
  droneDetune:    { type: 'number', label: 'detune',  step: 1,    min: 0,   max: 50 },
  droneMotion:    { type: 'number', label: 'motion',  step: 0.05, min: 0,   max: 1 },
  droneAttack:    { type: 'number', label: 'attack',  step: 0.5,  min: 0.1, max: 30 },
  droneRelease:   { type: 'number', label: 'release', step: 0.5,  min: 0.1, max: 30 },
  droneReverbMix: { type: 'number', label: 'reverb',  step: 0.05, min: 0,   max: 1 },
}

// ── Sampler 2-column layout ───────────────────────────────────────────────────

/** Sub-params rendered in a 2-col grid when sampler is on (skipped from the generic loop). */
const SAMPLER_2COL_KEYS = new Set([
  'samplerVolume', 'samplerPlayMode',
  'samplerSampleStart', 'samplerSampleEnd',
  'samplerLoopStart', 'samplerLoopEnd',
  'samplerReverse', 'samplerDetune',
  'samplerAttack', 'samplerRelease',
  'samplerReverbMix',
])
/** Shorter labels for the compact 2-col cells. */
const SAMPLER_2COL_LABELS: Record<string, string> = {
  samplerLoopStart: 'lp.s',
  samplerLoopEnd:   'lp.e',
  samplerReverse:   'rev',
  samplerRelease:   'rel',
  samplerReverbMix: 'rvb',
}

function stableSigilSeed(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function bodySigilGrammar(body: PlanetBody): SigilGrammar {
  return body.sigilGrammar ?? randomGrammar(stableSigilSeed(`${body.id}:${body.name}`), {})
}

function RackBodySigil({
  body,
  size = 38,
  color = '#fff',
  opacity = 1,
  strokeWidth = 2.15,
  style,
}: {
  body: PlanetBody
  size?: number
  color?: string
  opacity?: number
  strokeWidth?: number
  style?: CSSProperties
}) {
  const sigil = useMemo(
    () => generateFromGrammar(bodySigilGrammar(body)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [body.id, body.name, body.sigilGrammar],
  )
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        display: 'block',
        pointerEvents: 'none',
        overflow: 'visible',
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.38))',
        opacity,
        ...style,
      }}
    >
      {sigil.shapes.map((shape, index) => {
        const common = {
          opacity: 1,
        }
        const stroke = shape.renderMode === 'fill' ? 'none' : color
        const fill = shape.renderMode === 'stroke' ? 'none' : color
        if (shape.kind === 'circle') {
          return (
            <circle
              key={index}
              {...common}
              cx={shape.cx}
              cy={shape.cy}
              r={shape.r}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          )
        }
        if (shape.kind === 'polygon') {
          return (
            <polygon
              key={index}
              {...common}
              points={shape.points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeLinejoin="round"
            />
          )
        }
        return (
          <path
            key={index}
            {...common}
            d={shape.d}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}
    </svg>
  )
}
/** Ordered flat list for the grid (left→right, top→bottom). Empty string = empty cell. */
const SAMPLER_2COL_ORDER = [
  'samplerVolume',      'samplerPlayMode',
  'samplerSampleStart', 'samplerSampleEnd',
  'samplerLoopStart',   'samplerLoopEnd',
  'samplerReverse',     'samplerDetune',
  'samplerAttack',      'samplerRelease',
  'samplerReverbMix',   '',
]

// ── OscSynth 2-column layout ──────────────────────────────────────────────────

const OSC_SYNTH_2COL_KEYS = new Set([
  'oscSynthWaveform', 'oscSynthLevel',
  'oscSynthAttack',   'oscSynthDecay',
  'oscSynthSustain',  'oscSynthRelease',
  'oscSynthFilterCutoff', 'oscSynthFilterResonance',
  'oscSynthLfoTarget', 'oscSynthLfoWaveform',
  'oscSynthLfoRate', 'oscSynthLfoDepth',
])
const OSC_SYNTH_2COL_LABELS: Record<string, string> = {
  oscSynthWaveform:        'wave',
  oscSynthLevel:           'level',
  oscSynthAttack:          'A',
  oscSynthDecay:           'D',
  oscSynthSustain:         'S',
  oscSynthRelease:         'R',
  oscSynthFilterCutoff:    'cutoff',
  oscSynthFilterResonance: 'Q',
  oscSynthLfoTarget:       'lfo→',
  oscSynthLfoWaveform:     'lfoW',
  oscSynthLfoRate:         'rate',
  oscSynthLfoDepth:        'depth',
}
const _OSC_SYNTH_2COL_ORDER = [
  'oscSynthWaveform',        'oscSynthLevel',
  'oscSynthAttack',          'oscSynthDecay',
  'oscSynthSustain',         'oscSynthRelease',
  'oscSynthFilterCutoff',    'oscSynthFilterResonance',
  'oscSynthLfoTarget',       'oscSynthLfoWaveform',
  'oscSynthLfoRate',         'oscSynthLfoDepth',
]

// ── OscSynth Orbit: 2-col grid (includes type selector — no single-col rows) ──

const OSC_SYNTH_ORBIT_2COL_KEYS = new Set([
  ...OSC_SYNTH_2COL_KEYS,
  'oscSynthType',   // moved from generic loop into 2-col grid
])

const OSC_SYNTH_ORBIT_2COL_ORDER = [
  'oscSynthType',            'oscSynthLevel',
  'oscSynthWaveform',        'oscSynthLfoTarget',
  'oscSynthLfoWaveform',     'oscSynthFilterResonance',
]

// ── OscSynth orbit-map entries ────────────────────────────────────────────────

type OscOrbitEntry = {
  key: string; label: string
  srcKey: string; rateKey: string
  dfltSrc: string; dfltRate: number
  min: number; max: number
  unit: string; precision: number
}

const OSC_ORBIT_MAP_ENTRIES: OscOrbitEntry[] = [
  { key: 'oscSynthAttack',       label: 'A',   srcKey: 'oscSynthAttackSource',   rateKey: 'oscSynthAttackRate',   dfltSrc: 'period',       dfltRate: 0.06,  min: 0.001, max: 20,    unit: 's',  precision: 3 },
  { key: 'oscSynthDecay',        label: 'D',   srcKey: 'oscSynthDecaySource',    rateKey: 'oscSynthDecayRate',    dfltSrc: 'eccentricity', dfltRate: 8.0,   min: 0.01,  max: 20,    unit: 's',  precision: 3 },
  { key: 'oscSynthSustain',      label: 'S',   srcKey: 'oscSynthSustainSource',  rateKey: 'oscSynthSustainRate',  dfltSrc: 'distance',     dfltRate: 0.003, min: 0,     max: 1,     unit: '',   precision: 2 },
  { key: 'oscSynthRelease',      label: 'R',   srcKey: 'oscSynthReleaseSource',  rateKey: 'oscSynthReleaseRate',  dfltSrc: 'period',       dfltRate: 0.2,   min: 0.01,  max: 30,    unit: 's',  precision: 3 },
  { key: 'oscSynthFilterCutoff', label: 'cut', srcKey: 'oscSynthCutoffSource',   rateKey: 'oscSynthCutoffRate',   dfltSrc: 'velocity',     dfltRate: 600,   min: 80,    max: 12000, unit: 'Hz', precision: 0 },
  { key: 'oscSynthLfoRate',      label: 'lfR', srcKey: 'oscSynthLfoRateSource',  rateKey: 'oscSynthLfoRateRate',  dfltSrc: 'period',       dfltRate: 0.12,  min: 0.01,  max: 20,    unit: 'Hz', precision: 2 },
  { key: 'oscSynthLfoDepth',     label: 'lfD', srcKey: 'oscSynthLfoDepthSource', rateKey: 'oscSynthLfoDepthRate', dfltSrc: 'velocity',     dfltRate: 0.18,  min: 0,     max: 1,     unit: '',   precision: 2 },
]

const OSC_SRC_ABBREV: Record<string, string> = {
  manual: '—', period: 'T', eccentricity: 'ε', distance: 'r', velocity: 'v', bound: 'B',
}

// ── OscScope: mini oscilloscope for Osc Synth Orbit ──────────────────────────

function OscScope({ bodyId, accent }: { bodyId: string | null; accent: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    const buf = new Uint8Array(256)
    let raf: number

    const draw = () => {
      const engine   = bodyId ? getBodyOscSynthEngine(bodyId) : null
      const analyser = engine?.analyserNode ?? null
      const w = canvas.width
      const h = canvas.height

      ctx2d.clearRect(0, 0, w, h)

      if (analyser && engine?.isActive) {
        analyser.getByteTimeDomainData(buf)
        const len = buf.length
        ctx2d.beginPath()
        ctx2d.strokeStyle = accent
        ctx2d.lineWidth   = 1.2
        ctx2d.globalAlpha = 0.9
        for (let i = 0; i < len; i++) {
          const x = (i / (len - 1)) * w
          const y = ((buf[i] - 128) / 128) * (h * 0.42) + h / 2
          if (i === 0) ctx2d.moveTo(x, y)
          else         ctx2d.lineTo(x, y)
        }
        ctx2d.stroke()
      } else {
        // Idle: flat center line
        ctx2d.beginPath()
        ctx2d.strokeStyle = accent
        ctx2d.lineWidth   = 0.8
        ctx2d.globalAlpha = 0.2
        ctx2d.moveTo(0, h / 2)
        ctx2d.lineTo(w, h / 2)
        ctx2d.stroke()
      }
      ctx2d.globalAlpha = 1

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [bodyId, accent])

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={38}
      style={{
        width: '100%',
        height: 38,
        display: 'block',
        borderRadius: 4,
        background: `${accent}0a`,
        border: `0.5px solid ${accent}30`,
        marginTop: 2,
        boxSizing: 'border-box',
      }}
    />
  )
}

// ── Rack orbit input column helpers ──────────────────────────────────────────

/** One labelled stat row used inside the orbit column's Live Data section. */
function RackStatRow({ label, val, hint, dimText }: {
  label: string; val: string; hint: string; dimText: string
}) {
  return (
    <div title={hint} style={{ display: 'flex', gap: 3, alignItems: 'baseline', minHeight: 11 }}>
      <span style={{ fontSize: 6.5, color: dimText, width: 34, flexShrink: 0, textAlign: 'right', lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 8, color: dimText, fontFamily: 'monospace', lineHeight: 1, opacity: 0.85 }}>{val}</span>
    </div>
  )
}

// ── Slot-level audio meter strip ─────────────────────────────────────────────

/** Thin vertical VU bar, absolute-positioned on the right inner edge of a SlotCard. */
function SlotMeterStrip({ bodyId, accent, simple }: { bodyId: string; accent: string; simple: boolean }) {
  const fillRef = useRef<HTMLDivElement>(null)
  const trackBg = simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)'
  useEffect(() => {
    const el = fillRef.current
    if (!el) return
    let prevLevel = -1
    const id = window.setInterval(() => {
      const level = getBodyOutputLevel(bodyId)
      if (Math.abs(level - prevLevel) < 0.005) return   // skip if unchanged
      prevLevel = level
      const color = level > 0.85 ? '#f87171' : level > 0.55 ? '#fbbf24' : accent
      el.style.height  = `${level * 100}%`
      el.style.background = color
    }, 50)
    return () => window.clearInterval(id)
  }, [bodyId, accent])
  return (
    <div style={{ position: 'absolute', right: 3, top: 5, bottom: 5, width: 3, borderRadius: 2, overflow: 'hidden', background: trackBg }}>
      <div ref={fillRef} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '0%', background: accent, borderRadius: 2, transition: 'height 0.05s linear' }} />
    </div>
  )
}

// ── Trigger flash dot ─────────────────────────────────────────────────────────

const FLASH_FADE_MS = 350

/** Pulsing dot that flashes when the body is triggered. */
function TriggerFlashDot({ bodyId, accent }: { bodyId: string; accent: string }) {
  const dotRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = dotRef.current
    if (!el) return
    const id = window.setInterval(() => {
      const age     = getBodyTriggerAge(bodyId)
      const opacity = isFinite(age) ? Math.max(0, 1 - age / FLASH_FADE_MS) : 0
      el.style.opacity    = String(0.25 + opacity * 0.75)
      el.style.background = opacity > 0.05 ? accent : 'transparent'
      el.style.boxShadow  = opacity > 0.05 ? `0 0 ${(opacity * 7).toFixed(1)}px ${accent}` : 'none'
    }, 16)
    return () => window.clearInterval(id)
  }, [bodyId, accent])
  return (
    <div ref={dotRef} style={{
      position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)',
      width: 7, height: 7, borderRadius: '50%',
      background: 'transparent',
      border: `0.5px solid ${accent}66`,
      opacity: 0.25,
      pointerEvents: 'none',
    }} />
  )
}

// ── Mixer output column (right edge) ─────────────────────────────────────────

/**
 * Far-right rack column.
 * Left bar  = VU (actual signal from instruments — nonzero only while playing).
 * Right bar = Fader gain (body.volume × standpoint) — always visible, shows mixer send ceiling.
 * Numeric   = fader gain % normally; actual signal % while something plays.
 * Pan dot   = standpoint stereo position.
 */
function RackMixerColumn({ bodyId, simple }: { bodyId: string | null; simple: boolean }) {
  const [vuLevel,  setVuLevel]  = useState(0)
  const [fader,    setFader]    = useState(1)
  const [spPan,    setSpPan]    = useState(0)
  const [spActive, setSpActive] = useState(false)

  // Live body state for M/S/fader controls
  const body        = usePlanetStore(s => bodyId ? s.bodies.find(b => b.id === bodyId) ?? null : null)
  const updateBody  = usePlanetStore(s => s.updateBody)
  const allBodies   = usePlanetStore(s => s.bodies)
  const vol         = body?.volume ?? 1
  const muted       = body?.muted ?? false
  const unmutedIds  = allBodies.filter(b => !(b.muted ?? false)).map(b => b.id)
  const soloed      = unmutedIds.length === 1 && !!bodyId && unmutedIds[0] === bodyId

  function toggleMute() {
    if (!bodyId) return
    updateBody(bodyId, { muted: !muted })
  }
  function toggleSolo() {
    if (!bodyId) return
    const isCurrentlySoloed = unmutedIds.length === 1 && unmutedIds[0] === bodyId
    allBodies.forEach(b => updateBody(b.id, { muted: isCurrentlySoloed ? false : b.id !== bodyId }))
  }
  function setVolume(v: number) {
    if (!bodyId) return
    updateBody(bodyId, { volume: v })
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!bodyId) { setVuLevel(0); setFader(1); setSpPan(0); setSpActive(false); return }
    const id = window.setInterval(() => {
      setVuLevel(getBodyOutputLevel(bodyId))
      const { simParams, bodies } = usePlanetStore.getState()
      const b = bodies.find(b => b.id === bodyId)
      const bodyVol = b?.muted ? 0 : (b?.volume ?? 1)
      const active  = Boolean(simParams.standpointMode && simParams.standpointBodyId)
      setSpActive(active)
      if (active) {
        const liveBodies      = getPlanetLiveBodySnapshot()
        const liveById        = new Map(liveBodies.map(b => [b.id, b]))
        const effectiveBodies = bodies.map(b => {
          const live = liveById.get(b.id)
          return live ? { ...b, x: live.x, y: live.y, vx: live.vx, vy: live.vy } : b
        })
        const sp = computeBodyRackOutputSpatial(bodyId, effectiveBodies, simParams, {})
        setFader(bodyVol * sp.volume)
        setSpPan(sp.pan)
      } else {
        setFader(bodyVol)
        setSpPan(0)
      }
    }, 50)
    return () => window.clearInterval(id)
  }, [bodyId])

  const dimText   = simple ? 'rgba(0,0,0,0.32)'  : 'rgba(255,255,255,0.28)'
  const accentCol = simple ? '#16a34a'             : '#34d399'
  const trackBg   = simple ? 'rgba(0,0,0,0.07)'   : 'rgba(255,255,255,0.07)'

  const vuColor    = vuLevel > 0.85 ? '#f87171' : vuLevel > 0.60 ? '#fbbf24' : accentCol
  const faderColor = fader  > 0.7   ? accentCol : fader   > 0.35  ? '#fbbf24' : '#f87171'

  // The "display" number: actual signal while playing, fader gain when idle
  const _displayNum = vuLevel > 0.01 ? vuLevel : fader
  const displayCol = vuLevel > 0.01 ? vuColor : faderColor

  const dB = vuLevel > 0.0001 ? 20 * Math.log10(vuLevel) : -100
  const dBLabel = vuLevel > 0.001 ? `${Math.round(dB)}` : '—'

  return (
    <div style={{
      width: 70, flexShrink: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '5px 5px 6px',
      gap: 3,
      borderLeft: `0.5px solid ${simple ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)'}`,
    }}>
      {/* Signal-flow arrow */}
      <div style={{ fontSize: 8, color: accentCol, opacity: 0.75, lineHeight: 1 }}>→</div>

      {/* M / S buttons */}
      {bodyId && (
        <div style={{ display: 'flex', gap: 3 }}>
          <button onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}
            style={{ fontSize: 7, fontWeight: 800, padding: '2px 5px', borderRadius: 3, border: 'none', cursor: 'pointer', lineHeight: 1,
              background: muted ? 'rgba(239,68,68,0.18)' : (simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)'),
              color: muted ? '#ef4444' : dimText }}>M</button>
          <button onClick={toggleSolo} title={soloed ? 'Unsolo' : 'Solo'}
            style={{ fontSize: 7, fontWeight: 800, padding: '2px 5px', borderRadius: 3, border: 'none', cursor: 'pointer', lineHeight: 1,
              background: soloed ? 'rgba(245,158,11,0.18)' : (simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)'),
              color: soloed ? '#f59e0b' : dimText }}>S</button>
        </div>
      )}

      {/* VU meter + vertical fader side by side */}
      <div style={{ flex: 1, display: 'flex', gap: 4, alignItems: 'stretch', minHeight: 50, width: '100%', padding: '0 4px' }}>
        {/* VU bar — signal from instrument */}
        <div title="signal level" style={{ width: 8, flexShrink: 0, borderRadius: 3, overflow: 'hidden', background: trackBg, position: 'relative', alignSelf: 'stretch' }}>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${vuLevel * 100}%`, background: vuColor, borderRadius: 3, transition: 'height 0.05s linear' }} />
          {[0.5012, 0.2512, 0.1259].map((lin, i) => (
            <div key={i} style={{ position: 'absolute', bottom: `${lin * 100}%`, left: 0, right: 0, height: 0.5, background: simple ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.12)' }} />
          ))}
        </div>
        {/* Vertical fader */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
          {bodyId ? (
            <input type="range" min={0} max={1} step={0.01} value={vol}
              onChange={e => setVolume(parseFloat(e.target.value))}
              className={`planet-fader${muted ? ' muted' : ''}`}
              style={{
                position: 'absolute',
                width: 120,
                transformOrigin: 'center center',
                transform: 'rotate(-90deg)',
                accentColor: accentCol,
              }} />
          ) : (
            /* fallback fader gain bar when no body */
            <div title="fader × standpoint" style={{ width: 5, borderRadius: 3, overflow: 'hidden', background: trackBg, position: 'relative', alignSelf: 'stretch', height: '100%' }}>
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${fader * 100}%`, background: faderColor, opacity: 0.7, borderRadius: 3, transition: 'height 0.08s linear' }} />
            </div>
          )}
        </div>
      </div>

      {/* dB readout + pan */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <div style={{ fontSize: 7, color: displayCol, fontFamily: 'monospace', lineHeight: 1, minWidth: 22, textAlign: 'center' }}>
          {vuLevel > 0.001 ? dBLabel : `${(20 * Math.log10(Math.max(0.0001, vol))).toFixed(0)}`}
        </div>
        {/* Pan indicator (only when standpoint stereo active) */}
        {spActive && (
          <div style={{ width: 28, height: 3, borderRadius: 2, background: trackBg, position: 'relative' }}>
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 0.5, background: simple ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.15)' }} />
            <div style={{
              position: 'absolute', top: '50%', transform: 'translate(-50%,-50%)',
              left: `${((spPan + 1) / 2) * 100}%`,
              width: 3, height: 3, borderRadius: '50%',
              background: Math.abs(spPan) > 0.05 ? accentCol : dimText,
              transition: 'left 0.05s linear',
            }} />
          </div>
        )}
      </div>

      {/* Output label */}
      <div style={{ fontSize: 6.5, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: dimText, lineHeight: 1, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
        output
      </div>
    </div>
  )
}

// ── Rack orbit input column ───────────────────────────────────────────────────

const ORBIT_FLASH_FADE_MS = 400

function OrbitTriggerMonitor({ bodyId, simple }: { bodyId: string; simple: boolean }) {
  const dotRef = useRef<HTMLDivElement>(null)
  const col = simple ? '#7c3aed' : '#a78bfa'
  useEffect(() => {
    const el = dotRef.current
    if (!el) return
    const id = window.setInterval(() => {
      const age     = getBodyTriggerAge(bodyId)
      const opacity = isFinite(age) ? Math.max(0, 1 - age / ORBIT_FLASH_FADE_MS) : 0
      el.style.opacity    = String(0.2 + opacity * 0.8)
      el.style.background = opacity > 0.05 ? col : 'transparent'
      el.style.boxShadow  = opacity > 0.05 ? `0 0 ${(opacity * 8).toFixed(1)}px ${col}` : 'none'
    }, 16)
    return () => window.clearInterval(id)
  }, [bodyId, col])
  return (
    <div ref={dotRef} style={{
      width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
      background: 'transparent',
      border: `0.8px solid ${col}55`,
      opacity: 0.2,
    }} />
  )
}

function RackOrbitColumn({ selectedBodyId, simple }: { selectedBodyId: string | null; simple: boolean }) {
  const [liveStats, setLiveStats] = useState<PlanetBodyStats | null>(null)
  const [trailPts,  setTrailPts]  = useState<Array<{x: number; y: number}> | null>(null)
  const [showLiveData, setShowLiveData] = useState(false)

  const bodies = usePlanetStore(s => s.bodies)
  const G      = usePlanetStore(s => s.simParams.G)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selectedBodyId) { setLiveStats(null); return }
    const poll = () => setLiveStats(planetBodyStatsCache.get(selectedBodyId) ?? null)
    poll()
    const id = window.setInterval(poll, 100)
    return () => window.clearInterval(id)
  }, [selectedBodyId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selectedBodyId) { setTrailPts(null); return }
    const refresh = () => setTrailPts(getBodyTrailPoints(selectedBodyId))
    refresh()
    const id = window.setInterval(refresh, 200)
    return () => window.clearInterval(id)
  }, [selectedBodyId])

  const dimText   = simple ? 'rgba(0,0,0,0.32)'  : 'rgba(255,255,255,0.28)'
  const accentCol = simple ? '#2563eb'             : '#7c3aed'
  const freeCol   = simple ? '#dc2626'             : '#f87171'
  const divLine   = simple ? 'rgba(0,0,0,0.07)'   : 'rgba(255,255,255,0.07)'
  const _orbitBg  = simple ? 'rgba(0,0,0,0.04)'   : 'rgba(255,255,255,0.04)'
  const meterBg   = simple ? 'rgba(0,0,0,0.07)'   : 'rgba(255,255,255,0.06)'

  const liveBodies = getPlanetLiveBodySnapshot()
  const liveById   = new Map(liveBodies.map(b => [b.id, b]))
  const effectiveBodies = bodies.map(b => {
    const live = liveById.get(b.id)
    return live ? { ...b, x: live.x, y: live.y, vx: live.vx, vy: live.vy, ax: live.ax, ay: live.ay } : b
  })

  const body       = selectedBodyId ? (effectiveBodies.find(b => b.id === selectedBodyId) ?? null) : null
  const orbitStats = body ? computeOrbitStats(body, effectiveBodies, G) : null

  const _CollapseBtn = ({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) => (
    <button onClick={onToggle} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: 'none', border: 'none', cursor: 'pointer',
      padding: '1px 0', width: '100%', fontFamily: 'inherit',
    }}>
      <span style={{ fontSize: 7, fontWeight: 700, color: dimText, textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1 }}>{label}</span>
      <span style={{ fontSize: 7, color: dimText, lineHeight: 1 }}>{open ? '▲' : '▼'}</span>
    </button>
  )

  const border = simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)'

  function renderTrailPreview() {
    if (!body || !trailPts || trailPts.length < 2) return null
    let minX = trailPts[0].x, maxX = trailPts[0].x, minY = trailPts[0].y, maxY = trailPts[0].y
    for (const p of trailPts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
    }
    const pad = 6, bw = maxX - minX || 1, bh = maxY - minY || 1
    const svgW = 156, svgH = 84
    const scale = Math.min((svgW - pad * 2) / bw, (svgH - pad * 2) / bh)
    const drawW = bw * scale, drawH = bh * scale
    const ox = (svgW - drawW) / 2 - minX * scale
    const oy = (svgH - drawH) / 2 - minY * scale
    const pts = trailPts.map(p => `${(p.x * scale + ox).toFixed(1)},${(p.y * scale + oy).toFixed(1)}`).join(' ')
    const cur = trailPts[trailPts.length - 1]
    const cx = cur.x * scale + ox, cy = cur.y * scale + oy

    function copyTrail() {
      const json = JSON.stringify({ body: body.name, n: trailPts.length, points: trailPts })
      const ta = document.createElement('textarea')
      ta.value = json
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0.01;pointer-events:none'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      navigator.clipboard?.writeText(json).catch(() => {})
    }

    return (
      <div style={{ margin: '2px 0', position: 'relative' }}>
        <svg width={svgW} height={svgH}
          viewBox={`0 0 ${svgW.toFixed(1)} ${svgH.toFixed(1)}`}
          onClick={copyTrail}
          style={{ display: 'block', borderRadius: 3, background: 'transparent', cursor: 'copy' }}
        >
          <polyline points={pts} fill="none" stroke={body.color} strokeOpacity={0.7} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={cx.toFixed(1)} cy={cy.toFixed(1)} r={2.5} fill={body.color} opacity={0.9} />
        </svg>
        <div style={{ fontSize: 6, color: dimText, opacity: 0.5, textAlign: 'right', marginTop: 1 }}>
          click to copy · {trailPts.length} pts
        </div>
      </div>
    )
  }

  return (
    <div style={{ width: 172, flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
    {/* ── main scrollable content ── */}
    <div style={{
      flex: 1, minWidth: 0, minHeight: 0,
      display: 'flex', flexDirection: 'column',
      padding: '6px 7px 6px 8px', gap: 3,
      overflowY: 'auto', overflowX: 'hidden',
      scrollbarWidth: 'thin',
      scrollbarColor: simple ? 'rgba(0,0,0,0.12) transparent' : 'rgba(255,255,255,0.08) transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ fontSize: 6.5, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: accentCol, lineHeight: 1 }}>
          ◎ orbit
        </div>
        {selectedBodyId && <OrbitTriggerMonitor bodyId={selectedBodyId} simple={simple} />}
        {/* Copy orbit+trail to clipboard */}
        {body && (
          <button
            onClick={() => {
              const trail = getBodyTrailPoints(body.id) ?? []
              const json = JSON.stringify({
                body: body.name,
                orbit: liveStats ? {
                  T:          liveStats.period,
                  ecc:        orbitStats?.ecc ?? 0,
                  r:          liveStats.r,
                  speed:      liveStats.speed,
                  accel:      liveStats.accel,
                  omega:      liveStats.omega,
                  angleDeg:   liveStats.angleDeg,
                  lfoPhase:   liveStats.lfoPhase,
                  bound:      orbitStats?.bound ?? false,
                  centerName: orbitStats?.centerName ?? '',
                } : null,
                trail,
              })
              const ta = document.createElement('textarea')
              ta.value = json; ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0.01'
              document.body.appendChild(ta); ta.focus(); ta.select()
              document.execCommand('copy'); document.body.removeChild(ta)
              navigator.clipboard?.writeText(json).catch(() => {})
            }}
            title="Copy orbit data + trail to clipboard (paste in Wave Lab)"
            style={{
              marginLeft: 'auto', fontSize: 7, fontWeight: 700,
              padding: '1px 5px', border: 'none', borderRadius: 3, cursor: 'pointer',
              background: simple ? 'rgba(37,99,235,0.10)' : 'rgba(124,58,237,0.14)',
              color: accentCol, fontFamily: 'inherit',
            }}
          >copy</button>
        )}
      </div>

      {!body ? (
        <div style={{ fontSize: 7, color: dimText, fontStyle: 'italic', lineHeight: 1.55 }}>no body selected</div>
      ) : (<>
        {renderTrailPreview()}

        <div style={{ height: 0.5, background: divLine, margin: '1px 0' }} />

        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          {([
            { key: 'T',   value: orbitStats ? `${orbitStats.T_real.toFixed(1)}s` : '—', title: 'orbital period' },
            { key: 'ecc', value: orbitStats ? orbitStats.ecc.toFixed(2)           : '—', title: 'eccentricity'   },
            { key: 'r',   value: orbitStats ? `${Math.round(orbitStats.r)}`       : '—', title: 'distance'       },
            { key: 'v',   value: orbitStats ? orbitStats.speed.toFixed(1)         : '—', title: 'speed'          },
          ] as const).map(row => (
            <div key={row.key} title={row.title} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <span style={{ fontSize: 6, color: dimText, lineHeight: 1 }}>{row.key}</span>
              <span style={{ fontSize: 8, fontFamily: 'monospace', color: accentCol, lineHeight: 1 }}>{row.value}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 1 }}>
          {orbitStats && (
            <span style={{ fontSize: 6.5, color: orbitStats.bound ? accentCol : freeCol, letterSpacing: '0.07em', textTransform: 'uppercase', lineHeight: 1 }}>
              {orbitStats.bound ? '⟳ bound' : '↗ free'}
            </span>
          )}
          {orbitStats && (
            <span style={{ fontSize: 6.5, color: dimText, opacity: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, lineHeight: 1 }}>
              ← {orbitStats.centerName}
            </span>
          )}
        </div>

        <div style={{ height: 0.5, background: divLine, margin: '1px 0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3.5 }}>
            {([
              { label: 'spd', norm: liveStats ? Math.min(1, liveStats.speed / 4)                : 0, color: '#60a5fa' },
              { label: 'r',   norm: liveStats ? Math.min(1, liveStats.r / 700)                  : 0, color: '#34d399' },
              { label: 'acc', norm: liveStats ? Math.min(1, liveStats.accel * 80)               : 0, color: '#f87171' },
              { label: 'ω',   norm: liveStats ? Math.min(1, Math.abs(liveStats.omega) / 0.025) : 0, color: '#fbbf24' },
            ] as const).map(({ label, norm, color }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 7, color: dimText, width: 16, textAlign: 'right', flexShrink: 0, lineHeight: 1 }}>{label}</span>
                <div style={{ flex: 1, height: 3.5, background: meterBg, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${norm * 100}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.06s linear' }} />
                </div>
              </div>
            ))}
          </div>
          <svg width={28} height={28} style={{ flexShrink: 0 }}>
            <circle cx={14} cy={14} r={10} fill="none" stroke={simple ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'} strokeWidth={1.5} />
            {liveStats && (() => {
              const rad = (liveStats.angleDeg - 90) * Math.PI / 180
              const nx = 14 + 10 * Math.cos(rad), ny = 14 + 10 * Math.sin(rad)
              return <>
                <line x1={14} y1={14} x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke={body.color} strokeWidth={1.5} opacity={0.55} />
                <circle cx={nx.toFixed(1)} cy={ny.toFixed(1)} r={2.5} fill={body.color} opacity={0.9} />
              </>
            })()}
            <circle cx={14} cy={14} r={1.5} fill={simple ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)'} />
          </svg>
        </div>


        {/* ── Orbit preview — trail data already computed by canvas ── */}

        {showLiveData && liveStats && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 2 }}>
            {[
              { title: '角度 Angle',    color: '#a78bfa', rows: [
                { label: 'angle', val: `${liveStats.angleDeg.toFixed(1)}°`, hint: 'pan/filter' },
                { label: 'norm',  val: liveStats.angleNorm.toFixed(3),      hint: '0–1' },
              ]},
              { title: '距離 Distance', color: '#34d399', rows: [
                { label: 'r',  val: liveStats.r.toFixed(1),          hint: 'vol/reverb' },
                { label: 'x',  val: liveStats.x.toFixed(1),          hint: 'world x' },
                { label: 'y',  val: liveStats.y.toFixed(1),          hint: 'world y' },
              ]},
              { title: '速度 Velocity', color: '#60a5fa', rows: [
                { label: 'spd', val: liveStats.speed.toFixed(3),     hint: 'pitch/bright' },
                { label: 'vx',  val: liveStats.vx.toFixed(3),        hint: '' },
                { label: 'vy',  val: liveStats.vy.toFixed(3),        hint: '' },
              ]},
              { title: '加速度 Accel',  color: '#f87171', rows: [
                { label: 'acc', val: liveStats.accel.toFixed(4),     hint: 'noise/dist' },
                { label: 'ax',  val: liveStats.ax.toFixed(4),        hint: '' },
                { label: 'ay',  val: liveStats.ay.toFixed(4),        hint: '' },
              ]},
              { title: '周期 Period',   color: '#fbbf24', rows: [
                { label: 'ω',     val: liveStats.omega.toFixed(5),                                       hint: 'LFO rate'  },
                { label: 'T sim', val: isFinite(liveStats.period) ? liveStats.period.toFixed(1) : '∞', hint: 'orbit period' },
                { label: 'LFO φ', val: `${(liveStats.lfoPhase * 100).toFixed(1)}%`,                    hint: '0–100%'    },
              ]},
              { title: '近傍 Nearest',  color: '#fb923c', rows: [
                { label: 'dist',   val: isFinite(liveStats.nearestDist)     ? liveStats.nearestDist.toFixed(1)     : '∞', hint: 'FM/interf' },
                { label: 'relSpd', val: isFinite(liveStats.nearestRelSpeed) ? liveStats.nearestRelSpeed.toFixed(3) : '∞', hint: 'rel speed' },
              ]},
              { title: 'プローブ Probe', color: '#e879f9', rows: [
                { label: 'dist',  val: isFinite(liveStats.probeDist)      ? liveStats.probeDist.toFixed(1)           : '∞', hint: 'approach' },
                { label: 'angle', val: isFinite(liveStats.probeAngleDeg)  ? `${liveStats.probeAngleDeg.toFixed(1)}°` : '—', hint: 'dir'      },
                { label: 'norm',  val: isFinite(liveStats.probeAngleNorm) ? liveStats.probeAngleNorm.toFixed(3)      : '—', hint: '0–1'      },
              ]},
            ].map(section => (
              <div key={section.title}>
                <div style={{ fontSize: 6.5, fontWeight: 700, color: section.color, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{section.title}</div>
                {section.rows.map(r => <RackStatRow key={r.label} label={r.label} val={r.val} hint={r.hint} dimText={dimText} />)}
              </div>
            ))}
          </div>
        )}
      </>)}

      <div style={{ minHeight: 6 }} />
      <div style={{ fontSize: 6, color: dimText, opacity: 0.40, textTransform: 'uppercase', letterSpacing: '0.10em', lineHeight: 1 }}>input →</div>
    </div>{/* end scrollable content */}

    {/* ── thin Live Data strip on right ── */}
    <button
      onClick={() => setShowLiveData(v => !v)}
      title={showLiveData ? 'Hide live data' : 'Show live data'}
      style={{
        width: 14, flexShrink: 0,
        border: 'none', borderLeft: `0.5px solid ${border}`,
        cursor: 'pointer',
        background: showLiveData
          ? (simple ? 'rgba(37,99,235,0.10)' : 'rgba(124,58,237,0.12)')
          : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0,
      }}
    >
      <span style={{
        writingMode: 'vertical-rl',
        transform: 'rotate(180deg)',
        fontSize: 6.5, fontWeight: 800, letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: showLiveData ? accentCol : dimText,
        userSelect: 'none',
      }}>
        {showLiveData ? '◀ data' : '▶ data'}
      </span>
    </button>

    </div>
  )
}

// ── Orbit trigger input block ──────────────────────────────────────────────────

/**
 * Shown inside the orbit trigger SlotCard.
 * periodic mode: T, ecc, r, φ values + spd/ω meters
 * cumulative mode: charge arc showing progress toward next trigger fire
 */
function OrbitInputBlock({ bodyId, dimText, accent, triggerType, division }: {
  bodyId:      string | null
  dimText:     string
  accent:      string
  triggerType: string   // 'periodic' | 'cumulative'
  division:    number   // orbitTriggerDivision
}) {
  const bodies = usePlanetStore(s => s.bodies)
  const G      = usePlanetStore(s => s.simParams.G)

  const [liveStats, setLiveStats] = useState(() =>
    bodyId ? (planetBodyStatsCache.get(bodyId) ?? null) : null,
  )

  // High-water mark for rawOrbits — prevents the gauge from flickering backwards
  // due to tiny CM-drift-induced jitter in the angle accumulator.
  // Updated in the same setInterval tick, read in render (safe: ref is set before setState).
  const smoothRawOrbitsRef = useRef(0)

  useEffect(() => {
    smoothRawOrbitsRef.current = 0
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!bodyId) { setLiveStats(null); return }
    const id = window.setInterval(() => {
      const stats = planetBodyStatsCache.get(bodyId) ?? null
      // ── Update smoothed high-water mark ──────────────────────────────────
      if (stats) {
        const raw  = Math.abs(stats.totalOrbits)
        const prev = smoothRawOrbitsRef.current
        // Only allow the counter to move forward.
        // Exception: raw is near-zero AND prev is large → simulation was reset.
        // Rosette / precessing orbits can cause large backwards swings in the
        // CM-relative angle, so we never force-sync based on swing magnitude alone.
        const isReset = raw < 0.1 && prev > 1.0
        if (raw >= prev || isReset) {
          smoothRawOrbitsRef.current = raw
        }
      }
      setLiveStats(stats)
    }, 50)   // 20 Hz for smooth arc animation
    return () => window.clearInterval(id)
  }, [bodyId, division])

  // Compute orbit stats from live positions
  const liveBodies = getPlanetLiveBodySnapshot()
  const liveById   = new Map(liveBodies.map(b => [b.id, b]))
  const effective  = bodies.map(b => {
    const live = liveById.get(b.id)
    return live ? { ...b, x: live.x, y: live.y, vx: live.vx, vy: live.vy } : b
  })
  const orbitBody  = bodyId ? (effective.find(b => b.id === bodyId) ?? null) : null
  const orbitStats = orbitBody ? computeOrbitStats(orbitBody, effective, G) : null

  const meterBg = `${dimText}22`
  const isCumulative = triggerType === 'cumulative'
  const isTperiod    = triggerType === 'tperiod'

  // ── cumulative progress ────────────────────────────────────────────────────
  // Progress within the current cycle (0→1). div controls how many orbits per cycle.
  // Use smoothed high-water mark — never goes backwards within a cycle.
  // eslint-disable-next-line react-hooks/refs
  const rawOrbits  = smoothRawOrbitsRef.current
  const cycleLen   = Math.max(0.0625, division)   // orbits per trigger cycle
  const progress   = (rawOrbits % cycleLen) / cycleLen   // 0–1
  const doneOrbits = Math.floor(rawOrbits % cycleLen)    // completed orbits within cycle
  const totalDone  = Math.floor(rawOrbits / cycleLen)    // how many times fired so far

  // ── T-period progress — wall-clock based ─────────────────────────────────
  // Uses performance.now() elapsed since last trigger vs. the stored interval (ms).
  const tpIntervalMs  = liveStats?.tperiodIntervalMs ?? 0
  // eslint-disable-next-line react-hooks/purity
  const tpWallElapsed = (liveStats?.lastTriggerWallMs && tpIntervalMs > 0) ? Math.max(0, performance.now() - liveStats.lastTriggerWallMs) : 0
  const tpProgress    = tpIntervalMs > 0 ? Math.min(1, tpWallElapsed / tpIntervalMs) : 0

  // SVG arc helper — returns "M ... A ..." path for a circle arc
  function arcPath(cx: number, cy: number, r: number, pct: number): string {
    if (pct <= 0) return ''
    if (pct >= 1) pct = 0.9999   // avoid degenerate arc
    const startAngle = -Math.PI / 2
    const endAngle   = startAngle + pct * 2 * Math.PI
    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)
    const large = pct > 0.5 ? 1 : 0
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
  }

  return (
    <div style={{ padding: '4px 0 2px', borderTop: `0.5px solid ${accent}25` }}>
      {/* header badge */}
      <div style={{
        fontSize: 6.5, fontWeight: 800, color: accent, opacity: 0.75,
        textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 3,
      }}>◎ orbit input</div>

      {!bodyId ? (
        <div style={{ fontSize: 7, color: dimText, fontStyle: 'italic' }}>select a body</div>
      ) : isTperiod ? (

        /* ── T-PERIOD mode: wall-clock timer, fires T_real × div ms after trigger */
        tpIntervalMs <= 0 ? (
          <div style={{ fontSize: 7, color: dimText, fontStyle: 'italic' }}>unbound / no period</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Arc gauge */}
            <svg width={52} height={52} style={{ flexShrink: 0 }}>
              <circle cx={26} cy={26} r={20}
                fill="none" stroke={meterBg} strokeWidth={4} />
              {tpProgress > 0 && (
                <path d={arcPath(26, 26, 20, tpProgress)}
                  fill="none" stroke={accent} strokeWidth={4}
                  strokeLinecap="round" />
              )}
              {/* Centre: percent */}
              <text x={26} y={24} textAnchor="middle"
                fontSize={9} fontFamily="monospace"
                fill={accent} fontWeight={700}>
                {Math.round(tpProgress * 100)}
              </text>
              <text x={26} y={33} textAnchor="middle"
                fontSize={6} fontFamily="monospace" fill={dimText}>
                %
              </text>
            </svg>
            {/* Right side: T stats */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {orbitStats && (
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: accent, lineHeight: 1, fontWeight: 700 }}>
                  T {(orbitStats.T_real * cycleLen).toFixed(1)}<span style={{ fontSize: 7, opacity: 0.7 }}>s</span>
                </span>
              )}
              {orbitStats && cycleLen !== 1 && (
                <span style={{ fontSize: 6.5, color: dimText, lineHeight: 1 }}>
                  ×{cycleLen % 1 === 0 ? cycleLen : cycleLen.toFixed(2)}
                </span>
              )}
              {orbitStats && (
                <span style={{ fontSize: 6.5, fontFamily: 'monospace', color: dimText, lineHeight: 1 }}>
                  T {orbitStats.T_real.toFixed(1)}s
                </span>
              )}
            </div>
          </div>
        )

      ) : isCumulative ? (

        /* ── CUMULATIVE mode: charge arc ──────────────────────────────────── */
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Arc gauge */}
          <svg width={52} height={52} style={{ flexShrink: 0 }}>
            {/* Background track */}
            <circle cx={26} cy={26} r={20}
              fill="none" stroke={meterBg} strokeWidth={4} />
            {/* Filled arc */}
            {progress > 0 && (
              <path d={arcPath(26, 26, 20, progress)}
                fill="none" stroke={accent} strokeWidth={4}
                strokeLinecap="round" />
            )}
            {/* Centre: completed / total */}
            <text x={26} y={23} textAnchor="middle"
              fontSize={8} fontFamily="monospace"
              fill={accent} fontWeight={700}>
              {doneOrbits}
            </text>
            <text x={26} y={33} textAnchor="middle"
              fontSize={7} fontFamily="monospace"
              fill={dimText}>
              /{cycleLen % 1 === 0 ? cycleLen : cycleLen.toFixed(2)}
            </text>
          </svg>

          {/* Right side: percentage + stats */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Percent fill */}
            <span style={{ fontSize: 13, fontFamily: 'monospace', color: accent, lineHeight: 1, fontWeight: 700 }}>
              {Math.round(progress * 100)}<span style={{ fontSize: 8, opacity: 0.7 }}>%</span>
            </span>
            {/* Fired count */}
            <span style={{ fontSize: 7, color: dimText, lineHeight: 1 }}>
              fired {totalDone}×
            </span>
            {/* T value */}
            {orbitStats && (
              <span style={{ fontSize: 7, fontFamily: 'monospace', color: dimText, lineHeight: 1 }}>
                T {orbitStats.T_real.toFixed(1)}s
              </span>
            )}
          </div>
        </div>

      ) : (

        /* ── PERIODIC mode: T, ecc, r, φ + meters ────────────────────────── */
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
            {[
              { key: 'T',   val: orbitStats ? `${orbitStats.T_real.toFixed(1)}` : '—' },
              { key: 'ecc', val: orbitStats ? orbitStats.ecc.toFixed(2)          : '—' },
              { key: 'r',   val: orbitStats ? `${Math.round(orbitStats.r)}`      : '—' },
              { key: 'φ',   val: liveStats  ? `${liveStats.angleDeg.toFixed(0)}°` : '—' },
            ].map(row => (
              <div key={row.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                <span style={{ fontSize: 5.5, color: dimText, lineHeight: 1 }}>{row.key}</span>
                <span style={{ fontSize: 7.5, fontFamily: 'monospace', color: accent, lineHeight: 1.3 }}>{row.val}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {([
              { label: 'spd', norm: liveStats ? Math.min(1, liveStats.speed / 4)                : 0, color: '#60a5fa' },
              { label: 'ω',   norm: liveStats ? Math.min(1, Math.abs(liveStats.omega) / 0.025) : 0, color: '#fbbf24' },
            ] as const).map(({ label, norm, color }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ fontSize: 6.5, color: dimText, width: 16, textAlign: 'right', flexShrink: 0, lineHeight: 1 }}>{label}</span>
                <div style={{ flex: 1, height: 3, background: meterBg, borderRadius: 1.5, overflow: 'hidden' }}>
                  <div style={{ width: `${norm * 100}%`, height: '100%', background: color, borderRadius: 1.5, transition: 'width 0.06s linear' }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Orbit-mode drone readout ─────────────────────────────────────────────────

type OrbitParams = ReturnType<typeof computeOrbitDroneParams>

const ORBIT_PARAM_ROWS: Array<{
  paramKey: keyof OrbitParams
  label: string
  driver: string
  fmt: (v: number) => string
}> = [
  { paramKey: 'brightness', label: 'bright',  driver: 'period + dist',  fmt: v => `${v} Hz`          },
  { paramKey: 'melt',       label: 'melt',    driver: 'eccentricity',   fmt: v => v.toFixed(2)        },
  { paramKey: 'motion',     label: 'motion',  driver: 'period ↓',       fmt: v => v.toFixed(2)        },
  { paramKey: 'detune',     label: 'detune',  driver: 'ecc + dist',     fmt: v => `${v} ct`           },
  { paramKey: 'attack',     label: 'attack',  driver: 'period × .15',   fmt: v => `${v.toFixed(2)}s`  },
  { paramKey: 'release',    label: 'release', driver: 'period × .35',   fmt: v => `${v.toFixed(2)}s`  },
]

/** PlanetSimParams keys whose values are overwritten by orbit-mode computation. */
const ORBIT_DRIVEN_PARAM_KEYS = new Set<string>([
  'droneBrightness', 'droneMelt', 'droneMotion', 'droneDetune', 'droneAttack', 'droneRelease',
])

const EMPTY_PARAM_OVERRIDES: Partial<PlanetSimParams> = {}

// ── Inline Osc Synth content (rendered inside instrument SlotCard) ───────────

/**
 * Test-note button for instrument-osc-synth.
 * Sends C4 noteOn → noteOff after 1.5 s (or cancel on second click).
 */
function InlineOscSynthContent({
  bodyId, simple, accent,
}: { bodyId: string | null; simple: boolean; accent: string }) {
  const [testing, setTesting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dimText  = simple ? 'rgba(0,0,0,0.40)' : 'rgba(255,255,255,0.35)'

  function handleTest() {
    if (!bodyId) return
    const eng = getBodyOscSynthEngine(bodyId)
    if (!eng) return
    if (testing) {
      eng.noteOff(60)
      if (timerRef.current) clearTimeout(timerRef.current)
      setTesting(false)
      return
    }
    eng.noteOn(60, 0.8)
    setTesting(true)
    timerRef.current = setTimeout(() => {
      eng.noteOff(60)
      setTesting(false)
    }, 1500)
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return (
    <div style={{ padding: '4px 0 2px', display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        onClick={handleTest}
        style={{
          fontSize: 9, fontWeight: 700, padding: '3px 10px',
          borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
          border: `0.5px solid ${accent}55`,
          background: testing ? `${accent}22` : 'transparent',
          color: testing ? accent : dimText,
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        {testing ? '♪ playing…' : '▶ Test  C4'}
      </button>
    </div>
  )
}

// ── MIDI note number → name (e.g. 48 → "C3") ─────────────────────────────────
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
function midiToNoteName(n: number): string {
  const nn = Math.max(0, Math.min(127, Math.round(n)))
  return `${NOTE_NAMES[nn % 12]}${Math.floor(nn / 12) - 1}`
}

// ── Inline Arpeggio trigger (rendered inside trigger SlotCard) ────────────────

const ARP_STEP_KEYS = ['arpNote0', 'arpNote1', 'arpNote2', 'arpNote3'] as const
const ARP_CHORD_QUALITIES = ['Major','Minor','Sus2','Sus4','Dim','Aug','Maj7','Min7','Dom7'] as const
const ARP_CHORD_INTERVALS: Record<string, number[]> = {
  Major: [0, 4, 7],
  Minor: [0, 3, 7],
  Sus2:  [0, 2, 7],
  Sus4:  [0, 5, 7],
  Dim:   [0, 3, 6],
  Aug:   [0, 4, 8],
  Maj7:  [0, 4, 7, 11],
  Min7:  [0, 3, 7, 10],
  Dom7:  [0, 4, 7, 10],
}
const ARP_MAJOR_DEGREES = [
  { pc: 0,  quality: 'Maj7' },
  { pc: 2,  quality: 'Min7' },
  { pc: 4,  quality: 'Min7' },
  { pc: 5,  quality: 'Maj7' },
  { pc: 7,  quality: 'Dom7' },
  { pc: 9,  quality: 'Min7' },
  { pc: 11, quality: 'Dim' },
]
const ARP_MINOR_DEGREES = [
  { pc: 0,  quality: 'Min7' },
  { pc: 2,  quality: 'Dim' },
  { pc: 3,  quality: 'Maj7' },
  { pc: 5,  quality: 'Min7' },
  { pc: 7,  quality: 'Min7' },
  { pc: 8,  quality: 'Maj7' },
  { pc: 10, quality: 'Dom7' },
]
const ARP_DEGREE_LABELS = {
  major: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
  minor: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'],
} as const

function chordName(rootPc: number, quality: string): string {
  const suffix = quality === 'Major' ? ''
    : quality === 'Minor' ? 'm'
      : quality === 'Maj7' ? 'maj7'
        : quality === 'Min7' ? 'm7'
          : quality === 'Dom7' ? '7'
            : quality === 'Dim' ? 'dim'
              : quality
  return `${NOTE_NAMES[rootPc]}${suffix}`
}

function buildKeyChordMap(keyPc: number, scale: string, octave: number) {
  if (scale !== 'major' && scale !== 'minor') return null
  const table = scale === 'minor' ? ARP_MINOR_DEGREES : ARP_MAJOR_DEGREES
  return table.map((spec, index) => {
    const rootPc = (keyPc + spec.pc) % 12
    const notes = buildRackChordNotesFrom(rootPc, octave, spec.quality, 0)
    return {
      degree: ARP_DEGREE_LABELS[scale][index],
      name: chordName(rootPc, spec.quality),
      notes,
    }
  })
}

interface ChordSeqStep { root: number; quality: string; inv: number; oct: number; beats: number }

function parseChordSeq(raw: unknown): ChordSeqStep[] {
  try {
    const arr = JSON.parse(String(raw ?? '[]'))
    if (!Array.isArray(arr)) return []
    return arr.map(s => ({
      root: Math.max(0, Math.min(11, Number(s.root ?? 0))),
      quality: String(s.quality ?? 'Maj7'),
      inv: Math.max(0, Math.min(3, Number(s.inv ?? 0))),
      oct: Math.max(0, Math.min(8, Number(s.oct ?? 3))),
      beats: Math.max(1, Number(s.beats ?? 4)),
    }))
  } catch { return [] }
}

function stringifyChordSeq(seq: ChordSeqStep[]): string {
  return JSON.stringify(seq)
}

function chordSeqLabel(step: ChordSeqStep): string {
  const root = NOTE_NAMES[step.root]
  const invLabels = ['', '/', '6', '64']
  const inv = invLabels[Math.min(3, step.inv)] ?? ''
  if (step.inv === 1) {
    // show slash notation: root/bass
    const intervals = ARP_CHORD_INTERVALS[step.quality] ?? [0, 4, 7]
    const bassInterval = intervals[1] ?? 0
    const bassNote = NOTE_NAMES[(step.root + bassInterval) % 12]
    return `${root}/${bassNote}`
  }
  return `${root}${step.quality === 'Major' ? '' : step.quality === 'Minor' ? 'm' : step.quality}${inv}`
}

function getArpParam(overrides: Partial<PlanetSimParams>, key: string, fallback: unknown): unknown {
  return key in (overrides as Record<string, unknown>)
    ? (overrides as Record<string, unknown>)[key]
    : fallback
}

function parseRackProgression(raw: unknown): number[] {
  const degrees = String(raw ?? '').match(/-?\d+/g)?.map(n => Number(n)).filter(n => Number.isFinite(n)) ?? []
  return degrees.length ? degrees : [1]
}

function buildRackChordNotesFrom(rootPc: number, octave: number, quality: string, inversion: number): number[] {
  const intervals = ARP_CHORD_INTERVALS[quality] ?? ARP_CHORD_INTERVALS.Maj7
  const safeInversion = Math.max(0, Math.min(intervals.length - 1, Math.round(inversion)))
  const base = (octave + 1) * 12 + rootPc
  return intervals.map((iv, i) => Math.max(0, Math.min(127, base + iv + (i < safeInversion ? 12 : 0)))).sort((a, b) => a - b)
}

function buildRackChordNotes(overrides: Partial<PlanetSimParams>): number[] {
  const rootPc = Math.max(0, Math.min(11, Math.round(Number(getArpParam(overrides, 'arpChordRoot', 0)))))
  const octave = Math.max(0, Math.min(8, Math.round(Number(getArpParam(overrides, 'arpChordOctave', 3)))))
  const quality = String(getArpParam(overrides, 'arpChordQuality', 'Maj7'))
  const inversion = Math.max(0, Math.min(3, Math.round(Number(getArpParam(overrides, 'arpChordInversion', 0)))))
  return buildRackChordNotesFrom(rootPc, octave, quality, inversion)
}

function buildRackProgressionChordNotes(overrides: Partial<PlanetSimParams>, index: number): number[] {
  const degrees = parseRackProgression(getArpParam(overrides, 'arpChordProgression', '1 2 5 7'))
  const degree = degrees[((index % degrees.length) + degrees.length) % degrees.length]
  const keyPc = Math.max(0, Math.min(11, Math.round(Number(getArpParam(overrides, 'arpChordRoot', 0)))))
  const octave = Math.max(0, Math.min(8, Math.round(Number(getArpParam(overrides, 'arpChordOctave', 3)))))
  const inversion = Math.max(0, Math.min(3, Math.round(Number(getArpParam(overrides, 'arpChordInversion', 0)))))
  const table = String(getArpParam(overrides, 'arpChordScaleMode', 'major')) === 'minor' ? ARP_MINOR_DEGREES : ARP_MAJOR_DEGREES
  const degreeIndex = ((Math.round(degree) - 1) % 7 + 7) % 7
  const octaveShift = Math.floor((Math.round(degree) - 1) / 7)
  const spec = table[degreeIndex] ?? table[0]
  return buildRackChordNotesFrom((keyPc + spec.pc) % 12, Math.max(0, Math.min(8, octave + octaveShift)), spec.quality, inversion)
}

function progressionLabel(overrides: Partial<PlanetSimParams>): string {
  const scale = String(getArpParam(overrides, 'arpChordScaleMode', 'major'))
  return `${NOTE_NAMES[Math.max(0, Math.min(11, Number(getArpParam(overrides, 'arpChordRoot', 0))))]} ${scale} · ${String(getArpParam(overrides, 'arpChordProgression', '1 2 5 7'))}`
}

function InlineArpContent({
  bodyId, slotKey, simple, accent,
}: { bodyId: string | null; slotKey: string; simple: boolean; accent: string }) {
  const isNoteSlot = slotKey === 'g:note' || slotKey.endsWith(':note')
  const overrides       = useControlSetStore(s => s.rackParamOverrides[slotKey] ?? EMPTY_PARAM_OVERRIDES)
  const liveState       = useArpProgressionStore(s => s.liveBySlot[slotKey] ?? null)
  const setSlotOverride = useControlSetStore(s => s.setSlotOverride)
  const resetSlotParam  = useControlSetStore(s => s.resetSlotParam)
  const conductorKey    = useUniversalConductorStore(s => s.key)
  const conductorScale  = useUniversalConductorStore(s => s.scale)
  const dimText = simple ? 'rgba(0,0,0,0.40)' : 'rgba(255,255,255,0.35)'
  const playMode = String(getArpParam(overrides, 'arpPlayMode', 'arp'))
  const progressionEnabled = Boolean(getArpParam(overrides, 'arpChordProgressionEnabled', false))
  const chordNotes = progressionEnabled ? buildRackProgressionChordNotes(overrides, 0) : buildRackChordNotes(overrides)
  const chordLabel = chordNotes.map(midiToNoteName).join(' ')
  // eslint-disable-next-line react-hooks/purity
  const liveAge = liveState ? performance.now() - liveState.updatedAt : Infinity
  const liveActive = progressionEnabled && liveState && liveAge < 6000
  const liveNotes = liveState?.notes?.length ? liveState.notes : chordNotes
  const liveLabel = liveState
    ? `${liveState.degreeIndex + 1}/${liveState.degreeCount} · ${liveState.label} · ${liveNotes.map(midiToNoteName).join(' ')}`
    : progressionLabel(overrides)
  const division = Number(getArpParam(overrides, 'orbitTriggerDivision', 0.25))
  const divisionLabel = isNoteSlot ? 'note' : division === 1 ? '1/1' : division === 0.5 ? '1/2' : division === 0.25 ? '1/4' : division === 0.125 ? '1/8' : '1/16'
  const keyChordMap = buildKeyChordMap(conductorKey, conductorScale, 3)

  // defaults C3 E3 G3 B3
  const DEFAULT_NOTES = [48, 52, 55, 59]

  function noteValue(i: number): number {
    const k = ARP_STEP_KEYS[i]
    const v = (overrides as Record<string, unknown>)[k]
    return v !== undefined ? Number(v) : DEFAULT_NOTES[i]
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>, i: number) {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 1 : -1
    const next  = Math.max(0, Math.min(127, noteValue(i) + delta))
    setSlotOverride(slotKey, { [ARP_STEP_KEYS[i]]: next } as Partial<PlanetSimParams>)
  }

  function handleClick(i: number) {
    // fire note preview via OscSynth
    const tgt = bodyId || usePlanetStore.getState().selectedBodyId
    if (!tgt) return
    const midi = noteValue(i)
    const body = usePlanetStore.getState().bodies.find(b => b.id === tgt)
    sendMidiNote(body?.midiChannel ?? 1, midi, body?.midiVelocity ?? 100, 300)
    const eng = getBodyOscSynthEngine(tgt)
    if (eng) {
      eng.noteOn(midi, 0.8)
      setTimeout(() => eng.noteOff(midi), 500)
      markBodyTriggered(tgt)
    }
  }

  function handleReset(e: React.MouseEvent, i: number) {
    e.stopPropagation()
    resetSlotParam(slotKey, ARP_STEP_KEYS[i])
  }

  return (
    <div style={{ paddingTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 4 }}>
        <span style={{ fontSize: 7, color: dimText, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', marginRight: 2 }}>
          {divisionLabel}
        </span>
        {(['arp', 'chord'] as const).map(mode => (
          <button key={mode}
            onClick={() => setSlotOverride(slotKey, { arpPlayMode: mode } as Partial<PlanetSimParams>)}
            style={{
              flex: 1,
              fontSize: 7.5,
              fontWeight: 800,
              padding: '2px 4px',
              borderRadius: 4,
              border: `0.5px solid ${playMode === mode ? accent : accent + '44'}`,
              background: playMode === mode ? `${accent}24` : 'transparent',
              color: playMode === mode ? accent : dimText,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textTransform: 'uppercase',
              lineHeight: 1,
            }}
          >{mode}</button>
        ))}
      </div>
      <div style={{
        marginBottom: 4,
        padding: '3px 5px',
        borderRadius: 4,
        border: `0.5px solid ${accent}33`,
        background: `${accent}0c`,
        color: dimText,
        fontSize: 7.5,
        lineHeight: 1.25,
      }}>
        <span style={{ color: accent, fontWeight: 800 }}>
          Key {CONDUCTOR_NOTE_NAMES[conductorKey]} {conductorScale}
        </span>
        <span> → </span>
        {keyChordMap
          ? keyChordMap.map(chord => `${chord.degree} ${chord.name}`).join(' · ')
          : 'コード生成は major / minor に対応'}
      </div>
      {progressionEnabled && (
        <div style={{
          marginBottom: 4,
          padding: '3px 5px',
          borderRadius: 4,
          border: `0.5px solid ${liveActive ? accent + '88' : accent + '33'}`,
          background: liveActive ? `${accent}1c` : `${accent}0c`,
          color: liveActive ? accent : dimText,
          fontSize: 7.5,
          fontWeight: liveActive ? 800 : 700,
          lineHeight: 1.15,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {liveActive ? 'now ' : 'next '}{liveLabel}
        </div>
      )}
      {/* Step grid: 4 note cells */}
      {playMode === 'chord' ? (
        <div
          onClick={() => {
            const tgt = bodyId || usePlanetStore.getState().selectedBodyId
            if (!tgt) return
            chordNotes.forEach(midi => {
              const body = usePlanetStore.getState().bodies.find(b => b.id === tgt)
              sendMidiNote(body?.midiChannel ?? 1, midi, body?.midiVelocity ?? 100, 300)
              fireBodyInstrumentTrigger(tgt, 1, midi)
            })
            markBodyTriggered(tgt)
          }}
          style={{
            borderRadius: 4,
            border: `0.5px solid ${accent}55`,
            background: `${accent}10`,
            padding: '5px 6px',
            cursor: 'pointer',
          }}
          title="Click to preview chord"
        >
          <div style={{ fontSize: 7, color: dimText, lineHeight: 1, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {progressionEnabled ? progressionLabel(overrides) : 'Chord'}
          </div>
          <div style={{ fontSize: 9, fontWeight: 800, color: accent, lineHeight: 1.2 }}>{chordLabel}</div>
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
        {[0, 1, 2, 3].map(i => {
          const midi = noteValue(i)
          const isOverridden = ARP_STEP_KEYS[i] in (overrides as Record<string, unknown>)
          return (
            <div
              key={i}
              title={`Step ${i + 1}: ${midiToNoteName(midi)} (MIDI ${midi})\nScroll to change, click to preview`}
              onClick={() => handleClick(i)}
              onWheel={e => handleWheel(e, i)}
              onContextMenu={e => { e.preventDefault(); handleReset(e, i) }}
              style={{
                position: 'relative',
                borderRadius: 4,
                border: `0.5px solid ${isOverridden ? accent : accent + '44'}`,
                background: isOverridden ? `${accent}22` : `${accent}0e`,
                padding: '3px 2px',
                cursor: 'pointer',
                userSelect: 'none',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 7.5, color: dimText, lineHeight: 1, marginBottom: 1 }}>
                {i + 1}
              </div>
              <div style={{ fontSize: 9, fontWeight: 700, color: isOverridden ? accent : dimText, lineHeight: 1 }}>
                {midiToNoteName(midi)}
              </div>
            </div>
          )
        })}
      </div>
      )}
      <div style={{ fontSize: 7, color: dimText, marginTop: 3, lineHeight: 1.3 }}>
        {progressionEnabled ? 'progression: advances by degree' : playMode === 'chord' ? 'click: preview · expand: edit chord' : 'scroll: ±1st · click: preview · right-click: reset'}
      </div>
    </div>
  )
}

function ArpeggioExpanded({ bodyId, slotKey, simple, onClose }: { bodyId: string | null; slotKey: string; simple: boolean; onClose?: () => void }) {
  const isNoteSlot = slotKey === 'g:note' || slotKey.endsWith(':note')
  const overrides = useControlSetStore(s => s.rackParamOverrides[slotKey] ?? EMPTY_PARAM_OVERRIDES)
  const setSlotOverride = useControlSetStore(s => s.setSlotOverride)
  const resetSlotParam = useControlSetStore(s => s.resetSlotParam)
  const conductorKey = useUniversalConductorStore(s => s.key)
  const conductorScale = useUniversalConductorStore(s => s.scale)
  const accent = '#f59e0b'
  const dim = simple ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.38)'
  const dim2 = simple ? 'rgba(0,0,0,0.64)' : 'rgba(255,255,255,0.64)'
  const border = simple ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)'
  const panel = simple ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.04)'
  const playMode = String(getArpParam(overrides, 'arpPlayMode', 'arp'))
  const progressionEnabled = Boolean(getArpParam(overrides, 'arpChordProgressionEnabled', false))
  const progression = String(getArpParam(overrides, 'arpChordProgression', '1 2 5 7'))
  const scaleMode = String(getArpParam(overrides, 'arpChordScaleMode', 'major'))
  const rootPc = Math.max(0, Math.min(11, Math.round(Number(getArpParam(overrides, 'arpChordRoot', 0)))))
  const quality = String(getArpParam(overrides, 'arpChordQuality', 'Maj7'))
  const octave = Math.max(0, Math.min(8, Math.round(Number(getArpParam(overrides, 'arpChordOctave', 3)))))
  const inversion = Math.max(0, Math.min(3, Math.round(Number(getArpParam(overrides, 'arpChordInversion', 0)))))
  const chordNotes = buildRackChordNotes(overrides)
  const progressionPreview = parseRackProgression(progression).slice(0, 8).map((_, i) => buildRackProgressionChordNotes(overrides, i))
  const chordPcs = new Set(chordNotes.map(n => n % 12))
  const stepNotes = ARP_STEP_KEYS.map((key, i) => Number(getArpParam(overrides, key, [48, 52, 55, 59][i])))
  const keyChordMap = buildKeyChordMap(conductorKey, conductorScale, octave)

  const useSeq = Boolean(getArpParam(overrides, 'arpUseSeq', false))
  const seqSteps = parseChordSeq(getArpParam(overrides, 'arpChordSeq', '[]'))

  const setNum = (key: string, value: number) => setSlotOverride(slotKey, { [key]: value } as Partial<PlanetSimParams>)
  const setStr = (key: string, value: string) => setSlotOverride(slotKey, { [key]: value } as Partial<PlanetSimParams>)
  const setBool = (key: string, value: boolean) => setSlotOverride(slotKey, { [key]: value } as Partial<PlanetSimParams>)

  function updateSeq(next: ChordSeqStep[]) {
    setSlotOverride(slotKey, { arpChordSeq: stringifyChordSeq(next) } as Partial<PlanetSimParams>)
  }
  function seqAddStep() {
    // Read fresh from store to avoid stale closure
    const current = parseChordSeq(useControlSetStore.getState().rackParamOverrides[slotKey]?.arpChordSeq ?? '[]')
    const last = current[current.length - 1] ?? { root: 0, quality: 'Maj7', inv: 0, oct: 3, beats: 4 }
    updateSeq([...current, { ...last }])
  }
  function seqRemoveStep(i: number) {
    updateSeq(seqSteps.filter((_, idx) => idx !== i))
  }
  function seqUpdateStep(i: number, patch: Partial<ChordSeqStep>) {
    updateSeq(seqSteps.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  }

  function preview(notes: number[]) {
    const tgt = bodyId || usePlanetStore.getState().selectedBodyId
    if (!tgt) return
    const body = usePlanetStore.getState().bodies.find(b => b.id === tgt)
    notes.forEach(midi => {
      sendMidiNote(body?.midiChannel ?? 1, midi, body?.midiVelocity ?? 100, 350)
      fireBodyInstrumentTrigger(tgt, 1, midi)
    })
    markBodyTriggered(tgt)
  }

  function applyChordToSteps() {
    const patch: Partial<PlanetSimParams> = {
      arpLength: Math.min(4, chordNotes.length),
      arpNote0: chordNotes[0] ?? 48,
      arpNote1: chordNotes[1] ?? chordNotes[0] ?? 52,
      arpNote2: chordNotes[2] ?? chordNotes[1] ?? 55,
      arpNote3: chordNotes[3] ?? chordNotes[2] ?? 59,
    }
    setSlotOverride(slotKey, patch)
  }

  const sectionLabel = (label: string) => (
    <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>{label}</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
    {/* Inner header */}
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 12px 4px 48px', borderBottom:`0.5px solid ${border}`, flexShrink:0 }}>
      {onClose && <button onClick={onClose} style={{ fontSize:9, color:dim, background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', padding:'0 4px' }}>▼ close</button>}
      <span style={{ fontSize:10, fontWeight:700, color:'#f59e0b' }}>♜ Arpeggio</span>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 280px 200px', gap: 14, padding: '12px 14px 12px 48px', minHeight: 300 }}>
      <div style={{ borderRight: `0.5px solid ${border}`, paddingRight: 14 }}>
        {sectionLabel('Mode')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 12 }}>
          {(['arp', 'chord'] as const).map(mode => (
            <button key={mode} onClick={() => setStr('arpPlayMode', mode)} style={{
              fontSize: 10, fontWeight: 800, padding: '7px 8px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
              border: `0.5px solid ${playMode === mode ? accent : border}`,
              background: playMode === mode ? `${accent}22` : panel,
              color: playMode === mode ? accent : dim2,
              textTransform: 'uppercase',
            }}>{mode}</button>
          ))}
        </div>

        {sectionLabel('Current Key')}
        <div style={{
          marginBottom: 12,
          padding: '7px 8px',
          borderRadius: 5,
          border: `0.5px solid ${accent}55`,
          background: `${accent}0c`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 5 }}>
            <strong style={{ fontSize: 10, color: accent }}>
              {CONDUCTOR_NOTE_NAMES[conductorKey]} {conductorScale}
            </strong>
            {keyChordMap && (
              <button
                onClick={() => setSlotOverride(slotKey, {
                  arpChordRoot: conductorKey,
                  arpChordScaleMode: conductorScale,
                } as Partial<PlanetSimParams>)}
                style={{
                  border: `0.5px solid ${accent}66`,
                  borderRadius: 4,
                  background: `${accent}18`,
                  color: accent,
                  fontSize: 8,
                  fontWeight: 800,
                  padding: '3px 5px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                このキーを適用
              </button>
            )}
          </div>
          <div style={{ fontSize: 8, color: dim, lineHeight: 1.35 }}>
            {keyChordMap
              ? keyChordMap.map(chord => `${chord.degree} ${chord.name}`).join(' · ')
              : 'Arpeggioのコード生成は現在 major / minor に対応しています。'}
          </div>
        </div>

        {sectionLabel('Progression')}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: dim2, marginBottom: 7 }}>
          <input
            type="checkbox"
            checked={progressionEnabled}
            onChange={e => setBool('arpChordProgressionEnabled', e.target.checked)}
            style={{ accentColor: accent }}
          />
          degree progression
        </label>
        <input
          value={progression}
          onChange={e => setStr('arpChordProgression', e.target.value)}
          placeholder="1 2 5 7"
          style={{
            width: '100%',
            fontSize: 11,
            color: dim2,
            background: panel,
            border: `0.5px solid ${progressionEnabled ? accent + '66' : border}`,
            borderRadius: 4,
            padding: '5px 7px',
            marginBottom: 6,
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 12 }}>
          {(['major', 'minor'] as const).map(mode => (
            <button key={mode} onClick={() => setStr('arpChordScaleMode', mode)} style={{
              fontSize: 9, fontWeight: 800, padding: '5px 7px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
              border: `0.5px solid ${scaleMode === mode ? accent : border}`,
              background: scaleMode === mode ? `${accent}18` : panel,
              color: scaleMode === mode ? accent : dim2,
              textTransform: 'uppercase',
            }}>{mode}</button>
          ))}
        </div>

        {!isNoteSlot && (
          <>
            {sectionLabel('Timing')}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ width: 54, fontSize: 8, color: dim, textAlign: 'right' }}>division</span>
              <select value={String(getArpParam(overrides, 'orbitTriggerDivision', 0.25))}
                onChange={e => setNum('orbitTriggerDivision', Number(e.target.value))}
                style={{ flex: 1, fontSize: 10, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 4, padding: '4px 6px' }}>
                <option value={1}>1/1</option>
                <option value={0.5}>1/2</option>
                <option value={0.25}>1/4</option>
                <option value={0.125}>1/8</option>
                <option value={0.0625}>1/16</option>
              </select>
            </div>
          </>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 54, fontSize: 8, color: dim, textAlign: 'right' }}>length</span>
          <input type="range" min={1} max={4} step={1} value={Number(getArpParam(overrides, 'arpLength', 4))}
            onChange={e => setNum('arpLength', Number(e.target.value))}
            style={{ flex: 1, accentColor: accent }} />
          <span style={{ width: 16, fontSize: 9, color: accent, fontFamily: 'monospace' }}>{Number(getArpParam(overrides, 'arpLength', 4))}</span>
        </div>
      </div>

      <div>
        {sectionLabel('Arp Steps')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(70px, 1fr))', gap: 6, marginBottom: 14, opacity: playMode === 'arp' ? 1 : 0.45 }}>
          {ARP_STEP_KEYS.map((key, i) => {
            const midi = stepNotes[i]
            return (
              <div key={key} onClick={() => preview([midi])} onContextMenu={e => { e.preventDefault(); resetSlotParam(slotKey, key) }} style={{
                border: `0.5px solid ${border}`, borderRadius: 5, background: panel, padding: 7, cursor: 'pointer', minHeight: 56,
              }}>
                <div style={{ fontSize: 8, color: dim, marginBottom: 5 }}>Step {i + 1}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: accent, lineHeight: 1 }}>{midiToNoteName(midi)}</div>
                <input type="range" min={24} max={84} step={1} value={midi}
                  onChange={e => setNum(key, Number(e.target.value))}
                  style={{ width: '100%', accentColor: accent, marginTop: 6 }} />
              </div>
            )
          })}
        </div>
        {sectionLabel('Key Chords')}
        {keyChordMap ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 5, marginBottom: 12 }}>
            {keyChordMap.map(chord => (
              <button
                key={chord.degree}
                onClick={() => preview(chord.notes)}
                title={`${chord.name}: ${chord.notes.map(midiToNoteName).join(' ')}`}
                style={{
                  minWidth: 0,
                  border: `0.5px solid ${border}`,
                  borderRadius: 5,
                  background: panel,
                  color: dim2,
                  padding: '6px 5px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                  <span style={{ fontSize: 8, color: accent, fontWeight: 800 }}>{chord.degree}</span>
                  <span style={{ fontSize: 9, color: dim2, fontWeight: 800 }}>{chord.name}</span>
                </div>
                <div style={{ marginTop: 3, fontSize: 7.5, color: dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {chord.notes.map(midiToNoteName).join(' ')}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ marginBottom: 12, fontSize: 8, color: dim }}>
            major / minorを選ぶとダイアトニックコードを表示します。
          </div>
        )}

        {sectionLabel('Chord')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 8, color: dim }}>root
            <select value={rootPc} onChange={e => setNum('arpChordRoot', Number(e.target.value))}
              style={{ fontSize: 10, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 4, padding: '4px 5px' }}>
              {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 8, color: dim }}>quality
            <select value={quality} onChange={e => setStr('arpChordQuality', e.target.value)}
              style={{ fontSize: 10, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 4, padding: '4px 5px' }}>
              {ARP_CHORD_QUALITIES.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 8, color: dim }}>octave
            <input type="number" min={0} max={8} value={octave} onChange={e => setNum('arpChordOctave', Number(e.target.value))}
              style={{ fontSize: 10, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 4, padding: '4px 5px' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 8, color: dim }}>inv
            <input type="number" min={0} max={3} value={inversion} onChange={e => setNum('arpChordInversion', Number(e.target.value))}
              style={{ fontSize: 10, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 4, padding: '4px 5px' }} />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
          <button onClick={() => preview(chordNotes)} style={{
            border: `0.5px solid ${accent}66`, borderRadius: 5, background: `${accent}18`,
            color: accent, fontSize: 11, fontWeight: 800, padding: '7px 10px', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {chordNotes.map(midiToNoteName).join('  ')}
          </button>
          <button onClick={applyChordToSteps} style={{
            border: `0.5px solid ${border}`, borderRadius: 5, background: panel,
            color: dim2, fontSize: 9, fontWeight: 800, padding: '7px 10px', cursor: 'pointer', fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}>
            use as steps
          </button>
        </div>
        {sectionLabel('Progression Preview')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 5, opacity: progressionEnabled ? 1 : 0.45 }}>
          {progressionPreview.map((notes, i) => (
            <button
              key={i}
              onClick={() => preview(notes)}
              style={{
                border: `0.5px solid ${border}`,
                borderRadius: 5,
                background: panel,
                color: dim2,
                padding: '6px 5px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                minWidth: 0,
              }}
            >
              <div style={{ fontSize: 8, color: accent, fontWeight: 800 }}>{parseRackProgression(progression)[i]}</div>
              <div style={{ fontSize: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{notes.map(midiToNoteName).join(' ')}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Chord Sequence column */}
      <div style={{ borderLeft: `0.5px solid ${border}`, paddingLeft: 14, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          {sectionLabel('Chord Sequence')}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8.5, color: useSeq ? accent : dim2, cursor: 'pointer', marginBottom: 5 }}>
            <input type="checkbox" checked={useSeq} onChange={e => setBool('arpUseSeq', e.target.checked)} style={{ accentColor: accent }} />
            active
          </label>
        </div>
        <div style={{ opacity: useSeq ? 1 : 0.55 }}>
          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '26px 72px 68px 28px 28px 36px 20px', gap: 3, marginBottom: 4, paddingRight: 2 }}>
            {['#', 'Root', 'Quality', 'Inv', 'Oct', 'Beats', ''].map(h => (
              <div key={h} style={{ fontSize: 7.5, color: dim, fontWeight: 700 }}>{h}</div>
            ))}
          </div>
          {seqSteps.map((step, i) => {
            const notes = buildRackChordNotesFrom(step.root, step.oct, step.quality, step.inv)
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '26px 72px 68px 28px 28px 36px 20px', gap: 3, marginBottom: 4, alignItems: 'center' }}>
                <button onClick={() => preview(notes)} style={{
                  fontSize: 8, fontWeight: 800, color: accent, background: `${accent}18`,
                  border: `0.5px solid ${accent}66`, borderRadius: 3, padding: '3px 0', cursor: 'pointer', fontFamily: 'inherit',
                  title: notes.map(midiToNoteName).join(' '),
                }}>▶</button>
                <select value={step.root} onChange={e => seqUpdateStep(i, { root: Number(e.target.value) })}
                  style={{ fontSize: 9, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 3, padding: '2px 3px' }}>
                  {NOTE_NAMES.map((n, pc) => <option key={n} value={pc}>{n}</option>)}
                </select>
                <select value={step.quality} onChange={e => seqUpdateStep(i, { quality: e.target.value })}
                  style={{ fontSize: 9, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 3, padding: '2px 3px' }}>
                  {ARP_CHORD_QUALITIES.map(q => <option key={q} value={q}>{q}</option>)}
                </select>
                <input type="number" min={0} max={3} value={step.inv} onChange={e => seqUpdateStep(i, { inv: Number(e.target.value) })}
                  style={{ fontSize: 9, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 3, padding: '2px 3px', width: '100%' }} />
                <input type="number" min={0} max={8} value={step.oct} onChange={e => seqUpdateStep(i, { oct: Number(e.target.value) })}
                  style={{ fontSize: 9, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 3, padding: '2px 3px', width: '100%' }} />
                <select value={step.beats} onChange={e => seqUpdateStep(i, { beats: Number(e.target.value) })}
                  style={{ fontSize: 9, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 3, padding: '2px 3px' }}>
                  {[1,2,4,8].map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <button onClick={() => seqRemoveStep(i)} style={{
                  fontSize: 10, color: dim, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1,
                }}>×</button>
              </div>
            )
          })}
          {/* Add step + notes preview row */}
          <button onClick={seqAddStep} style={{
            fontSize: 9, color: dim2, background: panel, border: `0.5px solid ${border}`,
            borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit', width: '100%', marginBottom: 6,
          }}>+ Add chord</button>
          {seqSteps.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {seqSteps.map((step, i) => {
                const notes = buildRackChordNotesFrom(step.root, step.oct, step.quality, step.inv)
                return (
                  <div key={i} style={{ fontSize: 8, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 3, padding: '2px 5px' }}>
                    <span style={{ color: accent, fontWeight: 700 }}>{chordSeqLabel(step)}</span>
                    <span style={{ color: dim, marginLeft: 3 }}>{notes.map(midiToNoteName).join(' ')}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div style={{ borderLeft: `0.5px solid ${border}`, paddingLeft: 14 }}>
        {sectionLabel('Geometry')}
        <div style={{ aspectRatio: '1 / 1', maxHeight: 220, margin: '0 auto', position: 'relative' }}>
          <svg viewBox="0 0 220 220" style={{ width: '100%', height: '100%', display: 'block' }}>
            <circle cx="110" cy="110" r="78" fill={panel} stroke={border} strokeWidth="1" />
            <polygon
              points={chordNotes.map(n => {
                const pc = n % 12
                const a = (-Math.PI / 2) + (pc / 12) * Math.PI * 2
                return `${110 + Math.cos(a) * 78},${110 + Math.sin(a) * 78}`
              }).join(' ')}
              fill={`${accent}22`}
              stroke={accent}
              strokeWidth="1.5"
            />
            {NOTE_NAMES.map((name, pc) => {
              const a = (-Math.PI / 2) + (pc / 12) * Math.PI * 2
              const x = 110 + Math.cos(a) * 78
              const y = 110 + Math.sin(a) * 78
              const active = chordPcs.has(pc)
              return (
                <g key={name} onClick={() => setNum('arpChordRoot', pc)} style={{ cursor: 'pointer' }}>
                  <circle cx={x} cy={y} r={active ? 9 : 6} fill={active ? accent : panel} stroke={active ? accent : border} />
                  <text x={110 + Math.cos(a) * 98} y={114 + Math.sin(a) * 98} textAnchor="middle" fontSize="9" fill={active ? accent : dim2}>{name}</text>
                </g>
              )
            })}
          </svg>
        </div>
      </div>
    </div>
    </div>
  )
}

// ── Inline Chord-Test trigger (rendered inside trigger SlotCard) ─────────────

const CHORD_TEST_NOTES: { label: string; midi: number }[] = [
  { label: 'C3', midi: 48 },
  { label: 'E3', midi: 52 },
  { label: 'G3', midi: 55 },
]

function InlineChordTestContent({
  bodyId, simple, accent,
}: { bodyId: string | null; simple: boolean; accent: string }) {
  const [active, setActive] = useState<number | null>(null)
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const dimText = simple ? 'rgba(0,0,0,0.40)' : 'rgba(255,255,255,0.35)'

  function fire(midi: number) {
    // Resolve target body
    const state = usePlanetStore.getState()
    const targetId = bodyId || state.selectedBodyId
    if (!targetId) return

    // 1. Flash trigger indicator
    markBodyTriggered(targetId)

    // 2. MIDI note out
    const body = state.bodies.find(b => b.id === targetId)
    sendMidiNote(body?.midiChannel ?? 1, midi, body?.midiVelocity ?? 100, 500)

    // 3. Try instrument engines that accept specific pitches
    const pitchEng = getBodyOscSynthEngine(targetId)
    if (pitchEng) {
      pitchEng.noteOn(midi, 0.85)
      clearTimeout(timers.current[midi])
      timers.current[midi] = setTimeout(() => pitchEng.noteOff(midi), 800)
    } else {
      // One-shot or other instrument — fire generically
      fireBodyInstrumentTrigger(targetId)
    }

    // Button flash
    setActive(midi)
    clearTimeout(timers.current[-1])
    timers.current[-1] = setTimeout(() => setActive(null), 180)
  }

  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout) }, [])

  return (
    <div style={{ padding: '4px 0 2px', display: 'flex', gap: 5 }}>
      {CHORD_TEST_NOTES.map(({ label, midi }) => (
        <button
          key={midi}
          onClick={() => fire(midi)}
          style={{
            flex: 1, fontSize: 9, fontWeight: 700, padding: '4px 0',
            borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
            border: `0.5px solid ${active === midi ? accent : accent + '55'}`,
            background: active === midi ? `${accent}30` : `${accent}10`,
            color: active === midi ? accent : dimText,
            transition: 'background 0.08s, color 0.08s',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function stableSampleIndexFromBodyId(bodyId: string, length: number): number {
  if (length <= 0) return 0
  let hash = 0
  for (let i = 0; i < bodyId.length; i++) {
    hash = ((hash << 5) - hash + bodyId.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % length
}

function isBuiltinSample(sample: { id: string; source?: string; sourcePath?: string }): boolean {
  return sample.source === 'builtin' || sample.id.startsWith('builtin:') || sample.sourcePath?.startsWith('/samples/') === true
}

// ── Inline One-Shot content (rendered inside SlotCard) ───────────────────────

/**
 * Compact one-shot sampler UI rendered directly inside the instrument SlotCard.
 * Mirrors OneShotSamplerPanel logic but in a narrow inline layout.
 */
function InlineOneShotContent({
  bodyId, slotKey, simple, accent, isStretch, isSamplerStretch, isLongSampler,
}: {
  bodyId: string | null
  slotKey: string
  simple: boolean
  accent: string
  isStretch?: boolean
  /** When true, use StretchSamplerEngine instead of OneShotSamplerEngine */
  isSamplerStretch?: boolean
  isLongSampler?: boolean
}) {
  const samples         = useProjectStore(s => s.project.samples)
  const addSampleAsset  = useProjectStore(s => s.addSampleAsset)
  const overrides       = useControlSetStore(s => s.rackParamOverrides[slotKey] ?? EMPTY_PARAM_OVERRIDES)
  const setSlotOverride = useControlSetStore(s => s.setSlotOverride)
  const resetSlotParam  = useControlSetStore(s => s.resetSlotParam)
  const bodies          = usePlanetStore(s => s.bodies)
  const G               = usePlanetStore(s => s.simParams.G)
  const getBodyEffectiveParams = useControlSetStore(s => s.getBodyEffectiveParams)
  const getBodyTriggerParamsList = useControlSetStore(s => s.getBodyTriggerParamsList)
  const effectiveParams = bodyId ? getBodyEffectiveParams(bodyId) : null
  const triggerParams   = bodyId ? (getBodyTriggerParamsList(bodyId)[0] ?? null) : null

  const dimText   = simple ? 'rgba(0,0,0,0.32)' : 'rgba(255,255,255,0.28)'
  const accentDim = simple ? 'rgba(6,182,212,0.10)' : 'rgba(6,182,212,0.12)'
  const inputBg   = simple ? 'rgba(0,0,0,0.04)'  : 'rgba(255,255,255,0.05)'
  const inputCol  = simple ? '#333'               : '#e0e0e0'
  const borderCol = simple ? 'rgba(0,0,0,0.10)'  : 'rgba(255,255,255,0.10)'

  // ── Resolved sample ─────────────────────────────────────────────────────────
  const samplerMode = (overrides as Record<string, unknown>).samplerMode as string ?? 'auto'
  const fixedId     = (overrides as Record<string, unknown>).samplerSampleId as string | null ?? null
  const body        = usePlanetStore(s => bodyId ? (s.bodies.find(b => b.id === bodyId) ?? null) : null)
  const sample      = samplerMode === 'fixed'
    ? (fixedId ? (samples.find(s => s.id === fixedId) ?? null) : null)
    : (bodyId && samples.length > 0 ? samples[stableSampleIndexFromBodyId(bodyId, samples.length)] ?? null : null)

  // ── Stretch info (only for instrument-oneshot-stretch) ──────────────────────
  const targetExpression = String((effectiveParams as Record<string, unknown> | null)?.sampleTargetExpression ?? 'T')
  const stretchSourceBody = isSamplerStretch && body
    ? resolveOrbitDurationSource(targetExpression, body, bodies).body
    : body
  const stretchSourceMultiplier = isSamplerStretch && body
    ? resolveOrbitDurationSource(targetExpression, body, bodies).multiplier
    : 1
  const orbitStats  = isStretch && stretchSourceBody ? computeOrbitStats(stretchSourceBody, bodies, G) : null
  const tRealSec    = orbitStats?.T_real ?? null
  // bufferDuration read inline — re-evaluated on each render triggered by engState changes
  const bufDurSec   = isStretch && bodyId
    ? (isSamplerStretch
        ? (getBodyStretchSamplerEngine(bodyId)?.bufferDuration ?? 0)
        : (getBodyOneShotEngine(bodyId)?.bufferDuration ?? 0))
    : isLongSampler && bodyId
      ? (getBodyLongSamplerEngine(bodyId)?.bufferDuration ?? 0)
      : 0
  const sourceDiv    = Math.max(0.0625, Number((triggerParams as Record<string, unknown> | null)?.orbitTriggerDivision ?? 1))
  const sourceSec    = tRealSec !== null ? tRealSec * (isSamplerStretch ? stretchSourceMultiplier : sourceDiv) : null
  const loopNumer    = Math.max(1, Number((effectiveParams as Record<string, unknown> | null)?.orbitLoopNumer ?? 1))
  const loopDenom    = Math.max(1, Number((effectiveParams as Record<string, unknown> | null)?.orbitLoopDenom ?? 1))
  const stretchRatio = loopNumer / loopDenom
  const shownTarget  = sourceSec !== null ? sourceSec * stretchRatio : null
  const shownRate    = bufDurSec > 0 && shownTarget !== null && shownTarget > 0 ? (bufDurSec / shownTarget) : null

  // ── Engine state + playhead (RAF, no React state for 60fps) ─────────────────
  const [engState, setEngState] = useState<OneShotState>('idle')
  const [loading, setLoading]   = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const playheadRef  = useRef<HTMLDivElement>(null)
  const progressRef  = useRef<HTMLDivElement>(null)
  const rafRef       = useRef(0)

  useEffect(() => {
    const tick = () => {
      if (bodyId) {
        const eng = isSamplerStretch
          ? getBodyStretchSamplerEngine(bodyId)
          : isLongSampler
            ? getBodyLongSamplerEngine(bodyId)
            : getBodyOneShotEngine(bodyId)
        if (eng) {
          setEngState(eng.state as OneShotState)
          const norm = eng.getPlayheadNorm()
          if (playheadRef.current) {
            if (norm !== null) {
              playheadRef.current.style.left       = `${norm * 100}%`
              playheadRef.current.style.visibility = 'visible'
            } else {
              playheadRef.current.style.visibility = 'hidden'
            }
          }
          if (progressRef.current) {
            if (norm !== null) {
              progressRef.current.style.width      = `${norm * 100}%`
              progressRef.current.style.visibility = 'visible'
            } else {
              progressRef.current.style.width      = '0%'
              progressRef.current.style.visibility = 'hidden'
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [bodyId, isLongSampler, isSamplerStretch])

  // ── Drag-and-drop / file picker ─────────────────────────────────────────────
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadFile = useCallback(async (file: File) => {
    const AUDIO_EXT = /\.(wav|mp3|ogg|aiff?|flac|m4a|aac)$/i
    if (!file.type.startsWith('audio/') && !file.name.match(AUDIO_EXT)) {
      setLoadError('Audio files only')
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const objectUrl = URL.createObjectURL(file)
      const newSample = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ''),
        objectUrl,
        fileType: file.type || 'audio/unknown',
        sourcePath: file.name,
        source: 'local' as const,
      }
      addSampleAsset(newSample)
      setSlotOverride(slotKey, { samplerMode: 'fixed', samplerSampleId: newSample.id } as Partial<PlanetSimParams>)
    } catch {
      setLoadError('Load failed')
    } finally {
      setLoading(false)
    }
  }, [addSampleAsset, slotKey, setSlotOverride])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
  }
  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) loadFile(file)
    e.target.value = ''
  }

  const isPlaying = engState === 'playing'
  const isLoading = engState === 'loading' || loading

  function randomReassignSample() {
    const playable = samples.filter(candidate => Boolean(candidate.objectUrl))
    if (playable.length === 0) return
    const alternatives = fixedId && playable.length > 1
      ? playable.filter(candidate => candidate.id !== fixedId)
      : playable
    const next = alternatives[Math.floor(Math.random() * alternatives.length)]
    if (!next) return
    setSlotOverride(slotKey, {
      samplerType: 'sampler',
      samplerMode: 'fixed',
      samplerSampleId: next.id,
    } as Partial<PlanetSimParams>)
  }

  // ── Source selector row (always visible) ────────────────────────────────────
  const srcSelector = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <span style={{ fontSize: 7, color: dimText, flexShrink: 0 }}>src</span>
      <select
        value={samplerMode}
        onChange={e => setSlotOverride(slotKey, { samplerMode: e.target.value } as Partial<PlanetSimParams>)}
        style={{
          flex: 1, fontSize: 7.5, border: `0.5px solid ${borderCol}`,
          borderRadius: 3, padding: '1px 2px',
          background: inputBg, color: inputCol, fontFamily: 'inherit',
        }}
      >
        <option value="auto">Auto (hash)</option>
        <option value="fixed">Fixed file</option>
      </select>
      {(isSamplerStretch || isLongSampler) && (
        <button
          onClick={randomReassignSample}
          disabled={!samples.some(candidate => Boolean(candidate.objectUrl))}
          title="Randomly reassign a loaded sample"
          style={{
            width: 18,
            height: 18,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            padding: 0,
            borderRadius: 3,
            border: `0.5px solid ${borderCol}`,
            background: inputBg,
            color: accent,
            cursor: samples.some(candidate => Boolean(candidate.objectUrl)) ? 'pointer' : 'default',
            opacity: samples.some(candidate => Boolean(candidate.objectUrl)) ? 1 : 0.35,
            fontSize: 11,
            fontFamily: 'inherit',
          }}
        >
          ↻
        </button>
      )}
      {samplerMode === 'fixed' && fixedId && (
        <button
          onClick={() => resetSlotParam(slotKey, 'samplerSampleId')}
          style={{ fontSize: 7, color: dimText, background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px', flexShrink: 0 }}
        >×</button>
      )}
    </div>
  )

  if (!sample) {
    // ── No sample: compact drop zone + src selector ───────────────────────────
    return (
      <>
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 3,
            border: `1.5px dashed ${dragOver ? accent : borderCol}`,
            borderRadius: 5, padding: '8px 4px', cursor: 'pointer',
            background: dragOver ? accentDim : 'transparent',
            transition: 'border-color 0.12s, background 0.12s',
          }}
        >
          <span style={{ fontSize: 18, opacity: 0.4 }}>♫</span>
          <span style={{ fontSize: 8, color: dimText, fontWeight: 600, textAlign: 'center' }}>
            {isLoading ? 'Loading…' : 'Drop audio here'}
          </span>
          <span style={{ fontSize: 7, color: dimText, opacity: 0.6 }}>wav · mp3 · ogg · aiff</span>
          {loadError && <span style={{ fontSize: 7, color: '#ef4444' }}>{loadError}</span>}
        </div>
        {srcSelector}
        <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleFileInput} />
      </>
    )
  }

  // ── Sample loaded: name + playhead + source selector ──────────────────────
  return (
    <>
      {/* Sample name row (click to replace) */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 4px', borderRadius: 4,
          background: dragOver ? accentDim : inputBg,
          cursor: 'pointer', transition: 'background 0.1s',
          border: `0.5px solid ${dragOver ? accent : borderCol}`,
        }}
      >
        <span style={{ fontSize: 8, color: accent }}>▶</span>
        <span style={{ fontSize: 8.5, color: inputCol, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sample.name}
        </span>
        {/* State indicator */}
        <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.04em', color: isPlaying ? '#22c55e' : dimText, flexShrink: 0 }}>
          {isPlaying ? '●' : '○'}
        </span>
      </div>

      {/* Playhead bar */}
      <div style={{
        position: 'relative', height: 8, borderRadius: 3, overflow: 'visible',
        background: simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)',
        margin: '1px 0',
      }}>
        {/* Progress fill */}
        <div
          ref={progressRef}
          style={{
            position: 'absolute', top: 0, left: 0, height: '100%',
            width: '0%', borderRadius: 3,
            background: simple ? 'rgba(6,182,212,0.25)' : 'rgba(6,182,212,0.30)',
            pointerEvents: 'none', zIndex: 1,
            visibility: 'hidden',
          }}
        />
        {/* Playhead needle */}
        <div
          ref={playheadRef}
          style={{
            position: 'absolute', top: -2, bottom: -1,
            left: '0%', transform: 'translateX(-50%)',
            width: 2, background: '#fbbf24',
            boxShadow: '0 0 4px #fbbf2488',
            pointerEvents: 'none', zIndex: 4,
            visibility: 'hidden',
          }}
        />
      </div>

      {/* Stretch info row — original duration + Orbit Step source interval */}
      {isStretch && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 2px' }}>
          <span style={{ fontSize: 7, color: dimText, flexShrink: 0 }}>orig</span>
          <span style={{ fontSize: 8, color: inputCol, fontFamily: 'monospace', fontWeight: 600 }}>
            {bufDurSec > 0 ? `${bufDurSec.toFixed(2)}s` : '—'}
          </span>
          <span style={{ fontSize: 7, color: dimText, flexShrink: 0, marginLeft: 4 }}>src</span>
          <span style={{ fontSize: 8, color: accent, fontFamily: 'monospace', fontWeight: 600 }}>
            {sourceSec !== null ? `${sourceSec.toFixed(2)}s` : '—'}
          </span>
          {shownRate !== null && (
            <>
              <span style={{ fontSize: 7, color: dimText, flexShrink: 0, marginLeft: 4 }}>×</span>
              <span style={{ fontSize: 8, color: '#a78bfa', fontFamily: 'monospace', fontWeight: 600 }}>
                {shownRate.toFixed(2)}
              </span>
            </>
          )}
        </div>
      )}

      {/* Source selector row */}
      {srcSelector}

      {loadError && <span style={{ fontSize: 7, color: '#ef4444' }}>{loadError}</span>}
      <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleFileInput} />
    </>
  )
}

/** Live orbit-computed values for one body. Subscribes at physics rate. */
function OrbitDroneBlock({ bodyId, dimText }: { bodyId: string | null; dimText: string }) {
  const bodies = usePlanetStore(s => s.bodies)
  const G      = usePlanetStore(s => s.simParams.G)

  const body = bodyId ? (bodies.find(b => b.id === bodyId) ?? null) : null
  const op: OrbitParams | null = body ? computeOrbitDroneParams(body, bodies, G) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1.5, padding: '3px 0 1px' }}>
      {/* orbit badge */}
      <div style={{
        fontSize: 6.5, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase',
        color: '#7c3aed', marginBottom: 3,
      }}>◎ orbit</div>

      {!body && (
        <div style={{ fontSize: 7.5, color: dimText, fontStyle: 'italic' }}>select a body</div>
      )}

      {body && ORBIT_PARAM_ROWS.map(row => (
        <div key={row.paramKey} style={{ display: 'flex', alignItems: 'center', gap: 3, minHeight: 15 }}>
          {/* param label */}
          <span style={{
            fontSize: 7.5, color: dimText, width: 42, flexShrink: 0,
            textAlign: 'right', letterSpacing: '0.02em', lineHeight: 1,
          }}>
            {row.label}
          </span>
          {/* live value */}
          <span style={{
            fontSize: 8.5, fontFamily: 'monospace', color: '#7c3aed',
            minWidth: 44, textAlign: 'right', flexShrink: 0,
          }}>
            {op ? row.fmt(op[row.paramKey]) : '—'}
          </span>
          {/* driver description */}
          <span style={{
            fontSize: 6, color: dimText, opacity: 0.65,
            lineHeight: 1.2, overflow: 'hidden',
          }}>
            {row.driver}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Trigger → Instrument signal bridge ───────────────────────────────────────

const SIGNAL_FADE_MS = 380
const MIDI_FADE_MS   = 480

/**
 * Narrow column between Trigger and Instrument rack sections.
 * Shows: trigger-fired flash (amber) + MIDI OUT sent (cyan) + MIDI IN received (green).
 */
function TriggerSignalBridge({ bodyId, simple }: { bodyId: string | null; simple: boolean }) {
  const [trigOp,  setTrigOp]  = useState(0)
  const [midiOut, setMidiOut] = useState(0)
  const [midiIn,  setMidiIn]  = useState(0)
  const [midiOutLabel, setMidiOutLabel] = useState('')
  const [midiInLabel,  setMidiInLabel]  = useState('')

  useEffect(() => {
    const id = window.setInterval(() => {
      // Trigger flash
      if (bodyId) {
        const age = getBodyTriggerAge(bodyId)
        setTrigOp(isFinite(age) ? Math.max(0, 1 - age / SIGNAL_FADE_MS) : 0)
      } else {
        setTrigOp(0)
      }
      // MIDI OUT flash (global — any MIDI note sent)
      setMidiOut(Math.max(0, 1 - getMidiSendAge()   / MIDI_FADE_MS))
      // MIDI IN flash (global — any MIDI note received)
      setMidiIn( Math.max(0, 1 - getMidiReceiveAge() / MIDI_FADE_MS))
      const out = getLastMidiSendInfo()
      const input = getLastMidiReceiveInfo()
      setMidiOutLabel(out ? `${out.name} ch${out.ch} v${out.vel}` : '')
      setMidiInLabel(input ? `${input.name} ch${input.ch} v${input.vel}` : '')
    }, 16)
    return () => window.clearInterval(id)
  }, [bodyId])

  const trigCol  = '#f59e0b'   // amber
  const outCol   = '#22d3ee'   // cyan  — MIDI OUT
  const inCol    = '#4ade80'   // green — MIDI IN
  const dimText  = simple ? 'rgba(0,0,0,0.25)'  : 'rgba(255,255,255,0.20)'
  const divLine  = simple ? 'rgba(0,0,0,0.07)'  : 'rgba(255,255,255,0.06)'
  const midiReady = isMidiReady()

  const isTrig    = trigOp  > 0.04
  const isOut     = midiOut > 0.04
  const isIn      = midiIn  > 0.04
  const activeMidiLabel = isOut && midiOutLabel ? `OUT ${midiOutLabel}` : isIn && midiInLabel ? `IN ${midiInLabel}` : midiOutLabel ? `last OUT ${midiOutLabel}` : midiInLabel ? `last IN ${midiInLabel}` : 'No MIDI signal yet'
  const bridgeTitle = `Trigger signal\n${activeMidiLabel}`

  return (
    <>
      {/* Left 1px border */}
      <div style={{ width: 1, background: divLine, margin: '6px 0', flexShrink: 0 }} />

      <div style={{
        width: 42, flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 3, padding: '6px 2px',
        background: isTrig ? `rgba(245,158,11,${(0.015 + trigOp * 0.05).toFixed(3)})` : 'transparent',
        transition: 'background 0.08s',
      }}
        title={bridgeTitle}
      >
        {/* Signal arrow */}
        <span style={{
          fontSize: 7, lineHeight: 1, color: isTrig ? trigCol : dimText,
          opacity: 0.45 + trigOp * 0.55, transition: 'color 0.04s',
        }}>→</span>

        {/* Main trigger LED */}
        <div style={{
          width: 9, height: 9, borderRadius: '50%',
          background: isTrig ? trigCol : 'transparent',
          border: `1px solid ${isTrig ? trigCol : dimText + '55'}`,
          boxShadow: isTrig ? `0 0 ${Math.round(trigOp * 9)}px ${trigCol}` : 'none',
          opacity: 0.18 + trigOp * 0.82,
          transition: 'all 0.04s',
          flexShrink: 0,
        }} />

        {/* Divider */}
        <div style={{ width: 20, height: 0.5, background: divLine, margin: '1px 0' }} />

        {/* MIDI OUT row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: 5.5, fontWeight: 800, letterSpacing: '0.05em', color: midiReady ? (isOut ? outCol : outCol + '55') : dimText, lineHeight: 1 }}>OUT</span>
          <div style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: isOut ? outCol : 'transparent',
            border: `1px solid ${isOut ? outCol : (midiReady ? outCol + '44' : dimText + '33')}`,
            boxShadow: isOut ? `0 0 ${Math.round(midiOut * 7)}px ${outCol}` : 'none',
            opacity: midiReady ? (0.2 + midiOut * 0.8) : 0.25,
            transition: 'all 0.04s',
          }} />
        </div>
        {midiOutLabel && (
          <div style={{
            maxWidth: 38,
            fontSize: 5.5,
            lineHeight: 1,
            fontWeight: 800,
            color: isOut ? outCol : outCol + '66',
            opacity: isOut ? 0.95 : 0.45,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textAlign: 'center',
          }}>
            {midiOutLabel.split(' ')[0]}
          </div>
        )}

        {/* MIDI IN row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: 5.5, fontWeight: 800, letterSpacing: '0.05em', color: midiReady ? (isIn ? inCol : inCol + '55') : dimText, lineHeight: 1 }}>IN</span>
          <div style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: isIn ? inCol : 'transparent',
            border: `1px solid ${isIn ? inCol : (midiReady ? inCol + '44' : dimText + '33')}`,
            boxShadow: isIn ? `0 0 ${Math.round(midiIn * 7)}px ${inCol}` : 'none',
            opacity: midiReady ? (0.2 + midiIn * 0.8) : 0.25,
            transition: 'all 0.04s',
          }} />
        </div>
        {midiInLabel && (
          <div style={{
            maxWidth: 38,
            fontSize: 5.5,
            lineHeight: 1,
            fontWeight: 800,
            color: isIn ? inCol : inCol + '66',
            opacity: isIn ? 0.95 : 0.45,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textAlign: 'center',
          }}>
            {midiInLabel.split(' ')[0]}
          </div>
        )}

        {/* Arrow */}
        <span style={{
          fontSize: 7, lineHeight: 1, color: isTrig ? trigCol : dimText,
          opacity: 0.45 + trigOp * 0.55, transition: 'color 0.04s',
        }}>→</span>

        {/* MIDI label (vertical, bottom) */}
        <div style={{
          marginTop: 2,
          fontSize: 5.5, fontWeight: 800, letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: midiReady ? (isOut || isIn ? outCol : dimText) : dimText,
          writingMode: 'vertical-rl', transform: 'rotate(180deg)',
          lineHeight: 1, opacity: midiReady ? 0.7 : 0.3,
        }}>midi</div>
      </div>

      {/* Right 1px border */}
      <div style={{ width: 1, background: divLine, margin: '6px 0', flexShrink: 0 }} />
    </>
  )
}

// ── Instrument → Effector signal monitor ─────────────────────────────────────

/**
 * Narrow monitor column between Instrument and Effects rack sections.
 * Lights up when the body's instruments are producing output, indicating
 * that signal is being routed into the body's own effector.
 */
function InstrumentEffectorBridge({ bodyId, simple }: { bodyId: string | null; simple: boolean }) {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      if (bodyId) {
        setLevel(getBodyOutputLevel(bodyId))
      } else {
        setLevel(0)
      }
    }, 30)
    return () => window.clearInterval(id)
  }, [bodyId])

  const sigCol   = '#a78bfa'  // violet — instrument → effect path
  const dimText  = simple ? 'rgba(0,0,0,0.22)'  : 'rgba(255,255,255,0.18)'
  const divLine  = simple ? 'rgba(0,0,0,0.07)'  : 'rgba(255,255,255,0.06)'
  const isActive = level > 0.03

  return (
    <>
      {/* Left 1px border */}
      <div style={{ width: 1, background: divLine, margin: '6px 0', flexShrink: 0 }} />

      <div style={{
        width: 28, flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 4, padding: '6px 2px',
        background: isActive ? `rgba(167,139,250,${(0.01 + level * 0.07).toFixed(3)})` : 'transparent',
        transition: 'background 0.12s',
      }}>
        {/* Signal arrow */}
        <span style={{
          fontSize: 7, lineHeight: 1,
          color: isActive ? sigCol : dimText,
          opacity: 0.4 + level * 0.6, transition: 'color 0.06s',
        }}>→</span>

        {/* Level LED */}
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: isActive ? sigCol : 'transparent',
          border: `1px solid ${isActive ? sigCol : dimText + '44'}`,
          boxShadow: isActive ? `0 0 ${Math.round(level * 10)}px ${sigCol}` : 'none',
          opacity: 0.15 + level * 0.85,
          transition: 'all 0.06s',
          flexShrink: 0,
        }} />

        {/* FX label (vertical) */}
        <div style={{
          fontSize: 5, fontWeight: 800, letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: isActive ? sigCol : dimText,
          writingMode: 'vertical-rl', transform: 'rotate(180deg)',
          lineHeight: 1, opacity: isActive ? 0.75 : 0.35,
          transition: 'color 0.06s',
          marginTop: 2,
        }}>fx</div>
      </div>

      {/* Right 1px border */}
      <div style={{ width: 1, background: divLine, margin: '6px 0', flexShrink: 0 }} />
    </>
  )
}

// ── Slot card (filled) ────────────────────────────────────────────────────────

// ── Wave Lab expanded panel ───────────────────────────────────────────────────

const WAV_SIGS = ['x','y','r','angle','speed'] as const
const WAV_SIG_COLORS: Record<string, string> = { x:'#60a5fa', y:'#34d399', r:'#a78bfa', angle:'#fbbf24', speed:'#f87171' }
const WAV_SIG_LABELS: Record<string, string> = { x:'X', y:'Y', r:'r', angle:'θ', speed:'spd' }

function WaveLabOscillo({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef(0)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const maybeContext = canvas.getContext('2d'); if (!maybeContext) return
    const context: CanvasRenderingContext2D = maybeContext
    const W = canvas.width, H = canvas.height
    const activeAnalyser = analyser
    let buf = activeAnalyser ? new Float32Array(activeAnalyser.fftSize) : null
    function draw() {
      rafRef.current = requestAnimationFrame(draw)
      context.clearRect(0,0,W,H)
      context.fillStyle = 'rgba(255,255,255,0.03)'; context.fillRect(0,0,W,H)
      context.strokeStyle = 'rgba(255,255,255,0.07)'; context.lineWidth = 0.5
      context.beginPath(); context.moveTo(0,H/2); context.lineTo(W,H/2); context.stroke()
      if (!activeAnalyser || !buf) {
        context.fillStyle='rgba(255,255,255,0.2)'; context.font='8px sans-serif'; context.textAlign='center'
        context.fillText('no signal', W/2, H/2+3); return
      }
      const frameBuf = buf.length === activeAnalyser.fftSize
        ? buf
        : new Float32Array(activeAnalyser.fftSize)
      buf = frameBuf
      activeAnalyser.getFloatTimeDomainData(frameBuf)
      context.beginPath(); context.strokeStyle='#34d399'; context.lineWidth=1.5; context.lineJoin='round'
      frameBuf.forEach((v,i) => {
        const px = (i/(frameBuf.length-1))*W, py = (0.5-v*0.45)*H
        if (i === 0) context.moveTo(px,py)
        else context.lineTo(px,py)
      })
      context.stroke()
    }
    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [analyser])
  return <canvas ref={canvasRef} width={360} height={120} style={{width:'100%',height:'100%',display:'block'}} />
}

const ORBIT_SOURCES = ['manual','period','eccentricity','distance','velocity','speed','acceleration','bound'] as const
const ORBIT_SRC_LABELS: Record<string,string> = { manual:'man', period:'T', eccentricity:'ecc', distance:'r', velocity:'v', speed:'spd', acceleration:'acc', bound:'B' }
const LFO_TARGETS = ['off','pitch','filter','amplitude'] as const
const LFO_TARGET_LABELS: Record<string,string> = { off:'Off', pitch:'Pitch', filter:'Filt', amplitude:'Amp' }
const LFO_WAVES = ['sine','triangle','sawtooth','square'] as const
const LFO_WAVE_LABELS: Record<string,string> = { sine:'Sine', triangle:'Tri', sawtooth:'Saw', square:'Sq' }

function circularRackOscilloscopePath(cx: number, cy: number, radius: number, amp: number, data: Float32Array): string {
  if (data.length < 2) return ''
  const total = 64
  const values = Array.from({ length: total }, (_, i) => {
    const idx = Math.floor((i / total) * data.length)
    return Math.max(-1, Math.min(1, data[idx] || 0))
  })
  let seam = 0
  let bestJump = Infinity
  for (let i = 0; i < total; i++) {
    const jump = Math.abs(values[i] - values[(i + 1) % total])
    if (jump < bestJump) {
      bestJump = jump
      seam = i
    }
  }
  let d = ''
  for (let i = 0; i <= total; i++) {
    const a = (i / total) * Math.PI * 2 - Math.PI / 2
    const v = values[(seam + 1 + i) % total]
    const r = radius + v * amp
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`
  }
  return d
}

function waveLabOrbitValue(
  src: string,
  manual: number,
  stats: ReturnType<typeof computeOrbitStats>,
  rate: number,
  min: number,
  max: number,
): number {
  if (src === 'manual' || !stats) return manual
  let raw: number
  switch (src) {
    case 'period':       raw = stats.T_real * rate; break
    case 'eccentricity': raw = stats.ecc    * rate; break
    case 'distance':     raw = stats.r      * rate; break
    case 'velocity':
    case 'speed':        raw = stats.speed  * rate; break
    case 'acceleration': raw = stats.acc    * rate; break
    case 'bound':        raw = (stats.bound ? 1 : 0) * rate; break
    default: return manual
  }
  if (!isFinite(raw)) return manual
  return Math.max(min, Math.min(max, raw))
}

function lfoWaveValue(waveform: string, phase: number): number {
  const p = ((phase % 1) + 1) % 1
  switch (waveform) {
    case 'triangle':
      return 1 - 4 * Math.abs(p - 0.5)
    case 'sawtooth':
      return 2 * p - 1
    case 'square':
      return p < 0.5 ? 1 : -1
    case 'sine':
    default:
      return Math.sin(p * Math.PI * 2)
  }
}

function WaveLabLfoPreview({
  waveform, rate, depth, active, simple,
}: {
  waveform: string
  rate: number
  depth: number
  active: boolean
  simple: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    const accent = '#a78bfa'
    const grid = simple ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.08)'
    const bg = simple ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.035)'
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    ctx.strokeStyle = grid
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(0, H / 2)
    ctx.lineTo(W, H / 2)
    for (let i = 1; i < 4; i++) {
      const x = (i / 4) * W
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
    }
    ctx.stroke()

    const amp = Math.max(0.02, Math.min(1, depth)) * 0.42
    ctx.beginPath()
    ctx.strokeStyle = active ? accent : (simple ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.22)')
    ctx.lineWidth = active ? 1.6 : 1
    ctx.lineJoin = 'round'
    for (let i = 0; i < W; i++) {
      const ph = i / Math.max(1, W - 1)
      const y = (0.5 - lfoWaveValue(waveform, ph) * amp) * H
      if (i === 0) { ctx.moveTo(i, y) } else { ctx.lineTo(i, y) }
    }
    ctx.stroke()
  }, [waveform, rate, depth, active, simple])

  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 0
  const period = safeRate > 0 ? 1 / safeRate : 0
  const dim = simple ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.42)'
  const label = safeRate > 0
    ? `1 cycle  ·  ${period >= 1 ? period.toFixed(2) : period.toFixed(3)}s  ·  ${safeRate.toFixed(2)}Hz`
    : '1 cycle'

  return (
    <div style={{ marginTop: 5 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
        <span style={{ fontSize:7.5, color:dim, textTransform:'uppercase', letterSpacing:'0.06em' }}>LFO Period</span>
        <span style={{ fontSize:7.5, color:active ? '#a78bfa' : dim, fontFamily:'monospace' }}>{label}</span>
      </div>
      <div style={{
        height: 54,
        borderRadius: 3,
        overflow: 'hidden',
        border: `0.5px solid ${active ? 'rgba(167,139,250,0.30)' : (simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)')}`,
        opacity: active ? 1 : 0.45,
      }}>
        <canvas ref={canvasRef} width={360} height={72} style={{ width:'100%', height:'100%', display:'block' }} />
      </div>
    </div>
  )
}

// Standalone slider row — must be module-level to avoid remount on every parent render
function WLSliderRow({ label, paramKey, min, max, step, fmt, srcKey, rateKey, showSrc,
  ep, dim, dim2, accent, liveValue, onSetNum, onSetStr }: {
  label: string; paramKey: string; min: number; max: number; step: number
  fmt: (v: number) => string; srcKey?: string; rateKey?: string; showSrc: boolean
  ep: Record<string, unknown>; dim: string; dim2: string; accent: string
  liveValue?: number | null
  onSetNum: (key: string, val: number) => void
  onSetStr: (key: string, val: string) => void
}) {
  const storeVal = Number(ep[paramKey] ?? 0)
  const [drag, setDrag] = useState<number | null>(null)
  const val = drag ?? storeVal
  const src  = srcKey  ? String(ep[srcKey]  ?? 'manual') : null
  const rate = rateKey ? Number(ep[rateKey] ?? 1)     : null
  const isMapped = src !== null && src !== 'manual'
  const displayValue = liveValue ?? val
  return (
    <div style={{ marginBottom: 3 }}>
      <div style={{ display:'flex', alignItems:'center', gap:4 }}>
        <span style={{ fontSize:8.5, color:dim, width:50, flexShrink:0, textAlign:'right' }}>{label}</span>
        <input type="range" min={min} max={max} step={step} value={val}
          onMouseDown={() => setDrag(storeVal)}
          onChange={e => setDrag(parseFloat(e.target.value))}
          onMouseUp={e => { const v = parseFloat((e.target as HTMLInputElement).value); setDrag(null); onSetNum(paramKey, v) }}
          style={{ flex:1, accentColor:accent, minWidth:0, cursor:'ew-resize' }} />
        <span style={{ fontSize:8.5, fontFamily:'monospace', color:accent, width:46, textAlign:'right', flexShrink:0 }}>
          {fmt(displayValue)}
        </span>
      </div>
      {srcKey && rateKey && showSrc && (
        <div style={{ display:'flex', alignItems:'center', gap:3, marginTop:1, paddingLeft:54 }}>
          <span style={{ fontSize:7.5, color:dim, marginRight:2 }}>src</span>
          {ORBIT_SOURCES.map(s => (
            <button key={s} onClick={() => onSetStr(srcKey, s)} style={{
              fontSize:7, padding:'1px 5px', borderRadius:3, fontFamily:'inherit', cursor:'pointer',
              border:`0.5px solid ${src===s ? accent+'88' : 'rgba(255,255,255,0.08)'}`,
              background: src===s ? accent+'20' : 'transparent',
              color: src===s ? accent : dim,
            }}>{ORBIT_SRC_LABELS[s]}</button>
          ))}
          <span style={{ fontSize:7.5, color:dim, marginLeft:4 }}>×</span>
          <input type="number" value={rate ?? 1} step={0.01}
            onChange={e => onSetNum(rateKey, parseFloat(e.target.value))}
            style={{ width:44, fontSize:8, fontFamily:'monospace', padding:'1px 3px', borderRadius:3,
              border:'0.5px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.05)',
              color:dim2, outline:'none' }} />
          {isMapped && liveValue !== null && liveValue !== undefined && (
            <span style={{ fontSize:7.5, color:accent, fontFamily:'monospace', opacity:0.75 }}>
              → {fmt(liveValue)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function WaveLabInstrumentExpanded({ bodyId, slotKey, simple, onClose }: { bodyId: string | null; slotKey: string; simple: boolean; onClose?: () => void }) {
  const { getBodyEffectiveParams, getControlSetById, globalRack, rackParamOverrides, setSlotOverride } = useControlSetStore()
  const bodies = usePlanetStore(s => s.bodies)
  const G = usePlanetStore(s => s.simParams.G)
  const globalInstrument = globalRack.instrument ? getControlSetById(globalRack.instrument) : null
  const ep = useMemo(
    () => (bodyId
      ? getBodyEffectiveParams(bodyId)
      : { ...(globalInstrument?.params ?? {}), ...(rackParamOverrides[slotKey] ?? {}) }
    ) as Record<string, unknown>,
    [bodyId, getBodyEffectiveParams, globalInstrument?.params, rackParamOverrides, slotKey],
  )

  const [manualADSR, setManualADSR] = useState(false)
  const [, setWaveRefreshSeq] = useState(0)

  useEffect(() => {
    if (!bodyId) return
    return subscribeWaveLabWaveformRefresh(refreshedBodyId => {
      if (refreshedBodyId === bodyId) setWaveRefreshSeq(v => v + 1)
    })
  }, [bodyId])

  const dim    = simple ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)'
  const dim2   = simple ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)'
  const bg2    = simple ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)'
  const accent = '#34d399'

  const currentSig = String(ep.wavLabSig ?? 'x')
  const selectedSigs = currentSig.split(',').filter(s => WAV_SIGS.includes(s as typeof WAV_SIGS[number]))

  const toggleSig = useCallback((sig: string) => {
    const prev = (ep.wavLabSig ? String(ep.wavLabSig) : 'x').split(',').filter(s => WAV_SIGS.includes(s as typeof WAV_SIGS[number]))
    const next = prev.includes(sig) ? prev.filter(s => s !== sig) : [...prev, sig]
    setSlotOverride(slotKey, { wavLabSig: next.length > 0 ? next.join(',') : 'x' })
  }, [ep, slotKey, setSlotOverride])

  const setNum = useCallback((key: string, val: number) => setSlotOverride(slotKey, { [key]: val }), [slotKey, setSlotOverride])
  const setStr = useCallback((key: string, val: string) => setSlotOverride(slotKey, { [key]: val }), [slotKey, setSlotOverride])

  const trailPts = bodyId ? getBodyTrailPoints(bodyId) : null
  const liveStats = (() => {
    if (!bodyId) return null
    const liveBodies = getPlanetLiveBodySnapshot()
    const liveById = new Map(liveBodies.map(b => [b.id, b]))
    const effective = bodies.map(b => {
      const live = liveById.get(b.id)
      return live ? { ...b, x: live.x, y: live.y, vx: live.vx, vy: live.vy, ax: live.ax, ay: live.ay } : b
    })
    const body = effective.find(b => b.id === bodyId)
    return body ? computeOrbitStats(body, effective, G) : null
  })()
  const lfoTarget = String(ep.oscSynthLfoTarget ?? 'off')
  const lfoWave   = String(ep.oscSynthLfoWaveform ?? 'sine')
  const lfoOn     = lfoTarget !== 'off'

  function liveFor(paramKey: string, srcKey?: string, rateKey?: string, min = 0, max = 1): number | null {
    if (!srcKey || !rateKey) return null
    return waveLabOrbitValue(
      String(ep[srcKey] ?? 'manual'),
      Number(ep[paramKey] ?? 0),
      liveStats,
      Number(ep[rateKey] ?? 1),
      min,
      max,
    )
  }

  const lfoRateLive = liveFor('oscSynthLfoRate', 'oscSynthLfoRateSource', 'oscSynthLfoRateRate', 0.01, 20)
  const lfoDepthLive = liveFor('oscSynthLfoDepth', 'oscSynthLfoDepthSource', 'oscSynthLfoDepthRate', 0, 1)
  const sliderProps = { ep, dim, dim2, accent, showSrc: !manualADSR, onSetNum: setNum, onSetStr: setStr }

  const secLabel = (label: string) => (
    <div style={{ fontSize:8, fontWeight:700, color:dim, textTransform:'uppercase', letterSpacing:'0.07em', marginTop:8, marginBottom:4 }}>{label}</div>
  )

  const engine = bodyId ? getBodyWaveLabEngine(bodyId) : null

  const hdrColWL = simple ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.22)'

  return (
    <div style={{ display:'flex', flexDirection:'column', overflow:'hidden' }}>
    {/* Inner header */}
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 12px 4px', borderBottom:`0.5px solid ${simple?'rgba(0,0,0,0.07)':'rgba(255,255,255,0.06)'}`, flexShrink:0 }}>
      {onClose && <button onClick={onClose} style={{ fontSize:9, color:hdrColWL, background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', padding:'0 4px' }}>▼ close</button>}
      <span style={{ fontSize:10, fontWeight:700, color:'#34d399' }}>∿ Wave Lab</span>
    </div>
    <div style={{ display:'flex', gap:0, height: 380, overflow:'hidden' }}>

      {/* Left: signal selector / synthesis / oscilloscope */}
      <div style={{ width:200, flexShrink:0, borderRight:`0.5px solid ${simple?'rgba(0,0,0,0.07)':'rgba(255,255,255,0.06)'}`, padding:'8px 10px', display:'flex', flexDirection:'column', gap:0 }}>
        {/* Signal selector */}
        <div style={{ fontSize:8, fontWeight:700, color:dim, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>Wavetable Signal</div>
        <div style={{ display:'flex', gap:3, flexWrap:'wrap', marginBottom:6 }}>
          {WAV_SIGS.map(s => {
            const on = selectedSigs.includes(s)
            return (
              <button key={s} onClick={() => toggleSig(s)} style={{
                fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:4, fontFamily:'inherit', cursor:'pointer',
                border:`0.5px solid ${on ? WAV_SIG_COLORS[s]+'bb' : 'rgba(255,255,255,0.1)'}`,
                background: on ? `${WAV_SIG_COLORS[s]}28` : 'transparent',
                color: on ? WAV_SIG_COLORS[s] : dim,
              }}>{WAV_SIG_LABELS[s]}</button>
            )
          })}
        </div>
        {/* Orbit Trail: individual signals */}
        <div style={{ fontSize:7.5, color:dim, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Orbit Trail</div>
        <div style={{ height:72, background:bg2, borderRadius:3, overflow:'hidden', flexShrink:0, marginBottom:5 }}>
          {trailPts && trailPts.length >= 2
            ? <WaveLabMiniCanvas pts={trailPts} sigs={selectedSigs} />
            : <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, color:dim }}>{trailPts ? '…' : 'no body'}</div>
          }
        </div>
        {/* Synthesis: summed waveform */}
        <div style={{ fontSize:7.5, color:dim, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Synthesis</div>
        <div style={{ height:72, background:bg2, borderRadius:3, overflow:'hidden', flexShrink:0, marginBottom:5 }}>
          {trailPts && trailPts.length >= 2
            ? <WaveLabMiniSynth pts={trailPts} sigs={selectedSigs} />
            : <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, color:dim }}>{trailPts ? '…' : 'no body'}</div>
          }
        </div>
        {/* Oscilloscope */}
        <div style={{ fontSize:7.5, color:dim, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Oscilloscope</div>
        <div style={{ flex:1, minHeight:0, background:bg2, borderRadius:3, overflow:'hidden' }}>
          <WaveLabOscillo analyser={engine?.analyserNode ?? null} />
        </div>
      </div>

      {/* Center: Envelope + Filter */}
      <div style={{ width:270, flexShrink:0, borderRight:`0.5px solid ${simple?'rgba(0,0,0,0.07)':'rgba(255,255,255,0.06)'}`, padding:'10px 12px', overflowY:'auto' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
          <span style={{ fontSize:8, fontWeight:700, color:dim, textTransform:'uppercase', letterSpacing:'0.07em' }}>Envelope / Filter</span>
          <button onClick={() => setManualADSR(v => !v)} style={{
            fontSize:7, padding:'1px 7px', borderRadius:3, fontFamily:'inherit', cursor:'pointer',
            border:`0.5px solid ${manualADSR ? '#fbbf2488' : 'rgba(255,255,255,0.1)'}`,
            background: manualADSR ? 'rgba(251,191,36,0.15)' : 'transparent',
            color: manualADSR ? '#fbbf24' : dim,
          }}>{manualADSR ? '✎ manual' : '⟳ orbit src'}</button>
        </div>
        <WLSliderRow label="Level"   paramKey="oscSynthLevel"           min={0}     max={1}     step={0.01} fmt={v=>v.toFixed(2)}        {...sliderProps} />
        <WLSliderRow label="Attack"  paramKey="oscSynthAttack"          min={0.001} max={20}    step={0.05} fmt={v=>`${v.toFixed(2)}s`}  srcKey="oscSynthAttackSource"  rateKey="oscSynthAttackRate"  liveValue={liveFor('oscSynthAttack', 'oscSynthAttackSource', 'oscSynthAttackRate', 0.005, 20)} {...sliderProps} />
        <WLSliderRow label="Decay"   paramKey="oscSynthDecay"           min={0.01}  max={10}    step={0.05} fmt={v=>`${v.toFixed(2)}s`}  srcKey="oscSynthDecaySource"   rateKey="oscSynthDecayRate"   liveValue={liveFor('oscSynthDecay', 'oscSynthDecaySource', 'oscSynthDecayRate', 0.01, 20)} {...sliderProps} />
        <WLSliderRow label="Sustain" paramKey="oscSynthSustain"         min={0}     max={1}     step={0.01} fmt={v=>v.toFixed(2)}        srcKey="oscSynthSustainSource" rateKey="oscSynthSustainRate" liveValue={liveFor('oscSynthSustain', 'oscSynthSustainSource', 'oscSynthSustainRate', 0, 1)} {...sliderProps} />
        <WLSliderRow label="Release" paramKey="oscSynthRelease"         min={0.01}  max={30}    step={0.1}  fmt={v=>`${v.toFixed(2)}s`}  srcKey="oscSynthReleaseSource" rateKey="oscSynthReleaseRate" liveValue={liveFor('oscSynthRelease', 'oscSynthReleaseSource', 'oscSynthReleaseRate', 0.01, 30)} {...sliderProps} />
        <WLSliderRow label="Cutoff"  paramKey="oscSynthFilterCutoff"    min={80}    max={12000}  step={50}  fmt={v=>`${Math.round(v)}Hz`} srcKey="oscSynthCutoffSource"  rateKey="oscSynthCutoffRate"  liveValue={liveFor('oscSynthFilterCutoff', 'oscSynthCutoffSource', 'oscSynthCutoffRate', 80, 12000)} {...sliderProps} />
        <WLSliderRow label="Q"       paramKey="oscSynthFilterResonance" min={0.01}  max={15}    step={0.05} fmt={v=>v.toFixed(2)}        {...sliderProps} />
      </div>

      {/* Right: LFO */}
      <div style={{ flex:1, padding:'10px 12px', overflowY:'auto' }}>
        {secLabel('LFO')}
        <div style={{ display:'flex', gap:3, flexWrap:'wrap', marginBottom:6 }}>
          {LFO_TARGETS.map(t => (
            <button key={t} onClick={() => setStr('oscSynthLfoTarget', t)} style={{
              fontSize:8.5, fontWeight:600, padding:'2px 8px', borderRadius:4, fontFamily:'inherit', cursor:'pointer',
              border:`0.5px solid ${lfoTarget===t ? '#a78bfa88' : 'rgba(255,255,255,0.1)'}`,
              background: lfoTarget===t ? 'rgba(167,139,250,0.18)' : 'transparent',
              color: lfoTarget===t ? '#a78bfa' : dim,
            }}>{LFO_TARGET_LABELS[t]}</button>
          ))}
        </div>
        <div style={{ display:'flex', gap:3, flexWrap:'wrap', marginBottom:8, opacity: lfoOn ? 1 : 0.4 }}>
          {LFO_WAVES.map(w => (
            <button key={w} onClick={() => lfoOn && setStr('oscSynthLfoWaveform', w)} style={{
              fontSize:8.5, fontWeight:600, padding:'2px 8px', borderRadius:4, fontFamily:'inherit', cursor: lfoOn ? 'pointer' : 'default',
              border:`0.5px solid ${lfoWave===w && lfoOn ? '#a78bfa88' : 'rgba(255,255,255,0.1)'}`,
              background: lfoWave===w && lfoOn ? 'rgba(167,139,250,0.18)' : 'transparent',
              color: lfoWave===w && lfoOn ? '#a78bfa' : dim,
            }}>{LFO_WAVE_LABELS[w]}</button>
          ))}
        </div>
        <div style={{ opacity: lfoOn ? 1 : 0.4 }}>
          <WLSliderRow label="Rate"  paramKey="oscSynthLfoRate"  min={0.01} max={20} step={0.01} fmt={v=>`${v.toFixed(2)}Hz`} srcKey="oscSynthLfoRateSource"  rateKey="oscSynthLfoRateRate"  liveValue={lfoRateLive} {...sliderProps} />
          <WLSliderRow label="Depth" paramKey="oscSynthLfoDepth" min={0}    max={1}  step={0.01} fmt={v=>v.toFixed(2)}        srcKey="oscSynthLfoDepthSource" rateKey="oscSynthLfoDepthRate" liveValue={lfoDepthLive} {...sliderProps} />
          <WaveLabLfoPreview
            waveform={lfoWave}
            rate={lfoRateLive ?? Number(ep.oscSynthLfoRate ?? 0.5)}
            depth={lfoDepthLive ?? Number(ep.oscSynthLfoDepth ?? 0.3)}
            active={lfoOn}
            simple={simple}
          />
        </div>
      </div>
    </div>
    </div>
  )
}

function WaveLabMiniCanvas({ pts, sigs }: { pts: Array<{x:number;y:number}>; sigs: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0,0,W,H)
    ctx.fillStyle='rgba(255,255,255,0.03)'; ctx.fillRect(0,0,W,H)
    ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=0.5
    ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke()
    const sigColors: Record<string,string> = { x:'#60a5fa',y:'#34d399',r:'#a78bfa',angle:'#fbbf24',speed:'#f87171' }
    sigs.forEach(sig => {
      let arr: number[]
      if (sig==='x')     arr = pts.map(p=>p.x)
      else if (sig==='y') arr = pts.map(p=>p.y)
      else if (sig==='r') arr = pts.map(p=>Math.sqrt(p.x*p.x+p.y*p.y))
      else if (sig==='angle') arr = pts.map(p=>Math.atan2(p.y,p.x))
      else arr = pts.map((p,i)=>i===0?0:Math.sqrt((p.x-pts[i-1].x)**2+(p.y-pts[i-1].y)**2))
      const min=Math.min(...arr),max=Math.max(...arr),range=max-min||1
      const norm = arr.map(v=>(v-min)/range*2-1)
      ctx.beginPath(); ctx.strokeStyle=sigColors[sig]??'#fff'; ctx.lineWidth=1.5; ctx.lineJoin='round'
      norm.forEach((v,i)=>{const px=(i/(norm.length-1))*W,py=((1-v)/2)*H;if (i===0) { ctx.moveTo(px,py) } else { ctx.lineTo(px,py) }})
      ctx.stroke()
    })
  }, [pts, sigs])
  return <canvas ref={canvasRef} width={800} height={200} style={{width:'100%',height:'100%',display:'block'}} />
}

function WaveLabMiniSynth({ pts, sigs }: { pts: Array<{x:number;y:number}>; sigs: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0,0,W,H)
    ctx.fillStyle='rgba(255,255,255,0.03)'; ctx.fillRect(0,0,W,H)
    ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=0.5
    ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke()
    if (pts.length < 2 || sigs.length === 0) return
    const sigColors: Record<string,string> = { x:'#60a5fa',y:'#34d399',r:'#a78bfa',angle:'#fbbf24',speed:'#f87171' }
    const arrays = sigs.map(sig => {
      let arr: number[]
      if (sig==='x')     arr = pts.map(p=>p.x)
      else if (sig==='y') arr = pts.map(p=>p.y)
      else if (sig==='r') arr = pts.map(p=>Math.sqrt(p.x*p.x+p.y*p.y))
      else if (sig==='angle') arr = pts.map(p=>Math.atan2(p.y,p.x))
      else arr = pts.map((p,i)=>i===0?0:Math.sqrt((p.x-pts[i-1].x)**2+(p.y-pts[i-1].y)**2))
      const min=Math.min(...arr),max=Math.max(...arr),range=max-min||1
      return arr.map(v=>(v-min)/range*2-1)
    })
    // draw each signal faintly
    sigs.forEach((sig, si) => {
      ctx.beginPath(); ctx.strokeStyle=sigColors[sig]??'#fff'; ctx.lineWidth=0.8; ctx.globalAlpha=0.2; ctx.lineJoin='round'
      arrays[si].forEach((v,i)=>{const px=(i/(arrays[si].length-1))*W,py=((1-v)/2)*H;if (i===0) { ctx.moveTo(px,py) } else { ctx.lineTo(px,py) }})
      ctx.stroke()
    })
    ctx.globalAlpha=1
    // draw sum
    const summed = arrays[0].map((_,i) => arrays.reduce((acc,a)=>acc+a[i],0))
    const smin=Math.min(...summed),smax=Math.max(...summed),srange=smax-smin||1
    const norm = summed.map(v=>(v-smin)/srange*2-1)
    ctx.beginPath(); ctx.strokeStyle='#a78bfa'; ctx.lineWidth=1.8; ctx.lineJoin='round'
    norm.forEach((v,i)=>{const px=(i/(norm.length-1))*W,py=((1-v)/2)*H;if (i===0) { ctx.moveTo(px,py) } else { ctx.lineTo(px,py) }})
    ctx.stroke()
  }, [pts, sigs])
  return <canvas ref={canvasRef} width={800} height={200} style={{width:'100%',height:'100%',display:'block'}} />
}

function WaveLabPreview({ label, children, dim, panelBg, border }: { label: string; children: ReactNode; dim: string; panelBg: string; border: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 6.8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2, lineHeight: 1 }}>
        {label}
      </div>
      <div style={{ height: 38, borderRadius: 3, overflow: 'hidden', background: panelBg, border: `0.5px solid ${border}` }}>
        {children}
      </div>
    </div>
  )
}

function InlineWaveLabContent({
  bodyId, slotKey, cs, simple, accent: _accent,
}: { bodyId: string | null; slotKey: string; cs: ControlSet; simple: boolean; accent: string }) {
  const { getBodyEffectiveParams, rackParamOverrides, setSlotOverride } = useControlSetStore()
  const [trailPts, setTrailPts] = useState<Array<{x: number; y: number}> | null>(null)
  const [, setWaveRefreshSeq] = useState(0)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!bodyId) { setTrailPts(null); return }
    const refresh = () => setTrailPts(getBodyTrailPoints(bodyId))
    refresh()
    const id = window.setInterval(refresh, 250)
    return () => window.clearInterval(id)
  }, [bodyId])

  useEffect(() => {
    if (!bodyId) return
    return subscribeWaveLabWaveformRefresh(refreshedBodyId => {
      if (refreshedBodyId !== bodyId) return
      setTrailPts(getBodyTrailPoints(bodyId))
      setWaveRefreshSeq(v => v + 1)
    })
  }, [bodyId])

  const ep = (bodyId
    ? getBodyEffectiveParams(bodyId)
    : { ...cs.params, ...(rackParamOverrides[slotKey] ?? {}) }
  ) as Record<string, unknown>
  const selectedSigs = String(ep.wavLabSig ?? 'x')
    .split(',')
    .filter(s => WAV_SIGS.includes(s as typeof WAV_SIGS[number]))
  const activeSigs = selectedSigs.length > 0 ? selectedSigs : ['x']
  const engine = bodyId ? getBodyWaveLabEngine(bodyId) : null
  const dim = simple ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.36)'
  const panelBg = simple ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.045)'
  const border = simple ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.07)'

  const toggleSig = (sig: string) => {
    const prev = activeSigs.filter(s => WAV_SIGS.includes(s as typeof WAV_SIGS[number]))
    const next = prev.includes(sig) ? prev.filter(s => s !== sig) : [...prev, sig]
    setSlotOverride(slotKey, { wavLabSig: next.length > 0 ? next.join(',') : 'x' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 6.8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 3 }}>
          Wavetable
        </span>
        {WAV_SIGS.map(s => {
          const on = activeSigs.includes(s)
          return (
            <button key={s} onClick={() => toggleSig(s)} style={{
              minWidth: s === 'speed' ? 30 : 22,
              height: 18,
              fontSize: 8,
              fontWeight: 800,
              padding: '1px 6px',
              borderRadius: 4,
              fontFamily: 'inherit',
              cursor: 'pointer',
              border: `0.5px solid ${on ? WAV_SIG_COLORS[s] + 'bb' : border}`,
              background: on ? `${WAV_SIG_COLORS[s]}24` : 'transparent',
              color: on ? WAV_SIG_COLORS[s] : dim,
              lineHeight: 1,
            }}>{WAV_SIG_LABELS[s]}</button>
          )
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <WaveLabPreview label="Orbit Trail" dim={dim} panelBg={panelBg} border={border}>
          {trailPts && trailPts.length >= 2
            ? <WaveLabMiniCanvas pts={trailPts} sigs={activeSigs} />
            : <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:7, color:dim }}>{bodyId ? '…' : 'no body'}</div>
          }
        </WaveLabPreview>
        <WaveLabPreview label="Synthesis" dim={dim} panelBg={panelBg} border={border}>
          {trailPts && trailPts.length >= 2
            ? <WaveLabMiniSynth pts={trailPts} sigs={activeSigs} />
            : <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:7, color:dim }}>{bodyId ? '…' : 'no body'}</div>
          }
        </WaveLabPreview>
        <WaveLabPreview label="Oscilloscope" dim={dim} panelBg={panelBg} border={border}>
          <WaveLabOscillo analyser={engine?.analyserNode ?? null} />
        </WaveLabPreview>
      </div>
    </div>
  )
}

function OrbitStepExpanded({ bodyId, slotKey, simple, onClose }: { bodyId: string | null; slotKey: string; simple: boolean; onClose?: () => void }) {
  const overrides = useControlSetStore(s => s.rackParamOverrides[slotKey] ?? EMPTY_PARAM_OVERRIDES)
  const setSlotOverride = useControlSetStore(s => s.setSlotOverride)
  const resetSlotParam = useControlSetStore(s => s.resetSlotParam)
  const accent = '#60a5fa'
  const dim = simple ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.38)'
  const dim2 = simple ? 'rgba(0,0,0,0.64)' : 'rgba(255,255,255,0.64)'
  const border = simple ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)'
  const panel = simple ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.04)'
  const params = {
    orbitTriggerMode: 'orbit-complete',
    orbitTriggerType: 'tperiod',
    orbitTriggerDivision: 0.25,
    orbitStepSeqEnabled: false,
    orbitStepSeqLength: 8,
    orbitStepSeqPattern: '11111111',
    ...overrides,
  } as Record<string, unknown>
  const source = String(params.orbitTriggerType ?? 'tperiod')
  const division = Number(params.orbitTriggerDivision ?? 0.25)
  const seqEnabled = Boolean(params.orbitStepSeqEnabled)
  const seqLength = Math.max(1, Math.min(16, Math.round(Number(params.orbitStepSeqLength ?? 8))))
  const rawPattern = String(params.orbitStepSeqPattern ?? '11111111').replace(/[^01]/g, '')
  const pattern = (rawPattern || '11111111').padEnd(seqLength, '1').slice(0, seqLength)

  const setPatch = (patch: Partial<PlanetSimParams>) => setSlotOverride(slotKey, patch)
  const sectionLabel = (label: string) => (
    <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
  )
  function setPattern(next: string) {
    setPatch({ orbitStepSeqPattern: next } as Partial<PlanetSimParams>)
  }
  function toggleStep(i: number) {
    const chars = pattern.split('')
    chars[i] = chars[i] === '1' ? '0' : '1'
    setPattern(chars.join(''))
  }
  function setLength(nextLength: number) {
    const len = Math.max(1, Math.min(16, nextLength))
    setPatch({
      orbitStepSeqLength: len,
      orbitStepSeqPattern: pattern.padEnd(len, '1').slice(0, len),
    } as Partial<PlanetSimParams>)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 12px 4px 48px', borderBottom:`0.5px solid ${border}`, flexShrink:0 }}>
        {onClose && <button onClick={onClose} style={{ fontSize:9, color:dim, background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', padding:'0 4px' }}>▼ close</button>}
        <span style={{ fontSize:10, fontWeight:700, color:accent }}>↺ Orbit Step</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 240px', gap: 16, padding: '12px 14px 12px 48px', minHeight: 230 }}>
        <div style={{ borderRight: `0.5px solid ${border}`, paddingRight: 14 }}>
          {sectionLabel('Source / Rate')}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 50, fontSize: 8, color: dim, textAlign: 'right' }}>source</span>
            <select
              value={source}
              onChange={e => setPatch({ orbitTriggerType: e.target.value as PlanetSimParams['orbitTriggerType'] })}
              style={{ flex: 1, fontSize: 10, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 4, padding: '4px 6px' }}
            >
              <option value="tperiod">T-period</option>
              <option value="cumulative">Cumulative</option>
              <option value="periodic">Periodic</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ width: 50, fontSize: 8, color: dim, textAlign: 'right' }}>rate</span>
            <select
              value={String(division)}
              onChange={e => setPatch({ orbitTriggerDivision: Number(e.target.value) })}
              style={{ flex: 1, fontSize: 10, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 4, padding: '4px 6px' }}
            >
              <option value={2}>2 orbits</option>
              <option value={1}>1 orbit</option>
              <option value={0.5}>1/2</option>
              <option value={0.25}>1/4</option>
              <option value={0.125}>1/8</option>
              <option value={0.0625}>1/16</option>
            </select>
          </div>
          <button
            onClick={() => {
              resetSlotParam(slotKey, 'orbitTriggerType')
              resetSlotParam(slotKey, 'orbitTriggerDivision')
            }}
            style={{ width: '100%', fontSize: 8, color: dim, background: 'transparent', border: `0.5px solid ${border}`, borderRadius: 4, padding: '5px 7px', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            reset source/rate
          </button>
        </div>

        <div>
          {sectionLabel('Step Sequencer')}
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, color: dim2, marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={seqEnabled}
              onChange={e => setPatch({ orbitStepSeqEnabled: e.target.checked })}
              style={{ accentColor: accent }}
            />
            gate trigger events by step pattern
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, opacity: seqEnabled ? 1 : 0.45 }}>
            <span style={{ width: 44, fontSize: 8, color: dim, textAlign: 'right' }}>steps</span>
            <input
              type="range"
              min={1}
              max={16}
              step={1}
              value={seqLength}
              onChange={e => setLength(Number(e.target.value))}
              style={{ flex: 1, accentColor: accent }}
            />
            <span style={{ width: 20, fontSize: 10, color: accent, fontFamily: 'monospace', textAlign: 'right' }}>{seqLength}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(24px, 1fr))', gap: 5, opacity: seqEnabled ? 1 : 0.45 }}>
            {Array.from({ length: seqLength }, (_, i) => {
              const on = pattern[i] !== '0'
              return (
                <button
                  key={i}
                  onClick={() => toggleStep(i)}
                  title={`Step ${i + 1}: ${on ? 'on' : 'rest'}`}
                  style={{
                    height: 28,
                    borderRadius: 5,
                    border: `0.5px solid ${on ? accent : border}`,
                    background: on ? `${accent}28` : panel,
                    color: on ? accent : dim,
                    fontSize: 9,
                    fontWeight: 800,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {i + 1}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ borderLeft: `0.5px solid ${border}`, paddingLeft: 14 }}>
          {sectionLabel('Pattern')}
          <input
            value={pattern}
            onChange={e => setPattern(e.target.value.replace(/[^01]/g, '').slice(0, 16))}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              fontSize: 12,
              fontFamily: 'monospace',
              color: accent,
              background: panel,
              border: `0.5px solid ${border}`,
              borderRadius: 5,
              padding: '6px 8px',
              marginBottom: 8,
              letterSpacing: '0.08em',
            }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
            {[
              ['All', '11111111'],
              ['Offbeat', '01010101'],
              ['Sparse', '10001000'],
              ['Clave', '10010100'],
            ].map(([label, value]) => (
              <button
                key={label}
                onClick={() => setPattern(value.padEnd(seqLength, '0').slice(0, seqLength))}
                style={{ fontSize: 8, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 4, padding: '5px 6px', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 8, color: dim, lineHeight: 1.45, marginTop: 10 }}>
            1 = fire, 0 = rest. The sequencer advances only when Orbit Step reaches the selected rate.
          </div>
          {bodyId && (
            <div style={{ marginTop: 10 }}>
              <OrbitInputBlock bodyId={bodyId} dimText={dim} accent={accent} triggerType={source} division={division} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OneShotStretchExpanded({ bodyId, slotKey, simple, onClose }: { bodyId: string | null; slotKey: string; simple: boolean; onClose?: () => void }) {
  const _overrides = useControlSetStore(s => s.rackParamOverrides[slotKey] ?? EMPTY_PARAM_OVERRIDES)
  const setSlotOverride = useControlSetStore(s => s.setSlotOverride)
  const resetSlotParam = useControlSetStore(s => s.resetSlotParam)
  const getBodyEffectiveParams2 = useControlSetStore(s => s.getBodyEffectiveParams)
  const getBodyTriggerParamsList2 = useControlSetStore(s => s.getBodyTriggerParamsList)
  const effectiveParams = bodyId ? getBodyEffectiveParams2(bodyId) : null
  const _triggerParams = bodyId ? (getBodyTriggerParamsList2(bodyId)[0] ?? null) : null
  const bodies = usePlanetStore(s => s.bodies)
  const G = usePlanetStore(s => s.simParams.G)
  const body = bodyId ? (bodies.find(b => b.id === bodyId) ?? null) : null
  const orbitStats = body ? computeOrbitStats(body, bodies, G) : null
  const bufDurSec = bodyId ? (getBodyOneShotEngine(bodyId)?.bufferDuration ?? 0) : 0
  const fullT = orbitStats?.T_real ?? null
  const sourceDiv = Math.max(0.0625, Number((triggerParams as Record<string, unknown> | null)?.orbitTriggerDivision ?? 1))
  const sourceSec = fullT !== null ? fullT * sourceDiv : null
  const mode = String((effectiveParams as Record<string, unknown> | null)?.sampleStretchMode ?? 'rate')
  const source = String((effectiveParams as Record<string, unknown> | null)?.sampleOrbitSource ?? 'current')
  const numer = Math.max(1, Number((effectiveParams as Record<string, unknown> | null)?.orbitLoopNumer ?? 1))
  const denom = Math.max(1, Number((effectiveParams as Record<string, unknown> | null)?.orbitLoopDenom ?? 1))
  const _pitchFix = Boolean((effectiveParams as Record<string, unknown> | null)?.samplePitchCorrection)
  const stretchRatio = numer / denom
  const playbackRate = bufDurSec > 0 && sourceSec !== null && sourceSec > 0 ? (bufDurSec * stretchRatio / sourceSec) : null
  const accent = '#f59e0b'
  const dim = simple ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.38)'
  const dim2 = simple ? 'rgba(0,0,0,0.64)' : 'rgba(255,255,255,0.64)'
  const border = simple ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)'
  const panel = simple ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.04)'
  const setPatch = (patch: Partial<PlanetSimParams>) => setSlotOverride(slotKey, patch)
  const sectionLabel = (label: string) => (
    <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
  )
  const metric = (label: string, value: string, color = dim2) => (
    <div style={{ border: `0.5px solid ${border}`, borderRadius: 5, background: panel, padding: '7px 8px' }}>
      <div style={{ fontSize: 8, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, color, fontFamily: 'monospace', fontWeight: 800, lineHeight: 1 }}>{value}</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 12px 4px 48px', borderBottom:`0.5px solid ${border}`, flexShrink:0 }}>
        {onClose && <button onClick={onClose} style={{ fontSize:9, color:dim, background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', padding:'0 4px' }}>▼ close</button>}
        <span style={{ fontSize:10, fontWeight:700, color:accent }}>⟳ Oneshot Stretch</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr 250px', gap: 16, padding: '12px 14px 12px 48px', minHeight: 230 }}>
        <div style={{ borderRight: `0.5px solid ${border}`, paddingRight: 14 }}>
          {sectionLabel('Stretch')}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 54, fontSize: 8, color: dim, textAlign: 'right' }}>mode</span>
            <select
              value={mode}
              onChange={e => setPatch({ sampleStretchMode: e.target.value as PlanetSimParams['sampleStretchMode'] })}
              style={{ flex: 1, fontSize: 10, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 4, padding: '4px 6px' }}
            >
              <option value="rate">Rate</option>
              <option value="time">Time</option>
              <option value="off">Off</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 54, fontSize: 8, color: dim, textAlign: 'right' }}>source</span>
            <select
              value={source}
              onChange={e => setPatch({ sampleOrbitSource: e.target.value })}
              style={{ flex: 1, fontSize: 10, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 4, padding: '4px 6px' }}
            >
              <option value="current">Current</option>
              <option value="predicted">Predicted</option>
            </select>
          </div>
          <button
            onClick={() => {
              resetSlotParam(slotKey, 'sampleStretchMode')
              resetSlotParam(slotKey, 'sampleOrbitSource')
              resetSlotParam(slotKey, 'samplePitchCorrection')
            }}
            style={{ width: '100%', fontSize: 8, color: dim, background: 'transparent', border: `0.5px solid ${border}`, borderRadius: 4, padding: '5px 7px', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            reset stretch
          </button>
        </div>

        <div>
          {sectionLabel('Target Duration')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 14 }}>
            {metric('orig', bufDurSec > 0 ? `${bufDurSec.toFixed(2)}s` : '--')}
            {metric('source', sourceSec !== null ? `${sourceSec.toFixed(2)}s` : '--', accent)}
            {metric('rate', playbackRate !== null ? `${playbackRate.toFixed(3)}x` : '--', '#a78bfa')}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 58, fontSize: 8, color: dim, textAlign: 'right' }}>loops</span>
            <input
              type="number"
              min={1}
              step={1}
              value={numer}
              onChange={e => setPatch({ orbitLoopNumer: Math.max(1, Number(e.target.value)) })}
              style={{ width: 58, fontSize: 10, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 4, padding: '4px 6px', fontFamily: 'monospace' }}
            />
            <span style={{ fontSize: 10, color: dim }}>/</span>
            <input
              type="number"
              min={1}
              step={1}
              value={denom}
              onChange={e => setPatch({ orbitLoopDenom: Math.max(1, Number(e.target.value)) })}
              style={{ width: 58, fontSize: 10, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 4, padding: '4px 6px', fontFamily: 'monospace' }}
            />
            <span style={{ fontSize: 8, color: dim }}>source interval</span>
          </div>
          <div style={{ fontSize: 8, color: dim, lineHeight: 1.45 }}>
            Rate is calculated as original sample seconds times loop ratio divided by Orbit Step source interval.
          </div>
        </div>

        <div style={{ borderLeft: `0.5px solid ${border}`, paddingLeft: 14 }}>
          {sectionLabel('Orbit Step Source')}
          {metric('full orbit T', fullT !== null ? `${fullT.toFixed(2)}s` : '--', dim2)}
          <div style={{ height: 8 }} />
          {metric('division', `${sourceDiv}x`, accent)}
          <div style={{ fontSize: 8, color: dim, lineHeight: 1.45, marginTop: 10 }}>
            If Orbit Step rate is 1/4, stretch now targets T * 1/4, not the full orbit.
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Generic slot expanded panel ────────────────────────────────────────────────

function GenericSlotExpanded({ slotKey, cs, simple, onClose }: { slotKey: string; cs: ControlSet | null; simple: boolean; onClose?: () => void }) {
  const { rackParamOverrides, setSlotOverride } = useControlSetStore()
  const overrides = rackParamOverrides[slotKey] ?? {}
  const dim  = simple ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)'

  const hdrCol = simple ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.22)'

  if (!cs) return (
    <div style={{ padding:16, fontSize:10, color:dim }}>
      {onClose && <button onClick={onClose} style={{fontSize:9,color:hdrCol,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',marginBottom:8,display:'block'}}>▼ close</button>}
      No params
    </div>
  )

  const params = { ...cs.params, ...overrides }
  const numericParams = Object.entries(params).filter(([,v]) => typeof v === 'number')

  return (
    <div>
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 12px 4px', borderBottom:`0.5px solid ${simple?'rgba(0,0,0,0.07)':'rgba(255,255,255,0.06)'}` }}>
      {onClose && <button onClick={onClose} style={{fontSize:9,color:hdrCol,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',padding:'0 4px'}}>▼ close</button>}
      <span style={{fontSize:10,fontWeight:700,color:cs.color}}>{cs.icon} {cs.name}</span>
    </div>
    <div style={{ padding:'10px 16px', display:'flex', flexWrap:'wrap', gap:'6px 24px', alignContent:'flex-start' }}>
      {numericParams.map(([key, val]) => (
        <div key={key} style={{ display:'flex', alignItems:'center', gap:6, minWidth:240 }}>
          <span style={{ fontSize:8.5, color:dim, width:80, flexShrink:0, textAlign:'right' }}>{key.replace(/([A-Z])/g,' $1').toLowerCase()}</span>
          <input type="range" min={0} max={key.includes('Cutoff')?12000:key.includes('Rate')?20:1} step={0.01} value={Number(val)}
            onChange={e => setSlotOverride(slotKey, { [key]: parseFloat(e.target.value) })}
            style={{ flex:1, accentColor: cs.color }} />
          <span style={{ fontSize:8.5, fontFamily:'monospace', color:cs.color, width:40, textAlign:'right', flexShrink:0 }}>{Number(val).toFixed(2)}</span>
        </div>
      ))}
    </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function SamplerStretchExpanded({ bodyId, slotKey, simple, onClose }: { bodyId: string | null; slotKey: string; simple: boolean; onClose?: () => void }) {
  const _overrides = useControlSetStore(s => s.rackParamOverrides[slotKey] ?? EMPTY_PARAM_OVERRIDES)
  const setSlotOverride = useControlSetStore(s => s.setSlotOverride)
  const resetSlotParam = useControlSetStore(s => s.resetSlotParam)
  const getBodyEffectiveParams2 = useControlSetStore(s => s.getBodyEffectiveParams)
  const getBodyTriggerParamsList2 = useControlSetStore(s => s.getBodyTriggerParamsList)
  const effectiveParams = bodyId ? getBodyEffectiveParams2(bodyId) : null
  const _triggerParams = bodyId ? (getBodyTriggerParamsList2(bodyId)[0] ?? null) : null
  const bodies = usePlanetStore(s => s.bodies)
  const G = usePlanetStore(s => s.simParams.G)
  const body = bodyId ? (bodies.find(b => b.id === bodyId) ?? null) : null
  const targetExpression = String((effectiveParams as Record<string, unknown> | null)?.sampleTargetExpression ?? 'T')
  const resolvedSource = body ? resolveOrbitDurationSource(targetExpression, body, bodies) : null
  const orbitStats = resolvedSource ? computeOrbitStats(resolvedSource.body, bodies, G) : null
  const bufDurSec = bodyId ? (getBodyStretchSamplerEngine(bodyId)?.bufferDuration ?? 0) : 0
  const sourceSec = orbitStats ? orbitStats.T_real * (resolvedSource?.multiplier ?? 1) : null
  const numer = Math.max(1, Number((effectiveParams as Record<string, unknown> | null)?.orbitLoopNumer ?? 1))
  const denom = Math.max(1, Number((effectiveParams as Record<string, unknown> | null)?.orbitLoopDenom ?? 1))
  const stretchRatio = numer / denom
  const targetDurSec = sourceSec !== null && stretchRatio > 0 ? sourceSec * stretchRatio : null
  const playbackRate = bufDurSec > 0 && targetDurSec !== null && targetDurSec > 0 ? (bufDurSec / targetDurSec) : null
  const accent = '#818cf8'
  const dim = simple ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.38)'
  const dim2 = simple ? 'rgba(0,0,0,0.64)' : 'rgba(255,255,255,0.64)'
  const border = simple ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)'
  const panel = simple ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.04)'
  const progressRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const currentTimeRef = useRef<HTMLSpanElement>(null)
  const playStateRef = useRef<HTMLSpanElement>(null)
  const sourceMetricRef = useRef<HTMLDivElement>(null)
  const targetMetricRef = useRef<HTMLDivElement>(null)
  const rateMetricRef = useRef<HTMLDivElement>(null)
  const capturedExpressionRef = useRef<HTMLSpanElement>(null)
  const capturedAtRef = useRef<HTMLSpanElement>(null)
  const setPatch = (patch: Partial<PlanetSimParams>) => setSlotOverride(slotKey, patch)
  const sectionLabel = (label: string) => (
    <div style={{ fontSize: 8, fontWeight: 800, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
  )
  const metric = (
    label: string,
    value: string,
    color = dim2,
    valueRef?: { current: HTMLDivElement | null },
  ) => (
    <div style={{ border: `0.5px solid ${border}`, borderRadius: 5, background: panel, padding: '7px 8px' }}>
      <div style={{ fontSize: 8, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
      <div ref={valueRef} style={{ fontSize: 16, color, fontFamily: 'monospace', fontWeight: 800, lineHeight: 1 }}>{value}</div>
    </div>
  )

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const engine = bodyId ? getBodyStretchSamplerEngine(bodyId) : null
      const norm = engine?.getPlayheadNorm() ?? null
      const snapshot = engine?.timingSnapshot ?? null
      const heldTargetDur = norm !== null && engine && engine.playbackDuration > 0
        ? engine.playbackDuration
        : snapshot?.targetDuration ?? targetDurSec
      const progress = norm ?? 0
      if (progressRef.current) progressRef.current.style.width = `${progress * 100}%`
      if (playheadRef.current) {
        playheadRef.current.style.left = `${progress * 100}%`
        playheadRef.current.style.opacity = norm === null ? '0' : '1'
      }
      if (currentTimeRef.current) {
        currentTimeRef.current.textContent = heldTargetDur !== null
          ? `${(progress * heldTargetDur).toFixed(2)}s / ${heldTargetDur.toFixed(2)}s`
          : '— / —'
      }
      if (playStateRef.current) {
        playStateRef.current.textContent = norm === null ? 'IDLE' : 'PLAY'
        playStateRef.current.style.color = norm === null ? dim : '#22c55e'
      }
      if (snapshot) {
        if (sourceMetricRef.current) sourceMetricRef.current.textContent = `${snapshot.sourceDuration.toFixed(2)}s`
        if (targetMetricRef.current) targetMetricRef.current.textContent = `${snapshot.targetDuration.toFixed(2)}s`
        if (rateMetricRef.current) {
          const heldRate = bufDurSec > 0 && snapshot.targetDuration > 0 ? bufDurSec / snapshot.targetDuration : 0
          rateMetricRef.current.textContent = heldRate > 0 ? `×${heldRate.toFixed(3)}` : '—'
        }
        if (capturedExpressionRef.current) capturedExpressionRef.current.textContent = snapshot.expression
        if (capturedAtRef.current) {
          capturedAtRef.current.textContent = new Date(snapshot.capturedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [bodyId, targetDurSec, bufDurSec, dim])

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 12px 4px 48px', borderBottom:`0.5px solid ${border}`, flexShrink:0 }}>
        {onClose && <button onClick={onClose} style={{ fontSize:9, color:dim, background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', padding:'0 4px' }}>▼ close</button>}
        <span style={{ fontSize:10, fontWeight:700, color:accent }}>⟿ Sampler</span>
        <span style={{ fontSize:8, color:dim, marginLeft:4 }}>pitch-preserving time stretch</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 250px', gap: 16, padding: '12px 14px 12px 48px', minHeight: 180 }}>
        <div style={{ borderRight: `0.5px solid ${border}`, paddingRight: 14 }}>
          {sectionLabel('Loop ratio')}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ width: 54, fontSize: 8, color: dim, textAlign: 'right' }}>numer</span>
            <input type="number" min={1} max={16} step={1}
              value={numer}
              onChange={e => setPatch({ orbitLoopNumer: Math.max(1, Math.min(16, Number(e.target.value))) })}
              style={{ width: 44, fontSize: 11, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 4, padding: '4px 6px' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ width: 54, fontSize: 8, color: dim, textAlign: 'right' }}>denom</span>
            <input type="number" min={1} max={16} step={1}
              value={denom}
              onChange={e => setPatch({ orbitLoopDenom: Math.max(1, Math.min(16, Number(e.target.value))) })}
              style={{ width: 44, fontSize: 11, color: dim2, background: panel, border: `0.5px solid ${border}`, borderRadius: 4, padding: '4px 6px' }} />
          </div>
          <div style={{ fontSize: 9, color: dim, marginBottom: 10 }}>
            Sample is stretched to fit {numer}/{denom} orbit{numer !== 1 ? 's' : ''}.
          </div>
          <button
            onClick={() => { resetSlotParam(slotKey, 'orbitLoopNumer'); resetSlotParam(slotKey, 'orbitLoopDenom') }}
            style={{ width: '100%', fontSize: 8, color: dim, background: 'transparent', border: `0.5px solid ${border}`, borderRadius: 4, padding: '5px 7px', cursor: 'pointer', fontFamily: 'inherit' }}
          >reset loop ratio</button>
        </div>
        <div>
          {sectionLabel('Info')}
          <div style={{ marginBottom: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: 8, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Target playhead</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'monospace' }}>
                <span ref={playStateRef} style={{ fontSize: 7, fontWeight: 800, color: dim }}>IDLE</span>
                <span ref={currentTimeRef} style={{ fontSize: 9, color: dim2 }}>
                  {targetDurSec !== null ? `0.00s / ${targetDurSec.toFixed(2)}s` : '— / —'}
                </span>
              </div>
            </div>
            <div style={{ position: 'relative', height: 10, overflow: 'visible', borderRadius: 3, background: panel, border: `0.5px solid ${border}` }}>
              <div ref={progressRef} style={{ position: 'absolute', inset: '0 auto 0 0', width: '0%', borderRadius: 3, background: `${accent}45` }} />
              <div ref={playheadRef} style={{ position: 'absolute', top: -3, bottom: -3, left: '0%', width: 2, transform: 'translateX(-1px)', opacity: 0, background: accent, boxShadow: `0 0 5px ${accent}` }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {metric('Sample dur', bufDurSec > 0 ? `${bufDurSec.toFixed(2)}s` : '—')}
            {metric('Target dur', targetDurSec != null ? `${targetDurSec.toFixed(2)}s` : '—', dim2, targetMetricRef)}
            {metric('Rate', playbackRate != null ? `×${playbackRate.toFixed(3)}` : '—', accent, rateMetricRef)}
            {metric('Source', sourceSec != null ? `${sourceSec.toFixed(2)}s` : '—', dim2, sourceMetricRef)}
          </div>
          <div style={{ fontSize: 8, color: dim, lineHeight: 1.5, marginTop: 10 }}>
            preservesPitch: ピッチを維持したままブラウザのフェーズボコーダでテンポを変更。
          </div>
        </div>
        <div>
          {sectionLabel('Orbit source')}
          <input
            type="text"
            value={targetExpression}
            onChange={e => setPatch({ sampleTargetExpression: e.target.value })}
            placeholder="T"
            spellCheck={false}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              fontSize: 11,
              color: resolvedSource?.error ? '#fb7185' : dim2,
              fontFamily: 'monospace',
              background: panel,
              border: `0.5px solid ${resolvedSource?.error ? '#fb718588' : border}`,
              borderRadius: 4,
              padding: '6px 8px',
            }}
          />
          <div style={{ marginTop: 7, fontSize: 8, color: resolvedSource?.error ? '#fb7185' : dim, lineHeight: 1.45 }}>
            {resolvedSource?.error ?? `→ ${resolvedSource?.label ?? 'T'}`}
          </div>
          <div style={{ marginTop: 8, padding: '6px 7px', border: `0.5px solid ${border}`, borderRadius: 4, background: panel }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 8, marginBottom: 3 }}>
              <span style={{ color: dim, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Update</span>
              <span style={{ color: accent, fontFamily: 'monospace', fontWeight: 800 }}>ON TRIGGER</span>
            </div>
            <div style={{ fontSize: 8, color: dim, lineHeight: 1.45 }}>
              Source is sampled when triggered and held until playback ends.
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 5, fontSize: 7.5, fontFamily: 'monospace' }}>
              <span ref={capturedExpressionRef} style={{ color: dim2 }}>waiting for trigger</span>
              <span ref={capturedAtRef} style={{ color: dim }}>—</span>
            </div>
          </div>
          <div style={{ marginTop: 6, fontSize: 8, color: dim, fontFamily: 'monospace', lineHeight: 1.5 }}>
            {ORBIT_T_DEFINITION}<br />
            T/4 · T*2 · bodyId.T/8
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function LongSamplerExpanded({ bodyId, slotKey, simple, onClose }: { bodyId: string | null; slotKey: string; simple: boolean; onClose?: () => void }) {
  const overrides = useControlSetStore(s => s.rackParamOverrides[slotKey] ?? EMPTY_PARAM_OVERRIDES)
  const setSlotOverride = useControlSetStore(s => s.setSlotOverride)
  const getBodyEffectiveParams = useControlSetStore(s => s.getBodyEffectiveParams)
  const bodies = usePlanetStore(s => s.bodies)
  const body = bodyId ? bodies.find(candidate => candidate.id === bodyId) ?? null : null
  const effective = bodyId ? getBodyEffectiveParams(bodyId) as Record<string, unknown> : overrides as Record<string, unknown>
  const accent = '#ec4899'
  const dim = simple ? 'rgba(0,0,0,0.46)' : 'rgba(255,255,255,0.42)'
  const text = simple ? '#222' : '#e8e8ec'
  const border = simple ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.10)'
  const panel = simple ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.04)'
  const mode = String(effective.longSamplerDurationMode ?? 'seconds')
  const expression = String(effective.longSamplerDurationExpression ?? 'T')
  const resolved = body && mode === 'orbit' ? resolveOrbitDurationSource(expression, body, bodies) : null
  const setPatch = (patch: Partial<PlanetSimParams>) => setSlotOverride(slotKey, patch)
  const progressRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLSpanElement>(null)
  const detailRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const engine = bodyId ? getBodyLongSamplerEngine(bodyId) : null
      const norm = engine?.getPlayheadNorm() ?? null
      const snapshot = engine?.snapshot ?? null
      if (progressRef.current) progressRef.current.style.width = `${(norm ?? 0) * 100}%`
      if (playheadRef.current) {
        playheadRef.current.style.left = `${(norm ?? 0) * 100}%`
        playheadRef.current.style.opacity = norm === null ? '0' : '1'
      }
      if (statusRef.current) {
        statusRef.current.textContent = norm === null ? 'IDLE' : 'PLAY'
        statusRef.current.style.color = norm === null ? dim : '#22c55e'
      }
      if (detailRef.current) {
        detailRef.current.textContent = snapshot
          ? `${snapshot.startOffset.toFixed(1)}s → ${(snapshot.startOffset + snapshot.actualDuration).toFixed(1)}s · ${snapshot.actualDuration.toFixed(1)}s`
          : 'waiting for trigger'
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [bodyId, dim])

  const inputStyle: CSSProperties = {
    width: '100%', boxSizing: 'border-box', color: text, background: panel,
    border: `0.5px solid ${border}`, borderRadius: 4, padding: '5px 7px',
    fontSize: 10, fontFamily: 'inherit',
  }
  const label = (value: string) => (
    <div style={{ fontSize: 8, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>{value}</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 12px 4px 48px', borderBottom:`0.5px solid ${border}` }}>
        {onClose && <button onClick={onClose} style={{ fontSize:9, color:dim, background:'none', border:'none', cursor:'pointer', fontFamily:'inherit' }}>▼ close</button>}
        <span style={{ fontSize:10, fontWeight:800, color:accent }}>≋ Long Sampler</span>
        <span style={{ fontSize:8, color:dim }}>long-form phrase player</span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'230px 250px 1fr', gap:18, padding:'12px 16px 14px 48px', minHeight:190 }}>
        <div style={{ borderRight:`0.5px solid ${border}`, paddingRight:16 }}>
          {label('Duration')}
          <select value={mode} onChange={e => setPatch({ longSamplerDurationMode: e.target.value as 'seconds' | 'orbit' })} style={inputStyle}>
            <option value="seconds">Seconds</option>
            <option value="orbit">Orbit expression</option>
          </select>
          {mode === 'seconds' ? (
            <input type="number" min={0.1} max={600} step={1}
              value={Number(effective.longSamplerDurationSec ?? 30)}
              onChange={e => setPatch({ longSamplerDurationSec: Math.max(0.1, Number(e.target.value)) })}
              style={{ ...inputStyle, marginTop:7 }} />
          ) : (
            <>
              <input value={expression} onChange={e => setPatch({ longSamplerDurationExpression: e.target.value })}
                spellCheck={false} placeholder="T" style={{ ...inputStyle, marginTop:7, fontFamily:'monospace', color:resolved?.error ? '#fb7185' : text }} />
              <div style={{ fontSize:8, color:resolved?.error ? '#fb7185' : dim, marginTop:5 }}>
                {resolved?.error ?? `→ ${resolved?.label ?? expression}`}
              </div>
            </>
          )}
          <div style={{ marginTop:10, padding:'7px 8px', border:`0.5px solid ${border}`, borderRadius:4, background:panel }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:8 }}>
              <span style={{ color:dim }}>SOURCE UPDATE</span>
              <span style={{ color:accent, fontFamily:'monospace', fontWeight:800 }}>ON TRIGGER</span>
            </div>
            <div style={{ color:dim, fontSize:8, lineHeight:1.45, marginTop:5 }}>Duration is captured at trigger time and held for the segment.</div>
          </div>
        </div>

        <div style={{ borderRight:`0.5px solid ${border}`, paddingRight:16 }}>
          {label('Segment')}
          <select value={String(effective.longSamplerStartMode ?? 'random')}
            onChange={e => setPatch({ longSamplerStartMode: e.target.value as 'fixed' | 'random' })} style={inputStyle}>
            <option value="random">Random start</option>
            <option value="fixed">Fixed start</option>
          </select>
          {String(effective.longSamplerStartMode ?? 'random') === 'fixed' && (
            <div style={{ marginTop:8 }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:8, color:dim, marginBottom:3 }}>
                <span>START</span><span>{Math.round(Number(effective.longSamplerStart ?? 0) * 100)}%</span>
              </div>
              <input type="range" min={0} max={1} step={0.01} value={Number(effective.longSamplerStart ?? 0)}
                onChange={e => setPatch({ longSamplerStart: Number(e.target.value) })} style={{ width:'100%', accentColor:accent }} />
            </div>
          )}
          <div style={{ marginTop:8 }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:8, color:dim, marginBottom:3 }}>
              <span>PITCH</span><span>{Number(effective.longSamplerPitch ?? 0) > 0 ? '+' : ''}{Number(effective.longSamplerPitch ?? 0).toFixed(1)} st</span>
            </div>
            <input type="range" min={-3} max={3} step={0.1} value={Number(effective.longSamplerPitch ?? 0)}
              onChange={e => setPatch({ longSamplerPitch: Number(e.target.value) })} style={{ width:'100%', accentColor:accent }} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:8 }}>
            <div>{label('Fade in')}<input type="number" min={0} max={60} step={0.5} value={Number(effective.longSamplerFadeIn ?? 3)} onChange={e => setPatch({ longSamplerFadeIn:Number(e.target.value) })} style={inputStyle} /></div>
            <div>{label('Fade out')}<input type="number" min={0} max={60} step={0.5} value={Number(effective.longSamplerFadeOut ?? 5)} onChange={e => setPatch({ longSamplerFadeOut:Number(e.target.value) })} style={inputStyle} /></div>
          </div>
        </div>

        <div>
          {label('Trigger behavior')}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <div>
              <div style={{ fontSize:8, color:dim, marginBottom:4 }}>RETRIGGER</div>
              <select value={String(effective.longSamplerRetrigger ?? 'ignore')} onChange={e => setPatch({ longSamplerRetrigger:e.target.value as 'ignore'|'restart' })} style={inputStyle}>
                <option value="ignore">Ignore while playing</option>
                <option value="restart">Restart</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize:8, color:dim, marginBottom:4 }}>AFTER END</div>
              <select value={String(effective.longSamplerEndMode ?? 'oneshot')} onChange={e => setPatch({ longSamplerEndMode:e.target.value as 'oneshot'|'wander' })} style={inputStyle}>
                <option value="oneshot">One Shot</option>
                <option value="wander">Wander</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop:14, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:8, color:dim }}>CURRENT SEGMENT</span>
            <span ref={statusRef} style={{ fontSize:8, color:dim, fontWeight:800 }}>IDLE</span>
          </div>
          <div style={{ position:'relative', height:11, marginTop:6, borderRadius:3, background:panel, border:`0.5px solid ${border}` }}>
            <div ref={progressRef} style={{ position:'absolute', inset:'0 auto 0 0', width:'0%', background:`${accent}45`, borderRadius:3 }} />
            <div ref={playheadRef} style={{ position:'absolute', top:-3, bottom:-3, left:0, width:2, opacity:0, background:accent, boxShadow:`0 0 5px ${accent}` }} />
          </div>
          <span ref={detailRef} style={{ display:'block', marginTop:7, fontSize:9, color:text, fontFamily:'monospace' }}>waiting for trigger</span>
          <div style={{ marginTop:8, fontSize:8, color:dim, lineHeight:1.5 }}>
            Ignore keeps the current phrase intact. Wander selects another random segment after the current one ends.
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function SlotCard({
  cs, slotKey, simple, onClear, bodyId = null, onExtend, ghost = false,
  expandedSlotKey, onToggleExpand,
}: {
  cs: ControlSet; slotKey: string; simple: boolean; onClear: () => void; bodyId?: string | null; onExtend?: () => void; ghost?: boolean
  expandedSlotKey?: string | null; onToggleExpand?: (key: string) => void
}) {
  const overrides     = useControlSetStore(s => s.rackParamOverrides[slotKey] ?? EMPTY_PARAM_OVERRIDES)
  const setSlotOverride = useControlSetStore(s => s.setSlotOverride)
  const resetSlotParam  = useControlSetStore(s => s.resetSlotParam)

  const accent   = cs.color
  const dimText  = simple ? 'rgba(0,0,0,0.32)' : 'rgba(255,255,255,0.28)'
  const inputBg  = simple ? 'rgba(0,0,0,0.04)'  : 'rgba(255,255,255,0.05)'
  const inputCol = simple ? '#333'               : '#e0e0e0'

  // ── Orbit mode detection (instrument-pad-drone only) ──────────────────────
  const isDronePad = cs.id === 'instrument-pad-drone'
  const effectiveDroneMode = isDronePad
    ? String((overrides as Record<string, unknown>)['droneMode'] ?? cs.params.droneMode ?? 'manual')
    : 'manual'
  const isOrbitMode = isDronePad && effectiveDroneMode === 'orbit'

  // ── Sampler detection (instrument-sampler only) ───────────────────────────
  const isSampler = cs.id === 'instrument-sampler'
  const isLongSampler = cs.id === 'instrument-long-sampler'
  const effectiveSamplerType = isSampler
    ? String((overrides as Record<string, unknown>)['samplerType'] ?? cs.params.samplerType ?? 'off')
    : 'off'
  const isSamplerOn = isSampler && effectiveSamplerType === 'sampler'
  const effectiveSamplerMode = isSampler
    ? String((overrides as Record<string, unknown>)['samplerMode'] ?? cs.params.samplerMode ?? 'auto')
    : 'auto'
  const isSamplerFixed = isSampler && effectiveSamplerMode === 'fixed'

  // ── Granular active detection ──────────────────────────────────────────────
  const isGranular = cs.id === 'instrument-granular'
  const effectiveGranularType = isGranular
    ? String((overrides as Record<string, unknown>)['granularType'] ?? cs.params.granularType ?? 'off')
    : 'off'
  const isGranularOn = isGranular && effectiveGranularType === 'grain'

  // ── FM drone active detection ──────────────────────────────────────────────
  const isFMDrone = cs.id === 'instrument-fm-drone'
  const effectiveFMType = isFMDrone
    ? String((overrides as Record<string, unknown>)['fmDroneType'] ?? cs.params.fmDroneType ?? 'off')
    : 'off'
  const isFMOn = isFMDrone && effectiveFMType === 'fm'

  // ── Noise pad active detection ─────────────────────────────────────────────
  const isNoisePad = cs.id === 'instrument-noise-pad'
  const effectiveNoiseType = isNoisePad
    ? String((overrides as Record<string, unknown>)['noisePadType'] ?? cs.params.noisePadType ?? 'off')
    : 'off'
  const isNoiseOn = isNoisePad && effectiveNoiseType === 'noise'

  // ── One-shot active detection ──────────────────────────────────────────────
  const isOneShot = cs.id === 'instrument-oneshot' || cs.id === 'instrument-oneshot-stretch' || cs.id === 'instrument-sampler' || isLongSampler
  const isWaveLab = cs.id === 'instrument-wave-lab'

  // ── Osc Synth active detection ─────────────────────────────────────────────
  const isOscSynth        = cs.id === 'instrument-osc-synth'
  const isOscSynthOrbit   = cs.id === 'instrument-osc-synth-orbit'
  const effectiveOscSynthType = (isOscSynth || isOscSynthOrbit)
    ? String((overrides as Record<string, unknown>)['oscSynthType'] ?? cs.params.oscSynthType ?? 'off')
    : 'off'
  const isOscSynthOn = (isOscSynth || isOscSynthOrbit) && effectiveOscSynthType === 'osc-synth'

  // ── Osc Synth Orbit: live orbit stats ─────────────────────────────────────
  const [oscOrbitStats, setOscOrbitStats] = useState<ReturnType<typeof computeOrbitStats>>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isOscSynthOrbit || !bodyId) { setOscOrbitStats(null); return }
    const poll = () => {
      const { bodies: bs, simParams: sp } = usePlanetStore.getState()
      const liveBodies = getPlanetLiveBodySnapshot()
      const liveById   = new Map(liveBodies.map(b => [b.id, b]))
      const eff = bs.map(b => { const l = liveById.get(b.id); return l ? { ...b, x: l.x, y: l.y, vx: l.vx, vy: l.vy, ax: l.ax, ay: l.ay } : b })
      const lb  = eff.find(b => b.id === bodyId)
      setOscOrbitStats(lb ? computeOrbitStats(lb, eff, sp.G) : null)
    }
    poll()
    const id = window.setInterval(poll, 100)
    return () => window.clearInterval(id)
  }, [isOscSynthOrbit, bodyId])   

  function oscEp(key: string, dflt: unknown): unknown {
    const ov = overrides as Record<string, unknown>
    return key in ov ? ov[key] : (cs.params as Record<string, unknown>)[key] ?? dflt
  }

  function oscLiveVal(entry: OscOrbitEntry): number | null {
    const src = String(oscEp(entry.srcKey, entry.dfltSrc))
    if (src === 'manual' || !oscOrbitStats) return null
    const rate = Number(oscEp(entry.rateKey, entry.dfltRate))
    let raw: number
    switch (src) {
      case 'period':       raw = oscOrbitStats.T_real * rate; break
      case 'eccentricity': raw = oscOrbitStats.ecc    * rate; break
      case 'distance':     raw = oscOrbitStats.r      * rate; break
      case 'velocity':
      case 'speed':        raw = oscOrbitStats.speed  * rate; break
      case 'acceleration': raw = oscOrbitStats.acc    * rate; break
      case 'bound':        raw = (oscOrbitStats.bound ? 1 : 0) * rate; break
      default: return null
    }
    if (!isFinite(raw)) return null
    return Math.max(entry.min, Math.min(entry.max, raw))
  }

  // ── Orbit trigger detection ────────────────────────────────────────────────
  const isOrbitTrigger = cs.id === 'orbit'

  // ── Manual trigger detection ───────────────────────────────────────────────
  const isManualTrigger    = cs.id === 'trigger-manual'
  const isChordTestTrigger = cs.id === 'trigger-chord-test'
  const isArpTrigger       = cs.id === 'trigger-arpeggio' || cs.id === 'note-arpeggio'

  // ── Loaded samples (for sample dropdown) ──────────────────────────────────
  const loadedSamples = useProjectStore(s => s.project.samples)
  const defaultSamples = loadedSamples.filter(isBuiltinSample)
  const localSamples = loadedSamples.filter(sample => !isBuiltinSample(sample))

  return (
    <div style={{
      position: 'relative',
      borderRadius: 6,
      border: ghost ? `0.5px dashed ${accent}40` : `0.5px solid ${accent}55`,
      background: ghost ? `${accent}07` : `${accent}10`,
      display: 'flex', flexDirection: 'column', padding: '5px 10px 5px 7px', gap: 3,
      opacity: ghost ? 0.58 : 1,
      pointerEvents: 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
        {/* Ableton-style expand triangle — top-left */}
        {onToggleExpand && (
          <button
            title={expandedSlotKey === slotKey ? 'Collapse' : 'Expand'}
            onClick={e => { e.stopPropagation(); onToggleExpand(slotKey) }}
            style={{
              width: 12, height: 12, padding: 0, border: 'none', background: 'transparent',
              cursor: 'pointer', flexShrink: 0, lineHeight: 1,
              fontSize: 8, color: expandedSlotKey === slotKey ? accent : dimText,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transform: expandedSlotKey === slotKey ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s, color 0.15s',
            }}
          >▶</button>
        )}
        <span style={{ fontSize: 13, lineHeight: 1 }}>{cs.icon}</span>
        <span style={{
          fontSize: 8.5, fontWeight: 700, color: accent, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          letterSpacing: '0.02em',
        }}>{cs.name}</span>
        {ghost ? (
          <span style={{ fontSize: 6, color: dimText, letterSpacing: '0.07em', textTransform: 'uppercase', fontWeight: 700 }}>global</span>
        ) : (
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: accent, boxShadow: `0 0 5px ${accent}` }} />
        )}
        {!ghost && (isSampler || isLongSampler) && onExtend && (
          <button
            title="Open sampler editor"
            onClick={e => { e.stopPropagation(); onExtend() }}
            style={{
              width: 16, height: 16, border: `0.5px solid ${accent}55`, background: `${accent}18`,
              borderRadius: 3, cursor: 'pointer',
              fontSize: 9, lineHeight: 1, padding: 0, color: accent, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = `${accent}35`)}
            onMouseLeave={e => (e.currentTarget.style.background = `${accent}18`)}
          >↗</button>
        )}
        {!ghost && (
          <button
            title="Remove"
            onClick={e => { e.stopPropagation(); onClear() }}
            style={{
              width: 13, height: 13, border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 11, lineHeight: 1, padding: 0, color: dimText,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
            onMouseLeave={e => (e.currentTarget.style.color = dimText)}
          >×</button>
        )}
      </div>

      <div style={{ height: '0.5px', background: accent + '30', margin: '0 -1px 1px' }} />

      {/* Inline one-shot content — replaces the params loop for one-shot slots */}
      {isOneShot && (
        <InlineOneShotContent bodyId={bodyId} slotKey={slotKey} simple={simple} accent={accent}
          isStretch={cs.id === 'instrument-oneshot-stretch' || cs.id === 'instrument-sampler'}
          isSamplerStretch={cs.id === 'instrument-sampler'}
          isLongSampler={isLongSampler} />
      )}

      {isWaveLab && (
        <InlineWaveLabContent bodyId={bodyId} slotKey={slotKey} cs={cs} simple={simple} accent={accent} />
      )}

      {/* Osc Synth test-note button */}
      {isOscSynthOn && (
        <InlineOscSynthContent bodyId={bodyId} simple={simple} accent={accent} />
      )}

      {/* Editable params */}
      {!isOneShot && Object.entries(cs.params).map(([key, baseVal]) => {
        const cfg = PARAM_CFG[key]
        if (!cfg) return null
        // In orbit mode, orbit-driven params are computed live — skip manual inputs
        if (isOrbitMode && ORBIT_DRIVEN_PARAM_KEYS.has(key)) return null
        // Sampler sub-params: only when samplerType is 'sampler'
        if ([
          'samplerMode','samplerVolume','samplerPlayMode',
          'samplerSampleStart','samplerSampleEnd','samplerLoopStart','samplerLoopEnd',
          'samplerReverse','samplerDetune','samplerAttack','samplerRelease','samplerReverbMix',
        ].includes(key) && !isSamplerOn) return null
        // Only show samplerSampleId when sampler is on AND mode is 'fixed'
        if (key === 'samplerSampleId' && !(isSamplerOn && isSamplerFixed)) return null
        // When sampler is on, 2-col sub-params render in the dedicated block below
        if (isSamplerOn && SAMPLER_2COL_KEYS.has(key)) return null
        // Granular sub-params: only when granularType is 'grain'
        if (['granularVolume','granularGrainSize','granularOverlap','granularDetune','granularReverbMix'].includes(key) && !isGranularOn) return null
        // FM sub-params: only when fmDroneType is 'fm'
        if (['fmDroneRootNote','fmDroneRatio','fmDroneIndex','fmDroneVolume','fmDroneAttack','fmDroneRelease','fmDroneReverbMix'].includes(key) && !isFMOn) return null
        // Noise sub-params: only when noisePadType is 'noise'
        if (['noisePadVolume','noisePadFreq','noisePadQ','noisePadAttack','noisePadRelease','noisePadReverbMix'].includes(key) && !isNoiseOn) return null
        // Arpeggio's main controls are rendered by InlineArpContent and ArpeggioExpanded.
        if (isArpTrigger) return null
        // Osc Synth sub-params: only when oscSynthType is 'osc-synth'
        if (['oscSynthWaveform','oscSynthAttack','oscSynthDecay','oscSynthSustain','oscSynthRelease',
             'oscSynthFilterCutoff','oscSynthFilterResonance','oscSynthLevel',
             'oscSynthLfoTarget','oscSynthLfoRate','oscSynthLfoDepth','oscSynthLfoWaveform'].includes(key) && !isOscSynthOn) return null
        // When OscSynth is on, 2-col sub-params render in the dedicated block below
        if (isOscSynthOn && OSC_SYNTH_ORBIT_2COL_KEYS.has(key)) return null
        const isOv    = key in overrides
        const val     = isOv ? (overrides as Record<string, unknown>)[key] : baseVal
        const labelCol = isOv ? accent : dimText
        const bdr      = isOv ? `0.5px solid ${accent}55` : `0.5px solid ${simple ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)'}`
        const bg       = isOv ? `${accent}14` : inputBg

        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 3, minHeight: 17 }}>
            <span style={{ fontSize: 7.5, color: labelCol, fontWeight: isOv ? 700 : 400, width: 42, flexShrink: 0, textAlign: 'right', letterSpacing: '0.02em', lineHeight: 1 }}>
              {cfg.label}
            </span>
            {cfg.type === 'boolean' && (
              <button
                onClick={() => {
                  const nv = !val
                  if (nv === baseVal) resetSlotParam(slotKey, key)
                  else setSlotOverride(slotKey, { [key]: nv } as Partial<PlanetSimParams>)
                }}
                style={{ flex: 1, fontSize: 7.5, padding: '2px 4px', border: bdr, borderRadius: 3, cursor: 'pointer', background: val ? `${accent}22` : bg, color: val ? accent : dimText, fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.04em', lineHeight: 1 }}
              >{val ? 'ON' : 'OFF'}</button>
            )}
            {cfg.type === 'number' && (
              <input type="number" value={val as number}
                min={(cfg as ParamCfgNum).min} max={(cfg as ParamCfgNum).max} step={(cfg as ParamCfgNum).step}
                onChange={e => {
                  const n = Number(e.target.value)
                  if (n === baseVal) resetSlotParam(slotKey, key)
                  else setSlotOverride(slotKey, { [key]: n } as Partial<PlanetSimParams>)
                }}
                style={{ flex: 1, minWidth: 0, fontSize: 8.5, fontFamily: 'monospace', textAlign: 'right', border: bdr, borderRadius: 3, padding: '1px 3px', background: bg, color: inputCol }}
              />
            )}
            {cfg.type === 'select' && (
              <select value={String(val)}
                onChange={e => {
                  const raw = e.target.value
                  const v = (cfg as ParamCfgSel).numeric ? Number(raw) : raw
                  if (v === baseVal || raw === String(baseVal)) resetSlotParam(slotKey, key)
                  else setSlotOverride(slotKey, { [key]: v } as Partial<PlanetSimParams>)
                }}
                style={{ flex: 1, minWidth: 0, fontSize: 8, border: bdr, borderRadius: 3, padding: '1px 2px', background: bg, color: inputCol, fontFamily: 'inherit' }}
              >
                {(cfg as ParamCfgSel).options.map((opt, i) => (
                  <option key={opt} value={opt}>{(cfg as ParamCfgSel).optionLabels?.[i] ?? opt}</option>
                ))}
              </select>
            )}
            {cfg.type === 'sample' && (
              <select
                value={String(val ?? '')}
                onChange={e => {
                  const id = e.target.value || null
                  if (id === baseVal) resetSlotParam(slotKey, key)
                  else setSlotOverride(slotKey, { [key]: id } as Partial<PlanetSimParams>)
                }}
                style={{ flex: 1, minWidth: 0, fontSize: 8, border: bdr, borderRadius: 3, padding: '1px 2px', background: bg, color: loadedSamples.length ? inputCol : dimText, fontFamily: 'inherit' }}
              >
                <option value="">— auto</option>
                {defaultSamples.length > 0 && (
                  <optgroup label="Default">
                    {defaultSamples.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                )}
                {localSamples.length > 0 && (
                  <optgroup label="Local">
                    {localSamples.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
          </div>
        )
      })}

      {/* Sampler 2-column param grid */}
      {isSamplerOn && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 5px' }}>
          {SAMPLER_2COL_ORDER.map((key, idx) => {
            if (!key) return <div key={`_empty_${idx}`} />
            const cfg = PARAM_CFG[key]
            if (!cfg) return null
            const isOv    = key in overrides
            const baseVal = (cs.params as Record<string, unknown>)[key]
            const val     = isOv ? (overrides as Record<string, unknown>)[key] : baseVal
            const labelCol = isOv ? accent : dimText
            const bdr      = isOv ? `0.5px solid ${accent}55` : `0.5px solid ${simple ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)'}`
            const bg       = isOv ? `${accent}14` : inputBg
            const label2   = SAMPLER_2COL_LABELS[key] ?? cfg.label
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 17, minWidth: 0 }}>
                <span style={{
                  fontSize: 7, color: labelCol, fontWeight: isOv ? 700 : 400,
                  width: 24, flexShrink: 0, textAlign: 'right',
                  letterSpacing: '0.02em', lineHeight: 1,
                  overflow: 'hidden', whiteSpace: 'nowrap',
                }}>
                  {label2}
                </span>
                {cfg.type === 'boolean' && (
                  <button
                    onClick={() => {
                      const nv = !val
                      if (nv === baseVal) resetSlotParam(slotKey, key)
                      else setSlotOverride(slotKey, { [key]: nv } as Partial<PlanetSimParams>)
                    }}
                    style={{ flex: 1, minWidth: 0, fontSize: 7.5, padding: '2px 4px', border: bdr, borderRadius: 3, cursor: 'pointer', background: val ? `${accent}22` : bg, color: val ? accent : dimText, fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.04em', lineHeight: 1 }}
                  >{val ? 'ON' : 'OFF'}</button>
                )}
                {cfg.type === 'number' && (
                  <input type="number" value={val as number}
                    min={(cfg as ParamCfgNum).min} max={(cfg as ParamCfgNum).max} step={(cfg as ParamCfgNum).step}
                    onChange={e => {
                      const n = Number(e.target.value)
                      if (n === baseVal) resetSlotParam(slotKey, key)
                      else setSlotOverride(slotKey, { [key]: n } as Partial<PlanetSimParams>)
                    }}
                    style={{ flex: 1, minWidth: 0, fontSize: 8, fontFamily: 'monospace', textAlign: 'right', border: bdr, borderRadius: 3, padding: '1px 3px', background: bg, color: inputCol }}
                  />
                )}
                {cfg.type === 'select' && (
                  <select value={String(val)}
                    onChange={e => {
                      const raw = e.target.value
                      const v = (cfg as ParamCfgSel).numeric ? Number(raw) : raw
                      if (v === baseVal || raw === String(baseVal)) resetSlotParam(slotKey, key)
                      else setSlotOverride(slotKey, { [key]: v } as Partial<PlanetSimParams>)
                    }}
                    style={{ flex: 1, minWidth: 0, fontSize: 7.5, border: bdr, borderRadius: 3, padding: '1px 2px', background: bg, color: inputCol, fontFamily: 'inherit' }}
                  >
                    {(cfg as ParamCfgSel).options.map((opt, i) => (
                      <option key={opt} value={opt}>{(cfg as ParamCfgSel).optionLabels?.[i] ?? opt}</option>
                    ))}
                  </select>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* OscSynth 2-column param grid */}
      {isOscSynthOn && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 5px' }}>
          {OSC_SYNTH_ORBIT_2COL_ORDER.map((key, idx) => {
            const cfg = PARAM_CFG[key]
            if (!cfg) return <div key={`_e${idx}`} />
            const isOv    = key in overrides
            const baseVal = (cs.params as Record<string, unknown>)[key]
            const val     = isOv ? (overrides as Record<string, unknown>)[key] : baseVal
            const labelCol = isOv ? accent : dimText
            const bdr      = isOv ? `0.5px solid ${accent}55` : `0.5px solid ${simple ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)'}`
            const bg       = isOv ? `${accent}14` : inputBg
            const label2   = OSC_SYNTH_2COL_LABELS[key] ?? cfg.label
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 17, minWidth: 0 }}>
                <span style={{
                  fontSize: 7, color: labelCol, fontWeight: isOv ? 700 : 400,
                  width: 26, flexShrink: 0, textAlign: 'right',
                  letterSpacing: '0.02em', lineHeight: 1,
                  overflow: 'hidden', whiteSpace: 'nowrap',
                }}>
                  {label2}
                </span>
                {cfg.type === 'number' && (
                  <input type="number" value={val as number}
                    min={(cfg as ParamCfgNum).min} max={(cfg as ParamCfgNum).max} step={(cfg as ParamCfgNum).step}
                    onChange={e => {
                      const n = Number(e.target.value)
                      if (n === baseVal) resetSlotParam(slotKey, key)
                      else setSlotOverride(slotKey, { [key]: n } as Partial<PlanetSimParams>)
                    }}
                    style={{ flex: 1, minWidth: 0, fontSize: 9, fontFamily: 'monospace', textAlign: 'right', border: bdr, borderRadius: 3, padding: '3px 3px', background: bg, color: inputCol }}
                  />
                )}
                {cfg.type === 'select' && (
                  <select value={String(val)}
                    onChange={e => {
                      const raw = e.target.value
                      const v = (cfg as ParamCfgSel).numeric ? Number(raw) : raw
                      if (v === baseVal || raw === String(baseVal)) resetSlotParam(slotKey, key)
                      else setSlotOverride(slotKey, { [key]: v } as Partial<PlanetSimParams>)
                    }}
                    style={{ flex: 1, minWidth: 0, fontSize: 8, border: bdr, borderRadius: 3, padding: '2px 2px', background: bg, color: inputCol, fontFamily: 'inherit' }}
                  >
                    {(cfg as ParamCfgSel).options.map((opt, i) => (
                      <option key={opt} value={opt}>{(cfg as ParamCfgSel).optionLabels?.[i] ?? opt}</option>
                    ))}
                  </select>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* OscSynth Orbit: oscilloscope + source/rate controls + live computed values */}
      {isOscSynthOrbit && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Oscilloscope */}
          <OscScope bodyId={bodyId ?? null} accent={accent} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '5px 0 2px' }}>
            <div style={{ flex: 1, height: '0.5px', background: accent + '30' }} />
            <span style={{ fontSize: 6, fontWeight: 800, color: dimText, textTransform: 'uppercase', letterSpacing: '0.10em', lineHeight: 1 }}>orbit map</span>
            <div style={{ flex: 1, height: '0.5px', background: accent + '30' }} />
          </div>
          {/* Live orbit stats */}
          {oscOrbitStats ? (
            <div style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
              {([
                { k: 'T', v: `${oscOrbitStats.T_real.toFixed(1)}s` },
                { k: 'ε', v: oscOrbitStats.ecc.toFixed(2) },
                { k: 'r', v: `${Math.round(oscOrbitStats.r)}` },
                { k: 'v', v: oscOrbitStats.speed.toFixed(1) },
                { k: 'B', v: oscOrbitStats.bound ? '1' : '0' },
              ] as const).map(({ k, v }) => (
                <div key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                  <span style={{ fontSize: 6, color: dimText, lineHeight: 1 }}>{k}</span>
                  <span style={{ fontSize: 7.5, fontFamily: 'monospace', color: accent, lineHeight: 1, opacity: 0.85 }}>{v}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 6.5, color: dimText, fontStyle: 'italic', marginBottom: 3 }}>{bodyId ? 'no orbit' : 'no body'}</div>
          )}
          {/* Per-param rows */}
          {OSC_ORBIT_MAP_ENTRIES.map(entry => {
            const src  = String(oscEp(entry.srcKey,  entry.dfltSrc))
            const rate = Number(oscEp(entry.rateKey, entry.dfltRate))
            const live = oscLiveVal(entry)
            const isOrbit = src !== 'manual'
            const srcBg  = isOrbit ? `${accent}14` : inputBg
            const srcBdr = isOrbit ? `0.5px solid ${accent}55` : `0.5px solid ${simple ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)'}`
            return (
              <div key={entry.key} style={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 16 }}>
                <span style={{ fontSize: 7, fontWeight: isOrbit ? 700 : 400, color: isOrbit ? accent : dimText, width: 20, textAlign: 'right', flexShrink: 0, lineHeight: 1 }}>
                  {entry.label}
                </span>
                <select
                  value={src}
                  onChange={e => setSlotOverride(slotKey, { [entry.srcKey]: e.target.value } as Partial<PlanetSimParams>)}
                  style={{ width: 30, fontSize: 7.5, border: srcBdr, borderRadius: 3, padding: '1px 1px', background: srcBg, color: isOrbit ? accent : inputCol, fontFamily: 'inherit' }}
                >
                  {Object.entries(OSC_SRC_ABBREV).map(([val, lbl]) => (
                    <option key={val} value={val}>{lbl}</option>
                  ))}
                </select>
                <span style={{ fontSize: 6.5, color: dimText, lineHeight: 1, flexShrink: 0 }}>×</span>
                <input
                  type="number"
                  value={rate}
                  min={0.0001} step={0.01}
                  onChange={e => setSlotOverride(slotKey, { [entry.rateKey]: Number(e.target.value) } as Partial<PlanetSimParams>)}
                  style={{ width: 40, fontSize: 7.5, fontFamily: 'monospace', textAlign: 'right', border: `0.5px solid ${simple ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)'}`, borderRadius: 3, padding: '1px 2px', background: inputBg, color: inputCol }}
                />
                {live !== null ? (
                  <>
                    <span style={{ fontSize: 6.5, color: accent, opacity: 0.6, lineHeight: 1, flexShrink: 0 }}>→</span>
                    <span style={{ fontSize: 7.5, fontFamily: 'monospace', color: accent, lineHeight: 1, minWidth: 36, textAlign: 'right' }}>
                      {entry.precision === 0
                        ? `${Math.round(live)}${entry.unit}`
                        : `${live.toFixed(entry.precision)}${entry.unit}`}
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 6.5, color: dimText, opacity: 0.4, lineHeight: 1, marginLeft: 4 }}>—</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Manual trigger button — always visible when trigger-manual is assigned */}
      {isManualTrigger && (
        <button
          onClick={() => {
            // Resolve target: use the slot's bodyId, or fall back to the store's selected body
            const state = usePlanetStore.getState()
            const targetId = bodyId || state.selectedBodyId
            if (!targetId) return

            // 1. Flash the signal bridge (trigger age indicator)
            markBodyTriggered(targetId)
            // 2. Send MIDI note-on OUT (Note On = one-shot sample trigger)
            const body = state.bodies.find(b => b.id === targetId)
            sendMidiNote(
              body?.midiChannel  ?? 1,
              body?.midiNote     ?? 60,
              body?.midiVelocity ?? 100,
              200,
            )
            // 3. Direct internal playback (no MIDI loopback required)
            fireBodyInstrumentTrigger(targetId)
          }}
          style={{
            width: '100%', height: 30, marginTop: 2,
            border: `1px solid ${accent}`,
            borderRadius: 4, cursor: 'pointer',
            background: `${accent}18`,
            color: accent,
            fontFamily: 'inherit', fontWeight: 700, fontSize: 10,
            letterSpacing: '0.08em',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = `${accent}30`)}
          onMouseLeave={e => (e.currentTarget.style.background = `${accent}18`)}
        >
          ▶ TRIGGER
        </button>
      )}

      {/* Chord test trigger — C3 / E3 / G3 buttons */}
      {isChordTestTrigger && (
        <InlineChordTestContent bodyId={bodyId} simple={simple} accent={accent} />
      )}

      {/* Arpeggio trigger — 4-step note sequencer */}
      {isArpTrigger && (
        <InlineArpContent bodyId={bodyId} slotKey={slotKey} simple={simple} accent={accent} />
      )}

      {/* Orbit trigger: live orbit data flowing into this trigger */}
      {isOrbitTrigger && (() => {
        const triggerType = String((overrides as Record<string, unknown>).orbitTriggerType ?? cs.params.orbitTriggerType ?? 'cumulative')
        const division    = Number((overrides as Record<string, unknown>).orbitTriggerDivision ?? cs.params.orbitTriggerDivision ?? 1)
        return (
          <OrbitInputBlock
            bodyId={bodyId} dimText={dimText} accent={accent}
            triggerType={triggerType} division={division}
          />
        )
      })()}

      {/* Orbit mode live parameter readout (instrument-pad-drone only) */}
      {isOrbitMode && (
        <>
          <div style={{ height: '0.5px', background: accent + '30', margin: '2px -1px 1px' }} />
          <OrbitDroneBlock bodyId={bodyId} dimText={dimText} />
        </>
      )}

      {/* Slot-level indicator (right edge): flash for triggers, VU bar for instruments/effects) */}
      {bodyId && (
        cs.category === 'trigger'
          ? <TriggerFlashDot bodyId={bodyId} accent={accent} />
          : <SlotMeterStrip bodyId={bodyId} accent={accent} simple={simple} />
      )}
    </div>
  )
}

// ── Empty slot placeholder (non-interactive — rack handles all drops) ─────────

function EmptySlot({ simple, highlighted }: { simple: boolean; highlighted: boolean }) {
  const col = highlighted
    ? (simple ? 'rgba(0,0,0,0.40)' : 'rgba(255,255,255,0.50)')
    : (simple ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)')
  return (
    <div style={{
      borderRadius: 6,
      border: `0.5px dashed ${col}`,
      background: highlighted ? (simple ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)') : 'transparent',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '6px 8px', minHeight: 32,
      transition: 'border-color 0.12s, background 0.12s',
      pointerEvents: 'none',
    }}>
      <span style={{ fontSize: 11, color: col }}>+</span>
    </div>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ label, simple, highlighted = false }: { label: string; simple: boolean; highlighted?: boolean }) {
  const col = highlighted
    ? (simple ? 'rgba(37,99,235,0.60)' : 'rgba(99,102,241,0.75)')
    : (simple ? 'rgba(0,0,0,0.30)'      : 'rgba(255,255,255,0.20)')
  return (
    <div style={{
      fontSize: 7, fontWeight: highlighted ? 900 : 800, letterSpacing: '0.12em', textTransform: 'uppercase',
      color: col,
      padding: '0 2px', flexShrink: 0, writingMode: 'vertical-rl',
      transform: 'rotate(180deg)', userSelect: 'none',
      transition: 'color 0.12s, font-weight 0.12s',
    }}>{label}</div>
  )
}

// ── Rack Inspector Column (left edge) ────────────────────────────────────────

function UniverseRackIndicator({ simple }: { simple: boolean }) {
  const bodies = usePlanetStore(s => s.bodies)
  const dimText = simple ? 'rgba(0,0,0,0.38)' : 'rgba(255,255,255,0.28)'
  const accent  = simple ? '#6366f1' : '#818cf8'

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '20px 16px', gap: 10, userSelect: 'none',
    }}>
      {/* Glyph */}
      <div style={{
        fontSize: 32, lineHeight: 1, opacity: 0.55,
        color: accent, filter: `drop-shadow(0 0 8px ${accent}88)`,
      }}>
        ⊙
      </div>
      {/* Title */}
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: accent, opacity: 0.75,
      }}>
        Universe Rack
      </div>
      {/* Divider */}
      <div style={{ width: 40, height: '0.5px', background: accent, opacity: 0.25 }} />
      {/* Description */}
      <div style={{ fontSize: 8.5, color: dimText, textAlign: 'center', lineHeight: 1.6 }}>
        すべての天体が共有する<br />グローバルラック設定
      </div>
      {/* Stats */}
      <div style={{
        fontSize: 8, color: dimText, opacity: 0.65,
        fontFamily: 'monospace', letterSpacing: '0.04em',
      }}>
        {bodies.length} {bodies.length === 1 ? 'body' : 'bodies'}
      </div>
    </div>
  )
}

function RackBodyCentroidColumn({ simple, inspectorExpanded, onToggleInspector }: { simple: boolean; inspectorExpanded: boolean; onToggleInspector: () => void }) {
  const { bodies, simParams, selectedBodyId, setSelectedBodyId, updateSimParams, cameraFollowBodyId, setCameraFollowBodyId } = usePlanetStore()
  const body = selectedBodyId ? bodies.find(b => b.id === selectedBodyId) : null
  const border   = simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)'
  const accentCol = simple ? '#2563eb' : '#7c3aed'
  const textCol   = simple ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.88)'
  const dimCol    = simple ? 'rgba(0,0,0,0.4)'  : 'rgba(255,255,255,0.35)'
  const btnBg     = simple ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.07)'

  const [oscData, setOscData] = useState<Float32Array | null>(null)
  const rafRef = useRef<number>(0)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!body) { setOscData(null); return }
    const poll = () => {
      if (simParams.showRackBodyOscilloscope) {
        const data = getBusOscilloscopeData(body.id)
        setOscData(data ? new Float32Array(data) : null)
      } else {
        setOscData(null)
      }
      rafRef.current = requestAnimationFrame(poll)
    }
    rafRef.current = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(rafRef.current)
  }, [body?.id, body, simParams.showRackBodyOscilloscope])

  const isSP        = body ? simParams.standpointBodyId === body.id : false
  const isFollowing = body ? cameraFollowBodyId === body.id : false

  return (
    <div style={{
      width: 128, flexShrink: 0, minHeight: 0,
      display: 'flex', flexDirection: 'column',
      borderRight: `0.5px solid ${border}`,
    }}>
      {/* Column header */}
      <div style={{
        padding: '4px 8px 3px', flexShrink: 0,
        fontSize: 6.5, fontWeight: 800, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: accentCol, lineHeight: 1,
        borderBottom: `0.5px solid ${border}`,
      }}>
        ● body
      </div>

      {/* Body content row: centroid area + thin edit strip on right */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>

        {body ? (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '12px 8px', gap: 8, minWidth: 0,
          }}>
            {/* Large rack sigil */}
            <button
              type="button"
              onClick={() => setSelectedBodyId(body.id)}
              title={`Select ${body.name}`}
              style={{
                width: 90,
                height: 90,
                flexShrink: 0,
                position: 'relative',
                border: 'none',
                background: 'transparent',
                padding: 0,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <svg viewBox="0 0 90 90" width="90" height="90" style={{ display: 'block', overflow: 'visible', pointerEvents: 'none' }}>
                {simParams.showRackBodyOscilloscope && oscData && (
                  <path
                    d={circularRackOscilloscopePath(
                      45,
                      45,
                      35 + Math.max(0, simParams.rackBodyOscilloscopeGap) * 0.6,
                      Math.max(0, simParams.rackBodyOscilloscopeHeight) * 0.7,
                      oscData,
                    )}
                    fill="none"
                    stroke={body.color}
                    strokeWidth={Math.max(0.2, simParams.rackBodyOscilloscopeStrokeWidth)}
                    strokeOpacity={simple ? 0.45 : 0.72}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>
              <RackBodySigil
                body={body}
                size={78}
                color={body.color}
                strokeWidth={2.65}
                style={{ filter: `drop-shadow(0 0 8px ${body.color}66)` }}
              />
            </button>

            {/* Name */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: textCol, lineHeight: 1.2 }}>
                {body.name}
              </div>
              {body.designation && (
                <div style={{ fontSize: 8, color: dimCol, marginTop: 3, fontStyle: 'italic' }}>
                  {body.designation}
                </div>
              )}
              {body.catalogId && (
                <div style={{ fontSize: 7, color: dimCol, marginTop: 2, fontFamily: 'monospace', opacity: 0.7, letterSpacing: '0.04em' }}>
                  {body.catalogId}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => updateSimParams({ standpointBodyId: isSP ? null : body.id })}
                title={isSP ? 'Clear standpoint' : 'Set as standpoint listener'}
                style={{
                  fontSize: 11, padding: '4px 8px', border: 'none', borderRadius: 4, cursor: 'pointer',
                  background: isSP ? 'rgba(6,182,212,0.18)' : btnBg,
                  color: isSP ? '#0891b2' : dimCol,
                  fontFamily: 'inherit', fontWeight: 600,
                }}
              >⊕</button>
              <button
                onClick={() => setCameraFollowBodyId(isFollowing ? null : body.id)}
                title={isFollowing ? 'Stop following' : 'Follow camera'}
                style={{
                  fontSize: 11, padding: '4px 8px', border: 'none', borderRadius: 4, cursor: 'pointer',
                  background: isFollowing ? 'rgba(139,92,246,0.18)' : btnBg,
                  color: isFollowing ? '#7c3aed' : dimCol,
                  fontFamily: 'inherit', fontWeight: 600,
                }}
              >📷</button>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 9, color: dimCol, textAlign: 'center', padding: '0 8px' }}>
              no body<br />selected
            </div>
          </div>
        )}

        {/* Thin vertical Edit strip on the right */}
        <button
          onClick={onToggleInspector}
          title={inspectorExpanded ? 'Collapse inspector' : 'Edit body properties'}
          style={{
            width: 14, flexShrink: 0,
            border: 'none', borderLeft: `0.5px solid ${border}`,
            cursor: 'pointer',
            background: inspectorExpanded
              ? (simple ? 'rgba(37,99,235,0.10)' : 'rgba(124,58,237,0.12)')
              : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0,
          }}
        >
          <span style={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            fontSize: 6.5, fontWeight: 800, letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: inspectorExpanded ? accentCol : dimCol,
            userSelect: 'none',
          }}>
            {inspectorExpanded ? '◀ edit' : '▶ edit'}
          </span>
        </button>

      </div>{/* end body content row */}
    </div>
  )
}

function RackInspectorColumn({ planetTool: _planetTool, simple, expanded }: { planetTool: PlanetTool | undefined; simple: boolean; expanded: boolean }) {
  const selectedBodyId = usePlanetStore(s => s.selectedBodyId)
  const scrollColor = simple ? 'rgba(0,0,0,0.12) transparent' : 'rgba(255,255,255,0.08) transparent'
  const border = simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)'
  const accentCol = simple ? '#2563eb' : '#7c3aed'

  if (!expanded) return null

  return (
    <div style={{
      width: 228, flexShrink: 0, minHeight: 0,
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto', overflowX: 'hidden',
      scrollbarWidth: 'thin',
      scrollbarColor: scrollColor,
    }}>
      {/* Column header */}
      <div style={{
        padding: '4px 8px 3px', flexShrink: 0,
        fontSize: 6.5, fontWeight: 800, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: accentCol, lineHeight: 1,
        borderBottom: `0.5px solid ${border}`,
      }}>
        ◈ inspector
      </div>
      {selectedBodyId ? (
        <PlanetBodyInspector hideHeader />
      ) : (
        <UniverseRackIndicator simple={simple} />
      )}
    </div>
  )
}

// ── Rack ──────────────────────────────────────────────────────────────────────

interface PlanetRackProps {
  height: number
  collapsed: boolean
  onToggleCollapsed: () => void
  onExtendSampler?:  (bodyId: string, slotKey: string) => void
  onExtendOneShot?:  (bodyId: string, slotKey: string) => void
  planetTool?: PlanetTool
}

function MakeUniqueButton({ slot, bodyId, simple, makeBodyRackUnique }: {
  slot: 'triggers' | 'note' | 'instrument' | 'effects'
  bodyId: string
  simple: boolean
  makeBodyRackUnique: (bodyId: string, slot: 'triggers' | 'note' | 'instrument' | 'effects') => void
}) {
  return (
    <button
      title="Make this global rack slot unique for this body"
      onClick={e => {
        e.stopPropagation()
        makeBodyRackUnique(bodyId, slot)
      }}
      style={{
        position: 'absolute',
        top: 3,
        right: 4,
        zIndex: 3,
        height: 14,
        padding: '0 5px',
        borderRadius: 3,
        border: `0.5px solid ${simple ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)'}`,
        background: simple ? 'rgba(255,255,255,0.86)' : 'rgba(13,13,22,0.88)',
        color: simple ? 'rgba(0,0,0,0.62)' : 'rgba(255,255,255,0.68)',
        fontSize: 6.5,
        fontWeight: 800,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        lineHeight: 1,
        fontFamily: 'inherit',
        cursor: 'pointer',
        boxShadow: simple ? '0 1px 4px rgba(0,0,0,0.10)' : '0 1px 6px rgba(0,0,0,0.35)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.color = simple ? '#111827' : '#fff'
        e.currentTarget.style.borderColor = simple ? 'rgba(0,0,0,0.34)' : 'rgba(255,255,255,0.36)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = simple ? 'rgba(0,0,0,0.62)' : 'rgba(255,255,255,0.68)'
        e.currentTarget.style.borderColor = simple ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)'
      }}
    >
      unique
    </button>
  )
}

export function PlanetRack({ height, collapsed, onToggleCollapsed, onExtendSampler, onExtendOneShot: _onExtendOneShot, planetTool }: PlanetRackProps) {
  const simpleTheme    = usePlanetStore(s => s.simParams.simpleTheme)
  const monochromeMode = useCanvasSettingsStore(s => s.monochromeMode)
  const simple         = simpleTheme || monochromeMode
  const selectedBodyId = usePlanetStore(s => s.selectedBodyId)
  const [inspectorExpanded, setInspectorExpanded] = useState(false)
  const [expandedSlotKey, setExpandedSlotKey]     = useState<string | null>(null)
  const bodies         = usePlanetStore(s => s.bodies)

  const { globalRack, bodyRacks,
    getControlSetById,
    setGlobalSlot, addGlobalEffect, removeGlobalEffect,
    addGlobalTrigger, removeGlobalTrigger,
    setBodySlot, clearBodySlot, addBodyEffect, removeBodyEffect,
    addBodyTrigger, removeBodyTrigger, clearBodyTriggers,
    makeBodyRackUnique,
  } = useControlSetStore()

  const selectedBody = selectedBodyId ? (bodies.find(b => b.id === selectedBodyId) ?? null) : null
  const isBodyMode   = selectedBody !== null
  const bodyId       = selectedBodyId ?? ''

  // Resolve effective rack for the selected body (or global)
  const effectiveRack = isBodyMode
    ? useControlSetStore.getState().getBodyEffectiveRack(bodyId)
    : globalRack

  // Per-slot key helpers
  function triggerKey(i: number)  { return isBodyMode ? `b:${bodyId}:trigger:${i}` : `g:trigger:${i}` }
  function noteKey()              { return isBodyMode ? `b:${bodyId}:note`          : 'g:note'         }
  function instrumentKey()        { return isBodyMode ? `b:${bodyId}:instrument`    : 'g:instrument'   }
  function effectKey(i: number)   { return isBodyMode ? `b:${bodyId}:effect:${i}`  : `g:effect:${i}`  }

  // Body-level override status
  const bodyOv          = bodyRacks[bodyId] ?? {}
  const hasTriggerOv    = isBodyMode && (bodyOv.triggers   != null && bodyOv.triggers.length   > 0)
  const hasNoteOv       = isBodyMode && (bodyOv.note       != null)
  const hasInstrumentOv = isBodyMode && (bodyOv.instrument != null)
  const hasEffectsOv    = isBodyMode && (bodyOv.effects    != null && bodyOv.effects.length    > 0)

  // ── Assign helpers ────────────────────────────────────────────────────────
  function handleAssign(slot: 'trigger' | 'note' | 'instrument' | 'effect', id: string) {
    const cs = getControlSetById(id)
    if (!cs) return
    if (slot === 'trigger') {
      if (isBodyMode) addBodyTrigger(bodyId, id)
      else addGlobalTrigger(id)
    } else if (slot === 'effect') {
      if (isBodyMode) addBodyEffect(bodyId, id)
      else addGlobalEffect(id)
    } else if (slot === 'note') {
      if (isBodyMode) setBodySlot(bodyId, slot, id)
      else setGlobalSlot(slot, id)
    } else {
      if (isBodyMode) setBodySlot(bodyId, slot, id)
      else setGlobalSlot(slot, id)
    }
  }

  function handleClearTrigger(index: number) {
    if (isBodyMode) removeBodyTrigger(bodyId, index)
    else removeGlobalTrigger(index)
  }

  function handleClearEffect(index: number) {
    if (isBodyMode) removeBodyEffect(bodyId, index)
    else removeGlobalEffect(index)
  }

  function handleClear(slot: 'note' | 'instrument', hasOv: boolean) {
    if (isBodyMode) {
      if (hasOv) clearBodySlot(bodyId, slot)
      else setGlobalSlot(slot, null)
    } else {
      setGlobalSlot(slot, null)
    }
  }

  // ── Rack-level drag state (whole rack is one drop target) ─────────────────
  const [rackOver, setRackOver] = useState(false)
  const [rackDragCat, setRackDragCat] = useState<ControlSetCategory | null>(null)

  function isControlSetDrag(e: React.DragEvent): boolean {
    const types = e.dataTransfer?.types ? Array.from(e.dataTransfer.types) : []
    return types.includes('application/x-control-set') || types.includes('text/plain') || draggingControlSetId !== null
  }

  function resetRackDragState() {
    setRackOver(false)
    setRackDragCat(null)
    setDraggingControlSetId(null)
  }

  function handleRackDragOver(e: React.DragEvent) {
    try {
      if (!isControlSetDrag(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      // Use module-level tracker to show which section will receive the drop.
      // During dragover, browsers often hide getData(), so the module tracker is
      // the reliable source.
      const dragCs = draggingControlSetId
        ? getControlSetById(draggingControlSetId)
        : null
      const newCat = dragCs?.category ?? null
      if (!rackOver)             setRackOver(true)
      if (newCat !== rackDragCat) setRackDragCat(newCat)
    } catch (err) {
      console.error('Control set dragover failed', err)
      resetRackDragState()
    }
  }

  function handleRackDrop(e: React.DragEvent) {
    try {
      e.preventDefault()
      e.stopPropagation()
      const id =
        e.dataTransfer?.getData('application/x-control-set')
        || e.dataTransfer?.getData('text/plain')
        || draggingControlSetId
        || ''
      resetRackDragState()
      if (!id) return
      const cs = getControlSetById(id)
      if (!cs) return
        const slot: 'trigger' | 'note' | 'instrument' | 'effect' =
          cs.category === 'trigger' ? 'trigger' :
          cs.category === 'note' ? 'note' :
          cs.category === 'instrument' ? 'instrument' : 'effect'
      handleAssign(slot, id)
    } catch (err) {
      console.error('Control set drop failed', err)
      resetRackDragState()
    }
  }

  function handleRackDragLeave(e: React.DragEvent) {
    if (e.relatedTarget && (e.currentTarget as Element).contains(e.relatedTarget as Node)) return
    setRackOver(false)
    setRackDragCat(null)
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const bg     = simple ? 'rgba(245,245,243,0.97)' : '#0d0d16'
  const border = simple ? 'rgba(0,0,0,0.10)'       : 'rgba(255,255,255,0.07)'
  const hdrCol = simple ? 'rgba(0,0,0,0.28)'        : 'rgba(255,255,255,0.22)'
  const divCol = simple ? 'rgba(0,0,0,0.07)'         : 'rgba(255,255,255,0.06)'

  // Rack over highlight
  const rackOverBg = rackOver
    ? (simple ? 'rgba(37,99,235,0.03)' : 'rgba(99,102,241,0.04)')
    : 'transparent'

  // Slot info getters
  const triggerCsList = effectiveRack.triggers.map(id => getControlSetById(id))
  const visibleTriggerEntries = triggerCsList.map((cs, i) => ({ cs, i })).filter(entry => entry.cs)
  const noteCs = effectiveRack.note ? getControlSetById(effectiveRack.note) : null
  const instrumentCs  = effectiveRack.instrument ? getControlSetById(effectiveRack.instrument) : null
  const effectCsList  = effectiveRack.effects.map(id => getControlSetById(id))

  // ── Collapsed bar ──────────────────────────────────────────────────────────
  if (collapsed) {
    const slots = [
      ...(triggerCsList.length > 0
        ? [{ icon: triggerCsList[0]?.icon ?? '…', name: triggerCsList[0]?.name ?? '…', col: triggerCsList[0]?.color ?? hdrCol }]
        : []),
      ...(noteCs
        ? [{ icon: noteCs.icon, name: noteCs.name, col: noteCs.color }]
        : []),
      ...(instrumentCs
        ? [{ icon: instrumentCs.icon, name: instrumentCs.name, col: instrumentCs.color }]
        : []),
      ...(effectCsList.length > 0 && effectCsList[0]
        ? [{ icon: effectCsList[0].icon, name: effectCsList[0].name, col: effectCsList[0].color }]
        : []),
    ]
    return (
      <div style={{
        height: 30, flexShrink: 0, background: bg,
        borderTop: `0.5px solid ${border}`,
        display: 'flex', alignItems: 'stretch',
        overflow: 'hidden', cursor: 'pointer',
      }}
        onClick={onToggleCollapsed}
        title="Expand rack"
      >
        {/* ▲ label */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '0 10px',
          borderRight: `0.5px solid ${divCol}`,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 7, color: hdrCol, lineHeight: 1 }}>▲</span>
          <span style={{
            fontSize: 7, fontWeight: 800, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: hdrCol,
          }}>RACK</span>
        </div>
        {/* Active slot pills */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', overflow: 'hidden' }}>
          {slots.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 3,
              padding: '2px 6px', borderRadius: 3,
              border: `0.5px solid ${s.col}44`,
              background: `${s.col}12`,
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 9, lineHeight: 1 }}>{s.icon}</span>
              <span style={{ fontSize: 7.5, fontWeight: 600, color: s.col, lineHeight: 1 }}>{s.name}</span>
            </div>
          ))}
          {slots.length === 0 && (
            <span style={{ fontSize: 8, color: hdrCol, opacity: 0.4, fontStyle: 'italic' }}>empty</span>
          )}
        </div>
        {/* Body indicator */}
        {isBodyMode && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '0 10px', borderLeft: `0.5px solid ${divCol}`, flexShrink: 0,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: selectedBody.color, boxShadow: `0 0 4px ${selectedBody.color}88` }} />
            <span style={{ fontSize: 7.5, color: selectedBody.color, fontWeight: 700, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedBody.name}
            </span>
          </div>
        )}
      </div>
    )
  }

  // Find which CS is currently expanded by matching the slot key directly
  const expandedCs = expandedSlotKey
    ? (() => {
        const noteActualKey = isBodyMode && hasNoteOv ? noteKey() : 'g:note'
        const instrumentActualKey = isBodyMode && hasInstrumentOv ? instrumentKey() : 'g:instrument'
        const allSlots = [
          ...triggerCsList.map((cs, i) => ({
            cs,
            key: isBodyMode && hasTriggerOv ? triggerKey(i) : `g:trigger:${i}`,
          })),
          noteCs ? { cs: noteCs, key: noteActualKey } : null,
          instrumentCs ? { cs: instrumentCs, key: instrumentActualKey } : null,
          ...effectCsList.map((cs, i) => ({
            cs,
            key: isBodyMode && hasEffectsOv ? effectKey(i) : `g:effect:${i}`,
          })),
        ].filter(Boolean) as {cs: typeof instrumentCs; key: string}[]
        return allSlots.find(s => s.key === expandedSlotKey)?.cs ?? null
      })()
    : null
  const extensionHost = typeof document !== 'undefined'
    ? document.getElementById('rack-extension-panel-root')
    : null
  const expandedPanel = expandedSlotKey ? (
    <div style={{
      height: '100%',
      background: bg,
      borderRight: `0.5px solid ${border}`,
      boxShadow: simple ? '4px 0 18px rgba(0,0,0,0.12)' : '8px 0 28px rgba(0,0,0,0.42)',
      overflow: 'auto',
      pointerEvents: 'auto',
    }}>
      {expandedCs?.id === 'instrument-wave-lab' ? (
        <WaveLabInstrumentExpanded bodyId={isBodyMode ? bodyId : null} slotKey={expandedSlotKey} simple={simple} onClose={() => setExpandedSlotKey(null)} />
      ) : expandedCs?.id === 'instrument-oneshot-stretch' ? (
        <OneShotStretchExpanded bodyId={isBodyMode ? bodyId : null} slotKey={expandedSlotKey} simple={simple} onClose={() => setExpandedSlotKey(null)} />
      ) : expandedCs?.id === 'instrument-sampler' ? (
        <SamplerStretchExpanded bodyId={isBodyMode ? bodyId : null} slotKey={expandedSlotKey} simple={simple} onClose={() => setExpandedSlotKey(null)} />
      ) : expandedCs?.id === 'instrument-long-sampler' ? (
        <LongSamplerExpanded bodyId={isBodyMode ? bodyId : null} slotKey={expandedSlotKey} simple={simple} onClose={() => setExpandedSlotKey(null)} />
      ) : expandedCs?.id === 'trigger-orbit-step' ? (
        <OrbitStepExpanded bodyId={isBodyMode ? bodyId : null} slotKey={expandedSlotKey} simple={simple} onClose={() => setExpandedSlotKey(null)} />
      ) : (expandedCs?.id === 'trigger-arpeggio' || expandedCs?.id === 'note-arpeggio') ? (
        <ArpeggioExpanded bodyId={isBodyMode ? bodyId : null} slotKey={expandedSlotKey} simple={simple} onClose={() => setExpandedSlotKey(null)} />
      ) : (
        <GenericSlotExpanded slotKey={expandedSlotKey} cs={expandedCs} simple={simple} onClose={() => setExpandedSlotKey(null)} />
      )}
    </div>
  ) : null

  return (
    <div style={{
      height,
      flexShrink: 0, background: bg,
      borderTop: `0.5px solid ${border}`,
      display: 'flex', flexDirection: 'row',
      overflow: 'visible',
      position: 'relative',
      zIndex: 10,
    }}>
      {expandedPanel && extensionHost && createPortal(expandedPanel, extensionHost)}
      {/* ── Left strip — collapse toggle (always visible) ── */}
      <div style={{
        width: 14, flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center',
        borderRight: `0.5px solid ${divCol}`,
        padding: '2px 0', gap: 4,
      }}>
        <button
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand rack' : 'Collapse rack'}
          style={{
            width: 14, height: 14, flexShrink: 0,
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0, color: hdrCol, fontSize: 8, lineHeight: 1,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = simple ? '#000' : '#fff')}
          onMouseLeave={e => (e.currentTarget.style.color = hdrCol)}
        >
          {'▼'}
        </button>
        {isBodyMode && (
          <div style={{
            width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
            background: selectedBody.color,
            boxShadow: `0 0 4px ${selectedBody.color}88`,
          }} />
        )}
      </div>

      {/* Rack body — entire area is a drop target */}
      {!collapsed && (
        <div
          data-control-rack-dropzone="true"
          data-body-id={isBodyMode ? bodyId : ''}
          onDragOver={handleRackDragOver}
          onDrop={handleRackDrop}
          onDragLeave={handleRackDragLeave}
          style={{
            flex: 1, display: 'flex', alignItems: 'stretch',
            overflow: 'hidden',
            background: rackOverBg,
            transition: 'background 0.1s',
          }}
        >

          {/* ── BODY CENTROID (pinned — leftmost identity panel) ── */}
          <RackBodyCentroidColumn simple={simple} inspectorExpanded={inspectorExpanded} onToggleInspector={() => setInspectorExpanded(v => !v)} />

          {/* ── INSPECTOR (pinned — not inside horizontal scroll area) ── */}
          <RackInspectorColumn planetTool={planetTool} simple={simple} expanded={inspectorExpanded} />
          <div style={{ width: 1, background: divCol, margin: '6px 0', flexShrink: 0 }} />

          {/* ── ORBIT (pinned) ── */}
          <RackOrbitColumn selectedBodyId={isBodyMode ? selectedBodyId : null} simple={simple} />
          <div style={{ width: 1, background: divCol, margin: '6px 0', flexShrink: 0 }} />

          {/* ── Scrollable slots area (Trigger → Effects) ── */}
          <div style={{
            flex: 1, display: 'flex', alignItems: 'stretch',
            position: 'relative',
            overflowX: 'auto', overflowY: 'hidden',
            scrollbarWidth: 'thin',
            scrollbarColor: simple ? 'rgba(0,0,0,0.12) transparent' : 'rgba(255,255,255,0.08) transparent',
          }}>

          {/* ── TRIGGER ── */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
            <SectionLabel label="Trigger" simple={simple} highlighted={rackDragCat === 'trigger'} />
            <div style={{ width: 1, background: divCol, margin: '6px 0' }} />
            <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
              {visibleTriggerEntries.length > 0 ? visibleTriggerEntries.map(({ cs, i }) =>
                cs ? (
                  <div key={i} style={{ flexShrink: 0, width: 148, position: 'relative' }}>
                    <SlotCard cs={cs}
                      slotKey={isBodyMode && !hasTriggerOv ? `g:trigger:${i}` : triggerKey(i)}
                      simple={simple}
                      bodyId={isBodyMode ? bodyId : null}
                      ghost={isBodyMode && !hasTriggerOv}
                      onClear={() => handleClearTrigger(i)}
                      expandedSlotKey={expandedSlotKey}
                      onToggleExpand={key => setExpandedSlotKey(prev => prev === key ? null : key)} />
                    {isBodyMode && !hasTriggerOv && <MakeUniqueButton slot="triggers" bodyId={bodyId} simple={simple} makeBodyRackUnique={makeBodyRackUnique} />}
                  </div>
                ) : null
              ) : (
                <EmptySlot simple={simple} highlighted={rackDragCat === 'trigger'} />
              )}
              {triggerCsList.length < MAX_TRIGGERS && visibleTriggerEntries.length > 0 && (
                <EmptySlot simple={simple} highlighted={rackDragCat === 'trigger'} />
              )}
              {isBodyMode && hasTriggerOv && triggerCsList.length > 0 && (
                <button
                  onClick={() => clearBodyTriggers(bodyId)}
                  style={{ alignSelf: 'flex-end', fontSize: 7, color: hdrCol, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontFamily: 'inherit' }}
                >↺ global</button>
              )}
            </div>
          </div>

          {/* ── NOTE ── */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
            <SectionLabel label="Note" simple={simple} highlighted={rackDragCat === 'note'} />
            <div style={{ width: 1, background: divCol, margin: '6px 0' }} />
            <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
              {noteCs ? (
                <div style={{ flexShrink: 0, width: 148, position: 'relative' }}>
                  <SlotCard cs={noteCs}
                    slotKey={isBodyMode && !hasNoteOv ? 'g:note' : noteKey()}
                    simple={simple}
                    bodyId={isBodyMode ? bodyId : null}
                    ghost={isBodyMode && !hasNoteOv}
                    onClear={() => handleClear('note', hasNoteOv)}
                    expandedSlotKey={expandedSlotKey}
                    onToggleExpand={key => setExpandedSlotKey(prev => prev === key ? null : key)} />
                  {isBodyMode && !hasNoteOv && <MakeUniqueButton slot="note" bodyId={bodyId} simple={simple} makeBodyRackUnique={makeBodyRackUnique} />}
                </div>
              ) : (
                <EmptySlot simple={simple} highlighted={rackDragCat === 'note'} />
              )}
              {isBodyMode && hasNoteOv && noteCs && (
                <button
                  onClick={() => clearBodySlot(bodyId, 'note')}
                  style={{ alignSelf: 'flex-end', fontSize: 7, color: hdrCol, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontFamily: 'inherit' }}
                >↺ global</button>
              )}
            </div>
          </div>

          {/* ── TRIGGER / NOTE → INSTRUMENT signal bridge ── */}
          <TriggerSignalBridge bodyId={isBodyMode ? bodyId : null} simple={simple} />

          {/* ── INSTRUMENT ── */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
            <SectionLabel label="Instrument" simple={simple} highlighted={rackDragCat === 'instrument'} />
            <div style={{ width: 1, background: divCol, margin: '6px 0' }} />
            <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: 4, minWidth: (instrumentCs?.id === 'instrument-oneshot' || instrumentCs?.id === 'instrument-oneshot-stretch' || instrumentCs?.id === 'instrument-sampler' || instrumentCs?.id === 'instrument-long-sampler') ? 220 : instrumentCs?.id === 'instrument-wave-lab' ? 230 : instrumentCs?.id === 'instrument-osc-synth' ? 210 : 160 }}>
              {instrumentCs ? (
                <div style={{ position: 'relative' }}>
                  <SlotCard cs={instrumentCs}
                    slotKey={isBodyMode && !hasInstrumentOv ? 'g:instrument' : instrumentKey()}
                    simple={simple}
                    bodyId={isBodyMode ? bodyId : null}
                    ghost={isBodyMode && !hasInstrumentOv}
                    onClear={() => handleClear('instrument', hasInstrumentOv)}
                    onExtend={
                      instrumentCs.id === 'instrument-sampler'
                        ? () => onExtendSampler?.(isBodyMode ? bodyId : '', instrumentKey())
                        : undefined
                    }
                    expandedSlotKey={expandedSlotKey}
                    onToggleExpand={key => setExpandedSlotKey(prev => prev === key ? null : key)} />
                  {isBodyMode && !hasInstrumentOv && <MakeUniqueButton slot="instrument" bodyId={bodyId} simple={simple} makeBodyRackUnique={makeBodyRackUnique} />}
                </div>
              ) : (
                <EmptySlot simple={simple} highlighted={rackDragCat === 'instrument'} />
              )}
              {isBodyMode && hasInstrumentOv && instrumentCs && (
                <button
                  onClick={() => clearBodySlot(bodyId, 'instrument')}
                  style={{ fontSize: 7, color: hdrCol, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '0 2px', fontFamily: 'inherit' }}
                >↺ use global</button>
              )}
            </div>
          </div>

          {/* ── INSTRUMENT → EFFECTOR monitor bridge ── */}
          <InstrumentEffectorBridge bodyId={isBodyMode ? bodyId : null} simple={simple} />

          {/* ── EFFECTS ── */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, flex: 1 }}>
            <SectionLabel label="Effects" simple={simple} highlighted={rackDragCat === 'effect'} />
            <div style={{ width: 1, background: divCol, margin: '6px 0' }} />
            <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'flex-start', flex: 1 }}>
              {effectCsList.map((cs, i) =>
                cs ? (
                  <div key={i} style={{ flexShrink: 0, width: 148, position: 'relative' }}>
                    <SlotCard cs={cs}
                      slotKey={isBodyMode && !hasEffectsOv ? `g:effect:${i}` : effectKey(i)}
                      simple={simple}
                      bodyId={isBodyMode ? bodyId : null}
                      ghost={isBodyMode && !hasEffectsOv}
                      onClear={() => handleClearEffect(i)}
                      expandedSlotKey={expandedSlotKey}
                      onToggleExpand={key => setExpandedSlotKey(prev => prev === key ? null : key)} />
                    {isBodyMode && !hasEffectsOv && <MakeUniqueButton slot="effects" bodyId={bodyId} simple={simple} makeBodyRackUnique={makeBodyRackUnique} />}
                  </div>
                ) : null
              )}
              {effectCsList.length < MAX_EFFECTS && (
                <EmptySlot simple={simple} highlighted={rackDragCat === 'effect'} />
              )}
            </div>
          </div>

          </div>{/* end scrollable slots */}

          {/* ── MIXER OUTPUT (pinned — rightmost) ── */}
          <div style={{ width: 1, background: divCol, margin: '6px 0', flexShrink: 0 }} />
          <RackMixerColumn bodyId={isBodyMode ? selectedBodyId : null} simple={simple} />
        </div>
      )}
    </div>
  )
}
