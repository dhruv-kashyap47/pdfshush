/**
 * The single owner of the `pdfshush` IndexedDB connection.
 *
 * IndexedDB hangles one version per database, so two modules opening the same
 * database at different versions is a hard failure: whichever opens second with
 * the lower version gets a `VersionError`. Both stores therefore live here, and
 * this module is the only place that calls `indexedDB.open`.
 *
 * The connection is deliberately never closed. `close()` aborts transactions
 * still in flight, and the recent-history writer is fire-and-forget by design --
 * closing it is exactly how an entry gets lost when the user navigates straight
 * after a tool finishes.
 */

export const DB_NAME = 'pdfshush';
const DB_VERSION = 4;

export const RECENT_STORE = 'recent';
export const WORKFLOW_STORE = 'workflows';
export const SIGNATURE_STORE = 'signatures';
export const DRAFT_STORE = 'drafts';

function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(RECENT_STORE)) {
    const store = db.createObjectStore(RECENT_STORE, { keyPath: 'id' });
    // The trim cursor and the list both read newest-first through this index.
    store.createIndex('createdAt', 'createdAt');
  }
  if (!db.objectStoreNames.contains(WORKFLOW_STORE)) {
    const store = db.createObjectStore(WORKFLOW_STORE, { keyPath: 'id' });
    store.createIndex('updatedAt', 'updatedAt');
  }
  if (!db.objectStoreNames.contains(SIGNATURE_STORE)) {
    const store = db.createObjectStore(SIGNATURE_STORE, { keyPath: 'id' });
    // Newest-first reads (the saved-signature strip) and the cap trim both use it.
    store.createIndex('createdAt', 'createdAt');
  }
  if (!db.objectStoreNames.contains(DRAFT_STORE)) {
    const store = db.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
    // The idle restore banner only needs the newest draft.
    store.createIndex('updatedAt', 'updatedAt');
  }
}

let connection: Promise<IDBDatabase> | undefined;

export function pdfshushDb(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => {
      const database = request.result;
      // Another tab may open a newer version. Holding this connection would
      // block that upgrade forever; closing here lets the other tab proceed and
      // makes the next call in this tab reopen at the new version.
      database.onversionchange = () => {
        database.close();
        connection = undefined;
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
    // Without this, an upgrade blocked by another tab left the promise pending
    // forever: every reader hung and the history silently never loaded.
    request.onblocked = () =>
      reject(new Error('IndexedDB upgrade is blocked by another tab'));
  }).catch((error: unknown) => {
    // A cached rejection would poison every later call; forget it so the next
    // attempt opens afresh (a transient private-mode failure, for instance).
    connection = undefined;
    throw error;
  });
  return connection;
}
