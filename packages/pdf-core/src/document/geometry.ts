/**
 * The one coordinate engine.
 *
 * Three frames exist in this product:
 *
 *   PDF       -- user space, y up, origin at the page's lower-left.
 *   view      -- display space, top-left origin, y down, in points at 100 %
 *                zoom. This is the frame the model and overlay use.
 *   screen    -- CSS pixels relative to a page element (zoom and device pixel
 *                ratio applied). This is the frame pointer events arrive in.
 *
 * Every conversion goes through this module. The overlay, hit testing, caret
 * placement and export all consume the same maths, so a selection cannot drift
 * from the raster when the page is rotated, cropped or zoomed.
 *
 * The PDF↔view formulas are shared with `ops/geometry.ts` (the export path);
 * this class only adds the view↔screen and matrix layers, plus the geometric
 * primitives the tree builder needs.
 */

import {
  displaySize,
  geomFromBoxes,
  pdfRectToView,
  pdfToView,
  viewRectToPdf,
  viewToPdf,
  type PageGeom,
} from '../ops/geometry.js';
import type { BBox, Point, Quad } from './types.js';

/** Affine matrix `[a, b, c, d, e, f]`, the PDF/Canvas convention. */
export type Matrix = readonly [number, number, number, number, number, number];

export interface PageBoxes {
  /** MediaBox: x, y, width, height in PDF user space. */
  mediaBox: BBox;
  cropBox?: BBox;
  /** /Rotate in degrees; any multiple of 90 is normalised. */
  rotation?: number;
}

export interface ViewTransform {
  /** CSS pixels per point. */
  zoom: number;
  /** Canvas backing-store ratio; only affects device-pixel helpers. */
  devicePixelRatio?: number;
}

/** Client rect of the page element; mirrors the DOMRect fields we need. */
export interface ElementRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function normalizeAngle(degrees: number): number {
  const value = ((degrees % 360) + 360) % 360;
  // Collapse -0 and 360 to 0 so direction checks stay simple.
  return value === 360 ? 0 : value;
}

export function normalizeRotation(degrees: number): 0 | 90 | 180 | 270 {
  return (Math.round(degrees / 90) * 90) as 0 | 90 | 180 | 270;
}

export function applyMatrix(matrix: Matrix, point: Point): Point {
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * point.x + c * point.y + e,
    y: b * point.x + d * point.y + f,
  };
}

/** `first` then `second` (PDF's row-vector convention). */
export function multiplyMatrices(first: Matrix, second: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

/** Baseline angle of a text matrix, in degrees clockwise from +x. */
export function matrixRotation(matrix: Matrix): number {
  return normalizeAngle((Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI);
}

export class PageGeometry {
  readonly geom: PageGeom;

  constructor(boxes: PageBoxes) {
    const media = boxes.mediaBox;
    this.geom = geomFromBoxes(
      boxes.cropBox ?? media,
      boxes.rotation ?? 0,
      media,
    );
  }

  static fromGeom(geom: PageGeom): PageGeometry {
    return Object.assign(Object.create(PageGeometry.prototype), { geom }) as PageGeometry;
  }

  get rotation(): 0 | 90 | 180 | 270 {
    return this.geom.rot;
  }

  get x0(): number {
    return this.geom.x0;
  }

  get y0(): number {
    return this.geom.y0;
  }

  get x1(): number {
    return this.geom.x1;
  }

  get y1(): number {
    return this.geom.y1;
  }

  /** Displayed size in points (rotated pages swap width/height). */
  get size(): { width: number; height: number } {
    return displaySize(this.geom);
  }

  pdfToView(point: Point): Point {
    const [x, y] = pdfToView(this.geom, point.x, point.y);
    return { x, y };
  }

  viewToPdf(point: Point): Point {
    const [x, y] = viewToPdf(this.geom, point.x, point.y);
    return { x, y };
  }

  pdfRectToView(rect: BBox): BBox {
    return pdfRectToView(this.geom, rect);
  }

  viewRectToPdf(rect: BBox): BBox {
    return viewRectToPdf(this.geom, rect);
  }

  /** View points → CSS pixels relative to the page element. */
  viewToScreen(point: Point, view: ViewTransform): Point {
    return { x: point.x * view.zoom, y: point.y * view.zoom };
  }

  /** CSS pixels relative to the page element → view points. */
  screenToView(point: Point, view: ViewTransform): Point {
    return { x: point.x / view.zoom, y: point.y / view.zoom };
  }

  /** Client coordinates → view points, using the page element's client rect. */
  clientToView(client: Point, element: ElementRect, view: ViewTransform): Point {
    return {
      x: (client.x - element.left) / view.zoom,
      y: (client.y - element.top) / view.zoom,
    };
  }

  viewToClient(point: Point, element: ElementRect, view: ViewTransform): Point {
    return {
      x: element.left + point.x * view.zoom,
      y: element.top + point.y * view.zoom,
    };
  }

  rectToScreen(rect: BBox, view: ViewTransform): BBox {
    return {
      x: rect.x * view.zoom,
      y: rect.y * view.zoom,
      width: rect.width * view.zoom,
      height: rect.height * view.zoom,
    };
  }

  /** Size of the page element at this zoom (CSS pixels). */
  screenSize(view: ViewTransform): { width: number; height: number } {
    const size = this.size;
    return { width: size.width * view.zoom, height: size.height * view.zoom };
  }

  /** Backing-store size for a canvas at this zoom and DPR. */
  deviceSize(view: ViewTransform): { width: number; height: number } {
    const dpr = view.devicePixelRatio ?? 1;
    const size = this.size;
    return {
      width: Math.max(1, Math.round(size.width * view.zoom * dpr)),
      height: Math.max(1, Math.round(size.height * view.zoom * dpr)),
    };
  }
}

/* ------------------------------------------------------------- primitives */

export function normalizeBBox(box: BBox): BBox {
  const x = Math.min(box.x, box.x + box.width);
  const y = Math.min(box.y, box.y + box.height);
  return {
    x,
    y,
    width: Math.abs(box.width),
    height: Math.abs(box.height),
  };
}

export function bboxFromPoints(points: readonly Point[]): BBox {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function quadFromPoints(points: readonly [Point, Point, Point, Point]): Quad {
  return { p0: points[0], p1: points[1], p2: points[2], p3: points[3] };
}

export function bboxFromQuad(quad: Quad): BBox {
  return bboxFromPoints([quad.p0, quad.p1, quad.p2, quad.p3]);
}

export function unionBBoxes(boxes: readonly BBox[]): BBox {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function expandBBox(box: BBox, amount: number): BBox {
  return {
    x: box.x - amount,
    y: box.y - amount,
    width: box.width + amount * 2,
    height: box.height + amount * 2,
  };
}

export function bboxArea(box: BBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

export function bboxCenter(box: BBox): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function bboxContainsPoint(box: BBox, point: Point, tolerance = 0): boolean {
  return (
    point.x >= box.x - tolerance &&
    point.x <= box.x + box.width + tolerance &&
    point.y >= box.y - tolerance &&
    point.y <= box.y + box.height + tolerance
  );
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function intersectBBox(a: BBox, b: BBox): BBox | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** Distance from a point to a box (0 when inside). */
export function bboxDistance(box: BBox, point: Point): number {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

/** Even-odd point-in-polygon; used for rotated glyph quads. */
export function pointInQuad(quad: Quad, point: Point, tolerance = 0): boolean {
  const corners = [quad.p0, quad.p1, quad.p2, quad.p3];
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
    const a = corners[i]!;
    const b = corners[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside || bboxContainsPoint(bboxFromQuad(quad), point, tolerance);
}

/** Projects a point onto a unit direction and its normal. */
export function projectPoint(point: Point, rotationDeg: number): { advance: number; cross: number } {
  const radians = (normalizeAngle(rotationDeg) * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  return {
    advance: point.x * dx + point.y * dy,
    cross: -point.x * dy + point.y * dx,
  };
}

export function directionOfRotation(rotationDeg: number): 'ltr' | 'rtl' | 'ttb' {
  const angle = normalizeAngle(rotationDeg);
  if (angle > 45 && angle < 135) return 'ttb';
  if (angle >= 135 && angle <= 225) return 'rtl';
  return 'ltr';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/* ------------------------------------------------------------ spatial grid */

export interface SpatialItem {
  bbox: BBox;
}

/**
 * Uniform grid over a page. Text pages are extremely uneven (a huge paragraph
 * next to dozens of small words), so cells are reused rather than a BVH: the
 * win is eliminating the full scan per pointer move, not optimal packing.
 */
export class SpatialGrid<T extends SpatialItem> {
  private readonly cells = new Map<string, T[]>();
  private readonly items: T[] = [];
  readonly cellSize: number;
  /** Candidate items examined by the last query -- a diagnostic for tests. */
  lastCandidates = 0;

  constructor(items: readonly T[] = [], cellSize = 64) {
    this.cellSize = Math.max(8, cellSize);
    for (const item of items) this.insert(item);
  }

  get size(): number {
    return this.items.length;
  }

  get all(): readonly T[] {
    return this.items;
  }

  insert(item: T): void {
    this.items.push(item);
    const { x, y, width, height } = item.bbox;
    const x0 = Math.floor(x / this.cellSize);
    const y0 = Math.floor(y / this.cellSize);
    const x1 = Math.floor((x + Math.max(0, width)) / this.cellSize);
    const y1 = Math.floor((y + Math.max(0, height)) / this.cellSize);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const key = `${cx},${cy}`;
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(item);
        else this.cells.set(key, [item]);
      }
    }
  }

  private candidatesForRect(rect: BBox): Set<T> {
    const found = new Set<T>();
    const x0 = Math.floor(rect.x / this.cellSize);
    const y0 = Math.floor(rect.y / this.cellSize);
    const x1 = Math.floor((rect.x + Math.max(0, rect.width)) / this.cellSize);
    const y1 = Math.floor((rect.y + Math.max(0, rect.height)) / this.cellSize);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const bucket = this.cells.get(`${cx},${cy}`);
        if (!bucket) continue;
        for (const item of bucket) found.add(item);
      }
    }
    return found;
  }

  queryPoint(point: Point, tolerance = 0): T[] {
    const rect = {
      x: point.x - tolerance,
      y: point.y - tolerance,
      width: tolerance * 2,
      height: tolerance * 2,
    };
    const candidates = this.candidatesForRect(rect);
    this.lastCandidates = candidates.size;
    const matches: T[] = [];
    for (const item of candidates) {
      if (bboxContainsPoint(item.bbox, point, tolerance)) matches.push(item);
    }
    return matches;
  }

  queryRect(rect: BBox): T[] {
    const candidates = this.candidatesForRect(rect);
    this.lastCandidates = candidates.size;
    const matches: T[] = [];
    for (const item of candidates) {
      if (bboxIntersects(item.bbox, rect)) matches.push(item);
    }
    return matches;
  }
}
