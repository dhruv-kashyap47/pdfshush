/**
 * H-04: seeded fuzz for the content-stream lexer, emitter and planner.
 *
 * Deterministic by construction: every case comes from a fixed seed, so a
 * failure can be replayed exactly. The properties are the ones a rewrite must
 * never lose:
 *
 *  - tokenise -> emit is byte-identical, including for malformed input;
 *  - operation parsing terminates and stays inside the token range;
 *  - scanning/planning either succeeds or refuses with an Error, never hangs
 *    and never leaks an unexpected exception type.
 */

import { describe, expect, test } from 'vitest';
import {
  emitContentStream,
  parseOperations,
  tokenizeContentStream,
} from '../src/textedit/stream/lexer.js';
import {
  findGlyphRange,
  glyphRangeBox,
  planGlyphRemoval,
  planRunReplacement,
  scanPageText,
} from '../src/textedit/stream/surgery.js';
import type { FontMetrics } from '../src/textedit/stream/metrics.js';

/** Small deterministic PRNG (mulberry32); no dependency, same bytes everywhere. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const TOKENS = [
  'BT',
  'ET',
  'q',
  'Q',
  'Tf',
  '/F1 12 Tf',
  'Tm',
  '1 0 0 1 40 700 Tm',
  'Td',
  '0 -14 Td',
  'Tj',
  '(Hello) Tj',
  '<48656c6c6f> Tj',
  '[(A) -20 (B)] TJ',
  '[(A) 120 (B)] TJ',
  "(Line) '",
  '10 20 (Line) "',
  '/DeviceRGB cs',
  '0.2 0.4 0.6 sc',
  '1 0 0 rg',
  're',
  '0 0 10 10 re f',
  'cm',
  '2 0 0 2 10 10 cm',
  '% a comment with (parens) and \\\\ escapes',
  '<< /A [1 2 (x)] >>',
  'BI /W 2 /H 2 /BPC 8 /CS /G ID \u0000\u0001 EI',
  '(unclosed string',
  '<zz bad hex>',
  '[]',
  '0.0001',
  '-3.25',
  'true',
  'null',
  '/Name#20With#20Escapes',
];

function randomSnippet(random: () => number): string {
  const pieces = Math.floor(random() * 8) + 1;
  let output = '';
  for (let index = 0; index < pieces; index += 1) {
    output += TOKENS[Math.floor(random() * TOKENS.length)]!;
    output += random() < 0.7 ? '\n' : ' ';
  }
  return output;
}

function randomBytes(random: () => number): Uint8Array {
  const mode = random();
  if (mode < 0.15) {
    // Pure noise: not a PDF stream at all.
    const length = Math.floor(random() * 400);
    return Uint8Array.from({ length }, () => Math.floor(random() * 256));
  }
  return new TextEncoder().encode(randomSnippet(random));
}

const FONT: FontMetrics = {
  baseName: 'Helvetica',
  subtype: 'Type1',
  codeByteLength: 1,
  reliable: true,
  widthFor: () => 500,
  unicodeFor: (code) => String.fromCharCode(code),
  decode: (bytes) =>
    Array.from(bytes, (code) => ({
      code,
      unicode: String.fromCharCode(code),
      width: 500,
    })),
  encode: (text) => Uint8Array.from([...text], (character) => character.charCodeAt(0) & 0xff),
};

describe('H-04 stream fuzz (fixed seeds)', () => {
  test('a stray delimiter cannot stall the scanner', () => {
    // Found by the seeded fuzz: `>` is a delimiter, but no branch claimed a
    // lone one, so readWord returned a zero-width token and the scanner never
    // advanced.
    const bytes = new TextEncoder().encode('(A) Tj > > 0 0 m');
    expect(emitContentStream(bytes, tokenizeContentStream(bytes))).toEqual(bytes);
  }, 20_000);

  test('tokenise -> emit is byte-identical for every seed', () => {
    for (let seed = 1; seed <= 96; seed += 1) {
      const random = rng(seed);
      for (let iteration = 0; iteration < 25; iteration += 1) {
        const bytes = randomBytes(random);
        const tokens = tokenizeContentStream(bytes);
        const emitted = emitContentStream(bytes, tokens);
        if (emitted.length !== bytes.length) {
          throw new Error(`length changed at seed ${seed}/${iteration}`);
        }
        for (let i = 0; i < bytes.length; i += 1) {
          if (emitted[i] !== bytes[i]) {
            throw new Error(`byte ${i} changed at seed ${seed}/${iteration}`);
          }
        }
      }
    }
  }, 20_000);

  test('operation parsing terminates and stays within the stream', () => {
    for (let seed = 1000; seed < 1064; seed += 1) {
      const random = rng(seed);
      for (let iteration = 0; iteration < 25; iteration += 1) {
        const bytes = randomBytes(random);
        const tokens = tokenizeContentStream(bytes);
        const operations = parseOperations(tokens);
        expect(operations.length).toBeLessThanOrEqual(tokens.length);
        for (const operation of operations) {
          expect(operation.start).toBeGreaterThanOrEqual(0);
          expect(operation.end).toBeLessThanOrEqual(bytes.length);
          expect(operation.start).toBeLessThanOrEqual(operation.end);
        }
      }
    }
  }, 20_000);

  test('scanning and removal planning refuse rather than crash', () => {
    for (let seed = 2000; seed < 2032; seed += 1) {
      const random = rng(seed);
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const bytes = randomBytes(random);
        const operations = parseOperations(tokenizeContentStream(bytes));
        const scan = scanPageText(operations, new Map([['F1', FONT]]));

        for (const run of scan.runs) {
          const needle = run.text.length > 0
            ? run.text.slice(0, Math.max(1, Math.floor(random() * run.text.length)))
            : '';
          if (needle.length === 0) continue;
          const found = findGlyphRange(run, needle);
          if (!found) continue;
          const range = found.range;
          expect(glyphRangeBox(run, range)).toBeDefined();
          const plan = planGlyphRemoval(run, range, bytes);
          if ('reason' in plan) continue;
          expect(plan.removed).toBeGreaterThan(0);
          expect(plan.end).toBeGreaterThanOrEqual(plan.start);

          const encoded = Uint8Array.from(
            { length: Math.floor(random() * 20) },
            () => Math.floor(random() * 256),
          );
          const replacement = planRunReplacement(run, bytes, encoded);
          if (!('reason' in replacement)) {
            expect(replacement.end).toBeGreaterThanOrEqual(replacement.start);
          }
        }
      }
    }
  }, 20_000);
});
