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

/**
 * One connection, opened once and shared by every reader and writer.
 *
 * `indexedDB.open()` is asynchronous, and a writer used to wait for it before
 * its write transaction even existed. That wait is precisely the window in which
 * a navigation destroys the page and takes the entry with it: tools record their
 * history fire-and-forget and the user moves straight on to the next one. Once
 * the connection is resolved the transaction is created in the same tick as the
 * call, so nothing is left to race. The layout's `useRecent` read opens it at
 * startup, long before the first tool can finish.
 *
 * It is deliberately never closed: `close()` aborts transactions still in
 * flight, which would reintroduce exactly the loss this prevents.
 */
let connection: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  connection ??= openDb().catch((error: unknown) => {
    // A cached rejection would poison every later call; forget it and let the
    // next one open afresh.
    connection = undefined;
    throw error;
  });
  return connection;
}

/**
 * Serialises writes. Two tools finishing at once would otherwise overlap
 * transactions on the shared connection, and one trim cursor could delete what
 * the other had just written.
 */
let writes: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(work: () => Promise<T>): Promise<T> {
  const result = writes.then(work, work);
  // The chain has to keep moving even when a write fails, or one error would
  // wedge the history for the rest of the session.
  writes = result.catch(() => undefined);
  return result;
}

export function recordRecent(entry: Omit<RecentEntry, 'id' | 'createdAt'>): Promise<void> {
  return enqueueWrite(async () => {
    try {
      const database = await db();
      const record: RecentEntry = {
        ...entry,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.put(record);
        // Trim to the newest few entries. The cursor must run newest-first:
        // walking the index forwards started at the *oldest* record, so once
        // there were more than MAX_ENTRIES the deletion fell on the newest ones
        // -- including the record just written, which vanished immediately.
        const index = store.index('createdAt');
        const cursorRequest = index.openCursor(null, 'prev');
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
      // Even on a failed write: readers re-read, and the result is simply the
      // unchanged list.
      notify();
    }
  });
}

export async function getRecent(): Promise<RecentEntry[]> {
  try {
    const database = await db();
    const entries = await new Promise<RecentEntry[]>((resolve, reject) => {
      const tx = database.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as RecentEntry[]) ?? []);
      request.onerror = () => reject(request.error);
    });
    return entries.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function clearRecent(): Promise<void> {
  return enqueueWrite(async () => {
    try {
      const database = await db();
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // ignore
    } finally {
      notify();
    }
  });
}