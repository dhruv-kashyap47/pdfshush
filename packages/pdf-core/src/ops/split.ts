/**
 * Split-in-half -- cuts every page down the middle into two documents.
 *
 * Implemented by tightening each copied page's MediaBox/CropBox: content outside
 * the visible box is clipped by every conforming viewer, so no rasterisation is
 * needed and the result stays fully vector (text remains selectable).
 *
 * Coordinates are in the page's own (unrotated) space. Documents with /Rotate
 * 90/270 still produce valid output; the cut follows the page geometry rather
 * than the displayed orientation, which matches the rare real-world case of
 * rotated scans being the exception, not the rule.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import type { JobContext } from '../job.js';
import { createProgressReporter } from '../job.js';
import { loadPdfDocument } from './pages.js';
import type { SourceDocument } from './compose.js';

export type SplitOrientation = 'vertical' | 'horizontal';

export interface SplitHalfResult {
  /** Left half (vertical) or top half (horizontal). */
  first: Uint8Array;
  /** Right half (vertical) or bottom half (horizontal). */
  second: Uint8Array;
  firstLabel: 'left' | 'top';
  secondLabel: 'right' | 'bottom';
  pageCount: number;
}

interface HalfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function splitPagesInHalf(
  source: SourceDocument,
  orientation: SplitOrientation,
  ctx: JobContext,
): Promise<SplitHalfResult> {
  const progress = createProgressReporter(ctx);
  progress.report('Opening document', 0.02);

  const src = await loadPdfDocument(source.data, { password: source.password });
  const pageCount = src.getPageCount();

  const firstDoc = await PDFDocument.create();
  const secondDoc = await PDFDocument.create();

  const labels =
    orientation === 'vertical'
      ? { firstLabel: 'left' as const, secondLabel: 'right' as const }
      : { firstLabel: 'top' as const, secondLabel: 'bottom' as const };

  for (let i = 0; i < pageCount; i += 1) {
    ctx.throwIfAborted();
    const page = src.getPage(i);
    const { width, height } = page.getSize();
    const halves: { first: HalfBox; second: HalfBox } =
      orientation === 'vertical'
        ? {
            first: { x: 0, y: 0, width: width / 2, height },
            second: { x: width / 2, y: 0, width: width / 2, height },
          }
        : {
            first: { x: 0, y: height / 2, width, height: height / 2 },
            second: { x: 0, y: 0, width, height: height / 2 },
          };

    const [firstCopy] = await firstDoc.copyPages(src, [i]);
    const [secondCopy] = await secondDoc.copyPages(src, [i]);
    if (!firstCopy || !secondCopy) throw new Error(`Could not copy page ${i + 1}`);
    applyBox(firstCopy, halves.first);
    applyBox(secondCopy, halves.second);
    firstDoc.addPage(firstCopy);
    secondDoc.addPage(secondCopy);
    progress.step(i, pageCount, 'Cutting pages');
  }

  progress.report('Writing files', 0.97);
  return {
    first: await firstDoc.save({ useObjectStreams: false }),
    second: await secondDoc.save({ useObjectStreams: false }),
    ...labels,
    pageCount,
  };
}

/** Tightens both boxes so viewers with no CropBox fall back to MediaBox. */
function applyBox(page: { setMediaBox(x: number, y: number, w: number, h: number): unknown; setCropBox(x: number, y: number, w: number, h: number): unknown }, box: HalfBox): void {
  page.setMediaBox(box.x, box.y, box.width, box.height);
  page.setCropBox(box.x, box.y, box.width, box.height);
}
