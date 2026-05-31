import { useState, useEffect, useRef, useCallback } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import type { PlanetSimParams } from '../../store/planetStore'
import { useProjectStore } from '../../store/projectStore'
import {
  useControlSetStore,
  BUILTIN_CONTROL_SETS,
  MAX_EFFECTS,
  MAX_TRIGGERS,
  type ControlSet,
  type ControlSetCategory,
} from '../../store/controlSetStore'
import { computeOrbitDroneParams, computeOrbitStats } from './DroneLayer'
import { getPlanetLiveBodySnapshot, planetBodyStatsCache, computeOrbitPreviewForBody, type PlanetBodyStats, type PlanetTool } from './PlanetCanvas'
import { PlanetBodyInspector, NextBodyInspector } from '../layout/RightInspector'
import { draggingControlSetId, setDraggingControlSetId } from '../../lib/dragControlSet'
import { getBodyOutputLevel } from '../../audio/bodyOutputMeter'
import { computeBodyRackOutputSpatial } from '../../audio/bodyRackOutput'
import { getBodyTriggerAge, markBodyTriggered } from '../../audio/intersectionSynth'
import { sendMidiNote, getMidiSendAge, getMidiReceiveAge, isMidiReady } from '../../audio/midiManager'
import { getBodyOneShotEngine } from '../../audio/OneShotSamplerEngine'
import type { OneShotState } from '../../audio/OneShotSamplerEngine'
import { fireBodyInstrumentTrigger } from '../../audio/instrumentTrigger'
import { getBodyAmbientOscEngine } from './AmbientOscillatorLayer'
import { getBodyOscSynthEngine } from './OscSynthLayer'

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
  oscSynthAttack:          { type: 'number', label: 'attack',  step: 0.01, min: 0.001, max: 20 },
  oscSynthRelease:         { type: 'number', label: 'release', step: 0.1,  min: 0.01,  max: 30 },
  oscSynthFilterCutoff:    { type: 'number', label: 'cutoff',  step: 50,   min: 80,    max: 12000 },
  oscSynthFilterResonance: { type: 'number', label: 'Q',       step: 0.05, min: 0.01,  max: 15 },
  oscSynthLevel:           { type: 'number', label: 'level',   step: 0.05, min: 0,     max: 1 },
  oscSynthLfoTarget:       { type: 'select', label: 'lfo →',   options: ['off', 'pitch', 'filter', 'amplitude'], optionLabels: ['Off', 'Pitch', 'Filter', 'Amp'] },
  oscSynthLfoRate:         { type: 'number', label: 'lfo rate', step: 0.01, min: 0.01, max: 20 },
  oscSynthLfoDepth:        { type: 'number', label: 'lfo depth', step: 0.01, min: 0,   max: 1 },
  oscSynthLfoWaveform:     { type: 'select', label: 'lfo wave',  options: ['sine', 'triangle', 'sawtooth', 'square'], optionLabels: ['Sine', 'Triangle', 'Saw', 'Square'] },
  // Ambient Oscillator params
  ambientOscType:            { type: 'select', label: 'type',    options: ['off', 'ambient-osc'], optionLabels: ['— off', 'Ambient Osc'] },
  ambientOscWaveform:        { type: 'select', label: 'wave',    options: ['sine', 'triangle', 'sawtooth', 'square'], optionLabels: ['Sine', 'Triangle', 'Saw', 'Square'] },
  ambientOscAttack:          { type: 'number', label: 'attack',  step: 0.1, min: 0.01, max: 20 },
  ambientOscRelease:         { type: 'number', label: 'release', step: 0.1, min: 0.01, max: 30 },
  ambientOscFilterCutoff:    { type: 'number', label: 'cutoff',  step: 50,  min: 80,   max: 12000 },
  ambientOscFilterResonance: { type: 'number', label: 'Q',       step: 0.05, min: 0.01, max: 15 },
  ambientOscLevel:           { type: 'number', label: 'level',   step: 0.05, min: 0,   max: 1 },
  ambientOscNote:            { type: 'number', label: 'note',    step: 1,   min: 0,    max: 127 },
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
  'oscSynthAttack', 'oscSynthRelease',
  'oscSynthFilterCutoff', 'oscSynthFilterResonance',
  'oscSynthLfoTarget', 'oscSynthLfoWaveform',
  'oscSynthLfoRate', 'oscSynthLfoDepth',
])
const OSC_SYNTH_2COL_LABELS: Record<string, string> = {
  oscSynthWaveform:        'wave',
  oscSynthLevel:           'level',
  oscSynthAttack:          'atk',
  oscSynthRelease:         'rel',
  oscSynthFilterCutoff:    'cutoff',
  oscSynthFilterResonance: 'Q',
  oscSynthLfoTarget:       'lfo→',
  oscSynthLfoWaveform:     'lfoW',
  oscSynthLfoRate:         'rate',
  oscSynthLfoDepth:        'depth',
}
const OSC_SYNTH_2COL_ORDER = [
  'oscSynthWaveform',        'oscSynthLevel',
  'oscSynthAttack',          'oscSynthRelease',
  'oscSynthFilterCutoff',    'oscSynthFilterResonance',
  'oscSynthLfoTarget',       'oscSynthLfoWaveform',
  'oscSynthLfoRate',         'oscSynthLfoDepth',
]

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
  const [level, setLevel] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setLevel(getBodyOutputLevel(bodyId)), 50)
    return () => window.clearInterval(id)
  }, [bodyId])
  const fillColor = level > 0.85 ? '#f87171' : level > 0.55 ? '#fbbf24' : accent
  const trackBg   = simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)'
  return (
    <div style={{ position: 'absolute', right: 3, top: 5, bottom: 5, width: 3, borderRadius: 2, overflow: 'hidden', background: trackBg }}>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${level * 100}%`, background: fillColor, borderRadius: 2, transition: 'height 0.05s linear' }} />
    </div>
  )
}

// ── Trigger flash dot ─────────────────────────────────────────────────────────

const FLASH_FADE_MS = 350

/** Pulsing dot that flashes when the body is triggered. */
function TriggerFlashDot({ bodyId, accent }: { bodyId: string; accent: string }) {
  const [opacity, setOpacity] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      const age = getBodyTriggerAge(bodyId)
      if (!isFinite(age)) { setOpacity(0); return }
      setOpacity(Math.max(0, 1 - age / FLASH_FADE_MS))
    }, 16)
    return () => window.clearInterval(id)
  }, [bodyId])
  return (
    <div style={{
      position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)',
      width: 7, height: 7, borderRadius: '50%',
      background: opacity > 0.05 ? accent : 'transparent',
      border: `0.5px solid ${accent}66`,
      boxShadow: opacity > 0.05 ? `0 0 ${opacity * 7}px ${accent}` : 'none',
      opacity: 0.25 + opacity * 0.75,
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
  const [vuLevel,  setVuLevel]  = useState(0)    // instrument signal level (0 when idle)
  const [fader,    setFader]    = useState(1)    // body.volume × standpoint (0–1)
  const [spPan,    setSpPan]    = useState(0)
  const [spActive, setSpActive] = useState(false)

  useEffect(() => {
    if (!bodyId) { setVuLevel(0); setFader(1); setSpPan(0); setSpActive(false); return }
    const id = window.setInterval(() => {
      setVuLevel(getBodyOutputLevel(bodyId))
      const { simParams, bodies } = usePlanetStore.getState()
      const body = bodies.find(b => b.id === bodyId)
      const bodyVol = body?.muted ? 0 : (body?.volume ?? 1)
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
  const displayNum = vuLevel > 0.01 ? vuLevel : fader
  const displayCol = vuLevel > 0.01 ? vuColor : faderColor

  return (
    <div style={{
      width: 52, flexShrink: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '6px 5px 8px',
      gap: 4,
    }}>
      {/* Signal-flow arrow */}
      <div style={{ fontSize: 8, color: accentCol, opacity: 0.75, lineHeight: 1 }}>→</div>

      {/* Dual meter: VU (left) + Fader gain (right) */}
      <div style={{ flex: 1, display: 'flex', gap: 3, alignItems: 'flex-end', minHeight: 30 }}>
        {/* VU bar — signal from instrument */}
        <div title="signal level" style={{ flex: 1, borderRadius: 3, overflow: 'hidden', background: trackBg, position: 'relative', alignSelf: 'stretch' }}>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${vuLevel * 100}%`, background: vuColor, borderRadius: 3, transition: 'height 0.05s linear' }} />
          {[0.5012, 0.2512, 0.1259].map((lin, i) => (
            <div key={i} style={{ position: 'absolute', bottom: `${lin * 100}%`, left: 0, right: 0, height: 0.5, background: simple ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.12)' }} />
          ))}
        </div>
        {/* Fader gain bar — body.volume × standpoint (always visible) */}
        <div title="fader × standpoint" style={{ width: 5, borderRadius: 3, overflow: 'hidden', background: trackBg, position: 'relative', alignSelf: 'stretch' }}>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${fader * 100}%`, background: faderColor, opacity: 0.7, borderRadius: 3, transition: 'height 0.08s linear' }} />
        </div>
      </div>

      {/* Numeric readout + pan */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <div style={{ fontSize: 7, color: displayCol, fontFamily: 'monospace', lineHeight: 1, minWidth: 22, textAlign: 'center' }}>
          {`${Math.round(displayNum * 100)}`}
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
  const [opacity, setOpacity] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      const age = getBodyTriggerAge(bodyId)
      setOpacity(isFinite(age) ? Math.max(0, 1 - age / ORBIT_FLASH_FADE_MS) : 0)
    }, 16)
    return () => window.clearInterval(id)
  }, [bodyId])
  const col = simple ? '#7c3aed' : '#a78bfa'
  return (
    <div style={{
      width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
      background: opacity > 0.05 ? col : 'transparent',
      border: `0.8px solid ${col}55`,
      boxShadow: opacity > 0.05 ? `0 0 ${opacity * 8}px ${col}` : 'none',
      opacity: 0.2 + opacity * 0.8,
      transition: 'box-shadow 0.04s',
    }} />
  )
}

function RackOrbitColumn({ selectedBodyId, simple }: { selectedBodyId: string | null; simple: boolean }) {
  const [liveStats, setLiveStats] = useState<PlanetBodyStats | null>(null)
  const [orbitPts, setOrbitPts]   = useState<Array<{x: number; y: number}> | null>(null)
  const [showNextOrbit, setShowNextOrbit] = useState(true)
  const [showLiveData, setShowLiveData]   = useState(false)

  const bodies    = usePlanetStore(s => s.bodies)
  const G         = usePlanetStore(s => s.simParams.G)
  const simParams = usePlanetStore(s => s.simParams)

  useEffect(() => {
    if (!selectedBodyId) { setLiveStats(null); return }
    const poll = () => setLiveStats(planetBodyStatsCache.get(selectedBodyId) ?? null)
    poll()
    const id = window.setInterval(poll, 100)
    return () => window.clearInterval(id)
  }, [selectedBodyId])

  useEffect(() => {
    if (!selectedBodyId || !showNextOrbit) { setOrbitPts(null); return }
    const recompute = () => {
      const st = planetBodyStatsCache.get(selectedBodyId)
      const period   = st?.period
      const stepsRaw = (period && isFinite(period) && period > 0)
        ? Math.ceil(period / simParams.dt) : 1200
      const steps = Math.max(200, Math.min(3000, stepsRaw))
      setOrbitPts(computeOrbitPreviewForBody(selectedBodyId, steps))
    }
    recompute()
    const id = window.setInterval(recompute, 800)
    return () => window.clearInterval(id)
  }, [selectedBodyId, showNextOrbit, simParams.dt])  // eslint-disable-line react-hooks/exhaustive-deps

  const dimText   = simple ? 'rgba(0,0,0,0.32)'  : 'rgba(255,255,255,0.28)'
  const accentCol = simple ? '#2563eb'             : '#7c3aed'
  const freeCol   = simple ? '#dc2626'             : '#f87171'
  const divLine   = simple ? 'rgba(0,0,0,0.07)'   : 'rgba(255,255,255,0.07)'
  const orbitBg   = simple ? 'rgba(0,0,0,0.04)'   : 'rgba(255,255,255,0.04)'
  const meterBg   = simple ? 'rgba(0,0,0,0.07)'   : 'rgba(255,255,255,0.06)'

  const liveBodies = getPlanetLiveBodySnapshot()
  const liveById   = new Map(liveBodies.map(b => [b.id, b]))
  const effectiveBodies = bodies.map(b => {
    const live = liveById.get(b.id)
    return live ? { ...b, x: live.x, y: live.y, vx: live.vx, vy: live.vy, ax: live.ax, ay: live.ay } : b
  })

  const body       = selectedBodyId ? (effectiveBodies.find(b => b.id === selectedBodyId) ?? null) : null
  const orbitStats = body ? computeOrbitStats(body, effectiveBodies, G) : null

  const svgData = (() => {
    if (!orbitPts || orbitPts.length < 2) return null
    let minX = orbitPts[0].x, maxX = orbitPts[0].x, minY = orbitPts[0].y, maxY = orbitPts[0].y
    for (const p of orbitPts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
    }
    const pad = 8, bw = maxX - minX || 1, bh = maxY - minY || 1
    const scale = Math.min(148 / (bw + pad * 2), 90 / (bh + pad * 2))
    const ox = -(minX - pad) * scale, oy = -(minY - pad) * scale
    const svgW = (bw + pad * 2) * scale, svgH = (bh + pad * 2) * scale
    const polyPts = orbitPts.map(p => `${(p.x * scale + ox).toFixed(1)},${(p.y * scale + oy).toFixed(1)}`).join(' ')
    const sx = orbitPts[0].x * scale + ox, sy = orbitPts[0].y * scale + oy
    const ep = orbitPts[orbitPts.length - 1]
    return { polyPts, sx, sy, svgW, svgH, ex: ep.x * scale + ox, ey: ep.y * scale + oy }
  })()

  const CollapseBtn = ({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) => (
    <button onClick={onToggle} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: 'none', border: 'none', cursor: 'pointer',
      padding: '1px 0', width: '100%', fontFamily: 'inherit',
    }}>
      <span style={{ fontSize: 7, fontWeight: 700, color: dimText, textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1 }}>{label}</span>
      <span style={{ fontSize: 7, color: dimText, lineHeight: 1 }}>{open ? '▲' : '▼'}</span>
    </button>
  )

  return (
    <div style={{
      width: 172, flexShrink: 0, minHeight: 0,
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
      </div>

      {!body ? (
        <div style={{ fontSize: 7, color: dimText, fontStyle: 'italic', lineHeight: 1.55 }}>no body selected</div>
      ) : (<>
        {([
          { key: 'T',   value: orbitStats ? `${orbitStats.T_real.toFixed(1)}s` : '—', title: 'orbital period' },
          { key: 'ecc', value: orbitStats ? orbitStats.ecc.toFixed(2)           : '—', title: 'eccentricity'   },
          { key: 'r',   value: orbitStats ? `${Math.round(orbitStats.r)}`       : '—', title: 'distance'       },
          { key: 'v',   value: orbitStats ? orbitStats.speed.toFixed(1)         : '—', title: 'speed'          },
        ] as const).map(row => (
          <div key={row.key} title={row.title} style={{ display: 'flex', alignItems: 'center', gap: 3, minHeight: 13 }}>
            <span style={{ fontSize: 7, color: dimText, width: 22, flexShrink: 0, textAlign: 'right', lineHeight: 1 }}>{row.key}</span>
            <span style={{ fontSize: 8, fontFamily: 'monospace', color: accentCol, flex: 1, textAlign: 'right', lineHeight: 1 }}>{row.value}</span>
          </div>
        ))}

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

        <div style={{ height: 0.5, background: divLine, margin: '1px 0' }} />
        <CollapseBtn label="Next Orbit" open={showNextOrbit} onToggle={() => setShowNextOrbit(v => !v)} />
        {showNextOrbit && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            {svgData ? (
              <svg
                width={Math.min(156, svgData.svgW)}
                height={Math.min(95, svgData.svgH)}
                viewBox={`0 0 ${svgData.svgW.toFixed(1)} ${svgData.svgH.toFixed(1)}`}
                style={{ display: 'block', borderRadius: 3, background: orbitBg }}
              >
                <polyline points={svgData.polyPts} fill="none" stroke={`${accentCol}99`} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={svgData.sx.toFixed(1)} cy={svgData.sy.toFixed(1)} r={3} fill={accentCol} opacity={0.9} />
                <circle cx={svgData.ex.toFixed(1)} cy={svgData.ey.toFixed(1)} r={2.5} fill="#f472b6" opacity={0.75} />
              </svg>
            ) : (
              <span style={{ fontSize: 8, color: dimText }}>
                {liveStats?.period && !isFinite(liveStats.period) ? 'Unbound orbit' : 'Computing…'}
              </span>
            )}
            {liveStats && isFinite(liveStats.period) && liveStats.period > 0 && (
              <div style={{ fontSize: 7.5, color: dimText, fontFamily: 'monospace' }}>
                T={liveStats.period.toFixed(1)} · ω={liveStats.omega.toFixed(4)}
              </div>
            )}
          </div>
        )}

        <div style={{ height: 0.5, background: divLine, margin: '1px 0' }} />
        <CollapseBtn label="Live Data" open={showLiveData} onToggle={() => setShowLiveData(v => !v)} />
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
    </div>
  )
}

// ── Orbit trigger input block ─────────────────────────────────────────────────

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
  const rawOrbits  = smoothRawOrbitsRef.current
  const cycleLen   = Math.max(0.0625, division)   // orbits per trigger cycle
  const progress   = (rawOrbits % cycleLen) / cycleLen   // 0–1
  const doneOrbits = Math.floor(rawOrbits % cycleLen)    // completed orbits within cycle
  const totalDone  = Math.floor(rawOrbits / cycleLen)    // how many times fired so far

  // ── T-period progress — wall-clock based ─────────────────────────────────
  // Uses performance.now() elapsed since last trigger vs. the stored interval (ms).
  const tpIntervalMs  = liveStats?.tperiodIntervalMs ?? 0
  const tpWallElapsed = (liveStats?.lastTriggerWallMs && tpIntervalMs > 0)
    ? Math.max(0, performance.now() - liveStats.lastTriggerWallMs)
    : 0
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

// ── Inline Ambient Osc content (rendered inside SlotCard) ───────────────────

/**
 * Minimal test-note button rendered inside the Ambient Osc instrument SlotCard.
 * Calls noteOn(60) on click and auto-releases after 2 s (or on second click).
 */
function InlineAmbientOscContent({
  bodyId, simple, accent,
}: { bodyId: string | null; simple: boolean; accent: string }) {
  const [testing, setTesting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dimText = simple ? 'rgba(0,0,0,0.40)' : 'rgba(255,255,255,0.35)'

  function handleTestNote() {
    if (!bodyId) return
    const eng = getBodyAmbientOscEngine(bodyId)
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
    }, 2000)
  }

  // Clean up timer on unmount
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return (
    <div style={{ padding: '4px 0 2px', display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        onClick={handleTestNote}
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
    const ambientEng  = getBodyAmbientOscEngine(targetId)
    const oscSynthEng = getBodyOscSynthEngine(targetId)
    const pitchEng    = ambientEng ?? oscSynthEng
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

// ── Inline One-Shot content (rendered inside SlotCard) ───────────────────────

/**
 * Compact one-shot sampler UI rendered directly inside the instrument SlotCard.
 * Mirrors OneShotSamplerPanel logic but in a narrow inline layout.
 */
function InlineOneShotContent({
  bodyId, slotKey, simple, accent, isStretch,
}: {
  bodyId: string | null
  slotKey: string
  simple: boolean
  accent: string
  isStretch?: boolean
}) {
  const samples         = useProjectStore(s => s.project.samples)
  const addSampleAsset  = useProjectStore(s => s.addSampleAsset)
  const overrides       = useControlSetStore(s => s.rackParamOverrides[slotKey] ?? EMPTY_PARAM_OVERRIDES)
  const setSlotOverride = useControlSetStore(s => s.setSlotOverride)
  const resetSlotParam  = useControlSetStore(s => s.resetSlotParam)
  const bodies          = usePlanetStore(s => s.bodies)
  const G               = usePlanetStore(s => s.simParams.G)

  const dimText   = simple ? 'rgba(0,0,0,0.32)' : 'rgba(255,255,255,0.28)'
  const accentDim = simple ? 'rgba(6,182,212,0.10)' : 'rgba(6,182,212,0.12)'
  const inputBg   = simple ? 'rgba(0,0,0,0.04)'  : 'rgba(255,255,255,0.05)'
  const inputCol  = simple ? '#333'               : '#e0e0e0'
  const borderCol = simple ? 'rgba(0,0,0,0.10)'  : 'rgba(255,255,255,0.10)'

  // ── Resolved sample ─────────────────────────────────────────────────────────
  const samplerMode = (overrides as Record<string, unknown>).samplerMode as string ?? 'auto'
  const fixedId     = (overrides as Record<string, unknown>).samplerSampleId as string | null ?? null
  const body        = usePlanetStore(s => bodyId ? (s.bodies.find(b => b.id === bodyId) ?? null) : null)
  const resolvedId  = samplerMode === 'fixed' ? fixedId : (body?.sampleId ?? null)
  const sample      = resolvedId ? (samples.find(s => s.id === resolvedId) ?? null) : null

  // ── Stretch info (only for instrument-oneshot-stretch) ──────────────────────
  const orbitStats  = isStretch && body ? computeOrbitStats(body, bodies, G) : null
  const tRealSec    = orbitStats?.T_real ?? null
  // bufferDuration read inline — re-evaluated on each render triggered by engState changes
  const bufDurSec   = isStretch && bodyId ? (getBodyOneShotEngine(bodyId)?.bufferDuration ?? 0) : 0

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
        const eng = getBodyOneShotEngine(bodyId)
        if (eng) {
          setEngState(eng.state)
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
  }, [bodyId])

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
        <option value="auto">Auto (body)</option>
        <option value="fixed">Fixed file</option>
      </select>
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

      {/* Stretch info row — original duration + orbit T */}
      {isStretch && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 2px' }}>
          <span style={{ fontSize: 7, color: dimText, flexShrink: 0 }}>orig</span>
          <span style={{ fontSize: 8, color: inputCol, fontFamily: 'monospace', fontWeight: 600 }}>
            {bufDurSec > 0 ? `${bufDurSec.toFixed(2)}s` : '—'}
          </span>
          <span style={{ fontSize: 7, color: dimText, flexShrink: 0, marginLeft: 4 }}>T</span>
          <span style={{ fontSize: 8, color: accent, fontFamily: 'monospace', fontWeight: 600 }}>
            {tRealSec !== null ? `${tRealSec.toFixed(2)}s` : '—'}
          </span>
          {bufDurSec > 0 && tRealSec !== null && (
            <>
              <span style={{ fontSize: 7, color: dimText, flexShrink: 0, marginLeft: 4 }}>×</span>
              <span style={{ fontSize: 8, color: '#a78bfa', fontFamily: 'monospace', fontWeight: 600 }}>
                {(tRealSec / bufDurSec).toFixed(2)}
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
      }}>
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

function SlotCard({
  cs, slotKey, simple, onClear, bodyId = null, onExtend, ghost = false,
}: {
  cs: ControlSet; slotKey: string; simple: boolean; onClear: () => void; bodyId?: string | null; onExtend?: () => void; ghost?: boolean
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
  const isOneShot = cs.id === 'instrument-oneshot' || cs.id === 'instrument-oneshot-stretch'

  // ── Ambient Oscillator active detection ────────────────────────────────────
  const isAmbientOsc = cs.id === 'instrument-ambient-osc'
  const effectiveAmbientOscType = isAmbientOsc
    ? String((overrides as Record<string, unknown>)['ambientOscType'] ?? cs.params.ambientOscType ?? 'off')
    : 'off'
  const isAmbientOscOn = isAmbientOsc && effectiveAmbientOscType === 'ambient-osc'

  // ── Osc Synth active detection ─────────────────────────────────────────────
  const isOscSynth = cs.id === 'instrument-osc-synth'
  const effectiveOscSynthType = isOscSynth
    ? String((overrides as Record<string, unknown>)['oscSynthType'] ?? cs.params.oscSynthType ?? 'off')
    : 'off'
  const isOscSynthOn = isOscSynth && effectiveOscSynthType === 'osc-synth'

  // ── Orbit trigger detection ────────────────────────────────────────────────
  const isOrbitTrigger = cs.id === 'orbit'

  // ── Manual trigger detection ───────────────────────────────────────────────
  const isManualTrigger   = cs.id === 'trigger-manual'
  const isChordTestTrigger = cs.id === 'trigger-chord-test'

  // ── Loaded samples (for sample dropdown) ──────────────────────────────────
  const loadedSamples = useProjectStore(s => s.project.samples)

  return (
    <div style={{
      position: 'relative',
      borderRadius: 6,
      border: ghost ? `0.5px dashed ${accent}40` : `0.5px solid ${accent}55`,
      background: ghost ? `${accent}07` : `${accent}10`,
      display: 'flex', flexDirection: 'column', padding: '5px 10px 5px 7px', gap: 3,
      opacity: ghost ? 0.58 : 1,
      pointerEvents: ghost ? 'none' : 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
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
        {!ghost && isSampler && onExtend && (
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
        <InlineOneShotContent bodyId={bodyId} slotKey={slotKey} simple={simple} accent={accent} isStretch={cs.id === 'instrument-oneshot-stretch'} />
      )}

      {/* Ambient Osc test-note button */}
      {isAmbientOscOn && (
        <InlineAmbientOscContent bodyId={bodyId} simple={simple} accent={accent} />
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
        // Ambient Osc sub-params: only when ambientOscType is 'ambient-osc'
        if (['ambientOscWaveform','ambientOscAttack','ambientOscRelease','ambientOscFilterCutoff',
             'ambientOscFilterResonance','ambientOscLevel','ambientOscNote'].includes(key) && !isAmbientOscOn) return null
        // Osc Synth sub-params: only when oscSynthType is 'osc-synth'
        if (['oscSynthWaveform','oscSynthAttack','oscSynthRelease','oscSynthFilterCutoff',
             'oscSynthFilterResonance','oscSynthLevel',
             'oscSynthLfoTarget','oscSynthLfoRate','oscSynthLfoDepth','oscSynthLfoWaveform'].includes(key) && !isOscSynthOn) return null
        // When OscSynth is on, 2-col sub-params render in the dedicated block below
        if (isOscSynthOn && OSC_SYNTH_2COL_KEYS.has(key)) return null
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
                {loadedSamples.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
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
          {OSC_SYNTH_2COL_ORDER.map((key, idx) => {
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

function RackInspectorColumn({ planetTool, simple }: { planetTool: PlanetTool | undefined; simple: boolean }) {
  const selectedBodyId = usePlanetStore(s => s.selectedBodyId)
  const showNext = !selectedBodyId && (planetTool === 'add-sun' || planetTool === 'add-planet')
  const scrollColor = simple ? 'rgba(0,0,0,0.12) transparent' : 'rgba(255,255,255,0.08) transparent'
  const border = simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)'
  const accentCol = simple ? '#2563eb' : '#7c3aed'

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
      {showNext ? (
        <NextBodyInspector tool={planetTool!} />
      ) : (
        <PlanetBodyInspector />
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

export function PlanetRack({ height, collapsed, onToggleCollapsed, onExtendSampler, onExtendOneShot, planetTool }: PlanetRackProps) {
  const simple         = usePlanetStore(s => s.simParams.simpleTheme)
  const selectedBodyId = usePlanetStore(s => s.selectedBodyId)
  const bodies         = usePlanetStore(s => s.bodies)

  const { globalRack, bodyRacks,
    setGlobalSlot, addGlobalEffect, removeGlobalEffect,
    addGlobalTrigger, removeGlobalTrigger,
    setBodySlot, clearBodySlot, addBodyEffect, removeBodyEffect,
    addBodyTrigger, removeBodyTrigger, clearBodyTriggers,
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
  function instrumentKey()        { return isBodyMode ? `b:${bodyId}:instrument`    : 'g:instrument'   }
  function effectKey(i: number)   { return isBodyMode ? `b:${bodyId}:effect:${i}`  : `g:effect:${i}`  }

  // Body-level override status
  const bodyOv          = bodyRacks[bodyId] ?? {}
  const hasTriggerOv    = isBodyMode && (bodyOv.triggers   != null && bodyOv.triggers.length   > 0)
  const hasInstrumentOv = isBodyMode && (bodyOv.instrument != null)
  const hasEffectsOv    = isBodyMode && (bodyOv.effects    != null && bodyOv.effects.length    > 0)

  // ── Assign helpers ────────────────────────────────────────────────────────
  function handleAssign(slot: 'trigger' | 'instrument' | 'effect', id: string) {
    const cs = BUILTIN_CONTROL_SETS.find(c => c.id === id)
    if (!cs) return
    if (slot === 'trigger') {
      if (isBodyMode) addBodyTrigger(bodyId, id)
      else addGlobalTrigger(id)
    } else if (slot === 'effect') {
      if (isBodyMode) addBodyEffect(bodyId, id)
      else addGlobalEffect(id)
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

  function handleClear(slot: 'instrument', hasOv: boolean) {
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
        ? BUILTIN_CONTROL_SETS.find(c => c.id === draggingControlSetId)
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
      const cs = BUILTIN_CONTROL_SETS.find(c => c.id === id)
      if (!cs) return
      const slot: 'trigger' | 'instrument' | 'effect' =
        cs.category === 'trigger' ? 'trigger' :
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
  const triggerCsList = effectiveRack.triggers.map(id => BUILTIN_CONTROL_SETS.find(c => c.id === id) ?? null)
  const instrumentCs  = effectiveRack.instrument ? BUILTIN_CONTROL_SETS.find(c => c.id === effectiveRack.instrument) : null
  const effectCsList  = effectiveRack.effects.map(id => BUILTIN_CONTROL_SETS.find(c => c.id === id) ?? null)

  return (
    <div style={{
      height: collapsed ? 18 : height,
      flexShrink: 0, background: bg,
      borderTop: `0.5px solid ${border}`,
      display: 'flex', flexDirection: 'row',
      overflow: 'hidden',
    }}>
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
          {collapsed ? '▲' : '▼'}
        </button>
        {!collapsed && isBodyMode && (
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

          {/* ── INSPECTOR (pinned — not inside horizontal scroll area) ── */}
          <RackInspectorColumn planetTool={planetTool} simple={simple} />
          <div style={{ width: 1, background: divCol, margin: '6px 0', flexShrink: 0 }} />

          {/* ── ORBIT (pinned) ── */}
          <RackOrbitColumn selectedBodyId={isBodyMode ? selectedBodyId : null} simple={simple} />
          <div style={{ width: 1, background: divCol, margin: '6px 0', flexShrink: 0 }} />

          {/* ── Scrollable slots area (Trigger → Mixer) ── */}
          <div style={{
            flex: 1, display: 'flex', alignItems: 'stretch',
            overflowX: 'auto', overflowY: 'hidden',
            scrollbarWidth: 'thin',
            scrollbarColor: simple ? 'rgba(0,0,0,0.12) transparent' : 'rgba(255,255,255,0.08) transparent',
          }}>

          {/* ── TRIGGER ── */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
            <SectionLabel label="Trigger" simple={simple} highlighted={rackDragCat === 'trigger'} />
            <div style={{ width: 1, background: divCol, margin: '6px 0' }} />
            <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
              {triggerCsList.length > 0 ? triggerCsList.map((cs, i) =>
                cs ? (
                  <div key={i} style={{ flexShrink: 0, width: 148 }}>
                    <SlotCard cs={cs}
                      slotKey={isBodyMode && !hasTriggerOv ? `g:trigger:${i}` : triggerKey(i)}
                      simple={simple}
                      bodyId={isBodyMode ? bodyId : null}
                      ghost={isBodyMode && !hasTriggerOv}
                      onClear={() => handleClearTrigger(i)} />
                  </div>
                ) : null
              ) : (
                <EmptySlot simple={simple} highlighted={rackDragCat === 'trigger'} />
              )}
              {triggerCsList.length < MAX_TRIGGERS && triggerCsList.length > 0 && (
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

          {/* ── TRIGGER → INSTRUMENT signal bridge ── */}
          <TriggerSignalBridge bodyId={isBodyMode ? bodyId : null} simple={simple} />

          {/* ── INSTRUMENT ── */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
            <SectionLabel label="Instrument" simple={simple} highlighted={rackDragCat === 'instrument'} />
            <div style={{ width: 1, background: divCol, margin: '6px 0' }} />
            <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: 4, minWidth: (instrumentCs?.id === 'instrument-oneshot' || instrumentCs?.id === 'instrument-oneshot-stretch') ? 220 : instrumentCs?.id === 'instrument-ambient-osc' ? 185 : instrumentCs?.id === 'instrument-osc-synth' ? 210 : 160 }}>
              {instrumentCs ? (
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
                  } />
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
                  <div key={i} style={{ flexShrink: 0, width: 148 }}>
                    <SlotCard cs={cs}
                      slotKey={isBodyMode && !hasEffectsOv ? `g:effect:${i}` : effectKey(i)}
                      simple={simple}
                      bodyId={isBodyMode ? bodyId : null}
                      ghost={isBodyMode && !hasEffectsOv}
                      onClear={() => handleClearEffect(i)} />
                  </div>
                ) : null
              )}
              {effectCsList.length < MAX_EFFECTS && (
                <EmptySlot simple={simple} highlighted={rackDragCat === 'effect'} />
              )}
            </div>
          </div>

          {/* ── MIXER OUTPUT ── */}
          <div style={{ width: 1, background: divCol, margin: '6px 0', flexShrink: 0 }} />
          <RackMixerColumn bodyId={isBodyMode ? selectedBodyId : null} simple={simple} />

          </div>{/* end scrollable slots */}
        </div>
      )}
    </div>
  )
}
