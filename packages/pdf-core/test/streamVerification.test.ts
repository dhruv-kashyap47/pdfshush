import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import {
  configurePdfjsRuntime,
  verifyExportArtifact,
} from '../src/index.js';
import { testContext } from './fixtures.js';

beforeAll(() => {
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
      .href,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  });
});

async function twoPages(
  first: string,
  second: string,
  options: { rotation?: number } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pageOne = doc.addPage([400, 300]);
  pageOne.drawText(first, { x: 40, y: 240, size: 18, font });
  const pageTwo = doc.addPage([400, 300]);
  pageTwo.drawText(second, { x: 40, y: 240, size: 18, font });
  if (options.rotation) pageTwo.setRotation(degrees(options.rotation));
  return doc.save({ useObjectStreams: false });
}

const REGION = [{ pageIndex: 0, box: { x: 30, y: 30, width: 200, height: 40 } }];

describe('post-write verification completion (C-12)', () => {
  it('fingerprints untouched pages and passes when only the edited page changed', async () => {
    const original = await twoPages('OLD TEXT', 'SECOND PAGE');
    const output = await twoPages('NEW TEXT', 'SECOND PAGE');
    const verification = await verifyExportArtifact({
      original,
      output,
      expectedPageCount: 2,
      expectations: [{ label: 'e', pageIndex: 0, expect: 'NEW TEXT' }],
      editedRegions: REGION,
      visual: false,
      ctx: testContext(),
    });
    expect(verification.ok).toBe(true);
    const untouched = verification.checks.find(
      (check) => check.name === 'untouched-page-text:page-2',
    );
    expect(untouched?.ok).toBe(true);
    expect(untouched?.detail).toMatch(/unchanged/);
  });

  it('fails when an untouched page text changed without an edit region', async () => {
    const original = await twoPages('OLD TEXT', 'SECOND PAGE');
    const output = await twoPages('NEW TEXT', 'CHANGED PAGE');
    const verification = await verifyExportArtifact({
      original,
      output,
      expectedPageCount: 2,
      expectations: [{ label: 'e', pageIndex: 0, expect: 'NEW TEXT' }],
      editedRegions: REGION,
      visual: false,
      ctx: testContext(),
    });
    expect(verification.ok).toBe(false);
    const untouched = verification.checks.find(
      (check) => check.name === 'untouched-page-text:page-2',
    );
    expect(untouched?.ok).toBe(false);
    expect(untouched?.detail).toMatch(/changed/);
  });

  it('fails when a page rotation changed even though its text did not', async () => {
    const original = await twoPages('OLD TEXT', 'SECOND PAGE');
    const output = await twoPages('NEW TEXT', 'SECOND PAGE', { rotation: 90 });
    const verification = await verifyExportArtifact({
      original,
      output,
      expectedPageCount: 2,
      expectations: [{ label: 'e', pageIndex: 0, expect: 'NEW TEXT' }],
      editedRegions: REGION,
      visual: false,
      ctx: testContext(),
    });
    expect(verification.ok).toBe(false);
    const rotation = verification.checks.find((check) => check.name === 'page-rotation');
    expect(rotation?.ok).toBe(false);
  });
});
