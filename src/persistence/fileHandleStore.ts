/**
 * IndexedDB store for FileSystemFileHandle and FileSystemDirectoryHandle.
 * These survive page reloads (unlike blob: URLs or in-memory state).
 * On the next session the browser will re-prompt for permission once.
 */

const DB_NAME    = 'synthesizer_handles_v1'
const DB_VERSION = 1
const STORE_FILES = 'sampleFiles'   // key: sampleId  → FileSystemFileHandle
const STORE_DIRS  = 'directories'   // key: name       → FileSystemDirectoryHandle

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_FILES)) db.createObjectStore(STORE_FILES)
      if (!db.objectStoreNames.contains(STORE_DIRS))  db.createObjectStore(STORE_DIRS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function dbGet<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).get(key)
    req.onsuccess = () => { db.close(); resolve((req.result as T) ?? null) }
    req.onerror   = () => { db.close(); reject(req.error) }
  })
}

async function dbSet(storeName: string, key: string, value: unknown): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(value, key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror    = () => { db.close(); reject(tx.error) }
  })
}

async function dbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).delete(key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror    = () => { db.close(); reject(tx.error) }
  })
}

// ── Sample file handles ────────────────────────────────────────────────────────

export async function storeFileHandle(sampleId: string, handle: FileSystemFileHandle): Promise<void> {
  await dbSet(STORE_FILES, sampleId, handle)
}

export async function getFileHandle(sampleId: string): Promise<FileSystemFileHandle | null> {
  return dbGet<FileSystemFileHandle>(STORE_FILES, sampleId)
}

export async function deleteFileHandle(sampleId: string): Promise<void> {
  await dbDelete(STORE_FILES, sampleId)
}

// ── Directory handles ──────────────────────────────────────────────────────────

export const DEFAULT_DIR_KEY = 'default'

export async function storeDirectoryHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  await dbSet(STORE_DIRS, key, handle)
}

export async function getDirectoryHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  return dbGet<FileSystemDirectoryHandle>(STORE_DIRS, key)
}

export async function clearDirectoryHandle(key: string): Promise<void> {
  await dbDelete(STORE_DIRS, key)
}

// ── Permission helpers ─────────────────────────────────────────────────────────

export async function ensureReadPermission(
  handle: FileSystemHandle,
): Promise<'granted' | 'denied'> {
  try {
    let perm = await handle.queryPermission({ mode: 'read' })
    if (perm === 'prompt') perm = await handle.requestPermission({ mode: 'read' })
    return perm === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

/** Try to check WITHOUT requesting (safe to call without a user gesture). */
export async function queryReadPermission(
  handle: FileSystemHandle,
): Promise<PermissionState> {
  try {
    return await handle.queryPermission({ mode: 'read' })
  } catch {
    return 'denied'
  }
}

// ── Object URL helpers ────────────────────────────────────────────────────────

export async function objectUrlFromHandle(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile()
  return URL.createObjectURL(file)
}

/**
 * Restore objectUrl for a sample from its stored file handle.
 * Silently returns null if no handle found or permission denied.
 * NOTE: call this only after a user gesture if the permission is 'prompt'.
 */
export async function tryRestoreObjectUrl(sampleId: string): Promise<string | null> {
  try {
    const handle = await getFileHandle(sampleId)
    if (!handle) return null
    const perm = await ensureReadPermission(handle)
    if (perm !== 'granted') return null
    return objectUrlFromHandle(handle)
  } catch {
    return null
  }
}
