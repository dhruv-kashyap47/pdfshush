/**
 * Deskew -- straighten cropped/skewed scans.
 *
 * A page's rotation cannot be undone by rewriting the content stream: the skew
 * may live in the scan itself, in an image XObject or in a photographed page,
 * and a PDF `/Rotate` only turns whole pages by 90°. So this follows the same
 * rasterize-and-rebuild contract as grayscale, dark mode and secure redaction:
 *
 *   1. render each page through the product's pdf.js runtime;
 *   2. estimate the skew from a downscaled ink matrix (`skew.ts`);
 *   3. rotate the page pixels back to level on a white canvas;
 *   4. rebuild a fresh document from the JPEGs.
 *
 * The disclosed cost is identical to the other raster rebuilds: the output pages
 * are images, so text is no longer selectable. Rotating a page also grows its
 * box slightly to keep the corners, so a corrected page can gain thin white
 * wedges along the edges.
 *
 * Browser-only: without `OffscreenCanvas` the job refuses rather than
 * degrading. The estimator itself is pure and unit-tested in Node.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import { applyDocumentDates } from '../ops/dates.js';
import { addRasterPage } from '../ops/rasterPage.js';
import { createProgressReporter, type JobContext } from '../job.js';
import { LIMITS } from '../limits.js';
import { loadPdfForRender } from '../render/pdfjsRuntime.js';
import { renderPageToCanvas } from '../render/renderPage.js';
import {
  SKEW_LIMITS,
  estimateSkewAngle,
  isValidOverrideAngle,
} from './skew.js';

export interface DeskewOptions {
  /**
   * Rotate every page by this angle instead of detecting one. `null`/undefined
   * means auto-detect. Bounded to ±45° because beyond that "deskew" is really
   * a page rotation the user should make deliberately.
   */
  overrideAngle?: number | null;
  /** Render width in pixels, 320..4000. */
  targetWidthPx?: number;
  /** JPEG quality, 0.3..1. */
  quality?: number;
}

export interface DeskewResult {
  data: Uint8Array;
  pageCount: number;
  /** The angle applied to each page, in page order. */
  angles: number[];
}

export async function deskewDocument(
  data: Uint8Array,
  options: DeskewOptions,
  ctx: JobContext,
  password?: string,
): Promise<DeskewResult> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('Deskew needs this browser to run; it cannot run without a canvas');
  }

  const override = options.overrideAngle ?? null;
  if (override !== null && !isValidOverrideAngle(override)) {
    throw new Error(`Override angle must be a number between -${SKEW_LIMITS.maxOverrideDeg} and +${SKEW_LIMITS.maxOverrideDeg} degrees`);
  }

  const loaded = await loadPdfForRender(data, { ...(password ? { password } : {}) });
  const progress = createProgressReporter(ctx);
  const quality = Math.min(1, Math.max(0.3, options.quality ?? 0.92));
  const targetWidthPx = Math.min(
    Math.max(320, Math.round(options.targetWidthPx ?? LIMITS.tool.defaultImageWidthPx)),
    4000,
  );

  try {
    const total = loaded.doc.numPages;
    if (total > LIMITS.tool.maxRedactPages) {
      throw new Error(
        `That document has ${total} pages; deskew rebuilds each page as an image and the limit is ${LIMITS.tool.maxRedactPages}. Split it first.`,
      );
    }

    const out = await PDFDocument.create();
    // A rasterized rebuild has no source document to inherit dates from.
    applyDocumentDates(out, {});
    const angles: number[] = [];

    for (let index = 1; index <= total; index += 1) {
      ctx.throwIfAborted();
      const page = await loaded.doc.getPage(index);
      const unit = page.getViewport({ scale: 1 });
      const rendered = await renderPageToCanvas(page, { targetWidthPx, format: 'jpeg' });
      const source = rendered.context.canvas as CanvasImageSource;

      const angle = override ?? skewFromCanvas(source, rendered.width, rendered.height);
      angles.push(angle);

      const rotated = rotateCanvas(source, rendered.width, rendered.height, angle);
      const blob = await rotated.canvas.convertToBlob({ type: 'image/jpeg', quality });
      const jpeg = new Uint8Array(await blob.arrayBuffer());

      // Keep the physical scale: a 4° rotation grows the box by ~7%, and a page
      // that grows must still print at the same size as the original.
      const scaleX = rendered.width / unit.width;
      const scaleY = rendered.height / unit.height;
      const widthPt = rotated.width / scaleX;
      const heightPt = rotated.height / scaleY;
      await addRasterPage(out, jpeg, widthPt, heightPt);

      page.cleanup();
      rendered.canvas.release?.();
      rotated.canvas.width = 0;
      rotated.canvas.height = 0;
      progress.step(index - 1, total, `Straightening page ${index} of ${total}`);
    }

    const bytes = await out.save({ useObjectStreams: false });
    return { data: bytes, pageCount: total, angles };
  } finally {
    await loaded.destroy();
  }
}

/**
 * Reduce a rendered page to a downscaled ink matrix and estimate its skew.
 * The matrix is inverted luminance (paper = 0, ink = 255), which is what the
 * estimator expects.
 */
function skewFromCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
): number {
  const factor = Math.min(1, SKEW_LIMITS.maxDimension / Math.max(width, height));
  const w = Math.max(1, Math.round(width * factor));
  const h = Math.max(1, Math.round(height * factor));
  const small = new OffscreenCanvas(w, h);
  const context = small.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser could not read the page for skew detection');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, w, h);
  context.drawImage(source, 0, 0, w, h);
  const pixels = context.getImageData(0, 0, w, h).data;
  const ink = new Uint8Array(w * h);
  for (let index = 0; index < ink.length; index += 1) {
    const offset = index * 4;
    const luma = pixels[offset]! * 0.299 + pixels[offset + 1]! * 0.587 + pixels[offset + 2]! * 0.114;
    ink[index] = 255 - Math.round(luma);
  }
  small.width = 0;
  small.height = 0;
  return estimateSkewAngle(ink, w, h);
}

/** Rotate a page raster by `-angle` on a white canvas, keeping every corner. */
function rotateCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
  angle: number,
): { canvas: OffscreenCanvas; width: number; height: number } {
  const radians = (-angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const widthPx = Math.max(1, Math.ceil(width * cos + height * sin));
  const heightPx = Math.max(1, Math.ceil(width * sin + height * cos));
  const canvas = new OffscreenCanvas(widthPx, heightPx);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not rotate the page');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, widthPx, heightPx);
  context.translate(widthPx / 2, heightPx / 2);
  context.rotate(radians);
  context.drawImage(source, -width / 2, -height / 2);
  return { canvas, width: widthPx, height: heightPx };
}
