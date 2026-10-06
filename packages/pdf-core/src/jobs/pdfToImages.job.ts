import type { JobDefinition } from '../job.js';
import { renderPages, type ImageFormat, type RenderedImage } from '../render/renderPage.js';
import { probePageCount } from '../ops/pages.js';
import { createZip, dedupeNames, pageFileName, stripExtension } from '../ops/zip.js';
import { baseName, toArrayBuffer, totalInputBytes } from './helpers.js';
import { LIMITS } from '../limits.js';

/** Type alias (not interface) so it keeps an implicit index signature and
 * satisfies the `JobInputBase['options']` constraint. */
export type PdfToImagesOptions = {
  /** Zero-based page indexes. Empty or missing means every page. */
  pageIndexes?: number[];
  format?: ImageFormat;
  /** Target pixel width of the page. */
  targetWidthPx?: number;
  quality?: number;
};

export interface PdfToImagesInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: PdfToImagesOptions;
}

export interface PdfToImagesOutput {
  images: { name: string; data: ArrayBuffer; width: number; height: number; mimeType: string }[];
  /** Pre-built archive so the UI never has to zip in the main thread. */
  zip: ArrayBuffer;
  zipName: string;
  format: ImageFormat;
  pageCount: number;
}

export const pdfToImagesJob: JobDefinition<PdfToImagesInput, PdfToImagesOutput> = {
  slug: 'pdf-to-images',
  label: 'PDF to images',

  validate(input) {
    if (input.files.length !== 1) {
      return { ok: false, issues: [{ message: 'Choose exactly one PDF' }] };
    }
    return { ok: true };
  },

  estimate(input) {
    const bytes = totalInputBytes(input);
    const target = input.options?.targetWidthPx ?? LIMITS.tool.defaultImageWidthPx;
    // A full-page RGBA canvas is 4 bytes per pixel -- the real memory driver.
    const pixelsPerPage = target * target * 4 * (input.options?.pageIndexes?.length ?? 200);
    return { memoryBytes: bytes + Math.min(pixelsPerPage, 1.5 * 1024 * 1024 * 1024) };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const options = input.options ?? {};
    const format = options.format ?? 'jpeg';
    const targetWidthPx = options.targetWidthPx ?? LIMITS.tool.defaultImageWidthPx;

    // We need the page count to expand "all pages".
    const pageCount = await probePageCount(file.data, {
      ...(file.password ? { password: file.password } : {}),
    });
    const pageIndexes = options.pageIndexes?.length
      ? options.pageIndexes
      : Array.from({ length: pageCount }, (_, i) => i);

    const rendered: RenderedImage[] = await renderPages(
      file.data,
      {
        pageIndexes,
        format,
        targetWidthPx,
        ...(options.quality !== undefined ? { quality: options.quality } : {}),
      },
      ctx,
      file.password,
    );

    const stem = stripExtension(baseName(file.name));
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    const names = dedupeNames(pageIndexes.map((_, i) => pageFileName(stem, i + 1, pageIndexes.length, ext)));
    const images = rendered.map((image, i) => ({
      name: names[i] ?? `page-${i + 1}.${ext}`,
      data: image.data,
      width: image.width,
      height: image.height,
      mimeType: image.mimeType,
    }));

    const zip = createZip(images.map((image) => ({ name: image.name, data: new Uint8Array(image.data) })));

    return {
      images,
      zip: toArrayBuffer(zip),
      zipName: `${stem}-images.zip`,
      format,
      pageCount: pageIndexes.length,
    };
  },
};