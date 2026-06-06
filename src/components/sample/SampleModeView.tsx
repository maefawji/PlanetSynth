import { useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent } from 'react'
import { Download, FileAudio, FolderOpen, Import, Play, RefreshCw, Search, Square, Trash2, Upload } from 'lucide-react'
import { useTheme } from '../../lib/theme'
import { useProjectStore } from '../../store/projectStore'
import { usePlanetStore } from '../../store/planetStore'
import { useControlSetStore } from '../../store/controlSetStore'
import {
  cacheSampleLibrary,
  libraryFromSamples,
  loadCachedSampleLibrary,
  loadDefaultFolderSamples,
  pickDefaultFolder,
  pickSampleFiles,
  readSampleLibraryFile,
  samplesFromFiles,
  samplesFromLibrary,
  saveSampleLibraryFile,
} from '../../persistence/sampleLibrary'
import { restoreProjectSamples } from '../../persistence/projectSchema'
import type { SampleAsset } from '../../patch/types'

export function SampleModeView() {
  const t = useTheme()
  const samples = useProjectStore(s => s.project.samples)
  const addSampleAssets = useProjectStore(s => s.addSampleAssets)
  const removeSampleAsset = useProjectStore(s => s.removeSampleAsset)
  const randomAssignSamples = useProjectStore(s => s.randomAssignSamples)
  const selectedBodyId = usePlanetStore(s => s.selectedBodyId)
  const setBodySlot = useControlSetStore(s => s.setBodySlot)
  const setGlobalSlot = useControlSetStore(s => s.setGlobalSlot)
  const setSlotOverride = useControlSetStore(s => s.setSlotOverride)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('Ready')
  const [dragging, setDragging] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const filteredSamples = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return samples
    return samples.filter(sample => {
      const text = `${sample.name} ${sample.sourcePath ?? ''} ${sample.fileType} ${sampleSourceKind(sample)}`.toLowerCase()
      return text.includes(q)
    })
  }, [query, samples])
  const defaultSamples = filteredSamples.filter(sample => sampleSourceKind(sample) === 'builtin')
  const localSamples = filteredSamples.filter(sample => sampleSourceKind(sample) !== 'builtin')
  const allDefaultCount = samples.filter(sample => sampleSourceKind(sample) === 'builtin').length
  const allLocalCount = samples.filter(sample => sampleSourceKind(sample) !== 'builtin').length

  const reusableCount = samples.filter(sample => sample.sourcePath || !sample.objectUrl.startsWith('blob:')).length
  const folderCount = samples.filter(sample => sampleSourceKind(sample) !== 'builtin' && sample.sourcePath?.includes('/')).length
  const cachedLibrary = loadCachedSampleLibrary()
  const assignTargetLabel = selectedBodyId ? `body ${selectedBodyId}` : 'global rack'

  async function addFiles() {
    const picked = await pickSampleFiles()
    addPickedSamples(picked, 'Added')
  }

  async function setFolder() {
    const picked = await pickDefaultFolder()
    if (!picked.length) {
      setStatus('No audio files loaded from folder')
      return
    }
    removeLocalSamples()
    addSampleAssets(picked)
    setStatus(`Loaded ${picked.length} samples from folder`)
  }

  async function reloadFolder() {
    const picked = await loadDefaultFolderSamples()
    if (!picked.length) {
      setStatus('No default folder available or permission was not granted')
      return
    }
    removeLocalSamples()
    addSampleAssets(picked)
    setStatus(`Reloaded ${picked.length} samples from folder`)
  }

  async function importLibraryFile(file: File) {
    try {
      const library = await readSampleLibraryFile(file)
      cacheSampleLibrary(file.name, library)
      const imported = await restoreProjectSamples(samplesFromLibrary(library))
      addPickedSamples(imported, `Imported ${library.name}`)
    } catch (error) {
      setStatus(`Import failed: ${String(error)}`)
    }
  }

  function exportLibrary() {
    const library = libraryFromSamples('planet-synth-samples', samples)
    saveSampleLibraryFile(library)
    cacheSampleLibrary(`${library.name}.sample-library.json`, library)
    setStatus(`Exported ${library.samples.length} reusable sample references`)
  }

  function addPickedSamples(picked: SampleAsset[], action: string) {
    if (!picked.length) {
      setStatus('No audio files selected')
      return
    }
    addSampleAssets(picked)
    setStatus(`${action} ${picked.length} samples`)
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const dropped = samplesFromFiles(Array.from(event.dataTransfer.files ?? []))
    addPickedSamples(dropped, 'Dropped')
  }

  async function playSample(sample: SampleAsset) {
    if (playingId === sample.id) {
      stopPreview()
      return
    }
    stopPreview()
    if (!sample.objectUrl) {
      setStatus(`No playable URL for ${sample.name}`)
      return
    }
    const audio = new Audio(sample.objectUrl)
    audioRef.current = audio
    setPlayingId(sample.id)
    audio.onended = () => setPlayingId(null)
    audio.onerror = () => {
      setPlayingId(null)
      setStatus(`Could not play ${sample.name}`)
    }
    try {
      await audio.play()
      setStatus(`Previewing ${sample.name}`)
    } catch (error) {
      setPlayingId(null)
      setStatus(`Playback blocked: ${String(error)}`)
    }
  }

  function stopPreview() {
    audioRef.current?.pause()
    audioRef.current = null
    setPlayingId(null)
  }

  function deleteSample(sampleId: string) {
    if (playingId === sampleId) stopPreview()
    removeSampleAsset(sampleId)
    setStatus('Sample removed')
  }

  function removeLocalSamples() {
    for (const sample of samples) {
      if (sampleSourceKind(sample) !== 'builtin') removeSampleAsset(sample.id)
    }
  }

  function clearLocalSamples() {
    stopPreview()
    removeLocalSamples()
    setStatus('Local samples cleared')
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
    setStatus(`Added ${sample.name} as Sampler on ${assignTargetLabel}`)
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: t.panelBg,
      color: t.text,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 18px',
        borderBottom: `0.5px solid ${t.panelBorder}`,
        background: t.headerBg,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 200 }}>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '0.02em' }}>Sample Mode</div>
          <div style={{ fontSize: 11, color: t.textMid, marginTop: 3 }}>
            {allDefaultCount} default · {allLocalCount} local · {folderCount} folder paths · {reusableCount} reusable references
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={addFiles} style={buttonStyle(t)}><Upload size={13} />Add Files</button>
          <button onClick={setFolder} style={buttonStyle(t)}><FolderOpen size={13} />Set Folder</button>
          <button onClick={reloadFolder} style={buttonStyle(t)}><RefreshCw size={13} />Reload Folder</button>
          <button onClick={() => fileInputRef.current?.click()} style={buttonStyle(t)}><Import size={13} />Import Library</button>
          <button onClick={exportLibrary} disabled={!samples.length} style={buttonStyle(t, !samples.length)}><Download size={13} />Export</button>
          <button onClick={randomAssignSamples} disabled={!samples.length} style={buttonStyle(t, !samples.length)}>Random Assign</button>
          <button onClick={clearLocalSamples} disabled={!allLocalCount} style={dangerButtonStyle(t, !allLocalCount)}><Trash2 size={13} />Clear Local</button>
        </div>

        <div style={{ flex: 1 }} />
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 220,
          maxWidth: 340,
          flex: '1 1 240px',
          padding: '6px 8px',
          borderRadius: 6,
          border: `0.5px solid ${t.btnBorder}`,
          background: t.inputBg,
          color: t.textMid,
        }}>
          <Search size={13} />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search samples"
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: t.inputText,
              font: 'inherit',
              fontSize: 12,
            }}
          />
        </label>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void importLibraryFile(file)
          }}
        />
      </div>

      <div style={{ padding: '12px 18px 0', display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div
          onDrop={event => { void handleDrop(event) }}
          onDragOver={event => event.preventDefault()}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          style={{
            minHeight: 74,
            flex: '1 1 420px',
            borderRadius: 8,
            border: dragging ? '1px solid rgba(34,211,238,0.75)' : `0.5px dashed ${t.btnBorder}`,
            background: dragging ? 'rgba(34,211,238,0.10)' : t.sectionBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            padding: '12px 14px',
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 750 }}>Drop audio files here</div>
            <div style={{ fontSize: 11, color: t.textMid, marginTop: 4 }}>
              Local files stay separate from hardcoded defaults. Use Assign to bind a sample to One-Shot or Stretch.
            </div>
          </div>
          <FileAudio size={24} color={t.textMid} />
        </div>

        <div style={{
          minHeight: 74,
          flex: '1 1 260px',
          borderRadius: 8,
          border: `0.5px solid ${t.panelBorder}`,
          background: t.sectionBg,
          padding: '12px 14px',
        }}>
          <div style={{ fontSize: 12, fontWeight: 750 }}>Library Cache</div>
          <div style={{ fontSize: 11, color: t.textMid, marginTop: 5, lineHeight: 1.5 }}>
            {cachedLibrary
              ? `${cachedLibrary.fileName} · ${cachedLibrary.library.samples.length} references`
              : 'No imported library cached yet'}
          </div>
          <div style={{ fontSize: 11, color: t.textDim, marginTop: 5 }}>{status}</div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 18px 18px' }}>
        {filteredSamples.length === 0 ? (
          <div style={{
            height: '100%',
            minHeight: 260,
            display: 'grid',
            placeItems: 'center',
            border: `0.5px solid ${t.panelBorder}`,
            borderRadius: 8,
            color: t.textMid,
            background: t.sectionBg,
            fontSize: 13,
          }}>
            {samples.length ? 'No samples match the search.' : 'No samples loaded.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
            {renderSampleSection('Default Files', 'Hardcoded /public/samples assets', defaultSamples, false)}
            {renderSampleSection('User Local', 'Dropped, picked, folder, and imported references', localSamples, true)}
          </div>
        )}
      </div>
    </div>
  )

  function renderSampleSection(title: string, subtitle: string, list: SampleAsset[], removable: boolean) {
    return (
      <section style={{
        minWidth: 0,
        borderRadius: 8,
        border: `0.5px solid ${t.panelBorder}`,
        background: t.sectionBg,
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '8px 10px',
          borderBottom: `0.5px solid ${t.panelBorder}`,
          background: t.headerBg,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 850, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</div>
            <div style={{ fontSize: 10, color: t.textDim, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>
          </div>
          <span style={{ fontSize: 10, color: t.textMid, fontWeight: 800 }}>{list.length}</span>
        </div>
        {list.length === 0 ? (
          <div style={{ minHeight: 120, display: 'grid', placeItems: 'center', color: t.textDim, fontSize: 11 }}>
            {query ? 'No matches' : removable ? 'No local samples' : 'No default samples loaded'}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 1, padding: 6 }}>
            {list.map(sample => (
              <div
                key={sample.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '28px minmax(0, 1fr) auto',
                  alignItems: 'center',
                  gap: 7,
                  padding: '6px 6px',
                  borderRadius: 6,
                  border: `0.5px solid transparent`,
                }}
              >
                <button
                  onClick={() => { void playSample(sample) }}
                  title={playingId === sample.id ? 'Stop preview' : 'Preview sample'}
                  style={iconButtonStyle(t, playingId === sample.id)}
                >
                  {playingId === sample.id ? <Square size={13} /> : <Play size={13} />}
                </button>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 750, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {sample.name}
                    </span>
                    <span style={{
                      fontSize: 8,
                      fontWeight: 800,
                      color: sampleSourceKind(sample) === 'builtin' ? '#60a5fa' : '#34d399',
                      background: sampleSourceKind(sample) === 'builtin' ? 'rgba(96,165,250,0.12)' : 'rgba(52,211,153,0.12)',
                      borderRadius: 999,
                      padding: '2px 5px',
                      flexShrink: 0,
                    }}>
                      {sampleSourceKind(sample)}
                    </span>
                  </div>
                  <div style={{ fontSize: 9.5, color: t.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                    {sample.sourcePath || sample.objectUrl || 'No source path'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    onClick={() => assignSample(sample)}
                    title={`Add as Sampler to ${assignTargetLabel}`}
                    style={{ ...assignButtonStyle(t), color: '#818cf8' }}
                  >
                    Add
                  </button>
                  {removable && (
                    <button
                      onClick={() => deleteSample(sample.id)}
                      title="Remove sample"
                      style={iconButtonStyle(t, false, true)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    )
  }
}

function sampleSourceKind(sample: SampleAsset): 'builtin' | 'local' | 'library' {
  if (sample.source === 'builtin' || sample.id.startsWith('builtin:') || sample.sourcePath?.startsWith('/samples/')) return 'builtin'
  if (sample.source === 'library') return 'library'
  return 'local'
}

function buttonStyle(t: ReturnType<typeof useTheme>, disabled = false): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 9px',
    borderRadius: 6,
    border: `0.5px solid ${t.btnBorder}`,
    background: t.btnBg,
    color: t.text,
    font: 'inherit',
    fontSize: 11,
    fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.42 : 1,
  }
}

function dangerButtonStyle(t: ReturnType<typeof useTheme>, disabled = false): CSSProperties {
  return {
    ...buttonStyle(t, disabled),
    color: disabled ? t.textMid : '#fb7185',
    border: disabled ? `0.5px solid ${t.btnBorder}` : '0.5px solid rgba(251,113,133,0.35)',
    background: disabled ? t.btnBg : 'rgba(251,113,133,0.10)',
  }
}

function iconButtonStyle(t: ReturnType<typeof useTheme>, active = false, danger = false): CSSProperties {
  return {
    width: 30,
    height: 30,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 7,
    border: active
      ? '0.5px solid rgba(34,211,238,0.55)'
      : danger
        ? '0.5px solid rgba(251,113,133,0.28)'
        : `0.5px solid ${t.btnBorder}`,
    background: active
      ? 'rgba(34,211,238,0.15)'
      : danger
        ? 'rgba(251,113,133,0.08)'
        : t.btnBg,
    color: active ? '#22d3ee' : danger ? '#fb7185' : t.text,
    cursor: 'pointer',
  }
}

function assignButtonStyle(t: ReturnType<typeof useTheme>): CSSProperties {
  return {
    height: 24,
    minWidth: 30,
    padding: '0 6px',
    borderRadius: 5,
    border: `0.5px solid ${t.btnBorder}`,
    background: t.btnBg,
    color: t.text,
    font: 'inherit',
    fontSize: 9,
    fontWeight: 850,
    cursor: 'pointer',
  }
}
