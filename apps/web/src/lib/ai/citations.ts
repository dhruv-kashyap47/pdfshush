/**
 * Citation parsing for assistant answers.
 *
 * Both PDF skills are instructed to cite the pages they used as `[page N]`.
 * Answers are therefore stored as plain text (exactly what the model said), and
 * this module is the only place that interprets those markers; the chat renders
 * each one as a chip that jumps the preview pane to that page.
 */

export type AnswerSegment =
  | { kind: 'text'; text: string }
  | { kind: 'citation'; text: string; pages: number[] };

/** `[page 3]`, `[pages 2, 5]`, `[pages 4-6]` (case-insensitive, tolerant of spaces). */
const CITATION = /\[\s*pages?\s+([0-9][0-9\s,\u2013-]*)\]/gi;

/** Longest run of pages a single `4-6` range will expand to (a typo guard, not a limit). */
const MAX_RANGE_SPAN = 50;

function parsePages(raw: string): number[] {
  const pages = new Set<number>();
  for (const part of raw.split(',')) {
    const range = /^(\d+)\s*[\u2013-]\s*(\d+)$/.exec(part.trim());
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (!Number.isInteger(from) || !Number.isInteger(to)) continue;
      const low = Math.min(from, to);
      const high = Math.min(Math.max(from, to), low + MAX_RANGE_SPAN);
      for (let page = low; page <= high; page += 1) pages.add(page);
      continue;
    }
    const single = Number(part.trim());
    if (Number.isInteger(single) && single > 0) pages.add(single);
  }
  return [...pages].sort((a, b) => a - b);
}

/** Split answer text into plain runs and page citations. */
export function splitCitations(text: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  const pattern = new RegExp(CITATION.source, 'gi');
  let cursor = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const at = match.index;
    if (at > cursor) segments.push({ kind: 'text', text: text.slice(cursor, at) });
    const pages = parsePages(match[1] ?? '');
    // A malformed marker stays visible as text rather than vanishing.
    segments.push(pages.length > 0 ? { kind: 'citation', text: match[0], pages } : { kind: 'text', text: match[0] });
    cursor = at + match[0].length;
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });
  return segments;
}

/** Every page cited anywhere in the text, in ascending order. */
export function citedPages(text: string): number[] {
  const pages = new Set<number>();
  for (const segment of splitCitations(text)) {
    if (segment.kind === 'citation') for (const page of segment.pages) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}
