import * as Tone from 'tone'
import type { ModularProject, SampleAsset } from '../patch/types'
import { mapRange } from '../patch/connectionRules'
import { resolveControlInputs, resolveTriggerOutput } from '../patch/geometryGraph'

// Tone.js node instances keyed by project node ID
const oscillators = new Map<string, Tone.Oscillator>()
const noiseNodes = new Map<string, Tone.Noise>()
const gainNodes   = new Map<string, Tone.Gain>()
const filterNodes = new Map<string, Tone.Filter>()
const delayNodes = new Map<string, Tone.FeedbackDelay>()
const samplerGains = new Map<string, Tone.Gain>()
const samplerPlayers = new Map<string, Tone.Player>()
const samplerFallbackSynths = new Map<string, Tone.MembraneSynth>()
const prevTriggerValues = new Map<string, boolean>()
let isBuilt = false

function getToneNode(nodeId: string, nodeType: string): Tone.ToneAudioNode | null {
  if (oscillators.has(nodeId)) return oscillators.get(nodeId)!
  if (noiseNodes.has(nodeId)) return noiseNodes.get(nodeId)!
  if (gainNodes.has(nodeId))   return gainNodes.get(nodeId)!
  if (filterNodes.has(nodeId)) return filterNodes.get(nodeId)!
  if (delayNodes.has(nodeId)) return delayNodes.get(nodeId)!
  if (samplerGains.has(nodeId)) return samplerGains.get(nodeId)!
  if (nodeType === 'audio.output' || nodeType === 'dac~') return Tone.getDestination()
  return null
}

export function teardown() {
  oscillators.forEach(o => { try { o.stop(); o.dispose() } catch (_) { /* ignore */ } })
  noiseNodes.forEach(n => { try { n.stop(); n.dispose() } catch (_) { /* ignore */ } })
  gainNodes.forEach(g => { try { g.dispose() } catch (_) { /* ignore */ } })
  filterNodes.forEach(f => { try { f.dispose() } catch (_) { /* ignore */ } })
  delayNodes.forEach(d => { try { d.dispose() } catch (_) { /* ignore */ } })
  samplerPlayers.forEach(p => { try { p.stop(); p.dispose() } catch (_) { /* ignore */ } })
  samplerFallbackSynths.forEach(s => { try { s.dispose() } catch (_) { /* ignore */ } })
  samplerGains.forEach(g => { try { g.dispose() } catch (_) { /* ignore */ } })
  oscillators.clear()
  noiseNodes.clear()
  gainNodes.clear()
  filterNodes.clear()
  delayNodes.clear()
  samplerPlayers.clear()
  samplerFallbackSynths.clear()
  samplerGains.clear()
  prevTriggerValues.clear()
  isBuilt = false
}

export function buildGraph(project: ModularProject) {
  teardown()

  for (const node of project.nodes) {
    switch (node.type) {
      case 'audio.oscillator': {
        const freq  = (node.params.frequency as number) ?? 440
        const wave  = (node.params.waveform  as Tone.ToneOscillatorType) ?? 'sine'
        const osc   = new Tone.Oscillator(freq, wave)
        oscillators.set(node.id, osc)
        break
      }
      case 'cycle~':
      case 'phasor~': {
        const freq = (node.params.frequency as number) ?? (node.type === 'phasor~' ? 1 : 440)
        const wave = node.type === 'phasor~' ? 'sawtooth' : ((node.params.waveform as Tone.ToneOscillatorType) ?? 'sine')
        const osc = new Tone.Oscillator(freq, wave as Tone.ToneOscillatorType)
        oscillators.set(node.id, osc)
        break
      }
      case 'noise~': {
        const noise = new Tone.Noise((node.params.type as Tone.NoiseType) ?? 'white')
        noiseNodes.set(node.id, noise)
        break
      }
      case 'audio.gain': {
        const gain = new Tone.Gain((node.params.gain as number) ?? 0.7)
        gainNodes.set(node.id, gain)
        break
      }
      case 'gain~':
      case 'mix~': {
        const gain = new Tone.Gain((node.params.gain as number) ?? 1)
        gainNodes.set(node.id, gain)
        break
      }
      case 'filter~': {
        const filter = new Tone.Filter((node.params.frequency as number) ?? 1200, (node.params.type as BiquadFilterType) ?? 'lowpass')
        filterNodes.set(node.id, filter)
        break
      }
      case 'delay~': {
        const delay = new Tone.FeedbackDelay((node.params.time as number) ?? 0.25, (node.params.feedback as number) ?? 0.2)
        delayNodes.set(node.id, delay)
        break
      }
      case 'sampler~':
      case 'audio.sampler': {
        const gain = new Tone.Gain((node.params.gain as number) ?? 0.8)
        samplerGains.set(node.id, gain)
        const sample = sampleForSampler(node.id, project)
        // Only create a Player when there is a valid (non-empty) URL.
        // An empty objectUrl means the blob was stripped on save and hasn't
        // been restored yet — treat it the same as "no sample assigned".
        if (sample && sample.objectUrl) {
          const player = new Tone.Player({ url: sample.objectUrl })
          player.playbackRate = (node.params.playbackRate as number) ?? 1
          player.connect(gain)
          samplerPlayers.set(node.id, player)
        } else {
          const synth = new Tone.MembraneSynth({
            pitchDecay: 0.025,
            octaves: 3,
            envelope: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.12 },
          })
          synth.connect(gain)
          samplerFallbackSynths.set(node.id, synth)
        }
        break
      }
    }
  }

  // Wire audio edges
  for (const edge of project.edges) {
    if (edge.signalType !== 'audio') continue
    const fromNode = project.nodes.find(n => n.id === edge.fromNodeId)
    const toNode   = project.nodes.find(n => n.id === edge.toNodeId)
    if (!fromNode || !toNode) continue
    const src = getToneNode(edge.fromNodeId, fromNode.type)
    const dst = getToneNode(edge.toNodeId,   toNode.type)
    if (src && dst) {
      try { src.connect(dst as Tone.InputNode) } catch (_) { /* ignore dup connect */ }
    }
  }

  // Start oscillators
  oscillators.forEach(o => o.start())
  noiseNodes.forEach(n => n.start())
  isBuilt = true

  // Apply initial control values
  applyControlValues(project)
}

export function applyControlValues(project: ModularProject) {
  if (!isBuilt) return

  const inputKeys = new Set<string>()
  for (const edge of project.edges) {
    if (edge.signalType === 'control' || edge.signalType === 'geometry') {
      inputKeys.add(`${edge.toNodeId}:${edge.toPortId}`)
    }
  }

  for (const key of inputKeys) {
    const [nodeId, portId] = key.split(':')
    const values = resolveControlInputs(nodeId, portId, project)
    if (values.length === 0) continue
    const rawValue = values.reduce((sum, value) => sum + value, 0) / values.length
    applyControlInput(nodeId, portId, rawValue, project)
  }
}

function applyControlInput(nodeId: string, portId: string, rawValue: number, project: ModularProject) {
  const node = project.nodes.find(n => n.id === nodeId)
  if (!node) return

  switch (node.type) {
    case 'audio.oscillator':
    case 'cycle~':
    case 'phasor~':
      if (portId === 'frequency') {
        const freq = mapRange(rawValue, 0, 400, 80, 1200)
        const osc  = oscillators.get(nodeId)
        if (osc) osc.frequency.rampTo(freq, 0.02)
      }
      break
    case 'audio.gain':
    case 'gain~':
    case 'mix~':
      if (portId === 'gain') {
        const g = gainNodes.get(nodeId)
        if (g) g.gain.rampTo(Math.max(0, Math.min(2, rawValue)), 0.02)
      }
      break
    case 'filter~':
      if (portId === 'frequency') {
        const filter = filterNodes.get(nodeId)
        if (filter) filter.frequency.rampTo(mapRange(rawValue, 0, 400, 80, 6000), 0.02)
      }
      break
    case 'delay~':
      if (portId === 'time') {
        const delay = delayNodes.get(nodeId)
        if (delay) delay.delayTime.rampTo(Math.max(0, Math.min(2, rawValue)), 0.02)
      }
      break
    case 'audio.sampler':
    case 'sampler~':
      if (portId === 'gain') {
        const g = samplerGains.get(nodeId)
        if (g) g.gain.rampTo(Math.max(0, Math.min(2, rawValue)), 0.02)
      }
      break
  }
}

export function processTriggerValues(project: ModularProject, timeSeconds: number) {
  if (!isBuilt) return

  for (const edge of project.edges) {
    if (edge.signalType !== 'trigger') continue
    const toNode = project.nodes.find(n => n.id === edge.toNodeId)
    if (!toNode || (toNode.type !== 'audio.sampler' && toNode.type !== 'sampler~') || edge.toPortId !== 'trigger') continue

    const current = resolveTriggerOutput(edge.fromNodeId, edge.fromPortId, project, new Set<string>(), timeSeconds)
    const key = `${edge.id}:${edge.toNodeId}`
    const prev = prevTriggerValues.get(key) ?? false
    if (current && !prev) triggerSampler(toNode.id, project)
    prevTriggerValues.set(key, current)
  }
}

function triggerSampler(nodeId: string, project: ModularProject) {
  const player = samplerPlayers.get(nodeId)
  const fallback = samplerFallbackSynths.get(nodeId)
  const node = project.nodes.find(n => n.id === nodeId)
  if (!node) return
  try {
    if (player) {
      // Skip silently if the buffer hasn't finished loading yet.
      if (!player.loaded) return
      player.stop()
      player.playbackRate = (node.params.playbackRate as number) ?? 1
      player.start(Tone.now(), 0)
    } else {
      fallback?.triggerAttackRelease('C2', '16n', Tone.now(), 0.85)
    }
  } catch (_) {
    /* ignore unexpected errors */
  }
}

function sampleForSampler(nodeId: string, project: ModularProject): SampleAsset | null {
  const node = project.nodes.find(n => n.id === nodeId)
  if (!node) return null
  const sampleId = typeof node.params.sampleId === 'string' ? node.params.sampleId : ''
  return project.samples.find(sample => sample.id === sampleId) ?? null
}

export async function startEngine(project: ModularProject): Promise<void> {
  await Tone.start()
  buildGraph(project)
  // Wait for all sample buffers to finish loading before the engine starts
  // processing triggers. Blob URLs from local files load nearly instantly;
  // this prevents the first metro pulse from firing into an unloaded player.
  await Tone.loaded()
}

export function stopEngine() {
  oscillators.forEach(o => { try { o.stop() } catch (_) { /* ignore */ } })
  noiseNodes.forEach(n => { try { n.stop() } catch (_) { /* ignore */ } })
}

export async function resumeEngine(project: ModularProject): Promise<void> {
  buildGraph(project)
  await Tone.loaded()
}

export function updateOscFrequency(nodeId: string, frequency: number) {
  const osc = oscillators.get(nodeId)
  if (osc) osc.frequency.rampTo(frequency, 0.02)
}
