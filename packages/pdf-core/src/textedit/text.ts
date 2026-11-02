/**
 * Text folding for matching what the reader sees against what the PDF stores.
 *
 * Two producer habits break naive string equality even when nothing is wrong:
 *
 *   - typographic ligatures: `ﬁ` (U+FB01) is one glyph, but the user selects
 *     and types `fi`;
 *   - invisible/formatting characters: soft hyphens from line breaking and
 *     non-breaking spaces inserted by layout engines.
 *
 * Folding them can only make a match *more* likely, which is the safe direction
 * for both finding the text to edit and for verifying that a deleted string is
 * really gone -- a leftover ligature must still be detected as a leftover.
 */

const FOLD: Record<string, string> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'ft',
  '\uFB06': 'st',
  '\u00AD': '', // soft hyphen: a line-break artifact, not content
  '\u00A0': ' ',
  '\u2007': ' ',
  '\u202F': ' ',
  '\u2010': '-',
  '\u2011': '-',
};

const FOLDABLE = /[\uFB00-\uFB06\u00AD\u00A0\u2007\u202F\u2010\u2011]/g;

export function foldText(text: string): string {
  return text.replace(FOLDABLE, (char) => FOLD[char] ?? char);
}

/** Whitespace-collapsed, ligature-folded text for human-visible comparison. */
export function normalizeForMatch(text: string): string {
  return foldText(text).replace(/\s+/gu, ' ').trim();
}

/** Whitespace removed entirely, for producers that rely on positioning gaps. */
export function withoutWhitespaceForMatch(text: string): string {
  return normalizeForMatch(text).replace(/\s+/gu, '');
}
