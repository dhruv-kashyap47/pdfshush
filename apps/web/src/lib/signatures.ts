/**
 * Saved signature assets (P6.1, PLAN.md §25.1 D3): an IndexedDB store that
 * never leaves the device.
 *
 * Same discipline as `tools/recent.ts`: one shared connection (owned by
 * `lib/idb.ts`), serialised writes, fire-and-forget safety, and a newest-first
 * cap trim. The differences are deliberate:
 * - an oversize PNG or an at-cap store is a *visible* failure (the pad's save
 *   button toasts it), not a silent convenience drop -- a discarded signature
 *   is worse than no signature;
 * - records are validated on read with `isSignatureAssetRecord`, so an old or
 *   corrupted row renders as absent instead of producing a broken thumbnail.
 */

import { SIGNATURE_STORE, pdfshushDb } from '@/lib/idb';
import {
  SIGNATURE_PNG_MAX_BYTES,
  SIGNATURE_STORE_MAX,
  SIGNATURE_STROKES_SCHEMA,
  SignatureAssetLimitError,
  SignatureAssetTooLargeError,
  isSignatureAssetRecord,
  type SignatureAssetRecord,
  type SignatureMethod,
  type SignatureStrokeGroup,
} from '@/lib/signature-assets';

type SignatureListener = () => void;

const listeners = new Set<SignatureListener>();

/** Tells mounted readers (the pad dialog, the manage page) that assets changed. */
export function subscribeSignatures(listener: SignatureListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One bad subscriber must not abort the write or starve the others.
    }
  }
}

/** Serialises writes on the shared connection; identical rationale to recent.ts. */
let writes: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(work: () => Promise<T>): Promise<T> {
  const result = writes.then(work, work);
  writes = result.catch(() => undefined);
  return result;
}

export async function listSignatures(): Promise<SignatureAssetRecord[]> {
  try {
    const database = await pdfshushDb();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const tx = database.transaction(SIGNATURE_STORE, 'readonly');
      const request = tx.objectStore(SIGNATURE_STORE).getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
    return rows
      .filter(isSignatureAssetRecord)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    // Storage is a convenience for a device-internal store; an unavailable DB
    // just means no saved strip, and the pad itself keeps working.
    return [];
  }
}

/** Captures the stroke-relevant fields of a `signature_pad` point group. */
export function captureStrokeGroup(group: unknown): SignatureStrokeGroup | null {
  if (typeof group !== 'object' || group === null) return null;
  const source = group as Record<string, unknown>;
  const points = Array.isArray(source.points) ? source.points : null;
  if (!points || points.length === 0) return null;
  return {
    ...(typeof source.penColor === 'string' && source.penColor ? { penColor: source.penColor } : {}),
    ...(typeof source.dotSize === 'number' ? { dotSize: source.dotSize } : {}),
    ...(typeof source.minWidth === 'number' ? { minWidth: source.minWidth } : {}),
    ...(typeof source.maxWidth === 'number' ? { maxWidth: source.maxWidth } : {}),
    ...(typeof source.velocityFilterWeight === 'number'
      ? { velocityFilterWeight: source.velocityFilterWeight }
      : {}),
    points: points
      .slice(0, 5_000)
      .map((point) => {
        if (typeof point !== 'object' || point === null) return null;
        const p = point as Record<string, unknown>;
        if (typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.time !== 'number') {
          return null;
        }
        return {
          x: p.x,
          y: p.y,
          ...(typeof p.pressure === 'number' ? { pressure: p.pressure } : {}),
          time: p.time,
        };
      })
      .filter((point): point is NonNullable<typeof point> => point !== null),
  };
}

export function captureStrokes(groups: unknown[]):
  | { schema: typeof SIGNATURE_STROKES_SCHEMA; groups: SignatureStrokeGroup[] }
  | undefined {
  const captured = (groups ?? [])
    .map(captureStrokeGroup)
    .filter((group): group is SignatureStrokeGroup => group !== null);
  if (captured.length === 0) return undefined;
  return { schema: SIGNATURE_STROKES_SCHEMA, groups: captured };
}

/**
 * Stores a new asset and trims the store to the newest `SIGNATURE_STORE_MAX`.
 *
 * Throws `SignatureAssetTooLargeError` / `SignatureAssetLimitError` so the UI
 * can react with a toast -- callers should never swallow them silently (D3:
 * a discarded signature is a visible failure).
 */
export async function saveSignature(asset: {
  method: SignatureMethod;
  strokes?: { schema: typeof SIGNATURE_STROKES_SCHEMA; groups: SignatureStrokeGroup[] };
  png: Blob;
  width: number;
  height: number;
}): Promise<SignatureAssetRecord> {
  if (asset.png.size === 0) throw new Error('That signature is empty.');
  if (asset.png.size > SIGNATURE_PNG_MAX_BYTES) throw new SignatureAssetTooLargeError();

  const record: SignatureAssetRecord = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    method: asset.method,
    ...(asset.strokes ? { strokes: asset.strokes } : {}),
    png: asset.png,
    width: asset.width,
    height: asset.height,
  };

  await enqueueWrite(async () => {
    const database = await pdfshushDb();
    // At-cap is refused rather than silently evicting the oldest saved
    // signature (D3: a discarded signature is a visible failure, not a
    // convenience drop). The newest-first trim below stays as a safety net for
    // stale or migrated extras only.
    const count = await new Promise<number>((resolve, reject) => {
      const tx = database.transaction(SIGNATURE_STORE, 'readonly');
      const request = tx.objectStore(SIGNATURE_STORE).count();
      request.onsuccess = () => resolve(request.result ?? 0);
      request.onerror = () => reject(request.error);
    });
    if (count >= SIGNATURE_STORE_MAX) throw new SignatureAssetLimitError();

    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(SIGNATURE_STORE, 'readwrite');
      const store = tx.objectStore(SIGNATURE_STORE);
      const index = store.index('createdAt');
      store.put(record);
      const cursorRequest = index.openCursor(null, 'prev');
      let seen = 0;
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        seen += 1;
        if (seen > SIGNATURE_STORE_MAX) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Signature store write aborted'));
    });
    notify();
  });

  return record;
}

export async function deleteSignature(id: string): Promise<void> {
  await enqueueWrite(async () => {
    try {
      const database = await pdfshushDb();
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(SIGNATURE_STORE, 'readwrite');
        tx.objectStore(SIGNATURE_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      notify();
    }
  });
}

export type { SignatureAssetRecord };
