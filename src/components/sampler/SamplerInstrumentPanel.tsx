// ── SamplerInstrumentPanel ─────────────────────────────────────────────────────
// Expanded sampler editor — appears to the right of the rack.
// Reads / writes params via controlSetStore's slotKey overrides.
// Shows a timeline bar with draggable sample-start/end & loop handles.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { usePlanetStore } from '../../store/planetStore'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import { useControlSetStore, BUILTIN_CONTROL_SETS } from '../../store/controlSetStore'
import type { PlanetSimParams } from '../../store/planetStore'
import { getSamplerPlayhead, getSamplerRawDuration } from '../../audio/samplerPlayhead'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0.00'
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(2).padStart(5, '0')
  return m > 0 ? `${m}:${s}` : `${sec.toFixed(3)}`
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function stableSampleIndexFromBodyId(bodyId: string, length: number): number {
  if (length <= 0) return 0
  let hash = 0
  for (let i = 0; i < bodyId.length; i++) {
    hash = ((hash << 5) - hash + bodyId.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % length
}

// ── Base control-set defaults ─────────────────────────────────────────────────

const CS_BASE = BUILTIN_CONTROL_SETS.find(c => c.id === 'instrument-sampler')!
const EMPTY_OV: Record<string, unknown> = {}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  bodyId:   string    // empty string = global
  slotKey:  string    // e.g. 'b:bodyId:instrument' or 'g:instrument'
  onClose:  () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SamplerInstrumentPanel({ bodyId, slotKey, onClose }: Props) {
  const simpleTheme = usePlanetStore(s => s.simParams.simpleTheme)
  const monochromeMode = useCanvasSettingsStore(s => s.monochromeMode)
  const simple = simpleTheme || monochromeMode

  // Param overrides for this slot
  const overrides       = useControlSetStore(s => s.rackParamOverrides[slotKey] ?? EMPTY_OV)
  const setSlotOverride = useControlSetStore(s => s.setSlotOverride)
  const resetSlotParam  = useControlSetStore(s => s.resetSlotParam)

  // Project samples
  const samples         = useProjectStore(s => s.project.samples)
  const addSampleAsset  = useProjectStore(s => s.addSampleAsset)

  // Read effective param (override → base default)
  function gp<T>(key: string, fallback: T): T {
    if (key in overrides) return overrides[key] as T
    const base = CS_BASE.params as Record<string, unknown>
    if (key in base) return base[key] as T
    return fallback
  }

  // Write param (resets to base if value matches)
  function sp(key: string, value: unknown) {
    const base = CS_BASE.params as Record<string, unknown>
    if (value === base[key]) resetSlotParam(slotKey, key)
    else setSlotOverride(slotKey, { [key]: value } as Partial<PlanetSimParams>)
  }

  // Resolved current sample
  const samplerMode  = gp<string>('samplerMode',   'auto')
  const fixedId      = gp<string | null>('samplerSampleId', null)
  const sample       = samplerMode === 'fixed'
    ? (fixedId ? (samples.find(s => s.id === fixedId) ?? null) : null)
    : (bodyId && samples.length > 0 ? samples[stableSampleIndexFromBodyId(bodyId, samples.length)] ?? null : null)

  // Sampler params
  const sampleStart  = gp<number>('samplerSampleStart', 0)
  const sampleEnd    = gp<number>('samplerSampleEnd',   1)
  const loopStart    = gp<number>('samplerLoopStart',   0)
  const loopEnd      = gp<number>('samplerLoopEnd',     1)
  const playMode     = gp<string>('samplerPlayMode',    'loop')
  const reverse      = gp<boolean>('samplerReverse',   false)
  const volume       = gp<number>('samplerVolume',      0.7)
  const detune       = gp<number>('samplerDetune',      0)
  const attack       = gp<number>('samplerAttack',      0.01)
  const release      = gp<number>('samplerRelease',     1.0)
  const reverbMix    = gp<number>('samplerReverbMix',   0.3)
  const loopEnabled  = playMode === 'loop' || playMode === 'pingpong'

  // Raw duration from registry — React state (changes only once per sample load)
  const [rawDuration, setRawDuration] = useState(0)

  // Playhead animation via DOM refs — avoids 60fps React re-renders
  const rafRef          = useRef(0)
  const rawDurRef       = useRef(0)
  const playheadDivRef  = useRef<HTMLDivElement>(null)
  const positionSpanRef = useRef<HTMLSpanElement>(null)
  const durationSpanRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    function tick() {
      if (bodyId) {
        const ph = getSamplerPlayhead(bodyId)
        const rd = getSamplerRawDuration(bodyId)

        // rawDuration: trigger re-render only when value actually changes
        if (rd > 0 && rd !== rawDurRef.current) {
          rawDurRef.current = rd
          setRawDuration(rd)
        }

        // Playhead bar — direct DOM mutation
        if (playheadDivRef.current) {
          if (ph) {
            const fullPos = ph.sampleStart + ph.normPosInPlay * (ph.sampleEnd - ph.sampleStart)
            playheadDivRef.current.style.left       = `${fullPos * 100}%`
            playheadDivRef.current.style.visibility = 'visible'
          } else {
            playheadDivRef.current.style.visibility = 'hidden'
          }
        }

        // Position / duration text — direct DOM mutation
        if (positionSpanRef.current && durationSpanRef.current) {
          const hasDur = rawDurRef.current > 0
          if (ph && hasDur) {
            positionSpanRef.current.textContent    = fmt(ph.positionSec)
            positionSpanRef.current.style.display  = ''
            durationSpanRef.current.textContent    = `/${fmt(rawDurRef.current)}`
            durationSpanRef.current.style.display  = ''
          } else {
            positionSpanRef.current.style.display  = 'none'
            if (hasDur) {
              durationSpanRef.current.textContent   = fmt(rawDurRef.current)
              durationSpanRef.current.style.display = ''
            } else {
              durationSpanRef.current.style.display = 'none'
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [bodyId])

  // ── Drag & drop sample loading ────────────────────────────────────────────

  const [dragOver, setDragOver] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)

  const loadFile = useCallback(async (file: File) => {
    const AUDIO_TYPES = ['audio/', 'video/ogg']
    if (!AUDIO_TYPES.some(t => file.type.startsWith(t)) && !file.name.match(/\.(wav|mp3|ogg|aiff?|flac|m4a|aac)$/i)) {
      setLoadError('Audio files only (wav, mp3, ogg, aiff, flac)')
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const objectUrl = URL.createObjectURL(file)
      const newSample = {
        id:       crypto.randomUUID(),
        name:     file.name.replace(/\.[^.]+$/, ''),
        objectUrl,
        fileType: file.type || 'audio/unknown',
      }
      addSampleAsset(newSample)
      sp('samplerMode',     'fixed')
      sp('samplerSampleId', newSample.id)
      // Reset range after loading new sample
      sp('samplerSampleStart', 0)
      sp('samplerSampleEnd',   1)
      sp('samplerLoopStart',   0)
      sp('samplerLoopEnd',     1)
      setRawDuration(0)  // will be updated once engine plays
    } catch {
      setLoadError('Could not load audio file')
    } finally {
      setLoading(false)
    }
  }, [addSampleAsset, slotKey])  // eslint-disable-line react-hooks/exhaustive-deps

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) void loadFile(file)
  }

  function handleFileClick() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/*'
    input.onchange = () => { if (input.files?.[0]) void loadFile(input.files[0]) }
    input.click()
  }

  // ── Timeline drag handles ─────────────────────────────────────────────────

  const barRef = useRef<HTMLDivElement>(null)

  type Handle = 'sampleStart' | 'sampleEnd' | 'loopStart' | 'loopEnd'
  const draggingHandle = useRef<Handle | null>(null)

  function barFractionFromEvent(e: MouseEvent): number {
    if (!barRef.current) return 0
    const rect = barRef.current.getBoundingClientRect()
    return clamp((e.clientX - rect.left) / rect.width, 0, 1)
  }

  function startHandleDrag(handle: Handle) {
    return (e: React.PointerEvent) => {
      e.stopPropagation()
      draggingHandle.current = handle
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
  }

  function onBarPointerMove(e: React.PointerEvent) {
    const h = draggingHandle.current
    if (!h) return
    const frac = barFractionFromEvent(e.nativeEvent)
    const sliceLen = Math.max(0.001, sampleEnd - sampleStart)
    if (h === 'sampleStart') {
      const v = clamp(frac, 0, sampleEnd - 0.01)
      sp('samplerSampleStart', Math.round(v * 1000) / 1000)
    } else if (h === 'sampleEnd') {
      const v = clamp(frac, sampleStart + 0.01, 1)
      sp('samplerSampleEnd', Math.round(v * 1000) / 1000)
    } else if (h === 'loopStart') {
      // loopStart is normalized within the slice
      const sliceFrac = clamp((frac - sampleStart) / sliceLen, 0, loopEnd - 0.01)
      sp('samplerLoopStart', Math.round(sliceFrac * 1000) / 1000)
    } else if (h === 'loopEnd') {
      const sliceFrac = clamp((frac - sampleStart) / sliceLen, loopStart + 0.01, 1)
      sp('samplerLoopEnd', Math.round(sliceFrac * 1000) / 1000)
    }
  }

  function onBarPointerUp() {
    draggingHandle.current = null
  }

  // ── Colours ───────────────────────────────────────────────────────────────

  const bg        = simple ? '#f5f5f3' : '#0d0d16'
  const border    = simple ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.07)'
  const text      = simple ? '#1f1f1f' : 'rgba(255,255,255,0.88)'
  const textMid   = simple ? '#555'    : 'rgba(255,255,255,0.50)'
  const textDim   = simple ? '#999'    : 'rgba(255,255,255,0.28)'
  const inputBg   = simple ? 'rgba(0,0,0,0.05)'  : 'rgba(255,255,255,0.07)'
  const inputBdr  = simple ? 'rgba(0,0,0,0.12)'  : 'rgba(255,255,255,0.12)'
  const divider   = simple ? 'rgba(0,0,0,0.07)'  : 'rgba(255,255,255,0.06)'
  const accent    = '#06b6d4'  // cyan — sampler colour
  const accentDim = 'rgba(6,182,212,0.25)'

  // ── Sample range bar geometry (all in %) ──────────────────────────────────

  const sStartPct = sampleStart * 100
  const sEndPct   = sampleEnd   * 100
  const sliceLen  = sampleEnd - sampleStart
  const lStartPct = (sampleStart + loopStart * sliceLen) * 100
  const lEndPct   = (sampleStart + loopEnd   * sliceLen) * 100

  // Time labels (only meaningful once we know rawDuration)
  const rd = rawDuration > 0 ? rawDuration : (sample ? 1 : 0)

  const inputStyle: React.CSSProperties = {
    fontSize: 10, fontFamily: 'monospace', fontWeight: 600,
    border: `0.5px solid ${inputBdr}`, borderRadius: 4,
    background: inputBg, color: text, outline: 'none',
    padding: '2px 5px', width: 60,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 9, color: textDim, fontWeight: 600, letterSpacing: '0.04em',
    textTransform: 'uppercase', whiteSpace: 'nowrap',
  }

  const _rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, padding: '3px 12px',
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      width: 380, flexShrink: 0,
      background: bg, borderLeft: `0.5px solid ${border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 10px 0 12px',
        borderBottom: `0.5px solid ${border}`,
        background: simple ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.04)',
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: accent, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Sampler
        </span>
        <div style={{ width: 1, height: 12, background: divider }} />
        <span style={{ fontSize: 10, color: text, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sample?.name ?? (loading ? 'Loading…' : '— no sample —')}
        </span>
        {/* Position + duration — updated via DOM refs at 60fps (no React re-renders) */}
        <span ref={positionSpanRef} style={{ display: 'none', fontSize: 9, color: accent, fontFamily: 'monospace', minWidth: 42, textAlign: 'right' }} />
        <span ref={durationSpanRef} style={{ display: 'none', fontSize: 9, color: textMid, fontFamily: 'monospace' }} />
        <button
          onClick={onClose}
          style={{ width: 18, height: 18, border: 'none', background: 'transparent', cursor: 'pointer', color: textDim, fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3, padding: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
          onMouseLeave={e => (e.currentTarget.style.color = textDim)}
        >×</button>
      </div>

      {/* ── Drop zone / sample row ────────────────────────────────────── */}
      {!sample ? (
        <div
          onClick={handleFileClick}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8,
            border: `1.5px dashed ${dragOver ? accent : (simple ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.14)')}`,
            borderRadius: 8, margin: 12, cursor: 'pointer',
            background: dragOver ? accentDim : 'transparent',
            transition: 'border-color 0.12s, background 0.12s',
          }}>
          <span style={{ fontSize: 28, opacity: 0.4 }}>♫</span>
          <span style={{ fontSize: 11, color: textMid, fontWeight: 600 }}>Drop Audio Sample Here</span>
          <span style={{ fontSize: 9, color: textDim }}>wav · mp3 · ogg · aiff · flac</span>
          {loadError && <span style={{ fontSize: 9, color: '#ef4444' }}>{loadError}</span>}
        </div>
      ) : (
        <>
          {/* Sample info + mini drop target */}
          <div
            onClick={handleFileClick}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
              borderBottom: `0.5px solid ${border}`,
              background: dragOver ? accentDim : 'transparent',
              cursor: 'pointer', transition: 'background 0.1s',
            }}>
            <span style={{ fontSize: 9, color: accent }}>▶</span>
            <span style={{ fontSize: 10, color: text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sample.name}
            </span>
            <span style={{ fontSize: 8.5, color: textDim, fontFamily: 'monospace' }}>
              {rd > 0 ? fmt(rd) : '—'}
            </span>
            <span style={{ fontSize: 8, color: textDim }}>↓ replace</span>
            {loadError && <span style={{ fontSize: 8, color: '#ef4444' }}>{loadError}</span>}
          </div>

          {/* ── Timeline bar ─────────────────────────────────────── */}
          <div style={{ flexShrink: 0, padding: '10px 12px 4px' }}>
            <div
              ref={barRef}
              onPointerMove={onBarPointerMove}
              onPointerUp={onBarPointerUp}
              style={{
                position: 'relative', height: 32, borderRadius: 5, overflow: 'visible',
                background: simple ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)',
                cursor: 'col-resize', userSelect: 'none',
              }}>

              {/* Sample range */}
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${sStartPct}%`, width: `${sEndPct - sStartPct}%`,
                background: `rgba(6,182,212,0.20)`,
                borderLeft:  `1.5px solid ${accent}`,
                borderRight: `1.5px solid ${accent}`,
              }} />

              {/* Loop range */}
              {loopEnabled && (
                <div style={{
                  position: 'absolute', top: '30%', bottom: '30%',
                  left: `${lStartPct}%`, width: `${lEndPct - lStartPct}%`,
                  background: 'rgba(139,92,246,0.35)',
                  borderLeft:  '1.5px solid #a78bfa',
                  borderRight: '1.5px solid #a78bfa',
                }} />
              )}

              {/* Playhead — always mounted, visibility + left controlled by RAF ref */}
              <div
                ref={playheadDivRef}
                style={{
                  position: 'absolute', top: -6, bottom: -3,
                  left: '0%',
                  transform: 'translateX(-50%)',
                  width: 2, background: '#fbbf24',
                  boxShadow: '0 0 5px #fbbf2488',
                  pointerEvents: 'none',
                  zIndex: 4,
                  visibility: 'hidden',
                }}>
                {/* Triangle marker at top */}
                <div style={{
                  position: 'absolute', top: -4, left: '50%',
                  transform: 'translateX(-50%)',
                  width: 0, height: 0,
                  borderLeft: '4px solid transparent',
                  borderRight: '4px solid transparent',
                  borderTop: '5px solid #fbbf24',
                }} />
              </div>

              {/* Draggable handles */}
              {([
                ['sampleStart', sStartPct, accent],
                ['sampleEnd',   sEndPct,   accent],
                ...(loopEnabled ? [
                  ['loopStart', lStartPct, '#a78bfa'],
                  ['loopEnd',   lEndPct,   '#a78bfa'],
                ] : []) as [string, number, string][],
              ] as [Handle, number, string][]).map(([handle, pct, col]) => (
                <div
                  key={handle}
                  onPointerDown={startHandleDrag(handle)}
                  style={{
                    position: 'absolute', top: -4, bottom: -4,
                    left: `${pct}%`, width: 8,
                    transform: 'translateX(-4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'ew-resize', zIndex: 2,
                  }}>
                  <div style={{ width: 3, height: '100%', background: col, borderRadius: 2 }} />
                </div>
              ))}
            </div>

            {/* Time axis labels */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
              <span style={{ fontSize: 7.5, color: textDim, fontFamily: 'monospace' }}>
                {fmt(sampleStart * rd)}
              </span>
              <span style={{ fontSize: 7.5, color: textDim, fontFamily: 'monospace' }}>
                {fmt(sampleEnd * rd)}
              </span>
            </div>
          </div>

          {/* ── Controls ───────────────────────────────────────────── */}
          <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>

            {/* Playback mode */}
            <Row label="Mode" divider={divider}>
              <div style={{ display: 'flex', gap: 3 }}>
                {(['oneshot', 'loop', 'pingpong'] as const).map(m => (
                  <button key={m} onClick={() => sp('samplerPlayMode', m)}
                    style={{
                      fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                      border: `0.5px solid ${playMode === m ? accent : inputBdr}`,
                      background: playMode === m ? `rgba(6,182,212,0.18)` : inputBg,
                      color: playMode === m ? accent : textMid, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    {m === 'oneshot' ? 'Oneshot' : m === 'pingpong' ? 'Ping' : 'Loop'}
                  </button>
                ))}
                <button onClick={() => sp('samplerReverse', !reverse)}
                  style={{
                    fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4, marginLeft: 4,
                    border: `0.5px solid ${reverse ? '#f59e0b' : inputBdr}`,
                    background: reverse ? 'rgba(245,158,11,0.15)' : inputBg,
                    color: reverse ? '#f59e0b' : textMid, cursor: 'pointer', fontFamily: 'inherit',
                  }}>⟲ Rev</button>
              </div>
            </Row>

            {/* Sample range */}
            <SectionHeader label="Sample Range" simple={simple} textDim={textDim} />
            <Row label="Start" divider={divider}>
              <input type="number" value={sampleStart} min={0} max={0.99} step={0.001}
                style={inputStyle}
                onChange={e => sp('samplerSampleStart', clamp(+e.target.value, 0, sampleEnd - 0.01))} />
              <span style={{ fontSize: 8, color: textDim, fontFamily: 'monospace' }}>{fmt(sampleStart * rd)}</span>
            </Row>
            <Row label="End" divider={divider}>
              <input type="number" value={sampleEnd} min={0.01} max={1} step={0.001}
                style={inputStyle}
                onChange={e => sp('samplerSampleEnd', clamp(+e.target.value, sampleStart + 0.01, 1))} />
              <span style={{ fontSize: 8, color: textDim, fontFamily: 'monospace' }}>{fmt(sampleEnd * rd)}</span>
            </Row>

            {/* Loop range */}
            <SectionHeader label="Loop Range" simple={simple} textDim={textDim} />
            <Row label="Lp Start" divider={divider}>
              <input type="number" value={loopStart} min={0} max={0.99} step={0.001}
                style={inputStyle}
                onChange={e => sp('samplerLoopStart', clamp(+e.target.value, 0, loopEnd - 0.01))} />
              <span style={{ fontSize: 8, color: textDim, fontFamily: 'monospace' }}>{fmt((sampleStart + loopStart * sliceLen) * rd)}</span>
            </Row>
            <Row label="Lp End" divider={divider}>
              <input type="number" value={loopEnd} min={0.01} max={1} step={0.001}
                style={inputStyle}
                onChange={e => sp('samplerLoopEnd', clamp(+e.target.value, loopStart + 0.01, 1))} />
              <span style={{ fontSize: 8, color: textDim, fontFamily: 'monospace' }}>{fmt((sampleStart + loopEnd * sliceLen) * rd)}</span>
            </Row>

            {/* Tone */}
            <SectionHeader label="Tone" simple={simple} textDim={textDim} />
            <Row label="Volume" divider={divider}>
              <input type="range" min={0} max={1} step={0.01} value={volume}
                onChange={e => sp('samplerVolume', +e.target.value)}
                style={{ flex: 1 }} />
              <span style={{ ...labelStyle, minWidth: 26, textAlign: 'right', color: textMid }}>{Math.round(volume * 100)}</span>
            </Row>
            <Row label="Detune" divider={divider}>
              <input type="range" min={-24} max={24} step={1} value={detune}
                onChange={e => sp('samplerDetune', +e.target.value)}
                style={{ flex: 1 }} />
              <span style={{ ...labelStyle, minWidth: 26, textAlign: 'right', color: textMid, fontFamily: 'monospace' }}>{detune > 0 ? `+${detune}` : detune}</span>
            </Row>

            {/* Envelope */}
            <SectionHeader label="Envelope" simple={simple} textDim={textDim} />
            <Row label="Attack" divider={divider}>
              <input type="range" min={0.001} max={10} step={0.01} value={attack}
                onChange={e => sp('samplerAttack', +e.target.value)}
                style={{ flex: 1 }} />
              <span style={{ ...labelStyle, minWidth: 30, textAlign: 'right', color: textMid, fontFamily: 'monospace' }}>{attack.toFixed(2)}s</span>
            </Row>
            <Row label="Release" divider={divider}>
              <input type="range" min={0.01} max={20} step={0.05} value={release}
                onChange={e => sp('samplerRelease', +e.target.value)}
                style={{ flex: 1 }} />
              <span style={{ ...labelStyle, minWidth: 30, textAlign: 'right', color: textMid, fontFamily: 'monospace' }}>{release.toFixed(2)}s</span>
            </Row>

            {/* FX */}
            <SectionHeader label="FX" simple={simple} textDim={textDim} />
            <Row label="Reverb" divider={divider}>
              <input type="range" min={0} max={1} step={0.01} value={reverbMix}
                onChange={e => sp('samplerReverbMix', +e.target.value)}
                style={{ flex: 1 }} />
              <span style={{ ...labelStyle, minWidth: 26, textAlign: 'right', color: textMid }}>{Math.round(reverbMix * 100)}</span>
            </Row>

            {/* Sample source */}
            <SectionHeader label="Source" simple={simple} textDim={textDim} />
            <Row label="Mode" divider={divider}>
              <div style={{ display: 'flex', gap: 3 }}>
                {(['auto', 'fixed'] as const).map(m => (
                  <button key={m} onClick={() => sp('samplerMode', m)}
                    style={{
                      fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                      border: `0.5px solid ${samplerMode === m ? accent : inputBdr}`,
                      background: samplerMode === m ? `rgba(6,182,212,0.18)` : inputBg,
                      color: samplerMode === m ? accent : textMid, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    {m === 'auto' ? 'Auto' : 'Fixed'}
                  </button>
                ))}
              </div>
            </Row>
            {samplerMode === 'fixed' && (
              <Row label="Sample" divider={divider}>
                <select
                  value={fixedId ?? ''}
                  onChange={e => sp('samplerSampleId', e.target.value || null)}
                  style={{ flex: 1, fontSize: 9, border: `0.5px solid ${inputBdr}`, borderRadius: 4, padding: '2px 4px', background: inputBg, color: text, fontFamily: 'inherit' }}
                >
                  <option value="">— auto —</option>
                  {samples.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Row>
            )}

          </div>
        </>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Row({ label, children, divider }: { label: string; children: React.ReactNode; divider: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px', borderBottom: `0.5px solid ${divider}` }}>
      <span style={{ fontSize: 9, color: 'rgba(128,128,128,0.7)', width: 46, flexShrink: 0, textAlign: 'right', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </span>
      {children}
    </div>
  )
}

function SectionHeader({ label, simple, textDim }: { label: string; simple: boolean; textDim: string }) {
  return (
    <div style={{
      padding: '6px 12px 3px', fontSize: 8.5, fontWeight: 700,
      color: textDim, letterSpacing: '0.08em', textTransform: 'uppercase',
      background: simple ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)',
    }}>
      {label}
    </div>
  )
}
