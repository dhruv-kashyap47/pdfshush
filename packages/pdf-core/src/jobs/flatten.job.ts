/**
 * Flatten job -- bakes AcroForm fields into the page as static content.
 *
 * Uses the fork's `form.flatten()` (appearance streams become drawn content,
 * field dictionaries and widget annotations are removed). Documents without
 * an AcroForm succeed with `fields: 0` rather than an error: nothing to do is
 * an honest result, not a failure.
 */

import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import type { JobDefinition } from '../job.js';
import { EncryptedDocumentError, probePageCount } from '../ops/pages.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type FlattenJobOptions = {
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface FlattenJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: FlattenJobOptions;
}

export interface FlattenJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
  fieldsFlattened: number;
}

export const flattenJob: JobDefinition<FlattenJobInput, FlattenJobOutput> = {
  slug: 'flatten',
  label: 'Flatten form fields',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input) * 3 };
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
        throw new Error('Flatten a decrypted copy of this file first');
      }
      throw error;
    }

    // Non-destructive detection first: `getForm()` would create an empty
    // AcroForm on a plain document, silently growing it.
    const hasAcroForm = doc.catalog?.get?.(PDFName.of('AcroForm')) !== undefined;
    let fieldsFlattened = 0;
    if (hasAcroForm) {
      const form = doc.getForm();
      fieldsFlattened = form.getFields().length;
      form.flatten({ updateFieldAppearances: true });
    }

    ctx.throwIfAborted();
    const bytes = await doc.save({ useObjectStreams: false });
    return {
      data: toArrayBuffer(bytes),
      pageCount,
      fileName: safeOutputName(input.options?.outputName, `${baseName(file.name)}-flattened`),
      fieldsFlattened,
    };
  },
};
