/**
 * Cross-page assembly.
 *
 * Page-local extraction cannot tell a running header from a one-off title, and
 * it cannot know that "Page 3 of 12" on the bottom of every page is furniture.
 * This module looks at the whole document, promotes repeated margin text to
 * `header` / `footer`, and rolls page statistics up into the document stats.
 */

import { unionBBoxes } from './geometry.js';
import { hashString } from './ids.js';
import type {
  CrossPageContinuation,
  DocumentLayout,
  DocumentStats,
  PageLayout,
  Paragraph,
  Region,
  TextBlock,
} from './types.js';

const PAGE_NUMBER = /^\s*(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?\s*$/i;

export function normalizeFurnitureText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\d+/g, '#')
    .trim()
    .toLowerCase();
}

interface FurnitureEvidence {
  key: string;
  band: 'header' | 'footer';
  pages: Set<number>;
  paragraphIds: Map<number, Set<string>>;
}

function bandForParagraph(paragraph: Paragraph, page: PageLayout): 'header' | 'footer' | null {
  const center = paragraph.bbox.y + paragraph.bbox.height / 2;
  if (center < page.heightPt * 0.12) return 'header';
  if (center > page.heightPt * 0.88) return 'footer';
  return null;
}

/**
 * Finds text that repeats in the top or bottom band of enough pages to be page
 * furniture. Digits are normalised so numbered footers match across pages.
 */
export function findRepeatedFurniture(pages: readonly PageLayout[]): {
  headers: Map<number, Set<string>>;
  footers: Map<number, Set<string>>;
  keys: Set<string>;
} {
  const headers = new Map<number, Set<string>>();
  const footers = new Map<number, Set<string>>();
  const keys = new Set<string>();
  if (pages.length < 2) return { headers, footers, keys };

  const evidence = new Map<string, FurnitureEvidence>();
  for (const page of pages) {
    for (const paragraph of page.paragraphs) {
      if (paragraph.role === 'table-cell') continue;
      if (paragraph.text.length > 200) continue;
      // A title can sit in the top band without being a running header. Page
      // furniture is smaller than the body text, so size is the tie-breaker.
      if (paragraph.typography.fontSize > page.stats.medianFontSize * 1.25) continue;
      const band =
        paragraph.role === 'header'
          ? 'header'
          : paragraph.role === 'footer'
            ? 'footer'
            : bandForParagraph(paragraph, page);
      if (!band) continue;
      const pageNumber = PAGE_NUMBER.test(paragraph.text);
      if (!pageNumber && paragraph.text.trim().length < 3) continue;
      const key = `${band}|${normalizeFurnitureText(paragraph.text)}`;
      let entry = evidence.get(key);
      if (!entry) {
        entry = { key, band, pages: new Set(), paragraphIds: new Map() };
        evidence.set(key, entry);
      }
      entry.pages.add(page.index);
      const ids = entry.paragraphIds.get(page.index) ?? new Set<string>();
      ids.add(paragraph.id);
      entry.paragraphIds.set(page.index, ids);
    }
  }

  const threshold = pages.length <= 2 ? 2 : Math.max(2, Math.ceil(pages.length * 0.35));
  for (const entry of evidence.values()) {
    if (entry.pages.size < threshold) continue;
    keys.add(entry.key);
    for (const [pageIndex, ids] of entry.paragraphIds) {
      const target = entry.band === 'header' ? headers : footers;
      const set = target.get(pageIndex) ?? new Set<string>();
      for (const id of ids) set.add(id);
      target.set(pageIndex, set);
    }
  }
  return { headers, footers, keys };
}

function rebuildRegions(page: PageLayout): Region[] {
  const headerBlocks = page.blocks.filter((block) => block.kind === 'header');
  const footerBlocks = page.blocks.filter((block) => block.kind === 'footer');
  const headerIds = new Set(headerBlocks.map((block) => block.id));
  const footerIds = new Set(footerBlocks.map((block) => block.id));
  const regions: Region[] = [];

  for (const region of page.regions) {
    if (region.kind === 'header') continue;
    if (region.kind === 'footer') continue;
    const blockIds = region.blockIds.filter(
      (id) => !headerIds.has(id) && !footerIds.has(id),
    );
    if (blockIds.length === 0) continue;
    const blocks = page.blocks.filter((block) => blockIds.includes(block.id));
    regions.push({
      ...region,
      blockIds,
      bbox: unionBBoxes(blocks.map((block) => block.bbox)),
      pdfBox: unionBBoxes(blocks.map((block) => block.pdfBox)),
    });
  }

  const makeFurnitureRegion = (
    kind: 'header' | 'footer',
    blocks: readonly TextBlock[],
  ): void => {
    if (blocks.length === 0) return;
    regions.push({
      id: `p${page.index}.region.${kind}`,
      pageIndex: page.index,
      blockIds: blocks.map((block) => block.id),
      bbox: unionBBoxes(blocks.map((block) => block.bbox)),
      pdfBox: unionBBoxes(blocks.map((block) => block.pdfBox)),
      kind,
      confidence: blocks.reduce((sum, block) => sum + block.confidence, 0) / blocks.length,
    });
  };
  makeFurnitureRegion('header', headerBlocks);
  makeFurnitureRegion('footer', footerBlocks);

  if (regions.length === 0) {
    regions.push({
      id: `p${page.index}.region.empty`,
      pageIndex: page.index,
      blockIds: [],
      bbox: { x: 0, y: 0, width: page.widthPt, height: page.heightPt },
      pdfBox: { x: 0, y: 0, width: page.widthPt, height: page.heightPt },
      kind: 'content',
      confidence: 0,
    });
  }
  return regions;
}

function reorderPage(page: PageLayout): void {
  const blocksById = new Map(page.blocks.map((block) => [block.id, block]));
  const ordered = page.blockOrder
    .map((id) => blocksById.get(id))
    .filter((block): block is TextBlock => Boolean(block));
  for (const block of page.blocks) {
    if (!ordered.includes(block)) ordered.push(block);
  }
  const headers = ordered.filter((block) => block.kind === 'header');
  const footers = ordered.filter((block) => block.kind === 'footer');
  const body = ordered.filter(
    (block) => block.kind !== 'header' && block.kind !== 'footer',
  );
  const finalOrder = [...headers, ...body, ...footers];
  page.blockOrder = finalOrder.map((block) => block.id);
  const seen = new Set<string>();
  const readingOrder: string[] = [];
  for (const block of finalOrder) {
    for (const id of block.paragraphIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      readingOrder.push(id);
    }
  }
  page.readingOrder = readingOrder;
  page.regions = rebuildRegions(page);
}

/**
 * Finds paragraphs that clearly continue across a page break.
 *
 * The rule is deliberately one-sided: a page's last body paragraph must end
 * without terminal punctuation, and the next page's first body paragraph must
 * start with a lowercase letter or a continuation mark. That is strong evidence;
 * anything weaker is left unlinked. The pages themselves are untouched -- this
 * is an annotation, not a regrouping pass.
 */
export function findCrossPageContinuations(
  pages: readonly PageLayout[],
): CrossPageContinuation[] {
  const TERMINAL = /[.!?:;]["'”’)\]]?$/;
  const CONTINUATION_START = /^[,;:)\]}”’]|^[a-z]/;
  const continuations: CrossPageContinuation[] = [];

  const bodyInOrder = (page: PageLayout): Paragraph[] => {
    const byId = new Map(page.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
    return page.readingOrder
      .map((id) => byId.get(id))
      .filter((paragraph): paragraph is Paragraph => paragraph?.role === 'body');
  };

  for (let index = 0; index < pages.length - 1; index += 1) {
    const previousPage = pages[index]!;
    const nextPage = pages[index + 1]!;
    const previous = bodyInOrder(previousPage).at(-1);
    const next = bodyInOrder(nextPage)[0];
    if (!previous || !next) continue;

    const previousText = previous.text.trim();
    const nextText = next.text.trim();
    if (!previousText || !nextText) continue;
    if (TERMINAL.test(previousText)) continue;
    if (!CONTINUATION_START.test(nextText)) continue;

    const sameFamily = previous.typography.fontFamily === next.typography.fontFamily;
    const sizeRatio = next.typography.fontSize / Math.max(previous.typography.fontSize, 0.1);
    if (!sameFamily || sizeRatio < 0.9 || sizeRatio > 1.1) continue;

    const startsLowercase = /^[a-z]/.test(nextText);
    const confidence = startsLowercase ? 0.92 : 0.85;

    continuations.push({
      fromPageIndex: previousPage.index,
      fromParagraphId: previous.id,
      toPageIndex: nextPage.index,
      toParagraphId: next.id,
      confidence,
      reason: startsLowercase
        ? 'the previous page ends without terminal punctuation and this paragraph starts mid-sentence in lowercase'
        : 'the previous page ends without terminal punctuation and this paragraph starts with a continuation mark',
    });
  }

  return continuations;
}

function roleKind(role: Paragraph['role']): TextBlock['kind'] {
  switch (role) {
    case 'heading':
      return 'heading';
    case 'list-item':
      return 'list';
    case 'caption':
      return 'caption';
    case 'footnote':
      return 'footnote';
    case 'table-cell':
      return 'table';
    case 'header':
      return 'header';
    case 'footer':
      return 'footer';
    case 'body':
      return 'body';
    default:
      return 'unknown';
  }
}

/**
 * Applies cross-page furniture classification. Pages are freshly built, so
 * this mutates them in place; the resulting `DocumentLayout` is the immutable
 * snapshot callers persist.
 */
export function buildDocumentLayout(pages: readonly PageLayout[]): DocumentLayout {
  const repeated = findRepeatedFurniture(pages);

  for (const page of pages) {
    const headerIds = repeated.headers.get(page.index) ?? new Set<string>();
    const footerIds = repeated.footers.get(page.index) ?? new Set<string>();
    for (const paragraph of page.paragraphs) {
      if (headerIds.has(paragraph.id)) paragraph.role = 'header';
      else if (footerIds.has(paragraph.id)) paragraph.role = 'footer';
      else if (
        pages.length >= 2 &&
        (paragraph.role === 'header' || paragraph.role === 'footer') &&
        !PAGE_NUMBER.test(paragraph.text)
      ) {
        // Furniture is defined by repetition. A one-off line that happens to sit
        // in the margin band is body text that straddles a page break -- the
        // second page of a paragraph looks exactly like a running header to a
        // page-local rule, and calling it furniture hides real content.
        paragraph.role = 'body';
      }
    }
    for (const block of page.blocks) {
      const roles = block.paragraphIds
        .map((id) => page.paragraphs.find((paragraph) => paragraph.id === id)?.role)
        .filter((role): role is NonNullable<typeof role> => Boolean(role));
      if (roles.length > 0 && roles.every((role) => role === 'header')) block.kind = 'header';
      else if (roles.length > 0 && roles.every((role) => role === 'footer')) block.kind = 'footer';
      else if ((block.kind === 'header' || block.kind === 'footer') && roles[0]) {
        block.kind = roleKind(roles[0]);
      }
    }
    reorderPage(page);
  }

  const glyphCount = pages.reduce((sum, page) => sum + page.stats.glyphCount, 0);
  const weightedPageValue = (pick: (page: PageLayout) => number): number => {
    if (glyphCount === 0) return 0;
    return pages.reduce(
      (sum, page) => sum + pick(page) * page.stats.glyphCount,
      0,
    ) / glyphCount;
  };

  const warningSet = new Set<string>();
  for (const page of pages) {
    for (const warning of page.warnings) {
      warningSet.add(`Page ${page.index + 1}: ${warning}`);
    }
  }

  const stats: DocumentStats = {
    medianFontSize: weightedPageValue((page) => page.stats.medianFontSize),
    columnPages: pages.filter((page) => page.stats.columnCount > 1).length,
    tableCount: pages.reduce((sum, page) => sum + page.tables.length, 0),
    headingCount: pages.reduce(
      (sum, page) =>
        sum + page.paragraphs.filter((paragraph) => paragraph.role === 'heading').length,
      0,
    ),
    listCount: pages.reduce(
      (sum, page) =>
        sum + page.paragraphs.filter((paragraph) => paragraph.role === 'list-item').length,
      0,
    ),
    repeatedHeaderFooterCount: repeated.keys.size,
  };

  return {
    id: `doc.${hashString(pages.map((page) => page.id).join('|'))}`,
    pageCount: pages.length,
    pages: [...pages],
    stats,
    continuations: findCrossPageContinuations(pages),
    warnings: [...warningSet],
  };
}
