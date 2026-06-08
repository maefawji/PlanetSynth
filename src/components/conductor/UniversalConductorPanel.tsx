import { useTheme } from '../../lib/theme'
import {
  CONDUCTOR_CHORD_QUALITIES,
  CONDUCTOR_NOTE_NAMES,
  CONDUCTOR_SCALES,
  HARMONIC_MODES,
  useUniversalConductorStore,
} from '../../store/universalConductorStore'

const labelStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

export function UniversalConductorPanel() {
  const t = useTheme()
  const conductor = useUniversalConductorStore()

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    border: `0.5px solid ${t.panelBorder}`,
    borderRadius: 4,
    background: t.inputBg,
    color: t.inputText,
    fontFamily: 'inherit',
    fontSize: 11,
    padding: '5px 6px',
    outline: 'none',
  }

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      <div style={{
        padding: '8px 10px',
        borderBottom: `0.5px solid ${t.divider}`,
        background: t.sectionBg,
      }}>
        <div style={{ fontSize: 11, fontWeight: 850, color: t.text, letterSpacing: '0.03em' }}>
          Universal Context
        </div>
        <div style={{ marginTop: 3, fontSize: 9, lineHeight: 1.4, color: t.textDim }}>
          Shared musical context for the whole universe. Values are manual for now.
        </div>
      </div>

      <div style={{ padding: 10, display: 'grid', gap: 11 }}>
        <Field label="Tempo" color={t.textMid}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 50px', gap: 6, alignItems: 'center' }}>
            <input
              type="range"
              min={20}
              max={300}
              step={1}
              value={conductor.bpm}
              onChange={e => conductor.update({ bpm: Number(e.target.value) })}
            />
            <input
              type="number"
              min={20}
              max={300}
              step={1}
              value={conductor.bpm}
              onChange={e => conductor.update({ bpm: Number(e.target.value) })}
              style={{ ...inputStyle, fontFamily: 'monospace', textAlign: 'right' }}
            />
          </div>
          <div style={{ fontSize: 8, color: t.textDim, marginTop: 3 }}>BPM · connected to Tone Transport</div>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Key" color={t.textMid}>
            <select value={conductor.key} onChange={e => conductor.transposeToKey(Number(e.target.value))} style={inputStyle}>
              {CONDUCTOR_NOTE_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
            </select>
          </Field>
          <Field label="Scale" color={t.textMid}>
            <select value={conductor.scale} onChange={e => conductor.update({ scale: e.target.value as typeof conductor.scale })} style={inputStyle}>
              {CONDUCTOR_SCALES.map(scale => <option key={scale} value={scale}>{scale}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Current Chord" color={t.textMid}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.25fr 46px', gap: 6 }}>
            <select value={conductor.chordRoot} onChange={e => conductor.update({ chordRoot: Number(e.target.value) })} style={inputStyle}>
              {CONDUCTOR_NOTE_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
            </select>
            <select value={conductor.chordQuality} onChange={e => conductor.update({ chordQuality: e.target.value as typeof conductor.chordQuality })} style={inputStyle}>
              {CONDUCTOR_CHORD_QUALITIES.map(quality => <option key={quality} value={quality}>{quality}</option>)}
            </select>
            <input
              type="number"
              min={0}
              max={8}
              value={conductor.chordOctave}
              title="Chord octave"
              onChange={e => conductor.update({ chordOctave: Number(e.target.value) })}
              style={{ ...inputStyle, fontFamily: 'monospace', textAlign: 'right' }}
            />
          </div>
          <div style={{ fontSize: 8, color: t.textDim, marginTop: 3 }}>root · quality · octave</div>
        </Field>

        <Field label="Harmonic Mode" color={t.textMid}>
          <select value={conductor.harmonicMode} onChange={e => conductor.update({ harmonicMode: e.target.value as typeof conductor.harmonicMode })} style={inputStyle}>
            {HARMONIC_MODES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>

        <NormalizedField label="Density" value={conductor.density} color={t.textMid} dimColor={t.textDim}
          onChange={density => conductor.update({ density })} />
        <NormalizedField label="Tension" value={conductor.tension} color={t.textMid} dimColor={t.textDim}
          onChange={tension => conductor.update({ tension })} />
        <NormalizedField label="Quantize" value={conductor.quantize} color={t.textMid} dimColor={t.textDim}
          onChange={quantize => conductor.update({ quantize })} />
        <NormalizedField label="Sustain" value={conductor.sustain} color={t.textMid} dimColor={t.textDim}
          onChange={sustain => conductor.update({ sustain })} />

        <div style={{
          padding: '8px 9px',
          borderRadius: 5,
          background: t.inputBg,
          border: `0.5px solid ${t.panelBorder}`,
          fontSize: 10,
          color: t.textMid,
          lineHeight: 1.45,
        }}>
          <strong style={{ color: t.text }}>
            {conductor.bpm} BPM · {CONDUCTOR_NOTE_NAMES[conductor.key]} {conductor.scale}
          </strong>
          <br />
          {CONDUCTOR_NOTE_NAMES[conductor.chordRoot]} {conductor.chordQuality} · density {conductor.density.toFixed(2)} · tension {conductor.tension.toFixed(2)}
        </div>

        <button
          onClick={conductor.reset}
          style={{
            padding: '6px 8px',
            borderRadius: 4,
            border: `0.5px solid ${t.panelBorder}`,
            background: t.btnBg,
            color: t.textMid,
            fontFamily: 'inherit',
            fontSize: 9,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Reset context
        </button>
      </div>
    </div>
  )
}

function Field({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 5 }}>
      <span style={{ ...labelStyle, color }}>{label}</span>
      {children}
    </label>
  )
}

function NormalizedField({ label, value, color, dimColor, onChange }: {
  label: string
  value: number
  color: string
  dimColor: string
  onChange: (value: number) => void
}) {
  return (
    <Field label={label} color={color}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 38px', gap: 6, alignItems: 'center' }}>
        <input type="range" min={0} max={1} step={0.01} value={value} onChange={e => onChange(Number(e.target.value))} />
        <span style={{ color: dimColor, fontFamily: 'monospace', fontSize: 9, textAlign: 'right' }}>{value.toFixed(2)}</span>
      </div>
    </Field>
  )
}
