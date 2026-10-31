/**
 * Editor-side glue for the structured text layer.
 *
 * The heavy lifting (grouping, hit testing, editing state) lives in
 * `@pdfshush/pdf-core` and is framework-independent. This module holds only the
 * pieces that are specific to the browser editor:
 *
 * - mapping extracted typography to the CSS font stack / standard PDF font the
 *   overlay and the exporter share,
 * - turning a paragraph into the whiteout + text objects the existing save path
 *   already understands,
 * - click-count and selection helpers that stay pure so they can be unit
 *   tested without a DOM.
 *
 * Coordinates here are display points (top-left origin, y down), the same
 * frame `PageLayout` and `PageInteractionModel` use.
 */

import {
  TEXT_LINE_HEIGHT,
  type BBox,
  type EditTextObject,
  type EditorObject,
  type PageInteractionModel,
  type PageLayout,
  type Paragraph,
  type SelectionAnchor,
  type TextSelection,
  type TextTypography,
} from '@pdfshush/pdf-core';

/** Standard fonts the save path can embed without shipping a font file. */
export type EditorFontFamily = 'helvetica' | 'times' | 'courier';

/** A selection as the overlay and clipboard need it. */
export interface TextSelectionState {
  pageIndex: number;
  anchor: SelectionAnchor;
  focus: SelectionAnchor;
  ranges: TextSelection[];
  text: string;
}

/** Initial state for the inline paragraph editor. */
export interface ParagraphEditState {
  pageIndex: number;
  paragraphId: string;
  /** Textarea value. Includes a list marker when the paragraph is a list item. */
  initialText: string;
  /** Selection in `initialText`. */
  initialSelection: { start: number; end: number };
  /** Bumped when the same paragraph is reopened so the textarea remounts. */
  token: number;
}

export interface ParagraphTextMutation {
  pageIndex: number;
  paragraphId: string;
  /** New display text (including a list marker when present). */
  text: string;
}

/** Stable key for per-paragraph edit objects. */
export function paragraphEditKey(pageIndex: number, paragraphId: string): string {
  return `${pageIndex}:${paragraphId}`;
}

/* ------------------------------------------------------------- typography */

/** CSS stack for the textarea and the preview, matching the old editor. */
export function cssFontStack(typography: Pick<TextTypography, 'fontFamily' | 'fontFamilyLabel'>): string {
  const family = resolvedFontFamily(typography);
  if (family === 'times') return "'Times New Roman', Times, serif";
  if (family === 'courier') return "'Courier New', Courier, monospace";
  return 'Arial, Helvetica, sans-serif';
}

/** Standard PDF font the exporter embeds. */
export function resolvedFontFamily(
  typography: Pick<TextTypography, 'fontFamily' | 'fontFamilyLabel'>,
): EditorFontFamily {
  if (typography.fontFamily === 'times') return 'times';
  if (typography.fontFamily === 'courier') return 'courier';
  if (typography.fontFamily === 'helvetica') return 'helvetica';
  // `other` still has to export as one of the three standard fonts. Keep the
  // closest match instead of silently switching every serif face to Arial.
  const label = (typography.fontFamilyLabel || '').toLowerCase();
  if (/times|serif|georgia|garamond|book|roman/.test(label)) return 'times';
  if (/courier|mono|consola|menlo/.test(label)) return 'courier';
  return 'helvetica';
}

/**
 * Line height as a multiple of the font size.
 *
 * A reconstructed paragraph can be set tighter or looser than 1.2 (tables and
 * headings often are). Measure the baselines of the extracted lines so the
 * textarea and the replacement box agree with the original leading.
 */
export function paragraphLineHeightRatio(paragraph: Paragraph, layout: PageLayout): number {
  if (paragraph.lineIds.length < 2) return TEXT_LINE_HEIGHT;
  const lineById = new Map(layout.lines.map((line) => [line.id, line]));
  const tops: number[] = [];
  for (const lineId of paragraph.lineIds) {
    const line = lineById.get(lineId);
    if (line) tops.push(line.bbox.y);
  }
  if (tops.length < 2) return TEXT_LINE_HEIGHT;
  tops.sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let index = 1; index < tops.length; index += 1) {
    const gap = tops[index]! - tops[index - 1]!;
    if (gap > 0.5) gaps.push(gap);
  }
  if (gaps.length === 0) return TEXT_LINE_HEIGHT;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)]!;
  const ratio = median / Math.max(1, paragraph.typography.fontSize);
  // Text with drop caps or vertical writing can produce absurd ratios; clamp to
  // a range that still renders legibly instead of trusting a bad extraction.
  return Math.min(2.4, Math.max(0.95, ratio));
}

/* --------------------------------------------------------------- display text */

/**
 * Text the overlay edits for a paragraph.
 *
 * List markers are part of the line but not of `Paragraph.text` (the model
 * stores the body so lists can be analysed). Editing must show the marker,
 * otherwise committing a list item would delete its bullet/number.
 */
export function paragraphDisplayText(paragraph: Paragraph): string {
  if (!paragraph.list) return paragraph.text;
  const marker = paragraph.list.marker.trim();
  if (!marker) return paragraph.text;
  return `${marker} ${paragraph.text}`.trimEnd();
}

/** Prefix length between display text and body offsets. */
export function paragraphDisplayPrefix(paragraph: Paragraph): number {
  const display = paragraphDisplayText(paragraph);
  return Math.max(0, display.length - paragraph.text.length);
}

/** Maps a body-offset selection to the textarea's display offsets. */
export function bodySelectionToDisplay(
  paragraph: Paragraph,
  selection: { start: number; end: number },
): { start: number; end: number } {
  const prefix = paragraphDisplayPrefix(paragraph);
  const max = paragraphDisplayText(paragraph).length;
  return {
    start: Math.min(max, Math.max(0, selection.start + prefix)),
    end: Math.min(max, Math.max(0, selection.end + prefix)),
  };
}

/* ------------------------------------------------------------------ selection */

/** Builds a selection state from two caret anchors, or null when collapsed. */
export function selectionFromAnchors(
  model: PageInteractionModel,
  pageIndex: number,
  anchor: SelectionAnchor,
  focus: SelectionAnchor,
): TextSelectionState | null {
  const multi = model.selectionBetween(anchor, focus);
  if (multi.ranges.length === 0) return null;
  return { pageIndex, anchor, focus, ranges: multi.ranges, text: multi.text };
}

/** Whole-paragraph selection, used by a triple click. */
export function paragraphSelectionState(
  model: PageInteractionModel,
  pageIndex: number,
  paragraphId: string,
): TextSelectionState | null {
  const selection = model.selectParagraph(paragraphId);
  if (!selection || selection.start === selection.end) return null;
  return {
    pageIndex,
    anchor: { paragraphId, offset: selection.start },
    focus: { paragraphId, offset: selection.end },
    ranges: [selection],
    text: selection.text,
  };
}

/** Word under a point, used by a double click / double-click edit. */
export function wordSelectionAt(
  model: PageInteractionModel,
  pageIndex: number,
  point: { x: number; y: number },
  tolerance = 3,
): { paragraphId: string; selection: TextSelectionState | null; range: { start: number; end: number } } | null {
  const word = model.hitWord(point, tolerance);
  if (!word) return null;
  const selection = model.selectWordAt(point, tolerance);
  if (!selection) return null;
  return {
    paragraphId: selection.paragraphId,
    selection: {
      pageIndex,
      anchor: { paragraphId: selection.paragraphId, offset: selection.start },
      focus: { paragraphId: selection.paragraphId, offset: selection.end },
      ranges: [selection],
      text: selection.text,
    },
    range: { start: selection.start, end: selection.end },
  };
}

/* ---------------------------------------------------------------- click count */

export interface ClickTracker {
  count: number;
  time: number;
  x: number;
  y: number;
  key: string;
}

const CLICK_WINDOW_MS = 450;
const CLICK_SLOP_PX = 6;

/**
 * Resolves single / double / triple clicks from pointerdown events.
 *
 * `PointerEvent.detail` is unreliable across browsers for pointerdown (it is
 * often 0), so the overlay tracks the sequence itself. Distance is measured in
 * screen pixels: the same physical tap must stay put while the page zoom
 * changes, not the same point-space delta.
 */
export function resolveClickCount(
  previous: ClickTracker | null,
  next: { time: number; x: number; y: number; key: string },
): ClickTracker {
  const repeated =
    previous !== null &&
    previous.key === next.key &&
    next.time - previous.time <= CLICK_WINDOW_MS &&
    Math.abs(next.x - previous.x) <= CLICK_SLOP_PX &&
    Math.abs(next.y - previous.y) <= CLICK_SLOP_PX;
  // Cap at three: a fourth rapid click is still "select the paragraph", not a
  // fourth semantic level.
  return {
    count: repeated ? Math.min(3, previous.count + 1) : 1,
    ...next,
  };
}

/* -------------------------------------------------------------- text metrics */

let measureContext: CanvasRenderingContext2D | null | undefined;
function textMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext !== undefined) return measureContext;
  if (typeof document === 'undefined') {
    measureContext = null;
    return measureContext;
  }
  measureContext = document.createElement('canvas').getContext('2d');
  return measureContext;
}

function countWrappedLines(
  text: string,
  fontSize: number,
  bold: boolean,
  italic: boolean,
  family: string,
  boxWidth: number,
): number {
  const context = textMeasureContext();
  if (!context) {
    return text.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 40)), 0);
  }
  context.font = `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${fontSize}px ${family}`;
  const fits = (value: string): boolean => context.measureText(value).width <= boxWidth;

  let lines = 0;
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      lines += 1;
      continue;
    }
    let line = '';
    for (const original of words) {
      let word = original;
      if (line !== '' && !fits(`${line} ${word}`)) {
        lines += 1;
        line = '';
      }
      while (word.length > 1 && !fits(word)) {
        let cut = word.length - 1;
        while (cut > 1 && !fits(word.slice(0, cut))) cut -= 1;
        if (line !== '') {
          lines += 1;
          line = '';
        }
        line = word.slice(0, cut);
        word = word.slice(cut);
      }
      line = line === '' ? word : `${line} ${word}`;
    }
    lines += 1;
  }
  return Math.max(1, lines);
}

/** Height a replacement text object needs for its content and box width. */
export function estimateTextHeight(
  text: string,
  typography: TextTypography,
  boxWidth: number,
  lineHeightRatio = TEXT_LINE_HEIGHT,
): number {
  const lines = countWrappedLines(
    text,
    typography.fontSize,
    typography.bold,
    typography.italic,
    cssFontStack(typography),
    Math.max(1, boxWidth),
  );
  return Math.max(
    typography.fontSize * lineHeightRatio,
    lines * typography.fontSize * lineHeightRatio,
  );
}

/* --------------------------------------------------------------- edit objects */

export interface ParagraphEditObjectOptions {
  /** Object id source; injected so tests can assert structure deterministically. */
  makeId: () => string;
  /** Minimum text box width in points. Defaults to 40. */
  minWidth?: number;
  /** Extra horizontal room so a reflowed last line is not clipped. Defaults to 0.6em. */
  widthPaddingFactor?: number;
  /** Padding around each line whiteout, in points. Defaults to 1.2. */
  coverPadding?: number;
  /** Overrides the measured line height (ratio of font size). */
  lineHeightRatio?: number;
}

export interface ParagraphEditObjects {
  whiteouts: EditorObject[];
  textObject: EditTextObject | null;
}

/**
 * Turns a committed paragraph edit into the overlay objects the existing
 * `text-edit` save path already handles: one whiteout per original line, plus
 * one text object holding the new text.
 *
 * Per-line covers are deliberate. A single paragraph-box whiteout would also
 * erase the leading between lines, and on sewn/undersized boxes could clip a
 * neighbouring paragraph. Covering exactly what was extracted is safer.
 */
export function buildParagraphEditObjects(
  paragraph: Paragraph,
  layout: PageLayout,
  displayText: string,
  options: ParagraphEditObjectOptions,
): ParagraphEditObjects {
  const lineIds = new Set(paragraph.lineIds);
  const lines = layout.lines.filter((line) => lineIds.has(line.id));
  const covers = lines.length > 0 ? lines.map((line) => line.bbox) : [paragraph.bbox];
  const pad = Math.max(0, options.coverPadding ?? 1.2);
  const whiteouts: EditorObject[] = covers.map((box) => ({
    id: options.makeId(),
    kind: 'whiteout',
    pageIndex: paragraph.pageIndex,
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  }));

  if (displayText.trim() === '') return { whiteouts, textObject: null };

  const typography = paragraph.typography;
  const fontSize = Math.min(72, Math.max(4, Math.round(typography.fontSize * 2) / 2));
  const lineHeightRatio = options.lineHeightRatio ?? paragraphLineHeightRatio(paragraph, layout);
  const widthPadding = fontSize * (options.widthPaddingFactor ?? 0.6);
  const width = Math.max(options.minWidth ?? 40, paragraph.bbox.width + widthPadding);
  const height = Math.max(
    paragraph.bbox.height,
    estimateTextHeight(displayText, { ...typography, fontSize }, width, lineHeightRatio),
  );
  const align =
    paragraph.alignment === 'center' || paragraph.alignment === 'right'
      ? paragraph.alignment
      : 'left';

  const textObject: EditTextObject = {
    id: options.makeId(),
    kind: 'text',
    pageIndex: paragraph.pageIndex,
    x: paragraph.bbox.x,
    y: paragraph.bbox.y,
    width,
    height,
    text: displayText,
    fontSize,
    bold: typography.bold,
    italic: typography.italic,
    fontFamily: resolvedFontFamily(typography),
    color: '#111827',
    align,
  };
  return { whiteouts, textObject };
}

/* ----------------------------------------------------------- text mutations */

/**
 * Applies clipboard/deletion operations to paragraph display text.
 *
 * `ranges` are body offsets from `PageInteractionModel`. The first range is
 * replaced with `replacement`; any further ranges (a cross-paragraph selection)
 * are deleted. Returns one entry per touched paragraph.
 */
export function mutateParagraphText(
  ranges: readonly TextSelection[],
  paragraphs: ReadonlyMap<string, Paragraph>,
  replacement: string,
): ParagraphTextMutation[] {
  interface PendingEdit {
    start: number;
    end: number;
    insert: string;
  }
  const byParagraph = new Map<string, { paragraph: Paragraph; edits: PendingEdit[] }>();

  ranges.forEach((range, index) => {
    const paragraph = paragraphs.get(range.paragraphId);
    if (!paragraph) return;
    const prefix = paragraphDisplayPrefix(paragraph);
    const displayLength = paragraphDisplayText(paragraph).length;
    const edit: PendingEdit = {
      start: Math.min(displayLength, Math.max(0, prefix + Math.min(range.start, range.end))),
      end: Math.min(displayLength, Math.max(0, prefix + Math.max(range.start, range.end))),
      // The caller passes ranges in reading order: the first one receives the
      // pasted text, the rest (a cross-paragraph selection) are removed.
      insert: index === 0 ? replacement : '',
    };
    const existing = byParagraph.get(range.paragraphId);
    if (existing) existing.edits.push(edit);
    else byParagraph.set(range.paragraphId, { paragraph, edits: [edit] });
  });

  const mutations: ParagraphTextMutation[] = [];
  for (const entry of byParagraph.values()) {
    let text = paragraphDisplayText(entry.paragraph);
    // Apply right-to-left so earlier offsets stay valid.
    for (const edit of [...entry.edits].sort((a, b) => b.start - a.start)) {
      text = `${text.slice(0, edit.start)}${edit.insert}${text.slice(edit.end)}`;
    }
    mutations.push({
      pageIndex: entry.paragraph.pageIndex,
      paragraphId: entry.paragraph.id,
      text,
    });
  }
  return mutations;
}

/** True when the mutation actually changed the paragraph's display text. */
export function paragraphMutationChanged(paragraph: Paragraph, text: string): boolean {
  return text !== paragraphDisplayText(paragraph);
}

/** Rectangles a selection should paint, already in display points. */
export function selectionRects(selection: TextSelectionState | null): BBox[] {
  if (!selection) return [];
  const rects: BBox[] = [];
  for (const range of selection.ranges) rects.push(...range.rects);
  return rects;
}
