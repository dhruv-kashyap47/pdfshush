/**
 * Recent-tool history, stored locally in IndexedDB.
 *
 * Anonymous-first means we cannot put history on a server -- and we would not
 * want to, since "your files never leave this device" is the product promise.
 */

export interface RecentEntry {
  id: string;
  toolSlug: string;
  toolName: string;
  fileName: string;
  pageCount?: number;
  sizeBytes?: number;
  createdAt: number;
}

const DB_NAME = 'pdfshush';
const STORE = 'recent';
const MAX_ENTRIES = 12;

type RecentListener = () => void;

const listeners = new Set<RecentListener>();

/** Tells mounted readers the stored history changed. */
function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One bad subscriber must not abort the write or starve the others.
    }
  }
}

/**
 * Subscribes to changes in the recent history.
 *
 * The history lives in IndexedDB, so a mounted reader has no other way of
 * learning that a tool recorded something after it mounted.
 */
export function subscribeRecent(listener: RecentListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

export async function recordRecent(entry: Omit<RecentEntry, 'id' | 'createdAt'>): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    const record: RecentEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put(record);
      // Trim to the newest few entries.
      const index = store.index('createdAt');
      const cursorRequest = index.openCursor(IDBKeyRange.upperBound(record.createdAt, false));
      let seen = 0;
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        seen += 1;
        if (seen > MAX_ENTRIES) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Recent-history write aborted'));
    });
  } catch {
    // Storage is a convenience; never let it break the tool.
  } finally {
    // Always close: an unclosed connection keeps the database pinned open.
    db?.close();
    // Even on a failed write: readers re-read, and the result is simply the
    // unchanged list.
    notify();
  }
}

export async function getRecent(): Promise<RecentEntry[]> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    const entries = await new Promise<RecentEntry[]>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as RecentEntry[]) ?? []);
      request.onerror = () => reject(request.error);
    });
    return entries.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export async function clearRecent(): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  } finally {
    db?.close();
    notify();
  }
}
