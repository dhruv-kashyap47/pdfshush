/**
 * Edit Metadata job: writes only the fields the caller changed (an explicit
 * empty string clears a field) and saves. Values are clamped by
 * `ops/metadata`; the job validates the envelope.
 */

import type { JobDefinition } from '../job.js';
import { applyMetadataEdits, type MetadataEdits } from '../ops/metadata.js';
import { loadPdfDocument, probePageCount } from '../ops/pages.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type MetadataJobOptions = {
  edits?: MetadataEdits;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface MetadataJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: MetadataJobOptions;
}

export interface MetadataJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
}

export const metadataJob: JobDefinition<MetadataJobInput, MetadataJobOutput> = {
  slug: 'edit-metadata',
  label: 'Edit document metadata',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const edits = input.options?.edits ?? {};
    const touched =
      typeof edits.title === 'string' ||
      typeof edits.author === 'string' ||
      typeof edits.subject === 'string' ||
      typeof edits.creator === 'string' ||
      typeof edits.producer === 'string' ||
      Array.isArray(edits.keywords);
    if (!touched) issues.push({ message: 'Change at least one field' });
    if (edits.keywords && edits.keywords.length > 50) {
      issues.push({ message: 'At most 50 keywords are supported' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input) * 2 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const doc = await loadPdfDocument(file.data, {
      ...(file.password ? { password: file.password } : {}),
    });

    applyMetadataEdits(doc, input.options?.edits ?? {});

    ctx.throwIfAborted();
    const bytes = await doc.save({ useObjectStreams: false });
    return {
      data: toArrayBuffer(bytes),
      pageCount: await probePageCount(bytes),
      fileName: safeOutputName(input.options?.outputName, `${baseName(file.name)}-metadata`),
    };
  },
};
