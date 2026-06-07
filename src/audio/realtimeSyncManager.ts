// ── realtimeSyncManager.ts ─────────────────────────────────────────────────────
// Singleton 66ms realtime tick shared across all audio layer components.
//
// Architecture:
//   React UI layer   — param editing, panel display only
//   RealtimeSyncManager — single RAF @ ~15fps, calls each layer's sync fn
//   Audio Engine     — AudioNode graphs, SamplerEngine, GranularEngine, etc.
//
// This replaces per-layer `spatialTick` React state (spatialTick was causing
// setSpatialTick → React render → useEffect → compute → audio update on every
// frame). Here, React is not involved at all in the realtime path.

type SyncCallback = () => void

const _callbacks = new Map<string, SyncCallback>()
let _rafId   = 0
let _last    = 0
let _running = false

function _loop(ts: number): void {
  if (ts - _last >= 66) {
    _last = ts
    for (const cb of _callbacks.values()) {
      try { cb() } catch { /* don't let one layer crash others */ }
    }
  }
  _rafId = requestAnimationFrame(_loop)
}

/**
 * Register a callback to be called at ~15fps (every 66ms) via a shared RAF.
 * If the manager is not yet running it starts automatically.
 * Safe to call multiple times with the same id (replaces previous callback).
 */
export function registerRealtimeSync(id: string, cb: SyncCallback): void {
  _callbacks.set(id, cb)
  if (!_running) {
    _running = true
    _rafId   = requestAnimationFrame(_loop)
  }
}

/**
 * Remove a previously registered callback.
 * The RAF loop stops automatically when the last callback is removed.
 */
export function unregisterRealtimeSync(id: string): void {
  _callbacks.delete(id)
  if (_callbacks.size === 0 && _running) {
    cancelAnimationFrame(_rafId)
    _running = false
  }
}
