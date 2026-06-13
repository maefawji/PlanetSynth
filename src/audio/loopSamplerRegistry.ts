import type { SamplerEngine } from './SamplerEngine'
import { clearBodyOutputLevel } from './bodyOutputMeter'
import { releaseBus } from './rackBusMixer'

export const loopSamplerEngines = new Map<string, SamplerEngine>()

/** Immediately stop and release a body's continuous-loop sampler engine, if any. */
export function stopBodyLoopSampler(bodyId: string): void {
  const engine = loopSamplerEngines.get(bodyId)
  if (!engine) return
  engine.stop(true)
  releaseBus(bodyId)
  clearBodyOutputLevel(bodyId, 'sampler')
  loopSamplerEngines.delete(bodyId)
}
