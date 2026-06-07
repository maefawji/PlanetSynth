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
  const scheduleIdRef = useRef<number | null>(null)

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
    const transport = Tone.getTransport()
    if (scheduleIdRef.current !== null) {
      transport.clear(scheduleIdRef.current)
      scheduleIdRef.current = null
    }
    if (autoAdvance) {
      const interval = `${autoAdvanceBars}m`
      scheduleIdRef.current = transport.scheduleRepeat(() => {
        advanceChordIndex()
      }, interval)
    }
    return () => {
      if (scheduleIdRef.current !== null) {
        transport.clear(scheduleIdRef.current)
        scheduleIdRef.current = null
      }
    }
  }, [autoAdvance, autoAdvanceBars, advanceChordIndex])

  return null
}
