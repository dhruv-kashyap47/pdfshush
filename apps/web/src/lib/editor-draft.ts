/**
 * Editor drafts: the crash-safe copy of an in-flight document session.
 *
 * A draft is the *source bytes* plus the whole overlay document, because an
 * edit is meaningless without the document it targets. Everything in here is
 * plain data so the same objects IndexedDB stores are the objects the editor
 * restores; there is no second serialisation format to drift.
 *
 * The schema is additive and versioned (`DRAFT_SCHEMA`). Restore refuses a
 * record it cannot validate rather than hydrating a half-understood document:
 * a lost draft is visible and recoverable, a corrupted one silently merged into
 * a session is not.
 */

import type { EditorObject } from '@pdfshush/pdf-core';
import { DRAFT_STORE, pdfshushDb } from '@/lib/idb';
import type { EditorDoc } from '@/lib/editor-state';
import type { EditorMode, EditorTool } from '@/lib/editor-tools';
import {
  type ParagraphEditRecord,
} from '@/lib/text-editing';

export const DRAFT_SCHEMA = 1;
export const DRAFT_STORE_KEY = 'current';
/** The whole record -- source bytes plus overlay data -- must stay under this. */
export const DRAFT_LIMIT_BYTES = 60 * 1024 * 1024;
/** Autosave is debounced; a fast drag must not write on every pointer move. */
export const DRAFT_DEBOUNCE_MS = 1200;

export interface DraftFileFacts {
  name: string;
  size: number;
  lastModified: number;
}

export interface StoredDraft extends DraftFileFacts {
  id: typeof DRAFT_STORE_KEY;
  schema: typeof DRAFT_SCHEMA;
  updatedAt: number;
  signature: string;
  bytes: Uint8Array;
  doc: EditorDoc;
  pageOrder: number[];
  currentPage: number;
  zoom: number;
  mode: EditorMode;
  tool: EditorTool;
  orderDirty: boolean;
}

export type DraftWriteResult =
  | { ok: true; updatedAt: number; bytes: number }
  | { ok: false; reason: 'too-large' | 'quota' | 'unavailable'; message: string };

/** Stable identity for "the same document" across reloads. */
export function draftSignature(file: DraftFileFacts): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

/** Rough record size: source bytes plus any image payloads already in objects. */
export function draftSizeBytes(
  bytes: Uint8Array,
  doc: EditorDoc,
): number {
  let total = bytes.byteLength;
  for (const object of doc.objects) {
    if (object.kind === 'image') {
      total += object.data.byteLength;
    } else if (object.kind === 'text') {
      total += object.text.length * 2;
      if (object.native) total += object.native.before.length + object.native.after.length;
    } else if (object.kind === 'stamp') {
      total += object.text.length * 2;
    } else if (object.kind === 'ink') {
      total += object.points.length * 16;
    }
  }
  return total;
}

const MODES = new Set<EditorMode>(['edit', 'sign', 'ai', 'redact', 'organize']);
const TOOLS = new Set<EditorTool>([
  'select',
  'text',
  'image',
  'signature',
  'highlight',
  'strikeout',
  'underline',
  'whiteout',
  'rect',
  'ellipse',
  'line',
  'arrow',
  'pen',
  'check',
  'cross',
  'date',
  'stamp',
  'redact',
  'ai',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validBox(value: unknown): boolean {
  return (
    isRecord(value) &&
    finite(value.x) &&
    finite(value.y) &&
    finite(value.width) &&
    finite(value.height) &&
    Number(value.width) >= 0 &&
    Number(value.height) >= 0
  );
}

const OBJECT_KINDS = new Set<EditorObject['kind']>([
  'text',
  'image',
  'whiteout',
  'highlight',
  'strikeout',
  'underline',
  'rect',
  'ellipse',
  'line',
  'arrow',
  'ink',
  'check',
  'cross',
  'stamp',
]);

const ROLES = new Set(['content', 'decoration', 'redaction']);

function validNativePlan(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.before !== 'string' || typeof value.after !== 'string') return false;
  if (!Array.isArray(value.beforeLines)) return false;
  for (const line of value.beforeLines) {
    if (!isRecord(line) || typeof line.text !== 'string' || !validBox(line.box)) return false;
  }
  if (!isRecord(value.reflow)) return false;
  const reflow = value.reflow;
  if (
    !finite(reflow.width) ||
    !finite(reflow.lineHeight) ||
    !finite(reflow.firstBaselineY) ||
    !finite(reflow.x)
  ) {
    return false;
  }
  if (reflow.maxLines !== undefined && !finite(reflow.maxLines)) return false;
  if (reflow.moved !== undefined && typeof reflow.moved !== 'boolean') return false;
  if (value.coverIds !== undefined) {
    if (!Array.isArray(value.coverIds) || value.coverIds.some((id) => typeof id !== 'string')) {
      return false;
    }
  }
  if (value.strategy !== undefined) {
    if (
      ![
        'native-object',
        'content-stream',
        'localized-reconstruction',
        'manual-review',
      ].includes(value.strategy as string)
    ) {
      return false;
    }
  }
  return true;
}

function validObject(value: unknown): value is EditorObject {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (!OBJECT_KINDS.has(value.kind as EditorObject['kind'])) return false;
  if (value.role !== undefined && !ROLES.has(value.role as string)) return false;
  if (!finite(value.pageIndex) || value.pageIndex < 0) return false;
  if (!finite(value.x) || !finite(value.y) || !finite(value.width) || !finite(value.height)) {
    return false;
  }
  if (value.width < 0 || value.height < 0) return false;
  switch (value.kind) {
    case 'text':
      if (typeof value.text !== 'string') return false;
      if (!finite(value.fontSize) || value.fontSize <= 0) return false;
      if (value.native !== undefined && !validNativePlan(value.native)) return false;
      if (value.inPlace !== undefined) {
        if (!isRecord(value.inPlace) || typeof value.inPlace.find !== 'string') return false;
        if (!validBox(value.inPlace.box)) return false;
      }
      break;
    case 'image':
      if (!(value.data instanceof Uint8Array) && !(value.data instanceof ArrayBuffer)) return false;
      if (typeof value.mimeType !== 'string') return false;
      break;
    case 'ink':
      if (!Array.isArray(value.points)) return false;
      if (value.points.some((point) => !isRecord(point) || !finite(point.x) || !finite(point.y))) {
        return false;
      }
      break;
    case 'stamp':
      if (typeof value.text !== 'string') return false;
      break;
    default:
      break;
  }
  return true;
}

/** Accepts only a document whose every object can be drawn and exported. */
export function validateEditorDoc(value: unknown): EditorDoc | null {
  if (!isRecord(value) || !Array.isArray(value.objects)) return null;
  const objects: EditorObject[] = [];
  for (const object of value.objects) {
    if (!validObject(object)) return null;
    objects.push(object);
  }
  if (value.formValues !== undefined && !isRecord(value.formValues)) return null;
  const formValues: Record<string, string | boolean> = {};
  for (const [key, entry] of Object.entries(value.formValues ?? {})) {
    if (typeof entry !== 'string' && typeof entry !== 'boolean') return null;
    formValues[key] = entry;
  }
  const paragraphRecords: ParagraphEditRecord[] = [];
  if (value.paragraphRecords !== undefined) {
    if (!Array.isArray(value.paragraphRecords)) return null;
    for (const record of value.paragraphRecords) {
      if (!validRecord(record)) return null;
      paragraphRecords.push(record);
    }
  }
  return {
    objects,
    formValues,
    ...(paragraphRecords.length > 0 ? { paragraphRecords } : {}),
  };
}

function validRecord(value: unknown): value is ParagraphEditRecord {
  if (!isRecord(value)) return false;
  if (!finite(value.pageIndex) || value.pageIndex < 0) return false;
  if (typeof value.paragraphId !== 'string') return false;
  if (typeof value.before !== 'string' || typeof value.after !== 'string') return false;
  if (!Array.isArray(value.objectIds) || value.objectIds.some((id) => typeof id !== 'string')) {
    return false;
  }
  if (!validNativePlan(value.plan)) return false;
  if (typeof value.styled !== 'boolean') return false;
  return finite(value.savedAt);
}

/** Validates and narrows a stored record, including its schema version. */
export function validateDraft(value: unknown): StoredDraft | null {
  if (!isRecord(value)) return null;
  if (value.schema !== DRAFT_SCHEMA) return null;
  if (value.id !== DRAFT_STORE_KEY) return null;
  if (typeof value.name !== 'string' || value.name.length === 0) return null;
  if (!finite(value.size) || value.size < 0) return null;
  if (!finite(value.lastModified) || value.lastModified < 0) return null;
  if (!finite(value.updatedAt)) return null;
  if (typeof value.signature !== 'string') return null;
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength === 0) return null;
  const doc = validateEditorDoc(value.doc);
  if (!doc) return null;
  if (!Array.isArray(value.pageOrder) || value.pageOrder.some((index) => !finite(index))) {
    return null;
  }
  if (!finite(value.currentPage) || value.currentPage < 0) return null;
  if (!finite(value.zoom) || value.zoom <= 0) return null;
  if (!MODES.has(value.mode as EditorMode)) return null;
  if (!TOOLS.has(value.tool as EditorTool)) return null;
  if (typeof value.orderDirty !== 'boolean') return null;
  return {
    id: DRAFT_STORE_KEY,
    schema: DRAFT_SCHEMA,
    updatedAt: value.updatedAt,
    signature: value.signature,
    name: value.name,
    size: value.size,
    lastModified: value.lastModified,
    bytes: value.bytes,
    doc,
    pageOrder: value.pageOrder as number[],
    currentPage: value.currentPage,
    zoom: value.zoom,
    mode: value.mode as EditorMode,
    tool: value.tool as EditorTool,
    orderDirty: value.orderDirty,
  };
}

function isQuotaError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED';
  }
  return error instanceof Error && /quota|storage/i.test(error.message);
}

/**
 * Writes the one draft slot. A too-large record is refused before IndexedDB is
 * touched, and a quota failure is reported so the UI can say so instead of
 * failing silently.
 */
export async function saveDraft(draft: StoredDraft): Promise<DraftWriteResult> {
  const size = draftSizeBytes(draft.bytes, draft.doc);
  if (size > DRAFT_LIMIT_BYTES) {
    return {
      ok: false,
      reason: 'too-large',
      message: `Draft is ${(size / 1048576).toFixed(1)} MB; autosave caps at ${Math.round(
        DRAFT_LIMIT_BYTES / 1048576,
      )} MB.`,
    };
  }
  try {
    const db = await pdfshushDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, 'readwrite');
      tx.objectStore(DRAFT_STORE).put(draft);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Draft write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Draft write aborted'));
    });
    return { ok: true, updatedAt: draft.updatedAt, bytes: size };
  } catch (error) {
    return {
      ok: false,
      reason: isQuotaError(error) ? 'quota' : 'unavailable',
      message: isQuotaError(error)
        ? 'This browser is out of storage for the draft. Save the document or discard the draft.'
        : 'Autosave is unavailable in this browser session.',
    };
  }
}

export async function loadDraft(): Promise<StoredDraft | null> {
  try {
    const db = await pdfshushDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, 'readonly');
      const request = tx.objectStore(DRAFT_STORE).get(DRAFT_STORE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Draft read failed'));
    });
    return validateDraft(value);
  } catch {
    return null;
  }
}

export async function deleteDraft(): Promise<void> {
  try {
    const db = await pdfshushDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, 'readwrite');
      tx.objectStore(DRAFT_STORE).delete(DRAFT_STORE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Draft delete failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Draft delete aborted'));
    });
  } catch {
    // Deleting a draft is best effort: a failed delete must never block the
    // editor from continuing, and the banner can be dismissed locally.
  }
}


