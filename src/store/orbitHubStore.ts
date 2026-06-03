import { create } from 'zustand'

interface OrbitHubState {
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
}

export const useOrbitHubStore = create<OrbitHubState>(set => ({
  panelOpen: false,
  setPanelOpen: panelOpen => set({ panelOpen }),
}))
