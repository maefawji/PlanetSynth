import { useProjectStore } from '../store/projectStore'
import type { SampleAsset } from '../patch/types'

const MIME: Record<string, string> = {
  '.wav':  'audio/wav',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.flac': 'audio/flac',
  '.aiff': 'audio/aiff',
  '.aif':  'audio/aiff',
  '.m4a':  'audio/mp4',
  '.mp4':  'audio/mp4',
  '.webm': 'audio/webm',
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

function nameOf(filename: string): string {
  const base = filename.lastIndexOf('/') >= 0 ? filename.slice(filename.lastIndexOf('/') + 1) : filename
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(0, dot) : base
}

/** Fetch /samples/_index.json, convert each file to a blob URL,
 *  and register them via addSampleAssets (dedup by sourcePath). */
export async function loadBuiltinSamples(): Promise<SampleAsset[]> {
  try {
    const res = await fetch('/samples/_index.json', { cache: 'no-cache' })
    if (!res.ok) return []
    const files: string[] = await res.json()
    if (!files.length) return []

    const assets: SampleAsset[] = await Promise.all(
      files.map(async (filename): Promise<SampleAsset | null> => {
        try {
          const url  = '/samples/' + filename.split('/').map(encodeURIComponent).join('/')
          const blob = await fetch(url).then(r => r.blob())
          const objectUrl = URL.createObjectURL(blob)
          return {
            id:         `builtin:${filename}`,
            name:       nameOf(filename),
            objectUrl,
            fileType:   MIME[extOf(filename)] ?? 'audio/*',
            sourcePath: `/samples/${filename}`,
          }
        } catch {
          console.warn(`[SampleLibrary] Could not load: ${filename}`)
          return null
        }
      })
    ).then(results => results.filter((s): s is SampleAsset => s !== null))

    if (assets.length) {
      useProjectStore.getState().addSampleAssets(assets)
      console.info(`[SampleLibrary] Loaded ${assets.length} built-in sample(s)`)
    }
    return assets
  } catch (e) {
    console.warn('[SampleLibrary] Could not load manifest:', e)
    return []
  }
}
