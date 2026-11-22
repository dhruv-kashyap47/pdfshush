/**
 * `editPdfText` — genuine in-place text editing, with an honest fallback.
 *
 * The write path has three stages and never skips the last two:
 *
 *   1. **Native pass (PDFium).** Each edit is matched to the document's own
 *      text object and rewritten with `FPDFText_SetText`, so its font, size,
 *      matrix, colour and position are the document's. This is real editing,
 *      not an overlay: the original glyphs are gone from the content stream.
 *   2. **Demotion.** The serialized native result is reopened with pdf.js and
 *      each replacement looked for. PDFium reports success even when a font
 *      cannot encode the new characters (it writes filler), so an edit that
 *      does not survive this read is demoted to the overlay path.
 *   3. **Final pass + verification.** Any demoted edit's caller-supplied
 *      overlay (and every extra editor object) is applied with pdf-lib, the
 *      result is re-parsed, and every replacement is confirmed present.
 *
 * An edit that cannot be resolved and has no fallback is refused, never
 * silently dropped. Deleting a run must succeed in place: it is never covered
 * with a cosmetic whiteout, because that would leave the text recoverable while
 * claiming it was removed.
 */

import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { createProgressReporter, type JobContext } from '../job.js';
import { LIMITS } from '../limits.js';
import { applyEdits, validateExport, type EditorObject } from '../ops/edit.js';
import { applyFormValues, extractFormWidgets } from '../ops/forms.js';
import { loadPdfDocument } from '../ops/pages.js';
import type { CanvasFactory } from '../render/canvas.js';
import { TEXT_ASCENT } from '../ops/textMetrics.js';
import { wrapText } from '../document/reflow.js';
import type { BBox } from '../document/types.js';
import { encodeWithMap, readFontCharcodes, type FontCharcodesByPage } from './charcodes.js';
import { applyContentStreamEdits } from './contentStream.js';
import { coverBox, detectWhiteBackground } from './cover.js';
import { verifyExportArtifact, type VisualEditRegion } from './exportVerify.js';
import { normalizeForMatch, withoutWhitespaceForMatch } from './text.js';
import {
  PdfiumTextDocument,
  type PdfiumTextBounds,
  type PdfiumTextObject,
} from './pdfium.js';
import { loadPdfiumModule } from './runtime.js';
import {
  TextEditUnsafeError,
  type EditStats,
  type TextEdit,
  type TextEditBox,
  type TextEditMode,
  type TextEditOutcome,
  type TextEditUnsafeReason,
  type TextEditVerification,
} from './types.js';
import { verifyTextEdits, type TextEditExpectation } from './verify.js';

export interface PdfiumEnvironment {
  /** Initialises a PDFium module. Injected so Node tests can supply the bytes. */
  loadModule(): Promise<WrappedPdfiumModule>;
}

export function defaultPdfiumEnvironment(): PdfiumEnvironment {
  return { loadModule: loadPdfiumModule };
}

export interface TextEditOptions {
  edits: TextEdit[];
  /** Extra editor objects (images, shapes, new text) applied in the final pass. */
  objects?: EditorObject[];
  /** AcroForm values applied in the final pass. */
  formValues?: Record<string, string | boolean>;
  outputName?: string;
  /** Render edited pages and compare unchanged pixels. Default true. */
  verifyVisual?: boolean;
  /**
   * Job-level engine strategy. `auto` is the verified ladder (native, then the
   * content-stream fallback, then the declared overlay). `native-only` refuses
   * the content-stream fallback, so a caller can demand genuine text-object
   * rewriting or an explicit failure. Unknown values are rejected by the job
   * validator; the engine guards again for direct callers.
   */
  strategy?: TextEngineStrategy;
  /** Canvas used by the C-09 raster fallback (tests inject a polyfill). */
  canvasFactory?: CanvasFactory;
  /**
   * X-03: a caller that has shown the user the untouched-page mismatch may
   * choose to accept it. Only failures that are entirely about untouched-page
   * text can be overridden; a structural or verification failure still refuses.
   */
  acceptUntouchedPageChanges?: boolean;
}

/** The engine strategies a job may request. */
export type TextEngineStrategy = 'auto' | 'native-only';

export const TEXT_ENGINE_STRATEGIES: readonly TextEngineStrategy[] = ['auto', 'native-only'];

/** Result of the PDFium pass alone, before any verification or overlay. */
export interface NativeTextEditResult {
  bytes: Uint8Array;
  pageCount: number;
  outcomes: TextEditOutcome[];
  /**
   * Base names (subset prefix stripped) of fonts whose last text object on some
   * page was removed by this pass. A legitimate edit can consume a font entirely --
   * collapsing a two-font run into one rewrite, or deleting the only run that used
   * it -- and the export verifier must tolerate those fonts disappearing without
   * tolerating the disappearance of a font no edit touched.
   */
  consumedFonts: Set<string>;
  /** Native-stage fidelity warnings (`font-substituted`, shrink/rotation refusals). */
  warnings: string[];
}

export interface TextEditRunResult {
  bytes: Uint8Array;
  nativeBytes: Uint8Array;
  pageCount: number;
  outcomes: TextEditOutcome[];
  inPlace: number;
  contentStream: number;
  fallback: number;
  manualReview: number;
  /** C-07 patches added over completed removals. */
  covers: number;
  /** Edits drawn as raster images. */
  rasterised: number;
  /** True when at least one edit went through PDFium. */
  usedNativeEngine: boolean;
  /** The strategy this run actually used. */
  strategy: TextEngineStrategy;
  verification: TextEditVerification;
  warnings: string[];
  name: string;
  /** X-02: counts the receipt renders, taken from the pass that did the work. */
  stats: EditStats;
}

/**
 * Collapse whitespace (and fold ligatures) so pdf.js run joining, PDFium text
 * objects and the user's selection agree on what the text says.
 */
function normalize(text: string): string {
  return normalizeForMatch(text);
}

/**
 * Whitespace removed.
 *
 * `clusterTextRuns` merges same-line pdf.js items and inserts a space whenever
 * the positioning gap exceeds 0.15em, so the editor's `find` can carry a space
 * the document never wrote: `(Hello) -120 (World)` is one text object reading
 * `HelloWorld` but is presented to the user as `Hello World`. Comparing without
 * whitespace matches the text the reader can see rather than the bytes behind it.
 */
function withoutWhitespace(text: string): string {
  return withoutWhitespaceForMatch(text);
}

/**
 * Equality that lets a glyph PDFium failed to decode stand in.
 *
 * `FPDFTextObj_GetText` hands back U+0002 for the trailing hyphen of a LaTeX
 * line whose content stream writes that character at charcode 45, which the
 * font's own `Encoding` declares `/hyphen`, `/ToUnicode` maps to U+002D, and
 * every reader displays as `-`. Nothing in the document explains the 0x02, so
 * translating it would be a guess -- and a wrong guess rewrites a line the user
 * did not select. Ignoring it is bounded instead: lengths must match and every
 * character that is *not* a control code must be identical, so the only runs
 * that can match are ones differing solely in glyphs PDFium already failed to
 * decode. A run that fails this test simply falls back to an overlay; it can
 * never select a different line.
 */
export function sameText(objectText: string, find: string): boolean {
  if (objectText === find) return true;
  if (objectText.length !== find.length) return false;
  for (let i = 0; i < objectText.length; i += 1) {
    const code = objectText.charCodeAt(i);
    const undecoded = code < 0x20 || (code >= 0x7f && code < 0xa0);
    if (!undecoded && objectText[i] !== find[i]) return false;
  }
  return true;
}

/**
 * Two objects sit on one visual line when their ink boxes overlap across the
 * cross axis and stay within a fraction of an em along it -- the same test
 * `clusterTextRuns` applies to pdf.js items, so every sequence joined here is
 * one the editor would have presented as a single line.
 */
function sameLine(a: PdfiumTextObject, b: PdfiumTextObject): boolean {
  const cross = Math.min(a.bounds.top - a.bounds.bottom, b.bounds.top - b.bounds.bottom);
  if (cross <= 0) return false;
  const overlap =
    Math.min(a.bounds.top, b.bounds.top) - Math.max(a.bounds.bottom, b.bounds.bottom);
  if (overlap < cross * 0.6) return false;
  const gap = Math.max(
    0,
    Math.max(a.bounds.left, b.bounds.left) - Math.min(a.bounds.right, b.bounds.right),
  );
  const em = Math.min(a.fontSize || 12, b.fontSize || 12);
  return gap <= em * 0.8;
}

function unionBounds(members: PdfiumTextObject[]): PdfiumTextBounds {
  const first = members[0]!.bounds;
  const bounds = { ...first };
  for (const member of members) {
    bounds.left = Math.min(bounds.left, member.bounds.left);
    bounds.bottom = Math.min(bounds.bottom, member.bounds.bottom);
    bounds.right = Math.max(bounds.right, member.bounds.right);
    bounds.top = Math.max(bounds.top, member.bounds.top);
  }
  return bounds;
}

/**
 * An edit's target: a single object, or a contiguous run of objects on one line.
 *
 * `members` are in content-stream order. The run is rewritten by writing the
 * replacement into `members[0]` and removing the rest, which keeps the run's
 * origin (so a left-aligned line does not jump) and leaves everything after it
 * untouched.
 */
interface ObjectMatch {
  members: PdfiumTextObject[];
  /** true when only the whitespace-insensitive comparison matched. */
  loose: boolean;
}

/**
 * Best target for an edit. Prefers exact text over the whitespace-insensitive
 * form, then the fewest objects (so a run only collapses when it must), and
 * finally the box the user clicked when the same text occurs more than once.
 */
function matchObjects(
  doc: PdfiumTextDocument,
  objects: PdfiumTextObject[],
  used: Set<number>,
  edit: TextEdit,
): ObjectMatch | undefined {
  const target = normalize(edit.find);
  const targetKey = withoutWhitespace(edit.find);
  if (targetKey.length === 0) return undefined;

  const cx = edit.box ? edit.box.x + edit.box.width / 2 : undefined;
  const cy = edit.box ? edit.box.y + edit.box.height / 2 : undefined;
  const distance = (members: PdfiumTextObject[]): number => {
    if (cx === undefined || cy === undefined) return 0;
    const rect = doc.objectDisplayRect(edit.pageIndex, unionBounds(members));
    return Math.hypot(rect.x + rect.width / 2 - cx, rect.y + rect.height / 2 - cy);
  };

  let best: ObjectMatch | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  const consider = (candidate: ObjectMatch): void => {
    const candidateDistance = distance(candidate.members);
    if (best) {
      if (candidate.loose !== best.loose) {
        if (candidate.loose) return;
      } else if (candidate.members.length !== best.members.length) {
        if (candidate.members.length > best.members.length) return;
      } else if (candidateDistance >= bestDistance) return;
    }
    best = candidate;
    bestDistance = candidateDistance;
  };

  for (let start = 0; start < objects.length; start += 1) {
    if (used.has(objects[start]!.ptr)) continue;
    let text = '';
    for (let end = start; end < objects.length; end += 1) {
      const member = objects[end]!;
      if (end > start && (used.has(member.ptr) || !sameLine(objects[end - 1]!, member))) break;
      text += member.text;
      const collapsed = normalize(text);
      const key = withoutWhitespace(text);
      const exact = sameText(collapsed, target);
      if (exact || sameText(key, targetKey)) {
        consider({ members: objects.slice(start, end + 1), loose: !exact });
        break;
      }
      // Both comparisons only grow as the concatenation grows, so once the
      // whitespace-free form has reached the target's length no extension matches.
      if (key.length >= targetKey.length) break;
    }
  }
  if (best || edit.replace.length !== 0) return best;

  // A replacement that found nothing resolves honestly through its own overlay
  // (cover and redraw, reported per edit). A *deletion* that found nothing has
  // no such fallback to protect, so its clicked geometry gets the last word.
  return matchEraseByBox(doc, objects, used, edit);
}

/**
 * Box-only erase matching, the last resort for a deletion the text comparison
 * cannot see.
 *
 * The editor's `find` is what the reading order extracts, but a document can
 * segment or decode the same line differently (a bullet glyph the reader
 * normalises away, objects split mid-word, a font that decodes to control
 * codes): when no concatenation equals it, an erase has no text anchor at all.
 * The run's own geometry is still the truth the user saw: every
 * text object whose ink sits inside the run's box *is* the run's glyphs no
 * matter how they are chunked, and removing those objects is a genuine
 * deletion -- the same guarantee the text-matched path gives, not a cover.
 *
 * Only deletes qualify for this path (the caller already filtered for them),
 * and the candidates are bounded to the run's own band so a stray or oversized
 * object -- a whole-paragraph stream, another line overhanging the box -- can
 * never be cleared by one tight selection.
 */
function matchEraseByBox(
  doc: PdfiumTextDocument,
  objects: PdfiumTextObject[],
  used: Set<number>,
  edit: TextEdit,
): ObjectMatch | undefined {
  const box = edit.box;
  if (!box || !(box.width > 0) || !(box.height > 0)) return undefined;
  // Both spaces are display-normalised (top-left, y down, positive sides), so
  // centre-in-box holds on rotated pages too. The margins stay tight on
  // purpose: the box and a PDFium object's bounds derive from the same glyph
  // metrics, so matched ink centres should agree within a couple of points.
  // A loose tolerance would reach the *neighbouring* line whenever one run
  // sits close under the other -- the box has to earn every object it takes.
  const marginX = Math.max(2, box.height * 0.5);
  const marginY = Math.max(2, box.height * 0.15);
  const members: PdfiumTextObject[] = [];
  for (const object of objects) {
    if (used.has(object.ptr)) continue;
    const rect = doc.objectDisplayRect(edit.pageIndex, object.bounds);
    if (rect.width <= 0 || rect.height <= 0) continue;
    // An object many times taller than the run is a stacked multi-line
    // stream, not the run; erasing it would be collateral damage.
    if (rect.height > box.height * 3) continue;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    if (cx < box.x - marginX || cx > box.x + box.width + marginX) continue;
    if (cy < box.y - marginY || cy > box.y + box.height + marginY) continue;
    members.push(object);
  }
  return members.length > 0 ? { members, loose: true } : undefined;
}

/**
 * A failure after the first original line has been mutated.
 *
 * Such an edit cannot be demoted to an overlay: the surviving native lines
 * would print alongside the overlay text. The engine refuses the whole export
 * instead.
 */
class LayoutMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayoutMutationError';
  }
}

/** Groups edits by page, preserving request order within each page. */
function groupByPage(edits: TextEdit[]): Map<number, TextEdit[]> {  const byPage = new Map<number, TextEdit[]>();
  for (const edit of edits) {
    const list = byPage.get(edit.pageIndex);
    if (list) list.push(edit);
    else byPage.set(edit.pageIndex, [edit]);
  }
  return byPage;
}

/** Measure one string with the document font, or null when a glyph is missing. */
function measureWithFont(
  doc: PdfiumTextDocument,
  fontPtr: number,
  map: ReadonlyMap<number, number> | null | undefined,
  text: string,
  fontSize: number,
): number | null {
  if (!map) return null;
  let width = 0;
  for (const character of text) {
    const code = map.get(character.codePointAt(0)!);
    if (code === undefined) {
      if (character === ' ') {
        width += fontSize * 0.25;
        continue;
      }
      return null;
    }
    const advance = doc.glyphWidth(fontPtr, code, fontSize);
    if (advance === null) return null;
    width += advance;
  }
  return width;
}

interface LayoutMetrics {
  lines: { text: string; widthPt: number; bbox: BBox; x: number; baselineY: number }[];
  lineHeight: number;
  x: number;
  fontPtr: number;
  fontSize: number;
  source: PdfiumTextObject;
  matrix: readonly [number, number, number, number, number, number];
  map: Map<number, number>;
  fontName: string;
  fontFamily?: 'helvetica' | 'times' | 'courier';
  /** Exact standard face for native new-line creation, when the source is one. */
  standardFace?: string;
  color?: { r: number; g: number; b: number; a: number };
  align?: 'left' | 'center' | 'right';
  /** Clockwise display-space rotation requested by T-07. */
  rotationDeg?: number;
  /** True when the requested size differs from the source size. */
  scaleToSize: boolean;
  /** The object's nominal font size before the edit. */
  sourceFontSize: number;
  syntheticBold: boolean;
  syntheticItalic: boolean;
}

/** Printable ASCII maps one-to-one in the standard PDF fonts. */
function asciiCharcodeMap(): Map<number, number> {
  const map = new Map<number, number>();
  for (let code = 0x20; code <= 0x7e; code += 1) map.set(code, code);
  return map;
}

/** Rotates a display-space offset clockwise (display y points down). */
function rotateClockwise(dx: number, dy: number, degreesClockwise: number): [number, number] {
  const radians = (degreesClockwise * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [dx * cos - dy * sin, dx * sin + dy * cos];
}

/** AABB of an upright display box rotated clockwise about a block pivot. */
function rotatedBox(
  box: BBox,
  pivotX: number,
  pivotY: number,
  degreesClockwise: number,
): BBox {
  const corners: Array<[number, number]> = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height],
    [box.x, box.y + box.height],
  ];
  const points = corners.map(([x, y]) => {
    const [rx, ry] = rotateClockwise(x - pivotX, y - pivotY, degreesClockwise);
    return [pivotX + rx, pivotY + ry] as const;
  });
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

/** Display region an overlay object paints, including a rotated text block. */
function objectVerifyBox(object: EditorObject): TextEditBox {
  if (object.kind === 'text' && object.rotationDeg) {
    return rotatedBox(
      { x: object.x, y: object.y, width: object.width, height: object.height },
      object.x,
      object.y + object.fontSize * TEXT_ASCENT,
      object.rotationDeg,
    );
  }
  return { x: object.x, y: object.y, width: object.width, height: object.height };
}

/** `#rrggbb`/`#rgb` -> unit RGB. Invalid values fall back to black. */
function parseHexColorToUnit(value: string): { r: number; g: number; b: number; a: number } {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return { r: 0, g: 0, b: 0, a: 1 };
  let hex = match[1]!;
  if (hex.length === 3) hex = hex.split('').map((part) => part + part).join('');
  const number = Number.parseInt(hex, 16);
  return {
    r: ((number >> 16) & 0xff) / 255,
    g: ((number >> 8) & 0xff) / 255,
    b: (number & 0xff) / 255,
    a: 1,
  };
}

function fontFamilyOf(baseName: string): 'helvetica' | 'times' | 'courier' | 'other' {
  const lower = baseName.toLowerCase();
  if (lower.includes('times') || lower.includes('serif') || lower.includes('roman')) return 'times';
  if (lower.includes('courier') || lower.includes('mono')) return 'courier';
  if (lower.includes('helvetica') || lower.includes('arial')) return 'helvetica';
  return 'other';
}

function standardFace(
  family: 'helvetica' | 'times' | 'courier',
  bold: boolean,
  italic: boolean,
): string {
  if (family === 'times') {
    return bold && italic
      ? 'Times-BoldItalic'
      : bold
        ? 'Times-Bold'
        : italic
          ? 'Times-Italic'
          : 'Times-Roman';
  }
  if (family === 'courier') {
    return bold && italic
      ? 'Courier-BoldOblique'
      : bold
        ? 'Courier-Bold'
        : italic
          ? 'Courier-Oblique'
          : 'Courier';
  }
  return bold && italic
    ? 'Helvetica-BoldOblique'
    : bold
      ? 'Helvetica-Bold'
      : italic
        ? 'Helvetica-Oblique'
        : 'Helvetica';
}

/**
 * Standard-14 face equivalent of a source font, or undefined when the source
 * is an embedded/custom face that `NewTextObj` cannot recreate.
 */
function standardFaceForSource(
  fontName: string,
  font: PdfiumTextObject['font'],
): string | undefined {
  // Same rule as the stream metrics: only names that really are base-14 faces.
  // A custom `MySansFace` or `HelveticaNeue` must not be recreated as Helvetica
  // just because the name contains a family word.
  const name = fontName.trim().toLowerCase().replace(/^[a-z]{6}\+/, '');
  if (/symbol|zapfdingbats/.test(name)) return undefined;
  const style = name.replace(/^[a-z]+/, '').replace(/[^a-z]/g, '');
  const family = /^courier(\b|$)|^courier[- ]/.test(name)
    ? 'courier'
    : /^times(\b|$)|^times[- ]/.test(name)
      ? 'times'
      : /^helvetica(\b|$)|^helvetica[- ]|^arial(\b|$)|^arial[- ]/.test(name)
        ? 'helvetica'
        : undefined;
  if (!family) return undefined;
  const bold =
    (font?.weight ?? 400) >= 600 || style.includes('bold') || style.includes('black');
  const italic =
    Math.abs(font?.italicAngle ?? 0) > 0.01 ||
    style.includes('italic') ||
    style.includes('oblique');
  return standardFace(family, bold, italic);
}

function isBoldFont(font: PdfiumTextObject['font']): boolean {
  if (!font) return false;
  return font.weight >= 600 || /bold|black|heavy|demi/i.test(font.baseName);
}

function isItalicFont(font: PdfiumTextObject['font']): boolean {
  if (!font) return false;
  return Math.abs(font.italicAngle) > 0.01 || /italic|oblique/i.test(font.baseName);
}

/**
 * Preflight a multi-line edit: match every original line, measure the new text
 * in the document's own font, reflow it, and verify the result fits the page and
 * does not overlap another page object. Nothing is mutated here.
 */
function planLayoutEdit(
  doc: PdfiumTextDocument,
  pageIndex: number,
  objects: PdfiumTextObject[],
  used: Set<number>,
  edit: TextEdit,
  fonts: FontCharcodesByPage | undefined,
  warnings: string[] = [],
): { metrics: LayoutMetrics; targets: ObjectMatch[] } | { reason: string } {
  const plan = edit.layout!;
  if (plan.beforeLines.length === 0) return { reason: 'paragraph has no original lines to anchor' };
  const layoutUsed = new Set(used);
  const targets: ObjectMatch[] = [];
  for (const [lineIndex, line] of plan.beforeLines.entries()) {
    const match = matchObjects(doc, objects, layoutUsed, {
      ...edit,
      find: line.text,
      replace: 'x',
      box: line.box,
    });
    // The refusal reason is logged and surfaced to callers, so it must not quote
    // the document's own text. The line's position identifies it for debugging.
    if (!match) return { reason: `no text object matches original line ${lineIndex}` };
    for (const member of match.members) layoutUsed.add(member.ptr);
    targets.push(match);
  }
  const source = targets[0]!.members[0]!;
  const style = plan.style;
  const fontName = doc.fontNameOf(source.ptr);
  const documentMap = fontName ? fonts?.get(pageIndex)?.get(fontName) : undefined;
  const standardFont = fontName
    ? /^(helvetica|times|courier|arial|symbol|zapfdingbats)/i.test(fontName)
    : false;
  const fontPtr = source.fontPtr;
  const map = documentMap ?? (standardFont ? asciiCharcodeMap() : undefined);
  if (!fontPtr || !map) {
    return { reason: 'original font has no document-derived encoding map' };
  }
  const sourceFamily = fontFamilyOf(fontName ?? source.font?.familyName ?? '');
  const sourceBold = isBoldFont(source.font);
  const sourceItalic = isItalicFont(source.font);
  const standardFaceName = fontName
    ? standardFaceForSource(fontName, source.font)
    : undefined;
  // T-06 on this PDFium build: new text objects cannot be created (their text
  // write is refused), so a style is applied to the *existing* objects --
  // matrix scale, shear (synthetic italic), rotation, fill colour and
  // fill+stroke (synthetic bold). A requested family that is not the document's
  // own, or un-bolding/un-italicising a face that has that style baked in,
  // cannot be expressed and goes to the overlay with a receipt.
  if (style?.fontFamily !== undefined && style.fontFamily !== sourceFamily) {
    warnings.push(
      `font-substituted: "${fontName ?? 'the document font'}" cannot become ${style.fontFamily} in place; ` +
        'the replacement is drawn with the requested standard face instead.',
    );
    return { reason: 'requested font family needs a substituted face' };
  }
  if (style?.bold === false && sourceBold) {
    return { reason: 'the original face is bold and cannot be made lighter in place' };
  }
  if (style?.italic === false && sourceItalic) {
    return { reason: 'the original face is italic and cannot be made upright in place' };
  }
  const syntheticBold = style?.bold === true && !sourceBold;
  const syntheticItalic = style?.italic === true && !sourceItalic;
  if (syntheticBold) {
    warnings.push(
      'synthetic-bold: the document face has no bold variant; the replacement is drawn with a synthetic stroke.',
    );
  }
  if (syntheticItalic) {
    warnings.push(
      'synthetic-italic: the document face has no italic variant; the replacement is drawn with an oblique shear.',
    );
  }
  const sourceSize = source.fontSize || plan.reflow.lineHeight || 12;
  const fontSize = style?.fontSize ?? sourceSize;
  const color = style?.color ? parseHexColorToUnit(style.color) : doc.objectFillColor(source.ptr);
  const measure = (text: string): number | null => measureWithFont(doc, fontPtr, map, text, fontSize);
  const wrapped =
    edit.replace.length === 0
      ? {
          lines: [] as { text: string; widthPt: number; index: number }[],
          overflow: false,
          exceedsMaxLines: false,
        }
      : wrapText(
          {
            text: edit.replace,
            width: plan.reflow.width,
            fontSize,
            lineHeightPt: plan.reflow.lineHeight,
            ...(plan.reflow.maxLines ? { maxLines: plan.reflow.maxLines } : {}),
          },
          (text) => measure(text) ?? Number.POSITIVE_INFINITY,
        );
  if (wrapped.overflow || wrapped.exceedsMaxLines) {
    return { reason: 'reflowed text does not fit the paragraph width/line budget' };
  }
  if (style && wrapped.lines.length > targets.length) {
    return {
      reason:
        'the styled replacement needs more line objects than the original; this build cannot create them, so the overlay carries the style',
    };
  }
  if (style?.rotationDeg !== undefined && plan.beforeLines.length > 1) {
    return {
      reason:
        'a rotated multi-line paragraph is drawn by the overlay so its lines share one pivot',
    };
  }
  const x = plan.reflow.x ?? plan.beforeLines[0]!.box.x;
  const top = plan.reflow.firstBaselineY - fontSize * 0.82;
  const geom = doc.geom(pageIndex);
  const pageWidth = geom.x1 - geom.x0;
  const pageHeight = geom.y1 - geom.y0;
  const align = style?.align;
  const rotationDeg = style?.rotationDeg;
  const created: { text: string; widthPt: number; bbox: BBox; x: number; baselineY: number }[] = [];
  for (let index = 0; index < wrapped.lines.length; index += 1) {
    const line = wrapped.lines[index]!;
    const lineX =
      align === 'center'
        ? x + (plan.reflow.width - line.widthPt) / 2
        : align === 'right'
          ? x + plan.reflow.width - line.widthPt
          : x;
    const rawBox: BBox = {
      x: lineX,
      y: top + index * plan.reflow.lineHeight,
      width: Math.max(1, line.widthPt),
      height: plan.reflow.lineHeight * 0.9,
    };
    // A rotated block's collision/verification box is the AABB of its corners,
    // not the upright line box.
    const bbox = rotationDeg
      ? rotatedBox(rawBox, x, plan.reflow.firstBaselineY, rotationDeg)
      : rawBox;
    if (bbox.x < -0.5 || bbox.y < -0.5 || bbox.x + bbox.width > pageWidth + 0.5 || bbox.y + bbox.height > pageHeight + 0.5) {
      return { reason: 'reflowed paragraph would leave the page' };
    }
    created.push({
      text: line.text,
      widthPt: line.widthPt,
      bbox,
      x: lineX,
      baselineY: plan.reflow.firstBaselineY + index * plan.reflow.lineHeight,
    });
  }

  const consumed = new Set(targets.flatMap((target) => target.members.map((member) => member.ptr)));
  const otherObjects = doc.listPageObjectBounds(pageIndex);
  for (const object of otherObjects) {
    if (consumed.has(object.ptr)) continue;
    const rect = doc.objectDisplayRect(pageIndex, object.bounds);
    for (const line of created) {
      const overlap =
        Math.min(rect.x + rect.width, line.bbox.x + line.bbox.width) -
        Math.max(rect.x, line.bbox.x);
      const vertical =
        Math.min(rect.y + rect.height, line.bbox.y + line.bbox.height) -
        Math.max(rect.y, line.bbox.y);
      if (overlap > 0.5 && vertical > 0.5) {
        return { reason: `reflow would collide with a ${object.kind} object on page ${pageIndex + 1}` };
      }
    }
  }

  return {
    metrics: {
      lines: created,
      lineHeight: plan.reflow.lineHeight,
      x,
      fontPtr,
      fontSize,
      source,
      matrix: source.matrix ?? [fontSize, 0, 0, fontSize, 0, 0],
      map,
      fontName: fontName ?? '',
      ...(plan.fontFamily ? { fontFamily: plan.fontFamily } : {}),
      ...(standardFaceName ? { standardFace: standardFaceName } : {}),
      color,
      ...(align ? { align } : {}),
      ...(rotationDeg !== undefined ? { rotationDeg } : {}),
      scaleToSize:
        style?.fontSize !== undefined && Math.abs(style.fontSize - sourceSize) > 0.01,
      sourceFontSize: sourceSize,
      syntheticBold,
      syntheticItalic,
    },
    targets,
  };
}

/**
 * Record the base font of every object about to be removed, so the export verifier
 * can tolerate a font that an edit legitimately consumed (its last text object is
 * gone) without tolerating the loss of a font no edit touched. The name is read
 * before removal because the pointer is invalid afterwards.
 */
function noteConsumedFonts(
  doc: PdfiumTextDocument,
  ptrs: Iterable<number>,
  consumedFonts: Set<string>,
): void {
  for (const ptr of ptrs) {
    const name = doc.fontNameOf(ptr);
    if (name) consumedFonts.add(name);
  }
}

/** Apply a preflighted multi-line edit. Throws rather than leaving half a paragraph. */
function applyLayoutEdit(
  doc: PdfiumTextDocument,
  pageIndex: number,
  edit: TextEdit,
  plan: { metrics: LayoutMetrics; targets: ObjectMatch[] },
  consumedFonts: Set<string>,
): void {
  const { metrics, targets } = plan;
  const map = metrics.map;
  const created: number[] = [];
  try {
    // Create overflow lines first. If this fails, nothing has been rewritten.
    for (let index = targets.length; index < metrics.lines.length; index += 1) {
      const line = metrics.lines[index]!;
      const baselineY = edit.layout!.reflow.firstBaselineY + index * metrics.lineHeight;
      const [x, y] = doc.viewPointToPdf(pageIndex, { x: metrics.x, y: baselineY });
      const matrix = [metrics.matrix[0], metrics.matrix[1], metrics.matrix[2], metrics.matrix[3], x, y] as const;
      const charcodes = encodeWithMap(map, line.text);
      // Standard-14 sources use FPDFPageObj_NewTextObj: the only creation path
      // that is safe in this PDFium build. Embedded/custom faces cannot be
      // recreated here and still take the declared overlay fallback.
      let ptr = metrics.standardFace
        ? doc.createStandardTextObject(
            pageIndex,
            metrics.standardFace,
            metrics.fontSize,
            line.text,
            matrix,
            metrics.color,
            metrics.source.renderMode,
          )
        : 0;
      if (!ptr) {
        ptr = doc.createTextObject(
          pageIndex,
          metrics.fontPtr,
          metrics.fontSize,
          line.text,
          matrix,
          metrics.color,
          metrics.source.renderMode,
          charcodes,
        );
      }
      if (!ptr) throw new Error(`PDFium refused to create a reflowed line (${doc.lastCreateError})`);
      created.push(ptr);
    }

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]!;
      if (index >= metrics.lines.length) {
        noteConsumedFonts(doc, target.members.map((member) => member.ptr), consumedFonts);
        const failed = target.members.filter((member) => !doc.removeObject(pageIndex, member.ptr));
        if (failed.length > 0) {
          throw new LayoutMutationError('PDFium refused to remove an unused original line');
        }
        continue;
      }
      const replacement = metrics.lines[index]!.text;
      const first = target.members[0]!;
      const charcodes = encodeWithMap(map, replacement);
      const written =
        (charcodes !== null && doc.setCharcodes(first.ptr, charcodes)) ||
        doc.setText(first.ptr, replacement);
      if (!written) throw new LayoutMutationError('PDFium refused to rewrite a reflowed line');

      // T-06/T-07: apply the requested style to the *existing* object. New text
      // objects cannot be created in this PDFium build, so size is a matrix
      // scale, italic is a shear, rotation is a matrix rotation, colour is a
      // fill write, and bold is synthetic fill+stroke. The face itself is never
      // silently swapped; a family change goes to the overlay with a receipt.
      const original = doc.objectMatrix(first.ptr);
      if (original) {
        let [a, b, c, d] = original;
        if (metrics.scaleToSize) {
          // The matrix already carries the document's own scale. Divide it out
          // so a requested 24 pt is 24 pt, not 24 multiplied by whatever
          // transform the source object happened to use.
          const matrixScale = Math.hypot(original[0], original[1]) || 1;
          const fontScale = metrics.fontSize / Math.max(0.01, metrics.sourceFontSize * matrixScale);
          a *= fontScale;
          b *= fontScale;
          c *= fontScale;
          d *= fontScale;
        }
        if (metrics.syntheticItalic) {
          // Shear x by y: 12 degrees is the conventional oblique angle.
          const shear = Math.tan((12 * Math.PI) / 180);
          c += a * shear;
          d += b * shear;
        }
        if (metrics.rotationDeg !== undefined) {
          // Display clockwise -> PDF counter-clockwise is negative.
          const radians = (-metrics.rotationDeg * Math.PI) / 180;
          const cos = Math.cos(radians);
          const sin = Math.sin(radians);
          const na = a * cos + c * sin;
          const nb = b * cos + d * sin;
          const nc = -a * sin + c * cos;
          const nd = -b * sin + d * cos;
          a = na;
          b = nb;
          c = nc;
          d = nd;
        }
        const beforeLine = edit.layout!.beforeLines[index]?.box;
        const firstBefore = edit.layout!.beforeLines[0]?.box;
        const alignMoves = metrics.align !== undefined;
        const needsOrigin =
          Boolean(edit.layout!.reflow.moved) || alignMoves || metrics.rotationDeg !== undefined;
        let e = original[4];
        let f = original[5];
        if (needsOrigin) {
          const baseX = edit.layout!.reflow.moved
            ? metrics.x + (beforeLine && firstBefore ? beforeLine.x - firstBefore.x : 0)
            : alignMoves
              ? metrics.lines[index]!.x
              : beforeLine?.x ?? metrics.lines[index]!.x;
          let baselineX = baseX;
          let baselineY = edit.layout!.reflow.firstBaselineY + index * metrics.lineHeight;
          if (metrics.rotationDeg !== undefined) {
            // Rotate the whole block around the first line's baseline start,
            // not each line around its own origin. Otherwise the second line of
            // a rotated paragraph lands on top of the first.
            const pivotX = metrics.x;
            const pivotY = edit.layout!.reflow.firstBaselineY;
            const [rx, ry] = rotateClockwise(
              baseX - pivotX,
              baselineY - pivotY,
              metrics.rotationDeg,
            );
            baselineX = pivotX + rx;
            baselineY = pivotY + ry;
          }
          [e, f] = doc.viewPointToPdf(pageIndex, { x: baselineX, y: baselineY });
        }
        if (!doc.setObjectMatrix(first.ptr, [a, b, c, d, e, f])) {
          throw new LayoutMutationError('PDFium refused to style a reflowed line');
        }
        if (metrics.color) {
          if (!doc.setObjectFillColor(first.ptr, metrics.color)) {
            throw new LayoutMutationError('PDFium refused to apply the text colour');
          }
          if (
            metrics.syntheticBold &&
            metrics.source.renderMode !== 3 &&
            !doc.setSyntheticBold(first.ptr, metrics.color, metrics.fontSize * 0.03)
          ) {
            throw new LayoutMutationError('PDFium refused to apply synthetic bold');
          }
        }
      }
      const tails = target.members.slice(1);
      noteConsumedFonts(doc, tails.map((tail) => tail.ptr), consumedFonts);
      const failed = tails.filter((tail) => !doc.removeObject(pageIndex, tail.ptr));
      if (failed.length > 0) {
        throw new LayoutMutationError('PDFium refused to remove a split line object');
      }
    }
  } catch (error) {
    for (const ptr of created) {
      try {
        doc.removeObject(pageIndex, ptr);
      } catch {
        /* best effort before the whole document is discarded */
      }
    }
    throw error;
  }
}


/**
 * Runs the PDFium native pass only, returning the serialized bytes and a
 * provisional outcome per edit. Split out so tests can exercise the mutation
 * without pdf.js verification.
 */
export function applyNativeTextEdits(
  module: WrappedPdfiumModule,
  data: Uint8Array,
  edits: TextEdit[],
  ctx: JobContext,
  password?: string,
  fonts?: FontCharcodesByPage,
): NativeTextEditResult {
  const doc = PdfiumTextDocument.open(module, data, password ?? '');
  const progress = createProgressReporter(ctx);
  const provisional = new Map<
    string,
    { mode: TextEditMode; reason?: string; box?: import('./types.js').TextEditBox }
  >();
  const consumedFonts = new Set<string>();
  const warnings: string[] = [];
  try {
    const pageCount = doc.pageCount();
    const byPage = [...groupByPage(edits).entries()].sort((a, b) => a[0] - b[0]);

    let done = 0;
    for (const [pageIndex, pageEdits] of byPage) {
      ctx.throwIfAborted();
      if (pageIndex < 0 || pageIndex >= pageCount) {
        throw new TextEditUnsafeError([
          { kind: 'invalid-edit', detail: `edit targets page ${pageIndex + 1}, which does not exist` },
        ]);
      }
      const objects = doc.listTextObjects(pageIndex);
      const used = new Set<number>();
      for (const edit of pageEdits) {
        if (edit.strategy === 'manual-review') {
          throw new TextEditUnsafeError([
            {
              kind: 'unresolvable',
              detail: `edit "${edit.id}" is marked for manual review; fidelity cannot be guaranteed`,
            },
          ]);
        }
        if (edit.strategy && edit.strategy !== 'native-object' && !edit.layout) {
          provisional.set(edit.id, {
            mode: 'fallback',
            reason: `requested strategy: ${edit.strategy}`,
          });
          done += 1;
          progress.step(done, edits.length, `Editing page ${pageIndex + 1}`);
          continue;
        }
        if (edit.layout) {
          const plan = planLayoutEdit(doc, pageIndex, objects, used, edit, fonts, warnings);
          if ('reason' in plan) {
            provisional.set(edit.id, { mode: 'fallback', reason: plan.reason });
          } else {
            try {
              applyLayoutEdit(doc, pageIndex, edit, plan, consumedFonts);
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error);
              if (error instanceof LayoutMutationError) {
                throw new TextEditUnsafeError([
                  {
                    kind: 'unresolvable',
                    detail: `layout edit "${edit.id}" failed after rewriting part of page ${pageIndex + 1}: ${detail}; refusing to overlay a partially rewritten paragraph`,
                  },
                ]);
              }
              provisional.set(edit.id, {
                mode: 'fallback',
                reason: `native reflow could not create a line atomically: ${detail}`,
              });
              done += 1;
              progress.step(done, edits.length, `Editing page ${pageIndex + 1}`);
              continue;
            }
            for (const target of plan.targets) {
              for (const member of target.members) used.add(member.ptr);
            }
            const xs = plan.metrics.lines.map((line) => line.bbox.x);
            const ys = plan.metrics.lines.map((line) => line.bbox.y);
            const rights = plan.metrics.lines.map((line) => line.bbox.x + line.bbox.width);
            const bottoms = plan.metrics.lines.map((line) => line.bbox.y + line.bbox.height);
            for (const line of edit.layout!.beforeLines) {
              xs.push(line.box.x);
              ys.push(line.box.y);
              rights.push(line.box.x + line.box.width);
              bottoms.push(line.box.y + line.box.height);
            }
            const box =
              xs.length > 0
                ? {
                    x: Math.min(...xs),
                    y: Math.min(...ys),
                    width: Math.max(...rights) - Math.min(...xs),
                    height: Math.max(...bottoms) - Math.min(...ys),
                  }
                : edit.box;
            provisional.set(edit.id, { mode: 'in-place', ...(box ? { box } : {}) });
          }
          done += 1;
          progress.step(done, edits.length, `Editing page ${pageIndex + 1}`);
          continue;
        }
        const target = matchObjects(doc, objects, used, edit);
        if (!target) {
          provisional.set(edit.id, {
            mode: 'fallback',
            reason: 'no text object on the page matches the selected run',
          });
        } else if (edit.replace.length === 0) {
          // Deletion is a removal, not a rewrite: FPDFText_SetText refuses an
          // empty string, and a whiteout would leave the text recoverable. A run
          // has to disappear whole, so every member is removed.
          noteConsumedFonts(doc, target.members.map((member) => member.ptr), consumedFonts);
          const failed = target.members.filter(
            (member) => !doc.removeObject(pageIndex, member.ptr),
          );
          if (failed.length > 0) {
            throw new TextEditUnsafeError([
              {
                kind: 'unresolvable',
                detail:
                  `edit "${edit.id}" matched ${target.members.length} text objects on page ` +
                  `${pageIndex + 1} and PDFium refused to remove ${failed.length} of them; ` +
                  'the run cannot be deleted in place, and covering it would only hide it',
              },
            ]);
          }
          for (const member of target.members) used.add(member.ptr);
          provisional.set(edit.id, { mode: 'in-place' });
        } else {
          const first = target.members[0]!;
          // Prefer the document's own charcodes over PDFium's Unicode
          // re-encoding: on subset fonts that re-encoding writes the wrong
          // glyphs *and* reports success, whereas a map derived from the
          // document's own /ToUnicode and /Encoding is what the reader decodes
          // with. A font with no usable map keeps the old behaviour, and
          // verification still runs over whatever is written, so an over-eager
          // map costs an overlay rather than a bad file.
          const charcodes = encodeWithMap(
            fonts?.get(pageIndex)?.get(doc.fontNameOf(first.ptr) ?? ''),
            edit.replace,
          );
          const written =
            (charcodes !== null && doc.setCharcodes(first.ptr, charcodes)) ||
            doc.setText(first.ptr, edit.replace);
          if (!written) {
            provisional.set(edit.id, {
              mode: 'fallback',
              reason: 'PDFium refused to rewrite the text object',
            });
          } else {
            // The replacement takes the first member's slot, so the remaining
            // members would print the line a second time. Failing here is
            // refused outright rather than left to a best effort: a document
            // that says the text twice is worse than one that fails loudly.
            const tails = target.members.slice(1);
            noteConsumedFonts(doc, tails.map((tail) => tail.ptr), consumedFonts);
            const failed = tails.filter((tail) => !doc.removeObject(pageIndex, tail.ptr));
            if (failed.length > 0) {
              throw new TextEditUnsafeError([
                {
                  kind: 'unresolvable',
                  detail:
                    `edit "${edit.id}" rewrote its first text object but PDFium refused to ` +
                    `remove ${failed.length} of the ${tails.length} remaining matched objects ` +
                    `on page ${pageIndex + 1}, which would print the line twice`,
                },
              ]);
            }
            for (const member of target.members) used.add(member.ptr);
            provisional.set(edit.id, { mode: 'in-place' });
          }
        }
        done += 1;
        progress.step(done, edits.length, `Editing page ${pageIndex + 1}`);
      }
      // Objects are invalidated by a regenerate, so the page is flushed once all
      // of its edits are applied.
      if (used.size > 0 && !doc.generate(pageIndex)) {
        throw new TextEditUnsafeError([
          { kind: 'unresolvable', detail: `page ${pageIndex + 1} could not be regenerated` },
        ]);
      }
    }

    const bytes = doc.serialize();
    const outcomes: TextEditOutcome[] = edits.map((edit) => {
      const state = provisional.get(edit.id) ?? {
        mode: 'fallback' as const,
        reason: 'edit was not attempted',
      };
      return {
        id: edit.id,
        pageIndex: edit.pageIndex,
        mode: state.mode,
        ...(state.reason ? { reason: state.reason } : {}),
        ...(state.box ? { box: state.box } : edit.box ? { box: edit.box } : {}),
      };
    });
    return { bytes, pageCount, outcomes, consumedFonts, warnings };
  } finally {
    doc.close();
  }
}

/** C-13: no edit may vanish between the request and the outcome list. */
function assertOutcomeCoverage(edits: readonly TextEdit[], outcomes: readonly TextEditOutcome[]): void {
  const covered = new Set(outcomes.map((outcome) => outcome.id));
  const missing = edits.filter((edit) => !covered.has(edit.id));
  if (missing.length > 0) {
    throw new TextEditUnsafeError(
      missing.map((edit) => ({
        kind: 'unresolvable' as const,
        detail: `edit "${edit.id}" produced no outcome; refusing to export an edit that was silently dropped`,
      })),
    );
  }
}

/** Validates every edit before any WASM work, so a bad request costs nothing. */
function assertEditsValid(edits: TextEdit[]): void {
  const reasons: TextEditUnsafeReason[] = [];
  if (edits.length > LIMITS.tool.maxTextEdits) {
    reasons.push({
      kind: 'too-many-edits',
      detail: `${edits.length} edits exceeds the ${LIMITS.tool.maxTextEdits}-edit limit`,
    });
  }
  const seen = new Set<string>();
  for (const edit of edits) {
    if (!edit.id || seen.has(edit.id)) {
      reasons.push({ kind: 'invalid-edit', detail: `duplicate or missing edit id "${edit.id}"` });
    }
    seen.add(edit.id);
    if (edit.find.length === 0) {
      reasons.push({ kind: 'invalid-edit', detail: `edit "${edit.id}" has an empty find string` });
    }
    if (!Number.isInteger(edit.pageIndex) || edit.pageIndex < 0) {
      reasons.push({
        kind: 'invalid-edit',
        detail: `edit "${edit.id}" targets page index ${edit.pageIndex}, which is not a non-negative integer`,
      });
    }
    if (edit.box) {
      const { x, y, width, height } = edit.box;
      if (
        ![x, y, width, height].every((value) => Number.isFinite(value)) ||
        width <= 0 ||
        height <= 0
      ) {
        reasons.push({
          kind: 'invalid-edit',
          detail: `edit "${edit.id}" has an invalid box (${x}, ${y}, ${width}x${height})`,
        });
      }
    }
    if (edit.layout && edit.layout.beforeLines.length === 0) {
      reasons.push({
        kind: 'invalid-edit',
        detail: `layout edit "${edit.id}" has no original lines to anchor against`,
      });
    }
    const style = edit.layout?.style;
    if (style) {
      if (
        style.fontSize !== undefined &&
        (!Number.isFinite(style.fontSize) || style.fontSize <= 0 || style.fontSize > 288)
      ) {
        reasons.push({
          kind: 'invalid-edit',
          detail: `layout edit "${edit.id}" has an invalid style font size`,
        });
      }
      if (
        style.color !== undefined &&
        !/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(style.color.trim())
      ) {
        reasons.push({
          kind: 'invalid-edit',
          detail: `layout edit "${edit.id}" has an invalid style colour`,
        });
      }
      if (
        style.bold !== undefined &&
        typeof style.bold !== 'boolean'
      ) {
        reasons.push({
          kind: 'invalid-edit',
          detail: `layout edit "${edit.id}" has an invalid bold flag`,
        });
      }
      if (style.italic !== undefined && typeof style.italic !== 'boolean') {
        reasons.push({
          kind: 'invalid-edit',
          detail: `layout edit "${edit.id}" has an invalid italic flag`,
        });
      }
      if (
        style.fontFamily !== undefined &&
        !['helvetica', 'times', 'courier'].includes(style.fontFamily)
      ) {
        reasons.push({
          kind: 'invalid-edit',
          detail: `layout edit "${edit.id}" has an invalid font family`,
        });
      }
      if (
        style.align !== undefined &&
        !['left', 'center', 'right'].includes(style.align)
      ) {
        reasons.push({
          kind: 'invalid-edit',
          detail: `layout edit "${edit.id}" has an invalid alignment`,
        });
      }
      if (
        style.rotationDeg !== undefined &&
        (!Number.isFinite(style.rotationDeg) || Math.abs(style.rotationDeg) > 360)
      ) {
        reasons.push({
          kind: 'invalid-edit',
          detail: `layout edit "${edit.id}" has an invalid rotation`,
        });
      }
    }
    if (edit.coverPolicy !== undefined && edit.coverPolicy !== 'leftover-cover') {
      reasons.push({
        kind: 'invalid-edit',
        detail: `edit "${edit.id}" has an unknown cover policy`,
      });
    }
    if (
      edit.find.length > LIMITS.tool.maxTextEditChars ||
      edit.replace.length > LIMITS.tool.maxTextEditChars
    ) {
      reasons.push({
        kind: 'invalid-edit',
        detail: `edit "${edit.id}" exceeds the ${LIMITS.tool.maxTextEditChars}-character limit`,
      });
    }
    if (edit.strategy === 'manual-review') {
      reasons.push({
        kind: 'unresolvable',
        detail: `edit "${edit.id}" is marked for manual review; fidelity cannot be guaranteed`,
      });
    }
  }
  if (reasons.length > 0) throw new TextEditUnsafeError(reasons);
}

/**
 * X-02: character counts that do not lie about overlays.
 *
 * A fallback draws new text over the original, so its replacement characters
 * were added but the original characters were *not* removed from the file. Only
 * `in-place` and `content-stream` outcomes consume the original text.
 */
export function countCharacterChanges(
  edits: readonly TextEdit[],
  outcomes: readonly TextEditOutcome[],
): { removed: number; added: number } {
  const modeById = new Map(outcomes.map((outcome) => [outcome.id, outcome.mode] as const));
  let removed = 0;
  let added = 0;
  for (const edit of edits) {
    const mode = modeById.get(edit.id);
    if (!mode || mode === 'manual-review') continue;
    added += edit.replace.length;
    if (mode === 'in-place' || mode === 'content-stream') removed += edit.find.length;
  }
  return { removed, added };
}

/**
 * Full edit path: native rewrite, verification-driven demotion, overlay pass for
 * the demoted edits (and any extra editor objects), then a final verified save.
 */
export async function editPdfText(
  data: Uint8Array,
  options: TextEditOptions,
  ctx: JobContext,
  environment: PdfiumEnvironment = defaultPdfiumEnvironment(),
  password?: string,
): Promise<TextEditRunResult> {
  const edits = options.edits ?? [];
  const warnings: string[] = [];
  const strategy = options.strategy ?? 'auto';
  if (!TEXT_ENGINE_STRATEGIES.includes(strategy)) {
    throw new TextEditUnsafeError([
      { kind: 'invalid-edit', detail: `unknown text engine strategy "${String(strategy)}"` },
    ]);
  }
  assertEditsValid(edits);

  // C-13: every edit must carry enough geometry to be grounded, or say so. A
  // text-only match is still attempted; the warning is what stops a silently
  // dropped edit from looking like success.
  for (const edit of edits) {
    if (!edit.box && !edit.layout) {
      warnings.push(
        `edit-coverage: edit "${edit.id}" has no geometry; matching relies on its text alone`,
      );
    }
  }

  const overlayObjects = options.objects ?? [];

  // Nothing to rewrite natively: skip PDFium entirely and go straight to the
  // overlay pass, so a document of pure new objects never needs the WASM engine.
  if (edits.length === 0) {
    const overlay = await applyOverlayPass(
      data,
      overlayObjects,
      options.formValues,
      ctx,
      password,
      options.canvasFactory,
      { verifyOutput: true, visual: options.verifyVisual !== false },
    );
    warnings.push(...overlay.warnings);
    enforceVerification(overlay.verification, options.acceptUntouchedPageChanges, warnings);
    return {
      bytes: overlay.bytes,
      nativeBytes: overlay.bytes,
      pageCount: overlay.pageCount,
      outcomes: [],
      inPlace: 0,
      contentStream: 0,
      fallback: 0,
      manualReview: 0,
      covers: 0,
      rasterised: overlay.rasterisedObjectIds.size,
      usedNativeEngine: false,
      strategy,
      verification: overlay.verification,
      warnings: [...new Set(warnings)],
      name: options.outputName ?? 'edited.pdf',
      stats: {
        pages: overlay.pageCount,
        textEdits: 0,
        charactersRemoved: 0,
        charactersAdded: 0,
        objectsDrawn: overlay.stats.objectsDrawn,
        imagesDrawn: overlay.stats.imagesDrawn,
        fontsEmbedded: overlay.stats.fontsEmbedded,
        fontsSubstituted: warnings.filter((warning) => warning.startsWith('font-substituted:')).length,
        glyphsRasterised: overlay.rasterisedObjectIds.size,
        covers: 0,
        strategy,
        verification: overlay.verification.ok ? 'passed' : 'failed',
        verificationChecks: overlay.verification.checks.length,
        ocrPages: 0,
      },
    };
  }

  let module: WrappedPdfiumModule;
  try {
    module = await environment.loadModule();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TextEditUnsafeError([{ kind: 'no-pdfium', detail }]);
  }

  // Charcode maps come from the document's own /ToUnicode and /Encoding, so
  // they are read once here and handed to the pass instead of being re-parsed
  // per page. A document that cannot be read simply yields no maps.
  const fonts = await readFontCharcodes(data, password);
  const native = applyNativeTextEdits(module, data, edits, ctx, password, fonts);
  if (native.warnings.length > 0) {
    warnings.push(...native.warnings);
  }

  // Stage 2: reopen the serialized native bytes and look for each replacement.
  const outcomes: TextEditOutcome[] = native.outcomes.map((outcome) => ({ ...outcome }));
  assertOutcomeCoverage(edits, outcomes);
  // Carrying `find` makes verification also confirm the original text was consumed,
  // not just that the replacement is present. A native write can be reported as a
  // success while leaving the original run intact (e.g. the replacement string
  // already existed on the page), and a "present" check alone would pass it. Only
  // non-layout in-place replacements are checked here: a reflowed paragraph rewrites
  // many objects, so its `find` string is not a reliable absence oracle.
  const expectations: TextEditExpectation[] = outcomes
    .filter(
      (outcome) =>
        outcome.mode === 'in-place' &&
        (edits.find((edit) => edit.id === outcome.id)?.replace.length ?? 0) > 0,
    )
    .map((outcome) => {
      const edit = edits.find((candidate) => candidate.id === outcome.id)!;
      return {
        label: outcome.id,
        pageIndex: outcome.pageIndex,
        expect: edit.replace,
        ...(edit.layout ? {} : { find: edit.find }),
      };
    });

  if (expectations.length > 0) {
    const roundTrip = await verifyTextEdits(native.bytes, {
      expectedPageCount: native.pageCount,
      expectations,
      original: data,
      ...(password ? { password } : {}),
    });
    const reopens = roundTrip.checks.find((check) => check.name === 'reopens');
    if (reopens && !reopens.ok) {
      throw new TextEditUnsafeError([
        { kind: 'verification', detail: reopens.detail },
      ]);
    }
    const failed = new Set(
      roundTrip.checks
        .filter(
          (check) =>
            !check.ok &&
            (check.name.startsWith('replacement-present:') ||
              check.name.startsWith('residual-original:')),
        )
        .map((check) =>
          check.name.startsWith('replacement-present:')
            ? check.name.slice('replacement-present:'.length)
            : check.name.slice('residual-original:'.length),
        ),
    );
    for (const outcome of outcomes) {
      if (outcome.mode === 'in-place' && failed.has(outcome.id)) {
        const sourceEdit = edits.find((edit) => edit.id === outcome.id);
        if (sourceEdit?.layout) {
          // A multi-line edit may already have rewritten some lines. Falling back
          // to an overlay would duplicate the surviving text, so this is a hard
          // verification failure rather than a demotion.
          throw new TextEditUnsafeError([
            {
              kind: 'verification',
              detail: `layout edit "${outcome.id}" did not survive re-extraction; refusing to overlay a partially rewritten paragraph`,
            },
          ]);
        }
        outcome.mode = 'fallback';
        outcome.reason = 'in-place write did not survive re-extraction';
      }
    }
  }

  // Strategy B: a native fallback may still be safely editable by rewriting the
  // original show operator, provided the font encoding is fully understood. It
  // is attempted only for single-line replacements and is verified again below.
  let workingBytes = native.bytes;
  const contentCandidates = outcomes.filter((outcome) => {
    const edit = edits.find((candidate) => candidate.id === outcome.id);
    return (
      outcome.mode === 'fallback' &&
      Boolean(edit) &&
      !edit!.layout &&
      (edit!.strategy === undefined || edit!.strategy === 'content-stream')
    );
  });
  if (contentCandidates.length > 0 && strategy === 'auto') {
    try {
      const stream = await applyContentStreamEdits(
        workingBytes,
        contentCandidates
          .map((outcome) => edits.find((edit) => edit.id === outcome.id))
          .filter((edit): edit is TextEdit => Boolean(edit)),
        fonts,
        ctx,
        password,
      );
      const applied = new Map(
        stream.outcomes
          .filter((outcome) => outcome.mode === 'content-stream')
          .map((outcome) => [outcome.id, outcome] as const),
      );
      let accepted = false;
      if (applied.size > 0) {
        // C-12: a stream rewrite is only accepted after its own reopening check.
        // A mismatch discards the rewrite and leaves those edits for the overlay,
        // with a warning, instead of exporting a rewrite verification rejected.
        const appliedEdits = edits.filter((edit) => applied.has(edit.id));
        const streamCheck = await verifyTextEdits(stream.bytes, {
          expectedPageCount: native.pageCount,
          expectations: appliedEdits.map((edit) => ({
            label: edit.id,
            pageIndex: edit.pageIndex,
            expect: edit.replace,
            find: edit.find,
          })),
          original: workingBytes,
          ...(password ? { password } : {}),
        });
        const failed = streamCheck.checks.filter(
          (check) =>
            !check.ok &&
            (check.name.startsWith('replacement-present:') ||
              check.name.startsWith('residual-original:')),
        );
        if (failed.length > 0) {
          warnings.push(
            `content-stream rewrite was discarded after verification: ${failed
              .map((check) => check.detail)
              .join('; ')}`,
          );
        } else {
          accepted = true;
        }
      }
      if (accepted) {
        workingBytes = stream.bytes;
        for (const outcome of outcomes) {
          const replacement = applied.get(outcome.id);
          if (!replacement) continue;
          outcome.mode = 'content-stream';
          outcome.fidelity = 'high';
          if (replacement.box && !outcome.box) outcome.box = replacement.box;
          delete outcome.reason;
        }
        warnings.push(
          `${applied.size} of ${edits.length} edits were written through the page content stream because no native text object could be rewritten.`,
        );
      } else {
        if (applied.size === 0) {
          warnings.push('content-stream fallback found no safely anchored show operator');
        } else {
          warnings.push('content-stream fallback was not used because its rewrite did not survive verification');
        }
      }
      if (!stream.complete) {
        for (const limitation of stream.limitations) warnings.push(limitation);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      warnings.push(`content-stream fallback was not used: ${detail}`);
    }
  }

  // A deletion must not be re-expressed as a cosmetic cover.
  for (const outcome of outcomes) {
    const replaceLength = edits.find((edit) => edit.id === outcome.id)?.replace.length ?? 0;
    if (outcome.mode === 'fallback' && replaceLength === 0) {
      throw new TextEditUnsafeError([
        {
          kind: 'unresolvable',
          detail: `edit "${outcome.id}" deletes text that could not be removed in place (${outcome.reason}); refusing to cover it cosmetically`,
        },
      ]);
    }
  }

  // C-07: an explicit leftover-cover request. The removal must have completed;
  // the background is sampled once per page, and a coloured page is refused
  // with a warning rather than given a visible white rectangle.
  const coverObjects: EditorObject[] = [];
  let covers = 0;
  const coverBoxesByPage = new Map<number, { edit: TextEdit; boxes: TextEditBox[] }[]>();
  for (const outcome of outcomes) {
    const edit = edits.find((candidate) => candidate.id === outcome.id);
    if (!edit || edit.coverPolicy !== 'leftover-cover') continue;
    // A replacement already occupies the removed box; painting a patch after a
    // native rewrite would cover the new glyphs. Only a deletion leaves an
    // empty region where a leftover edge can show.
    if (edit.replace.length !== 0) continue;
    if (outcome.mode !== 'in-place' && outcome.mode !== 'content-stream') continue;
    const boxes = edit.layout
      ? edit.layout.beforeLines.map((line) => line.box)
      : outcome.removedBox || outcome.box || edit.box
        ? [outcome.removedBox ?? outcome.box ?? edit.box!]
        : [];
    if (boxes.length === 0) continue;
    const list = coverBoxesByPage.get(edit.pageIndex);
    if (list) list.push({ edit, boxes });
    else coverBoxesByPage.set(edit.pageIndex, [{ edit, boxes }]);
  }
  for (const [pageIndex, entries] of coverBoxesByPage) {
    const allBoxes = entries.flatMap((entry) => entry.boxes);
    let decision;
    try {
      decision = await detectWhiteBackground(data, pageIndex, allBoxes, {
        ...(password ? { password } : {}),
      });
    } catch (error) {
      warnings.push(
        `leftover-cover-skipped: page ${pageIndex + 1}: could not read the page background ` +
          `(${error instanceof Error ? error.message : String(error)}); the glyphs are removed but no patch was added.`,
      );
      continue;
    }
    if (!decision.white) {
      warnings.push(
        `leftover-cover-skipped: page ${pageIndex + 1}: ${decision.reason ?? 'background is not white'}; ` +
          'the glyphs are still removed, but a faint edge may remain.',
      );
      continue;
    }
    for (const entry of entries) {
      entry.boxes.forEach((box, index) => {
        const padded = coverBox(box);
        coverObjects.push({
          id: `leftover-cover-${entry.edit.id}-${index}`,
          // A plain `rect` with the page's own paper colour: on an off-white
          // page a pure-white whiteout would be visible.
          kind: 'rect',
          role: 'decoration',
          fill: decision.paper ?? '#ffffff',
          pageIndex,
          ...padded,
        });
        covers += 1;
      });
    }
  }
  if (covers > 0) {
    warnings.push(
      `leftover-cover: ${covers} small patch${covers === 1 ? '' : 'es'} added over completed removals to hide antialiased edges. ` +
        'This is a visual patch, not redaction; the original glyphs are absent from the text layer.',
    );
  }

  // `native-only` is a strict promise: no content-stream rewrite and no overlay.
  // If any edit could not be rewritten as a real text object, fail instead of
  // quietly turning it into a painted replacement.
  if (strategy === 'native-only') {
    const nonNative = outcomes.filter((outcome) => outcome.mode !== 'in-place');
    if (nonNative.length > 0) {
      throw new TextEditUnsafeError(
        nonNative.map((outcome) => ({
          kind: 'unresolvable' as const,
          detail: `native-only strategy: edit "${outcome.id}" (${outcome.mode}${outcome.reason ? `: ${outcome.reason}` : ''}) is not a native text-object rewrite`,
        })),
      );
    }
  }

  // Stage 3: overlay pass for demoted edits plus every extra editor object.
  const fallbackEdits = outcomes.filter((outcome) => outcome.mode === 'fallback');
  const unresolved = fallbackEdits.filter(
    (outcome) => (edits.find((edit) => edit.id === outcome.id)?.fallback?.length ?? 0) === 0,
  );
  if (unresolved.length > 0) {
    throw new TextEditUnsafeError(
      unresolved.map((outcome) => ({
        kind: 'unresolvable' as const,
        detail: `edit "${outcome.id}" is not natively editable (${outcome.reason}) and supplied no fallback`,
      })),
    );
  }

  const fallbackObjects = fallbackEdits.flatMap(
    (outcome) => edits.find((edit) => edit.id === outcome.id)?.fallback ?? [],
  );
  // Form values are part of the save request just like an overlay object. They
  // used to be applied only when some overlay happened to exist, so filling a
  // field while a text edit succeeded natively silently dropped the form value.
  const formValues = options.formValues ?? {};
  const hasFormValues = Object.keys(formValues).length > 0;
  const hasOverlay =
    fallbackObjects.length > 0 || coverObjects.length > 0 || overlayObjects.length > 0 || hasFormValues;
  const overlay = hasOverlay
    ? await applyOverlayPass(
        workingBytes,
        // Covers first: a user-added shape on the same page must sit above the
        // generated patch, not be erased by it. Fallback text stays on top.
        [...coverObjects, ...overlayObjects, ...fallbackObjects],
        options.formValues,
        ctx,
        password,
        options.canvasFactory,
        { verifyOutput: false, visual: false },
      )
    : undefined;
  if (overlay) warnings.push(...overlay.warnings);
  const finalBytes = overlay?.bytes ?? workingBytes;
  const rasterisedObjectIds = overlay?.rasterisedObjectIds ?? new Set<string>();

  if (fallbackObjects.length > 0) {
    warnings.push(
      `${fallbackEdits.length} of ${edits.length} edits were applied as overlays: the original text ` +
        'could not be rewritten in place, so it was covered and the replacement drawn on top.',
    );
  }

  // Final gate: reopen the bytes we are about to hand back, verify structure and
  // font resources, confirm every replacement is extractable, and compare the
  // rendered page outside the edited regions. A replacement string being present
  // is necessary but not sufficient.
  //
  // Carrying `find` for natively-applied edits (in-place and content-stream) makes
  // the gate also confirm the original text was consumed -- this is what catches a
  // no-op write whose replacement string already existed on the page, and what gives
  // deletions a real post-export absence check for the first time. Overlay-fallback
  // edits do not carry `find`: the original is still extractable underneath the
  // whiteout, so requiring its absence there would be a false failure. Layout edits
  // also do not: a reflowed paragraph rewrites many objects, so its `find` string is
  // not a reliable absence oracle.
  const outcomeModeById = new Map(outcomes.map((outcome) => [outcome.id, outcome.mode] as const));
  const nativelyApplied = (id: string): boolean => {
    const mode = outcomeModeById.get(id);
    return mode === 'in-place' || mode === 'content-stream';
  };
  const finalExpectations: TextEditExpectation[] = edits
    .filter(
      (edit) =>
        !rasterisedObjectIds.has(edit.id) &&
        (edit.replace.length > 0 || nativelyApplied(edit.id)),
    )
    .map((edit) => ({
      label: edit.id,
      pageIndex: edit.pageIndex,
      expect: edit.replace,
      ...(nativelyApplied(edit.id) && !edit.layout ? { find: edit.find } : {}),
    }));
  const editedRegions: VisualEditRegion[] = [];
  for (const edit of edits) {
    const outcomeBox = outcomes.find((outcome) => outcome.id === edit.id)?.box;
    const fallbackBoxes = (edit.fallback ?? []).map(objectVerifyBox);
    if (fallbackBoxes.length > 0 || outcomeBox || edit.box) {
      const boxes = [
        ...fallbackBoxes,
        ...(outcomeBox ? [outcomeBox] : edit.box ? [edit.box] : []),
      ];
      const x = Math.min(...boxes.map((box) => box.x));
      const y = Math.min(...boxes.map((box) => box.y));
      const right = Math.max(...boxes.map((box) => box.x + box.width));
      const bottom = Math.max(...boxes.map((box) => box.y + box.height));
      editedRegions.push({
        pageIndex: edit.pageIndex,
        box: { x, y, width: right - x, height: bottom - y },
      });
      continue;
    }
    const lines = edit.layout?.beforeLines ?? [];
    if (lines.length > 0) {
      const x = Math.min(...lines.map((line) => line.box.x));
      const y = Math.min(...lines.map((line) => line.box.y));
      const right = Math.max(...lines.map((line) => line.box.x + line.box.width));
      const bottom = Math.max(...lines.map((line) => line.box.y + line.box.height));
      editedRegions.push({
        pageIndex: edit.pageIndex,
        box: { x, y, width: right - x, height: bottom - y },
      });
    }
  }
  // Extra overlay objects are expected changes too. Without their boxes, the
  // untouched-page text check would see new text on a page no edit declared and
  // fail a save that did exactly what was asked (mixed text + object exports).
  for (const object of overlayObjects) {
    editedRegions.push({
      pageIndex: object.pageIndex,
      box: objectVerifyBox(object),
    });
  }
  // Filling a field legitimately repaints its widget appearance. The visual gate
  // compares the whole page outside the text-edit regions, so the widgets whose
  // values changed have to be declared as expected changes too -- otherwise a
  // mixed text + form save would be refused for doing exactly what was asked.
  if (hasFormValues) {
    const originalDoc = await loadPdfDocument(data, { ...(password ? { password } : {}) });
    for (const widget of extractFormWidgets(originalDoc)) {
      if (!Object.prototype.hasOwnProperty.call(formValues, widget.name)) continue;
      editedRegions.push({ pageIndex: widget.pageIndex, box: widget.rect });
    }
  }
  const verification = await verifyExportArtifact({
    original: data,
    output: finalBytes,
    expectedPageCount: native.pageCount,
    expectations: finalExpectations,
    editedRegions,
    consumedFonts: native.consumedFonts,
    ...(options.verifyVisual !== undefined ? { visual: options.verifyVisual } : {}),
    ctx,
    ...(password ? { password } : {}),
  });
  enforceVerification(verification, options.acceptUntouchedPageChanges, warnings);

  const inPlace = outcomes.filter((outcome) => outcome.mode === 'in-place').length;
  const contentStream = outcomes.filter((outcome) => outcome.mode === 'content-stream').length;
  const fallback = outcomes.filter((outcome) => outcome.mode === 'fallback').length;
  const manualReview = outcomes.filter((outcome) => outcome.mode === 'manual-review').length;
  for (const outcome of outcomes) {
    if (rasterisedObjectIds.has(outcome.id)) outcome.rasterised = true;
  }
  const rasterised = outcomes.filter((outcome) => outcome.rasterised).length;
  const { removed: charactersRemoved, added: charactersAdded } = countCharacterChanges(
    edits,
    outcomes,
  );
  const stats: EditStats = {
    pages: native.pageCount,
    textEdits: edits.length,
    charactersRemoved,
    charactersAdded,
    objectsDrawn: overlay?.stats.objectsDrawn ?? 0,
    imagesDrawn: overlay?.stats.imagesDrawn ?? 0,
    fontsEmbedded: overlay?.stats.fontsEmbedded ?? 0,
    fontsSubstituted: warnings.filter((warning) => warning.startsWith('font-substituted:')).length,
    glyphsRasterised: rasterised,
    covers,
    strategy,
    verification: verification.ok ? 'passed' : 'failed',
    verificationChecks: verification.checks.length,
    ocrPages: 0,
  };
  return {
    bytes: finalBytes,
    nativeBytes: native.bytes,
    pageCount: native.pageCount,
    outcomes,
    inPlace,
    contentStream,
    fallback,
    manualReview,
    covers,
    rasterised,
    usedNativeEngine: inPlace > 0 || contentStream > 0,
    strategy,
    verification,
    warnings: [...new Set(warnings)],
    stats,
    name: options.outputName ?? 'edited.pdf',
  };
}

interface OverlayPassResult {
  bytes: Uint8Array;
  pageCount: number;
  warnings: string[];
  rasterisedObjectIds: Set<string>;
  verification: TextEditVerification;
  stats: { objectsDrawn: number; imagesDrawn: number; fontsEmbedded: number };
}

async function applyOverlayPass(
  data: Uint8Array,
  objects: EditorObject[],
  formValues: Record<string, string | boolean> | undefined,
  ctx: JobContext,
  password?: string,
  canvasFactory?: CanvasFactory,
  verify: { verifyOutput?: boolean; visual?: boolean } = {},
): Promise<OverlayPassResult> {
  const doc = await loadPdfDocument(data, { ...(password ? { password } : {}) });
  const expectedPages = doc.getPageCount();
  const warnings: string[] = [];
  const rasterisedObjectIds = new Set<string>();
  // Widget rects are read before the values change, so the visual gate knows
  // which regions the form fill legitimately repainted (X-03).
  const widgets = extractFormWidgets(doc);
  const stats = await applyEdits(doc, objects, ctx, {
    warnings,
    rasterisedObjectIds,
    ...(canvasFactory ? { canvasFactory } : {}),
  });
  applyFormValues(doc, formValues ?? {});
  ctx.throwIfAborted();
  const saved = await doc.save({ useObjectStreams: false });
  const bytes = new Uint8Array(saved);
  await validateExport(bytes, expectedPages);

  const editedRegions: VisualEditRegion[] = objects.map((object) => ({
    pageIndex: object.pageIndex,
    box: objectVerifyBox(object),
  }));
  if (formValues) {
    for (const widget of widgets) {
      if (!Object.prototype.hasOwnProperty.call(formValues, widget.name)) continue;
      editedRegions.push({ pageIndex: widget.pageIndex, box: widget.rect });
    }
  }
  const verification =
    verify.verifyOutput === false
      ? { ok: true, checks: [] }
      : await verifyExportArtifact({
          original: data,
          output: bytes,
          expectedPageCount: expectedPages,
          expectations: [],
          editedRegions,
          ...(verify.visual === false ? { visual: false } : {}),
          ctx,
          ...(password ? { password } : {}),
        });
  return { bytes, pageCount: expectedPages, warnings, rasterisedObjectIds, verification, stats };
}

/**
 * X-03: the untouched-page text check is the one failure a user may knowingly
 * accept ("download anyway"). Everything else still refuses. Accepting adds an
 * `untouched-page-accepted` warning so the receipt cannot pretend the pages
 * matched.
 */
export function enforceVerification(
  verification: TextEditVerification,
  acceptUntouched: boolean | undefined,
  warnings: string[],
): void {
  if (verification.ok) return;
  const failures = verification.checks.filter((check) => !check.ok);
  const untouchedOnly =
    failures.length > 0 &&
    failures.every(
      (check) =>
        check.name.startsWith('untouched-page-text') || check.name.startsWith('untouched-pages'),
    );
  if (acceptUntouched && untouchedOnly) {
    warnings.push(
      `untouched-page-accepted: ${failures.map((check) => `${check.name}: ${check.detail}`).join('; ')}`,
    );
    return;
  }
  throw new TextEditUnsafeError([
    {
      kind: untouchedOnly ? 'untouched-page-changed' : 'verification',
      detail: failures.map((check) => `${check.name}: ${check.detail}`).join('; '),
    },
  ]);
}