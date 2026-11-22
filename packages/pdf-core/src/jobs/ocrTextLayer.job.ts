/**
 * O-02: append an OCR text layer to the pages that need one.
 *
 * The standalone `ocr` job rebuilds pages; this one edits the existing document
 * in place, so page indices, objects and paragraph ids survive. The editor is
 * the primary caller; it is also a valid workflow step for a scan.
 */

import type { JobDefinition } from '../job.js';
import { LIMITS, OCR_LIMITS, ocrTimeoutForPageCount } from '../limits.js';
import { addOcrTextLayer, type OcrTextPageResult } from '../ocr/textLayer.js';
import { collectWarnings, type JobWarning } from '../warnings.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

export type OcrTextLayerJobOptions = {
  /** Zero-based pages; empty means every page (pages with text are skipped). */
  pageIndexes?: number[];
  targetWidthPx?: number;
  quality?: number;
  outputName?: string;
};

export interface OcrTextLayerJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: OcrTextLayerJobOptions;
}

export interface OcrTextLayerJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
  /** 1-based pages that received a new text layer. */
  ocrPages: number[];
  /** 1-based pages skipped because they already had real text. */
  skippedPages: number[];
  /** Per-page confidence and structure (O-03). */
  pages: OcrTextPageResult[];
  wordCount: number;
  characterCount: number;
  averageConfidence: number;
  warnings: JobWarning[];
}

export const ocrTextLayerJob: JobDefinition<OcrTextLayerJobInput, OcrTextLayerJobOutput> = {
  slug: 'ocr-text-layer',
  label: 'Add a searchable text layer',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const width = input.options?.targetWidthPx;
    if (
      width !== undefined &&
      (!Number.isFinite(width) || width < OCR_LIMITS.minWidthPx || width > OCR_LIMITS.maxWidthPx)
    ) {
      issues.push({
        message: `Render width must be between ${OCR_LIMITS.minWidthPx} and ${OCR_LIMITS.maxWidthPx} px`,
      });
    }
    const quality = input.options?.quality;
    if (quality !== undefined && (!Number.isFinite(quality) || quality < 0.3 || quality > 1)) {
      issues.push({ message: 'Quality must be between 0.3 and 1' });
    }
    const pages = input.options?.pageIndexes ?? [];
    if (pages.length > OCR_LIMITS.maxPages) {
      issues.push({ message: `OCR is limited to ${OCR_LIMITS.maxPages} pages per run` });
    }
    if (pages.some((page) => !Number.isInteger(page) || page < 0)) {
      issues.push({ message: 'Page numbers must be zero-based non-negative integers' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input, pageCount) {
    const pages = input.options?.pageIndexes?.length ?? pageCount;
    const bytes = totalInputBytes(input);
    return {
      memoryBytes: bytes * 3 + pages * LIMITS.client.bytesPerRenderedPage,
      pageCount,
      timeoutMs: ocrTimeoutForPageCount(pages),
    };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const result = await addOcrTextLayer(
      file.data,
      {
        ...(input.options?.pageIndexes ? { pageIndexes: input.options.pageIndexes } : {}),
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
      fileName: safeOutputName(
        input.options?.outputName,
        `${baseName(file.name)}-searchable`,
      ),
      ocrPages: result.ocrPages,
      skippedPages: result.skippedPages,
      pages: result.pages,
      wordCount: result.wordCount,
      characterCount: result.characterCount,
      averageConfidence: result.averageConfidence,
      warnings: collectWarnings(result.warnings),
    };
  },
};
