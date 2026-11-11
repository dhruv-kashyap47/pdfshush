/**
 * Render-budget regressions for one page raster.
 *
 * `renderPageToCanvas` used to pick its scale as `min(8, targetWidth / width)`
 * and then refuse anything whose longest side exceeded the edge limit. Two
 * real documents fell through that gap:
 *
 *  - a 600x6000 pt page at the export presets (1600 / 2560 px) asked for an
 *    8192+ px tall bitmap and threw, so the page was never produced;
 *  - a 5000x5000 pt page passed the edge test but allocated a 64 MP canvas,
 *    which iOS/Safari caps at ~16.7 MP and paints blank;
 *  - a 250 pt wide page at the 2560 px preset hit `scaleForWidth`'s 8x cap and
 *    silently delivered 2000 px instead of the requested width.
 *
 * The scale is now the largest one that honours the requested width *and* fits
 * both the edge and area budgets. These tests pin the arithmetic and the two
 * former failures.
 */

import { describe, expect, it } from 'vitest';

import { fitScaleToBudget } from '../src/render/canvas.js';
import { renderPageToCanvas } from '../src/render/renderPage.js';
import { LIMITS } from '../src/limits.js';
import type { CanvasFactory, RenderCanvas } from '../src/render/canvas.js';

const BUDGET = {
  maxEdgePx: LIMITS.tool.maxRenderEdgePx,
  maxAreaPx: LIMITS.tool.maxRenderAreaPx,
};

/** Records the bitmap it was asked for without allocating one. */
function recordingFactory() {
  const sizes: { width: number; height: number }[] = [];
  const factory: CanvasFactory = (width, height): RenderCanvas => {
    sizes.push({ width, height });
    return {
      width,
      height,
      context: {
        fillStyle: null,
        fillRect: () => undefined,
      },
      toBlob: async () => new Blob([new Uint8Array([1])]),
      release: () => undefined,
    };
  };
  return { factory, sizes };
}

/** A page double exposing exactly what renderPageToCanvas reads. */
function fakePage(widthPt: number, heightPt: number): never {
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      width: widthPt * scale,
      height: heightPt * scale,
    }),
    render: () => ({ promise: Promise.resolve() }),
    cleanup: () => undefined,
  } as never;
}

async function renderedSize(widthPt: number, heightPt: number, targetWidthPx: number) {
  const { factory, sizes } = recordingFactory();
  await renderPageToCanvas(fakePage(widthPt, heightPt), {
    targetWidthPx,
    format: 'jpeg',
    canvasFactory: factory,
  });
  expect(sizes).toHaveLength(1);
  return sizes[0]!;
}

describe('fitScaleToBudget', () => {
  it('honours the requested scale while the page fits', () => {
    const fitted = fitScaleToBudget(595, 842, 2, BUDGET);
    expect(fitted).toEqual({ scale: 2, width: 1190, height: 1684 });
  });

  it('reduces the scale instead of exceeding the edge budget', () => {
    // 600x6000 at 1600px wide would be 1600x16000: taller than any canvas.
    const fitted = fitScaleToBudget(600, 6000, 1600 / 600, BUDGET);
    expect(fitted.height).toBeLessThanOrEqual(BUDGET.maxEdgePx);
    expect(fitted.width).toBe(819);
    expect(fitted.height).toBe(8192);
    // Aspect ratio is preserved to within one pixel of rounding.
    expect(fitted.height / fitted.width).toBeCloseTo(10, 1);
  });

  it('reduces the scale instead of exceeding the area budget', () => {
    // 5000x5000 at 8000px wide is 64 MP; iOS/Safari paints that blank.
    const fitted = fitScaleToBudget(5000, 5000, 8000 / 5000, BUDGET);
    expect(fitted.width * fitted.height).toBeLessThanOrEqual(BUDGET.maxAreaPx);
    expect(fitted.width).toBe(4096);
    expect(fitted.height).toBe(4096);
  });

  it('leaves a page narrower than the scale cap at its requested width', () => {
    // 250pt wide at a 2560px request is a 10.24x scale. The old 8x cap
    // delivered 2000px while the UI said 2560.
    const fitted = fitScaleToBudget(250, 350, 2560 / 250, BUDGET);
    expect(fitted.width).toBe(2560);
    expect(fitted.height).toBe(3584);
  });

  it('never returns a zero or non-finite size for degenerate input', () => {
    for (const [w, h, scale] of [
      [0, 0, 1],
      [Number.NaN, 842, 1],
      [595, Number.POSITIVE_INFINITY, 1],
      [595, 842, Number.NaN],
      [595, 842, 0],
      [595, 842, -2],
    ] as const) {
      const fitted = fitScaleToBudget(w, h, scale, BUDGET);
      expect(fitted.width).toBeGreaterThanOrEqual(1);
      expect(fitted.height).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(fitted.scale)).toBe(true);
      expect(fitted.scale).toBeGreaterThan(0);
    }
  });
});

describe('renderPageToCanvas budget', () => {
  it('renders a tall page at the presets instead of refusing it', async () => {
    const size = await renderedSize(600, 6000, 1600);
    expect(size.width).toBe(819);
    expect(size.height).toBe(8192);
    // Covered by the same call: the page really was painted.
    expect(size.width * size.height).toBeLessThanOrEqual(BUDGET.maxAreaPx);
  });

  it('renders a tall page at the print preset too', async () => {
    const size = await renderedSize(600, 6000, 2560);
    expect(size.width).toBe(819);
    expect(size.height).toBe(8192);
  });

  it('keeps a large square page inside the iOS canvas area', async () => {
    const size = await renderedSize(5000, 5000, 8000);
    expect(size.width * size.height).toBeLessThanOrEqual(BUDGET.maxAreaPx);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(BUDGET.maxEdgePx);
  });

  it('does not change an ordinary page', async () => {
    expect(await renderedSize(595, 842, 1190)).toEqual({ width: 1190, height: 1684 });
    expect(await renderedSize(612, 792, 1600)).toEqual({ width: 1600, height: 2070 });
  });
});
