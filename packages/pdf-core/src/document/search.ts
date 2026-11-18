/**
 * Find & replace over the structured document model.
 *
 * The model is the immutable original, so search never mutates it. A match is
 * identified by page, paragraph and *body* offsets in `Paragraph.text`; the
 * editor turns those offsets back into paragraph mutations and commits them as
 * one undo step. Working on the model (rather than the page raster or the
 * content stream) is what keeps this independent of the PDF engine and what
 * makes list markers survive a replacement: markers live outside
 * `Paragraph.text`.
 *
 * Case folding is deliberately offset-preserving. A character whose lowercase
 * form is longer than one code point (for example `İ`) is kept verbatim instead
 * of being folded, so `start`/`end` always address the original text exactly.
 * That is a documented limit, not a silent guess: matching those characters
 * still works when they appear the same way in the query.
 */

import type { PageLayout, Paragraph } from './types.js';

export interface SearchOptions {
  /** Default false: matching is case-insensitive. */
  caseSensitive?: boolean;
  /** Match only when neither edge is next to a letter, digit or underscore. */
  wholeWord?: boolean;
}

export interface SearchMatch {
  pageIndex: number;
  paragraphId: string;
  /** Body-offset start in `Paragraph.text` (inclusive). */
  start: number;
  /** Body-offset end in `Paragraph.text` (exclusive). */
  end: number;
  /** The matched text exactly as it appears in the paragraph. */
  text: string;
  /** Context around the match, whitespace-collapsed, for a results list. */
  snippet: string;
  before: string;
  after: string;
  /** Lines the match touches, in reading order. Empty for synthetic models. */
  lineIds: string[];
  /** The paragraph's full body text at search time. */
  paragraphText: string;
  /** Zero-based ordinal of this match inside its paragraph. */
  paragraphMatchIndex: number;
}

export interface SearchReplacement {
  pageIndex: number;
  paragraphId: string;
  /** Paragraph body text after every match in it is replaced. */
  text: string;
  /** Number of matches replaced in this paragraph. */
  count: number;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const SNIPPET_CONTEXT = 42;

/**
 * Lowercase text one code point at a time, preserving length.
 *
 * `toLowerCase()` can expand (or contract) a code point; adding that result
 * would shift every later offset. The contract here is exact offsets, so an
 * expansion is left unchanged.
 */
export function foldText(text: string): string {
  let folded = '';
  for (const char of text) {
    const lower = char.toLowerCase();
    folded += lower.length === char.length ? lower : char;
  }
  return folded;
}

/** True when a code point can be part of a word for whole-word matching. */
export function isWordCharacter(char: string | undefined): boolean {
  return Boolean(char && WORD_CHAR.test(char));
}

/** Whitespace-collapsed context around a match. */
export function searchSnippet(text: string, start: number, end: number): string {
  const from = Math.max(0, start - SNIPPET_CONTEXT);
  const to = Math.min(text.length, end + SNIPPET_CONTEXT);
  const body = text.slice(from, to).replace(/\s+/gu, ' ').trim();
  return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`;
}

/** Lines a body-offset range intersects, in the paragraph's own order. */
export function matchedLineIds(paragraph: Paragraph, start: number, end: number): string[] {
  const ids: string[] = [];
  for (const span of paragraph.lineSpans) {
    if (span.end <= start || span.start >= end) continue;
    ids.push(span.lineId);
  }
  return ids;
}

function findInParagraph(
  paragraph: Paragraph,
  query: string,
  options: Required<SearchOptions>,
): SearchMatch[] {
  if (paragraph.text.length === 0) return [];
  const haystack = options.caseSensitive ? paragraph.text : foldText(paragraph.text);
  const needle = options.caseSensitive ? query : foldText(query);
  if (needle.length === 0 || needle.length > haystack.length) return [];

  const matches: SearchMatch[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    const start = index;
    const end = index + needle.length;
    const wholeWordOk =
      !options.wholeWord ||
      (!isWordCharacter(haystack[start - 1]) && !isWordCharacter(haystack[end]));
    if (wholeWordOk) {
      matches.push({
        pageIndex: paragraph.pageIndex,
        paragraphId: paragraph.id,
        start,
        end,
        text: paragraph.text.slice(start, end),
        snippet: searchSnippet(paragraph.text, start, end),
        before: paragraph.text.slice(0, start),
        after: paragraph.text.slice(end),
        lineIds: matchedLineIds(paragraph, start, end),
        paragraphText: paragraph.text,
        paragraphMatchIndex: matches.length,
      });
    }
    // Advance by one, not by the query length: overlapping matches are real
    // (e.g. "aa" in "aaa") and skipping them would make the count wrong.
    from = start + 1;
  }
  return matches;
}

function paragraphsOf(layout: PageLayout): Paragraph[] {
  if (layout.readingOrder.length === 0) return layout.paragraphs;
  const byId = new Map(layout.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
  const ordered: Paragraph[] = [];
  for (const id of layout.readingOrder) {
    const paragraph = byId.get(id);
    if (paragraph) ordered.push(paragraph);
  }
  // A paragraph missing from `readingOrder` (a partially built model) must not
  // become unsearchable; append it rather than trusting the index blindly.
  for (const paragraph of layout.paragraphs) {
    if (!layout.readingOrder.includes(paragraph.id)) ordered.push(paragraph);
  }
  return ordered;
}

/**
 * Every match across the supplied layouts, in page and reading order.
 *
 * Pass layouts in page order. A page that failed to load is simply absent; the
 * caller reports that separately rather than pretending it was searched.
 */
export function findInLayouts(
  layouts: readonly PageLayout[] | ReadonlyMap<number, PageLayout>,
  query: string,
  options: SearchOptions = {},
): SearchMatch[] {
  const trimmed = query;
  if (trimmed.length === 0) return [];
  const resolved: Required<SearchOptions> = {
    caseSensitive: options.caseSensitive ?? false,
    wholeWord: options.wholeWord ?? false,
  };
  const pages = Array.isArray(layouts) ? [...layouts] : [...layouts.values()];
  pages.sort((a, b) => a.index - b.index);
  const matches: SearchMatch[] = [];
  for (const layout of pages) {
    for (const paragraph of paragraphsOf(layout)) {
      matches.push(...findInParagraph(paragraph, trimmed, resolved));
    }
  }
  return matches;
}

/**
 * New body text for every paragraph touched by `matches`.
 *
 * Replacements are applied right-to-left so earlier offsets stay valid. The
 * result is body text: list markers are intentionally untouched and the editor
 * re-attaches them through `paragraphDisplayText`.
 */
export function replaceMatches(
  matches: readonly SearchMatch[],
  replacement: string,
): SearchReplacement[] {
  interface Group {
    pageIndex: number;
    paragraphId: string;
    text: string;
    edits: { start: number; end: number }[];
  }
  const groups = new Map<string, Group>();
  for (const match of matches) {
    const key = `${match.pageIndex}:${match.paragraphId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        pageIndex: match.pageIndex,
        paragraphId: match.paragraphId,
        text: match.paragraphText,
        edits: [],
      };
      groups.set(key, group);
    }
    const start = Math.max(0, Math.min(group.text.length, match.start));
    const end = Math.max(start, Math.min(group.text.length, match.end));
    group.edits.push({ start, end });
  }
  return [...groups.values()].map(({ pageIndex, paragraphId, text, edits }) => {
    // Right-to-left: every edit's offsets were measured against the original
    // paragraph text, so applying from the end keeps them valid.
    let next = text;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
      next = `${next.slice(0, edit.start)}${replacement}${next.slice(edit.end)}`;
    }
    return { pageIndex, paragraphId, text: next, count: edits.length };
  });
}

export interface SearchSummary {
  matches: SearchMatch[];
  /** Pages searched (layouts present). */
  pagesSearched: number;
  /** Pages the caller asked for but could not supply. */
  pagesMissing: number;
}

/** Convenience for a UI that knows the intended page count. */
export function searchDocument(
  layouts: ReadonlyMap<number, PageLayout>,
  pageCount: number,
  query: string,
  options: SearchOptions = {},
): SearchSummary {
  const matches = findInLayouts(layouts, query, options);
  return {
    matches,
    pagesSearched: layouts.size,
    pagesMissing: Math.max(0, pageCount - layouts.size),
  };
}
