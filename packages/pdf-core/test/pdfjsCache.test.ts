/**
 * The pdf.js document cache key must (a) identify a document, not just its
 * length, and (b) never contain the open password in plaintext. Both broke
 * under the old 32-bit FNV-1a + `${password}` splice: a collision would serve
 * a different parsed document to the caller, and every password sat in the
 * cache Map for the worker's lifetime.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  documentKey,
  loadPdfForRender,
  resetPdfCache,
} from '../src/render/pdfjsRuntime.js';
import { makeFixturePdf } from './fixtures.js';

beforeAll(async () => {
  const { configurePdfjsRuntime } = await import('../src/render/pdfjsRuntime.js');
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
      .href,
  });
  await resetPdfCache();
});

describe('documentKey', () => {
  it('keys on the SHA-256 of the bytes, so a collision cannot alias documents', async () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(await documentKey(a, '')).not.toBe(await documentKey(b, ''));
    // Rehashing the same bytes is stable (cache hits depend on it).
    expect(await documentKey(a, '')).toBe(await documentKey(new Uint8Array(a), ''));
  });

  it('never contains the plaintext password', async () => {
    const password = 'swordfish-open-sesame';
    const key = await documentKey(new Uint8Array([9, 9, 9]), password);
    expect(key).not.toContain(password);
    // The password still participates: different passwords get different keys.
    expect(await documentKey(new Uint8Array([9, 9, 9]), 'another-password')).not.toBe(key);
    // Different passwords get different keys, and the shape is digest-only.
    expect(key).toMatch(/^[0-9a-f]{64}:\d+:[0-9a-f]+$/);
    // No password at all uses the empty third field.
    expect(await documentKey(new Uint8Array([9, 9, 9]), '')).toMatch(/^[0-9a-f]{64}:\d+:$/);
  });
});

describe('loadPdfForRender cache', () => {
  it('returns the same parsed document for the same bytes without a password', async () => {
    const bytes = await makeFixturePdf({ pages: 1 });
    const first = await loadPdfForRender(bytes);
    const second = await loadPdfForRender(bytes);
    expect(second.doc).toBe(first.doc);
    await first.destroy();
    await second.destroy();
    await resetPdfCache();
  });

  it('does not hand a cached document whose stored password differs', async () => {
    const open = 'cache-test-pass';
    const source = await makeFixturePdf({ pages: 1 });
    const { protectDocument } = await import('../src/ops/protect.js');
    const { testContext } = await import('./fixtures.js');
    const encrypted = await protectDocument(source, { userPassword: open }, testContext());

    const withPassword = await loadPdfForRender(encrypted.data, { password: open });
    // Same bytes, no password: pdf.js would reject the load, so the cache must
    // not have served the entry keyed with the password.
    await expect(loadPdfForRender(encrypted.data)).rejects.toThrow();
    await withPassword.destroy();
    await resetPdfCache();
  });
});
