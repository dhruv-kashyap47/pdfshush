/**
 * Structural repair: re-open a PDF and write it back out.
 *
 * pdf-lib parses the whole object graph and rebuilds the cross-reference table
 * and trailer when it saves, so a document whose xref offsets or trailer are
 * wrong (the common result of a truncated download or a bad incremental update)
 * comes out readable. That is a real repair, and it is the only one this engine
 * can promise without qpdf: damaged *content streams*, a missing object that a
 * page still references, or a broken font program are not reconstructed here.
 *
 * The tool says that out loud rather than pretending a save is a recovery
 * service. `rebuilt` reports whether the source already failed a strict
 * structural load -- useful for the UI ("this file was already valid; nothing
 * was wrong with it") and for tests.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';
import { EncryptedDocumentError } from './pages.js';

export interface RepairOptions {
  /** Password for an encrypted document. Omit for owner-restricted files. */
  password?: string;
}

export interface RepairResult {
  data: Uint8Array;
  pageCount: number;
  /** True when a strict load failed and the lenient parse had to save the day. */
  rebuilt: boolean;
}

function isEncryptionError(error: unknown): boolean {
  return error instanceof Error && /encrypt/i.test(error.message);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function load(
  data: Uint8Array,
  password: string | undefined,
  strict: boolean,
): Promise<PDFDocument> {
  return PDFDocument.load(data, {
    updateMetadata: false,
    throwOnInvalidObject: strict,
    // Pass the decrypt path only when a password is *defined*: an empty string
    // is how @cantoo/pdf-lib opens owner-restricted documents (PLAN.md §7).
    ...(password !== undefined ? { password } : {}),
  });
}

export async function repairPdf(
  data: Uint8Array,
  ctx: JobContext,
  options: RepairOptions = {},
): Promise<RepairResult> {
  if (data.byteLength === 0) throw new Error('That file is empty');
  const progress = createProgressReporter(ctx);
  progress.report('Checking the document structure', 0.1);

  let doc: PDFDocument;
  let rebuilt = false;
  const password = options.password;

  try {
    doc = await load(data, password, true);
  } catch (strictError) {
    if (isEncryptionError(strictError)) {
      if (password !== undefined) {
        throw new EncryptedDocumentError('Incorrect password for this PDF');
      }
      // Owner-restricted PDFs (permissions but no open password) unlock with ''.
      try {
        doc = await load(data, '', true);
      } catch {
        throw new EncryptedDocumentError(
          'This PDF needs a password. Remove it with Unlock PDF first.',
        );
      }
    } else {
      rebuilt = true;
      try {
        doc = await load(data, password, false);
      } catch (lenientError) {
        throw new Error(
          `This PDF is too damaged to rebuild (${messageOf(lenientError)}). ` +
            'The repair pass cannot recover objects that are missing entirely.',
        );
      }
    }
  }

  ctx.throwIfAborted();
  const pageCount = doc.getPageCount();
  if (pageCount === 0) {
    throw new Error('This PDF has no readable pages to rebuild');
  }

  progress.report('Writing a fresh cross-reference table', 0.75);
  let bytes: Uint8Array;
  try {
    bytes = await doc.save({
      useObjectStreams: false,
      addDefaultPage: false,
      updateFieldAppearances: false,
    });
  } catch (saveError) {
    throw new Error(`The rebuilt document could not be written (${messageOf(saveError)})`);
  }

  ctx.throwIfAborted();
  progress.report('Done', 1);
  return { data: bytes, pageCount, rebuilt };
}
