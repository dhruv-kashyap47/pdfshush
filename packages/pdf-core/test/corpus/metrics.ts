/**
 * Scoring for the layout-intelligence benchmark.
 *
 * Nothing here knows how the model *should* behave: every number is computed
 * by comparing the produced `PageLayout` against ground truth that was written
 * down when the fixture was drawn (or hand-annotated for real documents).
 *
 * The metrics are deliberately the standard ones --
 *
 *   - pairwise precision/recall/F1 for paragraph grouping,
 *   - pairwise ordering accuracy for reading order,
 *   - plain accuracy (with coverage) for role, level, column and font calls,
 *   - cell-level precision/recall for tables,
 *   - AUROC of the reported confidence against actual correctness, which is
 *     the only honest way to say whether a confidence score means anything,
 *   - collision precision/recall for reflow safety.
 *
 * -- so a before/after comparison is not a number we invented to win.
 */

import type { BBox, PageLayout, Paragraph, TextBlock } from '../../src/document/types.js';
import { assessReflow, type ReflowObstacle } from '../../src/document/reflow.js';
import type { GtDocument, GtPage, GtParagraph, ReflowScenario, SyntheticCase } from './synthetic.js';

/** A ground-truth line counts as found when predicted lines cover this much of it. */
export const LINE_COVERAGE = 0.5;

export function iou(a: BBox, b: BBox): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export function intersects(a: BBox, b: BBox): boolean {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0.5 && h > 0.5;
}

/* --------------------------------------------------------------- pairing */

export interface LinePairing {
  /** predicted line index -> ground-truth line index */
  predToGt: Map<number, number>;
  /** ground-truth line index -> predicted line index */
  gtToPred: Map<number, number>;
  /** Fraction of each ground-truth line's ink box covered by predicted lines. */
  gtCoverage: Map<number, number>;
}

function intersectionArea(a: BBox, b: BBox): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Pairs ground-truth lines with predicted lines by *coverage*, not IoU.
 *
 * A table row is one visual line that the model may legitimately split into
 * cells once it recognises the table, and a long line may be split into two by
 * a font change. Scoring those as "lost text" would punish the model for being
 * more structured than the PDF's operator stream, so a ground-truth line counts
 * as found when predicted lines cover most of its ink box. IoU is still used to
 * pick the single best partner for paragraph-level comparisons.
 */
export function matchLines(gt: GtPage, layout: PageLayout): LinePairing {
  const predToGt = new Map<number, number>();
  const gtToPred = new Map<number, number>();
  const gtCoverage = new Map<number, number>();

  gt.lines.forEach((gtLine, gtIndex) => {
    const gtArea = Math.max(1, gtLine.box.width * gtLine.box.height);
    let covered = 0;
    let bestPred = -1;
    let bestArea = 0;
    layout.lines.forEach((predLine, predIndex) => {
      const area = intersectionArea(gtLine.box, predLine.bbox);
      if (area <= 0) return;
      covered += area;
      if (area > bestArea) {
        bestArea = area;
        bestPred = predIndex;
      }
    });
    gtCoverage.set(gtIndex, Math.min(1, covered / gtArea));
    if (bestPred < 0 || bestArea / gtArea < 0.25) return;
    gtToPred.set(gtIndex, bestPred);
    if (!predToGt.has(bestPred)) predToGt.set(bestPred, gtIndex);
  });

  return { predToGt, gtToPred, gtCoverage };
}

function gtParagraphOfLine(gt: GtPage): Map<number, number> {
  const map = new Map<number, number>();
  // Table cells are scored by the table metrics (cell precision/recall), not by
  // paragraph grouping: a table row is one visual line but N logical cells, so
  // counting it here would double-penalise the same decision.
  gt.paragraphs.forEach((paragraph, index) => {
    if (paragraph.role === 'table-cell') return;
    for (const line of paragraph.lineIndexes) map.set(line, index);
  });
  return map;
}

function scoredParagraphs(gt: GtPage): GtParagraph[] {
  return gt.paragraphs.filter((paragraph) => paragraph.role !== 'table-cell');
}

function predictedParagraphOfLines(layout: PageLayout): Map<string, number> {
  const map = new Map<string, number>();
  layout.paragraphs.forEach((paragraph, index) => {
    for (const lineId of paragraph.lineIds) map.set(lineId, index);
  });
  return map;
}

/* ------------------------------------------------------------- aggregates */

export interface Ratio {
  total: number;
  correct: number;
  accuracy: number;
}

function ratio(total: number, correct: number): Ratio {
  return { total, correct, accuracy: total > 0 ? correct / total : 0 };
}

export interface GroupingScore {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

function grouping(tp: number, fp: number, fn: number): GroupingScore {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, precision, recall, f1 };
}

export interface RoleScore extends Ratio {
  perRole: Record<string, Ratio>;
}

export interface FontScore {
  family: Ratio;
  bold: Ratio;
  italic: Ratio;
}

export interface TableScore {
  gtTables: number;
  detectedTables: number;
  gtCells: number;
  matchedCells: number;
  extraCells: number;
  precision: number;
  recall: number;
}

export interface ConfidenceScore {
  /** AUROC of `Paragraph.confidence` predicting a correct grouping. */
  auroc: number | null;
  meanCorrect: number;
  meanIncorrect: number;
  /** Standard deviation of the reported confidence across paragraphs. */
  spread: number;
  flaggedTotal: number;
  flaggedWrong: number;
  unflaggedWrong: number;
  total: number;
}

export interface PageScore {
  gtLines: number;
  matchedLines: number;
  lineRecall: number;
  grouping: GroupingScore;
  readingOrder: { pairs: number; correct: number; accuracy: number };
  roles: RoleScore;
  headingLevels: Ratio;
  listLevels: Ratio;
  columns: Ratio;
  fonts: FontScore;
  tables: TableScore;
  confidence: ConfidenceScore;
}

/* ------------------------------------------------------------------- auroc */

/**
 * Rank-based AUROC. Returns null when only one class is present, which is
 * reported as "not measurable" rather than as a flattering number.
 */
export function auroc(scores: readonly number[], labels: readonly boolean[]): number | null {
  const positives = labels.filter(Boolean).length;
  const negatives = labels.length - positives;
  if (positives === 0 || negatives === 0) return null;
  const pairs = scores.map((score, index) => ({ score, label: labels[index]! }));
  pairs.sort((a, b) => a.score - b.score);
  let rankSum = 0;
  let index = 0;
  while (index < pairs.length) {
    let end = index;
    while (end + 1 < pairs.length && pairs[end + 1]!.score === pairs[index]!.score) end += 1;
    const averageRank = (index + end + 2) / 2; // ranks are 1-based
    for (let k = index; k <= end; k += 1) {
      if (pairs[k]!.label) rankSum += averageRank;
    }
    index = end + 1;
  }
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

/* ------------------------------------------------------------ page scoring */

function normalizeRole(role: string): string {
  return role === 'unknown' ? 'body' : role;
}

export function scorePage(gt: GtPage, layout: PageLayout): PageScore {
  const pairing = matchLines(gt, layout);
  const gtLineParagraph = gtParagraphOfLine(gt);
  const predParagraphOfLine = predictedParagraphOfLines(layout);
  const blockByParagraph = new Map<string, TextBlock>();
  for (const block of layout.blocks) {
    for (const id of block.paragraphIds) blockByParagraph.set(id, block);
  }

  const matchedGt = [...pairing.gtToPred.keys()]
    .filter((gtIndex) => gtLineParagraph.has(gtIndex))
    .sort((a, b) => a - b);

  // ---- grouping (pairwise over ground-truth lines the model could see) ----
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < matchedGt.length; i += 1) {
    for (let j = i + 1; j < matchedGt.length; j += 1) {
      const gi = matchedGt[i]!;
      const gj = matchedGt[j]!;
      const pi = pairing.gtToPred.get(gi)!;
      const pj = pairing.gtToPred.get(gj)!;
      const predSame =
        predParagraphOfLine.get(layout.lines[pi]!.id) !== undefined &&
        predParagraphOfLine.get(layout.lines[pi]!.id) === predParagraphOfLine.get(layout.lines[pj]!.id);
      const gtSame = gtLineParagraph.get(gi) === gtLineParagraph.get(gj);
      if (gtSame && predSame) tp += 1;
      else if (!gtSame && predSame) fp += 1;
      else if (gtSame && !predSame) fn += 1;
    }
  }

  // ---- predicted paragraph -> ground-truth paragraph (majority of its lines) ----
  const mapping = new Map<number, { gt: number; hits: number; gtSet: Set<number> }>();
  layout.paragraphs.forEach((paragraph, predIndex) => {
    const counts = new Map<number, Set<number>>();
    for (const lineId of paragraph.lineIds) {
      const predLine = layout.lines.findIndex((line) => line.id === lineId);
      if (predLine < 0) continue;
      const gtLine = pairing.predToGt.get(predLine);
      if (gtLine === undefined) continue;
      const gtPara = gtLineParagraph.get(gtLine);
      if (gtPara === undefined) continue;
      const set = counts.get(gtPara) ?? new Set<number>();
      set.add(gtLine);
      counts.set(gtPara, set);
    }
    let bestGt = -1;
    let bestHits = 0;
    for (const [gtPara, set] of counts) {
      if (set.size > bestHits) {
        bestHits = set.size;
        bestGt = gtPara;
      }
    }
    if (bestGt >= 0 && bestHits > 0) {
      mapping.set(predIndex, { gt: bestGt, hits: bestHits, gtSet: counts.get(bestGt)! });
    }
  });

  // ---- reading order ----
  const orderOfGt = new Map<number, number>();
  layout.readingOrder.forEach((paragraphId, position) => {
    const predIndex = layout.paragraphs.findIndex((paragraph) => paragraph.id === paragraphId);
    if (predIndex < 0) return;
    const hit = mapping.get(predIndex);
    if (!hit || orderOfGt.has(hit.gt)) return;
    orderOfGt.set(hit.gt, position);
  });
  let orderPairs = 0;
  let orderCorrect = 0;
  const expectedOrder = gt.readingOrder ?? gt.paragraphs.map((_, index) => index);
  const orderedGt = expectedOrder.filter((index) => orderOfGt.has(index));
  for (let i = 0; i < orderedGt.length; i += 1) {
    for (let j = i + 1; j < orderedGt.length; j += 1) {
      orderPairs += 1;
      if (orderOfGt.get(orderedGt[i]!)! < orderOfGt.get(orderedGt[j]!)!) orderCorrect += 1;
    }
  }

  // ---- per-GT-paragraph judgments (best predicted match) ----
  const bestPredForGt = new Map<number, { pred: number; hits: number }>();
  for (const [predIndex, hit] of mapping) {
    const existing = bestPredForGt.get(hit.gt);
    if (!existing || hit.hits > existing.hits) {
      bestPredForGt.set(hit.gt, { pred: predIndex, hits: hit.hits });
    }
  }

  const perRole = new Map<string, { total: number; correct: number }>();
  let roleMapped = 0;
  let roleCorrect = 0;
  let headingTotal = 0;
  let headingCorrect = 0;
  let listTotal = 0;
  let listCorrect = 0;
  let columnTotal = 0;
  let columnCorrect = 0;
  let familyTotal = 0;
  let familyCorrect = 0;
  let boldTotal = 0;
  let boldCorrect = 0;
  let italicTotal = 0;
  let italicCorrect = 0;
  const confidenceScores: number[] = [];
  const confidenceLabels: boolean[] = [];
  let flaggedTotal = 0;
  let flaggedWrong = 0;
  let unflaggedWrong = 0;

  gt.paragraphs.forEach((gtParagraph, gtIndex) => {
    if (gtParagraph.role === 'table-cell') return;
    const bucket = perRole.get(gtParagraph.role) ?? { total: 0, correct: 0 };
    bucket.total += 1;
    perRole.set(gtParagraph.role, bucket);

    const best = bestPredForGt.get(gtIndex);
    if (!best) return;
    const predicted = layout.paragraphs[best.pred]!;
    roleMapped += 1;
    const sameRole = normalizeRole(predicted.role) === normalizeRole(gtParagraph.role);
    if (sameRole) {
      roleCorrect += 1;
      bucket.correct += 1;
    }

    if (gtParagraph.role === 'heading') {
      headingTotal += 1;
      if (predicted.role === 'heading' && predicted.headingLevel === gtParagraph.headingLevel) {
        headingCorrect += 1;
      }
    }
    if (gtParagraph.role === 'list-item') {
      listTotal += 1;
      if (predicted.role === 'list-item' && predicted.list?.level === gtParagraph.listLevel) {
        listCorrect += 1;
      }
    }
    if (gt.columnCount > 1) {
      // Single-column pages carry no column signal: the model reports 0 where
      // the truth says "full measure", which is not an error.
      columnTotal += 1;
      const block = blockByParagraph.get(predicted.id);
      if ((block?.columnIndex ?? -1) === gtParagraph.column) columnCorrect += 1;
    }

    const gtLine = gt.lines[gtParagraph.lineIndexes[0]!]!;
    familyTotal += 1;
    boldTotal += 1;
    italicTotal += 1;
    if (predicted.typography.fontFamily === gtLine.family) familyCorrect += 1;
    if (predicted.typography.bold === gtLine.bold) boldCorrect += 1;
    if (predicted.typography.italic === gtLine.italic) italicCorrect += 1;
  });

  // ---- confidence: does it separate right from wrong? ----
  layout.paragraphs.forEach((paragraph, predIndex) => {
    const hit = mapping.get(predIndex);
    if (!hit) return;
    const gtParagraph = gt.paragraphs[hit.gt]!;
    const expected = new Set(gtParagraph.lineIndexes);
    const got = new Set<number>();
    for (const lineId of paragraph.lineIds) {
      const predLine = layout.lines.findIndex((line) => line.id === lineId);
      if (predLine < 0) continue;
      const gtLine = pairing.predToGt.get(predLine);
      if (gtLine !== undefined) got.add(gtLine);
    }
    const correct =
      got.size === expected.size && [...expected].every((line) => got.has(line));
    confidenceScores.push(paragraph.confidence);
    confidenceLabels.push(correct);
    if (paragraph.ambiguous) {
      flaggedTotal += 1;
      if (!correct) flaggedWrong += 1;
    } else if (!correct) {
      unflaggedWrong += 1;
    }
  });

  const correctScores = confidenceScores.filter((_, index) => confidenceLabels[index]);
  const wrongScores = confidenceScores.filter((_, index) => !confidenceLabels[index]);

  // ---- tables ----
  const tableScore = scoreTables(gt, layout);

  return {
    gtLines: gt.lines.length,
    matchedLines: [...pairing.gtCoverage.values()].filter((value) => value >= LINE_COVERAGE).length,
    lineRecall:
      gt.lines.length > 0
        ? [...pairing.gtCoverage.values()].filter((value) => value >= LINE_COVERAGE).length /
          gt.lines.length
        : 1,
    grouping: grouping(tp, fp, fn),
    readingOrder: {
      pairs: orderPairs,
      correct: orderCorrect,
      accuracy: orderPairs > 0 ? orderCorrect / orderPairs : 1,
    },
    roles: {
      ...ratio(scoredParagraphs(gt).length, roleCorrect),
      perRole: Object.fromEntries([...perRole].map(([key, value]) => [key, ratio(value.total, value.correct)])),
    },
    headingLevels: ratio(headingTotal, headingCorrect),
    listLevels: ratio(listTotal, listCorrect),
    columns: ratio(columnTotal, columnCorrect),
    fonts: {
      family: ratio(familyTotal, familyCorrect),
      bold: ratio(boldTotal, boldCorrect),
      italic: ratio(italicTotal, italicCorrect),
    },
    tables: tableScore,
    confidence: {
      auroc: auroc(confidenceScores, confidenceLabels),
      meanCorrect: mean(correctScores),
      meanIncorrect: mean(wrongScores),
      spread: stdev(confidenceScores),
      flaggedTotal,
      flaggedWrong,
      unflaggedWrong,
      total: confidenceScores.length,
    },
  };
}

function scoreTables(gt: GtPage, layout: PageLayout): TableScore {
  let gtCells = 0;
  let matchedCells = 0;
  let gtTables = 0;
  let detectedTables = 0;

  for (const gtTable of gt.tables) {
    gtTables += 1;
    gtCells += gtTable.rows.length * (gtTable.rows[0]?.length ?? 0);
    // Pick the predicted table that overlaps this ground-truth table most.
    let bestTable = -1;
    let bestScore = 0;
    layout.tables.forEach((table, index) => {
      const score = iou(table.bbox, gtTable.box);
      if (score > bestScore) {
        bestScore = score;
        bestTable = index;
      }
    });
    if (bestTable < 0 || bestScore < 0.1) continue;
    const predicted = layout.tables[bestTable]!;
    detectedTables += 1;
    gtTable.rows.forEach((row, rowIndex) => {
      row.forEach((cellText, colIndex) => {
        const hit = predicted.rows.some(
          (tableRow) =>
            tableRow.index === rowIndex &&
            tableRow.cells.some(
              (cell) => cell.column === colIndex && normalize(cell.text) === normalize(cellText),
            ),
        );
        if (hit) matchedCells += 1;
      });
    });
  }

  let predictedCells = 0;
  for (const table of layout.tables) {
    for (const row of table.rows) predictedCells += row.cells.length;
  }
  const extraCells = Math.max(0, predictedCells - matchedCells);
  return {
    gtTables,
    detectedTables,
    gtCells,
    matchedCells,
    extraCells,
    precision: predictedCells > 0 ? matchedCells / predictedCells : 0,
    recall: gtCells > 0 ? matchedCells / gtCells : 0,
  };
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/* ------------------------------------------------------------ case scoring */

export interface CaseScore {
  name: string;
  pages: PageScore[];
  /** Micro-averaged over every page of the case. */
  totals: {
    grouping: GroupingScore;
    readingOrder: { pairs: number; correct: number; accuracy: number };
    roles: Ratio;
    headingLevels: Ratio;
    listLevels: Ratio;
    columns: Ratio;
    fonts: FontScore;
    tables: TableScore;
    lineRecall: number;
    confidence: ConfidenceScore;
  };
  reflow: ReflowScore;
}

function sumRatio(pages: readonly PageScore[], pick: (page: PageScore) => Ratio): Ratio {
  let total = 0;
  let correct = 0;
  for (const page of pages) {
    const value = pick(page);
    total += value.total;
    correct += value.correct;
  }
  return ratio(total, correct);
}

export function scoreCase(
  testCase: SyntheticCase,
  layouts: readonly PageLayout[],
): CaseScore {
  const pages = testCase.truth.pages.map((gt, index) => scorePage(gt, layouts[index]!));
  const groupingTotals = pages.reduce(
    (acc, page) => ({
      tp: acc.tp + page.grouping.tp,
      fp: acc.fp + page.grouping.fp,
      fn: acc.fn + page.grouping.fn,
    }),
    { tp: 0, fp: 0, fn: 0 },
  );
  const orderPairs = pages.reduce((sum, page) => sum + page.readingOrder.pairs, 0);
  const orderCorrect = pages.reduce((sum, page) => sum + page.readingOrder.correct, 0);
  const allScores = pages.flatMap((page) => [page.confidence]);
  const confidence: ConfidenceScore = {
    auroc: combineAuroc(pages),
    meanCorrect: mean(allScores.map((score) => score.meanCorrect).filter((v) => Number.isFinite(v))),
    meanIncorrect: mean(allScores.map((score) => score.meanIncorrect).filter((v) => Number.isFinite(v))),
    spread: mean(allScores.map((score) => score.spread)),
    flaggedTotal: pages.reduce((sum, page) => sum + page.confidence.flaggedTotal, 0),
    flaggedWrong: pages.reduce((sum, page) => sum + page.confidence.flaggedWrong, 0),
    unflaggedWrong: pages.reduce((sum, page) => sum + page.confidence.unflaggedWrong, 0),
    total: pages.reduce((sum, page) => sum + page.confidence.total, 0),
  };
  const tableTotals: TableScore = pages.reduce(
    (acc, page) => ({
      ...acc,
      gtTables: acc.gtTables + page.tables.gtTables,
      detectedTables: acc.detectedTables + page.tables.detectedTables,
      gtCells: acc.gtCells + page.tables.gtCells,
      matchedCells: acc.matchedCells + page.tables.matchedCells,
      extraCells: acc.extraCells + page.tables.extraCells,
    }),
    { gtTables: 0, detectedTables: 0, gtCells: 0, matchedCells: 0, extraCells: 0, precision: 0, recall: 0 },
  );
  tableTotals.precision =
    tableTotals.matchedCells + tableTotals.extraCells > 0
      ? tableTotals.matchedCells / (tableTotals.matchedCells + tableTotals.extraCells)
      : 0;
  tableTotals.recall =
    tableTotals.gtCells > 0 ? tableTotals.matchedCells / tableTotals.gtCells : 0;

  const gtLines = pages.reduce((sum, page) => sum + page.gtLines, 0);
  const matchedLines = pages.reduce((sum, page) => sum + page.matchedLines, 0);

  return {
    name: testCase.name,
    pages,
    totals: {
      grouping: grouping(groupingTotals.tp, groupingTotals.fp, groupingTotals.fn),
      readingOrder: {
        pairs: orderPairs,
        correct: orderCorrect,
        accuracy: orderPairs > 0 ? orderCorrect / orderPairs : 1,
      },
      roles: sumRatio(pages, (page) => page.roles),
      headingLevels: sumRatio(pages, (page) => page.headingLevels),
      listLevels: sumRatio(pages, (page) => page.listLevels),
      columns: sumRatio(pages, (page) => page.columns),
      fonts: {
        family: sumRatio(pages, (page) => page.fonts.family),
        bold: sumRatio(pages, (page) => page.fonts.bold),
        italic: sumRatio(pages, (page) => page.fonts.italic),
      },
      tables: tableTotals,
      lineRecall: gtLines > 0 ? matchedLines / gtLines : 1,
      confidence,
    },
    reflow: scoreReflow(testCase, layouts),
  };
}

function combineAuroc(
  pages: readonly { confidence: { auroc: number | null } }[],
): number | null {
  const values = pages.map((page) => page.confidence.auroc).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return mean(values);
}

/* --------------------------------------------------------------- reflow */

export interface ReflowScore {
  total: number;
  correct: number;
  /** Predicted safe when the ground truth says it collides (the dangerous one). */
  falseSafe: number;
  /** Predicted collision when the ground truth says it is free. */
  falseRefuse: number;
  accuracy: number;
}

/**
 * Non-text obstacles the model knows about. `PageLayout.images` now carries
 * them, so the benchmark adds nothing of its own -- the number below measures
 * what the *engine* sees, not what the harness supplies.
 */
export function nonTextObstacles(layout: PageLayout): ReflowObstacle[] {
  void layout;
  return [];
}

function paragraphBoxOf(layout: PageLayout, paragraph: Paragraph): BBox | null {
  const ids = new Set(paragraph.lineIds);
  const boxes = layout.lines.filter((line) => ids.has(line.id)).map((line) => line.bbox);
  if (boxes.length === 0) return null;
  return boxes.reduce(
    (acc, box) => ({
      x: Math.min(acc.x, box.x),
      y: Math.min(acc.y, box.y),
      width: Math.max(acc.x + acc.width, box.x + box.width) - Math.min(acc.x, box.x),
      height: Math.max(acc.y + acc.height, box.y + box.height) - Math.min(acc.y, box.y),
    }),
    boxes[0]!,
  );
}

export function scoreReflow(
  testCase: SyntheticCase,
  layouts: readonly PageLayout[],
): ReflowScore {
  let total = 0;
  let correct = 0;
  let falseSafe = 0;
  let falseRefuse = 0;

  for (const scenario of testCase.scenarios) {
    const gtPage = testCase.truth.pages[scenario.pageIndex]!;
    const layout = layouts[scenario.pageIndex]!;
    const gtParagraph = gtPage.paragraphs[scenario.paragraph];
    if (!gtParagraph) continue;
    const gtBox = paragraphGtBox(gtPage, gtParagraph);
    const step = corpusLineStep(gtPage, gtParagraph);
    const lineCount = gtParagraph.lineIndexes.length;
    const height = (lineCount + scenario.extraLines) * step;
    const expanded: BBox = { x: gtBox.x, y: gtBox.y, width: gtBox.width, height };

    const gtObstacles: BBox[] = [];
    const ownLines = new Set(gtParagraph.lineIndexes);
    gtPage.lines.forEach((line, index) => {
      if (!ownLines.has(index)) gtObstacles.push(line.box);
    });
    for (const table of gtPage.tables) gtObstacles.push(table.box);
    for (const image of gtPage.images) gtObstacles.push(image.box);
    const truthCollides = gtObstacles.some((obstacle) => intersects(expanded, obstacle));

    const predicted = layout.paragraphs.find((entry) => {
      const box = paragraphBoxOf(layout, entry);
      return box !== null && iou(box, gtBox) > 0.3;
    });
    if (!predicted) continue;

    const assessment = assessReflow(
      predicted,
      layout,
      {
        text: Array.from({ length: lineCount + scenario.extraLines }, () => 'x').join(' '),
        width: Math.max(1, gtBox.width),
        fontSize: gtParagraph.lineIndexes.length > 0 ? gtPage.lines[gtParagraph.lineIndexes[0]!]!.size : 11,
        lineHeightPt: step,
      },
      (text) => text.length * Math.max(1, gtBox.width),
      nonTextObstacles(layout),
    );
    const predictedCollision = !assessment.safe;

    total += 1;
    if (predictedCollision === truthCollides) correct += 1;
    else if (truthCollides && !predictedCollision) falseSafe += 1;
    else falseRefuse += 1;
  }

  return {
    total,
    correct,
    falseSafe,
    falseRefuse,
    accuracy: total > 0 ? correct / total : 1,
  };
}

function paragraphGtBox(page: GtPage, paragraph: GtParagraph): BBox {
  const boxes = paragraph.lineIndexes.map((index) => page.lines[index]!.box);
  return boxes.reduce(
    (acc, box) => ({
      x: Math.min(acc.x, box.x),
      y: Math.min(acc.y, box.y),
      width: Math.max(acc.x + acc.width, box.x + box.width) - Math.min(acc.x, box.x),
      height: Math.max(acc.y + acc.height, box.y + box.height) - Math.min(acc.y, box.y),
    }),
    boxes[0]!,
  );
}

function corpusLineStep(page: GtPage, paragraph: GtParagraph): number {
  const first = page.lines[paragraph.lineIndexes[0]!]!;
  const secondIndex = paragraph.lineIndexes[1];
  if (secondIndex === undefined) return first.size * 1.45;
  const second = page.lines[secondIndex]!;
  return Math.max(1, Math.abs(first.box.y - second.box.y));
}

/* --------------------------------------------------------------- reporting */

export interface CorpusScore {
  cases: CaseScore[];
  totals: CaseScore['totals'] & { reflow: ReflowScore };
}

export function scoreCorpus(results: readonly { testCase: SyntheticCase; layouts: PageLayout[] }[]): CorpusScore {
  const cases = results.map(({ testCase, layouts }) => scoreCase(testCase, layouts));
  const groupingTotals = cases.reduce(
    (acc, item) => ({
      tp: acc.tp + item.totals.grouping.tp,
      fp: acc.fp + item.totals.grouping.fp,
      fn: acc.fn + item.totals.grouping.fn,
    }),
    { tp: 0, fp: 0, fn: 0 },
  );
  const orderPairs = cases.reduce((sum, item) => sum + item.totals.readingOrder.pairs, 0);
  const orderCorrect = cases.reduce((sum, item) => sum + item.totals.readingOrder.correct, 0);
  const tableTotals = cases.reduce(
    (acc, item) => ({
      gtTables: acc.gtTables + item.totals.tables.gtTables,
      detectedTables: acc.detectedTables + item.totals.tables.detectedTables,
      gtCells: acc.gtCells + item.totals.tables.gtCells,
      matchedCells: acc.matchedCells + item.totals.tables.matchedCells,
      extraCells: acc.extraCells + item.totals.tables.extraCells,
      precision: 0,
      recall: 0,
    }),
    { gtTables: 0, detectedTables: 0, gtCells: 0, matchedCells: 0, extraCells: 0, precision: 0, recall: 0 },
  );
  tableTotals.precision =
    tableTotals.matchedCells + tableTotals.extraCells > 0
      ? tableTotals.matchedCells / (tableTotals.matchedCells + tableTotals.extraCells)
      : 0;
  tableTotals.recall =
    tableTotals.gtCells > 0 ? tableTotals.matchedCells / tableTotals.gtCells : 0;

  const reflow = cases.reduce(
    (acc, item) => ({
      total: acc.total + item.reflow.total,
      correct: acc.correct + item.reflow.correct,
      falseSafe: acc.falseSafe + item.reflow.falseSafe,
      falseRefuse: acc.falseRefuse + item.reflow.falseRefuse,
      accuracy: 0,
    }),
    { total: 0, correct: 0, falseSafe: 0, falseRefuse: 0, accuracy: 0 },
  );
  reflow.accuracy = reflow.total > 0 ? reflow.correct / reflow.total : 1;

  const sumRatioAll = (pick: (item: CaseScore) => Ratio): Ratio => {
    let total = 0;
    let correct = 0;
    for (const item of cases) {
      const value = pick(item);
      total += value.total;
      correct += value.correct;
    }
    return ratio(total, correct);
  };

  const gtLines = cases.reduce(
    (sum, item) => sum + item.pages.reduce((inner, page) => inner + page.gtLines, 0),
    0,
  );
  const matchedLines = cases.reduce(
    (sum, item) => sum + item.pages.reduce((inner, page) => inner + page.matchedLines, 0),
    0,
  );

  return {
    cases,
    totals: {
      grouping: grouping(groupingTotals.tp, groupingTotals.fp, groupingTotals.fn),
      readingOrder: {
        pairs: orderPairs,
        correct: orderCorrect,
        accuracy: orderPairs > 0 ? orderCorrect / orderPairs : 1,
      },
      roles: sumRatioAll((item) => item.totals.roles),
      headingLevels: sumRatioAll((item) => item.totals.headingLevels),
      listLevels: sumRatioAll((item) => item.totals.listLevels),
      columns: sumRatioAll((item) => item.totals.columns),
      fonts: {
        family: sumRatioAll((item) => item.totals.fonts.family),
        bold: sumRatioAll((item) => item.totals.fonts.bold),
        italic: sumRatioAll((item) => item.totals.fonts.italic),
      },
      tables: tableTotals,
      lineRecall: gtLines > 0 ? matchedLines / gtLines : 1,
      confidence: {
        auroc: combineAuroc(cases.map((item) => ({ confidence: item.totals.confidence }))),
        meanCorrect: mean(cases.map((item) => item.totals.confidence.meanCorrect)),
        meanIncorrect: mean(cases.map((item) => item.totals.confidence.meanIncorrect)),
        spread: mean(cases.map((item) => item.totals.confidence.spread)),
        flaggedTotal: cases.reduce((sum, item) => sum + item.totals.confidence.flaggedTotal, 0),
        flaggedWrong: cases.reduce((sum, item) => sum + item.totals.confidence.flaggedWrong, 0),
        unflaggedWrong: cases.reduce((sum, item) => sum + item.totals.confidence.unflaggedWrong, 0),
        total: cases.reduce((sum, item) => sum + item.totals.confidence.total, 0),
      },
      reflow,
    },
  };
}

export type { GtDocument, ReflowScenario };
