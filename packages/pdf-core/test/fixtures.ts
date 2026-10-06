import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import type { JobContext, JobProgress } from '../src/job.js';

/** A deterministic single-file test context (no abort, no timing). */
export function testContext(onProgress?: (p: JobProgress) => void): JobContext {
  return {
    signal: new AbortController().signal,
    env: 'node',
    onProgress: onProgress ?? (() => {}),
    throwIfAborted() {},
  };
}

/** Builds a real, valid PDF with `pageCount` pages of known distinct sizes. */
export async function makeFixturePdf(options: {
  pages?: number;
  label?: string;
  width?: number;
  height?: number;
} = {}): Promise<Uint8Array> {
  const { pages = 3, label = 'PDFShush', width = 595, height = 842 } = options;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < pages; i += 1) {
    // Vary the size per page so page-copy assertions are meaningful.
    const page = doc.addPage([width + i, height]);
    page.drawText(`${label} page ${i + 1}`, {
      x: 24,
      y: height - 60,
      size: 18,
      font,
      color: rgb(0.05, 0.4, 0.3),
    });
  }

  return doc.save();
}