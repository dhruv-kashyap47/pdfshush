import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import {
  applyContentStreamEdits,
  configurePdfjsRuntime,
  readFontCharcodes,
} from '../src/index.js';
import { assertGoldenExport, inspectExport } from './golden.js';
import { testContext } from './fixtures.js';

beforeAll(() => {
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
      .href,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  });
});

async function twoPageInvoice(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([400, 300]);
  first.drawText('INVOICE 2026-0042', { x: 40, y: 240, size: 18, font });
  const second = doc.addPage([400, 300]);
  second.drawText('SECOND PAGE', { x: 40, y: 240, size: 18, font });
  return doc.save({ useObjectStreams: false });
}

describe('golden export corpus (G-03)', () => {
  it('prints one pass/fail report for a stream deletion with an untouched page', async () => {
    const source = await twoPageInvoice();
    const sourceInfo = await inspectExport(source);
    const fonts = await readFontCharcodes(source);
    const result = await applyContentStreamEdits(
      source,
      [{ id: 'cut', pageIndex: 0, find: '2026', replace: '' }],
      fonts,
      testContext(),
    );
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('content-stream');

    const inspected = await assertGoldenExport(result.bytes, {
      pageCount: 2,
      pages: [
        { width: 400, height: 300, rotation: 0 },
        { width: 400, height: 300, rotation: 0 },
      ],
      contains: ['INVOICE', '0042'],
      absent: ['2026'],
      untouchedText: { 1: 'SECOND PAGE' },
      untouchedHashes: { 1: sourceInfo.hashes[1]! },
    });
    expect(inspected.pageCount).toBe(2);
  });

  it('fails loudly with the page and hash when an untouched page changes', async () => {
    const source = await twoPageInvoice();
    const fonts = await readFontCharcodes(source);
    const result = await applyContentStreamEdits(
      source,
      [{ id: 'cut', pageIndex: 0, find: '2026', replace: '' }],
      fonts,
      testContext(),
    );
    await expect(
      assertGoldenExport(
        result.bytes,
        { untouchedHashes: { 1: 'deadbeef:11' } },
        'negative control',
      ),
    ).rejects.toThrow(/page 2 text fingerprint/);
  });
});
