type BodyOutputSource = 'sampler' | 'oneshot' | 'drone' | 'fmdrone' | 'noisepad' | 'granular' | 'effect' | 'ambient-osc' | 'osc-synth'

interface BodyOutputEntry {
  level: number
  updatedAt: number
  holdMs: number
}

const bodyOutputLevels = new Map<string, Partial<Record<BodyOutputSource, BodyOutputEntry>>>()

export function setBodyOutputLevel(
  bodyId: string,
  source: BodyOutputSource,
  level: number,
  holdMs = 500,
): void {
  const sources = bodyOutputLevels.get(bodyId) ?? {}
  sources[source] = {
    level: Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0)),
    updatedAt: performance.now(),
    holdMs,
  }
  bodyOutputLevels.set(bodyId, sources)
}

export function clearBodyOutputLevel(bodyId: string, source?: BodyOutputSource): void {
  if (!source) {
    bodyOutputLevels.delete(bodyId)
    return
  }
  const sources = bodyOutputLevels.get(bodyId)
  if (!sources) return
  delete sources[source]
  if (Object.keys(sources).length === 0) bodyOutputLevels.delete(bodyId)
}

export function getBodyOutputLevel(bodyId: string): number {
  const sources = bodyOutputLevels.get(bodyId)
  if (!sources) return 0
  const now = performance.now()
  let sumSquares = 0
  for (const [source, entry] of Object.entries(sources) as Array<[BodyOutputSource, BodyOutputEntry | undefined]>) {
    if (!entry) continue
    const age = now - entry.updatedAt
    if (age > entry.holdMs) {
      delete sources[source]
      continue
    }
    const fade = source === 'sampler' ? Math.max(0, 1 - age / entry.holdMs) : 1
    const level = entry.level * fade
    sumSquares += level * level
  }
  if (Object.keys(sources).length === 0) bodyOutputLevels.delete(bodyId)
  return Math.max(0, Math.min(1, Math.sqrt(sumSquares)))
}
