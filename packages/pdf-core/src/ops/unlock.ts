/**
 * Unlock PDF -- removes password protection from a document you can open.
 *
 * pdf-lib decrypts on load when given the user password (including the empty
 * password that owner-restricted PDFs use), but it can leave the old
 * encryption dictionary and xref stream in the object table. We remove those
 * artefacts before saving, so the result is genuinely unencrypted rather than
 * merely readable by a viewer that honours the last trailer. This cannot guess
 * a password: without the real one, the file stays locked.
 */

import {
  PDFDict,
  PDFDocument,
  PDFInvalidObject,
  PDFName,
  PDFRawStream,
  PDFRef,
} from '@cantoo/pdf-lib';
import type { PDFObject } from '@cantoo/pdf-lib';
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
  const wasEncrypted = probeEncryption(data);
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

  // `@cantoo/pdf-lib` removes the trailer's /Encrypt reference when it decrypts,
  // but it can leave the old encryption dictionary and the xref stream that
  // pointed at it in the object table. Saving then writes an unencrypted trailer
  // plus an orphan encrypted xref object. Strip both so the output is clean, not
  // merely "decryptable because the last trailer wins".
  if (wasEncrypted) {
    const encryptRef = doc.context.trailerInfo.Encrypt;
    delete doc.context.trailerInfo.Encrypt;
    if (encryptRef instanceof PDFRef) doc.context.delete(encryptRef);

    const staleRefs: PDFRef[] = [];
    for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
      const dict =
        object instanceof PDFRawStream ? object.dict : object instanceof PDFDict ? object : null;
      if (!dict) {
        // The old xref stream is parsed as an opaque object by pdf-lib. It is
        // dead weight once we write a fresh xref, and on an encrypted file it
        // still names the encryption dictionary we just removed.
        if (isXrefObject(object)) staleRefs.push(ref);
        continue;
      }
      const filter = dict.get(PDFName.of('Filter'));
      const type = dict.get(PDFName.of('Type'));
      const isEncryptionDict =
        filter instanceof PDFName && filter.asString() === '/Standard';
      const isXref =
        type instanceof PDFName && type.asString() === '/XRef';
      if (isEncryptionDict || isXref) staleRefs.push(ref);
    }
    for (const ref of staleRefs) doc.context.delete(ref);
  }

  ctx?.throwIfAborted();
  const pageCount = doc.getPageCount();
  const bytes = await doc.save({ useObjectStreams: false });
  return { data: bytes, pageCount, wasEncrypted };
}

/**
 * Answers "was this locked?" without trusting pdf-lib's `isEncrypted` flag.
 *
 * pdf-lib marks a context as "decrypted" by default even when no password was
 * supplied, then deletes the trailer's /Encrypt before constructing the
 * document. The trailer/xref dictionary is always plain text, so the marker is
 * the reliable signal here.
 */
function probeEncryption(data: Uint8Array): boolean {
  const marker = '/Encrypt';
  const needle = Array.from(marker, (char) => char.charCodeAt(0));
  outer: for (let i = 0; i <= data.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (data[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * True for an xref stream that should not survive a full rewrite. pdf-lib
 * sometimes hands back the old xref stream as a `PDFInvalidObject`, so its
 * dictionary cannot be inspected through the normal object API.
 */
function isXrefObject(object: PDFObject): boolean {
  if (object instanceof PDFInvalidObject) {
    const length = object.sizeInBytes();
    const bytes = new Uint8Array(length);
    object.copyBytesInto(bytes, 0);
    const head = Math.min(length, 4096);
    let text = '';
    for (let i = 0; i < head; i += 1) text += String.fromCharCode(bytes[i]!);
    return /\/Type\s*\/XRef/.test(text);
  }
  const dict =
    object instanceof PDFRawStream ? object.dict : object instanceof PDFDict ? object : null;
  if (!dict) return false;
  const type = dict.get(PDFName.of('Type'));
  return type instanceof PDFName && type.asString() === '/XRef';
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
