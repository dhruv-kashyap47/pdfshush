/**
 * Remove Annotations job.
 *
 * Single file in, single file out. Reports the count the job removed so the
 * result panel can be precise ("14 annotations removed across 5 pages").
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import type { JobDefinition } from '../job.js';
import { removeAnnotations } from '../ops/annotations.js';
import { EncryptedDocumentError, probePageCount } from '../ops/pages.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type AnnotationsJobOptions = {
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface AnnotationsJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: AnnotationsJobOptions;
}

export interface AnnotationsJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
  removed: number;
  pages: number;
}

export const annotationsJob: JobDefinition<AnnotationsJobInput, AnnotationsJobOutput> = {
  slug: 'remove-annotations',
  label: 'Remove annotations',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input) * 2 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const pageCount = await probePageCount(file.data, {
      ...(file.password ? { password: file.password } : {}),
    });

    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(file.data, {
        ...(file.password ? { password: file.password } : {}),
      });
    } catch (error) {
      if (error instanceof EncryptedDocumentError) {
        // Encrypted sources keep their stream bytes ciphered; stripping
        // annotation dicts sight-unseen is not honest work.
        throw new Error('Remove annotations from a decrypted copy of this file');
      }
      throw error;
    }

    const result = removeAnnotations(doc);
    ctx.throwIfAborted();
    const bytes = await doc.save({ useObjectStreams: false });
    return {
      data: toArrayBuffer(bytes),
      pageCount,
      fileName: safeOutputName(input.options?.outputName, `${baseName(file.name)}-clean`),
      removed: result.annotations,
      pages: result.pages,
    };
  },
};
