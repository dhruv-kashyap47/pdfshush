/**
 * Bates numbering -- sequential legal page stamps.
 *
 * A Bates number is not a page number: it carries a matter prefix, starts at a
 * number that continues an existing file, and is zero-padded to a fixed width
 * so every number in the set sorts and scans identically. The placement code
 * already lives in `stampDocument` (display-space aware, rotation-safe), so
 * this op only owns the number format and hands it a per-page resolver.
 */

import type { PDFDocument } from '@cantoo/pdf-lib';
import type { JobContext } from '../job.js';
import { stampDocument, type StampPosition, type StampStyle } from './stamp.js';

export interface BatesOptions {
  /** Matter prefix, e.g. "ABC-" or "2026/". At most 32 characters. */
  prefix?: string;
  /** First number in the sequence. Defaults to 1. */
  start?: number;
  /** Zero-pad the number to this many digits. Defaults to 6. */
  digits?: number;
  position?: StampPosition;
}

export const BATES_LIMITS = {
  maxPrefixChars: 32,
  minStart: 1,
  maxStart: 999_999_999,
  minDigits: 1,
  maxDigits: 12,
} as const;

/** `prefix` + a zero-padded, non-negative integer -- pure and trivially testable. */
export function formatBatesNumber(prefix: string, value: number, digits: number): string {
  const width = Math.min(BATES_LIMITS.maxDigits, Math.max(BATES_LIMITS.minDigits, Math.trunc(digits)));
  const number = Math.max(0, Math.trunc(value));
  return `${prefix}${String(number).padStart(width, '0')}`;
}

export interface BatesResult {
  start: number;
  end: number;
  pages: number;
}

/**
 * Stamps every page with the next number in the sequence.
 *
 * The output number for page `i` is `start + i`, so a 3-page document starting
 * at 42 with six digits ends at 000044.
 */
export async function batesNumberDocument(
  doc: PDFDocument,
  options: BatesOptions,
  ctx: JobContext,
  style: StampStyle = {},
): Promise<BatesResult> {
  const prefix = (options.prefix ?? '').slice(0, BATES_LIMITS.maxPrefixChars);
  const start = clampInt(options.start ?? 1, BATES_LIMITS.minStart, BATES_LIMITS.maxStart);
  const digits = clampInt(options.digits ?? 6, BATES_LIMITS.minDigits, BATES_LIMITS.maxDigits);
  const position = options.position ?? 'bottom-right';
  const pages = doc.getPageCount();

  await stampDocument(
    doc,
    {
      footer: {
        text: '',
        position,
        textFor: (pageIndex) => formatBatesNumber(prefix, start + pageIndex, digits),
      },
    },
    ctx,
    style,
  );

  return { start, end: start + pages - 1, pages };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
