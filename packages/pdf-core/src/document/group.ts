/**
 * Adaptive glyph → word → line → paragraph → block → region grouping.
 *
 * The rules here are deliberately conservative: a heuristic that cannot decide
 * keeps the text intact and lowers `confidence` / raises `ambiguous` instead of
 * dropping or silently merging content. That matters for an editor -- a wrong
 * paragraph boundary is recoverable, deleted text is not.
 *
 * Everything is page-local. Cross-page header/footer repetition is resolved in
 * `document.ts`, because it needs every page's layout first.
 */

import { unionBBoxes, type PageGeometry } from './geometry.js';
import type {
  BBox,
  BlockKind,
  ColumnModel,
  Glyph,
  Line,
  ListInfo,
  PageLayout,
  PageStats,
  Paragraph,
  ParagraphLineSpan,
  ParagraphRole,
  Region,
  RegionKind,
  TableCell,
  TableModel,
  TableRow,
  TextAlignment,
  TextBlock,
  TextTypography,
  Word,
} from './types.js';
import { createIdFactory, textSeed, type IdFactory } from './ids.js';
import { relateLines } from './relations.js';

/* ------------------------------------------------------------------ input */

export interface LayoutBuildOptions {
  /** Header/footer band as a fraction of page height. */
  marginBand?: number;
  /** Extra space (points) that splits one visual line into cells/columns. */
  cellGapPt?: number;
  /** Minimum vertical span for a whitespace corridor to count as a column. */
  columnSpanRatio?: number;
  /** Maximum number of detected columns. */
  maxColumns?: number;
  /** Disable detection for tests or host-specific overrides. */
  detectColumns?: boolean;
  detectTables?: boolean;
  detectLists?: boolean;
}

export interface PageLayoutInput {
  pageIndex: number;
  geometry: PageGeometry;
  /** MediaBox in PDF user space (y up). */
  mediaBox: BBox;
  /** CropBox in PDF user space (y up). */
  cropBox: BBox;
  /** Visible page rotation, already normalised. */
  rotation: 0 | 90 | 180 | 270;
  glyphs: readonly Glyph[];
  options?: LayoutBuildOptions;
}

/* ------------------------------------------------------------------ utils */

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;
const CLOSING_PUNCT = /[.,;:!?)\]}%'"”’]/;
const OPENING_PUNCT = /[(\[{'"“‘]/;

export function isCjk(text: string): boolean {
  return CJK.test(text);
}

/** Whether two adjacent word fragments need a space between them. */
export function needsSpace(previous: string, next: string): boolean {
  if (!previous || !next) return false;
  const a = previous[previous.length - 1] ?? '';
  const b = next[0] ?? '';
  if (CLOSING_PUNCT.test(b)) return false;
  if (OPENING_PUNCT.test(a)) return false;
  if (isCjk(a) || isCjk(b)) return false;
  if (a === '/' || a === '-') return false;
  return true;
}

export function joinWordTexts(parts: readonly string[]): string {
  let text = '';
  for (const part of parts) {
    if (!part) continue;
    text = text ? `${text}${needsSpace(text, part) ? ' ' : ''}${part}` : part;
  }
  return text;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nonWhitespace(glyphs: readonly ProjectedGlyph[]): ProjectedGlyph[] {
  return glyphs.filter((entry) => !entry.glyph.whitespace && entry.glyph.text.trim().length > 0);
}

/**
 * Typography keys are derived from the same immutable object for every glyph of
 * a pdf.js text item, so the `toFixed` formatting is memoised per object. This
 * is a pure cache: the key string it returns is byte-identical to building it
 * inline, which keeps the weighted-mode tie-breaking exactly as it was.
 */
const typographyKeyCache = new WeakMap<TextTypography, string>();

function typographyKey(typography: TextTypography): string {
  const cached = typographyKeyCache.get(typography);
  if (cached !== undefined) return cached;
  const key = `${typography.fontFamily}|${typography.fontSize.toFixed(2)}|${typography.bold}|${typography.italic}|${typography.rotationDeg.toFixed(1)}`;
  typographyKeyCache.set(typography, key);
  return key;
}

function dominantTypography(glyphs: readonly Glyph[]): TextTypography {
  if (glyphs.length === 0) {
    return {
      fontName: '',
      fontFamily: 'other',
      fontFamilyLabel: 'Unknown',
      fontSize: 0,
      fontWeight: 400,
      bold: false,
      italic: false,
      direction: 'ltr',
      rotationDeg: 0,
    };
  }
  // A one-glyph run has exactly one candidate, so the weighted-mode maps would
  // only be built to return it. This is the common case for table cells.
  if (glyphs.length === 1) return glyphs[0]!.typography;
  const weights = new Map<string, number>();
  const samples = new Map<string, TextTypography>();
  for (const glyph of glyphs) {
    const key = typographyKey(glyph.typography);
    weights.set(key, (weights.get(key) ?? 0) + Math.max(1, glyph.length));
    if (!samples.has(key)) samples.set(key, glyph.typography);
  }
  let bestKey = '';
  let bestWeight = -1;
  for (const [key, weight] of weights) {
    if (weight > bestWeight) {
      bestKey = key;
      bestWeight = weight;
    }
  }
  return samples.get(bestKey) ?? glyphs[0]!.typography;
}

/* -------------------------------------------------------------- projection */

interface ProjectedGlyph {
  glyph: Glyph;
  advanceStart: number;
  advanceEnd: number;
  /** Baseline cross-coordinate (display y for horizontal text). */
  cross: number;
  crossMin: number;
  crossMax: number;
}

function projectGlyph(glyph: Glyph, rotationDeg: number): ProjectedGlyph {
  const radians = (rotationDeg * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const nx = -dy;
  const ny = dx;
  const x = glyph.bbox.x;
  const y = glyph.bbox.y;
  const right = x + glyph.bbox.width;
  const bottom = y + glyph.bbox.height;
  // Project the four corners without allocating one object per corner: this
  // runs once per glyph, on every page of every document.
  const advanceA = x * dx + y * dy;
  const advanceB = right * dx + y * dy;
  const advanceC = x * dx + bottom * dy;
  const advanceD = right * dx + bottom * dy;
  const crossA = x * nx + y * ny;
  const crossB = right * nx + y * ny;
  const crossC = x * nx + bottom * ny;
  const crossD = right * nx + bottom * ny;
  const mid = {
    x: (glyph.baselineStart.x + glyph.baselineEnd.x) / 2,
    y: (glyph.baselineStart.y + glyph.baselineEnd.y) / 2,
  };
  return {
    glyph,
    advanceStart: Math.min(advanceA, advanceB, advanceC, advanceD),
    advanceEnd: Math.max(advanceA, advanceB, advanceC, advanceD),
    cross: mid.x * nx + mid.y * ny,
    crossMin: Math.min(crossA, crossB, crossC, crossD),
    crossMax: Math.max(crossA, crossB, crossC, crossD),
  };
}

/** Cross-axis overlap ratio of two bands, 0 when disjoint. */
function bandOverlap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  const shortest = Math.min(aMax - aMin, bMax - bMin);
  return shortest > 0 ? Math.max(0, overlap) / shortest : 0;
}

function rotationBucket(rotationDeg: number): number {
  const bucket = Math.round(rotationDeg / 5) * 5;
  return ((bucket % 360) + 360) % 360;
}

/* ---------------------------------------------------------- rows/fragments */

interface FragmentDraft {
  glyphs: ProjectedGlyph[];
  advanceStart: number;
  advanceEnd: number;
  cross: number;
  crossMin: number;
  crossMax: number;
  rowIndex: number;
  cellIndex: number;
  columnIndex: number;
  tableId?: string;
  tableRow?: number;
  /** Set once the fragment has been turned into a `Line`. */
  lineId?: string;
}

function boundsOfGlyphs(glyphs: readonly ProjectedGlyph[]): {
  advanceStart: number;
  advanceEnd: number;
  cross: number;
  crossMin: number;
  crossMax: number;
} {
  const ink = nonWhitespace(glyphs);
  const source = ink.length > 0 ? ink : glyphs;
  if (source.length === 0) {
    return { advanceStart: 0, advanceEnd: 0, cross: 0, crossMin: 0, crossMax: 0 };
  }
  let advanceStart = Number.POSITIVE_INFINITY;
  let advanceEnd = Number.NEGATIVE_INFINITY;
  let crossMin = Number.POSITIVE_INFINITY;
  let crossMax = Number.NEGATIVE_INFINITY;
  let crossSum = 0;
  for (const entry of source) {
    advanceStart = Math.min(advanceStart, entry.advanceStart);
    advanceEnd = Math.max(advanceEnd, entry.advanceEnd);
    crossMin = Math.min(crossMin, entry.crossMin);
    crossMax = Math.max(crossMax, entry.crossMax);
    crossSum += entry.cross;
  }
  return {
    advanceStart,
    advanceEnd,
    cross: crossSum / source.length,
    crossMin,
    crossMax,
  };
}

function buildRows(glyphs: readonly ProjectedGlyph[], rowTolerance: number): ProjectedGlyph[][] {
  const sorted = [...glyphs].sort(
    (a, b) => a.cross - b.cross || a.advanceStart - b.advanceStart,
  );
  const rows: ProjectedGlyph[][] = [];
  let row: ProjectedGlyph[] = [];
  let rowCross = 0;
  let rowMin = 0;
  let rowMax = 0;

  for (const entry of sorted) {
    if (row.length === 0) {
      row = [entry];
      rowCross = entry.cross;
      rowMin = entry.crossMin;
      rowMax = entry.crossMax;
      continue;
    }
    const overlap = bandOverlap(entry.crossMin, entry.crossMax, rowMin, rowMax);
    if (Math.abs(entry.cross - rowCross) <= rowTolerance || overlap >= 0.45) {
      row.push(entry);
      rowCross = (rowCross * (row.length - 1) + entry.cross) / row.length;
      rowMin = Math.min(rowMin, entry.crossMin);
      rowMax = Math.max(rowMax, entry.crossMax);
      continue;
    }
    rows.push(row);
    row = [entry];
    rowCross = entry.cross;
    rowMin = entry.crossMin;
    rowMax = entry.crossMax;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

function splitRow(
  row: readonly ProjectedGlyph[],
  rowIndex: number,
  cellGap: number,
): FragmentDraft[] {
  const sorted = [...row].sort((a, b) => a.advanceStart - b.advanceStart);
  const fragments: FragmentDraft[] = [];
  let current: ProjectedGlyph[] = [];
  // Producers commonly encode an inter-cell gap as one very wide space glyph
  // rather than as a positioning jump. Measuring the gap from that glyph's own
  // advance would report 0 and glue every table row into one fragment, so the
  // anchor is the last *inked* glyph.
  let lastInk: ProjectedGlyph | undefined;

  const flush = (): void => {
    if (current.length === 0) return;
    if (nonWhitespace(current).length > 0) {
      const bounds = boundsOfGlyphs(current);
      fragments.push({
        glyphs: [...current].sort((a, b) => a.advanceStart - b.advanceStart),
        ...bounds,
        rowIndex,
        cellIndex: 0,
        columnIndex: 0,
      });
    }
    current = [];
    lastInk = undefined;
  };

  for (const entry of sorted) {
    const previous = current[current.length - 1];
    if (previous) {
      const size = Math.max(
        previous.glyph.typography.fontSize,
        entry.glyph.typography.fontSize,
        1,
      );
      // A different source text item means a different text object. Objects can
      // overlap on a baseline (form labels, stamps), so their glyphs must not be
      // interleaved by x-order; `collapseRow` re-joins genuinely contiguous runs.
      const sameItem = entry.glyph.itemIndex === previous.glyph.itemIndex;
      const anchor = lastInk ?? previous;
      const gap = entry.advanceStart - anchor.advanceEnd;
      if (!sameItem || gap > Math.max(cellGap, size * 1.15)) {
        flush();
      }
    }
    current.push(entry);
    if (!entry.glyph.whitespace) lastInk = entry;
  }
  flush();
  return fragments;
}

/* ------------------------------------------------------------ column model */

interface Gutter {
  left: number;
  right: number;
  crossMin: number;
  crossMax: number;
  rowCount: number;
}

/**
 * A form page is not a multi-column page: its "columns" are field boxes.
 *
 * Dot leaders are the strongest cheap signal that a page is a form. Body prose
 * has none; a two-column paper has none. On the IRS 1040 they appear on 21 of
 * 297 lines, and inferring gutters from those gaps splits field labels into
 * table cells ("than four", "(3)", "dependents,"). Refusing the inference keeps
 * the labels whole; the page is then read as one column, and only a grid that
 * repeats across three or more rows is called a table. The test is deliberately
 * narrow: a form without leaders is not guessed at.
 */
function looksLikeForm(rows: readonly FragmentDraft[][]): boolean {
  const texts = rows
    .map((row) =>
      row
        .map((fragment) => fragment.glyphs.map((entry) => entry.glyph.text).join(''))
        .join(' ')
        .trim(),
    )
    .filter((text) => text.length > 0);
  if (texts.length < 20) return false;
  // Dots are often separate text items, so the row text has a space between
  // them (". . . . ."); allow that when counting leader runs.
  const leaders = texts.filter((text) => /\.(?:\s*\.){3,}/.test(text)).length;
  // Density, not label length: on a form a row is a label *plus* its field, so
  // it is not short. Dot leaders appear on no line of the paper fixtures.
  return leaders >= Math.max(5, Math.ceil(texts.length * 0.03));
}

/**
 * A column gutter is a whitespace corridor that recurs in several rows and
 * survives a large part of the page's text height. Rows that visibly cross it
 * are "spanning" (headlines, wide tables) and keep `columnIndex = -1`.
 */
function detectColumnGutters(
  rows: readonly FragmentDraft[][],
  pageSpan: number,
  medianFontSize: number,
  options: LayoutBuildOptions,
): Gutter[] {
  if (options.detectColumns === false || rows.length < 3) return [];
  const minGutter = Math.max(6, medianFontSize * 0.9);
  const minSpan = Math.max(24, pageSpan * (options.columnSpanRatio ?? 0.25));

  interface Candidate {
    left: number;
    right: number;
    cross: number;
    rowIndex: number;
  }
  const candidates: Candidate[] = [];

  rows.forEach((fragments, rowIndex) => {
    const ordered = [...fragments].sort((a, b) => a.advanceStart - b.advanceStart);
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1]!;
      const next = ordered[i]!;
      const gap = next.advanceStart - previous.advanceEnd;
      if (gap < minGutter) continue;
      candidates.push({
        left: previous.advanceEnd,
        right: next.advanceStart,
        cross: (previous.cross + next.cross) / 2,
        rowIndex,
      });
    }
  });
  if (candidates.length === 0) return [];

  // A corridor is the whitespace that is empty in *every* row: the intersection
  // of the per-row gaps that describe it. Clustering by gap midpoint chained
  // short-line rows into separate corridors whose own left edge then sat inside
  // the real corridor, so long left-column lines were reported as "spanning"
  // and lost their column membership. Sorting by the gap's left edge and
  // intersecting overlapping intervals keeps one corridor per physical gutter.
  const clusters: {
    left: number;
    right: number;
    crossMin: number;
    crossMax: number;
    rows: Set<number>;
  }[] = [];

  const ordered = [...candidates].sort((a, b) => a.left - b.left || a.right - b.right);
  for (const candidate of ordered) {
    const last = clusters[clusters.length - 1];
    if (last && candidate.left < last.right) {
      const left = Math.max(last.left, candidate.left);
      const right = Math.min(last.right, candidate.right);
      // Only keep intersecting while a usable corridor survives; two disjoint
      // corridors (a three-column page) must not be merged into one.
      if (right - left >= minGutter) {
        last.left = left;
        last.right = right;
        last.crossMin = Math.min(last.crossMin, candidate.cross);
        last.crossMax = Math.max(last.crossMax, candidate.cross);
        last.rows.add(candidate.rowIndex);
        continue;
      }
    }
    clusters.push({
      left: candidate.left,
      right: candidate.right,
      crossMin: candidate.cross,
      crossMax: candidate.cross,
      rows: new Set<number>([candidate.rowIndex]),
    });
  }

  const gutters: Gutter[] = [];
  for (const cluster of clusters) {
    if (cluster.rows.size < 3) continue;
    if (cluster.crossMax - cluster.crossMin < minSpan) continue;
    // `left`/`right` are already the intersected corridor bounds: it starts
    // where the longest left-column line ends and ends where the earliest
    // right-column line begins.
    const { left, right } = cluster;
    if (!(right - left >= minGutter)) continue;
    gutters.push({
      left,
      right,
      crossMin: cluster.crossMin,
      crossMax: cluster.crossMax,
      rowCount: cluster.rows.size,
    });
  }

  gutters.sort((a, b) => a.left - b.left);
  const merged: Gutter[] = [];
  for (const gutter of gutters) {
    const previous = merged[merged.length - 1];
    if (previous && gutter.left <= previous.right + 2) {
      previous.right = Math.max(previous.right, gutter.right);
      previous.crossMin = Math.min(previous.crossMin, gutter.crossMin);
      previous.crossMax = Math.max(previous.crossMax, gutter.crossMax);
      previous.rowCount = Math.max(previous.rowCount, gutter.rowCount);
      continue;
    }
    merged.push({ ...gutter });
  }

  const maxGutters = Math.max(0, (options.maxColumns ?? 4) - 1);
  if (merged.length > maxGutters) {
    // Keep the corridors with the strongest evidence (most rows, then widest).
    merged.sort((a, b) => b.rowCount - a.rowCount || b.right - b.left - (a.right - a.left));
    merged.length = maxGutters;
    merged.sort((a, b) => a.left - b.left);
  }
  return merged;
}

function columnIndexOf(
  advanceStart: number,
  advanceEnd: number,
  gutters: readonly Gutter[],
): number {
  let index = 0;
  for (const gutter of gutters) {
    if (advanceEnd <= gutter.left + 0.75) return index;
    if (advanceStart >= gutter.right - 0.75) {
      index += 1;
      continue;
    }
    // The fragment crosses the corridor: it belongs to no single column.
    return -1;
  }
  return index;
}

/* -------------------------------------------------------------- table model */

interface TableDraft {
  id: string;
  columnIndex: number;
  rows: FragmentDraft[][];
}

interface CellRow {
  columnIndex: number;
  cross: number;
  rowIndex: number;
  fragments: FragmentDraft[];
  starts: number[];
  ends: number[];
  gapMids: number[];
}

/**
 * A table is a run of neighbouring rows that each contain several cells and
 * whose cell boundaries line up. Column gutters are excluded first, otherwise
 * every two-column page would look like a two-column table.
 */
function detectTables(
  rows: readonly FragmentDraft[][],
  medianFontSize: number,
  idFactory: IdFactory,
  options: LayoutBuildOptions,
  /** Form pages keep only grids with three or more rows; two rows are fields. */
  minRows = 2,
): TableDraft[] {
  if (options.detectTables === false) return [];
  const minCellGap = Math.max(4, medianFontSize * 0.55);
  const cellRows: CellRow[] = [];

  rows.forEach((fragments, rowIndex) => {
    // A dot-leader run is a form guide, not a row of cells. When it is split
    // into one fragment per dot it otherwise aligns with the next form line and
    // becomes a table whose cells are all "." (observed on IRS 1040 page 2).
    const rowText = fragments
      .map((fragment) => fragment.glyphs.map((entry) => entry.glyph.text).join(''))
      .join('');
    if (/\.{4,}/.test(rowText)) return;
    const byColumn = new Map<number, FragmentDraft[]>();
    for (const fragment of fragments) {
      if (fragment.columnIndex < 0) continue;
      const bucket = byColumn.get(fragment.columnIndex);
      if (bucket) bucket.push(fragment);
      else byColumn.set(fragment.columnIndex, [fragment]);
    }
    for (const [columnIndex, cells] of byColumn) {
      if (cells.length < 2) continue;
      const ordered = [...cells].sort((a, b) => a.advanceStart - b.advanceStart);
      // A cell's text can be several text items (a font switch mid-cell, or a
      // producer that emits one item per word). Coalesce runs whose gap is
      // smaller than a cell gap, otherwise every such row looks like it has more
      // columns than the table really has.
      const coalesced: FragmentDraft[] = [];
      for (const fragment of ordered) {
        const previous = coalesced[coalesced.length - 1];
        if (previous && fragment.advanceStart - previous.advanceEnd < minCellGap) {
          coalesced[coalesced.length - 1] = mergeFragments([previous, fragment]);
        } else {
          coalesced.push(fragment);
        }
      }
      if (coalesced.length < 2) continue;
      const gapMids: number[] = [];
      let valid = true;
      for (let i = 1; i < coalesced.length; i += 1) {
        const previous = coalesced[i - 1]!;
        const next = coalesced[i]!;
        const gap = next.advanceStart - previous.advanceEnd;
        if (gap < minCellGap) {
          valid = false;
          break;
        }
        gapMids.push((previous.advanceEnd + next.advanceStart) / 2);
      }
      if (!valid) continue;
      const cross = average(coalesced.map((fragment) => fragment.cross));
      cellRows.push({
        columnIndex,
        cross,
        rowIndex,
        fragments: coalesced,
        starts: coalesced.map((fragment) => fragment.advanceStart),
        ends: coalesced.map((fragment) => fragment.advanceEnd),
        gapMids,
      });
    }
  });

  if (cellRows.length === 0) return [];
  cellRows.sort((a, b) => a.columnIndex - b.columnIndex || a.cross - b.cross);

  const alignmentTolerance = Math.max(10, medianFontSize * 1.1);
  const rowWindow = Math.max(18, medianFontSize * 3.2);
  const drafts: TableDraft[] = [];
  let group: CellRow[] = [];

  const alignmentMode = (
    a: CellRow,
    b: CellRow,
    index: number,
  ): 'start' | 'end' | 'center' | null => {
    const startDelta = Math.abs(a.starts[index]! - b.starts[index]!);
    const endDelta = Math.abs(a.ends[index]! - b.ends[index]!);
    const aMid = (a.starts[index]! + a.ends[index]!) / 2;
    const bMid = (b.starts[index]! + b.ends[index]!) / 2;
    if (startDelta <= alignmentTolerance) return 'start';
    if (endDelta <= alignmentTolerance) return 'end';
    if (Math.abs(aMid - bMid) <= alignmentTolerance) return 'center';
    return null;
  };

  const matches = (a: CellRow, b: CellRow): boolean => {
    if (a.columnIndex !== b.columnIndex) return false;
    if (Math.abs(b.cross - a.cross) > rowWindow) return false;
    if (a.fragments.length !== b.fragments.length) return false;
    if (a.gapMids.length !== b.gapMids.length) return false;

    // Alignment is judged per cell, not once for the whole row: a real table is
    // allowed to have left-aligned labels in column 0 and right-aligned numbers
    // in column 1. The previous one-mode-per-row rule refused that (PLAN §29.6).
    for (let i = 0; i < a.fragments.length; i += 1) {
      if (!alignmentMode(a, b, i)) return false;
    }

    // Per-cell alignment alone would accept justified prose: its first fragment
    // starts at the left margin, its last ends at the right margin, and the wide
    // stretched spaces split the line into two "cells". The guard is geometric:
    // in a table no cell's text may reach into the next column's leftmost start.
    // In justified prose the split point moves between lines, so an earlier
    // line's left cell crosses a later line's right-cell start and the group is
    // rejected.
    return rangesDisjoint(a, b);
  };

  const rangesDisjoint = (a: CellRow, b: CellRow): boolean => {
    for (let i = 0; i < a.fragments.length; i += 1) {
      for (let j = i + 1; j < a.fragments.length; j += 1) {
        const leftEnd = Math.max(a.ends[i]!, b.ends[i]!);
        const rightStart = Math.min(a.starts[j]!, b.starts[j]!);
        if (leftEnd > rightStart + alignmentTolerance) return false;
      }
    }
    return true;
  };

  const flush = (): void => {
    if (group.length < minRows) {
      group = [];
      return;
    }
    // Two rows whose cells align on *different* edges each are not table
    // evidence: justified prose does exactly that (left cell starts at the
    // margin, right cell ends at it), and its stretched word space can leave
    // two consecutive lines passing the disjointness guard. Three or more such
    // rows are a grid; two are a line break. Refusing the pair is the honest
    // choice -- the text stays ordinary prose (PLAN §29.6).
    if (group.length === 2) {
      const modes = new Set<string>();
      for (let i = 0; i < group[0]!.fragments.length; i += 1) {
        const mode = alignmentMode(group[0]!, group[1]!, i);
        if (mode) modes.add(mode);
      }
      if (modes.size > 1) {
        group = [];
        return;
      }
    }
    const first = group[0]!.fragments[0]!.glyphs[0]!;
    const seed = `${textSeed(first.glyph.text, first.glyph.bbox)}|${group[0]!.columnIndex}`;
    const id = idFactory('table', seed);
    group.forEach((cellRow, tableRow) => {
      cellRow.fragments.forEach((fragment, cellIndex) => {
        fragment.tableId = id;
        fragment.tableRow = tableRow;
        fragment.cellIndex = cellIndex;
      });
    });
    drafts.push({
      id,
      columnIndex: group[0]!.columnIndex,
      rows: group.map((cellRow) => cellRow.fragments),
    });
    group = [];
  };

  for (const cellRow of cellRows) {
    const previous = group[group.length - 1];
    if (!previous) {
      group = [cellRow];
      continue;
    }
    // A row can legitimately be missing from a sparse table; only break when
    // the vertical distance or the grid itself changes. Disjointness is checked
    // against the whole group, not just the previous row: three justified-prose
    // lines can pass A-B and B-C while A-C overlap.
    if (
      matches(previous, cellRow) &&
      cellRow.rowIndex > previous.rowIndex &&
      group.every((row) => rangesDisjoint(row, cellRow))
    ) {
      group.push(cellRow);
      continue;
    }
    flush();
    group = [cellRow];
  }
  flush();
  return drafts;
}

/* ---------------------------------------------------------- words and lines */

interface BuiltLine {
  line: Line;
  words: Word[];
}

interface WordResult {
  words: Word[];
  text: string;
}

function buildWords(
  glyphs: readonly ProjectedGlyph[],
  pageIndex: number,
  idFactory: IdFactory,
): WordResult {
  const ordered = [...glyphs].sort((a, b) => a.advanceStart - b.advanceStart);
  const words: Word[] = [];
  let bucket: ProjectedGlyph[] = [];

  const flush = (): void => {
    const ink = bucket.filter((entry) => !entry.glyph.whitespace && entry.glyph.text.trim().length > 0);
    if (ink.length > 0) {
      const text = ink.map((entry) => entry.glyph.text).join('');
      const box = unionBBoxes(ink.map((entry) => entry.glyph.bbox));
      const pdfBox = unionBBoxes(ink.map((entry) => entry.glyph.pdfBox));
      const first = ink[0]!;
      const last = ink[ink.length - 1]!;
      words.push({
        id: idFactory('word', `${textSeed(text, box)}|${words.length}`),
        pageIndex,
        text,
        glyphIds: ink.map((entry) => entry.glyph.id),
        bbox: box,
        pdfBox,
        baselineStart: first.glyph.baselineStart,
        baselineEnd: last.glyph.baselineEnd,
        rotationDeg: first.glyph.rotationDeg,
        direction: first.glyph.direction,
        typography: dominantTypography(ink.map((entry) => entry.glyph)),
        confidence: clamp01(average(ink.map((entry) => entry.glyph.confidence))),
      });
    }
    bucket = [];
  };

  for (const entry of ordered) {
    if (entry.glyph.whitespace) {
      flush();
      continue;
    }
    const previous = bucket[bucket.length - 1];
    if (previous) {
      const size = Math.max(previous.glyph.typography.fontSize, entry.glyph.typography.fontSize, 1);
      const gap = entry.advanceStart - previous.advanceEnd;
      // Some producers omit explicit space glyphs and rely on a positioning
      // jump instead; treat a small advance gap as a word boundary.
      if (gap > Math.max(1.2, size * 0.18)) flush();
    }
    bucket.push(entry);
  }
  flush();

  return { words, text: joinWordTexts(words.map((word) => word.text)) };
}

function mergeFragments(fragments: readonly FragmentDraft[]): FragmentDraft {
  const glyphs = fragments.flatMap((fragment) => fragment.glyphs);
  glyphs.sort((a, b) => a.advanceStart - b.advanceStart);
  const first = fragments[0]!;
  return {
    glyphs,
    ...boundsOfGlyphs(glyphs),
    rowIndex: first.rowIndex,
    cellIndex: first.cellIndex,
    columnIndex: first.columnIndex,
    ...(first.tableId ? { tableId: first.tableId, tableRow: first.tableRow } : {}),
  };
}

function runSize(fragment: FragmentDraft): number {
  const glyph = nonWhitespace(fragment.glyphs)[0] ?? fragment.glyphs[0];
  return glyph?.glyph.typography.fontSize ?? 0;
}

function typographyKeyOf(fragment: FragmentDraft): string {  const glyph = nonWhitespace(fragment.glyphs)[0] ?? fragment.glyphs[0];
  const typography = glyph?.glyph.typography;
  if (!typography) return '';
  return `${typography.fontName}|${typography.fontFamily}|${typography.fontSize.toFixed(2)}|${
    typography.bold ? 1 : 0
  }${typography.italic ? 1 : 0}`;
}

function collapseRow(
  fragments: readonly FragmentDraft[],
  medianFontSize: number,
): FragmentDraft[] {
  const tableFragments = fragments.filter((fragment) => fragment.tableId);
  const byColumn = new Map<number, FragmentDraft[]>();
  for (const fragment of fragments) {
    if (fragment.tableId) continue;
    const bucket = byColumn.get(fragment.columnIndex);
    if (bucket) bucket.push(fragment);
    else byColumn.set(fragment.columnIndex, [fragment]);
  }

  const nearGap = Math.max(4, medianFontSize * 2.5);
  const result: FragmentDraft[] = [...tableFragments];
  for (const group of byColumn.values()) {
    // Text objects can share a baseline while overlapping in x: a form's big
    // form number behind its title, a stamp over body text, a LaTeX lockup drawn
    // as several overlapping runs. Joining glyphs by x alone interleaves their
    // characters into gibberish ("1040 DUep.aSrtm..."), and keeping one line per
    // text item produces unreadable fragments. Grouping by *typography* first
    // reconstructs each visual string in its own order, then adjacent groups are
    // re-joined when they do not overlap.
    const byTypography = new Map<string, FragmentDraft[]>();
    for (const fragment of group) {
      const key = typographyKeyOf(fragment);
      const bucket = byTypography.get(key);
      if (bucket) bucket.push(fragment);
      else byTypography.set(key, [fragment]);
    }

    const runs: FragmentDraft[] = [];
    for (const bucket of byTypography.values()) {
      const ordered = [...bucket].sort((a, b) => a.advanceStart - b.advanceStart);
      let current: FragmentDraft[] = [];
      const flushRuns = (): void => {
        if (current.length > 0) runs.push(mergeFragments(current));
        current = [];
      };
      for (const fragment of ordered) {
        const previous = current[current.length - 1];
        // Overlap inside one typography is the same string split by the
        // producer; a large positive jump is a different region entirely.
        if (previous && fragment.advanceStart - previous.advanceEnd > nearGap) flushRuns();
        current.push(fragment);
      }
      flushRuns();
    }

    runs.sort((a, b) => a.advanceStart - b.advanceStart);
    let current: FragmentDraft[] = [];
    const flush = (): void => {
      if (current.length > 0) result.push(mergeFragments(current));
      current = [];
    };
    for (const run of runs) {
      const previous = current[current.length - 1];
      if (previous) {
        const gap = run.advanceStart - previous.advanceEnd;
        if (gap > nearGap) flush();
        else if (gap < -Math.max(1, medianFontSize * 0.4)) {
          // Overlapping runs are usually separate strings sharing a baseline
          // (form lockups), but a drop cap or an inline formula is drawn as a
          // slightly larger run that sits *inside* the line. Comparable size and
          // family means "same visual line"; a big size jump means "not".
          const previousSize = runSize(previous);
          const currentSize = runSize(run);
          const comparable =
            previousSize > 0 &&
            currentSize > 0 &&
            Math.max(previousSize, currentSize) / Math.min(previousSize, currentSize) <= 1.5;
          if (!comparable) flush();
        }
      }
      current.push(run);
    }
    flush();
  }
  return result.sort((a, b) => a.advanceStart - b.advanceStart);
}

function lineFromFragment(
  fragment: FragmentDraft,
  pageIndex: number,
  rotationDeg: number,
  idFactory: IdFactory,
): BuiltLine {
  const { words, text } = buildWords(fragment.glyphs, pageIndex, idFactory);
  const bbox = unionBBoxes(words.map((word) => word.bbox));
  const pdfBox = unionBBoxes(words.map((word) => word.pdfBox));
  const typography = dominantTypography(nonWhitespace(fragment.glyphs).map((entry) => entry.glyph));
  const confidence = clamp01(average(words.map((word) => word.confidence)) - 0.03);
  return {
    line: {
      id: idFactory('line', `${textSeed(text, bbox)}|${fragment.rowIndex}:${fragment.cellIndex}`),
      pageIndex,
      text,
      glyphIds: nonWhitespace(fragment.glyphs).map((entry) => entry.glyph.id),
      wordIds: words.map((word) => word.id),
      bbox,
      pdfBox,
      baseline: fragment.cross,
      advanceStart: fragment.advanceStart,
      advanceEnd: fragment.advanceEnd,
      rotationDeg,
      direction: typography.direction,
      typography,
      alignment: 'left',
      indentPt: 0,
      rowId: fragment.tableId ? `r${fragment.tableRow ?? 0}` : '',
      cellIndex: fragment.cellIndex,
      ...(fragment.tableId ? { tableId: fragment.tableId } : {}),
      confidence,
    },
    words,
  };
}

function lineAlignment(
  line: Line,
  columnLeft: number,
  columnRight: number,
): TextAlignment {
  const size = Math.max(line.typography.fontSize, 1);
  const leftMargin = line.advanceStart - columnLeft;
  const rightMargin = columnRight - line.advanceEnd;
  const centered =
    leftMargin > size * 2 &&
    rightMargin > size * 2 &&
    Math.abs(leftMargin - rightMargin) <= Math.max(size * 1.5, (leftMargin + rightMargin) * 0.15);
  if (centered) return 'center';
  if (leftMargin > size * 2 && rightMargin <= size * 1.5) return 'right';
  return 'left';
}

/* ------------------------------------------------------- orientation build */

export interface LineEntry {
  line: Line;
  words: Word[];
  columnIndex: number;
  rotationDeg: number;
}

export interface OrientationGroup {
  rotationDeg: number;
  direction: 'ltr' | 'rtl' | 'ttb';
  entries: LineEntry[];
  gutterCount: number;
}

export interface OrientationBuildResult {
  groups: OrientationGroup[];
  tables: TableDraft[];
  /** True when at least one orientation family looked like a form. */
  formLike: boolean;
}

/**
 * Splits a page into orientation families, then builds rows, columns, tables
 * and final lines inside each family. Arbitrary-angle watermarks cannot
 * satisfy the row/column tests, so they degrade to isolated lines instead of
 * corrupting the body text.
 */
export function buildOrientationGroups(
  glyphs: readonly Glyph[],
  pageIndex: number,
  options: LayoutBuildOptions,
  idFactory: IdFactory,
  pageSpan: number,
): OrientationBuildResult {
  const buckets = new Map<number, Glyph[]>();
  for (const glyph of glyphs) {
    if (!glyph.text || glyph.typography.fontSize <= 0) continue;
    const key = rotationBucket(glyph.rotationDeg);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(glyph);
    else buckets.set(key, [glyph]);
  }

  const groups: OrientationGroup[] = [];
  const tables: TableDraft[] = [];
  let formLike = false;

  for (const [rotationDeg, bucketGlyphs] of [...buckets].sort((a, b) => b[1].length - a[1].length)) {
    const medianFontSize = Math.max(1, median(bucketGlyphs.map((glyph) => glyph.typography.fontSize)));
    const projected = bucketGlyphs.map((glyph) => projectGlyph(glyph, rotationDeg));
    const rowTolerance = Math.max(1.2, medianFontSize * 0.2);
    const rowGlyphs = buildRows(projected, rowTolerance);
    const cellGap = Math.max(options.cellGapPt ?? 4, medianFontSize * 0.9);

    const rows = rowGlyphs.map((row, rowIndex) => splitRow(row, rowIndex, cellGap));
    const bucketIsForm = looksLikeForm(rows);
    if (bucketIsForm) formLike = true;
    const gutters = bucketIsForm
      ? []
      : detectColumnGutters(rows, pageSpan, medianFontSize, options);
    for (const row of rows) {
      for (const fragment of row) {
        fragment.columnIndex = columnIndexOf(fragment.advanceStart, fragment.advanceEnd, gutters);
      }
    }

    const pageTables = detectTables(rows, medianFontSize, idFactory, options, bucketIsForm ? 3 : 2);
    tables.push(...pageTables);

    const entries: LineEntry[] = [];
    for (const row of rows) {
      for (const fragment of collapseRow(row, medianFontSize)) {
        const built = lineFromFragment(fragment, pageIndex, rotationDeg, idFactory);
        fragment.lineId = built.line.id;
        entries.push({
          line: built.line,
          words: built.words,
          columnIndex: fragment.columnIndex,
          rotationDeg,
        });
      }
    }

    const direction = bucketGlyphs[0]?.direction ?? 'ltr';
    groups.push({ rotationDeg, direction, entries, gutterCount: gutters.length });
  }

  return { groups, tables, formLike };
}

/* ------------------------------------------------------------ role hints */

interface RoleHint {
  role: ParagraphRole;
  headingLevel?: number;
  list?: ListInfo;
}

const LIST_MARKER =
  /^(\s*)((?:[•▪◦‣∙·●○■□❖➤►*+–—-])|(?:\(?\d{1,3}[.)])|(?:\(?[a-zA-Z][.)])|(?:[ivxlcdmIVXLCDM]{1,6}[.)]))\s+/u;
const PAGE_NUMBER = /^\s*(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?\s*$/i;
// "Figure 3:", "Table II -", "Exhibit A." -- a *numbered* label, which is what
// distinguishes a caption from a body line that merely starts with the word
// "Table" or "Source".
const CAPTION =
  /^(?:fig(?:ure)?|tab(?:le)?|exhibit|chart|diagram)\s*(?:\d{1,3}|[ivxlcdm]{1,6}|[a-z](?=[.:)\-–—]))\s*(?:[.:)\-–—]|\s)/i;
const CAPTION_LEAD = /^(?:source|note|notes)\s*:/i;
const FOOTNOTE_MARKER = /^\s*(?:\d{1,3}|[*†‡§¶]|\[\d{1,3}\])\s+\S/;

export function matchListMarker(text: string): { marker: string; body: string; indentChars: number } | null {
  const match = LIST_MARKER.exec(text);
  if (!match) return null;
  const marker = match[2] ?? '';
  const body = text.slice((match[0] ?? '').length).trim();
  if (!body) return null;
  return { marker, body, indentChars: (match[1] ?? '').length };
}

function roleHintFor(
  entry: LineEntry,
  bodySize: number,
  maxSize: number,
  pageSize: { width: number; height: number },
  options: LayoutBuildOptions,
): RoleHint {
  const { line } = entry;
  const text = line.text.trim();
  if (!text) return { role: 'unknown' };
  const size = Math.max(line.typography.fontSize, 0.1);
  const ratio = size / Math.max(bodySize, 0.1);

  // Page furniture is identified by position *and* size; a large title in the
  // top band is a heading, not a running header.
  const band = Math.max(0.02, Math.min(0.2, options.marginBand ?? 0.085));
  const centerY = line.bbox.y + line.bbox.height / 2;
  if (line.direction !== 'ttb') {
    const pageNumber = PAGE_NUMBER.test(text);
    if (pageNumber && (centerY < pageSize.height * 0.2 || centerY > pageSize.height * 0.8)) {
      return { role: centerY < pageSize.height / 2 ? 'header' : 'footer' };
    }
    // A marker-led line that is smaller than the body and sits in the lower part
    // of the page is a footnote, not a footer. The marker is what separates the
    // two, and a footnote is real content the editor must be able to select.
    if (
      FOOTNOTE_MARKER.test(text) &&
      ratio <= 0.92 &&
      centerY > pageSize.height * 0.6 &&
      text.length >= 12
    ) {
      return { role: 'footnote' };
    }
    if (ratio <= 1.1 && centerY < pageSize.height * band) return { role: 'header' };
    if (ratio <= 1.1 && centerY > pageSize.height * (1 - band)) return { role: 'footer' };
  }

  const letters = text.replace(/[^A-Za-z]/g, '');
  const upperRatio = letters.length >= 3 ? (text.match(/[A-Z]/g)?.length ?? 0) / letters.length : 0;
  // Size is not the only heading signal. Bold, shouted or short title-cased
  // labels are headings at the same size as the body -- exactly the case a
  // pure size-ratio rule misses.
  const boldRunIn =
    line.typography.bold &&
    ratio >= 0.95 &&
    text.length <= 80 &&
    !/[.!?,;]$/.test(text) &&
    (upperRatio >= 0.7 || text.split(/\s+/).length <= 8);
  const shoutHeading =
    upperRatio >= 0.85 &&
    letters.length >= 4 &&
    text.length <= 60 &&
    !/[.!?,;]$/.test(text) &&
    text.split(/\s+/).length <= 10;

  if (ratio >= 1.16 || boldRunIn || shoutHeading) {
    // The page's largest text is its title; everything else steps down by how
    // much bigger than the body it is. A same-size bold label is a level-3
    // heading, not a title, even though its size equals the maximum.
    const headingLevel = ratio >= 1.16 && size >= maxSize * 0.95 ? 1 : ratio >= 1.32 ? 2 : 3;
    return { role: 'heading', headingLevel };
  }

  // A numbered section heading ("1. Method") is short and set above body size;
  // only body-sized marker-led lines are list items, so the heading test above
  // must win first.
  const marker = matchListMarker(text);
  if (marker) {
    return {
      role: 'list-item',
      list: {
        ordered: /\d|[ivxlcdm]/i.test(marker.marker),
        level: 1,
        marker: marker.marker,
        body: marker.body,
        indentPt: 0,
      },
    };
  }

  if (ratio <= 1.05 && (CAPTION.test(text) || CAPTION_LEAD.test(text)) && text.length <= 240) {
    return { role: 'caption' };
  }

  return { role: 'body' };
}

/**
 * A footnote wraps: only its first line carries the marker, so the tail lines
 * are hinted as page furniture by the margin band. Above the band, a tail is
 * hinted as body text instead -- so the original test for "footer/header" left
 * the second line of a footnote as a stray body paragraph. Re-hint any
 * unmarked line that directly follows a footnote in the same column and
 * typography, whether the margin rule called it furniture or body.
 */
function absorbFootnoteTails(
  entries: readonly LineEntry[],
  hints: Map<string, RoleHint>,
  lineHeight: number,
): void {
  const buckets = new Map<string, LineEntry[]>();
  for (const entry of entries) {
    const key = `${rotationBucket(entry.rotationDeg)}|${entry.columnIndex}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }
  for (const bucket of buckets.values()) {
    const ordered = [...bucket].sort((a, b) => a.line.baseline - b.line.baseline);
    for (let i = 1; i < ordered.length; i += 1) {
      const entry = ordered[i]!;
      const hint = hints.get(entry.line.id);
      // A header can never sit below a footnote; `unknown` carries no evidence.
      if (!hint || hint.role === 'header' || hint.role === 'unknown') continue;
      // A marked line starts a new footnote, not a tail of the previous one.
      if (FOOTNOTE_MARKER.test(entry.line.text.trim())) continue;
      const previous = ordered[i - 1]!;
      const previousHint = hints.get(previous.line.id);
      if (!previousHint || previousHint.role !== 'footnote') continue;
      if (entry.line.baseline - previous.line.baseline > lineHeight * 1.8) continue;
      if (!similarTypography(previous.line, entry.line)) continue;
      // A tail is the same size, never larger. This is what keeps a body
      // paragraph that follows a not-quite-bottom footnote out of it.
      if (entry.line.typography.fontSize > previous.line.typography.fontSize * 1.05) continue;
      hints.set(entry.line.id, { role: 'footnote' });
    }
  }
}

/**
 * A heading that carries no size or weight signal is still a heading when the
 * page sets it apart: short, unpunctuated, and isolated by larger-than-normal
 * whitespace above *and* below. This is what catches `Abstract` and
 * `1 Introduction` in papers whose section heads are only a point or two larger
 * than the body.
 *
 * The promotion is deliberately narrow. Figure labels, diagram captions and
 * stray formula fragments are also short, isolated and unprompted, and on a
 * figure-heavy page they outnumber real headings; requiring body-size type and
 * body-size neighbours is what keeps them out.
 */
function promoteIsolatedHeadings(
  entries: readonly LineEntry[],
  hints: Map<string, RoleHint>,
  lineHeight: number,
  pageWidth: number,
  bodySize: number,
): void {
  const buckets = new Map<string, LineEntry[]>();
  for (const entry of entries) {
    const key = `${rotationBucket(entry.rotationDeg)}|${entry.columnIndex}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }
  for (const bucket of buckets.values()) {
    const ordered = [...bucket].sort((a, b) => a.line.baseline - b.line.baseline);
    for (let i = 1; i < ordered.length - 1; i += 1) {
      const entry = ordered[i]!;
      const hint = hints.get(entry.line.id);
      if (!hint || hint.role !== 'body') continue;
      const text = entry.line.text.trim();
      if (text.length === 0 || text.length > 60) continue;
      if (/[.,;:!?\-]$/.test(text)) continue;
      if (text.split(/\s+/).length > 9) continue;

      // Body-size type, set among body-size type: a figure's own labels are
      // smaller than the prose around them and must not become headings.
      const size = entry.line.typography.fontSize;
      if (size < bodySize * 0.95) continue;
      const previous = ordered[i - 1]!;
      const next = ordered[i + 1]!;
      if (
        previous.line.typography.fontSize < bodySize * 0.9 ||
        next.line.typography.fontSize < bodySize * 0.9
      ) {
        continue;
      }

      // Mostly letters: rejects equation fragments and interleaved text objects.
      const nonSpace = text.replace(/\s+/g, '');
      const letters = (text.match(/[A-Za-z]/g) ?? []).length;
      if (letters < 2 || letters / Math.max(1, nonSpace.length) < 0.6) continue;
      const words = text.split(/\s+/);
      // Single *letters* indicate interleaved or tabulated fragments; a leading
      // section number (`2 Related Work`) is a legitimate heading shape.
      const singleLetter = words.filter((word) => /^[A-Za-z]$/.test(word)).length;
      if (singleLetter / words.length > 0.3) continue;
      // A heading is followed by prose, not by another short label: this is what
      // separates a section title from the labels inside a diagram.
      const nextText = next.line.text.trim();
      if (nextText.length < 20) continue;
      if (next.line.advanceEnd - next.line.advanceStart < pageWidth * 0.15) continue;
      if (previous.line.text.trim().length < 20) continue;

      const width = entry.line.advanceEnd - entry.line.advanceStart;
      if (width > pageWidth * 0.55) continue;

      const above = entry.line.baseline - previous.line.baseline;
      const below = next.line.baseline - entry.line.baseline;
      if (above < lineHeight * 1.5 || below < lineHeight * 1.5) continue;
      hints.set(entry.line.id, { role: 'heading', headingLevel: 3 });
    }
  }
}

function computeBodySize(entries: readonly LineEntry[]): number {
  const weights = new Map<number, number>();
  for (const entry of entries) {
    const text = entry.line.text.trim();
    if (!text) continue;
    const size = Math.round(entry.line.typography.fontSize * 4) / 4;
    // Weight by *inked area* (characters x size), not characters alone: a long
    // footnote set two points small would otherwise out-vote the body text and
    // become the page's reference size, which then makes the footnote look
    // body-sized and the real body look oversized.
    weights.set(size, (weights.get(size) ?? 0) + text.length * size);
  }
  let bestSize = 0;
  let bestWeight = -1;
  for (const [size, weight] of weights) {
    if (weight > bestWeight) {
      bestSize = size;
      bestWeight = weight;
    }
  }
  return bestSize > 0 ? bestSize : 10;
}

function computeLineHeight(
  entries: readonly LineEntry[],
  hints: ReadonlyMap<string, RoleHint>,
  bodySize: number,
): number {
  const buckets = new Map<string, LineEntry[]>();
  for (const entry of entries) {
    const key = `${rotationBucket(entry.rotationDeg)}|${entry.columnIndex}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }
  const gaps: number[] = [];
  for (const bucket of buckets.values()) {
    const ordered = [...bucket].sort((a, b) => a.line.baseline - b.line.baseline);
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1]!;
      const current = ordered[i]!;
      const previousRole = hints.get(previous.line.id)?.role;
      const currentRole = hints.get(current.line.id)?.role;
      if (previousRole !== currentRole) continue;
      const gap = current.line.baseline - previous.line.baseline;
      const maxGap = Math.max(previous.line.typography.fontSize, current.line.typography.fontSize) * 2.6;
      if (gap > 0.5 && gap <= maxGap) gaps.push(gap);
    }
  }
  const measured = median(gaps);
  return measured > 0 ? measured : Math.max(4, bodySize * 1.25);
}

interface ColumnBounds {
  left: number;
  right: number;
  /**
   * Median right edge of the column's lines. A line is "short" (paragraph-final)
   * only relative to this, because ragged-right text makes individual lines end
   * well short of the column edge without ending the paragraph.
   */
  typicalEnd: number;
}

function columnKey(rotationDeg: number, columnIndex: number): string {
  return `${rotationBucket(rotationDeg)}|${columnIndex}`;
}

function computeColumnBounds(
  entries: readonly LineEntry[],
  hints: ReadonlyMap<string, RoleHint>,
  pageWidth: number,
): Map<string, ColumnBounds> {
  const bounds = new Map<string, ColumnBounds>();
  const ends = new Map<string, number[]>();
  for (const entry of entries) {
    // Spanning content (columnIndex -1) gets its own bucket: a full-measure
    // paragraph must be measured against its own right edge, not the page edge,
    // or every one of its lines looks "short" and the paragraph is shattered.
    const role = hints.get(entry.line.id)?.role;
    if (role === 'header' || role === 'footer') continue;
    const key = columnKey(entry.rotationDeg, entry.columnIndex);
    const existing = bounds.get(key);
    if (existing) {
      existing.left = Math.min(existing.left, entry.line.advanceStart);
      existing.right = Math.max(existing.right, entry.line.advanceEnd);
    } else {
      bounds.set(key, {
        left: entry.line.advanceStart,
        right: entry.line.advanceEnd,
        typicalEnd: entry.line.advanceEnd,
      });
    }
    const list = ends.get(key);
    if (list) list.push(entry.line.advanceEnd);
    else ends.set(key, [entry.line.advanceEnd]);
  }
  for (const [key, box] of bounds) {
    if (!Number.isFinite(box.left) || !Number.isFinite(box.right) || box.right <= box.left) {
      box.left = 0;
      box.right = pageWidth;
    }
    const list = ends.get(key);
    box.typicalEnd = list && list.length > 0 ? median(list) : box.right;
  }
  return bounds;
}

function boundsFor(
  entry: LineEntry,
  columnBounds: ReadonlyMap<string, ColumnBounds>,
  pageWidth: number,
): ColumnBounds {
  return (
    columnBounds.get(columnKey(entry.rotationDeg, entry.columnIndex)) ?? {
      left: 0,
      right: pageWidth,
      typicalEnd: pageWidth,
    }
  );
}

/* ------------------------------------------------------------- paragraphs */

interface ParagraphDraft {
  lines: Line[];
  text: string;
  spans: ParagraphLineSpan[];
  role: ParagraphRole;
  headingLevel?: number;
  list?: ListInfo;
  tableId?: string;
  cell?: { row: number; column: number; rowSpan: number; colSpan: number };
  ambiguous: boolean;
  confidence: number;
  columnIndex: number;
  rotationDeg: number;
  /** P(continuation) for every internal line join, from `mergeDecision`. */
  scores: number[];
  /** P(continuation) across the break before this paragraph. */
  startBoundary?: number;
  /** P(continuation) across the break after this paragraph. */
  endBoundary?: number;
}

function trimLineText(line: Line): string {
  return line.text.trim();
}

function separatorBetween(previous: Line, current: Line): string {
  const a = previous.text.trimEnd();
  const b = current.text.trimStart();
  if (!a || !b) return '';
  if (a.endsWith('-')) return '';
  const last = a[a.length - 1] ?? '';
  const first = b[0] ?? '';
  if (isCjk(last) || isCjk(first)) return '';
  return ' ';
}

function startDraft(entry: LineEntry, hint: RoleHint): ParagraphDraft {
  const line = entry.line;
  const text = hint.list ? hint.list.body : trimLineText(line);
  return {
    lines: [line],
    text,
    spans: [{ lineId: line.id, start: 0, end: text.length, separatorAfter: '' }],
    role: hint.role,
    ...(hint.headingLevel ? { headingLevel: hint.headingLevel } : {}),
    ...(hint.list ? { list: hint.list } : {}),
    ...(line.tableId ? { tableId: line.tableId } : {}),
    ...(line.tableId
      ? {
          cell: {
            row: Number.parseInt(line.rowId.replace(/^r/, ''), 10) || 0,
            column: line.cellIndex,
            rowSpan: 1,
            colSpan: 1,
          },
        }
      : {}),
    ambiguous: false,
    confidence: line.confidence,
    columnIndex: entry.columnIndex,
    rotationDeg: entry.rotationDeg,
    scores: [],
  };
}

function appendToDraft(draft: ParagraphDraft, entry: LineEntry, previous: LineEntry): void {
  const line = entry.line;
  const separator = separatorBetween(previous.line, line);
  const addition = trimLineText(line);
  const start = draft.text.length + separator.length;
  const previousSpan = draft.spans[draft.spans.length - 1];
  if (previousSpan) previousSpan.separatorAfter = separator;
  draft.text = draft.text ? `${draft.text}${separator}${addition}` : addition;
  draft.spans.push({
    lineId: line.id,
    start,
    end: start + addition.length,
    separatorAfter: '',
  });
  draft.lines.push(line);
}

function similarTypography(previous: Line, current: Line): boolean {
  const a = previous.typography;
  const b = current.typography;
  const ratio = b.fontSize / Math.max(a.fontSize, 0.1);
  if (ratio < 0.86 || ratio > 1.16) return false;
  if (a.fontFamily !== b.fontFamily) return false;
  return true;
}

interface MergeDecision {
  merge: boolean;
  ambiguous: boolean;
  /**
   * Confidence in the *decision* (0.5 = coin flip, 1 = certain), whether that
   * decision is "merge" or "break". Using one scale for both is what lets
   * `draftConfidence` read a boundary term as "how sure am I that this really is
   * a boundary" instead of as a probability of continuation.
   */
  score: number;
}

/**
 * Decides whether `currentEntry` continues the open paragraph.
 *
 * Every branch returns a `score` as well as a boolean: a decision made a hair
 * inside a threshold is uncertain, a decision made well inside it is not. That
 * score is what makes `Paragraph.confidence` informative instead of a constant.
 */
function mergeDecision(
  previousEntry: LineEntry,
  currentEntry: LineEntry,
  draft: ParagraphDraft,
  currentHint: RoleHint,
  bodySize: number,
  lineHeight: number,
  bounds: ColumnBounds,
): MergeDecision {
  const previous = previousEntry.line;
  const current = currentEntry.line;
  const breakAll: MergeDecision = { merge: false, ambiguous: false, score: 0.95 };
  if (previous.tableId || current.tableId || draft.tableId) return breakAll;
  if (currentHint.role === 'list-item') return { merge: false, ambiguous: false, score: 0.9 };

  const gap = current.baseline - previous.baseline;
  if (gap <= 0) return breakAll;
  const size = Math.max(previous.typography.fontSize, 1);
  // All pair geometry comes from the relations engine so grouping, reflow and
  // the confidence report measure the same things the same way.
  const relation = relateLines(previous, current, {
    linePitch: lineHeight,
    column: { left: bounds.left, right: bounds.right, typicalEnd: bounds.typicalEnd },
  });
  const gapRatio = relation.gapRatio;

  if (draft.role === 'list-item') {
    if (currentHint.role === 'header' || currentHint.role === 'footer') return breakAll;
    const sameFont = similarTypography(previous, current);
    const continuationIndent = draft.list?.indentPt ?? 0;
    const indent = current.advanceStart - bounds.left;
    const merge = gapRatio <= 1.8 && sameFont && indent >= continuationIndent - size * 0.4;
    return {
      merge,
      ambiguous: merge && gapRatio > 1.55,
      score: merge ? clamp01(1 - (gapRatio - 1) / 1.6) : 0.7,
    };
  }

  if (currentHint.role === 'header' || currentHint.role === 'footer') {
    const merge = draft.role === currentHint.role && gapRatio <= 1.8;
    return { merge, ambiguous: false, score: merge ? 0.8 : 0.9 };
  }
  if (draft.role === 'header' || draft.role === 'footer') return breakAll;

  if (draft.role === 'heading' || currentHint.role === 'heading') {
    const sameHeading =
      draft.role === 'heading' &&
      currentHint.role === 'heading' &&
      draft.headingLevel === currentHint.headingLevel;
    const merge = sameHeading && similarTypography(previous, current) && gapRatio <= 1.8;
    return { merge, ambiguous: merge && gapRatio > 1.5, score: merge ? 0.85 : 0.9 };
  }

  if (draft.role === 'caption' || currentHint.role === 'caption') {
    const bothCaption = draft.role === 'caption' && currentHint.role === 'caption';
    // A wrapped caption's tail is hinted `body` (it no longer starts with
    // "Figure N"), so set-at-caption-size plus a tight gap is what keeps it
    // with its caption instead of becoming a stray one-line paragraph.
    const captionTail =
      draft.role === 'caption' &&
      currentHint.role === 'body' &&
      similarTypography(previous, current) &&
      current.typography.fontSize <= bodySize * 1.02 &&
      gapRatio <= 1.5;
    const merge =
      (bothCaption || captionTail) && similarTypography(previous, current) && gapRatio <= 1.8;
    return {
      merge,
      ambiguous: merge && captionTail,
      score: merge ? (captionTail ? 0.7 : 0.85) : 0.8,
    };
  }

  if (draft.role !== currentHint.role) return breakAll;
  if (!similarTypography(previous, current)) return breakAll;

  // 1.4x the measured line pitch. Real paragraphs separate by 1.45-1.8x, so a
  // looser cut merged every second paragraph in the corpus.
  const BREAK_RATIO = 1.4;
  if (gapRatio > BREAK_RATIO) {
    return {
      merge: false,
      ambiguous: gapRatio < BREAK_RATIO + 0.25,
      score: clamp01(0.5 + (gapRatio - BREAK_RATIO) * 2),
    };
  }

  const columnWidth = Math.max(1, bounds.right - bounds.left);
  // "Short" is relative to how this column's lines usually end, not to the
  // column edge: ragged-right text leaves gaps mid-paragraph.
  const previousShort =
    previous.advanceEnd <
    bounds.typicalEnd - Math.max(size * 2, columnWidth * 0.18);
  if (previousShort) return { merge: false, ambiguous: false, score: 0.8 };

  if (relation.indentDelta > Math.max(2, size * 0.6)) {
    return { merge: false, ambiguous: false, score: 0.75 };
  }

  const previousAlignment = lineAlignment(previous, bounds.left, bounds.right);
  const currentAlignment = lineAlignment(current, bounds.left, bounds.right);
  if (
    (previousAlignment === 'center' || previousAlignment === 'right') &&
    previousAlignment !== currentAlignment
  ) {
    return { merge: false, ambiguous: false, score: 0.7 };
  }

  const ratio = current.typography.fontSize / Math.max(previous.typography.fontSize, 0.1);
  const ambiguous = gapRatio > 1.2 || (bodySize > 0 && Math.abs(ratio - 1) > 0.09);
  const gapMargin = clamp01((BREAK_RATIO - gapRatio) / (BREAK_RATIO - 1));
  const sizeMargin = clamp01(1 - Math.abs(ratio - 1) / 0.16);
  return {
    merge: true,
    ambiguous,
    // Blend the threshold margin with the measured pair relationship: a pair
    // that also shares an edge and the same typography is more trustworthy than
    // one that only squeaked under the gap cut-off.
    score: clamp01(0.25 + 0.3 * gapMargin + 0.25 * relation.continuation + 0.2 * sizeMargin),
  };
}

function buildParagraphDrafts(
  entries: readonly LineEntry[],
  hints: ReadonlyMap<string, RoleHint>,
  columnBounds: ReadonlyMap<string, ColumnBounds>,
  bodySize: number,
  lineHeight: number,
  pageWidth: number,
): ParagraphDraft[] {
  const drafts: ParagraphDraft[] = [];
  const buckets = new Map<string, LineEntry[]>();

  for (const entry of entries) {
    if (!trimLineText(entry.line)) continue;
    if (entry.line.tableId) {
      // A table cell is its own paragraph; it never absorbs a neighbour.
      drafts.push(startDraft(entry, { role: 'table-cell' }));
      continue;
    }
    const key = `${rotationBucket(entry.rotationDeg)}|${entry.columnIndex}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }

  for (const bucket of buckets.values()) {
    const ordered = [...bucket].sort(
      (a, b) => a.line.baseline - b.line.baseline || a.line.advanceStart - b.line.advanceStart,
    );
    let current: ParagraphDraft | null = null;
    let previousEntry: LineEntry | null = null;

    for (const entry of ordered) {
      const hint = hints.get(entry.line.id) ?? { role: 'body' };
      const bounds = boundsFor(entry, columnBounds, pageWidth);
      if (!current || !previousEntry) {
        current = startDraft(entry, hint);
        previousEntry = entry;
        continue;
      }
      const decision = mergeDecision(
        previousEntry,
        entry,
        current,
        hint,
        bodySize,
        lineHeight,
        bounds,
      );
      if (decision.merge) {
        appendToDraft(current, entry, previousEntry);
        current.scores.push(decision.score);
        current.ambiguous ||= decision.ambiguous;
      } else {
        current.endBoundary = decision.score;
        drafts.push(current);
        current = startDraft(entry, hint);
        current.startBoundary = decision.score;
      }
      previousEntry = entry;
    }
    if (current) drafts.push(current);
  }

  return drafts;
}

function roleCertainty(draft: ParagraphDraft, bodySize: number): number {
  const size = draft.lines[0]?.typography.fontSize ?? bodySize;
  const ratio = size / Math.max(bodySize, 0.1);
  switch (draft.role) {
    case 'heading':
      // A heading two steps larger than the body is unambiguous; a bold
      // same-size label is a judgement call.
      if (ratio >= 1.16) return 0.95;
      return draft.lines[0]?.typography.bold ? 0.85 : 0.7;
    case 'caption':
      return 0.78;
    case 'footnote':
      return 0.75;
    case 'header':
    case 'footer':
      return 0.88;
    case 'list-item':
      return 0.9;
    case 'table-cell':
      return 0.72;
    default:
      return 0.8;
  }
}

/**
 * Paragraph confidence from evidence, not from opinion.
 *
 * `internal` is how strongly each join argued for continuation; the boundary
 * terms are how sure the cut was a real boundary. A confident break (a large
 * gap, a different role) leaves confidence untouched; a weak break -- one made
 * on a marginal signal -- lowers it, because the paragraph may have been cut
 * where it should have continued.
 */
function draftConfidence(draft: ParagraphDraft, bodySize: number): number {
  const internal =
    draft.scores.length > 0 ? average(draft.scores) : roleCertainty(draft, bodySize);
  const boundaryFactor = (score: number | undefined): number =>
    score === undefined ? 1 : 0.55 + 0.45 * clamp01(score);
  return clamp01(
    internal * boundaryFactor(draft.startBoundary) * boundaryFactor(draft.endBoundary),
  );
}

function paragraphAlignment(draft: ParagraphDraft, bounds: ColumnBounds): TextAlignment {
  const counts = new Map<TextAlignment, number>();
  for (const line of draft.lines) {
    const alignment = lineAlignment(line, bounds.left, bounds.right);
    counts.set(alignment, (counts.get(alignment) ?? 0) + 1);
  }
  const total = draft.lines.length;
  if ((counts.get('center') ?? 0) >= Math.max(1, total * 0.6)) return 'center';
  if ((counts.get('right') ?? 0) >= Math.max(1, total * 0.6)) return 'right';
  if (total >= 2) {
    const nonLast = draft.lines.slice(0, -1);
    const justified =
      nonLast.length > 0 &&
      nonLast.every((line) => {
        const size = Math.max(line.typography.fontSize, 1);
        return (
          line.advanceStart - bounds.left <= size * 1.6 &&
          bounds.right - line.advanceEnd <= size * 1.6
        );
      });
    if (justified) return 'justify';
  }
  return 'left';
}

interface MaterializedParagraphs {
  paragraphs: Paragraph[];
  columnByParagraph: Map<string, number>;
}

function materializeParagraphs(
  drafts: readonly ParagraphDraft[],
  pageIndex: number,
  idFactory: IdFactory,
  columnBounds: ReadonlyMap<string, ColumnBounds>,
  pageWidth: number,
  bodySize: number,
): MaterializedParagraphs {
  const paragraphs: Paragraph[] = [];
  const columnByParagraph = new Map<string, number>();

  for (const draft of drafts) {
    const text = draft.text.trim();
    if (!text) continue;
    const bbox = unionBBoxes(draft.lines.map((line) => line.bbox));
    const pdfBox = unionBBoxes(draft.lines.map((line) => line.pdfBox));
    const bounds =
      columnBounds.get(columnKey(draft.rotationDeg, draft.columnIndex)) ?? {
        left: 0,
        right: pageWidth,
        typicalEnd: pageWidth,
      };
    const alignment = paragraphAlignment(draft, bounds);
    const firstLine = draft.lines[0]!;
    const indentPt =
      draft.columnIndex >= 0 ? Math.max(0, firstLine.advanceStart - bounds.left) : 0;
    const confidence = draftConfidence(draft, bodySize);
    const id = idFactory('para', `${textSeed(text, bbox)}|${draft.lines.length}`);
    for (const line of draft.lines) line.alignment = alignment;
    const paragraph: Paragraph = {
      id,
      pageIndex,
      lineIds: draft.lines.map((line) => line.id),
      text,
      lineSpans: draft.spans,
      bbox,
      pdfBox,
      typography: firstLine.typography,
      alignment,
      indentPt,
      role: draft.role,
      ...(draft.headingLevel ? { headingLevel: draft.headingLevel } : {}),
      ...(draft.list ? { list: { ...draft.list, body: text } } : {}),
      ...(draft.tableId ? { tableId: draft.tableId } : {}),
      ...(draft.cell ? { cell: draft.cell } : {}),
      confidence,
      ambiguous: draft.ambiguous,
    };
    paragraphs.push(paragraph);
    columnByParagraph.set(id, draft.columnIndex);
  }

  return { paragraphs, columnByParagraph };
}

/* ------------------------------------------------------------ tables/blocks */

function buildTableModels(
  drafts: readonly TableDraft[],
  entries: readonly LineEntry[],
  paragraphs: readonly Paragraph[],
): TableModel[] {
  const lineById = new Map(entries.map((entry) => [entry.line.id, entry.line]));
  const paragraphByLine = new Map<string, Paragraph>();
  for (const paragraph of paragraphs) {
    for (const span of paragraph.lineSpans) paragraphByLine.set(span.lineId, paragraph);
  }

  const models: TableModel[] = [];
  for (const draft of drafts) {
    interface CellSource {
      fragment: FragmentDraft;
      line: Line;
      paragraph: Paragraph;
      row: number;
      start: number;
      end: number;
    }
    const cells: CellSource[] = [];
    draft.rows.forEach((row, rowIndex) => {
      row.forEach((fragment) => {
        if (!fragment.lineId) return;
        const line = lineById.get(fragment.lineId);
        if (!line) return;
        const paragraph = paragraphByLine.get(line.id);
        if (!paragraph) return;
        cells.push({
          fragment,
          line,
          paragraph,
          row: rowIndex,
          start: fragment.advanceStart,
          end: fragment.advanceEnd,
        });
      });
    });
    if (cells.length < 4) continue;

    // Columns are the gutters between cells, not clusters of cell *starts*.
    // Clustering starts split a right-aligned numeric column into one cluster
    // per number width ("7" and "12,345" start at different x), which reported a
    // two-column table as three. The gutter between column i and i+1 is measured
    // on every row and averaged; each cell is then assigned by its midpoint,
    // which is independent of the cell's own width.
    const gapCount = Math.max(0, (draft.rows[0]?.length ?? 0) - 1);
    const gutters: number[] = [];
    for (let gap = 0; gap < gapCount; gap += 1) {
      const mids = draft.rows
        .map((row) => {
          const left = row[gap];
          const right = row[gap + 1];
          return left && right ? (left.advanceEnd + right.advanceStart) / 2 : null;
        })
        .filter((mid): mid is number => mid !== null);
      if (mids.length > 0) gutters.push(average(mids));
    }
    if (gutters.length < 1) continue;

    const columnOf = (start: number, end: number): number => {
      const mid = (start + end) / 2;
      let index = 0;
      for (const gutter of gutters) if (mid >= gutter) index += 1;
      return index;
    };

    const rows: TableRow[] = [];
    const tableCells: TableCell[] = [];
    const usedByRow = new Map<number, Set<number>>();
    for (const cell of cells) {
      let column = columnOf(cell.start, cell.end);
      const used = usedByRow.get(cell.row) ?? new Set<number>();
      while (used.has(column)) column += 1;
      used.add(column);
      usedByRow.set(cell.row, used);
      cell.line.cellIndex = column;
      cell.paragraph.cell = { row: cell.row, column, rowSpan: 1, colSpan: 1 };
      const tableCell: TableCell = {
        paragraphId: cell.paragraph.id,
        lineId: cell.line.id,
        text: cell.paragraph.text,
        bbox: cell.line.bbox,
        pdfBox: cell.line.pdfBox,
        row: cell.row,
        column,
        rowSpan: 1,
        colSpan: 1,
      };
      tableCells.push(tableCell);
      const row = rows[cell.row];
      if (row) {
        row.cells.push(tableCell);
      } else {
        rows[cell.row] = { index: cell.row, bbox: cell.line.bbox, cells: [tableCell] };
      }
    }

    const filledRows: TableRow[] = [];
    for (let index = 0; index < draft.rows.length; index += 1) {
      const row = rows[index];
      if (!row) continue;
      row.cells.sort((a, b) => a.column - b.column);
      row.bbox = unionBBoxes(row.cells.map((cell) => cell.bbox));
      filledRows.push(row);
    }
    if (filledRows.length < 2) continue;

    const columnCount = Math.max(
      gutters.length + 1,
      ...filledRows.map((row) => Math.max(...row.cells.map((cell) => cell.column)) + 1),
    );
    const tableLeft = Math.min(...cells.map((cell) => cell.start));
    const tableRight = Math.max(...cells.map((cell) => cell.end));
    const columns = Array.from({ length: columnCount }, (_, index) => ({
      x0: index === 0 ? tableLeft : gutters[index - 1] ?? tableRight,
      x1: index === columnCount - 1 ? tableRight : gutters[index] ?? tableRight,
    }));
    const paragraphsById = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]));
    const confidence = average(
      filledRows.flatMap((row) =>
        row.cells.map((cell) => paragraphsById.get(cell.paragraphId)?.confidence ?? 0.5),
      ),
    );
    models.push({
      id: draft.id,
      pageIndex: paragraphs[0]?.pageIndex ?? 0,
      bbox: unionBBoxes(filledRows.map((row) => row.bbox)),
      pdfBox: unionBBoxes(
        filledRows.flatMap((row) => row.cells.map((cell) => cell.pdfBox)),
      ),
      rowCount: filledRows.length,
      columnCount,
      columns,
      rows: filledRows,
      confidence: clamp01(confidence),
    });
  }

  // A cell paragraph whose table did not survive validation must not keep
  // pointing at it: nothing would own it, so it would vanish from blocks,
  // regions and reading order while still existing in `paragraphs`. Demote the
  // whole candidate back to ordinary body text.
  const kept = new Set(models.map((model) => model.id));
  for (const paragraph of paragraphs) {
    const tableId = paragraph.tableId;
    if (!tableId || kept.has(tableId)) continue;
    delete paragraph.tableId;
    delete paragraph.cell;
    paragraph.role = 'body';
    for (const lineId of paragraph.lineIds) {
      const line = lineById.get(lineId);
      if (!line || line.tableId !== tableId) continue;
      delete line.tableId;
      line.rowId = '';
    }
  }
  for (const entry of entries) {
    const line = entry.line;
    if (line.tableId && !kept.has(line.tableId)) {
      delete line.tableId;
      line.rowId = '';
    }
  }

  return models;
}

function paragraphKind(paragraph: Paragraph): BlockKind {
  switch (paragraph.role) {
    case 'heading':
      return 'heading';
    case 'list-item':
      return 'list';
    case 'caption':
      return 'caption';
    case 'footnote':
      return 'footnote';
    case 'table-cell':
      return 'table';
    case 'header':
      return 'header';
    case 'footer':
      return 'footer';
    case 'body':
      return 'body';
    default:
      return 'unknown';
  }
}

function buildBlocks(
  paragraphs: readonly Paragraph[],
  tables: readonly TableModel[],
  columnByParagraph: ReadonlyMap<string, number>,
  lineHeight: number,
  idFactory: IdFactory,
): TextBlock[] {
  const blocks: TextBlock[] = [];
  const tableParagraphs = new Set(
    tables.flatMap((table) => table.rows.flatMap((row) => row.cells.map((cell) => cell.paragraphId))),
  );
  const paragraphById = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]));

  for (const table of tables) {
    const ids = table.rows.flatMap((row) => row.cells.map((cell) => cell.paragraphId));
    const first = paragraphById.get(ids[0] ?? '');
    if (!first) continue;
    blocks.push({
      id: idFactory('block', `${textSeed(first.text, table.bbox)}|table`),
      pageIndex: first.pageIndex,
      paragraphIds: ids,
      bbox: table.bbox,
      pdfBox: table.pdfBox,
      kind: 'table',
      columnIndex: columnByParagraph.get(first.id) ?? -1,
      style: { typography: first.typography, alignment: first.alignment },
      tableId: table.id,
      confidence: table.confidence,
      ambiguous: ids.some((id) => paragraphById.get(id)?.ambiguous ?? false),
    });
  }

  const buckets = new Map<string, Paragraph[]>();
  for (const paragraph of paragraphs) {
    if (paragraph.tableId || tableParagraphs.has(paragraph.id)) continue;
    const columnIndex = columnByParagraph.get(paragraph.id) ?? -1;
    const kind = paragraphKind(paragraph);
    const key = `${rotationBucket(paragraph.typography.rotationDeg)}|${columnIndex}|${kind}|${paragraph.headingLevel ?? 0}|${paragraph.list?.level ?? 0}|${paragraph.alignment}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(paragraph);
    else buckets.set(key, [paragraph]);
  }

  for (const bucket of buckets.values()) {
    const ordered = [...bucket].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
    let current: Paragraph[] = [];
    const flush = (): void => {
      const first = current[0];
      if (!first) {
        current = [];
        return;
      }
      const ids = current.map((paragraph) => paragraph.id);
      const bbox = unionBBoxes(current.map((paragraph) => paragraph.bbox));
      blocks.push({
        id: idFactory('block', `${textSeed(first.text, bbox)}|${paragraphKind(first)}`),
        pageIndex: first.pageIndex,
        paragraphIds: ids,
        bbox,
        pdfBox: unionBBoxes(current.map((paragraph) => paragraph.pdfBox)),
        kind: paragraphKind(first),
        columnIndex: columnByParagraph.get(first.id) ?? -1,
        style: { typography: first.typography, alignment: first.alignment },
        ...(first.headingLevel ? { headingLevel: first.headingLevel } : {}),
        ...(first.list ? { list: { ...first.list } } : {}),
        ...(first.tableId ? { tableId: first.tableId } : {}),
        confidence: clamp01(
          average(current.map((paragraph) => paragraph.confidence)) -
            (current.some((paragraph) => paragraph.ambiguous) ? 0.05 : 0),
        ),
        ambiguous: current.some((paragraph) => paragraph.ambiguous),
      });
      current = [];
    };

    for (const paragraph of ordered) {
      const previous = current[current.length - 1];
      if (previous) {
        const gap = paragraph.bbox.y - (previous.bbox.y + previous.bbox.height);
        const sameRole = paragraph.role === previous.role;
        const sameListLevel = (paragraph.list?.level ?? 0) === (previous.list?.level ?? 0);
        const sameHeading = (paragraph.headingLevel ?? 0) === (previous.headingLevel ?? 0);
        if (
          !sameRole ||
          !sameListLevel ||
          !sameHeading ||
          gap > Math.max(lineHeight * 1.1, paragraph.typography.fontSize * 1.6) ||
          gap < -lineHeight
        ) {
          flush();
        }
      }
      current.push(paragraph);
    }
    flush();
  }

  return blocks;
}

/* ------------------------------------------------------- columns / regions */

function activeRotation(entries: readonly LineEntry[]): number | null {
  if (entries.length === 0) return null;
  const weights = new Map<number, number>();
  for (const entry of entries) {
    const key = rotationBucket(entry.rotationDeg);
    weights.set(key, (weights.get(key) ?? 0) + entry.line.text.length);
  }
  if (weights.has(0)) return 0;
  let best: number | null = null;
  let bestWeight = -1;
  for (const [rotation, weight] of weights) {
    if (weight > bestWeight) {
      best = rotation;
      bestWeight = weight;
    }
  }
  return best;
}

function buildColumnModels(
  entries: readonly LineEntry[],
  columnBounds: ReadonlyMap<string, ColumnBounds>,
  blocks: readonly TextBlock[],
  paragraphs: readonly Paragraph[],
  rotation: number | null,
  pageWidth: number,
): ColumnModel[] {
  if (rotation === null || entries.length === 0) return [];
  const rotationKey = rotationBucket(rotation);
  const indexes = new Set<number>();
  for (const entry of entries) {
    if (rotationBucket(entry.rotationDeg) !== rotationKey) continue;
    if (entry.columnIndex >= 0) indexes.add(entry.columnIndex);
  }
  if (indexes.size === 0) indexes.add(0);
  const maximum = Math.max(...indexes);
  const paragraphById = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]));
  const columns: ColumnModel[] = [];

  for (let index = 0; index <= maximum; index += 1) {
    if (!indexes.has(index)) continue;
    const columnEntries = entries.filter(
      (entry) =>
        rotationBucket(entry.rotationDeg) === rotationKey && entry.columnIndex === index,
    );
    if (columnEntries.length === 0) continue;
    const bounds = columnBounds.get(columnKey(rotation, index)) ?? {
      left: Math.min(...columnEntries.map((entry) => entry.line.advanceStart)),
      right: Math.max(...columnEntries.map((entry) => entry.line.advanceEnd)),
    };
    const columnBlocks = blocks.filter((block) => block.columnIndex === index);
    const paragraphIds = columnBlocks.flatMap((block) => block.paragraphIds);
    columns.push({
      index,
      x0: Number.isFinite(bounds.left) ? bounds.left : 0,
      x1: Number.isFinite(bounds.right) ? bounds.right : pageWidth,
      top: Math.min(...columnEntries.map((entry) => entry.line.bbox.y)),
      bottom: Math.max(
        ...columnEntries.map((entry) => entry.line.bbox.y + entry.line.bbox.height),
      ),
      blockIds: columnBlocks.map((block) => block.id),
      paragraphIds,
      confidence: clamp01(
        average(
          paragraphIds.map((id) => paragraphById.get(id)?.confidence ?? 0.5),
        ),
      ),
    });
  }
  return columns;
}

function buildRegions(
  blocks: readonly TextBlock[],
  columns: readonly ColumnModel[],
  pageWidth: number,
  pageHeight: number,
  idFactory: IdFactory,
): Region[] {
  const regions: Region[] = [];
  const headers = blocks.filter((block) => block.kind === 'header');
  const footers = blocks.filter((block) => block.kind === 'footer');
  const tables = blocks.filter((block) => block.kind === 'table');
  const content = blocks.filter(
    (block) => block.kind !== 'header' && block.kind !== 'footer' && block.kind !== 'table',
  );

  const makeRegion = (
    kind: RegionKind,
    list: readonly TextBlock[],
    columnIndex?: number,
  ): void => {
    if (list.length === 0) return;
    const bbox = unionBBoxes(list.map((block) => block.bbox));
    regions.push({
      id: idFactory('region', `${kind}|${Math.round(bbox.x)},${Math.round(bbox.y)}|${list.length}`),
      pageIndex: list[0]!.pageIndex,
      blockIds: list.map((block) => block.id),
      bbox,
      pdfBox: unionBBoxes(list.map((block) => block.pdfBox)),
      kind,
      ...(columnIndex !== undefined ? { columnIndex } : {}),
      confidence: clamp01(average(list.map((block) => block.confidence))),
    });
  };

  makeRegion('header', headers);
  makeRegion('footer', footers);
  for (const table of tables) makeRegion('table', [table]);

  if (columns.length > 1) {
    for (const column of columns) {
      makeRegion(
        'column',
        content.filter((block) => block.columnIndex === column.index),
        column.index,
      );
    }
    makeRegion(
      'content',
      content.filter((block) => block.columnIndex < 0),
    );
  } else {
    makeRegion('content', content);
  }

  // A page with no visible text still has a content frame, which the editor
  // uses to place newly added text.
  if (regions.length === 0) {
    regions.push({
      id: idFactory('region', 'empty'),
      pageIndex: blocks[0]?.pageIndex ?? 0,
      blockIds: [],
      bbox: { x: 0, y: 0, width: pageWidth, height: pageHeight },
      pdfBox: { x: 0, y: 0, width: pageWidth, height: pageHeight },
      kind: 'content',
      confidence: 0,
    });
  }
  return regions;
}

/* --------------------------------------------------------- reading order */

function orderBlocks(blocks: readonly TextBlock[]): TextBlock[] {
  const byColumnThenTop = (a: TextBlock, b: TextBlock): number =>
    a.columnIndex - b.columnIndex || a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x;
  const headers = blocks.filter((block) => block.kind === 'header').sort(byColumnThenTop);
  const footers = blocks.filter((block) => block.kind === 'footer').sort(byColumnThenTop);
  const body = blocks.filter((block) => block.kind !== 'header' && block.kind !== 'footer');
  const spanning = body
    .filter((block) => block.columnIndex < 0)
    .sort((a, b) => a.bbox.y - b.bbox.y);
  let remaining = body.filter((block) => block.columnIndex >= 0);
  const ordered: TextBlock[] = [...headers];

  for (const span of spanning) {
    // Everything that starts above a spanning block belongs to the band before
    // it; that is what makes "headline, left column, right column, headline"
    // come out in the order a reader would scan.
    const above = remaining.filter((block) => block.bbox.y < span.bbox.y - 1);
    above.sort(byColumnThenTop);
    ordered.push(...above);
    const aboveSet = new Set(above);
    remaining = remaining.filter((block) => !aboveSet.has(block));
    ordered.push(span);
  }
  remaining.sort(byColumnThenTop);
  ordered.push(...remaining, ...footers);
  return ordered;
}

/* ------------------------------------------------------------------ stats */

function coverageRatio(
  entries: readonly LineEntry[],
  pageWidth: number,
  pageHeight: number,
): number {
  if (pageWidth <= 0 || pageHeight <= 0 || entries.length === 0) return 0;
  const step = 8;
  // Numeric cell keys avoid a string allocation per covered cell. The stride is
  // far larger than any real page's cell count (8.4M points), so it cannot
  // collide; the count is the only thing this ratio consumes.
  const stride = 1_048_576;
  const cells = new Set<number>();
  for (const entry of entries) {
    const { x, y, width, height } = entry.line.bbox;
    const x0 = Math.floor(x / step);
    const y0 = Math.floor(y / step);
    const x1 = Math.floor((x + Math.max(0, width)) / step);
    const y1 = Math.floor((y + Math.max(0, height)) / step);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) cells.add(cx * stride + cy);
    }
  }
  return clamp01((cells.size * step * step) / (pageWidth * pageHeight));
}

function weightedMedian(values: readonly number[], weights: readonly number[]): number {
  if (values.length === 0) return 0;
  const pairs = values
    .map((value, index) => ({ value, weight: Math.max(0.01, weights[index] ?? 1) }))
    .sort((a, b) => a.value - b.value);
  const total = pairs.reduce((sum, pair) => sum + pair.weight, 0);
  let running = 0;
  for (const pair of pairs) {
    running += pair.weight;
    if (running >= total / 2) return pair.value;
  }
  return pairs[pairs.length - 1]?.value ?? 0;
}

/* -------------------------------------------------------------- page build */

/**
 * Builds the complete structured layout for one page.
 *
 * Deterministic IDs, dual-frame geometry and explicit confidence make this the
 * only thing the overlay, hit testing and (later) native rewrite need to agree
 * on. Nothing here mutates its input glyphs.
 */
export function buildPageLayout(input: PageLayoutInput): PageLayout {
  const started = Date.now();
  const options = input.options ?? {};
  const pageIndex = input.pageIndex;
  const geometry = input.geometry;
  const pageSize = geometry.size;
  const idFactory = createIdFactory(pageIndex);
  const warnings: string[] = [];
  if (input.glyphs.length === 0) warnings.push('No extractable text on this page');

  const built = buildOrientationGroups(
    input.glyphs,
    pageIndex,
    options,
    idFactory,
    Math.max(pageSize.width, pageSize.height),
  );
  const entries = built.groups.flatMap((group) => group.entries);
  const activeGroups = built.groups.filter((group) => group.entries.length > 0);
  if (built.formLike) {
    warnings.push(
      'Form-like page: column inference was skipped and only three-row grids are treated as tables, so field labels stay whole',
    );
  }
  if (activeGroups.length > 1) {
    warnings.push(
      `${activeGroups.length} text orientations detected; rotated text is kept as separate blocks`,
    );
  }

  const bodySize = computeBodySize(entries);
  const maxSize = entries.reduce(
    (max, entry) => Math.max(max, entry.line.typography.fontSize),
    0,
  );
  const hints = new Map<string, RoleHint>();
  for (const entry of entries) {
    hints.set(entry.line.id, roleHintFor(entry, bodySize, maxSize, pageSize, options));
  }
  const lineHeight = computeLineHeight(entries, hints, bodySize);
  absorbFootnoteTails(entries, hints, lineHeight);
  promoteIsolatedHeadings(entries, hints, lineHeight, pageSize.width, bodySize);
  const columnBounds = computeColumnBounds(entries, hints, pageSize.width);

  const listIndents = new Map<string, number[]>();
  for (const entry of entries) {
    const bounds = boundsFor(entry, columnBounds, pageSize.width);
    const indent =
      entry.columnIndex >= 0 ? Math.max(0, entry.line.advanceStart - bounds.left) : 0;
    entry.line.indentPt = indent;
    entry.line.alignment = lineAlignment(entry.line, bounds.left, bounds.right);
    const hint = hints.get(entry.line.id);
    if (hint?.list) {
      const key = `${rotationBucket(entry.rotationDeg)}|${entry.columnIndex}`;
      const list = listIndents.get(key);
      if (list) list.push(indent);
      else listIndents.set(key, [indent]);
    }
  }

  // Nesting level is relative to the markers in the same column, not to an
  // absolute indent: real documents use wildly different tab stops.
  const listLevelCenters = new Map<string, number[]>();
  for (const [key, indents] of listIndents) {
    const sorted = [...new Set(indents.map((value) => Math.round(value * 2) / 2))].sort(
      (a, b) => a - b,
    );
    const centers: number[] = [];
    const step = Math.max(4, bodySize * 0.6);
    for (const indent of sorted) {
      const previous = centers[centers.length - 1];
      if (previous === undefined || indent - previous > step) centers.push(indent);
    }
    listLevelCenters.set(key, centers);
  }
  for (const entry of entries) {
    const hint = hints.get(entry.line.id);
    if (!hint?.list) continue;
    const key = `${rotationBucket(entry.rotationDeg)}|${entry.columnIndex}`;
    const centers = listLevelCenters.get(key) ?? [];
    let level = 1;
    for (let index = 0; index < centers.length; index += 1) {
      if (entry.line.indentPt + 1 >= centers[index]!) level = index + 1;
    }
    hint.list = {
      ...hint.list,
      level: Math.min(6, Math.max(1, level)),
      indentPt: entry.line.indentPt,
    };
  }

  const drafts = buildParagraphDrafts(
    entries,
    hints,
    columnBounds,
    bodySize,
    lineHeight,
    pageSize.width,
  );
  const { paragraphs, columnByParagraph } = materializeParagraphs(
    drafts,
    pageIndex,
    idFactory,
    columnBounds,
    pageSize.width,
    bodySize,
  );
  const tables = buildTableModels(built.tables, entries, paragraphs);
  const blocks = buildBlocks(paragraphs, tables, columnByParagraph, lineHeight, idFactory);
  const rotation = activeRotation(entries);
  const columns = buildColumnModels(
    entries,
    columnBounds,
    blocks,
    paragraphs,
    rotation,
    pageSize.width,
  );
  const regions = buildRegions(
    blocks,
    columns,
    pageSize.width,
    pageSize.height,
    idFactory,
  );
  const orderedBlocks = orderBlocks(blocks);

  const readingOrder: string[] = [];
  const seenParagraphs = new Set<string>();
  for (const block of orderedBlocks) {
    for (const paragraphId of block.paragraphIds) {
      if (seenParagraphs.has(paragraphId)) continue;
      seenParagraphs.add(paragraphId);
      readingOrder.push(paragraphId);
    }
  }

  if (tables.length > 0) warnings.push(`${tables.length} table(s) detected`);
  if (columns.length > 1 && tables.length > 0) {
    warnings.push('Tables and columns share alignment; table boundaries may be ambiguous');
  }

  const weightSum = entries.reduce((sum, entry) => sum + Math.max(1, entry.line.text.length), 0);
  const confidence =
    weightSum > 0
      ? clamp01(
          entries.reduce(
            (sum, entry) => sum + entry.line.confidence * Math.max(1, entry.line.text.length),
            0,
          ) / weightSum,
        )
      : 0;
  if (entries.length > 0 && confidence < 0.65) {
    warnings.push('Low-confidence text structure; ambiguous regions were preserved');
  }

  const stats: PageStats = {
    medianFontSize: weightedMedian(
      entries.map((entry) => entry.line.typography.fontSize),
      entries.map((entry) => Math.max(1, entry.line.text.length)),
    ) || bodySize,
    medianLineGap: lineHeight,
    lineHeight,
    wordGap: Math.max(0.5, bodySize * 0.28),
    columnCount: columns.length,
    glyphCount: input.glyphs.length,
    wordCount: entries.reduce((sum, entry) => sum + entry.words.length, 0),
    lineCount: entries.length,
    paragraphCount: paragraphs.length,
    blockCount: blocks.length,
    textCoverage: coverageRatio(entries, pageSize.width, pageSize.height),
    buildMs: Date.now() - started,
  };

  return {
    id: idFactory('page', `${pageIndex}|${pageSize.width.toFixed(1)}x${pageSize.height.toFixed(1)}`),
    index: pageIndex,
    widthPt: pageSize.width,
    heightPt: pageSize.height,
    rotation: input.rotation,
    mediaBox: input.mediaBox,
    cropBox: input.cropBox,
    geometry: geometry.geom,
    glyphs: [...input.glyphs],
    words: entries.flatMap((entry) => entry.words),
    lines: entries.map((entry) => entry.line),
    paragraphs,
    blocks,
    regions,
    tables,
    columns,
    readingOrder,
    blockOrder: orderedBlocks.map((block) => block.id),
    stats,
    confidence,
    warnings: [...new Set(warnings)],
  };
}
