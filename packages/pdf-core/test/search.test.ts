import { describe, expect, it } from 'vitest';
import {
  findInLayouts,
  foldText,
  isWordCharacter,
  matchedLineIds,
  replaceMatches,
  searchDocument,
  searchSnippet,
} from '../src/document/search.js';
import type { BBox, PageLayout, Paragraph, TextTypography } from '../src/document/types.js';

const typography: TextTypography = {
  fontName: 'f1',
  fontFamily: 'helvetica',
  fontFamilyLabel: 'Helvetica',
  fontSize: 11,
  fontWeight: 400,
  bold: false,
  italic: false,
  direction: 'ltr',
  rotationDeg: 0,
};

function box(x: number, y: number, width: number, height: number): BBox {
  return { x, y, width, height };
}

function paragraph(
  id: string,
  text: string,
  pageIndex = 0,
  spans?: { lineId: string; start: number; end: number }[],
): Paragraph {
  return {
    id,
    pageIndex,
    lineIds: spans?.map((span) => span.lineId) ?? [`${id}-line`],
    text,
    lineSpans: (spans ?? [{ lineId: `${id}-line`, start: 0, end: text.length }]).map((span) => ({
      ...span,
      separatorAfter: '',
    })),
    bbox: box(72, 100, 300, 14),
    pdfBox: box(72, 700, 300, 14),
    typography,
    alignment: 'left',
    indentPt: 0,
    role: 'body',
    confidence: 1,
    ambiguous: false,
  };
}

function layout(index: number, paragraphs: Paragraph[]): PageLayout {
  return {
    id: `page-${index}`,
    index,
    widthPt: 612,
    heightPt: 792,
    rotation: 0,
    mediaBox: box(0, 0, 612, 792),
    cropBox: box(0, 0, 612, 792),
    geometry: { x0: 0, y0: 0, x1: 612, y1: 792, rot: 0 },
    glyphs: [],
    words: [],
    lines: [],
    paragraphs,
    blocks: [],
    regions: [],
    tables: [],
    columns: [],
    readingOrder: paragraphs.map((item) => item.id),
    blockOrder: [],
    stats: {
      medianFontSize: 11,
      medianLineGap: 13,
      lineHeight: 13,
      wordGap: 3,
      columnCount: 1,
      glyphCount: 0,
      wordCount: 0,
      lineCount: 0,
      paragraphCount: paragraphs.length,
      blockCount: 0,
      textCoverage: 0,
      buildMs: 0,
    },
    confidence: 1,
    warnings: [],
  };
}

describe('find & replace: folding', () => {
  it('lowercases one code point at a time and preserves offsets', () => {
    expect(foldText('Hello WORLD')).toBe('hello world');
    // A Turkish dotted capital I lowercases to two code points; keeping it
    // verbatim is the documented limit that keeps offsets exact.
    const text = 'İstanbul';
    expect(foldText(text)).toHaveLength(text.length);
  });

  it('knows word characters for whole-word matching', () => {
    expect(isWordCharacter('a')).toBe(true);
    expect(isWordCharacter('9')).toBe(true);
    expect(isWordCharacter('_')).toBe(true);
    expect(isWordCharacter('-')).toBe(false);
    expect(isWordCharacter(undefined)).toBe(false);
  });

  it('builds a bounded whitespace-collapsed snippet', () => {
    const text = `prefix ${'x'.repeat(80)} needle ${'y'.repeat(80)} suffix`;
    const snippet = searchSnippet(text, text.indexOf('needle'), text.indexOf('needle') + 6);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('needle');
    expect(snippet).not.toContain('\n');
  });
});

describe('find & replace: matching', () => {
  const page = layout(0, [
    paragraph('p1', 'The cat sat on the mat.'),
    paragraph('p2', 'A CATEGORY of cats.'),
  ]);

  it('matches case-insensitively by default and reports exact offsets', () => {
    const matches = findInLayouts([page], 'cat');
    expect(matches.map((match) => match.text)).toEqual(['cat', 'CAT', 'cat']);
    expect(matches[0]).toMatchObject({ paragraphId: 'p1', start: 4, end: 7 });
    // Overlapping matches are not skipped: "cat" inside CATEGORY still counts.
    expect(matches[1]).toMatchObject({ paragraphId: 'p2', start: 2, end: 5 });
  });

  it('honours case sensitivity', () => {
    const matches = findInLayouts([page], 'cat', { caseSensitive: true });
    expect(matches).toHaveLength(2);
    expect(matches.every((match) => match.text === 'cat')).toBe(true);
  });

  it('honours whole-word matching', () => {
    const matches = findInLayouts([page], 'cat', { wholeWord: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ paragraphId: 'p1', start: 4, end: 7 });
  });

  it('searches pages in page order regardless of map insertion order', () => {
    const first = layout(0, [paragraph('a', 'needle here')]);
    const second = layout(1, [paragraph('b', 'needle there', 1)]);
    const matches = findInLayouts(new Map([[1, second], [0, first]]), 'needle');
    expect(matches.map((match) => match.pageIndex)).toEqual([0, 1]);
  });

  it('includes paragraphs missing from readingOrder instead of hiding them', () => {
    const broken = layout(0, [paragraph('a', 'visible needle')]);
    broken.readingOrder = [];
    const matches = findInLayouts([broken], 'needle');
    expect(matches).toHaveLength(1);
  });

  it('reports missing pages instead of claiming a complete search', () => {
    const summary = searchDocument(new Map([[0, page]]), 3, 'cat');
    expect(summary.pagesSearched).toBe(1);
    expect(summary.pagesMissing).toBe(2);
  });

  it('maps a match onto its paragraph lines', () => {
    const split = paragraph('p', 'first line second line', 0, [
      { lineId: 'l1', start: 0, end: 10 },
      { lineId: 'l2', start: 11, end: 22 },
    ]);
    expect(matchedLineIds(split, 2, 6)).toEqual(['l1']);
    expect(matchedLineIds(split, 8, 18)).toEqual(['l1', 'l2']);
    expect(matchedLineIds(split, 20, 22)).toEqual(['l2']);
  });
});

describe('find & replace: replacement', () => {
  const page = layout(0, [
    paragraph('p1', 'cat cat cat'),
    paragraph('p2', 'a cat and a dog'),
  ]);

  it('replaces every match right-to-left and counts per paragraph', () => {
    const matches = findInLayouts([page], 'cat');
    const replacements = replaceMatches(matches, 'lion');
    expect(replacements).toEqual([
      { pageIndex: 0, paragraphId: 'p1', text: 'lion lion lion', count: 3 },
      { pageIndex: 0, paragraphId: 'p2', text: 'a lion and a dog', count: 1 },
    ]);
  });

  it('keeps offsets valid when the replacement is longer', () => {
    const matches = findInLayouts([page], 'cat');
    const [first] = replaceMatches(matches, 'elephant');
    expect(first!.text).toBe('elephant elephant elephant');
  });

  it('does not loop when the replacement contains the query', () => {
    const matches = findInLayouts([page], 'cat');
    const [first] = replaceMatches(matches, 'cat-dog');
    expect(first!.text).toBe('cat-dog cat-dog cat-dog');
    expect(first!.count).toBe(3);
  });

  it('leaves the list marker outside the replaced body text', () => {
    const item = paragraph('li', 'Buy milk');
    item.list = {
      ordered: false,
      level: 1,
      marker: '•',
      body: 'Buy milk',
      indentPt: 0,
    };
    const matches = findInLayouts([layout(0, [item])], 'milk');
    const [replacement] = replaceMatches(matches, 'bread');
    expect(replacement!.text).toBe('Buy bread');
    expect(item.list.marker).toBe('•');
  });
});
