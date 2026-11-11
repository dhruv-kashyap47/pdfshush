/**
 * OCR job -- browser-only searchable text layer for scanned pages.
 * See `src/ocr/ocr.ts` for the render-recognize-rebuild contract; the job is
 * the thin envelope (caps, validation, names).
 */

import type { JobDefinition } from '../job.js';
import { LIMITS, OCR_LIMITS, ocrTimeoutForPageCount } from '../limits.js';
import { ocrDocument } from '../ocr/ocr.js';
import { nonEmbeddedFontWarnings } from '../render/fontWarnings.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type OcrJobOptions = {
  /** Render width in pixels, 1200..4000. */
  targetWidthPx?: number;
  /** JPEG quality, 0.3..1. */
  quality?: number;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface OcrJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: OcrJobOptions;
}

export interface OcrJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
  /** 1-based pages rebuilt as rasters with an invisible text layer. */
  ocrPages: number[];
  /** 1-based pages copied unchanged because they already had text. */
  textPages: number[];
  wordCount: number;
  characterCount: number;
  /** Word-weighted recognizer confidence, 0..100. */
  averageConfidence: number;
  warnings?: string[];
}

export const ocrJob: JobDefinition<OcrJobInput, OcrJobOutput> = {
  slug: 'ocr',
  label: 'Make scans searchable',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });

    const width = input.options?.targetWidthPx;
    if (
      width !== undefined &&
      (!Number.isFinite(width) ||
        width < OCR_LIMITS.minWidthPx ||
        width > OCR_LIMITS.maxWidthPx)
    ) {
      issues.push({
        message: `Render width must be between ${OCR_LIMITS.minWidthPx} and ${OCR_LIMITS.maxWidthPx} px`,
      });
    }

    const quality = input.options?.quality;
    if (quality !== undefined && (!Number.isFinite(quality) || quality < 0.3 || quality > 1)) {
      issues.push({ message: 'Quality must be between 0.3 and 1' });
    }

    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input, pageCount) {
    // One bitmap is live while recognition runs, and the output keeps a JPEG
    // per page. Recognition also holds Tesseract's own buffers.
    const bytes = totalInputBytes(input);
    return {
      memoryBytes: bytes * 3 + pageCount * LIMITS.client.bytesPerRenderedPage * 2,
      pageCount,
      timeoutMs: ocrTimeoutForPageCount(pageCount),
    };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const result = await ocrDocument(
      file.data,
      {
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
      fileName: safeOutputName(input.options?.outputName, `${baseName(file.name)}-ocr`),
      ocrPages: result.ocrPages,
      textPages: result.textPages,
      wordCount: result.wordCount,
      characterCount: result.characterCount,
      averageConfidence: result.averageConfidence,
      warnings: await nonEmbeddedFontWarnings(file.data, file.password),
    };
  },
};
