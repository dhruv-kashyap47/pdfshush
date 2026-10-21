/**
 * Batch rename job.
 *
 * Renaming is metadata the operating system owns, so the honest client-side
 * version is: read each document (title + page count), compute the new name,
 * and hand back the original bytes under that name. Nothing is re-encoded, and
 * the tool says so. Multiple files arrive as one ZIP because the browser cannot
 * download 20 files in one gesture.
 */

import type { JobDefinition } from '../job.js';
import type { PDFDocument } from '@cantoo/pdf-lib';
import { createZip, dedupeNames } from '../ops/zip.js';
import { loadPdfDocument } from '../ops/pages.js';
import {
  expandRenamePattern,
  RENAME_LIMITS,
} from '../ops/renamePattern.js';
import { baseName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type RenameJobOptions = {
  /** Pattern with {name}, {title}, {n}, {total}, {date}. Defaults to {name}. */
  pattern?: string;
  /** Zero-pad width for {n}. */
  digits?: number;
};

export interface RenameJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: RenameJobOptions;
}

export interface RenameJobOutput {
  files: { name: string; data: ArrayBuffer; bytes: number; from: string }[];
  /** Present only when more than one file was renamed. */
  zip?: ArrayBuffer;
  zipName?: string;
  pageCount: number;
  renamed: { from: string; to: string }[];
}

export const renameJob: JobDefinition<RenameJobInput, RenameJobOutput> = {
  slug: 'rename',
  label: 'Rename PDF files',

  validate(input) {
    const issues = [];
    if (input.files.length === 0) issues.push({ message: 'Add at least one PDF' });
    if (input.files.length > RENAME_LIMITS.maxFiles) {
      issues.push({ message: `At most ${RENAME_LIMITS.maxFiles} files can be renamed at once` });
    }
    const pattern = input.options?.pattern;
    if (pattern !== undefined && pattern.length > RENAME_LIMITS.maxPatternChars) {
      issues.push({ message: `The pattern is longer than ${RENAME_LIMITS.maxPatternChars} characters` });
    }
    const digits = input.options?.digits;
    if (
      digits !== undefined &&
      (!Number.isInteger(digits) || digits < 1 || digits > RENAME_LIMITS.maxDigits)
    ) {
      issues.push({ message: `Sequence width must be between 1 and ${RENAME_LIMITS.maxDigits}` });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    // Bytes are copied into the ZIP, never parsed twice, but every document is
    // opened once to read its title.
    return { memoryBytes: totalInputBytes(input) * 2 };
  },

  async run(input, ctx) {
    const pattern = input.options?.pattern ?? '{name}';
    const digits = input.options?.digits ?? 1;
    const total = input.files.length;
    const date = new Date();

    const entries: { name: string; data: Uint8Array; bytes: number; from: string }[] = [];
    let pageCount = 0;

    for (let index = 0; index < input.files.length; index += 1) {
      ctx.throwIfAborted();
      const file = input.files[index]!;
      const doc = await loadPdfDocument(file.data, {
        ...(file.password ? { password: file.password } : {}),
      });
      pageCount += doc.getPageCount();

      const name = expandRenamePattern(
        pattern,
        {
          name: baseName(file.name),
          title: readTitle(doc),
          index: index + 1,
          total,
          date,
        },        digits,
      );
      entries.push({ name, data: file.data, bytes: file.data.byteLength, from: file.name });
      ctx.onProgress({ phase: 'Renaming', ratio: (index + 1) / total });
    }

    // Two files can expand to the same name ("{name}" with duplicates, or a
    // shared {title}); suffix them instead of letting the ZIP collapse entries.
    const unique = dedupeNames(entries.map((entry) => entry.name));
    entries.forEach((entry, index) => {
      entry.name = unique[index]!;
    });

    const files = entries.map((entry) => ({
      name: entry.name,
      data: toArrayBuffer(entry.data),
      bytes: entry.bytes,
      from: entry.from,
    }));

    return {
      files,
      ...(entries.length > 1
        ? {
            zip: toArrayBuffer(
              createZip(entries.map((entry) => ({ name: entry.name, data: entry.data }))),
            ),
            zipName: `${baseName(input.files[0]!.name)}-renamed.zip`,
          }
        : {}),
      pageCount,
      renamed: entries.map((entry) => ({ from: entry.from, to: entry.name })),
    };
  },
};

/** Metadata is untrusted; a broken Info dictionary must not fail a rename. */
function readTitle(doc: PDFDocument): string | undefined {
  try {
    const title = doc.getTitle();
    return typeof title === 'string' && title.trim().length > 0 ? title.trim() : undefined;
  } catch {
    return undefined;
  }
}
