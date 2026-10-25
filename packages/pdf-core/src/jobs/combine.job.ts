/**
 * Combine job -- PDFs and images, in the order the user arranged them.
 *
 * Order is data, not a detail: this is the only tool where "move this page
 * before that document" spans different input formats, so the array order is
 * preserved exactly and every refusal names the offending file.
 */

import type { JobDefinition } from '../job.js';
import { combineToPdf, isPdfBytes, type CombinePart } from '../ops/combine.js';
import { detectImageKind, IMAGE_LIMITS, type ImageOrientation, type ImagePageSize } from '../ops/imageDocs.js';
import { LIMITS } from '../limits.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

const PAGE_SIZES: ReadonlySet<string> = new Set<ImagePageSize>(['a4', 'letter', 'image']);
const ORIENTATIONS: ReadonlySet<string> = new Set<ImageOrientation>([
  'auto',
  'portrait',
  'landscape',
]);

/** Type alias (not interface) for the implicit index signature constraint. */
export type CombineJobOptions = {
  pageSize?: ImagePageSize;
  orientation?: ImageOrientation;
  margin?: number;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface CombineJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: CombineJobOptions;
}

export interface CombineJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  /** What each input contributed, in output order. */
  parts: CombinePart[];
  fileName: string;
}

export const combineJob: JobDefinition<CombineJobInput, CombineJobOutput> = {
  slug: 'combine',
  label: 'Combine PDFs and images',

  validate(input) {
    const issues = [];
    if (input.files.length === 0) {
      issues.push({ message: 'Add at least one PDF or image' });
    } else if (input.files.length > LIMITS.tool.maxCombineFiles) {
      issues.push({ message: `At most ${LIMITS.tool.maxCombineFiles} files fit in one run` });
    } else {
      for (const file of input.files) {
        if (!isPdfBytes(file.data) && !detectImageKind(file.data)) {
          issues.push({
            field: file.name,
            message: `"${file.name}" is not a PDF or a JPEG/PNG image`,
          });
        }
      }
    }

    const options = input.options ?? {};
    if (options.pageSize !== undefined && !PAGE_SIZES.has(options.pageSize)) {
      issues.push({ message: 'Choose A4, Letter or the image size' });
    }
    if (options.orientation !== undefined && !ORIENTATIONS.has(options.orientation)) {
      issues.push({ message: 'Choose auto, portrait or landscape' });
    }
    if (
      options.margin !== undefined &&
      (!Number.isFinite(options.margin) || options.margin < 0 || options.margin > IMAGE_LIMITS.maxMarginPt)
    ) {
      issues.push({ message: `Margin must be between 0 and ${IMAGE_LIMITS.maxMarginPt} pt` });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input) * 2, pageCount: input.files.length };
  },

  async run(input, ctx) {
    const options = input.options ?? {};
    const result = await combineToPdf(
      input.files.map((file) => ({
        name: file.name,
        data: file.data,
        ...(file.password ? { password: file.password } : {}),
      })),
      {
        ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
        ...(options.orientation !== undefined ? { orientation: options.orientation } : {}),
        ...(options.margin !== undefined ? { margin: options.margin } : {}),
      },
      ctx,
    );

    const firstName = input.files[0]?.name ?? 'document';
    return {
      data: toArrayBuffer(result.data),
      pageCount: result.pageCount,
      parts: result.parts,
      fileName: safeOutputName(options.outputName, `${baseName(firstName)}-combined`),
    };
  },
};
