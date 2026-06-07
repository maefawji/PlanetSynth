import { useEffect } from 'react'
import * as Tone from 'tone'
import { FrequencyClass } from 'tone'
import { useUniversalConductorStore } from '../../store/universalConductorStore'

export function UniversalConductorSync() {
  const bpm = useUniversalConductorStore(state => state.bpm)
  const tuning = useUniversalConductorStore(state => state.tuning)
  const timeSignatureNumerator = useUniversalConductorStore(state => state.timeSignatureNumerator)
  const timeSignatureDenominator = useUniversalConductorStore(state => state.timeSignatureDenominator)

  useEffect(() => {
    Tone.getTransport().bpm.value = bpm
  }, [bpm])

  useEffect(() => {
    Tone.getTransport().timeSignature = [timeSignatureNumerator, timeSignatureDenominator]
  }, [timeSignatureNumerator, timeSignatureDenominator])

  useEffect(() => {
    FrequencyClass.A4 = tuning
  }, [tuning])

  return null
}
