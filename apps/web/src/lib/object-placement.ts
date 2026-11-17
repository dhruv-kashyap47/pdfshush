/**
 * Page-aware placement maths.
 *
 * The editor lets objects hang slightly off an edge, but a paste, a duplicate
 * or a freshly chosen signature must land on the page. These helpers are pure
 * so both the canvas gestures and the keyboard path clamp identically, and so
 * "no off-page exports" is unit-tested rather than assumed.
 */

export interface PlacementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageBox {
  width: number;
  height: number;
}

function clampAxis(value: number, size: number, extent: number): number {
  if (!Number.isFinite(value)) return 0;
  // An object wider than the page is pinned to the left/top edge rather than
  // pushed off it: half of a huge stamp is better than none of it.
  const max = Math.max(0, size - extent);
  return Math.min(max, Math.max(0, value));
}

/** Keeps an object's top-left corner on the page, shrinking nothing. */
export function clampToPage(rect: PlacementRect, page: PageBox): PlacementRect {
  return {
    ...rect,
    x: clampAxis(rect.x, page.width, rect.width),
    y: clampAxis(rect.y, page.height, rect.height),
  };
}

/**
 * Offsets a rect by (dx, dy) and clamps the result. `dx`/`dy` default to the
 * duplicate (+8) and paste (+12) conventions the keyboard uses.
 */
export function offsetOnPage(
  rect: PlacementRect,
  page: PageBox,
  dx: number,
  dy: number,
): PlacementRect {
  return clampToPage({ ...rect, x: rect.x + dx, y: rect.y + dy }, page);
}

/** True when the object's box intersects the page at all. */
export function intersectsPage(rect: PlacementRect, page: PageBox): boolean {
  return (
    rect.x < page.width &&
    rect.y < page.height &&
    rect.x + rect.width > 0 &&
    rect.y + rect.height > 0
  );
}
