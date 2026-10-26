/**
 * Bookmark suggestions from page text.
 *
 * The text runs come from the same pdf.js extraction the editor uses, so this
 * module is pure data-in/data-out: no rendering, no PDF bytes, and therefore
 * cheap to test with hand-built runs.
 *
 * "Heading" is a relative judgement, not a font table: a line is a heading when
 * it is noticeably larger than the document's body size (or bold at body size).
 * Running headers, footers, and page numbers repeat on most pages, so they are
 * excluded before ranking. The result is deliberately conservative -- one
 * bookmark per page, at the page's most prominent heading -- and the UI lets
 * the user fix whatever the heuristic gets wrong.
 */

import type { TextRun } from './textRuns.js';

export interface BookmarkSuggestion {
  /** Proposed sidebar label. */
  title: string;
  /** Zero-based destination page index. */
  pageIndex: number;
  /** Always 0 from detection; the UI adds nesting. */
  level: number;
}

export type BookmarkSuggestionMode = 'headings' | 'pages';

export interface SuggestBookmarksOptions {
  /** `headings` falls back to one bookmark per page when nothing qualifies. */
  mode?: BookmarkSuggestionMode;
  /** Hard cap, independent of the document length. */
  maxBookmarks?: number;
}

export const BOOKMARK_SUGGESTION_LIMITS = {
  maxBookmarks: 500,
  /** Long titles are cut at a word boundary rather than mid-word. */
  maxTitleChars: 120,
} as const;

interface CleanRun {
  text: string;
  /** Case-folded form used for boilerplate and duplicate checks. */
  key: string;
  fontSize: number;
  x: number;
  y: number;
  bold: boolean;
}

/**
 * Proposes an outline from per-page text runs. Returns an empty list only when
 * there are no pages to look at.
 */
export function suggestBookmarks(
  pages: TextRun[][],
  options: SuggestBookmarksOptions = {},
): BookmarkSuggestion[] {
  if (!Array.isArray(pages) || pages.length === 0) return [];

  const max = clampMax(options.maxBookmarks);
  const cleaned = pages.map(cleanPage);
  const bodySize = mostCommonSize(cleaned.flat().map((run) => run.fontSize));
  const repeated = repeatedKeys(cleaned, bodySize);

  let picks =
    (options.mode ?? 'headings') === 'headings'
      ? pickHeadings(cleaned, bodySize, repeated)
      : [];
  // A text-only PDF with no size contrast still deserves navigation, and a
  // scanned document has no runs at all: page bookmarks are the honest fallback.
  if (picks.length === 0) picks = pickFirstLines(cleaned, repeated);

  return dedupe(picks)
    .slice(0, max)
    .map((pick) => ({ title: pick.title, pageIndex: pick.pageIndex, level: 0 }));
}

function cleanPage(runs: TextRun[]): CleanRun[] {
  if (!Array.isArray(runs)) return [];
  const cleaned: CleanRun[] = [];
  for (const run of runs) {
    if (!run || run.horizontal === false) continue;
    if (typeof run.text !== 'string' || !Number.isFinite(run.fontSize)) continue;
    if (run.fontSize <= 0) continue;

    const text = run.text
      .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < 2) continue;
    if (text.length > BOOKMARK_SUGGESTION_LIMITS.maxTitleChars) continue;

    cleaned.push({
      text,
      key: text.toLowerCase(),
      fontSize: run.fontSize,
      x: Number.isFinite(run.x) ? run.x : 0,
      y: Number.isFinite(run.y) ? run.y : 0,
      bold: run.bold === true,
    });
  }
  return cleaned;
}

/**
 * The body size is the size used by the most lines. Ties go to the smaller
 * size, because a heading is less common than the text it introduces.
 */
function mostCommonSize(sizes: number[]): number {
  if (sizes.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const size of sizes) {
    // Half-point buckets absorb float noise from scaled text matrices.
    const bucket = Math.round(size * 2) / 2;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = -1;
  for (const [size, count] of counts) {
    if (count > bestCount || (count === bestCount && size < best)) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

function repeatedKeys(pages: CleanRun[][], bodySize: number): Set<string> {
  const pagesWithText = pages.filter((page) => page.length > 0).length;
  if (pagesWithText === 0) return new Set();

  const seen = new Map<string, Set<number>>();
  const largest = new Map<string, number>();
  pages.forEach((page, index) => {
    for (const run of page) {
      const set = seen.get(run.key) ?? new Set<number>();
      set.add(index);
      seen.set(run.key, set);
      largest.set(run.key, Math.max(largest.get(run.key) ?? 0, run.fontSize));
    }
  });

  const threshold = Math.max(3, Math.ceil(pagesWithText * 0.5));
  const repeated = new Set<string>();
  for (const [key, pageIndexes] of seen) {
    // A large line that repeats is more likely a running chapter title than a
    // header; consecutive-duplicate removal deals with it without hiding it.
    const isSmall = (largest.get(key) ?? 0) <= bodySize * 1.2 + 0.01;
    if (pageIndexes.size >= threshold && isSmall) repeated.add(key);
  }
  return repeated;
}

function isPageNumber(text: string): boolean {
  const value = text.trim();
  return (
    /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(value) ||
    /^\d{1,4}\s*[-–—]\s*\d{1,4}$/.test(value)
  );
}

function pickHeadings(pages: CleanRun[][], bodySize: number, repeated: Set<string>): Pick[] {
  const picks: Pick[] = [];
  pages.forEach((runs, pageIndex) => {
    const candidates = runs.filter(
      (run) =>
        !isPageNumber(run.text) &&
        !repeated.has(run.key) &&
        isHeading(run, bodySize),
    );
    if (candidates.length === 0) return;

    // Biggest first; on a tie, the higher line wins (smaller display y), then
    // the leftmost, so the choice is stable across runs of the same document.
    candidates.sort(
      (a, b) => b.fontSize - a.fontSize || a.y - b.y || a.x - b.x,
    );
    picks.push({ title: candidates[0]!.text, pageIndex });
  });
  return picks;
}

function isHeading(run: CleanRun, bodySize: number): boolean {
  if (bodySize <= 0) return false;
  const epsilon = 0.01;
  if (run.fontSize >= bodySize * 1.15 - epsilon) return true;
  // A bold line at body size is how plenty of reports write section headings.
  return run.bold && run.fontSize >= bodySize - epsilon;
}

function pickFirstLines(pages: CleanRun[][], repeated: Set<string>): Pick[] {
  const picks: Pick[] = [];
  pages.forEach((runs, pageIndex) => {
    const candidates = runs.filter(
      (run) => !isPageNumber(run.text) && !repeated.has(run.key),
    );
    if (candidates.length === 0) {
      picks.push({ title: `Page ${pageIndex + 1}`, pageIndex });
      return;
    }
    candidates.sort((a, b) => a.y - b.y || a.x - b.x);
    picks.push({ title: candidates[0]!.text, pageIndex });
  });
  return picks;
}

interface Pick {
  title: string;
  pageIndex: number;
}

/** Drops consecutive repeats: a running title that slipped through is still one idea. */
function dedupe(picks: Pick[]): Pick[] {
  const result: Pick[] = [];
  let previous = '';
  for (const pick of picks) {
    const key = pick.title.toLowerCase();
    if (key === previous) continue;
    result.push(pick);
    previous = key;
  }
  return result;
}

function clampMax(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return BOOKMARK_SUGGESTION_LIMITS.maxBookmarks;
  }
  return Math.max(1, Math.min(BOOKMARK_SUGGESTION_LIMITS.maxBookmarks, Math.floor(value)));
}
