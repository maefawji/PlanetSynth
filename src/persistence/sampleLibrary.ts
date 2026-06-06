import type { SampleAsset } from '../patch/types'
import {
  storeFileHandle,
  storeDirectoryHandle,
  getDirectoryHandle,
  DEFAULT_DIR_KEY,
  ensureReadPermission,
  queryReadPermission,
  objectUrlFromHandle,
} from './fileHandleStore'

const SAMPLE_LIBRARY_CACHE_KEY = 'synthesizer.sampleLibrary.v1'

export interface SampleLibraryEntry {
  name: string
  path: string
  fileType?: string
}

export interface SampleLibraryFile {
  version: '0.1.0'
  name: string
  canvasDataPath?: string
  samples: SampleLibraryEntry[]
}

export interface CachedSampleLibrary {
  fileName: string
  library: SampleLibraryFile
}

// ── ID helpers ────────────────────────────────────────────────────────────────

/**
 * Stable ID for a file in a scanned directory tree.
 * Uses the full relative path (e.g. "drums/kick.wav") so that files with the
 * same name in different subdirectories get distinct IDs.
 */
export function stableSampleIdForPath(relativePath: string): string {
  return `folder_${relativePath.replace(/[^a-zA-Z0-9._/-]/g, '_')}`
}

export function isAudioFileName(name: string): boolean {
  return /\.(mp3|mpeg|wav|wave|bwf|w64|rf64|ogg|oga|flac|aac|m4a|m4b|m4p|mp4|opus|webm|weba|mka|aiff|aif|aifc|caf|au|snd)$/i.test(name)
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || isAudioFileName(file.name)
}

function fileRelativePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
}

export function normalizeSamplePath(path: string): string {
  let normalized = path.trim().replace(/\\/g, '/')
  try {
    normalized = decodeURIComponent(normalized)
  } catch {
    /* keep original string */
  }
  normalized = normalized.replace(/^file:\/+/, '')
  normalized = normalized.replace(/^\.\//, '')
  normalized = normalized.replace(/\/+/g, '/')
  return normalized.toLowerCase()
}

export function samplePathsMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  const left = normalizeSamplePath(a)
  const right = normalizeSamplePath(b)
  if (!left || !right) return false
  if (left === right) return true
  if (left.endsWith(`/${right}`) || right.endsWith(`/${left}`)) return true
  const leftName = left.split('/').pop()
  const rightName = right.split('/').pop()
  return Boolean(leftName && rightName && leftName === rightName)
}

export function hydrateSamplesFromFolder(samples: SampleAsset[], folderSamples: SampleAsset[]): SampleAsset[] {
  return samples.map(sample => {
    const match = folderSamples.find(folderSample =>
      samplePathsMatch(sample.sourcePath, folderSample.sourcePath)
      || samplePathsMatch(sample.sourcePath, folderSample.name)
      || samplePathsMatch(sample.name, folderSample.sourcePath)
    )
    return match
      ? {
          ...sample,
          objectUrl: match.objectUrl,
          fileType: match.fileType,
          sourcePath: sample.sourcePath || match.sourcePath,
        }
      : sample
  })
}

// ── File System Access API pickers ────────────────────────────────────────────

/** Returns false if the API is not available in this browser. */
export function hasFSAPI(): boolean {
  return typeof window.showOpenFilePicker === 'function'
    && typeof window.showDirectoryPicker === 'function'
}

/**
 * Open the file picker for audio files.
 * Stores each FileSystemFileHandle in IndexedDB keyed by the sample ID.
 * Falls back to <input type="file"> if FSAPI not available.
 */
export async function pickSampleFiles(): Promise<SampleAsset[]> {
  if (hasFSAPI()) {
    let handles: FileSystemFileHandle[]
    try {
      handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'Audio files', accept: { 'audio/*': ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus', '.aiff', '.aif'] } }],
      })
    } catch {
      return []  // user cancelled
    }
    const assets: SampleAsset[] = []
    for (const handle of handles) {
      const file = await handle.getFile()
      const id   = crypto.randomUUID()
      const objectUrl = URL.createObjectURL(file)
      await storeFileHandle(id, handle)
      assets.push({
        id,
        name: file.name,
        objectUrl,
        fileType: file.type || 'audio/file',
        sourcePath: file.name,
        source: 'local',
      })
    }
    return assets
  }

  // Fallback: classic <input type="file">
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type     = 'file'
    input.accept   = 'audio/*'
    input.multiple = true
    input.onchange = () => resolve(samplesFromFiles(Array.from(input.files ?? [])))
    input.click()
  })
}

/**
 * Scan a FileSystemDirectoryHandle for audio files and return SampleAssets.
 * Uses stable IDs derived from file names so re-scans are idempotent.
 */
export async function scanDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  basePath = '',
): Promise<SampleAsset[]> {
  const assets: SampleAsset[] = []
  for await (const [name, handle] of dirHandle.entries()) {
    const relativePath = basePath ? `${basePath}/${name}` : name
    if (handle.kind === 'directory') {
      assets.push(...await scanDirectoryHandle(handle as FileSystemDirectoryHandle, relativePath))
      continue
    }
    if (handle.kind !== 'file') continue
    try {
      const fileHandle = handle as FileSystemFileHandle
      const file = await fileHandle.getFile()
      if (!isAudioFile(file)) continue
      const id   = stableSampleIdForPath(relativePath)
      const objectUrl = URL.createObjectURL(file)
      // Store handle under the stable folder ID
      await storeFileHandle(id, fileHandle)
      assets.push({
        id,
        name,
        objectUrl,
        fileType: file.type || 'audio/file',
        sourcePath: relativePath,
        source: 'local',
      })
    } catch {
      /* skip unreadable files */
    }
  }
  return assets.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Open the directory picker, store the handle as the default folder,
 * and return all audio files found.
 */
export async function pickDefaultFolder(): Promise<SampleAsset[]> {
  if (!hasFSAPI()) return pickFolderWithInput()

  let dirHandle: FileSystemDirectoryHandle
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'read' })
  } catch {
    return []  // user cancelled
  }
  await storeDirectoryHandle(DEFAULT_DIR_KEY, dirHandle)
  return scanDirectoryHandle(dirHandle)
}

/**
 * Check (without requesting) whether the stored default folder is accessible.
 * Returns 'granted' | 'prompt' | 'denied' | 'none'.
 */
export async function defaultFolderPermissionState(): Promise<PermissionState | 'none'> {
  const handle = await getDirectoryHandle(DEFAULT_DIR_KEY)
  if (!handle) return 'none'
  return queryReadPermission(handle)
}

/**
 * Load samples from the stored default folder.
 * Requests permission if needed (requires a user gesture).
 * Returns an empty array if no folder stored or permission denied.
 */
export async function loadDefaultFolderSamples(): Promise<SampleAsset[]> {
  const handle = await getDirectoryHandle(DEFAULT_DIR_KEY)
  if (!handle) return []
  const perm = await ensureReadPermission(handle)
  if (perm !== 'granted') return []
  return scanDirectoryHandle(handle)
}

function pickFolderWithInput(): Promise<SampleAsset[]> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.setAttribute('webkitdirectory', '')
    input.onchange = () => resolve(samplesFromFiles(Array.from(input.files ?? [])))
    input.click()
  })
}

// ── Legacy helpers (kept for compatibility) ───────────────────────────────────

export function samplesFromFiles(files: File[]): SampleAsset[] {
  return files
    .filter(isAudioFile)
    .map(file => {
      const sourcePath = fileRelativePath(file)
      return {
        id: sourcePath.includes('/') ? stableSampleIdForPath(sourcePath) : crypto.randomUUID(),
        name: file.name,
        objectUrl: URL.createObjectURL(file),
        fileType: file.type || 'audio/file',
        sourcePath,
        source: 'local',
      }
    })
}

export function samplesFromLibrary(library: SampleLibraryFile): SampleAsset[] {
  return library.samples
    .filter(sample => sample.path.trim().length > 0)
    .map(sample => {
      const isLocal = isLocalSamplePath(sample.path)
      return {
        id: isLocal ? stableSampleIdForPath(sample.path) : crypto.randomUUID(),
        name: sample.name || sampleNameFromPath(sample.path),
        objectUrl: isLocal ? '' : sample.path,
        sourcePath: sample.path,
        fileType: sample.fileType || 'audio/path',
        source: isLocal ? 'local' : 'library',
      }
    })
}

export async function readSampleLibraryFile(file: File): Promise<SampleLibraryFile> {
  const data = JSON.parse(await file.text())
  return parseSampleLibrary(data, file.name)
}

export function saveSampleLibraryFile(library: SampleLibraryFile): void {
  const blob = new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${library.name || 'sample-library'}.sample-library.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function cacheSampleLibrary(fileName: string, library: SampleLibraryFile): void {
  localStorage.setItem(SAMPLE_LIBRARY_CACHE_KEY, JSON.stringify({ fileName, library }))
}

export function loadCachedSampleLibrary(): CachedSampleLibrary | null {
  try {
    const raw = localStorage.getItem(SAMPLE_LIBRARY_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedSampleLibrary
    return {
      fileName: String(parsed.fileName || parsed.library?.name || 'cached library'),
      library:  parseSampleLibrary(parsed.library, parsed.fileName),
    }
  } catch {
    return null
  }
}

export function libraryFromSamples(name: string, samples: SampleAsset[], canvasDataPath?: string): SampleLibraryFile {
  return {
    version: '0.1.0',
    name: name || 'sample-library',
    ...(canvasDataPath ? { canvasDataPath } : {}),
    samples: samples
      .filter(sample => sample.sourcePath || isReusableSamplePath(sample.objectUrl))
      .map(sample => ({
        name:     sample.name,
        path:     sample.sourcePath || sample.objectUrl,
        fileType: sample.fileType,
      })),
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseSampleLibrary(data: unknown, fallbackName = 'sample-library'): SampleLibraryFile {
  if (!data || typeof data !== 'object') throw new Error('Invalid sample library')
  const record  = data as Record<string, unknown>
  const samples = Array.isArray(record.samples) ? record.samples : []
  return {
    version: '0.1.0',
    name:    typeof record.name === 'string' ? record.name : fallbackName.replace(/\.json$/i, ''),
    canvasDataPath: typeof record.canvasDataPath === 'string' ? record.canvasDataPath : undefined,
    samples: samples.map(parseSampleLibraryEntry).filter(Boolean) as SampleLibraryEntry[],
  }
}

function parseSampleLibraryEntry(entry: unknown): SampleLibraryEntry | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const path   = typeof record.path === 'string' ? record.path
               : typeof record.url  === 'string' ? record.url
               : ''
  if (!path) return null
  return {
    name:     typeof record.name     === 'string' ? record.name : sampleNameFromPath(path),
    path,
    fileType: typeof record.fileType === 'string' ? record.fileType : undefined,
  }
}

function sampleNameFromPath(path: string): string {
  try {
    const parsed = new URL(path)
    return parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname
  } catch {
    return path.split(/[\\/]/).filter(Boolean).pop() || 'sample'
  }
}

function isReusableSamplePath(path: string): boolean {
  return !path.startsWith('blob:')
}

function isLocalSamplePath(path: string): boolean {
  if (!isReusableSamplePath(path)) return false
  try {
    new URL(path)
    return false
  } catch {
    return true
  }
}

/** Get the display name for the default folder (from stored handle, no permission needed). */
export async function getDefaultFolderName(): Promise<string | null> {
  const handle = await getDirectoryHandle(DEFAULT_DIR_KEY)
  return handle ? handle.name : null
}

export { objectUrlFromHandle }
