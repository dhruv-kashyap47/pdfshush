/**
 * Bookmark batch (2026-10-25): repair, combine, split by bookmarks, zip.
 *
 * As with the earlier batches, every real-run case re-opens the produced bytes
 * (or the produced ZIP) instead of trusting the job's own return value, and the
 * outline cases are read back through pdf.js -- the same reader the tool uses.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { unzipSync } from 'fflate';
import { combineJob } from '../src/jobs/combine.job.js';
import { repairJob } from '../src/jobs/repair.job.js';
import { splitByBookmarksJob } from '../src/jobs/splitByBookmarks.job.js';
import { zipJob } from '../src/jobs/zip.job.js';
import { combineToPdf, isPdfBytes } from '../src/ops/combine.js';
import { repairPdf } from '../src/ops/repair.js';
import { safeEntryName, safeZipName } from '../src/jobs/helpers.js';
import { extractOutline, splitLevel } from '../src/render/outline.js';
import { createZip } from '../src/ops/zip.js';
import { configurePdfjsRuntime } from '../src/render/pdfjsRuntime.js';
import { makeFixturePdf, testContext } from './fixtures.js';
import { pdfContainsText } from './helpers.js';
import { encodePng } from './png.js';

beforeAll(() => {
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href,
  });
});

function inputFor(file: Uint8Array, options: Record<string, unknown> = {}, name = 'doc.pdf') {
  return { files: [{ name, data: file }], options };
}

/** Byte-preserving encode for corrupting an ASCII PDF without Node types. */
function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function zipEntries(zip: ArrayBuffer): { name: string; data: Uint8Array }[] {
  const files = unzipSync(new Uint8Array(zip));
  return Object.entries(files).map(([name, data]) => ({ name, data }));
}

/**
 * A real outline written with pdf-lib's low-level context: a linked sibling
 * list under a single /Outlines root. `levels` lets a test nest an item.
 */
async function makeBookmarkedPdf(
  pageCount: number,
  bookmarks: { title: string; page: number; level?: number }[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([595 + i, 842]);
    page.drawText(`Section page ${i + 1}`, {
      x: 24,
      y: 780,
      size: 18,
      font,
      color: rgb(0.05, 0.4, 0.3),
    });
  }

  const context = doc.context;
  const pageRefs = doc.getPages().map((page) => page.ref);
  const rootRef = context.nextRef();
  const refs = bookmarks.map(() => context.nextRef());

  const levelOf = (index: number) => bookmarks[index]?.level ?? 0;
  /** Nearest preceding bookmark shallower than this one, or -1 for the root. */
  const parentOf = (index: number): number => {
    const level = levelOf(index);
    for (let j = index - 1; j >= 0; j -= 1) {
      if (levelOf(j) < level) return j;
    }
    return -1;
  };
  const childrenOf = (parent: number) =>
    bookmarks.map((_, index) => index).filter((index) => parentOf(index) === parent);

  bookmarks.forEach((bookmark, index) => {
    const parent = parentOf(index);
    const parentRef = parent >= 0 ? refs[parent]! : rootRef;
    const siblings = childrenOf(parent);
    const position = siblings.indexOf(index);
    const prev = position > 0 ? refs[siblings[position - 1]!] : undefined;
    const next = position >= 0 && position < siblings.length - 1 ? refs[siblings[position + 1]!] : undefined;
    const children = childrenOf(index);
    const pageRef = pageRefs[bookmark.page];
    if (!pageRef) throw new Error(`No page ${bookmark.page}`);

    context.assign(
      refs[index]!,
      context.obj({
        Title: PDFString.of(bookmark.title),
        Parent: parentRef,
        Dest: context.obj([pageRef, 'Fit']),
        ...(prev ? { Prev: prev } : {}),
        ...(next ? { Next: next } : {}),
        ...(children[0] ? { First: refs[children[0]!]! } : {}),
        ...(children.length > 0
          ? { Last: refs[children[children.length - 1]!]!, Count: children.length }
          : {}),
      }),
    );
  });

  const roots = childrenOf(-1);
  context.assign(
    rootRef,
    context.obj({
      Type: 'Outlines',
      Count: bookmarks.length,
      ...(roots[0] !== undefined ? { First: refs[roots[0]!]! } : {}),
      ...(roots.length > 0 ? { Last: refs[roots[roots.length - 1]!]! } : {}),
    }),
  );
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  return doc.save({ useObjectStreams: false });
}

/** Real RGB PNG, so the embed path is exercised rather than a stub. */
function makePng(width: number, height: number): Uint8Array {
  return encodePng(width, height, [{ x: 4, y: 4, w: 20, h: 12 }]);
}

describe('safe archive names', () => {
  test('collapses traversal and separators to a basename', () => {
    expect(safeEntryName('../../evil.pdf', 'fallback.pdf')).toBe('evil.pdf');
    expect(safeEntryName('..\\..\\evil.pdf', 'fallback.pdf')).toBe('evil.pdf');
    expect(safeEntryName('a/b/c.pdf', 'fallback.pdf')).toBe('c.pdf');
    expect(safeEntryName('\u0000\u0007', 'fallback.pdf')).toBe('fallback.pdf');
    expect(safeEntryName('...', 'fallback.pdf')).toBe('fallback.pdf');
    expect(safeEntryName('', 'fallback.pdf')).toBe('fallback.pdf');
  });

  test('replaces characters Windows cannot extract', () => {
    expect(safeEntryName('a:b*c?.pdf', 'fallback.pdf')).toBe('a-b-c-.pdf');
  });

  test('forces a .zip extension without doubling it', () => {
    expect(safeZipName('batch', 'fallback')).toBe('batch.zip');
    expect(safeZipName('batch.ZIP', 'fallback')).toBe('batch.ZIP');
    expect(safeZipName('../../x', 'fallback')).toBe('x.zip');
  });
});

describe('repair pdf', () => {
  test('rewrites a valid PDF and reports that nothing was rebuilt', async () => {
    const source = await makeFixturePdf({ pages: 3, label: 'Repair' });
    const result = await repairJob.run(inputFor(source), testContext());

    expect(result.pageCount).toBe(3);
    expect(result.rebuilt).toBe(false);
    expect(result.fileName).toBe('doc-repaired.pdf');

    const reopened = await PDFDocument.load(result.data);
    expect(reopened.getPageCount()).toBe(3);
    expect(pdfContainsText(new Uint8Array(result.data), 'Repair page 2')).toBe(true);
  });

  test('rebuilds a document whose cross-reference offset is wrong', async () => {
    const source = await makeFixturePdf({ pages: 2 });
    const text = new TextDecoder('latin1').decode(source);
    const brokenOffset = text.replace(/startxref\s+\d+/, 'startxref\n999999');
    expect(brokenOffset).not.toBe(text);

    const result = await repairPdf(latin1(brokenOffset), testContext());
    expect(result.pageCount).toBe(2);
    expect(result.rebuilt).toBe(true);

    const reopened = await PDFDocument.load(result.data);
    expect(reopened.getPageCount()).toBe(2);
  });

  test('refuses an empty or hopeless file with a readable message', async () => {
    await expect(repairJob.run(inputFor(new Uint8Array()), testContext())).rejects.toThrow(/empty/i);
    await expect(
      repairJob.run(inputFor(new TextEncoder().encode('not a pdf at all')), testContext()),
    ).rejects.toThrow(/too damaged|could not be rebuilt/i);
  });
});

describe('combine pdfs and images', () => {
  test('preserves input order across formats', async () => {
    const first = await makeFixturePdf({ pages: 2, label: 'First' });
    const second = await makeFixturePdf({ pages: 1, label: 'Second' });
    const png = makePng(120, 80);

    const result = await combineJob.run(
      {
        files: [
          { name: 'one.pdf', data: first },
          { name: 'photo.png', data: png },
          { name: 'two.pdf', data: second },
        ],
        options: { pageSize: 'image' },
      },
      testContext(),
    );

    expect(result.pageCount).toBe(4);
    expect(result.fileName).toBe('one-combined.pdf');
    expect(result.parts.map((part) => part.kind)).toEqual(['pdf', 'image', 'pdf']);

    const reopened = await PDFDocument.load(result.data);
    expect(reopened.getPageCount()).toBe(4);
    // Fixture page widths are distinct per page: 595, 596. The image page is
    // its own pixel size, and the last page starts a new fixture at 595.
    expect(reopened.getPage(0).getWidth()).toBeCloseTo(595, 1);
    expect(reopened.getPage(1).getWidth()).toBeCloseTo(596, 1);
    expect(reopened.getPage(2).getWidth()).toBeCloseTo(120, 1);
    expect(reopened.getPage(3).getWidth()).toBeCloseTo(595, 1);

    const bytes = new Uint8Array(result.data);
    expect(pdfContainsText(bytes, 'First page 1')).toBe(true);
    expect(pdfContainsText(bytes, 'Second page 1')).toBe(true);
  });

  test('rejects a file that is neither a PDF nor a supported image', () => {
    const verdict = combineJob.validate({
      files: [{ name: 'notes.txt', data: new TextEncoder().encode('hello') }],
    });
    expect(verdict.ok).toBe(false);
  });

  test('sniffs PDF bytes by magic, not by name', () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\n...');
    expect(isPdfBytes(pdf)).toBe(true);
    expect(isPdfBytes(new TextEncoder().encode('GIF89a'))).toBe(false);
  });

  test('refuses an image that only pretends to be a PNG', async () => {
    const first = await makeFixturePdf({ pages: 1 });
    const fake = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await expect(
      combineToPdf(
        [
          { name: 'a.pdf', data: first },
          { name: 'fake.png', data: fake },
        ],
        {},
        testContext(),
      ),
    ).rejects.toThrow(/fake\.png/);
  });
});

describe('zip job', () => {
  test('packs entries under sanitized, unique names', async () => {
    const result = await zipJob.run(
      {
        files: [
          { name: '../../one.pdf', data: new Uint8Array([1, 2, 3]) },
          { name: 'one.pdf', data: new Uint8Array([4, 5]) },
        ],
        options: { zipName: 'batch' },
      },
      testContext(),
    );

    expect(result.zipName).toBe('batch.zip');
    expect(result.entries.map((entry) => entry.name)).toEqual(['one.pdf', 'one-2.pdf']);
    const entries = zipEntries(result.zip);
    expect(entries.map((entry) => entry.name).sort()).toEqual(['one-2.pdf', 'one.pdf']);
    expect(entries.find((entry) => entry.name === 'one.pdf')!.data).toEqual(new Uint8Array([1, 2, 3]));
  });

  test('validates the entry count and produces a rereadable archive', async () => {
    expect(zipJob.validate({ files: [] }).ok).toBe(false);
    const zip = createZip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }]);
    expect(zipEntries(zip.buffer as ArrayBuffer)[0]!.name).toBe('a.txt');
  });
});

describe('split by bookmarks', () => {
  test('reads a flat outline and cuts one part per section', async () => {
    const source = await makeBookmarkedPdf(6, [
      { title: 'Introduction', page: 0 },
      { title: 'Method & Data', page: 2 },
      { title: 'Results', page: 4 },
    ]);

    const outline = await extractOutline(source, testContext());
    expect(outline.entries.map((entry) => entry.pageIndex)).toEqual([0, 2, 4]);
    expect(splitLevel(outline.entries)).toBe(0);

    const result = await splitByBookmarksJob.run(inputFor(source, {}, 'paper.pdf'), testContext());
    expect(result.pageCount).toBe(6);
    expect(result.bookmarkCount).toBe(3);
    expect(result.zipName).toBe('paper-bookmarks.zip');
    expect(result.parts.map((part) => part.pageCount)).toEqual([2, 2, 2]);

    const entries = zipEntries(result.zip);
    expect(entries).toHaveLength(3);
    expect(entries[0]!.name).toBe('1-Introduction.pdf');
    expect(entries[1]!.name).toBe('2-Method-Data.pdf');
    expect(entries[2]!.name).toBe('3-Results.pdf');

    const second = await PDFDocument.load(entries[1]!.data);
    expect(second.getPageCount()).toBe(2);
    expect(pdfContainsText(entries[1]!.data, 'Section page 3')).toBe(true);
  });

  test('adds explicit front matter when the first bookmark is not page one', async () => {
    const source = await makeBookmarkedPdf(5, [
      { title: 'Chapter One', page: 2 },
      { title: 'Chapter Two', page: 4 },
    ]);
    const result = await splitByBookmarksJob.run(inputFor(source), testContext());
    expect(result.parts.map((part) => part.title)).toEqual(['Front matter', 'Chapter One', 'Chapter Two']);
    expect(result.parts.map((part) => part.pageCount)).toEqual([2, 2, 1]);
  });

  test('splits on the shallowest level that actually carries sections', async () => {
    const source = await makeBookmarkedPdf(4, [
      { title: 'Contents', page: 0, level: 0 },
      { title: 'Alpha', page: 0, level: 1 },
      { title: 'Beta', page: 2, level: 1 },
    ]);
    const outline = await extractOutline(source, testContext());
    expect(splitLevel(outline.entries)).toBe(1);

    const result = await splitByBookmarksJob.run(inputFor(source), testContext());
    expect(result.parts.map((part) => part.title)).toEqual(['Alpha', 'Beta']);
    expect(result.parts.map((part) => part.pageCount)).toEqual([2, 2]);
  });

  test('explains the absence of an outline instead of producing one empty part', async () => {
    const source = await makeFixturePdf({ pages: 2 });
    await expect(
      splitByBookmarksJob.run(inputFor(source), testContext()),
    ).rejects.toThrow(/no bookmarks/i);
  });
});
