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