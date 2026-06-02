import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Upload } from 'lucide-react'
import { useProjectStore } from '../../store/projectStore'
import { useSelectionStore } from '../../store/selectionStore'
import { useAudioStore } from '../../store/audioStore'
import { usePlanetStore } from '../../store/planetStore'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import { useControlSetStore } from '../../store/controlSetStore'
import type { PlanetBody } from '../../store/planetStore'
import type { PlanetTool } from '../planet/PlanetCanvas'
import { nodeRegistry } from '../../patch/nodeRegistry'
import { applyControlValues, resumeEngine } from '../../audio/audioEngine'
import { getPlayerState, getMasterVolume, setMasterVolume, triggerBodySound, wasBodyRecentlyTriggered } from '../../audio/intersectionSynth'
import { ADSR_OFF, computeOrbitAdsr } from '../../audio/orbitAdsr'
import { getBodyOutputLevel } from '../../audio/bodyOutputMeter'
import type { GeometryType, JSONValue, SignalType } from '../../patch/types'
import { useTheme } from '../../lib/theme'
import { getMidiOutputs, getSelectedOutputId, setSelectedOutputId, isMidiReady, midiNoteToName } from '../../audio/midiManager'
import { computeOrbitStats } from '../planet/DroneLayer'
import { getPlanetLiveBodySnapshot, planetBodyStatsCache } from '../planet/PlanetCanvas'

const signalColor: Record<SignalType, string> = {
  audio: '#1a1a1a', control: '#2563eb', trigger: '#c2410c', sample: '#db2777', geometry: '#16a34a', geometryList: '#7c3aed',
}

interface RightInspectorProps {
  mode?: 'sampler' | 'patcher' | 'planet'
  planetTool?: PlanetTool
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function RightInspector({ mode, planetTool, collapsed, onToggleCollapsed }: RightInspectorProps) {
  const t               = useTheme()
  const selectedNodeId  = useSelectionStore(s => s.selectedNodeId)
  const selectedGeomId  = useSelectionStore(s => s.selectedGeometryId)
  const project         = useProjectStore(s => s.project)

  const node = selectedNodeId ? project.nodes.find(n => n.id === selectedNodeId) : null
  const def  = node ? nodeRegistry[node.type] : null
  const geom = selectedGeomId ? project.geometry.find(g => g.id === selectedGeomId) : null

  // ── Render ────────────────────────────────────────────────────────────────────

  if (collapsed) {
    return (
      <div style={{
        width: 34, flexShrink: 0,
        background: t.panelBg,
        borderLeft: `0.5px solid ${t.panelBorder}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        overflow: 'hidden',
      }}>
        <button
          onClick={onToggleCollapsed}
          title="Show Panel"
          style={{
            marginTop: 6, width: 22, height: 22, border: 'none', borderRadius: 4,
            background: 'transparent', color: t.textMid, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <ChevronLeft size={13} />
        </button>
        <div style={{
          marginTop: 12,
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          fontSize: 8.5, fontWeight: 800, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: t.textDim,
          userSelect: 'none', opacity: 0.6,
        }}>
          Mixer
        </div>
      </div>
    )
  }

  // Non-planet mode inspector content
  const inspectorContent = node && def ? (
    <NodeInspector nodeId={node.id} nodeType={node.type} params={node.params} />
  ) : geom ? (
    <GeomInspector geomId={geom.id} geomType={geom.type} sampleId={geom.sampleId ?? null} params={geom.params} mode={mode} />
  ) : (
    <div style={{ fontSize: 11, color: t.textDim, padding: 16, textAlign: 'center' }}>
      Select a node or shape
    </div>
  )

  return (
    <div style={{
      width: 260, flexShrink: 0,
      background: t.panelBg,
      borderLeft: `0.5px solid ${t.panelBorder}`,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', position: 'relative',
    }}>
      {/* Collapse-whole-panel button — top-right corner */}
      <button
        onClick={onToggleCollapsed}
        title="Hide Panel"
        style={{
          position: 'absolute', top: 4, right: 4, zIndex: 10,
          width: 20, height: 20, border: 'none', borderRadius: 4,
          background: 'transparent', color: t.textDim, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <ChevronRight size={12} />
      </button>

      {/* Planet mode: Mixer only */}
      {mode === 'planet' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <PlanetMixerSection />
        </div>
      )}

      {/* Other modes: Inspector */}
      {mode !== 'planet' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {inspectorContent}
        </div>
      )}
    </div>
  )
}

// ── Planet Mixer Section ──────────────────────────────────────────────────────
// (formerly PlanetPanel in LeftLibraryPanel)
// ─────────────────────────────────────────────────────────────────────────────

function preventTrackVolumeJump(e: React.PointerEvent<HTMLInputElement>, value: number) {
  const rect = e.currentTarget.getBoundingClientRect()
  const thumbX = rect.left + Math.max(0, Math.min(1, value)) * rect.width
  if (Math.abs(e.clientX - thumbX) > 12) { e.preventDefault(); e.stopPropagation() }
}

function MixerSettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useTheme()
  return (
    <div style={{ padding: '5px 10px 7px' }}>
      <div style={{ fontSize: 8.5, fontWeight: 700, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{children}</div>
    </div>
  )
}

function MasterVolumeBar() {
  const t = useTheme()
  const [masterVol, setMasterVol] = useState(() => getMasterVolume())
  return (
    <div style={{ padding: '5px 10px 4px', borderBottom: `0.5px solid ${t.divider}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 9.5, color: t.textMid, flexShrink: 0, width: 62, textAlign: 'right' }}>Master</span>
        <input type="range" min={0} max={1} step={0.01} value={masterVol}
          onPointerDown={e => preventTrackVolumeJump(e, masterVol)}
          onChange={e => { const v = parseFloat(e.target.value); setMasterVol(v); setMasterVolume(v) }}
          className="planet-fader" style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: t.textDim, flexShrink: 0, width: 24, textAlign: 'right', fontFamily: 'monospace' }}>
          {Math.round(masterVol * 100)}
        </span>
      </div>
    </div>
  )
}

function MixerBodyRow({ b, selected, onSelect, onRemove, onToggleMute, onVolumeChange }: {
  b: PlanetBody; selected: boolean
  onSelect: () => void; onRemove: () => void
  onToggleMute: () => void; onVolumeChange: (v: number) => void
}) {
  const t = useTheme()
  const [level, setLevel] = useState(0)
  const [triggered, setTriggered] = useState(false)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    function poll() {
      setLevel(getBodyOutputLevel(b.id))
      setTriggered(wasBodyRecentlyTriggered(b.id))
      rafRef.current = requestAnimationFrame(poll)
    }
    rafRef.current = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(rafRef.current)
  }, [b.id])

  const isMuted = b.muted ?? false
  const vol = b.volume ?? 1
  const dB = level > 0.0001 ? 20 * Math.log10(level) : -100
  const meterPct = Math.max(0, Math.min(100, (Math.max(-60, dB) + 60) / 60 * 100))
  const barColor = isMuted ? t.divider
    : level > 0.7 ? '#fbbf24' : level > 0.01 ? '#22c55e' : 'rgba(34,197,94,0.18)'

  return (
    <div style={{ borderRadius: 4, background: selected ? t.activeBg : 'transparent', marginBottom: 1 }}>
      {/* Row 1: icon · mute · name · dot · delete */}
      <div onClick={onSelect} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px 1px', cursor: 'pointer' }}>
        <span style={{ fontSize: 8, color: b.color, flexShrink: 0 }}>{b.type === 'sun' ? '☀' : '●'}</span>
        <button onClick={e => { e.stopPropagation(); onToggleMute() }}
          style={{ border: 'none', borderRadius: 2, cursor: 'pointer', fontSize: 7, fontWeight: 700, lineHeight: 1, padding: '1px 3px', flexShrink: 0,
            background: isMuted ? 'rgba(239,68,68,0.15)' : t.btnBg, color: isMuted ? '#ef4444' : t.textDim }}>M</button>
        <span style={{ fontSize: 10, color: isMuted ? t.textDim : t.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {b.name}
        </span>
        {(b.sampleId || level > 0.001 || triggered) && (
          <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
            background: isMuted ? t.divider : triggered ? '#f59e0b' : level > 0.01 ? `rgba(34,197,94,${Math.min(1, level * 1.5)})` : t.divider,
            boxShadow: triggered && !isMuted ? '0 0 4px rgba(245,158,11,0.7)' : 'none',
            transition: triggered ? 'none' : 'background 120ms, box-shadow 120ms' }} />
        )}
        <button onClick={e => { e.stopPropagation(); onRemove() }}
          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: t.textDim, padding: '0 1px', lineHeight: 1, flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
          onMouseLeave={e => (e.currentTarget.style.color = t.textDim)}>×</button>
      </div>
      {/* Row 2: fader · level bars · dB */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px 3px' }}>
        <input type="range" min={0} max={1} step={0.01} value={vol}
          onPointerDown={e => preventTrackVolumeJump(e, vol)}
          onChange={e => onVolumeChange(parseFloat(e.target.value))}
          onClick={e => e.stopPropagation()}
          className={`planet-fader${isMuted ? ' muted' : ''}`}
          style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 1.5, flexShrink: 0 }}>
          {[0, 1].map(ch => (
            <div key={ch} style={{ width: 3.5, height: 18, background: t.tagBg, borderRadius: 1, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${meterPct}%`, background: barColor, transition: 'height 55ms linear' }} />
            </div>
          ))}
        </div>
        <span style={{ fontSize: 7.5, fontFamily: 'monospace', color: level > 0.001 ? (level > 0.7 ? '#f59e0b' : t.textMid) : t.textDim, width: 18, textAlign: 'right', flexShrink: 0, lineHeight: 1 }}>
          {level > 0.001 ? `${Math.round(dB)}` : '—'}
        </span>
      </div>
    </div>
  )
}

function PlanetMixerSection() {
  const t = useTheme()
  const { bodies, simParams, selectedBodyId, removeBody, clearBodies, updateBody, updateSimParams, setSelectedBodyId, resetToDefaults, restartSim } = usePlanetStore()
  const resetBodyRacksToDefaults = useControlSetStore(s => s.resetBodyRacksToDefaults)
  const samples = useProjectStore(s => s.project.samples)

  function retriggerAll() {
    const csStore = useControlSetStore.getState()
    for (const b of bodies) {
      if (b.muted) continue
      const rack = csStore.getBodyEffectiveRack(b.id)
      if (rack.instrument !== 'instrument-sampler') continue
      const ep = csStore.getBodyEffectiveParams(b.id) as Record<string, unknown>
      const samplerMode = String(ep.samplerMode ?? 'auto')
      let sample = null
      if (samplerMode === 'fixed') {
        const fixedId = String(ep.samplerSampleId ?? '')
        sample = fixedId ? (samples.find(s => s.id === fixedId) ?? null) : null
      } else {
        sample = b.sampleId
          ? (samples.find(s => s.id === b.sampleId) ?? null)
          : (samples.length > 0 ? samples[Math.abs(b.id.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)) % samples.length] ?? null : null)
      }
      if (sample?.objectUrl) {
        const adsr = simParams.adsrMode === 'off' ? ADSR_OFF
          : simParams.adsrMode === 'orbit' ? computeOrbitAdsr(b, bodies, simParams.G) : undefined
        triggerBodySound(sample, { playbackRate: 1, volume: b.volume ?? 0.85, adsr })
      }
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header row */}
        <div style={{
          minHeight: 28, flexShrink: 0, display: 'flex', alignItems: 'center',
          padding: '0 32px 0 12px',
          background: t.headerBg,
          borderBottom: `0.5px solid ${t.divider}`,
        }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: t.textMid, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Mixer
          </span>
        </div>
        {/* Master volume */}
        <MasterVolumeBar />
        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 4 }}>
          {/* Bodies */}
          <MixerSettingsGroup label={`Bodies (${bodies.length})`}>
            {bodies.map(b => (
              <MixerBodyRow key={b.id} b={b}
                selected={b.id === selectedBodyId}
                onSelect={() => setSelectedBodyId(b.id === selectedBodyId ? null : b.id)}
                onRemove={() => removeBody(b.id)}
                onToggleMute={() => updateBody(b.id, { muted: !(b.muted ?? false) })}
                onVolumeChange={v => updateBody(b.id, { volume: v })}
              />
            ))}
            <button onClick={clearBodies} disabled={bodies.length === 0}
              style={{ marginTop: 3, width: '100%', padding: '4px 6px', background: t.sectionBg, border: 'none', borderRadius: 4, cursor: bodies.length === 0 ? 'default' : 'pointer', fontSize: 9.5, color: t.textMid, fontFamily: 'inherit', opacity: bodies.length === 0 ? 0.4 : 1 }}
              onMouseEnter={e => { if (bodies.length > 0) e.currentTarget.style.color = '#ef4444' }}
              onMouseLeave={e => (e.currentTarget.style.color = t.textMid)}
            >✕ Clear all bodies</button>
          </MixerSettingsGroup>

        </div>

        {/* Controls */}
        <div style={{ padding: '6px 8px', borderTop: `0.5px solid ${t.divider}`, display: 'flex', gap: 4, flexShrink: 0 }}>
          <button onClick={() => { retriggerAll(); if (simParams.paused) updateSimParams({ paused: false }) }}
            style={{ flex: 1, padding: '5px 4px', background: 'rgba(139,92,246,0.10)', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 9.5, fontWeight: 600, color: '#7c3aed', fontFamily: 'inherit' }}>
            ↻ Trig</button>
          <button onClick={() => updateSimParams({ paused: !simParams.paused })}
            style={{ flex: 1, padding: '5px 4px', background: t.inputBg, border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 9.5, fontWeight: 600, color: simParams.paused ? t.textMid : t.text, fontFamily: 'inherit' }}>
            {simParams.paused ? '▶ Play' : '⏸ Pause'}</button>
          <button onClick={restartSim}
            style={{ flex: 1, padding: '5px 4px', background: t.inputBg, border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 9.5, color: t.textMid, fontFamily: 'inherit' }}>
            ⟳ Restart</button>
          <button onClick={() => { resetToDefaults(); resetBodyRacksToDefaults() }}
            style={{ flex: 1, padding: '5px 4px', background: t.inputBg, border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 9.5, color: t.textMid, fontFamily: 'inherit' }}>
            ↺ Reset</button>
        </div>
      </div>
  )
}

// ── Next-body placement inspector ─────────────────────────────────────────────

export function NextBodyInspector({ tool }: { tool: 'add-sun' | 'add-planet' }) {
  const t = useTheme()
  const isSun = tool === 'add-sun'
  const {
    nextSunDefaults, nextPlanetDefaults,
    updateNextSunDefaults, updateNextPlanetDefaults,
  } = usePlanetStore()

  const defs   = isSun ? nextSunDefaults   : nextPlanetDefaults
  const update = isSun ? updateNextSunDefaults : updateNextPlanetDefaults

  const accentColor = isSun ? '#f59e0b' : '#60a5fa'

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', borderBottom: `0.5px solid ${t.divider}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, color: accentColor, lineHeight: 1 }}>
            {isSun ? '☀' : '●'}
          </span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>
              {isSun ? 'Next Sun' : 'Next Planet'}
            </div>
            <div style={{ fontSize: 9, color: t.textDim, marginTop: 1 }}>
              配置時のデフォルト設定
            </div>
          </div>
        </div>
      </div>

      {/* Color preview strip */}
      <div style={{ height: 4, background: defs.randomColor ? 'linear-gradient(90deg,#f59e0b,#f472b6,#60a5fa,#34d399)' : defs.color }} />

      {/* Settings */}
      <div style={{ padding: '8px 0' }}>
        <PlanetRow label="Mass">
          <input
            type="number" value={defs.mass} min={0.001} step={isSun ? 100 : 1}
            onChange={e => update({ mass: Math.max(0.001, Number(e.target.value)) })}
            style={{ flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'monospace', border: 'none', borderRadius: 4, padding: '2px 6px', background: t.inputBg, color: t.inputText }}
          />
        </PlanetRow>

        <PlanetRow label="Color">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(defs.color) ? defs.color : '#888888'}
                disabled={defs.randomColor}
                onChange={e => update({ color: e.target.value })}
                style={{ width: 28, height: 20, border: 'none', background: 'none', cursor: defs.randomColor ? 'not-allowed' : 'pointer', padding: 0, borderRadius: 3, opacity: defs.randomColor ? 0.4 : 1 }}
              />
              <input
                type="text" value={defs.color}
                disabled={defs.randomColor}
                onChange={e => update({ color: e.target.value })}
                style={{ flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'monospace', border: 'none', borderRadius: 4, padding: '2px 6px', background: t.inputBg, color: t.inputText, opacity: defs.randomColor ? 0.4 : 1 }}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', paddingLeft: 2 }}>
              <input
                type="checkbox" checked={defs.randomColor}
                onChange={e => update({ randomColor: e.target.checked })}
              />
              <span style={{ fontSize: 10, color: t.textMid }}>Random color each time</span>
            </label>
          </div>
        </PlanetRow>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px' }}>
          <span style={{ fontSize: 10, color: t.textMid, width: 72, flexShrink: 0, textAlign: 'right' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox" checked={defs.randomSample}
              onChange={e => update({ randomSample: e.target.checked })}
            />
            <span style={{ fontSize: 10, color: t.textMid }}>Random sample each time</span>
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px' }}>
          <span style={{ fontSize: 10, color: t.textMid, width: 72, flexShrink: 0, textAlign: 'right' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox" checked={defs.fixed}
              onChange={e => update({ fixed: e.target.checked })}
            />
            <span style={{ fontSize: 10, color: t.textMid }}>Fixed (immovable)</span>
          </label>
        </div>
      </div>

      <div style={{ padding: '8px 12px', borderTop: `0.5px solid ${t.divider}`, fontSize: 9, color: t.textDim, lineHeight: 1.5 }}>
        ドラッグで初速を設定してから離すと配置。
      </div>
    </div>
  )
}

// ── MIDI OUT section ──────────────────────────────────────────────────────────

function MidiOutSection({
  body,
  updateBody,
}: {
  body: import('../../store/planetStore').PlanetBody
  updateBody: (id: string, patch: Partial<import('../../store/planetStore').PlanetBody>) => void
}) {
  const t = useTheme()
  const [outputs, setOutputs] = useState<{ id: string; name: string }[]>([])
  const [selOutId, setSelOutId] = useState<string | null>(null)

  // Refresh output list periodically (MIDI devices can connect/disconnect)
  useEffect(() => {
    function refresh() {
      setOutputs(getMidiOutputs())
      setSelOutId(getSelectedOutputId())
    }
    refresh()
    const id = window.setInterval(refresh, 2000)
    return () => window.clearInterval(id)
  }, [])

  const ch  = body.midiChannel  ?? 1
  const note = body.midiNote    ?? 60
  const vel  = body.midiVelocity ?? 100

  const midiReady = isMidiReady()

  return (
    <div style={{ padding: '6px 12px 6px', borderTop: `0.5px solid ${t.divider}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        <div style={{ fontSize: 8, fontWeight: 700, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          MIDI OUT
        </div>
        {/* Ready indicator */}
        <div style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: midiReady ? '#4ade80' : '#6b7280',
          boxShadow: midiReady ? '0 0 4px #4ade80' : 'none',
        }} />
        {!midiReady && (
          <span style={{ fontSize: 7, color: t.textDim, opacity: 0.7 }}>no MIDI</span>
        )}
      </div>

      {/* Ch / Note / Vel */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5, marginBottom: outputs.length > 0 ? 5 : 0 }}>
        {/* Channel */}
        <div>
          <div style={{ fontSize: 7, color: t.textDim, marginBottom: 2, letterSpacing: '0.04em' }}>CH</div>
          <input
            type="number" value={ch} min={1} max={16} step={1}
            onChange={e => updateBody(body.id, { midiChannel: Math.min(16, Math.max(1, Number(e.target.value))) })}
            style={{ width: '100%', fontSize: 10, fontFamily: 'monospace', border: 'none', borderRadius: 4, padding: '2px 4px', background: t.inputBg, color: t.inputText, textAlign: 'center' }}
          />
        </div>
        {/* Note */}
        <div>
          <div style={{ fontSize: 7, color: t.textDim, marginBottom: 2, letterSpacing: '0.04em' }}>NOTE</div>
          <input
            type="number" value={note} min={0} max={127} step={1}
            onChange={e => updateBody(body.id, { midiNote: Math.min(127, Math.max(0, Number(e.target.value))) })}
            style={{ width: '100%', fontSize: 10, fontFamily: 'monospace', border: 'none', borderRadius: 4, padding: '2px 4px', background: t.inputBg, color: t.inputText, textAlign: 'center' }}
          />
          <div style={{ fontSize: 7, color: t.textDim, marginTop: 1, textAlign: 'center', opacity: 0.65 }}>
            {midiNoteToName(note)}
          </div>
        </div>
        {/* Velocity */}
        <div>
          <div style={{ fontSize: 7, color: t.textDim, marginBottom: 2, letterSpacing: '0.04em' }}>VEL</div>
          <input
            type="number" value={vel} min={1} max={127} step={1}
            onChange={e => updateBody(body.id, { midiVelocity: Math.min(127, Math.max(1, Number(e.target.value))) })}
            style={{ width: '100%', fontSize: 10, fontFamily: 'monospace', border: 'none', borderRadius: 4, padding: '2px 4px', background: t.inputBg, color: t.inputText, textAlign: 'center' }}
          />
        </div>
      </div>

      {/* Output port selector — only shown when outputs are available */}
      {outputs.length > 0 && (
        <div>
          <div style={{ fontSize: 7, color: t.textDim, marginBottom: 2, letterSpacing: '0.04em' }}>PORT</div>
          <select
            value={selOutId ?? ''}
            onChange={e => {
              const id = e.target.value || null
              setSelectedOutputId(id)
              setSelOutId(id)
            }}
            style={{ width: '100%', fontSize: 8.5, border: 'none', borderRadius: 4, padding: '2px 4px', background: t.inputBg, color: t.inputText, fontFamily: 'inherit' }}
          >
            <option value="">All outputs</option>
            {outputs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

// ── Body orbit stats section ──────────────────────────────────────────────────

/** Live orbital statistics for one body, polled at 100 ms. */
function BodyOrbitSection({ bodyId }: { bodyId: string }) {
  const t      = useTheme()
  const simpleTheme = usePlanetStore(s => s.simParams.simpleTheme)
  const monochromeMode = useCanvasSettingsStore(s => s.monochromeMode)
  const simple = simpleTheme || monochromeMode

  // Both liveStats and orbitStats are updated together in one interval.
  // Calling update() immediately on mount avoids stale-display after reload
  // (getPlanetLiveBodySnapshot() starts as [] and is only populated after
  //  the first RAF frame, so calling it in the render phase always gave null).
  const [liveStats,  setLiveStats]  = useState<ReturnType<typeof planetBodyStatsCache.get>>(null)
  const [orbitStats, setOrbitStats] = useState<ReturnType<typeof computeOrbitStats>>(null)

  useEffect(() => {
    const update = () => {
      setLiveStats(planetBodyStatsCache.get(bodyId) ?? null)
      const { bodies: storeBodies, simParams: { G: liveG } } = usePlanetStore.getState()
      const liveBodies = getPlanetLiveBodySnapshot()
      const liveById   = new Map(liveBodies.map(b => [b.id, b]))
      const effective  = storeBodies.map(b => {
        const live = liveById.get(b.id)
        return live ? { ...b, x: live.x, y: live.y, vx: live.vx, vy: live.vy } : b
      })
      const orbitBody = effective.find(b => b.id === bodyId) ?? null
      setOrbitStats(orbitBody ? computeOrbitStats(orbitBody, effective, liveG) : null)
    }
    update() // populate immediately — don't wait 100ms on mount/body-change
    const id = window.setInterval(update, 100)
    return () => window.clearInterval(id)
  }, [bodyId])

  const accentCol = simple ? '#2563eb' : '#7c3aed'
  const freeCol   = simple ? '#dc2626' : '#f87171'
  const meterBg   = simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)'

  return (
    <div style={{ padding: '5px 12px 6px', borderTop: `0.5px solid ${t.divider}` }}>
      {/* Header: ◎ Orbit · bound/free · center name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <span style={{ fontSize: 8, fontWeight: 700, color: accentCol, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          ◎ Orbit
        </span>
        {orbitStats && (
          <span style={{ fontSize: 7, color: orbitStats.bound ? accentCol : freeCol, letterSpacing: '0.05em' }}>
            {orbitStats.bound ? '⟳ bound' : '↗ free'}
          </span>
        )}
        {orbitStats && (
          <span style={{ fontSize: 7, color: t.textDim, opacity: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            ← {orbitStats.centerName}
          </span>
        )}
      </div>

      {/* T / ecc / r / v — 2×2 grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', marginBottom: 5 }}>
        {([
          { key: 'T',   val: orbitStats ? `${orbitStats.T_real.toFixed(1)}s` : '—', hint: 'orbital period'  },
          { key: 'ecc', val: orbitStats ? orbitStats.ecc.toFixed(2)           : '—', hint: 'eccentricity'    },
          { key: 'r',   val: orbitStats ? `${Math.round(orbitStats.r)}`       : '—', hint: 'distance'        },
          { key: 'v',   val: orbitStats ? orbitStats.speed.toFixed(1)         : '—', hint: 'current speed'   },
        ] as const).map(row => (
          <div key={row.key} title={row.hint} style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span style={{ fontSize: 8, color: t.textDim, width: 20, textAlign: 'right', flexShrink: 0 }}>{row.key}</span>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: accentCol, lineHeight: 1 }}>{row.val}</span>
          </div>
        ))}
      </div>

      {/* Live bars: spd · r · acc · ω */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
        {([
          { label: 'spd', norm: liveStats ? Math.min(1, liveStats.speed / 4)                : 0, color: '#60a5fa' },
          { label: 'r',   norm: liveStats ? Math.min(1, liveStats.r / 700)                  : 0, color: '#34d399' },
          { label: 'acc', norm: liveStats ? Math.min(1, liveStats.accel * 80)               : 0, color: '#f87171' },
          { label: 'ω',   norm: liveStats ? Math.min(1, Math.abs(liveStats.omega) / 0.025) : 0, color: '#fbbf24' },
        ] as const).map(({ label, norm, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 8, color: t.textDim, width: 20, textAlign: 'right', flexShrink: 0, lineHeight: 1 }}>{label}</span>
            <div style={{ flex: 1, height: 4, background: meterBg, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${norm * 100}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.06s linear' }} />
            </div>
          </div>
        ))}
      </div>

      {/* Phase angle */}
      {liveStats && (
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 8, color: t.textDim, width: 20, textAlign: 'right', flexShrink: 0 }}>φ</span>
          <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#fbbf24' }}>
            {liveStats.angleDeg.toFixed(1)}°
          </span>
          <span style={{ fontSize: 7, color: t.textDim, opacity: 0.6 }}>
            lfo {(liveStats.lfoPhase * 100).toFixed(0)}%
          </span>
        </div>
      )}
    </div>
  )
}

// ── Planet body inspector ─────────────────────────────────────────────────────

export function PlanetBodyInspector({ hideHeader }: { hideHeader?: boolean } = {}) {
  const t = useTheme()
  const { bodies, simParams, selectedBodyId, updateBody, cameraFollowBodyId, setCameraFollowBodyId, updateSimParams, restartSim } = usePlanetStore()
  const loadedSamples  = useProjectStore(s => s.project.samples)
  const addSampleAsset = useProjectStore(s => s.addSampleAsset)
  const body = selectedBodyId ? bodies.find(b => b.id === selectedBodyId) : null
  const [showPhysics, setShowPhysics] = useState(false)
  const [showInitFields, setShowInitFields] = useState(false)
  const isFollowing = cameraFollowBodyId === body?.id
  // Debounce timer for mass changes → restart sim after 1s of no further changes
  const massRestartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function handleAddSample() {
    return new Promise<void>(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'audio/*'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file || !body) { resolve(); return }
        const sample = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^.]+$/, ''),
          objectUrl: URL.createObjectURL(file),
          fileType: file.type || 'audio/unknown',
        }
        addSampleAsset(sample)
        updateBody(body.id, { sampleId: sample.id })
        resolve()
      }
      input.click()
    })
  }

  if (!body) {
    return (
      <div style={{ fontSize: 11, color: t.textDim, padding: 16, textAlign: 'center' }}>
        Select a body
      </div>
    )
  }

  return (
    <div>
      {/* Header — hidden when a dedicated centroid column is shown */}
      {!hideHeader && (
      <div style={{ padding: '10px 12px 6px', borderBottom: `0.5px solid ${t.divider}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 15, color: body.color, lineHeight: 1 }}>
            {body.type === 'sun' ? '☀' : '●'}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{body.name}</div>
            {body.designation && (
              <div style={{ fontSize: 8.5, color: t.textDim, marginTop: 1, fontStyle: 'italic', opacity: 0.8 }}>
                {body.designation}
              </div>
            )}
            {body.catalogId && (
              <div style={{ fontSize: 7.5, color: t.textDim, marginTop: 1, fontFamily: 'monospace', opacity: 0.55, letterSpacing: '0.04em' }}>
                {body.catalogId}
              </div>
            )}
          </div>
          {/* Standpoint toggle */}
          {(() => {
            const isSP = simParams.standpointBodyId === body.id
            return (
              <button
                onClick={() => updateSimParams({ standpointBodyId: isSP ? null : body.id })}
                title={isSP ? 'Clear standpoint' : 'Set as standpoint listener'}
                style={{
                  fontSize: 10, padding: '3px 7px', border: 'none', borderRadius: 4, cursor: 'pointer',
                  background: isSP ? 'rgba(6,182,212,0.18)' : t.inputBg,
                  color: isSP ? '#0891b2' : t.textMid,
                  fontFamily: 'inherit', fontWeight: 600, flexShrink: 0,
                }}
              >⊕</button>
            )
          })()}
          {/* Camera follow toggle */}
          <button
            onClick={() => setCameraFollowBodyId(isFollowing ? null : body.id)}
            title={isFollowing ? 'Stop following' : 'Follow camera'}
            style={{
              fontSize: 10, padding: '3px 7px', border: 'none', borderRadius: 4, cursor: 'pointer',
              background: isFollowing ? 'rgba(139,92,246,0.18)' : t.inputBg,
              color: isFollowing ? '#7c3aed' : t.textMid,
              fontFamily: 'inherit', fontWeight: 600, flexShrink: 0,
            }}
          >
            {isFollowing ? '📷 On' : '📷'}
          </button>
        </div>
      </div>
      )}

      {/* Fields */}
      <div style={{ padding: '6px 0' }}>
        <PlanetRow label="Name">
          <input
            type="text"
            value={body.name}
            onChange={e => updateBody(body.id, { name: e.target.value })}
            style={{ flex: 1, minWidth: 0, fontSize: 11, border: 'none', borderRadius: 4, padding: '2px 6px', background: t.inputBg, color: t.inputText, fontFamily: 'inherit' }}
          />
        </PlanetRow>
        <PlanetRow label="Type">
          <select
            value={body.type}
            onChange={e => updateBody(body.id, { type: e.target.value as 'sun' | 'planet' })}
            style={{ flex: 1, fontSize: 11, border: 'none', borderRadius: 4, padding: '2px 5px', background: t.inputBg, color: t.inputText, fontFamily: 'inherit' }}
          >
            <option value="sun">☀ Sun</option>
            <option value="planet">● Planet</option>
          </select>
        </PlanetRow>
        <PlanetRow label="Mass">
          <input type="number" value={body.mass} min={0.001} step={1}
            onChange={e => {
              updateBody(body.id, { mass: Number(e.target.value) })
              // Debounce: restart sim 1s after last mass change
              if (massRestartTimer.current) clearTimeout(massRestartTimer.current)
              massRestartTimer.current = setTimeout(() => { restartSim() }, 1000)
            }}
            style={{ flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'monospace', border: 'none', borderRadius: 4, padding: '2px 6px', background: t.inputBg, color: t.inputText }}
          />
        </PlanetRow>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px' }}>
          <span style={{ fontSize: 10, color: t.textMid, width: 72, flexShrink: 0, textAlign: 'right' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={body.fixed}
              onChange={e => updateBody(body.id, { fixed: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Fixed (immovable)</span>
          </label>
        </div>

        {/* ── Sample ── used by orbit trigger in auto mode */}
        <div style={{ padding: '6px 12px 5px', borderTop: `0.5px solid ${t.divider}` }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
            Sample <span style={{ fontSize: 7, fontWeight: 400, opacity: 0.65 }}>— orbit trigger / auto</span>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <select
              value={body.sampleId ?? ''}
              onChange={e => updateBody(body.id, { sampleId: e.target.value || null })}
              style={{
                flex: 1, minWidth: 0, fontSize: 10.5, border: 'none', borderRadius: 4,
                padding: '3px 5px', background: t.inputBg,
                color: body.sampleId ? t.inputText : t.textDim,
                fontFamily: 'inherit',
              }}
            >
              <option value="">— none —</option>
              {loadedSamples.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              onClick={handleAddSample}
              title="Load new audio file and assign"
              style={{
                flexShrink: 0, padding: '3px 7px', fontSize: 9,
                border: 'none', borderRadius: 4, cursor: 'pointer',
                background: t.btnBg, color: t.textMid, fontFamily: 'inherit',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = t.text)}
              onMouseLeave={e => (e.currentTarget.style.color = t.textMid)}
            >＋</button>
          </div>
          {body.sampleId && (
            <div style={{ fontSize: 8, color: t.textDim, marginTop: 3, opacity: 0.7 }}>
              ↑ orbit trigger がこのサンプルを再生
            </div>
          )}
        </div>

        {/* ── MIDI OUT ── trigger sends MIDI note on this channel/note */}
        <MidiOutSection body={body} updateBody={updateBody} />

        {/* Collapsible: Color + Init position/velocity */}
        <button
          onClick={() => setShowInitFields(v => !v)}
          style={{
            width: '100%', padding: '4px 12px', background: 'none', border: 'none',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
            fontFamily: 'inherit', borderTop: `0.5px solid ${t.divider}`,
          }}
        >
          <span style={{ fontSize: 9, fontWeight: 600, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Color / Init
          </span>
          <span style={{ fontSize: 9, color: t.textDim, marginLeft: 'auto' }}>{showInitFields ? '▲' : '▼'}</span>
        </button>
        {showInitFields && (
          <>
            <PlanetRow label="Color">
              <div style={{ display: 'flex', gap: 5, alignItems: 'center', flex: 1 }}>
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : '#888888'}
                  onChange={e => updateBody(body.id, { color: e.target.value })}
                  style={{ width: 28, height: 20, border: 'none', background: 'none', cursor: 'pointer', padding: 0, borderRadius: 3 }}
                />
                <input
                  type="text"
                  value={body.color}
                  onChange={e => updateBody(body.id, { color: e.target.value })}
                  style={{ flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'monospace', border: 'none', borderRadius: 4, padding: '2px 6px', background: t.inputBg, color: t.inputText }}
                />
              </div>
            </PlanetRow>
            <PlanetRow label="Init X">
              <input type="number" value={body.x} step={10}
                onChange={e => updateBody(body.id, { x: Number(e.target.value) })}
                style={{ flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'monospace', border: 'none', borderRadius: 4, padding: '2px 6px', background: t.inputBg, color: t.inputText }}
              />
            </PlanetRow>
            <PlanetRow label="Init Y">
              <input type="number" value={body.y} step={10}
                onChange={e => updateBody(body.id, { y: Number(e.target.value) })}
                style={{ flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'monospace', border: 'none', borderRadius: 4, padding: '2px 6px', background: t.inputBg, color: t.inputText }}
              />
            </PlanetRow>
            <PlanetRow label="Init Vx">
              <input type="number" value={body.vx} step={0.1}
                onChange={e => updateBody(body.id, { vx: Number(e.target.value) })}
                style={{ flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'monospace', border: 'none', borderRadius: 4, padding: '2px 6px', background: t.inputBg, color: t.inputText }}
              />
            </PlanetRow>
            <PlanetRow label="Init Vy">
              <input type="number" value={body.vy} step={0.1}
                onChange={e => updateBody(body.id, { vy: Number(e.target.value) })}
                style={{ flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'monospace', border: 'none', borderRadius: 4, padding: '2px 6px', background: t.inputBg, color: t.inputText }}
              />
            </PlanetRow>
          </>
        )}
      </div>



      {/* Physics equations */}
      <div style={{ borderTop: `0.5px solid ${t.divider}` }}>
        <button
          onClick={() => setShowPhysics(v => !v)}
          style={{
            width: '100%', padding: '6px 12px', textAlign: 'left',
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontFamily: 'inherit',
          }}
        >
          <span style={{ fontSize: 9, fontWeight: 600, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Physics</span>
          <span style={{ fontSize: 9, color: t.textDim }}>{showPhysics ? '▲' : '▼'}</span>
        </button>
        {showPhysics && (
          <div style={{ padding: '4px 12px 10px', fontFamily: 'monospace', fontSize: 9, color: t.textMid, lineHeight: 1.65 }}>
            <div style={{ color: t.textMid, marginBottom: 3 }}>Gravity (softened):</div>
            <div style={{ marginLeft: 8 }}>F = G·m₁·m₂·r̂ / (r²+ε²)<sup>3/2</sup></div>
            <div style={{ color: t.textMid, marginTop: 5, marginBottom: 3 }}>Velocity Verlet integration:</div>
            <div style={{ marginLeft: 8 }}>x += v·dt + ½a·dt²</div>
            <div style={{ marginLeft: 8 }}>v += ½(aₙ + aₙ₊₁)·dt</div>
            <div style={{ color: t.textMid, marginTop: 5, marginBottom: 3 }}>Angular velocity (from CoM):</div>
            <div style={{ marginLeft: 8 }}>ω = v⊥ / r,  T = 2π / |ω|</div>
            <div style={{ marginTop: 6, paddingTop: 5, borderTop: `0.5px solid ${t.divider}`, color: t.textDim }}>
              G={simParams.G} · ε={simParams.epsilon} · dt={simParams.dt}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

// ── Effector section ──────────────────────────────────────────────────────────

const FX_COLOR: Record<string, string> = {
  reverb:     '#f97316',
  delay:      '#a78bfa',
  distortion: '#ef4444',
  chorus:     '#10b981',
  phaser:     '#c084fc',
  autofilter: '#22d3ee',
  bitcrush:   '#fb923c',
  freeze:     '#7dd3fc',
}

function EffectorSection({
  body, updateBody,
}: {
  body: PlanetBody
  updateBody: (id: string, patch: Partial<PlanetBody>) => void
}) {
  const t = useTheme()
  const type      = body.effectorType     ?? 'none'
  const dist      = body.effectorDistance ?? 200
  const maxWet    = body.effectorMaxWet   ?? 0.7
  const isActive  = type !== 'none'
  const accentCol = isActive ? (FX_COLOR[type] ?? '#f97316') : t.textDim

  const inputStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'monospace',
    border: 'none', borderRadius: 4, padding: '2px 6px', background: t.inputBg, color: t.inputText,
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 9, color: t.textDim, width: 58, textAlign: 'right', flexShrink: 0,
  }

  return (
    <div style={{ padding: '8px 12px', borderTop: `0.5px solid ${t.divider}` }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: isActive ? 7 : 0 }}>
        <span style={{
          fontSize: 9, fontWeight: 600, color: accentCol,
          textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1,
        }}>
          Effector
        </span>
        <select
          value={type}
          onChange={e => updateBody(body.id, { effectorType: e.target.value as PlanetBody['effectorType'] })}
          style={{
            fontSize: 10, border: 'none', borderRadius: 4, padding: '2px 5px',
            background: isActive ? `${accentCol}1a` : t.inputBg,
            color: isActive ? accentCol : t.textMid,
            fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer',
          }}
        >
          <option value="none">— None —</option>
          <option value="reverb">Reverb</option>
          <option value="delay">Delay</option>
          <option value="distortion">Distortion</option>
          <option value="chorus">Chorus</option>
          <option value="phaser">Phaser</option>
          <option value="autofilter">Auto-Filter</option>
          <option value="bitcrush">Bit Crush</option>
          <option value="freeze">Freeze</option>
        </select>
      </div>

      {isActive && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {/* Shared: Radius + Max wet */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={labelStyle}>Radius</span>
            <input type="number" value={dist} min={10} step={20}
              onChange={e => updateBody(body.id, { effectorDistance: Math.max(10, Number(e.target.value)) })}
              style={inputStyle} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={labelStyle}>Max wet</span>
            <input type="number" value={maxWet} min={0} max={1} step={0.05}
              onChange={e => updateBody(body.id, { effectorMaxWet: Math.max(0, Math.min(1, Number(e.target.value))) })}
              style={inputStyle} />
          </div>

          {/* Reverb: Decay */}
          {type === 'reverb' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={labelStyle}>Decay</span>
              <input type="number" value={body.effectorDecay ?? 2.5} min={0.1} max={15} step={0.5}
                onChange={e => updateBody(body.id, { effectorDecay: Math.max(0.1, Number(e.target.value)) })}
                style={inputStyle} />
              <span style={{ fontSize: 9, color: t.textDim, flexShrink: 0 }}>s</span>
            </div>
          )}

          {/* Delay: Division + Feedback */}
          {type === 'delay' && (<>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={labelStyle}>Delay</span>
              <select
                value={String(body.effectorDelayDivision ?? 0.25)}
                onChange={e => updateBody(body.id, { effectorDelayDivision: Number(e.target.value) })}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="2">2×</option>
                <option value="1">1×</option>
                <option value="0.5">1/2</option>
                <option value="0.25">1/4</option>
                <option value="0.125">1/8</option>
                <option value="0.0625">1/16</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={labelStyle}>Feedback</span>
              <input type="number" value={body.effectorFeedback ?? 0.4} min={0} max={0.9} step={0.05}
                onChange={e => updateBody(body.id, { effectorFeedback: Math.max(0, Math.min(0.9, Number(e.target.value))) })}
                style={inputStyle} />
            </div>
          </>)}

          {/* Distortion: Amount */}
          {type === 'distortion' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={labelStyle}>Distort</span>
              <input type="number" value={body.effectorDistortion ?? 0.4} min={0} max={1} step={0.05}
                onChange={e => updateBody(body.id, { effectorDistortion: Math.max(0, Math.min(1, Number(e.target.value))) })}
                style={inputStyle} />
            </div>
          )}

          {/* Chorus: Rate + Depth */}
          {type === 'chorus' && (<>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={labelStyle}>Rate</span>
              <input type="number" value={body.effectorChorusFreq ?? 1.5} min={0.1} max={20} step={0.1}
                onChange={e => updateBody(body.id, { effectorChorusFreq: Math.max(0.1, Number(e.target.value)) })}
                style={inputStyle} />
              <span style={{ fontSize: 9, color: t.textDim, flexShrink: 0 }}>Hz</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={labelStyle}>Depth</span>
              <input type="number" value={body.effectorChorusDepth ?? 0.5} min={0} max={1} step={0.05}
                onChange={e => updateBody(body.id, { effectorChorusDepth: Math.max(0, Math.min(1, Number(e.target.value))) })}
                style={inputStyle} />
            </div>
          </>)}

          {/* Phaser: Rate + Octaves */}
          {type === 'phaser' && (<>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={labelStyle}>Rate</span>
              <input type="number" value={body.effectorPhaserRate ?? 0.5} min={0.05} max={5} step={0.05}
                onChange={e => updateBody(body.id, { effectorPhaserRate: Math.max(0.05, Number(e.target.value)) })}
                style={inputStyle} />
              <span style={{ fontSize: 9, color: t.textDim, flexShrink: 0 }}>Hz</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={labelStyle}>Octaves</span>
              <input type="number" value={body.effectorPhaserOctaves ?? 3} min={1} max={6} step={1}
                onChange={e => updateBody(body.id, { effectorPhaserOctaves: Math.max(1, Math.min(6, Number(e.target.value))) })}
                style={inputStyle} />
            </div>
          </>)}

          {/* Auto-Filter: Rate + Depth + Base Freq */}
          {type === 'autofilter' && (<>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={labelStyle}>LFO rate</span>
              <input type="number" value={body.effectorAutoFilterFreq ?? 1.0} min={0.05} max={8} step={0.05}
                onChange={e => updateBody(body.id, { effectorAutoFilterFreq: Math.max(0.05, Number(e.target.value)) })}
                style={inputStyle} />
              <span style={{ fontSize: 9, color: t.textDim, flexShrink: 0 }}>Hz</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={labelStyle}>Depth</span>
              <input type="number" value={body.effectorAutoFilterDepth ?? 1.0} min={0} max={1} step={0.05}
                onChange={e => updateBody(body.id, { effectorAutoFilterDepth: Math.max(0, Math.min(1, Number(e.target.value))) })}
                style={inputStyle} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={labelStyle}>Base</span>
              <input type="number" value={body.effectorAutoFilterBaseFreq ?? 200} min={80} max={2000} step={20}
                onChange={e => updateBody(body.id, { effectorAutoFilterBaseFreq: Math.max(80, Number(e.target.value)) })}
                style={inputStyle} />
              <span style={{ fontSize: 9, color: t.textDim, flexShrink: 0 }}>Hz</span>
            </div>
          </>)}

          {/* Bit Crush: Bits */}
          {type === 'bitcrush' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={labelStyle}>Bits</span>
              <input type="number" value={body.effectorBitDepth ?? 8} min={2} max={16} step={1}
                onChange={e => updateBody(body.id, { effectorBitDepth: Math.max(2, Math.min(16, Number(e.target.value))) })}
                style={inputStyle} />
            </div>
          )}

          {/* Freeze: Decay */}
          {type === 'freeze' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={labelStyle}>Decay</span>
              <input type="number" value={body.effectorFreezeDecay ?? 30} min={10} max={60} step={5}
                onChange={e => updateBody(body.id, { effectorFreezeDecay: Math.max(10, Number(e.target.value)) })}
                style={inputStyle} />
              <span style={{ fontSize: 9, color: t.textDim, flexShrink: 0 }}>s</span>
            </div>
          )}

          <div style={{ fontSize: 8.5, color: t.textDim, lineHeight: 1.4, marginTop: 1 }}>
            範囲内の天体の音にエフェクトをかける。近いほど wet が上がる。
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function PlanetRow({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px' }}>
      <span style={{ fontSize: 10, color: t.textMid, width: 72, flexShrink: 0, textAlign: 'right' }}>{label}</span>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function NodeInspector({ nodeId, nodeType, params }: {
  nodeId: string; nodeType: string; params: Record<string, JSONValue>
}) {
  const def        = nodeRegistry[nodeType]
  const updateNode = useProjectStore(s => s.updateNodeParams)
  const addSampleAsset = useProjectStore(s => s.addSampleAsset)
  const samples    = useProjectStore(s => s.project.samples)
  const isRunning  = useAudioStore(s => s.isRunning)
  const lastSelectedGeometryId = useSelectionStore(s => s.lastSelectedGeometryId)

  function update(key: string, value: JSONValue) {
    updateNode(nodeId, { [key]: value })
    if (isRunning) {
      setTimeout(() => {
        if ((nodeType === 'audio.sampler' || nodeType === 'sampler~') && key === 'sampleId') resumeEngine(useProjectStore.getState().project)
        else applyControlValues(useProjectStore.getState().project)
      }, 10)
    }
  }

  async function handleAddSamplerSample() {
    return new Promise<void>(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'audio/*'
      input.multiple = false
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) {
          resolve()
          return
        }
        const sample = {
          id: crypto.randomUUID(),
          name: file.name,
          objectUrl: URL.createObjectURL(file),
          fileType: file.type,
        }
        addSampleAsset(sample)
        update('sampleId', sample.id)
        resolve()
      }
      input.click()
    })
  }

  if (!def) return null

  const t = useTheme()

  return (
    <div>
      <div style={{ padding: '10px 12px 6px', borderBottom: `0.5px solid ${t.divider}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{def.label}</div>
        <div style={{ fontSize: 9, color: t.textDim, marginTop: 2 }}>{nodeType}</div>
      </div>

      <div style={{ padding: '6px 0' }}>
        {isReferenceNode(nodeType) && (
          <ReferenceBinding
            nodeType={nodeType}
            value={typeof params.geometryId === 'string' ? params.geometryId : ''}
            lastSelectedGeometryId={lastSelectedGeometryId}
            onChange={value => update('geometryId', value)}
          />
        )}
        {(nodeType === 'audio.sampler' || nodeType === 'sampler~') && (
          <SamplerSampleBinding
            value={typeof params.sampleId === 'string' ? params.sampleId : ''}
            samples={samples}
            onChange={value => update('sampleId', value)}
            onAddSample={handleAddSamplerSample}
          />
        )}
        {Object.entries(params).sort().map(([key, value]) => (
          key === 'geometryId' || key === 'sampleId' ? null :
          <ParamRow key={key} paramKey={key} value={value} onChange={v => update(key, v)} />
        ))}
      </div>

      {(def.inputs.length > 0 || def.outputs.length > 0) && (
        <div style={{ borderTop: `0.5px solid ${t.divider}`, padding: '6px 0' }}>
          {def.inputs.length > 0 && (
            <>
              <div style={{ fontSize: 9, fontWeight: 600, color: t.textDim, padding: '4px 12px 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Inputs</div>
              {def.inputs.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 12px' }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: signalColor[p.signalType] }} />
                  <span style={{ fontSize: 10, color: t.textMid }}>{p.id}</span>
                  <span style={{ fontSize: 9, color: t.textDim, marginLeft: 'auto' }}>{p.signalType}</span>
                </div>
              ))}
            </>
          )}
          {def.outputs.length > 0 && (
            <>
              <div style={{ fontSize: 9, fontWeight: 600, color: t.textDim, padding: '6px 12px 2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Outputs</div>
              {def.outputs.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 12px' }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: signalColor[p.signalType] }} />
                  <span style={{ fontSize: 10, color: t.textMid }}>{p.id}</span>
                  <span style={{ fontSize: 9, color: t.textDim, marginLeft: 'auto' }}>{p.signalType}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SamplerSampleBinding({ value, samples, onChange, onAddSample }: {
  value: string
  samples: Array<{ id: string; name: string }>
  onChange: (value: string) => void
  onAddSample: () => void
}) {
  const t = useTheme()
  return (
    <div style={{ padding: '3px 12px 8px', borderBottom: `0.5px solid ${t.divider}`, marginBottom: 4 }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: t.textDim, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Sample
      </div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', fontSize: 11, border: 'none', borderRadius: 4,
          padding: '3px 5px', background: t.inputBg, color: t.inputText, fontFamily: 'inherit',
        }}
      >
        <option value="">No sample</option>
        {samples.map(sample => (
          <option key={sample.id} value={sample.id}>{sample.name}</option>
        ))}
      </select>
      <button
        onClick={onAddSample}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          width: '100%', marginTop: 6, padding: '5px 6px',
          fontSize: 10, color: t.textMid,
          background: t.inputBg, border: 'none', borderRadius: 4,
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <Upload size={10} />
        <span>Add and assign sample</span>
      </button>
    </div>
  )
}

function isReferenceNode(nodeType: string): boolean {
  return nodeType === 'geometry.referenceCircle'
    || nodeType === 'geometry.referencePoint'
    || nodeType === 'geometry.referenceCurve'
}

function referenceGeometryType(nodeType: string): GeometryType | null {
  if (nodeType === 'geometry.referenceCircle') return 'circle'
  if (nodeType === 'geometry.referencePoint') return 'point'
  if (nodeType === 'geometry.referenceCurve') return null
  return null
}

function ReferenceBinding({ nodeType, value, lastSelectedGeometryId, onChange }: {
  nodeType: string
  value: string
  lastSelectedGeometryId: string | null
  onChange: (value: string) => void
}) {
  const project = useProjectStore(s => s.project)
  const geometryType = referenceGeometryType(nodeType)
  const options = project.geometry.filter(g =>
    g.role !== 'derived'
    && !g.sourceNodeId
    && (nodeType === 'geometry.referenceCurve'
      ? (g.type === 'path' || g.type === 'circle' || g.type === 'way')
      : g.type === geometryType)
  )
  const lastSelected = options.find(g => g.id === lastSelectedGeometryId)

  const t = useTheme()

  return (
    <div style={{ padding: '3px 12px 8px', borderBottom: `0.5px solid ${t.divider}`, marginBottom: 4 }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: t.textDim, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Referenced geometry
      </div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', fontSize: 11, border: 'none', borderRadius: 4,
          padding: '3px 5px', background: t.inputBg, color: t.inputText, fontFamily: 'inherit',
        }}
      >
        <option value="">Auto: first matching object</option>
        {options.map(g => (
          <option key={g.id} value={g.id}>
            {nodeType === 'geometry.referenceCurve' ? `curve:${g.type}` : g.type} · {g.id}
          </option>
        ))}
      </select>
      <button
        disabled={!lastSelected}
        onClick={() => lastSelected && onChange(lastSelected.id)}
        style={{
          width: '100%', marginTop: 6, padding: '4px 6px',
          fontSize: 10, color: lastSelected ? t.textMid : t.textDim,
          background: t.inputBg, border: 'none', borderRadius: 4,
          cursor: lastSelected ? 'pointer' : 'default', fontFamily: 'inherit',
        }}
      >
        Store last selected {nodeType === 'geometry.referenceCurve' ? 'curve' : geometryType ?? 'geometry'}
      </button>
    </div>
  )
}

function GeomInspector({ geomId, geomType, sampleId, params, mode }: {
  geomId: string; geomType: string; sampleId: string | null; params: Record<string, JSONValue>; mode?: 'sampler' | 'patcher'
}) {
  const updateGeom = useProjectStore(s => s.updateGeometryObject)
  const updateGeometrySample = useProjectStore(s => s.updateGeometrySample)
  const addSampleAsset = useProjectStore(s => s.addSampleAsset)
  const samples = useProjectStore(s => s.project.samples)
  const [playback, setPlayback] = useState<{ currentTime: number; volume: number; playbackRate: number } | null>(null)

  useEffect(() => {
    if (!sampleId) {
      setPlayback(null)
      return
    }

    const update = () => setPlayback(getPlayerState(sampleId))
    update()
    const id = window.setInterval(update, 200)
    return () => window.clearInterval(id)
  }, [sampleId])

  async function handleAddSample() {
    return new Promise<void>(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'audio/*'
      input.multiple = false
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) {
          resolve()
          return
        }
        const sample = {
          id: crypto.randomUUID(),
          name: file.name,
          objectUrl: URL.createObjectURL(file),
          fileType: file.type,
        }
        addSampleAsset(sample)
        updateGeometrySample(geomId, sample.id)
        resolve()
      }
      input.click()
    })
  }

  const t = useTheme()
  const dynInputStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'inherit',
    border: 'none', borderRadius: 4, padding: '2px 6px',
    background: t.inputBg, color: t.inputText,
  }

  return (
    <div>
      <div style={{ padding: '10px 12px 6px', borderBottom: `0.5px solid ${t.divider}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{geomType.charAt(0).toUpperCase() + geomType.slice(1)}</div>
        <div style={{ fontSize: 9, color: t.textDim, marginTop: 2 }}>{geomId}</div>
      </div>
      <div style={{ padding: '8px 12px', borderBottom: `0.5px solid ${t.divider}` }}>
        <div style={{ fontSize: 9, fontWeight: 600, color: t.textDim, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Sample
        </div>
        <select
          value={sampleId ?? ''}
          onChange={e => updateGeometrySample(geomId, e.target.value || null)}
          style={{
            width: '100%', fontSize: 11, border: 'none', borderRadius: 4,
            padding: '3px 5px', background: t.inputBg, color: t.inputText, fontFamily: 'inherit',
          }}
        >
          <option value="">No sample</option>
          {samples.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button
          onClick={handleAddSample}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            width: '100%', marginTop: 6, padding: '5px 6px',
            fontSize: 10, color: t.textMid,
            background: t.inputBg, border: 'none', borderRadius: 4,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <Upload size={10} />
          <span>Add and assign sample</span>
        </button>
        {sampleId && (
          <div style={{
            marginTop: 8, padding: '6px 7px', borderRadius: 5,
            background: t.sectionBg,
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
          }}>
            <div>
              <div style={{ fontSize: 8, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Time</div>
              <div style={{ fontSize: 11, color: t.textMid, fontFamily: 'monospace' }}>
                {playback ? `${playback.currentTime.toFixed(2)}s` : 'stopped'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Volume</div>
              <div style={{ fontSize: 11, color: t.textMid, fontFamily: 'monospace' }}>
                {playback ? playback.volume.toFixed(2) : '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Speed</div>
              <div style={{ fontSize: 11, color: t.textMid, fontFamily: 'monospace' }}>
                {playback ? `${playback.playbackRate.toFixed(2)}x` : '—'}
              </div>
            </div>
          </div>
        )}
      </div>
      {mode === 'sampler' && geomType !== 'point' && (
        <div style={{ padding: '8px 12px', borderBottom: `0.5px solid ${t.divider}` }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: t.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Point on Curve
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={params.pointOnCurveEnabled !== false}
              onChange={e => updateGeom(geomId, { pointOnCurveEnabled: e.target.checked })}
            />
            <span style={{ fontSize: 10, color: t.textMid }}>Enable moving point</span>
          </label>
          <InspectorControlRow label="Speed">
            <input
              type="number"
              min={0}
              step={10}
              value={typeof params.speed === 'number' ? params.speed : 120}
              onChange={e => updateGeom(geomId, { speed: Math.max(0, Number(e.target.value)) })}
              style={dynInputStyle}
            />
          </InspectorControlRow>
          <InspectorControlRow label="Motion">
            <select
              value={typeof params.samplerMotionMode === 'string' ? params.samplerMotionMode : 'auto'}
              onChange={e => updateGeom(geomId, { samplerMotionMode: e.target.value })}
              style={dynInputStyle}
            >
              <option value="auto">Auto</option>
              <option value="loop">Loop</option>
              <option value="bounce">Bounce</option>
            </select>
          </InspectorControlRow>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={params.samplerReverse === true}
              onChange={e => updateGeom(geomId, { samplerReverse: e.target.checked })}
            />
            <span style={{ fontSize: 10, color: t.textMid }}>Reverse direction</span>
          </label>
        </div>
      )}
      {/* Division marks toggle — path only, sampler mode */}
      {geomType === 'path' && mode === 'sampler' && (
        <div style={{ padding: '8px 12px', borderBottom: `0.5px solid ${t.divider}` }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: t.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Divisions
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={typeof params.divisionCount === 'number' && (params.divisionCount as number) >= 2}
              onChange={e => updateGeom(geomId, { divisionCount: e.target.checked ? 4 : 0 })}
            />
            <span style={{ fontSize: 10, color: t.textMid }}>Show division marks</span>
          </label>
          {typeof params.divisionCount === 'number' && (params.divisionCount as number) >= 2 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: t.textMid, width: 44, flexShrink: 0, textAlign: 'right' }}>Count</span>
              <input
                type="number"
                min={2}
                max={64}
                value={params.divisionCount as number}
                onChange={e => updateGeom(geomId, { divisionCount: Math.max(2, Math.min(64, Number(e.target.value))) })}
                style={{
                  flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'monospace',
                  border: 'none', borderRadius: 4, padding: '2px 6px',
                  background: t.inputBg, color: t.inputText,
                }}
              />
            </label>
          )}
        </div>
      )}

      <div style={{ padding: '6px 0' }}>
        {Object.entries(params).sort().map(([key, value]) => (
          hiddenGeometryParam(key) ? null :
          typeof value === 'number' && (
            <ParamRow key={key} paramKey={key} value={value} onChange={v => updateGeom(geomId, { [key]: v })} />
          )
        ))}
      </div>
    </div>
  )
}

function hiddenGeometryParam(key: string): boolean {
  return key === 'divisionCount'
    || key === 'speed'
    || key === 'pointOnCurveEnabled'
    || key === 'samplerMotionMode'
    || key === 'samplerReverse'
    || key === 'samplerRole'
}

function InspectorControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useTheme()
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <span style={{ fontSize: 10, color: t.textMid, width: 44, flexShrink: 0, textAlign: 'right' }}>{label}</span>
      {children}
    </label>
  )
}

function ParamRow({ paramKey, value, onChange }: {
  paramKey: string; value: JSONValue; onChange: (v: JSONValue) => void
}) {
  const t = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px' }}>
      <span style={{ fontSize: 10, color: t.textMid, width: 72, flexShrink: 0, textAlign: 'right' }}>
        {paramKey}
      </span>
      {typeof value === 'number' ? (
        <input
          type="number" value={value}
          onChange={e => onChange(Number(e.target.value))}
          step={paramKey === 'frequency' ? 1 : paramKey === 'r' || paramKey === 'cx' || paramKey === 'cy' ? 1 : 0.01}
          style={{
            flex: 1, fontSize: 11, fontFamily: 'monospace',
            border: 'none', borderRadius: 4, padding: '2px 6px',
            background: t.inputBg, color: t.inputText, minWidth: 0,
          }}
        />
      ) : typeof value === 'string' && paramKey === 'waveform' ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            flex: 1, fontSize: 11, border: 'none', borderRadius: 4,
            padding: '2px 4px', background: t.inputBg, color: t.inputText, fontFamily: 'inherit',
          }}
        >
          {['sine','square','sawtooth','triangle'].map(w => <option key={w}>{w}</option>)}
        </select>
      ) : typeof value === 'string' ? (
        <input
          type="text" value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            flex: 1, fontSize: 11, border: 'none', borderRadius: 4,
            padding: '2px 6px', background: t.inputBg, color: t.inputText, minWidth: 0,
            fontFamily: 'inherit',
          }}
        />
      ) : (
        <span style={{ fontSize: 10, color: t.textDim }}>—</span>
      )}
    </div>
  )
}
