import { create } from 'zustand'

export interface ArpProgressionLiveState {
  slotKey: string
  degreeIndex: number
  degreeCount: number
  degree: number
  label: string
  notes: number[]
  updatedAt: number
}

interface ArpProgressionState {
  liveBySlot: Record<string, ArpProgressionLiveState>
  setLiveState: (state: ArpProgressionLiveState) => void
  clearLiveState: (slotKey: string) => void
}

export const useArpProgressionStore = create<ArpProgressionState>(set => ({
  liveBySlot: {},

  setLiveState(state) {
    set(s => ({ liveBySlot: { ...s.liveBySlot, [state.slotKey]: state } }))
  },

  clearLiveState(slotKey) {
    set(s => {
      if (!(slotKey in s.liveBySlot)) return s
      const next = { ...s.liveBySlot }
      delete next[slotKey]
      return { liveBySlot: next }
    })
  },
}))
