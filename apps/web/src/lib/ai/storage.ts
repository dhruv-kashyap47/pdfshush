/**
 * Where the AI configuration lives at rest.
 *
 * One IndexedDB record holds both halves of the AI state: the BYOK settings
 * (provider, model, key) and the chosen mode. The key deliberately does *not*
 * sit in localStorage any more; that is a flat string map any script on the
 * origin (an extension, a sibling tab, a "clear site data" sweep) enumerates by
 * name, and it is the store a review flags first. IndexedDB keeps the same
 * origin boundary but holds a structured record with an explicit delete, and it
 * is where a larger, typed payload belongs.
 *
 * Honest scope: neither store encrypts, and any script running in this origin
 * can read either. The guarantees that matter are enforced elsewhere and are
 * not weakened by the move:
 *  - the key never leaves the device (see ./transport: the request goes
 *    straight to the provider),
 *  - it is never a job payload, a URL, a log line, or part of the recent-files
 *    record,
 *  - it is erasable in one click (`forgetAiKey`), which deletes the record.
 *
 * `sanitizeAiSettings` still guards every read *and* every write: a tampered
 * record is coerced field by field, and dropped wholesale when it is not even
 * the right shape. The old localStorage keys are migrated on first read and
 * then removed.
 */

import {
  defaultAiSettings,
  resolveAiSettings,
  sanitizeAiSettings,
  type AiSettings,
} from '@pdfshush/ai-provider/browser';
import type { AiMode } from './mode';

/** Everything stored at rest for the AI features. */
export interface AiState {
  settings: AiSettings;
  mode: AiMode;
}

const DB_NAME = 'pdfshush.ai';
const DB_VERSION = 1;
const STORE = 'state';
const RECORD = 'ai';

/** Pre-IndexedDB keys, read once for migration and then deleted. */
const LEGACY_SETTINGS_KEY = 'pdfshush.ai.settings.v1';
const LEGACY_MODE_KEY = 'pdfshush.ai.mode.v1';

const defaultState = (): AiState => ({ settings: defaultAiSettings(), mode: 'byok' });

/**
 * The live copy for this session. Reads are synchronous because components hold
 * these values in state; the record is hydrated once at startup (`hydrateAiState`)
 * and every write updates this snapshot before it is persisted.
 */
let snapshot: AiState = defaultState();

/** The one in-flight (or completed) hydration, so several mounts share it. */
let hydration: Promise<AiState> | null = null;

/** The AI state this session is using. */
export function aiState(): AiState {
  return snapshot;
}

/**
 * Adopt (and persist) a change. Settings are sanitized here, so nothing invalid
 * (or unexpected) can reach the store through this path.
 */
export function setAiState(patch: { settings?: AiSettings; mode?: AiMode }): AiState {
  snapshot = {
    settings:
      patch.settings === undefined
        ? snapshot.settings
        : (sanitizeAiSettings(patch.settings) ?? defaultAiSettings()),
    mode: patch.mode ?? snapshot.mode,
  };
  void writeRecord(snapshot);
  return snapshot;
}

/**
 * Load the stored state: the IndexedDB record, or (once) the legacy
 * localStorage pair, which is adopted and then deleted.
 *
 * Single-flight on purpose. Two components mount in the same tick (and React's
 * dev-mode double mount makes that the norm), and the second read would
 * otherwise run between the first one's legacy diff and its write, find an
 * empty store and an already-cleared localStorage, and hand back defaults,
 * silently dropping the user's key from the session. One hydration, shared.
 */
export function hydrateAiState(): Promise<AiState> {
  hydration ??= hydrate();
  return hydration;
}

async function hydrate(): Promise<AiState> {
  const stored = coerceRecord(await readRecord());
  if (stored) {
    snapshot = stored;
    return snapshot;
  }

  const legacy = readLegacy();
  if (legacy) {
    snapshot = legacy;
    clearLegacy();
    await writeRecord(legacy);
    return snapshot;
  }

  // Nothing stored anywhere: keep whatever this session already holds rather
  // than replacing it with defaults.
  return snapshot;
}

/**
 * Erase the stored AI configuration entirely (key, provider, and mode choice)
 * and return to defaults. Deliberately a delete rather than a write of
 * empty fields: nothing is left on disk to recover.
 */
export async function forgetAiKey(): Promise<AiState> {
  snapshot = defaultState();
  clearLegacy();
  await deleteRecord();
  return snapshot;
}

/* ------------------------------------------------------------- validation */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A stored record, sanitized. Never throws; a bad payload yields the defaults. */
function coerceRecord(raw: unknown): AiState | null {
  if (!isRecord(raw)) return null;
  const settings =
    sanitizeAiSettings(resolveAiSettings(raw.settings, defaultAiSettings())) ??
    defaultAiSettings();
  return { settings, mode: raw.mode === 'managed' ? 'managed' : 'byok' };
}

/** The pre-IndexedDB pair, if either half is still present in localStorage. */
function readLegacy(): AiState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const rawSettings = localStorage.getItem(LEGACY_SETTINGS_KEY);
    const rawMode = localStorage.getItem(LEGACY_MODE_KEY);
    if (!rawSettings && !rawMode) return null;
    const parsed: unknown = rawSettings ? JSON.parse(rawSettings) : undefined;
    const legacy = coerceRecord({ settings: parsed, mode: rawMode });
    return legacy ?? { settings: defaultAiSettings(), mode: 'byok' };  } catch {
    return null;
  }
}

function clearLegacy(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(LEGACY_SETTINGS_KEY);
    localStorage.removeItem(LEGACY_MODE_KEY);
  } catch {
    // Storage disabled: the IndexedDB copy is already authoritative.
  }
}

/* ------------------------------------------------------------ IndexedDB IO */

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    // Private mode, a blocked upgrade or a disabled store: the in-memory copy
    // still works for this session, exactly as the old localStorage failure path.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    let request: IDBRequest<T>;
    try {
      const tx = db.transaction(STORE, mode);
      request = run(tx.objectStore(STORE));
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
      tx.oncomplete = () => db.close();
    } catch {
      db.close();
      resolve(null);
      return;
    }
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });
}

function readRecord(): Promise<unknown> {
  return withStore<unknown>('readonly', (store) => store.get(RECORD));
}

function writeRecord(state: AiState): Promise<void> {
  // Store a plain copy: the record must not hold a live reference to state.
  const value = { settings: state.settings, mode: state.mode };
  return withStore<IDBValidKey>('readwrite', (store) => store.put(value, RECORD)).then(
    () => undefined,
  );
}

function deleteRecord(): Promise<void> {
  return withStore<undefined>('readwrite', (store) => store.delete(RECORD)).then(() => undefined);
}
