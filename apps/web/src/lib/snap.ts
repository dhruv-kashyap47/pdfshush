/**
 * E-07: snap guides.
 *
 * Snapping is a pure geometric decision so it can be tested without a DOM and
 * so the drag path stays cheap: the editor gives the live box, the page size and
 * the other objects, and gets back the smallest correction plus the guides to
 * paint. `Alt` bypass is the caller's decision; this module never mutates.
 *
 * The threshold is expressed in points by the caller (screen pixels divided by
 * zoom), because a 6 px grab should feel the same at 50% and 400%.
 */

export interface SnapBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapPage {
  width: number;
  height: number;
}

export interface SnapOptions {
  /** Maximum correction, in display points. */
  thresholdPt: number;
  /** Alt (or an explicit bypass) disables snapping entirely. */
  disabled?: boolean;
}

export interface SnapGuides {
  /** Display x coordinates for vertical guide lines. */
  vertical: number[];
  /** Display y coordinates for horizontal guide lines. */
  horizontal: number[];
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuides;
  snappedX: boolean;
  snappedY: boolean;
}

interface Candidate {
  /** Coordinate of the candidate line. */
  line: number;
  /** Offset of the moving edge from the box origin. */
  edge: number;
}

const EPSILON = 0.01;

function verticalCandidates(page: SnapPage, others: readonly SnapBox[]): Candidate[] {
  const lines = [0, page.width / 2, page.width];
  for (const box of others) {
    lines.push(box.x, box.x + box.width / 2, box.x + box.width);
  }
  return [0, 0.5, 1].flatMap((edge) =>
    lines.map((line) => ({ line, edge })),
  );
}

function horizontalCandidates(page: SnapPage, others: readonly SnapBox[]): Candidate[] {
  const lines = [0, page.height / 2, page.height];
  for (const box of others) {
    lines.push(box.y, box.y + box.height / 2, box.y + box.height);
  }
  return [0, 0.5, 1].flatMap((edge) => lines.map((line) => ({ line, edge })));
}

/**
 * Snaps a moved box to the nearest page/object edge or centre. Both axes are
 * decided independently; a tie prefers the page edge (the list order), then the
 * smaller correction.
 */
export function snapBox(
  box: SnapBox,
  page: SnapPage,
  others: readonly SnapBox[],
  options: SnapOptions,
): SnapResult {
  const base = {
    x: box.x,
    y: box.y,
    guides: { vertical: [] as number[], horizontal: [] as number[] },
    snappedX: false,
    snappedY: false,
  };
  if (options.disabled || !(options.thresholdPt > 0)) return base;

  let bestX: { delta: number; line: number } | null = null;
  for (const candidate of verticalCandidates(page, others)) {
    const moving = box.x + box.width * candidate.edge;
    const delta = candidate.line - moving;
    if (Math.abs(delta) > options.thresholdPt) continue;
    if (
      !bestX ||
      Math.abs(delta) < Math.abs(bestX.delta) - EPSILON ||
      (Math.abs(Math.abs(delta) - Math.abs(bestX.delta)) <= EPSILON && delta < bestX.delta)
    ) {
      bestX = { delta, line: candidate.line };
    }
  }

  let bestY: { delta: number; line: number } | null = null;
  for (const candidate of horizontalCandidates(page, others)) {
    const moving = box.y + box.height * candidate.edge;
    const delta = candidate.line - moving;
    if (Math.abs(delta) > options.thresholdPt) continue;
    if (
      !bestY ||
      Math.abs(delta) < Math.abs(bestY.delta) - EPSILON ||
      (Math.abs(Math.abs(delta) - Math.abs(bestY.delta)) <= EPSILON && delta < bestY.delta)
    ) {
      bestY = { delta, line: candidate.line };
    }
  }

  return {
    x: bestX ? box.x + bestX.delta : box.x,
    y: bestY ? box.y + bestY.delta : box.y,
    guides: {
      vertical: bestX ? [bestX.line] : [],
      horizontal: bestY ? [bestY.line] : [],
    },
    snappedX: Boolean(bestX),
    snappedY: Boolean(bestY),
  };
}
