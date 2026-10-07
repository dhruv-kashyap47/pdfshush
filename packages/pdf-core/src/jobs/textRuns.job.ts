/**
 * Read page text -- display-space text runs for the editor's click-to-edit.
 *
 * Runs as its own (read-only) job so the editor can fetch the active page's
 * text without touching the source document's bytes again.
 */

import type { JobDefinition } from '../job.js';
import { extractTextRuns, type TextRun } from '../render/textRuns.js';
import { totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type TextRunsOptions = {
  /** Zero-based page indexes. Empty or missing means every page. */
  pageIndexes?: number[];
};

export interface TextRunsInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: TextRunsOptions;
}

export interface TextRunsOutput {
  /** One run list per requested page, in request order. */
  runs: TextRun[][];
}

export const textRunsJob: JobDefinition<TextRunsInput, TextRunsOutput> = {
  slug: 'text-runs',
  label: 'Read page text',

  validate(input) {
    if (input.files.length !== 1) {
      return { ok: false, issues: [{ message: 'Choose exactly one PDF' }] };
    }
    return { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input) };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const runs = await extractTextRuns(
      file.data,
      input.options?.pageIndexes ?? [],
      ctx,
      file.password,
    );
    return { runs };
  },
};
