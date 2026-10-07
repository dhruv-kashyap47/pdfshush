import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { inspectPdf, probePageCount } from '../src/ops/pages.js';
import { mergePdfs } from '../src/ops/merge.js';
import { composePageRefs, refsForSpan } from '../src/ops/compose.js';
import { parsePageRanges } from '../src/ops/ranges.js';
import { renderStampTemplate } from '../src/ops/stamp.js';
import { splitPagesInHalf } from '../src/ops/split.js';
import { imposePages, type NupCount } from '../src/ops/nup.js';
import { mergeJob } from '../src/jobs/merge.job.js';
import { organizeJob } from '../src/jobs/organize.job.js';
import { inspectJob } from '../src/jobs/inspect.job.js';
import { splitByPagesJob } from '../src/jobs/splitByPages.job.js';
import { splitHalfJob } from '../src/jobs/splitHalf.job.js';
import { stampJob } from '../src/jobs/stamp.job.js';
import { nUpJob } from '../src/jobs/nUp.job.js';
import { createZip, dedupeNames, pageFileName, stripExtension } from '../src/ops/zip.js';
import { formatBytes, timeoutForPageCount, LIMITS } from '../src/limits.js';
import { withJobLimits, JobAbortedError } from '../src/job.js';
import { makeFixturePdf, testContext } from './fixtures.js';
import { unzlibSync } from 'fflate';

/**
 * pdf-lib both hex-encodes drawText strings (`<506167...>`) AND deflates every
 * content stream, so a byte scan must first inflate the streams.
 */
function pdfContainsText(bytes: Uint8Array, needle: string): boolean {
  const decoder = new TextDecoder('latin1');
  const latin1 = decoder.decode(bytes);
  let haystack = '';
  const streams = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streams.exec(latin1)) !== null) {
    const start = match.index + match[0].length;
    const end = latin1.indexOf('endstream', start);
    if (end < 0) break;
    const slice = bytes.subarray(start, end);
    try {
      haystack += decoder.decode(unzlibSync(slice));
    } catch {
      haystack += decoder.decode(slice);
    }
    // Skip past 'endstream' itself -- otherwise the next match lands on the
    // "stream\n" tail inside "endstream\n" and re-slices from the wrong offset.
    streams.lastIndex = end + 'endstream'.length;
  }

  const hex = Array.from(new TextEncoder().encode(needle))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  haystack = haystack.toLowerCase();
  return haystack.includes(needle.toLowerCase()) || haystack.includes(hex);
}

describe('inspectPdf', () => {
  it('reports page count, sizes and rotations', async () => {
    const bytes = await makeFixturePdf({ pages: 4 });
    const info = await inspectPdf(bytes);

    expect(info.pageCount).toBe(4);
    expect(info.pages).toHaveLength(4);
    expect(info.pages[0]?.rotation).toBe(0);
    expect(info.pages[0]?.widthPt).toBe(595);
    expect(info.pages[0]?.heightPt).toBe(842);
    // Page 3 is 2pt wider than page 1, proving distinct geometry survived.
    expect(info.pages[2]?.widthPt).toBe(597);
    expect(info.encrypted).toBe(false);
  });

  it('round-trips a document we just created', async () => {
    const bytes = await makeFixturePdf({ pages: 1 });
    expect(await probePageCount(bytes)).toBe(1);

    // %PDF- header, asserted on bytes rather than a lossy toString().
    expect(Array.from(bytes.subarray(0, 5))).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(bytes.byteLength).toBeGreaterThan(400);
  });
});

describe('mergePdfs', () => {
  it('concatenates pages in the given order', async () => {
    const a = await makeFixturePdf({ pages: 3, label: 'A' });
    const b = await makeFixturePdf({ pages: 2, label: 'B' });

    const ctx = testContext();
    const result = await mergePdfs(
      [
        { name: 'a.pdf', data: a },
        { name: 'b.pdf', data: b },
      ],
      ctx,
    );

    expect(result.pageCount).toBe(5);
    expect(result.sources).toEqual([
      { name: 'a.pdf', pageCount: 3 },
      { name: 'b.pdf', pageCount: 2 },
    ]);

    // The merged output must be independently parseable.
    const info = await inspectPdf(result.data);
    expect(info.pageCount).toBe(5);
  });

  it('preserves order when reversed', async () => {
    const a = await makeFixturePdf({ pages: 1, label: 'A', width: 100 });
    const b = await makeFixturePdf({ pages: 1, label: 'B', width: 200 });

    const ctx = testContext();
    const forward = await mergePdfs([{ name: 'a.pdf', data: a }, { name: 'b.pdf', data: b }], ctx);
    const reversed = await mergePdfs([{ name: 'b.pdf', data: b }, { name: 'a.pdf', data: a }], ctx);

    const fwd = await inspectPdf(forward.data);
    const rev = await inspectPdf(reversed.data);
    expect(fwd.pages[0]?.widthPt).toBe(100);
    expect(rev.pages[0]?.widthPt).toBe(200);
  });

  it('reports progress and completes', async () => {
    const a = await makeFixturePdf({ pages: 2 });
    const phases: string[] = [];
    const ctx = testContext((p) => phases.push(p.phase));
    await mergePdfs([{ name: 'a.pdf', data: a }], ctx);
    expect(phases.length).toBeGreaterThan(0);
    expect(phases.at(-1)).toBe('Done');
  });
});

describe('composePageRefs', () => {
  it('reorders, duplicates and drops pages', async () => {
    const a = await makeFixturePdf({ pages: 3, label: 'A', width: 100 });
    const b = await makeFixturePdf({ pages: 2, label: 'B', width: 200 });

    const ctx = testContext();
    // Take A's pages 1 and 3, B's page 2, then A's page 1 again.
    const result = await composePageRefs(
      [
        { name: 'a.pdf', data: a },
        { name: 'b.pdf', data: b },
      ],
      [
        { docIndex: 0, pageIndex: 0 },
        { docIndex: 0, pageIndex: 2 },
        { docIndex: 1, pageIndex: 1 },
        { docIndex: 0, pageIndex: 0 },
      ],
      ctx,
    );

    expect(result.pageCount).toBe(4);
    const info = await inspectPdf(result.data);
    // Pages are 100pt wide + i, so A's pages are 100/101/102 and B's are 200/201.
    expect(info.pages.map((p) => p.widthPt)).toEqual([100, 102, 201, 100]);
  });

  it('applies rotation to every copied page', async () => {
    const a = await makeFixturePdf({ pages: 2 });
    const ctx = testContext();
    const result = await composePageRefs([{ name: 'a.pdf', data: a }], refsForSpan(0, 0, 1), ctx, {
      transform: 'rotate',
      rotateDegrees: 90,
    });

    const info = await inspectPdf(result.data);
    expect(info.pages.every((p) => p.rotation === 90)).toBe(true);
    // The MediaBox is deliberately untouched: /Rotate is a display attribute, so
    // the stored geometry stays 595x842 and viewers rotate at paint time.
    expect(info.pages[0]?.widthPt).toBe(595);
    expect(info.pages[0]?.heightPt).toBe(842);
  });

  it('rejects empty selections and out-of-range refs', async () => {
    const a = await makeFixturePdf({ pages: 1 });
    const ctx = testContext();
    await expect(composePageRefs([{ name: 'a.pdf', data: a }], [], ctx)).rejects.toThrow(/No pages/);
    await expect(
      composePageRefs([{ name: 'a.pdf', data: a }], [{ docIndex: 0, pageIndex: 99 }], ctx),
    ).rejects.toThrow(/does not exist/);
  });

  it('handles a page span helper that is order independent', () => {
    expect(refsForSpan(0, 2, 0).map((r) => r.pageIndex)).toEqual([0, 1, 2]);
  });
});

describe('parsePageRanges', () => {
  it('parses mixed ranges, clamps and dedupes', () => {
    expect(parsePageRanges('1-3, 5, 8-', 10)).toEqual([0, 1, 2, 4, 7, 8, 9]);
    expect(parsePageRanges('3, 1, 2', 5)).toEqual([0, 1, 2]);
    expect(parsePageRanges('99-200', 10)).toEqual([9]);
    expect(parsePageRanges('', 5)).toEqual([]);
  });

  it('throws on nonsense input', () => {
    expect(() => parsePageRanges('abc', 5)).toThrow();
  });
});

describe('zip helpers', () => {
  it('produces a valid zip archive', () => {
    const zip = createZip([
      { name: 'a.txt', data: new TextEncoder().encode('hello') },
      { name: 'b.txt', data: new TextEncoder().encode('world') },
    ]);
    // Local file header signature "PK\x03\x04".
    expect(Array.from(zip.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(zip.byteLength).toBeGreaterThan(0);
  });

  it('zero-pads page names and dedupes collisions', () => {
    expect(pageFileName('doc', 7, 100, 'jpg')).toBe('doc-007.jpg');
    expect(pageFileName('doc', 7, 10, 'jpg')).toBe('doc-07.jpg');
    expect(pageFileName('doc', 3, 1, 'jpg')).toBe('doc-3.jpg');
    expect(dedupeNames(['a.png', 'a.png', 'a.png'])).toEqual(['a.png', 'a-2.png', 'a-3.png']);
    expect(stripExtension('report.final.pdf')).toBe('report.final');
    expect(stripExtension('noext')).toBe('noext');
  });
});

describe('jobs (registry layer)', () => {
  it('merge job returns a transferable buffer and a filename', async () => {
    const a = await makeFixturePdf({ pages: 2, label: 'A' });
    const output = await mergeJob.run({ files: [{ name: 'a.pdf', data: a }] }, testContext());

    expect(output.fileName).toBe('a-merged.pdf');
    expect(output.pageCount).toBe(2);
    expect(output.data).toBeInstanceOf(ArrayBuffer);

    // The transferred bytes must still be a valid PDF.
    const doc = await PDFDocument.load(output.data);
    expect(doc.getPageCount()).toBe(2);
  });

  it('organize job builds from an explicit page order', async () => {
    const a = await makeFixturePdf({ pages: 3, label: 'A' });
    const output = await organizeJob.run(
      {
        files: [{ name: 'report.pdf', data: a }],
        options: { pageOrder: [{ docIndex: 0, pageIndex: 2 }, { docIndex: 0, pageIndex: 0 }] },
      },
      testContext(),
    );

    expect(output.pageCount).toBe(2);
    expect(output.fileName).toBe('report-organized.pdf');
  });

  it('inspect job reports page geometry for every document', async () => {
    const a = await makeFixturePdf({ pages: 2, label: 'A' });
    const b = await makeFixturePdf({ pages: 3, label: 'B', width: 200 });
    const output = await inspectJob.run(
      {
        files: [
          { name: 'a.pdf', data: a },
          { name: 'b.pdf', data: b },
        ],
      },
      testContext(),
    );

    expect(output.documents).toHaveLength(2);
    expect(output.documents[0]?.pageCount).toBe(2);
    expect(output.documents[1]?.pageCount).toBe(3);
    expect(output.documents[1]?.pages[0]?.widthPt).toBe(200);
  });

  it('validates inputs before doing work', () => {
    expect(mergeJob.validate({ files: [] }).ok).toBe(false);
    expect(mergeJob.validate({ files: [{ name: 'a', data: new Uint8Array() }] }).ok).toBe(true);
    expect(
      organizeJob.validate({
        files: [{ name: 'a', data: new Uint8Array() }],
        options: { pageOrder: [] },
      }).ok,
    ).toBe(false);
  });

  it('supports the rotate option through the organize job', async () => {
    const a = await makeFixturePdf({ pages: 1 });
    const output = await organizeJob.run(
      {
        files: [{ name: 'a.pdf', data: a }],
        options: {
          pageOrder: [{ docIndex: 0, pageIndex: 0 }],
          rotateDegrees: 180,
        },
      },
      testContext(),
    );
    const info = await inspectPdf(new Uint8Array(output.data));
    expect(info.pages[0]?.rotation).toBe(180);
  });

  it('never names a merged file after its only source', async () => {
    // Merging one file must not hand back a *different* document under the
    // user's original filename.
    const a = await makeFixturePdf({ pages: 2, label: 'A' });
    const single = await mergeJob.run({ files: [{ name: 'report.pdf', data: a }] }, testContext());
    expect(single.fileName).toBe('report-merged.pdf');

    const pair = await mergeJob.run(
      { files: [{ name: 'report.pdf', data: a }, { name: 'notes.pdf', data: a }] },
      testContext(),
    );
    expect(pair.fileName).toBe('merged.pdf');
  });
});

describe('limits & job guardrails', () => {
  it('scales timeout with page count and clamps it', () => {
    expect(timeoutForPageCount(1)).toBe(LIMITS.job.defaultTimeoutMs);
    expect(timeoutForPageCount(100)).toBeGreaterThan(LIMITS.job.defaultTimeoutMs);
    expect(timeoutForPageCount(100_000)).toBe(LIMITS.job.maxTimeoutMs);
    expect(timeoutForPageCount(1, 1)).toBe(LIMITS.job.minTimeoutMs);
  });

  it('aborts when the parent signal fires', async () => {
    const controller = new AbortController();
    const promise = withJobLimits(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted inside')));
        }),
      { env: 'node', parentSignal: controller.signal },
    );
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(JobAbortedError);
  });

  it('formats bytes for the UI', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });
});

describe('Phase 1 -- page transforms', () => {
  it('copies only referenced pages and keeps index mapping exact', async () => {
    // Selective copying must not shift indexes: page 3 of 10 is 102pt wide in
    // the fixture (width + index), so a mis-mapped copy would read as 100 or 101.
    const a = await makeFixturePdf({ pages: 10, label: 'A', width: 100, height: 200 });
    const result = await composePageRefs(
      [{ name: 'a.pdf', data: a }],
      [{ docIndex: 0, pageIndex: 2 }],
      testContext(),
    );

    const info = await inspectPdf(result.data);
    expect(result.pageCount).toBe(1);
    expect(info.pages[0]?.widthPt).toBe(102);
  });

  it('still duplicates pages that appear twice in the order', async () => {
    const a = await makeFixturePdf({ pages: 3, label: 'A', width: 100, height: 200 });
    const result = await composePageRefs(
      [{ name: 'a.pdf', data: a }],
      [
        { docIndex: 0, pageIndex: 2, rotateDegrees: 90 },
        { docIndex: 0, pageIndex: 2, rotateDegrees: 90 },
        { docIndex: 0, pageIndex: 0 },
      ],
      testContext(),
    );

    const info = await inspectPdf(result.data);
    expect(info.pages.map((p) => p.widthPt)).toEqual([102, 102, 100]);
    // Rotation is absolute, so a duplicated page is not compounded to 180.
    expect(info.pages[0]?.rotation).toBe(90);
    expect(info.pages[1]?.rotation).toBe(90);
  });

  it('rejects negative and unknown-document refs before copying', async () => {
    const a = await makeFixturePdf({ pages: 2 });
    const ctx = testContext();
    await expect(
      composePageRefs([{ name: 'a.pdf', data: a }], [{ docIndex: 0, pageIndex: -1 }], ctx),
    ).rejects.toThrow(/does not exist/);
    await expect(
      composePageRefs([{ name: 'a.pdf', data: a }], [{ docIndex: 5, pageIndex: 0 }], ctx),
    ).rejects.toThrow(/does not exist/);
  });

  it('per-page rotation overrides the global rotate option', async () => {
    const a = await makeFixturePdf({ pages: 2 });
    const ctx = testContext();
    const result = await composePageRefs(
      [{ name: 'a.pdf', data: a }],
      [
        { docIndex: 0, pageIndex: 0, rotateDegrees: 270 },
        { docIndex: 0, pageIndex: 1 },
      ],
      ctx,
      { transform: 'rotate', rotateDegrees: 90 },
    );

    const info = await inspectPdf(result.data);
    expect(info.pages[0]?.rotation).toBe(270);
    expect(info.pages[1]?.rotation).toBe(90);
  });

  it('applies a crop rectangle and clamps it to the page', async () => {
    const a = await makeFixturePdf({ pages: 2 });
    const ctx = testContext();

    const cropped = await composePageRefs(
      [{ name: 'a.pdf', data: a }],
      refsForSpan(0, 0, 0),
      ctx,
      { crop: { x: 50, y: 100, width: 400, height: 600 } },
    );
    const info = await inspectPdf(cropped.data);
    expect(info.pages[0]?.cropBox).toEqual({ x: 50, y: 100, width: 400, height: 600 });

    // Rectangles poking outside the page are clamped, never rejected.
    const clamped = await composePageRefs(
      [{ name: 'a.pdf', data: a }],
      refsForSpan(0, 0, 0),
      ctx,
      { crop: { x: -50, y: -50, width: 99999, height: 99999 } },
    );
    const clampedInfo = await inspectPdf(clamped.data);
    expect(clampedInfo.pages[0]?.cropBox).toEqual({ x: 0, y: 0, width: 595, height: 842 });
  });

  it('organize job honours crop and outputName', async () => {
    const a = await makeFixturePdf({ pages: 1 });
    const output = await organizeJob.run(
      {
        files: [{ name: 'scan.pdf', data: a }],
        options: {
          pageOrder: [{ docIndex: 0, pageIndex: 0 }],
          crop: { x: 10, y: 20, width: 300, height: 400 },
          outputName: 'tidied',
        },
      },
      testContext(),
    );

    expect(output.fileName).toBe('tidied.pdf');
    const info = await inspectPdf(new Uint8Array(output.data));
    expect(info.pages[0]?.cropBox).toEqual({ x: 10, y: 20, width: 300, height: 400 });
  });
});

describe('Phase 1 -- stamp (page numbers, header & footer)', () => {
  it('substitutes {n} and {N} tokens case-sensitively', () => {
    expect(renderStampTemplate('Page {n} of {N}', 3, 12)).toBe('Page 3 of 12');
    expect(renderStampTemplate('{n}{n}-{N}', 1, 2)).toBe('11-2');
    expect(renderStampTemplate('no tokens', 1, 1)).toBe('no tokens');
  });

  it('stamp job writes the resolved footer text into the page stream', async () => {
    const a = await makeFixturePdf({ pages: 3 });
    const output = await stampJob.run(
      {
        files: [{ name: 'report.pdf', data: a }],
        options: { footer: { text: 'Page {n} of {N}', position: 'bottom-center' } },
      },
      testContext(),
    );

    expect(output.pageCount).toBe(3);
    expect(output.fileName).toBe('report-stamped.pdf');
    expect(pdfContainsText(new Uint8Array(output.data), 'Page 1 of 3')).toBe(true);
    expect(pdfContainsText(new Uint8Array(output.data), 'Page 3 of 3')).toBe(true);
  });

  it('stamp job stamps only the selected pages', async () => {
    const a = await makeFixturePdf({ pages: 4 });
    const output = await stampJob.run(
      {
        files: [{ name: 'doc.pdf', data: a }],
        options: {
          pageOrder: [{ docIndex: 0, pageIndex: 1 }, { docIndex: 0, pageIndex: 2 }],
          header: { text: 'CONFIDENTIAL {n}/{N}', position: 'top-left' },
        },
      },
      testContext(),
    );

    expect(output.pageCount).toBe(2);
    // {N} counts the selected pages (2), not the original document's 4.
    const bytes = new Uint8Array(output.data);
    expect(pdfContainsText(bytes, 'CONFIDENTIAL 1/2')).toBe(true);
    expect(pdfContainsText(bytes, 'CONFIDENTIAL 2/2')).toBe(true);
    expect(pdfContainsText(bytes, 'CONFIDENTIAL 4/4')).toBe(false);
  });

  it('validates that some text was provided', () => {
    expect(stampJob.validate({ files: [{ name: 'a.pdf', data: new Uint8Array() }] }).ok).toBe(false);
    expect(
      stampJob.validate({
        files: [{ name: 'a.pdf', data: new Uint8Array() }],
        options: { footer: { text: 'x' } },
      }).ok,
    ).toBe(true);
  });

  it('clamps hostile style values instead of emitting broken operators', async () => {
    const a = await makeFixturePdf({ pages: 1 });
    const output = await stampJob.run(
      {
        files: [{ name: 'doc.pdf', data: a }],
        options: {
          footer: { text: 'Page {n}' },
          style: { fontSize: 9999, margin: -50, color: { r: 12, g: -4, b: Number.NaN } },
        },
      },
      testContext(),
    );

    expect(output.pageCount).toBe(1);
    expect(pdfContainsText(new Uint8Array(output.data), 'Page 1')).toBe(true);
  });

  it('treats an explicitly empty page order as an error, not "all pages"', async () => {
    const a = await makeFixturePdf({ pages: 3 });
    await expect(
      stampJob.run(
        {
          files: [{ name: 'doc.pdf', data: a }],
          options: { pageOrder: [], footer: { text: 'x' } },
        },
        testContext(),
      ),
    ).rejects.toThrow(/No pages selected/);
  });
});

describe('Phase 1 -- split in half', () => {
  it('splits the visible CropBox, not the MediaBox', async () => {
    // Real scans often carry a CropBox smaller than the MediaBox; cutting the
    // MediaBox would slice blank margin instead of content.
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setCropBox(100, 100, 300, 400);
    const bytes = await doc.save();

    const result = await splitPagesInHalf({ name: 'scan.pdf', data: bytes }, 'vertical', testContext());
    const left = await inspectPdf(result.first);
    const right = await inspectPdf(result.second);

    expect(left.pages[0]?.widthPt).toBe(150);
    expect(left.pages[0]?.cropBox).toEqual({ x: 100, y: 100, width: 150, height: 400 });
    expect(right.pages[0]?.cropBox).toEqual({ x: 250, y: 100, width: 150, height: 400 });
  });

  it('cuts a CropBox horizontally into top and bottom halves', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setCropBox(100, 100, 300, 400);
    const bytes = await doc.save();

    const result = await splitPagesInHalf({ name: 'scan.pdf', data: bytes }, 'horizontal', testContext());
    const top = await inspectPdf(result.first);
    expect(top.pages[0]?.cropBox).toEqual({ x: 100, y: 300, width: 300, height: 200 });
    expect(result.secondLabel).toBe('bottom');
  });

  it('cuts pages into equal left/right halves', async () => {
    const a = await makeFixturePdf({ pages: 2 });
    const result = await splitPagesInHalf({ name: 'a.pdf', data: a }, 'vertical', testContext());

    expect(result.pageCount).toBe(2);
    expect(result.firstLabel).toBe('left');
    expect(result.secondLabel).toBe('right');

    const left = await inspectPdf(result.first);
    const right = await inspectPdf(result.second);
    expect(left.pages[0]?.widthPt).toBe(297.5);
    expect(right.pages[0]?.widthPt).toBe(297.5);
    expect(left.pages[0]?.heightPt).toBe(842);
    // Right half is offset from the origin so its content lands on the same page.
    expect(right.pages[0]?.cropBox.x).toBeCloseTo(297.5, 1);
  });

  it('cuts horizontally into top/bottom halves', async () => {
    const a = await makeFixturePdf({ pages: 1 });
    const result = await splitPagesInHalf({ name: 'a.pdf', data: a }, 'horizontal', testContext());

    const top = await inspectPdf(result.first);
    expect(result.firstLabel).toBe('top');
    expect(top.pages[0]?.heightPt).toBe(421);
    expect(top.pages[0]?.cropBox.y).toBeCloseTo(421, 1);
  });

  it('split job returns a zip with both named halves', async () => {
    const a = await makeFixturePdf({ pages: 3 });
    const output = await splitHalfJob.run(
      { files: [{ name: 'report.pdf', data: a }], options: { orientation: 'vertical' } },
      testContext(),
    );

    expect(output.zipName).toBe('report-halves.zip');
    expect(output.parts.map((p) => p.name)).toEqual(['report-left.pdf', 'report-right.pdf']);
    expect(output.pageCount).toBe(3);
    expect(Array.from(new Uint8Array(output.zip).subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

    expect(splitHalfJob.validate({ files: [] }).ok).toBe(false);
  });
});

describe('Phase 1 -- split by pages', () => {
  it('chunks a document into padded zip entries', async () => {
    const a = await makeFixturePdf({ pages: 5 });
    const output = await splitByPagesJob.run(
      { files: [{ name: 'report.pdf', data: a }], options: { chunkSize: 2 } },
      testContext(),
    );

    expect(output.parts).toEqual([
      { name: 'report-part-1.pdf', pageCount: 2 },
      { name: 'report-part-2.pdf', pageCount: 2 },
      { name: 'report-part-3.pdf', pageCount: 1 },
    ]);
    expect(output.zipName).toBe('report-split.zip');
    expect(output.pageCount).toBe(5);
  });

  it('chunk size of 1 makes every page its own file', async () => {
    const a = await makeFixturePdf({ pages: 3 });
    const output = await splitByPagesJob.run(
      { files: [{ name: 'a.pdf', data: a }], options: { chunkSize: 1 } },
      testContext(),
    );
    expect(output.parts).toHaveLength(3);
  });

  it('refuses runaway part counts and bad options', async () => {
    // 201 pages with chunk 1 would exceed the 200-part cap; the job must fail
    // fast after the page-count probe, before composing anything.
    const many = await makeFixturePdf({ pages: 201 });
    await expect(
      splitByPagesJob.run({ files: [{ name: 'a.pdf', data: many }], options: { chunkSize: 1 } }, testContext()),
    ).rejects.toThrow(/limit 200/);

    expect(splitByPagesJob.validate({ files: [], options: { chunkSize: 0 } }).ok).toBe(false);
    expect(splitByPagesJob.validate({ files: [], options: { chunkSize: 1.5 } }).ok).toBe(false);
    expect(splitByPagesJob.validate({ files: [], options: { chunkSize: 1 } }).ok).toBe(false);
  });
});

describe('Phase 1 -- N-up imposition', () => {
  it('2-up puts two pages side by side on one sheet', async () => {
    const a = await makeFixturePdf({ pages: 2, width: 100, height: 200 });
    const result = await imposePages({ name: 'a.pdf', data: a }, { n: 2 }, testContext());

    expect(result.pageCount).toBe(1);
    const info = await inspectPdf(result.data);
    expect(info.pages[0]?.widthPt).toBe(200); // 100pt cells x 2 columns
    expect(info.pages[0]?.heightPt).toBe(200);
  });

  it('odd page counts leave the trailing cell blank', async () => {
    const a = await makeFixturePdf({ pages: 3, width: 100, height: 200 });
    const result = await imposePages({ name: 'a.pdf', data: a }, { n: 4 }, testContext());

    expect(result.pageCount).toBe(1); // 3 pages fit on one 2x2 sheet
    const info = await inspectPdf(result.data);
    expect(info.pages[0]?.widthPt).toBe(200);
    expect(info.pages[0]?.heightPt).toBe(400);
  });

  it('8-up needs two sheets for nine pages', async () => {
    const a = await makeFixturePdf({ pages: 9, width: 100, height: 200 });
    const result = await imposePages({ name: 'a.pdf', data: a }, { n: 8 }, testContext());
    expect(result.pageCount).toBe(2);
  });

  it('n-up job names and validates output', async () => {
    const a = await makeFixturePdf({ pages: 4, width: 100, height: 200 });
    const output = await nUpJob.run(
      { files: [{ name: 'deck.pdf', data: a }], options: { n: 4, sheet: 'source' } },
      testContext(),
    );
    expect(output.fileName).toBe('deck-4up.pdf');
    expect(output.pageCount).toBe(1);

    expect(nUpJob.validate({ files: [], options: { n: 3 as unknown as NupCount } }).ok).toBe(false);
    expect(nUpJob.validate({ files: [{ name: 'a', data: new Uint8Array() }] }).ok).toBe(true);
  });
});