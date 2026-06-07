import { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { useTheme } from '../../lib/theme'
import {
  CONDUCTOR_NOTE_NAMES,
  formatChordName,
  useUniversalConductorStore,
} from '../../store/universalConductorStore'
import { UniversalContextPanel } from './UniversalContextPanel'

interface TransportSnapshot {
  numerator: number
  denominator: number
  bar: number
  beat: number
  tick: number
  state: 'PLAY' | 'PAUSE' | 'STOP'
}

function readTransportSnapshot(): TransportSnapshot {
  const transport = Tone.getTransport()
  const signature = transport.timeSignature
  const numerator = Array.isArray(signature) ? Number(signature[0]) : Number(signature)
  const denominator = Array.isArray(signature) ? Number(signature[1]) : 4
  const safeNumerator = Number.isFinite(numerator) && numerator > 0 ? numerator : 4
  const safeDenominator = Number.isFinite(denominator) && denominator > 0 ? denominator : 4
  const ppq = Math.max(1, Number(transport.PPQ) || 192)
  const ticksPerBeat = ppq * (4 / safeDenominator)
  const ticksPerBar = ticksPerBeat * safeNumerator
  const ticks = Math.max(0, Number(transport.ticks) || 0)
  const ticksIntoBar = ticks % ticksPerBar

  return {
    numerator: safeNumerator,
    denominator: safeDenominator,
    bar: Math.floor(ticks / ticksPerBar) + 1,
    beat: Math.floor(ticksIntoBar / ticksPerBeat) + 1,
    tick: Math.floor(ticksIntoBar % ticksPerBeat),
    state: transport.state === 'started'
      ? 'PLAY'
      : transport.state === 'paused'
        ? 'PAUSE'
        : 'STOP',
  }
}

export function UniversalContextBar() {
  const t = useTheme()
  const bpm = useUniversalConductorStore(state => state.bpm)
  const key = useUniversalConductorStore(state => state.key)
  const scale = useUniversalConductorStore(state => state.scale)
  const tuning = useUniversalConductorStore(state => state.tuning)
  const gridResolution = useUniversalConductorStore(state => state.gridResolution)
  const timeSignatureNumerator = useUniversalConductorStore(state => state.timeSignatureNumerator)
  const timeSignatureDenominator = useUniversalConductorStore(state => state.timeSignatureDenominator)
  const harmonicMode = useUniversalConductorStore(state => state.harmonicMode)
  const chordRoot = useUniversalConductorStore(state => state.chordRoot)
  const chordQuality = useUniversalConductorStore(state => state.chordQuality)
  const chordIndex = useUniversalConductorStore(state => state.chordIndex)
  const chordProgressionLength = useUniversalConductorStore(state => state.chordProgressionLength)
  const chordProgression = useUniversalConductorStore(state => state.chordProgression)
  const activeSlot = chordProgression[chordIndex]
  const [transport, setTransport] = useState(readTransportSnapshot)
  const [open, setOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const refresh = () => setTransport(readTransportSnapshot())
    const timer = window.setInterval(refresh, 100)
    return () => window.clearInterval(timer)
  }, [])

  const chordDisplay = activeSlot
    ? formatChordName(activeSlot.root, activeSlot.quality, activeSlot.bassRoot)
    : formatChordName(chordRoot, chordQuality)

  const items = [
    { label: 'TEMPO', value: `${bpm} BPM` },
    { label: 'KEY', value: `${CONDUCTOR_NOTE_NAMES[key]} ${scale}` },
    { label: 'TIME', value: `${timeSignatureNumerator}/${timeSignatureDenominator}` },
    { label: 'MODE', value: harmonicMode },
    { label: 'CHORD', value: chordDisplay, active: true },
    { label: 'STEP', value: `${chordIndex + 1} / ${chordProgressionLength}` },
    { label: 'TRANSPORT', value: transport.state, active: transport.state === 'PLAY' },
    { label: 'POSITION', value: `${transport.bar}.${transport.beat}.${transport.tick}` },
  ]

  // Compute panel anchor from bar position
  const getAnchor = () => {
    const el = barRef.current
    if (!el) return { left: 455, right: 8, top: 38 }
    const rect = el.getBoundingClientRect()
    return { left: rect.left, right: window.innerWidth - rect.right, top: rect.bottom }
  }
  const anchor = getAnchor()

  return (
    <>
      <div
        ref={barRef}
        className="universal-context-bar"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={items.map(item => `${item.label}: ${item.value}`).join('. ')}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setOpen(o => !o) }}
        style={{
          position: 'absolute',
          top: 8,
          left: 455,
          right: 8,
          zIndex: 52,
          minWidth: 0,
          height: 30,
          display: 'flex',
          alignItems: 'stretch',
          overflow: 'hidden',
          borderRadius: open ? '5px 5px 0 0' : 5,
          border: `0.5px solid ${open ? 'rgba(167,139,250,0.5)' : t.panelBorder}`,
          background: open ? t.sectionBg : t.headerBg,
          boxShadow: open ? '0 0 0 1px rgba(167,139,250,0.15)' : '0 2px 8px rgba(0,0,0,0.18)',
          backdropFilter: 'blur(8px)',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'border-color 0.15s, background 0.15s, border-radius 0.1s',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 9px',
          color: open ? '#a78bfa' : 'rgba(167,139,250,0.7)',
          fontSize: 8,
          fontWeight: 900,
          letterSpacing: '0.11em',
          whiteSpace: 'nowrap',
          borderRight: `0.5px solid ${t.divider}`,
          gap: 5,
        }}>
          UNIVERSAL CONTEXT
          <span style={{
            fontSize: 7,
            color: open ? '#a78bfa' : t.textDim,
            transition: 'transform 0.15s',
            display: 'inline-block',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}>▾</span>
        </div>
        <div style={{
          flex: 1,
          minWidth: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
        }}>
          {items.map(item => (
            <div key={item.label} style={{
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '0 7px',
              borderRight: `0.5px solid ${t.divider}`,
            }}>
              <span style={{
                fontSize: 6.5,
                lineHeight: 1,
                color: t.textDim,
                letterSpacing: '0.08em',
                whiteSpace: 'nowrap',
              }}>
                {item.label}
              </span>
              <span style={{
                marginTop: 3,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                color: item.active ? '#22c55e' : t.text,
                fontFamily: 'monospace',
                fontSize: 8.5,
                fontWeight: 800,
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}>
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {open && (
        <UniversalContextPanel
          onClose={() => setOpen(false)}
          anchorLeft={anchor.left}
          anchorRight={anchor.right}
          anchorTop={anchor.top}
        />
      )}
    </>
  )
}
