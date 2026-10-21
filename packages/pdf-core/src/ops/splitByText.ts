/**
 * Split by text -- page boundaries found by reading the document.
 *
 * The planner is pure: given each page's text, it returns the page spans that
 * start at a match. The job only supplies the extraction and the ZIP. Splitting
 * *before* the matching page is the useful behaviour for statements, invoices
 * and case files: the marker line belongs to the section it introduces.
 *
 * A match on page 1 does not create an empty first part; a repeated marker on
 * consecutive pages does not create an empty middle part.
 */

export interface PageSpan {
  /** Zero-based, inclusive. */
  start: number;
  /** Zero-based, inclusive. */
  end: number;
}

export interface SplitByTextPlan {
  ranges: PageSpan[];
  /** Zero-based indexes of every page that contained a match. */
  matchPages: number[];
}

export const SPLIT_BY_TEXT_LIMITS = {
  maxNeedleChars: 120,
  maxParts: 200,
} as const;

export function planSplitByText(
  pageTexts: string[],
  needle: string,
  caseSensitive = false,
): SplitByTextPlan {
  const target = needle.trim();
  if (target.length === 0) {
    throw new Error('Type the text that starts each new part');
  }
  if (target.length > SPLIT_BY_TEXT_LIMITS.maxNeedleChars) {
    throw new Error(`Keep the search text under ${SPLIT_BY_TEXT_LIMITS.maxNeedleChars} characters`);
  }
  if (pageTexts.length === 0) {
    throw new Error('This document has no pages');
  }

  const compare = caseSensitive ? target : target.toLocaleLowerCase();
  const matchPages: number[] = [];
  pageTexts.forEach((text, index) => {
    const haystack = caseSensitive ? text : text.toLocaleLowerCase();
    if (haystack.includes(compare)) matchPages.push(index);
  });

  if (matchPages.length === 0) {
    throw new Error(`No page contains "${target}"`);
  }

  const ranges: PageSpan[] = [];
  let start = 0;
  for (const page of matchPages) {
    // Page 1 is the implicit start; a match directly after a boundary would
    // otherwise produce an empty part.
    if (page > start) {
      ranges.push({ start, end: page - 1 });
      start = page;
    }
  }
  ranges.push({ start, end: pageTexts.length - 1 });

  if (ranges.length < 2) {
    throw new Error('That text only appears at the start, so there is nothing to split');
  }
  if (ranges.length > SPLIT_BY_TEXT_LIMITS.maxParts) {
    throw new Error(
      `That would create ${ranges.length} files (limit ${SPLIT_BY_TEXT_LIMITS.maxParts}). Use a more specific search text.`,
    );
  }

  return { ranges, matchPages };
}
