/**
 * Content-stream text replacement -- strategy B.
 *
 * This is not a universal text engine and it does not pretend to be one. It
 * handles the case PDFium's object rewrite cannot: a page whose show-operator
 * text and font encoding are fully understood, where replacing the glyph bytes
 * inside the existing `Tj`/`TJ` operator preserves every surrounding operator
 * (text matrix, leading, character/word spacing, colour, graphics state).
 *
 * Safety rules:
 *   - only simple (non-CID) fonts with a document-derived charcode map;
 *   - only a single matching show operation on the page, or the edit is skipped
 *     as ambiguous;
 *   - inline images and malformed streams bail out entirely;
 *   - a replacement wider than the original box is refused (reflow is the
 *     native/reconstruction path, not a content-stream side effect);
 *   - after serialization the caller still reopens and re-extracts the result.
 *
 * The original operator bytes outside the replaced string are copied verbatim;
 * no page is re-typeset from an approximation.
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
} from '@cantoo/pdf-lib';
import type { JobContext } from '../job.js';
import { loadPdfDocument } from '../ops/pages.js';
import type { FontCharcodes, FontCharcodesByPage } from './charcodes.js';
import type { TextEdit, TextEditOutcome } from './types.js';

class UnsupportedStream extends Error {}

interface Token {
  kind: 'number' | 'name' | 'string' | 'array' | 'dict' | 'other';
  value?: number | string;
  bytes?: Uint8Array;
  start: number;
  end: number;
  items?: Token[];
}

interface Operation {
  name: string;
  args: Token[];
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITER = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isDigit(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x39;
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function tokenize(bytes: Uint8Array): Operation[] {
  let index = 0;
  const operations: Operation[] = [];
  let args: Token[] = [];

  const skip = (): void => {
    while (index < bytes.length) {
      const byte = bytes[index]!;
      if (WHITESPACE.has(byte)) index += 1;
      else if (byte === 0x25) {
        while (index < bytes.length && bytes[index] !== 0x0a && bytes[index] !== 0x0d) {
          index += 1;
        }
      } else break;
    }
  };

  const parseLiteral = (): Token => {
    const start = index;
    index += 1;
    const out: number[] = [];
    let depth = 1;
    while (index < bytes.length && depth > 0) {
      const byte = bytes[index]!;
      if (byte === 0x5c) {
        index += 1;
        if (index >= bytes.length) break;
        const next = bytes[index]!;
        if (next === 0x6e) out.push(0x0a);
        else if (next === 0x72) out.push(0x0d);
        else if (next === 0x74) out.push(0x09);
        else if (next === 0x62) out.push(0x08);
        else if (next === 0x66) out.push(0x0c);
        else if (next === 0x0a) {
          /* line continuation */
        } else if (next === 0x0d) {
          if (bytes[index + 1] === 0x0a) index += 1;
        } else if (next >= 0x30 && next <= 0x37) {
          let oct = String.fromCharCode(next);
          for (let n = 0; n < 2 && index + 1 < bytes.length; n += 1) {
            const digit = bytes[index + 1]!;
            if (digit < 0x30 || digit > 0x37) break;
            oct += String.fromCharCode(digit);
            index += 1;
          }
          out.push(Number.parseInt(oct, 8) & 0xff);
        } else out.push(next);
        index += 1;
        continue;
      }
      if (byte === 0x28) depth += 1;
      else if (byte === 0x29) {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          break;
        }
      }
      out.push(byte);
      index += 1;
    }
    return { kind: 'string', bytes: Uint8Array.from(out), start, end: index };
  };

  const parseHexString = (): Token => {
    const start = index;
    index += 1;
    const digits: string[] = [];
    while (index < bytes.length && bytes[index] !== 0x3e) {
      const byte = bytes[index]!;
      if (!WHITESPACE.has(byte)) digits.push(String.fromCharCode(byte));
      index += 1;
    }
    if (index < bytes.length) index += 1;
    if (digits.length % 2 === 1) digits.push('0');
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i += 1) {
      out[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2).join(''), 16);
    }
    return { kind: 'string', bytes: out, start, end: index };
  };

  const parseName = (): Token => {
    const start = index;
    index += 1;
    let raw = '';
    while (index < bytes.length) {
      const byte = bytes[index]!;
      if (WHITESPACE.has(byte) || DELIMITER.has(byte)) break;
      raw += String.fromCharCode(byte);
      index += 1;
    }
    const value = raw.replace(/#([0-9a-fA-F]{2})/g, (_, hexValue: string) =>
      String.fromCharCode(Number.parseInt(hexValue, 16)),
    );
    return { kind: 'name', value, start, end: index };
  };

  const parseArray = (): Token => {
    const start = index;
    index += 1;
    const items: Token[] = [];
    for (;;) {
      skip();
      if (index >= bytes.length) throw new UnsupportedStream('unterminated array');
      if (bytes[index] === 0x5d) {
        index += 1;
        break;
      }
      items.push(parseValue());
    }
    return { kind: 'array', items, start, end: index };
  };

  const parseDict = (): Token => {
    const start = index;
    index += 2;
    let depth = 1;
    while (index < bytes.length && depth > 0) {
      if (bytes[index] === 0x3c && bytes[index + 1] === 0x3c) {
        depth += 1;
        index += 2;
        continue;
      }
      if (bytes[index] === 0x3e && bytes[index + 1] === 0x3e) {
        depth -= 1;
        index += 2;
        continue;
      }
      index += 1;
    }
    return { kind: 'dict', start, end: index };
  };

  const parseValue = (): Token => {
    skip();
    if (index >= bytes.length) throw new UnsupportedStream('unexpected end');
    const byte = bytes[index]!;
    if (byte === 0x28) return parseLiteral();
    if (byte === 0x2f) return parseName();
    if (byte === 0x5b) return parseArray();
    if (byte === 0x3c) {
      if (bytes[index + 1] === 0x3c) return parseDict();
      return parseHexString();
    }
    if (isDigit(byte) || byte === 0x2b || byte === 0x2d || byte === 0x2e) {
      const start = index;
      while (index < bytes.length) {
        const current = bytes[index]!;
        if (WHITESPACE.has(current) || DELIMITER.has(current)) break;
        index += 1;
      }
      return {
        kind: 'number',
        value: Number.parseFloat(String.fromCharCode(...bytes.slice(start, index))),
        start,
        end: index,
      };
    }
    // Operator / keyword: read one token.
    const start = index;
    while (index < bytes.length) {
      const current = bytes[index]!;
      if (WHITESPACE.has(current) || DELIMITER.has(current)) break;
      index += 1;
    }
    const word = String.fromCharCode(...bytes.slice(start, index));
    if (word === 'true' || word === 'false' || word === 'null') {
      return { kind: 'other', value: word, start, end: index };
    }
    throw new UnsupportedStream(`unexpected token "${word}" inside an array`);
  };

  while (index < bytes.length) {
    skip();
    if (index >= bytes.length) break;
    const byte = bytes[index]!;
    // Operands are collected into the next operation.
    if (byte === 0x28 || byte === 0x2f || byte === 0x5b || byte === 0x3c) {
      args.push(parseValue());
      continue;
    }
    if (isDigit(byte) || byte === 0x2b || byte === 0x2d || byte === 0x2e) {
      args.push(parseValue());
      continue;
    }
    // Read operator name.
    const start = index;
    while (index < bytes.length) {
      const current = bytes[index]!;
      if (WHITESPACE.has(current) || DELIMITER.has(current)) break;
      index += 1;
    }
    if (index === start) {
      index += 1;
      continue;
    }
    const word = String.fromCharCode(...bytes.slice(start, index));
    if (word === 'BI') throw new UnsupportedStream('inline images are not supported');
    operations.push({ name: word, args });
    args = [];
  }
  return operations;
}

function reverseMap(map: FontCharcodes | undefined): Map<number, number> | null {
  if (!map) return null;
  const reverse = new Map<number, number>();
  for (const [unicode, code] of map) {
    if (code <= 0xff && !reverse.has(code)) reverse.set(code, unicode);
  }
  return reverse;
}

function decodeString(bytes: Uint8Array, reverse: Map<number, number>): string | null {
  let out = '';
  for (const byte of bytes) {
    const unicode = reverse.get(byte);
    if (unicode !== undefined) {
      out += String.fromCodePoint(unicode);
      continue;
    }
    // ASCII is the one safe fallback for a simple font: every PDF simple
    // encoding maps printable ASCII bytes to themselves.
    if (byte >= 0x20 && byte <= 0x7e) out += String.fromCharCode(byte);
    else return null;
  }
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

function normalize(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function fontResource(
  fontDict: PDFDict | undefined,
  name: string,
  context: PDFDict['context'],
): PDFDict | null {
  if (!fontDict) return null;
  const value = fontDict.lookup(PDFName.of(name));
  if (value instanceof PDFDict) return value;
  if (value instanceof PDFRef) {
    const looked = context.lookup(value);
    return looked instanceof PDFDict ? looked : null;
  }
  return null;
}

function baseFontName(dict: PDFDict): string | null {
  const value = dict.lookup(PDFName.of('BaseFont'));
  if (value instanceof PDFName) return value.decodeText().replace(/^[A-Z]{6}\+/, '');
  return null;
}

function simpleFont(dict: PDFDict): boolean {
  const subtype = dict.lookup(PDFName.of('Subtype'));
  return !(subtype instanceof PDFName && subtype.decodeText() === 'Type0');
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
        decoded = stream.getContents();
      }
    } else {
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

export interface ContentStreamResult {
  bytes: Uint8Array;
  pageCount: number;
  outcomes: TextEditOutcome[];
  applied: number;
}

/**
 * Rewrite eligible edits with content-stream string replacement. Edits that
 * cannot be grounded are returned as `manual-review`/`fallback` so the caller
 * can try the next strategy.
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
  for (const [pageIndex, pageEdits] of byPage) {
    ctx.throwIfAborted();
    const page = pages[pageIndex];
    if (!page) {
      for (const edit of pageEdits) {
        outcomes.push({ id: edit.id, pageIndex, mode: 'manual-review', reason: 'page does not exist' });
      }
      continue;
    }
    const { Contents, Resources } = page.node.normalizedEntries();
    if (!Contents) {
      for (const edit of pageEdits) {
        outcomes.push({ id: edit.id, pageIndex, mode: 'manual-review', reason: 'page has no content stream' });
      }
      continue;
    }
    let decoded: Uint8Array;
    let operations: Operation[];
    try {
      decoded = decodeContents(Contents, doc.context);
      operations = tokenize(decoded);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const edit of pageEdits) {
        outcomes.push({ id: edit.id, pageIndex, mode: 'manual-review', reason });
      }
      continue;
    }

    const fontDict = Resources.lookup(PDFName.of('Font'));
    const replacements: { start: number; end: number; text: string }[] = [];
    for (const edit of pageEdits) {
      if (edit.layout || edit.replace.length === 0) {
        outcomes.push({
          id: edit.id,
          pageIndex,
          mode: 'manual-review',
          reason: edit.layout
            ? 'multi-line reflow needs native object creation'
            : 'deletion cannot be performed safely in a content stream',
        });
        continue;
      }
      const candidates: { token: Token; font: PDFDict; map: FontCharcodes }[] = [];
      let currentFont: PDFDict | null = null;
      for (const operation of operations) {
        if (operation.name === 'Tf') {
          const name = operation.args[0];
          if (name?.kind === 'name' && typeof name.value === 'string') {
            currentFont = fontResource(
              fontDict instanceof PDFDict ? fontDict : undefined,
              name.value,
              doc.context,
            );
          }
          continue;
        }
        if (!currentFont || !simpleFont(currentFont)) continue;
        const fontName = baseFontName(currentFont);
        const map = fontName ? fonts.get(pageIndex)?.get(fontName) : undefined;
        if (!map) continue;
        const reverse = reverseMap(map);
        if (!reverse) continue;

        let stringToken: Token | undefined;
        if (operation.name === 'Tj' || operation.name === "'" || operation.name === '"') {
          const arg = operation.name === '"' ? operation.args[2] : operation.args[0];
          if (arg?.kind === 'string') stringToken = arg;
        } else if (operation.name === 'TJ') {
          const array = operation.args[0];
          if (array?.kind === 'array' && array.items?.length === 1 && array.items[0]?.kind === 'string') {
            stringToken = array.items[0];
          }
        }
        if (!stringToken?.bytes) continue;
        const text = decodeString(stringToken.bytes, reverse);
        if (text === null || normalize(text) !== normalize(edit.find)) continue;
        candidates.push({ token: stringToken, font: currentFont, map });
      }
      if (candidates.length !== 1) {
        outcomes.push({
          id: edit.id,
          pageIndex,
          mode: 'manual-review',
          reason:
            candidates.length === 0
              ? 'no single content-stream show operator matches the run'
              : `${candidates.length} show operators match the run; refusing an ambiguous rewrite`,
        });
        continue;
      }
      const candidate = candidates[0]!;
      const encoded = encodeString(edit.replace, candidate.map);
      if (!encoded) {
        outcomes.push({
          id: edit.id,
          pageIndex,
          mode: 'manual-review',
          reason: 'replacement cannot be encoded with the document font',
        });
        continue;
      }
      // A content-stream edit keeps the original line matrix, so a wider string
      // may collide with whatever follows. Reflow belongs to the native path.
      const average = edit.box && edit.find.length > 0 ? edit.box.width / edit.find.length : 0;
      if (edit.box && average > 0 && edit.replace.length * average > edit.box.width * 1.05) {
        outcomes.push({
          id: edit.id,
          pageIndex,
          mode: 'manual-review',
          reason: 'replacement is wider than the original line; reflow is required',
        });
        continue;
      }
      replacements.push({
        start: candidate.token.start,
        end: candidate.token.end,
        text: `<${hex(encoded)}>`,
      });
      applied += 1;
    }

    if (replacements.length === 0) continue;
    replacements.sort((a, b) => b.start - a.start);
    const chunks: Uint8Array[] = [];
    let cursor = decoded.length;
    for (const replacement of replacements) {
      if (replacement.end > cursor) {
        // Overlap means two edits claimed the same bytes; refuse the whole page
        // rather than corrupting the stream.
        throw new Error(`content-stream edits overlap on page ${pageIndex + 1}`);
      }
      chunks.push(decoded.slice(replacement.end, cursor));
      chunks.push(asciiBytes(replacement.text));
      cursor = replacement.start;
    }
    chunks.push(decoded.slice(0, cursor));
    chunks.reverse();
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const rewritten = new Uint8Array(total + 1);
    let offset = 0;
    for (const chunk of chunks) {
      rewritten.set(chunk, offset);
      offset += chunk.length;
    }
    rewritten[offset] = 0x0a;

    const dict = PDFDict.withContext(doc.context);
    dict.set(PDFName.of('Length'), PDFNumber.of(rewritten.length));
    const stream = PDFRawStream.of(dict, rewritten);
    const ref = doc.context.register(stream);
    page.node.set(PDFName.of('Contents'), ref);

    for (const edit of pageEdits) {
      if (!outcomes.some((outcome) => outcome.id === edit.id)) {
        outcomes.push({ id: edit.id, pageIndex, mode: 'content-stream', fidelity: 'high' });
      }
    }
  }

  const bytes = new Uint8Array(await doc.save({ useObjectStreams: false }));
  return { bytes, pageCount: pages.length, outcomes, applied };
}
