/**
 * Native text-object creation regression (Sprint 6).
 *
 * The bundled PDFium build cannot initialise an object from
 * `FPDFPageObj_CreateTextObj(FPDF_FONT, …)`: `SetMatrix`/`SetText` trap. It can
 * create a standard-14 object through
 * `FPDFPageObj_NewTextObj(document, font_name, size)`. These tests pin the
 * exact create → set text → set matrix → insert → generate → save → reopen →
 * extract sequence, and prove native reflow uses it for extra lines.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import {
  configurePdfiumRuntime,
  configurePdfjsRuntime,
  editPdfText,
  extractPageLayouts,
  extractTextRuns,
  loadPdfiumModule,
  type TextEdit,
} from '../src/index.js';
import { PdfiumTextDocument } from '../src/textedit/pdfium.js';
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

async function pageText(bytes: Uint8Array, pageIndex = 0): Promise<string> {
  const runs = await extractTextRuns(bytes, [pageIndex]);
  return runs[0]!.map((run) => run.text).join('\n');
}

async function simpleSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText('Existing', { x: 40, y: 200, size: 12, font });
  return doc.save({ useObjectStreams: false });
}

async function wideTwoLineSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText(
    'Native reflow starts on this long first line and continues across the width of the page',
    { x: 72, y: 700, size: 12, font },
  );
  page.drawText('and ends on the second line', { x: 72, y: 686, size: 12, font });
  return doc.save({ useObjectStreams: false });
}

describe('native standard-font text-object creation', () => {
  it('creates, writes, places, inserts, generates, saves and extracts', async () => {
    const source = await simpleSource();
    const module = await loadPdfiumModule();
    const doc = PdfiumTextDocument.open(module, source, '');
    try {
      const faces: Array<[string, string, number]> = [
        ['Helvetica', 'Helvetica regular', 100],
        ['Helvetica-Bold', 'Helvetica bold', 80],
        ['Times-Italic', 'Times italic', 60],
        ['Courier-BoldOblique', 'Courier bold oblique', 40],
      ];
      for (const [face, text, y] of faces) {
        const object = doc.createStandardTextObject(
          0,
          face,
          12,
          text,
          [1, 0, 0, 1, 100, y],
          { r: 0, g: 0, b: 0, a: 1 },
          0,
        );
        expect(object, `${face}: ${doc.lastCreateError}`).toBeGreaterThan(0);
      }
      expect(doc.generate(0)).toBe(true);
      const saved = doc.serialize();
      const text = await pageText(saved);
      for (const [, line] of faces) expect(text).toContain(line);
      expect(text).toContain('Existing');
    } finally {
      doc.close();
    }
  });

  it('uses NewTextObj for extra reflow lines instead of falling back', async () => {
    const source = await wideTwoLineSource();
    const layouts = await extractPageLayouts(source, { pageIndexes: [0] });
    const page = layouts[0]!;
    const paragraph = page.paragraphs.find((entry) => entry.text.includes('Native reflow'))!;
    const lines = paragraph.lineIds
      .map((id) => page.lines.find((line) => line.id === id)!)
      .filter(Boolean);
    const first = lines[0]!;
    const edit: TextEdit = {
      id: 'grow',
      pageIndex: 0,
      find: paragraph.text,
      replace:
        'native line creation proves this can work and keep going for several more wrapped lines without an overlay fallback at all '.repeat(
          3,
        ),
      box: paragraph.bbox,
      layout: {
        paragraphId: paragraph.id,
        fontFamily: 'helvetica',
        beforeLines: lines.map((line) => ({ text: line.text, box: line.bbox })),
        reflow: {
          width: Math.max(...lines.map((line) => line.bbox.width)) + 40,
          lineHeight: first.typography.fontSize * 1.25,
          firstBaselineY: first.bbox.y + first.typography.fontSize * 0.82,
          x: paragraph.bbox.x,
        },
      },
    };
    const result = await editPdfText(source, { edits: [edit] }, testContext());
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('in-place');
    expect(result.fallback).toBe(0);
    const runs = await extractTextRuns(result.bytes, [0]);
    const created = runs[0]!.filter((run) => run.y < first.bbox.y + 160);
    expect(created.length).toBeGreaterThan(2);
    const text = await pageText(result.bytes);
    expect(text).toContain('native line creation proves');
    expect(text).toContain('without an overlay fallback');
  });
});
