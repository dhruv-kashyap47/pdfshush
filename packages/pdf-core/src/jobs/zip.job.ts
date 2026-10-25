/**
 * ZIP job -- pack already-produced files into one archive.
 *
 * Batch run executes the same job once per file and then needs one download.
 * Zipping in the worker (rather than the main thread) keeps `fflate` out of the
 * app bundle, exactly as Split by pages already does.
 *
 * Entry names are untrusted: they come from user filenames. `safeEntryName`
 * strips directories, separators, control characters and leading dots before
 * the archive is built, because a name like `../../.bashrc` is a zip-slip when
 * the archive is extracted somewhere else.
 */

import type { JobDefinition } from '../job.js';
import { LIMITS } from '../limits.js';
import { createZip, dedupeNames } from '../ops/zip.js';
import { safeEntryName, safeZipName, toArrayBuffer } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type ZipJobOptions = {
  /** Override the archive name (extension optional). */
  zipName?: string;
  /** Fallback stem when no name is supplied. */
  fallbackName?: string;
};

export interface ZipJobInput {
  files: { name: string; type?: string; data: Uint8Array }[];
  options?: ZipJobOptions;
}

export interface ZipJobOutput {
  zip: ArrayBuffer;
  zipName: string;
  entries: { name: string; sizeBytes: number }[];
}

export const zipJob: JobDefinition<ZipJobInput, ZipJobOutput> = {
  slug: 'zip',
  label: 'Zip files',

  validate(input) {
    const issues = [];
    if (input.files.length === 0) issues.push({ message: 'There are no files to zip' });
    if (input.files.length > LIMITS.tool.maxZipEntries) {
      issues.push({ message: `At most ${LIMITS.tool.maxZipEntries} files fit in one archive` });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    // Entries stay resident while the archive is compressed.
    let total = 0;
    for (const file of input.files) total += file.data.byteLength;
    return { memoryBytes: total * 2 };
  },

  async run(input, ctx) {
    const requested = input.files.map((file, index) =>
      safeEntryName(file.name, `file-${index + 1}`),
    );
    // The archive and the reported metadata must agree: `createZip` collapses
    // duplicate names, so do it here once and hand it names that are already
    // unique. Otherwise the UI lists two "one.pdf" entries for one file.
    const names = dedupeNames(requested);
    ctx.throwIfAborted();
    const zip = createZip(
      input.files.map((file, index) => ({ name: names[index]!, data: file.data })),
    );
    const options = input.options ?? {};
    return {
      zip: toArrayBuffer(zip),
      zipName: safeZipName(options.zipName, options.fallbackName || 'pdfshush-batch'),
      entries: input.files.map((file, index) => ({
        name: names[index]!,
        sizeBytes: file.data.byteLength,
      })),
    };
  },
};
