/**
 * Layout relationships -- the geometry facts grouping and reflow both need.
 *
 * Paragraph merging, reading order, collision checks and the confidence report
 * all ask the same questions of the same pairs of boxes: how far apart are these
 * two lines, do they share an edge, are they in the same column, how much of the
 * page is already occupied. Keeping those measurements in one module means the
 * answers cannot drift between the consumers, and it keeps `group.ts` about
 * decisions rather than arithmetic.
 *
 * Everything here is pure geometry on the immutable model: no pdf.js, no DOM,
 * no randomness. Nothing in this file decides to delete, merge or move content;
 * it only measures.
 */

import { bboxArea, intersectBBox } from './geometry.js';
import type { BBox, Line, PageLayout } from './types.js';

export type SharedAlignment = 'left' | 'right' | 'center' | 'none';

export interface LineRelation {
  previousId: string;
  currentId: string;
  /** Distance between baselines, display points. */
  baselineGap: number;
  /** `baselineGap` as a multiple of the measured line pitch. */
  gapRatio: number;
  /** Positive when the current line starts further right than the previous. */
  indentDelta: number;
  /** Positive when the current line ends further right than the previous. */
  rightDelta: number;
  sharedAlignment: SharedAlignment;
  sameTypography: boolean;
  /** 0..1 geometric evidence that the two lines belong together. */
  continuation: number;
}

export interface RelationOptions {
  /** Measured baseline-to-baseline pitch, display points. */
  linePitch: number;
  /** Column this pair belongs to, if known. */
  column?: { left: number; right: number; typicalEnd?: number };
  /** Edge-matching tolerance in points; defaults to 2pt. */
  alignmentTolerance?: number;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function sharedAlignmentOf(
  previous: Line,
  current: Line,
  tolerance: number,
): SharedAlignment {
  if (Math.abs(previous.advanceStart - current.advanceStart) <= tolerance) return 'left';
  if (Math.abs(previous.advanceEnd - current.advanceEnd) <= tolerance) return 'right';
  const previousCenter = (previous.advanceStart + previous.advanceEnd) / 2;
  const currentCenter = (current.advanceStart + current.advanceEnd) / 2;
  if (Math.abs(previousCenter - currentCenter) <= tolerance) return 'center';
  return 'none';
}

function sameTypographyOf(previous: Line, current: Line): boolean {
  const a = previous.typography;
  const b = current.typography;
  const ratio = b.fontSize / Math.max(a.fontSize, 0.1);
  return Math.abs(ratio - 1) <= 0.06 && a.fontFamily === b.fontFamily;
}

/**
 * Measures one adjacent pair. `previous` must be above `current` in reading
 * order; the caller owns that ordering.
 */
export function relateLines(
  previous: Line,
  current: Line,
  options: RelationOptions,
): LineRelation {
  const pitch = Math.max(0.1, options.linePitch);
  const tolerance = options.alignmentTolerance ?? 2;
  const baselineGap = current.baseline - previous.baseline;
  const gapRatio = baselineGap / pitch;
  const indentDelta = current.advanceStart - previous.advanceStart;
  const rightDelta = current.advanceEnd - previous.advanceEnd;
  const sharedAlignment = sharedAlignmentOf(previous, current, tolerance);
  const sameTypography = sameTypographyOf(previous, current);
  const size = Math.max(previous.typography.fontSize, current.typography.fontSize, 1);

  // A short previous line is the classic paragraph-final signal, but only when
  // "short" is measured against the column's own typical end -- ragged-right
  // text ends lines short all the time.
  const typicalEnd = options.column?.typicalEnd ?? options.column?.right;
  const previousIsShort =
    typicalEnd !== undefined && previous.advanceEnd < typicalEnd - Math.max(size * 2, 12);

  const gapScore = clamp01((1.8 - gapRatio) / 0.8);
  const alignmentScore = sharedAlignment === 'none' ? 0.25 : 1;
  const typographyScore = sameTypography ? 1 : 0.3;
  const continuation = clamp01(
    0.5 * gapScore +
      0.2 * alignmentScore +
      0.2 * typographyScore +
      0.1 * (previousIsShort ? 0 : 1),
  );

  return {
    previousId: previous.id,
    currentId: current.id,
    baselineGap,
    gapRatio,
    indentDelta,
    rightDelta,
    sharedAlignment,
    sameTypography,
    continuation,
  };
}

/* ------------------------------------------------------------- collisions */

export interface CollisionTarget {
  id: string;
  bbox: BBox;
}

export interface CollisionRisk {
  collides: boolean;
  /** Area of the largest overlap, square points. */
  overlapArea: number;
  /** `overlapArea` as a fraction of the candidate box. */
  ratio: number;
  /** IDs of every obstacle the box touches. */
  ids: string[];
}

/**
 * How much a candidate box overlaps other page objects.
 *
 * A collider is only reported when the overlap is more than a hairline: a
 * one-point touch between a descender and a table rule is not a collision the
 * user needs to review.
 */
export function collisionRisk(
  box: BBox,
  obstacles: readonly CollisionTarget[],
  minimumOverlap = 0.5,
): CollisionRisk {
  const ids: string[] = [];
  let overlapArea = 0;
  for (const obstacle of obstacles) {
    const overlap = intersectBBox(box, obstacle.bbox);
    if (!overlap) continue;
    if (overlap.width <= minimumOverlap || overlap.height <= minimumOverlap) continue;
    const area = overlap.width * overlap.height;
    overlapArea = Math.max(overlapArea, area);
    ids.push(obstacle.id);
  }
  const area = Math.max(1e-6, bboxArea(box));
  return {
    collides: ids.length > 0,
    overlapArea,
    ratio: clamp01(overlapArea / area),
    ids,
  };
}

/* ----------------------------------------------------------- page summary */

export interface PageRelations {
  /** Adjacent line pairs, in reading order within each column. */
  pairs: LineRelation[];
  /** Fraction of adjacent pairs set in the same family and size. */
  typographyAgreement: number;
  /** Fraction of adjacent pairs sharing an edge. */
  alignmentAgreement: number;
  /** Fraction of adjacent pairs that stayed inside one detected column. */
  columnAgreement: number;
  linePitch: number;
  multiColumn: boolean;
  /** Fraction of the page area covered by tables and images. */
  obstacleCoverage: number;
}

function paragraphOfLine(layout: PageLayout): Map<string, string> {
  const map = new Map<string, string>();
  for (const paragraph of layout.paragraphs) {
    for (const lineId of paragraph.lineIds) map.set(lineId, paragraph.id);
  }
  return map;
}

function columnOfParagraph(layout: PageLayout): Map<string, number> {
  const map = new Map<string, number>();
  for (const block of layout.blocks) {
    for (const paragraphId of block.paragraphIds) map.set(paragraphId, block.columnIndex);
  }
  return map;
}

/**
 * Summarises the relationships the rest of the engine relied on.
 *
 * `confidence.basis` in `computeStructureConfidence` is built from these
 * numbers, so a page that grouped well but had no dependable column signal says
 * exactly that instead of a single opaque score.
 */
export function analyzePageRelations(layout: PageLayout): PageRelations {
  const paragraphOf = paragraphOfLine(layout);
  const columnOf = columnOfParagraph(layout);
  const pairs: LineRelation[] = [];

  // Group lines by paragraph, then relate consecutive ones. Paragraph-local
  // pairs are the ones whose geometry actually drove a merge decision.
  for (const paragraph of layout.paragraphs) {
    const lines = paragraph.lineIds
      .map((id) => layout.lines.find((line) => line.id === id))
      .filter((line): line is Line => line !== undefined)
      .sort((a, b) => a.baseline - b.baseline || a.advanceStart - b.advanceStart);
    for (let i = 1; i < lines.length; i += 1) {
      pairs.push(relateLines(lines[i - 1]!, lines[i]!, { linePitch: layout.stats.medianLineGap || 12 }));
    }
  }

  const gaps = pairs.map((pair) => pair.baselineGap).filter((gap) => gap > 0.5);
  const linePitch = gaps.length > 0 ? median(gaps) : 12;

  let typographyMatches = 0;
  let alignmentMatches = 0;
  let columnMatches = 0;
  let comparable = 0;
  for (const pair of pairs) {
    const previousParagraph = paragraphOf.get(pair.previousId);
    const currentParagraph = paragraphOf.get(pair.currentId);
    const previousColumn = previousParagraph ? columnOf.get(previousParagraph) : undefined;
    const currentColumn = currentParagraph ? columnOf.get(currentParagraph) : undefined;
    if (previousColumn === undefined || currentColumn === undefined) continue;
    comparable += 1;
    if (pair.sameTypography) typographyMatches += 1;
    if (pair.sharedAlignment !== 'none') alignmentMatches += 1;
    if (previousColumn === currentColumn) columnMatches += 1;
  }

  const obstacleArea = [
    ...layout.tables.map((table) => table.bbox),
    ...(layout.images ?? []).map((image) => image.bbox),
  ].reduce((sum, box) => sum + bboxArea(box), 0);
  const pageArea = Math.max(1, layout.widthPt * layout.heightPt);

  return {
    pairs,
    typographyAgreement: comparable > 0 ? typographyMatches / comparable : 1,
    alignmentAgreement: comparable > 0 ? alignmentMatches / comparable : 1,
    columnAgreement: comparable > 0 ? columnMatches / comparable : 1,
    linePitch,
    multiColumn: layout.columns.length > 1,
    obstacleCoverage: clamp01(obstacleArea / pageArea),
  };
}
