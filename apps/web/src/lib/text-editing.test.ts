import { describe, expect, it } from 'vitest';
import type {
  BBox,
  Line,
  PageLayout,
  Paragraph,
  Point,
  TextTypography,
  Word,
} from '@pdfshush/pdf-core';
import { PageInteractionModel } from '@pdfshush/pdf-core';
import {
  bodySelectionToDisplay,
  buildParagraphEditObjects,
  cssFontStack,
  mutateParagraphText,
  paragraphDisplayPrefix,
  paragraphDisplayText,
  paragraphLineHeightRatio,
  paragraphSelectionState,
  resolveClickCount,
  resolvedFontFamily,
  selectionFromAnchors,
  wordSelectionAt,
} from './text-editing';

const typography: TextTypography = {
  fontName: 'f1',
  fontFamily: 'helvetica',
  fontFamilyLabel: 'Helvetica',
  fontSize: 10,
  fontWeight: 400,
  bold: false,
  italic: false,
  direction: 'ltr',
  rotationDeg: 0,
};

function box(x: number, y: number, width: number, height: number): BBox {
  return { x, y, width, height };
}

function word(id: string, text: string, bbox: BBox): Word {
  return {
    id,
    pageIndex: 0,
    text,
    glyphIds: [],
    bbox,
    pdfBox: bbox,
    baselineStart: { x: bbox.x, y: bbox.y + bbox.height },
    baselineEnd: { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
    rotationDeg: 0,
    direction: 'ltr',
    typography,
    confidence: 1,
  };
}

function line(id: string, text: string, bbox: BBox, wordIds: string[]): Line {
  return {
    id,
    pageIndex: 0,
    text,
    glyphIds: [],
    wordIds,
    bbox,
    pdfBox: bbox,
    baseline: bbox.y + bbox.height,
    advanceStart: bbox.x,
    advanceEnd: bbox.x + bbox.width,
    rotationDeg: 0,
    direction: 'ltr',
    typography,
    alignment: 'left',
    indentPt: 0,
    rowId: '',
    cellIndex: 0,
    confidence: 1,
  };
}

function paragraph(
  id: string,
  lines: Line[],
  text: string,
  options: Partial<Paragraph> = {},
): Paragraph {
  const bbox = lines.reduce<BBox>(
    (union, current) => {
      const x = Math.min(union.x, current.bbox.x);
      const y = Math.min(union.y, current.bbox.y);
      const right = Math.max(union.x + union.width, current.bbox.x + current.bbox.width);
      const bottom = Math.max(union.y + union.height, current.bbox.y + current.bbox.height);
      return { x, y, width: right - x, height: bottom - y };
    },
    { ...lines[0]!.bbox },
  );
  let cursor = 0;
  const lineSpans = lines.map((entry) => {
    const start = cursor;
    cursor += entry.text.length;
    return { lineId: entry.id, start, end: cursor, separatorAfter: '' };
  });
  return {
    id,
    pageIndex: 0,
    lineIds: lines.map((entry) => entry.id),
    text,
    lineSpans,
    bbox,
    pdfBox: bbox,
    typography,
    alignment: 'left',
    indentPt: 0,
    role: 'body',
    confidence: 1,
    ambiguous: false,
    ...options,
  };
}

function pageWith(...paragraphs: Paragraph[]): PageLayout {
  const words = paragraphs.flatMap((entry) =>
    entry.lineIds.flatMap((lineId) => {
      const line = linesById.get(lineId)!;
      return line.wordIds.map((wordId) => wordsById.get(wordId)!);
    }),
  );
  const lines = paragraphs.flatMap((entry) =>
    entry.lineIds.map((lineId) => linesById.get(lineId)!),
  );
  return {
    id: 'page-0',
    index: 0,
    widthPt: 612,
    heightPt: 792,
    rotation: 0,
    mediaBox: { x: 0, y: 0, width: 612, height: 792 },
    cropBox: { x: 0, y: 0, width: 612, height: 792 },
    geometry: { x0: 0, y0: 0, x1: 612, y1: 792, rot: 0 },
    glyphs: [],
    words,
    lines,
    paragraphs,
    blocks: [],
    regions: [],
    tables: [],
    columns: [],
    readingOrder: paragraphs.map((entry) => entry.id),
    blockOrder: [],
    stats: {
      medianFontSize: 10,
      medianLineGap: 12,
      lineHeight: 12,
      wordGap: 3,
      columnCount: 1,
      glyphCount: 0,
      wordCount: words.length,
      lineCount: lines.length,
      paragraphCount: paragraphs.length,
      blockCount: 0,
      textCoverage: 0.1,
      buildMs: 0,
    },
    confidence: 1,
    warnings: [],
  };
}

const wordsById = new Map<string, Word>();
const linesById = new Map<string, Line>();

function registerWord(value: Word): Word {
  wordsById.set(value.id, value);
  return value;
}

function registerLine(value: Line): Line {
  linesById.set(value.id, value);
  return value;
}

function twoLineParagraph(): { page: PageLayout; paragraph: Paragraph } {
  const w1 = registerWord(word('w1', 'Hello', box(72, 100, 28, 10)));
  const w2 = registerWord(word('w2', 'world', box(102, 100, 28, 10)));
  const w3 = registerWord(word('w3', 'again', box(72, 112, 28, 10)));
  const l1 = registerLine(line('l1', 'Hello world', box(72, 100, 58, 10), [w1.id, w2.id]));
  const l2 = registerLine(line('l2', 'again', box(72, 112, 28, 10), [w3.id]));
  const p = paragraph('p1', [l1, l2], 'Hello world again');
  return { page: pageWith(p), paragraph: p };
}

describe('text typography mapping', () => {
  it('maps standard families to the editor and exporter stacks', () => {
    expect(resolvedFontFamily(typography)).toBe('helvetica');
    expect(cssFontStack(typography)).toContain('Arial');
    expect(
      resolvedFontFamily({ fontFamily: 'other', fontFamilyLabel: 'Times New Roman' }),
    ).toBe('times');
    expect(
      resolvedFontFamily({ fontFamily: 'other', fontFamilyLabel: 'Courier New' }),
    ).toBe('courier');
  });

  it('derives line height from extracted baselines', () => {
    const { page, paragraph: entry } = twoLineParagraph();
    expect(paragraphLineHeightRatio(entry, page)).toBeCloseTo(1.2, 5);
  });
});

describe('paragraph display text', () => {
  it('keeps a list marker visible while editing', () => {
    const w = registerWord(word('w4', 'Item', box(84, 100, 20, 10)));
    const l = registerLine(line('l3', '• Item', box(72, 100, 32, 10), [w.id]));
    const p = paragraph('p2', [l], 'Item', {
      role: 'list-item',
      list: { ordered: false, level: 1, marker: '•', body: 'Item', indentPt: 12 },
    });
    expect(paragraphDisplayText(p)).toBe('• Item');
    expect(paragraphDisplayPrefix(p)).toBe(2);
    expect(bodySelectionToDisplay(p, { start: 0, end: 2 })).toEqual({ start: 2, end: 4 });
  });
});

describe('click counting', () => {
  it('resolves single, double and triple clicks and resets away from the target', () => {
    const first = resolveClickCount(null, { time: 0, x: 10, y: 10, key: 'p1' });
    expect(first.count).toBe(1);
    const second = resolveClickCount(first, { time: 100, x: 11, y: 10, key: 'p1' });
    expect(second.count).toBe(2);
    const third = resolveClickCount(second, { time: 200, x: 10, y: 11, key: 'p1' });
    expect(third.count).toBe(3);
    const fourth = resolveClickCount(third, { time: 250, x: 10, y: 10, key: 'p1' });
    expect(fourth.count).toBe(3);
    const other = resolveClickCount(fourth, { time: 300, x: 10, y: 10, key: 'p2' });
    expect(other.count).toBe(1);
    const slow = resolveClickCount(other, { time: 1200, x: 10, y: 10, key: 'p2' });
    expect(slow.count).toBe(1);
  });
});

describe('selection mapping', () => {
  it('selects a word and a paragraph from the structured model', () => {
    const { page } = twoLineParagraph();
    const model = new PageInteractionModel(page);
    const point: Point = { x: 118, y: 105 };
    const wordHit = wordSelectionAt(model, 0, point);
    expect(wordHit?.range).toEqual({ start: 6, end: 11 });
    expect(wordHit?.selection?.text).toBe('world');

    const paragraphSelection = paragraphSelectionState(model, 0, 'p1');
    expect(paragraphSelection?.text).toBe('Hello world again');
  });

  it('builds a cross-line selection between two carets', () => {
    const { page } = twoLineParagraph();
    const model = new PageInteractionModel(page);
    const selection = selectionFromAnchors(
      model,
      0,
      { paragraphId: 'p1', offset: 6 },
      { paragraphId: 'p1', offset: 17 },
    );
    expect(selection?.text).toBe('world again');
    expect(selection?.ranges[0]?.rects.length).toBeGreaterThan(0);
  });
});

describe('paragraph edit objects', () => {
  it('covers each extracted line and replaces it with one text object', () => {
    const { page, paragraph: entry } = twoLineParagraph();
    let next = 0;
    const built = buildParagraphEditObjects(entry, page, 'Hello brave new world', {
      makeId: () => `o${++next}`,
    });
    expect(built.whiteouts).toHaveLength(2);
    expect(built.whiteouts.every((object) => object.kind === 'whiteout')).toBe(true);
    expect(built.textObject?.kind).toBe('text');
    expect(built.textObject?.text).toBe('Hello brave new world');
    expect(built.textObject?.fontFamily).toBe('helvetica');
    expect(built.textObject?.fontSize).toBe(10);
    expect(built.textObject?.x).toBe(entry.bbox.x);
  });

  it('keeps only the covers when the paragraph is cleared', () => {
    const { page, paragraph: entry } = twoLineParagraph();
    let next = 0;
    const built = buildParagraphEditObjects(entry, page, '', { makeId: () => `o${++next}` });
    expect(built.textObject).toBeNull();
    expect(built.whiteouts).toHaveLength(2);
  });
});

describe('text mutations', () => {
  it('replaces the first selected range and deletes the rest', () => {
    const w1 = registerWord(word('w5', 'Alpha', box(72, 200, 25, 10)));
    const l1 = registerLine(line('l4', 'Alpha', box(72, 200, 25, 10), [w1.id]));
    const p1 = paragraph('p3', [l1], 'Alpha');
    const w2 = registerWord(word('w6', 'Beta', box(72, 300, 20, 10)));
    const l2 = registerLine(line('l5', 'Beta', box(72, 300, 20, 10), [w2.id]));
    const p2 = paragraph('p4', [l2], 'Beta');
    const paragraphs = new Map([
      [p1.id, p1],
      [p2.id, p2],
    ]);
    const mutations = mutateParagraphText(
      [
        {
          paragraphId: p1.id,
          start: 0,
          end: 5,
          text: 'Alpha',
          rects: [l1.bbox],
        },
        {
          paragraphId: p2.id,
          start: 0,
          end: 4,
          text: 'Beta',
          rects: [l2.bbox],
        },
      ],
      paragraphs,
      'X',
    );
    expect(mutations).toEqual([
      { pageIndex: 0, paragraphId: 'p3', text: 'X' },
      { pageIndex: 0, paragraphId: 'p4', text: '' },
    ]);
  });

  it('shifts body offsets past a list marker', () => {
    const w = registerWord(word('w7', 'Item', box(84, 100, 20, 10)));
    const l = registerLine(line('l6', '• Item', box(72, 100, 32, 10), [w.id]));
    const p = paragraph('p5', [l], 'Item', {
      list: { ordered: false, level: 1, marker: '•', body: 'Item', indentPt: 12 },
    });
    const mutations = mutateParagraphText(
      [{ paragraphId: p.id, start: 0, end: 2, text: 'It', rects: [l.bbox] }],
      new Map([[p.id, p]]),
      'XX',
    );
    expect(mutations[0]?.text).toBe('• XXem');
  });
});
