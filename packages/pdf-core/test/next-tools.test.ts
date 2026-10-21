/**
 * Next-tools batch (2026-10-21): six client-side tools shipped over the
 * existing engine. As with the plain-tools suite, every real-run case re-opens
 * the OUTPUT rather than trusting the job's return value.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { unzipSync } from 'fflate';
import { batesJob } from '../src/jobs/bates.job.js';
import { compressJob } from '../src/jobs/compress.job.js';
import { jpgToPdfJob } from '../src/jobs/jpgToPdf.job.js';
import { renameJob } from '../src/jobs/rename.job.js';
import { splitByTextJob } from '../src/jobs/splitByText.job.js';
import { unlockJob } from '../src/jobs/unlock.job.js';
import { formatBatesNumber, batesNumberDocument } from '../src/ops/bates.js';
import {
  detectImageKind,
  planImagePlacement,
  IMAGE_LIMITS,
} from '../src/ops/imageDocs.js';
import { expandRenamePattern, sanitizeStem } from '../src/ops/renamePattern.js';
import { planSplitByText } from '../src/ops/splitByText.js';
import { unlockDocument } from '../src/ops/unlock.js';
import { compressDocument } from '../src/compress/compress.js';
import { loadPdfDocument } from '../src/ops/pages.js';
import { encodePng } from './png.js';
import { makeFixturePdf, testContext } from './fixtures.js';
import { pdfContainsText } from './helpers.js';
import {
  decodeBase64,
  ENCRYPTED_AES128_BASE64,
  ENCRYPTED_OWNER_ONLY_BASE64,
} from './encryptedFixtures.js';
import { configurePdfjsRuntime } from '../src/render/pdfjsRuntime.js';

beforeAll(() => {
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href,
  });
});

/** 1x1 white JPEG -- the smallest real frame pdf-lib will embed. */
const TINY_JPEG = decodeBase64(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
);

function inputFor(file: Uint8Array, options: Record<string, unknown> = {}, name = 'doc.pdf') {
  return { files: [{ name, data: file }], options };
}

function zipEntries(zip: ArrayBuffer): { name: string; data: Uint8Array }[] {
  const files = unzipSync(new Uint8Array(zip));
  return Object.entries(files).map(([name, data]) => ({ name, data }));
}

describe('bates numbering', () => {
  test('formats an offset, zero-padded sequence', () => {
    expect(formatBatesNumber('ABC-', 42, 6)).toBe('ABC-000042');
    expect(formatBatesNumber('', 7, 2)).toBe('07');
    // Digits and value are clamped rather than emitting a huge pad or a negative.
    expect(formatBatesNumber('X', 5, 0)).toBe('X5');
    expect(formatBatesNumber('X', 5, 99)).toBe('X000000000005');
    expect(formatBatesNumber('X', -3, 2)).toBe('X00');
  });

  test('stamps consecutive numbers across every page', async () => {
    const source = await makeFixturePdf({ pages: 3 });
    const result = await batesJob.run(
      inputFor(source, { prefix: 'ABC-', start: 42, digits: 6, position: 'bottom-right' }),
      testContext(),
    );
    expect(result.pageCount).toBe(3);
    expect(result.start).toBe(42);
    expect(result.end).toBe(44);
    expect(result.fileName).toBe('doc-bates.pdf');

    const reopened = await PDFDocument.load(result.data);
    expect(reopened.getPageCount()).toBe(3);
    expect(pdfContainsText(new Uint8Array(result.data), 'ABC-000042')).toBe(true);
    expect(pdfContainsText(new Uint8Array(result.data), 'ABC-000044')).toBe(true);
    expect(pdfContainsText(new Uint8Array(result.data), 'ABC-000045')).toBe(false);
  });

  test('rejects more than one file, bad digits and an unknown position', () => {
    expect(batesJob.validate(inputFor(new Uint8Array(10), { digits: 6 }))).toMatchObject({ ok: true });
    expect(batesJob.validate(inputFor(new Uint8Array(10), { digits: 0 }))).toMatchObject({ ok: false });
    expect(batesJob.validate(inputFor(new Uint8Array(10), { start: -1 }))).toMatchObject({ ok: false });
    expect(
      batesJob.validate(inputFor(new Uint8Array(10), { position: 'middle' as never })),
    ).toMatchObject({ ok: false });
    expect(
      batesJob.validate({
        files: [
          { name: 'a.pdf', data: new Uint8Array(5) },
          { name: 'b.pdf', data: new Uint8Array(5) },
        ],
        options: {},
      }),
    ).toMatchObject({ ok: false });
  });

  test('skips a region when the resolver returns nothing', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const result = await batesNumberDocument(doc, { digits: 3 }, testContext());
    expect(result.pages).toBe(1);
  });
});

describe('jpg to pdf', () => {
  test('sniffs real magic bytes, not extensions', () => {
    expect(detectImageKind(TINY_JPEG)).toBe('jpeg');
    expect(detectImageKind(encodePng(4, 4, []))).toBe('png');
    expect(detectImageKind(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
    expect(detectImageKind(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  test('contain-fits on fixed paper with the requested margin', () => {
    const placement = planImagePlacement(1000, 500, { pageSize: 'a4', margin: 24 });
    // Landscape paper chosen automatically for a landscape photo.
    expect(placement.pageWidthPt).toBeCloseTo(841.89);
    expect(placement.pageHeightPt).toBeCloseTo(595.28);
    expect(placement.width).toBeCloseTo(793.89);
    expect(placement.height).toBeCloseTo(396.945);
    expect(placement.x).toBeCloseTo(24);
    expect(placement.y).toBeGreaterThan(90);
  });

  test('can use the image size as the page size', () => {
    const placement = planImagePlacement(4000, 3000, { pageSize: 'image' });
    expect(placement).toMatchObject({
      pageWidthPt: 4000,
      pageHeightPt: 3000,
      x: 0,
      y: 0,
      width: 4000,
      height: 3000,
    });
  });

  test('places a PNG and a JPEG in one document, in order', async () => {
    const png = encodePng(800, 400, []);
    const result = await jpgToPdfJob.run(
      {
        files: [
          { name: 'first.png', data: png },
          { name: 'second.jpg', data: TINY_JPEG },
        ],
        options: { pageSize: 'a4', orientation: 'portrait', margin: 0 },
      },
      testContext(),
    );
    expect(result.pageCount).toBe(2);
    expect(result.fileName).toBe('first-images.pdf');

    const reopened = await PDFDocument.load(result.data);
    expect(reopened.getPageCount()).toBe(2);
    // Forced portrait: every page stays A4 portrait even for the wide PNG.
    for (const page of reopened.getPages()) {
      expect(page.getSize().width).toBeCloseTo(595.28, 1);
      expect(page.getSize().height).toBeCloseTo(841.89, 1);
    }
    // The 1x1 JPEG is drawn to fill the printable area, not skipped.
    const images = reopened.context
      .enumerateIndirectObjects()
      .filter(([, object]) => {
        const stream = object as unknown as {
          dict?: { get?: (key: unknown) => { asString?: () => string } | undefined };
        };
        return stream.dict?.get?.(PDFName.of('Subtype'))?.asString?.() === '/Image';
      });
    expect(images.length).toBeGreaterThanOrEqual(2);
  });

  test('rejects non-images and out-of-range options', () => {
    const pdf = new TextEncoder().encode('%PDF-1.7');
    expect(jpgToPdfJob.validate(inputFor(pdf))).toMatchObject({ ok: false });
    expect(jpgToPdfJob.validate(inputFor(TINY_JPEG, { pageSize: 'a4' }))).toMatchObject({ ok: true });
    expect(jpgToPdfJob.validate(inputFor(TINY_JPEG, { margin: IMAGE_LIMITS.maxMarginPt + 1 }))).toMatchObject({
      ok: false,
    });
    expect(jpgToPdfJob.validate(inputFor(TINY_JPEG, { orientation: 'diagonal' as never }))).toMatchObject({
      ok: false,
    });
  });
});

describe('rename', () => {
  test('expands every token and sanitises illegal characters', () => {
    const context = {
      name: 'invoice',
      title: 'Q3/Q4 report',
      index: 3,
      total: 12,
      date: new Date('2026-10-21T00:00:00Z'),
    };
    expect(expandRenamePattern('{name}-{n}', context, 3)).toBe('invoice-003.pdf');
    expect(expandRenamePattern('{title} {date} {total}', context, 2)).toBe('Q3-Q4 report 2026-10-21 12.pdf');
    // Missing titles fall back to the original stem; a typed .pdf never doubles.
    expect(expandRenamePattern('{title}.pdf', { ...context, title: undefined })).toBe('invoice.pdf');
    expect(sanitizeStem('  bad:name?.pdf  ')).toBe('bad-name-.pdf');
    // A pattern that sanitises away to nothing falls back to the original name.
    expect(expandRenamePattern('...', context)).toBe('invoice.pdf');
  });

  test('renames a batch from document titles and returns a ZIP', async () => {
    const alpha = await PDFDocument.create();
    alpha.addPage([200, 200]);
    alpha.setTitle('Alpha Report');
    const bravo = await PDFDocument.create();
    bravo.addPage([200, 200]);
    bravo.addPage([200, 200]);
    bravo.setTitle('Bravo Letter');

    const result = await renameJob.run(
      {
        files: [
          { name: 'one.pdf', data: await alpha.save() },
          { name: 'two.pdf', data: await bravo.save() },
        ],
        options: { pattern: '{title}-{n}', digits: 2 },
      },
      testContext(),
    );

    expect(result.pageCount).toBe(3);
    expect(result.renamed).toEqual([
      { from: 'one.pdf', to: 'Alpha Report-01.pdf' },
      { from: 'two.pdf', to: 'Bravo Letter-02.pdf' },
    ]);
    expect(result.zip).toBeDefined();
    const entries = zipEntries(result.zip!);
    expect(entries.map((entry) => entry.name)).toEqual(['Alpha Report-01.pdf', 'Bravo Letter-02.pdf']);
    // Bytes are copied, not re-encoded.
    expect(entries[0]!.data).toEqual(new Uint8Array(await alpha.save()));
  });

  test('suffixes colliding names instead of dropping a file', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    const result = await renameJob.run(
      {
        files: [
          { name: 'a.pdf', data: source },
          { name: 'b.pdf', data: source },
        ],
        options: { pattern: 'same' },
      },
      testContext(),
    );
    expect(result.files.map((file) => file.name)).toEqual(['same.pdf', 'same-2.pdf']);
  });

  test('single file returns bytes directly, with no ZIP', async () => {
    const source = await makeFixturePdf({ pages: 2 });
    const result = await renameJob.run(
      inputFor(source, { pattern: 'renamed-{n}' }, 'source.pdf'),
      testContext(),
    );
    expect(result.zip).toBeUndefined();
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.name).toBe('renamed-1.pdf');
    expect(result.pageCount).toBe(2);
  });

  test('validates the file count and sequence width', () => {
    expect(renameJob.validate(inputFor(new Uint8Array(1), { digits: 3 }))).toMatchObject({ ok: true });
    expect(renameJob.validate(inputFor(new Uint8Array(1), { digits: 0 }))).toMatchObject({ ok: false });
    expect(renameJob.validate({ files: [], options: {} })).toMatchObject({ ok: false });
  });
});

describe('split by text', () => {
  test('splits before each match, ignoring a match on page one', () => {
    const plan = planSplitByText(
      ['cover', 'Section B starts', 'body', 'Section B again', 'tail'],
      'section b',
    );
    expect(plan.matchPages).toEqual([1, 3]);
    expect(plan.ranges).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 2 },
      { start: 3, end: 4 },
    ]);
  });

  test('respects case sensitivity and never emits empty parts', () => {
    expect(planSplitByText(['INVOICE', 'invoice'], 'invoice', true).matchPages).toEqual([1]);
    // Every page starting with the marker is its own part -- the statement
    // case -- and consecutive markers still produce no zero-page slice.
    const plan = planSplitByText(['x', 'mark', 'mark', 'y'], 'mark');
    expect(plan.ranges).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 1 },
      { start: 2, end: 3 },
    ]);
  });

  test('refuses a plan that cannot split', () => {
    expect(() => planSplitByText(['a', 'b'], '')).toThrow(/Type the text/);
    expect(() => planSplitByText(['a', 'b'], 'missing')).toThrow(/No page contains/);
    expect(() => planSplitByText(['mark', 'b'], 'mark')).toThrow(/nothing to split/);
  });

  test('composes one standalone PDF per match, zipped', async () => {
    const source = await makeFixturePdf({ pages: 4 });
    const result = await splitByTextJob.run(
      inputFor(source, { needle: 'page 4' }, 'book.pdf'),
      testContext(),
    );

    expect(result.pageCount).toBe(4);
    expect(result.matchedPages).toEqual([4]);
    expect(result.parts).toHaveLength(2);
    expect(result.zipName).toBe('book-split.zip');

    const entries = zipEntries(result.zip);
    expect(entries.map((entry) => entry.name)).toEqual(['book-part-1.pdf', 'book-part-2.pdf']);
    const first = await PDFDocument.load(entries[0]!.data);
    const second = await PDFDocument.load(entries[1]!.data);
    expect(first.getPageCount()).toBe(3);
    expect(second.getPageCount()).toBe(1);
  });

  test('surfaces a no-match run as a job error', async () => {
    const source = await makeFixturePdf({ pages: 3 });
    await expect(
      splitByTextJob.run(inputFor(source, { needle: 'not in this document' }), testContext()),
    ).rejects.toThrow(/No page contains/);
  });
});

describe('compress', () => {
  test('lossless repack keeps every page and reopens', async () => {
    const source = await makeFixturePdf({ pages: 3 });
    const result = await compressJob.run(
      inputFor(source, { mode: 'lossless' }),
      testContext(),
    );
    expect(result.mode).toBe('lossless');
    expect(result.pageCount).toBe(3);
    expect(result.originalBytes).toBe(source.byteLength);
    expect(result.fileName).toBe('doc-compressed.pdf');

    const reopened = await PDFDocument.load(result.data);
    expect(reopened.getPageCount()).toBe(3);
    expect(pdfContainsText(new Uint8Array(result.data), 'PDFShush page 2')).toBe(true);
  });

  test('raster mode refuses Node with a clear message instead of degrading', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    await expect(
      compressDocument(source, { mode: 'raster' }, testContext()),
    ).rejects.toThrow(/needs this browser/);
  });

  test('validates quality, resolution and mode', () => {
    expect(compressJob.validate(inputFor(new Uint8Array(1), { mode: 'raster' }))).toMatchObject({ ok: true });
    expect(compressJob.validate(inputFor(new Uint8Array(1), { mode: 'tiny' as never }))).toMatchObject({
      ok: false,
    });
    expect(compressJob.validate(inputFor(new Uint8Array(1), { quality: 0.1 }))).toMatchObject({ ok: false });
    expect(compressJob.validate(inputFor(new Uint8Array(1), { dpi: 600 }))).toMatchObject({ ok: false });
  });
});

describe('unlock', () => {
  const locked = decodeBase64(ENCRYPTED_AES128_BASE64);
  const ownerOnly = decodeBase64(ENCRYPTED_OWNER_ONLY_BASE64);

  test('removes the password with the right one and the output opens without it', async () => {
    const result = await unlockDocument(locked, 'shush123');
    expect(result.wasEncrypted).toBe(true);
    expect(result.pageCount).toBe(1);

    const reopened = await PDFDocument.load(result.data);
    expect(reopened.isEncrypted).toBe(false);
    expect(reopened.getPageCount()).toBe(1);
    expect(pdfContainsText(result.data, 'unlock test')).toBe(true);
  });

  test('explains a wrong password without leaking parser internals', async () => {
    await expect(unlockDocument(locked, 'nope')).rejects.toThrow(
      /That password did not open this PDF/,
    );
    await expect(unlockDocument(locked, undefined)).rejects.toThrow(
      /needs its password/,
    );
  });

  test('opens owner-only restrictions without a password', async () => {
    const result = await unlockDocument(ownerOnly, undefined);
    expect(result.wasEncrypted).toBe(true);
    const reopened = await PDFDocument.load(result.data);
    expect(reopened.getPageCount()).toBe(1);
    expect(reopened.isEncrypted).toBe(false);
  });

  test('an unencrypted file still produces a clean, marked copy', async () => {
    const plain = await makeFixturePdf({ pages: 2 });
    const result = await unlockDocument(plain, undefined);
    expect(result.wasEncrypted).toBe(false);
    expect(result.pageCount).toBe(2);
    const reopened = await loadPdfDocument(result.data);
    expect(reopened.getPageCount()).toBe(2);
  });

  test('the job writes the -unlocked name and reports encryption', async () => {
    const result = await unlockJob.run(
      inputFor(locked, { password: 'shush123' }, 'contract.pdf'),
      testContext(),
    );
    expect(result.fileName).toBe('contract-unlocked.pdf');
    expect(result.wasEncrypted).toBe(true);
    expect(result.pageCount).toBe(1);
  });

  test('validation rejects multiple files and non-string passwords', () => {
    expect(unlockJob.validate(inputFor(locked))).toMatchObject({ ok: true });
    expect(unlockJob.validate(inputFor(locked, { password: 42 as never }))).toMatchObject({ ok: false });
    expect(
      unlockJob.validate({
        files: [
          { name: 'a.pdf', data: locked },
          { name: 'b.pdf', data: locked },
        ],
      }),
    ).toMatchObject({ ok: false });
  });
});

describe('shared font embedding sanity', () => {
  test('the bates job does not disturb other page content', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 300]);
    page.drawText('BODY', { x: 20, y: 200, size: 12, font });
    const source = await doc.save();
    const result = await batesJob.run(inputFor(source, { start: 1, digits: 3 }), testContext());
    expect(pdfContainsText(new Uint8Array(result.data), 'BODY')).toBe(true);
    expect(pdfContainsText(new Uint8Array(result.data), '001')).toBe(true);
  });
});
