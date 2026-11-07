/**
 * Render resource hygiene: the rendered canvas must be released when the page
 * is encoded (successful or not), and the page proxy's cleanup must run even
 * when a page render throws. Without either, one failing page in a multi-page
 * run pins its bitmap and operator list for the rest of the run.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({ cleanups: [] as number[] }));

vi.mock('../src/render/pdfjsRuntime.js', () => ({
  loadPdfForRender: async () => {
    const makePage = (n: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 595 * scale,
        height: 842 * scale,
      }),
      render: () => ({ promise: Promise.resolve() }),
      cleanup: () => {
        spies.cleanups.push(n);
      },
    });
    return {
      doc: {
        numPages: 2,
        getPage: async (n: number) => makePage(n),
      },
      destroy: async () => undefined,
    };
  },
}));

import { renderPageToImage, renderPages } from '../src/render/renderPage.js';
import { testContext } from './fixtures.js';
import type { CanvasFactory, RenderCanvas } from '../src/render/canvas.js';

function makeFactory(failEncodeFrom = Infinity) {
  const releases: number[] = [];
  let encodes = 0;
  const factory: CanvasFactory = (width: number, height: number): RenderCanvas => {
    return {
      width,
      height,
      context: {
        fillStyle: null,
        fillRect: () => undefined,
      },
      toBlob: async () => {
        encodes += 1;
        if (encodes >= failEncodeFrom) throw new Error('encode boom');
        return new Blob([new Uint8Array([1, 2, 3])]);
      },
      release: () => {
        releases.push(1);
      },
    };
  };
  return { factory, releases };
}

/** A minimal page double: only the surface renderPage.ts touches. */
function fakePage(n = 1): unknown {
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 595 * scale,
      height: 842 * scale,
    }),
    render: () => ({ promise: Promise.resolve() }),
    cleanup: () => {
      spies.cleanups.push(n);
    },
  };
}

beforeEach(() => {
  spies.cleanups.length = 0;
});

describe('renderPageToImage', () => {
  it('returns encoded bytes and releases the canvas afterwards', async () => {
    const { factory, releases } = makeFactory();
    const image = (await renderPageToImage(fakePage(1) as never, {
      targetWidthPx: 200,
      format: 'jpeg',
      quality: 0.8,
      canvasFactory: factory,
    })) as { width: number; height: number };

    expect(image.width).toBe(200);
    expect(image.height).toBeGreaterThan(0);
    expect(releases.length).toBe(1);
    expect(spies.cleanups).toEqual([]); // cleanup is the caller's business
  });

  it('still releases the canvas when encoding fails', async () => {
    const { factory, releases } = makeFactory(1); // every encode fails
    await expect(
      renderPageToImage(fakePage(1) as never, {
        targetWidthPx: 200,
        format: 'png',
        canvasFactory: factory,
      }),
    ).rejects.toThrow(/encode boom/);
    // The fix: a failed encode must not leave the bitmap alive until GC.
    expect(releases.length).toBe(1);
  });
});

describe('renderPages', () => {
  it('cleans every page proxy, including the page that fails to render', async () => {
    // The second page's encode fails; page 1 must still have been released.
    const { factory, releases } = makeFactory(2);
    await expect(
      renderPages(
        new Uint8Array(0),
        {
          pageIndexes: [0, 1],
          targetWidthPx: 200,
          format: 'jpeg',
          canvasFactory: factory,
        },
        testContext(),
      ),
    ).rejects.toThrow(/encode boom/);

    // The fix: cleanup runs in a finally, so page 2's proxy does not leak.
    expect(spies.cleanups).toEqual([1, 2]);
    // The fix: both canvases are released -- page 1 on success, page 2 in the
    // finally before its error propagates.
    expect(releases.length).toBe(2);
  });

  it('cleans every page on a fully successful run', async () => {
    const { factory, releases } = makeFactory();
    const pages = await renderPages(
      new Uint8Array(0),
      {
        pageIndexes: [0, 1],
        targetWidthPx: 200,
        format: 'jpeg',
        canvasFactory: factory,
      },
      testContext(),
    );
    expect(pages).toHaveLength(2);
    expect(spies.cleanups).toEqual([1, 2]);
    expect(releases.length).toBe(2);
  });
});
