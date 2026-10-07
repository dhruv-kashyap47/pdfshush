import type { JobDefinition } from '../job.js';
import { composePageRefs, type CropRect, type PageRef } from '../ops/compose.js';
import { baseName, toArrayBuffer, toSources, totalInputBytes } from './helpers.js';

export interface OrganizeJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: {
    /**
     * Flat list of page references across all input documents, in final order.
     * Duplicates are allowed -- the same page can appear more than once.
     */
    pageOrder?: PageRef[];
    /** Applied to every page, used by the Rotate tool. */
    rotateDegrees?: 0 | 90 | 180 | 270;
    /** Crop every page to this rectangle (page coordinates, clamped). */
    crop?: CropRect;
    /** Override the output file name (extension optional). */
    outputName?: string;
  };
}

export interface OrganizeJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
}

/**
 * Builds a PDF from an explicit page list. This single job powers Organize,
 * Delete Pages, Extract Pages and Rotate -- the UI only differs in how it
 * produces `pageOrder`.
 */
export const organizeJob: JobDefinition<OrganizeJobInput, OrganizeJobOutput> = {
  slug: 'organize',
  label: 'Organize pages',

  validate(input) {
    const issues = [];
    if (input.files.length === 0) issues.push({ message: 'Add at least one PDF' });
    const order = input.options?.pageOrder;
    if (order && order.length === 0) issues.push({ message: 'Keep at least one page' });
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input), pageCount: input.options?.pageOrder?.length };
  },

  async run(input, ctx) {
    const sources = toSources(input.files);
    const refs = input.options?.pageOrder ?? defaultOrder();
    const rotate = input.options?.rotateDegrees;
    const crop = input.options?.crop;

    const result = await composePageRefs(sources, refs, ctx, {
      ...(rotate ? { transform: 'rotate' as const, rotateDegrees: rotate } : {}),
      ...(crop ? { crop } : {}),
    });

    const firstName = input.files[0] ? baseName(input.files[0].name) : 'document';
    const explicit = input.options?.outputName?.trim();
    const stem = explicit ? (explicit.endsWith('.pdf') ? explicit : `${explicit}.pdf`) : `${firstName}-organized.pdf`;
    return {
      data: toArrayBuffer(result.data),
      pageCount: result.pageCount,
      fileName: stem,
    };
  },
};

function defaultOrder(): PageRef[] {
  // The UI always supplies an explicit order; this fallback only keeps the job
  // runnable from tests or an API call with no page selection.
  return [];
}