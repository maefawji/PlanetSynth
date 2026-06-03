// ── OneShotSamplerPanel ───────────────────────────────────────────────────────
// Minimal one-shot sampler UI.
//
// Shows:
//   • Sample loaded / no sample (with drag-and-drop loader)
//   • ONE-SHOT mode label
//   • Trigger button
//   • Current state: idle / playing
//   • Simple playhead bar (DOM ref, no React state at 60fps)

import { useState, useEffect, useRef, useCallback } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import { useProjectStore } from '../../store/projectStore'
import { useControlSetStore } from '../../store/controlSetStore'
import type { PlanetSimParams } from '../../store/planetStore'
import { getBodyOneShotEngine } from '../../audio/OneShotSamplerEngine'
import type { OneShotState } from '../../audio/OneShotSamplerEngine'

interface Props {
  bodyId:  string
  slotKey: string
  onClose: () => void
}

// Stable empty object — prevents Zustand from firing infinite re-renders
// when the slot has no param overrides yet (selector must return stable ref).
const EMPTY_OVERRIDES: Partial<PlanetSimParams> = {}

function stableSampleIndexFromBodyId(bodyId: string, length: number): number {
  if (length <= 0) return 0
  let hash = 0
  for (let i = 0; i < bodyId.length; i++) {
    hash = ((hash << 5) - hash + bodyId.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % length
}

export function OneShotSamplerPanel({ bodyId, slotKey, onClose }: Props) {
  const simpleTheme  = usePlanetStore(s => s.simParams.simpleTheme)
  const monochromeMode = useCanvasSettingsStore(s => s.monochromeMode)
  const simple       = simpleTheme || monochromeMode
  const samples      = useProjectStore(s => s.project.samples)
  const addSampleAsset = useProjectStore(s => s.addSampleAsset)
  const overrides    = useControlSetStore(s => s.rackParamOverrides[slotKey] ?? EMPTY_OVERRIDES)
  const setSlotOverride = useControlSetStore(s => s.setSlotOverride)
  const resetSlotParam  = useControlSetStore(s => s.resetSlotParam)

  // ── Theme ───────────────────────────────────────────────────────────────────
  const bg       = simple ? 'rgba(255,255,255,0.92)' : '#1a1a2e'
  const border   = simple ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)'
  const text     = simple ? '#111' : '#e8e8f0'
  const textMid  = simple ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.50)'
  const accent   = '#06b6d4'
  const accentDim = simple ? 'rgba(6,182,212,0.08)' : 'rgba(6,182,212,0.12)'
  const divider  = simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)'

  // ── Resolved sample ─────────────────────────────────────────────────────────
  const samplerMode = (overrides as Record<string, unknown>).samplerMode as string ?? 'auto'
  const fixedId     = (overrides as Record<string, unknown>).samplerSampleId as string | null ?? null
  const sample      = samplerMode === 'fixed'
    ? (fixedId ? (samples.find(s => s.id === fixedId) ?? null) : null)
    : (bodyId && samples.length > 0 ? samples[stableSampleIndexFromBodyId(bodyId, samples.length)] ?? null : null)

  // ── Sampler state (from engine) ─────────────────────────────────────────────
  const [samplerState, setSamplerState] = useState<OneShotState>('idle')
  const rafRef        = useRef(0)
  const playheadRef   = useRef<HTMLDivElement>(null)
  const progressRef   = useRef<HTMLDivElement>(null)

  // Sync engine state + playhead bar at 60fps (DOM mutation only)
  useEffect(() => {
    const tick = () => {
      const eng = getBodyOneShotEngine(bodyId)
      if (eng) {
        setSamplerState(eng.state)
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
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [bodyId])

  // ── Drag-and-drop / file picker ─────────────────────────────────────────────
  const [dragOver,   setDragOver]   = useState(false)
  const [loadError,  setLoadError]  = useState<string | null>(null)
  const [loading,    setLoading]    = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadFile = useCallback(async (file: File) => {
    const AUDIO_EXT = /\.(wav|mp3|ogg|aiff?|flac|m4a|aac)$/i
    if (!file.type.startsWith('audio/') && !file.name.match(AUDIO_EXT)) {
      setLoadError('Audio files only (wav, mp3, ogg, aiff, flac)')
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const objectUrl  = URL.createObjectURL(file)
      const newSample  = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ''), objectUrl, fileType: file.type || 'audio/unknown' }
      addSampleAsset(newSample)
      setSlotOverride(slotKey, { samplerMode: 'fixed', samplerSampleId: newSample.id } as Partial<PlanetSimParams>)
    } catch {
      setLoadError('Could not load audio file')
    } finally {
      setLoading(false)
    }
  }, [addSampleAsset, slotKey, setSlotOverride])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
  }
  function handleFileClick() { fileInputRef.current?.click() }
  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) loadFile(file)
    e.target.value = ''
  }

  // ── Trigger ─────────────────────────────────────────────────────────────────
  function handleTrigger() {
    const eng = getBodyOneShotEngine(bodyId)
    if (eng) eng.trigger()
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const isPlaying = samplerState === 'playing'
  const isLoading = samplerState === 'loading' || loading

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', width: 340, height: '100%',
      background: bg, borderLeft: `1px solid ${border}`, fontSize: 11, color: text,
      fontFamily: 'system-ui, sans-serif', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, height: 36,
        padding: '0 10px 0 12px', borderBottom: `0.5px solid ${border}`,
        background: simple ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.04)',
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: accent, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Sampler
        </span>
        <div style={{ width: 1, height: 12, background: divider }} />
        {/* ONE-SHOT badge */}
        <span style={{ fontSize: 8, fontWeight: 700, color: accent, border: `0.5px solid ${accent}55`, borderRadius: 3, padding: '1px 5px', letterSpacing: '0.06em' }}>
          ONE-SHOT
        </span>
        <span style={{ fontSize: 10, color: text, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sample?.name ?? (isLoading ? 'Loading…' : '— no sample —')}
        </span>
        {/* State indicator */}
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', color: isPlaying ? '#22c55e' : textMid }}>
          {isPlaying ? '● PLAYING' : '○ IDLE'}
        </span>
        <button
          onClick={onClose}
          style={{ width: 18, height: 18, border: 'none', background: 'transparent', cursor: 'pointer', color: textMid, fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3, padding: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
          onMouseLeave={e => (e.currentTarget.style.color = textMid)}
        >×</button>
      </div>

      {/* Sample drop zone or content */}
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
          <span style={{ fontSize: 9, color: textMid, opacity: 0.7 }}>wav · mp3 · ogg · aiff · flac</span>
          {loadError && <span style={{ fontSize: 9, color: '#ef4444' }}>{loadError}</span>}
        </div>
      ) : (
        <>
          {/* Sample row */}
          <div
            onClick={handleFileClick}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
              borderBottom: `0.5px solid ${border}`,
              background: dragOver ? accentDim : 'transparent',
              cursor: 'pointer', transition: 'background 0.1s',
            }}>
            <span style={{ fontSize: 9, color: accent }}>▶</span>
            <span style={{ fontSize: 10, color: text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sample.name}
            </span>
            <span style={{ fontSize: 8, color: textMid }}>↓ replace</span>
            {loadError && <span style={{ fontSize: 8, color: '#ef4444' }}>{loadError}</span>}
          </div>

          {/* Playhead bar */}
          <div style={{ flexShrink: 0, padding: '10px 12px 6px' }}>
            <div style={{
              position: 'relative', height: 24, borderRadius: 4, overflow: 'visible',
              background: simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)',
            }}>
              {/* Progress fill — always mounted, width/visibility toggled by RAF */}
              <div
                ref={progressRef}
                style={{
                  position: 'absolute', top: 0, left: 0, height: '100%',
                  width: '0%', borderRadius: 4,
                  background: simple ? 'rgba(6,182,212,0.25)' : 'rgba(6,182,212,0.30)',
                  pointerEvents: 'none', zIndex: 1,
                  visibility: 'hidden',
                }}
              />
              {/* Playhead — always mounted, visibility toggled by RAF */}
              <div
                ref={playheadRef}
                style={{
                  position: 'absolute', top: -4, bottom: -2,
                  left: '0%', transform: 'translateX(-50%)',
                  width: 2, background: '#fbbf24',
                  boxShadow: '0 0 5px #fbbf2488',
                  pointerEvents: 'none', zIndex: 4,
                  visibility: 'hidden',
                }}>
                <div style={{
                  position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)',
                  width: 0, height: 0,
                  borderLeft: '4px solid transparent', borderRight: '4px solid transparent',
                  borderTop: '5px solid #fbbf24',
                }} />
              </div>
            </div>
          </div>

          {/* Trigger button */}
          <div style={{ padding: '8px 12px' }}>
            <button
              onClick={handleTrigger}
              disabled={isLoading}
              style={{
                width: '100%', height: 40, border: `1px solid ${isPlaying ? '#22c55e' : accent}`,
                borderRadius: 6, cursor: isLoading ? 'not-allowed' : 'pointer',
                background: isPlaying ? 'rgba(34,197,94,0.15)' : `${accent}18`,
                color: isPlaying ? '#22c55e' : accent,
                fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
                letterSpacing: '0.08em', transition: 'all 0.08s',
                opacity: isLoading ? 0.5 : 1,
              }}
              onMouseEnter={e => { if (!isLoading) e.currentTarget.style.background = `${accent}28` }}
              onMouseLeave={e => { e.currentTarget.style.background = isPlaying ? 'rgba(34,197,94,0.15)' : `${accent}18` }}
            >
              {isLoading ? '…' : isPlaying ? '▶ PLAYING' : '▶ TRIGGER'}
            </button>
          </div>

        </>
      )}

      {/* Sample source selector — always visible */}
      <div style={{ flexShrink: 0, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 8, borderTop: `0.5px solid ${divider}` }}>
        <span style={{ fontSize: 8.5, color: textMid }}>Sample source</span>
        <select
          value={samplerMode}
          onChange={e => setSlotOverride(slotKey, { samplerMode: e.target.value } as Partial<PlanetSimParams>)}
          style={{ flex: 1, fontSize: 8.5, border: `0.5px solid ${border}`, borderRadius: 3, padding: '2px 4px', background: simple ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)', color: text, fontFamily: 'inherit' }}
        >
          <option value="auto">Auto (hash)</option>
          <option value="fixed">Fixed (this file)</option>
        </select>
        {samplerMode === 'fixed' && fixedId && (
          <button
            onClick={() => resetSlotParam(slotKey, 'samplerSampleId')}
            style={{ fontSize: 8, color: textMid, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
          >clear</button>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleFileInput} />
    </div>
  )
}
