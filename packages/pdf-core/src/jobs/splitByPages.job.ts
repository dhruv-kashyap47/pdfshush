/**
 * Split a document into fixed-size chunks (Split by pages).
 *
 * Every chunk is a composed sub-document; the job returns them pre-zipped so
 * the main thread never touches fflate.
 */

import type { JobDefinition } from '../job.js';
import { composePageRefs, refsForSpan } from '../ops/compose.js';
import { probePageCount } from '../ops/pages.js';
import { createZip, dedupeNames } from '../ops/zip.js';
import { baseName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type SplitByPagesOptions = {
  /** Pages per output file. Defaults to 1. */
  chunkSize?: number;
};

export interface SplitByPagesInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: SplitByPagesOptions;
}

export interface SplitByPagesOutput {
  zip: ArrayBuffer;
  zipName: string;
  parts: { name: string; pageCount: number }[];
  pageCount: number;
}

/** Guard against a 500-page file split into 500 one-page parts. */
const MAX_PARTS = 200;

export const splitByPagesJob: JobDefinition<SplitByPagesInput, SplitByPagesOutput> = {
  slug: 'split-by-pages',
  label: 'Split by page ranges',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const chunk = input.options?.chunkSize;
    if (chunk !== undefined && (!Number.isInteger(chunk) || chunk < 1)) {
      issues.push({ message: 'Chunk size must be a whole number of at least 1' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    // Source plus one output document stay open, plus the zip buffer.
    return { memoryBytes: totalInputBytes(input) * 2 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const chunkSize = input.options?.chunkSize ?? 1;
    const totalPages = await probePageCount(file.data, {
      ...(file.password ? { password: file.password } : {}),
    });

    const partCount = Math.ceil(totalPages / chunkSize);
    if (partCount > MAX_PARTS) {
      throw new Error(`That would create ${partCount} files (limit ${MAX_PARTS}). Use a larger chunk size.`);
    }

    const stem = baseName(file.name);
    const sources = [{ name: file.name, data: file.data, ...(file.password ? { password: file.password } : {}) }];
    const width = String(partCount).length;

    const entries: { name: string; data: Uint8Array }[] = [];
    const parts: { name: string; pageCount: number }[] = [];
    for (let part = 0; part < partCount; part += 1) {
      ctx.throwIfAborted();
      const start = part * chunkSize;
      const end = Math.min(start + chunkSize, totalPages) - 1;
      const result = await composePageRefs(sources, refsForSpan(0, start, end), ctx);
      const name = `${stem}-part-${String(part + 1).padStart(width, '0')}.pdf`;
      entries.push({ name, data: result.data });
      parts.push({ name, pageCount: result.pageCount });
    }

    const zip = createZip(dedupeNames(entries.map((entry) => entry.name)).map((name, i) => ({
      name,
      data: entries[i]!.data,
    })));

    return {
      zip: toArrayBuffer(zip),
      zipName: `${stem}-split.zip`,
      parts,
      pageCount: totalPages,
    };
  },
};
