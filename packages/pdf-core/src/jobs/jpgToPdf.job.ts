/**
 * JPG to PDF job: embeds JPEG/PNG files in the order the user chose.
 * Validation sniffs magic bytes so a `.jpg` that is really a HEIC is caught
 * before the worker starts.
 */

import type { JobDefinition } from '../job.js';
import {
  detectImageKind,
  imagesToPdf,
  IMAGE_LIMITS,
  type ImageOrientation,
  type ImagePageSize,
} from '../ops/imageDocs.js';
import { baseName, safeOutputName, toArrayBuffer } from './helpers.js';

const PAGE_SIZES: ReadonlySet<string> = new Set<ImagePageSize>(['a4', 'letter', 'image']);
const ORIENTATIONS: ReadonlySet<string> = new Set<ImageOrientation>([
  'auto',
  'portrait',
  'landscape',
]);

/** Type alias (not interface) for the implicit index signature constraint. */
export type JpgToPdfJobOptions = {
  pageSize?: ImagePageSize;
  orientation?: ImageOrientation;
  margin?: number;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface JpgToPdfJobInput {
  files: { name: string; type?: string; data: Uint8Array }[];
  options?: JpgToPdfJobOptions;
}

export interface JpgToPdfJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
}

export const jpgToPdfJob: JobDefinition<JpgToPdfJobInput, JpgToPdfJobOutput> = {
  slug: 'jpg-to-pdf',
  label: 'Convert images to PDF',

  validate(input) {
    const issues = [];
    if (input.files.length === 0) {
      issues.push({ message: 'Add at least one JPEG or PNG image' });
    } else if (input.files.length > IMAGE_LIMITS.maxImages) {
      issues.push({ message: `At most ${IMAGE_LIMITS.maxImages} images fit in one PDF` });
    } else {
      for (const file of input.files) {
        if (!detectImageKind(file.data)) {
          issues.push({
            field: file.name,
            message: `"${file.name}" is not a JPEG or PNG image`,
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
    // Source bytes stay resident while each image is embedded and the document
    // is serialized; the encoded images themselves are copied once more.
    let total = 0;
    for (const file of input.files) total += file.data.byteLength;
    return { memoryBytes: total * 3, pageCount: input.files.length };
  },

  async run(input, ctx) {
    const options = input.options ?? {};
    const result = await imagesToPdf(
      input.files.map((file) => ({ name: file.name, data: file.data })),
      {
        ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
        ...(options.orientation !== undefined ? { orientation: options.orientation } : {}),
        ...(options.margin !== undefined ? { margin: options.margin } : {}),
      },
      ctx,
    );

    const stem = baseName(input.files[0]?.name ?? 'images');
    const fallback = input.files.length > 1 ? `${stem}-images` : stem;
    return {
      data: toArrayBuffer(result.data),
      pageCount: result.pageCount,
      fileName: safeOutputName(options.outputName, fallback),
    };
  },
};
