/**
 * Content-stream text surgery — replacement and partial removal.
 *
 * The native PDFium path rewrites whole text objects. This pass handles the
 * cases it cannot: a page whose show operator is fully understood, where the
 * glyph bytes can be replaced or removed while every surrounding operator
 * (text matrix, leading, character/word spacing, colour, graphics state) is
 * preserved byte-for-byte.
 *
 * Sprint 4 promoted this from "single-string replacement" to real surgery:
 *
 *   - the C-01 lexer round-trips untouched bytes exactly and no longer throws on
 *     `BI` inline images;
 *   - the C-02 metrics reader supplies glyph advances from `/Widths`, `/W`,
 *     Type3 `/FontMatrix` or the base-14 AFM tables;
 *   - the C-03/C-04 walker plans per-glyph removals and writes the removed
 *     advance back as a `TJ` kern, so kept glyphs do not move;
 *   - C-14 limitations (Type3, text inside Form XObjects, malformed streams) are
 *     reported as `stream-incomplete` instead of claiming a clean pass.
 *
 * Anything that cannot be grounded is returned as `manual-review` for the next
 * strategy; it is never guessed at.
 */

import {
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFArray,
  type PDFPage,
} from '@cantoo/pdf-lib';
import type { JobContext } from '../job.js';
import { loadPdfDocument } from '../ops/pages.js';
import { pageGeom, pdfRectToView } from '../ops/geometry.js';
import type { FontCharcodes, FontCharcodesByPage } from './charcodes.js';
import { parseOperations, tokenizeContentStream } from './stream/lexer.js';
import { readPageFontMetrics } from './stream/metrics.js';
import {
  findGlyphRange,
  glyphRangeBox,
  planGlyphRemoval,
  planRunReplacement,
  scanPageText,
  type PageTextScan,
  type RunBox,
  type TextRun,
} from './stream/surgery.js';
import type { TextEdit, TextEditBox, TextEditOutcome } from './types.js';

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function encodeString(text: string, map: FontCharcodes): Uint8Array | null {
  const out: number[] = [];
  for (const character of text) {
    const code = map.get(character.codePointAt(0)!);
    if (code === undefined) {
      if (character === ' ' && !map.has(0x20)) out.push(0x20);
      else return null;
    } else if (code > 0xff) return null;
    else out.push(code);
  }
  return Uint8Array.from(out);
}

function decodeContents(contents: PDFArray, context: PDFDict['context']): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < contents.size(); i += 1) {
    const value = contents.lookup(i);
    const stream =
      value instanceof PDFRef
        ? context.lookup(value)
        : value instanceof PDFStream
          ? value
          : undefined;
    if (!(stream instanceof PDFStream)) continue;
    let decoded: Uint8Array;
    if (stream instanceof PDFRawStream) {
      try {
        decoded = decodePDFRawStream(stream).decode();
      } catch {
        if (stream.dict.get(PDFName.of('Filter')) !== undefined) {
          throw new Error('content stream uses a filter this engine cannot decode');
        }
        decoded = stream.getContents();
      }
    } else if (
      'getUnencodedContents' in stream &&
      typeof (stream as { getUnencodedContents?: () => Uint8Array }).getUnencodedContents ===
        'function'
    ) {
      decoded = (stream as { getUnencodedContents(): Uint8Array }).getUnencodedContents();
    } else {
      if (stream.dict.get(PDFName.of('Filter')) !== undefined) {
        throw new Error('content stream uses a filter this engine cannot decode');
      }
      decoded = stream.getContents();
    }
    chunks.push(decoded, Uint8Array.of(0x0a));
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

interface Splice {
  start: number;
  end: number;
  text: string;
}

function applySplices(bytes: Uint8Array, splices: readonly Splice[]): Uint8Array {
  const ordered = [...splices].sort((a, b) => b.start - a.start);
  const chunks: Uint8Array[] = [];
  let cursor = bytes.length;
  for (const splice of ordered) {
    if (splice.end > cursor) {
      throw new Error('content-stream edits overlap');
    }
    chunks.push(bytes.subarray(splice.end, cursor));
    chunks.push(asciiBytes(splice.text));
    cursor = splice.start;
  }
  chunks.push(bytes.subarray(0, cursor));
  chunks.reverse();
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total + 1);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  out[offset] = 0x0a;
  return out;
}

function displayBox(page: PDFPage, box: RunBox): TextEditBox | undefined {
  try {
    // pdfRectToView owns CropBox intersection and /Rotate; doing this by hand
    // left rotated stream edits without a verification region.
    return pdfRectToView(pageGeom(page), box);
  } catch {
    return undefined;
  }
}

function limitationsFor(scan: PageTextScan): string[] {
  const out: string[] = [];
  if (scan.formText) {
    out.push('stream-incomplete: text inside a Form XObject is not reachable from the page stream');
  }
  if (scan.type3) {
    out.push('stream-incomplete: Type3 font text is not rewritten by the stream path');
  }
  if (scan.malformed) {
    out.push('stream-incomplete: content stream is malformed');
  }
  for (const reason of scan.unsupported) {
    out.push(`stream-incomplete: ${reason}`);
  }
  return [...new Set(out)];
}

function encodeReplacement(
  edit: TextEdit,
  run: TextRun,
  pageFonts: Map<string, FontCharcodes> | undefined,
): Uint8Array | { reason: string } {
  if (run.font.codeByteLength === 2) {
    const encoded = run.font.encode(edit.replace);
    return encoded ?? { reason: 'replacement cannot be encoded with the document font' };
  }
  const map = pageFonts?.get(run.font.baseName);
  if (!map) {
    return { reason: 'font encoding map unavailable; the replacement cannot be encoded safely' };
  }
  const encoded = encodeString(edit.replace, map);
  return encoded ?? { reason: 'replacement cannot be encoded with the document font' };
}

export interface ContentStreamResult {
  bytes: Uint8Array;
  pageCount: number;
  outcomes: TextEditOutcome[];
  applied: number;
  /**
   * False when the page stream cannot see all of its text (Form XObject, Type3,
   * malformed). A caller must not report this pass as a complete removal.
   */
  complete: boolean;
  limitations: string[];
}

/**
 * Rewrites eligible edits with content-stream surgery. Edits that cannot be
 * grounded are returned as `manual-review` so the caller can try the next
 * strategy.
 */
export async function applyContentStreamEdits(
  data: Uint8Array,
  edits: TextEdit[],
  fonts: FontCharcodesByPage,
  ctx: JobContext,
  password?: string,
): Promise<ContentStreamResult> {
  const doc = await loadPdfDocument(data, { ...(password ? { password } : {}) });
  const outcomes: TextEditOutcome[] = [];
  const pages = doc.getPages();
  const byPage = new Map<number, TextEdit[]>();
  for (const edit of edits) {
    const list = byPage.get(edit.pageIndex);
    if (list) list.push(edit);
    else byPage.set(edit.pageIndex, [edit]);
  }

  let applied = 0;
  let complete = true;
  const limitations: string[] = [];

  for (const [pageIndex, pageEdits] of byPage) {
    ctx.throwIfAborted();
    const page = pages[pageIndex];
    if (!page) {
      complete = false;
      limitations.push(`stream-incomplete: page ${pageIndex + 1} does not exist`);
      for (const edit of pageEdits) {
        outcomes.push({ id: edit.id, pageIndex, mode: 'manual-review', reason: 'page does not exist' });
      }
      continue;
    }
    const { Contents, Resources } = page.node.normalizedEntries();
    if (!Contents) {
      complete = false;
      limitations.push(`stream-incomplete: page ${pageIndex + 1} has no content stream`);
      for (const edit of pageEdits) {
        outcomes.push({ id: edit.id, pageIndex, mode: 'manual-review', reason: 'page has no content stream' });
      }
      continue;
    }

    let decoded: Uint8Array;
    let operations: ReturnType<typeof parseOperations>;
    let tokens: ReturnType<typeof tokenizeContentStream>;
    let scan: PageTextScan;
    try {
      decoded = decodeContents(Contents, doc.context);
      tokens = tokenizeContentStream(decoded);
      operations = parseOperations(tokens);
      const fontMetrics = readPageFontMetrics(
        Resources instanceof PDFDict ? Resources : undefined,
      );
      scan = scanPageText(
        operations,
        fontMetrics,
        Resources instanceof PDFDict ? Resources : undefined,
        tokens,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      complete = false;
      limitations.push(`stream-incomplete: ${reason}`);
      for (const edit of pageEdits) {
        outcomes.push({ id: edit.id, pageIndex, mode: 'manual-review', reason });
      }
      continue;
    }

    const pageLimitations = limitationsFor(scan);
    if (pageLimitations.length > 0) complete = false;
    for (const limitation of pageLimitations) {
      if (!limitations.includes(limitation)) limitations.push(limitation);
    }

    const splices: Splice[] = [];
    const pageOutcomes = new Map<string, TextEditOutcome>();
    for (const edit of pageEdits) {
      if (edit.layout) {
        pageOutcomes.set(edit.id, {
          id: edit.id,
          pageIndex,
          mode: 'manual-review',
          reason: 'multi-line reflow needs native object creation',
        });
        continue;
      }

      const deletion = edit.replace.length === 0;
      const matches: Array<{ run: TextRun; start: number; end: number }> = [];
      let ambiguousInRun = false;
      for (const run of scan.runs) {
        const found = findGlyphRange(run, edit.find);
        if (!found) continue;
        if (!deletion && !found.exact) continue;
        if (found.ambiguous) {
          ambiguousInRun = true;
          continue;
        }
        matches.push({ run, start: found.range.start, end: found.range.end });
      }

      if (ambiguousInRun || matches.length !== 1) {
        const base =
          ambiguousInRun
            ? `the run contains more than one occurrence of "${edit.find}"; refusing to guess which one was selected`
            : matches.length === 0
              ? 'no single content-stream show operator matches the run'
              : `${matches.length} show operators match the run; refusing an ambiguous rewrite`;
        pageOutcomes.set(edit.id, {
          id: edit.id,
          pageIndex,
          mode: 'manual-review',
          reason: pageLimitations.length > 0 ? `${base}; ${pageLimitations[0]}` : base,
        });
        continue;
      }

      const match = matches[0]!;
      const box = glyphRangeBox(match.run, { start: match.start, end: match.end });
      if (deletion) {
        const plan = planGlyphRemoval(
          match.run,
          { start: match.start, end: match.end },
          decoded,
        );
        if ('reason' in plan) {
          pageOutcomes.set(edit.id, {
            id: edit.id,
            pageIndex,
            mode: 'manual-review',
            reason: plan.reason,
          });
          continue;
        }
        splices.push({ start: plan.start, end: plan.end, text: plan.text });
        pageOutcomes.set(edit.id, {
          id: edit.id,
          pageIndex,
          mode: 'content-stream',
          fidelity: 'high',
          // A caller-supplied box is the region the UI already told the visual
          // gate to expect; keep it. Only derive one when none was supplied.
          ...(box && !edit.box ? { box: displayBox(page, box) ?? undefined } : {}),
        });
        applied += 1;
        continue;
      }

      const encoded = encodeReplacement(edit, match.run, fonts.get(pageIndex));
      if ('reason' in encoded) {
        pageOutcomes.set(edit.id, {
          id: edit.id,
          pageIndex,
          mode: 'manual-review',
          reason: encoded.reason,
        });
        continue;
      }
      const plan = planRunReplacement(match.run, decoded, encoded, {
        allowAdvanceGrowth: !edit.box,
      });
      if ('reason' in plan) {
        pageOutcomes.set(edit.id, {
          id: edit.id,
          pageIndex,
          mode: 'manual-review',
          reason: plan.reason,
        });
        continue;
      }
      splices.push({ start: plan.start, end: plan.end, text: plan.text });
      pageOutcomes.set(edit.id, {
        id: edit.id,
        pageIndex,
        mode: 'content-stream',
        fidelity: 'high',
        ...(box && !edit.box ? { box: displayBox(page, box) ?? undefined } : {}),
      });
      applied += 1;
    }

    if (splices.length > 0) {
      let rewritten: Uint8Array;
      try {
        rewritten = applySplices(decoded, splices);
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} on page ${pageIndex + 1}`,
        );
      }
      const dict = PDFDict.withContext(doc.context);
      dict.set(PDFName.of('Length'), PDFNumber.of(rewritten.length));
      const stream = PDFRawStream.of(dict, rewritten);
      const ref = doc.context.register(stream);
      page.node.set(PDFName.of('Contents'), ref);
    }

    for (const edit of pageEdits) {
      const outcome = pageOutcomes.get(edit.id);
      if (outcome) outcomes.push(outcome);
      else {
        complete = false;
        outcomes.push({
          id: edit.id,
          pageIndex,
          mode: 'manual-review',
          reason: 'edit was not planned by the content-stream pass',
        });
      }
    }
  }

  const bytes = new Uint8Array(await doc.save({ useObjectStreams: false }));
  return {
    bytes,
    pageCount: pages.length,
    outcomes,
    applied,
    complete,
    limitations: [...new Set(limitations)],
  };
}
