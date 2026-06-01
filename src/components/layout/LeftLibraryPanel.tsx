import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, FolderOpen, Settings, SlidersHorizontal, Upload, Waves, Crosshair, Activity, Sun, Music, Wand2, ToggleLeft, Star, Radio } from 'lucide-react'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import { usePlanetStore, type PlanetSimParams } from '../../store/planetStore'
import {
  getMidiOutputs, getMidiInputs, getSelectedOutputId, setSelectedOutputId,
  isMidiReady, sendMidiNote, type MidiPortInfo,
} from '../../audio/midiManager'
import { UNIVERSE_PRESETS, loadUserUniversePresets, saveUserUniversePresets } from '../../presets/universe'
import { PLANET_PRESETS, loadUserPlanetPresets, saveUserPlanetPresets } from '../../presets/planet'
import type { UserUniversePreset, UserPlanetPreset } from '../../presets/types'
import { useProjectStore } from '../../store/projectStore'
import { useControlSetStore, BUILTIN_CONTROL_SETS, type ControlSet, type ControlSetCategory } from '../../store/controlSetStore'
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
  hydrateSamplesFromFolder,
  loadDefaultFolderSamples,
  pickDefaultFolder,
  type CachedSampleLibrary,
} from '../../persistence/sampleLibrary'
import { parseProject, restoreProjectSamples, saveProjectJson } from '../../persistence/projectSchema'
import { setGlobalAdsr } from '../../audio/intersectionSynth'
import { ADSR_OFF, computeOrbitAdsr } from '../../audio/orbitAdsr'
import { loadBuiltinSamples } from '../../lib/loadBuiltinSamples'
import { useTheme } from '../../lib/theme'

interface LeftLibraryPanelProps {
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function LeftLibraryPanel({ collapsed, onToggleCollapsed }: LeftLibraryPanelProps) {
  const t = useTheme()
  const [activePanel, setActivePanel] = useState<
    | 'canvas' | 'universe-presets' | 'planet-presets' | 'planet-samples'
    | 'planet-triggers'
    | 'planet-controls-trigger' | 'planet-controls-instrument' | 'planet-controls-effect'
    | 'planet-playback' | 'planet-localization' | 'planet-adsr'
    | 'midi'
  >('planet-samples')
  const [cachedLibrary, setCachedLibrary] = useState<CachedSampleLibrary | null>(() => loadCachedSampleLibrary())
  const addSampleAssets     = useProjectStore(s => s.addSampleAssets)
  const setSampleObjectUrl  = useProjectStore(s => s.setSampleObjectUrl)
  const clearSamples        = useProjectStore(s => s.clearSamples)
  const loadProject         = useProjectStore(s => s.loadProject)
  const project             = useProjectStore(s => s.project)
  const samples             = useProjectStore(s => s.project.samples)
  const randomAssignSamplesToPlanets = usePlanetStore(s => s.randomAssignSamplesToPlanets)

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
    restoreProjectSamples(useProjectStore.getState().project.samples).then(restored => {
      for (const s of restored) {
        if (s.objectUrl) setSampleObjectUrl(s.id, s.objectUrl)
      }
    })
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
    clearSamples()
    addSampleAssets(folderSamples)
    for (const sample of folderSamples) {
      if (sample.objectUrl) setSampleObjectUrl(sample.id, sample.objectUrl)
    }
    setSampleImportStatus(`Reloaded ${folderSamples.length} sample${folderSamples.length === 1 ? '' : 's'} from the stored folder.`)
  }

  async function handleSetSampleFolder() {
    setSampleImportStatus('')
    const folderSamples = await pickDefaultFolder()
    if (!folderSamples.length) {
      setSampleImportStatus('No audio files found in that folder.')
      return
    }
    clearSamples()
    addSampleAssets(folderSamples)
    for (const sample of folderSamples) {
      if (sample.objectUrl) setSampleObjectUrl(sample.id, sample.objectUrl)
    }
    setSampleImportStatus(`Loaded ${folderSamples.length} sample${folderSamples.length === 1 ? '' : 's'} from folder.`)
  }

  function handleClearAllSamples() {
    clearSamples()
  }

  async function handleRandomAssignPlanetSamples() {
    setSampleImportStatus('')
    const builtinSamples = await loadBuiltinSamples()
    const currentSamples = useProjectStore.getState().project.samples
    const folderSamples = await loadDefaultFolderSamples()
    const folderHydratedSamples = folderSamples.length
      ? hydrateSamplesFromFolder(currentSamples, folderSamples)
      : currentSamples
    const restored = await restoreProjectSamples(folderHydratedSamples)
    if (folderSamples.length) addSampleAssets(folderSamples)
    addSampleAssets(restored)
    for (const sample of restored) {
      if (sample.objectUrl) setSampleObjectUrl(sample.id, sample.objectUrl)
    }

    const loadedById = new Map<string, SampleAsset>()
    for (const sample of restored) {
      if (sample.objectUrl) loadedById.set(sample.id, sample)
    }
    for (const sample of folderSamples) {
      if (sample.objectUrl) loadedById.set(sample.id, sample)
    }
    for (const sample of builtinSamples) {
      if (sample.objectUrl) loadedById.set(sample.id, sample)
    }
    const loadedSampleIds = Array.from(loadedById.keys())
    if (loadedSampleIds.length === 0) {
      setSampleImportStatus('No loaded samples available. Use Set Folder / Reload first, or allow folder permission when prompted.')
      return
    }
    randomAssignSamplesToPlanets(loadedSampleIds)
    setSampleImportStatus(`Randomly assigned ${loadedSampleIds.length} loaded sample${loadedSampleIds.length === 1 ? '' : 's'} to planet bodies.`)
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

  return (
    <div style={{
      width: collapsed ? 34 : 246, flexShrink: 0,
      background: t.panelBg,
      borderRight: `0.5px solid ${t.panelBorder}`,
      display: 'flex',
      overflow: 'hidden',
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
          onClick={() => { setActivePanel('planet-samples'); if (collapsed) onToggleCollapsed() }}
        >
          <FolderOpen size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'universe-presets' && !collapsed}
          title="Universe Presets"
          onClick={() => { setActivePanel('universe-presets'); if (collapsed) onToggleCollapsed() }}
        >
          <Sun size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-presets' && !collapsed}
          title="Planet Presets"
          onClick={() => { setActivePanel('planet-presets'); if (collapsed) onToggleCollapsed() }}
        >
          <Star size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-triggers' && !collapsed}
          title="Triggers"
          onClick={() => { setActivePanel('planet-triggers'); if (collapsed) onToggleCollapsed() }}
        >
          <SlidersHorizontal size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-playback' && !collapsed}
          title="Sample Playback"
          onClick={() => { setActivePanel('planet-playback'); if (collapsed) onToggleCollapsed() }}
        >
          <Waves size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-adsr' && !collapsed}
          title="ADSR"
          onClick={() => { setActivePanel('planet-adsr'); if (collapsed) onToggleCollapsed() }}
        >
          <Activity size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-localization' && !collapsed}
          title="Localization"
          onClick={() => { setActivePanel('planet-localization'); if (collapsed) onToggleCollapsed() }}
        >
          <Crosshair size={14} />
        </RailButton>

        {/* ── Control Sets: 3 icons per category ───────────────────── */}
        <RailDivider />
        <RailButton
          active={activePanel === 'planet-controls-trigger' && !collapsed}
          title="Trigger Sets"
          onClick={() => { setActivePanel('planet-controls-trigger'); if (collapsed) onToggleCollapsed() }}
        >
          <ToggleLeft size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-controls-instrument' && !collapsed}
          title="Instrument Sets"
          onClick={() => { setActivePanel('planet-controls-instrument'); if (collapsed) onToggleCollapsed() }}
        >
          <Music size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'planet-controls-effect' && !collapsed}
          title="Effect Sets"
          onClick={() => { setActivePanel('planet-controls-effect'); if (collapsed) onToggleCollapsed() }}
        >
          <Wand2 size={14} />
        </RailButton>
        <RailDivider />

        <RailButton
          active={activePanel === 'midi' && !collapsed}
          title="MIDI"
          onClick={() => { setActivePanel('midi'); if (collapsed) onToggleCollapsed() }}
        >
          <Radio size={14} />
        </RailButton>
        <RailButton
          active={activePanel === 'canvas' && !collapsed}
          title="Canvas Settings"
          onClick={() => { setActivePanel('canvas'); if (collapsed) onToggleCollapsed() }}
        >
          <Settings size={14} />
        </RailButton>
        <div style={{ flex: 1 }} />
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
          onRandomAssign={handleRandomAssignPlanetSamples}
          onReloadAll={handleReloadAllSamples}
          onSetFolder={handleSetSampleFolder}
          onClearAll={handleClearAllSamples}
          importStatus={sampleImportStatus}
        />
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
      {!collapsed && activePanel === 'planet-controls-trigger' && (
        <ControlSetsPanel category="trigger" />
      )}
      {!collapsed && activePanel === 'planet-controls-instrument' && (
        <ControlSetsPanel category="instrument" />
      )}
      {!collapsed && activePanel === 'planet-controls-effect' && (
        <ControlSetsPanel category="effect" />
      )}
      {!collapsed && activePanel === 'planet-playback' && (
        <PlanetSamplePlaybackPanel />
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
    </div>
  )
}

// ── Library explorer ──────────────────────────────────────────────────────────

type FileNode   = { type: 'file';   name: string; path: string }
type FolderNode = { type: 'folder'; name: string; path: string; children: TreeNode[] }
type TreeNode   = FileNode | FolderNode

function buildTree(paths: string[]): TreeNode[] {
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

function LibraryExplorer({ loadedSamples }: { loadedSamples: SampleAsset[] }) {
  const t = useTheme()
  const [tree, setTree]         = useState<TreeNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [status, setStatus]     = useState<'loading' | 'empty' | 'ok'>('loading')
  const { selectedBodyId, updateBody } = usePlanetStore()
  const { addSampleAssets } = useProjectStore()

  useEffect(() => {
    fetch('/samples/_index.json', { cache: 'no-cache' })
      .then(r => r.json())
      .then((files: string[]) => {
        setTree(buildTree(files))
        setStatus(files.length === 0 ? 'empty' : 'ok')
        // Expand all top-level folders by default
        const topFolders = buildTree(files).filter(n => n.type === 'folder').map(n => n.path)
        setExpanded(new Set(topFolders))
      })
      .catch(() => setStatus('empty'))
  }, [])

  function isLoaded(filePath: string) {
    return loadedSamples.some(s => s.sourcePath === `/samples/${filePath}` || s.id === `builtin:${filePath}`)
  }
  function getLoaded(filePath: string) {
    return loadedSamples.find(s => s.sourcePath === `/samples/${filePath}` || s.id === `builtin:${filePath}`)
  }

  async function handleFileClick(filePath: string) {
    let sample = getLoaded(filePath)
    if (!sample) {
      // Load on demand
      try {
        const url  = '/samples/' + filePath.split('/').map(encodeURIComponent).join('/')
        const blob = await fetch(url).then(r => r.blob())
        const objectUrl = URL.createObjectURL(blob)
        const ext = filePath.lastIndexOf('.') >= 0 ? filePath.slice(filePath.lastIndexOf('.')).toLowerCase() : ''
        const mime: Record<string,string> = { '.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.flac':'audio/flac','.aiff':'audio/aiff','.aif':'audio/aiff','.m4a':'audio/mp4','.mp4':'audio/mp4','.webm':'audio/webm' }
        const newSample: SampleAsset = {
          id: `builtin:${filePath}`,
          name: filePath.split('/').pop()!.replace(/\.[^.]+$/, ''),
          objectUrl,
          fileType: mime[ext] ?? 'audio/*',
          sourcePath: `/samples/${filePath}`,
        }
        addSampleAssets([newSample])
        sample = newSample
      } catch { return }
    }
    // Assign to selected planet body
    if (selectedBodyId && sample) {
      updateBody(selectedBodyId, { sampleId: sample.id })
    }
  }

  function renderNodes(nodes: TreeNode[], depth = 0): React.ReactNode {
    return nodes.map(node => {
      const indent = depth * 12 + 8
      if (node.type === 'folder') {
        const open = expanded.has(node.path)
        return (
          <div key={node.path}>
            <button
              onClick={() => setExpanded(prev => {
                const next = new Set(prev)
                open ? next.delete(node.path) : next.add(node.path)
                return next
              })}
              style={{
                width: '100%', textAlign: 'left', border: 'none', background: 'none',
                cursor: 'pointer', padding: `4px 8px 4px ${indent}px`,
                display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = t.hoverBg)}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <span style={{ fontSize: 9, color: t.textDim, width: 8, flexShrink: 0 }}>{open ? '▼' : '▶'}</span>
              <span style={{ fontSize: 11, color: '#f59e0b' }}>📁</span>
              <span style={{ fontSize: 11, color: t.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {node.name}
              </span>
            </button>
            {open && renderNodes(node.children, depth + 1)}
          </div>
        )
      }
      // file
      const loaded = isLoaded(node.path)
      return (
        <button
          key={node.path}
          title={loaded
            ? (selectedBodyId ? `Assign "${node.name}" to selected body` : node.path)
            : `Load "${node.name}"${selectedBodyId ? ' and assign to selected body' : ''}`}
          onClick={() => handleFileClick(node.path)}
          style={{
            width: '100%', textAlign: 'left', border: 'none', background: 'none',
            cursor: 'pointer', padding: `4px 8px 4px ${indent}px`,
            display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = t.hoverBg)}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <span style={{ width: 8, flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: loaded ? '#60a5fa' : t.textDim }}>♪</span>
          <span style={{
            fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: loaded ? t.text : t.textMid,
          }}>
            {node.name.replace(/\.[^.]+$/, '')}
          </span>
          {loaded && (
            <span style={{ fontSize: 8, color: '#60a5fa', background: 'rgba(96,165,250,0.10)', borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>
              ✓
            </span>
          )}
        </button>
      )
    })
  }

  return (
    <div style={{ borderBottom: `0.5px solid ${t.divider}` }}>
      <div style={{
        padding: '6px 8px 4px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: t.textMid, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Library Folder
        </span>
        <span style={{ fontSize: 9, color: t.textDim }}>/public/samples/</span>
      </div>

      {status === 'loading' && (
        <div style={{ fontSize: 10, color: t.textDim, padding: '4px 12px 8px' }}>Loading…</div>
      )}
      {status === 'empty' && (
        <div style={{ fontSize: 10, color: t.textDim, padding: '4px 12px 8px', lineHeight: 1.5 }}>
          Drop audio files into <code style={{ fontSize: 9, background: t.inputBg, padding: '1px 3px', borderRadius: 2 }}>public/samples/</code> to see them here.
        </div>
      )}
      {status === 'ok' && (
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          {renderNodes(tree)}
        </div>
      )}

      {selectedBodyId && status === 'ok' && (
        <div style={{ fontSize: 9, color: '#a78bfa', padding: '3px 8px 6px', lineHeight: 1.4 }}>
          ↑ クリックで選択ボディにアサイン
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function SamplesPanel({ samples, cachedLibrary, onAddSample, onAddDroppedSamples, onLoadSampleLibrary, onSaveSampleLibrary, onLoadCanvasData, onSaveCanvasData, onRandomAssign, onReloadAll, onSetFolder, onClearAll, importStatus }: {
  samples: Array<SampleAsset>
  cachedLibrary: CachedSampleLibrary | null
  onAddSample: () => void
  onAddDroppedSamples: (files: File[]) => void
  onLoadSampleLibrary: (file?: File) => void | Promise<void>
  onSaveSampleLibrary: () => void
  onLoadCanvasData: () => void | Promise<void>
  onSaveCanvasData: () => void
  onRandomAssign: () => void
  onReloadAll: () => void | Promise<void>
  onSetFolder: () => void | Promise<void>
  onClearAll: () => void
  importStatus: string
}) {
  const t = useTheme()
  const smallBtnStyle: React.CSSProperties = {
    flex: 1, padding: '5px 7px', background: t.inputBg, border: 'none',
    borderRadius: 4, cursor: 'pointer', fontSize: 10, color: t.textMid, fontFamily: 'inherit',
  }
  const [dragging, setDragging] = useState(false)

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const files = await filesFromDataTransfer(e.dataTransfer)
    if (!files.length) return

    const libraryFile = files.find(file => /\.json$/i.test(file.name))
    if (libraryFile) await onLoadSampleLibrary(libraryFile)
    onAddDroppedSamples(files.filter(isAudioFile))
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

      <div style={{
        padding: '8px 10px',
        borderBottom: `0.5px solid ${t.divider}`,
        background: t.sectionBg,
      }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: t.textMid, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
          Library File
        </div>
        <div style={{ fontSize: 10, color: t.textMid, lineHeight: 1.35, marginBottom: 7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cachedLibrary ? cachedLibrary.fileName : 'No cached library'}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => onLoadSampleLibrary()} style={smallBtnStyle}>Load</button>
          <button onClick={onSaveSampleLibrary} style={smallBtnStyle}>Save</button>
        </div>
        <div style={{
          marginTop: 8, paddingTop: 8,
          borderTop: `0.5px solid ${t.divider}`,
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: t.textMid, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Canvas Data
          </div>
          <div style={{ fontSize: 10, color: t.textMid, lineHeight: 1.35, marginBottom: 7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {cachedLibrary?.library.canvasDataPath ?? 'No canvas data recorded'}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onLoadCanvasData} style={smallBtnStyle}>Load Canvas</button>
            <button onClick={onSaveCanvasData} style={smallBtnStyle}>Save Canvas</button>
          </div>
        </div>
      </div>
      {/* Reload / Clear bar */}
      <div style={{
        display: 'flex', gap: 6, padding: '6px 10px',
        borderBottom: `0.5px solid ${t.divider}`,
        background: t.sectionBg,
      }}>
        <button
          onClick={onSetFolder}
          title="Choose the audio folder used by the Samples explorer and reloads"
          style={{
            flex: 1, padding: '5px 8px',
            background: 'rgba(37,99,235,0.07)',
            border: '0.5px solid rgba(37,99,235,0.18)',
            borderRadius: 4, cursor: 'pointer',
            fontSize: 10, fontWeight: 600, color: '#2563eb',
            fontFamily: 'inherit',
          }}
        >
          Set Folder
        </button>
        <button
          onClick={onReloadAll}
          title="Restore file handles — fixes sounds after page reload"
          style={{
            flex: 1, padding: '5px 8px',
            background: 'rgba(37,99,235,0.07)',
            border: '0.5px solid rgba(37,99,235,0.18)',
            borderRadius: 4, cursor: 'pointer',
            fontSize: 10, fontWeight: 600, color: '#2563eb',
            fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}
        >
          ⟳ Reload
        </button>
        <button
          onClick={onClearAll}
          disabled={samples.length === 0}
          title="Remove all samples from the list"
          style={{
            flex: 1, padding: '5px 8px',
            background: t.inputBg,
            border: 'none', borderRadius: 4,
            cursor: samples.length === 0 ? 'default' : 'pointer',
            fontSize: 10, color: t.textMid, fontFamily: 'inherit',
            opacity: samples.length === 0 ? 0.4 : 1,
          }}
          onMouseEnter={e => { if (samples.length > 0) e.currentTarget.style.color = '#ef4444' }}
          onMouseLeave={e => (e.currentTarget.style.color = t.textMid)}
        >
          ✕ Clear all
        </button>
      </div>

      {/* Library folder explorer */}
      <LibraryExplorer loadedSamples={samples} />

      {/* Loaded samples list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '6px 8px 2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: t.textMid, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Loaded ({samples.length})
          </span>
        </div>
        {samples.length === 0 ? (
          <div style={{ fontSize: 11, color: t.textDim, padding: '4px 12px 12px', lineHeight: 1.5 }}>
            Drop audio files here or click a file above.
          </div>
        ) : (
          samples.map(s => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '5px 12px', fontSize: 11, color: t.text,
              borderBottom: `0.5px solid ${t.sectionBg}`,
            }}>
              <span style={{ fontSize: 8, color: s.objectUrl ? '#60a5fa' : '#f87171' }}>♪</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {s.name}
              </span>
              {!s.objectUrl && (
                <span style={{ fontSize: 8, color: '#f87171', flexShrink: 0 }}>!</span>
              )}
            </div>
          ))
        )}
      </div>
      {/* Randomize assign */}
      {samples.length > 0 && (
        <div style={{ padding: '6px 10px', borderTop: `0.5px solid ${t.divider}` }}>
          <button
            onClick={onRandomAssign}
            title="Randomly assign loaded samples from the list to every planet body"
            style={{
              width: '100%', padding: '6px 8px',
              background: 'rgba(37,99,235,0.07)',
              border: '0.5px solid rgba(37,99,235,0.18)',
              borderRadius: 5, cursor: 'pointer',
              fontSize: 10, fontWeight: 600,
              color: '#2563eb', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(37,99,235,0.13)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(37,99,235,0.07)')}
          >
            🎲 Randomize planet assign
          </button>
        </div>
      )}

      <button
        onClick={onAddSample}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          width: '100%', padding: '9px 12px',
          background: 'rgba(37,99,235,0.08)', border: 'none',
          borderTop: `0.5px solid ${t.divider}`,
          cursor: 'pointer', fontSize: 11, color: '#2563eb', fontWeight: 600,
          fontFamily: 'inherit',
        }}
      >
        <Upload size={12} />
        <span>Add Samples</span>
      </button>
    </div>
  )
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
      </div>
    </div>
  )
}

// ── Control Sets Panel ────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<ControlSetCategory, string> = {
  trigger:    'Trigger',
  instrument: 'Instrument',
  effect:     'Effect',
}

function ControlSetCard({ cs, globalRack }: { cs: ControlSet; globalRack: import('../../store/controlSetStore').BodyRack }) {
  const inRack = globalRack.triggers.includes(cs.id)
    || globalRack.instrument === cs.id
    || globalRack.effects.includes(cs.id)
  const selectedBodyId = usePlanetStore(s => s.selectedBodyId)
  const setBodySlot     = useControlSetStore(s => s.setBodySlot)
  const addBodyTrigger  = useControlSetStore(s => s.addBodyTrigger)
  const addBodyEffect   = useControlSetStore(s => s.addBodyEffect)
  const setGlobalSlot   = useControlSetStore(s => s.setGlobalSlot)
  const addGlobalTrigger = useControlSetStore(s => s.addGlobalTrigger)
  const addGlobalEffect  = useControlSetStore(s => s.addGlobalEffect)

  function assignToRack(bodyId: string | null) {
    if (cs.category === 'trigger') {
      if (bodyId) addBodyTrigger(bodyId, cs.id)
      else addGlobalTrigger(cs.id)
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
        borderRadius: 7,
        border: `0.5px solid ${inRack ? cs.color + '88' : t.panelBorder}`,
        background: inRack ? `${cs.color}0d` : t.sectionBg,
        padding: '8px 10px',
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
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
        <span style={{
          width: 26, height: 26, borderRadius: 6, flexShrink: 0,
          background: `${cs.color}22`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, lineHeight: 1,
          border: `0.5px solid ${cs.color}44`,
        }}>{cs.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: t.text, lineHeight: 1.2 }}>
            {cs.name}
          </div>
          <div style={{ fontSize: 8.5, color: cs.color, fontWeight: 600, letterSpacing: '0.04em', marginTop: 1 }}>
            {CATEGORY_LABELS[cs.category]}
          </div>
        </div>
        {inRack && (
          <span style={{
            fontSize: 8, fontWeight: 700, color: cs.color,
            background: `${cs.color}18`, borderRadius: 3,
            padding: '2px 5px', flexShrink: 0,
            border: `0.5px solid ${cs.color}44`,
          }}>RACK</span>
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
            fontSize: 8,
            fontWeight: 800,
            color: cs.color,
            background: `${cs.color}14`,
            border: `0.5px solid ${cs.color}44`,
            borderRadius: 4,
            padding: '2px 5px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            flexShrink: 0,
          }}
        >
          Add
        </button>
      </div>

      {/* Description */}
      <div style={{ fontSize: 9.5, color: t.textMid, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
        {cs.description}
      </div>

      {/* Param tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
        {Object.entries(cs.params).map(([k, v]) => (
          <span key={k} style={{
            fontSize: 8, fontFamily: 'monospace',
            background: t.tagBg, borderRadius: 3, padding: '1px 5px',
            color: t.tagText,
          }}>
            {PARAM_LABEL_MAP[k] ?? k}={String(v)}
          </span>
        ))}
      </div>

      <div style={{ fontSize: 8, color: t.textDim, marginTop: 5 }}>
        ↖ ドラッグしてラックにアサイン{selectedBodyId ? ' / ダブルクリックで選択bodyへ' : ''}
      </div>
    </div>
  )
}

const PARAM_LABEL_MAP: Record<string, string> = {
  rendezvousTriggerMode: 'rdv',
  rendezvousDistance:    'dist',
  orbitTriggerMode:      'orbit',
  orbitStretchMode:      'stretch',
  standpointMode:        'sp',
  standpointMaxDist:     'sp.dist',
  standpointMinVol:      'sp.vol',
  effectorType:          'fx.type',
  effectorDistance:      'fx.dist',
  effectorMaxWet:        'fx.wet',
  effectorDecay:         'fx.decay',
  // granular
  granularType:      'grain',
  granularVolume:    'vol',
  granularGrainSize: 'grain s',
  granularOverlap:   'overlap',
  granularDetune:    'detune',
  granularReverbMix: 'reverb',
  // fm drone
  fmDroneType:      'fm',
  fmDroneRootNote:  'note',
  fmDroneRatio:     'ratio',
  fmDroneIndex:     'index',
  fmDroneVolume:    'vol',
  fmDroneAttack:    'attack',
  fmDroneRelease:   'release',
  fmDroneReverbMix: 'reverb',
  // noise pad
  noisePadType:      'noise',
  noisePadVolume:    'vol',
  noisePadFreq:      'freq',
  noisePadQ:         'Q',
  noisePadAttack:    'attack',
  noisePadRelease:   'release',
  noisePadReverbMix: 'reverb',
  // new effects
  effectorPhaserRate:         'rate',
  effectorPhaserOctaves:      'oct',
  effectorAutoFilterFreq:     'rate',
  effectorAutoFilterDepth:    'depth',
  effectorAutoFilterBaseFreq: 'base',
  effectorBitDepth:           'bits',
  effectorFreezeDecay:        'decay',
}

function ControlSetsPanel({ category }: { category: ControlSetCategory }) {
  const t = useTheme()
  const globalRack = useControlSetStore(s => s.globalRack)
  const sets = BUILTIN_CONTROL_SETS.filter(c => c.category === category)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <SectionHeader label={CATEGORY_LABELS[category]} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ fontSize: 9.5, color: t.textMid, lineHeight: 1.5 }}>
          ドラッグしてラックにアサイン。ダブルクリックで選択 body へ即追加。
        </div>
        {sets.map(cs => (
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
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 28, height: 28, marginTop: 4,
        border: 'none', borderRadius: 5,
        background: active ? 'rgba(37,99,235,0.12)' : 'transparent',
        color: active ? '#2563eb' : t.textMid,
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
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

// ── Universe Preset Panel ─────────────────────────────────────────────────────

function UniversePresetPanel() {
  const t = useTheme()
  const applyPreset           = usePlanetStore(s => s.applyPreset)
  const resetBodyRacksToDefaults = useControlSetStore(s => s.resetBodyRacksToDefaults)
  const [userPresets, setUserPresets] = useState<UserUniversePreset[]>(() => loadUserUniversePresets())

  function handleApply(preset: { bodies: typeof UNIVERSE_PRESETS[0]['bodies']; simParams: typeof UNIVERSE_PRESETS[0]['simParams'] }) {
    applyPreset([...preset.bodies], preset.simParams)
    resetBodyRacksToDefaults()
  }

  function handleDeleteUser(id: string) {
    const next = userPresets.filter(p => p.id !== id)
    setUserPresets(next)
    saveUserUniversePresets(next)
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

// ── Sample Playback panel ─────────────────────────────────────────────────────

function PlanetSamplePlaybackPanel() {
  const t = useTheme()
  const { simParams, updateSimParams } = usePlanetStore()
  const p = simParams

  // Helper for segmented button group
  function SegGroup<T extends string>({ value, options, onChange }: {
    value: T
    options: { val: T; label: string; hint?: string }[]
    onChange: (v: T) => void
  }) {
    return (
      <div style={{ display: 'flex', gap: 3 }}>
        {options.map(o => (
          <button
            key={o.val}
            title={o.hint}
            onClick={() => onChange(o.val)}
            style={{
              flex: 1, padding: '4px 0', border: 'none', borderRadius: 4,
              cursor: 'pointer', fontSize: 9.5, fontFamily: 'inherit', fontWeight: 600,
              background: value === o.val ? 'rgba(139,92,246,0.15)' : t.inputBg,
              color:      value === o.val ? '#7c3aed'                : t.textMid,
              transition: 'background 120ms, color 120ms',
            }}
          >{o.label}</button>
        ))}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <SectionHeader label="Sample Playback" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>

        {/* ── Orbit source ─────────────────────────────────────────────── */}
        <SettingsGroup label="Orbit Source">
          <div style={{ fontSize: 9.5, color: t.textMid, lineHeight: 1.5, marginBottom: 6 }}>
            ストレッチ・計算の基準となる軌道データを選択します。
          </div>
          <SegGroup
            value={p.sampleOrbitSource}
            onChange={v => updateSimParams({ sampleOrbitSource: v })}
            options={[
              { val: 'current',   label: 'Trigger orbit', hint: 'トリガー時点の瞬間角速度(ω)から算出した周期を使用' },
              { val: 'predicted', label: 'Predicted next', hint: '指数移動平均で平滑化した予測周期を使用（安定・一定速）' },
            ]}
          />
          <div style={{ marginTop: 5, padding: '4px 6px', background: t.sectionBg, borderRadius: 4 }}>
            <div style={{ fontSize: 8.5, color: t.textDim, lineHeight: 1.55 }}>
              <b style={{ color: t.textMid }}>Trigger orbit:</b> 毎フレームの瞬間ωを使用。速度変化がリアルタイムにレートへ反映。
            </div>
            <div style={{ fontSize: 8.5, color: t.textDim, lineHeight: 1.55, marginTop: 3 }}>
              <b style={{ color: t.textMid }}>Predicted next:</b> 緩やかなEMAで平滑化。近日点・遠日点でも速度が一定に保たれる。
            </div>
          </div>
        </SettingsGroup>

        {/* ── Loop / Oneshot ───────────────────────────────────────────── */}
        <SettingsGroup label="Play Mode">
          <SegGroup
            value={p.sampleLoopMode}
            onChange={v => updateSimParams({ sampleLoopMode: v })}
            options={[
              { val: 'loop',    label: 'Loop',    hint: 'サンプルをループ再生。stretchが有効な場合は軌道に同期' },
              { val: 'oneshot', label: 'Oneshot', hint: '1トリガーにつき1回のみ再生' },
            ]}
          />
          <div style={{ marginTop: 4, padding: '4px 6px', background: t.sectionBg, borderRadius: 4 }}>
            {p.sampleLoopMode === 'loop' && (
              <span style={{ fontSize: 8.5, color: t.textDim }}>
                ループ再生。Rate/Time stretchが有効な場合、playbackRateを毎フレーム更新し軌道に追従。
              </span>
            )}
            {p.sampleLoopMode === 'oneshot' && (
              <span style={{ fontSize: 8.5, color: t.textDim }}>
                ワンショット。Stretchが有効な場合は算出したrateをトリガー時のみ適用して1回再生。
              </span>
            )}
          </div>
        </SettingsGroup>

        {/* ── Loop ratio (orbit per loop) ───────────────────────────────── */}
        {p.sampleLoopMode === 'loop' && (
          <SettingsGroup label="Loop Ratio">
            <div style={{ fontSize: 9.5, color: t.textMid, lineHeight: 1.5, marginBottom: 4 }}>
              個別bodyのループ比はボディインスペクタで設定（Inspector → Loop ratio）。<br />
              例: 1/2 = 2周ごとに1ループ
            </div>
          </SettingsGroup>
        )}

      </div>
    </div>
  )
}

// ── Pad / Drone Panel ─────────────────────────────────────────────────────────

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
  const labelStyle: React.CSSProperties = {
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

// ─────────────────────────────────────────────────────────────────────────────

function CanvasSettingsPanel() {
  const t = useTheme()
  const settings = useCanvasSettingsStore()
  const update = settings.updateCanvasSettings
  const { simParams, updateSimParams } = usePlanetStore()

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <SectionHeader label="Canvas Settings" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        <SettingsGroup label="UI">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 76 }}>
            <input
              type="checkbox"
              checked={settings.monochromeMode}
              onChange={e => update({ monochromeMode: e.target.checked })}
            />
            <span style={{ fontSize: 10, color: t.textMid }}>Monochrome mode</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 76 }}>
            <input
              type="checkbox"
              checked={settings.showModeBar}
              onChange={e => update({ showModeBar: e.target.checked })}
            />
            <span style={{ fontSize: 10, color: t.textMid }}>Show mode bar</span>
          </label>
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
        <SettingsGroup label="Placement">
          <NumberSetting label="Path span" value={settings.pathSpan} min={20} step={10} onChange={pathSpan => update({ pathSpan })} />
          <NumberSetting label="Zoom" value={settings.zoom} min={0.2} step={0.1} onChange={zoom => update({ zoom })} />
          <button
            onClick={() => update({ zoom: 1 })}
            style={{
              marginLeft: 76, padding: '4px 6px',
              fontSize: 10, color: t.textMid,
              background: t.inputBg, border: 'none', borderRadius: 4,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Reset zoom
          </button>
        </SettingsGroup>

        {/* Planet display settings */}
        <SettingsGroup label="Planet Display">
          <NumberSetting label="Trail len" value={simParams.trailLength} min={10} step={100}
            onChange={trailLength => updateSimParams({ trailLength })} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 76 }}>
            <input type="checkbox" checked={simParams.showTrails}
              onChange={e => updateSimParams({ showTrails: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Show trails</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 76 }}>
            <input type="checkbox" checked={simParams.showVelocityVectors}
              onChange={e => updateSimParams({ showVelocityVectors: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Velocity vectors</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 76 }}>
            <input type="checkbox" checked={simParams.simpleTheme}
              onChange={e => updateSimParams({ simpleTheme: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Simple (light) theme</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 76 }}>
            <input type="checkbox" checked={simParams.showPredictedOrbit}
              onChange={e => updateSimParams({ showPredictedOrbit: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Predicted orbit on drag</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 76 }}>
            <input type="checkbox" checked={simParams.bodyRadiusFromMass}
              onChange={e => updateSimParams({ bodyRadiusFromMass: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Body size from mass (×0.1)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 76 }}>
            <input type="checkbox" checked={simParams.showSampleName}
              onChange={e => updateSimParams({ showSampleName: e.target.checked })} />
            <span style={{ fontSize: 10, color: t.textMid }}>Show sample name</span>
          </label>
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
