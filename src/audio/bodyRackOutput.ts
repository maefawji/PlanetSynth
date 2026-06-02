import type { PlanetSimParams } from '../store/planetStore'

export interface BodyRackOutputBody {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  standpointFacingAngle?: number
}

export interface BodyRackOutputSpatial {
  volume: number
  pan: number
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
}

function angleDelta(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function standpointFacingRad(sp: BodyRackOutputBody, simParams: PlanetSimParams): number {
  if (simParams.standpointFacing === 'velocity') {
    const speed = Math.hypot(sp.vx, sp.vy)
    if (speed > 0.001) return Math.atan2(sp.vy, sp.vx)
  }
  return (sp.standpointFacingAngle ?? simParams.standpointFacingAngle) * Math.PI / 180
}

/**
 * Final body-rack output placement.
 *
 * Treat every body as a track with its own rack. Instrument and effect nodes feed
 * that rack, and standpoint is applied once at the rack output stage.
 */
export function computeBodyRackOutputSpatial(
  bodyId: string,
  bodies: BodyRackOutputBody[],
  simParams: PlanetSimParams,
  rackParams: Partial<PlanetSimParams> = {},
): BodyRackOutputSpatial {
  const standpointMode = Boolean(rackParams.standpointMode ?? simParams.standpointMode)
  if (!standpointMode || !simParams.standpointBodyId || bodyId === simParams.standpointBodyId) {
    return { volume: 1, pan: 0 }
  }

  const body = bodies.find(b => b.id === bodyId)
  const sp = bodies.find(b => b.id === simParams.standpointBodyId)
  if (!body || !sp) return { volume: 1, pan: 0 }

  const dx = body.x - sp.x
  const dy = body.y - sp.y
  const dist = Math.hypot(dx, dy)
  const maxDist = Math.max(0.001, Number(rackParams.standpointMaxDist ?? simParams.standpointMaxDist ?? 400))
  const minVol = clamp01(Number(rackParams.standpointMinVol ?? simParams.standpointMinVol ?? 0))
  const distT = clamp01(dist / maxDist)
  let volume = 1 + (minVol - 1) * distT

  let pan = 0
  if (simParams.standpointDirectional) {
    const facing = standpointFacingRad(sp, simParams)
    const sourceAngle = Math.atan2(dy, dx)
    const diff = Math.abs(angleDelta(sourceAngle, facing))
    const halfCone = Math.max(0.001, (simParams.standpointConeWidth * Math.PI / 180) / 2)
    const coneT = clamp01(diff / halfCone)
    const dirVol = 1 + (clamp01(simParams.standpointOuterVol) - 1) * coneT
    volume *= dirVol

    if (simParams.standpointFrontBack) {
      const rearT = clamp01(diff / Math.PI)
      volume *= 1 + (clamp01(simParams.standpointRearVol) - 1) * rearT
    }

    if (simParams.standpointStereo) {
      const width = Math.max(0, Math.min(1, simParams.standpointStereoWidth ?? 1))
      pan = Math.max(-1, Math.min(1, Math.sin(angleDelta(sourceAngle, facing)) * width))
    }
  }

  return { volume: clamp01(volume), pan }
}
