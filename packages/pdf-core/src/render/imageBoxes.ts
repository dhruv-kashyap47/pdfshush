/**
 * Image and stencil-mask boxes for a page, in display space.
 *
 * The text model only knows about glyphs, so a paragraph reflow that grows into
 * a figure was reported as safe -- the figure is not a line and not a table, so
 * nothing in `PageLayout` represented it. pdf.js's operator list does: painting
 * an image composes a transform and fills the unit square, so walking the ops
 * with a CTM stack recovers exactly where each image lands.
 *
 * Only geometry is taken from the operator list; no pixels are decoded and no
 * image data is retained.
 */

import { OPS } from 'pdfjs-dist';
import type { BBox, PageImage } from '../document/types.js';

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `a * b`: applies `b` first, then `a` (pdf.js's `Util.transform` order). */
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function asMatrix(value: unknown): Matrix | null {
  if (!value || typeof value !== 'object' || !('length' in value)) return null;
  const arr = value as ArrayLike<number>;
  if (arr.length !== 6) return null;
  return [arr[0]!, arr[1]!, arr[2]!, arr[3]!, arr[4]!, arr[5]!];
}

function boxOf(m: Matrix): BBox {
  const corners = [
    { x: m[0] * 0 + m[2] * 0 + m[4], y: m[1] * 0 + m[3] * 0 + m[5] },
    { x: m[0] * 1 + m[2] * 0 + m[4], y: m[1] * 1 + m[3] * 0 + m[5] },
    { x: m[0] * 0 + m[2] * 1 + m[4], y: m[1] * 0 + m[3] * 1 + m[5] },
    { x: m[0] * 1 + m[2] * 1 + m[4], y: m[1] * 1 + m[3] * 1 + m[5] },
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function rectBox(m: Matrix, x0: number, y0: number, x1: number, y1: number): BBox {
  const corners = [
    { x: m[0] * x0 + m[2] * y0 + m[4], y: m[1] * x0 + m[3] * y0 + m[5] },
    { x: m[0] * x1 + m[2] * y0 + m[4], y: m[1] * x1 + m[3] * y0 + m[5] },
    { x: m[0] * x0 + m[2] * y1 + m[4], y: m[1] * x0 + m[3] * y1 + m[5] },
    { x: m[0] * x1 + m[2] * y1 + m[4], y: m[1] * x1 + m[3] * y1 + m[5] },
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Operators that fill the current CTM (or an embedded rect) with image data. */
const PAINT_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintSolidColorImageMask,
]);
const MASK_OPS = new Set<number>([
  OPS.paintImageMaskXObject,
  OPS.paintImageMaskXObjectGroup,
  OPS.paintImageMaskXObjectRepeat,
  OPS.paintSolidColorImageMask,
]);

export interface OperatorListLike {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

/**
 * Display-space boxes of every image-like paint on the page.
 *
 * `viewportTransform` is `viewport.transform` for the same viewport the text
 * layer was extracted with, so both frames agree exactly.
 */
export function imageBoxesFromOperatorList(
  opList: OperatorListLike,
  viewportTransform: readonly number[],
): PageImage[] {
  const viewport = asMatrix(viewportTransform);
  if (!viewport) return [];

  const images: PageImage[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;

  const push = (box: BBox, kind: 'image' | 'mask'): void => {
    // Drop degenerate/decorative slivers; they cannot block text meaningfully.
    if (!(box.width > 0.5) || !(box.height > 0.5)) return;
    images.push({ bbox: box, pdfBox: box, kind });
  };

  const { fnArray, argsArray } = opList;
  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index]!;
    const args = argsArray[index];

    if (fn === OPS.save) {
      stack.push(ctm);
      continue;
    }
    if (fn === OPS.restore) {
      ctm = stack.pop() ?? IDENTITY;
      continue;
    }
    if (fn === OPS.transform) {
      const matrix = asMatrix(args);
      if (matrix) ctm = multiply(ctm, matrix);
      continue;
    }

    const kind = MASK_OPS.has(fn) ? 'mask' : 'image';
    if (PAINT_OPS.has(fn)) {
      push(boxOf(multiply(viewport, ctm)), kind);
      continue;
    }
    if (fn === OPS.paintImageXObjectRepeat || fn === OPS.paintImageMaskXObjectRepeat) {
      // args: [objId, scaleX, scaleY, positions[]]
      const list = args as unknown[];
      const scaleX = Number(list?.[1]);
      const scaleY = Number(list?.[2]);
      const positions = list?.[3] as ArrayLike<number> | undefined;
      if (!positions || !Number.isFinite(scaleX) || !Number.isFinite(scaleY)) continue;
      for (let i = 0; i + 1 < positions.length; i += 2) {
        const x = positions[i]!;
        const y = positions[i + 1]!;
        // The repeat is expressed in the CTM's space, so the unit rect scales by
        // (scaleX, scaleY) at each position.
        push(
          rectBox(multiply(viewport, ctm), x, y, x + scaleX, y + scaleY),
          kind,
        );
      }
      continue;
    }
    if (fn === OPS.paintImageMaskXObjectGroup) {
      const entries = (args as unknown[] | undefined)?.[0] as
        | { transform?: unknown }[]
        | undefined;
      if (!entries) continue;
      for (const entry of entries) {
        const matrix = asMatrix(entry.transform);
        if (!matrix) continue;
        push(boxOf(multiply(viewport, multiply(ctm, matrix))), 'mask');
      }
    }
  }

  // Merge exact duplicates: producers often paint the same image twice (a
  // background and a clipped foreground copy).
  const seen = new Set<string>();
  return images.filter((image) => {
    const key = `${Math.round(image.bbox.x)},${Math.round(image.bbox.y)},${Math.round(
      image.bbox.width,
    )},${Math.round(image.bbox.height)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
