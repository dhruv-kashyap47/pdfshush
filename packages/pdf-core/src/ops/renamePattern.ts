/**
 * Rename pattern expansion -- dependency-free on purpose.
 *
 * The tool previews new names as the user types, on the main thread, and the
 * main bundle must not contain pdf-lib (PLAN.md §3). Keeping the formatter here
 * means the preview and the job cannot disagree about what `{n}` produces.
 */

export interface RenameContext {
  /** Original stem, extension already removed. */
  name: string;
  /** Document title, when it has one. Falls back to `name`. */
  title?: string;
  /** 1-based position in the batch. */
  index: number;
  total: number;
  /** Injection point for tests; defaults to today. */
  date?: Date;
}

export const RENAME_TOKENS = [
  { token: '{name}', label: 'Original name' },
  { token: '{title}', label: 'Document title' },
  { token: '{n}', label: 'Sequence' },
  { token: '{total}', label: 'File count' },
  { token: '{date}', label: 'Today' },
] as const;

export const RENAME_LIMITS = {
  maxPatternChars: 120,
  maxStemChars: 120,
  maxDigits: 6,
  maxFiles: 50,
} as const;

/**
 * Expands one pattern. Illegal filename characters become `-` rather than
 * failing: a title such as `Q3/Q4 report` is common and the user should get a
 * usable name, not an error they cannot fix without editing metadata.
 */
export function expandRenamePattern(
  pattern: string,
  context: RenameContext,
  digits = 1,
): string {
  const width = Math.min(RENAME_LIMITS.maxDigits, Math.max(1, Math.trunc(digits)));
  const original = sanitizeStem(context.name) || 'document';
  const title = sanitizeStem(context.title?.trim() ?? '') || original;
  const source = (pattern.trim() || '{name}')
    .replaceAll('{name}', original)
    .replaceAll('{title}', title)
    .replaceAll('{n}', String(context.index).padStart(width, '0'))
    .replaceAll('{total}', String(context.total))
    .replaceAll('{date}', isoDate(context.date ?? new Date()));

  const stem = sanitizeStem(source).replace(/\.pdf$/i, '');
  return `${stem || original}.pdf`;
}

/** Strips characters Windows, macOS and Linux cannot share in a filename. */
export function sanitizeStem(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, RENAME_LIMITS.maxStemChars)
    .trim();
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
