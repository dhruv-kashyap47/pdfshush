/**
 * Layout-aware text reflow primitives.
 *
 * This module is deliberately independent of PDFium, pdf-lib and the DOM. It
 * operates on the Phase 1 document model and takes a measurement callback, so
 * the native engine can feed it the document font's real advances while tests
 * can feed deterministic metrics.
 *
 * The rule is conservative: a paragraph may grow only into space that is
 * provably empty. Anything else is reported as overflow/collision and the
 * caller must choose reconstruction or manual review. Shrinking never moves
 * neighbouring content.
 */

import { unionBBoxes } from './geometry.js';
import { collisionRisk } from './relations.js';
import type { BBox, PageLayout, Paragraph, TextAlignment } from './types.js';

export type MeasureText = (text: string, fontSize: number) => number;

export interface ReflowRequest {
  text: string;
  /** Available width in display points. */
  width: number;
  fontSize: number;
  /** Baseline-to-baseline distance in display points. Defaults to 1.2em. */
  lineHeightPt?: number;
  /** Extra first-line indent; it reduces the first line's available width. */
  firstLineIndentPt?: number;
  alignment?: TextAlignment;
  /** Refuse to plan more than this many lines (0/undefined = no cap). */
  maxLines?: number;
}

export interface ReflowLine {
  text: string;
  widthPt: number;
  /** Line index from the top. */
  index: number;
}

export interface ReflowResult {
  lines: ReflowLine[];
  widestPt: number;
  heightPt: number;
  lineHeightPt: number;
  /** True when a single unbreakable glyph/word exceeded the width. */
  overflow: boolean;
  /** Width in points by which the widest hard-broken line exceeds the box. */
  overflowPt: number;
  exceedsMaxLines: boolean;
}

export interface ReflowObstacle {
  id: string;
  kind: string;
  bbox: BBox;
}

export interface ReflowAssessment {
  request: ReflowRequest;
  result: ReflowResult;
  /** Display-space box the edited paragraph would occupy. */
  bbox: BBox;
  availableHeightPt: number;
  collisions: ReflowObstacle[];
  safe: boolean;
  reasons: string[];
}

function clampWidth(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Greedy word wrap with explicit-newline support and character hard-breaks for
 * a single word wider than the box. Mirrors the exporter's wrapping rules, but
 * measures with the supplied font metrics instead of a CSS canvas.
 */
export function wrapText(request: ReflowRequest, measure: MeasureText): ReflowResult {
  const width = clampWidth(request.width);
  const lineHeightPt = Math.max(1, request.lineHeightPt ?? request.fontSize * 1.2);
  const indent = Math.max(0, Math.min(width - 1, request.firstLineIndentPt ?? 0));
  const lines: ReflowLine[] = [];
  let widest = 0;
  let overflow = false;
  let overflowPt = 0;

  const push = (text: string): void => {
    const measured = measure(text, request.fontSize);
    // A non-finite measure means the caller could not resolve a glyph. Treat it
    // as overflow, never as zero width.
    const lineWidth = Number.isFinite(measured) ? measured : width + 1;
    widest = Math.max(widest, lineWidth);
    if (lineWidth > width + 0.01) {
      overflow = true;
      overflowPt = Math.max(overflowPt, lineWidth - width);
    }
    lines.push({ text, widthPt: lineWidth, index: lines.length });
  };

  for (const paragraph of request.text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      push('');
      continue;
    }
    let line = '';
    for (const original of words) {
      let word = original;
      const limit = lines.length === 0 ? width - indent : width;
      if (line !== '' && measure(`${line} ${word}`, request.fontSize) > limit) {
        push(line);
        line = '';
      }
      // A single word wider than the remaining line hard-breaks by character.
      while (word.length > 1 && measure(word, request.fontSize) > (line === '' ? limit : width)) {
        let cut = word.length - 1;
        while (cut > 1 && measure(word.slice(0, cut), request.fontSize) > (line === '' ? limit : width)) {
          cut -= 1;
        }
        if (line !== '') {
          push(line);
          line = '';
        }
        line = word.slice(0, cut);
        push(line);
        line = '';
        word = word.slice(cut);
      }
      line = line === '' ? word : `${line} ${word}`;
    }
    if (line !== '') push(line);
  }

  return {
    lines,
    widestPt: widest,
    heightPt: Math.max(lineHeightPt, lines.length * lineHeightPt),
    lineHeightPt,
    overflow,
    overflowPt,
    exceedsMaxLines: Boolean(request.maxLines && lines.length > request.maxLines),
  };
}

/** Union of the paragraph's original line boxes, in display points. */
export function paragraphBox(paragraph: Paragraph, layout: PageLayout): BBox {
  const lineIds = new Set(paragraph.lineIds);
  const boxes = layout.lines.filter((line) => lineIds.has(line.id)).map((line) => line.bbox);
  return boxes.length > 0 ? unionBBoxes(boxes) : paragraph.bbox;
}

function obstaclesFromLayout(layout: PageLayout, paragraphId: string): ReflowObstacle[] {
  const paragraph = layout.paragraphs.find((entry) => entry.id === paragraphId);
  const ownLines = new Set(paragraph?.lineIds ?? []);
  const obstacles: ReflowObstacle[] = [];
  for (const line of layout.lines) {
    if (ownLines.has(line.id)) continue;
    obstacles.push({ id: line.id, kind: 'line', bbox: line.bbox });
  }
  for (const table of layout.tables) {
    obstacles.push({ id: table.id, kind: 'table', bbox: table.bbox });
  }
  // Images and stencil masks are real estate the paragraph cannot grow into;
  // leaving them out is what made "safe" reflow run straight through a figure.
  (layout.images ?? []).forEach((image, index) => {
    obstacles.push({ id: `image-${index}`, kind: 'image', bbox: image.bbox });
  });
  return obstacles;
}

/**
 * Plans a paragraph replacement and decides whether it fits without touching
 * neighbouring content. `extraObstacles` lets the native caller add non-text
 * page objects (images, paths) that the text model does not contain.
 */
export function assessReflow(
  paragraph: Paragraph,
  layout: PageLayout,
  request: ReflowRequest,
  measure: MeasureText,
  extraObstacles: readonly ReflowObstacle[] = [],
): ReflowAssessment {
  const result = wrapText(request, measure);
  const original = paragraphBox(paragraph, layout);
  const bbox: BBox = {
    x: original.x,
    y: original.y,
    width: Math.max(1, request.width),
    height: result.heightPt,
  };
  const obstacles = [...obstaclesFromLayout(layout, paragraph.id), ...extraObstacles];
  const risk = collisionRisk(bbox, obstacles);
  const collisions = obstacles.filter((obstacle) => risk.ids.includes(obstacle.id));

  // Available vertical space: nearest obstacle below that overlaps the column.
  let availableBottom = layout.heightPt;
  for (const obstacle of obstacles) {
    if (obstacle.bbox.y < bbox.y + bbox.height) continue;
    if (obstacle.bbox.x + obstacle.bbox.width <= bbox.x || obstacle.bbox.x >= bbox.x + bbox.width) {
      continue;
    }
    availableBottom = Math.min(availableBottom, obstacle.bbox.y);
  }
  const availableHeightPt = Math.max(0, availableBottom - bbox.y);
  const reasons: string[] = [];
  if (result.overflow) {
    reasons.push(`text is ${Math.round(result.overflowPt * 10) / 10}pt wider than the paragraph box`);
  }
  if (result.exceedsMaxLines) reasons.push('reflow exceeds the planned line limit');
  if (collisions.length > 0) {
    reasons.push(`${collisions.length} neighbouring object(s) overlap the expanded paragraph`);
  }
  if (result.heightPt > availableHeightPt + 0.5) {
    reasons.push(
      `paragraph needs ${Math.round(result.heightPt)}pt but only ${Math.round(availableHeightPt)}pt is free`,
    );
  }
  return {
    request,
    result,
    bbox,
    availableHeightPt,
    collisions,
    safe: reasons.length === 0,
    reasons,
  };
}
