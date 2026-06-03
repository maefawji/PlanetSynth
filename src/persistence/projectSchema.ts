import { z } from 'zod'
import type { ModularProject, SampleAsset } from '../patch/types'
import { tryRestoreObjectUrl } from './fileHandleStore'
import { stableSampleIdForPath } from './sampleLibrary'

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(), z.number(), z.boolean(), z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
)

const nodeInstanceSchema = z.object({
  id:       z.string(),
  type:     z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  params:   z.record(z.string(), jsonValueSchema),
})

const edgeSchema = z.object({
  id:         z.string(),
  fromNodeId: z.string(),
  fromPortId: z.string(),
  toNodeId:   z.string(),
  toPortId:   z.string(),
  signalType: z.enum(['audio', 'control', 'trigger', 'sample', 'geometry', 'geometryList']),
})

const geometryStyleSchema = z.object({
  stroke:      z.string(),
  strokeWidth: z.number(),
  fill:        z.string(),
  opacity:     z.number().optional(),
})

const geometryObjectSchema = z.object({
  id:           z.string(),
  type:         z.enum(['circle', 'path', 'point', 'way']),
  role:         z.enum(['base', 'derived']).optional(),
  sourceNodeId: z.string().optional(),
  sampleId:     z.string().nullable().optional(),
  params:       z.record(z.string(), jsonValueSchema),
  style:        geometryStyleSchema,
})

const sampleAssetSchema = z.object({
  id:         z.string(),
  name:       z.string(),
  objectUrl:  z.string(),          // may be '' in saved files; restored at load time
  fileType:   z.string(),
  sourcePath: z.string().optional(),
})

export const modularProjectSchema = z.object({
  version:   z.literal('0.1.0'),
  meta:      z.object({ name: z.string(), createdAt: z.string(), updatedAt: z.string() }),
  transport: z.object({ bpm: z.number() }),
  nodes:     z.array(nodeInstanceSchema),
  edges:     z.array(edgeSchema),
  geometry:  z.array(geometryObjectSchema),
  samples:   z.array(sampleAssetSchema),
  planetSynth: z.unknown().optional(),
})

export function parseProject(data: unknown): ModularProject {
  return modularProjectSchema.parse(data) as ModularProject
}

// ── Save ──────────────────────────────────────────────────────────────────────

/**
 * Download the project as a JSON file.
 * blob: objectUrls are stripped — they're only valid for the current session
 * and will be restored from IndexedDB file handles on the next load.
 */
export function saveProjectJson(project: ModularProject): void {
  const updated: ModularProject = {
    ...project,
    meta: { ...project.meta, updatedAt: new Date().toISOString() },
    // Strip blob: URLs; sourcePath remains for identification
    samples: project.samples.map(s => ({
      ...s,
      objectUrl: s.objectUrl.startsWith('blob:') ? '' : s.objectUrl,
    })),
  }
  const blob = new Blob([JSON.stringify(updated, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${project.meta.name.replace(/[^\w\s-]/g, '')}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Auto-save to localStorage ─────────────────────────────────────────────────

const LS_PROJECT_KEY = 'synthesizer.project.autosave'

export function autosaveProject(project: ModularProject): void {
  try {
    const stripped: ModularProject = {
      ...project,
      samples: project.samples.map(s => ({
        ...s,
        objectUrl: s.objectUrl.startsWith('blob:') ? '' : s.objectUrl,
      })),
    }
    localStorage.setItem(LS_PROJECT_KEY, JSON.stringify(stripped))
  } catch {
    /* quota exceeded — ignore */
  }
}

export function loadAutosavedProject(): ModularProject | null {
  try {
    const raw = localStorage.getItem(LS_PROJECT_KEY)
    if (!raw) return null
    return parseProject(JSON.parse(raw))
  } catch {
    return null
  }
}

// ── Load ──────────────────────────────────────────────────────────────────────

export function loadProjectFromFile(): Promise<ModularProject> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type   = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return reject(new Error('No file selected'))
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        resolve(parseProject(data))
      } catch (e) {
        reject(e)
      }
    }
    input.click()
  })
}

/**
 * After loading a project (from file or localStorage), attempt to restore
 * blob: objectUrls for samples whose file handles are stored in IndexedDB.
 *
 * Returns a new samples array where each entry has been patched with a fresh
 * objectUrl where possible; entries that cannot be restored are left with
 * objectUrl: '' and `missing: true` metadata (not a real field, but callers
 * can detect empty objectUrl as "needs user action").
 *
 * MUST be called after a user gesture (click) because it may call
 * requestPermission() for file handles that are in 'prompt' state.
 */
export async function restoreProjectSamples(
  samples: SampleAsset[],
): Promise<SampleAsset[]> {
  return Promise.all(
    samples.map(async s => {
      // Remote/data URLs are reusable across reloads. Local paths and empty
      // blob placeholders must be restored from IndexedDB file handles.
      if (isPersistentUrl(s.objectUrl)) return s

      const fresh = await tryRestoreObjectUrl(s.id)
      if (fresh) return { ...s, objectUrl: fresh }

      if (s.sourcePath) {
        const stableId = stableSampleIdForPath(s.sourcePath)
        if (stableId !== s.id) {
          const stableFresh = await tryRestoreObjectUrl(stableId)
          if (stableFresh) return { ...s, objectUrl: stableFresh }
        }
      }

      return s.objectUrl.startsWith('blob:') ? { ...s, objectUrl: '' } : s
    })
  )
}

function isPersistentUrl(url: string): boolean {
  if (!url || url.startsWith('blob:')) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'data:'
  } catch {
    return false
  }
}
