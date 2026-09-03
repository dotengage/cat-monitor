/**
 * Minimal IndexedDB key-value store with a localStorage fallback.
 *
 * Dependency-free on purpose: this is ~80 lines of code instead of a library,
 * and it is the only place in the app that talks to browser storage.
 */

const DB_NAME = 'cat-monitor';
const DB_VERSION = 1;
const STORE = 'kv';
const LS_PREFIX = 'cat-monitor:';

let dbPromise: Promise<IDBDatabase> | null = null;

function hasIndexedDB(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
  });
  return dbPromise;
}

async function idbRequest<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

function lsGet<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch (err) {
    console.warn('Local storage write failed', err);
  }
}

/**
 * Ask the browser to make this origin's storage durable.
 *
 * Without it, storage is "best-effort": a browser under disk pressure may
 * evict it, and iOS Safari evicts data for sites not opened in ~7 days unless
 * they are installed to the Home Screen. Chrome grants this automatically for
 * installed PWAs and high-engagement sites. It can only ever help.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export interface StorageStatus {
  persistent: boolean;
  supported: boolean;
  usageBytes: number;
  quotaBytes: number;
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const fallback: StorageStatus = { persistent: false, supported: false, usageBytes: 0, quotaBytes: 0 };
  try {
    if (typeof navigator === 'undefined' || !navigator.storage) return fallback;
    const persistent = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const estimate = navigator.storage.estimate ? await navigator.storage.estimate() : undefined;
    return {
      persistent,
      supported: Boolean(navigator.storage.persist),
      usageBytes: estimate?.usage ?? 0,
      quotaBytes: estimate?.quota ?? 0,
    };
  } catch {
    return fallback;
  }
}

export const kv = {
  async get<T>(key: string): Promise<T | undefined> {
    if (hasIndexedDB()) {
      try {
        const value = await idbRequest<T | undefined>('readonly', (s) => s.get(key));
        if (value !== undefined) return value;
      } catch (err) {
        console.warn('IndexedDB read failed, falling back to localStorage', err);
      }
    }
    return lsGet<T>(key);
  },

  async set(key: string, value: unknown): Promise<void> {
    // Always mirror to localStorage: it is the recovery path if IndexedDB is
    // cleared by the browser or unavailable in a private window.
    lsSet(key, value);
    if (!hasIndexedDB()) return;
    try {
      await idbRequest('readwrite', (s) => s.put(value, key));
    } catch (err) {
      console.warn('IndexedDB write failed; localStorage copy retained', err);
    }
  },

  async delete(key: string): Promise<void> {
    try {
      localStorage.removeItem(LS_PREFIX + key);
    } catch {
      /* ignore */
    }
    if (!hasIndexedDB()) return;
    try {
      await idbRequest('readwrite', (s) => s.delete(key));
    } catch (err) {
      console.warn('IndexedDB delete failed', err);
    }
  },

  async keys(): Promise<string[]> {
    if (hasIndexedDB()) {
      try {
        const keys = await idbRequest<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
        return keys.map(String);
      } catch {
        /* fall through */
      }
    }
    try {
      return Object.keys(localStorage)
        .filter((k) => k.startsWith(LS_PREFIX))
        .map((k) => k.slice(LS_PREFIX.length));
    } catch {
      return [];
    }
  },
};
