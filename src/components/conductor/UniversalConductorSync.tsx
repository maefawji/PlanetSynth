import { useEffect } from 'react'
import * as Tone from 'tone'
import { useUniversalConductorStore } from '../../store/universalConductorStore'

export function UniversalConductorSync() {
  const bpm = useUniversalConductorStore(state => state.bpm)

  useEffect(() => {
    Tone.getTransport().bpm.value = bpm
  }, [bpm])

  return null
}
