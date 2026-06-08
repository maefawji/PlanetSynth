import {
  CHORD_QUALITY_INTERVALS,
  formatChordName,
  type UniversalConductorValues,
} from '../store/universalConductorStore'

export type UniversalArpRole = 'bass' | 'body' | 'tension'
export type UniversalArpOrder = 'up' | 'down' | 'updown' | 'random'

export interface UniversalArpeggioParams {
  partCount: 2 | 3
  role: UniversalArpRole
  order: UniversalArpOrder
  octaveShift: number
  octaveSpan: 1 | 2
}

export interface UniversalArpeggioSnapshot {
  chordName: string
  chordIndex: number
  chordCount: number
  role: UniversalArpRole
  roleLabel: string
  allNotes: number[]
  roleNotes: number[]
}

function clampMidi(note: number): number {
  return Math.max(0, Math.min(127, Math.round(note)))
}

function uniqueSorted(notes: number[]): number[] {
  return [...new Set(notes.map(clampMidi))].sort((a, b) => a - b)
}

export function readUniversalArpeggioParams(params: Record<string, unknown>): UniversalArpeggioParams {
  const partCount = Number(params.universalArpPartCount) === 3 ? 3 : 2
  const rawRole = String(params.universalArpRole ?? 'bass')
  const role: UniversalArpRole = rawRole === 'tension' ? 'tension' : rawRole === 'body' ? 'body' : 'bass'
  const rawOrder = String(params.universalArpOrder ?? 'up')
  const order: UniversalArpOrder =
    rawOrder === 'down' || rawOrder === 'updown' || rawOrder === 'random' ? rawOrder : 'up'
  return {
    partCount,
    role: partCount === 2 && role === 'tension' ? 'body' : role,
    order,
    octaveShift: Math.max(-2, Math.min(2, Math.round(Number(params.universalArpOctaveShift ?? 0)))),
    octaveSpan: Number(params.universalArpOctaveSpan) === 2 ? 2 : 1,
  }
}

export function getUniversalArpeggioSnapshot(
  context: UniversalConductorValues,
  params: Record<string, unknown>,
): UniversalArpeggioSnapshot {
  const config = readUniversalArpeggioParams(params)
  const chordCount = Math.max(1, Math.min(
    context.chordProgression.length,
    Math.round(context.chordProgressionLength),
  ))
  const chordIndex = ((Math.round(context.chordIndex) % chordCount) + chordCount) % chordCount
  const slot = context.chordProgression[chordIndex]
  const root = slot?.root ?? context.chordRoot
  const quality = slot?.quality ?? context.chordQuality
  const octave = slot?.octave ?? context.chordOctave
  const bassRoot = slot?.bassRoot ?? null
  const intervals = CHORD_QUALITY_INTERVALS[quality] ?? CHORD_QUALITY_INTERVALS.Maj7
  const base = (Math.max(0, Math.min(8, octave)) + 1) * 12 + root
  const chordNotes = intervals.map(interval => clampMidi(base + interval))

  let anchor = (Math.max(0, Math.min(8, octave)) + 1) * 12 + (bassRoot ?? root)
  while (anchor >= chordNotes[0] && anchor >= 12) anchor -= 12
  const anchorNotes = bassRoot != null && bassRoot !== root
    ? uniqueSorted([anchor, chordNotes[0]])
    : [clampMidi(anchor)]

  const coreNotes = uniqueSorted(chordNotes.slice(1, 3))
  const extensionNotes = uniqueSorted(chordNotes.slice(3))
  const ornamentFallback = clampMidi((coreNotes.at(-1) ?? chordNotes.at(-1) ?? base) + 12)

  let roleNotes: number[]
  let roleLabel: string
  if (config.role === 'bass') {
    roleNotes = anchorNotes
    roleLabel = 'Bass / Anchor'
  } else if (config.partCount === 2) {
    roleNotes = uniqueSorted([...coreNotes, ...extensionNotes])
    roleLabel = 'Chord Body + Tension'
  } else if (config.role === 'body') {
    roleNotes = coreNotes.length ? coreNotes : [chordNotes[0]]
    roleLabel = 'Chord Body'
  } else {
    roleNotes = extensionNotes.length ? extensionNotes : [ornamentFallback]
    roleLabel = 'Add9 / Tension / Ornament'
  }

  const registerOffset = config.role === 'bass' ? -12 : config.role === 'tension' ? 12 : 0
  const shift = registerOffset + config.octaveShift * 12
  roleNotes = uniqueSorted(roleNotes.flatMap(note => {
    const shifted = clampMidi(note + shift)
    return config.octaveSpan === 2 ? [shifted, clampMidi(shifted + 12)] : [shifted]
  }))

  return {
    chordName: formatChordName(root, quality, bassRoot),
    chordIndex,
    chordCount,
    role: config.role,
    roleLabel,
    allNotes: uniqueSorted([...anchorNotes, ...chordNotes]),
    roleNotes,
  }
}

export function universalArpeggioStepIndex(length: number, order: UniversalArpOrder, step: number): number {
  if (length <= 1) return 0
  if (order === 'random') return Math.floor(Math.random() * length)
  if (order === 'down') return length - 1 - (step % length)
  if (order === 'updown') {
    const cycle = length * 2 - 2
    const position = step % cycle
    return position < length ? position : cycle - position
  }
  return step % length
}
