import { describe, expect, it } from 'vitest';
import { assessReflow, wrapText } from '../src/document/reflow.js';
import type { BBox, Line, PageLayout, Paragraph, TextTypography } from '../src/document/types.js';

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

const measure = (text: string): number => text.length * 6;

function box(x: number, y: number, width: number, height: number): BBox {
  return { x, y, width, height };
}

function makeLayout(): { layout: PageLayout; paragraph: Paragraph } {
  const lineBox = box(72, 100, 180, 10);
  const line: Line = {
    id: 'l1',
    pageIndex: 0,
    text: 'Original paragraph text',
    glyphIds: [],
    wordIds: [],
    bbox: lineBox,
    pdfBox: lineBox,
    baseline: 110,
    advanceStart: 72,
    advanceEnd: 252,
    rotationDeg: 0,
    direction: 'ltr',
    typography,
    alignment: 'left',
    indentPt: 0,
    rowId: '',
    cellIndex: 0,
    confidence: 1,
  };
  const paragraph: Paragraph = {
    id: 'p1',
    pageIndex: 0,
    lineIds: [line.id],
    text: line.text,
    lineSpans: [{ lineId: line.id, start: 0, end: line.text.length, separatorAfter: '' }],
    bbox: lineBox,
    pdfBox: lineBox,
    typography,
    alignment: 'left',
    indentPt: 0,
    role: 'body',
    confidence: 1,
    ambiguous: false,
  };
  return {
    paragraph,
    layout: {
      id: 'page-0',
      index: 0,
      widthPt: 612,
      heightPt: 792,
      rotation: 0,
      mediaBox: { x: 0, y: 0, width: 612, height: 792 },
      cropBox: { x: 0, y: 0, width: 612, height: 792 },
      geometry: { x0: 0, y0: 0, x1: 612, y1: 792, rot: 0 },
      glyphs: [],
      words: [],
      lines: [line],
      paragraphs: [paragraph],
      blocks: [],
      regions: [],
      tables: [],
      columns: [],
      readingOrder: [paragraph.id],
      blockOrder: [],
      stats: {
        medianFontSize: 10,
        medianLineGap: 12,
        lineHeight: 12,
        wordGap: 3,
        columnCount: 1,
        glyphCount: 0,
        wordCount: 0,
        lineCount: 1,
        paragraphCount: 1,
        blockCount: 0,
        textCoverage: 0.1,
        buildMs: 0,
      },
      confidence: 1,
      warnings: [],
    },
  };
}

describe('layout-aware reflow', () => {
  it('wraps on words and measures every line', () => {
    const result = wrapText(
      { text: 'one two three four five six seven', width: 30, fontSize: 10, lineHeightPt: 12 },
      measure,
    );
    expect(result.lines.map((line) => line.text)).toEqual(['one', 'two', 'three', 'four', 'five', 'six', 'seven']);
    expect(result.heightPt).toBe(84);
    expect(result.overflow).toBe(false);
  });

  it('honours explicit newlines and hard-breaks oversized words', () => {
    const result = wrapText(
      { text: 'abcdefghij\nok', width: 24, fontSize: 10, lineHeightPt: 12 },
      measure,
    );
    expect(result.lines.map((line) => line.text)).toEqual(['abcd', 'efgh', 'ij', 'ok']);
    expect(result.overflow).toBe(false);
  });

  it('reduces the first line by the requested indent', () => {
    const result = wrapText(
      { text: 'aaa bbb ccc', width: 36, fontSize: 10, firstLineIndentPt: 18 },
      measure,
    );
    expect(result.lines[0]!.text).toBe('aaa');
    expect(result.lines[1]!.text).toBe('bbb');
  });

  it('marks a paragraph safe when its expansion has free space', () => {
    const { layout, paragraph } = makeLayout();
    const assessment = assessReflow(
      paragraph,
      layout,
      { text: 'short text that wraps', width: 180, fontSize: 10, lineHeightPt: 12 },
      measure,
    );
    expect(assessment.safe).toBe(true);
    expect(assessment.collisions).toHaveLength(0);
  });

  it('flags a neighbouring object and insufficient vertical space', () => {
    const { layout, paragraph } = makeLayout();
    const assessment = assessReflow(
      paragraph,
      layout,
      { text: 'a much longer paragraph that needs several lines of room to fit', width: 180, fontSize: 10, lineHeightPt: 12 },
      measure,
      [{ id: 'image', kind: 'image', bbox: box(72, 100, 180, 20) }],
    );
    expect(assessment.safe).toBe(false);
    expect(assessment.collisions.map((item) => item.id)).toContain('image');
    expect(assessment.reasons.length).toBeGreaterThan(0);
  });

  it('reports overflow when a glyph cannot be measured', () => {
    const assessment = assessReflow(
      makeLayout().paragraph,
      makeLayout().layout,
      { text: 'unmeasurable', width: 180, fontSize: 10, lineHeightPt: 12 },
      () => Number.POSITIVE_INFINITY,
    );
    expect(assessment.result.overflow).toBe(true);
    expect(assessment.safe).toBe(false);
  });
});
