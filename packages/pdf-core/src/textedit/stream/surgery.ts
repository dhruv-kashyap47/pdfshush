/**
 * Stream surgery: text-state walking, glyph quads and removal plans (C-03/C-04).
 *
 * Two rules shape this module:
 *
 *   1. **Only target glyphs disappear.** A removal re-emits the *same* show
 *      operator with the targeted glyph codes omitted. Every byte outside that
 *      operator is untouched.
 *   2. **Kept glyphs do not move.** Each removed advance becomes a `TJ` kern in
 *      the operator's own text space, including character and word spacing.
 *      `Tj` becomes `TJ` when a removal splits the string, and `'`/`"` keep
 *      their line move even when every glyph is removed.
 *
 * The walker tracks the graphics/text state needed to know which glyphs are
 * affected and what their advances are. It does not re-typeset anything and it
 * refuses, with a reason, when the font or the string shape cannot be grounded.
 */

import {
  PDFDict,
  PDFName,
  PDFRawStream as RawStream,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';
import type { PDFRawStream } from '@cantoo/pdf-lib';
import type { FontMetrics } from './metrics.js';
import { foldText, normalizeForMatch } from '../text.js';
import type { ContentOperation, StreamToken } from './lexer.js';
import { parseOperations, tokenizeContentStream } from './lexer.js';

export interface GlyphBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GlyphInfo {
  code: number;
  unicode: string | undefined;
  /** Advance in 1/1000 text-space units, including Tc/Tw. */
  advanceUnits: number;
  /** Nominal glyph width in 1/1000 text-space units. */
  width: number;
  /** User-space glyph origin. */
  x: number;
  y: number;
  /** User-space axis-aligned box (approximate ascent/descent). */
  box: GlyphBox;
  segmentIndex: number;
  glyphIndex: number;
}

export interface TextSegment {
  token: StreamToken;
  glyphs: GlyphInfo[];
}

export interface TextRun {
  operationIndex: number;
  operation: ContentOperation;
  /** Concatenation of every decodable glyph's Unicode. */
  text: string;
  glyphs: GlyphInfo[];
  segments: TextSegment[];
  /** True when every glyph in the run decoded to Unicode. */
  decodable: boolean;
  font: FontMetrics;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
}

export interface PageTextScan {
  runs: TextRun[];
  inlineImages: boolean;
  /** True when a Form XObject on the page contains text show operators. */
  formText: boolean;
  /** True when any page font is Type3. */
  type3: boolean;
  /** Non-fatal reasons the scan could not see all text. */
  unsupported: string[];
  malformed: boolean;
}

export type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const SHOW_OPERATORS = new Set(['Tj', 'TJ', "'", '"']);

function multiply(left: Matrix, right: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

function translate(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

function apply(matrix: Matrix, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

interface TextState {
  fontName: string | undefined;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  horizontalScale: number;
  leading: number;
  rise: number;
}

interface GraphicsState {
  ctm: Matrix;
  text: TextState;
}

function initialTextState(): TextState {
  return {
    fontName: undefined,
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    horizontalScale: 1,
    leading: 0,
    rise: 0,
  };
}

function numberOperand(operation: ContentOperation, index: number): number | undefined {
  const token = operation.operands[index];
  return token?.kind === 'number' && Number.isFinite(token.value) ? token.value : undefined;
}

function nameOperand(operation: ContentOperation, index: number): string | undefined {
  const token = operation.operands[index];
  return token?.kind === 'name' ? token.text : undefined;
}

function stringOperand(operation: ContentOperation, index: number): StreamToken | undefined {
  const token = operation.operands[index];
  return token?.kind === 'string' ? token : undefined;
}

function decodeSegments(
  operation: ContentOperation,
  font: FontMetrics,
  segmentIndexStart: number,
): TextSegment[] {
  const segments: TextSegment[] = [];
  const pushString = (token: StreamToken): void => {
    const glyphs: GlyphInfo[] = [];
    const bytes = token.bytes ?? Uint8Array.of();
    font.decode(bytes).forEach((decoded, glyphIndex) => {
      glyphs.push({
        code: decoded.code,
        unicode: decoded.unicode,
        advanceUnits: 0,
        width: decoded.width,
        x: 0,
        y: 0,
        box: { x: 0, y: 0, width: 0, height: 0 },
        segmentIndex: segmentIndexStart + segments.length,
        glyphIndex,
      });
    });
    segments.push({ token, glyphs });
  };

  if (operation.name === 'Tj') {
    const token = stringOperand(operation, 0);
    if (token) pushString(token);
  } else if (operation.name === "'") {
    const token = stringOperand(operation, 0);
    if (token) pushString(token);
  } else if (operation.name === '"') {
    const token = stringOperand(operation, 2);
    if (token) pushString(token);
  } else if (operation.name === 'TJ') {
    const array = operation.operands[0];
    if (array?.kind === 'array') {
      for (const item of array.items ?? []) {
        if (item.kind === 'string') pushString(item);
      }
    }
  }
  return segments;
}

function glyphBox(
  tm: Matrix,
  ctm: Matrix,
  fontSize: number,
  width: number,
  rise: number,
): GlyphBox {
  const left = width / 1000 * fontSize;
  const ascent = fontSize * 0.75;
  const descent = -fontSize * 0.25;
  const corners: Array<[number, number]> = [
    [0, descent],
    [left, descent],
    [0, ascent],
    [left, ascent],
  ];
  const points = corners.map(([x, y]) => apply(ctm, ...apply(tm, x, y + rise)));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function decodeFormHasText(stream: PDFRawStream): boolean {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(decodePDFRawStream(stream).decode());
  } catch {
    try {
      bytes = stream.getContents();
    } catch {
      return false;
    }
  }
  try {
    const operations = parseOperations(tokenizeContentStream(bytes));
    return operations.some((operation) => SHOW_OPERATORS.has(operation.name));
  } catch {
    return false;
  }
}

function pageHasFormText(
  resources: PDFDict | undefined,
  name: string,
): boolean {
  if (!resources) return false;
  const xobjectsRaw = resources.get(PDFName.of('XObject'));
  const xobjects = xobjectsRaw ? resources.context.lookup(xobjectsRaw) : undefined;
  if (!(xobjects instanceof PDFDict)) return false;
  const value = xobjects.lookup(PDFName.of(name));
  if (!(value instanceof RawStream)) return false;
  const subtype = value.dict.get(PDFName.of('Subtype'));
  const resolved = subtype ? value.dict.context.lookup(subtype) : undefined;
  if (!(resolved instanceof PDFName) || resolved.asString() !== '/Form') return false;
  return decodeFormHasText(value);
}

/**
 * Walks a page's operations and returns every show run with glyph positions and
 * advances. Text matrices, the CTM, `q/Q` and the text-state parameters are all
 * tracked; content the walker cannot ground is reported, never guessed.
 */
export function scanPageText(
  operations: readonly ContentOperation[],
  fonts: Map<string, FontMetrics>,
  resources?: PDFDict,
  tokens?: readonly StreamToken[],
): PageTextScan {
  const runs: TextRun[] = [];
  const unsupported: string[] = [];
  let inlineImages = false;
  let formText = false;
  const type3 = [...fonts.values()].some((font) => font.subtype === 'Type3');
  if (type3) unsupported.push('Type3 fonts are not rewritten by the stream path');

  let state: GraphicsState = { ctm: IDENTITY, text: initialTextState() };
  const stack: GraphicsState[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;

  for (let operationIndex = 0; operationIndex < operations.length; operationIndex += 1) {
    const operation = operations[operationIndex]!;
    switch (operation.name) {
      case 'q':
        stack.push({ ctm: state.ctm, text: { ...state.text } });
        break;
      case 'Q': {
        const restored = stack.pop();
        if (restored) state = restored;
        break;
      }
      case 'cm': {
        const a = numberOperand(operation, 0);
        const b = numberOperand(operation, 1);
        const c = numberOperand(operation, 2);
        const d = numberOperand(operation, 3);
        const e = numberOperand(operation, 4);
        const f = numberOperand(operation, 5);
        if ([a, b, c, d, e, f].every((value) => value !== undefined)) {
          state.ctm = multiply([a!, b!, c!, d!, e!, f!], state.ctm);
        }
        break;
      }
      case 'BT':
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case 'ET':
        break;
      case 'Tf': {
        state.text.fontName = nameOperand(operation, 0);
        state.text.fontSize = numberOperand(operation, 1) ?? 0;
        break;
      }
      case 'Tc':
        state.text.charSpacing = numberOperand(operation, 0) ?? 0;
        break;
      case 'Tw':
        state.text.wordSpacing = numberOperand(operation, 0) ?? 0;
        break;
      case 'Tz':
        state.text.horizontalScale = (numberOperand(operation, 0) ?? 100) / 100;
        break;
      case 'TL':
        state.text.leading = numberOperand(operation, 0) ?? 0;
        break;
      case 'Ts':
        state.text.rise = numberOperand(operation, 0) ?? 0;
        break;
      case 'Tm': {
        const a = numberOperand(operation, 0);
        const b = numberOperand(operation, 1);
        const c = numberOperand(operation, 2);
        const d = numberOperand(operation, 3);
        const e = numberOperand(operation, 4);
        const f = numberOperand(operation, 5);
        if ([a, b, c, d, e, f].every((value) => value !== undefined)) {
          tm = [a!, b!, c!, d!, e!, f!];
          tlm = tm;
        }
        break;
      }
      case 'Td':
      case 'TD': {
        const tx = numberOperand(operation, 0) ?? 0;
        const ty = numberOperand(operation, 1) ?? 0;
        if (operation.name === 'TD') state.text.leading = -ty;
        tlm = multiply(translate(tx, ty), tlm);
        tm = tlm;
        break;
      }
      case 'T*':
        tlm = multiply(translate(0, -state.text.leading), tlm);
        tm = tlm;
        break;
      case 'Do': {
        const name = nameOperand(operation, 0);
        if (name && pageHasFormText(resources, name)) formText = true;
        break;
      }
      case 'BI':
        inlineImages = true;
        break;
      case 'Tj':
      case 'TJ':
      case "'":
      case '"': {
        if (operation.name === "'") {
          tlm = multiply(translate(0, -state.text.leading), tlm);
          tm = tlm;
        } else if (operation.name === '"') {
          state.text.wordSpacing = numberOperand(operation, 0) ?? state.text.wordSpacing;
          state.text.charSpacing = numberOperand(operation, 1) ?? state.text.charSpacing;
          tlm = multiply(translate(0, -state.text.leading), tlm);
          tm = tlm;
        }
        const fontName = state.text.fontName;
        const font = fontName ? fonts.get(fontName) : undefined;
        if (!font) {
          unsupported.push(`show operator uses an unresolved font resource${fontName ? ` /${fontName}` : ''}`);
          break;
        }
        if (state.text.fontSize <= 0) {
          unsupported.push('show operator has no positive font size');
          break;
        }
        const decoded = decodeSegments(operation, font, 0);
        if (decoded.length === 0) break;
        const fontSize = state.text.fontSize;
        const horizontalScale = state.text.horizontalScale;
        const charSpacing = state.text.charSpacing;
        const wordSpacing = state.text.wordSpacing;

        // TJ numbers move the text matrix between strings. Walk strings and
        // numbers in source order so glyph positions stay faithful.
        const segmentGlyphs: GlyphInfo[] = [];
        let text = '';
        let decodable = true;
        const applyNumber = (value: number): void => {
          const distance = (-value / 1000) * fontSize * horizontalScale;
          tm = multiply(translate(distance, 0), tm);
        };
        const emitSegment = (segment: TextSegment, segmentIndex: number): void => {
          if (
            font.codeByteLength === 2 &&
            (segment.token.bytes?.length ?? 0) % 2 !== 0
          ) {
            // A two-byte code space with a trailing half code cannot be re-emitted
            // without guessing. Mark the run undecodable so no plan can match it.
            decodable = false;
          }
          for (const glyph of segment.glyphs) {
            const spacing =
              charSpacing + (glyph.code === 0x20 && font.codeByteLength === 1 ? wordSpacing : 0);
            glyph.advanceUnits = glyph.width + (fontSize > 0 ? (spacing * 1000) / fontSize : 0);
            const [originX, originY] = apply(state.ctm, ...apply(tm, 0, state.text.rise));
            glyph.x = originX;
            glyph.y = originY;
            glyph.box = glyphBox(
              tm,
              state.ctm,
              fontSize,
              glyph.width,
              state.text.rise,
            );
            glyph.segmentIndex = segmentIndex;
            glyph.glyphIndex = segmentGlyphs.length;
            segmentGlyphs.push(glyph);
            if (glyph.unicode === undefined) decodable = false;
            else text += glyph.unicode;
            const distance = (glyph.advanceUnits / 1000) * fontSize * horizontalScale;
            tm = multiply(translate(distance, 0), tm);
          }
        };

        if (operation.name === 'TJ') {
          const array = operation.operands[0];
          let segmentIndex = 0;
          for (const item of array?.kind === 'array' ? array.items ?? [] : []) {
            if (item.kind === 'number') applyNumber(item.value ?? 0);
            else if (item.kind === 'string') {
              const segment = decoded[segmentIndex];
              if (!segment) continue;
              emitSegment(segment, segmentIndex);
              segmentIndex += 1;
            }
          }
        } else {
          const segment = decoded[0];
          if (segment) emitSegment(segment, 0);
        }

        runs.push({
          operationIndex,
          operation,
          text,
          glyphs: segmentGlyphs,
          segments: decoded,
          decodable,
          font,
          fontSize,
          charSpacing,
          wordSpacing,
        });
        break;
      }
      default:
        break;
    }
  }

  const malformed = Boolean(tokens?.some((token) => token.malformed));
  return {
    runs,
    inlineImages,
    formText,
    type3,
    unsupported: [...new Set(unsupported)],
    malformed,
  };
}

export interface NormalizedRun {
  text: string;
  /** Glyph index for every character in `text`. */
  owners: number[];
}

/**
 * Folds a run's glyph text the same way the editor does, retaining a map from
 * each folded character back to the glyph that produced it. This is what turns
 * "the user selected these characters" into "these glyph indices".
 */
export function foldRunText(glyphs: readonly GlyphInfo[]): NormalizedRun {
  let text = '';
  const owners: number[] = [];
  for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex += 1) {
    const glyph = glyphs[glyphIndex]!;
    const folded = foldText(glyph.unicode ?? '');
    for (const character of folded) {
      if (/\s/u.test(character)) {
        if (text.length === 0 || text.endsWith(' ')) continue;
        text += ' ';
        owners.push(glyphIndex);
        continue;
      }
      text += character;
      owners.push(glyphIndex);
    }
  }
  while (text.endsWith(' ')) {
    text = text.slice(0, -1);
    owners.pop();
  }
  return { text, owners };
}

export interface GlyphRange {
  start: number;
  end: number;
}

export interface FindResult {
  range: GlyphRange;
  exact: boolean;
  /** True when the same needle appears more than once in this run. */
  ambiguous: boolean;
}

/** Finds `needle` in a run and maps it back to glyph indices. */
export function findGlyphRange(run: TextRun, needle: string): FindResult | undefined {
  if (!run.decodable || run.glyphs.length === 0) return undefined;
  const normalizedNeedle = normalizeForMatch(needle);
  if (normalizedNeedle.length === 0) return undefined;
  const folded = foldRunText(run.glyphs);
  const exact = folded.text === normalizedNeedle;
  const at = exact ? 0 : folded.text.indexOf(normalizedNeedle);
  if (at < 0) return undefined;
  const ambiguous = !exact && folded.text.indexOf(normalizedNeedle, at + 1) !== -1;
  const startGlyph = folded.owners[at];
  const endGlyph = folded.owners[at + normalizedNeedle.length - 1];
  if (startGlyph === undefined || endGlyph === undefined) return undefined;
  return {
    range: { start: startGlyph, end: endGlyph + 1 },
    exact,
    ambiguous,
  };
}

export interface RunBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** User-space AABB of the selected glyphs. */
export function glyphRangeBox(run: TextRun, range: GlyphRange): RunBox | undefined {
  const glyphs = run.glyphs.slice(range.start, range.end);
  if (glyphs.length === 0) return undefined;
  const xs = glyphs.map((glyph) => glyph.box.x);
  const ys = glyphs.map((glyph) => glyph.box.y);
  const rights = glyphs.map((glyph) => glyph.box.x + glyph.box.width);
  const bottoms = glyphs.map((glyph) => glyph.box.y + glyph.box.height);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...rights) - x, height: Math.max(...bottoms) - y };
}

function formatNumber(value: number): string {
  if (Math.abs(value) < 0.00005) return '0';
  let text = value.toFixed(4);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

function hexBytes(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function codesToBytes(codes: readonly number[], byteLength: 1 | 2): Uint8Array {
  if (byteLength === 1) return Uint8Array.from(codes.map((code) => code & 0xff));
  const out = new Uint8Array(codes.length * 2);
  codes.forEach((code, index) => {
    out[index * 2] = (code >> 8) & 0xff;
    out[index * 2 + 1] = code & 0xff;
  });
  return out;
}

function rawToken(bytes: Uint8Array, token: StreamToken): string {
  let out = '';
  for (let i = token.start; i < token.end; i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}

/** Compensation number (1/1000 text units) for a removed glyph span. */
function removalKern(glyphs: readonly GlyphInfo[], start: number, end: number): number {
  let units = 0;
  for (let i = start; i < end; i += 1) units += glyphs[i]?.advanceUnits ?? 0;
  return -units;
}

interface Pieces {
  /** Hex strings and kern numbers, in display order. */
  parts: string[];
}

/**
 * Splits one string segment around the removed glyph range. `glyphIndex` values
 * are relative to the segment.
 */
function segmentPieces(
  segment: TextSegment,
  removeStart: number | undefined,
  removeEnd: number | undefined,
  byteLength: 1 | 2,
): Pieces {
  const glyphs = segment.glyphs;
  const parts: string[] = [];
  const pushKept = (start: number, end: number): void => {
    if (end <= start) return;
    const codes = glyphs.slice(start, end).map((glyph) => glyph.code);
    parts.push(`<${hexBytes(codesToBytes(codes, byteLength))}>`);
  };
  if (removeStart === undefined || removeEnd === undefined || removeEnd <= removeStart) {
    pushKept(0, glyphs.length);
    return { parts };
  }
  pushKept(0, removeStart);
  const kern = removalKern(glyphs, removeStart, removeEnd);
  if (kern !== 0) parts.push(formatNumber(kern));
  pushKept(removeEnd, glyphs.length);
  return { parts };
}

/** The line-move / spacing operators a show operator carries. */
function showPrefix(run: TextRun, bytes: Uint8Array): string {
  if (run.operation.name === "'") return 'T* ';
  if (run.operation.name === '"') {
    const aw = run.operation.operands[0];
    const ac = run.operation.operands[1];
    if (aw && ac) return `${rawToken(bytes, aw)} Tw ${rawToken(bytes, ac)} Tc T* `;
  }
  return '';
}

function buildRemovalShow(
  run: TextRun,
  bytes: Uint8Array,
  targetSegment: number,
  removeStart: number,
  removeEnd: number,
): string | { reason: string } {
  if (run.operation.name === '"' && run.operation.operands.length < 3) {
    return { reason: 'malformed " operator; spacing operands are missing' };
  }
  const font = run.font;
  const renderSegment = (segment: TextSegment, index: number): string[] => {
    if (index !== targetSegment) return [rawToken(bytes, segment.token)];
    return segmentPieces(segment, removeStart, removeEnd, font.codeByteLength).parts;
  };

  const arrayParts: string[] = [];
  if (run.operation.name === 'TJ') {
    const array = run.operation.operands[0];
    let segmentIndex = 0;
    for (const item of array?.kind === 'array' ? array.items ?? [] : []) {
      if (item.kind === 'number') arrayParts.push(formatNumber(item.value ?? 0));
      else if (item.kind === 'string') {
        const segment = run.segments[segmentIndex];
        if (segment) arrayParts.push(...renderSegment(segment, segmentIndex));
        segmentIndex += 1;
      }
    }
  } else {
    // Tj / ' / " hold exactly one string. Convert them to TJ so kept glyphs can
    // be separated by a compensating kern.
    run.segments.forEach((segment, index) => {
      arrayParts.push(...renderSegment(segment, index));
    });
  }

  const prefix = showPrefix(run, bytes);
  const allowed =
    run.operation.name === 'Tj' ||
    run.operation.name === 'TJ' ||
    run.operation.name === "'" ||
    run.operation.name === '"';
  if (!allowed) return { reason: `show operator "${run.operation.name}" cannot be rewritten` };
  return `${prefix}[${arrayParts.join(' ')}] TJ`;
}

function buildReplacementShow(
  run: TextRun,
  bytes: Uint8Array,
  encoded: Uint8Array,
  kern: number,
): string | { reason: string } {
  if (run.operation.name === '"' && run.operation.operands.length < 3) {
    return { reason: 'malformed " operator; spacing operands are missing' };
  }
  const parts = [`<${hexBytes(encoded)}>`];
  if (Math.abs(kern) >= 0.00005) parts.push(formatNumber(kern));
  const prefix = showPrefix(run, bytes);
  const allowed =
    run.operation.name === 'Tj' ||
    run.operation.name === 'TJ' ||
    run.operation.name === "'" ||
    run.operation.name === '"';
  if (!allowed) return { reason: `show operator "${run.operation.name}" cannot be rewritten` };
  return `${prefix}[${parts.join(' ')}] TJ`;
}

export interface RemovalPlan {
  operationIndex: number;
  start: number;
  end: number;
  text: string;
  /** Number of glyphs removed. */
  removed: number;
}

export interface ReplacementPlan {
  operationIndex: number;
  start: number;
  end: number;
  text: string;
}

/**
 * Plans the removal of a glyph range. The caller applies the returned splice to
 * the original bytes; every byte outside the show operation is preserved.
 */
export function planGlyphRemoval(
  run: TextRun,
  range: GlyphRange,
  bytes: Uint8Array,
): RemovalPlan | { reason: string } {
  if (!run.decodable) {
    return { reason: 'the show operator could not be decoded completely' };
  }
  if (range.start < 0 || range.end > run.glyphs.length || range.end <= range.start) {
    return { reason: 'selected glyph range is empty or outside the run' };
  }
  if (!run.font.reliable) {
    return { reason: run.font.reason ?? 'font advances are not reliable' };
  }
  const first = run.glyphs[range.start]!;
  const last = run.glyphs[range.end - 1]!;
  if (first.segmentIndex !== last.segmentIndex) {
    return { reason: 'selection spans more than one string in the same show operator' };
  }
  const segment = run.segments[first.segmentIndex];
  if (!segment) return { reason: 'selection has no owning string' };
  const relativeStart = range.start - (segment.glyphs[0]?.glyphIndex ?? 0);
  const relativeEnd = relativeStart + (range.end - range.start);
  const text = buildRemovalShow(run, bytes, first.segmentIndex, relativeStart, relativeEnd);
  if (typeof text !== 'string') return text;
  return {
    operationIndex: run.operationIndex,
    start: run.operation.start,
    end: run.operation.end,
    text,
    removed: range.end - range.start,
  };
}

/**
 * Plans a whole-run replacement. `encoded` is the replacement in the document's
 * own charcodes; `kern` preserves the original run's advance so following
 * content does not jump.
 */
export function planRunReplacement(
  run: TextRun,
  bytes: Uint8Array,
  encoded: Uint8Array,
  options: { allowAdvanceGrowth?: boolean } = {},
): ReplacementPlan | { reason: string } {
  if (!run.decodable) {
    return { reason: 'the show operator could not be decoded completely' };
  }
  if (!run.font.reliable) {
    // No reliable metrics means no honest compensation; still rewrite the string
    // when the caller asked, but do not claim a preserved advance.
    const text = buildReplacementShow(run, bytes, encoded, 0);
    if (typeof text !== 'string') return text;
    return {
      operationIndex: run.operationIndex,
      start: run.operation.start,
      end: run.operation.end,
      text,
    };
  }
  const spacingUnits = (code: number): number => {
    if (run.fontSize <= 0) return 0;
    const spacing =
      run.charSpacing + (code === 0x20 && run.font.codeByteLength === 1 ? run.wordSpacing : 0);
    return (spacing * 1000) / run.fontSize;
  };
  const originalUnits = run.glyphs.reduce((sum, glyph) => sum + glyph.advanceUnits, 0);
  const newUnits = run.font
    .decode(encoded)
    .reduce((sum, glyph) => sum + glyph.width + spacingUnits(glyph.code), 0);
  const tolerance = Math.max(1, originalUnits * 0.05);
  const growth = newUnits - originalUnits;
  let kern: number;
  if (growth > tolerance) {
    // A wider replacement overflows its original line. Refusing is the honest
    // answer when the caller supplied a box (the UI can reflow); without a box
    // there is no line to overflow, so keep the old behaviour and leave the
    // advance uncompensated rather than dragging following content backwards.
    if (!options.allowAdvanceGrowth) {
      return { reason: 'replacement is wider than the original run; reflow is required' };
    }
    kern = 0;
  } else {
    kern = -(originalUnits - newUnits);
  }
  const text = buildReplacementShow(run, bytes, encoded, kern);
  if (typeof text !== 'string') return text;
  return {
    operationIndex: run.operationIndex,
    start: run.operation.start,
    end: run.operation.end,
    text,
  };
}
