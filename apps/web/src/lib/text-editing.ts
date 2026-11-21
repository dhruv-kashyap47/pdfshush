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
  type EditTextNativePlan,
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
  /** Extra horizontal room so a reflowed last line is not clipped. Defaults to 1.2em. */
  widthPaddingFactor?: number;
  /** Padding around each line whiteout, in points. Defaults to 1.2. */
  coverPadding?: number;
  /** Overrides the measured line height (ratio of font size). */
  lineHeightRatio?: number;
  /** Capability-planned strategy for the native save path. */
  strategy?: 'native-object' | 'content-stream' | 'localized-reconstruction' | 'manual-review';
  /** BaseFont/FamilyName of the paragraph's document font, when known. */
  fontKey?: string;
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
function maxLinesInSpace(paragraph: Paragraph, layout: PageLayout, lineHeight: number): number {
  const top = paragraph.bbox.y;
  const right = paragraph.bbox.x + paragraph.bbox.width;
  let bottom = layout.heightPt - 4;
  const ownLines = new Set(paragraph.lineIds);
  for (const line of layout.lines) {
    if (ownLines.has(line.id)) continue;
    if (line.bbox.y < paragraph.bbox.y + paragraph.bbox.height - 0.5) continue;
    if (line.bbox.x + line.bbox.width <= paragraph.bbox.x || line.bbox.x >= right) continue;
    bottom = Math.min(bottom, line.bbox.y);
  }
  for (const table of layout.tables) {
    if (table.bbox.y < paragraph.bbox.y + paragraph.bbox.height - 0.5) continue;
    if (table.bbox.x + table.bbox.width <= paragraph.bbox.x || table.bbox.x >= right) continue;
    bottom = Math.min(bottom, table.bbox.y);
  }
  return Math.max(1, Math.floor((bottom - top) / Math.max(1, lineHeight)));
}

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
    role: 'decoration',
    pageIndex: paragraph.pageIndex,
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  }));

  const typography = paragraph.typography;
  const fontSize = Math.min(72, Math.max(4, Math.round(typography.fontSize * 2) / 2));
  const lineHeightRatio = options.lineHeightRatio ?? paragraphLineHeightRatio(paragraph, layout);
  const widthPadding = fontSize * (options.widthPaddingFactor ?? 1.2);
  const width = Math.max(options.minWidth ?? 40, paragraph.bbox.width + widthPadding);
  const lineHeight = fontSize * lineHeightRatio;
  const firstLine = lines[0];
  const native: EditTextNativePlan = {
    paragraphId: paragraph.id,
    before: paragraphDisplayText(paragraph),
    after: displayText,
    fontFamily: resolvedFontFamily(typography),
    beforeLines: lines.map((line) => ({
      text: line.text,
      box: {
        x: line.bbox.x,
        y: line.bbox.y,
        width: line.bbox.width,
        height: line.bbox.height,
      },
    })),
    coverIds: whiteouts.map((object) => object.id),
    reflow: {
      width,
      lineHeight,
      firstBaselineY: (firstLine?.bbox.y ?? paragraph.bbox.y) + fontSize * 0.82,
      x: paragraph.bbox.x,
      maxLines: maxLinesInSpace(paragraph, layout, lineHeight),
    },
    originalAlign: normalizedAlign(paragraph.alignment),
    originalFontFamily: resolvedFontFamily(typography),
    ...(options.strategy ? { strategy: options.strategy } : {}),
  };

  if (displayText.trim() === '') {
    // A paragraph deletion still needs a native intent; otherwise the save path
    // would have nothing to do but paint a whiteout. Carry the plan on the
    // first cover and let the engine remove the original text objects.
    const [firstCover, ...rest] = whiteouts;
    return {
      whiteouts: firstCover
        ? [{ ...(firstCover as EditorObject), native } as EditorObject, ...rest]
        : whiteouts,
      textObject: null,
    };
  }

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
    role: 'content',
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
    color: typography.color ?? '#111827',
    align,
    rasterFallback: true,
    native,
    ...(options.fontKey ? { fontKey: options.fontKey } : {}),
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

/* ------------------------------------------------------- paragraph records */

/** The colour a freshly built paragraph replacement uses when none is chosen. */
export const DEFAULT_TEXT_COLOR = '#111827';

/**
 * One committed paragraph edit.
 *
 * The record is the source of truth for "this paragraph was changed". It keeps
 * the native plan and the overlay objects together so the inspector can offer a
 * real revert, and so a draft can restore both without re-deriving them.
 */
export interface ParagraphEditRecord {
  pageIndex: number;
  paragraphId: string;
  /** Display text before the edit (list marker included). */
  before: string;
  /** Display text after the edit. */
  after: string;
  /** Overlay objects this edit owns (covers plus the replacement text). */
  objectIds: string[];
  /** Native reflow intent carried by the replacement object. */
  plan: EditTextNativePlan;
  /** True when the edit's style is currently served by the overlay path. */
  styled: boolean;
  /** Timestamp of the commit, for drafts and the details drawer. */
  savedAt: number;
}

/** Style fields the paragraph replacement can change from the original. */
export interface ParagraphStyleDiff {
  size: boolean;
  bold: boolean;
  italic: boolean;
  family: boolean;
  color: boolean;
  align: boolean;
  rotation: boolean;
  any: boolean;
  /** Human-readable field names, for the inspector note and receipt copy. */
  labels: string[];
}

function normalizedAlign(alignment: Paragraph['alignment']): 'left' | 'center' | 'right' {
  return alignment === 'center' || alignment === 'right' ? alignment : 'left';
}

/**
 * Which of the replacement object's style fields differ from the original
 * paragraph. This is what decides whether the native plan can honestly be used:
 * the engine's reflow keeps the document's own font, size, colour and alignment,
 * so a difference must be demoted to the overlay until the native style path
 * lands (T-06 engine half).
 */
export function paragraphStyleDiff(
  paragraph: Paragraph,
  object: Pick<
    EditTextObject,
    'fontSize' | 'bold' | 'italic' | 'fontFamily' | 'color' | 'align' | 'rotationDeg'
  >,
): ParagraphStyleDiff {
  const originalSize = Math.round(paragraph.typography.fontSize * 2) / 2;
  const size = Math.abs(object.fontSize - originalSize) > 0.26;
  const bold = Boolean(object.bold) !== paragraph.typography.bold;
  const italic = Boolean(object.italic) !== paragraph.typography.italic;
  const family = (object.fontFamily ?? 'helvetica') !== resolvedFontFamily(paragraph.typography);
  const color =
    (object.color ?? DEFAULT_TEXT_COLOR) !== (paragraph.typography.color ?? DEFAULT_TEXT_COLOR);
  const align = (object.align ?? 'left') !== normalizedAlign(paragraph.alignment);
  const originalRotation = Math.round(paragraph.typography.rotationDeg) % 360;
  const rotation = Math.abs(Math.round(object.rotationDeg ?? 0) - originalRotation) > 0.5;
  const labels: string[] = [];
  if (size) labels.push('size');
  if (bold) labels.push(bold ? 'bold' : 'weight');
  if (italic) labels.push(italic ? 'italic' : 'upright');
  if (family) labels.push('font family');
  if (color) labels.push('colour');
  if (align) labels.push('alignment');
  if (rotation) labels.push('rotation');
  return { size, bold, italic, family, color, align, rotation, any: labels.length > 0, labels };
}

/**
 * Moves a paragraph's native reflow origin by `dx`/`dy`.
 *
 * `beforeLines` deliberately stay at the original anchor: they identify the
 * glyphs to remove and the fallback covers must keep hiding them where they
 * are. Only the replacement's origin moves.
 */
export function offsetNativePlan(
  plan: EditTextNativePlan,
  dx: number,
  dy: number,
): EditTextNativePlan {
  if (dx === 0 && dy === 0) return plan;
  return {
    ...plan,
    reflow: {
      ...plan.reflow,
      x: plan.reflow.x + dx,
      firstBaselineY: plan.reflow.firstBaselineY + dy,
    },
  };
}

/** Body text plus the paragraph's list marker, ready for the overlay editor. */
export function displayTextForBody(paragraph: Paragraph, body: string): string {
  if (!paragraph.list) return body;
  const marker = paragraph.list.marker.trim();
  if (!marker) return body;
  return `${marker} ${body}`.trimEnd();
}

export interface SingleRunDeletion {
  /** The removed display text (never empty after trimming). */
  text: string;
  /** The original line that owns it, for geometry. */
  line: { text: string; box: BBox };
}

/**
 * C-05: recognises a pure, single-line deletion.
 *
 * A paragraph edit that only removes one contiguous span inside one original
 * line is exactly a content-stream deletion: remove those glyphs, compensate
 * the advance, leave every other byte alone. Reporting it as a full layout
 * rewrite would be true but coarser, and would force a cover on fallback. This
 * helper returns null for anything else (an insertion, a replacement, a change
 * spanning lines, repeated text it cannot disambiguate).
 */
export function singleRunDeletion(
  before: string,
  after: string,
  lines: readonly { text: string; box: BBox }[],
): SingleRunDeletion | null {
  if (after.length >= before.length || before.length === 0) return null;
  let start = 0;
  while (start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length - 1;
  let endAfter = after.length - 1;
  while (endAfter >= start && before[endBefore] === after[endAfter]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  if (endAfter >= start) return null; // an insertion or replacement, not a deletion
  const removed = before.slice(start, endBefore + 1);
  if (removed.trim().length === 0 || /[\r\n]/.test(removed)) return null;
  // It must sit inside exactly one original line; a span across a soft wrap is
  // not one show operator and must stay a reflow.
  const owners = lines.filter((line) => line.text.includes(removed));
  if (owners.length !== 1) return null;
  const owner = owners[0]!;
  if (owner.text !== removed && !owner.text.includes(removed)) return null;
  return { text: removed, line: owner };
}

/**
 * A reverse edit for a source whose bytes have already been rewritten.
 *
 * pdfshush saves from the *original* source every time, so a normal revert only
 * removes overlay objects. This builder exists for the one case where the
 * session's source is an exported artifact (a future in-place workflow): the
 * engine then needs a genuine edit putting the original text back. It returns
 * null when the replacement spans objects the engine could not match in one
 * pass, and the caller must warn instead of silently keeping the replacement.
 */
export function buildReverseParagraphEdit(
  record: ParagraphEditRecord,
  makeId: () => string,
): { id: string; pageIndex: number; find: string; replace: string } | null {
  // The native path can reverse a single text object exactly. Multi-line
  // replacements are refused rather than guessed at; nothing here pretends the
  // original is back when it cannot be.
  const after = record.plan.after;
  if (after.includes('\n') || record.before.includes('\n')) return null;
  return {
    id: makeId(),
    pageIndex: record.pageIndex,
    find: after,
    replace: record.before,
  };
}
