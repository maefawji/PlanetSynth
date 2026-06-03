import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import { useProjectStore } from '../../store/projectStore'
import { useControlSetStore } from '../../store/controlSetStore'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import {
  triggerBodySound,
  startStandpointSound,
  stopStandpointSound,
  stopAllLoopingPlayers,
  getPlayerDuration,
  ensureEffectorBus,
  destroyEffectorBus,
  setEffectorOutputGain,
  setPlayerEffectorSend,
  clearPlayerEffectorSend,
  setBodySelfEffectorSend,
  setBodyProximityRackSend,
  clearBodyProximityRackSend,
  markBodyTriggered,
  setPlayerRate,
  setPlayerDetune,
  setPlayerPan,
} from '../../audio/intersectionSynth'
import type { PlanetBody, PlanetSimParams } from '../../store/planetStore'
import { BODY_DRONE_DEFAULTS, BODY_MIDI_DEFAULTS } from '../../store/planetStore'
import { ADSR_OFF, computeOrbitAdsr } from '../../audio/orbitAdsr'
import type { SampleAsset } from '../../patch/types'
import { setBodyOutputLevel, clearBodyOutputLevel } from '../../audio/bodyOutputMeter'
import { computeBodyRackOutputSpatial } from '../../audio/bodyRackOutput'
import { clearBusOscilloscopeAnalysers, getBusOscilloscopeData, setBusStandpointSpatial } from '../../audio/rackBusMixer'
import { fireBodyInstrumentTrigger } from '../../audio/instrumentTrigger'
import { getBodyOneShotEngine } from '../../audio/OneShotSamplerEngine'
import { getBodyOscSynthEngine } from './OscSynthLayer'
import { getBodyWaveLabEngine } from './WaveLabInstrumentLayer'
import { sendMidiNote } from '../../audio/midiManager'
import { unlockMobileAudio } from '../../audio/mobileAudioUnlock'
import { generateStarIdentity, collectExistingIdentities } from '../../lib/starNaming'

export type PlanetTool = 'select' | 'add-sun' | 'add-planet' | 'probe'

// ── Orbit-preview snapshot (updated every RAF frame) ─────────────────────────
// Lets RightInspector compute next-orbit prediction without coupling to the
// component internals.

interface LiveBodySnap { id: string; mass: number; x: number; y: number; z: number; vx: number; vy: number; ax: number; ay: number; fixed: boolean }
let _liveBodiesSnap: LiveBodySnap[] = []
let _simParamsSnap: Pick<PlanetSimParams, 'G' | 'epsilon' | 'dt'> = { G: 1, epsilon: 5, dt: 0.2 }
const _trailsSnap = new Map<string, TrailRing>()

export function getPlanetLiveBodySnapshot(): LiveBodySnap[] {
  return _liveBodiesSnap.map(b => ({ ...b }))
}

// ── Smoothed period cache (for time-stretch "constant speed" mode) ────────────
// Exponential moving average of each body's orbital period.
// Updated every RAF frame. Prevents rate jitter caused by instantaneous ω variation.
const _smoothedPeriods = new Map<string, number>()
const PERIOD_SMOOTH_ALPHA = 0.015  // slow alpha → stable rate for time-stretch

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

function buildArpChordNotes(tp: Record<string, unknown>): number[] {
  const rootPc = Math.max(0, Math.min(11, Math.round(Number(tp.arpChordRoot ?? 0))))
  const octave = Math.max(0, Math.min(8, Math.round(Number(tp.arpChordOctave ?? 3))))
  const quality = String(tp.arpChordQuality ?? 'Maj7')
  const intervals = ARP_CHORD_INTERVALS[quality] ?? ARP_CHORD_INTERVALS.Maj7
  const inversion = Math.max(0, Math.min(intervals.length - 1, Math.round(Number(tp.arpChordInversion ?? 0))))
  const base = (octave + 1) * 12 + rootPc
  return intervals.map((iv, i) => {
    const raised = i < inversion ? 12 : 0
    return Math.max(0, Math.min(127, base + iv + raised))
  }).sort((a, b) => a - b)
}

// Reusable acceleration buffers for verletStep — eliminates per-step heap allocation
let _prevAxBuf = new Float64Array(0)
let _prevAyBuf = new Float64Array(0)

/** Returns the smoothed (EMA) orbital period for a body, in sim-time units. */
export function getSmoothedPeriod(bodyId: string): number | null {
  return _smoothedPeriods.get(bodyId) ?? null
}

/** Returns the recorded trail points for `bodyId` as an ordered array (oldest → newest). */
export function getBodyTrailPoints(bodyId: string): Array<{x: number; y: number}> | null {
  const ring = _trailsSnap.get(bodyId)
  if (!ring || ring.count < 2) return null
  const pts = new Array<{x: number; y: number}>(ring.count)
  const start = ring.count < ring.capacity ? 0 : ring.head
  for (let i = 0; i < ring.count; i++) {
    const idx = (start + i) % ring.capacity
    pts[i] = { x: ring.xs[idx], y: ring.ys[idx] }
  }
  return pts
}

/** Returns the predicted positions for `bodyId` over the next `steps` simulation steps. */
export function computeOrbitPreviewForBody(bodyId: string, steps: number): Array<{x: number; y: number}> | null {
  const body = _liveBodiesSnap.find(b => b.id === bodyId)
  if (!body || body.fixed) return null
  const cloned = _liveBodiesSnap.map(b => ({ ...b }))
  computeAccels(cloned, _simParamsSnap.G, _simParamsSnap.epsilon)
  const t = cloned.find(b => b.id === bodyId)!
  const pts: Array<{x: number; y: number}> = [{ x: t.x, y: t.y }]
  for (let i = 0; i < steps; i++) {
    verletStep(cloned, _simParamsSnap)
    pts.push({ x: t.x, y: t.y })
  }
  return pts
}

// ── Physics output cache ──────────────────────────────────────────────────────
// Covers every row in the 運動の情報 → 音の要素 mapping.
export interface PlanetBodyStats {
  // Position (world)
  x: number; y: number
  // Velocity
  vx: number; vy: number; speed: number
  // Acceleration
  ax: number; ay: number; accel: number
  // Orbital relative to system centre of mass
  r: number           // distance from CoM  → 音量, リバーブ, 低域
  angleDeg: number    // 0-360°             → パン, フィルター
  angleNorm: number   // 0-1
  omega: number       // rad / sim-unit     → LFO速度
  period: number      // sim-units / orbit  → LFO周期; Infinity when ω ≈ 0
  lfoPhase: number    // 0-1 fractional orbit
  totalOrbits: number // cumulative orbit count (never resets) — for cumulative trigger mode
  simTime: number          // accumulated simulation time (sum of dt steps, never resets)
  lastTriggerSimTime: number // simTime when T-period trigger last fired (0 = never)
  lastTriggerWallMs: number  // performance.now() when T-period last fired (0 = never armed)
  tperiodIntervalMs: number  // wall-clock ms for current T-period interval (0 = not armed)
  // Nearest other body
  nearestDist: number      // Infinity when alone → FM量, 干渉
  nearestRelSpeed: number
  // Mouse-probe cursor (Infinity when cursor not yet positioned)
  probeDist: number        // → 発音イベント, 接近
  probeAngleDeg: number    // 0-360°
  probeAngleNorm: number   // 0-1
}
export const planetBodyStatsCache = new Map<string, PlanetBodyStats>()

function computeSampleStretchRate(args: {
  sampleDuration: number
  period: number
  smoothedPeriod?: number
  dt: number
  frameSeconds: number
  stretchRatio: number
  stretchMode: string
  orbitSource?: string
}): number | null {
  if (args.stretchMode === 'off' || args.sampleDuration <= 0 || !isFinite(args.period) || args.period <= 0) return null
  const effectivePeriod = args.stretchMode === 'time'
    ? (args.smoothedPeriod ?? args.period)
    : args.orbitSource === 'predicted'
      ? (args.smoothedPeriod ?? args.period)
      : args.period
  const frameSeconds = Math.max(0.001, args.frameSeconds)
  const simStep = Math.max(0.000001, args.dt * STEPS_PER_FRAME)
  const realSecondsPerOrbit = effectivePeriod / simStep * frameSeconds
  if (!isFinite(realSecondsPerOrbit) || realSecondsPerOrbit <= 0) return null
  return Math.max(0.001, Math.min(4, args.sampleDuration * args.stretchRatio / realSecondsPerOrbit))
}

function detuneForRate(rate: number, enabled: boolean): number {
  return enabled ? -1200 * Math.log2(Math.max(0.001, rate)) : 0
}

function stableIndexFromId(id: string, length: number): number {
  if (length <= 0) return 0
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % length
}

function resolveBodySamplerSample(bodyId: string, _legacyBodySampleId: string | null | undefined, samples: SampleAsset[]): SampleAsset | null {
  const rack = useControlSetStore.getState().getBodyEffectiveRack(bodyId)
  // Instrument owns sample selection; legacy body.sampleId is intentionally ignored.
  if (rack.instrument !== 'instrument-sampler') return null
  const ep = useControlSetStore.getState().getBodyEffectiveParams(bodyId)
  const samplerMode = String((ep as Record<string, unknown>).samplerMode ?? 'auto')
  if (samplerMode === 'fixed') {
    const fixedId = String((ep as Record<string, unknown>).samplerSampleId ?? '')
    return fixedId ? (samples.find(s => s.id === fixedId) ?? null) : null
  }
  if (samples.length === 0) return null
  return samples[stableIndexFromId(bodyId, samples.length)] ?? null
}

// ── Simulation types ──────────────────────────────────────────────────────────

interface LiveBody {
  id: string; mass: number; x: number; y: number
  z: number; vx: number; vy: number; ax: number; ay: number; fixed: boolean
}

interface TrailRing {
  xs: Float32Array; ys: Float32Array; head: number; count: number; capacity: number
}

interface DragPlaceState {
  bodyX: number; bodyY: number; dragX: number; dragY: number
  tool: 'add-sun' | 'add-planet'
}

interface TriggerStarMarker {
  id: string
  bodyId: string
  x: number
  y: number
  color: string
  bornMs: number
}

// ── Physics ───────────────────────────────────────────────────────────────────

function computeAccels(bodies: LiveBody[], G: number, eps: number): void {
  for (const b of bodies) { b.ax = 0; b.ay = 0 }
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const bi = bodies[i], bj = bodies[j]
      const dx = bj.x - bi.x, dy = bj.y - bi.y
      const r2 = dx * dx + dy * dy + eps * eps
      const r  = Math.sqrt(r2)
      const f  = G / (r2 * r)
      if (!bi.fixed) { bi.ax += f * bj.mass * dx; bi.ay += f * bj.mass * dy }
      if (!bj.fixed) { bj.ax -= f * bi.mass * dx; bj.ay -= f * bi.mass * dy }
    }
  }
}

function verletStep(bodies: LiveBody[], params: Pick<PlanetSimParams, 'G' | 'epsilon' | 'dt'>): void {
  const { G, epsilon: eps, dt } = params
  for (const b of bodies) {
    if (b.fixed) continue
    b.x += b.vx * dt + 0.5 * b.ax * dt * dt
    b.y += b.vy * dt + 0.5 * b.ay * dt * dt
  }
  if (_prevAxBuf.length < bodies.length) {
    _prevAxBuf = new Float64Array(bodies.length)
    _prevAyBuf = new Float64Array(bodies.length)
  }
  for (let i = 0; i < bodies.length; i++) { _prevAxBuf[i] = bodies[i].ax; _prevAyBuf[i] = bodies[i].ay }
  computeAccels(bodies, G, eps)
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].fixed) continue
    bodies[i].vx += 0.5 * (_prevAxBuf[i] + bodies[i].ax) * dt
    bodies[i].vy += 0.5 * (_prevAyBuf[i] + bodies[i].ay) * dt
  }
}

// ── Trail ring buffer ─────────────────────────────────────────────────────────

function makeTrail(capacity: number): TrailRing {
  return { xs: new Float32Array(capacity), ys: new Float32Array(capacity), head: 0, count: 0, capacity }
}

function pushTrail(ring: TrailRing, x: number, y: number): void {
  ring.xs[ring.head] = x; ring.ys[ring.head] = y
  ring.head = (ring.head + 1) % ring.capacity
  if (ring.count < ring.capacity) ring.count++
}

function launchVelocityFromDrag(dp: DragPlaceState): { vx: number; vy: number } {
  return {
    vx: (dp.bodyX - dp.dragX) * VELOCITY_SCALE,
    vy: (dp.bodyY - dp.dragY) * VELOCITY_SCALE,
  }
}

const MOBILE_MAX_PLANETS = 10

function trailToPoints(ring: TrailRing): string {
  if (ring.count < 2) return ''
  const parts = new Array<string>(ring.count)
  const start = ring.count < ring.capacity ? 0 : ring.head
  for (let i = 0; i < ring.count; i++) {
    const idx = (start + i) % ring.capacity
    parts[i] = `${ring.xs[idx].toFixed(1)},${ring.ys[idx].toFixed(1)}`
  }
  return parts.join(' ')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bodyScreenR(
  mass: number,
  type: PlanetBody['type'] = 'planet',
  fromMass = false,
  planetMassScale = 0.1,
  sunMassScale = 0.125,
): number {
  if (fromMass) {
    const scale = type === 'sun' ? sunMassScale : planetMassScale
    return Math.max(4, mass * scale)
  }
  const base = Math.max(4, Math.cbrt(mass) * 2)
  return type === 'sun' ? base * 1.25 : base
}

function depthScaleFromZ(z: number | null | undefined): number {
  const raw = 1 + (Number.isFinite(z) ? Number(z) : 0) / 500
  return Math.max(0.25, Math.min(3, raw))
}

function projectedBodyScreenR(
  mass: number,
  type: PlanetBody['type'] = 'planet',
  z = 0,
  fromMass = false,
  planetMassScale = 0.1,
  sunMassScale = 0.125,
): number {
  return bodyScreenR(mass, type, fromMass, planetMassScale, sunMassScale) * depthScaleFromZ(z)
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS_PER_FRAME   = 4
const TRAIL_STEP_INTERVAL = 2
const VELOCITY_SCALE    = 0.02   // bow-and-arrow: velocity per world-unit of drag pullback
const PREDICT_STEPS     = 800    // forward-sim steps for drag-place orbit preview
// ── Predicted orbit ───────────────────────────────────────────────────────────

/** Run a forward simulation clone and return the preview body's trajectory as
 *  an SVG polyline points string. Safe to call every render frame. */
function computePredictedOrbit(
  liveBodies: LiveBody[],
  params: Pick<PlanetSimParams, 'G' | 'epsilon' | 'dt'>,
  previewBody: LiveBody,
  steps: number,
): string {
  // Clone existing bodies + append preview
  const cloned: LiveBody[] = liveBodies.map(b => ({ ...b }))
  cloned.push({ ...previewBody })
  computeAccels(cloned, params.G, params.epsilon)
  const preview = cloned[cloned.length - 1]
  const pts: string[] = [`${previewBody.x.toFixed(1)},${previewBody.y.toFixed(1)}`]
  for (let i = 0; i < steps; i++) {
    verletStep(cloned, params)
    pts.push(`${preview.x.toFixed(1)},${preview.y.toFixed(1)}`)
  }
  return pts.join(' ')
}

function circularOscilloscopePath(
  cx: number,
  cy: number,
  radius: number,
  amp: number,
  data: Float32Array,
): string {
  if (data.length < 2) return ''
  const total = 72
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
    const phase = i / total
    const a = phase * Math.PI * 2 - Math.PI / 2
    const v = values[(seam + 1 + i) % total]
    const r = radius + v * amp
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`
  }
  return d
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PlanetCanvas({ tool = 'select', onSelectTool, mobileMode = false }: { tool?: PlanetTool; onSelectTool?: () => void; mobileMode?: boolean }) {
  // Keep onSelectTool in a ref so the keydown closure doesn't need it in deps
  const onSelectToolRef = useRef(onSelectTool)
  useEffect(() => { onSelectToolRef.current = onSelectTool }, [onSelectTool])

  // ── Store subscriptions ──────────────────────────────────────────────────
  const { bodies: storeBodies, simParams: storeParams, selectedBodyId, selectedBodyIds, resetSeq, setSelectedBodyId } = usePlanetStore()
  const monochromeMode = useCanvasSettingsStore(s => s.monochromeMode)
  const monochromeInverted = useCanvasSettingsStore(s => s.monochromeInverted)
  const paperCanvasBackground = useCanvasSettingsStore(s => s.paperCanvasBackground)
  const paperCanvasInk = useCanvasSettingsStore(s => s.paperCanvasInk)
  const paperCanvasTone = useCanvasSettingsStore(s => s.paperCanvasTone)
  const paperCanvasTrailOpacity = useCanvasSettingsStore(s => s.paperCanvasTrailOpacity)
  const paperCanvasLabelOpacity = useCanvasSettingsStore(s => s.paperCanvasLabelOpacity)
  const paperCanvasKeepBodyColors = useCanvasSettingsStore(s => s.paperCanvasKeepBodyColors)
  const canvasStrokeWidth = useCanvasSettingsStore(s => s.strokeWidth)
  const orbitTrailStrokeWidth = useCanvasSettingsStore(s => s.orbitTrailStrokeWidth)
  const orbitTrailOpacity = useCanvasSettingsStore(s => s.orbitTrailOpacity)
  const orbitTrailDash = useCanvasSettingsStore(s => s.orbitTrailDash)
  const canvasBackgroundImageUrl = useCanvasSettingsStore(s => s.canvasBackgroundImageUrl)
  const canvasBackgroundImageOpacity = useCanvasSettingsStore(s => s.canvasBackgroundImageOpacity)
  const canvasBackgroundImageFit = useCanvasSettingsStore(s => s.canvasBackgroundImageFit)
  const canvasBackgroundImageColorInMonochrome = useCanvasSettingsStore(s => s.canvasBackgroundImageColorInMonochrome)

  // ── Simulation refs (declared first so all effects can use them) ─────────
  const storeBodiesRef    = useRef<PlanetBody[]>(storeBodies)
  // O(1) body lookup — kept in sync with storeBodiesRef
  const storeBodiesMapRef  = useRef<Map<string, PlanetBody>>(new Map(storeBodies.map(b => [b.id, b])))
  // Per-frame caches: populated once at frame start, reused throughout the RAF loop
  const bodyParamsCacheRef = useRef<Map<string, Partial<PlanetSimParams>>>(new Map())
  const trigParamsCacheRef = useRef<Map<string, Partial<PlanetSimParams>[]>>(new Map())
  const rackCacheRef       = useRef<Map<string, { triggers: string[]; instrument: string | null; effects: string[] }>>(new Map())
  const liveBodiesRef   = useRef<LiveBody[]>([])
  const trailsRef       = useRef<Map<string, TrailRing>>(new Map())
  const bodyOscilloscopeRef = useRef<Map<string, Float32Array>>(new Map())
  const simParamsRef    = useRef<PlanetSimParams>(storeParams)
  const trailStepRef    = useRef(0)
  const prevInRef       = useRef<Map<string, boolean>>(new Map())
  const prevAngleRef    = useRef<Map<string, number>>(new Map())
  const lfoAccumRef     = useRef<Map<string, number>>(new Map())
  const simTimeRef      = useRef(0)                                // total accumulated sim time
  const lastTriggerSimTimeRef = useRef<Map<string, number>>(new Map()) // per-body T-period trigger time
  // Wall-clock T-period timing (performance.now() ms — independent of sim speed)
  // Keys: bodyId (single trigger) or `${bodyId}:${triggerIndex}` (multi-trigger)
  const lastTriggerWallMsRef  = useRef<Map<string, number>>(new Map())
  const tperiodIntervalMsRef  = useRef<Map<string, number>>(new Map())
  // Direct orbit-crossing measurement for accurate T estimate (avoids slow EMA warm-up)
  const lastOrbitCrossWallMsRef = useRef<Map<string, number>>(new Map())  // wall-clock of last full-orbit crossing
  const measuredRealTMsRef      = useRef<Map<string, number>>(new Map())  // measured wall-clock duration of last orbit
  // toggle mode: tracks whether each body's sample is currently looping (true = on)
  const toggleStateRef  = useRef<Map<string, boolean>>(new Map())
  // Arpeggiator: current step index per timerKey
  const arpStepRef      = useRef<Map<string, number>>(new Map())
  // Arpeggiator: last note fired per timerKey (for monophonic noteOff on next step)
  const arpPrevNoteRef  = useRef<Map<string, number[]>>(new Map())
  const lastAutoSpawnMsRef = useRef(performance.now())
  const triggerStarMarkersRef = useRef<TriggerStarMarker[]>([])

  // Sync storeBodiesRef + purge deleted bodies from live simulation
  useEffect(() => {
    const newIds = new Set(storeBodies.map(b => b.id))
    const removed = liveBodiesRef.current.filter(lb => !newIds.has(lb.id))
    if (removed.length > 0) {
      // Stop any looping/toggle samples for removed bodies before cleaning up
      for (const lb of removed) {
        const sb = storeBodiesRef.current.find(b => b.id === lb.id)
        if (sb?.sampleId) stopStandpointSound(sb.sampleId)
        useControlSetStore.getState().clearBodyRack(lb.id)
        destroyEffectorBus(lb.id)
      }
      liveBodiesRef.current = liveBodiesRef.current.filter(lb => newIds.has(lb.id))
      for (const lb of removed) {
        trailsRef.current.delete(lb.id)
        bodyOscilloscopeRef.current.delete(lb.id)
        triggerStarMarkersRef.current = triggerStarMarkersRef.current.filter(m => m.bodyId !== lb.id)
        prevAngleRef.current.delete(lb.id)
        lfoAccumRef.current.delete(lb.id)
        lastTriggerSimTimeRef.current.delete(lb.id)
        lastTriggerWallMsRef.current.delete(lb.id)
        tperiodIntervalMsRef.current.delete(lb.id)
        lastOrbitCrossWallMsRef.current.delete(lb.id)
        measuredRealTMsRef.current.delete(lb.id)
        planetBodyStatsCache.delete(lb.id)
        toggleStateRef.current.delete(lb.id)
        arpStepRef.current.delete(lb.id)
        arpPrevNoteRef.current.delete(lb.id)
      }
      prevInRef.current.clear()
      if (liveBodiesRef.current.length > 0)
        computeAccels(liveBodiesRef.current, simParamsRef.current.G, simParamsRef.current.epsilon)
    }
    // Stop samples for bodies whose sampleId was replaced
    for (const newBody of storeBodies) {
      const oldBody = storeBodiesRef.current.find(b => b.id === newBody.id)
      if (oldBody?.sampleId && oldBody.sampleId !== newBody.sampleId) {
        stopStandpointSound(oldBody.sampleId)
      }
    }
    const bodyById = new Map(storeBodies.map(b => [b.id, b]))
    for (const liveBody of liveBodiesRef.current) {
      const storeBody = bodyById.get(liveBody.id)
      if (storeBody) liveBody.z = storeBody.z ?? 0
    }

    storeBodiesRef.current    = storeBodies
    storeBodiesMapRef.current = bodyById
  }, [storeBodies])

  const projectSamplesRef = useRef(useProjectStore.getState().project.samples)
  useEffect(() => {
    return useProjectStore.subscribe(s => { projectSamplesRef.current = s.project.samples })
  }, [])

  // Merge base simParams with rack overrides → simParamsRef
  useEffect(() => {
    simParamsRef.current = { ...storeParams, ...useControlSetStore.getState().getEffectiveParams() }
  }, [storeParams])
  useEffect(() => {
    if (storeParams.showBodyOscilloscope || storeParams.showRackBodyOscilloscope) return
    bodyOscilloscopeRef.current.clear()
    clearBusOscilloscopeAnalysers()
  }, [storeParams.showBodyOscilloscope, storeParams.showRackBodyOscilloscope])
  useEffect(() => {
    return useControlSetStore.subscribe(() => {
      simParamsRef.current = { ...usePlanetStore.getState().simParams, ...useControlSetStore.getState().getEffectiveParams() }
    })
  }, [])

  // Stop looping players when orbit-stretch mode turns off
  useEffect(() => {
    if (!storeParams.orbitStretchMode) stopAllLoopingPlayers()
  }, [storeParams.orbitStretchMode])

  // Camera follow + tool refs for RAF access
  const cameraFollowBodyIdRef = useRef<string | null>(usePlanetStore.getState().cameraFollowBodyId)
  useEffect(() => {
    return usePlanetStore.subscribe(s => { cameraFollowBodyIdRef.current = s.cameraFollowBodyId })
  }, [])

  const toolRef = useRef<PlanetTool>(tool)
  useEffect(() => { toolRef.current = tool }, [tool])

  // Mouse world position for probe tool (null = not yet positioned)
  const mousePosWorldRef = useRef<{ x: number; y: number } | null>(null)

  // Frame timing (EMA) for real-time orbit-stretch rate calculation
  const frameTimeRef    = useRef(16.67)
  const lastFrameMsRef  = useRef(performance.now())
  const lastRenderMsRef = useRef(0)   // throttle React re-renders to ~30fps

  function markTriggeredOnCanvas(bodyId: string) {
    markBodyTriggered(bodyId)
    const sp = simParamsRef.current
    if (!sp.showTriggerStars) return
    const live = liveBodiesRef.current.find(b => b.id === bodyId)
    if (!live) return
    const storeBody = storeBodiesMapRef.current.get(bodyId)
    const nowMs = performance.now()
    const marker: TriggerStarMarker = {
      id: `${bodyId}:${nowMs.toFixed(2)}:${triggerStarMarkersRef.current.length}`,
      bodyId,
      x: live.x,
      y: live.y,
      color: storeBody?.color ?? '#facc15',
      bornMs: nowMs,
    }
    const maxCount = Math.max(1, Math.floor(sp.triggerStarMaxCount || 1))
    triggerStarMarkersRef.current = [...triggerStarMarkersRef.current, marker].slice(-maxCount)
  }

  // ── Initialize / reinitialize ─────────────────────────────────────────────
  const initFromStore = useCallback(() => {
    const { bodies: sb, simParams: sp } = usePlanetStore.getState()
    const live: LiveBody[] = sb.map(b => ({
      id: b.id, mass: b.mass, x: b.x, y: b.y, z: b.z ?? 0, vx: b.vx, vy: b.vy, ax: 0, ay: 0, fixed: b.fixed,
    }))
    computeAccels(live, sp.G, sp.epsilon)
    liveBodiesRef.current = live
    const trails = new Map<string, TrailRing>()
    for (const b of live) trails.set(b.id, makeTrail(sp.trailLength))
    trailsRef.current = trails
    trailStepRef.current = 0
    prevInRef.current.clear()
    prevAngleRef.current.clear()
    lfoAccumRef.current.clear()
    simTimeRef.current = 0
    lastTriggerSimTimeRef.current.clear()
    lastTriggerWallMsRef.current.clear()
    tperiodIntervalMsRef.current.clear()
    lastOrbitCrossWallMsRef.current.clear()
    measuredRealTMsRef.current.clear()
    toggleStateRef.current.clear()
    arpStepRef.current.clear()
    arpPrevNoteRef.current.clear()
    planetBodyStatsCache.clear()
  }, [])

  useEffect(() => { initFromStore() }, [resetSeq, initFromStore])

  // ── Camera ────────────────────────────────────────────────────────────────
  const [zoom, setZoom]             = useState(0.5)
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 })
  const zoomRef       = useRef(zoom)
  const viewOffsetRef = useRef(viewOffset)

  function setZoomSync(z: number) { zoomRef.current = z; setZoom(z) }
  function setViewOffsetSync(o: { x: number; y: number }) { viewOffsetRef.current = o; setViewOffset(o) }

  // ── Canvas size ───────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef       = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const sizeRef = useRef(size)
  useEffect(() => { sizeRef.current = size }, [size])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setSize({ w: Math.max(1, width), h: Math.max(1, height) })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // ── Wheel (non-passive) ───────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top
      const { w, h } = sizeRef.current
      const cx = w / 2, cy = h / 2
      const curZ = zoomRef.current, curO = viewOffsetRef.current

      if (e.ctrlKey) {
        // Trackpad pinch zoom (continuous)
        const wx = (sx - cx) / curZ + curO.x, wy = (sy - cy) / curZ + curO.y
        const nz = Math.max(0.02, Math.min(50, curZ * Math.exp(-e.deltaY * 0.006)))
        setZoomSync(nz)
        setViewOffsetSync({ x: wx - (sx - cx) / nz, y: wy - (sy - cy) / nz })
      } else if (Math.abs(e.deltaX) > 0.5 || Math.abs(e.deltaY) < 50) {
        // Two-finger trackpad pan:
        //   horizontal component → definitely trackpad
        //   small deltaY (< 50px) → smooth trackpad scroll (mouse wheel click ≈ 100px)
        setViewOffsetSync({ x: curO.x + e.deltaX / curZ, y: curO.y + e.deltaY / curZ })
      } else {
        // Mouse wheel zoom (large discrete deltaY, no horizontal component)
        const wx = (sx - cx) / curZ + curO.x, wy = (sy - cy) / curZ + curO.y
        const nz = Math.max(0.02, Math.min(50, curZ * Math.exp(-Math.sign(e.deltaY) * 0.13)))
        setZoomSync(nz)
        setViewOffsetSync({ x: wx - (sx - cx) / nz, y: wy - (sy - cy) / nz })
      }
    }
    svg.addEventListener('wheel', handler, { passive: false })
    return () => svg.removeEventListener('wheel', handler)
  }, [])

  // ── Interaction state ─────────────────────────────────────────────────────
  const [draggingBodyId, setDraggingBodyId] = useState<string | null>(null)
  const [isPanning, setIsPanning]           = useState(false)
  const [dragPlace, setDragPlace]           = useState<DragPlaceState | null>(null)
  const dragOffRef   = useRef({ dx: 0, dy: 0 })
  const panStartRef  = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const dragPlaceRef = useRef<DragPlaceState | null>(null)
  const [, setTick]  = useState(0)

  // ── Drag-rect multi-select ────────────────────────────────────────────────
  interface DragSelRect { sx: number; sy: number; ex: number; ey: number }
  const [dragSel, setDragSel]         = useState<DragSelRect | null>(null)
  const dragSelStartRef               = useRef<{ sx: number; sy: number } | null>(null)
  const pendingBodySelectRef          = useRef<{ sx: number; sy: number } | null>(null)

  // ── Esc cancels active drag, deselects body, and switches to select tool ─
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        dragPlaceRef.current = null
        setDragPlace(null)
        setDraggingBodyId(null)
        panStartRef.current = null
        setIsPanning(false)
        dragSelStartRef.current = null
        pendingBodySelectRef.current = null
        setDragSel(null)
        usePlanetStore.getState().setSelectedBodyId(null)
        onSelectToolRef.current?.()
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Ignore when focus is in a text input / select / textarea
        const tag = (document.activeElement as HTMLElement | null)?.tagName ?? ''
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return
        const { selectedBodyId, removeBody } = usePlanetStore.getState()
        if (selectedBodyId) removeBody(selectedBodyId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── RAF loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let rafId: number

    function frame() {
      // Frame-time tracking for orbit-stretch rate computation
      const nowMs = performance.now()
      const rawDt = nowMs - lastFrameMsRef.current
      lastFrameMsRef.current = nowMs
      frameTimeRef.current = frameTimeRef.current * 0.9 + rawDt * 0.1

      const params = simParamsRef.current
      const bodies = liveBodiesRef.current
      const trails = trailsRef.current

      // ── Per-frame caches (ONE store read + O(n) build; reused everywhere) ────
      const csStore  = useControlSetStore.getState()
      const sbMap    = storeBodiesMapRef.current
      const bpCache  = bodyParamsCacheRef.current
      const tpCache  = trigParamsCacheRef.current
      const rkCache  = rackCacheRef.current
      bpCache.clear(); tpCache.clear(); rkCache.clear()
      for (const b of bodies) {
        bpCache.set(b.id, csStore.getBodyEffectiveParams(b.id))
        tpCache.set(b.id, csStore.getBodyTriggerParamsList(b.id))
        rkCache.set(b.id, csStore.getBodyEffectiveRack(b.id))
      }

      // Update module-level snapshot for orbit-preview (every frame, cheap)
      _liveBodiesSnap = bodies.map(b => ({ ...b }))
      _simParamsSnap  = { G: params.G, epsilon: params.epsilon, dt: params.dt }

      if (!params.paused) {
        const probeMode = toolRef.current === 'probe'
        const mp = mousePosWorldRef.current

        for (let s = 0; s < STEPS_PER_FRAME; s++) {
          // Temporarily add mouse-probe as a virtual fixed body so it affects physics
          if (probeMode && params.probeMass > 0 && mp) {
            bodies.push({
              id: '__probe__', mass: params.probeMass,
              x: mp.x, y: mp.y, z: 0, vx: 0, vy: 0, ax: 0, ay: 0, fixed: true,
            })
          }
          verletStep(bodies, params)
          trailStepRef.current++
          if (trailStepRef.current % TRAIL_STEP_INTERVAL === 0) {
            for (const b of bodies) {
              if (b.id === '__probe__') continue
              const ring = trails.get(b.id)
              if (ring) { pushTrail(ring, b.x, b.y); _trailsSnap.set(b.id, ring) }
            }
          }
          if (probeMode && params.probeMass > 0 && mp) bodies.pop()
        }

        // ── Auto-delete escaped (unbound) bodies ───────────────────────────
        {
          const G = params.G
          let totalMass = 0, cmX = 0, cmY = 0
          for (const b of bodies) { totalMass += b.mass; cmX += b.mass * b.x; cmY += b.mass * b.y }
          if (totalMass > 0) { cmX /= totalMass; cmY /= totalMass }
          const toDelete: string[] = []
          for (const b of bodies) {
            if (b.fixed) continue
            const dx = b.x - cmX, dy = b.y - cmY
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < 4000) continue  // not far enough yet
            // Specific orbital energy = KE + PE (sum over all other bodies)
            const v2 = b.vx * b.vx + b.vy * b.vy
            let pe = 0
            for (const other of bodies) {
              if (other.id === b.id) continue
              const odx = other.x - b.x, ody = other.y - b.y
              const r = Math.sqrt(odx * odx + ody * ody)
              if (r > 0.001) pe -= G * other.mass / r
            }
            if (0.5 * v2 + pe > 0) toDelete.push(b.id)
          }
          if (toDelete.length > 0) {
            for (const id of toDelete) {
              usePlanetStore.getState().removeBody(id)
              liveBodiesRef.current = liveBodiesRef.current.filter(b => b.id !== id)
              trailsRef.current.delete(id)
              triggerStarMarkersRef.current = triggerStarMarkersRef.current.filter(m => m.bodyId !== id)
              prevAngleRef.current.delete(id)
              lfoAccumRef.current.delete(id)
              lastTriggerSimTimeRef.current.delete(id)
              lastTriggerWallMsRef.current.delete(id)
              tperiodIntervalMsRef.current.delete(id)
              planetBodyStatsCache.delete(id)
              toggleStateRef.current.delete(id)
              arpStepRef.current.delete(id)
              arpPrevNoteRef.current.delete(id)
              storeBodiesMapRef.current.delete(id)
            }
            computeAccels(liveBodiesRef.current, params.G, params.epsilon)
          }
        }

        // ── Rendezvous triggers ────────────────────────────────────────────
        // Rack-only: a body participates only when its rack slot sets rendezvousDistance > 0.
        // There is no global fallback — global simParams values are ignored here.
        {
          const samples = projectSamplesRef.current
          const prevIn  = prevInRef.current
          const togSt   = toggleStateRef.current

          // Helper: fire or toggle a sample for one body, using its effective params
          function fireOrToggle(bodyId: string, sampleId: string | null, rate: number, vol: number) {
            const sbi = sbMap.get(bodyId)
            if (sbi?.muted) return                     // body is muted — skip

            // ── MIDI OUT ─ Note On to instrument ─────────────────────────────
            // Send MIDI Note On regardless of which path handles audio playback.
            // Instrument slot (OneShotLayer) listens via MIDI IN to play.
            sendMidiNote(
              sbi?.midiChannel  ?? 1,
              sbi?.midiNote     ?? 60,
              sbi?.midiVelocity ?? 100,
              200,
            )

            // ── Instrument engine path (oneshot etc.) ─────────────────────────
            // If the body's instrument rack consumed the trigger, skip legacy path.
            if (fireBodyInstrumentTrigger(bodyId)) {
              markTriggeredOnCanvas(bodyId)
              return
            }

            // ── Legacy sample path ────────────────────────────────────────────
            const bodyVol = sbi?.volume ?? 1           // per-body volume scale
            const sample = resolveBodySamplerSample(bodyId, sampleId, samples)
            if (!sample) return
            // Per-body rack overrides global params for this body
            const bodyOverride = bpCache.get(bodyId) ?? {}
            const effectiveMode = (bodyOverride.rendezvousTriggerMode ?? 'oneshot') as string
            const triggerPlaybackMode = (bodyOverride.triggerPlaybackMode ?? params.triggerPlaybackMode) as string
            const spatial = computeBodyRackOutputSpatial(bodyId, bodies, params, bodyOverride)
            const scaledVol = vol * spatial.volume * bodyVol
            setBodyOutputLevel(bodyId, 'sampler', scaledVol, effectiveMode === 'toggle' ? 500 : 900)
            const liveBody = bodies.find(b => b.id === bodyId)
            const adsr = params.adsrMode === 'off'
              ? ADSR_OFF
              : params.adsrMode === 'orbit' && liveBody
                ? computeOrbitAdsr(liveBody, bodies, params.G)
                : undefined
            const stretchMode = (bodyOverride.sampleStretchMode ?? params.sampleStretchMode) as string
            const pitchCorrection = stretchMode === 'time' || Boolean(bodyOverride.samplePitchCorrection ?? params.samplePitchCorrection)
            const detuneCents = detuneForRate(rate, pitchCorrection)
            if (effectiveMode === 'toggle') {
              const on = !(togSt.get(bodyId) ?? false)
              togSt.set(bodyId, on)
              if (on) { startStandpointSound(sample, scaledVol, rate, adsr, spatial.pan); setPlayerDetune(sample.id, detuneCents); markTriggeredOnCanvas(bodyId) }
              else      { stopStandpointSound(sample.id); clearBodyOutputLevel(bodyId, 'sampler') }
            } else {
              triggerBodySound(sample, {
                playbackRate: rate,
                volume: scaledVol,
                adsr,
                overlap: triggerPlaybackMode === 'layer',
                pan: spatial.pan,
                detuneCents,
              })
              markTriggeredOnCanvas(bodyId)
            }
          }

          // Body-body rendezvous — check each pair using the effective rdDist for the pair
          for (let i = 0; i < bodies.length; i++) {
            for (let j = i + 1; j < bodies.length; j++) {
              const bi = bodies[i], bj = bodies[j]
              // Use the larger of the two bodies' effective rendezvous distance
              const biOverride = bpCache.get(bi.id) ?? {}
              const bjOverride = bpCache.get(bj.id) ?? {}
              const rdDistI = (biOverride.rendezvousDistance as number | undefined) ?? 0
              const rdDistJ = (bjOverride.rendezvousDistance as number | undefined) ?? 0
              const rdDist  = Math.max(rdDistI, rdDistJ)
              if (rdDist <= 0) continue
              const dx = bj.x - bi.x, dy = bj.y - bi.y
              const dist = Math.sqrt(dx * dx + dy * dy)
              const key  = `${bi.id}|${bj.id}`
              const wasIn = prevIn.get(key) ?? false
              const isIn  = dist <= rdDist
              if (isIn && !wasIn) {
                const sbi = sbMap.get(bi.id)
                const sbj = sbMap.get(bj.id)
                const relV = Math.sqrt((bi.vx - bj.vx) ** 2 + (bi.vy - bj.vy) ** 2)
                const rate = Math.max(0.3, Math.min(3.0, 0.5 + relV * 0.3))
                const vol  = Math.max(0.2, Math.min(1.0, 1.0 - dist / (rdDist * 2)))
                fireOrToggle(bi.id, sbi?.sampleId ?? null, rate, vol)
                fireOrToggle(bj.id, sbj?.sampleId ?? null, rate, vol)
              }
              prevIn.set(key, isIn)
            }
          }

          // Body-probe rendezvous (when probe is active)
          if (toolRef.current === 'probe' && mp) {
            for (const b of bodies) {
              const bOverride = bpCache.get(b.id) ?? {}
              const rdDist = (bOverride.rendezvousDistance as number | undefined) ?? 0
              if (rdDist <= 0) continue
              const dx = mp.x - b.x, dy = mp.y - b.y
              const dist = Math.sqrt(dx * dx + dy * dy)
              const key  = `__probe__|${b.id}`
              const wasIn = prevIn.get(key) ?? false
              const isIn  = dist <= rdDist
              if (isIn && !wasIn) {
                const sbi = sbMap.get(b.id)
                fireOrToggle(b.id, sbi?.sampleId ?? null, 1 + dist * 0.002, 0.85)
              }
              prevIn.set(key, isIn)
            }
          }
        }
      }

      // ── Orbital stats (always — even when paused) ──────────────────────────
      {
        const bodies = liveBodiesRef.current  // fresh read after potential verlet
        let totalMass = 0, cmX = 0, cmY = 0
        for (const b of bodies) { totalMass += b.mass; cmX += b.mass * b.x; cmY += b.mass * b.y }
        if (totalMass > 0) { cmX /= totalMass; cmY /= totalMass }

        const params   = simParamsRef.current

        // Advance simulation clock (only when running)
        if (!params.paused) simTimeRef.current += params.dt * STEPS_PER_FRAME
        const smpArr   = projectSamplesRef.current
        const mp       = mousePosWorldRef.current

        for (const b of bodies) {
          const dx = b.x - cmX, dy = b.y - cmY
          const r  = Math.sqrt(dx * dx + dy * dy)
          const angle = Math.atan2(dy, dx)

          // Angle accumulation (only advances when simulation is running)
          const prevAngle = prevAngleRef.current.get(b.id) ?? angle
          let dAngle = angle - prevAngle
          if (dAngle >  Math.PI) dAngle -= 2 * Math.PI
          if (dAngle < -Math.PI) dAngle += 2 * Math.PI
          prevAngleRef.current.set(b.id, angle)
          const prevAccum = lfoAccumRef.current.get(b.id) ?? 0
          const newAccum  = prevAccum + dAngle
          lfoAccumRef.current.set(b.id, newAccum)
          const lfoPhase = ((newAccum / (2 * Math.PI)) % 1 + 1) % 1

          const angleDeg  = ((angle * 180 / Math.PI) + 360) % 360
          const angleNorm = angleDeg / 360
          const speed     = Math.sqrt(b.vx * b.vx + b.vy * b.vy)
          const accel     = Math.sqrt(b.ax * b.ax + b.ay * b.ay)
          const vPerp     = r > 0.001 ? (b.vx * (-dy) + b.vy * dx) / r : 0
          const omega     = r > 0.001 ? vPerp / r : 0
          const period    = Math.abs(omega) > 0.0001 ? (2 * Math.PI / Math.abs(omega)) : Infinity

          // Nearest other body
          let nearestDist = Infinity, nearestRelSpeed = 0
          for (const other of bodies) {
            if (other.id === b.id) continue
            const odx = other.x - b.x, ody = other.y - b.y
            const od  = Math.sqrt(odx * odx + ody * ody)
            if (od < nearestDist) {
              nearestDist = od
              nearestRelSpeed = Math.sqrt((other.vx - b.vx) ** 2 + (other.vy - b.vy) ** 2)
            }
          }

          // Probe distance
          const pdx = mp ? mp.x - b.x : 0, pdy = mp ? mp.y - b.y : 0
          const probeDist       = mp ? Math.sqrt(pdx * pdx + pdy * pdy) : Infinity
          const probeAngleDeg   = mp ? ((Math.atan2(pdy, pdx) * 180 / Math.PI) + 360) % 360 : 0
          const probeAngleNorm  = probeAngleDeg / 360

          planetBodyStatsCache.set(b.id, {
            x: b.x, y: b.y, vx: b.vx, vy: b.vy, speed,
            ax: b.ax, ay: b.ay, accel,
            r, angleDeg, angleNorm, omega, period, lfoPhase,
            totalOrbits: newAccum / (2 * Math.PI),
            simTime: simTimeRef.current,
            lastTriggerSimTime: lastTriggerSimTimeRef.current.get(b.id) ?? 0,
            lastTriggerWallMs: lastTriggerWallMsRef.current.get(b.id) ?? 0,
            tperiodIntervalMs: tperiodIntervalMsRef.current.get(b.id) ?? 0,
            nearestDist, nearestRelSpeed,
            probeDist, probeAngleDeg, probeAngleNorm,
          })

          // Update smoothed period (EMA) for time-stretch "constant speed" mode
          if (isFinite(period) && period > 0) {
            const prev = _smoothedPeriods.get(b.id) ?? period
            _smoothedPeriods.set(b.id, prev * (1 - PERIOD_SMOOTH_ALPHA) + period * PERIOD_SMOOTH_ALPHA)
          }

          // Merge per-body rack on top of global params for this body
          // (pre-computed at frame start — O(1) lookup here)
          const bodyOverride   = bpCache.get(b.id) ?? {}
          const bodyParams     = Object.keys(bodyOverride).length > 0
            ? { ...params, ...bodyOverride }
            : params

          // ── Standpoint spatial: applied at rack bus level every frame ──────────
          // Skip the Web Audio API call entirely when standpoint is off (common case).
          if (params.standpointMode && params.standpointBodyId) {
            const sp = computeBodyRackOutputSpatial(b.id, bodies, params, bodyParams)
            setBusStandpointSpatial(b.id, sp.volume, sp.pan)
          }

          // ── Per-trigger orbit evaluation ──────────────────────────────────────
          // Each trigger in the rack fires independently with its own params.
          // Using prevAccum / newAccum (already computed above) for orbit crossing detection.
          const sbi   = sbMap.get(b.id)
          if (!params.paused && sbi && !sbi.muted && newAccum !== 0) {
            const triggerParamsList = tpCache.get(b.id) ?? []
            const rack = rkCache.get(b.id) ?? { triggers: [] as string[], instrument: null as string | null, effects: [] as string[] }

            for (let ti = 0; ti < triggerParamsList.length; ti++) {
              const tp       = triggerParamsList[ti]
              const tpOrbitMode = String(tp.orbitTriggerMode ?? '')
              const tpType      = String(tp.orbitTriggerType ?? 'cumulative')
              if (tpOrbitMode !== 'orbit-complete') continue

              if (tpType !== 'tperiod') {
                // ── Orbit-complete (angle-based) ──────────────────────────────
                const div = Math.max(0.0625, Number(tp.orbitTriggerDivision ?? 1))
                const unit = 2 * Math.PI * div
                const prevOrbit = Math.floor(Math.abs(prevAccum) / unit)
                const currOrbit = Math.floor(Math.abs(newAccum) / unit)
                if (currOrbit > prevOrbit) {
                  sendMidiNote(sbi.midiChannel ?? 1, sbi.midiNote ?? 60, sbi.midiVelocity ?? 100, 200)
                  // Only fire instrument on the FIRST (ti=0) trigger to avoid duplicate audio
                  if (ti === 0) {
                    const numer = Number((bodyParams as Record<string, unknown>).orbitLoopNumer ?? 1)
                    const denom = Number((bodyParams as Record<string, unknown>).orbitLoopDenom ?? 1)
                    const stretchRatio = denom > 0 ? numer / denom : 1
                    const oneShotDur = getBodyOneShotEngine(b.id)?.bufferDuration ?? 0
                    const instrRate = rack.instrument === 'instrument-oneshot-stretch'
                      ? (computeSampleStretchRate({
                          sampleDuration: oneShotDur, period,
                          smoothedPeriod: _smoothedPeriods.get(b.id),
                          dt: params.dt, frameSeconds: frameTimeRef.current / 1000,
                          stretchRatio, stretchMode: 'rate',
                          orbitSource: (bodyParams as Record<string, unknown>).sampleOrbitSource as string ?? 'current',
                        }) ?? 1)
                      : 1
                    if (fireBodyInstrumentTrigger(b.id, instrRate)) {
                      markTriggeredOnCanvas(b.id)
                    } else {
                      const sample = resolveBodySamplerSample(b.id, sbi.sampleId, smpArr)
                      if (sample) {
                        const spatial = computeBodyRackOutputSpatial(b.id, bodies, params, bodyParams)
                        const bodyVol = sbi.volume ?? 1
                        const finalVol = 0.85 * spatial.volume * bodyVol
                        const adsr = params.adsrMode === 'off' ? ADSR_OFF
                          : params.adsrMode === 'orbit' ? computeOrbitAdsr(b, bodies, params.G) : undefined
                        const tPlayMode = (bodyParams.triggerPlaybackMode as string | undefined) ?? params.triggerPlaybackMode
                        const stretchM  = (bodyParams.sampleStretchMode as string | undefined) ?? ((bodyParams.orbitStretchMode as boolean | undefined) ? 'rate' : 'off')
                        const lnumer = sbi.orbitLoopNumer ?? 1, ldenom = sbi.orbitLoopDenom ?? 1
                        const lstr = ldenom > 0 ? lnumer / ldenom : 1
                        const tRate = computeSampleStretchRate({
                          sampleDuration: getPlayerDuration(sample.id), period,
                          smoothedPeriod: _smoothedPeriods.get(b.id),
                          dt: params.dt, frameSeconds: frameTimeRef.current / 1000,
                          stretchRatio: lstr, stretchMode: stretchM,
                          orbitSource: (bodyParams.sampleOrbitSource as string | undefined) ?? 'current',
                        }) ?? 1
                        triggerBodySound(sample, {
                          playbackRate: tRate, volume: finalVol, adsr,
                          overlap: tPlayMode === 'layer', pan: spatial.pan,
                          detuneCents: detuneForRate(tRate, stretchM === 'time' || Boolean(bodyParams.samplePitchCorrection)),
                        })
                        setBodyOutputLevel(b.id, 'sampler', finalVol, 900)
                        markTriggeredOnCanvas(b.id)
                      }
                    }
                  }
                }

              } else {
                // ── T-period trigger (wall-clock timer) ───────────────────────
                // Timer key: bodyId for ti=0 (display compat), `${bodyId}:N` for extras
                const timerKey = ti === 0 ? b.id : `${b.id}:${ti}`
                const nowMs = performance.now()

                // Orbit-crossing measurement (shared for all T-period triggers of this body)
                // Only run once (ti === 0) to avoid redundant work
                if (ti === 0) {
                  const fullPrev = Math.floor(Math.abs(prevAccum) / (2 * Math.PI))
                  const fullCurr = Math.floor(Math.abs(newAccum) / (2 * Math.PI))
                  if (fullCurr > fullPrev) {
                    const lastCross = lastOrbitCrossWallMsRef.current.get(b.id)
                    if (lastCross !== undefined) {
                      const measured = nowMs - lastCross
                      if (measured >= 10 && measured <= 60_000)
                        measuredRealTMsRef.current.set(b.id, measured)
                    }
                    lastOrbitCrossWallMsRef.current.set(b.id, nowMs)
                  }
                }

                const tpDiv = Math.max(0.0625, Number(tp.orbitTriggerDivision ?? 1))
                const measuredT = measuredRealTMsRef.current.get(b.id)
                let intervalMs: number
                if (measuredT !== undefined) {
                  intervalMs = measuredT * tpDiv
                } else {
                  const smoothedP  = _smoothedPeriods.get(b.id)
                  const effectiveP = (smoothedP && isFinite(smoothedP) && smoothedP > 0) ? smoothedP
                    : (isFinite(period) && period > 0 ? period : 0)
                  if (effectiveP <= 0) continue
                  intervalMs = (effectiveP / (params.dt * STEPS_PER_FRAME)) * frameTimeRef.current * tpDiv
                }
                intervalMs = Math.max(16, intervalMs)

                const lastWall = lastTriggerWallMsRef.current.get(timerKey)
                if (ti === 0) tperiodIntervalMsRef.current.set(b.id, intervalMs)

                if (lastWall === undefined || (nowMs - lastWall) >= intervalMs) {
                  lastTriggerWallMsRef.current.set(timerKey, nowMs)

                  // ── Arpeggiator / chord trigger notes ────────────────────────
                  const tpRecord = tp as Record<string, unknown>
                  const arpMode  = Boolean(tpRecord.arpMode)
                  const arpPlayMode = String(tpRecord.arpPlayMode ?? 'arp')
                  const arpLen   = Math.max(1, Math.min(4, Number((tp as Record<string, unknown>).arpLength ?? 4)))
                  const arpNotes = [
                    Number((tp as Record<string, unknown>).arpNote0 ?? 48),
                    Number((tp as Record<string, unknown>).arpNote1 ?? 52),
                    Number((tp as Record<string, unknown>).arpNote2 ?? 55),
                    Number((tp as Record<string, unknown>).arpNote3 ?? 59),
                  ]
                  let fireNotes = [sbi.midiNote ?? 60]
                  if (arpMode) {
                    // Release previous step/chord before firing next.
                    const prevNotes = arpPrevNoteRef.current.get(timerKey) ?? []
                    if (prevNotes.length > 0) {
                      const oscEng = getBodyOscSynthEngine(b.id)
                      const waveEng = getBodyWaveLabEngine(b.id)
                      for (const prevNote of prevNotes) {
                        oscEng?.noteOff(prevNote)
                        waveEng?.noteOff(prevNote)
                      }
                    }
                    if (arpPlayMode === 'chord') {
                      fireNotes = buildArpChordNotes(tpRecord)
                    } else {
                      const step = arpStepRef.current.get(timerKey) ?? 0
                      fireNotes = [arpNotes[step % arpLen]]
                      arpStepRef.current.set(timerKey, (step + 1) % arpLen)
                    }
                    arpPrevNoteRef.current.set(timerKey, fireNotes)
                  }

                  for (const fireNote of fireNotes) {
                    sendMidiNote(sbi.midiChannel ?? 1, fireNote, sbi.midiVelocity ?? 100, 200)
                  }
                  if (ti === 0) {
                    const tpNumer = Number((bodyParams as Record<string, unknown>).orbitLoopNumer ?? 1)
                    const tpDenom = Number((bodyParams as Record<string, unknown>).orbitLoopDenom ?? 1)
                    const tpStr = tpDenom > 0 ? tpNumer / tpDenom : 1
                    const tpDur = getBodyOneShotEngine(b.id)?.bufferDuration ?? 0
                    const tpRate = rack.instrument === 'instrument-oneshot-stretch'
                      ? (computeSampleStretchRate({
                          sampleDuration: tpDur, period,
                          smoothedPeriod: _smoothedPeriods.get(b.id),
                          dt: params.dt, frameSeconds: frameTimeRef.current / 1000,
                          stretchRatio: tpStr, stretchMode: 'rate',
                          orbitSource: (bodyParams as Record<string, unknown>).sampleOrbitSource as string ?? 'current',
                        }) ?? 1)
                      : 1
                    const supportsPitchedNotes =
                      rack.instrument === 'instrument-wave-lab' ||
                      rack.instrument === 'instrument-osc-synth-orbit'
                    const instrumentNotes = supportsPitchedNotes ? fireNotes : [fireNotes[0]]
                    let consumed = false
                    for (const fireNote of instrumentNotes) {
                      consumed = fireBodyInstrumentTrigger(b.id, tpRate, arpMode ? fireNote : undefined) || consumed
                    }
                    if (consumed) {
                      markTriggeredOnCanvas(b.id)
                    } else {
                      const sample = resolveBodySamplerSample(b.id, sbi.sampleId, smpArr)
                      if (sample) {
                        const spatial  = computeBodyRackOutputSpatial(b.id, bodies, params, bodyParams)
                        const bodyVol  = sbi.volume ?? 1
                        const finalVol = 0.85 * spatial.volume * bodyVol
                        const adsr = params.adsrMode === 'off' ? ADSR_OFF
                          : params.adsrMode === 'orbit' ? computeOrbitAdsr(b, bodies, params.G) : undefined
                        const tPlayMode = (bodyParams.triggerPlaybackMode as string | undefined) ?? params.triggerPlaybackMode
                        const stretchM  = (bodyParams.sampleStretchMode as string | undefined) ?? ((bodyParams.orbitStretchMode as boolean | undefined) ? 'rate' : 'off')
                        const lnumer = sbi.orbitLoopNumer ?? 1, ldenom = sbi.orbitLoopDenom ?? 1
                        const lstr = ldenom > 0 ? lnumer / ldenom : 1
                        const tRate = computeSampleStretchRate({
                          sampleDuration: getPlayerDuration(sample.id), period,
                          smoothedPeriod: _smoothedPeriods.get(b.id),
                          dt: params.dt, frameSeconds: frameTimeRef.current / 1000,
                          stretchRatio: lstr, stretchMode: stretchM,
                          orbitSource: (bodyParams.sampleOrbitSource as string | undefined) ?? 'current',
                        }) ?? 1
                        triggerBodySound(sample, {
                          playbackRate: tRate, volume: finalVol, adsr,
                          overlap: tPlayMode === 'layer', pan: spatial.pan,
                          detuneCents: detuneForRate(tRate, stretchM === 'time' || Boolean(bodyParams.samplePitchCorrection)),
                        })
                        setBodyOutputLevel(b.id, 'sampler', finalVol, 900)
                        markTriggeredOnCanvas(b.id)
                      }
                    }
                  }
                }
              }
            }  // end for (ti)
          }    // end if (!paused && sbi && !muted)

          // ── Sample playback: orbit-stretch and time-stretch modes ──────────────
          {
            // Resolve effective stretch mode: new sampleStretchMode takes priority,
            // falls back to legacy orbitStretchMode boolean.
            const stretchMode = (bodyParams.sampleStretchMode as string | undefined)
              ?? ((bodyParams.orbitStretchMode as boolean | undefined) ? 'rate' : 'off')
            const isActive = stretchMode !== 'off' && !params.paused && isFinite(period) && period > 0

            const sbi = sbMap.get(b.id)

            if (isActive) {
              if (sbi?.muted) {
                const sample = resolveBodySamplerSample(b.id, sbi.sampleId, smpArr)
                if (sample) { stopStandpointSound(sample.id); setPlayerDetune(sample.id, 0) }
                clearBodyOutputLevel(b.id, 'sampler')
              } else {
                const sample = resolveBodySamplerSample(b.id, sbi?.sampleId, smpArr)
                if (sample?.objectUrl) {
                  const dur = getPlayerDuration(sample.id)
                  if (dur > 0) {
                    const numer = sbi?.orbitLoopNumer ?? 1
                    const denom = sbi?.orbitLoopDenom ?? 1
                    const stretchRatio = denom > 0 ? numer / denom : 1

                    const orbitSrc = (bodyParams.sampleOrbitSource as string | undefined) ?? 'current'
                    const rate = computeSampleStretchRate({
                      sampleDuration: dur,
                      period,
                      smoothedPeriod: _smoothedPeriods.get(b.id),
                      dt: params.dt,
                      frameSeconds: frameTimeRef.current / 1000,
                      stretchRatio,
                      stretchMode,
                      orbitSource: orbitSrc,
                    }) ?? 1

                    const spatial = computeBodyRackOutputSpatial(b.id, bodies, params, bodyParams)
                    const bodyVol = sbi?.volume ?? 1
                    const vol     = 0.8 * spatial.volume * bodyVol
                    setBodyOutputLevel(b.id, 'sampler', vol, 500)

                    const loopMode = (bodyParams.sampleLoopMode as string | undefined) ?? 'loop'

                    if (loopMode === 'loop') {
                      // Loop: rate-stretch → instantaneous speed varies rate
                      //       time-stretch → smoothed period gives constant rate
                      const adsr = params.adsrMode === 'off'
                        ? ADSR_OFF
                        : params.adsrMode === 'orbit'
                          ? computeOrbitAdsr(b, bodies, params.G)
                          : undefined
                      startStandpointSound(sample, vol, rate, adsr, spatial.pan)
                    } else {
                      // Oneshot: just update playback rate (triggered by orbit-complete/rendezvous)
                      setPlayerRate(sample.id, rate)
                      setPlayerPan(sample.id, spatial.pan)
                    }

                    // Time stretch means "change duration without pitch shift", so it always
                    // uses correction. Rate stretch can stay tape-like unless enabled.
                    const pitchCorr = stretchMode === 'time' || Boolean(bodyParams.samplePitchCorrection)
                    setPlayerDetune(sample.id, detuneForRate(rate, pitchCorr))
                  }
                }
              }
            } else {
              // Stretch mode turned off — stop any looping player and reset detune
              const sample = resolveBodySamplerSample(b.id, sbi?.sampleId, smpArr)
              if (sample && !sbi?.muted) setPlayerDetune(sample.id, 0)
              clearBodyOutputLevel(b.id, 'sampler')
            }
          }
        }
      }

      // ── Effector proximity routing ────────────────────────────────────────
      // Every frame: for each effector body, route nearby planets' samples
      // into its reverb bus proportional to closeness (wet = maxWet × (1 - d/maxDist))
      {
        const smpArr  = projectSamplesRef.current
        // A body is an effector if its per-body rack overrides effectorType to 'reverb',
        // OR if its direct body property effectorType is set.
        const effectors = storeBodiesRef.current.filter(b => {
          const eff = bpCache.get(b.id) ?? {}
          const effType = (eff.effectorType ?? b.effectorType ?? 'none') as string
          return effType !== 'none'
        })
        if (effectors.length > 0) {
          for (const eff of effectors) {
            const effLive = bodies.find(b => b.id === eff.id)
            if (!effLive) continue
            // Merge rack-level overrides on top of body properties
            const effOverride = bpCache.get(eff.id) ?? {}
            const effDist    = (effOverride.effectorDistance    ?? eff.effectorDistance    ?? 200)   as number
            const effMaxWet  = (effOverride.effectorMaxWet      ?? eff.effectorMaxWet      ?? 0.7)   as number
            const effType    = (effOverride.effectorType        ?? eff.effectorType        ?? 'reverb') as string
            // Orbit-synced delay time: T_real (seconds) × division ratio
            const rawDelayDivision = Number(effOverride.effectorDelayDivision ?? eff.effectorDelayDivision ?? 0.25)
            const delayDivision = Number.isFinite(rawDelayDivision)
              ? Math.max(0.03125, Math.min(2, rawDelayDivision))
              : 0.25
            const effSmoothedPeriod = _smoothedPeriods.get(eff.id) ?? (planetBodyStatsCache.get(eff.id)?.period ?? 0)
            const effT_real = effSmoothedPeriod > 0 && isFinite(effSmoothedPeriod)
              ? effSmoothedPeriod / (params.dt * STEPS_PER_FRAME) * (frameTimeRef.current / 1000)
              : 0.25  // fallback to 250ms if no orbit data
            const delayTime = Math.max(0.01, Math.min(7.5, effT_real * delayDivision))

            ensureEffectorBus(eff.id, {
              type:               effType,
              reverbMode:         (effOverride.reverbMode              ?? eff.reverbMode              ?? 'convolution') as string,
              decay:              (effOverride.effectorDecay           ?? eff.effectorDecay           ?? 2.5)  as number,
              delayTime,
              feedback:           Math.max(0, Math.min(0.9, Number(effOverride.effectorFeedback ?? eff.effectorFeedback ?? 0.4))),
              distortion:         (effOverride.effectorDistortion      ?? eff.effectorDistortion      ?? 0.4)  as number,
              chorusFreq:         (effOverride.effectorChorusFreq      ?? eff.effectorChorusFreq      ?? 1.5)  as number,
              chorusDepth:        (effOverride.effectorChorusDepth     ?? eff.effectorChorusDepth     ?? 0.5)  as number,
              phaserRate:         (effOverride.effectorPhaserRate      ?? eff.effectorPhaserRate      ?? 0.5)  as number,
              phaserOctaves:      (effOverride.effectorPhaserOctaves   ?? eff.effectorPhaserOctaves   ?? 3)    as number,
              autoFilterFreq:     (effOverride.effectorAutoFilterFreq  ?? eff.effectorAutoFilterFreq  ?? 1.0)  as number,
              autoFilterDepth:    (effOverride.effectorAutoFilterDepth ?? eff.effectorAutoFilterDepth ?? 1.0)  as number,
              autoFilterBaseFreq: (effOverride.effectorAutoFilterBaseFreq ?? eff.effectorAutoFilterBaseFreq ?? 200) as number,
              bitDepth:           (effOverride.effectorBitDepth        ?? eff.effectorBitDepth        ?? 8)    as number,
              freezeDecay:        (effOverride.effectorFreezeDecay     ?? eff.effectorFreezeDecay     ?? 30)   as number,
            })
            // Route body's own instruments through its own effector (Input 1).
            // For microphone: use micSelfGain; for other effectors: always 1.0.
            const selfSendGain = effType === 'microphone'
              ? Math.max(0, Number(effOverride.micSelfGain ?? eff.micSelfGain ?? 1.0))
              : 1.0
            setBodySelfEffectorSend(eff.id, selfSendGain)

            // ── outputGain = effector body's own volume/mute ──────────────────
            // The effected signal "comes from" the effector body:
            // muting the effector silences all wet output; its volume scales it.
            // This is the final body-track output, so standpoint attenuation also
            // applies here after the rack/effect chain.
            const effSpatial = computeBodyRackOutputSpatial(eff.id, bodies, params, effOverride)
            const effOutputGain = eff.muted ? 0 : Math.max(0, Math.min(1, (eff.volume ?? 1) * effSpatial.volume))
            setEffectorOutputGain(eff.id, effOutputGain)

            // ── Route nearby source bodies into the effect input (Input 2) ────
            // Two parallel send paths per body:
            //   1. Rack post-fader send  — captures all instrument layers (drone/FM/granular/etc.)
            //   2. Sample-player send    — captures the basic sampler (bypasses rack bus)
            //
            // For microphone: sendMaxGain = micPickupGain
            // For others:     sendMaxGain = effMaxWet
            // sendLevel = sendMaxGain × (1 − dist/effDist)  [0 at max distance]
            const sendMaxGain = effType === 'microphone'
              ? Math.max(0, Number(effOverride.micPickupGain ?? eff.micPickupGain ?? 1.0))
              : effMaxWet
            let maxWetInput = 0
            for (const b of bodies) {
              if (b.id === eff.id) continue
              const dx = b.x - effLive.x, dy = b.y - effLive.y
              const dist = Math.sqrt(dx * dx + dy * dy)
              const sbBody = sbMap.get(b.id)

              if (dist <= effDist) {
                const sendLevel = sendMaxGain * Math.max(0, 1 - dist / effDist)
                maxWetInput = Math.max(maxWetInput, sendLevel)

                // Rack output send (instrument layers)
                setBodyProximityRackSend(b.id, eff.id, sendLevel)

                // Sample-player send (basic sampler — goes direct-to-destination, not via rack bus)
                const sample = resolveBodySamplerSample(b.id, sbBody?.sampleId, smpArr)
                if (sample?.objectUrl) {
                  setPlayerEffectorSend(sample.id, eff.id, sendLevel)
                }
              } else {
                // Out of range — fade both sends to zero
                clearBodyProximityRackSend(b.id, eff.id)
                const sample = resolveBodySamplerSample(b.id, sbBody?.sampleId, smpArr)
                if (sample?.objectUrl) {
                  clearPlayerEffectorSend(sample.id, eff.id)
                }
              }
            }
            setBodyOutputLevel(eff.id, 'effect', maxWetInput * effOutputGain, 500)
          }
        }
      }

      // ── Camera follow (always active) ──────────────────────────────────────
      const followId = cameraFollowBodyIdRef.current
      if (followId) {
        const fb = liveBodiesRef.current.find(b => b.id === followId)
        if (fb) {
          viewOffsetRef.current = { x: fb.x, y: fb.y }
          setViewOffset({ x: fb.x, y: fb.y })
        }
      }

      if (nowMs - lastRenderMsRef.current >= 33) {
        if (simParamsRef.current.showBodyOscilloscope) {
          const nextOsc = bodyOscilloscopeRef.current
          const liveIds = new Set(liveBodiesRef.current.map(b => b.id))
          for (const id of Array.from(nextOsc.keys())) {
            if (!liveIds.has(id)) nextOsc.delete(id)
          }
          for (const b of liveBodiesRef.current) {
            const data = getBusOscilloscopeData(b.id)
            if (data) nextOsc.set(b.id, new Float32Array(data))
            else nextOsc.delete(b.id)
          }
        }
        lastRenderMsRef.current = nowMs
        setTick(t => t + 1)
      }
      rafId = requestAnimationFrame(frame)
    }

    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Mouse helpers ─────────────────────────────────────────────────────────
  function getSVGPos(e: React.MouseEvent) {
    const rect = svgRef.current!.getBoundingClientRect()
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top }
  }
  function screenToWorld(sx: number, sy: number) {
    const cx = sizeRef.current.w / 2, cy = sizeRef.current.h / 2
    return {
      wx: (sx - cx) / zoomRef.current + viewOffsetRef.current.x,
      wy: (sy - cy) / zoomRef.current + viewOffsetRef.current.y,
    }
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button === 1 || e.button === 2) {
      const { sx, sy } = getSVGPos(e)
      panStartRef.current = { sx, sy, ox: viewOffsetRef.current.x, oy: viewOffsetRef.current.y }
      setIsPanning(true)
      return
    }
    if (e.button !== 0) return
    const { sx, sy } = getSVGPos(e)
    const { wx, wy } = screenToWorld(sx, sy)

    if (tool === 'add-sun' || tool === 'add-planet') {
      const dp: DragPlaceState = { bodyX: wx, bodyY: wy, dragX: wx, dragY: wy, tool }
      dragPlaceRef.current = dp
      setDragPlace(dp)
      return
    }
    if (tool === 'probe') return  // probe mode: no body interaction on click

    const bodies = liveBodiesRef.current
    let hit: LiveBody | null = null
    for (const b of bodies) {
      const sb = storeBodiesRef.current.find(s => s.id === b.id)
      const wr = (projectedBodyScreenR(
        b.mass,
        sb?.type,
        sb?.z ?? b.z ?? 0,
        simParamsRef.current.bodyRadiusFromMass,
        simParamsRef.current.bodyRadiusMassScalePlanet,
        simParamsRef.current.bodyRadiusMassScaleSun,
      ) + 6) / zoomRef.current
      const dx = b.x - wx, dy = b.y - wy
      if (dx * dx + dy * dy <= wr * wr) { hit = b; break }
    }
    if (hit) {
      setSelectedBodyId(hit.id)
      if (simParamsRef.current.paused && !hit.fixed) {
        setDraggingBodyId(hit.id)
        dragOffRef.current = { dx: hit.x - wx, dy: hit.y - wy }
      } else if (tool === 'select') {
        pendingBodySelectRef.current = { sx, sy }
      }
    } else {
      // Start drag-rect multi-select (on empty canvas, select tool)
      setSelectedBodyId(null)
      dragSelStartRef.current = { sx, sy }
      setDragSel({ sx, sy, ex: sx, ey: sy })
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    // Always track world position (used for probe stats + visualization)
    const { sx, sy } = getSVGPos(e)
    const { wx, wy } = screenToWorld(sx, sy)
    mousePosWorldRef.current = { x: wx, y: wy }

    if (panStartRef.current) {
      setViewOffsetSync({
        x: panStartRef.current.ox + (panStartRef.current.sx - sx) / zoomRef.current,
        y: panStartRef.current.oy + (panStartRef.current.sy - sy) / zoomRef.current,
      })
      return
    }
    if (dragPlaceRef.current) {
      const updated: DragPlaceState = { ...dragPlaceRef.current, dragX: wx, dragY: wy }
      dragPlaceRef.current = updated
      setDragPlace({ ...updated })
      return
    }
    if (dragSelStartRef.current) {
      setDragSel({ ...dragSelStartRef.current, ex: sx, ey: sy })
      return
    }
    if (pendingBodySelectRef.current && tool === 'select') {
      const start = pendingBodySelectRef.current
      if (Math.hypot(sx - start.sx, sy - start.sy) > 5) {
        dragSelStartRef.current = start
        pendingBodySelectRef.current = null
        setDragSel({ ...start, ex: sx, ey: sy })
        return
      }
    }
    if (draggingBodyId) {
      const body = liveBodiesRef.current.find(b => b.id === draggingBodyId)
      if (body) { body.x = wx + dragOffRef.current.dx; body.y = wy + dragOffRef.current.dy; body.vx = 0; body.vy = 0 }
    }
  }

  function handleMouseLeave() {
    // Keep last known position — probe cursor hides only when null
    // (we don't reset mousePosWorldRef to avoid cursor disappearing on slight exit)
  }

  // ── commitDragPlace: shared by mouse and touch handlers ──────────────────────

  /** For add-sun drag: map screen-pixel drag distance to mass (0→minMass, 300px→maxMass). */
  function sunMassFromDrag(dp: DragPlaceState): number {
    const maxMass  = usePlanetStore.getState().nextSunDefaults.mass
    const minMass  = Math.max(10, Math.round(maxMass * 0.05))
    const screenDist = Math.hypot(dp.dragX - dp.bodyX, dp.dragY - dp.bodyY) * zoomRef.current
    const t = Math.min(1, screenDist / 300)
    return Math.max(minMass, Math.round(minMass + t * (maxMass - minMass)))
  }

  function planetMassFromDrag(dp: DragPlaceState): number {
    const maxMass = Math.max(0.001, usePlanetStore.getState().nextPlanetDefaults.mass)
    const minMass = Math.max(0.001, maxMass * 0.05)
    const screenDist = Math.hypot(dp.dragX - dp.bodyX, dp.dragY - dp.bodyY) * zoomRef.current
    const t = Math.min(1, screenDist / 220)
    return Number((minMass + t * (maxMass - minMass)).toFixed(maxMass < 10 ? 2 : 1))
  }

  function commitDragPlace(dp: DragPlaceState) {
    const isSun = dp.tool === 'add-sun'
    const storeState  = usePlanetStore.getState()
    const starCount   = storeState.bodies.filter(b => b.type === 'sun').length
    const planetCount = storeState.bodies.filter(b => b.type === 'planet').length
    const defs = dp.tool === 'add-sun'
      ? storeState.nextSunDefaults
      : storeState.nextPlanetDefaults
    const launchVelocity = launchVelocityFromDrag(dp)
    const vx = isSun ? 0 : launchVelocity.vx
    const vy = isSun ? 0 : launchVelocity.vy
    const resolvedMass = isSun
      ? sunMassFromDrag(dp)
      : planetMassFromDrag(dp)
    const resolvedColor = defs.randomColor
      ? (dp.tool === 'add-sun'
          ? `hsl(${35 + Math.floor(Math.random() * 25)},90%,55%)`
          : `hsl(${Math.floor(Math.random() * 360)},70%,62%)`)
      : defs.color
    // Generate star identity (properName / designation / catalogId)
    const { ids, properNames, designations } = collectExistingIdentities(storeState.bodies)
    const starId = generateStarIdentity(ids, properNames, designations)

    const newBody: PlanetBody = {
      id: `body_${Date.now().toString(36)}`,
      name:        starId.properName,
      designation: starId.designation,
      catalogId:   starId.id,
      type: dp.tool === 'add-sun' ? 'sun' : 'planet',
      mass: resolvedMass,
      x: dp.bodyX, y: dp.bodyY, z: 0, vx, vy,
      fixed: defs.fixed,
      standpointFacingAngle: isSun ? 270 : undefined,
      color: resolvedColor,
      sampleId: null,
      orbitLoopNumer: 1, orbitLoopDenom: 1,
      effectorType: 'none',
      effectorDistance: 200, effectorMaxWet: 0.7, effectorDecay: 2.5,
      effectorDelayDivision: 0.25, effectorFeedback: 0.4, effectorDistortion: 0.4,
      effectorChorusFreq: 1.5, effectorChorusDepth: 0.5,
      ...BODY_DRONE_DEFAULTS,
      ...BODY_MIDI_DEFAULTS,
      muted: false,
      volume: 1,
    }
    storeState.addBody(newBody)
    storeBodiesRef.current = [...storeBodiesRef.current, newBody]
    storeBodiesMapRef.current.set(newBody.id, newBody)
    liveBodiesRef.current.push({
      id: newBody.id, mass: newBody.mass, x: dp.bodyX, y: dp.bodyY, z: newBody.z ?? 0,
      vx, vy, ax: 0, ay: 0, fixed: newBody.fixed,
    })
    const launchTrail = makeTrail(simParamsRef.current.trailLength)
    trailsRef.current.set(newBody.id, launchTrail)
    _trailsSnap.set(newBody.id, launchTrail)
    computeAccels(liveBodiesRef.current, simParamsRef.current.G, simParamsRef.current.epsilon)
    setSelectedBodyId(newBody.id)

    // Sun gets all-empty rack (override global rack defaults)
    if (isSun) {
      const cs = useControlSetStore.getState()
      cs.clearBodyRack(newBody.id)
      cs.addBodyTrigger(newBody.id, 'trigger-empty')
      cs.setBodySlot(newBody.id, 'instrument', 'instrument-empty')
      cs.addBodyEffect(newBody.id, 'effect-empty')
    } else if (mobileMode) {
      const cs = useControlSetStore.getState()
      cs.clearBodyRack(newBody.id)
      cs.addBodyTrigger(newBody.id, 'trigger-arpeggio')
      cs.setBodySlot(newBody.id, 'instrument', 'instrument-wave-lab')

      const mobilePlanets = storeBodiesRef.current.filter(b => b.type === 'planet')
      const overflow = mobilePlanets.length - MOBILE_MAX_PLANETS
      if (overflow > 0) {
        const removeIds = mobilePlanets.slice(0, overflow).map(b => b.id)
        for (const id of removeIds) {
          usePlanetStore.getState().removeBody(id)
          useControlSetStore.getState().clearBodyRack(id)
          destroyEffectorBus(id)
          liveBodiesRef.current = liveBodiesRef.current.filter(b => b.id !== id)
          storeBodiesRef.current = storeBodiesRef.current.filter(b => b.id !== id)
          storeBodiesMapRef.current.delete(id)
          trailsRef.current.delete(id)
          _trailsSnap.delete(id)
          triggerStarMarkersRef.current = triggerStarMarkersRef.current.filter(m => m.bodyId !== id)
          prevAngleRef.current.delete(id)
          lfoAccumRef.current.delete(id)
          lastTriggerSimTimeRef.current.delete(id)
          lastTriggerWallMsRef.current.delete(id)
          tperiodIntervalMsRef.current.delete(id)
          lastOrbitCrossWallMsRef.current.delete(id)
          measuredRealTMsRef.current.delete(id)
          planetBodyStatsCache.delete(id)
          toggleStateRef.current.delete(id)
          arpStepRef.current.delete(id)
          arpPrevNoteRef.current.delete(id)
          clearBodyOutputLevel(id, 'sampler')
        }
        if (liveBodiesRef.current.length > 0)
          computeAccels(liveBodiesRef.current, simParamsRef.current.G, simParamsRef.current.epsilon)
      }
    }

    const _launchId = newBody.id
    window.setTimeout(() => {
      const sbi = storeBodiesRef.current.find(b => b.id === _launchId)
      if (sbi?.muted) return
      sendMidiNote(sbi?.midiChannel ?? 1, sbi?.midiNote ?? 60, sbi?.midiVelocity ?? 100, 200)
      if (fireBodyInstrumentTrigger(_launchId)) {
        markTriggeredOnCanvas(_launchId)
        return
      }
      const sample = resolveBodySamplerSample(_launchId, sbi?.sampleId ?? null, projectSamplesRef.current)
      if (sample) {
        const sp      = simParamsRef.current
        const bodyOv  = useControlSetStore.getState().getBodyEffectiveParams(_launchId)
        const spatial = computeBodyRackOutputSpatial(_launchId, liveBodiesRef.current, sp, bodyOv)
        const finalVol = 0.85 * Math.max(0, Math.min(1, (sbi?.volume ?? 1) * spatial.volume))
        triggerBodySound(sample, { playbackRate: 1, volume: finalVol, overlap: false, pan: spatial.pan, detuneCents: 0 })
        setBodyOutputLevel(_launchId, 'sampler', finalVol, 900)
      }
      markTriggeredOnCanvas(_launchId)
    }, mobileMode ? 300 : 150)
  }

  function randBetween(min: number, max: number): number {
    const lo = Number.isFinite(min) ? min : 0
    const hi = Number.isFinite(max) ? max : lo
    const a = Math.min(lo, hi)
    const b = Math.max(lo, hi)
    return a + Math.random() * (b - a)
  }

  function spawnAutoPlanet() {
    const storeState = usePlanetStore.getState()
    const sp = storeState.simParams
    const planetCount = storeBodiesRef.current.filter(b => b.type === 'planet').length
    const maxPlanets = Math.max(0, Math.floor(sp.autoSpawnMaxPlanets))
    if (maxPlanets > 0 && planetCount >= maxPlanets) return false

    const standpoint = sp.standpointBodyId
      ? (storeBodiesMapRef.current.get(sp.standpointBodyId) ?? null)
      : null
    const centerX = standpoint?.x ?? 0
    const centerY = standpoint?.y ?? 0
    const standpointLimit = standpoint && sp.standpointMode
      ? Math.max(0, sp.standpointMaxDist)
      : Infinity
    const radiusMin = Math.max(0, Math.min(sp.autoSpawnRadiusMin, standpointLimit))
    const radiusMax = Math.max(radiusMin, Math.min(sp.autoSpawnRadiusMax, standpointLimit))
    const angle = Math.random() * Math.PI * 2
    const radius = Math.sqrt(randBetween(radiusMin * radiusMin, radiusMax * radiusMax))
    const x = centerX + Math.cos(angle) * radius
    const y = centerY + Math.sin(angle) * radius

    const velocityAngle = Math.random() * Math.PI * 2
    const speed = Math.max(0, randBetween(sp.autoSpawnSpeedMin, sp.autoSpawnSpeedMax))
    const vx = Math.cos(velocityAngle) * speed
    const vy = Math.sin(velocityAngle) * speed
    const mass = Math.max(0.001, randBetween(sp.autoSpawnMassMin, sp.autoSpawnMassMax))
    const defs = storeState.nextPlanetDefaults
    const color = defs.randomColor
      ? `hsl(${Math.floor(Math.random() * 360)},70%,62%)`
      : defs.color
    const { ids, properNames, designations } = collectExistingIdentities(storeState.bodies)
    const starId = generateStarIdentity(ids, properNames, designations)
    const newBody: PlanetBody = {
      id: `body_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
      name:        starId.properName,
      designation: starId.designation,
      catalogId:   starId.id,
      type: 'planet',
      mass,
      x, y, vx, vy,
      fixed: false,
      color,
      sampleId: null,
      orbitLoopNumer: 1, orbitLoopDenom: 1,
      effectorType: 'none',
      effectorDistance: 200, effectorMaxWet: 0.7, effectorDecay: 2.5,
      effectorDelayDivision: 0.25, effectorFeedback: 0.4, effectorDistortion: 0.4,
      effectorChorusFreq: 1.5, effectorChorusDepth: 0.5,
      ...BODY_DRONE_DEFAULTS,
      ...BODY_MIDI_DEFAULTS,
      muted: false,
      volume: 1,
    }

    storeState.addBody(newBody)
    storeBodiesRef.current = [...storeBodiesRef.current, newBody]
    storeBodiesMapRef.current.set(newBody.id, newBody)
    liveBodiesRef.current.push({
      id: newBody.id, mass: newBody.mass, x, y, z: newBody.z ?? 0, vx, vy,
      ax: 0, ay: 0, fixed: newBody.fixed,
    })
    const trail = makeTrail(simParamsRef.current.trailLength)
    trailsRef.current.set(newBody.id, trail)
    _trailsSnap.set(newBody.id, trail)
    computeAccels(liveBodiesRef.current, simParamsRef.current.G, simParamsRef.current.epsilon)
    return true
  }

  useEffect(() => {
    if (mobileMode) return
    const timer = window.setInterval(() => {
      const sp = usePlanetStore.getState().simParams
      if (!sp.autoSpawnPlanets) return
      const now = performance.now()
      const planetCount = storeBodiesRef.current.filter(b => b.type === 'planet').length
      const minPlanets = Math.max(0, Math.floor(sp.autoSpawnMinPlanets))
      const maxPlanets = Math.max(minPlanets, Math.floor(sp.autoSpawnMaxPlanets))
      const belowMin = planetCount < minPlanets
      const intervalDue = now - lastAutoSpawnMsRef.current >= Math.max(0.5, sp.autoSpawnIntervalSec) * 1000
      if ((belowMin || (intervalDue && planetCount < maxPlanets)) && spawnAutoPlanet()) {
        lastAutoSpawnMsRef.current = now
      }
    }, 500)
    return () => window.clearInterval(timer)
  }, [mobileMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mobile touch handlers (non-passive, attached in useEffect) ────────────────

  useEffect(() => {
    if (!mobileMode) return
    const svg = svgRef.current
    if (!svg) return

    let launchId: number | null = null
    let pinchIds: [number, number] | null = null
    let pinchDist = 0
    let pinchMid: { sx: number; sy: number } | null = null

    function getTouchById(list: TouchList, id: number): Touch | null {
      for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i]
      return null
    }
    function svgPos(t: Touch) {
      const r = svg.getBoundingClientRect()
      return { sx: t.clientX - r.left, sy: t.clientY - r.top }
    }
    function tw(sx: number, sy: number) {
      const cx = sizeRef.current.w / 2, cy = sizeRef.current.h / 2
      return {
        wx: (sx - cx) / zoomRef.current + viewOffsetRef.current.x,
        wy: (sy - cy) / zoomRef.current + viewOffsetRef.current.y,
      }
    }

    function onStart(e: TouchEvent) {
      e.preventDefault()
      void unlockMobileAudio()
      if (e.touches.length === 1 && launchId === null && pinchIds === null) {
        const t = e.touches[0]
        launchId = t.identifier
        const { sx, sy } = svgPos(t)
        const { wx, wy } = tw(sx, sy)
        const currentTool = toolRef.current === 'add-sun' ? 'add-sun' : 'add-planet'
        const dp: DragPlaceState = { bodyX: wx, bodyY: wy, dragX: wx, dragY: wy, tool: currentTool }
        dragPlaceRef.current = dp
        setDragPlace({ ...dp })
      } else if (e.touches.length >= 2) {
        // Cancel any ongoing launch and switch to two-finger pan/zoom.
        launchId = null
        dragPlaceRef.current = null
        setDragPlace(null)
        const t0 = e.touches[0], t1 = e.touches[1]
        pinchIds = [t0.identifier, t1.identifier]
        const r = svg.getBoundingClientRect()
        pinchDist = Math.max(1, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY))
        pinchMid = {
          sx: (t0.clientX + t1.clientX) / 2 - r.left,
          sy: (t0.clientY + t1.clientY) / 2 - r.top,
        }
      }
    }

    function onMove(e: TouchEvent) {
      e.preventDefault()
      if (pinchIds !== null && e.touches.length >= 2) {
        // Two-finger gesture: slide pans, pinch zooms.
        const t0 = getTouchById(e.touches, pinchIds[0])
        const t1 = getTouchById(e.touches, pinchIds[1])
        if (!t0 || !t1 || pinchDist <= 0 || !pinchMid) return
        const r = svg.getBoundingClientRect()
        const midSx = (t0.clientX + t1.clientX) / 2 - r.left
        const midSy = (t0.clientY + t1.clientY) / 2 - r.top
        const { wx, wy } = tw(pinchMid.sx, pinchMid.sy)
        const nextDist = Math.max(1, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY))
        const nextZoom = Math.max(0.02, Math.min(50, zoomRef.current * (nextDist / pinchDist)))
        const cx = sizeRef.current.w / 2, cy = sizeRef.current.h / 2
        setZoomSync(nextZoom)
        setViewOffsetSync({
          x: wx - (midSx - cx) / nextZoom,
          y: wy - (midSy - cy) / nextZoom,
        })
        pinchDist = nextDist
        pinchMid = { sx: midSx, sy: midSy }
      } else if (launchId !== null && dragPlaceRef.current) {
        // Single finger: update velocity vector
        const t = getTouchById(e.touches, launchId)
        if (!t) return
        const { sx, sy } = svgPos(t)
        const { wx, wy } = tw(sx, sy)
        const updated = { ...dragPlaceRef.current, dragX: wx, dragY: wy }
        dragPlaceRef.current = updated
        setDragPlace({ ...updated })
      }
    }

    function onEnd(e: TouchEvent) {
      e.preventDefault()
      // Check if the launch finger was lifted
      if (launchId !== null) {
        let stillDown = false
        for (let i = 0; i < e.touches.length; i++) {
          if (e.touches[i].identifier === launchId) { stillDown = true; break }
        }
        if (!stillDown && dragPlaceRef.current) {
          const dp = dragPlaceRef.current
          dragPlaceRef.current = null
          setDragPlace(null)
          commitDragPlace(dp)
          launchId = null
        }
      }
      if (e.touches.length < 2) { pinchIds = null; pinchDist = 0; pinchMid = null }
    }

    svg.addEventListener('touchstart',  onStart, { passive: false })
    svg.addEventListener('touchmove',   onMove,  { passive: false })
    svg.addEventListener('touchend',    onEnd,   { passive: false })
    svg.addEventListener('touchcancel', onEnd,   { passive: false })
    return () => {
      svg.removeEventListener('touchstart',  onStart)
      svg.removeEventListener('touchmove',   onMove)
      svg.removeEventListener('touchend',    onEnd)
      svg.removeEventListener('touchcancel', onEnd)
    }
  }, [mobileMode])  // eslint-disable-line react-hooks/exhaustive-deps

  function handleMouseUp(e: React.MouseEvent) {
    if (e.button === 1 || e.button === 2) { panStartRef.current = null; setIsPanning(false); return }
    pendingBodySelectRef.current = null

    // Finish drag-rect multi-select
    if (dragSelStartRef.current && e.button === 0) {
      const ds = dragSelStartRef.current
      dragSelStartRef.current = null
      setDragSel(null)
      const { sx, sy } = getSVGPos(e)
      if (Math.abs(sx - ds.sx) > 5 || Math.abs(sy - ds.sy) > 5) {
        // Convert screen rect to world coords
        const minSx = Math.min(ds.sx, sx), maxSx = Math.max(ds.sx, sx)
        const minSy = Math.min(ds.sy, sy), maxSy = Math.max(ds.sy, sy)
        const { wx: wx1, wy: wy1 } = screenToWorld(minSx, minSy)
        const { wx: wx2, wy: wy2 } = screenToWorld(maxSx, maxSy)
        const inRect = liveBodiesRef.current.filter(b => {
          const sb = storeBodiesRef.current.find(s => s.id === b.id)
          const radius = (projectedBodyScreenR(
            b.mass,
            sb?.type,
            sb?.z ?? b.z ?? 0,
            simParamsRef.current.bodyRadiusFromMass,
            simParamsRef.current.bodyRadiusMassScalePlanet,
            simParamsRef.current.bodyRadiusMassScaleSun,
          ) + 6) / zoomRef.current
          return b.x + radius >= wx1 && b.x - radius <= wx2 && b.y + radius >= wy1 && b.y - radius <= wy2
        })
        const ids = inRect.map(b => b.id)
        usePlanetStore.getState().setSelectedBodyIds(ids)
      }
      return
    }

    if (dragPlaceRef.current && e.button === 0) {
      const dp = dragPlaceRef.current
      dragPlaceRef.current = null
      setDragPlace(null)
      // Single click (no meaningful drag) → ignore, don't place
      const dragDist = Math.hypot(dp.dragX - dp.bodyX, dp.dragY - dp.bodyY)
      if (dragDist < 8 / zoomRef.current) return
      commitDragPlace(dp)
      return
    }

    setDraggingBodyId(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const bodies   = liveBodiesRef.current
  const { w, h } = size

  // Predicted orbit preview (computed every frame while dragging)
  const predictOrbitPoints: string | null = (() => {
    if (!dragPlace || !storeParams.showPredictedOrbit) return null
    if (dragPlace.tool === 'add-sun') return null  // sun is fixed — no orbit preview
    const { vx, vy } = launchVelocityFromDrag(dragPlace)
    const previewBody: LiveBody = {
      id: '__preview__', mass: planetMassFromDrag(dragPlace),
      x: dragPlace.bodyX, y: dragPlace.bodyY,
      z: 0, vx, vy, ax: 0, ay: 0, fixed: false,
    }
    return computePredictedOrbit(liveBodiesRef.current, simParamsRef.current, previewBody, PREDICT_STEPS)
  })()
  const cx = w / 2, cy = h / 2
  const camTx = `translate(${cx},${cy}) scale(${zoom}) translate(${-viewOffset.x},${-viewOffset.y})`

  const simple       = storeParams.simpleTheme || monochromeMode
  const paperTone    = Math.max(0, Math.min(1, paperCanvasTone))
  const monoPaper    = monochromeInverted ? paperCanvasInk : paperCanvasBackground
  const monoInk      = monochromeInverted ? paperCanvasBackground : paperCanvasInk
  const bgColor      = monochromeMode ? monoPaper : simple ? '#fafaf9' : '#0a0a0f'
  const labelColor   = monochromeMode ? monoInk : simple ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)'
  const labelOpacity = monochromeMode ? Math.max(0, Math.min(1, paperCanvasLabelOpacity)) : 1
  const hudColor     = monochromeMode ? monoInk : simple ? 'rgba(0,0,0,0.38)' : 'rgba(255,255,255,0.38)'
  const hudOpacity   = monochromeMode ? Math.max(0.12, labelOpacity * 0.72) : 1
  const selStroke    = monochromeMode ? monoInk : simple ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.45)'
  const trailOpacity = Math.max(0, Math.min(1, Number.isFinite(orbitTrailOpacity) ? orbitTrailOpacity : paperCanvasTrailOpacity))
  const paperMainOpacity = 0.28 + paperTone * 0.68
  const paperLineOpacity = 0.14 + paperTone * 0.56
  const paperSubtleOpacity = 0.04 + paperTone * 0.18
  const drawingStrokeWidth = Math.max(0, Number.isFinite(canvasStrokeWidth) ? canvasStrokeWidth : 0)
  const worldStroke = (scale = 1) => (drawingStrokeWidth * scale) / zoom
  const trailStrokeWidth = Math.max(0, Number.isFinite(orbitTrailStrokeWidth) ? orbitTrailStrokeWidth : 1.2) / zoom
  const trailDash = Math.max(0, Number.isFinite(orbitTrailDash) ? orbitTrailDash : 0)
  const bgImageOpacity = Math.max(0, Math.min(1, canvasBackgroundImageOpacity))
  const bgImagePreserveAspectRatio = canvasBackgroundImageFit === 'stretch'
    ? 'none'
    : `xMidYMid ${canvasBackgroundImageFit === 'contain' ? 'meet' : 'slice'}`
  const renderNowMs = performance.now()
  const triggerStars = storeParams.showTriggerStars
    ? triggerStarMarkersRef.current.filter(marker => renderNowMs - marker.bornMs < Math.max(80, storeParams.triggerStarLifetimeMs))
    : []
  if (storeParams.showTriggerStars && triggerStars.length !== triggerStarMarkersRef.current.length) {
    triggerStarMarkersRef.current = triggerStars
  }

  // Probe cursor params
  const probePos = tool === 'probe' ? mousePosWorldRef.current : null
  const probeWr  = probePos ? projectedBodyScreenR(
    storeParams.probeMass,
    'planet',
    0,
    storeParams.bodyRadiusFromMass,
    storeParams.bodyRadiusMassScalePlanet,
    storeParams.bodyRadiusMassScaleSun,
  ) / zoom : 0
  const probeCol = monochromeMode ? monoInk : '#a78bfa'

  // Drag-place overlay data
  const dpOverlay = dragPlace ? (() => {
    const isSunDrag = dragPlace.tool === 'add-sun'
    const previewMass = isSunDrag
      ? sunMassFromDrag(dragPlace)
      : planetMassFromDrag(dragPlace)
    const isPlanetLaunch = dragPlace.tool === 'add-planet'
    return {
      col:      monochromeMode ? monoInk : isSunDrag ? '#f59e0b' : '#60a5fa',
      wr:       projectedBodyScreenR(
        previewMass,
        isSunDrag ? 'sun' : 'planet',
        0,
        storeParams.bodyRadiusFromMass,
        storeParams.bodyRadiusMassScalePlanet,
        storeParams.bodyRadiusMassScaleSun,
      ) / zoom,
      arrowX:   isPlanetLaunch ? dragPlace.bodyX + (dragPlace.bodyX - dragPlace.dragX) : dragPlace.dragX,
      arrowY:   isPlanetLaunch ? dragPlace.bodyY + (dragPlace.bodyY - dragPlace.dragY) : dragPlace.dragY,
      hasDrag:  isPlanetLaunch && (dragPlace.dragX !== dragPlace.bodyX || dragPlace.dragY !== dragPlace.bodyY),
      isSun:    isSunDrag,
      sunMass:  previewMass,
      mass:     previewMass,
      isPlanetLaunch,
    }
  })() : null

  const cursorStyle = tool !== 'select'
    ? 'crosshair'
    : draggingBodyId ? 'grabbing'
    : isPanning ? 'grabbing'
    : dragSel ? 'crosshair'
    : 'default'

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden', background: bgColor, userSelect: 'none' }}
    >
      <svg
        ref={svgRef}
        width={w} height={h}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        onContextMenu={e => e.preventDefault()}
        style={{ display: 'block', cursor: cursorStyle }}
      >
        <defs>
          <marker id="velArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={simple ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.55)'} />
          </marker>
          <marker id="placeArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={dpOverlay?.col ?? '#888'} />
          </marker>
          {!simple && (
            <radialGradient id="bgGrad">
              <stop offset="0%" stopColor="#12121f" />
              <stop offset="100%" stopColor="#0a0a0f" />
            </radialGradient>
          )}
        </defs>

        <rect width={w} height={h} fill={monochromeMode ? monoPaper : simple ? '#fafaf9' : 'url(#bgGrad)'} />
        {canvasBackgroundImageUrl && (
          <image
            href={canvasBackgroundImageUrl}
            x={0}
            y={0}
            width={w}
            height={h}
            preserveAspectRatio={bgImagePreserveAspectRatio}
            opacity={bgImageOpacity}
            style={{
              pointerEvents: 'none',
              filter: monochromeMode && !canvasBackgroundImageColorInMonochrome ? 'grayscale(1)' : undefined,
            }}
          />
        )}

        {!simple && Array.from({ length: 80 }, (_, i) => {
          const seed = i * 137.508
          const x  = (Math.sin(seed) * 0.5 + 0.5) * w
          const y  = (Math.cos(seed * 1.618) * 0.5 + 0.5) * h
          const r  = (Math.sin(seed * 2.3) * 0.5 + 0.5) * 1 + 0.3
          const op = (Math.cos(seed * 0.7) * 0.5 + 0.5) * 0.4 + 0.1
          return <circle key={i} cx={x} cy={y} r={r} fill="white" opacity={op} />
        })}

        <g transform={camTx}>
          {/* Trails */}
          {storeParams.showTrails && bodies.map(b => {
            const ring = trailsRef.current.get(b.id)
            if (!ring || ring.count < 2) return null
            const pts = trailToPoints(ring)
            if (!pts) return null
            const sb = storeBodiesMapRef.current.get(b.id)
            const trailColor = monochromeMode && !paperCanvasKeepBodyColors ? monoInk : sb?.color ?? '#888'
            return (
              <polyline key={`trail-${b.id}`} points={pts} fill="none"
                stroke={trailColor}
                strokeWidth={trailStrokeWidth}
                strokeOpacity={trailOpacity}
                strokeDasharray={trailDash > 0 ? `${trailDash / zoom} ${trailDash / zoom}` : undefined} />
            )
          })}

          {triggerStars.length > 0 && (
            <g style={{ pointerEvents: 'none' }}>
              {triggerStars.map(marker => {
                const age = Math.max(0, renderNowMs - marker.bornMs)
                const lifetimeMs = Math.max(80, storeParams.triggerStarLifetimeMs)
                const progress = Math.min(1, age / lifetimeMs)
                const burst = 1 - Math.pow(1 - Math.min(1, progress * 1.45), 3)
                const fadeStart = Math.max(0, Math.min(0.95, storeParams.triggerStarFadeStart))
                const fadeSpan = Math.max(0.05, 1 - fadeStart)
                const fade = Math.max(0, 1 - Math.pow(Math.max(0, progress - fadeStart) / fadeSpan, 1.6))
                const base = Math.max(1, storeParams.triggerStarSize) / zoom
                const outer = base * (0.45 + burst * Math.max(0.2, storeParams.triggerStarSpread))
                const inner = base * Math.max(0, burst * 0.82 - 0.24)
                const strokeWidth = Math.max(0.1, storeParams.triggerStarLineWidth) / zoom
                const glowWidth = strokeWidth * Math.max(0, storeParams.triggerStarGlow)
                const arms = [
                  [marker.x - outer, marker.y, marker.x - inner, marker.y],
                  [marker.x + inner, marker.y, marker.x + outer, marker.y],
                  [marker.x, marker.y - outer, marker.x, marker.y - inner],
                  [marker.x, marker.y + inner, marker.x, marker.y + outer],
                ]
                return (
                  <g key={marker.id} opacity={fade}>
                    {arms.map(([x1, y1, x2, y2], i) => (
                      <line
                        key={`glow-${i}`}
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke={monochromeMode && !paperCanvasKeepBodyColors ? monoInk : marker.color}
                        strokeWidth={glowWidth}
                        strokeLinecap="round"
                        strokeOpacity={monochromeMode ? paperSubtleOpacity : simple ? 0.12 : 0.20}
                      />
                    ))}
                    {arms.map(([x1, y1, x2, y2], i) => (
                      <line
                        key={i}
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke={monochromeMode && !paperCanvasKeepBodyColors ? monoInk : marker.color}
                        strokeWidth={strokeWidth}
                        strokeLinecap="round"
                        strokeOpacity={monochromeMode ? paperLineOpacity : simple ? 0.74 : 0.88}
                      />
                    ))}
                    <circle
                      cx={marker.x}
                      cy={marker.y}
                      r={base * Math.max(0, 0.36 - progress * 0.7)}
                      fill={monochromeMode && !paperCanvasKeepBodyColors ? monoInk : marker.color}
                      opacity={monochromeMode ? paperMainOpacity : simple ? 0.45 : 0.65}
                    />
                  </g>
                )
              })}
            </g>
          )}

          {/* Velocity vectors */}
          {storeParams.showVelocityVectors && bodies.map(b => {
            const sb = storeBodiesMapRef.current.get(b.id)
            const velColor = monochromeMode && !paperCanvasKeepBodyColors ? monoInk : sb?.color ?? '#888'
            return (
              <line key={`vel-${b.id}`}
                x1={b.x} y1={b.y} x2={b.x + b.vx * 25} y2={b.y + b.vy * 25}
                stroke={velColor} strokeWidth={worldStroke()} strokeOpacity={monochromeMode ? paperLineOpacity : 0.7}
                markerEnd="url(#velArrow)" />
            )
          })}

          {/* Bodies */}
          {bodies.map(b => {
            const sb        = storeBodiesMapRef.current.get(b.id)
            const type      = sb?.type  ?? 'planet'
            const color     = sb?.color ?? '#888'
            const inkColor  = monochromeMode && !paperCanvasKeepBodyColors ? monoInk : color
            const samplerSample = resolveBodySamplerSample(b.id, sb?.sampleId, projectSamplesRef.current)
            const hasSample = Boolean(samplerSample)
            // Label: show sample name when enabled and sample is assigned
            const sampleLabel = storeParams.showSampleName && samplerSample
              ? samplerSample.name
              : (sb?.name ?? b.id)
            const name  = sampleLabel
            const wr        = projectedBodyScreenR(
              b.mass,
              type,
              sb?.z ?? b.z ?? 0,
              storeParams.bodyRadiusFromMass,
              storeParams.bodyRadiusMassScalePlanet,
              storeParams.bodyRadiusMassScaleSun,
            ) / zoom
            const isSel     = b.id === selectedBodyId
            const isMultiSel = !isSel && selectedBodyIds.includes(b.id)

            return (
              <g key={b.id}>
                {!simple ? (
                  <circle cx={b.x} cy={b.y} r={wr * 2.5} fill={color} opacity={0.07} />
                ) : (
                  type === 'sun' && (
                    !monochromeMode && <circle cx={b.x} cy={b.y} r={wr * 1.6} fill={inkColor} opacity={0.12} />
                  )
                )}
                {storeParams.showBodyOscilloscope && (() => {
                  const data = bodyOscilloscopeRef.current.get(b.id)
                  if (!data) return null
                  const oscHeight = Math.max(0, storeParams.bodyOscilloscopeHeight) / zoom
                  const oscGap = Math.max(0, storeParams.bodyOscilloscopeGap) / zoom
                  const path = circularOscilloscopePath(b.x, b.y, wr + oscGap, oscHeight, data)
                  if (!path) return null
                  return (
                    <path
                      d={path}
                      fill="none"
                      stroke={inkColor}
                      strokeWidth={Math.max(0.1, storeParams.bodyOscilloscopeStrokeWidth)}
                      strokeOpacity={monochromeMode ? paperLineOpacity : simple ? 0.42 : 0.62}
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: 'none' }}
                    />
                  )
                })()}
                {isSel && (
                  <circle cx={b.x} cy={b.y} r={wr + 5 / zoom} fill="none"
                    stroke={selStroke} strokeWidth={worldStroke(0.67)}
                    strokeDasharray={`${5 / zoom} ${3 / zoom}`} />
                )}
                {isMultiSel && (
                  <circle cx={b.x} cy={b.y} r={wr + 5 / zoom} fill="none"
                    stroke={monochromeMode ? monoInk : 'rgba(139,92,246,0.65)'} strokeWidth={worldStroke(0.67)}
                    strokeDasharray={`${4 / zoom} ${3 / zoom}`} />
                )}
                {/* Effector ring + influence radius */}
                {(() => {
                  const sb = storeBodiesMapRef.current.get(b.id)
                  const rackOv  = bodyParamsCacheRef.current.get(b.id) ?? {}
                  const effType = (rackOv.effectorType ?? sb?.effectorType ?? 'none') as string
                  if (effType === 'none') return null
                  const effDist = ((rackOv.effectorDistance ?? sb?.effectorDistance ?? 200) as number)
                  const effCol  = monochromeMode && !paperCanvasKeepBodyColors ? monoInk
                               : effType === 'delay'      ? '#a78bfa'
                               : effType === 'distortion'  ? '#ef4444'
                               : effType === 'chorus'      ? '#10b981'
                               : effType === 'phaser'      ? '#c084fc'
                               : effType === 'autofilter'  ? '#22d3ee'
                               : effType === 'bitcrush'    ? '#fb923c'
                               : effType === 'freeze'      ? '#7dd3fc'
                               : '#f97316'  // reverb = orange
                  const effLabel = effType === 'delay'      ? 'DLY'
                               : effType === 'distortion'  ? 'DST'
                               : effType === 'chorus'      ? 'CHO'
                               : effType === 'phaser'      ? 'PHS'
                               : effType === 'autofilter'  ? 'AFL'
                               : effType === 'bitcrush'    ? 'BIT'
                               : effType === 'freeze'      ? 'FRZ'
                               : 'FX'
                  return (
                    <>
                      <circle cx={b.x} cy={b.y} r={wr + 6 / zoom} fill="none"
                        stroke={effCol} strokeWidth={worldStroke()} strokeOpacity={monochromeMode ? paperLineOpacity : 0.65}
                        strokeDasharray={`${3 / zoom} ${2 / zoom}`} />
                      <circle cx={b.x} cy={b.y} r={effDist} fill="none"
                        stroke={effCol} strokeWidth={worldStroke(0.33)} strokeOpacity={monochromeMode ? paperSubtleOpacity : 0.20}
                        strokeDasharray={`${8 / zoom} ${5 / zoom}`} />
                      <text
                        x={b.x + wr + 10 / zoom} y={b.y - 2 / zoom}
                        fontSize={8 / zoom} fill={effCol} opacity={monochromeMode ? labelOpacity : 0.75}
                        style={{ pointerEvents: 'none', userSelect: 'none' }}>
                        {effLabel}
                      </text>
                    </>
                  )
                })()}
                {/* Standpoint listener ring + range + optional directional cone */}
                {storeParams.standpointBodyId === b.id && storeParams.showStandpointVisual !== false && (() => {
                  const r     = storeParams.standpointMaxDist
                  const dirOn = storeParams.standpointDirectional
                  // Facing angle for cone (from live velocity or manual)
                  let facingRad = ((b as PlanetBody).standpointFacingAngle ?? storeParams.standpointFacingAngle) * Math.PI / 180
                  if (dirOn && storeParams.standpointFacing === 'velocity') {
                    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy)
                    if (speed > 0.001) facingRad = Math.atan2(b.vy, b.vx)
                  }
                  const halfConeRad = (storeParams.standpointConeWidth / 2) * Math.PI / 180
                  const startAngle  = facingRad - halfConeRad
                  const endAngle    = facingRad + halfConeRad
                  const x1 = b.x + r * Math.cos(startAngle)
                  const y1 = b.y + r * Math.sin(startAngle)
                  const x2 = b.x + r * Math.cos(endAngle)
                  const y2 = b.y + r * Math.sin(endAngle)
                  const largeArc = halfConeRad * 2 > Math.PI ? 1 : 0

                  return (
                    <>
                      <circle cx={b.x} cy={b.y} r={wr + 7 / zoom} fill="none"
                        stroke={monochromeMode ? monoInk : '#06b6d4'} strokeWidth={worldStroke()} strokeOpacity={monochromeMode ? paperLineOpacity : 0.75} />
                      {/* Range: cone sector if directional, full circle otherwise */}
                      {dirOn ? (
                        // Directional: arc only (no center lines, no fill)
                        <path
                          d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
                          fill="none" stroke={monochromeMode ? monoInk : '#06b6d4'} strokeWidth={worldStroke(0.67)} strokeOpacity={monochromeMode ? paperLineOpacity : 0.6}
                          strokeDasharray={`${7 / zoom} ${5 / zoom}`} />
                      ) : (
                        <circle cx={b.x} cy={b.y} r={r} fill="none"
                          stroke={monochromeMode ? monoInk : '#06b6d4'} strokeWidth={worldStroke(0.33)} strokeOpacity={monochromeMode ? paperSubtleOpacity : 0.22}
                          strokeDasharray={`${7 / zoom} ${5 / zoom}`} />
                      )}
                      <text
                        x={b.x + wr + 11 / zoom} y={b.y + 3 / zoom}
                        fontSize={9 / zoom} fill={monochromeMode ? monoInk : '#06b6d4'} opacity={monochromeMode ? labelOpacity : 0.75}
                        style={{ pointerEvents: 'none', userSelect: 'none' }}>
                        SP
                      </text>
                    </>
                  )
                })()}
                {/* Orbit trigger position markers */}
                {(() => {
                  const bodyOv = bodyParamsCacheRef.current.get(b.id) ?? {}
                  const bp = Object.keys(bodyOv).length > 0 ? { ...storeParams, ...bodyOv } : storeParams
                  if (!bp.showOrbitTriggerMarkers || bp.orbitTriggerMode !== 'orbit-complete') return null
                  const stats = planetBodyStatsCache.get(b.id)
                  if (!stats || stats.r < 5) return null
                  const r = stats.r
                  const bodyAngleRad = stats.angleDeg * Math.PI / 180
                  // CoM position inferred from body pos + r + angle
                  const cmX = b.x - r * Math.cos(bodyAngleRad)
                  const cmY = b.y - r * Math.sin(bodyAngleRad)
                  const div = Math.max(0.0625, Number((bp as Record<string,unknown>).orbitTriggerDivision ?? 1))
                  const nMarkers = div >= 1 ? 1 : Math.round(1 / div)
                  return Array.from({ length: nMarkers }, (_, k) => {
                    const a = bodyAngleRad + k * 2 * Math.PI / nMarkers
                    const mx = cmX + r * Math.cos(a)
                    const my = cmY + r * Math.sin(a)
                    return (
                      <g key={k}>
                        <circle cx={mx} cy={my} r={5 / zoom} fill="none"
                          stroke={monochromeMode ? monoInk : '#60a5fa'} strokeWidth={worldStroke(0.8)} strokeOpacity={monochromeMode ? paperLineOpacity : 0.65} />
                        <line
                          x1={mx} y1={my - 5 / zoom} x2={mx} y2={my + 5 / zoom}
                          stroke={monochromeMode ? monoInk : '#60a5fa'} strokeWidth={worldStroke(0.53)} strokeOpacity={monochromeMode ? paperLineOpacity : 0.40} />
                      </g>
                    )
                  })
                })()}
                {hasSample && storeParams.rendezvousDistance > 0 && (
                  <circle cx={b.x} cy={b.y} r={storeParams.rendezvousDistance} fill="none"
                    stroke={inkColor} strokeWidth={worldStroke(0.33)} strokeOpacity={monochromeMode ? paperSubtleOpacity : 0.18}
                    strokeDasharray={`${8 / zoom} ${6 / zoom}`} />
                )}
                <circle cx={b.x} cy={b.y} r={wr} fill={inkColor}
                  opacity={monochromeMode ? paperMainOpacity : 1}
                  stroke={monochromeMode ? monoInk : simple ? 'rgba(0,0,0,0.15)' : 'none'}
                  strokeWidth={simple ? worldStroke(0.67) : 0}
                  style={{
                    cursor: storeParams.paused && !b.fixed ? 'grab' : 'default',
                    filter: monochromeMode ? 'none' : !simple
                      ? `drop-shadow(0 0 ${type === 'sun' ? 8 : 4}px ${color}88)`
                      : type === 'sun' ? `drop-shadow(0 0 3px ${color}66)` : 'none',
                  }}
                />
                {simple && !monochromeMode && type === 'sun' && (
                  <>
                    <line x1={b.x - wr * 1.5} y1={b.y} x2={b.x + wr * 1.5} y2={b.y}
                      stroke={inkColor} strokeWidth={worldStroke(0.67)} strokeOpacity={monochromeMode ? paperLineOpacity : 0.45} />
                    <line x1={b.x} y1={b.y - wr * 1.5} x2={b.x} y2={b.y + wr * 1.5}
                      stroke={inkColor} strokeWidth={worldStroke(0.67)} strokeOpacity={monochromeMode ? paperLineOpacity : 0.45} />
                  </>
                )}
                {hasSample && (
                  <circle cx={b.x + wr * 0.7} cy={b.y - wr * 0.7} r={2.5 / zoom}
                    fill={monochromeMode ? monoInk : simple ? '#2563eb' : '#60a5fa'} opacity={monochromeMode ? paperMainOpacity : 0.9} />
                )}
                <text x={b.x} y={b.y - wr - 5 / zoom} textAnchor="middle"
                  fontSize={10 / zoom} fill={labelColor} opacity={labelOpacity}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {name}
                </text>
              </g>
            )
          })}

          {/* ── Probe cursor ───────────────────────────────────────────── */}
          {probePos && (
            <g>
              <circle cx={probePos.x} cy={probePos.y} r={probeWr * 3}
                fill={probeCol} opacity={monochromeMode ? paperSubtleOpacity : 0.06} />
              <circle cx={probePos.x} cy={probePos.y} r={probeWr} fill="none"
                stroke={probeCol} strokeWidth={worldStroke()} strokeOpacity={monochromeMode ? paperLineOpacity : 1} strokeDasharray={`${4 / zoom} ${3 / zoom}`} />
              <circle cx={probePos.x} cy={probePos.y} r={3 / zoom}
                fill={probeCol} opacity={monochromeMode ? paperMainOpacity : 0.85} />
              {/* Crosshair */}
              {[[-1.6, 0, -0.55, 0], [0.55, 0, 1.6, 0], [0, -1.6, 0, -0.55], [0, 0.55, 0, 1.6]].map(([x1f, y1f, x2f, y2f], i) => (
                <line key={i}
                  x1={probePos.x + x1f * probeWr} y1={probePos.y + y1f * probeWr}
                  x2={probePos.x + x2f * probeWr} y2={probePos.y + y2f * probeWr}
                  stroke={probeCol} strokeWidth={worldStroke(0.67)} opacity={monochromeMode ? paperLineOpacity : 0.65} />
              ))}
              <text x={probePos.x} y={probePos.y - probeWr - 5 / zoom} textAnchor="middle"
                fontSize={9 / zoom} fill={probeCol} opacity={monochromeMode ? labelOpacity : 0.8}
                style={{ userSelect: 'none', pointerEvents: 'none' }}>
                probe m={storeParams.probeMass}
              </text>
            </g>
          )}

          {/* ── Predicted orbit preview ────────────────────────────────── */}
          {predictOrbitPoints && dpOverlay && (
            <polyline
              points={predictOrbitPoints}
              fill="none"
              stroke={dpOverlay.col}
              strokeWidth={worldStroke(0.67)}
              strokeOpacity={0.40}
              strokeDasharray={`${4 / zoom} ${4 / zoom}`}
            />
          )}

          {/* ── Drag-place bow-and-arrow overlay ───────────────────────── */}
          {dragPlace && dpOverlay && (
            <g>
              {dpOverlay.isPlanetLaunch && (
                <line x1={dragPlace.bodyX} y1={dragPlace.bodyY}
                  x2={dragPlace.dragX} y2={dragPlace.dragY}
                  stroke={monochromeMode ? monoInk : simple ? 'rgba(0,0,0,0.38)' : 'rgba(255,255,255,0.38)'}
                  strokeOpacity={monochromeMode ? paperLineOpacity : 1}
                  strokeWidth={worldStroke()} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />
              )}
              {dpOverlay.hasDrag && (
                <line x1={dragPlace.bodyX} y1={dragPlace.bodyY}
                  x2={dpOverlay.arrowX} y2={dpOverlay.arrowY}
                  stroke={dpOverlay.col} strokeWidth={worldStroke(1.33)} markerEnd="url(#placeArrow)" />
              )}
              <circle cx={dragPlace.bodyX} cy={dragPlace.bodyY} r={dpOverlay.wr}
                fill={dpOverlay.col} opacity={monochromeMode ? paperMainOpacity : 0.72} />
              {(dpOverlay.isSun || dpOverlay.isPlanetLaunch) && (
                <text x={dragPlace.bodyX} y={dragPlace.bodyY - dpOverlay.wr - 6 / zoom}
                  textAnchor="middle" fontSize={11 / zoom}
                  fill={dpOverlay.col} fontFamily="monospace" opacity={monochromeMode ? labelOpacity : 0.9}>
                  m={dpOverlay.mass}
                </text>
              )}
            </g>
          )}
        </g>

        {storeParams.paused && (
          <g>
            <rect x={6} y={6} width={230} height={20} rx={3}
              fill={monochromeMode ? monoInk : simple ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.4)'}
              opacity={monochromeMode ? 0.06 : 1} />
            <text x={12} y={21} fontSize={11} fill={hudColor} opacity={hudOpacity} fontFamily="monospace">
              ⏸  PAUSED — drag bodies to reposition
            </text>
          </g>
        )}
        <text x={8} y={h - 8} fontSize={9} fontFamily="monospace"
          fill={monochromeMode ? monoInk : simple ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.18)'}
          opacity={monochromeMode ? hudOpacity : 1}>
          scroll: zoom · right-drag: pan
        </text>
        <text x={w - 8} y={h - 8} fontSize={9} fontFamily="monospace"
          textAnchor="end" fill={monochromeMode ? monoInk : simple ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.18)'}
          opacity={monochromeMode ? hudOpacity : 1}>
          {bodies.length} bodies · speed={(storeParams.dt / 0.2).toFixed(storeParams.dt < 0.2 ? 2 : 1)}x · G={storeParams.G} · ε={storeParams.epsilon} · dt={storeParams.dt}
        </text>

        {/* Drag-rect multi-select overlay (screen coords, no camera transform) */}
        {dragSel && tool === 'select' && (() => {
          const rx = Math.min(dragSel.sx, dragSel.ex)
          const ry = Math.min(dragSel.sy, dragSel.ey)
          const rw = Math.abs(dragSel.ex - dragSel.sx)
          const rh = Math.abs(dragSel.ey - dragSel.sy)
          return (
            <rect x={rx} y={ry} width={rw} height={rh}
              fill={monochromeMode ? monoInk : 'rgba(139,92,246,0.07)'}
              fillOpacity={monochromeMode ? 0.06 : undefined}
              stroke={monochromeMode ? monoInk : 'rgba(139,92,246,0.55)'}
              strokeOpacity={monochromeMode ? paperLineOpacity : undefined}
              strokeWidth={1}
              strokeDasharray="5 3"
              style={{ pointerEvents: 'none' }} />
          )
        })()}
      </svg>
    </div>
  )
}
