/**
 * OCR (2026-11-08).
 *
 * Three things are pinned here, none of which need a recognizer:
 *
 *  - sanitization: WinAnsi cannot encode everything Tesseract returns, and one
 *    unsupported code point would fail the whole page;
 *  - placement: image pixels map to PDF points, and touching word boxes still
 *    leave a gap so extraction keeps its spaces;
 *  - the invisible layer is actually extractable: pdf.js rebuilds the text a
 *    user would copy, not just the operators we emitted.
 */

import { describe, expect, test } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import {
  OCR_LIMITS,
  buildOcrPlacements,
  configurePdfjsRuntime,
  drawOcrTextLayer,
  extractTextRuns,
  ocrJob,
  ocrTimeoutForPageCount,
  sanitizeOcrText,
  type OcrPage,
} from '../src/index.js';
import { JOBS } from '../src/jobs/registry.js';
import { JOB_SLUGS } from '../src/jobs/slugs.js';
import { WORKFLOW_OUTPUT_JOBS } from '../src/workflow.js';
import { makeFixturePdf, testContext } from './fixtures.js';

configurePdfjsRuntime({
  workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href,
});

describe('OCR text sanitization', () => {
  test('maps curly punctuation and ligatures to encodable ASCII', () => {
    expect(sanitizeOcrText('\u201cInvoice\u201d \u2014 total\u2026')).toBe('"Invoice" - total...');
    expect(sanitizeOcrText('of\ufb01ce')).toBe('office');
    expect(sanitizeOcrText("don\u2019t")).toBe("don't");
  });

  test('keeps Latin-1 but drops code points WinAnsi cannot carry', () => {
    expect(sanitizeOcrText('caf\u00e9 \u00a3 42')).toBe('caf\u00e9 \u00a3 42');
    expect(sanitizeOcrText('\u4e2d\u6587')).toBe('');
    expect(sanitizeOcrText('\u00adsoft')).toBe('soft');
  });

  test('collapses whitespace so one word becomes one text run', () => {
    expect(sanitizeOcrText('  INVOICE\t\n2026  ')).toBe('INVOICE 2026');
    expect(sanitizeOcrText('\u200b')).toBe('');
    expect(sanitizeOcrText('')).toBe('');
  });
});

/** One scanned-looking line: image pixels, top-left origin. */
function syntheticPage(): OcrPage {
  return {
    confidence: 91,
    lines: [
      {
        text: 'INVOICE 2026',
        confidence: 92,
        // 1000x500 image; the first word butts against the second.
        box: { x0: 100, y0: 100, x1: 400, y1: 150 },
        baseline: { x0: 100, y0: 145, x1: 400, y1: 145 },
        words: [
          { text: 'INVOICE', confidence: 94, box: { x0: 100, y0: 100, x1: 260, y1: 150 } },
          { text: '2026', confidence: 90, box: { x0: 260, y0: 100, x1: 400, y1: 150 } },
        ],
      },
      {
        text: 'TOTAL 42',
        confidence: 88,
        box: { x0: 100, y0: 200, x1: 320, y1: 240 },
        words: [
          { text: 'TOTAL', confidence: 89, box: { x0: 100, y0: 200, x1: 240, y1: 240 } },
          { text: '42', confidence: 87, box: { x0: 250, y0: 200, x1: 320, y1: 240 } },
          // A box with no recognized glyphs must not become a placement.
          { text: '   ', confidence: 0, box: { x0: 320, y0: 200, x1: 340, y1: 240 } },
        ],
      },
    ],
  };
}

const MAPPING = {
  imageWidthPx: 1000,
  imageHeightPx: 500,
  pageWidthPt: 500,
  pageHeightPt: 250,
};

describe('OCR placement', () => {
  test('maps pixels to PDF points with a bottom-left origin', () => {
    const placements = buildOcrPlacements(syntheticPage(), MAPPING);
    const invoice = placements.find((placement) => placement.text === 'INVOICE')!;
    expect(invoice).toBeDefined();
    expect(invoice.x).toBeCloseTo(50, 5);
    expect(invoice.width).toBeCloseTo(80, 5);
    // Baseline y=145 in a 500 px image -> 250 - 72.5 = 177.5 pt.
    expect(invoice.y).toBeCloseTo(177.5, 5);
    expect(invoice.fontSize).toBeCloseTo(19.5, 5);
  });

  test('reserves a gap after each word so extraction keeps a space', () => {
    const placements = buildOcrPlacements(syntheticPage(), MAPPING);
    const invoice = placements.find((placement) => placement.text === 'INVOICE')!;
    const year = placements.find((placement) => placement.text === '2026')!;
    // The image boxes touch (260 px === 130 pt), so the second word may only
    // start after the first run plus a 0.2 em gap.
    expect(year.x).toBeGreaterThanOrEqual(invoice.x + invoice.width + invoice.fontSize * 0.19);
  });

  test('drops empty words and refuses an impossible mapping', () => {
    const placements = buildOcrPlacements(syntheticPage(), MAPPING);
    expect(placements.map((placement) => placement.text)).toEqual([
      'INVOICE',
      '2026',
      'TOTAL',
      '42',
    ]);
    expect(buildOcrPlacements(syntheticPage(), { ...MAPPING, imageWidthPx: 0 })).toEqual([]);
    expect(buildOcrPlacements(syntheticPage(), { ...MAPPING, pageHeightPt: Number.NaN })).toEqual(
      [],
    );
  });

  test('keeps every word on a line at one font size', () => {
    const placements = buildOcrPlacements(syntheticPage(), MAPPING);
    const firstLine = placements.slice(0, 2);
    expect(firstLine[0]!.fontSize).toBe(firstLine[1]!.fontSize);
  });
});

describe('invisible OCR text layer', () => {
  test('pdf.js extracts the hidden words with their spaces', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([MAPPING.pageWidthPt, MAPPING.pageHeightPt]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    drawOcrTextLayer(page, font, buildOcrPlacements(syntheticPage(), MAPPING));

    const bytes = await doc.save({ useObjectStreams: false });
    const runs = (await extractTextRuns(bytes, [0], testContext()))[0]!;
    const text = runs.map((run) => run.text).join('\n');

    expect(text).toContain('INVOICE 2026');
    expect(text).toContain('TOTAL 42');
  });

  test('a run wider than its box still fits, so words do not overlap neighbours', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 100]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    drawOcrTextLayer(page, font, [
      { text: 'WWWWWWWWWW', x: 10, y: 40, width: 40, fontSize: 20 },
    ]);

    const bytes = await doc.save({ useObjectStreams: false });
    const runs = (await extractTextRuns(bytes, [0], testContext()))[0]!;
    const run = runs.find((entry) => entry.text.includes('WWWW'))!;
    expect(run).toBeDefined();
    expect(run.x + run.width).toBeLessThanOrEqual(10 + 40 + 1);
  });

  test('a single glyph wider than its box shrinks instead of overflowing', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 100]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // One character has no inter-glyph gap to compress, so character spacing
    // cannot save it; the draw step must reduce the type size.
    drawOcrTextLayer(page, font, [
      { text: 'W', x: 10, y: 40, width: 2, fontSize: 20 },
    ]);

    const bytes = await doc.save({ useObjectStreams: false });
    const runs = (await extractTextRuns(bytes, [0], testContext()))[0]!;
    const run = runs.find((entry) => entry.text.includes('W'))!;
    expect(run).toBeDefined();
    expect(run.x + run.width).toBeLessThanOrEqual(10 + 2 + 1);
  });
});

describe('OCR job', () => {
  test('slug is registered and can feed a workflow', () => {
    expect(ocrJob.slug).toBe('ocr');
    expect(JOB_SLUGS).toContain('ocr');
    expect(JOBS.ocr).toBe(ocrJob);
    expect(WORKFLOW_OUTPUT_JOBS.has('ocr')).toBe(true);
  });

  test('validate: exactly one file and bounded options', async () => {
    const source = await makeFixturePdf();
    const files = [{ name: 'scan.pdf', type: 'application/pdf', data: source }];
    expect(ocrJob.validate({ files })).toMatchObject({ ok: true });
    expect(
      ocrJob.validate({
        files,
        options: { targetWidthPx: OCR_LIMITS.defaultWidthPx, quality: 0.9 },
      }),
    ).toMatchObject({ ok: true });
    expect(ocrJob.validate({ files, options: { targetWidthPx: 100 } })).toMatchObject({
      ok: false,
    });
    expect(ocrJob.validate({ files, options: { targetWidthPx: 4001 } })).toMatchObject({
      ok: false,
    });
    expect(ocrJob.validate({ files, options: { quality: 0.2 } })).toMatchObject({ ok: false });
    expect(ocrJob.validate({ files, options: { quality: 1.1 } })).toMatchObject({ ok: false });
    expect(ocrJob.validate({ files: [...files, ...files] })).toMatchObject({ ok: false });
  });

  test('run in Node refuses instead of emitting a text layer it cannot verify', async () => {
    const source = await makeFixturePdf();
    await expect(
      ocrJob.run({ files: [{ name: 'scan.pdf', data: source }] }, testContext()),
    ).rejects.toThrow(/canvas/);
  });

  test('estimate keeps the recognition timeout well above pdf-lib page work', async () => {
    const source = await makeFixturePdf();
    const estimate = ocrJob.estimate({ files: [{ name: 'scan.pdf', data: source }] }, 10);
    expect(estimate.pageCount).toBe(10);
    expect(estimate.timeoutMs).toBe(ocrTimeoutForPageCount(10));
    expect(estimate.timeoutMs).toBeGreaterThan(5 * 60_000);
    expect(estimate.memoryBytes).toBeGreaterThan(source.length * 3);
  });

  test('timeout grows per page but never exceeds the global job ceiling', () => {
    expect(ocrTimeoutForPageCount(1)).toBe(OCR_LIMITS.timeoutBaseMs);
    expect(ocrTimeoutForPageCount(10)).toBeGreaterThan(ocrTimeoutForPageCount(2));
    expect(ocrTimeoutForPageCount(100_000)).toBeLessThanOrEqual(15 * 60_000);
  });
});
