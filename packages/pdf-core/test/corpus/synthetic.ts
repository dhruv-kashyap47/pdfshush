/**
 * Synthetic corpus generator with exact ground truth.
 *
 * Every PDF here is drawn line by line with pdf-lib, so the ground truth is
 * not inferred from the model under test: we know exactly which drawn lines
 * form a paragraph, what role each one has, where the columns, tables, images
 * and page furniture are, and in which order a reader consumes them.
 *
 * Two seed pools exist on purpose:
 *
 *   - `DEV_CASES` is what the implementation was tuned against;
 *   - `HELD_OUT_CASES` uses the same generators with different seeds and
 *     parameter draws, and is only ever scored, never tuned on.
 *
 * Real-world PDFs are scored separately (see `real.ts`); this corpus exists to
 * give exact precision/recall numbers that a hand-annotated real corpus cannot
 * provide at scale.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import type { BBox } from '../../src/document/types.js';
import { encodePng } from '../png.js';

/* ------------------------------------------------------------------ truth */

export type GtFamily = 'helvetica' | 'times' | 'courier';

export type GtRole =
  | 'body'
  | 'heading'
  | 'list-item'
  | 'caption'
  | 'header'
  | 'footer'
  | 'footnote'
  | 'table-cell';

export interface GtLine {
  text: string;
  /** Display-space ink box (top-left origin), derived from the drawn geometry. */
  box: BBox;
  size: number;
  family: GtFamily;
  bold: boolean;
  italic: boolean;
  /** 0-based column index, -1 for content that spans the full measure. */
  column: number;
}

export interface GtParagraph {
  lineIndexes: number[];
  role: GtRole;
  headingLevel?: number;
  listLevel?: number;
  column: number;
  /** Concatenation of the drawn line texts, single-spaced. */
  text: string;
}

export interface GtTable {
  rows: string[][];
  box: BBox;
}

export interface GtImage {
  box: BBox;
}

export interface GtPage {
  width: number;
  height: number;
  lines: GtLine[];
  paragraphs: GtParagraph[];
  tables: GtTable[];
  images: GtImage[];
  columnCount: number;
  /**
   * Paragraph indexes in the order a reader consumes them. Defaults to the
   * order they were drawn, which is right for one-column pages; a multi-column
   * page has to say so explicitly (column-major, spanning blocks in place).
   */
  readingOrder?: number[];
}

export interface GtDocument {
  pages: GtPage[];
}

/** A pre-computed reflow probe: expand a paragraph and say what must happen. */
export interface ReflowScenario {
  pageIndex: number;
  /** Index into `GtPage.paragraphs`. */
  paragraph: number;
  /** How many extra lines the replacement is forced to occupy. */
  extraLines: number;
  expectCollision: boolean;
  /** Free text used by the benchmark report. */
  note: string;
}

export interface SyntheticCase {
  name: string;
  bytes: Uint8Array;
  truth: GtDocument;
  scenarios: ReflowScenario[];
}

/* ------------------------------------------------------------------- rng */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  'layout paragraph heading table column margin footnote caption reading order confidence region ' +
  'block glyph line document structure detection extraction geometry typography alignment spacing ' +
  'indent continuation adjacency relationship whitespace collision risk baseline rotation direction ' +
  'review ambiguous boundary estimate measure wrapper engine native content stream verification ' +
  'report section chapter appendix figure reference summary method result conclusion'
).split(' ');

function sentence(rng: () => number, words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i += 1) out.push(WORDS[Math.floor(rng() * WORDS.length)]!);
  out[0] = out[0]![0]!.toUpperCase() + out[0]!.slice(1);
  return `${out.join(' ')}.`;
}

function paragraphText(rng: () => number, minWords: number, maxWords: number): string {
  const count = minWords + Math.floor(rng() * (maxWords - minWords + 1));
  const parts: string[] = [];
  let left = count;
  while (left > 0) {
    const take = Math.min(left, 6 + Math.floor(rng() * 8));
    parts.push(sentence(rng, take));
    left -= take;
  }
  return parts.join(' ');
}

/* ----------------------------------------------------------------- fonts */

const STANDARD: Record<GtFamily, [string, string, string, string]> = {
  helvetica: [
    StandardFonts.Helvetica,
    StandardFonts.HelveticaBold,
    StandardFonts.HelveticaOblique,
    StandardFonts.HelveticaBoldOblique,
  ],
  times: [
    StandardFonts.TimesRoman,
    StandardFonts.TimesRomanBold,
    StandardFonts.TimesRomanItalic,
    StandardFonts.TimesRomanBoldItalic,
  ],
  courier: [
    StandardFonts.Courier,
    StandardFonts.CourierBold,
    StandardFonts.CourierOblique,
    StandardFonts.CourierBoldOblique,
  ],
};

class Fonts {
  private readonly cache = new Map<string, PDFFont>();

  private constructor(private readonly doc: PDFDocument) {}

  static async create(doc: PDFDocument): Promise<Fonts> {
    const fonts = new Fonts(doc);
    for (const family of ['helvetica', 'times', 'courier'] as GtFamily[]) {
      for (const bold of [false, true]) {
        for (const italic of [false, true]) await fonts.load(family, bold, italic);
      }
    }
    return fonts;
  }

  private key(family: GtFamily, bold: boolean, italic: boolean): string {
    return `${family}|${bold ? 1 : 0}|${italic ? 1 : 0}`;
  }

  private async load(family: GtFamily, bold: boolean, italic: boolean): Promise<PDFFont> {
    const [regular, b, i, bi] = STANDARD[family];
    const name = bold && italic ? bi : bold ? b : italic ? i : regular;
    const embedded = await this.doc.embedFont(name);
    this.cache.set(this.key(family, bold, italic), embedded);
    return embedded;
  }

  get(family: GtFamily, bold: boolean, italic: boolean): PDFFont {
    const hit = this.cache.get(this.key(family, bold, italic));
    if (!hit) throw new Error(`font not warmed: ${this.key(family, bold, italic)}`);
    return hit;
  }

  width(text: string, family: GtFamily, bold: boolean, italic: boolean, size: number): number {
    return this.get(family, bold, italic).widthOfTextAtSize(text, size);
  }
}

/* ----------------------------------------------------------------- sheet */

export interface LineSpec {
  text: string;
  /** Left edge in display points. */
  x: number;
  /** Baseline in PDF user space (y up, from the page bottom). */
  baseline: number;
  size?: number;
  family?: GtFamily;
  bold?: boolean;
  italic?: boolean;
  column?: number;
}

export interface ParaSpec {
  role: GtRole;
  lines: LineSpec[];
  headingLevel?: number;
  listLevel?: number;
}

const ASCENT = 0.8;

class Sheet {
  readonly lines: GtLine[] = [];
  readonly paragraphs: GtParagraph[] = [];
  readonly tables: GtTable[] = [];
  readonly images: GtImage[] = [];
  /** Set for pages whose draw order is not the reading order. */
  readingOrder?: number[];

  setReadingOrder(order: number[]): void {
    this.readingOrder = order;
  }

  constructor(
    readonly page: PDFPage,
    readonly width: number,
    readonly height: number,
    readonly fonts: Fonts,
  ) {}

  private draw(spec: LineSpec): number {
    const size = spec.size ?? 11;
    const family = spec.family ?? 'helvetica';
    const bold = spec.bold ?? false;
    const italic = spec.italic ?? false;
    this.page.drawText(spec.text, {
      x: spec.x,
      y: spec.baseline,
      size,
      font: this.fonts.get(family, bold, italic),
      color: rgb(0, 0, 0),
    });
    const box: BBox = {
      x: spec.x,
      y: this.height - (spec.baseline + size * ASCENT),
      width: Math.max(1, this.fonts.width(spec.text, family, bold, italic, size)),
      height: size,
    };
    this.lines.push({
      text: spec.text,
      box,
      size,
      family,
      bold,
      italic,
      column: spec.column ?? -1,
    });
    return this.lines.length - 1;
  }

  paragraph(spec: ParaSpec): number {
    // Two draw calls that share a baseline are one *visual* line -- that is what
    // a reader sees and what the model is allowed to produce. Merging them here
    // keeps the ground truth about lines honest instead of scoring the model for
    // a distinction only the PDF operator stream makes.
    const indexes: number[] = [];
    for (const line of spec.lines) {
      const lastIndex = indexes[indexes.length - 1];
      const last = lastIndex === undefined ? undefined : this.lines[lastIndex];
      if (last && Math.abs(last.box.y - this.lineBoxY(line)) < 1.5) {
        const drawn = this.draw(line);
        const fresh = this.lines[drawn]!;
        const mergedText = `${last.text} ${fresh.text}`.replace(/\s+/g, ' ').trim();
        // Keep the typography of whichever run dominates the line.
        if (fresh.text.length > last.text.length) {
          last.family = fresh.family;
          last.bold = fresh.bold;
          last.italic = fresh.italic;
          last.size = fresh.size;
        }
        last.text = mergedText;
        last.box = {
          x: Math.min(last.box.x, fresh.box.x),
          y: Math.min(last.box.y, fresh.box.y),
          width:
            Math.max(last.box.x + last.box.width, fresh.box.x + fresh.box.width) -
            Math.min(last.box.x, fresh.box.x),
          height:
            Math.max(last.box.y + last.box.height, fresh.box.y + fresh.box.height) -
            Math.min(last.box.y, fresh.box.y),
        };
        this.lines.pop();
        continue;
      }
      indexes.push(this.draw(line));
    }
    const text = indexes
      .map((index) => this.lines[index]!.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    this.paragraphs.push({
      lineIndexes: indexes,
      role: spec.role,
      ...(spec.headingLevel !== undefined ? { headingLevel: spec.headingLevel } : {}),
      ...(spec.listLevel !== undefined ? { listLevel: spec.listLevel } : {}),
      column: spec.lines[0]?.column ?? -1,
      text,
    });
    return this.paragraphs.length - 1;
  }

  private lineBoxY(line: LineSpec): number {
    return this.height - (line.baseline + (line.size ?? 11) * ASCENT);
  }

  /** Greedy wrap of `text` to `width`, returning display-space line specs. */
  wrap(
    text: string,
    opts: {
      x: number;
      baseline: number;
      width: number;
      size?: number;
      family?: GtFamily;
      bold?: boolean;
      italic?: boolean;
      column?: number;
      lineHeight?: number;
      firstLineIndent?: number;
    },
  ): LineSpec[] {
    const size = opts.size ?? 11;
    const family = opts.family ?? 'helvetica';
    const bold = opts.bold ?? false;
    const italic = opts.italic ?? false;
    const lineHeight = opts.lineHeight ?? Math.round(size * 1.45);
    return wrapWords(
      text,
      (t) => this.fonts.width(t, family, bold, italic, size),
      opts.width,
    ).map((line, index) => ({
      text: line,
      x: opts.x + (index === 0 ? (opts.firstLineIndent ?? 0) : 0),
      baseline: opts.baseline - index * lineHeight,
      size,
      family,
      bold,
      italic,
      column: opts.column ?? -1,
    }));
  }

  body(
    text: string,
    opts: {
      x: number;
      baseline: number;
      width: number;
      size?: number;
      family?: GtFamily;
      column?: number;
      firstLineIndent?: number;
      lineHeight?: number;
    },
  ): { paragraph: number; specs: LineSpec[] } {
    const specs = this.wrap(text, opts);
    return { paragraph: this.paragraph({ role: 'body', lines: specs }), specs };
  }

  table(
    rows: string[][],
    opts: { x: number; baseline: number; colWidths: number[]; size?: number; rowStep?: number },
  ): { box: BBox; lastBaseline: number } {
    const size = opts.size ?? 10;
    const rowStep = opts.rowStep ?? 24;
    const start = this.lines.length;
    const firstTop = opts.baseline + size * ASCENT;
    rows.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        const x = opts.x + opts.colWidths.slice(0, colIndex).reduce((sum, w) => sum + w, 0);
        this.draw({ text: cell, x, baseline: opts.baseline - rowIndex * rowStep, size, column: colIndex });
      });
    });
    const lastBaseline = opts.baseline - (rows.length - 1) * rowStep;
    const totalWidth = opts.colWidths.reduce((sum, w) => sum + w, 0);
    const box: BBox = {
      x: opts.x,
      y: this.height - firstTop,
      width: totalWidth,
      height: firstTop - (lastBaseline - size * 0.2),
    };
    rows.forEach((row, rowIndex) => {
      row.forEach((_cell, colIndex) => {
        this.paragraphs.push({
          lineIndexes: [start + rowIndex * row.length + colIndex],
          role: 'table-cell',
          column: colIndex,
          text: row[colIndex]!,
        });
      });
    });
    this.tables.push({ rows, box });
    return { box, lastBaseline };
  }

  async image(top: number, width: number, height: number): Promise<BBox> {
    const png = encodePng(64, 48, [{ x: 0, y: 0, w: 64, h: 48 }]);
    const embedded = await this.page.doc.embedPng(png);
    this.page.drawImage(embedded, {
      x: 72,
      y: this.height - (top + height),
      width,
      height,
    });
    const box: BBox = { x: 72, y: top, width, height };
    this.images.push({ box });
    return box;
  }
}

/** Greedy word wrap with the caller's own width function. */
export function wrapWords(text: string, widthOf: (t: string) => number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && widthOf(candidate) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/* ----------------------------------------------------------------- cases */

export const PAGE_W = 612;
export const PAGE_H = 792;
const MARGIN = 72;
const MEASURE = PAGE_W - MARGIN * 2;

interface Ctx {
  doc: PDFDocument;
  fonts: Fonts;
  sheets: Sheet[];
  scenarios: ReflowScenario[];
}

async function newPage(ctx: Ctx): Promise<Sheet> {
  const page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  const sheet = new Sheet(page, PAGE_W, PAGE_H, ctx.fonts);
  ctx.sheets.push(sheet);
  return sheet;
}

async function createContext(): Promise<Ctx> {
  const doc = await PDFDocument.create();
  return { doc, fonts: await Fonts.create(doc), sheets: [], scenarios: [] };
}

/** Line step the corpus actually used for a paragraph, from its own geometry. */
function lineStep(page: GtPage, paragraph: GtParagraph): number {
  const first = page.lines[paragraph.lineIndexes[0]!]!;
  const second = page.lines[paragraph.lineIndexes[1] ?? -1];
  if (second) return Math.abs(first.box.y - second.box.y);
  return first.size * 1.45;
}

async function finish(name: string, ctx: Ctx): Promise<SyntheticCase> {
  const truth: GtDocument = {
    pages: ctx.sheets.map((sheet) => {
      // Column count is a property of the *text flow*, not of table cells: a
      // four-cell table row is one column of prose containing a table.
      const contentColumns = sheet.paragraphs
        .filter((paragraph) => paragraph.role !== 'table-cell')
        .map((paragraph) => paragraph.column);
      const columnCount = Math.max(1, ...contentColumns.map((column) => column + 1));
      return {
        width: sheet.width,
        height: sheet.height,
        lines: sheet.lines,
        paragraphs: sheet.paragraphs,
        tables: sheet.tables,
        images: sheet.images,
        columnCount,
        ...(sheet.readingOrder ? { readingOrder: sheet.readingOrder } : {}),
      };
    }),
  };
  const bytes = await ctx.doc.save();
  return { name, bytes, truth, scenarios: ctx.scenarios };
}

/* ------------------------------------------------------------------ prose */

async function caseProse(seed: number): Promise<SyntheticCase> {
  const rng = mulberry32(seed);
  const ctx = await createContext();
  const sheet = await newPage(ctx);
  const lineHeight = 16;
  // A deliberately generous paragraph gap: real word-processed documents use
  // 1.4-1.8x the line height, which is exactly where a gap-only splitter fails.
  const paraGap = Math.round(lineHeight * (1.45 + rng() * 0.35));
  let baseline = PAGE_H - 96;
  // Word counts chosen so each paragraph wraps to 3-6 lines and ends on a
  // naturally short final line; truncating a wrap instead would leave a
  // full-width last line and penalise the model for a document we faked.
  const wordCounts = [34, 62, 46, 78];
  for (const words of wordCounts) {
    const specs = sheet.wrap(paragraphText(rng, words, words + 8), {
      x: MARGIN,
      baseline,
      width: MEASURE,
    });
    const paragraph = sheet.paragraph({ role: 'body', lines: specs });
    baseline = specs[specs.length - 1]!.baseline - paraGap;
    ctx.scenarios.push({
      pageIndex: 0,
      paragraph,
      extraLines: 4,
      // Every paragraph but the last is followed by another one, so growing
      // must be refused; the last one has the rest of the page to itself.
      expectCollision: paragraph !== sheet.paragraphs.length - 1,
      note: paragraph !== sheet.paragraphs.length - 1
        ? 'paragraph growing into the paragraph below it'
        : 'final paragraph growing into free space',
    });
  }
  return finish('prose', ctx);
}

/** APA-style paragraphs: no vertical gap, only a first-line indent. */
async function caseIndentedProse(seed: number): Promise<SyntheticCase> {
  const rng = mulberry32(seed);
  const ctx = await createContext();
  const sheet = await newPage(ctx);
  let baseline = PAGE_H - 96;
  for (let i = 0; i < 4; i += 1) {
    const specs = sheet.wrap(paragraphText(rng, 34 + i * 6, 48 + i * 6), {
      x: MARGIN,
      baseline,
      width: MEASURE,
      firstLineIndent: 18,
    });
    sheet.paragraph({ role: 'body', lines: specs });
    baseline = specs[specs.length - 1]!.baseline - 16;
  }
  return finish('indented-prose', ctx);
}

/* --------------------------------------------------------------- headings */

async function caseHeadings(seed: number): Promise<SyntheticCase> {
  const rng = mulberry32(seed);
  const ctx = await createContext();
  const sheet = await newPage(ctx);

  let baseline = PAGE_H - 80;
  sheet.paragraph({
    role: 'heading',
    headingLevel: 1,
    lines: [{ text: 'Document Intelligence Report', x: MARGIN, baseline, size: 24, bold: true }],
  });
  baseline -= 46;

  const intro = sheet.body(paragraphText(rng, 26, 38), { x: MARGIN, baseline, width: MEASURE });
  baseline = intro.specs[intro.specs.length - 1]!.baseline - 30;

  sheet.paragraph({
    role: 'heading',
    headingLevel: 2,
    lines: [{ text: '1. Method', x: MARGIN, baseline, size: 16, bold: true }],
  });
  baseline -= 30;
  const method = sheet.body(paragraphText(rng, 28, 40), { x: MARGIN, baseline, width: MEASURE });
  baseline = method.specs[method.specs.length - 1]!.baseline - 26;

  sheet.paragraph({
    role: 'heading',
    headingLevel: 3,
    lines: [{ text: '1.1 Sampling', x: MARGIN, baseline, size: 13, bold: true }],
  });
  baseline -= 26;
  const sampling = sheet.body(paragraphText(rng, 22, 32), { x: MARGIN, baseline, width: MEASURE });
  baseline = sampling.specs[sampling.specs.length - 1]!.baseline - 28;

  // Same size as the body but bold and uppercase: a heading that a pure
  // size-ratio heuristic cannot see.
  sheet.paragraph({
    role: 'heading',
    headingLevel: 3,
    lines: [{ text: 'RESULTS SUMMARY', x: MARGIN, baseline, size: 11, bold: true }],
  });
  baseline -= 24;
  sheet.body(paragraphText(rng, 20, 28), { x: MARGIN, baseline, width: MEASURE });

  return finish('headings', ctx);
}

/* ----------------------------------------------------------------- lists */

async function caseLists(seed: number): Promise<SyntheticCase> {
  const rng = mulberry32(seed);
  const ctx = await createContext();
  const sheet = await newPage(ctx);

  let baseline = PAGE_H - 90;
  const size = 11;
  const step = 17;

  const items: { marker: string; indent: number; text: string; level: number; wrapped?: boolean }[] = [
    { marker: '•', indent: 0, text: sentence(rng, 9), level: 1 },
    { marker: '•', indent: 0, text: paragraphText(rng, 26, 34), level: 1, wrapped: true },
    { marker: '–', indent: 24, text: sentence(rng, 8), level: 2 },
    { marker: '1.', indent: 0, text: sentence(rng, 10), level: 1 },
    { marker: '2.', indent: 0, text: sentence(rng, 11), level: 1 },
    { marker: '(a)', indent: 24, text: sentence(rng, 7), level: 2 },
    { marker: '(b)', indent: 24, text: sentence(rng, 7), level: 2 },
  ];

  for (const item of items) {
    const x = MARGIN + item.indent;
    const markerWidth = sheet.fonts.width(`${item.marker} `, 'helvetica', false, false, size);
    const specs: LineSpec[] = [];
    if (item.wrapped) {
      const body = wrapWords(
        item.text,
        (t) => sheet.fonts.width(t, 'helvetica', false, false, size),
        MEASURE - item.indent - markerWidth - 8,
      );
      specs.push({ text: `${item.marker} ${body[0]}`, x, baseline, size });
      for (let i = 1; i < body.length; i += 1) {
        specs.push({ text: body[i]!, x: x + markerWidth + 8, baseline: baseline - i * step, size });
      }
    } else {
      specs.push({ text: `${item.marker} ${item.text}`, x, baseline, size });
    }
    sheet.paragraph({ role: 'list-item', lines: specs, listLevel: item.level });
    baseline = specs[specs.length - 1]!.baseline - step;
  }

  return finish('lists', ctx);
}

/* --------------------------------------------------------------- two col */

async function caseTwoColumn(seed: number): Promise<SyntheticCase> {
  const rng = mulberry32(seed);
  const ctx = await createContext();
  const sheet = await newPage(ctx);

  const colWidth = 216;
  const gutter = 36;
  const leftX = MARGIN;
  const rightX = MARGIN + colWidth + gutter;

  let baseline = PAGE_H - 84;
  sheet.paragraph({
    role: 'heading',
    headingLevel: 1,
    lines: [{ text: 'A Spanning Headline For Two Columns', x: MARGIN, baseline, size: 20, bold: true }],
  });
  baseline -= 50;

  const colStep = 104;
  for (let block = 0; block < 4; block += 1) {
    for (const column of [0, 1]) {
      const x = column === 0 ? leftX : rightX;
      const specs = sheet.wrap(paragraphText(rng, 18, 26), { x, baseline, width: colWidth, column });
      sheet.paragraph({ role: 'body', lines: specs });
    }
    baseline -= colStep;
  }

  const spanning = sheet.wrap(paragraphText(rng, 22, 30), {
    x: MARGIN,
    baseline,
    width: MEASURE,
    column: -1,
  });
  sheet.paragraph({ role: 'body', lines: spanning });
  // Column-major reading order: headline, all of the left column, all of the
  // right column, then the spanning closing paragraph.
  sheet.setReadingOrder([0, 1, 3, 5, 7, 2, 4, 6, 8, sheet.paragraphs.length - 1]);

  return finish('two-column', ctx);
}

/* ---------------------------------------------------------------- tables */

async function caseTable(seed: number): Promise<SyntheticCase> {
  const rng = mulberry32(seed);
  const ctx = await createContext();
  const sheet = await newPage(ctx);

  let baseline = PAGE_H - 92;
  const intro = sheet.body(paragraphText(rng, 22, 30), { x: MARGIN, baseline, width: MEASURE });
  baseline = intro.specs[intro.specs.length - 1]!.baseline - 36;

  const rows = [
    ['Component', 'Units', 'Unit price', 'Total'],
    ['Widget assembly', '12', '4.50', '54.00'],
    ['Gasket set', '3', '19.00', '57.00'],
    ['Calibration', '1', '120.00', '120.00'],
  ];
  sheet.table(rows, { x: MARGIN, baseline, colWidths: [186, 66, 100, 110], size: 10, rowStep: 24 });
  baseline -= 24 * rows.length + 30;

  sheet.body(paragraphText(rng, 20, 28), { x: MARGIN, baseline, width: MEASURE });

  return finish('table', ctx);
}

async function caseSmallTable(seed: number): Promise<SyntheticCase> {
  const rng = mulberry32(seed);
  const ctx = await createContext();
  const sheet = await newPage(ctx);

  const baseline = PAGE_H - 150;
  sheet.table(
    [
      ['Input', 'Output'],
      ['alpha', '17'],
      ['beta', '42'],
    ],
    { x: MARGIN, baseline, colWidths: [150, 150], size: 10, rowStep: 24 },
  );
  sheet.body(paragraphText(rng, 26, 36), {
    x: MARGIN,
    baseline: baseline - 24 * 3 - 34,
    width: MEASURE,
  });

  return finish('small-table', ctx);
}

/* -------------------------------------------------------------- furniture */

async function caseFurniture(seed: number): Promise<SyntheticCase> {
  const rng = mulberry32(seed);
  const ctx = await createContext();
  const pages = 4;

  for (let index = 0; index < pages; index += 1) {
    const sheet = await newPage(ctx);
    sheet.paragraph({
      role: 'header',
      lines: [
        { text: 'Northwind Analytics — Quarterly Review', x: MARGIN, baseline: PAGE_H - 44, size: 9 },
      ],
    });
    let baseline = PAGE_H - 110;
    for (let p = 0; p < 3; p += 1) {
      const specs = sheet.wrap(paragraphText(rng, 28, 40), { x: MARGIN, baseline, width: MEASURE });
      sheet.paragraph({ role: 'body', lines: specs });
      baseline = specs[specs.length - 1]!.baseline - 28;
    }
    sheet.paragraph({
      role: 'footer',
      lines: [{ text: `Page ${index + 1} of ${pages}`, x: MARGIN, baseline: 44, size: 9 }],
    });
  }

  return finish('furniture', ctx);
}

/* --------------------------------------------------- caption + footnote */

async function caseCaptionFootnote(seed: number): Promise<SyntheticCase> {
  const rng = mulberry32(seed);
  const ctx = await createContext();
  const sheet = await newPage(ctx);

  let baseline = PAGE_H - 96;
  const body = sheet.wrap(paragraphText(rng, 32, 46), { x: MARGIN, baseline, width: MEASURE });
  sheet.paragraph({ role: 'body', lines: body });
  baseline = body[body.length - 1]!.baseline - 44;

  // A caption long enough to wrap: the second line must stay a caption.
  const captionText = `Figure ${(seed % 7) + 1}: ${paragraphText(rng, 18, 24)}`;
  const caption = sheet.wrap(captionText, { x: MARGIN, baseline, width: MEASURE, size: 10 });
  sheet.paragraph({ role: 'caption', lines: caption });
  baseline = caption[caption.length - 1]!.baseline - 66;

  const more = sheet.wrap(paragraphText(rng, 26, 36), { x: MARGIN, baseline, width: MEASURE });
  sheet.paragraph({ role: 'body', lines: more });

  // Footnote: clearly smaller than the body and low on the page.
  const footnote = sheet.wrap(`1 ${paragraphText(rng, 16, 22)}`, {
    x: MARGIN,
    baseline: 60,
    width: MEASURE,
    size: 8,
  });
  sheet.paragraph({ role: 'footnote', lines: footnote });

  return finish('caption-footnote', ctx);
}

/* ------------------------------------------------------- image collision */

async function caseImage(seed: number): Promise<SyntheticCase> {
  const rng = mulberry32(seed);
  const ctx = await createContext();
  const sheet = await newPage(ctx);

  let baseline = PAGE_H - 96;
  const body = sheet.wrap(paragraphText(rng, 26, 36), { x: MARGIN, baseline, width: MEASURE });
  const victim = sheet.paragraph({ role: 'body', lines: body });
  baseline = body[body.length - 1]!.baseline - 34;

  const imageTop = sheet.height - baseline + 6;
  const imageHeight = 150;
  await sheet.image(imageTop, 260, imageHeight);
  ctx.scenarios.push({
    pageIndex: 0,
    paragraph: victim,
    extraLines: 4,
    expectCollision: true,
    note: 'paragraph expanding into the figure below it',
  });

  const captionBaseline = sheet.height - (imageTop + imageHeight) - 20;
  const caption = sheet.wrap(`Figure ${seed % 5}: ${sentence(rng, 11)}`, {
    x: MARGIN,
    baseline: captionBaseline,
    width: MEASURE,
    size: 10,
  });
  sheet.paragraph({ role: 'caption', lines: caption });

  const afterBaseline = caption[caption.length - 1]!.baseline - 50;
  const after = sheet.wrap(paragraphText(rng, 22, 30), {
    x: MARGIN,
    baseline: afterBaseline,
    width: MEASURE,
  });
  const afterIndex = sheet.paragraph({ role: 'body', lines: after });
  ctx.scenarios.push({
    pageIndex: 0,
    paragraph: afterIndex,
    extraLines: 3,
    expectCollision: false,
    note: 'paragraph at the end of the page grows into free space',
  });

  return finish('image', ctx);
}

/* ------------------------------------------------ mixed typography pages */

async function caseMixedTypography(seed: number): Promise<SyntheticCase> {
  const rng = mulberry32(seed);
  const ctx = await createContext();
  const sheet = await newPage(ctx);

  let baseline = PAGE_H - 92;
  // Bold lead-in followed by regular text on the same line.
  const lead = 'Key finding: ';
  const leadWidth = sheet.fonts.width(lead, 'helvetica', true, false, 11);
  const restWrapped = wrapWords(
    paragraphText(rng, 40, 56),
    (t) => sheet.fonts.width(t, 'helvetica', false, false, 11),
    MEASURE - leadWidth,
  );
  const specs: LineSpec[] = [{ text: lead, x: MARGIN, baseline, bold: true }];
  specs.push({ text: restWrapped[0]!, x: MARGIN + leadWidth, baseline });
  for (let i = 1; i < restWrapped.length; i += 1) {
    specs.push({ text: restWrapped[i]!, x: MARGIN, baseline: baseline - i * 16 });
  }
  sheet.paragraph({ role: 'body', lines: specs });
  baseline = specs[specs.length - 1]!.baseline - 36;

  const serif = sheet.wrap(paragraphText(rng, 30, 42), {
    x: MARGIN,
    baseline,
    width: MEASURE,
    family: 'times',
  });
  sheet.paragraph({ role: 'body', lines: serif });
  baseline = serif[serif.length - 1]!.baseline - 32;

  const mono = sheet.wrap(paragraphText(rng, 16, 24), {
    x: MARGIN,
    baseline,
    width: MEASURE,
    family: 'courier',
    size: 10,
  });
  sheet.paragraph({ role: 'body', lines: mono });

  return finish('mixed-typography', ctx);
}

/* --------------------------------------------------------- dense / timing */

async function caseDense(seed: number): Promise<SyntheticCase> {
  const rng = mulberry32(seed);
  const ctx = await createContext();
  const pages = 24;
  for (let index = 0; index < pages; index += 1) {
    const sheet = await newPage(ctx);
    sheet.paragraph({
      role: 'header',
      lines: [{ text: `Corpus Volume ${(seed % 3) + 1}`, x: MARGIN, baseline: PAGE_H - 42, size: 9 }],
    });
    let baseline = PAGE_H - 100;
    for (let p = 0; p < 5; p += 1) {
      const specs = sheet.wrap(paragraphText(rng, 30, 46), { x: MARGIN, baseline, width: MEASURE });
      sheet.paragraph({ role: 'body', lines: specs });
      baseline = specs[specs.length - 1]!.baseline - 26;
    }
    sheet.paragraph({
      role: 'footer',
      lines: [{ text: `${index + 1} / ${pages}`, x: MARGIN, baseline: 42, size: 9 }],
    });
  }
  return finish('dense', ctx);
}

/* --------------------------------------------------------------- registry */

export type CaseName =
  | 'prose'
  | 'indented-prose'
  | 'headings'
  | 'lists'
  | 'two-column'
  | 'table'
  | 'small-table'
  | 'furniture'
  | 'caption-footnote'
  | 'image'
  | 'mixed-typography'
  | 'dense';

const BUILDERS: Record<CaseName, (seed: number) => Promise<SyntheticCase>> = {
  prose: caseProse,
  'indented-prose': caseIndentedProse,
  headings: caseHeadings,
  lists: caseLists,
  'two-column': caseTwoColumn,
  table: caseTable,
  'small-table': caseSmallTable,
  furniture: caseFurniture,
  'caption-footnote': caseCaptionFootnote,
  image: caseImage,
  'mixed-typography': caseMixedTypography,
  dense: caseDense,
};

/** Seeds the implementation was developed against. Never scored. */
export const DEV_SEEDS: number[] = [11, 23, 37, 51, 67, 83, 97, 113, 131, 149, 167, 181];

/** Seeds reserved for the final score; drawn from the same generators. */
export const HELD_OUT_SEEDS: number[] = [
  10_007, 20_011, 30_013, 40_017, 50_023, 60_029, 70_031, 80_037, 90_041, 100_043, 110_047, 120_049,
];

export const ALL_CASE_NAMES: CaseName[] = Object.keys(BUILDERS) as CaseName[];

export function casePlan(seeds: readonly number[]): { name: CaseName; seed: number }[] {
  return seeds.map((seed, index) => ({ name: ALL_CASE_NAMES[index % ALL_CASE_NAMES.length]!, seed }));
}

export async function buildCase(name: CaseName, seed: number): Promise<SyntheticCase> {
  return BUILDERS[name](seed);
}

export { lineStep };
