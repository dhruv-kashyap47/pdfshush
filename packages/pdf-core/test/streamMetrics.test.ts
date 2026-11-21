import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { readFontMetrics } from '../src/index.js';

const TO_UNICODE = [
  '/CIDInit /ProcSet findresource begin',
  '12 dict begin begincmap',
  '1 begincodespacerange <0000> <FFFF> endcodespacerange',
  '2 beginbfchar',
  '<0041> <0041>',
  '<0042> <0042>',
  'endbfchar',
  'endcmap end end',
].join('\n');

function dict(doc: PDFDocument, value: Record<string, unknown>): PDFDict {
  const object = doc.context.obj(value as never);
  if (!(object instanceof PDFDict)) throw new Error('expected a dictionary');
  return object;
}

describe('stream font metrics (C-02)', () => {
  it('reads simple /FirstChar + /Widths and falls back to /MissingWidth', async () => {
    const doc = await PDFDocument.create();
    const font = dict(doc, {
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: 'CustomFace',
      FirstChar: 65,
      LastIndex: 66,
      Widths: [500, 600],
      MissingWidth: 250,
      Encoding: 'WinAnsiEncoding',
    });
    const metrics = readFontMetrics(font);
    expect(metrics.codeByteLength).toBe(1);
    expect(metrics.reliable).toBe(true);
    expect(metrics.widthFor(65)).toBe(500);
    expect(metrics.widthFor(66)).toBe(600);
    expect(metrics.widthFor(67)).toBe(250);
    expect(metrics.unicodeFor(65)).toBe('A');
  });

  it('uses the base-14 AFM table when a standard face declares no /Widths', async () => {
    const doc = await PDFDocument.create();
    const font = dict(doc, { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' });
    const metrics = readFontMetrics(font);
    expect(metrics.reliable).toBe(true);
    // Public Adobe AFM advance for Helvetica 'A'.
    expect(metrics.widthFor(65)).toBe(667);
    expect(metrics.widthFor(32)).toBe(278);
  });

  it('reads Type0 /W + /DW and decodes two-byte codes with /ToUnicode', async () => {
    const doc = await PDFDocument.create();
    const font = dict(doc, {
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'SubsetFace',
      Encoding: 'Identity-H',
      DescendantFonts: [
        {
          Type: 'Font',
          Subtype: 'CIDFontType2',
          BaseFont: 'SubsetFace',
          DW: 1000,
          W: [65, [600, 700]],
        },
      ],
    });
    font.set(PDFName.of('ToUnicode'), doc.context.register(doc.context.flateStream(TO_UNICODE)));

    const metrics = readFontMetrics(font);
    expect(metrics.codeByteLength).toBe(2);
    expect(metrics.reliable).toBe(true);
    expect(metrics.widthFor(0x41)).toBe(600);
    expect(metrics.widthFor(0x42)).toBe(700);
    expect(metrics.widthFor(0x43)).toBe(1000);
    const glyphs = metrics.decode(Uint8Array.of(0x00, 0x41, 0x00, 0x42));
    expect(glyphs.map((glyph) => glyph.unicode)).toEqual(['A', 'B']);
    expect(metrics.encode('AB')).toEqual(Uint8Array.of(0x00, 0x41, 0x00, 0x42));
  });

  it('flags a non-Identity CMap as unreliable instead of guessing', async () => {
    const doc = await PDFDocument.create();
    const font = dict(doc, {
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'CMapFace',
      Encoding: 'Custom-H',
      DescendantFonts: [{ Type: 'Font', Subtype: 'CIDFontType2', DW: 800, W: [] }],
    });
    const metrics = readFontMetrics(font);
    expect(metrics.reliable).toBe(false);
    expect(metrics.reason).toMatch(/non-Identity/i);
  });

  it('applies a Type3 /FontMatrix to its widths', async () => {
    const doc = await PDFDocument.create();
    const font = dict(doc, {
      Type: 'Font',
      Subtype: 'Type3',
      BaseFont: 'Type3Face',
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      FirstChar: 65,
      LastIndex: 65,
      Widths: [500],
    });
    const metrics = readFontMetrics(font);
    expect(metrics.subtype).toBe('Type3');
    expect(metrics.widthFor(65)).toBe(500);
  });

  it('reports a font with no width source instead of inventing advances', async () => {
    const doc = await PDFDocument.create();
    const font = dict(doc, {
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: 'MysteryFace',
    });
    const metrics = readFontMetrics(font);
    expect(metrics.reliable).toBe(false);
    expect(metrics.reason).toMatch(/width/i);
  });
});
