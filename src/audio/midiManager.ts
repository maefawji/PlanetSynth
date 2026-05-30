// ── midiManager.ts ────────────────────────────────────────────────────────────
// Web MIDI API wrapper: send MIDI OUT and receive MIDI IN.
//
// Usage:
//   initMidi()                          — call once at app startup
//   sendMidiNote(ch, note, vel, ms)     — note-on + auto note-off after ms
//   sendMidiNoteOn(ch, note, vel)       — note-on only
//   sendMidiNoteOff(ch, note)           — note-off
//   onMidiNoteOn(cb) → unsub           — subscribe to MIDI IN note-on events
//   getMidiOutputs() / getMidiInputs()  — list ports
//   getSelectedOutputId()               — null = send to all outputs
//   setSelectedOutputId(id | null)      — restrict to one output

// ── Types ─────────────────────────────────────────────────────────────────────

export type NoteOnCallback = (ch: number, note: number, vel: number) => void

export type MidiPortInfo = { id: string; name: string }

// ── Module state ──────────────────────────────────────────────────────────────

let _access: MIDIAccess | null = null
let _selectedOutputId: string | null = null
const _noteOnListeners = new Set<NoteOnCallback>()
let _initPromise: Promise<void> | null = null

/** Timestamp (performance.now()) of the last MIDI note-on SENT (OUT). */
let _lastSendTime   = -Infinity
/** Timestamp of the last MIDI note-on RECEIVED (IN). */
let _lastReceiveTime = -Infinity

// ── Init ──────────────────────────────────────────────────────────────────────

/** Initialize Web MIDI access. Safe to call multiple times (idempotent). */
export async function initMidi(): Promise<void> {
  if (_initPromise) return _initPromise
  _initPromise = _doInit()
  return _initPromise
}

async function _doInit(): Promise<void> {
  if (!navigator.requestMIDIAccess) {
    console.warn('[midiManager] Web MIDI API not supported.')
    return
  }
  try {
    _access = await navigator.requestMIDIAccess({ sysex: false })
    _access.onstatechange = _handleStateChange
    _attachInputListeners()
    const outNames = [..._access.outputs.values()].map(o => o.name).join(', ') || 'none'
    const inNames  = [..._access.inputs.values()].map(i => i.name).join(', ')  || 'none'
    console.log(`[midiManager] Ready  OUT: [${outNames}]  IN: [${inNames}]`)
  } catch (err) {
    console.warn('[midiManager] MIDI access denied:', err)
  }
}

function _handleStateChange(_e: MIDIConnectionEvent) {
  _attachInputListeners()
}

function _attachInputListeners() {
  if (!_access) return
  for (const input of _access.inputs.values()) {
    input.onmidimessage = _handleMessage
  }
}

function _handleMessage(e: MIDIMessageEvent) {
  const data = e.data
  if (!data || data.length < 3) return
  const status = data[0]
  const note   = data[1]
  const vel    = data[2]
  const type   = status & 0xf0
  const ch     = (status & 0x0f) + 1  // 1-based channel (1–16)

  // Note-on with velocity > 0
  if (type === 0x90 && vel > 0) {
    _lastReceiveTime = performance.now()
    for (const cb of _noteOnListeners) cb(ch, note, vel)
  }
  // Note-on with velocity 0 = note-off (running status convention) — ignored for now
}

// ── Status ────────────────────────────────────────────────────────────────────

export function isMidiReady(): boolean { return _access !== null }

/** ms since the last MIDI note-on was SENT (OUT). Infinity if never sent. */
export function getMidiSendAge(): number  { return performance.now() - _lastSendTime }
/** ms since the last MIDI note-on was RECEIVED (IN). Infinity if never received. */
export function getMidiReceiveAge(): number { return performance.now() - _lastReceiveTime }

// ── Port lists ────────────────────────────────────────────────────────────────

export function getMidiOutputs(): MidiPortInfo[] {
  if (!_access) return []
  return [..._access.outputs.values()].map(o => ({ id: o.id, name: o.name ?? o.id }))
}

export function getMidiInputs(): MidiPortInfo[] {
  if (!_access) return []
  return [..._access.inputs.values()].map(i => ({ id: i.id, name: i.name ?? i.id }))
}

// ── Output selection ──────────────────────────────────────────────────────────

/** null = send to ALL connected outputs. */
export function getSelectedOutputId(): string | null { return _selectedOutputId }

/** Pass an output id to restrict, or null to broadcast. */
export function setSelectedOutputId(id: string | null): void { _selectedOutputId = id }

// ── Send helpers ──────────────────────────────────────────────────────────────

function _getTargetOutputs(): MIDIOutput[] {
  if (!_access) return []
  if (_selectedOutputId) {
    const o = _access.outputs.get(_selectedOutputId)
    return o ? [o] : []
  }
  return [..._access.outputs.values()]
}

/** Send MIDI note-on. ch = 1–16, note/vel = 0–127. */
export function sendMidiNoteOn(ch: number, note: number, vel: number): void {
  _lastSendTime = performance.now()
  const status  = 0x90 | ((ch - 1) & 0x0f)
  const msg     = [status, note & 0x7f, vel & 0x7f]
  for (const out of _getTargetOutputs()) out.send(msg)
}

/** Send MIDI note-off. */
export function sendMidiNoteOff(ch: number, note: number): void {
  const status = 0x80 | ((ch - 1) & 0x0f)
  const msg    = [status, note & 0x7f, 0]
  for (const out of _getTargetOutputs()) out.send(msg)
}

/**
 * Send note-on, then note-off after durationMs.
 * Defaults to a 200 ms pulse — long enough for most synths to register.
 */
export function sendMidiNote(ch: number, note: number, vel: number, durationMs = 200): void {
  sendMidiNoteOn(ch, note, vel)
  setTimeout(() => sendMidiNoteOff(ch, note), durationMs)
}

// ── Receive ───────────────────────────────────────────────────────────────────

/** Subscribe to note-on events from all connected MIDI inputs. Returns unsubscribe fn. */
export function onMidiNoteOn(cb: NoteOnCallback): () => void {
  _noteOnListeners.add(cb)
  return () => _noteOnListeners.delete(cb)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a MIDI note number to a human-readable name, e.g. 60 → "C4". */
export function midiNoteToName(note: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`
}
