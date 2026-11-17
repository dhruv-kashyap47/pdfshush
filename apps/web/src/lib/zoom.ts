/**
 * Viewport zoom maths.
 *
 * Kept pure so the two things that used to be guessed at -- "fit" and "type a
 * percentage" -- can be pinned by tests. The editor allows 25–400%; above 100%
 * the raster budget in the worker clamps the bitmap rather than the zoom.
 */

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export type FitMode = 'width' | 'page';

export interface FitViewport {
  /** Content-box width in CSS px. */
  width: number;
  /** Content-box height in CSS px. */
  height: number;
  /** Horizontal padding already accounted for inside `width`. */
  paddingX?: number;
  paddingY?: number;
}

export interface FitPage {
  width: number;
  height: number;
}

/** Rounds to a 5% step and clamps to the supported window. */
export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 20) / 20));
}

/**
 * Fits the widest page into the viewport. `page` is the largest display size in
 * the document, so fit applies to every page consistently.
 */
export function fitZoom(viewport: FitViewport, page: FitPage, mode: FitMode): number {
  const availableWidth = Math.max(1, viewport.width - (viewport.paddingX ?? 0) - 2);
  const availableHeight = Math.max(1, viewport.height - (viewport.paddingY ?? 0) - 2);
  const width = Math.max(1, page.width);
  const height = Math.max(1, page.height);
  if (mode === 'width') return clampZoom(availableWidth / width);
  return clampZoom(Math.min(availableWidth / width, availableHeight / height));
}

/**
 * Parses a typed percentage ("150", "150%", " 37.5 "). Returns null for
 * unusable input so the caller can restore the current value rather than jump
 * to a fallback the user did not ask for.
 */
export function parseZoomPercent(raw: string): number | null {
  const parsed = Number(raw.replace('%', '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return clampZoom(parsed / 100);
}
