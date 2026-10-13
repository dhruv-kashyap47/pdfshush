/**
 * Display-space rectangles, and the small amount of box arithmetic redaction
 * needs.
 *
 * Regions arrive in the same display space the editor already uses (top-left
 * origin, y down, /Rotate applied), which is also the frame pdf.js renders into
 * — so a region maps straight onto a rendered bitmap with a single scale factor
 * and no rotation maths of its own.
 */

/** A half-open box. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function boxesIntersect(a: Box, b: Box, eps = 0): boolean {
  return a.x0 < b.x1 + eps && a.x1 > b.x0 - eps && a.y0 < b.y1 + eps && a.y1 > b.y0 - eps;
}

export function boxContains(outer: Box, inner: Box, eps = 0.5): boolean {
  return (
    inner.x0 >= outer.x0 - eps &&
    inner.x1 <= outer.x1 + eps &&
    inner.y0 >= outer.y0 - eps &&
    inner.y1 <= outer.y1 + eps
  );
}

export function boxArea(box: Box): number {
  return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);
}

export function intersectionArea(a: Box, b: Box): number {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

/** Fraction of `inner` covered by `outer`. */
export function coverageOf(outer: Box, inner: Box): number {
  const area = boxArea(inner);
  if (area <= 0) return 0;
  return intersectionArea(outer, inner) / area;
}
