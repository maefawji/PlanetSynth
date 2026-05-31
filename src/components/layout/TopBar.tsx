import { RotateCcw, Save, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import * as Tone from 'tone'
import { getAudioLatencyHint, setAudioLatencyHint, LATENCY_OPTIONS, type AudioLatencyHint } from '../../audio/audioLatencySettings'
import { useProjectStore } from '../../store/projectStore'
import { useAudioStore } from '../../store/audioStore'
import { useTheme } from '../../lib/theme'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import { forgetSamplePlayers, prepareIntersectionSamples, stopIntersectionSamples, triggerBodySound } from '../../audio/intersectionSynth'
import { saveProjectJson, loadProjectFromFile, restoreProjectSamples } from '../../persistence/projectSchema'
import { hydrateSamplesFromFolder, loadDefaultFolderSamples } from '../../persistence/sampleLibrary'
import { usePlanetStore } from '../../store/planetStore'
import { useControlSetStore } from '../../store/controlSetStore'
import { ADSR_OFF, computeOrbitAdsr } from '../../audio/orbitAdsr'
import type { SampleAsset } from '../../patch/types'

function stableIndexFromId(id: string, length: number): number {
  if (length <= 0) return 0
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % length
}

function resolveBodySamplerSample(bodyId: string, explicitSampleId: string | null | undefined, samples: SampleAsset[]): SampleAsset | null {
  const rack = useControlSetStore.getState().getBodyEffectiveRack(bodyId)
  // Rack must have instrument-sampler — never fall back to raw body.sampleId otherwise
  if (rack.instrument !== 'instrument-sampler') return null
  const ep = useControlSetStore.getState().getBodyEffectiveParams(bodyId)
  const samplerMode = String((ep as Record<string, unknown>).samplerMode ?? 'auto')
  if (samplerMode === 'fixed') {
    const fixedId = String((ep as Record<string, unknown>).samplerSampleId ?? '')
    return fixedId ? (samples.find(s => s.id === fixedId) ?? null) : null
  }
  // auto: explicit body sampleId first, then stable hash
  if (explicitSampleId) return samples.find(s => s.id === explicitSampleId) ?? null
  if (samples.length === 0) return null
  return samples[stableIndexFromId(bodyId, samples.length)] ?? null
}

type AppMode = 'planet' | 'chord-lab' | 'osc' | 'dev'

interface TopBarProps {
  appMode?: AppMode
  onSetAppMode?: (mode: AppMode) => void
}

export function TopBar({ appMode = 'planet', onSetAppMode }: TopBarProps) {
  const t         = useTheme()
  const project   = useProjectStore(s => s.project)
  const isDirty   = useProjectStore(s => s.isDirty)
  const loadProj  = useProjectStore(s => s.loadProject)
  const markClean = useProjectStore(s => s.markClean)
  const isRunning = useAudioStore(s => s.isRunning)
  const setRunning = useAudioStore(s => s.setRunning)
  const setStatus  = useAudioStore(s => s.setStatus)
  const simParams          = usePlanetStore(s => s.simParams)
  const standpointMaxDist  = simParams.standpointMaxDist
  const updateSimParams    = usePlanetStore(s => s.updateSimParams)
  const showModeBar        = useCanvasSettingsStore(s => s.showModeBar)

  // ── Audio buffer setting ────────────────────────────────────────────────────
  const [latencyHint, setLatencyHintState] = useState<AudioLatencyHint>(getAudioLatencyHint)
  const [pendingReload, setPendingReload]  = useState(false)

  function handleLatencyChange(hint: AudioLatencyHint) {
    setAudioLatencyHint(hint)
    setLatencyHintState(hint)
    setPendingReload(true)
  }

  async function retrigger() {
    try {
      // 1. Start / resume audio context (required by browsers)
      await Tone.start()
      // Restore master volume in case STOP had silenced it
      Tone.getDestination().volume.value = 0

      // 2. Restore / prepare samples
      const folderSamples = await loadDefaultFolderSamples()
      const folderHydratedSamples = folderSamples.length
        ? hydrateSamplesFromFolder(project.samples, folderSamples)
        : project.samples
      const restoredSamples = await restoreProjectSamples(folderHydratedSamples)
      const changedSampleIds = restoredSamples
        .filter((sample, index) => sample.objectUrl !== project.samples[index]?.objectUrl)
        .map(sample => sample.id)
      if (changedSampleIds.length > 0) {
        const setSampleObjectUrl = useProjectStore.getState().setSampleObjectUrl
        for (const sample of restoredSamples) {
          if (sample.objectUrl) setSampleObjectUrl(sample.id, sample.objectUrl)
        }
        forgetSamplePlayers(changedSampleIds)
      }
      await prepareIntersectionSamples(restoredSamples)

      // 3. Retrigger all non-muted planet bodies that have an explicit sample,
      // or have the Sampler instrument assigned and can pull from the sample folder.
      const { bodies, simParams } = usePlanetStore.getState()
      for (const b of bodies) {
        if (b.muted) continue
        const sample = resolveBodySamplerSample(b.id, b.sampleId, restoredSamples)
        if (sample?.objectUrl) {
          const adsr = simParams.adsrMode === 'off'
            ? ADSR_OFF
            : simParams.adsrMode === 'orbit'
              ? computeOrbitAdsr(b, bodies, simParams.G)
              : undefined
          triggerBodySound(sample, { playbackRate: 1, volume: b.volume ?? 0.85, adsr })
        }
      }

      setRunning(true)
      setStatus('running')
    } catch (e) {
      setStatus('error', String(e))
    }
  }

  function stopAll() {
    // 1. Instantly zero the master gain — synchronous, 100% reliable regardless of context state
    try { Tone.getDestination().volume.value = -Infinity } catch (_) {}
    // 2. Stop transport (Chord Lab sequencer etc.)
    try { Tone.Transport.stop(); Tone.Transport.cancel() } catch (_) {}
    // 3. Stop intersection synth players
    stopIntersectionSamples()
    // 4. Best-effort context suspend (fire-and-forget — don't await)
    Tone.getContext().rawContext.suspend().catch(() => {})
    setRunning(false)
    setStatus('stopped')
  }

  function save() {
    saveProjectJson(project)
    markClean()
  }

  async function load() {
    try {
      const p = await loadProjectFromFile()
      const restoredSamples = await restoreProjectSamples(p.samples)
      loadProj({ ...p, samples: restoredSamples })
      const setSampleObjectUrl = useProjectStore.getState().setSampleObjectUrl
      for (const s of restoredSamples) {
        if (s.objectUrl) setSampleObjectUrl(s.id, s.objectUrl)
      }
    } catch (e) {
      console.error('Load failed', e)
    }
  }

  return (
    <div style={{
      height: 36, display: 'flex', alignItems: 'center', gap: 10,
      padding: '0 12px',
      background: t.panelBg,
      borderBottom: `0.5px solid ${t.panelBorder}`,
      flexShrink: 0,
    }}>
      {/* Pause / Resume — same as mixer PAUSE */}
      <button
        onClick={() => updateSimParams({ paused: !simParams.paused })}
        title={simParams.paused ? 'Resume simulation' : 'Pause simulation'}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 10px', borderRadius: 5, fontFamily: 'inherit',
          fontSize: 11, fontWeight: 700, cursor: 'pointer',
          background: simParams.paused ? 'rgba(251,191,36,0.15)' : t.inputBg,
          border: simParams.paused ? '0.5px solid rgba(251,191,36,0.45)' : `0.5px solid ${t.btnBorder}`,
          color: simParams.paused ? '#fbbf24' : t.textMid,
        }}
      >
        <span>{simParams.paused ? '▶ Play' : '⏸ Pause'}</span>
      </button>

      <div style={{ width: 1, height: 16, background: t.divider }} />

      {/* Retrigger */}
      <button
        onClick={retrigger}
        style={btnStyle(false, false, t)}
        title="Start audio + retrigger all planet sounds"
      >
        <RotateCcw size={11} strokeWidth={2.5} />
        <span>Retrigger</span>
      </button>

      <div style={{ width: 1, height: 16, background: t.divider }} />

      {/* Save / Load */}
      <button onClick={save} style={btnStyle(false, false, t)}>
        <Save size={11} strokeWidth={2} />
        <span>Save</span>
      </button>
      <button onClick={load} style={btnStyle(false, false, t)}>
        <FolderOpen size={11} strokeWidth={2} />
        <span>Load</span>
      </button>

      <div style={{ width: 1, height: 16, background: t.divider }} />

      {/* Standpoint distance */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 10, color: t.textMid, whiteSpace: 'nowrap' }}>Distance</span>
        <input
          type="number"
          value={standpointMaxDist}
          min={50}
          step={50}
          onChange={e => updateSimParams({ standpointMaxDist: Math.max(50, Number(e.target.value)) })}
          style={{
            width: 64, fontSize: 11, fontFamily: 'monospace', fontWeight: 600,
            padding: '2px 6px', borderRadius: 4,
            border: `0.5px solid ${t.btnBorder}`,
            background: t.inputBg, color: t.inputText,
            outline: 'none',
          }}
        />
      </div>

      <div style={{ width: 1, height: 16, background: t.divider }} />

      {/* Audio buffer setting */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 9, color: t.textMid, whiteSpace: 'nowrap', letterSpacing: '0.04em' }}>Buffer</span>
        <div style={{ display: 'flex', gap: 2 }}>
          {LATENCY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              title={opt.desc}
              onClick={() => handleLatencyChange(opt.value)}
              style={{
                fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                fontFamily: 'inherit', cursor: 'pointer',
                border: latencyHint === opt.value
                  ? '0.5px solid rgba(6,182,212,0.6)'
                  : `0.5px solid ${t.btnBorder}`,
                background: latencyHint === opt.value ? 'rgba(6,182,212,0.15)' : t.inputBg,
                color: latencyHint === opt.value ? '#06b6d4' : t.textMid,
              }}
            >{opt.label}</button>
          ))}
        </div>
        {pendingReload && (
          <button
            onClick={() => window.location.reload()}
            title="リロードして設定を反映"
            style={{
              fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
              fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
              border: '0.5px solid rgba(251,191,36,0.6)',
              background: 'rgba(251,191,36,0.15)',
              color: '#fbbf24',
            }}
          >↺ Reload</button>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Mode switcher — hidden by default, shown when showModeBar is on */}
      {onSetAppMode && showModeBar && (
        <div style={{ display: 'flex', gap: 2, background: t.sectionBg, borderRadius: 6, padding: 2, border: `0.5px solid ${t.panelBorder}` }}>
          {([
            ['planet',    '⬤ Planet'],
            ['chord-lab', '⬡ Chord Lab'],
            ['osc',       '∿ Osc'],
            ['dev',       '⬡ Dev'],
          ] as [AppMode, string][]).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => onSetAppMode(mode)}
              style={{
                fontSize: 10, fontWeight: 600, padding: '2px 9px', borderRadius: 4,
                border: 'none', fontFamily: 'inherit', cursor: 'pointer',
                background: appMode === mode ? 'rgba(139,92,246,0.22)' : 'transparent',
                color: appMode === mode ? '#a78bfa' : t.textMid,
              }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Dirty indicator */}
      {isDirty && <span style={{ color: '#f59e0b', fontSize: 14, lineHeight: 1 }}>●</span>}

    </div>
  )
}

function btnStyle(active: boolean, disabled: boolean, t: ReturnType<typeof useTheme>): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '3px 8px', borderRadius: 5, border: `0.5px solid ${t.btnBorder}`,
    background: active ? 'rgba(37,99,235,0.15)' : t.btnBg,
    fontSize: 11, fontWeight: 500, cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1, color: t.text,
    fontFamily: 'inherit',
  }
}
