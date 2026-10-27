/**
 * Compress job: envelope around `compress/compress`. The UI shows before/after
 * sizes from `originalBytes`; the job never claims a saving it did not measure.
 */

import type { JobDefinition } from '../job.js';
import { compressDocument, COMPRESS_LIMITS, type CompressMode } from '../compress/compress.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

const MODES: ReadonlySet<string> = new Set<CompressMode>(['smart', 'raster', 'lossless']);

/** Type alias (not interface) for the implicit index signature constraint. */
export type CompressJobOptions = {
  mode?: CompressMode;
  quality?: number;
  dpi?: number;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface CompressJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: CompressJobOptions;
}

export interface CompressJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
  mode: CompressMode;
  originalBytes: number;
  /** Smart mode metrics; 0 for the other modes. */
  imagesOptimized: number;
  imagesSkipped: number;
  imageBytesBefore: number;
  imageBytesAfter: number;
}

export const compressJob: JobDefinition<CompressJobInput, CompressJobOutput> = {
  slug: 'compress',
  label: 'Compress PDF',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const options = input.options ?? {};
    if (options.mode !== undefined && !MODES.has(options.mode)) {
      issues.push({ message: 'Choose smart compression, strong compression or repack-only' });
    }
    if (
      options.quality !== undefined &&
      (!Number.isFinite(options.quality) ||
        options.quality < COMPRESS_LIMITS.minQuality ||
        options.quality > COMPRESS_LIMITS.maxQuality)
    ) {
      issues.push({ message: 'Quality must be between 30% and 100%' });
    }
    if (
      options.dpi !== undefined &&
      (!Number.isFinite(options.dpi) ||
        options.dpi < COMPRESS_LIMITS.minDpi ||
        options.dpi > COMPRESS_LIMITS.maxDpi)
    ) {
      issues.push({ message: `Resolution must be between ${COMPRESS_LIMITS.minDpi} and ${COMPRESS_LIMITS.maxDpi} dpi` });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    const options = input.options ?? {};
    // Smart decodes one image at a time; raster holds a full-page bitmap plus
    // its encoded JPEG; lossless only needs the parse and the reserialized copy.
    const factor = options.mode === 'lossless' ? 2 : options.mode === 'smart' ? 6 : 8;
    return { memoryBytes: totalInputBytes(input) * factor };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const options = input.options ?? {};
    const result = await compressDocument(
      file.data,
      {
        ...(options.mode !== undefined ? { mode: options.mode } : {}),
        ...(options.quality !== undefined ? { quality: options.quality } : {}),
        ...(options.dpi !== undefined ? { dpi: options.dpi } : {}),
      },
      ctx,
      file.password,
    );

    return {
      data: toArrayBuffer(result.data),
      pageCount: result.pageCount,
      fileName: safeOutputName(options.outputName, `${baseName(file.name)}-compressed`),
      mode: result.mode,
      originalBytes: file.data.byteLength,
      imagesOptimized: result.imagesOptimized ?? 0,
      imagesSkipped: result.imagesSkipped ?? 0,
      imageBytesBefore: result.imageBytesBefore ?? 0,
      imageBytesAfter: result.imageBytesAfter ?? 0,
    };
  },
};
