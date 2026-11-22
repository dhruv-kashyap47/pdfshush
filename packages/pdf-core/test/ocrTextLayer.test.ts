/**
 * O-02/O-03: the editor's text-layer OCR pass.
 *
 * Recognition and rendering are injected here, so the parts that can lose a
 * document — page preservation, coordinate mapping, verification — run in Node
 * without Tesseract or a canvas.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { addOcrTextLayer } from '../src/ocr/textLayer.js';
import { summarizeOcrPage } from '../src/ocr/layout.js';
import { ocrTextLayerJob } from '../src/jobs/ocrTextLayer.job.js';
import { JOBS } from '../src/jobs/registry.js';
import { JOB_SLUGS } from '../src/jobs/slugs.js';
import { WORKFLOW_OUTPUT_JOBS } from '../src/workflow.js';
import { configurePdfjsRuntime } from '../src/render/pdfjsRuntime.js';
import { extractTextRuns } from '../src/render/textRuns.js';
import { loadPdfDocument } from '../src/ops/pages.js';
import type { OcrEngine, OcrPage } from '../src/ocr/types.js';
import { testContext } from './fixtures.js';

beforeAll(() => {
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
      .href,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  });
});

function recognized(): OcrPage {
  return {
    confidence: 92,
    lines: [
      {
        text: 'INVOICE 2026',
        confidence: 94,
        baseline: { x0: 40, y0: 145, x1: 400, y1: 145 },
        box: { x0: 40, y0: 100, x1: 400, y1: 150 },
        words: [
          { text: 'INVOICE', confidence: 95, box: { x0: 40, y0: 100, x1: 240, y1: 150 } },
          { text: '2026', confidence: 93, box: { x0: 250, y0: 100, x1: 400, y1: 150 } },
        ],
      },
    ],
  };
}

function fakeEngine(): OcrEngine {
  return {
    async recognize() {
      return recognized();
    },
    async terminate() {
      // no resources
    },
  };
}

function fakeRender(width: number, height: number) {
  return async () => ({ data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width, height });
}

async function scanSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Scanned fixture');
  doc.setAuthor('pdfshush');
  doc.addPage([500, 250]);
  const textPage = doc.addPage([500, 250]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  textPage.drawText('ALREADY HAS TEXT LAYER', { x: 20, y: 100, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

describe('O-02 text-layer-only OCR', () => {
  test('adds text to a scan, skips a text page and preserves the document', async () => {
    const source = await scanSource();
    const result = await addOcrTextLayer(
      source,
      {
        pageIndexes: [0, 1],
        engineFactory: fakeEngine,
        renderPage: fakeRender(1000, 500),
      },
      testContext(),
    );

    expect(result.pageCount).toBe(2);
    expect(result.ocrPages).toEqual([1]);
    expect(result.skippedPages).toEqual([2]);
    expect(result.pages[0]?.confidence).toBeGreaterThan(90);
    expect(result.pages[0]?.wordCount).toBe(2);
    expect(result.warnings.join(' ')).toMatch(/ocr-skipped: page 2/);

    const runs = await extractTextRuns(result.data, [0, 1], testContext());
    expect(runs[0]!.map((run) => run.text).join(' ')).toContain('INVOICE 2026');
    expect(runs[1]!.map((run) => run.text).join(' ')).toContain('ALREADY HAS TEXT LAYER');

    const output = await loadPdfDocument(result.data);
    expect(output.getTitle()).toBe('Scanned fixture');
    expect(output.getPageCount()).toBe(2);
    expect(output.getPage(0).getSize()).toEqual({ width: 500, height: 250 });
  }, 60_000);

  test('maps a /Rotate 90 page back into its unrotated coordinates', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 400]);
    page.setRotation(degrees(90));
    const source = await doc.save({ useObjectStreams: false });

    const result = await addOcrTextLayer(
      source,
      {
        pageIndexes: [0],
        engineFactory: fakeEngine,
        // Rotated viewport: 400 wide x 600 tall.
        renderPage: fakeRender(400, 600),
      },
      testContext(),
    );
    const runs = (await extractTextRuns(result.data, [0], testContext()))[0]!;
    const text = runs.map((run) => run.text).join(' ');
    expect(text).toContain('INVOICE 2026');
    // Display-space x (40 px of a 400 px viewport over 400 pt) is unchanged by
    // the page rotation; a transform bug would push it to the far edge.
    const invoice = runs.find((run) => run.text.includes('INVOICE'))!;
    expect(invoice.x).toBeGreaterThan(20);
    expect(invoice.x).toBeLessThan(80);
  }, 60_000);

  test('maps /Rotate 180 and 270 pages back into their unrotated coordinates', async () => {
    for (const [rotation, width, height] of [
      [180, 600, 400],
      [270, 400, 600],
    ] as const) {
      const doc = await PDFDocument.create();
      const page = doc.addPage([600, 400]);
      page.setRotation(degrees(rotation));
      const source = await doc.save({ useObjectStreams: false });
      const result = await addOcrTextLayer(
        source,
        {
          pageIndexes: [0],
          engineFactory: fakeEngine,
          renderPage: fakeRender(width, height),
        },
        testContext(),
      );
      const runs = (await extractTextRuns(result.data, [0], testContext()))[0]!;
      expect(runs.map((run) => run.text).join(' ')).toContain('INVOICE 2026');
      const invoice = runs.find((run) => run.text.includes('INVOICE'))!;
      expect(invoice.x).toBeGreaterThan(20);
      expect(invoice.x).toBeLessThan(80);
    }
  }, 60_000);

  test('honours a CropBox offset on a rotated page', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 400]);
    page.setCropBox(50, 40, 500, 300);
    page.setRotation(degrees(90));
    const source = await doc.save({ useObjectStreams: false });
    const result = await addOcrTextLayer(
      source,
      {
        pageIndexes: [0],
        engineFactory: fakeEngine,
        // Rotated crop viewport: 300 wide x 500 tall.
        renderPage: fakeRender(300, 500),
      },
      testContext(),
    );
    const runs = (await extractTextRuns(result.data, [0], testContext()))[0]!;
    expect(runs.map((run) => run.text).join(' ')).toContain('INVOICE 2026');
    const invoice = runs.find((run) => run.text.includes('INVOICE'))!;
    expect(invoice.x).toBeGreaterThan(10);
    expect(invoice.x).toBeLessThan(60);
  }, 60_000);

  test('refuses an explicit page that does not exist', async () => {
    const source = await scanSource();
    await expect(
      addOcrTextLayer(
        source,
        { pageIndexes: [5], engineFactory: fakeEngine, renderPage: fakeRender(1000, 500) },
        testContext(),
      ),
    ).rejects.toThrow(/does not exist/i);
  }, 60_000);

  test('one page in a large document is still allowed', async () => {
    const doc = await PDFDocument.create();
    for (let index = 0; index < 101; index += 1) doc.addPage([100, 100]);
    const source = await doc.save({ useObjectStreams: false });
    const result = await addOcrTextLayer(
      source,
      { pageIndexes: [0], engineFactory: fakeEngine, renderPage: fakeRender(1000, 500) },
      testContext(),
    );
    expect(result.ocrPages).toEqual([1]);
    expect(result.pageCount).toBe(101);
  }, 60_000);

  test('returns the original bytes when every page is already searchable', async () => {
    const source = await scanSource();
    const result = await addOcrTextLayer(
      source,
      {
        pageIndexes: [1],
        engineFactory: fakeEngine,
        renderPage: fakeRender(1000, 500),
      },
      testContext(),
    );
    expect(result.ocrPages).toEqual([]);
    expect(result.skippedPages).toEqual([2]);
    expect(result.data).toEqual(source);
  }, 60_000);

  test('terminates the recognizer even when the run is used', async () => {
    const source = await scanSource();
    let terminated = false;
    const engine = (): OcrEngine => ({
      async recognize() {
        return recognized();
      },
      async terminate() {
        terminated = true;
      },
    });
    await addOcrTextLayer(
      source,
      { pageIndexes: [0], engineFactory: engine, renderPage: fakeRender(1000, 500) },
      testContext(),
    );
    expect(terminated).toBe(true);
  }, 60_000);
});

describe('O-03 layout summary', () => {
  test('reports words, lines and a paragraph count', () => {
    const summary = summarizeOcrPage(recognized(), {
      imageWidthPx: 1000,
      imageHeightPx: 500,
      pageWidthPt: 500,
      pageHeightPt: 250,
    });
    expect(summary.wordCount).toBe(2);
    expect(summary.lineCount).toBe(1);
    expect(summary.paragraphCount).toBe(1);
    expect(summary.blocks[0]?.text).toBe('INVOICE 2026');
    expect(summary.blocks[0]?.box.x).toBeCloseTo(20, 3);
  });
});

describe('ocr-text-layer job', () => {
  test('is registered and can feed a workflow', () => {
    expect(ocrTextLayerJob.slug).toBe('ocr-text-layer');
    expect(JOB_SLUGS).toContain('ocr-text-layer');
    expect(JOBS['ocr-text-layer']).toBe(ocrTextLayerJob);
    expect(WORKFLOW_OUTPUT_JOBS.has('ocr-text-layer')).toBe(true);
  });

  test('validates page numbers and render bounds', () => {
    const files = [{ name: 'scan.pdf', type: 'application/pdf', data: new Uint8Array() }];
    expect(ocrTextLayerJob.validate({ files, options: { pageIndexes: [0, 3] } })).toMatchObject({
      ok: true,
    });
    expect(ocrTextLayerJob.validate({ files, options: { pageIndexes: [-1] } })).toMatchObject({
      ok: false,
    });
    expect(ocrTextLayerJob.validate({ files, options: { targetWidthPx: 10 } })).toMatchObject({
      ok: false,
    });
  });
});
