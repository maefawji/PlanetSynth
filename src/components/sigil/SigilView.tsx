import { useMemo, useState, useCallback } from 'react'
import { useTheme } from '../../lib/theme'
import {
  COMPOSITION_MODES,
  CORE_MOTIFS,
  INTERIOR_MOTIFS,
  STRUCTURES,
  STRUCTURE_OPERATORS,
  TERMINAL_MOTIFS,
  generateFromGrammar,
  randomGrammar,
  randomSeed,
} from '../../sigil/sigilGenerator'
import type {
  CoreMotif,
  GeneratedSigil,
  InteriorMotif,
  SigilGrammar,
  SigilLayer,
  StructureCompositionMode,
  StructureOperator,
  StructuralType,
  TerminalMotif,
} from '../../sigil/sigilGenerator'

const LAYER_COLOR: Record<SigilLayer['family'], string> = {
  structure: '#60a5fa',
  composition: '#22d3ee',
  operator:  '#fb7185',
  primary:   '#f8fafc',
  secondary: '#a78bfa',
  terminal:  '#34d399',
  interior:  '#f59e0b',
}

function makeSigil(seed: number, locks: Partial<SigilGrammar>): GeneratedSigil {
  return generateFromGrammar(randomGrammar(seed, locks))
}

function label(value: string): string {
  return value.replace(/-/g, ' ')
}

function SelectField<T extends string>({
  labelText,
  value,
  values,
  onChange,
}: {
  labelText: string
  value: T
  values: readonly T[]
  onChange: (value: T) => void
}) {
  const t = useTheme()
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 122 }}>
      <span style={{ fontSize: 8, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{labelText}</span>
      <select value={value} onChange={e => onChange(e.target.value as T)} style={{
        height: 25,
        borderRadius: 4,
        border: `0.5px solid ${t.divider}`,
        background: t.inputBg,
        color: t.inputText,
        fontSize: 10,
        fontFamily: 'inherit',
        padding: '0 6px',
      }}>
        {values.map(v => <option key={v} value={v}>{label(v)}</option>)}
      </select>
    </label>
  )
}

function SigilSvg({ sigil }: { sigil: GeneratedSigil }) {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ display: 'block', color: '#fff' }}>
      {sigil.shapes.map((s, i) => {
        const strokeWidth = 1.9
        const opacity = 1
        if (s.kind === 'circle') {
          return (
            <circle key={i} cx={s.cx} cy={s.cy} r={s.r}
              fill={s.renderMode === 'stroke' ? 'none' : '#fff'}
              stroke={s.renderMode === 'fill' ? 'none' : '#fff'}
              strokeWidth={strokeWidth}
              opacity={opacity}
            />
          )
        }
        if (s.kind === 'polygon') {
          return (
            <polygon key={i}
              points={s.points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}
              fill={s.renderMode === 'stroke' ? 'none' : '#fff'}
              stroke={s.renderMode === 'fill' ? 'none' : '#fff'}
              strokeWidth={strokeWidth}
              strokeLinejoin="round"
              opacity={opacity}
            />
          )
        }
        return (
          <path key={i} d={s.d}
            fill={s.renderMode === 'stroke' ? 'none' : '#fff'}
            stroke={s.renderMode === 'fill' ? 'none' : '#fff'}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fillRule={s.fillRule === 'evenodd' ? 'evenodd' : undefined}
            opacity={opacity}
          />
        )
      })}
    </svg>
  )
}

function LayerChip({ layer, textColor }: { layer: SigilLayer; textColor: string }) {
  const color = LAYER_COLOR[layer.family]
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 7px', borderRadius: 3,
      border: `0.5px solid ${color}55`,
      background: `${color}14`,
    }}>
      <span style={{ fontSize: 7.5, color, opacity: 0.78, letterSpacing: '0.05em' }}>
        {layer.family}
      </span>
      <span style={{ fontSize: 8.5, color: textColor, fontFamily: 'monospace' }}>
        {label(layer.name)}
      </span>
    </div>
  )
}

export function SigilView() {
  const t = useTheme()
  const [seed, setSeed] = useState(() => randomSeed())
  const [structure, setStructure] = useState<StructuralType>('single-axis')
  const [secondaryStructure, setSecondaryStructure] = useState<StructuralType>('ring-core')
  const [compositionMode, setCompositionMode] = useState<StructureCompositionMode>('none')
  const [structureOperator, setStructureOperator] = useState<StructureOperator>('none')
  const [primaryMotif, setPrimaryMotif] = useState<CoreMotif>('ring')
  const [terminalMotif, setTerminalMotif] = useState<TerminalMotif>('dot')
  const [interiorMotif, setInteriorMotif] = useState<InteriorMotif>('pupil')
  const [allowFullRepetition, setAllowFullRepetition] = useState(false)

  const locks = useMemo<Partial<SigilGrammar>>(() => ({
    structure,
    secondaryStructure: compositionMode === 'none' ? undefined : secondaryStructure,
    compositionMode,
    structureOperator,
    primaryMotif,
    terminalMotif,
    interiorMotif,
    complexity: 1,
    strokeWeight: 'normal',
    allowFullRepetition,
  }), [allowFullRepetition, compositionMode, interiorMotif, primaryMotif, secondaryStructure, structure, structureOperator, terminalMotif])

  const sigil = useMemo(() => makeSigil(seed, locks), [seed, locks])

  const reroll = useCallback(() => {
    setSeed(randomSeed())
  }, [])

  const randomizeAll = useCallback(() => {
    const nextSeed = randomSeed()
    const next = randomGrammar(nextSeed, {})
    setSeed(nextSeed)
    setStructure(next.structure)
    setSecondaryStructure(next.secondaryStructure ?? 'ring-core')
    setCompositionMode(next.compositionMode ?? 'none')
    setStructureOperator(next.structureOperator ?? 'none')
    setPrimaryMotif(next.primaryMotif)
    setTerminalMotif(next.terminalMotif ?? 'dot')
    setInteriorMotif(next.interiorMotif ?? 'dot')
    setAllowFullRepetition(next.allowFullRepetition === true)
  }, [])

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(260px, 360px) minmax(320px, 440px)',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100%',
      gap: 28,
      padding: 28,
      background: t.panelBg,
      color: t.text,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 284,
          height: 284,
          border: `0.5px solid ${t.divider}`,
          borderRadius: 8,
          background: t.sectionBg,
          color: '#fff',
          padding: 22,
          boxSizing: 'border-box',
        }}>
          <SigilSvg sigil={sigil} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, maxWidth: 360 }}>
          <div style={{ fontSize: 9, color: LAYER_COLOR.structure, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}>
            {label(sigil.grammar.structure)}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'center' }}>
            {sigil.layers.map((layer, i) => (
              <LayerChip key={i} layer={layer} textColor={t.text} />
            ))}
          </div>

          <div style={{ fontSize: 8, color: t.textDim, opacity: 0.7, fontFamily: 'monospace', marginTop: 2 }}>
            seed {seed.toString(16).padStart(8, '0')}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={reroll} style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '7px 20px',
            borderRadius: 6,
            border: `0.5px solid ${t.divider}`,
            background: t.tagBg,
            color: '#a78bfa',
            cursor: 'pointer',
            fontFamily: 'inherit',
            letterSpacing: '0.08em',
          }}>
            Reroll
          </button>
          <button onClick={randomizeAll} style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '7px 20px',
            borderRadius: 6,
            border: `0.5px solid ${t.divider}`,
            background: t.activeBg,
            color: '#f8fafc',
            cursor: 'pointer',
            fontFamily: 'inherit',
            letterSpacing: '0.08em',
          }}>
            Random All
          </button>
        </div>
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 13,
        maxWidth: 440,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <SelectField labelText="Structure" value={structure} values={STRUCTURES} onChange={setStructure} />
          <SelectField labelText="Secondary structure" value={secondaryStructure} values={STRUCTURES} onChange={setSecondaryStructure} />
          <SelectField labelText="Composition" value={compositionMode} values={COMPOSITION_MODES} onChange={setCompositionMode} />
          <SelectField labelText="Structure op" value={structureOperator} values={STRUCTURE_OPERATORS} onChange={setStructureOperator} />
          <SelectField labelText="Primary" value={primaryMotif} values={CORE_MOTIFS} onChange={setPrimaryMotif} />
          <SelectField labelText="Terminal" value={terminalMotif} values={TERMINAL_MOTIFS} onChange={setTerminalMotif} />
          <SelectField labelText="Interior" value={interiorMotif} values={INTERIOR_MOTIFS} onChange={setInteriorMotif} />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginLeft: 4,
            fontSize: 10,
            color: t.textMid,
          }}>
            <input type="checkbox" checked={allowFullRepetition} onChange={e => setAllowFullRepetition(e.target.checked)} />
            Allow full repetition
          </label>
        </div>

        <div style={{
          minHeight: 38,
          borderTop: `0.5px solid ${t.divider}`,
          paddingTop: 10,
          color: sigil.warnings.length ? '#fbbf24' : t.textDim,
          fontSize: 9,
          lineHeight: 1.55,
        }}>
          {sigil.warnings.length ? sigil.warnings.join(' / ') : 'Legibility check passed'}
        </div>

        <div style={{
          color: t.textDim,
          fontSize: 8.5,
          lineHeight: 1.55,
          fontFamily: 'monospace',
        }}>
          axes {sigil.topology.axes} · loops {sigil.topology.closedLoops} · branches {sigil.topology.branches} · crossings {sigil.topology.crossings} · symmetry {sigil.topology.symmetry}
          <br />
          slots {sigil.slots.map(label).join(', ')}
        </div>
      </div>
    </div>
  )
}
