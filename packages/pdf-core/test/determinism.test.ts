/**
 * Deterministic output: same input, same bytes.
 *
 * `PDFDocument.create()` stamps the current wall clock into /ModDate and
 * /CreationDate, so two runs of the same merge used to differ. These tests pin
 * the clock to two different moments and demand identical output, then check
 * the date policy itself (inherited from sources, or omitted when there is no
 * source document).
 */

import { PDFDocument, PDFRef } from '@cantoo/pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { combineToPdf } from '../src/ops/combine.js';
import { composePageRefs } from '../src/ops/compose.js';
import { combineDocumentDates } from '../src/ops/dates.js';
import { imagesToPdf } from '../src/ops/imageDocs.js';
import { mergePdfs } from '../src/ops/merge.js';
import { splitPagesInHalf } from '../src/ops/split.js';
import { testContext } from './fixtures.js';
import { encodePng } from './png.js';

beforeEach(() => {
  // Only Date is faked: pdf-lib uses no timers, and the rest of the runtime
  // (microtasks, promises) must behave normally.
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** A one-page source with explicit provenance dates. */
async function datedPdf(created: string, modified: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(created));
  doc.setModificationDate(new Date(modified));
  doc.addPage([200, 300]);
  return doc.save({ useObjectStreams: false });
}

/** A source with no /CreationDate or /ModDate at all. */
async function undatedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // Drop the whole Info dictionary, the way redaction does, so the fixture is
  // genuinely date-free without relying on the helper under test.
  const info = doc.context.trailerInfo.Info;
  if (info instanceof PDFRef) doc.context.delete(info);
  doc.context.trailerInfo.Info = undefined;
  doc.addPage([200, 300]);
  return doc.save({ useObjectStreams: false });
}

async function datesOf(bytes: Uint8Array): Promise<{ created?: string; modified?: string }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return {
    created: doc.getCreationDate()?.toISOString(),
    modified: doc.getModificationDate()?.toISOString(),
  };
}

/** Runs `fn` with the system clock pinned to `iso`. */
async function at<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  vi.setSystemTime(new Date(iso));
  return fn();
}

describe('combineDocumentDates', () => {
  it('takes the earliest creation and the latest modification', () => {
    expect(
      combineDocumentDates([
        { creationDate: new Date('2020-01-01T00:00:00Z'), modificationDate: new Date('2021-01-01T00:00:00Z') },
        { creationDate: new Date('2019-05-05T00:00:00Z'), modificationDate: new Date('2022-02-02T00:00:00Z') },
      ]),
    ).toEqual({
      creationDate: new Date('2019-05-05T00:00:00Z'),
      modificationDate: new Date('2022-02-02T00:00:00Z'),
    });
  });

  it('ignores sources without dates and returns nothing when none have them', () => {
    expect(combineDocumentDates([{}, {}])).toEqual({});
    expect(
      combineDocumentDates([{}, { creationDate: new Date('2020-01-01T00:00:00Z') }]),
    ).toEqual({ creationDate: new Date('2020-01-01T00:00:00Z') });
  });
});

describe('deterministic output', () => {
  it('merges two documents to identical bytes at two different wall-clock times', async () => {
    const sources = [
      { name: 'a.pdf', data: await datedPdf('2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z') },
      { name: 'b.pdf', data: await datedPdf('2019-05-05T00:00:00Z', '2022-02-02T00:00:00Z') },
    ];

    const first = await at('2024-06-01T09:00:00Z', () => mergePdfs(sources, testContext()));
    const second = await at('2031-12-31T23:59:59Z', () => mergePdfs(sources, testContext()));

    expect(bytesEqual(first.data, second.data)).toBe(true);
    expect(await datesOf(first.data)).toEqual({
      created: '2019-05-05T00:00:00.000Z',
      modified: '2022-02-02T00:00:00.000Z',
    });
  });

  it('merges documents without dates to identical, date-free bytes', async () => {
    const sources = [
      { name: 'a.pdf', data: await undatedPdf() },
      { name: 'b.pdf', data: await undatedPdf() },
    ];

    const first = await at('2024-06-01T09:00:00Z', () => mergePdfs(sources, testContext()));
    const second = await at('2031-12-31T23:59:59Z', () => mergePdfs(sources, testContext()));

    expect(bytesEqual(first.data, second.data)).toBe(true);
    expect(await datesOf(first.data)).toEqual({ created: undefined, modified: undefined });
  });

  it('splits to identical halves that inherit the source dates', async () => {
    const source = {
      name: 'source.pdf',
      data: await datedPdf('2020-01-01T00:00:00Z', '2023-03-03T00:00:00Z'),
    };

    const first = await at('2024-06-01T09:00:00Z', () =>
      splitPagesInHalf(source, 'vertical', testContext()),
    );
    const second = await at('2031-12-31T23:59:59Z', () =>
      splitPagesInHalf(source, 'vertical', testContext()),
    );

    expect(bytesEqual(first.first, second.first)).toBe(true);
    expect(bytesEqual(first.second, second.second)).toBe(true);
    expect(await datesOf(first.first)).toEqual({
      created: '2020-01-01T00:00:00.000Z',
      modified: '2023-03-03T00:00:00.000Z',
    });
    expect(await datesOf(first.second)).toEqual({
      created: '2020-01-01T00:00:00.000Z',
      modified: '2023-03-03T00:00:00.000Z',
    });
  });

  it('composes to identical bytes at two different wall-clock times', async () => {
    const sources = [
      { name: 'a.pdf', data: await datedPdf('2018-08-08T00:00:00Z', '2020-09-09T00:00:00Z') },
    ];
    const refs = [{ docIndex: 0, pageIndex: 0 }];

    const first = await at('2024-06-01T09:00:00Z', () =>
      composePageRefs(sources, refs, testContext()),
    );
    const second = await at('2031-12-31T23:59:59Z', () =>
      composePageRefs(sources, refs, testContext()),
    );

    expect(bytesEqual(first.data, second.data)).toBe(true);
    expect(await datesOf(first.data)).toEqual({
      created: '2018-08-08T00:00:00.000Z',
      modified: '2020-09-09T00:00:00.000Z',
    });
  });

  it('combines a PDF and an image deterministically, inheriting the PDF dates', async () => {
    const sources = [
      { name: 'a.pdf', data: await datedPdf('2017-07-07T00:00:00Z', '2019-09-09T00:00:00Z') },
      { name: 'photo.png', data: encodePng(40, 30, [{ x: 4, y: 4, w: 10, h: 8 }]) },
    ];

    const first = await at('2024-06-01T09:00:00Z', () =>
      combineToPdf(sources, {}, testContext()),
    );
    const second = await at('2031-12-31T23:59:59Z', () =>
      combineToPdf(sources, {}, testContext()),
    );

    expect(bytesEqual(first.data, second.data)).toBe(true);
    expect(await datesOf(first.data)).toEqual({
      created: '2017-07-07T00:00:00.000Z',
      modified: '2019-09-09T00:00:00.000Z',
    });
  });

  it('omits dates from an image-only document and stays deterministic', async () => {
    const images = [{ name: 'photo.png', data: encodePng(40, 30, [{ x: 4, y: 4, w: 10, h: 8 }]) }];

    const first = await at('2024-06-01T09:00:00Z', () =>
      imagesToPdf(images, { pageSize: 'a4' }, testContext()),
    );
    const second = await at('2031-12-31T23:59:59Z', () =>
      imagesToPdf(images, { pageSize: 'a4' }, testContext()),
    );

    expect(bytesEqual(first.data, second.data)).toBe(true);
    expect(await datesOf(first.data)).toEqual({ created: undefined, modified: undefined });
  });
});
