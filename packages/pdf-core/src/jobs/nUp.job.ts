/**
 * N-up job -- imposes every page of one document onto 2/4/8-up sheets.
 */

import type { JobDefinition } from '../job.js';
import { imposePages, type NupCount, type NupSheet } from '../ops/nup.js';
import { stripExtension } from '../ops/zip.js';
import { baseName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type NUpJobOptions = {
  n?: NupCount;
  sheet?: NupSheet;
};

export interface NUpJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: NUpJobOptions;
}

export interface NUpJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
}

export const nUpJob: JobDefinition<NUpJobInput, NUpJobOutput> = {
  slug: 'n-up',
  label: 'N-up imposition',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const n = input.options?.n;
    if (n !== undefined && n !== 2 && n !== 4 && n !== 8) {
      issues.push({ message: 'Sheets must hold 2, 4 or 8 pages' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    // One embedded page per source page plus the output sheets.
    return { memoryBytes: totalInputBytes(input) * 3 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const result = await imposePages(
      { name: file.name, data: file.data, ...(file.password ? { password: file.password } : {}) },
      { n: input.options?.n ?? 2, ...(input.options?.sheet ? { sheet: input.options.sheet } : {}) },
      ctx,
    );

    const stem = stripExtension(baseName(file.name));
    return {
      data: toArrayBuffer(result.data),
      pageCount: result.pageCount,
      fileName: `${stem}-${input.options?.n ?? 2}up.pdf`,
    };
  },
};
