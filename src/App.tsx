import { useEffect, useState, useRef, useCallback } from 'react'
import { TopBar } from './components/layout/TopBar'
import { LeftLibraryPanel } from './components/layout/LeftLibraryPanel'
import { RightInspector } from './components/layout/RightInspector'
import { PlanetCanvas } from './components/planet/PlanetCanvas'
import { PlanetRack } from './components/planet/PlanetRack'
import { WholeInstrumentPanel } from './components/planet/WholeInstrumentPanel'
import { OrbitHubPanel } from './components/planet/OrbitHubPanel'
import { DroneLayer } from './components/planet/DroneLayer'
import { GranularLayer } from './components/planet/GranularLayer'
import { FMDroneLayer } from './components/planet/FMDroneLayer'
import { NoisePadLayer } from './components/planet/NoisePadLayer'
import { SamplerLayer } from './components/planet/SamplerLayer'
import { OneShotLayer } from './components/planet/OneShotLayer'
import { StretchSamplerLayer } from './components/planet/StretchSamplerLayer'
import { LongSamplerLayer } from './components/planet/LongSamplerLayer'
import { OscSynthLayer } from './components/planet/OscSynthLayer'
import { WaveLabInstrumentLayer } from './components/planet/WaveLabInstrumentLayer'
import { WholeInstrumentLayer } from './components/planet/WholeInstrumentLayer'
import { SamplerInstrumentPanel } from './components/sampler/SamplerInstrumentPanel'
import { OneShotSamplerPanel } from './components/sampler/OneShotSamplerPanel'
import { DevRouteView } from './components/dev/DevRouteView'
import { OscView } from './components/osc/OscView'
import { WaveLabView } from './components/wave/WaveLabView'
import { WholeInstrumentDevView } from './components/whole/WholeInstrumentDevView'
import { OrbitHubView } from './components/orbit/OrbitHubView'
import { TransformLabView } from './components/transform/TransformLabView'
import { SampleModeView } from './components/sample/SampleModeView'
import { SigilView } from './components/sigil/SigilView'
import { PatchEditor } from './components/patch/PatchEditor'
import type { PlanetTool } from './components/planet/PlanetCanvas'
import { MobileHud } from './components/layout/MobileHud'
import { UniversalConductorSync } from './components/conductor/UniversalConductorSync'
import { UniversalContextBar } from './components/conductor/UniversalContextBar'
import { usePlanetStore } from './store/planetStore'
import { useCanvasSettingsStore } from './store/canvasSettingsStore'
import { useWholeInstrumentStore } from './store/wholeInstrumentStore'
import { useOrbitHubStore } from './store/orbitHubStore'
import { loadBuiltinSamples } from './lib/loadBuiltinSamples'
import { initMidi } from './audio/midiManager'
import { unlockMobileAudio } from './audio/mobileAudioUnlock'

// Detect iPhone / touch-primary device at startup (stable — never changes)
const IS_MOBILE = (() => {
  if (typeof navigator === 'undefined') return false
  // Explicit override via URL: ?mobile or ?desktop
  const sp = new URLSearchParams(window.location.search)
  if (sp.has('mobile'))  return true
  if (sp.has('desktop')) return false
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth <= 820)
})()
import { initToneContext } from './audio/audioLatencySettings'

// Apply saved audio latency setting before any Tone.start() call
initToneContext()

type AppMode = 'planet' | 'osc' | 'dev' | 'wave-lab' | 'whole-lab' | 'orbit-hub' | 'transform-lab' | 'sample' | 'sigil' | 'patch'

const RACK_MIN = 120
const RACK_MAX = 340
const RACK_DEFAULT = 220

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('planet')
  const [planetTool, setPlanetTool] = useState<PlanetTool>('add-planet')
  const simpleTheme        = usePlanetStore(s => s.simParams.simpleTheme)
  const setSelectedBodyId  = usePlanetStore(s => s.setSelectedBodyId)
  const selectedBodyId     = usePlanetStore(s => s.selectedBodyId)
  const probeMass    = usePlanetStore(s => s.simParams.probeMass)
  const updateSimParams = usePlanetStore(s => s.updateSimParams)
  const nextPlanetDefaults = usePlanetStore(s => s.nextPlanetDefaults)
  const nextSunDefaults    = usePlanetStore(s => s.nextSunDefaults)
  const updateNextPlanetDefaults = usePlanetStore(s => s.updateNextPlanetDefaults)
  const updateNextSunDefaults    = usePlanetStore(s => s.updateNextSunDefaults)
  const monochromeMode = useCanvasSettingsStore(s => s.monochromeMode)
  const monochromeInverted = useCanvasSettingsStore(s => s.monochromeInverted)
  const wholeInstrumentPanelOpen = useWholeInstrumentStore(s => s.panelOpen)
  const setWholeInstrumentPanelOpen = useWholeInstrumentStore(s => s.setPanelOpen)
  const orbitHubPanelOpen = useOrbitHubStore(s => s.panelOpen)
  const [leftCollapsed, setLeftCollapsed] = useState(true)
  const [rightCollapsed, setRightCollapsed] = useState(true)
  const [rackCollapsed, setRackCollapsed] = useState(false)
  const [rackH, setRackH] = useState(RACK_DEFAULT)
  const [samplerPanel, setSamplerPanel]   = useState<{ bodyId: string; slotKey: string } | null>(null)
  const [oneShotPanel, setOneShotPanel]   = useState<{ bodyId: string; slotKey: string } | null>(null)
  const rackDragging = useRef(false)
  const rackStartY   = useRef(0)
  const rackStartH   = useRef(RACK_DEFAULT)
  const audioUnlockStarted = useRef(false)
  const monoUi = monochromeMode
  const paperTheme = simpleTheme || monoUi
  const monoBg = monochromeInverted ? '#050505' : '#fff'
  const monoText = monochromeInverted ? '#f7f7f7' : '#050505'
  const monoActiveBg = monochromeInverted ? '#f7f7f7' : '#111'
  const monoActiveText = monochromeInverted ? '#050505' : '#fff'
  const monoInputBg = monochromeInverted ? '#171717' : '#f2f2f2'
  const monoPanelBg = monochromeInverted ? 'rgba(5,5,5,0.92)' : 'rgba(255,255,255,0.92)'
  const monoBorder = monochromeInverted ? '0.5px solid rgba(255,255,255,0.18)' : '0.5px solid rgba(0,0,0,0.12)'
  const monoTextMid = monochromeInverted ? '#a8a8a8' : '#777'

  useEffect(() => {
    loadBuiltinSamples()
    initMidi()
  }, [])

  const unlockAudioOnce = useCallback(() => {
    if (audioUnlockStarted.current) return
    audioUnlockStarted.current = true
    void unlockMobileAudio().catch(() => {
      audioUnlockStarted.current = false
    })
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', unlockAudioOnce)
    return () => window.removeEventListener('keydown', unlockAudioOnce)
  }, [unlockAudioOnce])

  useEffect(() => {
    if (appMode !== 'planet') return
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 's' || e.key === 'S') { setPlanetTool('add-sun') }
      else if (e.key === 'p' || e.key === 'P') { setPlanetTool('add-planet') }
      else if (e.key === 'Escape') { setSelectedBodyId(null); setPlanetTool('select') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [appMode, setSelectedBodyId])

  const onRackDividerMouseDown = useCallback((e: React.MouseEvent) => {
    rackDragging.current = true
    rackStartY.current   = e.clientY
    rackStartH.current   = rackH

    function onMove(me: MouseEvent) {
      if (!rackDragging.current) return
      const delta = rackStartY.current - me.clientY
      setRackH(Math.max(RACK_MIN, Math.min(RACK_MAX, rackStartH.current + delta)))
    }
    function onUp() {
      rackDragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
  }, [rackH])

  // ── Mobile layout ─────────────────────────────────────────────────────────
  if (IS_MOBILE) {
    return (
      <div style={{
        width: '100vw', height: '100dvh', position: 'relative', overflow: 'hidden',
        background: monoUi ? monoBg : '#0a0a0f',
        color: monoUi ? monoText : undefined,
        fontFamily: monoUi
          ? '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Times New Roman", serif'
          : undefined,
      }}
        onPointerDown={() => { void unlockMobileAudio() }}
        onTouchStart={() => { void unlockMobileAudio() }}
      >
        <UniversalConductorSync />
        {/* Headless audio layers */}
        <DroneLayer /><GranularLayer /><FMDroneLayer /><NoisePadLayer />
        <SamplerLayer /><OneShotLayer /><StretchSamplerLayer /><LongSamplerLayer />
        <OscSynthLayer />
        <WaveLabInstrumentLayer />
        <WholeInstrumentLayer />
        {/* Full-screen canvas */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <PlanetCanvas tool={planetTool} onSelectTool={() => {}} mobileMode />
        </div>
        {/* Minimal HUD */}
        <MobileHud tool={planetTool} onSetTool={setPlanetTool} />
      </div>
    )
  }

  // ── Desktop layout ─────────────────────────────────────────────────────────
  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: monoUi ? monoBg : undefined,
      color: monoUi ? monoText : undefined,
      fontFamily: monoUi
        ? '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Times New Roman", serif'
        : undefined,
    }}
      onPointerDown={unlockAudioOnce}
      onTouchStart={unlockAudioOnce}
    >
      <UniversalConductorSync />
      <TopBar appMode={appMode} onSetAppMode={setAppMode} />
      <DroneLayer />
      <GranularLayer />
      <FMDroneLayer />
      <NoisePadLayer />
      <SamplerLayer />
      <OneShotLayer />
      <StretchSamplerLayer />
      <LongSamplerLayer />
      <OscSynthLayer />
      <WaveLabInstrumentLayer />
      <WholeInstrumentLayer />

      {appMode === 'osc' ? (
        /* ── Osc Mode: Ambient Oscillator dev view ──────────────────────── */
        <OscView />
      ) : appMode === 'dev' ? (
        /* ── Dev Mode: Audio Routing ────────────────────────────────────── */
        <DevRouteView />
      ) : appMode === 'wave-lab' ? (
        /* ── Wave Lab ────────────────────────────────────────────────────── */
        <WaveLabView />
      ) : appMode === 'whole-lab' ? (
        /* ── Whole Instrument Lab ────────────────────────────────────────── */
        <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }}>
            <PlanetCanvas tool="select" onSelectTool={() => {}} />
          </div>
          <div style={{ position: 'absolute', inset: 0 }}>
            <WholeInstrumentDevView />
          </div>
        </div>
      ) : appMode === 'orbit-hub' ? (
        /* ── Orbit Hub ───────────────────────────────────────────────────── */
        <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }}>
            <PlanetCanvas tool="select" onSelectTool={() => {}} />
          </div>
          <div style={{ position: 'absolute', inset: 0 }}>
            <OrbitHubView />
          </div>
        </div>
      ) : appMode === 'transform-lab' ? (
        /* ── Transform Lab ───────────────────────────────────────────────── */
        <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }}>
            <PlanetCanvas tool="select" onSelectTool={() => {}} />
          </div>
          <div style={{ position: 'absolute', inset: 0 }}>
            <TransformLabView />
          </div>
        </div>
      ) : appMode === 'sample' ? (
        /* ── Sample Mode ─────────────────────────────────────────────────── */
        <SampleModeView />
      ) : appMode === 'sigil' ? (
        /* ── Sigil Mode ──────────────────────────────────────────────────── */
        <SigilView />
      ) : appMode === 'patch' ? (
        /* ── Patch Mode ──────────────────────────────────────────────────── */
        <div style={{ flex: 1, minHeight: 0 }}>
          <PatchEditor />
        </div>
      ) : (
        /* ── Planet mode ────────────────────────────────────────────────── */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {/* Upper area: left panel + canvas + mixer */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
            <LeftLibraryPanel
              collapsed={leftCollapsed}
              onToggleCollapsed={() => setLeftCollapsed(v => !v)}
            />

            {/* Canvas area */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: monoUi ? monoBg : paperTheme ? '#fff' : '#0a0a0f' }}>
              <PlanetCanvas tool={planetTool} onSelectTool={() => setPlanetTool('select')} rightPanelWidth={rightCollapsed ? 34 : 260} />
              <UniversalContextBar />

              {/* Planet toolbar — top-left */}
              <div style={{
                position: 'absolute', top: 8, left: 8,
                display: 'flex', gap: 4,
                background: monoUi ? monoPanelBg : paperTheme ? 'rgba(255,255,255,0.92)' : 'rgba(10,10,20,0.80)',
                borderRadius: monoUi ? 2 : 8, padding: monoUi ? 4 : 5,
                border: monoUi ? monoBorder : paperTheme ? '0.5px solid rgba(0,0,0,0.12)' : '0.5px solid rgba(255,255,255,0.10)',
                boxShadow: monoUi ? 'none' : '0 2px 6px rgba(0,0,0,0.15)',
                backdropFilter: monoUi ? undefined : 'blur(4px)',
              }}>
                {/* Universe button — deselects body → global rack editing */}
                <button
                  onClick={() => { setSelectedBodyId(null); setPlanetTool('select') }}
                  style={{
                    fontSize: 10, fontWeight: 600, padding: '3px 9px',
                    borderRadius: monoUi ? 1 : 5,
                    border: monoUi ? monoBorder : paperTheme ? '0.5px solid rgba(0,0,0,0.12)' : '0.5px solid rgba(255,255,255,0.15)',
                    background: 'transparent',
                    color: monoUi ? monoText : paperTheme ? '#111' : 'rgba(255,255,255,0.55)',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  ⊙ Universe
                </button>

                {([
                  ['add-sun',    '☀ Sun'],
                  ['add-planet', '● Planet'],
                  ['probe',      '⊕ Probe'],
                ] as [PlanetTool, string][]).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setPlanetTool(id)}
                    style={{
                      fontSize: 10, fontWeight: 600, padding: '3px 9px',
                      borderRadius: monoUi ? 1 : 5,
                      border: monoUi
                        ? monoBorder
                        : paperTheme
                        ? '0.5px solid rgba(0,0,0,0.12)'
                        : '0.5px solid rgba(255,255,255,0.15)',
                      background: planetTool === id
                        ? monoUi ? monoActiveBg : 'rgba(139,92,246,0.22)'
                        : 'transparent',
                      color: planetTool === id
                        ? monoUi ? monoActiveText : '#a78bfa'
                        : monoUi ? monoText : paperTheme ? '#111' : 'rgba(255,255,255,0.55)',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {label}
                  </button>
                ))}
                {/* Next body mass — always visible; edits planet or star mass depending on active tool */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 3,
                  borderLeft: monoUi ? monoBorder : paperTheme ? '0.5px solid rgba(0,0,0,0.12)' : '0.5px solid rgba(255,255,255,0.15)',
                  paddingLeft: 6, marginLeft: 2,
                  opacity: (planetTool === 'add-planet' || planetTool === 'add-sun') ? 1 : 0.45,
                }}>
                  <span style={{ fontSize: 9, color: monoUi ? monoTextMid : paperTheme ? '#777' : 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
                    {planetTool === 'add-sun' ? '☀' : '●'} m=
                  </span>
                  <input
                    type="number"
                    value={planetTool === 'add-sun' ? nextSunDefaults.mass : nextPlanetDefaults.mass}
                    min={1}
                    max={planetTool === 'add-sun' ? 1000 : undefined}
                    step={1}
                    onChange={e => {
                      const raw = Math.max(1, Math.round(Number(e.target.value)))
                      const v = planetTool === 'add-sun' ? Math.min(1000, raw) : raw
                      if (planetTool === 'add-sun') updateNextSunDefaults({ mass: v })
                      else updateNextPlanetDefaults({ mass: v })
                    }}
                    style={{
                      width: 52, fontSize: 10, fontFamily: 'monospace', fontWeight: 600,
                      padding: '2px 4px', borderRadius: monoUi ? 1 : 4,
                      border: monoUi ? monoBorder : paperTheme ? '0.5px solid rgba(0,0,0,0.12)' : '0.5px solid rgba(255,255,255,0.15)',
                      background: monoUi ? monoInputBg : planetTool === 'add-sun' ? 'rgba(245,158,11,0.12)' : 'rgba(96,165,250,0.12)',
                      color: monoUi ? monoText : planetTool === 'add-sun' ? '#f59e0b' : '#60a5fa',
                      outline: 'none',
                    }}
                  />
                </div>
                {/* Probe mass — only visible when probe tool is active */}
                {planetTool === 'probe' && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 3,
                    borderLeft: monoUi ? monoBorder : paperTheme ? '0.5px solid rgba(0,0,0,0.12)' : '0.5px solid rgba(255,255,255,0.15)',
                    paddingLeft: 6, marginLeft: 2,
                  }}>
                    <span style={{ fontSize: 9, color: monoUi ? monoTextMid : paperTheme ? '#777' : 'rgba(255,255,255,0.45)', fontWeight: 600 }}>m=</span>
                    <input
                      type="number"
                      value={probeMass}
                      min={0}
                      step={10}
                      onChange={e => updateSimParams({ probeMass: Math.max(0, Number(e.target.value)) })}
                      style={{
                        width: 46, fontSize: 10, fontFamily: 'monospace', fontWeight: 600,
                        padding: '2px 4px', borderRadius: monoUi ? 1 : 4,
                        border: monoUi ? monoBorder : paperTheme ? '0.5px solid rgba(0,0,0,0.12)' : '0.5px solid rgba(255,255,255,0.15)',
                        background: monoUi ? monoInputBg : 'rgba(139,92,246,0.12)',
                        color: monoUi ? monoText : '#a78bfa',
                        outline: 'none',
                      }}
                    />
                  </div>
                )}
              </div>

              {!selectedBodyId && (
                <div
                  role="status"
                  style={{
                    position: 'absolute', top: 48, left: 8,
                    maxWidth: 'min(360px, calc(100% - 58px))',
                    padding: '5px 8px',
                    borderRadius: monoUi ? 2 : 6,
                    border: monoUi ? monoBorder : paperTheme ? '0.5px solid rgba(0,0,0,0.10)' : '0.5px solid rgba(255,255,255,0.10)',
                    background: monoUi ? monoPanelBg : paperTheme ? 'rgba(255,255,255,0.88)' : 'rgba(10,10,20,0.76)',
                    color: monoUi ? monoTextMid : paperTheme ? '#555' : 'rgba(255,255,255,0.66)',
                    fontSize: 9.5,
                    lineHeight: 1.35,
                    backdropFilter: monoUi ? undefined : 'blur(4px)',
                    pointerEvents: 'none',
                  }}
                >
                  {planetTool === 'select'
                    ? 'まず: 天体をクリックして選択し、下のRackで音を確認'
                    : planetTool === 'add-sun'
                      ? 'まず: キャンバスをドラッグして太陽を配置'
                      : planetTool === 'probe'
                        ? 'まず: キャンバスをドラッグしてProbeを投射'
                        : 'まず: キャンバスをドラッグして惑星を配置'}
                </div>
              )}

              {/* Mixer panel overlays the canvas so opening it does not resize or shift the canvas. */}
              <div style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                zIndex: 20,
                display: 'flex',
                pointerEvents: 'auto',
              }}>
                <RightInspector
                  mode="planet"
                  planetTool={planetTool}
                  collapsed={rightCollapsed}
                  onToggleCollapsed={() => setRightCollapsed(v => !v)}
                />
              </div>
            </div>

            {/* Sampler instrument editor panel — temporarily hidden */}
            {false && samplerPanel && (
              <SamplerInstrumentPanel
                bodyId={samplerPanel.bodyId}
                slotKey={samplerPanel.slotKey}
                onClose={() => setSamplerPanel(null)}
              />
            )}

            {/* One-shot sampler panel */}
            {oneShotPanel && (
              <OneShotSamplerPanel
                bodyId={oneShotPanel.bodyId}
                slotKey={oneShotPanel.slotKey}
                onClose={() => setOneShotPanel(null)}
              />
            )}
          </div>

          {/* Rack divider */}
          {!rackCollapsed && (
            <div
              onMouseDown={onRackDividerMouseDown}
              style={{
                height: 4, flexShrink: 0,
                background: paperTheme ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.75)',
                cursor: 'ns-resize',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <div style={{ display: 'flex', gap: 3 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{ width: 14, height: 1, background: paperTheme ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)', borderRadius: 1 }} />
                ))}
              </div>
            </div>
          )}

          {/* Planet Rack — full width at bottom */}
          {wholeInstrumentPanelOpen ? (
            <WholeInstrumentPanel height={rackH} />
          ) : orbitHubPanelOpen ? (
            <OrbitHubPanel height={rackH} />
          ) : (
            <PlanetRack
              height={rackH}
              collapsed={rackCollapsed}
              onToggleCollapsed={() => setRackCollapsed(v => !v)}
              onExtendSampler={(bId, sk) => setSamplerPanel({ bodyId: bId, slotKey: sk })}
              onExtendOneShot={(bId, sk) => setOneShotPanel({ bodyId: bId, slotKey: sk })}
              planetTool={planetTool}
            />
          )}
        </div>
      )}
    </div>
  )
}
