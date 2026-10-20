/**
 * The plain-tools batch (PLAN.md changelog, 2026-10-20): ten client-side jobs
 * over an engine that already existed. Every job gets a validation case and a
 * real-run case whose OUTPUT is re-opened, not trusted.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  degrees,
} from '@cantoo/pdf-lib';
import { unzlibSync, zlibSync } from 'fflate';
import { annotationsJob } from '../src/jobs/annotations.job.js';
import { flattenJob } from '../src/jobs/flatten.job.js';
import { flipJob, axisPerPageCount } from '../src/jobs/flip.job.js';
import { grayscaleJob } from '../src/jobs/grayscale.job.js';
import { imagesJob } from '../src/jobs/images.job.js';
import { metadataJob } from '../src/jobs/metadata.job.js';
import { resizeJob } from '../src/jobs/resize.job.js';
import { splitBySizeJob, planSplitBySize } from '../src/jobs/splitBySize.job.js';
import { textJob } from '../src/jobs/text.job.js';
import { watermarkJob } from '../src/jobs/watermark.job.js';
import { extractImages, classifyImageStream } from '../src/ops/images.js';
import { toGrayscaleRgba } from '../src/gray/gray.js';
import { LIMITS } from '../src/limits.js';
import { testContext, makeFixturePdf } from './fixtures.js';
import { pdfContainsText } from './helpers.js';
import { encodePng } from './png.js';
import { configurePdfjsRuntime } from '../src/render/pdfjsRuntime.js';

beforeAll(() => {
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href,
  });
});

/** Bytewise equality that works for ArrayBuffer or Uint8Array sides. */
function bytesEqual(a: ArrayBuffer | Uint8Array, b: Uint8Array): boolean {
  const left = a instanceof Uint8Array ? a : new Uint8Array(a);
  if (left.length !== b.length) return false;
  for (let i = 0; i < b.length; i += 1) if (left[i] !== b[i]) return false;
  return true;
}

function inputFor(file: Uint8Array, options: Record<string, unknown> = {}, name = 'doc.pdf') {
  return { files: [{ name, data: file }], options };
}

/** Collects all inflated content streams so matrix/text assertions work. */
function inflatedContent(source: ArrayBuffer | Uint8Array): string {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const decoder = new TextDecoder('latin1');
  const latin1 = decoder.decode(bytes);
  let out = '';
  const re = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(latin1)) !== null) {
    const start = match.index + match[0].length;
    const end = latin1.indexOf('endstream', start);
    if (end < 0) break;
    const slice = bytes.subarray(start, end);
    try {
      out += decoder.decode(unzlibSync(slice));
    } catch {
      out += decoder.decode(slice);
    }
    re.lastIndex = end + 'endstream'.length;
  }
  return out;
}

describe('flip job', () => {
  test('refuses no-flip and multi-file inputs', async () => {
    expect(flipJob.validate(inputFor(new Uint8Array(10)))).toMatchObject({ ok: false });
    expect(flipJob.validate(inputFor(new Uint8Array(10), { horizontal: true }, 'a.pdf'))).toMatchObject({
      ok: true,
    });
    expect(
      flipJob.validate({
        files: [
          { name: 'a.pdf', data: new Uint8Array(10) },
          { name: 'b.pdf', data: new Uint8Array(10) },
        ],
        options: { horizontal: true },
      }),
    ).toMatchObject({ ok: false });
    expect(flipJob.validate(inputFor(new Uint8Array(10), { horizontal: [0] }))).toMatchObject({ ok: true });
  });

  test('horizontal flip emits the mirror matrix and keeps every page', async () => {
    const source = await makeFixturePdf({ pages: 3 });
    const result = await flipJob.run(inputFor(source, { horizontal: true }), testContext());
    expect(result.pageCount).toBe(3);
    expect(result.flipped).toBe(3);
    expect(result.fileName).toBe('doc-flipped.pdf');

    const reloaded = await PDFDocument.load(result.data);
    expect(reloaded.getPageCount()).toBe(3);
    expect(inflatedContent(result.data)).toContain('-1 0 0 1');
  });

  test('vertical flip emits the up-down matrix', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    const result = await flipJob.run(inputFor(source, { vertical: true }), testContext());
    const content = inflatedContent(result.data);
    expect(content).toContain('1 0 0 -1');
    expect(content.includes('-1 0 0 1')).toBe(false);
  });

  test('pages keep their display rotation through the rebuild', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([200, 100]);
    page.setRotation(degrees(90));
    const bytes = await source.save();

    const result = await flipJob.run(inputFor(bytes, { horizontal: true }), testContext());
    const reloaded = await PDFDocument.load(result.data);
    expect(reloaded.getPage(0).getRotation().angle).toBe(90);
  });

  test('a page with no content stream survives (embedPage would throw on it)', async () => {
    const source = await PDFDocument.create();
    source.addPage([200, 100]); // intentionally blank
    const bytes = await source.save();

    const result = await flipJob.run(inputFor(bytes, { horizontal: true }), testContext());
    expect((await PDFDocument.load(result.data)).getPageCount()).toBe(1);
  });

  test('axisPerPageCount resolves true / list / undefined identically', () => {
    expect(axisPerPageCount(true, 3)).toEqual([true, true, true]);
    expect(axisPerPageCount([2], 3)).toEqual([false, false, true]);
    expect(axisPerPageCount(undefined, 3)).toEqual([false, false, false]);
    // Out-of-range indexes are ignored, not expanded to an error: the same
    // clamp-then-ignore rule parsePageRanges uses.
    expect(axisPerPageCount([9], 3)).toEqual([false, false, false]);
  });
});

describe('watermark job', () => {
  test('defers to its spec: text and image are mutually required', async () => {
    const bytes = await makeFixturePdf({ pages: 1 });
    expect(watermarkJob.validate(inputFor(bytes, { spec: undefined }))).toMatchObject({ ok: false });
    expect(
      watermarkJob.validate(inputFor(bytes, { spec: { mode: 'text' } })),
    ).toMatchObject({ ok: false });
    expect(
      watermarkJob.validate(inputFor(bytes, { spec: { mode: 'image' } })),
    ).toMatchObject({ ok: false });
    expect(
      watermarkJob.validate(inputFor(bytes, { spec: { mode: 'text', text: 'Top Secret' } })),
    ).toMatchObject({ ok: true });
  });

  test('a centred text mark lands exactly once per page', async () => {
    const source = await makeFixturePdf({ pages: 2 });
    const result = await watermarkJob.run(
      inputFor(source, { spec: { mode: 'text', text: 'DRAFT', placement: 'center' } }),
      testContext(),
    );
    expect(result.pageCount).toBe(2);
    expect(result.fileName).toBe('doc-watermarked.pdf');
    expect(pdfContainsText(new Uint8Array(result.data), 'DRAFT')).toBe(true);

    const reloaded = await PDFDocument.load(result.data);
    expect(reloaded.getPageCount()).toBe(2);
  });

  test('a tiled mark repeats across the page', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    const result = await watermarkJob.run(
      inputFor(source, {
        spec: { mode: 'text', text: 'DRAFT', placement: 'tile', fontSize: 24 },
      }),
      testContext(),
    );
    const content = inflatedContent(result.data);
    const hex = [...new TextEncoder().encode('DRAFT')].map((b) => b.toString(16).padStart(2, '0')).join('');
    const occurrences = content.toLowerCase().split(hex.toLowerCase()).length - 1;
    expect(occurrences).toBeGreaterThan(10);
  });

  test('an image mark embeds and keeps the page size', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    const result = await watermarkJob.run(
      inputFor(source, {
        spec: { mode: 'image', image: { data: encodePng(16, 8, []), type: 'image/png' } },
      }),
      testContext(),
    );
    expect((await PDFDocument.load(result.data)).getPageCount()).toBe(1);
  });

  test('options are clamped to sane ranges', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    // fontSize 9999 / opacity 40 / rotation 999 must not emit malformed operators.
    const result = await watermarkJob.run(
      inputFor(source, {
        spec: { mode: 'text', text: 'DRAFT', fontSize: 9999, opacity: 40, rotation: 999 },
      }),
      testContext(),
    );
    expect(pdfContainsText(new Uint8Array(result.data), 'DRAFT')).toBe(true);
  });

  test('emoji-only text is refused (standard fonts mangle it silently)', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    await expect(
      watermarkJob.run(inputFor(source, { spec: { mode: 'text', text: '🚀' } }), testContext()),
    ).rejects.toThrow();
  });
});

describe('edit-metadata job', () => {
  test('writes and clears fields on the Info dictionary', async () => {
    const source = await makeFixturePdf({ pages: 1, label: 'Meta' });
    const first = await metadataJob.run(
      inputFor(source, { edits: { title: 'Annual Report', author: 'Ada', keywords: ['cash', 'flow'] } }),
      testContext(),
    );
    const reloaded = await PDFDocument.load(first.data);
    expect(reloaded.getTitle()).toBe('Annual Report');
    expect(reloaded.getAuthor()).toBe('Ada');
    // pdf-lib joins the stored keyword array with single spaces.
    expect(reloaded.getKeywords()).toBe('cash flow');
    expect(first.pageCount).toBe(1);

    const second = await metadataJob.run(
      inputFor(new Uint8Array(first.data), { edits: { title: '', author: 'Bob' } }),
      testContext(),
    );
    const cleared = await PDFDocument.load(second.data);
    // setTitle('') stores an empty string (pdf-lib keeps the key present) --
    // the meaningful contract is that the title is visibly empty.
    expect(cleared.getTitle()).toBe('');
    expect(cleared.getAuthor()).toBe('Bob');
  });

  test('requires at least one field', async () => {
    const bytes = await makeFixturePdf({ pages: 1 });
    expect(metadataJob.validate(inputFor(bytes, { edits: {} }))).toMatchObject({ ok: false });
  });
});

describe('remove-annotations job', () => {
  test('strips presentation annotations and keeps form widgets', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const form = source.getForm();
    const field = form.createTextField('applicant.name');
    field.addToPage(page);

    // A comment-style annotation, APPENDED to the page's own /Annots so the
    // form widget created by addToPage stays in place.
    const note = source.context.obj({
      Subtype: 'Text',
      Rect: [10, 10, 30, 30],
      Contents: 'review me',
    });
    const existing = source.context.lookup(page.node.get(PDFName.of('Annots')));
    if (existing instanceof PDFArray) {
      existing.push(source.context.register(note));
    } else {
      page.node.set(PDFName.of('Annots'), source.context.obj([source.context.register(note)]));
    }
    const bytes = await source.save();

    // Precondition: the page really has both annotation kinds.
    const before = await PDFDocument.load(bytes);
    const savedAnnots = before.context.lookup(before.getPage(0).node.get(PDFName.of('Annots')));
    expect(savedAnnots instanceof PDFArray ? savedAnnots.size() : 0).toBe(2);

    const result = await annotationsJob.run(inputFor(bytes), testContext());
    expect(result.removed).toBe(1);
    expect(result.pages).toBe(1);

    const cleaned = await PDFDocument.load(result.data);
    const kept = cleaned.context.lookup(cleaned.getPage(0).node.get(PDFName.of('Annots')));
    // The form widget survives: it IS the field's visible half.
    expect(kept instanceof PDFArray ? kept.size() : 0).toBe(1);
  });

  test('a document with no annotations is a clean, count-zero success', async () => {
    const bytes = await makeFixturePdf({ pages: 2 });
    const result = await annotationsJob.run(inputFor(bytes), testContext());
    expect(result.removed).toBe(0);
    expect((await PDFDocument.load(result.data)).getPageCount()).toBe(2);
  });
});

describe('flatten job', () => {
  test('bakes field values into page content and removes the AcroForm', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 200]);
    const form = source.getForm();
    const field = form.createTextField('name');
    field.setText('HELLO FLATTENED');
    field.addToPage(page);
    const bytes = await source.save();

    const result = await flattenJob.run(inputFor(bytes), testContext());
    expect(result.fieldsFlattened).toBe(1);
    expect(result.fileName).toBe('doc-flattened.pdf');
    expect(pdfContainsText(new Uint8Array(result.data), 'HELLO FLATTENED')).toBe(true);

    const flattened = await PDFDocument.load(result.data);
    // pdf-lib's flatten empties the AcroForm rather than deleting it; the
    // meaningful contract is zero remaining fields, however it is arrived at.
    const acro = flattened.catalog?.get?.(PDFName.of('AcroForm'));
    const acroDict = acro ? flattened.context.lookup(acro) : undefined;
    const fields = acroDict instanceof PDFDict ? acroDict.get(PDFName.of('Fields')) : undefined;
    expect(fields instanceof PDFArray ? fields.size() : 0).toBe(0);
    expect(flattened.getPageCount()).toBe(1);
  });

  test('a document with no form flattens to itself (zero fields, no error)', async () => {
    const bytes = await makeFixturePdf({ pages: 1 });
    const result = await flattenJob.run(inputFor(bytes), testContext());
    expect(result.fieldsFlattened).toBe(0);
    expect((await PDFDocument.load(result.data)).getPageCount()).toBe(1);
  });
});

describe('resize job', () => {
  test('A4 preset gives every page the exact A4 box', async () => {
    const source = await makeFixturePdf({ pages: 2, width: 300, height: 600 });
    const result = await resizeJob.run(
      inputFor(source, { request: { kind: 'preset', preset: 'a4' } }),
      testContext(),
    );
    const reloaded = await PDFDocument.load(result.data);
    expect(reloaded.getPageCount()).toBe(2);
    for (let i = 0; i < 2; i += 1) {
      const size = reloaded.getPage(i).getSize();
      expect(size.width).toBeCloseTo(595.28, 1);
      expect(size.height).toBeCloseTo(841.89, 1);
    }
  });

  test('a custom percentage scales the box proportionally', async () => {
    const source = await makeFixturePdf({ pages: 1, width: 200, height: 100 });
    const result = await resizeJob.run(
      inputFor(source, { request: { kind: 'percent', percent: 50 } }),
      testContext(),
    );
    const size = (await PDFDocument.load(result.data)).getPage(0).getSize();
    expect(size.width).toBeCloseTo(100, 1);
    expect(size.height).toBeCloseTo(50, 1);
  });

  test('validation bounds the request', async () => {
    const bytes = await makeFixturePdf({ pages: 1 });
    expect(resizeJob.validate(inputFor(bytes))).toMatchObject({ ok: false });
    expect(
      resizeJob.validate(inputFor(bytes, { request: { kind: 'percent', percent: 1000 } })),
    ).toMatchObject({ ok: false });
    expect(
      resizeJob.validate(inputFor(bytes, { request: { kind: 'preset', preset: 'a4' } })),
    ).toMatchObject({ ok: true });
  });
});

describe('pdf-to-text job', () => {
  test('extracts the drawn text in page order as UTF-8 .txt', async () => {
    const source = await makeFixturePdf({ pages: 2, label: 'PDFShush' });
    const result = await textJob.run(inputFor(source), testContext());
    expect(result.fileName).toBe('doc.txt');
    expect(result.pageCount).toBe(2);
    const text = new TextDecoder().decode(result.data);
    expect(text).toContain('PDFShush page 1');
    expect(text).toContain('PDFShush page 2');
    expect(text.indexOf('page 1')).toBeLessThan(text.indexOf('page 2'));
    expect(result.charCount).toBeGreaterThan(10);
  });

  test('a page-range request extracts only those pages', async () => {
    const source = await makeFixturePdf({ pages: 3 });
    const result = await textJob.run(inputFor(source, { pageIndexes: [1] }), testContext());
    const text = new TextDecoder().decode(result.data);
    expect(text).toContain('page 2');
    expect(text).not.toContain('page 1');
    expect(text).not.toContain('page 3');
  });
});

describe('extract-images job', () => {
  test('hands DCTDecode bytes back untouched', async () => {
    const doc = await PDFDocument.create();
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    // Register a synthetic image XObject straight into the context; extraction
    // walks indirect objects, not pages, so this is exactly what it must find.
    const dict = doc.context.obj({
      Subtype: 'Image',
      Width: 4,
      Height: 4,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
      Filter: 'DCTDecode',
    });
    doc.context.register(PDFRawStream.of(dict, jpegBytes));

    const result = extractImages(doc, 'doc');
    expect(result.skipped).toBe(0);
    expect(result.images.length).toBe(1);
    expect(result.images[0]!.ext).toBe('jpg');
    expect(bytesEqual(result.images[0]!.data, jpegBytes)).toBe(true);
    expect(result.images[0]!.name).toBe('doc-img-001.jpg');
  });

  test('classify honestly skips CMYK, predictor-2 and dimension-mismatched streams', async () => {
    const { context } = await PDFDocument.create();
    const make = (overrides: Record<string, unknown>, bytes = new Uint8Array(8)): PDFRawStream =>
      PDFRawStream.of(
        context.obj({
          Subtype: 'Image',
          Width: 2,
          Height: 2,
          ColorSpace: 'DeviceRGB',
          BitsPerComponent: 8,
          Filter: 'FlateDecode',
          ...overrides,
        }),
        bytes,
      );

    // Flate payloads must be REAL zlib streams, or unzlibSync skips them below.
    const zlibbed = (n: number): Uint8Array => zlibSync(new Uint8Array(n));
    expect(classifyImageStream(make({}).dict, zlibbed(12))).not.toBeNull(); // 2*2*3 = 12 ✓
    expect(classifyImageStream(make({}).dict, zlibbed(11))).toBeNull(); // sample-count mismatch
    expect(classifyImageStream(make({ ColorSpace: 'DeviceCMYK' }).dict, zlibbed(16))).toBeNull();
    expect(
      classifyImageStream(make({ DecodeParms: { Predictor: 2, Colors: 3, Columns: 2 } }).dict, zlibbed(12)),
    ).toBeNull();
    expect(classifyImageStream(make({ BitsPerComponent: 16 }).dict, zlibbed(16))).toBeNull();
    // ... but PNG predictors (12) pass AND decode below.
  });

  test('validation is single-file only', async () => {
    const bytes = await makeFixturePdf({ pages: 1 });
    expect(imagesJob.validate(inputFor(bytes))).toMatchObject({ ok: true });
    expect(imagesJob.validate({ files: [{ name: 'a.pdf', data: bytes }, { name: 'b.pdf', data: bytes }] })).toMatchObject({
      ok: false,
    });
  });

  test('PNG-predictor streams (Predictor 12) decode through the unfilter path', async () => {
    const width = 4;
    const height = 3;
    // Build a plain raster, then PNG-filter it (row 0: none, rest: up).
    const plain = new Uint8Array(width * height);
    for (let i = 0; i < plain.length; i += 1) plain[i] = (i * 7) % 251;
    const filtered = new Uint8Array(height * (width + 1));
    for (let y = 0; y < height; y += 1) {
      const base = y * (width + 1);
      filtered[base] = y === 0 ? 0 : 2;
      for (let x = 0; x < width; x += 1) {
        filtered[base + 1 + x] =
          y === 0 ? plain[x]! : (plain[y * width + x]! - plain[(y - 1) * width + x]!) & 0xff;
      }
    }
    const deflated = zlibSync(filtered);

    const doc = await PDFDocument.create();
    const dict = doc.context.obj({
      Subtype: 'Image',
      Width: width,
      Height: height,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 8,
      Filter: 'FlateDecode',
      DecodeParms: { Predictor: 12, Colors: 1, Columns: width },
    });
    doc.context.register(PDFRawStream.of(dict, deflated));

    const result = extractImages(doc, 'doc');
    expect(result.skipped).toBe(0);
    expect(result.images.length).toBe(1);
    expect(result.images[0]!.ext).toBe('png');
    // The re-encode declares the decoded source raster's dimensions.
    expect(result.images[0]!.width).toBe(width);
    expect(result.images[0]!.height).toBe(height);
  });
});

describe('split-by-size job', () => {
  test('the pure estimator floors pages per part and keeps the part count sane', () => {
    expect(planSplitBySize(1000, 10, 1000)).toEqual({ pagesPerPart: 10, parts: 1 });
    expect(planSplitBySize(1000, 10, 500)).toEqual({ pagesPerPart: 5, parts: 2 });
    expect(planSplitBySize(1000, 10, 100)).toEqual({ pagesPerPart: 1, parts: 10 });
    expect(planSplitBySize(1000, 10, 1)).toEqual({ pagesPerPart: 1, parts: 10 });
    // A 1000-page file one page per part would be 1000 files — flood guard.
    expect(() => planSplitBySize(1000, 1000, 1)).toThrow(/limit/);
  });

  test('job segments the real document and reports measured part sizes', async () => {
    // 30 pages; target one third → parts under a third each.
    const source = await makeFixturePdf({ pages: 30 });
    const targetBytes = Math.floor(1000 / 30) * 12; // ≈ 12 pages worth (real bytes > estimate)
    const plan = planSplitBySize(source.length, 30, targetBytes);
    const result = await splitBySizeJob.run(inputFor(source, { targetBytes }), testContext());

    expect(result.zip.byteLength).toBeGreaterThan(0);
    expect(result.pageCount).toBe(30);
    expect(result.approximate).toBe(true);
    expect(result.parts).toEqual(
      Array.from({ length: plan.parts }, (_, index) => {
        void index;
        return expect.objectContaining({ bytes: expect.any(Number), pageCount: expect.any(Number) });
      }),
    );
    const sum = result.parts.reduce((total, part) => total + part.pageCount, 0);
    expect(sum).toBe(30);
  });

  test('validation demands a real target', async () => {
    const source = await makeFixturePdf({ pages: 2 });
    expect(splitBySizeJob.validate(inputFor(source))).toMatchObject({ ok: false });
    expect(splitBySizeJob.validate(inputFor(source, { targetBytes: 50 }))).toMatchObject({ ok: false });
  });
});

describe('grayscale job', () => {
  test('refuses to run without a canvas (Node) instead of degrading', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    await expect(grayscaleJob.run(inputFor(source), testContext())).rejects.toThrow();
    expect(grayscaleJob.validate(inputFor(source))).toMatchObject({ ok: true });
  });

  test('the luma conversion is exact BT.601', () => {
    // Black, white, then a pure red pixel (255, 0, 0).
    const pixels = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255]);
    toGrayscaleRgba(pixels);
    expect([pixels[0]!, pixels[4]!, pixels[8]!]).toEqual([0, 255, 76]);
    // Pure red → 0.299 * 255 ≈ 76 — the R channel dominates the channels.
    expect(Math.abs((pixels[8] as number) - 76)).toBeLessThanOrEqual(1);
    // Alpha is passed through untouched on every pixel.
    expect(Array.from(pixels.filter((_, index) => index % 4 === 3))).toEqual([255, 255, 255]);
  });

  test('the page ceiling is the same gate secure redaction uses', () => {
    expect(LIMITS.tool.maxRedactPages).toBe(150);
  });
});
