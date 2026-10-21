/**
 * Unlock PDF -- removes password protection from a document you can open.
 *
 * pdf-lib decrypts on load when given the user password (including the empty
 * password that owner-restricted PDFs use) and drops the /Encrypt entry, so
 * saving produces a normal unencrypted PDF. That is the whole operation, and it
 * is honest about its limit: this cannot guess a password. Without the real
 * password the file stays locked.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import type { JobContext } from '../job.js';

export interface UnlockResult {
  data: Uint8Array;
  pageCount: number;
  /** False when the input had no /Encrypt at all; the copy is still clean. */
  wasEncrypted: boolean;
}

export async function unlockDocument(
  data: Uint8Array,
  password: string | undefined,
  ctx?: JobContext,
): Promise<UnlockResult> {
  const wasEncrypted = await probeEncryption(data);
  ctx?.throwIfAborted();

  let doc: PDFDocument;
  try {
    // Always pass a password: an owner-only PDF has an empty user password, and
    // pdf-lib only takes the decrypt path when `password` is defined.
    doc = await PDFDocument.load(data, {
      password: password ?? '',
      updateMetadata: false,
    });
  } catch (error) {
    throw mapUnlockError(error, Boolean(password));
  }

  ctx?.throwIfAborted();
  const pageCount = doc.getPageCount();
  const bytes = await doc.save({ useObjectStreams: false });
  return { data: bytes, pageCount, wasEncrypted };
}

/**
 * Parses the document once with encryption ignored purely to answer "was this
 * locked?". A failure here is not reported: the decrypt attempt below produces
 * the actionable error.
 */
async function probeEncryption(data: Uint8Array): Promise<boolean> {
  try {
    const probe = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
    return Boolean((probe as unknown as { isEncrypted?: boolean }).isEncrypted);
  } catch {
    return false;
  }
}

function mapUnlockError(error: unknown, suppliedPassword: boolean): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/password incorrect|needs password/i.test(message)) {
    return new Error(
      suppliedPassword
        ? 'That password did not open this PDF. Check it and try again.'
        : 'This PDF needs its password before it can be unlocked.',
    );
  }
  if (/encrypted/i.test(message)) {
    return new Error('This PDF needs its password before it can be unlocked.');
  }
  return error instanceof Error ? error : new Error(message);
}
