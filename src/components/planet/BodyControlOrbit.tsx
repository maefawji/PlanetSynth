import { useMemo, useState } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import type { PlanetBody, PlanetSimParams } from '../../store/planetStore'
import { useControlSetStore } from '../../store/controlSetStore'
import { usePlanetPresetStore } from '../../store/planetPresetStore'
import { useProjectStore } from '../../store/projectStore'
import { useCanvasSettingsStore } from '../../store/canvasSettingsStore'
import { generateFromGrammar, randomGrammar } from '../../sigil/sigilGenerator'

// FNV-1a hash → stable seed for a body's default sigil grammar.
function stableSigilSeed(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function BodyOrbitSigil({ body, size, color }: { body: PlanetBody; size: number; color: string }) {
  const sigil = useMemo(
    () => generateFromGrammar(body.sigilGrammar ?? randomGrammar(stableSigilSeed(`${body.id}:${body.name}`), {})),
    [body.id, body.name, body.sigilGrammar],
  )
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true"
      style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', overflow: 'visible' }}>
      {sigil.shapes.map((shape, i) => {
        const stroke = shape.renderMode === 'fill' ? 'none' : color
        const fill = shape.renderMode === 'stroke' ? 'none' : color
        if (shape.kind === 'circle') {
          return <circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} fill={fill} stroke={stroke} strokeWidth={2.4} />
        }
        if (shape.kind === 'polygon') {
          return <polygon key={i} points={shape.points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}
            fill={fill} stroke={stroke} strokeWidth={2.4} strokeLinejoin="round" />
        }
        return <path key={i} d={shape.d} fill={fill} stroke={stroke} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      })}
    </svg>
  )
}

type NodeKey = 'instrument' | 'preset' | 'locate' | 'random'

interface OrbitNode {
  key: NodeKey
  angle: number   // degrees, 0 = up, clockwise
  icon: string
  label: string
  detail: string
  active: boolean
}

export function BodyControlOrbit({ simple }: { simple: boolean }) {
  const selectedBodyId   = usePlanetStore(s => s.selectedBodyId)
  const bodies           = usePlanetStore(s => s.bodies)
  const simParams        = usePlanetStore(s => s.simParams)
  const updateSimParams  = usePlanetStore(s => s.updateSimParams)
  const cameraFollowId   = usePlanetStore(s => s.cameraFollowBodyId)
  const setCameraFollow  = usePlanetStore(s => s.setCameraFollowBodyId)
  const presets          = usePlanetPresetStore(s => s.presets)
  const cycleNext        = usePlanetPresetStore(s => s.cycleNext)
  const capturePreset    = usePlanetPresetStore(s => s.capturePreset)
  const samples          = useProjectStore(s => s.project.samples)
  const mono             = useCanvasSettingsStore(s => s.monochromeMode)
  const monoInverted     = useCanvasSettingsStore(s => s.monochromeInverted)
  // Subscribe so node states refresh when racks change.
  const rackParamOverrides = useControlSetStore(s => s.rackParamOverrides)
  const bodyRacks          = useControlSetStore(s => s.bodyRacks)
  const globalRack         = useControlSetStore(s => s.globalRack)

  const [hover, setHover] = useState<NodeKey | null>(null)
  const [flash, setFlash] = useState<NodeKey | null>(null)

  const body = selectedBodyId ? bodies.find(b => b.id === selectedBodyId) ?? null : null

  // Recompute whenever rack state changes (deps referenced to satisfy lint + reactivity).
  const rackVersion = `${JSON.stringify(bodyRacks[selectedBodyId ?? ''] ?? {})}|${globalRack.instrument}|${Object.keys(rackParamOverrides).length}`

  const nodes = useMemo<OrbitNode[] | null>(() => {
    if (!body) return null
    void rackVersion
    const cs = useControlSetStore.getState()
    const rack = cs.getBodyEffectiveRack(body.id)
    const instrument = rack.instrument
    const isSampler = instrument === 'instrument-sampler'
    const isWaveLab = instrument === 'instrument-wave-lab'
    const instLabel = isSampler ? 'Sampler' : isWaveLab ? 'Wave Lab' : (instrument ?? 'none')

    const curPreset = presets.find(p => p.instrument === instrument)
    const curIdx = presets.findIndex(p => p.instrument === instrument)
    const nextPreset = presets.length > 0 ? presets[(curIdx + 1) % presets.length] : null

    const isSP        = simParams.standpointBodyId === body.id
    const isFollowing = cameraFollowId === body.id

    return [
      {
        key: 'instrument', angle: 0, icon: isSampler ? '▤' : isWaveLab ? '∿' : '◌',
        label: 'Instrument', detail: `${instLabel} → ${isSampler ? 'Wave Lab' : 'Sampler'}`,
        active: isSampler || isWaveLab,
      },
      {
        key: 'preset', angle: 90, icon: '◇',
        label: 'Preset',
        detail: nextPreset ? `${curPreset?.name ?? '—'} → ${nextPreset.name}` : 'no presets',
        active: !!curPreset,
      },
      {
        key: 'locate', angle: 180, icon: isSP || isFollowing ? '◎' : '⊕',
        label: 'Locate', detail: isSP || isFollowing ? 'standpoint + camera ON' : 'assign standpoint + camera',
        active: isSP || isFollowing,
      },
      {
        key: 'random', angle: 270, icon: '⚄',
        label: 'Random', detail: samples.length > 0 ? `random sample (${samples.length})` : 'no samples',
        active: false,
      },
    ]
  }, [body, rackVersion, presets, simParams.standpointBodyId, cameraFollowId, samples.length])

  if (!body || !nodes) return null

  // Monochrome UI: drop all hue (blue accent, body-colour sigil) for pure ink.
  const inkOn  = monoInverted ? '#ededed' : '#1a1a1a'
  const paper  = monoInverted ? '#0e0e0e' : '#ffffff'
  const inkDim = monoInverted ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)'
  const inkMid = monoInverted ? 'rgba(255,255,255,0.5)'  : 'rgba(0,0,0,0.5)'
  const inkFaint = monoInverted ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)'

  const color   = mono ? inkOn : body.color
  const accent  = mono ? inkOn : (simple ? '#2563eb' : body.color)
  const dim     = mono ? inkDim : (simple ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.5)')
  const ringCol = mono ? inkFaint : (simple ? 'rgba(0,0,0,0.18)' : `${body.color}55`)
  const nodeOff = mono ? inkMid : (simple ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.55)')
  const nodeFill = mono ? paper : (simple ? '#ffffff' : '#0a0a12')

  const SIZE = 188
  const C = SIZE / 2
  const RING = 66
  const NODE_R = 17

  const triggerFlash = (k: NodeKey) => { setFlash(k); window.setTimeout(() => setFlash(f => (f === k ? null : f)), 220) }

  function handleNode(k: NodeKey, eventTime: number) {
    if (!body) return
    const cs = useControlSetStore.getState()
    triggerFlash(k)
    if (k === 'instrument') {
      const inst = cs.getBodyEffectiveRack(body.id).instrument
      const next = inst === 'instrument-sampler' ? 'instrument-wave-lab' : 'instrument-sampler'
      cs.setBodySlot(body.id, 'instrument', next)
    } else if (k === 'preset') {
      cycleNext(body.id)
    } else if (k === 'locate') {
      const isSP = usePlanetStore.getState().simParams.standpointBodyId === body.id
      const isFollowing = usePlanetStore.getState().cameraFollowBodyId === body.id
      const turnOn = !(isSP && isFollowing)
      updateSimParams({ standpointBodyId: turnOn ? body.id : null })
      setCameraFollow(turnOn ? body.id : null)
    } else if (k === 'random') {
      const list = useProjectStore.getState().project.samples
      if (list.length === 0) return
      const pick = list[Math.floor(eventTime) % list.length]
      // Ensure the body plays the sampler so the random sample is audible.
      if (cs.getBodyEffectiveRack(body.id).instrument !== 'instrument-sampler') {
        cs.setBodySlot(body.id, 'instrument', 'instrument-sampler')
      }
      cs.setSlotOverride(`b:${body.id}:instrument`, {
        samplerMode: 'fixed', samplerSampleId: pick.id,
      } as Partial<PlanetSimParams>)
    }
  }

  const hoveredNode = hover ? nodes.find(n => n.key === hover) ?? null : null

  return (
    <div
      style={{ position: 'relative', width: SIZE, height: SIZE, userSelect: 'none' }}
      onContextMenu={e => {
        // Right-click → capture current body config as a new planet preset.
        e.preventDefault()
        const name = window.prompt('Save current sound as planet preset — name:', `${body.name}`)
        if (name !== null) capturePreset(body.id, name)
      }}
      title="Right-click: save current sound as a planet preset"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ display: 'block', overflow: 'visible' }}>
        {/* Orbit ring */}
        <circle cx={C} cy={C} r={RING} fill="none" stroke={ringCol} strokeWidth={1} strokeDasharray="2 4" />
        {/* Node connector ticks */}
        {nodes.map(n => {
          const a = (n.angle - 90) * Math.PI / 180
          const x = C + RING * Math.cos(a)
          const y = C + RING * Math.sin(a)
          const on = n.active || flash === n.key
          const nodeCol = on ? accent : nodeOff
          const isHov = hover === n.key
          const fillBg = nodeFill
          return (
            <g key={n.key}>
              <circle cx={x} cy={y} r={NODE_R + (isHov ? 2 : 0)}
                fill={fillBg}
                stroke={nodeCol}
                strokeWidth={on ? 1.6 : 1}
                opacity={flash === n.key ? 1 : isHov ? 1 : 0.92}
                style={{ transition: 'r 0.08s, stroke-width 0.08s' }} />
              {on && (
                <circle cx={x} cy={y} r={NODE_R + (isHov ? 2 : 0)} fill={nodeCol} opacity={0.12} />
              )}
              <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
                fontSize={15} fill={nodeCol} style={{ pointerEvents: 'none' }}>{n.icon}</text>
            </g>
          )
        })}
      </svg>

      {/* Center sigil — absolutely centered HTML layer */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%', width: 62, height: 62,
        transform: 'translate(-50%, -50%)', pointerEvents: 'none',
        opacity: simple ? 0.85 : 0.95,
        filter: simple ? 'none' : `drop-shadow(0 0 6px ${color}66)`,
      }}>
        <BodyOrbitSigil body={body} size={62} color={color} />
      </div>

      {/* Clickable node hotspots (HTML buttons on top of the SVG nodes) */}
      {nodes.map(n => {
        const a = (n.angle - 90) * Math.PI / 180
        const x = C + RING * Math.cos(a)
        const y = C + RING * Math.sin(a)
        return (
          <button
            key={n.key}
            onClick={event => handleNode(n.key, event.timeStamp)}
            onMouseEnter={() => setHover(n.key)}
            onMouseLeave={() => setHover(h => (h === n.key ? null : h))}
            aria-label={`${n.label}: ${n.detail}`}
            style={{
              position: 'absolute', left: x - NODE_R, top: y - NODE_R,
              width: NODE_R * 2, height: NODE_R * 2, borderRadius: '50%',
              border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
            }}
          />
        )
      })}

      {/* Hover label — floating chip to the left of the orbit (open canvas space) */}
      {hoveredNode && (
        <div style={{
          position: 'absolute', right: SIZE + 8, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'none', whiteSpace: 'nowrap',
          padding: '5px 9px', borderRadius: 6,
          background: mono ? (monoInverted ? 'rgba(14,14,14,0.92)' : 'rgba(255,255,255,0.92)') : (simple ? 'rgba(255,255,255,0.92)' : 'rgba(10,10,18,0.88)'),
          border: `0.5px solid ${mono ? inkFaint : (simple ? 'rgba(0,0,0,0.12)' : `${body.color}44`)}`,
          boxShadow: simple ? '0 2px 8px rgba(0,0,0,0.12)' : '0 2px 10px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)',
        }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent }}>
            {hoveredNode.label}
          </div>
          <div style={{ fontSize: 8.5, color: dim, marginTop: 2 }}>
            {hoveredNode.detail}
          </div>
        </div>
      )}
    </div>
  )
}
