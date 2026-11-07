/**
 * Protect's output verification used to be a byte-substring scan for `/Encrypt`
 * and `/AESV3`. That proves nothing: the words may or may not survive the
 * output container, and they are ordinary dictionary noise a member can match
 * by accident. The verify step is now a round-trip -- the saved copy must
 * reload under the open password. These tests stub `@cantoo/pdf-lib` so the
 * saved "PDF" is a bare byte array with no markers at all, proving the gate
 * reads the parse, not the bytes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const stub = vi.hoisted(() => ({
  /** The password the stub loader will accept. */
  passwordOf: 'open-pass-123',
  /** Force the round-trip load to fail, simulating a bad save. */
  loadFails: false,
  pages: 3,
}));

vi.mock('@cantoo/pdf-lib', () => {
  const PDFDocument = {
    async load(
      _data: Uint8Array,
      options?: { password?: string; ignoreEncryption?: boolean },
    ) {
      if (options?.ignoreEncryption) {
        // The entry probe (is this already locked?).
        return {
          isEncrypted: false,
          getPageCount: () => stub.pages,
          encrypt: () => undefined,
          save: async () => new Uint8Array([1, 2, 3, 4]),
        };
      }
      if (stub.loadFails || options?.password !== stub.passwordOf) {
        throw new Error('decode failure');
      }
      return { getPageCount: () => stub.pages };
    },
  };
  return { PDFDocument };
});

import { protectDocument, type ProtectOptions } from '../src/ops/protect.js';
import { testContext } from './fixtures.js';

const documentStub = undefined as unknown as never;

beforeEach(() => {
  stub.loadFails = false;
  stub.passwordOf = 'open-pass-123';
});

const baseOptions = (userPassword: string): ProtectOptions => ({ userPassword });

describe('protect verification', () => {
  it('verifies by round-trip, not by /Encrypt or /AESV3 byte markers', async () => {
    const result = await protectDocument(
      new Uint8Array([9, 9, 9]),
      baseOptions('open-pass-123'),
      testContext(),
    );
    // The stub's save returns four bytes with no PDF structure at all. Under
    // the marker scan that copy would have been rejected; the round-trip
    // accepts it because it reloads under the password.
    expect(Array.from(result.data)).toEqual([1, 2, 3, 4]);
    expect(result.pageCount).toBe(3);
    expect(result.algorithm).toBe('AES-256');
    void documentStub;
  });

  it('refuses output that does not reload under the open password', async () => {
    stub.loadFails = true;
    await expect(
      protectDocument(new Uint8Array([9, 9, 9]), baseOptions('open-pass-123'), testContext()),
    ).rejects.toThrow(/could not be verified/i);
  });

  it('refuses output that merely accepted wrong-password loads', async () => {
    // The saved copy reloads only under a different password, which is exactly
    // the failure fake protection produces.
    stub.passwordOf = 'another-passkey';
    const result = protectDocument(
      new Uint8Array([9, 9, 9]),
      baseOptions('open-pass-123'),
      testContext(),
    );
    await expect(result).rejects.toThrow(/could not be verified/i);
  });
});
