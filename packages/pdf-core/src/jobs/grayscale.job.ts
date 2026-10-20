/**
 * Grayscale job -- browser-only rebuild of every page as a luma JPEG.
 * See `src/gray/gray.ts` for the rasterize-and-rebuild contract; the job is
 * the thin envelope (caps, validation, names).
 */

import type { JobDefinition } from '../job.js';
import { grayscaleDocument } from '../gray/gray.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type GrayscaleJobOptions = {
  /** Render width in pixels, 320..4000. */
  targetWidthPx?: number;
  /** JPEG quality, 0.3..1. */
  quality?: number;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface GrayscaleJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: GrayscaleJobOptions;
}

export interface GrayscaleJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
}

export const grayscaleJob: JobDefinition<GrayscaleJobInput, GrayscaleJobOutput> = {
  slug: 'grayscale',
  label: 'Convert pages to grayscale',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const width = input.options?.targetWidthPx;
    if (width !== undefined && (!Number.isFinite(width) || width < 320 || width > 4000)) {
      issues.push({ message: 'Render width must be between 320 and 4000 px' });
    }
    const quality = input.options?.quality;
    if (quality !== undefined && (!Number.isFinite(quality) || quality < 0.3 || quality > 1)) {
      issues.push({ message: 'Quality must be between 0.3 and 1' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    // Every page becomes a full bitmap before it is re-embedded.
    const bytes = totalInputBytes(input);
    return { memoryBytes: bytes * 8 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const result = await grayscaleDocument(
      file.data,
      {
        ...(input.options?.targetWidthPx !== undefined ? { targetWidthPx: input.options.targetWidthPx } : {}),
        ...(input.options?.quality !== undefined ? { quality: input.options.quality } : {}),
      },
      ctx,
      file.password,
    );
    return {
      data: toArrayBuffer(result.data),
      pageCount: result.pageCount,
      fileName: safeOutputName(input.options?.outputName, `${baseName(file.name)}-grayscale`),
    };
  },
};
