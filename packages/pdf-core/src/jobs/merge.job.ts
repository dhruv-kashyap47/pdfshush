import type { JobDefinition } from '../job.js';
import { mergeIfNeeded } from '../ops/merge.js';
import { baseName, toArrayBuffer, toSources, totalInputBytes } from './helpers.js';

export interface MergeJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: { reverse?: boolean };
}

export interface MergeJobOutput {
  /** `ArrayBuffer` rather than `Uint8Array` so the host can transfer it. */
  data: ArrayBuffer;
  pageCount: number;
  sources: { name: string; pageCount: number }[];
  fileName: string;
}

export const mergeJob: JobDefinition<MergeJobInput, MergeJobOutput> = {
  slug: 'merge',
  label: 'Merge PDFs',

  validate(input) {
    if (input.files.length === 0) return { ok: false, issues: [{ message: 'Add at least one PDF' }] };
    return { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input), pageCount: input.files.length * 20 };
  },

  async run(input, ctx) {
    const sources = toSources(input.files);
    const ordered = input.options?.reverse ? [...sources].reverse() : sources;
    const result = await mergeIfNeeded(ordered, ctx);
    return {
      data: toArrayBuffer(result.data),
      pageCount: result.pageCount,
      sources: result.sources,
      fileName: buildMergedFileName(result.sources.map((s) => s.name)),
    };
  },
};

function buildMergedFileName(sourceNames: string[]): string {
  // Never reuse the source name: "merging" a single file would hand back a
  // different document under the user's own filename.
  if (sourceNames.length === 1) {
    return `${baseName(sourceNames[0] ?? 'document') || 'document'}-merged.pdf`;
  }
  return 'merged.pdf';
}