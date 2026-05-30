import { create } from 'zustand'

type EngineStatus = 'stopped' | 'ready' | 'running' | 'error'

interface AudioState {
  isRunning: boolean
  status: EngineStatus
  errorMessage: string | null
  setRunning: (v: boolean) => void
  setStatus: (s: EngineStatus, error?: string) => void
}

export const useAudioStore = create<AudioState>(set => ({
  isRunning: false,
  status: 'stopped',
  errorMessage: null,
  setRunning(v) { set({ isRunning: v }) },
  setStatus(s, error) { set({ status: s, errorMessage: error ?? null }) },
}))
