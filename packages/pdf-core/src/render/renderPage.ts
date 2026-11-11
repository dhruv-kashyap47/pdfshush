import type { PDFPageProxy } from 'pdfjs-dist';
import { createProgressReporter, type JobContext } from '../job.js';
import { LIMITS } from '../limits.js';
import { defaultCanvasFactory, fitScaleToBudget, type CanvasFactory } from './canvas.js';
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

export interface RenderedCanvas {
  /** Typed loosely so the worker (Offscreen) and tests (DOM) both fit. */
  canvas: import('./canvas.js').RenderCanvas;
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
}

/**
 * Renders one page into a fresh canvas and returns the raw context, so
 * callers that need pixel access (grayscale) can post-process before
 * encoding. Shared by `renderPageToImage`.
 */
export async function renderPageToCanvas(
  page: PDFPageProxy,
  options: RenderPageOptions,
): Promise<RenderedCanvas> {
  const factory = options.canvasFactory ?? defaultCanvasFactory();
  // Fit the scale to the requested width *and* to what a browser canvas can
  // actually hold. Doing only the first and then refusing the result meant a
  // tall page could never render at any offered width, and an oversized square
  // page produced a blank canvas on iOS/Safari. See `fitScaleToBudget`.
  const unit = page.getViewport({ scale: 1 });
  const wantedScale = unit.width > 0 ? options.targetWidthPx / unit.width : 1;
  const fitted = fitScaleToBudget(unit.width, unit.height, wantedScale, {
    maxEdgePx: LIMITS.tool.maxRenderEdgePx,
    maxAreaPx: LIMITS.tool.maxRenderAreaPx,
  });
  const viewport = page.getViewport({ scale: fitted.scale });

  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  const canvas = factory(width, height);
  const context = canvas.context as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) {
    canvas.release?.();
    throw new Error('Could not acquire a 2D canvas context');
  }

  const background = options.background ?? '#ffffff';
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  // A render task can reject (bad content stream, GPU context loss, a page
  // cancelled mid-paint). The canvas already holds a page-sized bitmap, so it
  // is released here as well; the success path is released by the caller.
  let task: ReturnType<PDFPageProxy['render']>;
  try {
    task = page.render({
      // v6 made `canvas` required; null means "derive it from the context", which
      // is how OffscreenCanvas contexts (worker rendering) are supported. pdf.js
      // only calls 2D-context methods, shared by DOM and offscreen variants.
      canvas: null,
      canvasContext: context as CanvasRenderingContext2D,
      viewport,
      background,
    });
    await task.promise;
  } catch (error) {
    canvas.release?.();
    throw error;
  }
  return { canvas, context, width, height };
}

export async function renderPageToImage(
  page: PDFPageProxy,
  options: RenderPageOptions,
): Promise<RenderedImage> {
  const rendered = await renderPageToCanvas(page, options);
  try {
    const mimeType = MIME[options.format];
    const blob = await rendered.canvas.toBlob(
      mimeType,
      options.format === 'jpeg' ? (options.quality ?? 0.92) : undefined,
    );
    const data = await blob.arrayBuffer();
    return { data, width: rendered.width, height: rendered.height, mimeType };
  } finally {
    // The context is dead past this point; zero the backing store now instead
    // of letting a multi-page run hold every rendered bitmap until GC.
    rendered.canvas.release?.();
  }
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
      try {
        out.push(
          await renderPageToImage(page, {
            targetWidthPx: options.targetWidthPx,
            format: options.format,
            ...(options.quality !== undefined ? { quality: options.quality } : {}),
            ...(options.background !== undefined ? { background: options.background } : {}),
            ...(options.canvasFactory ? { canvasFactory: options.canvasFactory } : {}),
          }),
        );
      } finally {
        // Runs even when the render throws: a failed page must not leak its
        // proxy, which pins the page's operator-list memory for the rest of
        // the run (and outlives it if the document proxy is still open).
        page.cleanup();
      }
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
      try {
        thumbnails.push(
          await renderPageToImage(page, {
            targetWidthPx: width,
            format: 'jpeg',
            quality: 0.72,
            background: options.background ?? '#ffffff',
          }),
        );
      } finally {
        page.cleanup();
      }
      progress.step(i, indexes.length, 'Preparing previews');
      await Promise.resolve();
    }

    progress.report('Previews ready', 1);
    return { pageCount, thumbnails };
  } finally {
    await destroy();
  }
}
