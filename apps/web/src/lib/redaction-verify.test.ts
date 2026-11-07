/**
 * The standalone verifier must not upgrade an undecidable check into a pass,
 * and its receipt must be reproducible. Both are claims the page makes in
 * public, so both are pinned here.
 */

import { describe, expect, it } from 'vitest';
import {
  CHECK_LABELS,
  classifyCheck,
  formatReceipt,
  labelForCheck,
  sha256Hex,
  summarizeVerification,
  type UserVerification,
} from './redaction-verify';

/** Every check name `verifyRedaction` can emit today. */
const ENGINE_CHECKS = [
  'parses',
  'page-count',
  'no-annotations',
  'pages-are-single-images',
  'page-images-substantial',
  'content-has-no-text-operators',
  'marks-burned-in',
  'page-not-blank',
  'no-attachments',
  'metadata-stripped',
  'text-extractable',
  'no-extractable-text',
  'forbidden-strings-absent',
];

describe('check mapping', () => {
  it('has a human label for every check the engine can emit', () => {
    const missing = ENGINE_CHECKS.filter((name) => !CHECK_LABELS[name]);
    expect(missing).toEqual([]);
  });

  it('reports marks-burned-in as not checked, never as a pass', () => {
    const mapped = classifyCheck({ name: 'marks-burned-in', ok: true, detail: '0 marked area(s)' });
    expect(mapped.status).toBe('n/a');
    expect(mapped.detail).toMatch(/not checked/iu);
  });

  it('reports the page count as information, not evidence', () => {
    const mapped = classifyCheck({ name: 'page-count', ok: true, detail: 'expected 3, found 3' });
    expect(mapped.status).toBe('info');
  });

  it('keeps a failed check failed and passes a passed check', () => {
    expect(classifyCheck({ name: 'no-extractable-text', ok: false, detail: '12 runs' }).status).toBe(
      'fail',
    );
    expect(classifyCheck({ name: 'no-extractable-text', ok: true, detail: 'none' }).status).toBe(
      'pass',
    );
  });

  it('renders an unknown future check as words rather than leaking its slug', () => {
    expect(labelForCheck('some-new-check')).toBe('some new check');
  });

  it('never resolves inherited Object.prototype keys as labels', () => {
    // A worker message or recipe can carry an arbitrary name; the label lookup
    // must not return the inherited `constructor`/`__proto__` values.
    expect(labelForCheck('constructor')).toBe('constructor');
    expect(labelForCheck('__proto__')).toBe('__proto__');
    expect(labelForCheck('toString')).toBe('toString');
    expect(String(labelForCheck('valueOf'))).not.toMatch(/native code/iu);
  });
});

describe('verdict', () => {
  const base = { digest: 'a'.repeat(64), byteLength: 1234, pageCount: 2 };

  it('is clean when every applicable check passes, even with n/a and info rows', () => {
    const result = summarizeVerification(
      [
        { name: 'parses', ok: true, detail: 'ok' },
        { name: 'page-count', ok: true, detail: '2' },
        { name: 'marks-burned-in', ok: true, detail: 'vacuous' },
        { name: 'no-extractable-text', ok: true, detail: 'none' },
      ],
      base,
    );
    expect(result.ok).toBe(true);
    expect(result.failed).toBe(0);
    expect(result.notChecked).toBe(1);
  });

  it('is not clean when one applicable check fails, and says how many', () => {
    const result = summarizeVerification(
      [
        { name: 'parses', ok: true, detail: 'ok' },
        { name: 'no-extractable-text', ok: false, detail: '12 runs survive' },
        { name: 'metadata-stripped', ok: false, detail: 'still present: Producer' },
      ],
      base,
    );
    expect(result.ok).toBe(false);
    expect(result.failed).toBe(2);
  });

  it('does not show a vacuous image pass beside a failed image check', () => {
    const result = summarizeVerification(
      [
        { name: 'pages-are-single-images', ok: false, detail: '3 page(s) are not one image' },
        { name: 'page-images-substantial', ok: true, detail: 'every page image is full-size' },
        { name: 'page-not-blank', ok: true, detail: 'pages retain visible content' },
      ],
      base,
    );
    const byName = Object.fromEntries(result.checks.map((check) => [check.name, check.status]));
    expect(byName['pages-are-single-images']).toBe('fail');
    expect(byName['page-images-substantial']).toBe('n/a');
    expect(byName['page-not-blank']).toBe('n/a');
    expect(result.failed).toBe(1);
    expect(result.notChecked).toBe(2);
  });

  it('keeps a real page-not-blank failure when the pages are images', () => {
    const result = summarizeVerification(
      [
        { name: 'pages-are-single-images', ok: true, detail: 'one image per page' },
        { name: 'page-not-blank', ok: false, detail: 'p1: contrast spread only 0' },
      ],
      base,
    );
    const row = result.checks.find((check) => check.name === 'page-not-blank');
    expect(row?.status).toBe('fail');
  });
});

describe('receipt', () => {
  const verification: UserVerification = summarizeVerification(
    [
      { name: 'parses', ok: true, detail: 'exported bytes reload as a PDF' },
      { name: 'page-count', ok: true, detail: 'expected 1, found 1' },
      { name: 'marks-burned-in', ok: true, detail: '0 marked area(s) are opaque' },
      { name: 'no-extractable-text', ok: true, detail: 'no text is extractable' },
    ],
    { digest: 'f'.repeat(64), byteLength: 999, pageCount: 1 },
  );

  it('is byte-identical for the same input (no timestamp, no locale formatting)', () => {
    expect(formatReceipt(verification)).toBe(formatReceipt(structuredClone(verification)));
  });

  it('states the digest, the verdict and the not-checked row', () => {
    const receipt = formatReceipt(verification);
    expect(receipt).toContain(`SHA-256  ${'f'.repeat(64)}`);
    expect(receipt).toContain('Verdict  CLEAN');
    expect(receipt).toContain('N/A   Marks burned into pixels');
    expect(receipt).toContain('same file always produces this receipt');
  });

  it('reports content that remains instead of rounding a failure up', () => {
    const dirty = summarizeVerification(
      [{ name: 'no-extractable-text', ok: false, detail: '12 text run(s) survive' }],
      { digest: 'b'.repeat(64), byteLength: 10, pageCount: null },
    );
    const receipt = formatReceipt(dirty);
    expect(receipt).toContain('CONTENT REMAINS - 1 check(s) failed');
    expect(receipt).toContain('Pages    unreadable');
    expect(receipt).toContain('FAIL  No extractable text: 12 text run(s) survive');
  });
});

describe('digest', () => {
  it('is the standard SHA-256 of the bytes', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('changes when one byte changes', async () => {
    const a = await sha256Hex(new Uint8Array([1, 2, 3]));
    const b = await sha256Hex(new Uint8Array([1, 2, 4]));
    expect(a).not.toBe(b);
  });
});
