/**
 * Document-derived Unicode-to-charcode maps.
 *
 * `FPDFText_SetText` re-encodes from Unicode using its own idea of the font's
 * encoding, and on documents whose encoding does not match that idea it writes
 * the wrong glyphs *and reports success*. On a real LaTeX export (Type 1 subset,
 * `/Encoding` carrying only a `/Differences` array and no `/BaseEncoding`,
 * `ToUnicode` that deliberately omits space) every space came back as a comma:
 *
 *     SetText      -> "The,Lifecycle,of,a,Mushroom,Z"   (verified absent)
 *     SetCharcodes -> "The Lifecycle of a Mushroom Z"   (verified present)
 *
 * The document already contains the answer. `/ToUnicode` is the map the reader
 * decodes with; `/Encoding` plus its `/Differences` is the map the font draws
 * with. Reading both and inverting them yields the charcodes the document
 * itself would have used, which is what `FPDFText_SetCharcodes` needs.
 *
 * Coverage is deliberately limited to what can be derived, and a caller must
 * treat a `null` from {@link encodeWithMap} as "no map for this text" -- never
 * as a licence to guess. Whatever is written is still re-read by the engine's
 * verification pass, so a wrong map costs an overlay rather than a bad file.
 */

import { inflateSync, unzlibSync } from 'fflate';
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream } from '@cantoo/pdf-lib';
import { loadPdfDocument } from '../ops/pages.js';

/** Unicode code point -> the charcode a page's font uses for it. */
export type FontCharcodes = Map<number, number>;

/** Page index -> (subset-tag-stripped base font name -> map). */
export type FontCharcodesByPage = Map<number, Map<string, FontCharcodes>>;

/* --------------------------------------------------------- glyph names */

/**
 * PostScript glyph names -> Unicode. `/Differences` names glyphs, not
 * characters, so this is the only bridge from a `/Differences` entry to the
 * text a reader will see. Names not listed (and not `uniXXXX`-shaped) make the
 * font unresolvable rather than guessed at.
 */
const GLYPH_NAMES: Record<string, number> = {
  space: 0x20, exclam: 0x21, quotedbl: 0x22, numbersign: 0x23, dollar: 0x24,
  percent: 0x25, ampersand: 0x26, quotesingle: 0x27, parenleft: 0x28,
  parenright: 0x29, asterisk: 0x2a, plus: 0x2b, comma: 0x2c, hyphen: 0x2d,
  period: 0x2e, slash: 0x2f, colon: 0x3a, semicolon: 0x3b, less: 0x3c,
  equal: 0x3d, greater: 0x3e, question: 0x3f, at: 0x40, bracketleft: 0x5b,
  backslash: 0x5c, bracketright: 0x5d, asciicircum: 0x5e, underscore: 0x5f,
  grave: 0x60, braceleft: 0x7b, bar: 0x7c, braceright: 0x7d, asciitilde: 0x7e,
  quoteleft: 0x2018, quoteright: 0x2019, quotedblleft: 0x201c,
  quotedblright: 0x201d, quotesinglbase: 0x201a, quotedblbase: 0x201e,
  endash: 0x2013, emdash: 0x2014, bullet: 0x2022, dagger: 0x2020,
  daggerdbl: 0x2021, ellipsis: 0x2026, perthousand: 0x2030,
  guilsinglleft: 0x2039, guilsinglright: 0x203a, guillemotleft: 0xab,
  guillemotright: 0xbb, exclamdown: 0xa1, questiondown: 0xbf, cent: 0xa2,
  sterling: 0xa3, currency: 0xa4, yen: 0xa5, brokenbar: 0xa6, section: 0xa7,
  dieresis: 0xa8, copyright: 0xa9, ordfeminine: 0xaa, ordmasculine: 0xba,
  logicalnot: 0xac, softhyphen: 0xad, registered: 0xae, macron: 0xaf,
  degree: 0xb0, plusminus: 0xb1, twosuperior: 0xb2, threesuperior: 0xb3,
  acute: 0xb4, mu: 0xb5, paragraph: 0xb6, periodcentered: 0xb7, cedilla: 0xb8,
  onesuperior: 0xb9, onequarter: 0xbc, onehalf: 0xbd, threequarters: 0xbe,
  multiply: 0xd7, divide: 0xf7, Euro: 0x20ac, sterlingstyle: 0xa3,
  eth: 0xf0, ETH: 0xd0, thorn: 0xfe, Thorn: 0xde, germandbls: 0xdf,
  AE: 0xc6, ae: 0xe6, OE: 0x152, oe: 0x153, Oslash: 0xd8, oslash: 0xf8,
  Lslash: 0x141, lslash: 0x142, dotlessi: 0x131, dotlessj: 0x237,
  Scaron: 0x160, scaron: 0x161, Zcaron: 0x17d, zcaron: 0x17e,
  Ydieresis: 0x178, circumflex: 0x2c6, caron: 0x2c7, breve: 0x2d8,
  dotaccent: 0x2d9, ring: 0x2da, ogonek: 0x2db, tilde: 0x2dc,
  doubleacute: 0x2dd, minus: 0x2212, fi: 0xfb01, fl: 0xfb02, ff: 0xfb00,
  ffi: 0xfb03, ffl: 0xfb04, trademark: 0x2122, estimated: 0x212e,
  arrowleft: 0x2190, arrowup: 0x2191, arrowright: 0x2192, arrowdown: 0x2193,
};

// Latin-1 letters and ASCII letters: the bulk of any real /Differences array.
for (let code = 0xc0; code <= 0xde; code += 1) {
  if (code === 0xd7) continue; // multiply is not a letter
  GLYPH_NAMES[String.fromCharCode(code)] = code;
  GLYPH_NAMES[String.fromCharCode(code + 0x20)] = code + 0x20;
}
for (let letter = 0x41; letter <= 0x5a; letter += 1) {
  GLYPH_NAMES[String.fromCharCode(letter)] = letter;
  GLYPH_NAMES[String.fromCharCode(letter + 0x20)] = letter + 0x20;
}
const DIGIT_NAMES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
DIGIT_NAMES.forEach((name, digit) => {
  GLYPH_NAMES[name] = 0x30 + digit;
});

/** Glyph name -> Unicode, or undefined when the name is not understood. */
export function glyphNameToUnicode(name: string): number | undefined {
  const bare = name.replace(/^\//, '');
  const direct = GLYPH_NAMES[bare];
  if (direct !== undefined) return direct;
  // uniXXXX / uniXXXXYYYY / uXXXX / uXXXXXX / uXXXXYYYY
  const uni = /^uni([0-9A-Fa-f]{4})([0-9A-Fa-f]{4})*$/.exec(bare);
  if (uni) return Number.parseInt(uni[1]!, 16);
  const u = /^u([0-9A-Fa-f]{4})([0-9A-Fa-f]{2})*$/.exec(bare);
  if (u) return Number.parseInt(u[1]!, 16);
  return undefined;
}

/* ------------------------------------------------------- base encodings */

function ascii(): Record<number, number> {
  const out: Record<number, number> = {};
  for (let code = 0x20; code <= 0x7e; code += 1) out[code] = code;
  return out;
}

function latin1(): Record<number, number> {
  const out: Record<number, number> = {};
  for (let code = 0xa0; code <= 0xff; code += 1) out[code] = code;
  return out;
}

/**
 * Adobe StandardEncoding. Per the PDF spec this is the base a Type 1 font's
 * `/Encoding` inherits when it declares neither `/BaseEncoding` nor
 * `/Subtype /TrueType` -- the exact shape that broke `FPDFText_SetText`.
 * It differs from ASCII at 0x27/0x60 (curly quotes) and is shifted by one
 * through 0xC1-0xDF.
 */
function standardEncoding(): Record<number, number> {
  const out = { ...ascii(), ...latin1() };
  out[0x27] = 0x2019; // quoteright
  out[0x60] = 0x2018; // quoteleft
  for (let code = 0xc1; code <= 0xdf; code += 1) out[code] = code - 1;
  return out;
}

/** WinAnsiEncoding: ASCII plus Latin-1 plus the CP1252 specials at 0x80-0x9F. */
function winAnsiEncoding(): Record<number, number> {
  const out = { ...ascii(), ...latin1() };
  const specials: Record<number, number> = {
    0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026,
    0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030, 0x8a: 0x160,
    0x8b: 0x2039, 0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019,
    0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153,
    0x9e: 0x17e, 0x9f: 0x178,
  };
  return Object.assign(out, specials);
}

/** MacRomanEncoding: ASCII plus the classic Macintosh specials. */
function macRomanEncoding(): Record<number, number> {
  const out = { ...ascii(), ...latin1() };
  const specials: Record<number, number> = {
    0x80: 0xc4, 0x81: 0xc5, 0x82: 0xc7, 0x83: 0xc9, 0x84: 0xd1, 0x85: 0xd6,
    0x86: 0xdc, 0x87: 0xe1, 0x88: 0xe0, 0x89: 0xe2, 0x8a: 0xe4, 0x8b: 0xe3,
    0x8c: 0xe5, 0x8d: 0xe7, 0x8e: 0xe9, 0x8f: 0xe8, 0x90: 0xea, 0x91: 0xeb,
    0x92: 0xed, 0x93: 0xec, 0x94: 0xee, 0x95: 0xef, 0x96: 0xf1, 0x97: 0xf3,
    0x98: 0xf2, 0x99: 0xf4, 0x9a: 0xf6, 0x9b: 0xf5, 0x9c: 0xfa, 0x9d: 0xf9,
    0x9e: 0xfb, 0x9f: 0xfc, 0xa0: 0x2026, 0xa1: 0x2013, 0xa2: 0x2014,
    0xa3: 0x2018, 0xa4: 0x2019, 0xa5: 0x201c, 0xa6: 0x201d, 0xa7: 0x2022,
  };
  return Object.assign(out, specials);
}

const BASE_ENCODINGS: Record<string, Record<number, number>> = {
  StandardEncoding: standardEncoding(),
  WinAnsiEncoding: winAnsiEncoding(),
  MacRomanEncoding: macRomanEncoding(),
};

/* -------------------------------------------------------------- parsing */

/** Decodes a CMap's hex string as UTF-16BE code units. */
function decodeUtf16Be(hex: string): string {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
  }
  return out;
}

/** Parses a ToUnicode CMap into charcode -> Unicode text. */
export function parseToUnicode(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const section of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const match of section[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      out.set(Number.parseInt(match[1]!, 16), decodeUtf16Be(match[2]!));
    }
  }
  for (const section of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = section[1]!;
    for (const match of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g)) {
      const start = Number.parseInt(match[1]!, 16);
      const end = Number.parseInt(match[2]!, 16);
      const values = [...match[3]!.matchAll(/<([0-9a-fA-F]+)>/g)];
      values.forEach((value, offset) => {
        if (start + offset <= end) out.set(start + offset, decodeUtf16Be(value[1]!));
      });
    }
    for (const match of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const start = Number.parseInt(match[1]!, 16);
      const end = Number.parseInt(match[2]!, 16);
      const width = match[3]!.length;
      const base = Number.parseInt(match[3]!, 16);
      for (let code = start; code <= end && code - start < 0x10000; code += 1) {
        const dest = (base + (code - start)).toString(16).padStart(width, '0');
        out.set(code, decodeUtf16Be(dest));
      }
    }
  }
  return out;
}

/** Decodes an unfiltered or FlateDecode stream to a string. */
function streamText(stream: PDFRawStream): string | undefined {
  const filter = stream.dict.get(PDFName.of('Filter'));
  const name = filter ? stream.dict.context.lookup(filter) : undefined;
  let bytes: Uint8Array;
  if (!name) bytes = stream.contents;
  else if (name instanceof PDFName && name.asString() === '/FlateDecode') {
    try {
      bytes = unzlibSync(stream.contents);
    } catch {
      try {
        bytes = inflateSync(stream.contents);
      } catch {
        return undefined;
      }
    }
  } else return undefined;

  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return out;
}

/** Strips the `ABCDEF+` prefix subset fonts carry so names can be matched. */
function baseFontName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.replace(/^\//, '').replace(/^[A-Z]{6}\+/, '');
}

/** `/Encoding` -> code -> Unicode, honouring `/BaseEncoding` and `/Differences`. */
function encodingMap(
  doc: Awaited<ReturnType<typeof loadPdfDocument>>,
  font: PDFDict,
): Map<number, number> | undefined {
  const raw = font.get(PDFName.of('Encoding'));
  if (!raw) return undefined;

  let base: Record<number, number> | undefined;
  let differences: Map<number, number> | undefined;

  const encoding = doc.context.lookup(raw);
  if (encoding instanceof PDFName) {
    // A named encoding this module does not carry is not a licence to guess
    // one: writing the wrong codes is worse than falling back to SetText.
    base = BASE_ENCODINGS[encoding.asString().replace(/^\//, '')];
    if (!base) return undefined;
  } else if (encoding instanceof PDFDict) {
    const declared = encoding.get(PDFName.of('BaseEncoding'));
    const baseName = declared ? doc.context.lookup(declared) : undefined;
    if (baseName instanceof PDFName) {
      base = BASE_ENCODINGS[baseName.asString().replace(/^\//, '')];
      if (!base) return undefined;
    } else {
      // No `/BaseEncoding`: the spec says a Type 1 font inherits
      // StandardEncoding, which is exactly the shape TeX ships.
      base = BASE_ENCODINGS.StandardEncoding;
    }
    const list = encoding.get(PDFName.of('Differences'));
    const array = list ? doc.context.lookup(list) : undefined;
    if (array instanceof PDFArray) {
      differences = new Map();
      let code = 0;
      for (let i = 0; i < array.size(); i += 1) {
        const entry = doc.context.lookup(array.get(i));
        if (entry instanceof PDFNumber) {
          code = entry.asNumber();
          continue;
        }
        if (!(entry instanceof PDFName)) continue;
        const unicode = glyphNameToUnicode(entry.asString());
        if (unicode !== undefined) differences.set(code, unicode);
        code += 1;
      }
    }
  } else {
    return undefined;
  }

  // `/Differences` is inserted first because this map is keyed by code and the
  // caller inverts it: insertion order decides which *code* claims a character
  // two codes both draw, and the `/Differences` overlay is the more specific
  // declaration, so it must beat the base it sits on. Skipping base codes that
  // are already present leaves the per-code result identical to an override.
  const table = base;
  if (table === undefined) return undefined;
  const out = new Map<number, number>();
  for (const [code, unicode] of differences ?? []) out.set(code, unicode);
  for (const [code, unicode] of Object.entries(table)) {
    const key = Number(code);
    if (!out.has(key)) out.set(key, unicode);
  }
  return out;
}

/** Font dictionary -> Unicode -> charcode, or undefined when unresolvable. */
function fontCharcodes(
  doc: Awaited<ReturnType<typeof loadPdfDocument>>,
  font: PDFDict,
): FontCharcodes | undefined {
  const subtypeRef = font.get(PDFName.of('Subtype'));
  const subtype = subtypeRef ? doc.context.lookup(subtypeRef) : undefined;
  const encoding = subtype instanceof PDFName && subtype.asString() === '/Type0'
    ? undefined
    : encodingMap(doc, font);

  const toUnicodeRef = font.get(PDFName.of('ToUnicode'));
  const toUnicodeStream = toUnicodeRef ? doc.context.lookup(toUnicodeRef) : undefined;
  const toUnicodeText =
    toUnicodeStream instanceof PDFRawStream ? streamText(toUnicodeStream) : undefined;
  const toUnicode = toUnicodeText ? parseToUnicode(toUnicodeText) : undefined;

  if (!encoding && !toUnicode) return undefined;

  // Invert: `/ToUnicode` first, because it is the map the reader actually
  // decodes with, then the font's own encoding to fill the gaps it leaves --
  // which on subset fonts is exactly where whitespace lives.
  const unicodeToCode: FontCharcodes = new Map();
  const claim = (unicode: string, code: number): void => {
    if (unicode.length !== 1) return;
    const point = unicode.codePointAt(0)!;
    if (!unicodeToCode.has(point)) unicodeToCode.set(point, code);
  };
  for (const [code, unicode] of toUnicode ?? []) claim(unicode, code);
  for (const [code, unicode] of encoding ?? []) claim(String.fromCodePoint(unicode), code);
  return unicodeToCode.size > 0 ? unicodeToCode : undefined;
}

/**
 * Reads every font's map on every page of `data`.
 *
 * Failures are not fatal: a document that cannot be parsed simply yields no
 * maps, and the caller falls back to `FPDFText_SetText` as before.
 */
export async function readFontCharcodes(
  data: Uint8Array,
  password?: string,
): Promise<FontCharcodesByPage> {
  const out: FontCharcodesByPage = new Map();
  let doc: Awaited<ReturnType<typeof loadPdfDocument>>;
  try {
    doc = await loadPdfDocument(data, password !== undefined ? { password } : {});
  } catch {
    return out;
  }

  const count = doc.getPageCount();
  for (let pageIndex = 0; pageIndex < count; pageIndex += 1) {
    const resources = doc.getPage(pageIndex).node.Resources();
    const fonts = resources ? doc.context.lookup(resources.get(PDFName.of('Font'))) : undefined;
    if (!(fonts instanceof PDFDict)) continue;
    let perFont: Map<string, FontCharcodes> | undefined;
    for (const [, ref] of fonts.entries()) {
      const font = doc.context.lookup(ref);
      if (!(font instanceof PDFDict)) continue;
      const base = font.get(PDFName.of('BaseFont'));
      const declared = base ? doc.context.lookup(base) : undefined;
      const name = baseFontName(
        declared instanceof PDFName ? declared.asString() : undefined,
      );
      if (!name) continue;
      const map = fontCharcodes(doc, font);
      if (!map) continue;
      perFont ??= new Map();
      perFont.set(name, map);
    }
    if (perFont) out.set(pageIndex, perFont);
  }
  return out;
}

/**
 * Charcodes for `text` in one font, or `null` when any character is unknown.
 *
 * Returning `null` rather than a partial list matters: `FPDFText_SetCharcodes`
 * replaces the whole glyph string, so a run that silently drops the characters
 * it could not map would be worse than the Unicode write it replaces.
 */
export function encodeWithMap(map: FontCharcodes | undefined, text: string): number[] | null {
  if (!map) return null;
  const codes: number[] = [];
  for (const character of text) {
    const code = map.get(character.codePointAt(0)!);
    if (code === undefined) return null;
    codes.push(code);
  }
  return codes.length > 0 ? codes : null;
}

