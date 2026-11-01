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
import { applyFormValues } from '../ops/forms.js';
import { loadPdfDocument } from '../ops/pages.js';
import { wrapText } from '../document/reflow.js';
import type { BBox } from '../document/types.js';
import { encodeWithMap, readFontCharcodes, type FontCharcodesByPage } from './charcodes.js';
import { applyContentStreamEdits } from './contentStream.js';
import { verifyExportArtifact, type VisualEditRegion } from './exportVerify.js';
import {
  PdfiumTextDocument,
  type PdfiumTextBounds,
  type PdfiumTextObject,
} from './pdfium.js';
import { loadPdfiumModule } from './runtime.js';
import {
  TextEditUnsafeError,
  type TextEdit,
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
}

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
  /** True when at least one edit went through PDFium. */
  usedNativeEngine: boolean;
  verification: TextEditVerification;
  warnings: string[];
  name: string;
}

/** Collapse whitespace so pdf.js run joining and PDFium text objects agree. */
function normalize(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
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
  return normalize(text).replace(/\s+/gu, '');
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
  lines: { text: string; widthPt: number; bbox: BBox }[];
  lineHeight: number;
  x: number;
  fontPtr: number;
  fontSize: number;
  source: PdfiumTextObject;
  matrix: readonly [number, number, number, number, number, number];
  map: Map<number, number>;
  fontName: string;
  fontFamily?: 'helvetica' | 'times' | 'courier';
}

/** Printable ASCII maps one-to-one in the standard PDF fonts. */
function asciiCharcodeMap(): Map<number, number> {
  const map = new Map<number, number>();
  for (let code = 0x20; code <= 0x7e; code += 1) map.set(code, code);
  return map;
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
): { metrics: LayoutMetrics; targets: ObjectMatch[] } | { reason: string } {
  const plan = edit.layout!;
  if (plan.beforeLines.length === 0) return { reason: 'paragraph has no original lines to anchor' };
  const layoutUsed = new Set(used);
  const targets: ObjectMatch[] = [];
  for (const line of plan.beforeLines) {
    const match = matchObjects(doc, objects, layoutUsed, {
      ...edit,
      find: line.text,
      replace: 'x',
      box: line.box,
    });
    if (!match) return { reason: `no text object matches original line "${line.text.slice(0, 40)}"` };
    for (const member of match.members) layoutUsed.add(member.ptr);
    targets.push(match);
  }
  const source = targets[0]!.members[0]!;
  const fontPtr = source.fontPtr;
  const fontName = doc.fontNameOf(source.ptr);
  const documentMap = fontName ? fonts?.get(pageIndex)?.get(fontName) : undefined;
  const standardFont = fontName
    ? /^(helvetica|times|courier|arial|symbol|zapfdingbats)/i.test(fontName)
    : false;
  const map = documentMap ?? (standardFont ? asciiCharcodeMap() : undefined);
  if (!fontPtr || !map) {
    return { reason: 'original font has no document-derived encoding map' };
  }
  const fontSize = source.fontSize || plan.reflow.lineHeight || 12;
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
  const x = plan.reflow.x ?? plan.beforeLines[0]!.box.x;
  const top = plan.reflow.firstBaselineY - fontSize * 0.82;
  const geom = doc.geom(pageIndex);
  const pageWidth = geom.x1 - geom.x0;
  const pageHeight = geom.y1 - geom.y0;
  const created: { text: string; widthPt: number; bbox: BBox }[] = [];
  for (let index = 0; index < wrapped.lines.length; index += 1) {
    const line = wrapped.lines[index]!;
    const bbox: BBox = {
      x,
      y: top + index * plan.reflow.lineHeight,
      width: Math.max(1, line.widthPt),
      height: plan.reflow.lineHeight * 0.9,
    };
    if (bbox.x < -0.5 || bbox.y < -0.5 || bbox.x + bbox.width > pageWidth + 0.5 || bbox.y + bbox.height > pageHeight + 0.5) {
      return { reason: 'reflowed paragraph would leave the page' };
    }
    created.push({ text: line.text, widthPt: line.widthPt, bbox });
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
      const standardName =
        metrics.fontFamily === 'times'
          ? 'Times-Roman'
          : metrics.fontFamily === 'courier'
            ? 'Courier'
            : metrics.fontFamily === 'helvetica'
              ? 'Helvetica'
              : '';
      const standard = standardName ? doc.loadStandardFont(standardName) : 0;
      // For a standard-14 source font, a freshly loaded standard font is exact
      // and avoids reusing a document font pointer that some PDFium builds only
      // allow for rewriting existing objects.
      let ptr = doc.createTextObject(
        pageIndex,
        standard || metrics.fontPtr,
        metrics.fontSize,
        line.text,
        matrix,
        doc.objectFillColor(metrics.source.ptr),
        metrics.source.renderMode,
        charcodes,
      );
      if (!ptr && standard) {
        ptr = doc.createTextObject(
          pageIndex,
          metrics.fontPtr,
          metrics.fontSize,
          line.text,
          matrix,
          doc.objectFillColor(metrics.source.ptr),
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
          const plan = planLayoutEdit(doc, pageIndex, objects, used, edit, fonts);
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
    return { bytes, pageCount, outcomes, consumedFonts };
  } finally {
    doc.close();
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
  assertEditsValid(edits);

  const overlayObjects = options.objects ?? [];

  // Nothing to rewrite natively: skip PDFium entirely and go straight to the
  // overlay pass, so a document of pure new objects never needs the WASM engine.
  if (edits.length === 0) {
    const bytes = await applyOverlayPass(data, overlayObjects, options.formValues, ctx, password);
    return {
      bytes,
      nativeBytes: bytes,
      pageCount: await pageCountOf(bytes, password),
      outcomes: [],
      inPlace: 0,
      contentStream: 0,
      fallback: 0,
      manualReview: 0,
      usedNativeEngine: false,
      verification: { ok: true, checks: [] },
      warnings,
      name: options.outputName ?? 'edited.pdf',
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

  // Stage 2: reopen the serialized native bytes and look for each replacement.
  const outcomes: TextEditOutcome[] = native.outcomes.map((outcome) => ({ ...outcome }));
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
      (edit!.strategy === undefined || edit!.strategy === 'content-stream') &&
      edit!.replace.length > 0
    );
  });
  if (contentCandidates.length > 0) {
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
      if (applied.size > 0) {
        workingBytes = stream.bytes;
        for (const outcome of outcomes) {
          const replacement = applied.get(outcome.id);
          if (!replacement) continue;
          outcome.mode = 'content-stream';
          outcome.fidelity = 'high';
          delete outcome.reason;
        }
        warnings.push(
          `${applied.size} of ${edits.length} edits were written through the page content stream because no native text object could be rewritten.`,
        );
      } else {
        warnings.push('content-stream fallback found no safely anchored show operator');
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
  const hasOverlay = fallbackObjects.length > 0 || overlayObjects.length > 0;
  const finalBytes = hasOverlay
    ? await applyOverlayPass(
        workingBytes,
        [...overlayObjects, ...fallbackObjects],
        options.formValues,
        ctx,
        password,
      )
    : workingBytes;

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
    .filter((edit) => edit.replace.length > 0 || nativelyApplied(edit.id))
    .map((edit) => ({
      label: edit.id,
      pageIndex: edit.pageIndex,
      expect: edit.replace,
      ...(nativelyApplied(edit.id) && !edit.layout ? { find: edit.find } : {}),
    }));
  const editedRegions: VisualEditRegion[] = [];
  for (const edit of edits) {
    const outcomeBox = outcomes.find((outcome) => outcome.id === edit.id)?.box;
    const fallbackBoxes = (edit.fallback ?? []).map((object) => ({
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
    }));
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
  if (!verification.ok) {
    throw new TextEditUnsafeError([
      {
        kind: 'verification',
        detail: verification.checks
          .filter((check) => !check.ok)
          .map((check) => check.detail)
          .join('; '),
      },
    ]);
  }

  const inPlace = outcomes.filter((outcome) => outcome.mode === 'in-place').length;
  const contentStream = outcomes.filter((outcome) => outcome.mode === 'content-stream').length;
  const fallback = outcomes.filter((outcome) => outcome.mode === 'fallback').length;
  const manualReview = outcomes.filter((outcome) => outcome.mode === 'manual-review').length;
  return {
    bytes: finalBytes,
    nativeBytes: native.bytes,
    pageCount: native.pageCount,
    outcomes,
    inPlace,
    contentStream,
    fallback,
    manualReview,
    usedNativeEngine: inPlace > 0 || contentStream > 0,
    verification,
    warnings,
    name: options.outputName ?? 'edited.pdf',
  };
}

async function applyOverlayPass(
  data: Uint8Array,
  objects: EditorObject[],
  formValues: Record<string, string | boolean> | undefined,
  ctx: JobContext,
  password?: string,
): Promise<Uint8Array> {
  const doc = await loadPdfDocument(data, { ...(password ? { password } : {}) });
  const expectedPages = doc.getPageCount();
  await applyEdits(doc, objects, ctx);
  applyFormValues(doc, formValues ?? {});
  ctx.throwIfAborted();
  const saved = await doc.save({ useObjectStreams: false });
  const bytes = new Uint8Array(saved);
  await validateExport(bytes, expectedPages);
  return bytes;
}

async function pageCountOf(data: Uint8Array, password?: string): Promise<number> {
  const doc = await loadPdfDocument(data, { ...(password ? { password } : {}) });
  return doc.getPageCount();
}
