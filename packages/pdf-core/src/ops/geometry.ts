/**
 * Display-space geometry -- the coordinate system of the editor.
 *
 * The UI works in *display space*: origin at the top-left of the page as the
 * user sees it, y down, in PDF points at 100% zoom, with the page's /Rotate
 * applied. Every overlay object, text run and form-widget rectangle crosses
 * the job boundary in this space, so the React side never does PDF math and
 * this module owns the single conversion in both directions.
 *
 * The visible box is CropBox ∩ MediaBox (what pdf.js renders); rotation is
 * rounded to the nearest quarter turn because the mapping is axis-aligned.
 */

import type { PDFPage } from '@cantoo/pdf-lib';

export interface PageGeom {
  /** Visible box in PDF user space (y up): [x0,y0] lower-left, [x1,y1] upper-right. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Normalized /Rotate: 0 | 90 | 180 | 270. */
  rot: 0 | 90 | 180 | 270;
}

export interface DisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Geometry of an open page: visible box ∩ media box, rotation normalized. */
export function pageGeom(page: PDFPage): PageGeom {
  return geomFromBoxes(page.getCropBox(), page.getRotation().angle, page.getMediaBox());
}

/** Same, from raw boxes -- kept separate so tests and inspect can build a geom without a page. */
export function geomFromBoxes(cropBox: Box, rotation: number, mediaBox?: Box): PageGeom {
  let x0 = cropBox.x;
  let y0 = cropBox.y;
  let x1 = cropBox.x + cropBox.width;
  let y1 = cropBox.y + cropBox.height;
  if (mediaBox) {
    // pdf.js intersects CropBox with MediaBox; a CropBox wider than the media
    // box would otherwise make us map coordinates no viewer ever shows.
    x0 = Math.max(x0, mediaBox.x);
    y0 = Math.max(y0, mediaBox.y);
    x1 = Math.min(x1, mediaBox.x + mediaBox.width);
    y1 = Math.min(y1, mediaBox.y + mediaBox.height);
  }
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  const rounded = Math.round(rotation / 90) * 90;
  const rot = (((rounded % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  return { x0, y0, x1, y1, rot };
}

/** Page size as displayed (width/height swap on 90°/270° pages). */
export function displaySize(g: PageGeom): { width: number; height: number } {
  const width = g.x1 - g.x0;
  const height = g.y1 - g.y0;
  return g.rot % 180 === 0 ? { width, height } : { width: height, height: width };
}

/** Display coords (top-left, y down) → PDF user space (y up). */
export function viewToPdf(g: PageGeom, vx: number, vy: number): [number, number] {
  const pw = g.x1 - g.x0;
  const ph = g.y1 - g.y0;
  switch (g.rot) {
    case 90:
      return [g.x0 + vy, g.y0 + vx];
    case 180:
      return [g.x0 + pw - vx, g.y0 + vy];
    case 270:
      return [g.x0 + pw - vy, g.y0 + ph - vx];
    default:
      return [g.x0 + vx, g.y1 - vy];
  }
}

/** PDF user space → display coords (top-left, y down). */
export function pdfToView(g: PageGeom, x: number, y: number): [number, number] {
  const ox = x - g.x0;
  const oy = y - g.y0;
  const pw = g.x1 - g.x0;
  const ph = g.y1 - g.y0;
  switch (g.rot) {
    case 90:
      return [oy, ox];
    case 180:
      return [pw - ox, oy];
    case 270:
      return [ph - oy, pw - ox];
    default:
      return [ox, g.y1 - y];
  }
}

/**
 * A display-space rect (y down) → a normalized PDF-space box (y up).
 * Both corners are mapped first, so the result is correct on rotated pages.
 */
export function viewRectToPdf(g: PageGeom, rect: DisplayRect): Box {
  const [ax, ay] = viewToPdf(g, rect.x, rect.y);
  const [bx, by] = viewToPdf(g, rect.x + rect.width, rect.y + rect.height);
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  return { x, y, width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

/** A PDF-space box → display rect. */
export function pdfRectToView(g: PageGeom, box: Box): DisplayRect {
  const [ax, ay] = pdfToView(g, box.x, box.y);
  const [bx, by] = pdfToView(g, box.x + box.width, box.y + box.height);
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  return { x, y, width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}
