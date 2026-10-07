import type { JobDefinition } from '../job.js';
import { renderThumbnails } from '../render/renderPage.js';
import { totalInputBytes } from './helpers.js';
import { LIMITS } from '../limits.js';

export interface ThumbnailsInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: {
    targetWidthPx?: number;
    /** Render only these pages (Crop previews page 1); output follows their order. */
    pageIndexes?: number[];
  };
}

export interface ThumbnailsOutput {
  documents: {
    name: string;
    pageCount: number;
    thumbnails: { data: ArrayBuffer; width: number; height: number; mimeType: string }[];
  }[];
}

/**
 * Page previews for the grid-style tools (Organize, Delete Pages, Split, ...).
 * Runs as its own job so the UI can show previews while the user picks pages,
 * then run the real job with the selection.
 */
export const thumbnailsJob: JobDefinition<ThumbnailsInput, ThumbnailsOutput> = {
  slug: 'thumbnails',
  label: 'Generate page previews',

  validate(input) {
    if (input.files.length === 0) return { ok: false, issues: [{ message: 'Add at least one PDF' }] };
    return { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input) };
  },

  async run(input, ctx) {
    const targetWidthPx = input.options?.targetWidthPx ?? LIMITS.tool.thumbnailWidthPx;
    const documents: ThumbnailsOutput['documents'] = [];

    for (let i = 0; i < input.files.length; i += 1) {
      ctx.throwIfAborted();
      const file = input.files[i]!;
      const { pageCount, thumbnails } = await renderThumbnails(
        file.data,
        {
          targetWidthPx,
          ...(input.options?.pageIndexes?.length ? { pageIndexes: input.options.pageIndexes } : {}),
        },
        ctx,
        file.password,
      );
      documents.push({ name: file.name, pageCount, thumbnails });
    }

    return { documents };
  },
};