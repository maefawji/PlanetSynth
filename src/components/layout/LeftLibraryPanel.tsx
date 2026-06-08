import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, FolderOpen, Settings, SlidersHorizontal, Upload, Crosshair, Activity, Sun, Music, Wand2, ToggleLeft, Star, Radio, CircleHelp, Sparkles, Radar, Zap, Save as SaveIcon, Download, Gauge } from 'lucide-react'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import { usePlanetStore } from '../../store/planetStore'
import { CollisionPanel } from '../planet/CollisionPanel'
import { clearStardustDots } from '../planet/PlanetCanvas'
import { useWholeInstrumentStore } from '../../store/wholeInstrumentStore'
import { useOrbitHubStore } from '../../store/orbitHubStore'
import {
  getMidiOutputs, getMidiInputs, getSelectedOutputId, setSelectedOutputId,
  isMidiReady, sendMidiNote, type MidiPortInfo,
} from '../../audio/midiManager'
import { UNIVERSE_PRESETS, loadUserUniversePresets, saveUserUniversePresets } from '../../presets/universe'
import { PLANET_PRESETS, loadUserPlanetPresets, saveUserPlanetPresets } from '../../presets/planet'
import type { UserUniversePreset, UserPlanetPreset } from '../../presets/types'
import { useProjectStore } from '../../store/projectStore'
import { useControlSetStore, type ControlSet, type ControlSetCategory } from '../../store/controlSetStore'
import { setDraggingControlSetId } from '../../lib/dragControlSet'
import type { SampleAsset } from '../../patch/types'
import {
  cacheSampleLibrary,
  isAudioFile,
  libraryFromSamples,
  loadCachedSampleLibrary,
  pickSampleFiles,
  readSampleLibraryFile,
  samplesFromFiles,
  samplesFromLibrary,
  saveSampleLibraryFile,
  loadDefaultFolderSamples,
  pickDefaultFolder,
  type CachedSampleLibrary,
} from '../../persistence/sampleLibrary'
import { parseProject, restoreProjectSamples, saveProjectJson } from '../../persistence/projectSchema'
import { setGlobalAdsr } from '../../audio/intersectionSynth'
import { ADSR_OFF, computeOrbitAdsr } from '../../audio/orbitAdsr'
import { useTheme } from '../../lib/theme'
import { UniversalConductorPanel } from '../conductor/UniversalConductorPanel'

interface LeftLibraryPanelProps {
  collapsed: boolean
  onToggleCollapsed: () => void
}

type LeftPanelId =
  | 'canvas' | 'universe-presets' | 'planet-presets' | 'planet-samples'
  | 'universal-conductor'
  | 'planet-triggers'
  | 'planet-collision'
  | 'planet-auto'
  | 'planet-controls-trigger' | 'planet-controls-note' | 'planet-controls-instrument' | 'planet-controls-effect'
  | 'planet-localization' | 'planet-adsr'
  | 'orbit-hub' | 'midi' | 'help'

export function LeftLibraryPanel({ collapsed, onToggleCollapsed }: LeftLibraryPanelProps) {
  const t = useTheme()
  const [activePanel, setActivePanel] = useState<LeftPanelId>('planet-samples')
  const setWholeInstrumentPanelOpen = useWholeInstrumentStore(s => s.setPanelOpen)
  const orbitHubPanelOpen = useOrbitHubStore(s => s.panelOpen)
  const setOrbitHubPanelOpen = useOrbitHubStore(s => s.setPanelOpen)
  const [cachedLibrary, setCachedLibrary] = useState<CachedSampleLibrary | null>(() => loadCachedSampleLibrary())
  const addSampleAssets     = useProjectStore(s => s.addSampleAssets)
  const removeSampleAsset   = useProjectStore(s => s.removeSampleAsset)
  const loadProject         = useProjectStore(s => s.loadProject)
  const project             = useProjectStore(s => s.project)
  const samples             = useProjectStore(s => s.project.samples)
  const expandedWidth: number | string = activePanel === 'canvas' ? 'min(500px, 62vw)' : 246

  const [sampleImportStatus, setSampleImportStatus] = useState('')
  const didRestoreRef = useRef(false)

  useEffect(() => {
    if (!cachedLibrary || samples.length > 0) return
    const librarySamples = samplesFromLibrary(cachedLibrary.library)
    restoreProjectSamples(librarySamples).then(addSampleAssets)
  }, [addSampleAssets, cachedLibrary, samples.length])

  // ── On mount: restore sample blob URLs from stored file handles ──────────────
  useEffect(() => {
    if (didRestoreRef.current) return
    didRestoreRef.current = true
    restoreProjectSamples(useProjectStore.getState().project.samples).then(addSampleAssets)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleAddSample() {
    const picked = await pickSampleFiles()
    addSampleAssets(picked)
    setSampleImportStatus(picked.length ? `Imported ${picked.length} sample${picked.length === 1 ? '' : 's'}.` : 'No audio files selected.')
  }

  async function handleReloadAllSamples() {
    setSampleImportStatus('')
    const folderSamples = await loadDefaultFolderSamples()
    if (!folderSamples.length) {
      setSampleImportStatus('No stored sample folder available. Use Set Folder once, then Reload will rescan that folder.')
      return
    }
    removeLocalSamples()
    addSampleAssets(folderSamples)
    setSampleImportStatus(`Reloaded ${folderSamples.length} sample${folderSamples.length === 1 ? '' : 's'} from the stored folder.`)
  }

  async function handleSetSampleFolder() {
    setSampleImportStatus('')
    const folderSamples = await pickDefaultFolder()
    if (!folderSamples.length) {
      setSampleImportStatus('No audio files found in that folder.')
      return
    }
    removeLocalSamples()
    addSampleAssets(folderSamples)
    setSampleImportStatus(`Loaded ${folderSamples.length} sample${folderSamples.length === 1 ? '' : 's'} from folder.`)
  }

  function handleClearAllSamples() {
    removeLocalSamples()
  }

  function removeLocalSamples() {
    for (const sample of useProjectStore.getState().project.samples) {
      if (!isBuiltinSampleAsset(sample)) removeSampleAsset(sample.id)
    }
  }

  function handleAddDroppedSamples(files: File[]) {
    const imported = samplesFromFiles(files.filter(isAudioFile))
    addSampleAssets(imported)
    setSampleImportStatus(imported.length ? `Imported ${imported.length} dropped sample${imported.length === 1 ? '' : 's'}.` : 'No audio files found in the drop.')
  }

  async function handleLoadSampleLibraryFile(file?: File) {
    const selectedFile = file ?? await chooseFile('.json,.sample-library.json')
    if (!selectedFile) return
    const library = await readSampleLibraryFile(selectedFile)
    cacheSampleLibrary(selectedFile.name, library)
    setCachedLibrary({ fileName: selectedFile.name, library })
    const restored = await restoreProjectSamples(samplesFromLibrary(library))
    addSampleAssets(restored)
    setSampleImportStatus(restored.some(sample => sample.objectUrl)
      ? `Loaded ${restored.length} library sample${restored.length === 1 ? '' : 's'}.`
      : 'Library loaded, but sample files need the matching folder to be set or reloaded.')
  }

  function handleSaveSampleLibrary() {
    const library = libraryFromSamples(
      cachedLibrary?.library.name ?? 'sample-library',
      samples,
      cachedLibrary?.library.canvasDataPath,
    )
    cacheSampleLibrary(`${library.name}.sample-library.json`, library)
    setCachedLibrary({ fileName: `${library.name}.sample-library.json`, library })
    saveSampleLibraryFile(library)
  }

  async function handleLoadCanvasDataFile() {
    const selectedFile = await chooseFile('.json')
    if (!selectedFile) return
    const data = JSON.parse(await selectedFile.text())
    const nextProject = parseProject(data)
    loadProject(nextProject)
    const library = {
      ...(cachedLibrary?.library ?? libraryFromSamples('sample-library', samples)),
      canvasDataPath: selectedFile.name,
    }
    cacheSampleLibrary(cachedLibrary?.fileName ?? `${library.name}.sample-library.json`, library)
    setCachedLibrary({ fileName: cachedLibrary?.fileName ?? `${library.name}.sample-library.json`, library })
  }

  function handleSaveCanvasData() {
    const fileName = `${project.meta.name.replace(/[^\w\s-]/g, '')}.json`
    saveProjectJson(project)
    const library = {
      ...(cachedLibrary?.library ?? libraryFromSamples('sample-library', samples)),
      canvasDataPath: fileName,
    }
    cacheSampleLibrary(cachedLibrary?.fileName ?? `${library.name}.sample-library.json`, library)
    setCachedLibrary({ fileName: cachedLibrary?.fileName ?? `${library.name}.sample-library.json`, library })
  }

  function handleSelectPanel(panel: LeftPanelId) {
    if (panel === 'orbit-hub') {
      setActivePanel(panel)
      setWholeInstrumentPanelOpen(false)
      setOrbitHubPanelOpen(true)
      if (!collapsed) onToggleCollapsed()
      return
    }
    setWholeInstrumentPanelOpen(false)
    setOrbitHubPanelOpen(false)
    if (!collapsed && activePanel === panel) {
      onToggleCollapsed()
      return
    }
    setActivePanel(panel)
    if (collapsed) onToggleCollapsed()
  }

  return (
    <div style={{
      width: collapsed ? 34 : expandedWidth, flexShrink: 0,
      background: t.panelBg,
      borderRight: `0.5px solid ${t.panelBorder}`,
      display: 'flex',
      overflow: 'visible',
      position: 'relative',
      zIndex: 20,
    }}>
      <div style={{
        width: 34, flexShrink: 0,
        borderRight: collapsed ? 'none' : `0.5px solid ${t.divider}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        background: t.headerBg,
      }}>
        <RailButton
          active={false}
          title={collapsed ? 'Show Panel' : 'Hide Panel'}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </RailButton>
        <RailButton
          active={activePanel === 'planet-samples' && !collapsed}
          title="Samples"
          onClick={() => handleSelectPanel('planet-samples')}
        >
          <FolderOpen size={14} />
        </RailButton>
        <RailDivider />
        <RailButton
          active={activePanel === 'universal-conductor' && !collapsed}
          title="Universal Context"
          onClick={() => handleSelectPanel('universal-conductor')}
        >
          <Gauge size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-controls-trigger' && !collapsed}
          title="Trigger Sets"
          onClick={() => handleSelectPanel('planet-controls-trigger')}
        >
          <ToggleLeft size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-controls-note' && !collapsed}
          title="Note Sets"
          onClick={() => handleSelectPanel('planet-controls-note')}
        >
          <Activity size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-controls-instrument' && !collapsed}
          title="Instrument Sets"
          onClick={() => handleSelectPanel('planet-controls-instrument')}
        >
          <Music size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-controls-effect' && !collapsed}
          title="Effect Sets"
          onClick={() => handleSelectPanel('planet-controls-effect')}
        >
          <Wand2 size={14} />
        </RailButton>
        <RailDivider />
        <RailButton
          active={activePanel === 'universe-presets' && !collapsed}
          title="Universe Presets"
          onClick={() => handleSelectPanel('universe-presets')}
        >
          <Sun size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-presets' && !collapsed}
          title="Planet Presets"
          onClick={() => handleSelectPanel('planet-presets')}
        >
          <Star size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-triggers' && !collapsed}
          title="Triggers"
          onClick={() => handleSelectPanel('planet-triggers')}
        >
          <SlidersHorizontal size={14} />
        </RailButton>
<RailButton
          active={activePanel === 'planet-auto' && !collapsed}
          title="Auto Spawn"
          onClick={() => handleSelectPanel('planet-auto')}
        >
          <Sparkles size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-adsr' && !collapsed}
          title="ADSR"
          onClick={() => handleSelectPanel('planet-adsr')}
        >
          <Activity size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-localization' && !collapsed}
          title="Localization"
          onClick={() => handleSelectPanel('planet-localization')}
        >
          <Crosshair size={14} />
        </RailButton>
        <RailButton
          active={orbitHubPanelOpen}
          title="Orbit Hub"
          onClick={() => handleSelectPanel('orbit-hub')}
        >
          <Radar size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'midi' && !collapsed}
          title="MIDI"
          onClick={() => handleSelectPanel('midi')}
        >
          <Radio size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'canvas' && !collapsed}
          title="Canvas Settings"
          onClick={() => handleSelectPanel('canvas')}
        >
          <Settings size={14} />
        </RailButton>
        <div style={{ flex: 1 }} />
        <RailButton
          active={activePanel === 'help' && !collapsed}
          title="Help"
          onClick={() => handleSelectPanel('help')}
        >
          <CircleHelp size={14} />
        </RailButton>
      </div>

      {!collapsed && activePanel === 'planet-samples' && (
        <SamplesPanel
          samples={samples}
          cachedLibrary={cachedLibrary}
          onAddSample={handleAddSample}
          onAddDroppedSamples={handleAddDroppedSamples}
          onLoadSampleLibrary={handleLoadSampleLibraryFile}
          onSaveSampleLibrary={handleSaveSampleLibrary}
          onLoadCanvasData={handleLoadCanvasDataFile}
          onSaveCanvasData={handleSaveCanvasData}
          onReloadAll={handleReloadAllSamples}
          onSetFolder={handleSetSampleFolder}
          onClearAll={handleClearAllSamples}
          importStatus={sampleImportStatus}
        />
      )}
      {!collapsed && activePanel === 'universal-conductor' && (
        <UniversalConductorPanel />
      )}

      {!collapsed && activePanel === 'universe-presets' && (
        <UniversePresetPanel />
      )}
      {!collapsed && activePanel === 'planet-presets' && (
        <PlanetPresetPanel />
      )}
      {!collapsed && activePanel === 'planet-triggers' && (
        <PlanetTriggersPanel />
      )}
{!collapsed && activePanel === 'planet-auto' && (
        <PlanetAutoSpawnPanel />
      )}
      {!collapsed && activePanel === 'planet-controls-trigger' && (
        <ControlSetsPanel category="trigger" />
      )}
      {!collapsed && activePanel === 'planet-controls-note' && (
        <ControlSetsPanel category="note" />
      )}
      {!collapsed && activePanel === 'planet-controls-instrument' && (
        <ControlSetsPanel category="instrument" />
      )}
      {!collapsed && activePanel === 'planet-controls-effect' && (
        <ControlSetsPanel category="effect" />
      )}
      {!collapsed && activePanel === 'planet-adsr' && (
        <PlanetAdsrPanel />
      )}
      {!collapsed && activePanel === 'planet-localization' && (
        <LocalizationPanel />
      )}

      {!collapsed && activePanel === 'canvas' && (
        <CanvasSettingsPanel />
      )}
      {!collapsed && activePanel === 'midi' && (
        <MidiPanel />
      )}
      {!collapsed && activePanel === 'help' && (
        <HelpPanel />
      )}

    </div>
  )
}

// ── Library explorer ──────────────────────────────────────────────────────────

type FileNode   = { type: 'file';   name: string; path: string }
type FolderNode = { type: 'folder'; name: string; path: string; children: TreeNode[] }
type TreeNode   = FileNode | FolderNode

function _buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = []
  for (const filePath of paths) {
    const parts = filePath.split('/')
    let nodes = root
    for (let i = 0; i < parts.length - 1; i++) {
      const folderPath = parts.slice(0, i + 1).join('/')
      let folder = nodes.find(n => n.type === 'folder' && n.name === parts[i]) as FolderNode | undefined
      if (!folder) {
        folder = { type: 'folder', name: parts[i], path: folderPath, children: [] }
        nodes.push(folder)
      }
      nodes = folder.children
    }
    nodes.push({ type: 'file', name: parts[parts.length - 1], path: filePath })
  }
  return root
}

// ─────────────────────────────────────────────────────────────────────────────

function SamplesPanel({ samples, cachedLibrary, onAddSample, onAddDroppedSamples, onLoadSampleLibrary, onSaveSampleLibrary, onLoadCanvasData, onSaveCanvasData, onReloadAll, onSetFolder, onClearAll, importStatus }: {
  samples: Array<SampleAsset>
  cachedLibrary: CachedSampleLibrary | null
  onAddSample: () => void
  onAddDroppedSamples: (files: File[]) => void
  onLoadSampleLibrary: (file?: File) => void | Promise<void>
  onSaveSampleLibrary: () => void
  onLoadCanvasData: () => void | Promise<void>
  onSaveCanvasData: () => void
  onReloadAll: () => void | Promise<void>
  onSetFolder: () => void | Promise<void>
  onClearAll: () => void
  importStatus: string
}) {
  const t = useTheme()
  const selectedBodyId = usePlanetStore(s => s.selectedBodyId)
  const setBodySlot = useControlSetStore(s => s.setBodySlot)
  const setGlobalSlot = useControlSetStore(s => s.setGlobalSlot)
  const setSlotOverride = useControlSetStore(s => s.setSlotOverride)
  const removeSampleAsset = useProjectStore(s => s.removeSampleAsset)
  const [dragging, setDragging] = useState(false)
  const [query, setQuery] = useState('')
  const [activeSource, setActiveSource] = useState<'all' | 'builtin' | 'local'>('all')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const defaultSamples = samples.filter(isBuiltinSampleAsset)
  const localSamples = samples.filter(sample => !isBuiltinSampleAsset(sample))
  const filteredSamples = samples.filter(sample => {
    const source = isBuiltinSampleAsset(sample) ? 'builtin' : sample.source === 'library' ? 'library' : 'local'
    if (activeSource !== 'all' && source !== activeSource && !(activeSource === 'local' && source === 'library')) return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    return `${sample.name} ${sample.sourcePath ?? ''} ${source}`.toLowerCase().includes(q)
  })
  const visibleDefaultSamples = filteredSamples.filter(isBuiltinSampleAsset)
  const visibleLocalSamples = filteredSamples.filter(sample => !isBuiltinSampleAsset(sample))
  const assignTarget = selectedBodyId ? `selected body` : 'global rack'

  const smallBtnStyle: React.CSSProperties = {
    padding: '5px 7px',
    background: t.inputBg,
    border: `0.5px solid ${t.panelBorder}`,
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 9,
    color: t.textMid,
    fontFamily: 'inherit',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const files = await filesFromDataTransfer(e.dataTransfer)
    if (!files.length) return

    const libraryFile = files.find(file => /\.json$/i.test(file.name))
    if (libraryFile) await onLoadSampleLibrary(libraryFile)
    onAddDroppedSamples(files.filter(isAudioFile))
  }

  async function playSample(sample: SampleAsset) {
    if (playingId === sample.id) {
      stopPreview()
      return
    }
    stopPreview()
    if (!sample.objectUrl) return
    const audio = new Audio(sample.objectUrl)
    audioRef.current = audio
    setPlayingId(sample.id)
    audio.onended = () => setPlayingId(null)
    audio.onerror = () => setPlayingId(null)
    try {
      await audio.play()
    } catch {
      setPlayingId(null)
    }
  }

  function stopPreview() {
    audioRef.current?.pause()
    audioRef.current = null
    setPlayingId(null)
  }

  function assignSample(sample: SampleAsset) {
    const slotKey = selectedBodyId ? `b:${selectedBodyId}:instrument` : 'g:instrument'
    if (selectedBodyId) setBodySlot(selectedBodyId, 'instrument', 'instrument-sampler')
    else setGlobalSlot('instrument', 'instrument-sampler')
    setSlotOverride(slotKey, {
      samplerType: 'sampler',
      samplerMode: 'fixed',
      samplerSampleId: sample.id,
    })
  }

  function renderSampleRow(sample: SampleAsset, removable: boolean) {
    const builtin = isBuiltinSampleAsset(sample)
    const loaded = Boolean(sample.objectUrl)
    return (
      <div key={sample.id} style={{
        display: 'grid',
        gridTemplateColumns: '20px minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 5,
        padding: '5px 6px',
        borderRadius: 5,
      }}>
        <button
          onClick={() => { void playSample(sample) }}
          disabled={!loaded}
          title={loaded ? 'Preview sample' : 'Sample file is not restored'}
          style={{
            width: 20, height: 20,
            display: 'grid', placeItems: 'center',
            borderRadius: 4,
            border: `0.5px solid ${playingId === sample.id ? '#60a5fa' : t.panelBorder}`,
            background: playingId === sample.id ? 'rgba(96,165,250,0.16)' : t.inputBg,
            color: loaded ? (playingId === sample.id ? '#60a5fa' : t.textMid) : '#f87171',
            cursor: loaded ? 'pointer' : 'default',
            fontSize: 8,
            fontFamily: 'inherit',
            padding: 0,
          }}
        >
          {playingId === sample.id ? '■' : '▶'}
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 10.5, color: t.text, fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sample.name}
            </span>
            <span style={{
              fontSize: 7,
              color: builtin ? '#60a5fa' : '#34d399',
              background: builtin ? 'rgba(96,165,250,0.12)' : 'rgba(52,211,153,0.12)',
              borderRadius: 99,
              padding: '1px 4px',
              flexShrink: 0,
            }}>
              {builtin ? 'DEF' : sample.source === 'library' ? 'LIB' : 'LOC'}
            </span>
          </div>
          <div style={{ fontSize: 8, color: loaded ? t.textDim : '#f87171', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
            {loaded ? sample.sourcePath || sample.fileType : 'missing file handle'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <button
            onClick={() => assignSample(sample)}
            title={`Add as Sampler to ${assignTarget}`}
            style={{ ...sampleAssignBtn(t), minWidth: 34, color: '#818cf8' }}
          >
            Add
          </button>
          {removable && (
            <button
              onClick={() => {
                if (playingId === sample.id) stopPreview()
                removeSampleAsset(sample.id)
              }}
              title="Remove local sample"
              style={{ ...sampleAssignBtn(t), minWidth: 20, color: '#f87171' }}
            >×</button>
          )}
        </div>
      </div>
    )
  }

  function renderSection(label: string, list: SampleAsset[], removable: boolean) {
    return (
      <div style={{ borderTop: `0.5px solid ${t.divider}` }}>
        <div style={{ padding: '6px 9px 3px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 8, fontWeight: 850, color: t.textMid, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
          <span style={{ fontSize: 8, color: t.textDim }}>{list.length}</span>
        </div>
        {list.length === 0 ? (
          <div style={{ fontSize: 10, color: t.textDim, padding: '4px 10px 10px' }}>
            {query ? 'No matches.' : removable ? 'No local samples.' : 'No default samples loaded.'}
          </div>
        ) : (
          <div style={{ padding: '0 5px 5px', display: 'grid', gap: 1 }}>
            {list.map(sample => renderSampleRow(sample, removable))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      onDragOver={e => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
        outline: dragging ? '2px solid rgba(37,99,235,0.35)' : 'none',
        outlineOffset: -2,
        background: dragging ? 'rgba(37,99,235,0.04)' : 'transparent',
      }}
    >
      <SectionHeader label="Samples" />
      {importStatus && (
        <div style={{
          padding: '5px 10px',
          fontSize: 10,
          color: importStatus.startsWith('No ') || importStatus.includes('failed') || importStatus.includes('missing') ? '#b45309' : '#2563eb',
          background: 'rgba(37,99,235,0.045)',
          borderBottom: `0.5px solid ${t.divider}`,
          lineHeight: 1.35,
        }}>
          {importStatus}
        </div>
      )}

      <div style={{ padding: '7px 9px', borderBottom: `0.5px solid ${t.divider}`, background: t.sectionBg, display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {([
            ['all', `All ${samples.length}`],
            ['builtin', `Default ${defaultSamples.length}`],
            ['local', `Local ${localSamples.length}`],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveSource(id)}
              style={{
                ...smallBtnStyle,
                flex: 1,
                color: activeSource === id ? t.activeText : t.textMid,
                background: activeSource === id ? t.activeBg : t.inputBg,
                borderColor: activeSource === id ? t.activeBg : t.panelBorder,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search samples"
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 10, color: t.inputText, background: t.inputBg, border: `0.5px solid ${t.panelBorder}`, borderRadius: 4, padding: '5px 7px', fontFamily: 'inherit', outline: 'none' }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
          <button onClick={onAddSample} style={smallBtnStyle}>Add</button>
          <button onClick={onSetFolder} style={smallBtnStyle}>Folder</button>
          <button onClick={onReloadAll} style={smallBtnStyle}>Reload</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
          <button onClick={() => onLoadSampleLibrary()} style={smallBtnStyle} title={cachedLibrary ? cachedLibrary.fileName : 'Load sample library'}>Import</button>
          <button onClick={onSaveSampleLibrary} style={smallBtnStyle}>Export</button>
          <button onClick={onClearAll} disabled={localSamples.length === 0} style={{ ...smallBtnStyle, opacity: localSamples.length === 0 ? 0.4 : 1, color: localSamples.length ? '#f87171' : t.textDim }}>Clear</button>
        </div>
        <details>
          <summary style={{ fontSize: 9, color: t.textDim, cursor: 'pointer', userSelect: 'none' }}>Project data</summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginTop: 5 }}>
            <button onClick={onLoadCanvasData} style={smallBtnStyle}>Load Canvas</button>
            <button onClick={onSaveCanvasData} style={smallBtnStyle}>Save Canvas</button>
          </div>
          <div style={{ fontSize: 8, color: t.textDim, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {cachedLibrary?.library.canvasDataPath ?? 'No canvas data recorded'}
          </div>
        </details>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {(activeSource === 'all' || activeSource === 'builtin') && renderSection('Default Files', visibleDefaultSamples, false)}
        {(activeSource === 'all' || activeSource === 'local') && renderSection('User Local', visibleLocalSamples, true)}
      </div>
    </div>
  )
}

function isBuiltinSampleAsset(sample: SampleAsset): boolean {
  return sample.source === 'builtin' || sample.id.startsWith('builtin:') || sample.sourcePath?.startsWith('/samples/') === true
}

function sampleAssignBtn(t: ReturnType<typeof useTheme>): CSSProperties {
  return {
    minWidth: 26,
    height: 20,
    padding: '0 5px',
    borderRadius: 4,
    border: `0.5px solid ${t.panelBorder}`,
    background: t.inputBg,
    color: t.textMid,
    fontSize: 8,
    fontWeight: 850,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
}

type WebkitFileEntry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file: (success: (file: File) => void, error?: (error: unknown) => void) => void
  createReader?: () => { readEntries: (success: (entries: WebkitFileEntry[]) => void, error?: (error: unknown) => void) => void }
}

async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? [])
  const entries = items
    .map(item => {
      const withEntry = item as DataTransferItem & { webkitGetAsEntry?: () => WebkitFileEntry | null }
      return (withEntry.webkitGetAsEntry?.() ?? null) as WebkitFileEntry | null
    })
    .filter((entry): entry is WebkitFileEntry => entry !== null)

  if (entries.length > 0) {
    const nested = await Promise.all(entries.map(entry => filesFromEntry(entry)))
    return nested.flat()
  }

  return Array.from(dataTransfer.files ?? [])
}

async function filesFromEntry(entry: WebkitFileEntry, basePath = ''): Promise<File[]> {
  const path = basePath ? `${basePath}/${entry.name}` : entry.name
  if (entry.isFile) {
    return new Promise(resolve => {
      entry.file(file => {
        Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true })
        resolve([file])
      }, () => resolve([]))
    })
  }

  if (!entry.isDirectory || !entry.createReader) return []

  const reader = entry.createReader()
  const entries: WebkitFileEntry[] = []
  while (true) {
    const batch = await new Promise<WebkitFileEntry[]>(resolve => {
      reader.readEntries(resolve, () => resolve([]))
    })
    if (batch.length === 0) break
    entries.push(...batch)
  }

  const nested = await Promise.all(entries.map(child => filesFromEntry(child, path)))
  return nested.flat()
}

function chooseFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

// smallPanelButtonStyle is now computed dynamically inside components that use useTheme()

function PlanetTriggersPanel() {
  const t = useTheme()
  const { simParams, updateSimParams } = usePlanetStore()

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <SectionHeader label="Triggers" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {/* ── Simulation ───────────────────────────────────────────────── */}
        <SettingsGroup label="Simulation">
          <SimulationSpeedSetting dt={simParams.dt} onChange={dt => updateSimParams({ dt })} />
          <NumberSetting label="G" value={simParams.G} min={0} step={0.1}
            onChange={G => updateSimParams({ G })} />
          <NumberSetting label="Softening ε" value={simParams.epsilon} min={0.1} step={1}
            onChange={epsilon => updateSimParams({ epsilon })} />
          <NumberSetting label="Probe mass" value={simParams.probeMass} min={0} step={10}
            onChange={probeMass => updateSimParams({ probeMass })} />
        </SettingsGroup>
        <SettingsGroup label="Trigger Playback">
          <div style={{ display: 'flex', gap: 5 }}>
            {([
              ['restart', 'Retrigger', 'Stop the current voice and restart the sample'],
              ['layer', 'Layer', 'Start a new one-shot voice without stopping the current one'],
            ] as const).map(([value, label, title]) => (
              <button
                key={value}
                title={title}
                onClick={() => updateSimParams({ triggerPlaybackMode: value })}
                style={{
                  flex: 1,
                  padding: '6px 4px',
                  background: simParams.triggerPlaybackMode === value
                    ? 'rgba(139,92,246,0.15)' : t.inputBg,
                  border: simParams.triggerPlaybackMode === value
                    ? '0.5px solid rgba(139,92,246,0.40)' : '0.5px solid transparent',
                  borderRadius: 5,
                  cursor: 'pointer',
                  fontSize: 10,
                  fontWeight: 600,
                  color: simParams.triggerPlaybackMode === value ? '#7c3aed' : t.textMid,
                  fontFamily: 'inherit',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 9, color: t.textDim, lineHeight: 1.4 }}>
            Retrigger は現在の同じサンプルを止めて再スタート。Layer はトリガーごとに重ねて鳴らします。
          </div>
        </SettingsGroup>
        <CollisionPanel />
      </div>
    </div>
  )
}

function PlanetAutoSpawnPanel() {
  const t = useTheme()
  const { simParams, updateSimParams } = usePlanetStore()

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <SectionHeader label="Auto Spawn" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        <SettingsGroup label="Mode">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 76 }}>
            <input
              type="checkbox"
              checked={simParams.autoSpawnPlanets}
              onChange={e => updateSimParams({ autoSpawnPlanets: e.target.checked })}
            />
            <span style={{ fontSize: 10, color: t.textMid }}>Enable auto planets</span>
          </label>
          <div style={{ fontSize: 9, color: t.textDim, lineHeight: 1.4, paddingLeft: 76 }}>
            Adds planets at random positions inside the current standpoint range.
          </div>
        </SettingsGroup>

        <SettingsGroup label="Trigger">
          <NumberSetting label="Every sec" value={simParams.autoSpawnIntervalSec} min={0.5} step={0.5}
            onChange={autoSpawnIntervalSec => updateSimParams({ autoSpawnIntervalSec })} />
          <NumberSetting label="Min count" value={simParams.autoSpawnMinPlanets} min={0} step={1}
            onChange={autoSpawnMinPlanets => updateSimParams({ autoSpawnMinPlanets })} />
          <NumberSetting label="Max count" value={simParams.autoSpawnMaxPlanets} min={0} step={1}
            onChange={autoSpawnMaxPlanets => updateSimParams({ autoSpawnMaxPlanets })} />
        </SettingsGroup>

        <SettingsGroup label="Spawn Range">
          <NumberSetting label="Radius min" value={simParams.autoSpawnRadiusMin} min={0} step={10}
            onChange={autoSpawnRadiusMin => updateSimParams({ autoSpawnRadiusMin })} />
          <NumberSetting label="Radius max" value={simParams.autoSpawnRadiusMax} min={0} step={10}
            onChange={autoSpawnRadiusMax => updateSimParams({ autoSpawnRadiusMax })} />
          <div style={{ fontSize: 9, color: t.textDim, lineHeight: 1.4, paddingLeft: 76 }}>
            Radius max is clamped to Standpoint max distance when a standpoint body exists.
          </div>
        </SettingsGroup>

        <SettingsGroup label="Random Planet">
          <NumberSetting label="m min" value={simParams.autoSpawnMassMin} min={0.1} step={0.5}
            onChange={autoSpawnMassMin => updateSimParams({ autoSpawnMassMin })} />
          <NumberSetting label="m max" value={simParams.autoSpawnMassMax} min={0.1} step={0.5}
            onChange={autoSpawnMassMax => updateSimParams({ autoSpawnMassMax })} />
          <NumberSetting label="v min" value={simParams.autoSpawnSpeedMin} min={0} step={0.1}
            onChange={autoSpawnSpeedMin => updateSimParams({ autoSpawnSpeedMin })} />
          <NumberSetting label="v max" value={simParams.autoSpawnSpeedMax} min={0} step={0.1}
            onChange={autoSpawnSpeedMax => updateSimParams({ autoSpawnSpeedMax })} />
        </SettingsGroup>
      </div>
    </div>
  )
}

// ── Control Sets Panel ────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<ControlSetCategory, string> = {
  trigger:    'Trigger',
  note:       'Note',
  instrument: 'Instrument',
  effect:     'Effect',
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<{
    getFileHandle: (name: string, options?: { create?: boolean }) => Promise<{
      getFile: () => Promise<File>
      createWritable: () => Promise<{
        write: (data: string) => Promise<void>
        close: () => Promise<void>
      }>
    }>
  }>
}

const USER_CONTROL_SET_FILE = 'planet-synth-user-control-sets.json'

function ControlSetCard({ cs, globalRack }: { cs: ControlSet; globalRack: import('../../store/controlSetStore').BodyRack }) {
  const inRack = globalRack.triggers.includes(cs.id)
    || globalRack.note === cs.id
    || globalRack.instrument === cs.id
    || globalRack.effects.includes(cs.id)
  const selectedBodyId = usePlanetStore(s => s.selectedBodyId)
  const setBodySlot     = useControlSetStore(s => s.setBodySlot)
  const addBodyTrigger  = useControlSetStore(s => s.addBodyTrigger)
  const addBodyEffect   = useControlSetStore(s => s.addBodyEffect)
  const setGlobalSlot   = useControlSetStore(s => s.setGlobalSlot)
  const addGlobalTrigger = useControlSetStore(s => s.addGlobalTrigger)
  const addGlobalEffect  = useControlSetStore(s => s.addGlobalEffect)
  const deleteUserControlSet = useControlSetStore(s => s.deleteUserControlSet)

  function assignToRack(bodyId: string | null) {
    if (cs.category === 'trigger') {
      if (bodyId) addBodyTrigger(bodyId, cs.id)
      else addGlobalTrigger(cs.id)
    } else if (cs.category === 'note') {
      if (bodyId) setBodySlot(bodyId, 'note', cs.id)
      else setGlobalSlot('note', cs.id)
    } else if (cs.category === 'effect') {
      if (bodyId) addBodyEffect(bodyId, cs.id)
      else addGlobalEffect(cs.id)
    } else {
      if (bodyId) setBodySlot(bodyId, 'instrument', cs.id)
      else setGlobalSlot('instrument', cs.id)
    }
  }

  function assignToSelectedBody() {
    if (!selectedBodyId) return
    assignToRack(selectedBodyId)
  }

  function handleManualDragStart(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    let dragging = false
    setDraggingControlSetId(cs.id)

    function cleanup() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      setDraggingControlSetId(null)
    }

    function onMove(ev: MouseEvent) {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
        dragging = true
        document.body.style.cursor = 'copy'
      }
    }

    function onUp(ev: MouseEvent) {
      try {
        if (dragging) {
          const target = document
            .elementFromPoint(ev.clientX, ev.clientY)
            ?.closest<HTMLElement>('[data-control-rack-dropzone="true"]')
          if (target) assignToRack(target.dataset.bodyId || null)
        }
      } finally {
        cleanup()
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const t = useTheme()

  return (
    <div
      title={`${cs.description}${cs.description ? '\n\n' : ''}ドラッグしてラックにアサイン。ダブルクリックで選択 body へ即追加。`}
      draggable={false}
      onMouseDown={handleManualDragStart}
      onDragStart={e => {
        e.preventDefault()
        e.stopPropagation()
        setDraggingControlSetId(null)
      }}
      onDragEnd={() => setDraggingControlSetId(null)}
      onDoubleClick={assignToSelectedBody}
      style={{
        borderRadius: 5,
        border: `0.5px solid ${inRack ? cs.color + '88' : t.panelBorder}`,
        background: inRack ? `${cs.color}0d` : t.sectionBg,
        padding: '5px 7px',
        cursor: 'grab',
        transition: 'border-color 0.15s, background 0.15s',
        userSelect: 'none',
        WebkitUserDrag: 'none',
        touchAction: 'none',
      } as CSSProperties & { WebkitUserDrag: string }}
      onMouseEnter={e => {
        if (!inRack) e.currentTarget.style.background = t.hoverBg
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = inRack ? `${cs.color}0d` : t.sectionBg
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 25 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 5, flexShrink: 0,
          background: `${cs.color}22`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, lineHeight: 1,
          border: `0.5px solid ${cs.color}44`,
        }}>{cs.icon}</span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 10.5, fontWeight: 750, color: t.text, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {cs.name}
          </div>
        </div>
        {inRack && (
          <span style={{
            fontSize: 7, fontWeight: 800, color: cs.color,
            background: `${cs.color}18`, borderRadius: 3,
            padding: '2px 4px', flexShrink: 0,
            border: `0.5px solid ${cs.color}44`,
          }}>RACK</span>
        )}
        {cs.source === 'user' && (
          <button
            title="Delete user preset"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              if (window.confirm(`Delete user preset "${cs.name}"?`)) deleteUserControlSet(cs.id)
            }}
            style={{
              fontSize: 10,
              color: t.textDim,
              background: 'transparent',
              border: 'none',
              padding: '1px 2px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        )}
        <button
          title={selectedBodyId ? 'Add to selected body rack' : 'Add to global rack'}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
            assignToRack(selectedBodyId || null)
          }}
          style={{
            fontSize: 7.5,
            fontWeight: 800,
            color: cs.color,
            background: `${cs.color}14`,
            border: `0.5px solid ${cs.color}44`,
            borderRadius: 3,
            padding: '2px 4px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            flexShrink: 0,
          }}
        >
          Add
        </button>
      </div>

    </div>
  )
}

function ControlSetsPanel({ category }: { category: ControlSetCategory }) {
  const t = useTheme()
  const globalRack = useControlSetStore(s => s.globalRack)
  const bodyRacks = useControlSetStore(s => s.bodyRacks)
  const rackParamOverrides = useControlSetStore(s => s.rackParamOverrides)
  const getControlSetById = useControlSetStore(s => s.getControlSetById)
  const getControlSetsByCategory = useControlSetStore(s => s.getControlSetsByCategory)
  const saveUserControlSet = useControlSetStore(s => s.saveUserControlSet)
  const exportUserControlSets = useControlSetStore(s => s.exportUserControlSets)
  const importUserControlSets = useControlSetStore(s => s.importUserControlSets)
  const selectedBodyId = usePlanetStore(s => s.selectedBodyId)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sets = getControlSetsByCategory(category).filter(cs => cs.id !== 'trigger-arpeggio')
  const defaultSets = sets.filter(c => c.source !== 'user')
  const userSets = sets.filter(c => c.source === 'user')

  function activeSlot(): { cs: ControlSet; slotKey: string } | null {
    const bodyRack = selectedBodyId ? bodyRacks[selectedBodyId] ?? {} : null
    const bodyHasTrigger = !!(bodyRack?.triggers && bodyRack.triggers.length > 0)
    const bodyHasEffect = !!(bodyRack?.effects && bodyRack.effects.length > 0)
    const bodyHasNote = !!(bodyRack && bodyRack.note != null)
    const bodyHasInstrument = !!(bodyRack && bodyRack.instrument != null)

    if (category === 'note') {
      const id = selectedBodyId && bodyHasNote ? bodyRack!.note : globalRack.note
      const cs = getControlSetById(id)
      if (!cs) return null
      return { cs, slotKey: selectedBodyId && bodyHasNote ? `b:${selectedBodyId}:note` : 'g:note' }
    }
    if (category === 'instrument') {
      const id = selectedBodyId && bodyHasInstrument ? bodyRack!.instrument : globalRack.instrument
      const cs = getControlSetById(id)
      if (!cs) return null
      return { cs, slotKey: selectedBodyId && bodyHasInstrument ? `b:${selectedBodyId}:instrument` : 'g:instrument' }
    }
    if (category === 'trigger') {
      const list = selectedBodyId && bodyHasTrigger ? bodyRack!.triggers! : globalRack.triggers
      const id = list[0]
      const cs = getControlSetById(id)
      if (!cs) return null
      return { cs, slotKey: selectedBodyId && bodyHasTrigger ? `b:${selectedBodyId}:trigger:0` : 'g:trigger:0' }
    }
    const list = selectedBodyId && bodyHasEffect ? bodyRack!.effects! : globalRack.effects
    const id = list[0]
    const cs = getControlSetById(id)
    if (!cs) return null
    return { cs, slotKey: selectedBodyId && bodyHasEffect ? `b:${selectedBodyId}:effect:0` : 'g:effect:0' }
  }

  function saveCurrentAsUserPreset() {
    const active = activeSlot()
    if (!active) {
      window.alert(`No active ${CATEGORY_LABELS[category].toLowerCase()} slot to save.`)
      return
    }
    const name = window.prompt('User preset name', `${active.cs.name} Copy`)
    if (!name?.trim()) return
    const override = rackParamOverrides[active.slotKey] ?? {}
    saveUserControlSet({
      name: name.trim(),
      icon: active.cs.icon,
      color: active.cs.color,
      category: active.cs.category,
      description: `User preset saved from ${selectedBodyId ? 'body' : 'global'} rack.\nBase: ${active.cs.name}`,
      params: { ...active.cs.params, ...override },
    })
  }

  function exportPresets() {
    const blob = new Blob([exportUserControlSets()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'planet-synth-user-control-sets.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function importPresets(file: File | null | undefined) {
    if (!file) return
    try {
      const count = importUserControlSets(await file.text())
      window.alert(`Imported ${count} user preset${count === 1 ? '' : 's'}.`)
    } catch (e) {
      window.alert(`Import failed: ${String(e)}`)
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function savePresetsToFolder() {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker
    if (!picker) {
      window.alert('Folder save is not supported in this browser. Use Export instead.')
      return
    }
    try {
      const dir = await picker({ mode: 'readwrite' })
      const file = await dir.getFileHandle(USER_CONTROL_SET_FILE, { create: true })
      const writable = await file.createWritable()
      await writable.write(exportUserControlSets())
      await writable.close()
      window.alert(`Saved ${USER_CONTROL_SET_FILE}`)
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') window.alert(`Folder save failed: ${String(e)}`)
    }
  }

  async function loadPresetsFromFolder() {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker
    if (!picker) {
      window.alert('Folder load is not supported in this browser. Use Import instead.')
      return
    }
    try {
      const dir = await picker({ mode: 'read' })
      const file = await dir.getFileHandle(USER_CONTROL_SET_FILE)
      const count = importUserControlSets(await (await file.getFile()).text())
      window.alert(`Loaded ${count} user preset${count === 1 ? '' : 's'} from folder.`)
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') window.alert(`Folder load failed: ${String(e)}`)
    }
  }

  const groupLabelStyle: CSSProperties = {
    fontSize: 8,
    fontWeight: 800,
    color: t.textDim,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginTop: 4,
    marginBottom: 1,
  }
  const actionBtn: CSSProperties = {
    height: 22,
    minWidth: 24,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    fontSize: 8,
    fontWeight: 700,
    color: t.textMid,
    background: t.sectionBg,
    border: `0.5px solid ${t.panelBorder}`,
    borderRadius: 4,
    padding: '0 6px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
  const hintPill: CSSProperties = {
    height: 22,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '0 7px',
    borderRadius: 5,
    border: `0.5px solid ${t.panelBorder}`,
    background: t.cardBg,
    color: t.textMid,
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <SectionHeader label={CATEGORY_LABELS[category]} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <div
            style={{ ...hintPill, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
            title="ドラッグしてラックにアサイン。ダブルクリックで選択 body へ即追加。"
          >
            <span style={{ color: t.accent }}>↖</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Rack assign</span>
          </div>
          <button onClick={saveCurrentAsUserPreset} style={actionBtn} title="Save current rack slot as a user preset">
            <SaveIcon size={12} />
          </button>
          <button onClick={exportPresets} style={actionBtn} title="Export user presets">
            <Download size={12} />
          </button>
          <button onClick={() => fileInputRef.current?.click()} style={actionBtn} title="Import user presets">
            <Upload size={12} />
          </button>
          <button onClick={() => { void savePresetsToFolder() }} style={actionBtn} title="Save user presets to folder">
            <SaveIcon size={12} />
            <span style={{ fontSize: 7 }}>dir</span>
          </button>
          <button onClick={() => { void loadPresetsFromFolder() }} style={actionBtn} title="Load user presets from folder">
            <FolderOpen size={12} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={e => { void importPresets(e.target.files?.[0]) }}
            style={{ display: 'none' }}
          />
        </div>

        <div style={groupLabelStyle}>Default</div>
        {defaultSets.map(cs => (
          <ControlSetCard key={cs.id} cs={cs} globalRack={globalRack} />
        ))}
        <div style={groupLabelStyle}>User Presets</div>
        {userSets.length === 0 ? (
          <div style={{ fontSize: 9, color: t.textDim, padding: '5px 2px 8px', lineHeight: 1.4 }}>
            まだUser presetはありません。rackの現在値をSave currentで保存できます。
          </div>
        ) : userSets.map(cs => (
          <ControlSetCard key={cs.id} cs={cs} globalRack={globalRack} />
        ))}
      </div>
    </div>
  )
}

function RailButton({ active, title, onClick, children }: {
  active: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  const t = useTheme()
  const [hovered, setHovered] = useState(false)
  const mono = t.activeBg === '#111' || t.activeBg === '#f7f7f7'
  const monoActiveText = t.activeBg === '#111' ? '#fff' : '#050505'
  return (
    <div
      style={{ position: 'relative', width: 28, height: 28, marginTop: 4, flexShrink: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        title={title}
        onClick={onClick}
        style={{
          width: 28, height: 28,
          border: 'none', borderRadius: mono ? 1 : 5,
          background: active ? t.activeBg : 'transparent',
          color: active ? (mono ? monoActiveText : '#2563eb') : t.textMid,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {children}
      </button>
      {hovered && (
        <div style={{
          position: 'absolute',
          left: 32,
          top: '50%',
          transform: 'translateY(-50%)',
          padding: '4px 7px',
          borderRadius: 5,
          border: `0.5px solid ${t.panelBorder}`,
          background: t.panelBg,
          color: t.text,
          boxShadow: '0 6px 18px rgba(0,0,0,0.28)',
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 50,
        }}>
          {title}
        </div>
      )}
    </div>
  )
}

/** Thin horizontal divider for the icon rail. */
function RailDivider() {
  const t = useTheme()
  return (
    <div style={{
      width: 18, height: '0.5px',
      background: t.divider,
      margin: '5px 0',
      flexShrink: 0,
    }} />
  )
}

// ── Help Panel ────────────────────────────────────────────────────────────────

function HelpPanel() {
  const t = useTheme()
  const sections = [
    {
      title: 'Canvas',
      items: [
        'Left drag: place the selected body tool.',
        'Right drag / middle drag: pan.',
        'Mouse wheel: zoom.',
        'S / P: switch Sun / Planet placement.',
      ],
    },
    {
      title: 'Rack',
      items: [
        'Drag control sets from the left panel into rack slots.',
        'Use UNIQUE to detach a gray inherited slot.',
        'Expand a slot to edit its detailed parameters.',
      ],
    },
    {
      title: 'Wave Lab',
      items: [
        'Wave Lab instrument reads the body trail and resynthesizes it as a wavetable.',
        'X / Y / r / theta / spd choose the orbit signals used for the waveform.',
      ],
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <SectionHeader label="Help" />
      <div style={{ padding: 12, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{
          padding: 10,
          border: `0.5px solid ${t.panelBorder}`,
          borderRadius: 6,
          background: t.sectionBg,
          color: t.textMid,
          fontSize: 11,
          lineHeight: 1.45,
        }}>
          Planet Synth quick reference.
        </div>
        {sections.map(section => (
          <div key={section.title} style={{
            border: `0.5px solid ${t.panelBorder}`,
            borderRadius: 6,
            background: t.sectionBg,
            padding: 10,
          }}>
            <div style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: t.text,
              marginBottom: 7,
            }}>
              {section.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {section.items.map(item => (
                <div key={item} style={{ display: 'flex', gap: 7, color: t.textMid, fontSize: 10.5, lineHeight: 1.35 }}>
                  <span style={{ color: '#7c3aed', flexShrink: 0 }}>•</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Universe Preset Panel ─────────────────────────────────────────────────────

function UniversePresetPanel() {
  const t = useTheme()
  const bodies                = usePlanetStore(s => s.bodies)
  const simParams             = usePlanetStore(s => s.simParams)
  const applyPreset           = usePlanetStore(s => s.applyPreset)
  const resetBodyRacksToDefaults = useControlSetStore(s => s.resetBodyRacksToDefaults)
  const [userPresets, setUserPresets] = useState<UserUniversePreset[]>(() => loadUserUniversePresets())
  const [saveName, setSaveName] = useState('')

  function handleApply(preset: { bodies: typeof UNIVERSE_PRESETS[0]['bodies']; simParams: typeof UNIVERSE_PRESETS[0]['simParams'] }) {
    applyPreset([...preset.bodies], preset.simParams)
    resetBodyRacksToDefaults()
  }

  function handleDeleteUser(id: string) {
    const next = userPresets.filter(p => p.id !== id)
    setUserPresets(next)
    saveUserUniversePresets(next)
  }

  function handleSaveCurrent() {
    const name = saveName.trim() || `Universe ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    const entry: UserUniversePreset = {
      id: `universe-${Date.now()}`,
      name,
      description: `${bodies.length} bodies`,
      icon: '✦',
      bodies: bodies.map(b => ({ ...b })),
      simParams: { ...simParams },
      createdAt: Date.now(),
    }
    const next = [entry, ...userPresets]
    setUserPresets(next)
    saveUserUniversePresets(next)
    setSaveName('')
  }

  const btnBase: React.CSSProperties = {
    width: '100%', border: `0.5px solid ${t.panelBorder}`, borderRadius: 7,
    background: t.sectionBg, cursor: 'pointer', padding: '8px 10px',
    textAlign: 'left', fontFamily: 'inherit', marginBottom: 6,
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <SectionHeader label="Universe Presets" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        <div style={{
          border: `0.5px solid ${t.panelBorder}`,
          borderRadius: 7,
          background: t.sectionBg,
          padding: 8,
          marginBottom: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.10em' }}>
            Save Current
          </div>
          <input
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            placeholder="Preset name"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: `0.5px solid ${t.panelBorder}`,
              borderRadius: 5,
              background: t.inputBg,
              color: t.inputText,
              padding: '5px 7px',
              fontSize: 10,
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={handleSaveCurrent}
            style={{
              border: '0.5px solid rgba(139,92,246,0.75)',
              borderRadius: 5,
              background: 'rgba(124,58,237,0.82)',
              color: '#ffffff',
              cursor: 'pointer',
              padding: '5px 7px',
              fontSize: 10,
              fontWeight: 800,
              fontFamily: 'inherit',
              boxShadow: '0 0 10px rgba(124,58,237,0.22)',
            }}
          >
            Save Current Universe
          </button>
        </div>

        {/* ── Built-in (hardcoded) ─────────────────────────────────────────── */}
        <div style={{ fontSize: 8, fontWeight: 700, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 5 }}>
          Built-in
        </div>
        {UNIVERSE_PRESETS.map(preset => (
          <button
            key={preset.id}
            onClick={() => handleApply(preset)}
            style={btnBase}
            onMouseEnter={e => (e.currentTarget.style.background = `${t.accent}14`)}
            onMouseLeave={e => (e.currentTarget.style.background = t.sectionBg)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, lineHeight: 1 }}>{preset.icon ?? '⊙'}</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: t.text }}>{preset.name}</div>
                {preset.description && (
                  <div style={{ fontSize: 8.5, color: t.textMid, marginTop: 1 }}>{preset.description}</div>
                )}
              </div>
            </div>
          </button>
        ))}

        {/* ── User-saved ───────────────────────────────────────────────────── */}
        {userPresets.length > 0 && (
          <>
            <div style={{ fontSize: 8, fontWeight: 700, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.10em', margin: '10px 0 5px' }}>
              My Presets
            </div>
            {userPresets.map(preset => (
              <div key={preset.id} style={{ ...btnBase, display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px' }}>
                <button
                  onClick={() => handleApply(preset)}
                  style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', padding: 0 }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{preset.name}</div>
                  <div style={{ fontSize: 8, color: t.textDim }}>{new Date(preset.createdAt).toLocaleDateString()}</div>
                </button>
                <button
                  onClick={() => handleDeleteUser(preset.id)}
                  style={{ width: 18, height: 18, border: 'none', background: 'none', cursor: 'pointer', color: t.textDim, fontSize: 11, padding: 0, lineHeight: 1 }}
                >×</button>
              </div>
            ))}
          </>
        )}

        <div style={{ fontSize: 9, color: t.textDim, lineHeight: 1.5, marginTop: 10 }}>
          プリセット適用時は現在の body 配置を置き換え、シミュレーションを再初期化します。
        </div>
      </div>
    </div>
  )
}

// ── Planet Preset (individual body) panel ─────────────────────────────────────

// Planet preset storage is managed by src/presets/planet/index.ts
// Types: UserPlanetPreset (imported from src/presets/types.ts)

function PlanetPresetPanel() {
  const t = useTheme()
  const { bodies, selectedBodyId } = usePlanetStore()
  const updateBody = usePlanetStore(s => s.updateBody)
  const { getBodyEffectiveRack, setBodySlot, addBodyTrigger, addBodyEffect, clearBodyRack } = useControlSetStore()

  const [builtinPresets]                        = useState(() => PLANET_PRESETS)
  const [userPresets, setUserPresets]           = useState<UserPlanetPreset[]>(() => loadUserPlanetPresets())
  const [saveName, setSaveName] = useState('')

  const selectedBody = bodies.find(b => b.id === selectedBodyId) ?? null

  function handleSave() {
    if (!selectedBody) return
    const rack = getBodyEffectiveRack(selectedBody.id)
    const name = saveName.trim() || selectedBody.name
    const entry: UserPlanetPreset = {
      id: `bp-${Date.now()}`,
      name,
      createdAt: Date.now(),
      bodyInfo: {
        name:         selectedBody.name,
        type:         selectedBody.type as 'sun' | 'planet',
        mass:         selectedBody.mass,
        color:        selectedBody.color,
        muted:        selectedBody.muted,
        volume:       selectedBody.volume,
        midiChannel:  selectedBody.midiChannel,
        midiNote:     selectedBody.midiNote,
        midiVelocity: selectedBody.midiVelocity,
      },
      rack: {
        triggers:   [...rack.triggers],
        instrument: rack.instrument,
        effects:    [...rack.effects],
      },
    }
    const next = [entry, ...userPresets]
    setUserPresets(next)
    saveUserPlanetPresets(next)
    setSaveName('')
  }

  function handleApply(preset: UserPlanetPreset | typeof PLANET_PRESETS[0]) {
    if (!selectedBodyId) return
    updateBody(selectedBodyId, {
      name:         preset.bodyInfo.name,
      mass:         preset.bodyInfo.mass,
      color:        preset.bodyInfo.color,
      muted:        preset.bodyInfo.muted,
      volume:       preset.bodyInfo.volume,
      midiChannel:  preset.bodyInfo.midiChannel,
      midiNote:     preset.bodyInfo.midiNote,
      midiVelocity: preset.bodyInfo.midiVelocity,
    })
    clearBodyRack(selectedBodyId)
    setBodySlot(selectedBodyId, 'instrument', preset.rack.instrument)
    for (const trig of preset.rack.triggers) addBodyTrigger(selectedBodyId, trig)
    for (const eff  of preset.rack.effects)  addBodyEffect(selectedBodyId, eff)
  }

  function handleDelete(id: string) {
    const next = userPresets.filter(p => p.id !== id)
    setUserPresets(next)
    saveUserPlanetPresets(next)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <SectionHeader label="Planet Presets" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>

        {/* ── Save section ─────────────────────────────────────────────────── */}
        <div style={{
          marginBottom: 10,
          padding: '8px',
          background: t.sectionBg,
          borderRadius: 7,
          border: `0.5px solid ${t.panelBorder}`,
        }}>
          {selectedBody ? (
            <>
              <div style={{ fontSize: 10, color: t.textMid, marginBottom: 6 }}>
                Save{' '}
                <span style={{ color: selectedBody.color, fontWeight: 700 }}>
                  {selectedBody.name}
                </span>{' '}
                as preset
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                  placeholder={selectedBody.name}
                  style={{
                    flex: 1,
                    background: t.inputBg,
                    border: `0.5px solid ${t.btnBorder}`,
                    borderRadius: 5,
                    color: t.inputText,
                    fontSize: 11,
                    padding: '4px 6px',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={handleSave}
                  style={{
                    background: 'rgba(6,182,212,0.15)',
                    border: `0.5px solid rgba(6,182,212,0.4)`,
                    borderRadius: 5,
                    color: '#06b6d4',
                    fontSize: 11,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Save
                </button>
              </div>
              <div style={{ fontSize: 9, color: t.textDim, marginTop: 5, lineHeight: 1.45 }}>
                body情報 + rack（コントロールセット名のみ、パラメータ値は含まない）
              </div>
            </>
          ) : (
            <div style={{ fontSize: 10, color: t.textDim }}>
              ボディを選択するとプリセットとして保存できます
            </div>
          )}
        </div>

        {/* ── Built-in presets ─────────────────────────────────────────────── */}
        {builtinPresets.length > 0 && (
          <>
            <div style={{ fontSize: 8, fontWeight: 700, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 5 }}>
              Built-in
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
              {builtinPresets.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => handleApply(preset)}
                  disabled={!selectedBodyId}
                  style={{
                    textAlign: 'left', fontFamily: 'inherit', cursor: selectedBodyId ? 'pointer' : 'default',
                    opacity: selectedBodyId ? 1 : 0.4,
                    background: t.sectionBg, border: `0.5px solid ${t.panelBorder}`,
                    borderRadius: 6, padding: '6px 8px',
                  }}
                  onMouseEnter={e => { if (selectedBodyId) e.currentTarget.style.background = `${t.accent}14` }}
                  onMouseLeave={e => (e.currentTarget.style.background = t.sectionBg)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 12 }}>{preset.icon ?? '●'}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{preset.name}</span>
                  </div>
                  {preset.description && (
                    <div style={{ fontSize: 8.5, color: t.textMid, marginTop: 2 }}>{preset.description}</div>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── User-saved presets ────────────────────────────────────────────── */}
        {userPresets.length > 0 && (
          <div style={{ fontSize: 8, fontWeight: 700, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 5 }}>
            My Presets
          </div>
        )}
        {userPresets.length === 0 && builtinPresets.length === 0 ? (
          <div style={{ fontSize: 9.5, color: t.textDim, textAlign: 'center', marginTop: 20 }}>
            保存されたプリセットはありません
          </div>
        ) : userPresets.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {userPresets.map(preset => (
              <div
                key={preset.id}
                style={{
                  border: `0.5px solid ${t.panelBorder}`,
                  borderRadius: 7,
                  padding: '8px',
                  background: t.sectionBg,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 3 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{preset.name}</div>
                  <button
                    onClick={() => handleDelete(preset.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: t.textDim,
                      fontSize: 14,
                      lineHeight: 1,
                      padding: '0 2px',
                      marginTop: -1,
                    }}
                    title="Delete preset"
                  >
                    ×
                  </button>
                </div>
                <div style={{ fontSize: 9, color: t.textMid, lineHeight: 1.5, marginBottom: 6 }}>
                  <span>{preset.bodyInfo.type}</span>
                  {' · '}
                  <span>mass {preset.bodyInfo.mass}</span>
                  {' · '}
                  <span>note {preset.bodyInfo.midiNote}</span>
                  <br />
                  <span>inst: <span style={{ color: t.text }}>{preset.rack.instrument ?? 'none'}</span></span>
                  {preset.rack.triggers.length > 0 && (
                    <><br /><span>trg: <span style={{ color: t.text }}>{preset.rack.triggers.join(', ')}</span></span></>
                  )}
                  {preset.rack.effects.length > 0 && (
                    <><br /><span>fx: <span style={{ color: t.text }}>{preset.rack.effects.join(', ')}</span></span></>
                  )}
                  <br />
                  <span style={{ color: t.textDim }}>{new Date((preset as UserPlanetPreset).createdAt).toLocaleDateString()}</span>
                </div>
                {selectedBodyId && (
                  <button
                    onClick={() => handleApply(preset)}
                    style={{
                      width: '100%',
                      background: 'rgba(6,182,212,0.08)',
                      border: `0.5px solid rgba(6,182,212,0.3)`,
                      borderRadius: 5,
                      color: '#06b6d4',
                      fontSize: 10,
                      padding: '3px 6px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(6,182,212,0.15)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(6,182,212,0.08)')}
                  >
                    Apply to selected body
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── ADSR panel ────────────────────────────────────────────────────────────────

function PlanetAdsrPanel() {
  const { bodies, selectedBodyId, simParams, updateSimParams } = usePlanetStore()
  const previewBody = bodies.find(b => b.id === selectedBodyId) ?? bodies.find(b => b.type === 'planet') ?? bodies[0]
  const orbitPreview = previewBody ? computeOrbitAdsr(previewBody, bodies, simParams.G) : null

  useEffect(() => {
    if (simParams.adsrMode === 'off') {
      setGlobalAdsr(ADSR_OFF)
      return
    }
    if (simParams.adsrMode !== 'manual') return
    setGlobalAdsr({
      attack: simParams.adsrAttack,
      decay: simParams.adsrDecay,
      sustain: simParams.adsrSustain,
      release: simParams.adsrRelease,
    })
  }, [simParams.adsrMode, simParams.adsrAttack, simParams.adsrDecay, simParams.adsrSustain, simParams.adsrRelease])

  function updateAdsr(patch: Partial<Pick<typeof simParams, 'adsrAttack' | 'adsrDecay' | 'adsrSustain' | 'adsrRelease'>>) {
    updateSimParams(patch)
    if (simParams.adsrMode !== 'manual') return
    setGlobalAdsr({
      attack: patch.adsrAttack ?? simParams.adsrAttack,
      decay: patch.adsrDecay ?? simParams.adsrDecay,
      sustain: patch.adsrSustain ?? simParams.adsrSustain,
      release: patch.adsrRelease ?? simParams.adsrRelease,
    })
  }

  const t = useTheme()
  const smallBtnStyle: React.CSSProperties = {
    flex: 1, padding: '5px 7px', background: t.inputBg, border: 'none',
    borderRadius: 4, cursor: 'pointer', fontSize: 10, color: t.textMid, fontFamily: 'inherit',
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <SectionHeader label="ADSR" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        <SettingsGroup label="Mode">
          <div style={{ display: 'flex', gap: 5 }}>
            {([
              ['off', 'Off'],
              ['manual', 'Manual'],
              ['orbit', 'Orbit'],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => updateSimParams({ adsrMode: mode })}
                style={{
                  flex: 1,
                  padding: '6px 4px',
                  border: simParams.adsrMode === mode ? '0.5px solid rgba(139,92,246,0.45)' : '0.5px solid transparent',
                  borderRadius: 5,
                  background: simParams.adsrMode === mode ? 'rgba(139,92,246,0.15)' : t.inputBg,
                  color: simParams.adsrMode === mode ? '#7c3aed' : t.textMid,
                  cursor: 'pointer',
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: 'inherit',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 9, color: t.textDim, lineHeight: 1.45 }}>
            {simParams.adsrMode === 'manual'
              ? '全bodyに同じADSRを適用します。'
              : simParams.adsrMode === 'orbit'
                ? '各bodyの軌道から Attack / Decay / Sustain / Release をトリガー時に計算します。'
                : 'ADSRを無効化し、音量ゲートは即時に開閉します。'}
          </div>
        </SettingsGroup>
        <SettingsGroup label="Envelope">
          <NumberSetting
            label="Attack"
            value={simParams.adsrAttack}
            min={0}
            max={3}
            step={0.005}
            onChange={adsrAttack => updateAdsr({ adsrAttack })}
          />
          <NumberSetting
            label="Decay"
            value={simParams.adsrDecay}
            min={0}
            max={3}
            step={0.01}
            onChange={adsrDecay => updateAdsr({ adsrDecay })}
          />
          <NumberSetting
            label="Sustain"
            value={simParams.adsrSustain}
            min={0}
            max={1}
            step={0.01}
            onChange={adsrSustain => updateAdsr({ adsrSustain })}
          />
          <NumberSetting
            label="Release"
            value={simParams.adsrRelease}
            min={0}
            max={5}
            step={0.01}
            onChange={adsrRelease => updateAdsr({ adsrRelease })}
          />
          <div style={{ fontSize: 9, color: t.textDim, lineHeight: 1.45, paddingLeft: 76 }}>
            {simParams.adsrMode === 'manual'
              ? 'サンプルの再トリガー、ランデブー、ループ停止時に共通でかかる音量エンベロープです。'
              : simParams.adsrMode === 'orbit'
                ? 'Orbitモード中は手動値は保存されますが、発音時はbodyごとの軌道ADSRが優先されます。'
                : 'Offではこの手動値は保存されますが、発音時はADSR_OFFが優先されます。'}
          </div>
        </SettingsGroup>
        {simParams.adsrMode === 'off' ? (
          <SettingsGroup label="Bypass">
            <div style={{ fontSize: 9, color: t.textDim, lineHeight: 1.45 }}>
              Attack=0 / Decay=0 / Sustain=1 / Release=0 として再生します。サンプル本体の波形はそのままです。
            </div>
          </SettingsGroup>
        ) : simParams.adsrMode === 'manual' ? (
          <SettingsGroup label="Quick Shape">
            <button onClick={() => updateAdsr({ adsrAttack: 0.005, adsrDecay: 0.1, adsrSustain: 1, adsrRelease: 0.3 })} style={smallBtnStyle}>Percussive</button>
            <button onClick={() => updateAdsr({ adsrAttack: 0.35, adsrDecay: 0.4, adsrSustain: 0.75, adsrRelease: 1.2 })} style={smallBtnStyle}>Soft fade</button>
            <button onClick={() => updateAdsr({ adsrAttack: 1.2, adsrDecay: 0.8, adsrSustain: 0.6, adsrRelease: 2.4 })} style={smallBtnStyle}>Long pad</button>
          </SettingsGroup>
        ) : (
          <SettingsGroup label="Orbit Preview">
            <div style={{ fontSize: 10, color: t.textMid, fontWeight: 700 }}>
              {previewBody ? previewBody.name : 'No body'}
            </div>
            {orbitPreview ? (
              <>
                <AdsrReadout label="A" value={orbitPreview.attack} />
                <AdsrReadout label="D" value={orbitPreview.decay} />
                <AdsrReadout label="S" value={orbitPreview.sustain} />
                <AdsrReadout label="R" value={orbitPreview.release} />
              </>
            ) : (
              <div style={{ fontSize: 9, color: t.textDim }}>Select or add a body to preview orbit ADSR.</div>
            )}
            <div style={{ fontSize: 9, color: t.textDim, lineHeight: 1.45 }}>
              Attack=近点速度、Decay=離心率、Sustain=近点/遠点比、Release=公転周期から近似します。
            </div>
          </SettingsGroup>
        )}
      </div>
    </div>
  )
}

function AdsrReadout({ label, value }: { label: string; value: number }) {
  const t = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 68, textAlign: 'right', fontSize: 10, color: t.textMid, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: t.tagBg, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(4, Math.min(100, value / 5 * 100))}%`, height: '100%', background: 'rgba(124,58,237,0.55)' }} />
      </div>
      <span style={{ width: 40, textAlign: 'right', fontSize: 9, color: t.textMid, fontFamily: 'monospace' }}>
        {value.toFixed(label === 'S' ? 2 : 3)}
      </span>
    </div>
  )
}

// ── Localization Panel ────────────────────────────────────────────────────────

function LocalizationPanel() {
  const t = useTheme()
  const { bodies, simParams, updateSimParams } = usePlanetStore()

  const spMode   = simParams.standpointMode
  const spBodyId = simParams.standpointBodyId
  const dirOn    = simParams.standpointDirectional

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: t.textMid, width: 68, textAlign: 'right', flexShrink: 0,
  }
  const inputStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'monospace',
    border: 'none', borderRadius: 4, padding: '3px 6px',
    background: t.inputBg, color: t.inputText,
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <SectionHeader label="Localization" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>

        {/* ── Standpoint ── */}
        <SettingsGroup label="Standpoint">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
            <input type="checkbox" checked={spMode}
              onChange={e => updateSimParams({ standpointMode: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.text, fontWeight: 600 }}>
              Enable distance volume
            </span>
          </label>

          {spMode && (<>
            {/* Body picker */}
            <label style={rowStyle}>
              <span style={labelStyle}>Body</span>
              <select
                value={spBodyId ?? ''}
                onChange={e => updateSimParams({ standpointBodyId: e.target.value || null })}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="">— None —</option>
                {bodies.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
            <NumberSetting label="Max dist" value={simParams.standpointMaxDist} min={10} step={50}
              onChange={standpointMaxDist => updateSimParams({ standpointMaxDist })} />
            <NumberSetting label="Min vol" value={simParams.standpointMinVol} min={0} max={1} step={0.05}
              onChange={standpointMinVol => updateSimParams({ standpointMinVol })} />
          </>)}
        </SettingsGroup>

        {/* ── Directional ── */}
        <SettingsGroup label="Directional">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
            <input type="checkbox" checked={simParams.showStandpointVisual !== false}
              onChange={e => updateSimParams({ showStandpointVisual: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.text, fontWeight: 600 }}>
              Show on canvas
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
            <input type="checkbox" checked={dirOn}
              onChange={e => updateSimParams({ standpointDirectional: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.text, fontWeight: 600 }}>
              Enable cone attenuation
            </span>
          </label>

          {dirOn && (<>
            {/* Facing mode */}
            <label style={rowStyle}>
              <span style={labelStyle}>Facing</span>
              <select
                value={simParams.standpointFacing}
                onChange={e => updateSimParams({ standpointFacing: e.target.value as 'velocity' | 'manual' })}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="velocity">Velocity dir.</option>
                <option value="manual">Manual angle</option>
              </select>
            </label>

            {/* Manual angle — only shown in manual mode */}
            {simParams.standpointFacing === 'manual' && (
              <label style={rowStyle}>
                <span style={labelStyle}>Angle °</span>
                <input
                  type="range" min={0} max={360} step={1}
                  value={simParams.standpointFacingAngle}
                  onChange={e => updateSimParams({ standpointFacingAngle: Number(e.target.value) })}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <span style={{ fontSize: 10, color: t.textMid, fontFamily: 'monospace', width: 28, flexShrink: 0, textAlign: 'right' }}>
                  {simParams.standpointFacingAngle}
                </span>
              </label>
            )}

            {/* Cone width */}
            <label style={rowStyle}>
              <span style={labelStyle}>Cone °</span>
              <input
                type="range" min={0} max={360} step={5}
                value={simParams.standpointConeWidth}
                onChange={e => updateSimParams({ standpointConeWidth: Number(e.target.value) })}
                style={{ flex: 1, minWidth: 0 }}
              />
              <span style={{ fontSize: 10, color: t.textMid, fontFamily: 'monospace', width: 28, flexShrink: 0, textAlign: 'right' }}>
                {simParams.standpointConeWidth}
              </span>
            </label>

            {/* Outer volume */}
            <NumberSetting label="Outer vol" value={simParams.standpointOuterVol} min={0} max={1} step={0.05}
              onChange={standpointOuterVol => updateSimParams({ standpointOuterVol })} />

            <div style={{ fontSize: 9, color: t.textDim, lineHeight: 1.4 }}>
              {simParams.standpointFacing === 'velocity'
                ? 'コーンはスタンドポイント天体の速度方向を向く。'
                : 'コーンは指定した角度を向く（0° = 右）。'}
            </div>
          </>)}

          {!dirOn && (
            <div style={{ fontSize: 9, color: t.textDim, lineHeight: 1.4 }}>
              指向性 ON でスタンドポイントが向いている方向の音量を上げる。コーン外は Outer vol まで減衰。
            </div>
          )}
        </SettingsGroup>

        {/* ── Stereo / front-back ── */}
        <SettingsGroup label="Stereo Field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
            <input type="checkbox" checked={simParams.standpointStereo}
              onChange={e => updateSimParams({ standpointStereo: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.text, fontWeight: 600 }}>
              Enable L/R pan
            </span>
          </label>
          {simParams.standpointStereo && (
            <NumberSetting label="Width" value={simParams.standpointStereoWidth ?? 1} min={0} max={1} step={0.05}
              onChange={standpointStereoWidth => updateSimParams({ standpointStereoWidth })} />
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
            <input type="checkbox" checked={simParams.standpointFrontBack}
              onChange={e => updateSimParams({ standpointFrontBack: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.text, fontWeight: 600 }}>
              Enable front/back volume
            </span>
          </label>
          {simParams.standpointFrontBack && (
            <NumberSetting label="Rear vol" value={simParams.standpointRearVol} min={0} max={1} step={0.05}
              onChange={standpointRearVol => updateSimParams({ standpointRearVol })} />
          )}
          <div style={{ fontSize: 9, color: t.textDim, lineHeight: 1.4 }}>
            L/R はスタンドポイントの向きに対する左右位置でパンします。Front/back は背後の音量を Rear vol まで下げます。
          </div>
        </SettingsGroup>

      </div>
    </div>
  )
}

// ── MIDI Panel ────────────────────────────────────────────────────────────────

function MidiPanel() {
  const t = useTheme()
  const [outputs,   setOutputs]   = useState<MidiPortInfo[]>([])
  const [inputs,    setInputs]    = useState<MidiPortInfo[]>([])
  const [selOutId,  setSelOutId]  = useState<string | null>(null)
  const [ready,     setReady]     = useState(false)
  const [testNote,  setTestNote]  = useState(60)

  // Refresh port list every 1.5 s (devices can connect/disconnect)
  useEffect(() => {
    function refresh() {
      setOutputs(getMidiOutputs())
      setInputs(getMidiInputs())
      setSelOutId(getSelectedOutputId())
      setReady(isMidiReady())
    }
    refresh()
    const id = window.setInterval(refresh, 1500)
    return () => window.clearInterval(id)
  }, [])

  function handleOutSelect(id: string | null) {
    setSelectedOutputId(id)
    setSelOutId(id)
  }

  function handleTest() {
    sendMidiNote(1, testNote, 100, 300)
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
  }
  const _labelStyle: React.CSSProperties = {
    fontSize: 8, fontWeight: 700, color: t.textDim,
    textTransform: 'uppercase', letterSpacing: '0.09em',
    width: 40, flexShrink: 0,
  }
  const selectStyle: React.CSSProperties = {
    flex: 1, fontSize: 9, border: `0.5px solid ${t.btnBorder}`,
    borderRadius: 4, padding: '3px 5px',
    background: t.inputBg, color: t.inputText, fontFamily: 'inherit',
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <SectionHeader label="MIDI" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>

        {/* ── Status ────────────────────────────────────────────────────── */}
        <div style={{ ...rowStyle, marginBottom: 12 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: ready ? '#4ade80' : '#6b7280',
            boxShadow: ready ? '0 0 6px #4ade80' : 'none',
          }} />
          <span style={{ fontSize: 10, color: ready ? '#4ade80' : t.textDim, fontWeight: 700 }}>
            {ready ? 'Web MIDI Ready' : 'MIDI Unavailable'}
          </span>
        </div>

        {!ready && (
          <div style={{
            fontSize: 9, color: t.textDim, lineHeight: 1.6, marginBottom: 12,
            padding: '8px', background: t.sectionBg, borderRadius: 6,
            border: `0.5px solid ${t.panelBorder}`,
          }}>
            Chrome / Edge が必要です。<br />
            Safari は Web MIDI 非対応。<br />
            ページ読み込み時に許可ダイアログが表示されます。
          </div>
        )}

        {ready && (
          <>
            {/* ── Output port ─────────────────────────────────────────── */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: t.textMid, marginBottom: 6, letterSpacing: '0.05em' }}>
                OUTPUT PORT
              </div>
              {outputs.length === 0 ? (
                <div style={{ fontSize: 9, color: t.textDim, fontStyle: 'italic' }}>
                  出力ポートが見つかりません<br />
                  <span style={{ fontSize: 8 }}>Mac: Audio MIDI設定 → IAC Driver を有効化</span>
                </div>
              ) : (
                <select
                  value={selOutId ?? ''}
                  onChange={e => handleOutSelect(e.target.value || null)}
                  style={selectStyle}
                >
                  <option value="">すべてのポートに送信</option>
                  {outputs.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* ── Input ports (display only) ───────────────────────────── */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: t.textMid, marginBottom: 6, letterSpacing: '0.05em' }}>
                INPUT PORTS
              </div>
              {inputs.length === 0 ? (
                <div style={{ fontSize: 9, color: t.textDim, fontStyle: 'italic' }}>なし</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {inputs.map(inp => (
                    <div key={inp.id} style={{
                      fontSize: 9, color: t.textMid, padding: '3px 6px',
                      background: t.sectionBg, borderRadius: 4,
                      border: `0.5px solid ${t.panelBorder}`,
                    }}>
                      {inp.name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Test note ────────────────────────────────────────────── */}
            <div style={{
              padding: '8px', background: t.sectionBg, borderRadius: 6,
              border: `0.5px solid ${t.panelBorder}`,
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: t.textMid, marginBottom: 7, letterSpacing: '0.05em' }}>
                TEST NOTE
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number" value={testNote} min={0} max={127} step={1}
                  onChange={e => setTestNote(Math.max(0, Math.min(127, Number(e.target.value))))}
                  style={{ width: 44, fontSize: 10, fontFamily: 'monospace', textAlign: 'center', border: `0.5px solid ${t.btnBorder}`, borderRadius: 4, padding: '3px 4px', background: t.inputBg, color: t.inputText }}
                />
                <span style={{ fontSize: 9, color: t.textDim, minWidth: 26 }}>
                  {['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][testNote % 12]}
                  {Math.floor(testNote / 12) - 1}
                </span>
                <button
                  onClick={handleTest}
                  style={{
                    flex: 1, fontSize: 9, padding: '4px 8px',
                    background: 'rgba(74,222,128,0.12)',
                    border: '0.5px solid rgba(74,222,128,0.4)',
                    borderRadius: 4, color: '#4ade80', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(74,222,128,0.22)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(74,222,128,0.12)')}
                >
                  ▶ Send
                </button>
              </div>
              <div style={{ fontSize: 8, color: t.textDim, marginTop: 5 }}>
                ch 1 / vel 100 / 300ms
              </div>
            </div>

            {/* ── Hint ─────────────────────────────────────────────────── */}
            <div style={{ fontSize: 8.5, color: t.textDim, lineHeight: 1.6, marginTop: 12 }}>
              各ボディの CH / NOTE / VEL は右パネルの Inspector で個別に設定できます。
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CanvasSettingsPanel() {
  const t = useTheme()
  const settings = useCanvasSettingsStore()
  const update = settings.updateCanvasSettings
  const { simParams, updateSimParams } = usePlanetStore()
  const checkboxRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12 }
  const smallButtonStyle: React.CSSProperties = {
    padding: '4px 6px',
    fontSize: 10,
    color: t.textMid,
    background: t.inputBg,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }

  function handleBackgroundImageFile(file: File | undefined) {
    if (!file) return
    update({ canvasBackgroundImageUrl: URL.createObjectURL(file) })
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <SectionHeader label="Canvas Settings" />
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '10px 12px 12px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        alignContent: 'start',
        gap: 10,
      }}>
        <SettingsGroup label="UI">
          <label style={checkboxRowStyle}>
            <input type="checkbox" checked={simParams.simpleTheme}
              onChange={e => updateSimParams({ simpleTheme: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Simple (light) theme</span>
          </label>
          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={settings.monochromeMode}
              onChange={e => update({ monochromeMode: e.target.checked })}
            />
            <span style={{ fontSize: 10, color: t.textMid }}>Monochrome paper UI</span>
          </label>
          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={settings.monochromeInverted}
              onChange={e => update({ monochromeInverted: e.target.checked })}
            />
            <span style={{ fontSize: 10, color: t.textMid }}>Invert B/W</span>
          </label>
          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={settings.showModeBar}
              onChange={e => update({ showModeBar: e.target.checked })}
            />
            <span style={{ fontSize: 10, color: t.textMid }}>Show mode bar</span>
          </label>
        </SettingsGroup>
        <SettingsGroup label="Paper Canvas">
          <TextSetting label="Paper" value={settings.paperCanvasBackground}
            onChange={paperCanvasBackground => update({ paperCanvasBackground })} />
          <TextSetting label="Ink" value={settings.paperCanvasInk}
            onChange={paperCanvasInk => update({ paperCanvasInk })} />
          <NumberSetting label="Tone" value={settings.paperCanvasTone} min={0} max={1} step={0.05}
            onChange={paperCanvasTone => update({ paperCanvasTone })} />
          <NumberSetting label="Labels" value={settings.paperCanvasLabelOpacity} min={0} max={1} step={0.05}
            onChange={paperCanvasLabelOpacity => update({ paperCanvasLabelOpacity })} />
          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={settings.paperCanvasKeepBodyColors}
              onChange={e => update({ paperCanvasKeepBodyColors: e.target.checked })}
            />
            <span style={{ fontSize: 10, color: t.textMid }}>Keep body colors</span>
          </label>
        </SettingsGroup>
        <SettingsGroup label="Background Image">
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 10, color: t.textMid, paddingLeft: 12 }}>Image file</span>
            <input
              type="file"
              accept="image/*"
              onChange={e => handleBackgroundImageFile(e.target.files?.[0])}
              style={{ fontSize: 10, color: t.textMid, width: '100%' }}
            />
          </label>
          <TextSetting label="URL" value={settings.canvasBackgroundImageUrl}
            onChange={canvasBackgroundImageUrl => update({ canvasBackgroundImageUrl })} />
          <NumberSetting label="Opacity" value={settings.canvasBackgroundImageOpacity} min={0} max={1} step={0.05}
            onChange={canvasBackgroundImageOpacity => update({ canvasBackgroundImageOpacity })} />
          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={settings.canvasBackgroundImageColorInMonochrome}
              onChange={e => update({ canvasBackgroundImageColorInMonochrome: e.target.checked })}
            />
            <span style={{ fontSize: 10, color: t.textMid }}>Color in mono</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: t.textMid, width: 68, textAlign: 'right', flexShrink: 0 }}>Fit</span>
            <select
              value={settings.canvasBackgroundImageFit}
              onChange={e => update({ canvasBackgroundImageFit: e.target.value as 'cover' | 'contain' | 'stretch' })}
              style={{
                flex: 1, minWidth: 0, fontSize: 11,
                border: 'none', borderRadius: 4, padding: '3px 6px',
                background: t.inputBg, color: t.inputText, fontFamily: 'inherit',
              }}
            >
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="stretch">Stretch</option>
            </select>
          </label>
          <button
            onClick={() => update({ canvasBackgroundImageUrl: '' })}
            style={{ ...smallButtonStyle, marginLeft: 12, opacity: settings.canvasBackgroundImageUrl ? 1 : 0.45 }}
            disabled={!settings.canvasBackgroundImageUrl}
          >
            Clear image
          </button>
        </SettingsGroup>
        <SettingsGroup label="Drawing">
          <NumberSetting label="Circle r" value={settings.circleRadius} min={1} step={1} onChange={circleRadius => {
            update({ circleRadius })
          }} />
          <NumberSetting label="Stroke w" value={settings.strokeWidth} min={0} step={0.5} onChange={strokeWidth => update({ strokeWidth })} />
          <TextSetting label="Stroke" value={settings.stroke} onChange={stroke => update({ stroke })} />
          <TextSetting label="Fill" value={settings.fill} onChange={fill => update({ fill })} />
          <NumberSetting label="Point r" value={settings.pointSize} min={1} step={1} onChange={pointSize => update({ pointSize })} />
        </SettingsGroup>
        <SettingsGroup label="Orbit Lines">
          <NumberSetting label="Trail w" value={settings.orbitTrailStrokeWidth} min={0} step={0.1}
            onChange={orbitTrailStrokeWidth => update({ orbitTrailStrokeWidth })} />
          <NumberSetting label="Opacity" value={settings.orbitTrailOpacity} min={0} max={1} step={0.05}
            onChange={orbitTrailOpacity => update({ orbitTrailOpacity })} />
          <NumberSetting label="Dash" value={settings.orbitTrailDash} min={0} step={1}
            onChange={orbitTrailDash => update({ orbitTrailDash })} />
        </SettingsGroup>
        <SettingsGroup label="Placement">
          <NumberSetting label="Path span" value={settings.pathSpan} min={20} step={10} onChange={pathSpan => update({ pathSpan })} />
          <NumberSetting label="Zoom" value={settings.zoom} min={0.2} step={0.1} onChange={zoom => update({ zoom })} />
          <button
            onClick={() => update({ zoom: 1 })}
            style={{ ...smallButtonStyle, marginLeft: 12 }}
          >
            Reset zoom
          </button>
        </SettingsGroup>

        {/* Planet display settings */}
        <SettingsGroup label="Planet Display">
          <NumberSetting label="Trail len" value={simParams.trailLength} min={10} step={100}
            onChange={trailLength => updateSimParams({ trailLength })} />
          <label style={checkboxRowStyle}>
            <input type="checkbox" checked={simParams.showTrails}
              onChange={e => updateSimParams({ showTrails: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Show trails</span>
          </label>
          <label style={checkboxRowStyle}>
            <input type="checkbox" checked={simParams.showVelocityVectors}
              onChange={e => updateSimParams({ showVelocityVectors: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Velocity vectors</span>
          </label>
          <label style={checkboxRowStyle}>
            <input type="checkbox" checked={simParams.showPredictedOrbit}
              onChange={e => updateSimParams({ showPredictedOrbit: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Predicted orbit on drag</span>
          </label>
          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={settings.showCanvasBodyList}
              onChange={e => update({ showCanvasBodyList: e.target.checked })}
            />
            <span style={{ fontSize: 10, color: t.textMid }}>Canvas body list</span>
          </label>
          <label style={checkboxRowStyle}>
            <input type="checkbox" checked={simParams.bodyRadiusFromMass}
              onChange={e => updateSimParams({ bodyRadiusFromMass: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Size from mass</span>
          </label>
          <NumberSetting label="Planet rate" value={simParams.bodyRadiusMassScalePlanet} min={0} step={0.01}
            onChange={bodyRadiusMassScalePlanet => updateSimParams({ bodyRadiusMassScalePlanet })} />
          <NumberSetting label="Sun rate" value={simParams.bodyRadiusMassScaleSun} min={0} step={0.01}
            onChange={bodyRadiusMassScaleSun => updateSimParams({ bodyRadiusMassScaleSun })} />
          <label style={checkboxRowStyle}>
            <input type="checkbox" checked={simParams.showBodyNameCross ?? false}
              onChange={e => updateSimParams({ showBodyNameCross: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>✛ Cross prefix on name</span>
          </label>
        </SettingsGroup>

        <SettingsGroup label="Trigger Stars">
          <label style={checkboxRowStyle}>
            <input type="checkbox" checked={simParams.showTriggerStars}
              onChange={e => updateSimParams({ showTriggerStars: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Show trigger stars</span>
          </label>
          <label style={checkboxRowStyle}>
            <input type="checkbox"
              checked={(simParams.triggerStarShape ?? 'star') === 'dot'}
              onChange={e => updateSimParams({ triggerStarShape: e.target.checked ? 'dot' : 'star' })} />
            <span style={{ fontSize: 10, color: t.textMid }}>星屑を残す</span>
          </label>
          <NumberSetting label="Size" value={simParams.triggerStarSize} min={1} step={1}
            onChange={triggerStarSize => updateSimParams({ triggerStarSize })} />
          <NumberSetting label="Max count" value={simParams.triggerStarMaxCount} min={1} step={10}
            onChange={triggerStarMaxCount => updateSimParams({ triggerStarMaxCount })} />
          <NumberSetting label="Life ms" value={simParams.triggerStarLifetimeMs} min={80} step={20}
            onChange={triggerStarLifetimeMs => updateSimParams({ triggerStarLifetimeMs })} />
          <NumberSetting label="Spread" value={simParams.triggerStarSpread} min={0.2} step={0.1}
            onChange={triggerStarSpread => updateSimParams({ triggerStarSpread })} />
          <NumberSetting label="Line w" value={simParams.triggerStarLineWidth} min={0.1} step={0.1}
            onChange={triggerStarLineWidth => updateSimParams({ triggerStarLineWidth })} />
          <NumberSetting label="Glow" value={simParams.triggerStarGlow} min={0} step={0.2}
            onChange={triggerStarGlow => updateSimParams({ triggerStarGlow })} />
          <NumberSetting label="Fade" value={simParams.triggerStarFadeStart} min={0} max={0.95} step={0.05}
            onChange={triggerStarFadeStart => updateSimParams({ triggerStarFadeStart })} />
          {(simParams.triggerStarShape ?? 'star') === 'dot' && (
            <div style={{ paddingLeft: 12, marginTop: 4 }}>
              <button onClick={clearStardustDots} style={{
                fontSize: 9, padding: '2px 10px', borderRadius: 4, fontFamily: 'inherit', cursor: 'pointer',
                border: `0.5px solid ${t.divider}`, background: 'transparent', color: t.textDim,
              }}>星屑をクリア</button>
            </div>
          )}
        </SettingsGroup>

        <SettingsGroup label="Body Oscilloscope Rings">
          <label style={checkboxRowStyle}>
            <input type="checkbox" checked={simParams.showBodyOscilloscope}
              onChange={e => updateSimParams({ showBodyOscilloscope: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Show canvas rings</span>
          </label>
          <label style={checkboxRowStyle}>
            <input type="checkbox" checked={simParams.showRackBodyOscilloscope}
              onChange={e => updateSimParams({ showRackBodyOscilloscope: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Show rack rings</span>
          </label>
          <NumberSetting label="Canvas w" value={simParams.bodyOscilloscopeStrokeWidth} min={0.2} step={0.1}
            onChange={bodyOscilloscopeStrokeWidth => updateSimParams({ bodyOscilloscopeStrokeWidth })} />
          <NumberSetting label="Canvas h" value={simParams.bodyOscilloscopeHeight} min={0} step={1}
            onChange={bodyOscilloscopeHeight => updateSimParams({ bodyOscilloscopeHeight })} />
          <NumberSetting label="Canvas gap" value={simParams.bodyOscilloscopeGap} min={0} step={1}
            onChange={bodyOscilloscopeGap => updateSimParams({ bodyOscilloscopeGap })} />
          <NumberSetting label="Rack w" value={simParams.rackBodyOscilloscopeStrokeWidth} min={0.2} step={0.1}
            onChange={rackBodyOscilloscopeStrokeWidth => updateSimParams({ rackBodyOscilloscopeStrokeWidth })} />
          <NumberSetting label="Rack h" value={simParams.rackBodyOscilloscopeHeight} min={0} step={1}
            onChange={rackBodyOscilloscopeHeight => updateSimParams({ rackBodyOscilloscopeHeight })} />
          <NumberSetting label="Rack gap" value={simParams.rackBodyOscilloscopeGap} min={0} step={1}
            onChange={rackBodyOscilloscopeGap => updateSimParams({ rackBodyOscilloscopeGap })} />
        </SettingsGroup>
      </div>
    </div>
  )
}

export function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useTheme()
  return (
    <div style={{ padding: '6px 12px 8px' }}>
      <div style={{
        fontSize: 9, fontWeight: 600, color: t.textDim,
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  )
}

const BASE_SIM_DT = 0.2
const MIN_SIM_SPEED = 0.05
const MAX_SIM_SPEED = 4

export function SimulationSpeedSetting({ dt, onChange }: {
  dt: number
  onChange: (dt: number) => void
}) {
  const t = useTheme()
  const speed = Math.max(MIN_SIM_SPEED, Math.min(MAX_SIM_SPEED, dt / BASE_SIM_DT))

  function setSpeed(nextSpeed: number) {
    const clamped = Math.max(MIN_SIM_SPEED, Math.min(MAX_SIM_SPEED, nextSpeed))
    onChange(Number((BASE_SIM_DT * clamped).toFixed(4)))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: t.textMid, width: 68, textAlign: 'right', flexShrink: 0 }}>Speed</span>
        <input
          type="range"
          min={MIN_SIM_SPEED}
          max={MAX_SIM_SPEED}
          step={0.05}
          value={speed}
          onChange={e => setSpeed(Number(e.target.value))}
          className="planet-fader"
          style={{ flex: 1, minWidth: 0 }}
        />
        <span style={{ fontSize: 9, color: t.textMid, fontFamily: 'monospace', width: 38, textAlign: 'right', flexShrink: 0 }}>
          {speed.toFixed(speed < 1 ? 2 : 1)}x
        </span>
      </label>
      <div style={{ display: 'flex', gap: 4, paddingLeft: 76 }}>
        {[
          [0.25, '¼'],
          [0.5, '½'],
          [1, '1x'],
          [2, '2x'],
          [4, '4x'],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setSpeed(Number(value))}
            style={{
              flex: 1,
              padding: '3px 0',
              border: 'none',
              borderRadius: 4,
              background: Math.abs(speed - Number(value)) < 0.03 ? 'rgba(139,92,246,0.16)' : t.inputBg,
              color: Math.abs(speed - Number(value)) < 0.03 ? '#7c3aed' : t.textMid,
              cursor: 'pointer',
              fontSize: 9,
              fontWeight: 700,
              fontFamily: 'inherit',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 9, color: t.textDim, lineHeight: 1.35, paddingLeft: 76 }}>
        Physics dt = {dt.toFixed(4)}. 大きいほど速く進みますが、極端に上げると軌道が荒れます。
      </div>
    </div>
  )
}

export function NumberSetting({ label, value, min, max, step, onChange }: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
}) {
  const t = useTheme()
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: t.textMid, width: 68, textAlign: 'right', flexShrink: 0 }}>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          flex: 1, minWidth: 0, fontSize: 11, fontFamily: 'monospace',
          border: 'none', borderRadius: 4, padding: '3px 6px',
          background: t.inputBg, color: t.inputText,
        }}
      />
    </label>
  )
}

function TextSetting({ label, value, onChange }: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const t = useTheme()
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: t.textMid, width: 68, textAlign: 'right', flexShrink: 0 }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          flex: 1, minWidth: 0, fontSize: 11,
          border: 'none', borderRadius: 4, padding: '3px 6px',
          background: t.inputBg, color: t.inputText, fontFamily: 'inherit',
        }}
      />
    </label>
  )
}

export function SectionHeader({ label, collapsed = false, onToggleCollapsed, side }: {
  label: string
  collapsed?: boolean
  onToggleCollapsed?: () => void
  side?: 'left' | 'right'
}) {
  const t = useTheme()
  return (
    <div style={{
      minHeight: 28, flexShrink: 0,
      fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
      color: t.textMid, padding: collapsed ? '0' : '0 8px 0 12px',
      textTransform: 'uppercase',
      background: t.headerBg,
      borderBottom: `0.5px solid ${t.divider}`,
      display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between',
    }}>
      {!collapsed && <span>{label}</span>}
      {onToggleCollapsed && (
        <button
          onClick={onToggleCollapsed}
          title={collapsed ? `Show ${label}` : `Hide ${label}`}
          style={{
            width: 22, height: 22, border: 'none', borderRadius: 4,
            background: 'transparent', color: t.textMid, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {side === 'left'
            ? collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />
            : collapsed ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
        </button>
      )}
    </div>
  )
}
