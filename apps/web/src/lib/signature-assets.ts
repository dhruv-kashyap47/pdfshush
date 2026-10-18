/**
 * Signature asset capture shared logic (P6.1, PLAN.md §25.1 D2/D3, §25.2).
 *
 * Pure record shapes, limits and maths only: the draw pad, the IndexedDB store
 * and the audit sidecar all import from here. This module must stay free of
 * DOM and IndexedDB references so it is directly unit-testable (`apps/web`'s
 * own vitest suite, new with P6.1; the aggregate `pnpm test` picks it up via
 * `--if-present`).
 *
 * Storage decisions locked in §25.1 D3:
 * - assets live only in this browser's IndexedDB (no sync, no server copy),
 * - at most `SIGNATURE_STORE_MAX` assets, `SIGNATURE_PNG_MAX_BYTES` per PNG,
 * - stroke data mirrors `signature_pad`'s `toData()` output but is *pinned*
 *   and versioned (`SIGNATURE_STROKES_SCHEMA`), never stored wholesale, so a
 *   library major cannot silently rewrite what our records mean.
 */

export const SIGNATURE_STORE_MAX = 5;
export const SIGNATURE_PNG_MAX_BYTES = 200 * 1024;
export const SIGNATURE_LABEL_MAX_CHARS = 80;

/** Versioned, so a stored record can be read long after the library changes. */
export const SIGNATURE_STROKES_SCHEMA = 1;

export type SignatureMethod = 'drawn' | 'typed';

/**
 * The point-relevant fields of a `signature_pad` point group. Extra fields the
 * library adds later are dropped on capture -- stores change shape rarely and
 * deliberately, not by library accident.
 */
export interface SignatureStrokeGroup {
  penColor?: string;
  dotSize?: number;
  minWidth?: number;
  maxWidth?: number;
  velocityFilterWeight?: number;
  points: Array<{ x: number; y: number; pressure?: number; time: number }>;
}

export interface SignatureStrokes {
  schema: typeof SIGNATURE_STROKES_SCHEMA;
  groups: SignatureStrokeGroup[];
}

export interface SignatureAssetRecord {
  id: string;
  createdAt: number;
  method: SignatureMethod;
  /** Present only for captured strokes (drawn); typed signatures are pixels. */
  strokes?: SignatureStrokes;
  png: Blob;
  /** Capture-space dimensions in CSS pixels (before trim). */
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_CAPTURE_SIDE = 20_000;
const MAX_GROUPS = 1_000;
const MAX_POINTS_PER_GROUP = 5_000;

/** Control characters (C0, DEL, C1) never belong in a signer label. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * D2 label sanitizer: trim, flatten whitespace runs, drop control characters,
 * cap at `SIGNATURE_LABEL_MAX_CHARS` code points. Empty/absent → `undefined`
 * so the audit sidecar can omit the field cleanly.
 */
export function sanitizeSignatureLabel(raw: string | undefined | null): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const cleaned = raw.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return undefined;
  const chars = Array.from(cleaned);
  const capped = chars.slice(0, SIGNATURE_LABEL_MAX_CHARS).join('');
  return capped.length > 0 ? capped : undefined;
}

/**
 * Trim maths for the captured pad: scan the alpha channel, find the tight ink
 * box, and expand it by `padding` CSS pixels, clamped to the canvas.
 *
 * Runs on `Uint8ClampedArray` (or a plain `Uint8Array` of the same rgba
 * layout) rather than an `ImageData` so it is testable without a canvas.
 * Returns `null` when there is no ink at or above the threshold -- the caller
 * treats that as "nothing to save", never as a whole-canvas PNG.
 */
export function computeInkBounds(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options?: { alphaThreshold?: number; padding?: number },
): Rect | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  if (data.length < width * height * 4) return null;

  const threshold = options?.alphaThreshold ?? 1;
  const padding = options?.padding ?? 8;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * 4 + 3]! < threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;

  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(width - 1, maxX + padding);
  const bottom = Math.min(height - 1, maxY + padding);
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Positive-finite number guard shared by the pad and the store. */
function isPositiveFinite(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strokesArePlausible(value: unknown): value is SignatureStrokes {
  if (!isPlainObject(value)) return false;
  if (value.schema !== SIGNATURE_STROKES_SCHEMA) return false;
  const groups = value.groups;
  if (!Array.isArray(groups) || groups.length === 0 || groups.length > MAX_GROUPS) return false;
  return groups.every((group) => {
    if (!isPlainObject(group)) return false;
    const points = group.points;
    if (!Array.isArray(points) || points.length === 0) return false;
    return points.length <= MAX_POINTS_PER_GROUP;
  });
}

/**
 * Validates an unknown parsed record before it is trusted (or shown). Malformed
 * records fail *visibly* (the caller drops them) rather than rendering junk.
 */
export function isSignatureAssetRecord(value: unknown): value is SignatureAssetRecord {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 100) return false;
  if (!isPositiveFinite(value.createdAt, Number.MAX_SAFE_INTEGER)) return false;
  if (value.method !== 'drawn' && value.method !== 'typed') return false;
  if (!(value.png instanceof Blob)) return false;
  if (value.png.size === 0 || value.png.size > SIGNATURE_PNG_MAX_BYTES) return false;
  if (!isPositiveFinite(value.width, MAX_CAPTURE_SIDE)) return false;
  if (!isPositiveFinite(value.height, MAX_CAPTURE_SIDE)) return false;
  if (value.strokes !== undefined && !strokesArePlausible(value.strokes)) return false;
  return true;
}

export class SignatureAssetTooLargeError extends Error {
  constructor() {
    super(`Signature image exceeds the ${Math.round(SIGNATURE_PNG_MAX_BYTES / 1024)} KB limit.`);
    this.name = 'SignatureAssetTooLargeError';
  }
}

export class SignatureAssetLimitError extends Error {
  constructor() {
    super(`Only ${SIGNATURE_STORE_MAX} saved signatures are kept; delete one first.`);
    this.name = 'SignatureAssetLimitError';
  }
}
