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
import { encodeWithMap, readFontCharcodes, type FontCharcodesByPage } from './charcodes.js';
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
}

/** Result of the PDFium pass alone, before any verification or overlay. */
export interface NativeTextEditResult {
  bytes: Uint8Array;
  pageCount: number;
  outcomes: TextEditOutcome[];
}

export interface TextEditRunResult {
  bytes: Uint8Array;
  nativeBytes: Uint8Array;
  pageCount: number;
  outcomes: TextEditOutcome[];
  inPlace: number;
  fallback: number;
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
  return best;
}

/** Groups edits by page, preserving request order within each page. */
function groupByPage(edits: TextEdit[]): Map<number, TextEdit[]> {
  const byPage = new Map<number, TextEdit[]>();
  for (const edit of edits) {
    const list = byPage.get(edit.pageIndex);
    if (list) list.push(edit);
    else byPage.set(edit.pageIndex, [edit]);
  }
  return byPage;
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
  const provisional = new Map<string, { mode: TextEditMode; reason?: string }>();
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
      };
    });
    return { bytes, pageCount, outcomes };
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
      fallback: 0,
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
  const expectations: TextEditExpectation[] = outcomes
    .filter(
      (outcome) =>
        outcome.mode === 'in-place' &&
        (edits.find((edit) => edit.id === outcome.id)?.replace.length ?? 0) > 0,
    )
    .map((outcome) => ({
      label: outcome.id,
      pageIndex: outcome.pageIndex,
      expect: edits.find((edit) => edit.id === outcome.id)!.replace,
    }));

  if (expectations.length > 0) {
    const roundTrip = await verifyTextEdits(native.bytes, {
      expectedPageCount: native.pageCount,
      expectations,
    });
    const reopens = roundTrip.checks.find((check) => check.name === 'reopens');
    if (reopens && !reopens.ok) {
      throw new TextEditUnsafeError([
        { kind: 'verification', detail: reopens.detail },
      ]);
    }
    const failed = new Set(
      roundTrip.checks
        .filter((check) => !check.ok && check.name.startsWith('replacement-present:'))
        .map((check) => check.name.slice('replacement-present:'.length)),
    );
    for (const outcome of outcomes) {
      if (outcome.mode === 'in-place' && failed.has(outcome.id)) {
        outcome.mode = 'fallback';
        outcome.reason = 'in-place write did not survive re-extraction';
      }
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
        native.bytes,
        [...overlayObjects, ...fallbackObjects],
        options.formValues,
        ctx,
        password,
      )
    : native.bytes;

  if (fallbackObjects.length > 0) {
    warnings.push(
      `${fallbackEdits.length} of ${edits.length} edits were applied as overlays: the original text ` +
        'could not be rewritten in place, so it was covered and the replacement drawn on top.',
    );
  }

  // Final gate: reopen the bytes we are about to hand back and confirm every
  // replacement is extractable.
  const finalExpectations: TextEditExpectation[] = edits
    .filter((edit) => edit.replace.length > 0)
    .map((edit) => ({ label: edit.id, pageIndex: edit.pageIndex, expect: edit.replace }));
  const verification = await verifyTextEdits(finalBytes, {
    expectedPageCount: native.pageCount,
    expectations: finalExpectations,
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
  return {
    bytes: finalBytes,
    nativeBytes: native.bytes,
    pageCount: native.pageCount,
    outcomes,
    inPlace,
    fallback: outcomes.length - inPlace,
    usedNativeEngine: true,
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
