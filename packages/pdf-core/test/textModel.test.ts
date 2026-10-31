/**
 * Phase 1 text-model tests.
 *
 * Synthetic glyphs exercise the deterministic grouping rules (paragraphs,
 * headings, columns, lists, tables, rotation, page sizes) without depending on
 * a particular PDF producer. Real PDFs then prove the pdf.js extraction path
 * and the job boundary.
 */

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { PageGeometry } from '../src/document/geometry.js';
import {
  charAdvanceWeight,
  glyphsFromTextItems,
  normalizeFontFamily,
  type RawTextContent,
  type RawTextItem,
} from '../src/document/glyphs.js';
import { buildPageLayout, type LayoutBuildOptions } from '../src/document/group.js';
import { buildDocumentLayout } from '../src/document/document.js';
import { PageInteractionModel } from '../src/document/hitTest.js';
import { TextEditSession, wordRangeAt } from '../src/document/editing.js';
import { extractDocumentLayout, extractPageLayouts } from '../src/render/textLayout.js';
import { configurePdfjsRuntime } from '../src/render/pdfjsRuntime.js';
import { textRunsJob, type TextRunsInput } from '../src/jobs/textRuns.job.js';
import { testContext } from './fixtures.js';
import { encodePng } from './png.js';

configurePdfjsRuntime({
  workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
    .href,
});

interface TextSpec {
  text: string;
  x: number;
  y: number;
  size?: number;
  bold?: boolean;
  /** Display-space baseline rotation; only 90° is used here. */
  rotation?: 0 | 90;
}

function itemWidth(text: string, size: number): number {
  return Array.from(text).reduce((sum, char) => sum + charAdvanceWeight(char), 0) * size;
}

function makeContent(items: readonly TextSpec[], height: number): RawTextContent {
  const raw: RawTextItem[] = items.map((item) => {
    const size = item.size ?? 11;
    const width = itemWidth(item.text, size);
    if (item.rotation === 90) {
      // PDF baseline points down: display direction (0, 1), ascent points +x.
      return {
        str: item.text,
        transform: [0, -size, size, 0, item.x, height - item.y],
        width,
        height: size,
        fontName: item.bold ? 'F2' : 'F1',
      };
    }
    return {
      str: item.text,
      transform: [size, 0, 0, size, item.x, height - item.y - size * 0.82],
      width,
      height: size,
      fontName: item.bold ? 'F2' : 'F1',
    };
  });
  return {
    items: raw,
    styles: {
      F1: { fontFamily: 'Helvetica', fontWeight: 'normal' },
      F2: { fontFamily: 'Helvetica', fontWeight: 'bold' },
    },
  };
}

function syntheticPage(options: {
  items: readonly TextSpec[];
  width?: number;
  height?: number;
  rotation?: 0 | 90 | 180 | 270;
  pageIndex?: number;
  layout?: LayoutBuildOptions;
}) {
  const width = options.width ?? 612;
  const height = options.height ?? 792;
  const mediaBox = { x: 0, y: 0, width, height };
  const geometry = new PageGeometry({
    mediaBox,
    cropBox: mediaBox,
    rotation: options.rotation ?? 0,
  });
  const content = makeContent(options.items, height);
  const extracted = glyphsFromTextItems(content, {
    pageIndex: options.pageIndex ?? 0,
    geometry,
  });
  return buildPageLayout({
    pageIndex: options.pageIndex ?? 0,
    geometry,
    mediaBox,
    cropBox: mediaBox,
    rotation: options.rotation ?? 0,
    glyphs: extracted.glyphs,
    ...(options.layout ? { options: options.layout } : {}),
  });
}

const LONG_LEFT = 'Left column alpha bravo charlie delta';
const LONG_RIGHT = 'Right column echo foxtrot golf hotel';

function makeColumns() {
  const items: TextSpec[] = [];
  for (let line = 0; line < 20; line += 1) {
    items.push({ text: LONG_LEFT, x: 36, y: 80 + line * 12, size: 11 });
    items.push({ text: LONG_RIGHT, x: 330, y: 80 + line * 12, size: 11 });
  }
  return syntheticPage({ items });
}

function makeTable() {
  const rows = [
    ['Name', 'Qty', 'Price'],
    ['Widget', '12', '4.50'],
    ['Gadget', '3', '19.00'],
  ];
  const items: TextSpec[] = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((text, columnIndex) => {
      items.push({ text, x: 60 + columnIndex * 190, y: 100 + rowIndex * 24, size: 10 });
    });
  });
  return syntheticPage({ items });
}

describe('structured page model', () => {
  it('groups multi-line body text into a paragraph and splits at paragraph spacing', () => {
    const page = syntheticPage({
      items: [
        { text: 'Body paragraph line one with several words', x: 72, y: 100 },
        { text: 'Body paragraph line one with several words', x: 72, y: 112 },
        { text: 'Body paragraph line one with several words', x: 72, y: 124 },
        { text: 'Second paragraph starts after a larger gap', x: 72, y: 160 },
      ],
    });
    const bodyParagraphs = page.paragraphs.filter((paragraph) => paragraph.role === 'body');
    expect(bodyParagraphs).toHaveLength(2);
    expect(bodyParagraphs[0]!.text).toContain('line one');
    expect(bodyParagraphs[0]!.text).toContain('line one with several words Body paragraph');
    expect(bodyParagraphs[0]!.lineSpans).toHaveLength(3);
    expect(bodyParagraphs[1]!.text).toBe('Second paragraph starts after a larger gap');
    expect(page.stats.lineCount).toBe(4);
  });

  it('detects headings by relative size and keeps them out of body paragraphs', () => {
    const page = syntheticPage({
      items: [
        { text: 'Annual Report', x: 72, y: 50, size: 24, bold: true },
        { text: 'Body text follows the heading after a gap', x: 72, y: 110 },
        { text: 'Body text follows the heading after a gap', x: 72, y: 122 },
      ],
    });
    const heading = page.paragraphs.find((paragraph) => paragraph.role === 'heading');
    expect(heading).toBeDefined();
    expect(heading!.text).toBe('Annual Report');
    expect(heading!.headingLevel).toBe(1);
    const body = page.paragraphs.find((paragraph) => paragraph.role === 'body');
    expect(body?.text).not.toContain('Annual Report');
    expect(page.blocks.some((block) => block.kind === 'heading')).toBe(true);
  });

  it('detects two columns and reads the left column before the right one', () => {
    const page = makeColumns();
    expect(page.stats.columnCount).toBe(2);
    expect(page.columns).toHaveLength(2);
    expect(page.columns[0]!.x1).toBeLessThan(page.columns[1]!.x0);
    const first = page.paragraphs.find((paragraph) => paragraph.id === page.readingOrder[0]);
    expect(first?.text).toContain('Left column');
    const leftParagraph = page.paragraphs.find((paragraph) => paragraph.text.includes('Left column'));
    const rightParagraph = page.paragraphs.find((paragraph) => paragraph.text.includes('Right column'));
    expect(leftParagraph).toBeDefined();
    expect(rightParagraph).toBeDefined();
    expect(leftParagraph!.lineIds.length).toBeGreaterThan(10);
    expect(rightParagraph!.lineIds.length).toBeGreaterThan(10);
    expect(page.regions.some((region) => region.kind === 'column')).toBe(true);
  });

  it('recognises bullet lists, nesting and continuation lines', () => {
    const page = syntheticPage({
      items: [
        { text: '• First item', x: 72, y: 100 },
        { text: 'continued detail for the first item', x: 90, y: 114 },
        { text: '• Second item', x: 72, y: 140 },
        { text: '– Nested item', x: 100, y: 160 },
      ],
    });
    const listItems = page.paragraphs.filter((paragraph) => paragraph.role === 'list-item');
    expect(listItems).toHaveLength(3);
    expect(listItems[0]!.text).toBe('First item continued detail for the first item');
    expect(listItems[0]!.list?.marker).toBe('•');
    expect(listItems[0]!.list?.level).toBe(1);
    expect(listItems[2]!.text).toBe('Nested item');
    expect(listItems[2]!.list?.level).toBe(2);
    expect(page.blocks.some((block) => block.kind === 'list')).toBe(true);
  });

  it('detects a table and builds its row/column grid', () => {
    const page = makeTable();
    expect(page.tables).toHaveLength(1);
    const table = page.tables[0]!;
    expect(table.rowCount).toBe(3);
    expect(table.columnCount).toBe(3);
    expect(table.rows[0]!.cells.map((cell) => cell.text)).toEqual(['Name', 'Qty', 'Price']);
    expect(table.rows[1]!.cells.map((cell) => cell.text)).toEqual(['Widget', '12', '4.50']);
    const cells = page.paragraphs.filter((paragraph) => paragraph.role === 'table-cell');
    expect(cells).toHaveLength(9);
    expect(cells.every((paragraph) => paragraph.cell !== undefined)).toBe(true);
    expect(page.blocks.some((block) => block.kind === 'table')).toBe(true);
  });

  it('keeps rotated text in its own orientation group', () => {
    const page = syntheticPage({
      items: [
        { text: 'Horizontal body text', x: 72, y: 100 },
        { text: 'CONFIDENTIAL', x: 500, y: 100, size: 12, rotation: 90 },
      ],
    });
    const rotated = page.lines.find((line) => Math.abs(line.rotationDeg - 90) < 2);
    expect(rotated).toBeDefined();
    expect(rotated!.bbox.height).toBeGreaterThan(rotated!.bbox.width);
    expect(page.warnings.some((warning) => warning.includes('orientations'))).toBe(true);
    const horizontal = page.lines.find((line) => Math.abs(line.rotationDeg) < 2);
    expect(horizontal?.text).toBe('Horizontal body text');
  });

  it('projects selection along the display axis on a rotated page', () => {
    const page = syntheticPage({
      rotation: 90,
      items: [{ text: 'Rotated text', x: 72, y: 120, size: 12 }],
    });
    const paragraph = page.paragraphs.find((entry) => entry.text.includes('text'))!;
    const word = page.words.find((entry) => entry.text === 'text')!;
    expect(word.bbox.height).toBeGreaterThan(word.bbox.width);
    const model = new PageInteractionModel(page);
    // Offsets 10..12 are the second half of "text" in "Rotated text". On a
    // rotated page that half must be *below* the word's top, not to its right.
    const selection = model.selectionForParagraph(paragraph.id, 10, 12)!;
    const rect = selection.rects[0]!;
    expect(rect.y).toBeGreaterThan(word.bbox.y + word.bbox.height * 0.25);
    expect(rect.height).toBeLessThan(word.bbox.height * 0.75);
  });

  it('produces identical ids for repeated extraction of the same page', () => {
    const make = () =>
      syntheticPage({
        items: [
          { text: 'Stable identity paragraph one', x: 72, y: 100 },
          { text: 'Stable identity paragraph two', x: 72, y: 150 },
        ],
      });
    const first = make();
    const second = make();
    expect(second.paragraphs.map((paragraph) => paragraph.id)).toEqual(
      first.paragraphs.map((paragraph) => paragraph.id),
    );
    expect(second.blocks.map((block) => block.id)).toEqual(
      first.blocks.map((block) => block.id),
    );
    expect(second.lines.map((line) => line.id)).toEqual(first.lines.map((line) => line.id));
  });

  it('round-trips through JSON without losing structure', () => {
    const page = makeTable();
    const clone = JSON.parse(JSON.stringify(page)) as typeof page;
    expect(clone.tables).toHaveLength(page.tables.length);
    expect(clone.paragraphs.map((paragraph) => paragraph.id)).toEqual(
      page.paragraphs.map((paragraph) => paragraph.id),
    );
    expect(clone.blocks.map((block) => block.kind)).toEqual(
      page.blocks.map((block) => block.kind),
    );
  });

  it('keeps page geometry correct across page sizes and rotations', () => {
    const letter = new PageGeometry({
      mediaBox: { x: 0, y: 0, width: 612, height: 792 },
      cropBox: { x: 0, y: 0, width: 612, height: 792 },
    });
    const a4 = new PageGeometry({
      mediaBox: { x: 0, y: 0, width: 595, height: 842 },
      cropBox: { x: 0, y: 0, width: 595, height: 842 },
    });
    expect(letter.size).toEqual({ width: 612, height: 792 });
    expect(a4.size).toEqual({ width: 595, height: 842 });

    const rotated = new PageGeometry({
      mediaBox: { x: 0, y: 0, width: 612, height: 792 },
      cropBox: { x: 0, y: 0, width: 612, height: 792 },
      rotation: 90,
    });
    expect(rotated.size).toEqual({ width: 792, height: 612 });
    expect(rotated.pdfToView({ x: 0, y: 792 })).toEqual({ x: 792, y: 0 });
    expect(rotated.viewToPdf({ x: 792, y: 0 })).toEqual({ x: 0, y: 792 });
  });

  it('maps between view points, screen pixels and device pixels at any zoom', () => {
    const geometry = new PageGeometry({
      mediaBox: { x: 0, y: 0, width: 612, height: 792 },
      cropBox: { x: 0, y: 0, width: 612, height: 792 },
    });
    const view = { zoom: 1.75, devicePixelRatio: 2 };
    const screen = geometry.viewToScreen({ x: 100, y: 200 }, view);
    expect(screen).toEqual({ x: 175, y: 350 });
    expect(geometry.screenToView(screen, view)).toEqual({ x: 100, y: 200 });
    expect(geometry.deviceSize(view)).toEqual({
      width: Math.round(612 * 1.75 * 2),
      height: Math.round(792 * 1.75 * 2),
    });
    expect(geometry.screenSize(view)).toEqual({ width: 612 * 1.75, height: 792 * 1.75 });
  });

  it('handles crop box offsets and non-zero origins', () => {
    const geometry = new PageGeometry({
      mediaBox: { x: 0, y: 0, width: 612, height: 792 },
      cropBox: { x: 36, y: 36, width: 540, height: 720 },
    });
    expect(geometry.size).toEqual({ width: 540, height: 720 });
    expect(geometry.pdfToView({ x: 36, y: 756 })).toEqual({ x: 0, y: 0 });
    expect(geometry.viewToPdf({ x: 0, y: 0 })).toEqual({ x: 36, y: 756 });
  });

  it('builds hit-test indexes and maps a click to a word and caret', () => {
    const page = syntheticPage({
      items: [
        { text: 'Click this word to edit it', x: 72, y: 100 },
        { text: 'A second line follows here', x: 72, y: 114 },
      ],
    });
    const model = new PageInteractionModel(page);
    const firstWord = page.words[0]!;
    const point = {
      x: firstWord.bbox.x + firstWord.bbox.width / 2,
      y: firstWord.bbox.y + firstWord.bbox.height / 2,
    };
    const targets = model.hitTest(point);
    expect(targets.word?.text).toBe(firstWord.text);
    expect(targets.line).toBeDefined();
    expect(targets.paragraph).toBeDefined();

    const caret = model.caretAt(point);
    expect(caret).not.toBeNull();
    expect(caret!.paragraphId).toBe(targets.paragraph!.id);
    expect(caret!.paragraphOffset).toBeGreaterThanOrEqual(0);
    expect(caret!.paragraphOffset).toBeLessThanOrEqual(targets.paragraph!.text.length);

    const wordSelection = model.selectWordAt(point);
    expect(wordSelection?.text).toBe(firstWord.text);
    expect(wordSelection!.rects.length).toBeGreaterThan(0);

    const paragraph = targets.paragraph!;
    const all = model.selectionForParagraph(paragraph.id, 0, paragraph.text.length);
    expect(all?.text).toBe(paragraph.text);
    expect(all!.rects.length).toBeGreaterThan(0);
    expect(model.caretRect(paragraph.id, 0)).not.toBeNull();
  });

  it('selects across paragraph boundaries in reading order', () => {
    const page = syntheticPage({
      items: [
        { text: 'First paragraph alpha beta', x: 72, y: 100 },
        { text: 'Second paragraph gamma delta', x: 72, y: 160 },
      ],
    });
    const model = new PageInteractionModel(page);
    const [first, second] = page.readingOrder.map((id) => model.paragraphByIdOrNull(id)!);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const selection = model.selectionBetween(
      { paragraphId: first!.id, offset: 6 },
      { paragraphId: second!.id, offset: 17 },
    );
    expect(selection.ranges).toHaveLength(2);
    expect(selection.text).toContain('paragraph alpha beta');
    expect(selection.text).toContain('Second paragraph');
    expect(selection.text).toContain('\n');
  });

  it('edits a paragraph with undo/redo and produces a serializable edit', () => {
    const page = syntheticPage({
      items: [{ text: 'Paragraph text', x: 72, y: 100 }],
    });
    const paragraph = page.paragraphs[0]!;
    const session = new TextEditSession(paragraph);
    expect(session.dirty).toBe(false);
    expect(session.toEdit()).toBeNull();

    session.moveCaret(paragraph.text.length);
    expect(session.insert('!')).toBe(true);
    expect(session.text).toBe('Paragraph text!');
    expect(session.dirty).toBe(true);
    expect(session.canUndo).toBe(true);

    session.deleteBackward();
    expect(session.text).toBe('Paragraph text');
    session.undo();
    expect(session.text).toBe('Paragraph text!');
    session.undo();
    expect(session.text).toBe('Paragraph text');
    session.redo();
    expect(session.text).toBe('Paragraph text!');

    const edit = session.toEdit();
    expect(edit).not.toBeNull();
    expect(edit!.before).toBe('Paragraph text');
    expect(edit!.after).toBe('Paragraph text!');
    expect(edit!.paragraphId).toBe(paragraph.id);
    expect(edit!.bbox).toEqual(paragraph.bbox);
    expect(wordRangeAt('alpha beta', 2)).toEqual({ start: 0, end: 5 });
  });

  it('reports repeated headers and footers across pages', () => {
    const pages = [0, 1, 2].map((pageIndex) =>
      syntheticPage({
        pageIndex,
        items: [
          { text: 'ACME Corporation', x: 36, y: 24, size: 9 },
          { text: `Body text for page ${pageIndex + 1}`, x: 72, y: 200 },
          { text: `Page ${pageIndex + 1} of 3`, x: 260, y: 760, size: 9 },
        ],
      }),
    );
    const document = buildDocumentLayout(pages);
    expect(document.pageCount).toBe(3);
    expect(document.stats.repeatedHeaderFooterCount).toBeGreaterThanOrEqual(2);
    expect(
      document.pages.every((page) =>
        page.paragraphs.some((paragraph) => paragraph.role === 'header'),
      ),
    ).toBe(true);
    expect(
      document.pages.every((page) =>
        page.paragraphs.some((paragraph) => paragraph.role === 'footer'),
      ),
    ).toBe(true);
    expect(document.id).toMatch(/^doc\./);
  });

  it('keeps a long page linear and structurally complete', () => {
    const items: TextSpec[] = [];
    for (let line = 0; line < 300; line += 1) {
      items.push({
        text: 'Long document line with a stable amount of text',
        x: 72,
        y: 50 + line * 13,
      });
    }
    const page = syntheticPage({ items, height: 4200 });
    expect(page.stats.lineCount).toBeGreaterThan(250);
    expect(page.paragraphs.length).toBeGreaterThan(0);
    expect(page.stats.buildMs).toBeLessThan(5000);
  });
});

describe('pdf.js layout extraction', () => {
  async function makeRealPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const image = await doc.embedPng(encodePng(40, 40, []));
    for (let index = 0; index < 2; index += 1) {
      const page = doc.addPage([612, 792]);
      page.drawText('ACME Corporation', { x: 36, y: 770, size: 9, font });
      page.drawText('Quarterly Report', { x: 72, y: 700, size: 24, font: bold });
      page.drawText('Body paragraph line one with enough words', {
        x: 72,
        y: 660,
        size: 11,
        font,
      });
      page.drawText('Body paragraph line two with enough words', {
        x: 72,
        y: 648,
        size: 11,
        font,
      });
      page.drawText('Body paragraph line three with enough words', {
        x: 72,
        y: 636,
        size: 11,
        font,
      });
      page.drawText('Second paragraph starts lower on the page', {
        x: 72,
        y: 600,
        size: 11,
        font,
      });
      if (index === 0) page.drawImage(image, { x: 420, y: 520, width: 80, height: 80 });
      page.drawText(`Page ${index + 1} of 2`, { x: 270, y: 30, size: 9, font });
    }
    return doc.save();
  }

  it('extracts paragraphs, headings, headers and footers from a real PDF', async () => {
    const data = await makeRealPdf();
    const document = await extractDocumentLayout(data, { ctx: testContext() });
    expect(document.pageCount).toBe(2);
    expect(document.stats.headingCount).toBeGreaterThanOrEqual(2);
    expect(document.stats.repeatedHeaderFooterCount).toBeGreaterThanOrEqual(2);
    expect(document.pages[0]!.widthPt).toBeCloseTo(612, 0);
    expect(document.pages[0]!.heightPt).toBeCloseTo(792, 0);
    const text = document.pages[0]!.paragraphs.map((paragraph) => paragraph.text).join(' ');
    expect(text).toContain('Quarterly Report');
    expect(text).toContain('Body paragraph line one');
    expect(document.pages[0]!.paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(document.pages[0]!.regions.some((region) => region.kind === 'header')).toBe(true);
  });

  it('extracts a requested page only and preserves page indexing', async () => {
    const data = await makeRealPdf();
    const pages = await extractPageLayouts(data, { pageIndexes: [1] });
    expect(pages).toHaveLength(1);
    expect(pages[0]!.index).toBe(1);
    expect(pages[0]!.paragraphs.some((paragraph) => paragraph.text.includes('Page 2 of 2'))).toBe(
      true,
    );
  });

  it('returns runs and layouts from one text-runs job invocation', async () => {
    const data = await makeRealPdf();
    const input: TextRunsInput = {
      files: [{ name: 'report.pdf', data }],
      options: { includeLayout: true, pageIndexes: [0] },
    };
    const result = await textRunsJob.run(input, testContext());
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]!.length).toBeGreaterThan(0);
    expect(result.layouts).toHaveLength(1);
    expect(result.layouts![0]!.paragraphs.length).toBeGreaterThan(0);

    const legacy = await textRunsJob.run(
      { files: [{ name: 'report.pdf', data }], options: { pageIndexes: [0] } },
      testContext(),
    );
    expect(legacy.runs).toHaveLength(1);
    expect(legacy.layouts).toBeUndefined();
    expect(legacy.runs[0]!.map((run) => run.text)).toEqual(
      result.runs[0]!.map((run) => run.text),
    );
  });
});

describe('font family normalisation', () => {
  it('does not mistake generic sans-serif for a serif face', () => {
    expect(normalizeFontFamily('sans-serif').family).toBe('helvetica');
    expect(normalizeFontFamily('serif').family).toBe('times');
    expect(normalizeFontFamily('Helvetica').family).toBe('helvetica');
    expect(normalizeFontFamily('Times-Roman').family).toBe('times');
    expect(normalizeFontFamily('monospace').family).toBe('courier');
    expect(normalizeFontFamily('DejaVu Sans Mono').family).toBe('courier');
  });
});
