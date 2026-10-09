import { describe, expect, it, afterEach } from 'vitest';

import {
  hasOffscreenCanvas,
  PdfjsCanvasFactory,
  rasterWidthWithinBudget,
  scaleForWidth,
} from '../src/render/canvas.js';
import { JobTimeoutError, JobValidationError, serializeJobError } from '../src/job.js';

/** A4, in points -- the page geometry the editor is fit-width on by default. */
const A4 = { w: 595, h: 842 };
/** The editor's decoded-bitmap ceiling for one page. */
const MAX_RASTER_PIXELS = 12_000_000;

/**
 * The budget in the editor, before it was fixed. Kept as a literal so the test
 * that guards the regression states the old behaviour instead of restating the
 * new formula: it compared a *scale* (pixels per point) against a *width* in
 * pixels, so it returned about 10 for an A4 page at any sane zoom.
 */
function oldBrokenRasterWidth(widthPt: number, heightPt: number, scale: number): number {
  const budgeted = Math.sqrt(MAX_RASTER_PIXELS / (widthPt * heightPt)) * scale;
  const wanted = Math.round(widthPt * scale);
  return Math.max(1, Math.round(Math.min(wanted, budgeted)));
}

describe('rasterWidthWithinBudget', () => {
  it('gives an A4 page a page-sized raster at fit-width zoom', () => {
    // Fit-width on a ~950px column lands near zoom 1.5, times a DPR factor of 2.
    const scale = 1.5 * 2;
    const width = rasterWidthWithinBudget(A4.w, A4.h, scale, MAX_RASTER_PIXELS);

    // Must be page-sized. The old unit-confused calculation returned ~15 here,
    // which scaleForWidth's 0.05 floor turned into a 29px bitmap blown up across
    // the whole column -- indistinguishable from a blank page.
    expect(width).toBe(1785);
    expect(width).toBeGreaterThan(oldBrokenRasterWidth(A4.w, A4.h, scale) * 10);
  });

  it('honours the requested scale while the page fits the budget', () => {
    expect(rasterWidthWithinBudget(A4.w, A4.h, 1, MAX_RASTER_PIXELS)).toBe(595);
    expect(rasterWidthWithinBudget(A4.w, A4.h, 2, MAX_RASTER_PIXELS)).toBe(1190);
    expect(rasterWidthWithinBudget(612, 792, 1.25, MAX_RASTER_PIXELS)).toBe(765); // US Letter
  });

  it('keeps a rotated page budgeted in the orientation it is painted at', () => {
    // A4 rotated to landscape: pdf.js paints 842x595, so that is what is budgeted.
    const portrait = rasterWidthWithinBudget(A4.w, A4.h, 2, MAX_RASTER_PIXELS);
    const landscape = rasterWidthWithinBudget(A4.h, A4.w, 2, MAX_RASTER_PIXELS);
    expect(landscape).toBe(1684);
    expect(landscape).toBeGreaterThan(portrait);
    // Rotation must not change the area either way.
    expect((landscape / 2) * (A4.w * 2)).toBeLessThanOrEqual(MAX_RASTER_PIXELS);
  });

  it('caps the scale, not the width, so a huge page still fits the budget', () => {
    // A poster: even at scale 8 the whole page is only 6 megapixels, but a
    // 4000x6000 one is not, and must be clamped down to fit.
    const huge = { w: 4000, h: 6000 };
    const width = rasterWidthWithinBudget(huge.w, huge.h, 8, MAX_RASTER_PIXELS);

    const scale = width / huge.w;
    expect(scale * huge.w * (scale * huge.h)).toBeLessThanOrEqual(MAX_RASTER_PIXELS);
    expect(width).toBeLessThan(huge.w * 8);
    expect(width).toBeGreaterThan(0);
  });

  it('survives a page larger than any sane canvas', () => {
    const width = rasterWidthWithinBudget(20_000, 30_000, 8, MAX_RASTER_PIXELS);
    const scale = width / 20_000;
    expect(scale * 20_000 * (scale * 30_000)).toBeLessThanOrEqual(MAX_RASTER_PIXELS);
  });

  it('never returns zero for degenerate geometry', () => {
    expect(rasterWidthWithinBudget(0, 0, 1, MAX_RASTER_PIXELS)).toBe(1);
    expect(rasterWidthWithinBudget(Number.NaN, 842, 1, MAX_RASTER_PIXELS)).toBe(1);
    expect(rasterWidthWithinBudget(A4.w, A4.h, 0, MAX_RASTER_PIXELS)).toBe(1);
    expect(rasterWidthWithinBudget(A4.w, A4.h, Number.NaN, MAX_RASTER_PIXELS)).toBe(1);
  });

  it('is monotonic in zoom and round-trips through scaleForWidth', () => {
    let previous = 0;
    for (const scale of [0.25, 0.5, 1, 1.5, 2, 4, 8]) {
      const width = rasterWidthWithinBudget(A4.w, A4.h, scale, MAX_RASTER_PIXELS);
      expect(width).toBeGreaterThanOrEqual(previous);
      previous = width;
    }
    // Whatever width we ask for, the scale actually used must rebuild it.
    for (const scale of [0.1, 0.5, 1, 3]) {
      const width = rasterWidthWithinBudget(A4.w, A4.h, scale, MAX_RASTER_PIXELS);
      expect(scaleForWidth(A4.w, width)).toBeCloseTo(scaleForWidth(A4.w, width), 6);
    }
  });
});

/* -------------------------------------------------------------------------- */

class FakeOffscreenCanvas {
  width: number;
  height: number;
  readonly contextRequests: unknown[] = [];
  private readonly ctx: object;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ctx = { fake: '2d' };
  }

  getContext(kind: string, options?: unknown): object | null {
    this.contextRequests.push(options);
    return kind === '2d' ? this.ctx : null;
  }
}

const globals = globalThis as unknown as { OffscreenCanvas?: unknown };
const realOffscreen = globals.OffscreenCanvas;

function useFakeOffscreenCanvas(): void {
  globals.OffscreenCanvas = FakeOffscreenCanvas;
}

afterEach(() => {
  if (realOffscreen === undefined) delete globals.OffscreenCanvas;
  else globals.OffscreenCanvas = realOffscreen;
});

describe('hasOffscreenCanvas', () => {
  it('reports the realm accurately so Node keeps pdf.js\'s NodeCanvasFactory', () => {
    delete globals.OffscreenCanvas;
    expect(hasOffscreenCanvas()).toBe(false);
    useFakeOffscreenCanvas();
    expect(hasOffscreenCanvas()).toBe(true);
  });
});

describe('PdfjsCanvasFactory', () => {
  it('is constructible the way pdf.js constructs it', () => {
    useFakeOffscreenCanvas();
    // pdf.js does `new CanvasFactory({ ownerDocument, enableHWA })`. Passing an
    // instance instead throws "is not a constructor", so the class shape is part
    // of the contract, not an implementation detail.
    const factory = new PdfjsCanvasFactory({ ownerDocument: undefined, enableHWA: false });
    expect(factory).toBeInstanceOf(PdfjsCanvasFactory);
    expect(typeof factory.create).toBe('function');
    expect(typeof factory.reset).toBe('function');
    expect(typeof factory.destroy).toBe('function');
  });

  it('creates a correctly sized canvas with a 2D context', () => {
    useFakeOffscreenCanvas();
    const factory = new PdfjsCanvasFactory();
    const entry = factory.create(320, 240);

    expect(entry.canvas.width).toBe(320);
    expect(entry.canvas.height).toBe(240);
    expect(entry.context).not.toBeNull();
    // pdf.js's own factories ask for a read-frequently context: these scratch
    // canvases are painted and then read back.
    expect((entry.canvas as unknown as FakeOffscreenCanvas).contextRequests).toEqual([
      { willReadFrequently: true },
    ]);
  });

  it('rejects a non-positive size, matching pdf.js', () => {
    useFakeOffscreenCanvas();
    const factory = new PdfjsCanvasFactory();
    expect(() => factory.create(0, 10)).toThrow(/Invalid canvas size/);
    expect(() => factory.create(10, 0)).toThrow(/Invalid canvas size/);
    expect(() => factory.create(-1, 10)).toThrow(/Invalid canvas size/);
  });

  it('resets an existing canvas to new dimensions', () => {
    useFakeOffscreenCanvas();
    const factory = new PdfjsCanvasFactory();
    const entry = factory.create(10, 10);
    factory.reset(entry, 64, 32);
    expect(entry.canvas.width).toBe(64);
    expect(entry.canvas.height).toBe(32);
    expect(() => factory.reset(entry, 0, 32)).toThrow(/Invalid canvas size/);
  });

  it('releases the backing store on destroy instead of waiting for the collector', () => {
    useFakeOffscreenCanvas();
    const factory = new PdfjsCanvasFactory();
    const entry = factory.create(800, 600);
    factory.destroy(entry);
    // Zeroed dimensions are what actually frees the bitmap memory.
    expect(entry.canvas.width).toBe(0);
    expect(entry.canvas.height).toBe(0);
    expect(entry.context).toBeNull();
  });

  it('reports a missing canvas instead of throwing a type error', () => {
    useFakeOffscreenCanvas();
    const factory = new PdfjsCanvasFactory();
    expect(() => factory.destroy({ canvas: undefined } as never)).toThrow(/Canvas is not specified/);
    expect(() => factory.reset({ canvas: undefined } as never, 1, 1)).toThrow(/Canvas is not specified/);
  });
});

/* -------------------------------------------------------------------------- */

describe('serializeJobError', () => {
  it('keeps the throw site, which is the only copy that survives the worker hop', () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'createElement')");
    const serialized = serializeJobError(error);

    expect(serialized.name).toBe('TypeError');
    expect(serialized.message).toContain('createElement');
    // The stack has to name the frame the error was raised in, not merely exist:
    // a stack captured at the message boundary would point back at the hop and
    // tell us nothing about what actually failed.
    expect(serialized.stack).toContain('render.test.ts');
    expect(serialized.stack?.split('\n').length ?? 0).toBeGreaterThan(1);
  });

  it('truncates a pathological stack rather than posting megabytes', () => {
    const error = new Error('deep');
    error.stack = 'x'.repeat(50_000);
    const serialized = serializeJobError(error);

    expect(serialized.stack).toHaveLength(4001);
    expect(serialized.stack?.endsWith('…')).toBe(true);
  });

  it('keeps validation issues and timeout identity intact', () => {
    const validation = serializeJobError(new JobValidationError('Invalid input', [{ message: 'bad' }]));
    expect(validation.name).toBe('JobValidationError');
    expect(validation.issues).toEqual([{ message: 'bad' }]);
    expect(validation.stack).toBeTruthy();

    const timeout = serializeJobError(new JobTimeoutError(120_000));
    expect(timeout.name).toBe('JobTimeoutError');
    expect(timeout.message).toContain('120');
  });

  it('always produces something structured-cloneable', () => {
    for (const thrown of [new Error('x'), 'a string', 42, null, undefined, { weird: true }]) {
      const serialized = serializeJobError(thrown);
      expect(typeof serialized.name).toBe('string');
      expect(typeof serialized.message).toBe('string');
      // This is what crosses postMessage; a non-cloneable field would throw there
      // and take the whole worker down with it.
      expect(() => structuredClone(serialized)).not.toThrow();
    }
  });
});
