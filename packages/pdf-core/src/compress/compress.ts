/**
 * Compress PDF -- two honest strategies, no magic.
 *
 * `lossless` re-serializes with object streams: text and images survive
 * byte-for-byte, but the engine cannot deduplicate or re-encode content it does
 * not understand, so already-optimized files may not shrink at all.
 *
 * `raster` rebuilds each page as a JPEG at a chosen resolution and quality --
 * the same rasterize-and-rebuild contract secure redaction and grayscale use.
 * It is what makes scanned/photographic documents genuinely smaller, and it
 * flattens text into pixels. The UI discloses that before the run; the job
 * enforces the same page ceiling as redaction.
 *
 * Browser-only for the raster path (needs `OffscreenCanvas`); lossless runs
 * anywhere pdf-lib does.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';
import { LIMITS } from '../limits.js';
import { loadPdfDocument } from '../ops/pages.js';
import { loadPdfForRender } from '../render/pdfjsRuntime.js';
import { renderPageToCanvas } from '../render/renderPage.js';

export type CompressMode = 'raster' | 'lossless';

export interface CompressOptions {
  mode?: CompressMode;
  /** JPEG quality for the raster path, 0.3..1. */
  quality?: number;
  /** Target resolution for the raster path, 72..300 dpi. */
  dpi?: number;
}

export interface CompressResult {
  data: Uint8Array;
  pageCount: number;
  mode: CompressMode;
}

export const COMPRESS_DEFAULTS = {
  mode: 'raster' as CompressMode,
  quality: 0.65,
  dpi: 150,
};

export const COMPRESS_LIMITS = {
  minQuality: 0.3,
  maxQuality: 1,
  minDpi: 72,
  maxDpi: 300,
} as const;

export async function compressDocument(
  data: Uint8Array,
  options: CompressOptions,
  ctx: JobContext,
  password?: string,
): Promise<CompressResult> {
  const mode = options.mode ?? COMPRESS_DEFAULTS.mode;
  const quality = clamp(options.quality ?? COMPRESS_DEFAULTS.quality, COMPRESS_LIMITS.minQuality, COMPRESS_LIMITS.maxQuality);
  const dpi = clamp(options.dpi ?? COMPRESS_DEFAULTS.dpi, COMPRESS_LIMITS.minDpi, COMPRESS_LIMITS.maxDpi);

  if (mode === 'lossless') {
    const doc = await loadPdfDocument(data, { ...(password ? { password } : {}) });
    ctx.throwIfAborted();
    const bytes = await doc.save({ useObjectStreams: true });
    return { data: bytes, pageCount: doc.getPageCount(), mode };
  }

  return rasterCompress(data, { quality, dpi }, ctx, password);
}

async function rasterCompress(
  data: Uint8Array,
  options: { quality: number; dpi: number },
  ctx: JobContext,
  password?: string,
): Promise<CompressResult> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('Strong compression needs this browser to run; it cannot run without a canvas');
  }

  const loaded = await loadPdfForRender(data, { ...(password ? { password } : {}) });
  const progress = createProgressReporter(ctx);

  try {
    const total = loaded.doc.numPages;
    if (total > LIMITS.tool.maxRedactPages) {
      throw new Error(
        `That document has ${total} pages; strong compression rebuilds each page as an image and the limit is ${LIMITS.tool.maxRedactPages}. Split it first, or use repack-only.`,
      );
    }

    const out = await PDFDocument.create();
    for (let index = 1; index <= total; index += 1) {
      ctx.throwIfAborted();
      const page = await loaded.doc.getPage(index);
      const unit = page.getViewport({ scale: 1 });
      // DPI is physical: a Letter page at 150 dpi is ~1275 px wide, whatever the
      // source resolution was.
      const targetWidthPx = Math.max(1, Math.round((unit.width * options.dpi) / 72));
      const rendered = await renderPageToCanvas(page, {
        targetWidthPx,
        format: 'jpeg',
        quality: options.quality,
      });

      const blob = await rendered.canvas.toBlob('image/jpeg', options.quality);
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      await out.embedJpg(jpeg);
      out.addPage([unit.width, unit.height]);
      page.cleanup();
      rendered.canvas.release?.();

      progress.step(index - 1, total, `Compressing page ${index} of ${total}`);
    }

    const bytes = await out.save({ useObjectStreams: false });
    return { data: bytes, pageCount: total, mode: 'raster' };
  } finally {
    await loaded.destroy();
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
