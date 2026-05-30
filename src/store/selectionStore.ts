import { create } from 'zustand'

interface SelectionState {
  selectedNodeId: string | null
  selectedGeometryId: string | null
  selectedGeometryIds: string[]
  lastSelectedGeometryId: string | null
  selectNode: (id: string | null) => void
  selectGeometry: (id: string | null) => void
  toggleGeometrySelection: (id: string) => void
  selectGeometryRange: (ids: string[]) => void
  clearAll: () => void
}

export const useSelectionStore = create<SelectionState>(set => ({
  selectedNodeId: null,
  selectedGeometryId: null,
  selectedGeometryIds: [],
  lastSelectedGeometryId: null,
  selectNode(id) { set({ selectedNodeId: id, selectedGeometryId: null, selectedGeometryIds: [] }) },
  selectGeometry(id) {
    set({
      selectedGeometryId: id,
      selectedGeometryIds: id ? [id] : [],
      selectedNodeId: null,
      ...(id ? { lastSelectedGeometryId: id } : {}),
    })
  },
  toggleGeometrySelection(id) {
    set(s => {
      const selectedGeometryIds = s.selectedGeometryIds.includes(id)
        ? s.selectedGeometryIds.filter(existingId => existingId !== id)
        : [...s.selectedGeometryIds, id]
      return {
        selectedNodeId: null,
        selectedGeometryId: selectedGeometryIds[0] ?? null,
        selectedGeometryIds,
        lastSelectedGeometryId: id,
      }
    })
  },
  selectGeometryRange(ids) {
    set({
      selectedGeometryId: ids[0] ?? null,
      selectedGeometryIds: ids,
      selectedNodeId: null,
      ...(ids[0] ? { lastSelectedGeometryId: ids[0] } : {}),
    })
  },
  clearAll() { set({ selectedNodeId: null, selectedGeometryId: null, selectedGeometryIds: [] }) },
}))
