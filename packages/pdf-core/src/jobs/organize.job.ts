import type { JobDefinition } from '../job.js';
import { composePageRefs, identityRefs, type CropRect, type PageRef } from '../ops/compose.js';
import { probePageCount } from '../ops/pages.js';
import { baseName, safeOutputName, toArrayBuffer, toSources, totalInputBytes } from './helpers.js';

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
    const refs = input.options?.pageOrder ?? (await identityOrderFor(input.files));
    const rotate = input.options?.rotateDegrees;
    const crop = input.options?.crop;

    const result = await composePageRefs(sources, refs, ctx, {
      ...(rotate ? { transform: 'rotate' as const, rotateDegrees: rotate } : {}),
      ...(crop ? { crop } : {}),
    });

    const firstName = input.files[0] ? baseName(input.files[0].name) : 'document';
    return {
      data: toArrayBuffer(result.data),
      pageCount: result.pageCount,
      fileName: safeOutputName(input.options?.outputName, `${firstName}-organized`),
    };
  },
};

/**
 * "Keep every page, in order" for a caller that supplied no page list.
 *
 * This used to return `[]`, which `composePageRefs` rejects with "No pages
 * selected" -- so the documented fallback did not actually work, and any caller
 * other than the UI (the API, a workflow step) got a hard failure for the one
 * order that needs no decisions. The page counts have to be read to build it,
 * which is why this costs a parse; it only runs when no order was given.
 */
async function identityOrderFor(files: { name: string; data: Uint8Array; password?: string }[]): Promise<PageRef[]> {
  const counts = await Promise.all(
    files.map((file) => probePageCount(file.data, file.password ? { password: file.password } : {})),
  );
  return identityRefs(counts);
}
