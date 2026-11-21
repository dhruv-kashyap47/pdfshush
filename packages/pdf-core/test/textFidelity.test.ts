/**
 * Sprint 5 fidelity tests: native style (T-06), rotation (T-07/C-10),
 * leftover covers (C-07), raster fallback (C-09), colour sampling (C-11) and
 * the C-08 fit boundaries.
 *
 * These run the real PDFium/pdf.js stack, because every claim here is about the
 * bytes and the rendered page, not about a helper returning a plausible object.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import {
  applyContentStreamEdits,
  configurePdfiumRuntime,
  configurePdfjsRuntime,
  editPdfText,
  extractPageLayouts,
  extractTextRuns,
  fitTextToWidth,
  loadPdfiumModule,
  readFontCharcodes,
  type CanvasFactory,
  type EditorObject,
  type TextEdit,
} from '../src/index.js';
import { PdfiumTextDocument } from '../src/textedit/pdfium.js';
import { buildTextSurgeryFixture } from './corpus/textSurgery.js';
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

beforeAll(async () => {
  configurePdfiumRuntime({ wasmBinary: readPdfiumWasm() });
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
      .href,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  });
  await loadPdfiumModule();
});

async function pageText(bytes: Uint8Array, pageIndex = 0): Promise<string> {
  const runs = await extractTextRuns(bytes, [pageIndex]);
  return runs[0]!.map((run) => run.text).join('\n');
}

async function makeParagraphFixture(color = rgb(0, 0, 0)): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Reflow this paragraph starts here and keeps going', {
    x: 72,
    y: 700,
    size: 12,
    font,
    color,
  });
  page.drawText('KEEP THIS NEIGHBOUR', { x: 72, y: 620, size: 12, font });
  return doc.save({ useObjectStreams: false });
}

async function makeTwoLineFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('First line of block', { x: 72, y: 500, size: 14, font });
  page.drawText('Second line of block', { x: 72, y: 484, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

async function makeSingleLineFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Rotate this paragraph', { x: 72, y: 500, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

async function layoutEdit(
  source: Uint8Array,
  replace: string,
  extra: Partial<NonNullable<TextEdit['layout']>> = {},
  needle = 'Reflow',
): Promise<TextEdit> {
  const layouts = await extractPageLayouts(source, { pageIndexes: [0] });
  const page = layouts[0]!;
  const paragraph = page.paragraphs.find((entry) => entry.text.includes(needle))!;
  const lines = paragraph.lineIds
    .map((id) => page.lines.find((line) => line.id === id)!)
    .filter(Boolean);
  const first = lines[0]!;
  return {
    id: 'styled',
    pageIndex: 0,
    find: paragraph.text,
    replace,
    box: paragraph.bbox,
    layout: {
      paragraphId: paragraph.id,
      fontFamily: 'helvetica',
      beforeLines: lines.map((line) => ({ text: line.text, box: line.bbox })),
      reflow: {
        width: 400,
        lineHeight: first.typography.fontSize * 1.25,
        firstBaselineY: first.bbox.y + first.typography.fontSize * 0.82,
        x: paragraph.bbox.x,
      },
      ...extra,
    },
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

describe('text fit (C-08)', () => {
  it('leaves a fitting line at 100% and clamps the outer window', () => {
    expect(fitTextToWidth(100, 200)).toMatchObject({ percent: 100, fitted: false });
    expect(fitTextToWidth(200, 140).percent).toBeCloseTo(70);
    expect(fitTextToWidth(200, 80).percent).toBe(40);
    expect(fitTextToWidth(200, 80).unreadable).toBe(true);
    // A short line is never stretched to fill its box; it stays at 100%.
    expect(fitTextToWidth(100, 250).percent).toBe(100);
    expect(fitTextToWidth(100, 250).fitted).toBe(false);
    // Very long lines clamp at the 40% floor rather than becoming illegible.
    expect(fitTextToWidth(1000, 10).percent).toBe(40);
  });
});

describe('native style (T-06)', () => {
  it('applies size, colour and a standard bold face to the rewritten objects', async () => {
    const source = await makeParagraphFixture();
    const edit = await layoutEdit(source, 'Styled paragraph starts here', {
      style: {
        fontSize: 20,
        color: '#ff0000',
        bold: true,
        align: 'center',
      },
    });
    const result = await editPdfText(
      source,
      { edits: [edit], canvasFactory },
      testContext(),
    );
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('in-place');
    const text = await pageText(result.bytes);
    expect(text).toContain('Styled paragraph');
    const runs = await extractTextRuns(result.bytes, [0]);
    const styled = runs[0]!.find((run) => run.text.includes('Styled paragraph'))!;
    // The size is applied through the object matrix, which is what the reader
    // sees; the original object's nominal size is not mutated.
    expect(styled.fontSize).toBeCloseTo(20, 1);
    const object = await textObjectStartingWith(result.bytes, 'Styled paragraph');
    // Synthetic bold is fill + stroke (render mode 2), not a silent lighter face.
    expect(object?.renderMode).toBe(2);
  });

  it('scales a source object that already has a matrix transform', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    page.node.set(
      PDFName.of('Contents'),
      doc.context.register(
        doc.context.flateStream('BT /F1 12 Tf 2 0 0 2 72 500 Tm (Scaled source) Tj ET\n'),
      ),
    );
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font.ref } }));
    const source = await doc.save({ useObjectStreams: false });
    const edit = await layoutEdit(
      source,
      'Scaled source',
      { style: { fontSize: 36 } },
      'Scaled source',
    );
    const result = await editPdfText(source, { edits: [edit], canvasFactory }, testContext());
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('in-place');
    const runs = await extractTextRuns(result.bytes, [0]);
    const styled = runs[0]!.find((run) => run.text.includes('Scaled source'))!;
    expect(styled.fontSize).toBeCloseTo(36, 0);
  });

  it('keeps the document face when only the colour changes', async () => {
    const source = await makeParagraphFixture();
    const edit = await layoutEdit(source, 'Recoloured paragraph', {
      style: { color: '#ff0000' },
    });
    const result = await editPdfText(
      source,
      { edits: [edit], canvasFactory },
      testContext(),
    );
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('in-place');
    expect(await pageText(result.bytes)).toContain('Recoloured paragraph');
    // No substitution warning: the source face was kept.
    expect(result.warnings.some((warning) => warning.startsWith('font-substituted:'))).toBe(false);
  });
});

describe('rotated text (T-07/C-10)', () => {
  it('rotates a rewritten paragraph and keeps extraction non-horizontal', async () => {
    const source = await makeSingleLineFixture();
    const edit = await layoutEdit(
      source,
      'Rotated paragraph',
      { style: { rotationDeg: 90 } },
      'Rotate this',
    );
    const result = await editPdfText(
      source,
      { edits: [edit], canvasFactory },
      testContext(),
    );
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('in-place');
    const runs = await extractTextRuns(result.bytes, [0]);
    const rotated = runs[0]!.find((run) => run.text.includes('Rotated'));
    expect(rotated?.horizontal, JSON.stringify(runs[0])).toBe(false);
    expect(await pageText(result.bytes)).toContain('Rotated paragraph');
  });

  it('rotates a multi-line paragraph around one pivot, not each line', async () => {
    const source = await makeTwoLineFixture();
    const edit = await layoutEdit(
      source,
      'First line of block\nSecond line of block',
      { style: { rotationDeg: 90 } },
      'First line',
    );
    edit.fallback = [
      {
        id: 'rotated-block',
        kind: 'text',
        pageIndex: 0,
        x: edit.box!.x,
        y: edit.box!.y,
        width: 240,
        height: 60,
        text: 'First line of block\nSecond line of block',
        fontSize: 14,
        rotationDeg: 90,
        rasterFallback: true,
      },
    ];
    const result = await editPdfText(source, { edits: [edit], canvasFactory }, testContext());
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('fallback');
    const runs = await extractTextRuns(result.bytes, [0]);
    // The fallback leaves the original horizontal lines under the overlay, so
    // look at the new vertical runs specifically.
    const block = runs[0]!.filter(
      (run) =>
        !run.horizontal &&
        (run.text.includes('First line') || run.text.includes('Second line')),
    );
    expect(block.length).toBe(2);
    // Lines must not stack on the same anchor after rotation.
    expect(Math.abs(block[0]!.x - block[1]!.x)).toBeGreaterThan(5);
  });

  it('rotates a multi-line overlay block around one pivot', async () => {
    const source = await makeTwoLineFixture();
    const result = await editPdfText(
      source,
      {
        edits: [],
        objects: [
          {
            id: 'rotated-lines',
            kind: 'text',
            pageIndex: 0,
            x: 72,
            y: 200,
            width: 220,
            height: 40,
            text: 'Alpha line\nBeta line',
            fontSize: 14,
            rotationDeg: 90,
            rasterFallback: true,
          },
        ],
        canvasFactory,
        verifyVisual: false,
      },
      testContext(),
    );
    const runs = await extractTextRuns(result.bytes, [0]);
    const block = runs[0]!.filter(
      (run) => run.text.includes('Alpha line') || run.text.includes('Beta line'),
    );
    expect(block.length).toBe(2);
    expect(block.every((run) => !run.horizontal)).toBe(true);
    expect(Math.abs(block[0]!.x - block[1]!.x)).toBeGreaterThan(5);
  });

  it('removes glyphs from 180- and 270-degree stream fixtures', async () => {
    for (const matrix of ['-1 0 0 -1 340 240', '0 -1 1 0 40 60']) {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([400, 300]);
      page.node.set(
        PDFName.of('Contents'),
        doc.context.register(
          doc.context.flateStream(`BT /F1 18 Tf ${matrix} Tm (ROTATED) Tj ET\n`),
        ),
      );
      page.node.set(
        PDFName.of('Resources'),
        doc.context.obj({ Font: { F1: font.ref } }),
      );
      const bytes = await doc.save({ useObjectStreams: false });
      const fonts = await readFontCharcodes(bytes);
      const result = await applyContentStreamEdits(
        bytes,
        [{ id: 'delete', pageIndex: 0, find: 'ROTATED', replace: '' }],
        fonts,
        testContext(),
      );
      expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('content-stream');
      expect(await pageText(result.bytes)).not.toContain('ROTATED');
    }
  });
});

describe('leftover covers (C-07)', () => {
  it('adds a receipted patch over a completed deletion on a white page', async () => {
    const source = await makeParagraphFixture();
    const edit: TextEdit = {
      id: 'delete',
      pageIndex: 0,
      find: 'KEEP THIS NEIGHBOUR',
      replace: '',
      box: { x: 70, y: 160, width: 140, height: 18 },
      coverPolicy: 'leftover-cover',
    };
    const result = await editPdfText(
      source,
      { edits: [edit], canvasFactory, verifyVisual: false },
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('in-place');
    expect(result.covers).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => warning.startsWith('leftover-cover:'))).toBe(true);
  });

  it('never patches a replacement, because that would hide the new glyphs', async () => {
    const source = await makeParagraphFixture();
    const result = await editPdfText(
      source,
      {
        edits: [
          {
            id: 'replace',
            pageIndex: 0,
            find: 'KEEP THIS NEIGHBOUR',
            replace: 'NEW NEIGHBOUR',
            box: { x: 70, y: 160, width: 140, height: 18 },
            coverPolicy: 'leftover-cover',
          },
        ],
        canvasFactory,
        verifyVisual: false,
      },
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('in-place');
    expect(result.covers).toBe(0);
    expect(await pageText(result.bytes)).toContain('NEW NEIGHBOUR');
  });

  it('reports the exact removed glyph box, not the caller line box', async () => {
    const fixture = await buildTextSurgeryFixture('partial-word');
    const fonts = await readFontCharcodes(fixture.bytes);
    const lineBox = { x: 30, y: 40, width: 220, height: 30 };
    const stream = await applyContentStreamEdits(
      fixture.bytes,
      [{ id: 'word', pageIndex: 0, find: '2026', replace: '', box: lineBox }],
      fonts,
      testContext(),
    );
    expect(stream.outcomes[0]!.mode).toBe('content-stream');
    expect(stream.outcomes[0]!.removedBox).toBeDefined();
    expect(stream.outcomes[0]!.removedBox!.width).toBeLessThan(lineBox.width / 2);
    const text = await pageText(stream.bytes);
    expect(text).toContain('INVOICE');
    expect(text).toContain('0042');
    expect(text).not.toContain('2026');
  });

  it('skips the patch on a coloured background and says why', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawRectangle({ x: 0, y: 0, width: 400, height: 300, color: rgb(0.1, 0.3, 0.8) });
    page.drawText('DELETE ME', { x: 60, y: 140, size: 18, font, color: rgb(1, 1, 1) });
    const source = await doc.save({ useObjectStreams: false });
    const result = await editPdfText(
      source,
      {
        edits: [
          {
            id: 'delete',
            pageIndex: 0,
            find: 'DELETE ME',
            replace: '',
            box: { x: 55, y: 120, width: 110, height: 28 },
            coverPolicy: 'leftover-cover',
          },
        ],
        canvasFactory,
        verifyVisual: false,
      },
      testContext(),
    );
    expect(result.covers).toBe(0);
    expect(result.warnings.some((warning) => warning.startsWith('leftover-cover-skipped:'))).toBe(
      true,
    );
  });
});

describe('raster fallback (C-09)', () => {
  it('draws an unencodable replacement as an image and does not expect its text', async () => {
    const source = await makeParagraphFixture();
    const fallback: EditorObject[] = [
      {
        id: 'cover',
        kind: 'whiteout',
        pageIndex: 0,
        x: 70,
        y: 150,
        width: 220,
        height: 24,
      },
      {
        id: 'glyphs',
        kind: 'text',
        pageIndex: 0,
        x: 72,
        y: 150,
        width: 240,
        height: 24,
        text: 'Signed \u{1F600}',
        fontSize: 14,
        fontFamily: 'helvetica',
        rasterFallback: true,
      },
    ];
    const result = await editPdfText(
      source,
      {
        edits: [
          {
            id: 'glyphs',
            pageIndex: 0,
            find: 'KEEP THIS NEIGHBOUR',
            replace: 'Signed \u{1F600}',
            box: { x: 70, y: 150, width: 220, height: 24 },
            fallback,
          },
        ],
        canvasFactory,
        verifyVisual: false,
      },
      testContext(),
    );
    expect(result.fallback).toBe(1);
    expect(result.rasterised).toBe(1);
    expect(result.outcomes[0]!.rasterised).toBe(true);
    expect(result.warnings.some((warning) => warning.startsWith('glyph-rasterised:'))).toBe(true);
    const text = await pageText(result.bytes);
    expect(text).not.toContain('KEEP THIS NEIGHBOUR');
    expect(text).not.toContain('\u{1F600}');
  });
});

describe('ink colour (C-11)', () => {
  it('samples a red heading from the rendered page', async () => {
    const source = await makeParagraphFixture(rgb(0.85, 0.1, 0.1));
    const layouts = await extractPageLayouts(source, {
      pageIndexes: [0],
      includeColors: true,
      canvasFactory,
    });
    const paragraph = layouts[0]!.paragraphs.find((entry) => entry.text.includes('Reflow'))!;
    expect(paragraph.typography.color).toMatch(/^#[0-9a-f]{6}$/);
    const red = Number.parseInt(paragraph.typography.color!.slice(1, 3), 16);
    const green = Number.parseInt(paragraph.typography.color!.slice(3, 5), 16);
    expect(red).toBeGreaterThan(120);
    expect(red).toBeGreaterThan(green + 40);
  });
});

describe('rotated fixture sanity', () => {
  it('the corpus rotated fixture is still removable through the stream path', async () => {
    const fixture = await buildTextSurgeryFixture('rotated');
    const fonts = await readFontCharcodes(fixture.bytes);
    const result = await applyContentStreamEdits(
      fixture.bytes,
      [{ id: 'rot', pageIndex: 0, find: 'ROTATED', replace: '' }],
      fonts,
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('content-stream');
    expect(await pageText(result.bytes)).not.toContain('ROTATED');
  });
});
