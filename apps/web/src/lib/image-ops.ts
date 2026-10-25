/**
 * Image-editor maths, kept away from the canvas so it can be tested.
 *
 * The editor applies an ordered list of operations to the source bitmap and
 * re-renders from the original every time, which makes undo free and prevents
 * the quality loss (and accumulating rounding error) of repeatedly resampling
 * an already-edited canvas.
 *
 * Crop rectangles are in the coordinate space of the image *at that point in
 * the operation list*: after a 90-degree turn the user is cropping the rotated
 * image, not the original. `sizeAfterOps` mirrors that so the UI can validate a
 * selection without touching a DOM.
 */

export interface Dimensions {
  width: number;
  height: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ImageOp =
  | { kind: 'rotate'; turns: 1 | 2 | 3 }
  | { kind: 'flip'; axis: 'horizontal' | 'vertical' }
  | { kind: 'crop'; rect: CropRect };

/** A selection smaller than this in either axis is treated as a stray click. */
export const MIN_CROP_PX = 8;

/**
 * Refuse to decode absurd phone-camera panoramas / design exports. A 100 MP
 * bitmap is 400 MB of RGBA before the editor's working canvases are allocated.
 */
export const MAX_EDIT_PIXELS = 80_000_000;

/** Normalized 0..1 rectangle, used while the pointer is still dragging. */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function sizeAfterOps(source: Dimensions, ops: ImageOp[]): Dimensions {
  let { width, height } = source;
  for (const op of ops) {
    if (op.kind === 'rotate') {
      if (op.turns % 2 === 1) [width, height] = [height, width];
    } else if (op.kind === 'crop') {
      width = op.rect.width;
      height = op.rect.height;
    }
  }
  return { width, height };
}

/**
 * Clamps a crop to the image and rounds to whole pixels.
 *
 * Returns null for an empty or hairline selection, so callers never create a
 * zero-sized canvas (which throws in some browsers and silently yields a blank
 * PNG in others).
 */
export function clampCropRect(rect: CropRect, bounds: Dimensions): CropRect | null {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const right = Math.min(bounds.width, Math.round(rect.x + rect.width));
  const bottom = Math.min(bounds.height, Math.round(rect.y + rect.height));
  const width = right - x;
  const height = bottom - y;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < MIN_CROP_PX ||
    height < MIN_CROP_PX
  ) {
    return null;
  }
  return { x, y, width, height };
}

/** Normalizes two drag points into a positive, 0..1-clamped rectangle. */
export function rectFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
): NormalizedRect | null {
  const left = Math.max(0, Math.min(start.x, end.x));
  const top = Math.max(0, Math.min(start.y, end.y));
  const right = Math.min(1, Math.max(start.x, end.x));
  const bottom = Math.min(1, Math.max(start.y, end.y));
  const width = right - left;
  const height = bottom - top;
  // 2% of each axis: below that the overlay is too small to aim at and the
  // result would be a useless sliver of pixels.
  if (width < 0.02 || height < 0.02) return null;
  return { x: left, y: top, width, height };
}

/** Scale a normalized selection into image pixels, then clamp it. */
export function selectionToCrop(
  selection: NormalizedRect,
  bounds: Dimensions,
): CropRect | null {
  return clampCropRect(
    {
      x: selection.x * bounds.width,
      y: selection.y * bounds.height,
      width: selection.width * bounds.width,
      height: selection.height * bounds.height,
    },
    bounds,
  );
}

/** Converts a crop stored in pixels back to percentages for the overlay. */
export function cropToPercent(rect: CropRect, bounds: Dimensions): NormalizedRect {
  return {
    x: rect.x / bounds.width,
    y: rect.y / bounds.height,
    width: rect.width / bounds.width,
    height: rect.height / bounds.height,
  };
}

export interface ImageFilters {
  /** Percent, 100 = unchanged. */
  brightness: number;
  /** Percent, 100 = unchanged. */
  contrast: number;
  grayscale: boolean;
}

export const DEFAULT_FILTERS: ImageFilters = { brightness: 100, contrast: 100, grayscale: false };

/** The canvas `filter` string, shared by the preview and the exported bytes. */
export function filterString(filters: ImageFilters): string {
  const brightness = Math.min(200, Math.max(0, Math.round(filters.brightness)));
  const contrast = Math.min(200, Math.max(0, Math.round(filters.contrast)));
  return `brightness(${brightness}%) contrast(${contrast}%) grayscale(${
    filters.grayscale ? 1 : 0
  })`;
}
