/**
 * Golden export assertions (G-03).
 *
 * One reusable check for every future engine change: reopen the output, compare
 * page count and size, prove the requested text is present and removed text is
 * absent, and assert untouched pages still extract exactly what they did
 * before. The pixel gate lives in `verifyExportArtifact`; this harness is the
 * cheap, text-level companion that runs on every corpus fixture.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import { extractTextRuns } from '../src/index.js';

export interface GoldenExpectation {
  pageCount?: number;
  /** Per-page display size in points, in order. */
  pages?: Array<{ width: number; height: number }>;
  contains?: string[];
  absent?: string[];
  /** pageIndex -> exact extracted text that must not change. */
  untouchedText?: Record<number, string>;
}

export interface GoldenResult {
  pageCount: number;
  pages: Array<{ width: number; height: number }>;
  textByPage: string[];
}

async function textByPage(bytes: Uint8Array, pageCount: number): Promise<string[]> {
  const runs = await extractTextRuns(bytes, Array.from({ length: pageCount }, (_, index) => index));
  return runs.map((pageRuns) => pageRuns.map((run) => run.text).join('\n'));
}

export async function inspectExport(bytes: Uint8Array): Promise<GoldenResult> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    return { width: Math.round(width), height: Math.round(height) };
  });
  return {
    pageCount: pages.length,
    pages,
    textByPage: await textByPage(bytes, pages.length),
  };
}

export async function assertGoldenExport(
  output: Uint8Array,
  expectation: GoldenExpectation,
  label = 'export',
): Promise<GoldenResult> {
  const result = await inspectExport(output);
  const problems: string[] = [];
  const normalise = (value: string): string => value.replace(/\s+/g, ' ').trim();

  if (expectation.pageCount !== undefined && result.pageCount !== expectation.pageCount) {
    problems.push(`page count ${result.pageCount} != ${expectation.pageCount}`);
  }
  if (expectation.pages) {
    expectation.pages.forEach((expected, index) => {
      const actual = result.pages[index];
      if (!actual) {
        problems.push(`page ${index + 1} is missing`);
        return;
      }
      if (
        Math.abs(actual.width - expected.width) > 1 ||
        Math.abs(actual.height - expected.height) > 1
      ) {
        problems.push(
          `page ${index + 1} size ${actual.width}x${actual.height} != ${expected.width}x${expected.height}`,
        );
      }
    });
  }

  const allText = normalise(result.textByPage.join('\n'));
  for (const expected of expectation.contains ?? []) {
    if (!allText.includes(normalise(expected))) problems.push(`missing text "${expected}"`);
  }
  for (const forbidden of expectation.absent ?? []) {
    if (allText.includes(normalise(forbidden))) problems.push(`text "${forbidden}" still present`);
  }
  for (const [index, expected] of Object.entries(expectation.untouchedText ?? {})) {
    const actual = normalise(result.textByPage[Number(index)] ?? '');
    if (actual !== normalise(expected)) {
      problems.push(`page ${Number(index) + 1} text changed: "${actual}" != "${expected}"`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`${label}: ${problems.join('; ')}`);
  }
  return result;
}
