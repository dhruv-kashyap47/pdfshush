/**
 * Deterministic identities for model nodes.
 *
 * IDs must survive a re-read of the same page: an edit is keyed by paragraph
 * ID while the original text is re-extracted, and history snapshots refer to
 * object IDs long after the layout that produced them is gone. A random UUID
 * would break both. We hash the semantic position (page, ordinal, quantized
 * geometry, text) instead, then disambiguate collisions with a suffix.
 */

/** FNV-1a, 32-bit. Fast, dependency-free, stable across platforms. */
export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

/** Quantizes a coordinate so sub-point noise cannot change an ID. */
export function quantize(value: number, step = 0.1): number {
  return Math.round(value / step) * step;
}

export interface IdFactory {
  (prefix: string, seed: string | number): string;
}

/**
 * Creates an ID factory that guarantees uniqueness within one page/document.
 * The prefix makes IDs self-describing in logs (`p2.para.1a2b3c4`).
 */
export function createIdFactory(pageIndex = 0): IdFactory {
  const seen = new Map<string, number>();
  return (prefix: string, seed: string | number): string => {
    const base = `p${pageIndex}.${prefix}.${hashString(String(seed))}`;
    const previous = seen.get(base) ?? 0;
    seen.set(base, previous + 1);
    return previous === 0 ? base : `${base}-${previous + 1}`;
  };
}

export function textSeed(text: string, bbox: { x: number; y: number; width: number; height: number }): string {
  return `${text}|${quantize(bbox.x)},${quantize(bbox.y)},${quantize(bbox.width)},${quantize(bbox.height)}`;
}
