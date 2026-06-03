import { useState, useEffect } from 'react'
import { usePlanetStore } from '../../store/planetStore'
import {
  useControlSetStore,
  MAX_TRIGGERS,
  MAX_EFFECTS,
} from '../../store/controlSetStore'
import { getBodyOutputLevel } from '../../audio/bodyOutputMeter'
import { getBodyTriggerAge } from '../../audio/intersectionSynth'
import { useWholeInstrumentStore } from '../../store/wholeInstrumentStore'
import { useOrbitTransformStore, type OrbitTransformOutput } from '../../store/orbitTransformStore'
import { useProjectStore } from '../../store/projectStore'

// ── Theme ─────────────────────────────────────────────────────────────────────

function useT(simple: boolean) {
  return {
    bg:        simple ? '#f2f2f0' : '#090910',
    panelBg:   simple ? 'rgba(255,255,255,0.88)' : 'rgba(18,18,32,0.94)',
    border:    simple ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.09)',
    rowBorder: simple ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)',
    hdrBg:     simple ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)',
    text:      simple ? '#111' : '#dde0f0',
    dim:       simple ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.25)',
    dimBg:     simple ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)',
    addBorder: simple ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.14)',
  }
}

// Stage accent colors
const C = {
  orbit:      '#64748b',
  trigger:    '#f59e0b',
  instrument: '#8b5cf6',
  effect:     '#06b6d4',
  mixer:      '#f472b6',
  standpoint: '#0891b2',
  transform:  '#a78bfa',
  whole:      '#22d3ee',
  master:     '#34d399',
}

const ROW_H  = 72   // fixed row height per body
const HDR_H  = 36   // stage column header height
const FLASH_MS = 350

// ── Shared mini components ────────────────────────────────────────────────────

function VuBar({ level, color, h = 3 }: { level: number; color: string; h?: number }) {
  return (
    <div style={{ flex: 1, height: h, borderRadius: h / 2, overflow: 'hidden', background: 'rgba(128,128,128,0.10)' }}>
      <div style={{
        height: '100%', width: `${Math.min(1, level) * 100}%`,
        background: level > 0.8 ? '#f87171' : level > 0.5 ? '#fbbf24' : color,
        borderRadius: h / 2, transition: 'width 0.05s linear',
      }} />
    </div>
  )
}

function InlineBtn({ label, onClick, t }: { label: string; onClick: () => void; t: ReturnType<typeof useT> }) {
  return (
    <button onClick={onClick}
      style={{ padding: '1px 5px', fontSize: 7, border: `0.5px dashed ${t.addBorder}`, borderRadius: 3, background: 'none', cursor: 'pointer', color: t.dim, fontFamily: 'inherit' }}
      onMouseEnter={e => (e.currentTarget.style.color = t.text)}
      onMouseLeave={e => (e.currentTarget.style.color = t.dim)}
    >{label}</button>
  )
}

function RemoveBtn({ onClick, t }: { onClick: () => void; t: ReturnType<typeof useT> }) {
  return (
    <button onClick={onClick}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: 8, color: t.dim, lineHeight: 1, flexShrink: 0 }}
      onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
      onMouseLeave={e => (e.currentTarget.style.color = t.dim)}
    >×</button>
  )
}

// Floating dropdown picker
function Picker({ color, items, onPick, onClose }: {
  color: string
  items: { id: string; name: string; icon: string; color: string }[]
  onPick: (id: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    const h = (e: MouseEvent) => { onClose(); e.stopPropagation() }
    setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'absolute', top: 'calc(100% + 3px)', left: 0, zIndex: 300,
        background: '#141428', border: `0.5px solid ${color}55`,
        borderRadius: 7, padding: 4, minWidth: 155,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
      }}>
      {items.map(cs => (
        <button key={cs.id} onClick={() => { onPick(cs.id); onClose() }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '4px 7px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 4, fontFamily: 'inherit' }}
          onMouseEnter={e => (e.currentTarget.style.background = `${cs.color}22`)}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <span style={{ fontSize: 10 }}>{cs.icon}</span>
          <span style={{ fontSize: 8, color: cs.color, fontWeight: 700 }}>{cs.name}</span>
        </button>
      ))}
    </div>
  )
}

// ── Stage header ──────────────────────────────────────────────────────────────

function StageHdr({ icon, label, color, sub, t }: {
  icon: string; label: string; color: string; sub?: string
  t: ReturnType<typeof useT>
}) {
  return (
    <div style={{
      height: HDR_H, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 1,
      background: t.hdrBg, borderBottom: `1.5px solid ${color}55`,
      padding: '0 10px',
    }}>
      <span style={{ fontSize: 9, fontWeight: 800, color, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        {icon} {label}
      </span>
      {sub && <span style={{ fontSize: 6, color, opacity: 0.5, letterSpacing: '0.05em' }}>{sub}</span>}
    </div>
  )
}

// ── Connector (horizontal arrow between stages) ───────────────────────────────
// One arrow per body row, all stacked in a narrow column

function ConnCol({ rowLevels, simple, t }: {
  rowLevels: number[]
  simple: boolean
  t: ReturnType<typeof useT>
}) {
  const dim = simple ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.10)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, width: 20 }}>
      <div style={{ height: HDR_H }} />
      {rowLevels.map((lv, i) => {
        const active = lv > 0.04
        const col = lv > 0.7 ? '#f87171' : lv > 0.3 ? '#fbbf24' : '#34d399'
        return (
          <div key={i} style={{
            height: ROW_H, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderBottom: `0.5px solid ${t.rowBorder}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ width: 9, height: 1.5, background: active ? col : dim, boxShadow: active ? `0 0 4px ${col}` : 'none', transition: 'background 0.1s' }} />
              <div style={{ width: 0, height: 0, borderTop: '3.5px solid transparent', borderBottom: '3.5px solid transparent', borderLeft: `4.5px solid ${active ? col : dim}`, transition: 'border-left-color 0.1s' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Body name column ──────────────────────────────────────────────────────────

function BodyNameCol({ bodies, selectedBodyId, t }: {
  bodies: { id: string; name: string; color: string; type: string; muted: boolean }[]
  selectedBodyId: string | null
  t: ReturnType<typeof useT>
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      background: t.panelBg,
      borderRight: `0.5px solid ${t.border}`,
      borderRadius: '10px 0 0 10px',
    }}>
      <div style={{ height: HDR_H, display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.hdrBg, borderBottom: `0.5px solid ${t.border}`, borderRadius: '10px 0 0 0', padding: '0 14px' }}>
        <span style={{ fontSize: 7.5, fontWeight: 800, color: t.dim, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Body</span>
      </div>
      {bodies.map(b => (
        <div key={b.id} style={{
          height: ROW_H, display: 'flex', alignItems: 'center', gap: 7,
          padding: '0 12px',
          borderBottom: `0.5px solid ${t.rowBorder}`,
          background: b.id === selectedBodyId ? `${b.color}10` : undefined,
          opacity: b.muted ? 0.45 : 1,
        }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: b.color, boxShadow: `0 0 6px ${b.color}88` }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: t.text, lineHeight: 1, whiteSpace: 'nowrap' }}>{b.name}</span>
            <span style={{ fontSize: 6.5, color: t.dim, lineHeight: 1 }}>{b.type === 'sun' ? '☀ sun' : '● planet'}</span>
            {b.muted && <span style={{ fontSize: 6, color: '#f87171', fontWeight: 700, lineHeight: 1 }}>MUTED</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Cell wrappers ─────────────────────────────────────────────────────────────

function Cell({ children, t, selected, color }: {
  children: React.ReactNode
  t: ReturnType<typeof useT>
  selected?: boolean
  color?: string
}) {
  return (
    <div style={{
      height: ROW_H, borderBottom: `0.5px solid ${t.rowBorder}`,
      background: selected && color ? `${color}08` : undefined,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '5px 9px', overflow: 'hidden',
    }}>
      {children}
    </div>
  )
}

// ── Orbit cell ────────────────────────────────────────────────────────────────

function OrbitCell({ body, selected, t }: {
  body: { vx: number; vy: number; fixed: boolean; mass: number; color: string }
  selected: boolean
  t: ReturnType<typeof useT>
}) {
  const speed = Math.sqrt(body.vx * body.vx + body.vy * body.vy)
  return (
    <Cell t={t} selected={selected} color={C.orbit}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <VuBar level={Math.min(1, speed / 200)} color={C.orbit} h={2} />
        <span style={{ fontSize: 7, fontFamily: 'monospace', color: C.orbit, minWidth: 30, textAlign: 'right' }}>
          {speed.toFixed(1)}<span style={{ fontSize: 6, opacity: 0.6 }}> u/s</span>
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <span style={{ fontSize: 7, color: body.fixed ? '#f59e0b' : t.dim, fontWeight: body.fixed ? 700 : 400 }}>
          {body.fixed ? '⚓ fixed' : '⟳ orbit'}
        </span>
        <span style={{ fontSize: 7, color: t.dim }}>m={body.mass}</span>
      </div>
    </Cell>
  )
}

// ── Trigger cell ──────────────────────────────────────────────────────────────

function TriggerCell({ bodyId, triggers, flash, selected, t }: {
  bodyId: string
  triggers: string[]
  flash: number
  selected: boolean
  t: ReturnType<typeof useT>
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const { addBodyTrigger, removeBodyTrigger, getControlSetsByCategory, getControlSetById } = useControlSetStore()
  const available = getControlSetsByCategory('trigger')
  const list = triggers.map(id => getControlSetById(id))

  return (
    <Cell t={t} selected={selected} color={C.trigger}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {list.map((cs, i) => cs && (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 5px 2px 6px', borderLeft: `2px solid ${C.trigger}`, background: t.dimBg, borderRadius: 4 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: flash > 0.05 ? C.trigger : `${C.trigger}44`, boxShadow: flash > 0.05 ? `0 0 4px ${C.trigger}` : 'none', transition: 'all 0.06s' }} />
            <span style={{ fontSize: 7.5, color: C.trigger, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cs.name}</span>
            <RemoveBtn onClick={() => removeBodyTrigger(bodyId, i)} t={t} />
          </div>
        ))}
        {list.length === 0 && <span style={{ fontSize: 7, color: t.dim, fontStyle: 'italic' }}>none</span>}
        {triggers.length < MAX_TRIGGERS && (
          <div style={{ position: 'relative' }}>
            <InlineBtn label="+ add" onClick={() => setPickerOpen(true)} t={t} />
            {pickerOpen && <Picker color={C.trigger} items={available} onPick={id => addBodyTrigger(bodyId, id)} onClose={() => setPickerOpen(false)} />}
          </div>
        )}
      </div>
    </Cell>
  )
}

// ── Instrument cell ───────────────────────────────────────────────────────────

function InstrumentCell({ bodyId, instrument, outLevel, selected, t }: {
  bodyId: string
  instrument: string | null
  outLevel: number
  selected: boolean
  t: ReturnType<typeof useT>
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const { setBodySlot, clearBodySlot, getControlSetsByCategory, getControlSetById } = useControlSetStore()
  const available = getControlSetsByCategory('instrument')
  const cs = getControlSetById(instrument)

  return (
    <Cell t={t} selected={selected} color={C.instrument}>
      {cs ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 5px 2px 6px', borderLeft: `2px solid ${C.instrument}`, background: t.dimBg, borderRadius: 4 }}>
            <span style={{ fontSize: 9, flexShrink: 0 }}>{cs.icon}</span>
            <span style={{ fontSize: 7.5, color: C.instrument, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cs.name}</span>
            <RemoveBtn onClick={() => clearBodySlot(bodyId, 'instrument')} t={t} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <VuBar level={outLevel} color={C.instrument} h={2} />
            <span style={{ fontSize: 6.5, fontFamily: 'monospace', color: C.instrument, minWidth: 20, textAlign: 'right' }}>{Math.round(outLevel * 100)}</span>
          </div>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <span style={{ fontSize: 7, color: t.dim, fontStyle: 'italic', display: 'block', marginBottom: 3 }}>none</span>
          <InlineBtn label="+ set" onClick={() => setPickerOpen(true)} t={t} />
          {pickerOpen && <Picker color={C.instrument} items={available} onPick={id => setBodySlot(bodyId, 'instrument', id)} onClose={() => setPickerOpen(false)} />}
        </div>
      )}
    </Cell>
  )
}

// ── Effect cell ───────────────────────────────────────────────────────────────

function EffectCell({ bodyId, effects, outLevel, selected, t }: {
  bodyId: string
  effects: string[]
  outLevel: number
  selected: boolean
  t: ReturnType<typeof useT>
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const { addBodyEffect, removeBodyEffect, getControlSetsByCategory, getControlSetById } = useControlSetStore()
  const available = getControlSetsByCategory('effect')
  const list = effects.map(id => getControlSetById(id))

  return (
    <Cell t={t} selected={selected} color={C.effect}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {list.map((cs, i) => cs && (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 5px 2px 6px', borderLeft: `2px solid ${C.effect}`, background: t.dimBg, borderRadius: 4 }}>
            <span style={{ fontSize: 8, flexShrink: 0 }}>{cs.icon}</span>
            <span style={{ fontSize: 7.5, color: C.effect, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cs.name}</span>
            <RemoveBtn onClick={() => removeBodyEffect(bodyId, i)} t={t} />
          </div>
        ))}
        {list.length === 0 && <span style={{ fontSize: 7, color: t.dim, fontStyle: 'italic' }}>∅ pass-through</span>}
        {effects.length < MAX_EFFECTS && (
          <div style={{ position: 'relative' }}>
            <InlineBtn label="+ add" onClick={() => setPickerOpen(true)} t={t} />
            {pickerOpen && <Picker color={C.effect} items={available} onPick={id => addBodyEffect(bodyId, id)} onClose={() => setPickerOpen(false)} />}
          </div>
        )}
      </div>
    </Cell>
  )
}

// ── Mixer cell ────────────────────────────────────────────────────────────────

function MixerCell({ body, outLevel, selected, t }: {
  body: { volume: number; muted: boolean; color: string }
  outLevel: number
  selected: boolean
  t: ReturnType<typeof useT>
}) {
  const postFader = body.muted ? 0 : outLevel * body.volume
  return (
    <Cell t={t} selected={selected} color={C.mixer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 6.5, color: t.dim, minWidth: 20 }}>vol</span>
          <div style={{ flex: 1, height: 3, borderRadius: 1.5, overflow: 'hidden', background: 'rgba(128,128,128,0.10)' }}>
            <div style={{ height: '100%', width: `${body.volume * 100}%`, background: C.mixer, borderRadius: 1.5 }} />
          </div>
          <span style={{ fontSize: 7, fontFamily: 'monospace', color: C.mixer, minWidth: 24, textAlign: 'right' }}>{body.volume.toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 6.5, color: body.muted ? '#f87171' : t.dim, minWidth: 20, fontWeight: body.muted ? 700 : 400 }}>
            {body.muted ? 'mute' : 'out'}
          </span>
          <VuBar level={postFader} color={C.mixer} h={3} />
          <span style={{ fontSize: 7, fontFamily: 'monospace', color: C.mixer, minWidth: 24, textAlign: 'right' }}>{Math.round(postFader * 100)}</span>
        </div>
      </div>
    </Cell>
  )
}

// ── Standpoint cell ───────────────────────────────────────────────────────────

function StandpointCell({ bodyId, simParams, outLevel, selected, t }: {
  bodyId: string
  simParams: { standpointBodyId: string | null }
  outLevel: number
  selected: boolean
  t: ReturnType<typeof useT>
}) {
  const isListener = simParams.standpointBodyId === bodyId
  const spOn = Boolean(simParams.standpointBodyId)

  return (
    <Cell t={t} selected={selected} color={C.standpoint}>
      {isListener ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 10 }}>⊕</span>
          <span style={{ fontSize: 7.5, color: C.standpoint, fontWeight: 700 }}>Listener</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: spOn ? 1 : 0.4 }}>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <span style={{ fontSize: 6.5, color: t.dim, minWidth: 20 }}>vol</span>
            <span style={{ fontSize: 7, fontFamily: 'monospace', color: C.standpoint }}>{spOn ? '···' : '1.00'}</span>
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <span style={{ fontSize: 6.5, color: t.dim, minWidth: 20 }}>pan</span>
            <span style={{ fontSize: 7, fontFamily: 'monospace', color: C.standpoint }}>{spOn ? '···' : '0.00'}</span>
          </div>
          {!spOn && <span style={{ fontSize: 6, color: t.dim, fontStyle: 'italic' }}>off</span>}
        </div>
      )}
    </Cell>
  )
}

// ── Master output node (rightmost) ───────────────────────────────────────────

function MasterNode({ bodies, levels, t }: {
  bodies: { id: string; color: string; muted: boolean }[]
  levels: Record<string, number>
  t: ReturnType<typeof useT>
}) {
  const total = Math.min(1, bodies.reduce((s, b) => s + (b.muted ? 0 : (levels[b.id] ?? 0)), 0))
  const glowCol = total > 0.7 ? '#f87171' : total > 0.3 ? '#fbbf24' : C.master

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, alignSelf: 'stretch' }}>
      {/* header aligns with stage headers */}
      <div style={{
        height: HDR_H,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: t.hdrBg,
        borderBottom: `1.5px solid ${C.master}55`,
        padding: '0 10px',
        borderRadius: '0 10px 0 0',
      }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: C.master, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
          ↑ Master
        </span>
      </div>

      {/* body rows — just a converging VU bar per body */}
      {bodies.map(b => {
        const lv = b.muted ? 0 : (levels[b.id] ?? 0)
        return (
          <div key={b.id} style={{
            height: ROW_H, borderBottom: `0.5px solid ${t.rowBorder}`,
            display: 'flex', alignItems: 'center',
            padding: '0 10px', gap: 5,
          }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: b.color, opacity: lv > 0.04 ? 1 : 0.2, flexShrink: 0 }} />
            <VuBar level={lv} color={b.color} h={3} />
          </div>
        )
      })}

      {/* total sum */}
      <div style={{
        flex: 1, minHeight: 48,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5,
        padding: '8px 12px',
        background: t.hdrBg,
        borderRadius: '0 0 10px 0',
        boxShadow: total > 0.04 ? `inset 0 0 ${Math.round(total * 16)}px ${glowCol}22` : 'none',
        transition: 'box-shadow 0.1s',
      }}>
        <span style={{ fontSize: 6.5, fontWeight: 800, color: C.master, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Total</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <VuBar level={total} color={C.master} h={5} />
          <span style={{ fontSize: 7, fontFamily: 'monospace', color: C.master, minWidth: 24, textAlign: 'right' }}>{Math.round(total * 100)}</span>
        </div>
      </div>
    </div>
  )
}

// ── Global rack info bar ──────────────────────────────────────────────────────

function GlobalRackBar({ t }: { t: ReturnType<typeof useT> }) {
  const { globalRack, getControlSetById } = useControlSetStore()
  const trigNames = globalRack.triggers.map(id => getControlSetById(id)?.name ?? id)
  const instName  = globalRack.instrument ? (getControlSetById(globalRack.instrument)?.name ?? globalRack.instrument) : '—'
  const fxNames   = globalRack.effects.map(id => getControlSetById(id)?.name ?? id)

  return (
    <div style={{
      flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
      padding: '5px 14px',
      background: t.hdrBg,
      borderBottom: `0.5px solid ${t.border}`,
      fontSize: 7.5,
    }}>
      <span style={{ fontWeight: 800, color: t.dim, letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 }}>
        Global default rack
      </span>
      <span style={{ color: t.dim, flexShrink: 0 }}>→</span>
      <span style={{ color: C.trigger }}>▶ {trigNames.length ? trigNames.join(', ') : '—'}</span>
      <span style={{ color: t.dim }}>›</span>
      <span style={{ color: C.instrument }}>◈ {instName}</span>
      <span style={{ color: t.dim }}>›</span>
      <span style={{ color: C.effect }}>◆ {fxNames.length ? fxNames.join(', ') : '—'}</span>
      <span style={{ flex: 1 }} />
      <span style={{ color: t.dim, fontStyle: 'italic' }}>
        bodies without overrides inherit these settings
      </span>
    </div>
  )
}

function RouteChip({ label, value, color, t }: {
  label: string
  value: string
  color: string
  t: ReturnType<typeof useT>
}) {
  return (
    <div style={{
      minWidth: 108,
      border: `0.5px solid ${color}55`,
      borderRadius: 6,
      background: `${color}12`,
      padding: '6px 9px',
    }}>
      <div style={{ fontSize: 6.5, fontWeight: 800, color, letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 9, fontWeight: 800, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    </div>
  )
}

function WholeRouteBar({ t }: { t: ReturnType<typeof useT> }) {
  const whole = useWholeInstrumentStore()
  const transformNodes = useOrbitTransformStore(s => s.nodes)
  const samples = useProjectStore(s => s.project.samples)
  const activeTransformCount = (Object.keys(transformNodes) as OrbitTransformOutput[])
    .filter(id => transformNodes[id].enabled)
    .length
  const sampleName = whole.samplerSampleId
    ? samples.find(s => s.id === whole.samplerSampleId)?.name ?? 'missing sample'
    : samples[0]?.name ?? 'no sample'
  const instrumentDetail = whole.type === 'sampler'
    ? `sampler · ${sampleName}`
    : whole.type === 'wave-drone'
      ? 'wave drone'
      : 'off'

  return (
    <div style={{
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      padding: '8px 14px',
      background: t.panelBg,
      borderBottom: `0.5px solid ${t.border}`,
      fontSize: 8,
    }}>
      <span style={{ fontWeight: 800, color: t.dim, letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 }}>
        Whole route
      </span>
      <RouteChip label="source" value="Orbit Hub telemetry" color={C.orbit} t={t} />
      <span style={{ color: t.dim }}>›</span>
      <RouteChip label="transform" value={`${activeTransformCount} nodes · level/cutoff/motion/root`} color={C.transform} t={t} />
      <span style={{ color: t.dim }}>›</span>
      <RouteChip label="instrument" value={instrumentDetail} color={C.whole} t={t} />
      <span style={{ color: t.dim }}>›</span>
      <RouteChip label="output" value="master destination" color={C.master} t={t} />
      <span style={{ flex: 1 }} />
      <span style={{ color: t.dim, fontStyle: 'italic' }}>
        Transform Lab controls how Orbit Hub data reaches Whole Instrument.
      </span>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function DevRouteView() {
  const bodies         = usePlanetStore(s => s.bodies)
  const simParams      = usePlanetStore(s => s.simParams)
  const simple         = simParams.simpleTheme
  const selectedBodyId = usePlanetStore(s => s.selectedBodyId)
  const t              = useT(simple)
  const { getBodyEffectiveRack } = useControlSetStore()

  const [levels,     setLevels]     = useState<Record<string, number>>({})
  const [trigFlashes, setTrigFlashes] = useState<Record<string, number>>({})

  useEffect(() => {
    const id = setInterval(() => {
      const lv: Record<string, number> = {}
      const tf: Record<string, number> = {}
      for (const b of bodies) {
        lv[b.id] = getBodyOutputLevel(b.id)
        const age = getBodyTriggerAge(b.id)
        tf[b.id] = isFinite(age) ? Math.max(0, 1 - age / FLASH_MS) : 0
      }
      setLevels(lv)
      setTrigFlashes(tf)
    }, 50)
    return () => clearInterval(id)
  }, [bodies])

  // Per-body effective racks
  const racks = Object.fromEntries(bodies.map(b => [b.id, getBodyEffectiveRack(b.id)]))

  // Connector levels between each stage
  const trigLevels  = bodies.map(b => trigFlashes[b.id] ?? 0)
  const instLevels  = bodies.map(b => levels[b.id] ?? 0)
  const fxLevels    = instLevels
  const mixLevels   = bodies.map(b => b.muted ? 0 : (levels[b.id] ?? 0))
  const spLevels    = mixLevels

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: t.bg, overflow: 'hidden' }}>

      {/* ── Top bar ── */}
      <div style={{
        height: 32, flexShrink: 0, display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 8,
        borderBottom: `0.5px solid ${t.border}`,
        background: t.panelBg,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: t.text, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          ⬡ Audio Routing
        </span>
        <div style={{ width: 1, height: 12, background: t.border }} />
        {([
          ['⊙', 'Orbit', C.orbit],
          ['▶', 'Trigger', C.trigger],
          ['◈', 'Instrument', C.instrument],
          ['◆', 'Effect', C.effect],
          ['▧', 'Mixer', C.mixer],
          ['◉', 'Standpoint', C.standpoint],
          ['◇', 'Transform', C.transform],
          ['∿', 'Whole', C.whole],
          ['↑', 'Master', C.master],
        ] as [string, string, string][]).map(([icon, label, color], i, arr) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 8, color, fontWeight: 600 }}>{icon} {label}</span>
            {i < arr.length - 1 && <span style={{ fontSize: 9, color: t.dim, opacity: 0.35 }}>›</span>}
          </span>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 8.5, color: t.dim }}>{bodies.length} bod{bodies.length !== 1 ? 'ies' : 'y'}</span>
      </div>

      {/* ── Global rack info ── */}
      <GlobalRackBar t={t} />
      <WholeRouteBar t={t} />

      {/* ── Pipeline ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px 40px' }}>
        {bodies.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 10 }}>
            <span style={{ fontSize: 28, opacity: 0.3 }}>⬡</span>
            <span style={{ fontSize: 11, color: t.dim, fontStyle: 'italic' }}>Planet modeでbodyを追加するとここにルーティングが表示されます。</span>
          </div>
        ) : (
          /* Outer rail: stages are panels with synchronized row heights */
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 0,
            border: `0.5px solid ${t.border}`, borderRadius: 10,
            overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
          }}>

            {/* Body names */}
            <BodyNameCol
              bodies={bodies.map(b => ({ id: b.id, name: b.name, color: b.color, type: b.type, muted: b.muted }))}
              selectedBodyId={selectedBodyId}
              t={t}
            />

            {/* ── ⊙ Orbit ── */}
            <ConnCol rowLevels={bodies.map(() => 0.18)} simple={simple} t={t} />
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, background: t.panelBg, borderRight: `0.5px solid ${t.border}`, minWidth: 118 }}>
              <StageHdr icon="⊙" label="Orbit" color={C.orbit} sub="source" t={t} />
              {bodies.map(b => (
                <OrbitCell key={b.id} body={b} selected={b.id === selectedBodyId} t={t} />
              ))}
            </div>

            {/* ── ▶ Trigger ── */}
            <ConnCol rowLevels={bodies.map(b => (levels[b.id] ?? 0) > 0.04 ? 0.4 : 0.12)} simple={simple} t={t} />
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, background: t.panelBg, borderRight: `0.5px solid ${t.border}`, minWidth: 145 }}>
              <StageHdr icon="▶" label="Trigger" color={C.trigger} t={t} />
              {bodies.map(b => (
                <TriggerCell key={b.id}
                  bodyId={b.id}
                  triggers={racks[b.id]?.triggers ?? []}
                  flash={trigFlashes[b.id] ?? 0}
                  selected={b.id === selectedBodyId}
                  t={t}
                />
              ))}
            </div>

            {/* ── ◈ Instrument ── */}
            <ConnCol rowLevels={trigLevels} simple={simple} t={t} />
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, background: t.panelBg, borderRight: `0.5px solid ${t.border}`, minWidth: 148 }}>
              <StageHdr icon="◈" label="Instrument" color={C.instrument} t={t} />
              {bodies.map(b => (
                <InstrumentCell key={b.id}
                  bodyId={b.id}
                  instrument={racks[b.id]?.instrument ?? null}
                  outLevel={levels[b.id] ?? 0}
                  selected={b.id === selectedBodyId}
                  t={t}
                />
              ))}
            </div>

            {/* ── ◆ Effect ── */}
            <ConnCol rowLevels={instLevels} simple={simple} t={t} />
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, background: t.panelBg, borderRight: `0.5px solid ${t.border}`, minWidth: 148 }}>
              <StageHdr icon="◆" label="Effect" color={C.effect} sub="multi-input" t={t} />
              {bodies.map(b => (
                <EffectCell key={b.id}
                  bodyId={b.id}
                  effects={racks[b.id]?.effects ?? []}
                  outLevel={levels[b.id] ?? 0}
                  selected={b.id === selectedBodyId}
                  t={t}
                />
              ))}
            </div>

            {/* ── ▧ Mixer ── */}
            <ConnCol rowLevels={fxLevels} simple={simple} t={t} />
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, background: t.panelBg, borderRight: `0.5px solid ${t.border}`, minWidth: 118 }}>
              <StageHdr icon="▧" label="Mixer" color={C.mixer} sub="fader" t={t} />
              {bodies.map(b => (
                <MixerCell key={b.id}
                  body={b}
                  outLevel={levels[b.id] ?? 0}
                  selected={b.id === selectedBodyId}
                  t={t}
                />
              ))}
            </div>

            {/* ── ◉ Standpoint ── */}
            <ConnCol rowLevels={mixLevels} simple={simple} t={t} />
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, background: t.panelBg, borderRight: `0.5px solid ${t.border}`, minWidth: 115 }}>
              <StageHdr icon="◉" label="Standpoint" color={C.standpoint} t={t} />
              {bodies.map(b => (
                <StandpointCell key={b.id}
                  bodyId={b.id}
                  simParams={simParams}
                  outLevel={levels[b.id] ?? 0}
                  selected={b.id === selectedBodyId}
                  t={t}
                />
              ))}
            </div>

            {/* ── ↑ Master ── */}
            <ConnCol rowLevels={spLevels} simple={simple} t={t} />
            <MasterNode bodies={bodies} levels={levels} t={t} />

          </div>
        )}
      </div>
    </div>
  )
}
