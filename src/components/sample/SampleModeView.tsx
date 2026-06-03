import { useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent } from 'react'
import { Download, FileAudio, FolderOpen, Import, Play, RefreshCw, Search, Square, Trash2, Upload } from 'lucide-react'
import { useTheme } from '../../lib/theme'
import { useProjectStore } from '../../store/projectStore'
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
  const clearSamples = useProjectStore(s => s.clearSamples)
  const randomAssignSamples = useProjectStore(s => s.randomAssignSamples)
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
      const text = `${sample.name} ${sample.sourcePath ?? ''} ${sample.fileType}`.toLowerCase()
      return text.includes(q)
    })
  }, [query, samples])

  const reusableCount = samples.filter(sample => sample.sourcePath || !sample.objectUrl.startsWith('blob:')).length
  const folderCount = samples.filter(sample => sample.sourcePath?.includes('/')).length
  const cachedLibrary = loadCachedSampleLibrary()

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
    clearSamples()
    addSampleAssets(picked)
    setStatus(`Loaded ${picked.length} samples from folder`)
  }

  async function reloadFolder() {
    const picked = await loadDefaultFolderSamples()
    if (!picked.length) {
      setStatus('No default folder available or permission was not granted')
      return
    }
    clearSamples()
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

  function clearAllSamples() {
    stopPreview()
    clearSamples()
    setStatus('All samples cleared')
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
            {samples.length} samples · {folderCount} folder paths · {reusableCount} reusable references
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={addFiles} style={buttonStyle(t)}><Upload size={13} />Add Files</button>
          <button onClick={setFolder} style={buttonStyle(t)}><FolderOpen size={13} />Set Folder</button>
          <button onClick={reloadFolder} style={buttonStyle(t)}><RefreshCw size={13} />Reload Folder</button>
          <button onClick={() => fileInputRef.current?.click()} style={buttonStyle(t)}><Import size={13} />Import Library</button>
          <button onClick={exportLibrary} disabled={!samples.length} style={buttonStyle(t, !samples.length)}><Download size={13} />Export</button>
          <button onClick={randomAssignSamples} disabled={!samples.length} style={buttonStyle(t, !samples.length)}>Random Assign</button>
          <button onClick={clearAllSamples} disabled={!samples.length} style={dangerButtonStyle(t, !samples.length)}><Trash2 size={13} />Clear</button>
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
              wav, mp3, flac, aiff, ogg and browser-supported audio files are accepted.
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
          <div style={{ display: 'grid', gap: 7 }}>
            {filteredSamples.map(sample => (
              <div
                key={sample.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '36px minmax(180px, 1.5fr) minmax(180px, 2fr) 120px 40px',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `0.5px solid ${t.panelBorder}`,
                  background: t.sectionBg,
                }}
              >
                <button
                  onClick={() => { void playSample(sample) }}
                  title={playingId === sample.id ? 'Stop preview' : 'Preview sample'}
                  style={iconButtonStyle(t, playingId === sample.id)}
                >
                  {playingId === sample.id ? <Square size={14} /> : <Play size={14} />}
                </button>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 750, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {sample.name}
                  </div>
                  <div style={{ fontSize: 10, color: t.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                    {sample.id}
                  </div>
                </div>
                <div style={{ minWidth: 0, fontSize: 11, color: t.textMid, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {sample.sourcePath || sample.objectUrl || 'No source path'}
                </div>
                <div style={{
                  justifySelf: 'start',
                  fontSize: 10,
                  fontWeight: 700,
                  color: t.tagText,
                  background: t.tagBg,
                  borderRadius: 999,
                  padding: '3px 8px',
                  maxWidth: 120,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {sample.fileType || 'audio/file'}
                </div>
                <button
                  onClick={() => deleteSample(sample.id)}
                  title="Remove sample"
                  style={iconButtonStyle(t, false, true)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
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
