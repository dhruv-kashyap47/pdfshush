/**
 * Hit testing and selection over the structured page model.
 *
 * The overlay never scans every glyph on a pointer move: words, lines,
 * paragraphs, blocks, regions and glyphs each get a `SpatialGrid`, and a click
 * resolves the deepest target first. All positions are display points, so the
 * caller only has to convert the pointer once through `PageGeometry`.
 *
 * Offset mapping is intentionally honest about its precision: glyph advances
 * inside a pdf.js item are estimated, so a caret is placed at the nearest
 * estimated boundary. It is stable and good enough for editing, but it is not
 * a claim of glyph-exact kerning.
 */

import {
  bboxArea,
  bboxContainsPoint,
  bboxDistance,
  projectPoint,
  SpatialGrid,
} from './geometry.js';
import { needsSpace } from './group.js';
import type {
  BBox,
  Glyph,
  Line,
  PageLayout,
  Paragraph,
  ParagraphLineSpan,
  Point,
  Region,
  TextBlock,
  Word,
} from './types.js';

export interface LineWordSegment {
  word: Word;
  /** Offset of the word in the line's text. */
  start: number;
  end: number;
  /** Projected extent on the line's baseline, display points. */
  advanceStart: number;
  advanceEnd: number;
}

export interface CaretPosition {
  paragraphId: string;
  lineId: string;
  /** Offset in `Paragraph.text`. */
  paragraphOffset: number;
  /** Offset in `Line.text` (includes list markers). */
  lineOffset: number;
  point: Point;
}

export interface TextSelection {
  paragraphId: string;
  start: number;
  end: number;
  text: string;
  rects: BBox[];
}

export interface MultiParagraphSelection {
  ranges: TextSelection[];
  text: string;
}

export interface SelectionAnchor {
  paragraphId: string;
  offset: number;
}

export interface HitTargets {
  glyph?: Glyph;
  word?: Word;
  line?: Line;
  paragraph?: Paragraph;
  block?: TextBlock;
  region?: Region;
}

function projectedAdvance(bbox: BBox, rotationDeg: number): { start: number; end: number } {
  const radians = (rotationDeg * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const corners = [
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y },
    { x: bbox.x, y: bbox.y + bbox.height },
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
  ].map((point) => point.x * dx + point.y * dy);
  return { start: Math.min(...corners), end: Math.max(...corners) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smallest<T extends { bbox: BBox }>(items: readonly T[]): T | null {
  let best: T | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const area = bboxArea(item.bbox);
    if (area < bestArea) {
      best = item;
      bestArea = area;
    }
  }
  return best;
}

export class PageInteractionModel {
  readonly page: PageLayout;
  private readonly lineGrid: SpatialGrid<Line>;
  private readonly wordGrid: SpatialGrid<Word>;
  private readonly paragraphGrid: SpatialGrid<Paragraph>;
  private readonly blockGrid: SpatialGrid<TextBlock>;
  private readonly regionGrid: SpatialGrid<Region>;
  private readonly glyphGrid: SpatialGrid<Glyph>;
  private readonly paragraphById = new Map<string, Paragraph>();
  private readonly lineById = new Map<string, Line>();
  private readonly wordById = new Map<string, Word>();
  private readonly lineToParagraph = new Map<string, string>();
  private readonly wordToLine = new Map<string, string>();
  private readonly segmentsByLine = new Map<string, LineWordSegment[]>();
  private readonly paragraphOrder = new Map<string, number>();

  constructor(page: PageLayout) {
    this.page = page;
    for (const paragraph of page.paragraphs) this.paragraphById.set(paragraph.id, paragraph);
    for (const line of page.lines) this.lineById.set(line.id, line);
    for (const word of page.words) this.wordById.set(word.id, word);
    page.readingOrder.forEach((id, index) => this.paragraphOrder.set(id, index));
    page.paragraphs.forEach((paragraph, index) => {
      if (!this.paragraphOrder.has(paragraph.id)) {
        this.paragraphOrder.set(paragraph.id, page.readingOrder.length + index);
      }
      for (const lineId of paragraph.lineIds) this.lineToParagraph.set(lineId, paragraph.id);
    });

    for (const line of page.lines) {
      const segments: LineWordSegment[] = [];
      let cursor = 0;
      let previous = '';
      for (const wordId of line.wordIds) {
        const word = this.wordById.get(wordId);
        if (!word) continue;
        if (cursor > 0 && needsSpace(previous, word.text)) cursor += 1;
        const start = cursor;
        cursor += word.text.length;
        const advance = projectedAdvance(word.bbox, line.rotationDeg);
        segments.push({
          word,
          start,
          end: cursor,
          advanceStart: advance.start,
          advanceEnd: advance.end,
        });
        this.wordToLine.set(word.id, line.id);
        previous = word.text;
      }
      this.segmentsByLine.set(line.id, segments);
    }

    this.lineGrid = new SpatialGrid(page.lines, 48);
    this.wordGrid = new SpatialGrid(page.words, 32);
    this.paragraphGrid = new SpatialGrid(page.paragraphs, 96);
    this.blockGrid = new SpatialGrid(page.blocks, 128);
    this.regionGrid = new SpatialGrid(page.regions, 192);
    this.glyphGrid = new SpatialGrid(page.glyphs, 16);
  }

  /* ------------------------------------------------------------ hit tests */

  hitLine(point: Point, tolerance = 1): Line | null {
    return smallest(
      this.lineGrid.queryPoint(point, tolerance).filter((line) => line.text.length > 0),
    );
  }

  hitWord(point: Point, tolerance = 1): Word | null {
    return smallest(this.wordGrid.queryPoint(point, tolerance));
  }

  hitParagraph(point: Point, tolerance = 1): Paragraph | null {
    return smallest(this.paragraphGrid.queryPoint(point, tolerance));
  }

  hitBlock(point: Point, tolerance = 1): TextBlock | null {
    return smallest(this.blockGrid.queryPoint(point, tolerance));
  }

  hitRegion(point: Point, tolerance = 1): Region | null {
    return smallest(this.regionGrid.queryPoint(point, tolerance));
  }

  hitTest(point: Point, tolerance = 1): HitTargets {
    const glyph = smallest(this.glyphGrid.queryPoint(point, tolerance));
    const word = this.hitWord(point, tolerance);
    const line = this.hitLine(point, tolerance);
    const paragraph = this.hitParagraph(point, tolerance);
    const block = this.hitBlock(point, tolerance);
    const region = this.hitRegion(point, tolerance);
    return {
      ...(glyph ? { glyph } : {}),
      ...(word ? { word } : {}),
      ...(line ? { line } : {}),
      ...(paragraph ? { paragraph } : {}),
      ...(block ? { block } : {}),
      ...(region ? { region } : {}),
    };
  }

  /** Nearest line within an expanding search, used at the end of a paragraph. */
  nearestLine(point: Point, tolerance = 12): Line | null {
    let best: Line | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let margin = Math.max(1, tolerance);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidates = this.lineGrid.queryPoint(point, margin);
      for (const line of candidates) {
        const distance = bboxDistance(line.bbox, point);
        if (distance < bestDistance) {
          best = line;
          bestDistance = distance;
        }
      }
      if (best) return best;
      margin *= 2;
    }
    return best;
  }

  paragraphsInRect(rect: BBox): Paragraph[] {
    return this.paragraphGrid.queryRect(rect);
  }

  linesInRect(rect: BBox): Line[] {
    return this.lineGrid.queryRect(rect);
  }

  /* -------------------------------------------------------------- caret */

  segmentsForLine(lineId: string): readonly LineWordSegment[] {
    return this.segmentsByLine.get(lineId) ?? [];
  }

  private prefixForSpan(_paragraph: Paragraph, span: ParagraphLineSpan): number {
    const line = this.lineById.get(span.lineId);
    if (!line) return 0;
    const spanLength = Math.max(0, span.end - span.start);
    return Math.max(0, line.text.length - spanLength);
  }

  lineOffsetAtPoint(line: Line, point: Point): number {
    const segments = this.segmentsForLine(line.id);
    if (segments.length === 0) return 0;
    const { advance } = projectPoint(point, line.rotationDeg);
    const first = segments[0]!;
    const last = segments[segments.length - 1]!;
    if (advance <= first.advanceStart) return 0;
    if (advance >= last.advanceEnd) return Math.max(0, line.text.length);

    let chosen = first;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const segment of segments) {
      if (advance >= segment.advanceStart && advance <= segment.advanceEnd) {
        chosen = segment;
        bestDistance = 0;
        break;
      }
      const distance =
        advance < segment.advanceStart
          ? segment.advanceStart - advance
          : advance - segment.advanceEnd;
      if (distance < bestDistance) {
        chosen = segment;
        bestDistance = distance;
      }
    }
    const width = Math.max(0, chosen.advanceEnd - chosen.advanceStart);
    const ratio = width > 0 ? clamp((advance - chosen.advanceStart) / width, 0, 1) : 0;
    return chosen.start + Math.round(ratio * (chosen.end - chosen.start));
  }

  caretAt(point: Point, tolerance = 4): CaretPosition | null {
    const line = this.hitLine(point, tolerance) ?? this.nearestLine(point, tolerance * 3);
    if (!line) return null;
    const paragraphId = this.lineToParagraph.get(line.id);
    if (!paragraphId) return null;
    const paragraph = this.paragraphById.get(paragraphId);
    if (!paragraph) return null;
    const span = paragraph.lineSpans.find((candidate) => candidate.lineId === line.id);
    if (!span) return null;
    const lineOffset = this.lineOffsetAtPoint(line, point);
    const prefix = this.prefixForSpan(paragraph, span);
    const paragraphOffset = clamp(
      span.start + clamp(lineOffset - prefix, 0, Math.max(0, span.end - span.start)),
      0,
      paragraph.text.length,
    );
    return {
      paragraphId,
      lineId: line.id,
      paragraphOffset,
      lineOffset,
      point,
    };
  }

  caretAtParagraphOffset(paragraphId: string, offset: number): CaretPosition | null {
    const paragraph = this.paragraphById.get(paragraphId);
    if (!paragraph || paragraph.lineSpans.length === 0) return null;
    const clamped = clamp(offset, 0, paragraph.text.length);
    let span = paragraph.lineSpans[paragraph.lineSpans.length - 1]!;
    for (const candidate of paragraph.lineSpans) {
      if (clamped >= candidate.start && clamped <= candidate.end) {
        span = candidate;
        break;
      }
    }
    const prefix = this.prefixForSpan(paragraph, span);
    const lineOffset = prefix + clamp(clamped - span.start, 0, Math.max(0, span.end - span.start));
    return {
      paragraphId,
      lineId: span.lineId,
      paragraphOffset: clamped,
      lineOffset,
      point: { x: paragraph.bbox.x, y: paragraph.bbox.y },
    };
  }

  /* ------------------------------------------------------------- selection */

  rangeRects(line: Line, from: number, to: number): BBox[] {
    const segments = this.segmentsForLine(line.id);
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    if (start === end) return [];
    const rects: BBox[] = [];
    const radians = (line.rotationDeg * Math.PI) / 180;
    const vertical = Math.abs(Math.sin(radians)) > Math.abs(Math.cos(radians));

    for (const segment of segments) {
      const overlapStart = Math.max(start, segment.start);
      const overlapEnd = Math.min(end, segment.end);
      if (overlapEnd <= overlapStart) continue;
      const length = Math.max(1, segment.end - segment.start);
      const a = (overlapStart - segment.start) / length;
      const b = (overlapEnd - segment.start) / length;
      const box = segment.word.bbox;
      if (vertical) {
        rects.push({
          x: box.x,
          y: box.y + box.height * a,
          width: box.width,
          height: box.height * (b - a),
        });
      } else {
        rects.push({
          x: box.x + box.width * a,
          y: box.y,
          width: box.width * (b - a),
          height: box.height,
        });
      }
    }
    if (rects.length === 0 && line.text.length > 0) rects.push(line.bbox);
    return rects;
  }

  selectionForParagraph(paragraphId: string, start: number, end: number): TextSelection | null {
    const paragraph = this.paragraphById.get(paragraphId);
    if (!paragraph) return null;
    const from = clamp(Math.min(start, end), 0, paragraph.text.length);
    const to = clamp(Math.max(start, end), 0, paragraph.text.length);
    const rects: BBox[] = [];
    if (from !== to) {
      for (const span of paragraph.lineSpans) {
        const overlapStart = Math.max(from, span.start);
        const overlapEnd = Math.min(to, span.end);
        if (overlapEnd <= overlapStart) continue;
        const line = this.lineById.get(span.lineId);
        if (!line) continue;
        const prefix = this.prefixForSpan(paragraph, span);
        rects.push(
          ...this.rangeRects(
            line,
            overlapStart - span.start + prefix,
            overlapEnd - span.start + prefix,
          ),
        );
      }
    }
    return {
      paragraphId,
      start: from,
      end: to,
      text: paragraph.text.slice(from, to),
      rects,
    };
  }

  selectParagraph(paragraphId: string): TextSelection | null {
    const paragraph = this.paragraphById.get(paragraphId);
    if (!paragraph) return null;
    return this.selectionForParagraph(paragraphId, 0, paragraph.text.length);
  }

  selectWordAt(point: Point, tolerance = 3): TextSelection | null {
    const word = this.hitWord(point, tolerance);
    if (!word) return null;
    const lineId = this.wordToLine.get(word.id);
    if (!lineId) return null;
    const paragraphId = this.lineToParagraph.get(lineId);
    if (!paragraphId) return null;
    const paragraph = this.paragraphById.get(paragraphId);
    const line = this.lineById.get(lineId);
    if (!paragraph || !line) return null;
    const segment = this.segmentsForLine(lineId).find((candidate) => candidate.word.id === word.id);
    if (!segment) return null;
    const span = paragraph.lineSpans.find((candidate) => candidate.lineId === lineId);
    if (!span) return null;
    const prefix = this.prefixForSpan(paragraph, span);
    const start = clamp(span.start + segment.start - prefix, 0, paragraph.text.length);
    const end = clamp(span.start + segment.end - prefix, 0, paragraph.text.length);
    return this.selectionForParagraph(paragraphId, start, end);
  }

  selectionBetween(anchor: SelectionAnchor, focus: SelectionAnchor): MultiParagraphSelection {
    const anchorOrder = this.paragraphOrder.get(anchor.paragraphId) ?? Number.MAX_SAFE_INTEGER;
    const focusOrder = this.paragraphOrder.get(focus.paragraphId) ?? Number.MAX_SAFE_INTEGER;
    const forward = anchorOrder <= focusOrder;
    const startAnchor = forward ? anchor : focus;
    const endAnchor = forward ? focus : anchor;
    const startParagraph = this.paragraphById.get(startAnchor.paragraphId);
    const endParagraph = this.paragraphById.get(endAnchor.paragraphId);
    if (!startParagraph || !endParagraph) return { ranges: [], text: '' };

    if (startParagraph.id === endParagraph.id) {
      const selection = this.selectionForParagraph(
        startParagraph.id,
        startAnchor.offset,
        endAnchor.offset,
      );
      return { ranges: selection ? [selection] : [], text: selection?.text ?? '' };
    }

    const ranges: TextSelection[] = [];
    const texts: string[] = [];
    const startSelection = this.selectionForParagraph(
      startParagraph.id,
      clamp(startAnchor.offset, 0, startParagraph.text.length),
      startParagraph.text.length,
    );
    if (startSelection && startSelection.start !== startSelection.end) {
      ranges.push(startSelection);
      texts.push(startSelection.text);
    }

    const startIndex = this.paragraphOrder.get(startParagraph.id) ?? 0;
    const endIndex = this.paragraphOrder.get(endParagraph.id) ?? 0;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const paragraphId = this.page.readingOrder[index];
      if (!paragraphId) continue;
      const selection = this.selectParagraph(paragraphId);
      if (selection && selection.start !== selection.end) {
        ranges.push(selection);
        texts.push(selection.text);
      }
    }

    const endSelection = this.selectionForParagraph(
      endParagraph.id,
      0,
      clamp(endAnchor.offset, 0, endParagraph.text.length),
    );
    if (endSelection && endSelection.start !== endSelection.end) {
      ranges.push(endSelection);
      texts.push(endSelection.text);
    }

    return { ranges, text: texts.join('\n') };
  }

  /**
   * Converts a paragraph offset to a zero-width caret box. The box is one line
   * high and can be drawn directly by the overlay.
   */
  caretRect(paragraphId: string, offset: number): BBox | null {
    const paragraph = this.paragraphById.get(paragraphId);
    if (!paragraph) return null;
    const clamped = clamp(offset, 0, paragraph.text.length);
    let span = paragraph.lineSpans[paragraph.lineSpans.length - 1];
    if (!span) return null;
    for (const candidate of paragraph.lineSpans) {
      if (clamped >= candidate.start && clamped <= candidate.end) {
        span = candidate;
        break;
      }
    }
    const line = this.lineById.get(span.lineId);
    if (!line) return null;
    const prefix = this.prefixForSpan(paragraph, span);
    const lineOffset = prefix + clamp(clamped - span.start, 0, Math.max(0, span.end - span.start));
    const segments = this.segmentsForLine(line.id);
    if (segments.length === 0) return { ...line.bbox, width: 1 };

    let x = line.bbox.x + line.bbox.width;
    for (const segment of segments) {
      if (lineOffset < segment.start) break;
      if (lineOffset <= segment.end) {
        const length = Math.max(1, segment.end - segment.start);
        const ratio = clamp((lineOffset - segment.start) / length, 0, 1);
        x = segment.word.bbox.x + segment.word.bbox.width * ratio;
        break;
      }
      x = segment.word.bbox.x + segment.word.bbox.width;
    }
    return { x, y: line.bbox.y, width: 1, height: line.bbox.height };
  }

  paragraphByIdOrNull(id: string): Paragraph | null {
    return this.paragraphById.get(id) ?? null;
  }

  lineByIdOrNull(id: string): Line | null {
    return this.lineById.get(id) ?? null;
  }

  wordByIdOrNull(id: string): Word | null {
    return this.wordById.get(id) ?? null;
  }

  /** Convenience for hover: returns the paragraph under a point, or nearest. */
  nearParagraph(point: Point, tolerance = 6): Paragraph | null {
    const direct = this.hitParagraph(point, tolerance);
    if (direct) return direct;
    const line = this.nearestLine(point, tolerance);
    if (!line) return null;
    const id = this.lineToParagraph.get(line.id);
    return id ? (this.paragraphById.get(id) ?? null) : null;
  }

  pointInPage(point: Point): boolean {
    return bboxContainsPoint(
      { x: 0, y: 0, width: this.page.widthPt, height: this.page.heightPt },
      point,
    );
  }
}

export function createInteractionModel(page: PageLayout): PageInteractionModel {
  return new PageInteractionModel(page);
}
