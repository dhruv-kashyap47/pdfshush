import type { PDFPageProxy } from 'pdfjs-dist';
import { createProgressReporter, type JobContext } from '../job.js';
import { LIMITS } from '../limits.js';
import { defaultCanvasFactory, scaleForWidth, type CanvasFactory } from './canvas.js';
import { loadPdfForRender } from './pdfjsRuntime.js';

export type ImageFormat = 'png' | 'jpeg';

export interface RenderPageOptions {
  /** Target pixel width; height follows the page aspect ratio. */
  targetWidthPx: number;
  format: ImageFormat;
  /** 0..1, JPEG only. */
  quality?: number;
  /** Opaque background; PDF pages have no intrinsic background. */
  background?: string;
  canvasFactory?: CanvasFactory;
}

export interface RenderedImage {
  /** Raw encoded bytes -- transferable, avoids a Blob round-trip. */
  data: ArrayBuffer;
  width: number;
  height: number;
  mimeType: string;
}

const MIME: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
};

export async function renderPageToImage(
  page: PDFPageProxy,
  options: RenderPageOptions,
): Promise<RenderedImage> {
  const factory = options.canvasFactory ?? defaultCanvasFactory();
  const scale = scaleForWidth(page.getViewport({ scale: 1 }).width, options.targetWidthPx);
  const viewport = page.getViewport({ scale });

  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  const canvas = factory(width, height);
  const context = canvas.context as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('Could not acquire a 2D canvas context');

  const background = options.background ?? '#ffffff';
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const task = page.render({
    // v6 made `canvas` required; null means "derive it from the context", which
    // is how OffscreenCanvas contexts (worker rendering) are supported. pdf.js
    // only calls 2D-context methods, shared by DOM and offscreen variants.
    canvas: null,
    canvasContext: context as CanvasRenderingContext2D,
    viewport,
    background,
  });
  await task.promise;

  const mimeType = MIME[options.format];
  const blob = await canvas.toBlob(
    mimeType,
    options.format === 'jpeg' ? (options.quality ?? 0.92) : undefined,
  );
  const data = await blob.arrayBuffer();
  return { data, width, height, mimeType };
}

export interface RenderPageRangeOptions extends RenderPageOptions {
  /** Zero-based page indexes. */
  pageIndexes: number[];
}

/** Renders a set of pages, keeping progress responsive and abortable. */
export async function renderPages(
  pdfData: Uint8Array,
  options: RenderPageRangeOptions,
  ctx: JobContext,
  password?: string,
): Promise<RenderedImage[]> {
  const { doc, destroy } = await loadPdfForRender(pdfData, {
    ...(password !== undefined ? { password } : {}),
  });
  const progress = createProgressReporter(ctx);
  const out: RenderedImage[] = [];

  try {
    const total = options.pageIndexes.length;
    if (total === 0) throw new Error('No pages selected');

    for (let i = 0; i < total; i += 1) {
      ctx.throwIfAborted();
      const index = options.pageIndexes[i]!;
      const page = await doc.getPage(index + 1);
      out.push(
        await renderPageToImage(page, {
          targetWidthPx: options.targetWidthPx,
          format: options.format,
          ...(options.quality !== undefined ? { quality: options.quality } : {}),
          ...(options.background !== undefined ? { background: options.background } : {}),
          ...(options.canvasFactory ? { canvasFactory: options.canvasFactory } : {}),
        }),
      );
      // Release the page's resources immediately -- this is the difference
      // between a 500-page job and a 500-page tab crash.
      page.cleanup();
      progress.step(i, total, `Rendering page ${index + 1} of ${total}`);
      await Promise.resolve();
    }
  } finally {
    await destroy();
  }

  return out;
}

/**
 * Renders small previews for a page grid. Thumbnails degrade gracefully: huge
 * documents get a narrower strip, so a 300 page deck still renders.
 */
export async function renderThumbnails(
  pdfData: Uint8Array,
  options: { targetWidthPx: number; pageIndexes?: number[]; background?: string },
  ctx: JobContext,
  password?: string,
): Promise<{ pageCount: number; thumbnails: RenderedImage[] }> {
  const { doc, destroy } = await loadPdfForRender(pdfData, {
    ...(password !== undefined ? { password } : {}),
  });
  const progress = createProgressReporter(ctx);

  try {
    const pageCount = doc.numPages;
    const indexes = options.pageIndexes ?? Array.from({ length: pageCount }, (_, i) => i);
    // Single source of truth for the degradation threshold (the UI used to keep
    // its own copy, which silently drifted from this one).
    const width =
      indexes.length > LIMITS.client.thumbnailDegradeAtPages
        ? Math.min(options.targetWidthPx, 96)
        : options.targetWidthPx;
    const thumbnails: RenderedImage[] = [];

    for (let i = 0; i < indexes.length; i += 1) {
      ctx.throwIfAborted();
      const page = await doc.getPage(indexes[i]! + 1);
      thumbnails.push(
        await renderPageToImage(page, {
          targetWidthPx: width,
          format: 'jpeg',
          quality: 0.72,
          background: options.background ?? '#ffffff',
        }),
      );
      page.cleanup();
      progress.step(i, indexes.length, 'Preparing previews');
      await Promise.resolve();
    }

    progress.report('Previews ready', 1);
    return { pageCount, thumbnails };
  } finally {
    await destroy();
  }
}