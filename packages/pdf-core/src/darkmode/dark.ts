/**
 * Dark-mode conversion -- Dark Mode PDF.
 *
 * There is no honest client-side way to rewrite only the colour operators of
 * arbitrary content streams (inline images, shadings, patterns and nested
 * XObjects all carry colour). So the pages are rasterized on the pdf.js
 * pipeline the rest of the product renders with, the pixels are remapped in
 * place (see `darkModes.ts`), and a fresh document is rebuilt from the JPEGs.
 *
 * That is the same contract grayscale and secure redaction already make and
 * disclose: the output is flat images -- text is no longer selectable. The UI
 * says so before the user confirms, and the job refuses more pages than the
 * rasterize-rebuild ceiling redaction uses.
 *
 * The per-pixel transforms live in the import-free `darkModes.ts` so the
 * main-thread preview and this engine agree to the byte.
 *
 * Browser-only: without a 2D context the conversion reports unavailable and
 * refuses rather than degrading. The transforms themselves are pure and
 * unit-tested in Node.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import { applyDarkModeRgba, darkModeTheme, type DarkModeKind, type DarkModeThemeId } from './darkModes.js';
import { createProgressReporter, type JobContext } from '../job.js';
import { LIMITS } from '../limits.js';
import { loadPdfForRender } from '../render/pdfjsRuntime.js';
import { renderPageToCanvas } from '../render/renderPage.js';

export interface DarkModeOptions {
  /** Transform kind: the theme remap, the hue-preserving invert, or plain invert. */
  kind?: DarkModeKind;
  /** Background theme id, used only when `kind` is `theme`. */
  themeId?: DarkModeThemeId;
  /** Render width in pixels. Defaults to the product's image width. */
  targetWidthPx?: number;
  /** JPEG quality, 0.3..1. Defaults to 0.9. */
  quality?: number;
}

export interface DarkModeResult {
  data: Uint8Array;
  pageCount: number;
}

export async function darkModeDocument(
  data: Uint8Array,
  options: DarkModeOptions,
  ctx: JobContext,
  password?: string,
): Promise<DarkModeResult> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('Dark mode conversion needs this browser to run; it cannot run without a canvas');
  }

  const kind: DarkModeKind = options.kind ?? 'theme';
  const theme = darkModeTheme(options.themeId ?? 'ink');
  const loaded = await loadPdfForRender(data, { ...(password ? { password } : {}) });
  const progress = createProgressReporter(ctx);
  const quality = Math.min(1, Math.max(0.3, options.quality ?? 0.9));
  const targetWidthPx = Math.min(
    Math.max(320, Math.round(options.targetWidthPx ?? LIMITS.tool.defaultImageWidthPx)),
    4000,
  );

  try {
    const out = await PDFDocument.create();
    const total = loaded.doc.numPages;
    if (total > LIMITS.tool.maxRedactPages) {
      throw new Error(
        `That document has ${total} pages; dark mode rebuilds each page as an image and the limit is ${LIMITS.tool.maxRedactPages}. Split it first.`,
      );
    }

    for (let index = 1; index <= total; index += 1) {
      ctx.throwIfAborted();
      const page = await loaded.doc.getPage(index);
      const rendered = await renderPageToCanvas(page, { targetWidthPx, format: 'jpeg' });
      const unit = page.getViewport({ scale: 1 });
      const { canvas, context } = rendered;

      const imageData = context.getImageData(0, 0, rendered.width, rendered.height);
      applyDarkModeRgba(imageData.data, kind, theme);
      context.putImageData(imageData, 0, 0);

      const blob = await canvas.toBlob('image/jpeg', quality);
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      await out.embedJpg(jpeg);
      out.addPage([unit.width, unit.height]);
      page.cleanup();

      // Zero the backing store now rather than at GC convenience; a 150-page
      // run would otherwise hold every bitmap at once.
      canvas.release?.();
      progress.step(index - 1, total, `Converting page ${index} of ${total}`);
    }

    const bytes = await out.save({ useObjectStreams: false });
    return { data: bytes, pageCount: total };
  } finally {
    await loaded.destroy();
  }
}
