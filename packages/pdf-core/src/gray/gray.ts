/**
 * Grayscale conversion -- Grayscale PDF.
 *
 * There is no honest client-side way to rewrite only the colour operators of
 * arbitrary content streams (inline images, shadings, patterns and nested
 * XObjects all carry colour). So the pages are rasterized on the pdf.js
 * pipeline the rest of the product renders with, the pixels are converted in
 * place (Rec. 601 luma), and a fresh document is rebuilt from the JPEGs.
 *
 * That is the same contract secure redaction already makes and discloses: the
 * output is flat images -- text is no longer selectable. The UI says so
 * before the user confirms, and the job refuses more pages than the
 * rasterize-rebuild ceiling redaction uses.
 *
 * Browser-only: without a 2D context the conversion reports unavailable and
 * refuses rather than degrading. The luma conversion itself is pure and
 * unit-tested in Node.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';
import { LIMITS } from '../limits.js';
import { loadPdfForRender } from '../render/pdfjsRuntime.js';
import { renderPageToCanvas } from '../render/renderPage.js';

export interface GrayscaleOptions {
  /** Render width in pixels. Defaults to the product's image width. */
  targetWidthPx?: number;
  /** JPEG quality, 0.3..1. Defaults to 0.85. */
  quality?: number;
}

export interface GrayscaleResult {
  data: Uint8Array;
  pageCount: number;
}

/**
 * Converts one RGBA bitmap in place to luma. Pure apart from the mutation of
 * `pixels`, so it is cheap to test in Node.
 */
export function toGrayscaleRgba(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    // ITU-R BT.601 luma -- the weights TV/monitor grayscale was always tuned to.
    const luma = 0.299 * pixels[i]! + 0.587 * pixels[i + 1]! + 0.114 * pixels[i + 2]!;
    const grey = luma < 0 ? 0 : luma > 255 ? 255 : Math.round(luma);
    pixels[i] = grey;
    pixels[i + 1] = grey;
    pixels[i + 2] = grey;
    // Alpha stays as painted: PDF pages render over white here, so it is 255.
  }
}

export async function grayscaleDocument(
  data: Uint8Array,
  options: GrayscaleOptions,
  ctx: JobContext,
  password?: string,
): Promise<GrayscaleResult> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('Grayscale needs this browser to run; it cannot run without a canvas');
  }

  const loaded = await loadPdfForRender(data, { ...(password ? { password } : {}) });
  const progress = createProgressReporter(ctx);
  const quality = Math.min(1, Math.max(0.3, options.quality ?? 0.85));
  const targetWidthPx = Math.min(
    Math.max(320, Math.round(options.targetWidthPx ?? LIMITS.tool.defaultImageWidthPx)),
    4000,
  );

  try {
    const out = await PDFDocument.create();
    const total = loaded.doc.numPages;
    if (total > LIMITS.tool.maxRedactPages) {
      throw new Error(
        `That document has ${total} pages; grayscale rebuilds each page as an image and the limit is ${LIMITS.tool.maxRedactPages}. Split it first.`,
      );
    }

    for (let index = 1; index <= total; index += 1) {
      ctx.throwIfAborted();
      const page = await loaded.doc.getPage(index);
      const rendered = await renderPageToCanvas(page, { targetWidthPx, format: 'jpeg' });
      const unit = page.getViewport({ scale: 1 });
      const { canvas, context } = rendered;

      const imageData = context.getImageData(0, 0, rendered.width, rendered.height);
      toGrayscaleRgba(imageData.data);
      context.putImageData(imageData, 0, 0);

      const blob = await canvas.toBlob('image/jpeg', quality);
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      await out.embedJpg(jpeg);
      out.addPage([unit.width, unit.height]);
      page.cleanup();

      // Zero the backing store now rather than at GC convenience; a 150-page
      // run would otherwise hold every bitmap at once.
      canvas.release?.();
      progress.step(index - 1, total, `Converting page ${index} of ${total}`);
    }

    const bytes = await out.save({ useObjectStreams: false });
    return { data: bytes, pageCount: total };
  } finally {
    await loaded.destroy();
  }
}
