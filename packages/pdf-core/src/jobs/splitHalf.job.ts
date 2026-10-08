/**
 * Split in half -- two output documents (left/top and right/bottom), zipped.
 */

import type { JobDefinition } from '../job.js';
import { splitPagesInHalf, type SplitOrientation } from '../ops/split.js';
import { createZip } from '../ops/zip.js';
import { baseName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type SplitHalfOptions = {
  /** 'vertical' cuts left/right, 'horizontal' cuts top/bottom. */
  orientation?: SplitOrientation;
};

export interface SplitHalfInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: SplitHalfOptions;
}

export interface SplitHalfOutput {
  zip: ArrayBuffer;
  zipName: string;
  parts: { name: string; pageCount: number }[];
  pageCount: number;
}

export const splitHalfJob: JobDefinition<SplitHalfInput, SplitHalfOutput> = {
  slug: 'split-in-half',
  label: 'Split pages in half',

  validate(input) {
    if (input.files.length !== 1) {
      return { ok: false, issues: [{ message: 'Choose exactly one PDF' }] };
    }
    return { ok: true };
  },

  estimate(input) {
    // Source plus two outputs stay open simultaneously.
    return { memoryBytes: totalInputBytes(input) * 3 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const orientation: SplitOrientation = input.options?.orientation ?? 'vertical';

    const result = await splitPagesInHalf(
      { name: file.name, data: file.data, ...(file.password ? { password: file.password } : {}) },
      orientation,
      ctx,
    );

    const stem = baseName(file.name);
    const first = `${stem}-${result.firstLabel}.pdf`;
    const second = `${stem}-${result.secondLabel}.pdf`;
    const zip = createZip([
      { name: first, data: result.first },
      { name: second, data: result.second },
    ]);

    return {
      zip: toArrayBuffer(zip),
      zipName: `${stem}-halves.zip`,
      parts: [
        { name: first, pageCount: result.pageCount },
        { name: second, pageCount: result.pageCount },
      ],
      pageCount: result.pageCount,
    };
  },
};
