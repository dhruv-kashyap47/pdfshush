/**
 * Protect PDF -- real AES-256 encryption, on this device.
 *
 * `@cantoo/pdf-lib` ships the encryption write path that upstream pdf-lib still
 * lacks. We use it directly (no permission-bit theatre): every string and
 * stream is encrypted with a key derived from the open password, and the
 * permission flags are protected by a separate owner key. A reader that only
 * has the open password can view the document but cannot silently turn the
 * restrictions off.
 *
 * When the caller does not supply an owner password we generate a random one
 * and never return it. That keeps the permission switches meaningful without
 * asking people to manage two secrets. The open password can still be used with
 * Unlock to remove protection and start over.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import type { JobContext } from '../job.js';
import {
  PROTECT_DEFAULT_PERMISSIONS,
  PROTECT_LIMITS,
  type ProtectPermissions,
} from './protectConfig.js';

export type { ProtectPermissions } from './protectConfig.js';

export interface ProtectOptions {
  userPassword: string;
  /** Optional. When omitted, a random owner password is generated. */
  ownerPassword?: string;
  permissions?: Partial<ProtectPermissions>;
}

export interface ProtectResult {
  data: Uint8Array;
  pageCount: number;
  algorithm: 'AES-256';
  permissions: ProtectPermissions;
  /** True when the engine generated the owner key instead of using one supplied. */
  ownerPasswordGenerated: boolean;
}

export async function protectDocument(
  data: Uint8Array,
  options: ProtectOptions,
  ctx?: JobContext,
): Promise<ProtectResult> {
  validateProtectOptions(options);

  let doc: PDFDocument;
  try {
    // `ignoreEncryption` lets us answer "is this already locked?" without
    // needing a password. We never save that parse: an encrypted source is
    // refused below so we cannot accidentally launder a locked file.
    doc = await PDFDocument.load(data, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch {
    throw new Error('Could not read this PDF. It may be damaged or not be a PDF at all.');
  }

  if (doc.isEncrypted) {
    throw new Error(
      'This PDF is already encrypted. Use Unlock first if you want to replace its password or permissions.',
    );
  }

  ctx?.throwIfAborted();

  const permissions = normalizePermissions(options.permissions);
  const ownerPassword =
    options.ownerPassword && options.ownerPassword.length > 0
      ? options.ownerPassword
      : randomOwnerPassword();
  const ownerPasswordGenerated = !options.ownerPassword;

  try {
    doc.encrypt({
      userPassword: options.userPassword,
      ownerPassword,
      permissions: {
        // AES-256 is the modern ISO 32000-2 handler. `printing: false` is a
        // real flag; high-resolution printing sets both print bits.
        printing: permissions.printing ? 'highResolution' : false,
        copying: permissions.copying,
        modifying: permissions.modifying,
        annotating: permissions.annotating,
        fillingForms: permissions.fillingForms,
        // Accessibility is deliberately always granted.
        contentAccessibility: true,
        documentAssembly: permissions.documentAssembly,
      },
      algorithm: 'AES-256',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/PDF\/A|PDFA/i.test(message)) {
      throw new Error(
        'PDF/A forbids encryption. Convert this document to a regular PDF, then protect it.',
      );
    }
    throw new Error(
      'Could not encrypt this PDF. It may use a feature the encryptor cannot handle.',
    );
  }

  ctx?.throwIfAborted();
  const pageCount = doc.getPageCount();
  const bytes = await doc.save({ useObjectStreams: true });

  // Never trust that "encrypt() ran" means the output is encrypted. A missing
  // /Encrypt trailer is exactly the fake-protection failure we refuse to ship.
  if (!containsAscii(bytes, '/Encrypt') || !containsAscii(bytes, '/AESV3')) {
    throw new Error('The encrypted copy could not be verified. Keep the original and try again.');
  }

  return {
    data: bytes,
    pageCount,
    algorithm: 'AES-256',
    permissions,
    ownerPasswordGenerated,
  };
}

export function validateProtectOptions(options: ProtectOptions): void {
  const user = options.userPassword;
  if (typeof user !== 'string' || user.length === 0) {
    throw new Error('Choose an open password.');
  }
  if (user.length < PROTECT_LIMITS.minPasswordLength) {
    throw new Error(
      `Use at least ${PROTECT_LIMITS.minPasswordLength} characters for the open password.`,
    );
  }
  if (user.length > PROTECT_LIMITS.maxPasswordLength) {
    throw new Error(
      `That password is too long. Keep it under ${PROTECT_LIMITS.maxPasswordLength} characters.`,
    );
  }

  const owner = options.ownerPassword;
  if (owner !== undefined) {
    if (typeof owner !== 'string') throw new Error('The owner password must be text.');
    if (owner.length > 0 && owner.length < PROTECT_LIMITS.minPasswordLength) {
      throw new Error(
        `Use at least ${PROTECT_LIMITS.minPasswordLength} characters for the owner password, or leave it blank.`,
      );
    }
    if (owner.length > PROTECT_LIMITS.maxPasswordLength) {
      throw new Error(
        `That owner password is too long. Keep it under ${PROTECT_LIMITS.maxPasswordLength} characters.`,
      );
    }
    if (owner.length > 0 && owner === user) {
      throw new Error('The owner password must be different from the open password.');
    }
  }
}

export function normalizePermissions(
  permissions: Partial<ProtectPermissions> | undefined,
): ProtectPermissions {
  const pick = (key: keyof ProtectPermissions): boolean => {
    const value = permissions?.[key];
    return typeof value === 'boolean' ? value : PROTECT_DEFAULT_PERMISSIONS[key];
  };
  return {
    printing: pick('printing'),
    copying: pick('copying'),
    modifying: pick('modifying'),
    annotating: pick('annotating'),
    fillingForms: pick('fillingForms'),
    documentAssembly: pick('documentAssembly'),
  };
}

/** 192 bits of platform randomness, hex-encoded for a 48-character password. */
function randomOwnerPassword(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error(
      'This browser does not expose secure randomness, so it cannot create an encryption key.',
    );
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const first = needle.charCodeAt(0);
  const limit = bytes.length - needle.length;
  outer: for (let i = 0; i <= limit; i += 1) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return true;
  }
  return false;
}
