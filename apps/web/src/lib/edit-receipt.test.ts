/**
 * The receipt is a public claim about what an export did, so the two things a
 * claim can get wrong are pinned here: softening a lossy mode, and changing
 * between two runs of the same data.
 */

import { describe, expect, it } from 'vitest';
import type { TextEditJobReport } from '@pdfshush/pdf-core';
import {
  EDIT_MODE_COPY,
  formatEditReceipt,
  hasRecoverableOriginal,
  receiptFileNameFor,
  summarizeEditModes,
  totalEdits,
} from './edit-receipt';

function report(overrides: Partial<TextEditJobReport> = {}): TextEditJobReport {
  return {
    outcomes: [],
    inPlace: 0,
    contentStream: 0,
    fallback: 0,
    manualReview: 0,
    usedNativeEngine: false,
    verification: { ok: true, checks: [{ name: 'reopened', ok: true, detail: 'reopened' }] },
    warnings: [],
    ...overrides,
  };
}

const input = {
  fileName: 'report.pdf',
  pageCount: 3,
  sizeBytes: 2048,
  report: report({ inPlace: 2, contentStream: 1, fallback: 1 }),
};

describe('edit mode summary', () => {
  it('lists only modes that occurred, in a stable order', () => {
    const summaries = summarizeEditModes(input.report);
    expect(summaries.map((summary) => summary.mode)).toEqual([
      'in-place',
      'content-stream',
      'fallback',
    ]);
    expect(summaries.map((summary) => summary.count)).toEqual([2, 1, 1]);
  });

  it('counts every edit exactly once', () => {
    expect(totalEdits(input.report)).toBe(4);
  });

  it('never hides the recoverable-original case', () => {
    expect(hasRecoverableOriginal(input.report)).toBe(true);
    expect(hasRecoverableOriginal(report({ inPlace: 9 }))).toBe(false);
  });

  it('describes a fallback by its consequence, not a euphemism', () => {
    expect(EDIT_MODE_COPY.fallback.detail).toMatch(/still in the file underneath/i);
    expect(EDIT_MODE_COPY.fallback.detail).toMatch(/selectable, searchable and recoverable/i);
    expect(EDIT_MODE_COPY['manual-review'].detail).toMatch(/nothing was changed/i);
  });
});

describe('formatEditReceipt', () => {
  it('is byte-identical for the same export', () => {
    expect(formatEditReceipt(input)).toBe(formatEditReceipt(input));
  });

  it('carries no timestamp or date', () => {
    const text = formatEditReceipt(input);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/);
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('states the file, page count and size', () => {
    const text = formatEditReceipt(input);
    expect(text).toContain('File: report.pdf');
    expect(text).toContain('Pages: 3');
    expect(text).toContain('Size: 2.0 KB');
  });

  it('renders the fallback disclosure inline, not only as a count', () => {
    const text = formatEditReceipt(input);
    expect(text).toContain('1 × drawn over the original');
    expect(text).toContain('still in the file underneath it');
  });

  it('says plainly when only non-text changes were made', () => {
    const text = formatEditReceipt({
      ...input,
      report: report(),
    });
    expect(text).toContain('Text edits: none.');
    expect(text).not.toContain('0 ×');
  });

  it('reports failed checks with the engine detail instead of a bare count', () => {
    const text = formatEditReceipt({
      ...input,
      report: report({
        inPlace: 1,
        verification: {
          ok: false,
          checks: [
            { name: 'reopened', ok: true, detail: 'reopened' },
            { name: 'text-present', ok: false, detail: 'replacement text was not found after export' },
          ],
        },
      }),
    });
    expect(text).toContain('1 of 2 checks failed');
    expect(text).toContain('text-present: replacement text was not found after export');
    expect(text).not.toContain('2 of 2 checks passed');
  });

  it('does not claim verification that did not run', () => {
    const text = formatEditReceipt({
      ...input,
      report: report({ verification: { ok: true, checks: [] } }),
    });
    expect(text).toContain('no checks were run');
  });

  it('keeps engine warnings next to the result', () => {
    const text = formatEditReceipt({
      ...input,
      report: report({ fallback: 1, warnings: ['content-stream fallback was not used: unsupported'] }),
    });
    expect(text).toContain('Warnings:');
    expect(text).toContain('content-stream fallback was not used: unsupported');
  });

  it('ends with a newline so a saved file is well formed', () => {
    expect(formatEditReceipt(input).endsWith('\n')).toBe(true);
  });
});

describe('receiptFileNameFor', () => {
  it('derives a stable name beside the PDF', () => {
    expect(receiptFileNameFor('report.pdf')).toBe('report-edit-receipt.txt');
    expect(receiptFileNameFor('REPORT.PDF')).toBe('REPORT-edit-receipt.txt');
  });

  it('does not produce a leading dash for an empty stem', () => {
    expect(receiptFileNameFor('.pdf')).toBe('document-edit-receipt.txt');
  });
});
