import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import {
  configurePdfiumRuntime,
  configurePdfjsRuntime,
  editPdfText,
  loadPdfiumModule,
} from '../src/index.js';
import { assertGoldenExport } from './golden.js';
import { testContext } from './fixtures.js';

function readPdfiumWasm(): Uint8Array {
  const proc = (globalThis as unknown as {
    process: { getBuiltinModule(name: string): unknown };
  }).process;
  const fs = proc.getBuiltinModule('node:fs') as { readFileSync(path: URL): Uint8Array };
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

async function twoPageFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([400, 300]);
  first.drawText('KEEP THIS', { x: 40, y: 240, size: 18, font });
  const second = doc.addPage([400, 300]);
  second.drawText('SECOND PAGE', { x: 40, y: 240, size: 18, font });
  return doc.save({ useObjectStreams: false });
}

describe('golden export harness (G-03)', () => {
  it('checks page metadata, replacement presence, absence and untouched pages', async () => {
    const source = await twoPageFixture();
    const result = await editPdfText(
      source,
      {
        edits: [{ id: 'golden', pageIndex: 0, find: 'KEEP THIS', replace: 'GOLDEN TEXT' }],
      },
      testContext(),
    );

    const inspected = await assertGoldenExport(
      result.bytes,
      {
        pageCount: 2,
        pages: [
          { width: 400, height: 300 },
          { width: 400, height: 300 },
        ],
        contains: ['GOLDEN TEXT'],
        absent: ['KEEP THIS'],
        untouchedText: { 1: 'SECOND PAGE' },
      },
      'native replacement',
    );
    expect(inspected.pageCount).toBe(2);
  });

  it('fails loudly when an untouched page text changes', async () => {
    const source = await twoPageFixture();
    const result = await editPdfText(source, { edits: [] }, testContext());
    await expect(
      assertGoldenExport(
        result.bytes,
        { untouchedText: { 1: 'NOT THE SAME' } },
        'negative control',
      ),
    ).rejects.toThrow(/page 2 text changed/);
  });
});
