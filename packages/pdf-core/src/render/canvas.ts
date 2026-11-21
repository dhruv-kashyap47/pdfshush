/**
 * Canvas abstraction.
 *
 * Rendering happens inside a Web Worker, so the real implementation is
 * `OffscreenCanvas`. We keep an interface here so the same engine can also run
 * under Node (with a canvas polyfill) and in the main thread during tests.
 *
 * The DOM type names are deliberately not used: `apps/api` compiles this engine
 * without the `dom` lib, and a bare `OffscreenCanvas` annotation would make the
 * Node build depend on browser types it never uses.
 */

export interface RenderCanvas {
  readonly width: number;
  readonly height: number;
  /** 2D rendering context (DOM or offscreen, depending on the realm). */
  readonly context: unknown;
  toBlob(type: string, quality?: number): Promise<Blob>;
  /** Optional early release of the underlying bitmap (memory pressure). */
  release?(): void;
}

export type CanvasFactory = (width: number, height: number) => RenderCanvas;

/**
 * The 2D-context operations the engine actually uses. Deliberately structural:
 * the DOM and Offscreen contexts both satisfy it, and `apps/api` can compile
 * the engine without the `dom` lib.
 */
export interface Canvas2DContext {
  readonly canvas?: unknown;
  fillStyle: unknown;
  strokeStyle?: unknown;
  font?: string;
  textBaseline?: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  clearRect?(x: number, y: number, width: number, height: number): void;
  getImageData(
    x: number,
    y: number,
    width: number,
    height: number,
  ): { data: Uint8ClampedArray; width: number; height: number };
  putImageData(
    image: { data: Uint8ClampedArray; width: number; height: number },
    x: number,
    y: number,
  ): void;
  fillText?(text: string, x: number, y: number): void;
  measureText?(text: string): { width: number };
  drawImage?(image: unknown, x: number, y: number, width?: number, height?: number): void;
}

interface OffscreenCanvasLike {
  width: number;
  height: number;
  getContext(type: '2d', options?: unknown): unknown;
  convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob>;
}

interface HtmlCanvasLike {
  width: number;
  height: number;
  getContext(type: '2d', options?: unknown): unknown;
  toBlob(
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: number,
  ): void;
}

interface CanvasGlobals {
  OffscreenCanvas?: new (width: number, height: number) => OffscreenCanvasLike;
  document?: {
    createElement(tag: 'canvas'): HtmlCanvasLike;
  };
}

function canvasGlobals(): CanvasGlobals {
  return globalThis as unknown as CanvasGlobals;
}

class OffscreenCanvasAdapter implements RenderCanvas {
  constructor(private readonly canvas: OffscreenCanvasLike) {}
  get width(): number {
    return this.canvas.width;
  }
  get height(): number {
    return this.canvas.height;
  }
  get context(): unknown {
    return this.canvas.getContext('2d', { willReadFrequently: true });
  }
  toBlob(type: string, quality?: number): Promise<Blob> {
    return this.canvas.convertToBlob({
      type,
      ...(quality !== undefined ? { quality } : {}),
    });
  }
  release(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

class HtmlCanvasAdapter implements RenderCanvas {
  constructor(private readonly canvas: HtmlCanvasLike) {}
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
  release(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

/** True when this realm owns canvases that outlive a DOM document. */
export function hasOffscreenCanvas(): boolean {
  return typeof canvasGlobals().OffscreenCanvas !== 'undefined';
}

/** A canvas pdf.js asked us for, plus the 2D context it paints into. */
export interface PdfjsCanvasEntry {
  canvas: OffscreenCanvasLike;
  /** Null when the browser refuses a 2D context (e.g. GPU process loss). */
  context: unknown;
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
  constructor(_options?: { ownerDocument?: unknown; enableHWA?: boolean }) {}

  create(width: number, height: number): PdfjsCanvasEntry {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const Offscreen = canvasGlobals().OffscreenCanvas;
    if (!Offscreen) throw new Error('OffscreenCanvas is not available');
    const canvas = new Offscreen(width, height);
    // `willReadFrequently` mirrors pdf.js's own factories: these scratch canvases
    // are painted and then read back, which a GPU-backed context makes slow.
    return {
      canvas,
      context: canvas.getContext('2d', { willReadFrequently: true }),
    };
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

  const globals = canvasGlobals();
  if (globals.OffscreenCanvas) {
    const Offscreen = globals.OffscreenCanvas;
    cachedFactory = (width, height) => new OffscreenCanvasAdapter(new Offscreen(width, height));
    return cachedFactory;
  }

  if (globals.document) {
    cachedFactory = (width, height) => {
      const canvas = globals.document!.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return new HtmlCanvasAdapter(canvas);
    };
    return cachedFactory;
  }

  throw new Error(
    'This environment has no canvas implementation. Run pdfshush processing in a browser worker, ' +
      'or install a canvas polyfill on the server.',
  );
}

/** Scale that yields the requested pixel width for a PDF page. */
export function scaleForWidth(pageWidthPt: number, targetWidthPx: number): number {
  if (pageWidthPt <= 0) return 1;
  return Math.max(0.05, Math.min(8, targetWidthPx / pageWidthPt));
}

/** Hard bounds for one page bitmap. Both must hold for every render. */
export interface RenderBudget {
  /** Longest side, in pixels. */
  maxEdgePx: number;
  /** Width x height, in pixels. */
  maxAreaPx: number;
}

export interface FittedRender {
  scale: number;
  width: number;
  height: number;
}

/**
 * Largest scale at or below `wantedScale` whose bitmap fits `budget`.
 */
export function fitScaleToBudget(
  pageWidthPt: number,
  pageHeightPt: number,
  wantedScale: number,
  budget: RenderBudget,
): FittedRender {
  const widthPt = Number.isFinite(pageWidthPt) && pageWidthPt > 0 ? pageWidthPt : 1;
  const heightPt = Number.isFinite(pageHeightPt) && pageHeightPt > 0 ? pageHeightPt : 1;
  const wanted = Number.isFinite(wantedScale) && wantedScale > 0 ? wantedScale : 1;

  const edgeScale = budget.maxEdgePx / Math.max(widthPt, heightPt);
  const areaScale = Math.sqrt(budget.maxAreaPx / (widthPt * heightPt));
  const scale = Math.max(Number.EPSILON, Math.min(wanted, edgeScale, areaScale));

  return {
    scale,
    width: Math.max(1, Math.floor(widthPt * scale)),
    height: Math.max(1, Math.floor(heightPt * scale)),
  };
}

/**
 * Raster width in pixels for a page rendered at `scale`, clamped so the decoded
 * bitmap stays inside `maxPixels`.
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
