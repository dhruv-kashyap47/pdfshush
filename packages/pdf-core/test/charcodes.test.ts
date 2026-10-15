/**
 * Document-derived charcode maps.
 *
 * The native pass prefers `FPDFText_SetCharcodes` over `FPDFText_SetText`
 * because the latter re-encodes from Unicode using its own idea of the font's
 * encoding -- and on subset fonts (a real LaTeX export, a Word re-save) that
 * idea is wrong: on the fixture that motivated this module every space came
 * back as a comma, and `SetCharcodes` with the document's own codes fixed it.
 *
 * These tests pin the contract the engine relies on: the map is read from the
 * document's own `/ToUnicode` and `/Encoding`, and a character the document
 * cannot encode is refused outright rather than written as a guess.
 */

import { describe, expect, it } from 'vitest';
import {
  encodeWithMap,
  glyphNameToUnicode,
  parseToUnicode,
  readFontCharcodes,
} from '../src/textedit/charcodes.js';

/** Builds a one-page PDF whose objects are given as raw PDF source. */
function assemble(objects: string[]): Uint8Array {
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n += 1) {
    offsets[n] = body.length;
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n += 1) {
    body += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/**
 * A one-page document with a single font (object 5). `toUnicode` is written as
 * object 6 when supplied, and `font` should reference it as `6 0 R`.
 */
function fontPdf(font: string, toUnicode?: string): Uint8Array {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R ' +
    '/Resources << /Font << /F1 5 0 R >> >> >>';
  objects[4] = '<< /Length 0 >>\nstream\n\nendstream';
  objects[5] = font;
  if (toUnicode !== undefined) {
    objects[6] = `<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}\nendstream`;
  }
  return assemble(objects);
}

/** A Type 1 font with a `/Differences`-only `/Encoding` (the shape TeX ships). */
const WIDTHS = Array.from({ length: 126 - 32 + 1 }, () => '0').join(' ');

function subsetFont(encoding: string, withToUnicode: boolean): string {
  return (
    '<< /Type /Font /Subtype /Type1 /BaseFont /AAAAAA+SampleFont ' +
    '/FirstChar 32 /LastChar 126 ' +
    `/Widths [${WIDTHS}] ` +
    (withToUnicode ? '/ToUnicode 6 0 R ' : '') +
    `/Encoding ${encoding} >>`
  );
}

const TO_UNICODE =
  [
    'begincmap',
    '1 begincodespacerange',
    '<00> <FF>',
    'endcodespacerange',
    '2 beginbfchar',
    '<41> <0020>',
    '<46> <002A>',
    'endbfchar',
    'endcmap',
  ].join('\n') + '\n';

describe('document-derived charcodes', () => {
  it('prefers /ToUnicode, then fills the gaps from /Encoding and its base', async () => {
    const bytes = fontPdf(
      subsetFont(
        '<< /BaseEncoding /WinAnsiEncoding /Differences [ 45 /space 66 /bullet ] >>',
        true,
      ),
      TO_UNICODE,
    );
    const maps = await readFontCharcodes(bytes);
    const font = maps.get(0)?.get('SampleFont');
    expect(font, 'the subset tag must be stripped so PDFium and the PDF agree').toBeDefined();

    // /ToUnicode is what the reader decodes with, so it wins where the two
    // disagree: it calls code 0x41 a space even though /Differences says 45.
    expect(encodeWithMap(font, ' ')).toEqual([0x41]);
    // /Differences still supplies characters /ToUnicode never mentions.
    expect(encodeWithMap(font, '•')).toEqual([66]);
    // and the declared base encoding fills the rest of the page's text.
    expect(encodeWithMap(font, '€')).toEqual([0x80]);
  });

  it('resolves a /Differences-only font that has no /ToUnicode at all', async () => {
    const bytes = fontPdf(subsetFont('<< /Differences [ 45 /space 46 /hyphen ] >>', false));
    const font = (await readFontCharcodes(bytes)).get(0)?.get('SampleFont');
    expect(font).toBeDefined();
    // Space is not at 32 here -- this is exactly what FPDFText_SetText gets
    // wrong, because it writes 32 regardless.
    expect(encodeWithMap(font, ' ')).toEqual([45]);
    expect(encodeWithMap(font, '-')).toEqual([46]);
    expect(encodeWithMap(font, 'A')).toEqual([65]);
  });

  it('refuses a whole run when one character cannot be encoded', async () => {
    const bytes = fontPdf(subsetFont('<< /Differences [ 45 /space ] >>', false));
    const font = (await readFontCharcodes(bytes)).get(0)?.get('SampleFont');
    // A partial list would silently drop the characters it could not map from a
    // string FPDFText_SetCharcodes replaces wholesale.
    expect(encodeWithMap(font, '中文')).toBeNull();
    expect(encodeWithMap(font, 'a中')).toBeNull();
    expect(encodeWithMap(font, '')).toBeNull();
    expect(encodeWithMap(undefined, 'text')).toBeNull();
  });

  it('gives a CID font without /ToUnicode no map rather than a guessed one', async () => {
    const bytes = fontPdf(
      '<< /Type /Font /Subtype /Type0 /BaseFont /SampleCID /Encoding /Identity-H ' +
        '/DescendantFonts [7 0 R] >>',
    );
    const maps = await readFontCharcodes(bytes);
    expect(maps.get(0)?.get('SampleCID')).toBeUndefined();
  });

  it('treats an unreadable document as carrying no maps instead of throwing', async () => {
    const maps = await readFontCharcodes(new Uint8Array([1, 2, 3, 4]));
    expect(maps.size).toBe(0);
  });
});

describe('ToUnicode parsing', () => {
  it('reads bfchar, incremental bfrange and array bfrange', () => {
    const parsed = parseToUnicode(
      [
        '1 beginbfchar',
        '<01> <0041>',
        'endbfchar',
        '2 beginbfrange',
        '<10> <12> <0061>',
        '<20> <22> [<00C0> <00C1> <00C2>]',
        'endbfrange',
      ].join('\n'),
    );
    expect(parsed.get(0x01)).toBe('A');
    expect(parsed.get(0x10)).toBe('a');
    expect(parsed.get(0x11)).toBe('b');
    expect(parsed.get(0x12)).toBe('c');
    expect(parsed.get(0x20)).toBe('À');
    expect(parsed.get(0x22)).toBe('Â');
  });

  it('decodes UTF-16BE destinations', () => {
    const parsed = parseToUnicode('1 beginbfchar <07> <FB03> endbfchar');
    expect(parsed.get(0x07)).toBe('ﬃ');
  });
});

describe('glyph-name decoding', () => {
  it('reads standard PostScript names, uniXXXX names, and refuses the rest', () => {
    expect(glyphNameToUnicode('hyphen')).toBe(0x2d);
    expect(glyphNameToUnicode('space')).toBe(0x20);
    expect(glyphNameToUnicode('quoteright')).toBe(0x2019);
    expect(glyphNameToUnicode('ffi')).toBe(0xfb03);
    expect(glyphNameToUnicode('uni0398')).toBe(0x398);
    expect(glyphNameToUnicode('/bullet')).toBe(0x2022);
    expect(glyphNameToUnicode('A')).toBe(0x41);
    expect(glyphNameToUnicode('glyphthatisnotreal')).toBeUndefined();
  });
});
