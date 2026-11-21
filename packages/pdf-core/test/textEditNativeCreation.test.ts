/**
 * Native text-object creation and styling regressions.
 *
 * These tests exercise the real PDFium WASM and verify with pdf.js. They pin
 * the capability added after `FPDFPageObj_NewTextObj` was found to work while
 * the `FPDFPageObj_CreateTextObj(FPDF_FONT, …)` path is unusable in this build:
 *
 *   - multiline growth/shrink can create/remove lines natively;
 *   - newly created lines receive the requested face, size, colour, render mode
 *     and origin;
 *   - a requested standard family is an exact face, not a substitution;
 *   - embedded/custom faces keep the explicit overlay fallback (never claimed
 *     as native);
 *   - the exported bytes are reopenable, searchable and text-extractable, and
 *     the original lines are genuinely gone.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import fontkit from '@cantoo/fontkit';
import {
  TextEditUnsafeError,
  configurePdfiumRuntime,
  configurePdfjsRuntime,
  editPdfText,
  extractPageLayouts,
  extractTextRuns,
  loadPdfiumModule,
  type CanvasFactory,
  type EditorObject,
  type TextEdit,
} from '../src/index.js';
import { PdfiumTextDocument } from '../src/textedit/pdfium.js';
import { findInLayouts } from '../src/document/search.js';
import { testContext } from './fixtures.js';

function readPdfiumWasm(): Uint8Array {
  const proc = (globalThis as unknown as {
    process: { getBuiltinModule(name: string): unknown };
  }).process;
  const fs = proc.getBuiltinModule('node:fs') as {
    readFileSync(path: URL): Uint8Array;
  };
  return fs.readFileSync(
    new URL('../node_modules/@embedpdf/pdfium/dist/pdfium.wasm', import.meta.url),
  );
}

beforeAll(async () => {
  configurePdfiumRuntime({ wasmBinary: readPdfiumWasm() });
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
      .href,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  });
  await loadPdfiumModule();
});

const canvasFactory: CanvasFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    width,
    height,
    context: canvas.getContext('2d'),
    toBlob: async (type: string) => {
      const buffer = await canvas.encode('png');
      return new Blob([new Uint8Array(buffer)], { type });
    },
    release: () => {
      canvas.width = 1;
      canvas.height = 1;
    },
  };
};

async function pageText(bytes: Uint8Array, pageIndex = 0): Promise<string> {
  const runs = await extractTextRuns(bytes, [pageIndex]);
  return runs[0]!.map((run) => run.text).join('\n');
}

interface SourceOptions {
  family?: 'helvetica' | 'times' | 'courier';
  bold?: boolean;
  italic?: boolean;
  lines?: string[];
  color?: ReturnType<typeof rgb>;
  renderMode?: number;
}

async function makeParagraph(options: SourceOptions = {}): Promise<Uint8Array> {
  const family = options.family ?? 'helvetica';
  const bold = options.bold ?? false;
  const italic = options.italic ?? false;
  const fontName =
    family === 'times'
      ? bold && italic
        ? StandardFonts.TimesRomanBoldItalic
        : bold
          ? StandardFonts.TimesRomanBold
          : italic
            ? StandardFonts.TimesRomanItalic
            : StandardFonts.TimesRoman
      : family === 'courier'
        ? bold && italic
          ? StandardFonts.CourierBoldOblique
          : bold
            ? StandardFonts.CourierBold
            : italic
              ? StandardFonts.CourierOblique
              : StandardFonts.Courier
        : bold && italic
          ? StandardFonts.HelveticaBoldOblique
          : bold
            ? StandardFonts.HelveticaBold
            : italic
              ? StandardFonts.HelveticaOblique
              : StandardFonts.Helvetica;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(fontName);
  const page = doc.addPage([612, 792]);
  const lines = options.lines ?? [
    'Native creation starts on this first line and continues across the page',
    'and ends on the second line',
  ];
  lines.forEach((text, index) => {
    page.drawText(text, {
      x: 72,
      y: 700 - index * 14,
      size: 12,
      font,
      color: options.color ?? rgb(0, 0, 0),
      ...(options.renderMode !== undefined ? { renderMode: options.renderMode } : {}),
    } as Parameters<typeof page.drawText>[1]);
  });
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

async function layoutEditFor(
  source: Uint8Array,
  replace: string,
  extra: Partial<NonNullable<TextEdit['layout']>> = {},
  needle = 'Native',
  widthOverride?: number,
): Promise<{ edit: TextEdit; paragraphX: number; paragraphRight: number; lineHeight: number }> {
  const layouts = await extractPageLayouts(source, { pageIndexes: [0] });
  const page = layouts[0]!;
  const paragraph = page.paragraphs.find((entry) => entry.text.includes(needle))!;
  const lines = paragraph.lineIds
    .map((id) => page.lines.find((line) => line.id === id)!)
    .filter(Boolean);
  const first = lines[0]!;
  const styleSize = extra.style?.fontSize ?? first.typography.fontSize;
  const lineHeight = Math.max(1, styleSize * 1.25);
  const width = widthOverride ?? Math.max(...lines.map((line) => line.bbox.width)) + 40;
  return {
    edit: {
      id: 'styled',
      pageIndex: 0,
      find: paragraph.text,
      replace,
      box: paragraph.bbox,
      layout: {
        paragraphId: paragraph.id,
        beforeLines: lines.map((line) => ({ text: line.text, box: line.bbox })),
        reflow: {
          width,
          lineHeight,
          firstBaselineY: first.bbox.y + styleSize * 0.82,
          x: paragraph.bbox.x,
        },
        ...extra,
      },
    },
    paragraphX: paragraph.bbox.x,
    paragraphRight: paragraph.bbox.x + width,
    lineHeight,
  };
}

async function textObjectStartingWith(bytes: Uint8Array, prefix: string) {
  const module = await loadPdfiumModule();
  const doc = PdfiumTextDocument.open(module, bytes, '');
  try {
    return doc.listTextObjects(0).find((object) => object.text.startsWith(prefix)) ?? null;
  } finally {
    doc.close();
  }
}

describe('native standard-font creation and styling', () => {
  it('grows a paragraph and applies size, colour, a real bold face and alignment to new lines', async () => {
    const source = await makeParagraph();
    const replacement =
      'ZZSTYLED native growth keeps this replacement long enough to need several new lines ' +
      'and each one must carry the chosen size colour and real bold face while staying ' +
      'inside the paragraph width until the final short line.';
    const { edit } = await layoutEditFor(source, replacement, {
      style: { fontSize: 18, color: '#cc1122', bold: true, italic: false, align: 'center' },
    });

    const result = await editPdfText(source, { edits: [edit] }, testContext());
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('in-place');
    expect(result.fallback).toBe(0);
    expect(result.inPlace).toBe(1);

    const text = await pageText(result.bytes);
    expect(text).toContain('ZZSTYLED native growth');
    expect(text).toContain('final short line');
    expect(text).not.toContain('and ends on the second line');

    const runs = await extractTextRuns(result.bytes, [0]);
    const grown = runs[0]!.filter((run) => run.y < 200);
    expect(grown.length).toBeGreaterThan(2);
    for (const run of grown) expect(run.fontSize).toBeCloseTo(18, 0);

    const object = await textObjectStartingWith(result.bytes, 'ZZSTYLED');
    expect(object).not.toBeNull();
    expect(object?.font?.baseName.toLowerCase()).toContain('bold');
    expect(object?.renderMode).toBe(0);

    // Colour is verified from the rendered page: PDFium's per-object fill
    // getter is unreliable in this build, so the ink pixels are the honest
    // source of truth.
    const layouts = await extractPageLayouts(result.bytes, {
      pageIndexes: [0],
      includeColors: true,
      canvasFactory,
    });
    const styled = layouts[0]!.paragraphs.find((entry) => entry.text.includes('ZZSTYLED'))!;
    expect(styled.typography.color).toMatch(/^#[0-9a-f]{6}$/);
    const red = Number.parseInt(styled.typography.color!.slice(1, 3), 16);
    const green = Number.parseInt(styled.typography.color!.slice(3, 5), 16);
    expect(red).toBeGreaterThan(120);
    expect(red).toBeGreaterThan(green + 40);
  });

  it('uses a real italic variant and can remove a baked-in bold style natively', async () => {
    const source = await makeParagraph({ bold: true });
    const { edit } = await layoutEditFor(
      source,
      'Unbolded and now italic on this replacement line that still wraps once more',
      { style: { fontSize: 14, bold: false, italic: true } },
    );

    const result = await editPdfText(source, { edits: [edit] }, testContext());
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('in-place');
    const object = await textObjectStartingWith(result.bytes, 'Unbolded');
    expect(object).not.toBeNull();
    expect(object?.font?.baseName.toLowerCase()).toContain('oblique');
    expect(object?.font?.baseName.toLowerCase()).not.toContain('bold');
    expect(object?.renderMode).toBe(0);
    expect(result.warnings.some((warning) => warning.startsWith('synthetic-'))).toBe(false);
  });

  it.each([
    ['helvetica', false, false],
    ['times', false, false],
    ['courier', true, false],
    ['helvetica', false, true],
  ] as const)('grows a %s paragraph natively (bold=%s italic=%s)', async (family, bold, italic) => {
    const source = await makeParagraph({ family, bold, italic });
    const { edit } = await layoutEditFor(
      source,
      `ZZ${family} growth adds enough words to this replacement to require at least one more ` +
        'line than the original paragraph had before the edit.',
    );
    const result = await editPdfText(source, { edits: [edit] }, testContext());
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('in-place');
    const text = await pageText(result.bytes);
    expect(text).toContain(`ZZ${family} growth`);
    expect(text).not.toContain('and ends on the second line');
    const object = await textObjectStartingWith(result.bytes, `ZZ${family}`);
    expect(object).not.toBeNull();
    expect(object?.font?.baseName.toLowerCase()).toContain(family === 'times' ? 'times' : family);
  });

  it('shrinks a paragraph, removes surplus original lines and leaves no old text', async () => {
    const source = await makeParagraph({
      lines: [
        'Shrink this paragraph from three lines down to one short replacement',
        'the second line must disappear entirely',
        'and the third old line must disappear too',
      ].map((line) => line.slice(0, 60)),
    });
    const { edit } = await layoutEditFor(
      source,
      'ZZSHRUNK.',
      { style: { fontSize: 20, color: '#111827', bold: true, italic: false } },
      'Shrink',
    );
    const result = await editPdfText(source, { edits: [edit] }, testContext());
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('in-place');
    const text = await pageText(result.bytes);
    expect(text).toContain('ZZSHRUNK');
    expect(text).not.toContain('second line must disappear');
    expect(text).not.toContain('third old line must disappear');
    const runs = await extractTextRuns(result.bytes, [0]);
    expect(runs[0]!.filter((run) => run.text.trim().length > 0)).toHaveLength(1);
  });

  it('preserves an invisible OCR render mode on every created line', async () => {
    const source = await makeParagraph({ renderMode: 3 });
    const { edit } = await layoutEditFor(
      source,
      'ZZOCR carries invisible text across more than the two original lines so new ones exist ' +
        'and this replacement is deliberately long enough to need several additional lines ' +
        'while every old line disappears from the text layer entirely.',
      { style: { color: '#008000' } },
    );
    const result = await editPdfText(
      source,
      { edits: [edit], verifyVisual: false },
      testContext(),
    );
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('in-place');
    expect(await pageText(result.bytes)).toContain('ZZOCR carries invisible text');

    const module = await loadPdfiumModule();
    const doc = PdfiumTextDocument.open(module, result.bytes, '');
    try {
      const objects = doc.listTextObjects(0);
      expect(objects.length).toBeGreaterThan(2);
      expect(objects.every((object) => object.renderMode === 3)).toBe(true);
    } finally {
      doc.close();
    }
  });

  it('positions created lines on a right-aligned paragraph edge', async () => {
    const source = await makeParagraph({
      lines: ['Align this paragraph to the right edge of its column', 'with a second original line'],
    });
    const { edit, paragraphRight } = await layoutEditFor(
      source,
      'ZZRIGHT first line is deliberately much longer than the line after it and wraps once',
      { style: { align: 'right' } },
      'Align',
    );
    const result = await editPdfText(source, { edits: [edit] }, testContext());
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('in-place');
    const runs = (await extractTextRuns(result.bytes, [0]))[0]!;
    const paragraphRuns = runs.filter((run) => run.y < 200 && run.text.trim().length > 0);
    expect(paragraphRuns.length).toBeGreaterThan(1);
    const rightEdges = paragraphRuns.map((run) => run.x + run.width);
    const widest = Math.max(...rightEdges);
    expect(widest).toBeGreaterThan(paragraphRight - 3);
    for (const run of paragraphRuns) {
      expect(run.x + run.width).toBeGreaterThan(widest - 1.5);
    }
  });

  it('leaves untouched pages text-identical after a native styled reflow', async () => {
    const first = await makeParagraph();
    const pdf = await PDFDocument.load(first);
    const second = pdf.addPage([612, 792]);
    const keeper = await pdf.embedFont(StandardFonts.Helvetica);
    second.drawText('KEEP PAGE TWO EXACTLY', { x: 72, y: 700, size: 14, font: keeper });
    const source = new Uint8Array(await pdf.save({ useObjectStreams: false }));
    const before = await pageText(source, 1);
    const { edit } = await layoutEditFor(
      source,
      'Page one grows natively while page two must stay byte-for-byte text identical.',
      { style: { fontSize: 16, bold: true } },
    );
    const result = await editPdfText(source, { edits: [edit] }, testContext());
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('in-place');
    expect(await pageText(result.bytes, 1)).toBe(before);
    expect(result.verification.checks.find((check) => check.name === 'untouched-pages')?.ok).toBe(
      true,
    );
  });

  it('keeps the exported replacement searchable and extractable', async () => {
    const source = await makeParagraph();
    const { edit } = await layoutEditFor(
      source,
      'ZZSEARCHABLE words survive export and remain copyable and findable after reopening.',
    );
    const result = await editPdfText(source, { edits: [edit] }, testContext());
    expect(result.outcomes[0]!.mode).toBe('in-place');

    const layouts = await extractPageLayouts(result.bytes, { pageIndexes: [0] });
    const matches = findInLayouts(layouts, 'ZZSEARCHABLE words survive');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.paragraphText).toContain('ZZSEARCHABLE words survive');

    const copied = await pageText(result.bytes);
    expect(copied).toContain('ZZSEARCHABLE words survive export');
  });
});

describe('embedded/custom font boundaries', () => {
  async function embeddedParagraph(): Promise<Uint8Array> {
    const proc = (globalThis as unknown as {
      process: { getBuiltinModule(name: string): unknown };
    }).process;
    const fs = proc.getBuiltinModule('node:fs') as {
      readFileSync(path: URL): Uint8Array;
    };
    const fontBytes = fs.readFileSync(
      new URL(
        '../../../apps/web/public/standard_fonts/LiberationSans-Regular.ttf',
        import.meta.url,
      ),
    );
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontBytes, { subset: false });
    const page = doc.addPage([612, 792]);
    page.drawText('Embedded line one stays in the original custom face forever', {
      x: 72,
      y: 700,
      size: 14,
      font,
    });
    page.drawText('Embedded line two is also original', { x: 72, y: 684, size: 14, font });
    return new Uint8Array(await doc.save({ useObjectStreams: false }));
  }

  it('refuses embedded-font growth without a reviewed fallback instead of claiming a native edit', async () => {
    const source = await embeddedParagraph();
    const { edit } = await layoutEditFor(
      source,
      'This replacement needs many more lines than the embedded custom face can create safely in this build, ' +
        'so a native rewrite must be refused instead of pretending the extra line objects exist. ' +
        'The refusal is the honest outcome when no reviewed overlay was supplied by the caller.',
      { style: { fontSize: 14, color: '#111827', bold: false, italic: false } },
      'Embedded',
    );
    await expect(editPdfText(source, { edits: [edit] }, testContext())).rejects.toBeInstanceOf(
      TextEditUnsafeError,
    );
  });

  it('uses the explicit overlay fallback and reports it as fallback, never in-place', async () => {
    const source = await embeddedParagraph();
    // The replacement is short enough to fit one overlay line, but the native
    // reflow width is narrow enough that the custom face would need extra line
    // objects it cannot create.
    const overlayText = 'EMBEDDED OVERLAY replacement remains readable after export.';
    const { edit } = await layoutEditFor(
      source,
      overlayText,
      { style: { fontSize: 14, color: '#111827', bold: false, italic: false } },
      'Embedded',
      170,
    );
    const cover = { x: 68, y: 70, width: 500, height: 40 };
    edit.fallback = [
      { id: 'embedded-cover', kind: 'whiteout', pageIndex: 0, ...cover },
      {
        id: 'embedded-text',
        kind: 'text',
        pageIndex: 0,
        x: 72,
        y: 72,
        width: 480,
        height: 100,
        text: overlayText,
        fontSize: 12,
        fontFamily: 'helvetica',
      },
    ] satisfies EditorObject[];
    const result = await editPdfText(
      source,
      { edits: [edit], verifyVisual: false },
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('fallback');
    expect(result.inPlace).toBe(0);
    expect(result.fallback).toBe(1);
    expect(result.warnings.some((warning) => /applied as overlays/.test(warning))).toBe(true);
    const text = await pageText(result.bytes);
    expect(text).toContain('EMBEDDED OVERLAY replacement');
    // The original custom-face text is still recoverable under the overlay.
    expect(text).toContain('Embedded line one');
  });

  it('honours an explicit standard-family request natively even when the source face is custom', async () => {
    const source = await embeddedParagraph();
    const { edit } = await layoutEditFor(
      source,
      'ZZTIMES an explicit family request recreates the paragraph in a real standard Times face.',
      {
        style: {
          fontFamily: 'times',
          fontSize: 14,
          color: '#111827',
          bold: false,
          italic: false,
        },
      },
      'Embedded',
    );
    const result = await editPdfText(source, { edits: [edit] }, testContext());
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('in-place');
    const text = await pageText(result.bytes);
    expect(text).toContain('ZZTIMES an explicit family request');
    expect(text).not.toContain('Embedded line one');
    const object = await textObjectStartingWith(result.bytes, 'ZZTIMES');
    expect(object?.font?.baseName.toLowerCase()).toContain('times');
  });
});
