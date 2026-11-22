/**
 * Stable warning codes for the editor and the jobs that feed it.
 *
 * A warning used to be a free-text string. That was readable but not
 * addressable: the receipt could not group the same loss reported by two
 * pages, and a test could only pin wording. A code names the *kind* of loss;
 * `detail` says where it happened; `message` is still the full human sentence,
 * so existing call sites keep working while new ones can key on the code.
 *
 * Codes are part of the public contract: rename one only with a migration,
 * never reuse it for a different meaning.
 */

export const WARNING_CODES = [
  // Text-engine fidelity
  'font-substituted',
  'font-non-embedded',
  'synthetic-bold',
  'synthetic-italic',
  'glyph-rasterised',
  'text-squeeze',
  'leftover-cover',
  'leftover-cover-skipped',
  'edit-coverage',
  'edit-unresolved',
  'overlay-fallback',
  // Content-stream surgery
  'stream-incomplete',
  'stream-verification',
  'stream-unavailable',
  'stream-fallback',
  'stream-error',
  // Export verification
  'verification-failed',
  'untouched-page-changed',
  'untouched-page-accepted',
  'metadata-dropped',
  'structure-dropped',
  // OCR
  'ocr-text-layer',
  'ocr-skipped',
  'ocr-low-confidence',
  'ocr-empty-page',
  // Redaction
  'redaction-rasterised',
  'redaction-dpi',
  // Generic fallback for a warning that has not been assigned a code yet.
  'engine-warning',
] as const;

export type WarningCode = (typeof WARNING_CODES)[number];

export interface JobWarning {
  code: WarningCode;
  /**
   * Locator for the warning: a page number, an edit id, a font name. Two
   * warnings with the same code and detail are the same warning.
   */
  detail: string;
  /** The complete sentence shown to the user. */
  message: string;
}

/** More than this many distinct warnings stops being a receipt and becomes a log. */
export const WARNING_LIMIT = 40;

const CODE_SET: ReadonlySet<string> = new Set(WARNING_CODES);

/**
 * Message patterns for warnings emitted before this registry existed. Keeping
 * them here means a job can migrate its type without rewriting every sentence
 * in one go; each branch is a stable code, not a guess at intent.
 */
const LEGACY_PATTERNS: ReadonlyArray<readonly [RegExp, WarningCode]> = [
  [/content-stream rewrite was discarded/i, 'stream-verification'],
  [/content-stream fallback found no/i, 'stream-unavailable'],
  [/content-stream fallback was not used because/i, 'stream-verification'],
  [/content-stream fallback was not used:/i, 'stream-error'],
  [/edits were written through the page content stream/i, 'stream-fallback'],
  [/edits were applied as overlays/i, 'overlay-fallback'],
  [/rendered at \d+ dpi/i, 'redaction-dpi'],
  [/pages were rebuilt as images/i, 'redaction-rasterised'],
  [/non-embedded/i, 'font-non-embedded'],
  [/untouched page/i, 'untouched-page-changed'],
];

/**
 * Normalises either shape the engine can produce into a coded warning.
 *
 * A leading `code: detail` prefix wins when the code is registered; otherwise
 * the sentence is matched against the legacy patterns and finally kept as
 * `engine-warning` rather than dropped. A warning without a code is still more
 * honest than no warning.
 */
export function toJobWarning(value: string | JobWarning): JobWarning {
  if (typeof value !== 'string') return value;
  const match = /^([a-z0-9-]+):\s*(.*)$/s.exec(value);
  if (match && CODE_SET.has(match[1]!)) {
    return { code: match[1] as WarningCode, detail: match[2]!.trim(), message: value };
  }
  for (const [pattern, code] of LEGACY_PATTERNS) {
    if (pattern.test(value)) return { code, detail: value, message: value };
  }
  return { code: 'engine-warning', detail: value, message: value };
}

/**
 * Deduplicates by `code + detail` and caps the list. Order is preserved: the
 * first occurrence of a warning is the one the user reads.
 */
export function collectWarnings(
  values: Iterable<string | JobWarning>,
  limit: number = WARNING_LIMIT,
): JobWarning[] {
  const seen = new Set<string>();
  const out: JobWarning[] = [];
  for (const value of values) {
    const warning = toJobWarning(value);
    const key = `${warning.code}\u0000${warning.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(warning);
    if (out.length >= limit) break;
  }
  return out;
}

/** The human sentences, for consumers that only render text. */
export function warningMessages(warnings: readonly JobWarning[]): string[] {
  return warnings.map((warning) => warning.message);
}

/** True when any warning is about an untouched page's text changing. */
export function hasUntouchedPageWarning(warnings: readonly JobWarning[]): boolean {
  return warnings.some(
    (warning) =>
      warning.code === 'untouched-page-changed' || warning.code === 'untouched-page-accepted',
  );
}
