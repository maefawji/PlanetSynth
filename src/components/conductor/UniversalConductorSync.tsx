import { useEffect, useRef } from 'react'
import * as Tone from 'tone'
import { FrequencyClass } from 'tone'
import { useUniversalConductorStore } from '../../store/universalConductorStore'

export function UniversalConductorSync() {
  const bpm = useUniversalConductorStore(state => state.bpm)
  const tuning = useUniversalConductorStore(state => state.tuning)
  const timeSignatureNumerator = useUniversalConductorStore(state => state.timeSignatureNumerator)
  const timeSignatureDenominator = useUniversalConductorStore(state => state.timeSignatureDenominator)
  const autoAdvance = useUniversalConductorStore(state => state.autoAdvance)
  const autoAdvanceBars = useUniversalConductorStore(state => state.autoAdvanceBars)
  const advanceChordIndex = useUniversalConductorStore(state => state.advanceChordIndex)
  const autoAdvanceTimerRef = useRef<number | null>(null)

  useEffect(() => {
    Tone.getTransport().bpm.value = bpm
  }, [bpm])

  useEffect(() => {
    Tone.getTransport().timeSignature = [timeSignatureNumerator, timeSignatureDenominator]
  }, [timeSignatureNumerator, timeSignatureDenominator])

  useEffect(() => {
    FrequencyClass.A4 = tuning
  }, [tuning])

  useEffect(() => {
    if (autoAdvanceTimerRef.current !== null) {
      window.clearInterval(autoAdvanceTimerRef.current)
      autoAdvanceTimerRef.current = null
    }
    if (autoAdvance) {
      const beatDurationMs = (60_000 / bpm) * (4 / timeSignatureDenominator)
      const barDurationMs = beatDurationMs * timeSignatureNumerator
      const intervalMs = Math.max(100, barDurationMs * autoAdvanceBars)
      autoAdvanceTimerRef.current = window.setInterval(() => {
        advanceChordIndex()
      }, intervalMs)
    }
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearInterval(autoAdvanceTimerRef.current)
        autoAdvanceTimerRef.current = null
      }
    }
  }, [
    autoAdvance,
    autoAdvanceBars,
    bpm,
    timeSignatureNumerator,
    timeSignatureDenominator,
    advanceChordIndex,
  ])

  return null
}
