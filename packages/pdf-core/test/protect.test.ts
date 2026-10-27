/**
 * Protect PDF -- encryption is only useful if it really locks the bytes.
 *
 * These tests open the OUTPUT independently (pdf-lib for the password gate,
 * pdf.js for permissions and text extraction) rather than trusting the job's
 * return value. The raw stream markers are asserted too, so a regression to
 * permission-bit-only "protection" fails loudly.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import {
  normalizePermissions,
  protectDocument,
  validateProtectOptions,
} from '../src/ops/protect.js';
import { PROTECT_DEFAULT_PERMISSIONS } from '../src/ops/protectConfig.js';
import { unlockDocument } from '../src/ops/unlock.js';
import { protectJob } from '../src/jobs/protect.job.js';
import { configurePdfjsRuntime, loadPdfForRender } from '../src/render/pdfjsRuntime.js';
import { makeFixturePdf, testContext } from './fixtures.js';
import { decodeBase64, ENCRYPTED_AES128_BASE64 } from './encryptedFixtures.js';

beforeAll(() => {
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
      .href,
  });
});

const OPEN = 'open-pass-123';
const PERM = {
  PRINT: 0x04,
  MODIFY_CONTENTS: 0x08,
  COPY: 0x10,
  MODIFY_ANNOTATIONS: 0x20,
  FILL_FORMS: 0x100,
  COPY_ACCESSIBILITY: 0x200,
  ASSEMBLE: 0x400,
  PRINT_HIGH: 0x800,
} as const;

function inputFor(data: Uint8Array, options?: Record<string, unknown>) {
  return {
    files: [{ name: 'doc.pdf', data }],
    ...(options ? { options } : {}),
  };
}

describe('protect', () => {
  test('writes a real AES-256 encrypted copy that only the open password decrypts', async () => {
    const source = await makeFixturePdf({ pages: 2 });
    const result = await protectDocument(source, { userPassword: OPEN }, testContext());

    expect(result.algorithm).toBe('AES-256');
    expect(result.pageCount).toBe(2);
    expect(result.ownerPasswordGenerated).toBe(true);
    expect(result.data).not.toEqual(source);

    const raw = Array.from(result.data, (byte) => String.fromCharCode(byte)).join('');
    expect(raw).toContain('/Encrypt');
    expect(raw).toContain('/AESV3');
    expect(raw).toContain('/V 5');
    expect(raw).toContain('/R 6');

    const reopened = await PDFDocument.load(result.data, { password: OPEN });
    expect(reopened.getPageCount()).toBe(2);
    await expect(PDFDocument.load(result.data)).rejects.toThrow();
    await expect(PDFDocument.load(result.data, { password: 'wrong-password' })).rejects.toThrow();
    await expect(
      protectDocument(result.data, { userPassword: 'another-password' }, testContext()),
    ).rejects.toThrow(/already encrypted/i);

    // The UI tells people the open password can remove protection. Prove it:
    // Unlock must produce a clean PDF, not leave the /Encrypt trailer behind.
    const unlocked = await unlockDocument(result.data, OPEN, testContext());
    expect(unlocked.wasEncrypted).toBe(true);
    const unlockedRaw = Array.from(unlocked.data, (byte) => String.fromCharCode(byte)).join('');
    expect(unlockedRaw).not.toContain('/Encrypt');
    expect(unlockedRaw).not.toContain('/AESV3');
    await expect(PDFDocument.load(unlocked.data)).resolves.toBeDefined();

    const unlockedView = await loadPdfForRender(unlocked.data);
    try {
      const page = await unlockedView.doc.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      expect(text).toContain('PDFShush page 1');
    } finally {
      await unlockedView.destroy();
    }
  });

  test('sets permission flags through a separate owner key and preserves the text layer', async () => {
    const source = await makeFixturePdf({ pages: 2 });
    const result = await protectDocument(
      source,
      {
        userPassword: OPEN,
        ownerPassword: 'owner-pass-456',
        permissions: {
          printing: false,
          copying: false,
          modifying: false,
          annotating: true,
          fillingForms: false,
          documentAssembly: false,
        },
      },
      testContext(),
    );

    const loaded = await loadPdfForRender(result.data, { password: OPEN });
    try {
      const permissions = new Set(await loaded.doc.getPermissions());
      expect(permissions.has(PERM.PRINT)).toBe(false);
      expect(permissions.has(PERM.PRINT_HIGH)).toBe(false);
      expect(permissions.has(PERM.COPY)).toBe(false);
      expect(permissions.has(PERM.MODIFY_CONTENTS)).toBe(false);
      expect(permissions.has(PERM.ASSEMBLE)).toBe(false);
      expect(permissions.has(PERM.MODIFY_ANNOTATIONS)).toBe(true);
      expect(permissions.has(PERM.FILL_FORMS)).toBe(false);
      // Accessibility is always allowed, even when every other switch is off.
      expect(permissions.has(PERM.COPY_ACCESSIBILITY)).toBe(true);

      const page = await loaded.doc.getPage(1);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      expect(text).toContain('PDFShush page 1');
    } finally {
      await loaded.destroy();
    }
  });

  test('handles non-Latin passwords without mangling them', async () => {
    const password = 'pässwörd-日本語';
    const source = await makeFixturePdf({ pages: 1 });
    const result = await protectDocument(source, { userPassword: password }, testContext());
    const reopened = await PDFDocument.load(result.data, { password });
    expect(reopened.getPageCount()).toBe(1);
    await expect(PDFDocument.load(result.data, { password: 'pässwörd-日本' })).rejects.toThrow();
  });

  test('refuses an already encrypted source instead of double-locking it', async () => {
    const locked = decodeBase64(ENCRYPTED_AES128_BASE64);
    await expect(
      protectDocument(locked, { userPassword: OPEN }, testContext()),
    ).rejects.toThrow(/already encrypted/i);
  });

  test('validates password length, owner mismatch and permission shape', () => {
    expect(() => validateProtectOptions({ userPassword: 'short' })).toThrow(/at least 8/i);
    expect(() =>
      validateProtectOptions({ userPassword: OPEN, ownerPassword: OPEN }),
    ).toThrow(/different/i);
    expect(() =>
      validateProtectOptions({ userPassword: OPEN, ownerPassword: 'short' }),
    ).toThrow(/at least 8/i);
    expect(() => validateProtectOptions({ userPassword: 'x'.repeat(257) })).toThrow(/too long/i);

    expect(normalizePermissions(undefined)).toEqual(PROTECT_DEFAULT_PERMISSIONS);
    expect(normalizePermissions({ copying: true, printing: false })).toMatchObject({
      copying: true,
      printing: false,
      modifying: false,
      annotating: true,
      fillingForms: true,
      documentAssembly: false,
    });
  });

  test('the job reports the encrypted contract and a safe file name', async () => {
    const source = await makeFixturePdf({ pages: 3 });
    const result = await protectJob.run(
      inputFor(source, { userPassword: OPEN }),
      testContext(),
    );

    expect(result.fileName).toBe('doc-protected.pdf');
    expect(result.algorithm).toBe('AES-256');
    expect(result.pageCount).toBe(3);
    expect(result.originalBytes).toBe(source.byteLength);
    expect(result.ownerPasswordGenerated).toBe(true);
    expect(result.permissions).toEqual(PROTECT_DEFAULT_PERMISSIONS);

    const reopened = await PDFDocument.load(result.data, { password: OPEN });
    expect(reopened.getPageCount()).toBe(3);
  });

  test('job validation rejects missing, short and matching owner passwords', () => {
    const source = new Uint8Array(0);
    expect(protectJob.validate(inputFor(source, { userPassword: OPEN }))).toMatchObject({
      ok: true,
    });
    expect(protectJob.validate(inputFor(source))).toMatchObject({ ok: false });
    expect(protectJob.validate(inputFor(source, { userPassword: 'short' }))).toMatchObject({
      ok: false,
    });
    expect(
      protectJob.validate(
        inputFor(source, { userPassword: OPEN, ownerPassword: OPEN }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      protectJob.validate(
        inputFor(source, { userPassword: OPEN, permissions: { copying: 'yes' } }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      protectJob.validate(
        inputFor(source, { userPassword: OPEN, permissions: { notAThing: true } }),
      ),
    ).toMatchObject({ ok: false });
  });
});
