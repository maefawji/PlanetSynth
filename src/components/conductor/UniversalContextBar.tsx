import { useEffect, useState } from 'react'
import * as Tone from 'tone'
import { useTheme } from '../../lib/theme'
import {
  CONDUCTOR_NOTE_NAMES,
  useUniversalConductorStore,
} from '../../store/universalConductorStore'

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
  const [transport, setTransport] = useState(readTransportSnapshot)

  useEffect(() => {
    const refresh = () => setTransport(readTransportSnapshot())
    const timer = window.setInterval(refresh, 100)
    return () => window.clearInterval(timer)
  }, [])

  const items = [
    { label: 'TEMPO', value: `${bpm} BPM` },
    { label: 'KEY', value: CONDUCTOR_NOTE_NAMES[key] },
    { label: 'TIME', value: `${transport.numerator}/${transport.denominator}` },
    { label: 'SCALE', value: scale },
    { label: 'TUNING', value: 'A4 440 Hz' },
    { label: 'GRID', value: '1/16' },
    { label: 'TRANSPORT', value: transport.state, active: transport.state === 'PLAY' },
    { label: 'POSITION', value: `${transport.bar}.${transport.beat}.${transport.tick}` },
  ]

  return (
    <div
      className="universal-context-bar"
      role="status"
      aria-label={items.map(item => `${item.label}: ${item.value}`).join('. ')}
      style={{
        position: 'absolute',
        top: 8,
        left: 455,
        right: 8,
        zIndex: 12,
        minWidth: 0,
        height: 30,
        display: 'flex',
        alignItems: 'stretch',
        overflow: 'hidden',
        borderRadius: 5,
        border: `0.5px solid ${t.panelBorder}`,
        background: t.headerBg,
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        backdropFilter: 'blur(8px)',
        pointerEvents: 'none',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 9px',
        color: '#a78bfa',
        fontSize: 8,
        fontWeight: 900,
        letterSpacing: '0.11em',
        whiteSpace: 'nowrap',
        borderRight: `0.5px solid ${t.divider}`,
      }}>
        UNIVERSAL CONTEXT
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
  )
}
