import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { inspectPdf, probePageCount } from '../src/ops/pages.js';
import { mergePdfs } from '../src/ops/merge.js';
import { composePageRefs, refsForSpan } from '../src/ops/compose.js';
import { parsePageRanges } from '../src/ops/ranges.js';
import { mergeJob } from '../src/jobs/merge.job.js';
import { organizeJob } from '../src/jobs/organize.job.js';
import { inspectJob } from '../src/jobs/inspect.job.js';
import { createZip, dedupeNames, pageFileName, stripExtension } from '../src/ops/zip.js';
import { formatBytes, timeoutForPageCount, LIMITS } from '../src/limits.js';
import { withJobLimits, JobAbortedError } from '../src/job.js';
import { makeFixturePdf, testContext } from './fixtures.js';

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

    expect(output.fileName).toBe('a.pdf');
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