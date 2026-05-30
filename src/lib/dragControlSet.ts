/**
 * Module-level singleton that tracks the control-set ID currently being
 * dragged from the library.  Unlike React state it is readable during
 * dragover events (getData() returns '' there due to browser security) and
 * does not trigger re-renders.
 */
export let draggingControlSetId: string | null = null

export function setDraggingControlSetId(id: string | null) {
  draggingControlSetId = id
}
