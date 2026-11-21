/**
 * Font metrics for content-stream surgery (C-02).
 *
 * Removing glyphs from an existing show operator is only safe when their
 * advances are known: the next glyph has to stay where it was, and that means
 * writing a compensating kern in the same units the stream used. The existing
 * pass only knew PDFium's `FPDFFont_GetGlyphWidth`; this module reads the
 * document's own declarations instead, so the stream path works in the worker
 * without a renderer and can be exercised by pure unit tests.
 *
 * Width sources, in precedence order:
 *
 *   - Type0: `/W` + `/DW`, with `/Encoding` deciding whether the code space is
 *     Identity (the only one trusted today);
 *   - simple: `/FirstChar` + `/Widths` + `/MissingWidth`;
 *   - Type3: `/Widths` transformed by `/FontMatrix`;
 *   - base-14 without `/Widths`: the Adobe AFM advance tables for
 *     Helvetica/Times/Courier (ASCII range).
 *
 * Anything outside those sources returns a reason and `reliable:false`; callers
 * must not compensate from a guess.
 */

import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';
import {
  glyphNameToUnicode,
  namedEncodingTable,
  parseToUnicode,
} from '../charcodes.js';

export type FontSubtype =
  | 'Type0'
  | 'Type1'
  | 'TrueType'
  | 'Type3'
  | 'MMType1'
  | 'CIDFontType0'
  | 'CIDFontType2'
  | 'unknown';

export interface DecodedGlyphCode {
  code: number;
  /** Unicode text this code decodes to, when the document told us. */
  unicode: string | undefined;
  /** Glyph width in 1/1000 text-space units. */
  width: number;
}

export interface FontMetrics {
  baseName: string;
  subtype: FontSubtype;
  /** 1 for simple fonts, 2 for Type0/CID code spaces. */
  codeByteLength: 1 | 2;
  /** True only when every glyph advance needed for compensation is known. */
  reliable: boolean;
  reason?: string;
  /** Width in 1/1000 text-space units. */
  widthFor(code: number): number;
  unicodeFor(code: number): string | undefined;
  decode(bytes: Uint8Array): DecodedGlyphCode[];
  /** Encodes text to codes, or null when a character is not covered. */
  encode(text: string): Uint8Array | null;
}

const ASCII_FIRST = 32;
const ASCII_LAST = 126;

function widthTable(text: string): number[] {
  return text.trim().split(/\s+/).map(Number);
}

// Adobe AFM advance widths for the printable ASCII range (32-126). The values
// are public standard-14 metrics, not extracted from any document.
const HELVETICA = widthTable(
  '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 ' +
    '556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 ' +
    '1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 ' +
    '667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 ' +
    '333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 ' +
    '556 556 333 500 278 556 500 722 500 500 500 334 260 334 584',
);

const HELVETICA_BOLD = widthTable(
  '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 ' +
    '556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 ' +
    '975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 ' +
    '667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 ' +
    '333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 ' +
    '611 611 389 556 333 611 556 778 556 556 500 389 280 389 584',
);

const TIMES_ROMAN = widthTable(
  '250 333 408 500 500 833 778 180 333 333 500 564 250 333 250 278 ' +
    '500 500 500 500 500 500 500 500 500 500 278 278 564 564 564 444 ' +
    '921 722 667 667 722 611 556 722 722 333 389 722 611 889 722 722 ' +
    '556 722 667 556 611 722 722 944 722 722 611 333 278 333 469 500 ' +
    '333 444 500 444 500 444 333 500 500 278 278 500 278 778 500 500 ' +
    '500 500 333 389 278 500 500 722 500 500 444 480 200 480 541',
);

const TIMES_BOLD = widthTable(
  '250 333 555 500 500 1000 833 278 333 333 500 570 250 333 250 278 ' +
    '500 500 500 500 500 500 500 500 500 500 333 333 570 570 570 500 ' +
    '930 722 667 722 722 667 611 778 778 389 500 778 667 944 722 778 ' +
    '611 778 722 556 667 722 722 1000 722 722 667 333 278 333 581 500 ' +
    '333 500 556 444 556 444 333 500 556 278 333 556 278 833 556 500 ' +
    '556 556 444 389 333 556 500 722 500 500 444 394 220 394 520',
);

const TIMES_ITALIC = widthTable(
  '250 333 420 500 500 833 778 214 333 333 500 675 250 333 250 278 ' +
    '500 500 500 500 500 500 500 500 500 500 333 333 675 675 675 500 ' +
    '920 611 611 667 722 611 611 722 722 333 444 667 556 833 667 722 ' +
    '611 722 611 500 556 722 611 833 611 556 556 389 278 389 422 500 ' +
    '333 500 500 444 500 444 278 500 500 278 278 444 278 722 500 500 ' +
    '500 500 389 389 278 500 444 667 444 444 389 400 275 400 541',
);

const TIMES_BOLD_ITALIC = widthTable(
  '250 389 555 500 500 833 778 278 333 333 500 570 250 333 250 278 ' +
    '500 500 500 500 500 500 500 500 500 500 333 333 570 570 570 500 ' +
    '832 667 667 667 722 667 667 722 778 389 500 667 611 889 722 722 ' +
    '611 722 667 556 611 722 667 889 667 611 611 333 278 333 570 500 ' +
    '333 500 500 444 500 444 333 500 556 278 278 500 278 778 556 500 ' +
    '500 500 389 389 278 556 444 667 500 444 389 348 220 348 570',
);

const COURIER = widthTable(
  Array.from({ length: ASCII_LAST - ASCII_FIRST + 1 }, () => '600').join(' '),
);

function baseTables(baseName: string): number[] | undefined {
  const name = baseName.toLowerCase();
  if (name.includes('courier') || name.includes('mono')) return COURIER;
  if (name.includes('times') || name.includes('serif')) {
    const bold = name.includes('bold') || name.includes('black');
    const italic = name.includes('italic') || name.includes('oblique');
    if (bold && italic) return TIMES_BOLD_ITALIC;
    if (bold) return TIMES_BOLD;
    if (italic) return TIMES_ITALIC;
    return TIMES_ROMAN;
  }
  if (
    name.includes('helvetica') ||
    name.includes('arial') ||
    name.includes('sans') ||
    name.includes('symbol')
  ) {
    return name.includes('bold') ? HELVETICA_BOLD : HELVETICA;
  }
  return undefined;
}

function tableWidth(table: readonly number[] | undefined, code: number): number | undefined {
  if (!table || code < ASCII_FIRST || code > ASCII_LAST) return undefined;
  return table[code - ASCII_FIRST];
}

function lookupNumber(dict: PDFDict, key: string): number | undefined {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

function lookupArray(dict: PDFDict, key: string): PDFArray | undefined {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFArray ? value : undefined;
}

function streamText(stream: PDFRawStream): string | undefined {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(decodePDFRawStream(stream).decode());
  } catch {
    try {
      bytes = stream.getContents();
    } catch {
      return undefined;
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return out;
}

function toUnicodeMap(dict: PDFDict): Map<number, string> | undefined {
  const raw = dict.lookup(PDFName.of('ToUnicode'));
  if (!(raw instanceof PDFRawStream)) return undefined;
  const text = streamText(raw);
  if (!text) return undefined;
  const map = parseToUnicode(text);
  return map.size > 0 ? map : undefined;
}

interface EncodingResult {
  codeToUnicode: Map<number, string>;
  /** True when the map came from a declaration the document actually made. */
  declared: boolean;
}

function encodingMap(dict: PDFDict): EncodingResult | undefined {
  const raw = dict.get(PDFName.of('Encoding'));
  if (!raw) return undefined;
  const encoding = dict.context.lookup(raw);
  let base: Readonly<Record<number, number>> | undefined;
  let differences: Map<number, string> | undefined;
  if (encoding instanceof PDFName) {
    base = namedEncodingTable(encoding.asString());
    if (!base) return undefined;
  } else if (encoding instanceof PDFDict) {
    const declared = encoding.get(PDFName.of('BaseEncoding'));
    const baseName = declared ? encoding.context.lookup(declared) : undefined;
    if (baseName instanceof PDFName) {
      base = namedEncodingTable(baseName.asString());
      if (!base) return undefined;
    } else {
      // A Type1 font with /Differences and no /BaseEncoding inherits
      // StandardEncoding. This is the shape TeX ships.
      base = namedEncodingTable('StandardEncoding');
    }
    const list = encoding.get(PDFName.of('Differences'));
    const array = list ? encoding.context.lookup(list) : undefined;
    if (array instanceof PDFArray) {
      differences = new Map();
      let code = 0;
      for (let i = 0; i < array.size(); i += 1) {
        const entry = array.lookup(i);
        if (entry instanceof PDFNumber) {
          code = entry.asNumber();
          continue;
        }
        if (!(entry instanceof PDFName)) continue;
        const unicode = glyphNameToUnicode(entry.asString());
        if (unicode !== undefined) differences.set(code, String.fromCodePoint(unicode));
        code += 1;
      }
    }
  } else {
    return undefined;
  }

  const out = new Map<number, string>();
  for (const [code, unicode] of differences ?? []) out.set(code, unicode);
  for (const [code, unicode] of Object.entries(base ?? {})) {
    const key = Number(code);
    if (!out.has(key)) out.set(key, String.fromCodePoint(unicode));
  }
  return { codeToUnicode: out, declared: differences !== undefined || base !== undefined };
}

interface WidthSource {
  widthFor(code: number): number | undefined;
  reliable: boolean;
  reason?: string;
}

function simpleWidths(dict: PDFDict, baseName: string): WidthSource {
  const widths = lookupArray(dict, 'Widths');
  const first = lookupNumber(dict, 'FirstChar');
  const missing = lookupNumber(dict, 'MissingWidth');
  const table = baseTables(baseName);
  if (widths && first !== undefined) {
    return {
      widthFor(code: number) {
        const index = code - first;
        if (index < 0 || index >= widths.size()) return missing;
        const value = widths.lookup(index);
        return value instanceof PDFNumber ? value.asNumber() : missing;
      },
      reliable: true,
    };
  }
  if (table) {
    return {
      widthFor(code: number) {
        return tableWidth(table, code) ?? missing;
      },
      reliable: true,
    };
  }
  if (missing !== undefined) {
    return {
      widthFor: () => missing,
      reliable: false,
      reason: 'font has no /Widths and is not a known base-14 face; widths fall back to /MissingWidth',
    };
  }
  return {
    widthFor: () => undefined,
    reliable: false,
    reason: 'font has no usable width table',
  };
}

interface Type0Widths {
  widthFor(code: number): number | undefined;
  defaultWidth: number;
  reliable: boolean;
  reason?: string;
}

function type0Widths(descendant: PDFDict): Type0Widths {
  const defaultWidth = lookupNumber(descendant, 'DW') ?? 1000;
  const w = lookupArray(descendant, 'W');
  const widths = new Map<number, number>();
  if (w) {
    let i = 0;
    while (i < w.size()) {
      const firstValue = w.lookup(i);
      if (!(firstValue instanceof PDFNumber)) {
        i += 1;
        continue;
      }
      const first = firstValue.asNumber();
      const next = i + 1 < w.size() ? w.lookup(i + 1) : undefined;
      if (next instanceof PDFArray) {
        for (let n = 0; n < next.size(); n += 1) {
          const width = next.lookup(n);
          if (width instanceof PDFNumber) widths.set(first + n, width.asNumber());
        }
        i += 2;
        continue;
      }
      if (next instanceof PDFNumber) {
        const lastValue = i + 2 < w.size() ? w.lookup(i + 2) : undefined;
        if (lastValue instanceof PDFNumber) {
          const last = next.asNumber();
          const width = lastValue.asNumber();
          for (let code = first; code <= last && code - first < 0x10000; code += 1) {
            widths.set(code, width);
          }
        }
        i += 3;
        continue;
      }
      i += 1;
    }
  }
  return {
    defaultWidth,
    widthFor(code: number) {
      return widths.get(code) ?? defaultWidth;
    },
    reliable: true,
  };
}

function decodeType0EncodingName(dict: PDFDict): { identity: boolean; reason?: string } {
  const raw = dict.get(PDFName.of('Encoding'));
  const encoding = raw ? dict.context.lookup(raw) : undefined;
  if (encoding instanceof PDFName) {
    const name = encoding.asString().replace(/^\//, '');
    if (name === 'Identity-H' || name === 'Identity-V') return { identity: true };
    return { identity: false, reason: `non-Identity CMap "${name}" is not trusted for surgery` };
  }
  return { identity: false, reason: 'Type0 font has no Identity CMap' };
}

function makeMetrics(
  baseName: string,
  subtype: FontSubtype,
  codeByteLength: 1 | 2,
  widthSource: WidthSource,
  unicode: Map<number, string> | undefined,
  reliable: boolean,
  reason?: string,
): FontMetrics {
  const reverse = new Map<string, number>();
  for (const [code, text] of unicode ?? []) {
    if (text.length === 1 && !reverse.has(text)) reverse.set(text, code);
  }
  return {
    baseName,
    subtype,
    codeByteLength,
    reliable,
    ...(reason ? { reason } : {}),
    widthFor(code: number) {
      return widthSource.widthFor(code) ?? 0;
    },
    unicodeFor(code: number) {
      return unicode?.get(code);
    },
    decode(bytes: Uint8Array) {
      const glyphs: DecodedGlyphCode[] = [];
      if (codeByteLength === 2) {
        for (let i = 0; i + 1 < bytes.length; i += 2) {
          const code = (bytes[i]! << 8) | bytes[i + 1]!;
          glyphs.push({ code, unicode: unicode?.get(code), width: widthSource.widthFor(code) ?? 0 });
        }
        return glyphs;
      }
      for (const code of bytes) {
        glyphs.push({ code, unicode: unicode?.get(code), width: widthSource.widthFor(code) ?? 0 });
      }
      return glyphs;
    },
    encode(text: string) {
      const codes: number[] = [];
      for (const character of text) {
        const code = reverse.get(character);
        if (code === undefined) return null;
        codes.push(code);
      }
      if (codeByteLength === 1) return Uint8Array.from(codes.map((code) => code & 0xff));
      const out = new Uint8Array(codes.length * 2);
      codes.forEach((code, index) => {
        out[index * 2] = (code >> 8) & 0xff;
        out[index * 2 + 1] = code & 0xff;
      });
      return out;
    },
  };
}

/** Reads one font dictionary into a metrics object. */
export function readFontMetrics(dict: PDFDict): FontMetrics {
  const baseRaw = dict.lookup(PDFName.of('BaseFont'));
  const baseName =
    baseRaw instanceof PDFName
      ? baseRaw.asString().replace(/^\//, '').replace(/^[A-Z]{6}\+/, '')
      : 'unknown';
  const subtypeRaw = dict.lookup(PDFName.of('Subtype'));
  const subtypeName =
    subtypeRaw instanceof PDFName ? subtypeRaw.asString().replace(/^\//, '') : 'unknown';
  const knownSubtypes = new Set<string>([
    'Type0',
    'Type1',
    'TrueType',
    'Type3',
    'MMType1',
    'CIDFontType0',
    'CIDFontType2',
  ]);
  const subtype: FontSubtype = knownSubtypes.has(subtypeName)
    ? (subtypeName as FontSubtype)
    : 'unknown';

  const toUnicode = toUnicodeMap(dict);

  if (subtype === 'Type0') {
    const descendants = lookupArray(dict, 'DescendantFonts');
    const descendant =
      descendants && descendants.size() > 0
        ? descendants.lookup(0)
        : undefined;
    if (!(descendant instanceof PDFDict)) {
      return makeMetrics(
        baseName,
        subtype,
        2,
        { widthFor: () => undefined, reliable: false, reason: 'Type0 font has no descendant font' },
        toUnicode,
        false,
        'Type0 font has no descendant font dictionary',
      );
    }
    const widths = type0Widths(descendant);
    const encoding = decodeType0EncodingName(dict);
    return makeMetrics(
      baseName,
      subtype,
      2,
      widths,
      toUnicode,
      widths.reliable && encoding.identity,
      encoding.reason,
    );
  }

  if (subtype === 'Type3') {
    const matrix = lookupArray(dict, 'FontMatrix');
    const scale = matrix && matrix.size() >= 1 ? matrix.lookup(0) : undefined;
    const a = scale instanceof PDFNumber ? scale.asNumber() : 0.001;
    const widths = simpleWidths(dict, baseName);
    return makeMetrics(
      baseName,
      subtype,
      1,
      {
        widthFor(code: number) {
          const raw = widths.widthFor(code);
          return raw === undefined ? undefined : raw * a * 1000;
        },
        reliable: widths.reliable,
        ...(widths.reason ? { reason: widths.reason } : {}),
      },
      toUnicode,
      widths.reliable,
      widths.reliable ? undefined : 'Type3 widths are not fully declared',
    );
  }

  if (subtype === 'CIDFontType0' || subtype === 'CIDFontType2') {
    const widths = type0Widths(dict);
    return makeMetrics(baseName, subtype, 2, widths, toUnicode, widths.reliable);
  }

  const widths = simpleWidths(dict, baseName);
  const encoding = encodingMap(dict);
  const unicode = new Map<number, string>();
  for (const [code, text] of toUnicode ?? []) unicode.set(code, text);
  for (const [code, text] of encoding?.codeToUnicode ?? []) {
    if (!unicode.has(code)) unicode.set(code, text);
  }
  return makeMetrics(
    baseName,
    subtype,
    1,
    widths,
    unicode.size > 0 ? unicode : undefined,
    widths.reliable,
    widths.reason,
  );
}

/**
 * Resolves every font resource on one page. Duplicate resource names pointing at
 * the same dictionary still yield one metrics object per name, which keeps the
 * caller's `Tf` lookup trivial.
 */
export function readPageFontMetrics(
  resources: PDFDict | undefined,
): Map<string, FontMetrics> {
  const out = new Map<string, FontMetrics>();
  if (!resources) return out;
  const fontsRaw = resources.get(PDFName.of('Font'));
  const fonts = fontsRaw ? resources.context.lookup(fontsRaw) : undefined;
  if (!(fonts instanceof PDFDict)) return out;
  for (const [name, value] of fonts.entries()) {
    const dict = fonts.context.lookup(value);
    if (dict instanceof PDFDict) out.set(name.asString().replace(/^\//, ''), readFontMetrics(dict));
  }
  return out;
}
