/**
 * Page-level geometric transforms -- Flip PDF and Resize PDF.
 *
 * Both transforms rebuild every page as an embedded copy redrawn under a
 * transformation matrix: the source content stays fully vector (text stays
 * selectable, images keep their resolution), and the matrix does the work.
 * Verified against the emitted operators: a horizontal flip produces
 * `q 1 0 0 1 <w> 0 cm -1 0 0 1 0 0 cm /Form Do Q` -- an exact mirror inside
 * the page box.
 *
 * Embedding detail discovered in prototyping: `embedPage` throws
 * "Can't embed page with missing Contents" on a page with no content stream
 * at all. A blank page is geometrically identical under any mirror or
 * resize, so those pages are rebuilt as genuinely blank replacements and
 * never touch the embedder.
 */

import { degrees, PDFDocument, type PDFPage } from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';

interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A page has no own content until /Contents exists (pdf-lib fills it lazily on draw). */
function hasDirectContents(page: PDFPage): boolean {
  return page.node.Contents() !== undefined;
}

/**
 * The box the viewer displays: CropBox with a MediaBox fallback. Content is
 * embedded relative to this box's origin, exactly like split-in-half maths.
 */
function embeddedBox(page: PDFPage): PageBox {
  const crop = page.getCropBox();
  const media = page.getSize();
  return {
    x: crop.x,
    y: crop.y,
    width: crop.width || media.width,
    height: crop.height || media.height,
  };
}

function normalisedRotation(page: PDFPage): number {
  return ((page.getRotation().angle % 360) + 360) % 360;
}

export type FlipAxis = 'horizontal' | 'vertical';

/**
 * Mirrors pages in place (the document must already be composed or loaded).
 * `perPage[i]` is the flip for output page i in DISPLAY space -- the axis is
 * translated into the page's unrotated frame so it behaves like the on-screen
 * flip the user performs, exactly as the rotate override does.
 *
 * Replacements are appended and originals removed after the loop, so page
 * indexes stay stable while iterating.
 */
export async function mirrorPages(
  doc: PDFDocument,
  perPage: (FlipAxis | null)[],
  ctx: JobContext,
): Promise<void> {
  const progress = createProgressReporter(ctx);
  const pages = doc.getPages();

  for (let i = 0; i < pages.length; i += 1) {
    ctx.throwIfAborted();
    const axis = perPage[i] ?? null;
    const page = pages[i]!;
    const box = embeddedBox(page);
    const rotation = normalisedRotation(page);

    let axisFlip: FlipAxis | null = axis;
    if (axisFlip && rotation % 180 === 90) {
      // On a sideways page the display axes swap: flipping horizontally on
      // screen mirrors the unrotated content vertically (and vice versa).
      axisFlip = axisFlip === 'horizontal' ? 'vertical' : 'horizontal';
    }

    const replacement = doc.addPage([box.width, box.height]);
    if (axisFlip && hasDirectContents(page)) {
      const embedded = await doc.embedPage(page, {
        left: box.x,
        bottom: box.y,
        right: box.x + box.width,
        top: box.y + box.height,
      });
      replacement.drawPage(
        embedded,
        axisFlip === 'horizontal'
          ? { x: box.width, y: 0, xScale: -1, yScale: 1 }
          : { x: 0, y: box.height, xScale: 1, yScale: -1 },
      );
    }
    if (rotation !== 0) replacement.setRotation(degrees(rotation));
    progress.step(i, pages.length, 'Flipping pages');
  }

  for (let i = pages.length - 1; i >= 0; i -= 1) {
    doc.removePage(i);
  }
}

export type ResizeRequest =
  | { kind: 'preset'; preset: 'a4' | 'letter' }
  | { kind: 'percent'; percent: number };

export interface ResizePlan {
  /** Output box width/height in points. */
  width: number;
  height: number;
  /** Uniform scale from source to output. */
  scale: number;
}

/** Resolve a resize request into an exact plan for one page. */
export function planResize(box: { width: number; height: number }, request: ResizeRequest): ResizePlan {
  const target =
    request.kind === 'percent'
      ? { width: (box.width * request.percent) / 100, height: (box.height * request.percent) / 100 }
      : request.preset === 'a4'
        ? { width: 595.28, height: 841.89 }
        : { width: 612, height: 792 };
  // Uniform scale keeps the aspect ratio; the result is centred. For paper
  // sizes this is "fit", so a small page scales up to the sheet.
  const scale = Math.min(target.width / box.width, target.height / box.height);
  return { width: target.width, height: target.height, scale };
}

/**
 * Rescales every page to its own plan (uniform scale, centred). Content is
 * embedded and redrawn -- vectors preserved, page boxes exact.
 */
export async function resizePages(
  doc: PDFDocument,
  plans: ResizePlan[],
  ctx: JobContext,
): Promise<void> {
  const progress = createProgressReporter(ctx);
  const pages = doc.getPages();

  for (let i = 0; i < pages.length; i += 1) {
    ctx.throwIfAborted();
    const plan = plans[i]!;
    const page = pages[i]!;
    const box = embeddedBox(page);
    const replacement = doc.addPage([plan.width, plan.height]);
    if (hasDirectContents(page)) {
      const embedded = await doc.embedPage(page, {
        left: box.x,
        bottom: box.y,
        right: box.x + box.width,
        top: box.y + box.height,
      });
      const drawWidth = box.width * plan.scale;
      const drawHeight = box.height * plan.scale;
      replacement.drawPage(embedded, {
        x: (plan.width - drawWidth) / 2,
        y: (plan.height - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      });
    }
    const rotation = normalisedRotation(page);
    if (rotation !== 0) replacement.setRotation(degrees(rotation));
    progress.step(i, pages.length, 'Resizing pages');
  }

  for (let i = pages.length - 1; i >= 0; i -= 1) {
    doc.removePage(i);
  }
}
