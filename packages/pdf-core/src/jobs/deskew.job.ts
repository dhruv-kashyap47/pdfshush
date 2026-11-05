/**
 * Deskew job -- browser-only rebuild of every page, straightened.
 * See `src/deskew/deskew.ts` for the rasterize-estimate-rotate contract; the
 * job is the thin envelope (caps, validation, names).
 */

import type { JobDefinition } from '../job.js';
import { deskewDocument } from '../deskew/deskew.js';
import { SKEW_LIMITS, isValidOverrideAngle } from '../deskew/skew.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type DeskewJobOptions = {
  /** Rotate every page by this angle; omit or null to detect per page. */
  overrideAngle?: number | null;
  /** Render width in pixels, 320..4000. */
  targetWidthPx?: number;
  /** JPEG quality, 0.3..1. */
  quality?: number;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface DeskewJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: DeskewJobOptions;
}

export interface DeskewJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
  /** The angle applied to each page, in page order. */
  angles: number[];
}

export const deskewJob: JobDefinition<DeskewJobInput, DeskewJobOutput> = {
  slug: 'deskew',
  label: 'Straighten skewed scans',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const override = input.options?.overrideAngle;
    if (override !== undefined && override !== null && !isValidOverrideAngle(override)) {
      issues.push({
        message: `Override angle must be between -${SKEW_LIMITS.maxOverrideDeg} and +${SKEW_LIMITS.maxOverrideDeg} degrees`,
      });
    }
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
    const result = await deskewDocument(
      file.data,
      {
        ...(input.options?.overrideAngle !== undefined
          ? { overrideAngle: input.options.overrideAngle }
          : {}),
        ...(input.options?.targetWidthPx !== undefined
          ? { targetWidthPx: input.options.targetWidthPx }
          : {}),
        ...(input.options?.quality !== undefined ? { quality: input.options.quality } : {}),
      },
      ctx,
      file.password,
    );
    return {
      data: toArrayBuffer(result.data),
      pageCount: result.pageCount,
      fileName: safeOutputName(input.options?.outputName, `${baseName(file.name)}-deskewed`),
      angles: result.angles,
    };
  },
};
