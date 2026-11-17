/**
 * Freehand ink maths shared by the pen tool and its tests.
 *
 * The engine stores an ink object as points relative to its own box, so this
 * module owns the two transforms that matter:
 *
 * - sampling while the pointer moves (0.6 pt between points is dense enough to
 *   look smooth at 400% and sparse enough that a ten-second stroke stays far
 *   below the object limit),
 * - simplification on release (Ramer–Douglas–Peucker), because a pointer emits
 *   far more samples than a stroke needs to keep its shape.
 *
 * Pure and DOM-free so it can be unit-tested without a browser.
 */

export interface InkPoint {
  x: number;
  y: number;
}

export interface InkBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Points closer than this are the same sample. */
export const INK_SAMPLE_DISTANCE_PT = 0.6;
/** Hard cap per stroke; matches the engine's validation limit. */
export const INK_MAX_POINTS = 5_000;
/** RDP tolerance: below a third of a point reads as the same line. */
export const INK_SIMPLIFY_TOLERANCE_PT = 0.35;
/** A dot or hairline still needs a hit target. */
const MIN_BOX_SIZE_PT = 1;

/**
 * Appends `point` unless it is closer than `minDistance` to the last sample.
 * Returns the original array when nothing changed so React state updates bail
 * out without re-rendering the live stroke.
 */
export function sampleInk(
  points: readonly InkPoint[],
  point: InkPoint,
  minDistance = INK_SAMPLE_DISTANCE_PT,
): InkPoint[] {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return points as InkPoint[];
  const last = points[points.length - 1];
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < minDistance) {
    return points as InkPoint[];
  }
  return [...points, { x: point.x, y: point.y }];
}

/** Evenly thins to `max` points while keeping both endpoints. */
export function capInkPoints(points: readonly InkPoint[], max = INK_MAX_POINTS): InkPoint[] {
  if (points.length <= max) return points as InkPoint[];
  if (max <= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    return first && last ? [first, last] : [];
  }
  const out: InkPoint[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * step)]!);
  return out;
}

/** Squared distance from `point` to the segment `a`–`b`. */
function distanceToSegmentSq(point: InkPoint, a: InkPoint, b: InkPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    const px = point.x - a.x;
    const py = point.y - a.y;
    return px * px + py * py;
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)),
  );
  const px = point.x - (a.x + t * dx);
  const py = point.y - (a.y + t * dy);
  return px * px + py * py;
}

/**
 * Ramer–Douglas–Peucker. Iterative so a 5,000-point stroke cannot blow the
 * call stack, and it always keeps the first and last point.
 */
export function simplifyInk(
  points: readonly InkPoint[],
  tolerance = INK_SIMPLIFY_TOLERANCE_PT,
): InkPoint[] {
  if (points.length <= 2) return points as InkPoint[];
  const threshold = Math.max(0, tolerance) ** 2;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end <= start + 1) continue;
    let farthest = -1;
    let farthestDistance = threshold;
    for (let i = start + 1; i < end; i += 1) {
      const distance = distanceToSegmentSq(points[i]!, points[start]!, points[end]!);
      if (distance > farthestDistance) {
        farthest = i;
        farthestDistance = distance;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  const out: InkPoint[] = [];
  for (let i = 0; i < points.length; i += 1) if (keep[i]) out.push(points[i]!);
  return out;
}

/** Tight box around a stroke, or null for an empty one. */
export function inkBounds(points: readonly InkPoint[]): InkBounds | null {
  if (points.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return {
    x: minX,
    y: minY,
    width: Math.max(MIN_BOX_SIZE_PT, maxX - minX),
    height: Math.max(MIN_BOX_SIZE_PT, maxY - minY),
  };
}

/**
 * Turns absolute pointer samples into the engine's representation: a box plus
 * points relative to it. Simplification happens before the cap so the cap only
 * matters for pathological strokes.
 */
export function normalizeInk(
  points: readonly InkPoint[],
  options: { tolerance?: number; maxPoints?: number } = {},
): { points: InkPoint[]; bounds: InkBounds } | null {
  const simplified = simplifyInk(points, options.tolerance ?? INK_SIMPLIFY_TOLERANCE_PT);
  const capped = capInkPoints(simplified, options.maxPoints ?? INK_MAX_POINTS);
  const bounds = inkBounds(capped);
  if (!bounds) return null;
  return {
    bounds,
    points: capped.map((point) => ({ x: point.x - bounds.x, y: point.y - bounds.y })),
  };
}

/** Scales a relative stroke when its box is resized. */
export function scaleInkPoints(
  points: readonly InkPoint[],
  from: { width: number; height: number },
  to: { width: number; height: number },
): InkPoint[] {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return points.map((point) => ({ x: point.x * sx, y: point.y * sy }));
}
