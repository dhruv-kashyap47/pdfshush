/**
 * Page rasterization for redaction, on the same pdf.js worker pipeline the rest
 * of the product renders with.
 *
 * The critical detail: the marks are painted **onto the canvas before encoding**,
 * not drawn over the image afterwards. An image with a black box drawn on top
 * still contains the pixels underneath, and those pixels would ship inside the
 * PDF. Here they are overwritten in the bitmap, so what gets embedded is already
 * clean.
 *
 * Browser-only (needs `OffscreenCanvas`). Where there is no canvas the redaction
 * pipeline reports `rasterize-unavailable` and refuses to export rather than
 * degrading to something weaker.
 */

import { loadPdfForRender } from '../render/pdfjsRuntime.js';
import type { RedactRegion } from './types.js';

export interface RasterizedPage {
  png: Uint8Array;
  /** Page size in points, rotation already applied by the viewport. */
  widthPt: number;
  heightPt: number;
}

export interface Rasterizer {
  rasterize(pageIndex: number, regions: RedactRegion[], dpi: number, fill: string): Promise<RasterizedPage>;
  /** Releases the pdf.js document and its worker. Must always be called. */
  destroy(): Promise<void>;
}

/** `#rrggbb` (or `rrggbb`) → a CSS colour. Falls back to black. */
function cssColour(fill: string): string {
  const hex = fill.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : '#000000';
}

export async function createPdfjsRasterizer(data: Uint8Array, password?: string): Promise<Rasterizer> {
  // One document for the whole run: re-parsing a large PDF per page would be the
  // dominant cost.
  const loaded = await loadPdfForRender(data, { ...(password ? { password } : {}) });
  let destroyed = false;

  return {
    async rasterize(pageIndex, regions, dpi, fill) {
      const page = await loaded.doc.getPage(pageIndex + 1);
      try {
        const scale = dpi / 72;
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.ceil(viewport.width));
        const height = Math.max(1, Math.ceil(viewport.height));

        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('could not acquire a 2D context for rasterization');

        // PDF pages have no background of their own; without this the PNG is
        // transparent and every viewer renders it over black.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);

        await page.render({
          canvas: null,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
          background: '#ffffff',
        }).promise;

        // Burn the marks in. Display-space coordinates map straight onto the
        // viewport — that is the frame pdf.js renders into — so only a scale
        // factor is needed. Floor/ceil so a mark can only ever cover *more*.
        context.fillStyle = cssColour(fill);
        for (const region of regions) {
          context.fillRect(
            Math.floor(region.x * scale),
            Math.floor(region.y * scale),
            Math.ceil(region.width * scale),
            Math.ceil(region.height * scale),
          );
        }

        const blob = await canvas.convertToBlob({ type: 'image/png' });
        const png = new Uint8Array(await blob.arrayBuffer());
        // Zeroing the backing store releases it now rather than at GC
        // convenience; a 200-page run would otherwise hold every bitmap.
        canvas.width = 0;
        canvas.height = 0;

        const unit = page.getViewport({ scale: 1 });
        return { png, widthPt: unit.width, heightPt: unit.height };
      } finally {
        page.cleanup();
      }
    },

    async destroy() {
      // Without this the pdf.js document — and the worker behind it — outlives
      // the redaction for the life of the tab.
      if (destroyed) return;
      destroyed = true;
      await loaded.destroy().catch(() => undefined);
    },
  };
}
