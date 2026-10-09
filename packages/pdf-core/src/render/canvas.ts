/**
 * Canvas abstraction.
 *
 * Rendering happens inside a Web Worker, so the real implementation is
 * `OffscreenCanvas`. We keep an interface here so the same engine can also run
 * under Node (with a canvas polyfill) and in the main thread during tests.
 */

export interface RenderCanvas {
  readonly width: number;
  readonly height: number;
  /** 2D rendering context. */
  readonly context: unknown;
  toBlob(type: string, quality?: number): Promise<Blob>;
}

export type CanvasFactory = (width: number, height: number) => RenderCanvas;

class OffscreenCanvasAdapter implements RenderCanvas {
  constructor(private readonly canvas: OffscreenCanvas) {}
  get width(): number {
    return this.canvas.width;
  }
  get height(): number {
    return this.canvas.height;
  }
  get context(): unknown {
    return this.canvas.getContext('2d');
  }
  toBlob(type: string, quality?: number): Promise<Blob> {
    return this.canvas.convertToBlob({ type, ...(quality !== undefined ? { quality } : {}) });
  }
}

class HtmlCanvasAdapter implements RenderCanvas {
  constructor(private readonly canvas: HTMLCanvasElement) {}
  get width(): number {
    return this.canvas.width;
  }
  get height(): number {
    return this.canvas.height;
  }
  get context(): unknown {
    return this.canvas.getContext('2d');
  }
  toBlob(type: string, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas produced no image data'))),
        type,
        quality,
      );
    });
  }
}

/** True when this realm owns canvases that outlive a DOM document. */
export function hasOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

/** A canvas pdf.js asked us for, plus the 2D context it paints into. */
export interface PdfjsCanvasEntry {
  canvas: OffscreenCanvas;
  /** Null when the browser refuses a 2D context (e.g. GPU process loss). */
  context: OffscreenCanvasRenderingContext2D | null;
}

/**
 * The canvas factory pdf.js hands its own painting to.
 *
 * pdf.js is not content to draw onto the canvas we give it: image downscaling,
 * soft masks, tiling patterns, shadings and transparency groups all ask
 * `canvasFactory.create()` for scratch space of their own. Left alone it builds
 * `DOMCanvasFactory`, whose `ownerDocument` defaults to `globalThis.document` --
 * which is `undefined` inside a Web Worker. Because it is a *property* read
 * rather than a bare identifier, that produced no `ReferenceError`, just
 * `Cannot read properties of undefined (reading 'createElement')` the first
 * time a page painted an image, which is exactly how the editor came up blank
 * on real-world PDFs.
 *
 * pdf.js instantiates the class it is given (`new CanvasFactory({ ownerDocument,
 * enableHWA })`), so it must be handed over as a constructor, not an instance.
 */
export class PdfjsCanvasFactory {
  /** Accepted and ignored: pdf.js passes its DOM, and a worker has none. */
  constructor(_options?: { ownerDocument?: Document; enableHWA?: boolean }) {}

  create(width: number, height: number): PdfjsCanvasEntry {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    // `willReadFrequently` mirrors pdf.js's own factories: these scratch canvases
    // are painted and then read back, which a GPU-backed context makes slow.
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }

  reset(entry: PdfjsCanvasEntry, width: number, height: number): void {
    if (!entry.canvas) throw new Error('Canvas is not specified');
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    entry.canvas.width = width;
    entry.canvas.height = height;
  }

  destroy(entry: PdfjsCanvasEntry): void {
    if (!entry.canvas) throw new Error('Canvas is not specified');
    // Zeroing the dimensions releases the backing store immediately. Waiting for
    // the collector would pin every scratch bitmap in the meantime, and a
    // page's scratch canvases can reach page-sized megapixels.
    entry.canvas.width = 0;
    entry.canvas.height = 0;
    entry.context = null;
  }
}

let cachedFactory: CanvasFactory | undefined;

export function defaultCanvasFactory(): CanvasFactory {
  if (cachedFactory) return cachedFactory;

  if (typeof OffscreenCanvas !== 'undefined') {
    cachedFactory = (width, height) => new OffscreenCanvasAdapter(new OffscreenCanvas(width, height));
    return cachedFactory;
  }

  if (typeof document !== 'undefined') {
    cachedFactory = (width, height) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return new HtmlCanvasAdapter(canvas);
    };
    return cachedFactory;
  }

  throw new Error(
    'This environment has no canvas implementation. Run PDFShush processing in a browser worker, ' +
      'or install a canvas polyfill on the server.',
  );
}

/** Scale that yields the requested pixel width for a PDF page. */
export function scaleForWidth(pageWidthPt: number, targetWidthPx: number): number {
  if (pageWidthPt <= 0) return 1;
  return Math.max(0.05, Math.min(8, targetWidthPx / pageWidthPt));
}

/**
 * Raster width in pixels for a page rendered at `scale`, clamped so the decoded
 * bitmap stays inside `maxPixels`.
 *
 * A page's pixel area is `widthPt * heightPt * scale ** 2`, so the largest scale
 * the budget allows is `sqrt(maxPixels / (widthPt * heightPt))` -- and that is a
 * *scale* (pixels per point), not a width. Taking it as a width is the bug this
 * replaces: the editor compared it against a real pixel width, so `min()` always
 * picked the budget number and every page was asked to render about 7 px wide.
 * `scaleForWidth`'s 0.05 floor turned that into a 29 px bitmap stretched across
 * the whole column, which reads as a blank page.
 *
 * Clamping the scale rather than the width is also what keeps a huge page honest:
 * the area it returns stays `<= maxPixels` at any aspect ratio, while a page small
 * enough to fit is left at the scale the UI asked for.
 */
export function rasterWidthWithinBudget(
  pageWidthPt: number,
  pageHeightPt: number,
  scale: number,
  maxPixels: number,
): number {
  const widthPt = pageWidthPt > 0 ? pageWidthPt : 1;
  const heightPt = pageHeightPt > 0 ? pageHeightPt : 1;
  const wanted = widthPt * scale;
  if (!Number.isFinite(wanted) || wanted <= 0 || !Number.isFinite(scale)) return 1;
  const budgetScale = Math.sqrt(maxPixels / (widthPt * heightPt));
  const capped =
    Number.isFinite(budgetScale) && budgetScale > 0 ? Math.min(scale, budgetScale) : scale;
  return Math.max(1, Math.round(widthPt * capped));
}