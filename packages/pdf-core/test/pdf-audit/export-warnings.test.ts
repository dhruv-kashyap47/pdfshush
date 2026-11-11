/**
 * PDF-EXPORT-002/003 (session 6 decisions).
 *
 * Transparent images are still exported as opaque RGB, but the result now says
 * so through `warnings[]` instead of hiding the loss. PDF-to-images names each
 * file by its source page number, so a subset keeps a self-identifying name.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import { imagesJob } from '../../src/jobs/images.job.js';
import { pdfToImagesFileNames } from '../../src/jobs/pdfToImages.job.js';
import { testContext } from '../fixtures.js';

async function transparentImagePdf(): Promise<Uint8Array> {
  const canvas = createCanvas(8, 8);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, 8, 8);
  context.fillStyle = 'rgba(220, 30, 30, 0.5)';
  context.fillRect(0, 0, 8, 8);
  const png = await canvas.encode('png');

  const doc = await PDFDocument.create();
  const image = await doc.embedPng(png);
  doc.addPage([50, 50]).drawImage(image, { x: 0, y: 0, width: 50, height: 50 });
  return doc.save({ useObjectStreams: false });
}

describe('extract-images transparency warning (PDF-EXPORT-002)', () => {
  it('reports an image whose alpha channel was dropped', async () => {
    const out = await imagesJob.run(
      { files: [{ name: 'alpha.pdf', data: await transparentImagePdf() }] },
      testContext(),
    );
    expect(out.files.some((file) => file.alphaDropped)).toBe(true);
    expect(out.warnings?.join(' ')).toMatch(/transparen|alpha/i);
  });

  it('stays quiet when no image had an alpha channel', async () => {
    const canvas = createCanvas(8, 8);
    const context = canvas.getContext('2d');
    context.fillStyle = '#336699';
    context.fillRect(0, 0, 8, 8);
    const png = await canvas.encode('png');
    const doc = await PDFDocument.create();
    const image = await doc.embedPng(png);
    doc.addPage([50, 50]).drawImage(image, { x: 0, y: 0, width: 50, height: 50 });

    const out = await imagesJob.run(
      { files: [{ name: 'opaque.pdf', data: await doc.save({ useObjectStreams: false }) }] },
      testContext(),
    );
    expect(out.warnings ?? []).toEqual([]);
  });
});

describe('pdf-to-images source page names (PDF-EXPORT-003)', () => {
  it('names a subset by source page number, not selection position', () => {
    expect(pdfToImagesFileNames('deck', [2, 4], 5, 'jpeg')).toEqual([
      'deck-3.jpg',
      'deck-5.jpg',
    ]);
    // A 120-page document keeps its existing zero padding.
    expect(pdfToImagesFileNames('deck', [1], 120, 'jpeg')).toEqual(['deck-002.jpg']);
  });

  it('keeps the all-pages names unchanged', () => {
    expect(pdfToImagesFileNames('deck', [0, 1, 2], 3, 'png')).toEqual([
      'deck-1.png',
      'deck-2.png',
      'deck-3.png',
    ]);
  });
});
