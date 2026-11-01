/**
 * Adversarial regression corpus for the text-edit engine.
 *
 * Every case here is a document shape that has bitten (or nearly bitten) a
 * PDF-rewriting engine in the past: subset fonts with non-standard encodings,
 * CID fonts, ligatures split across objects, rotated and cropped pages, opaque
 * content-stream string forms, and multi-font lines. The corpus pins the engine's
 * *documented* behaviour on each shape so a future change that silently widens or
 * narrows a capability is caught here rather than in production.
 *
 * These tests run the real PDFium WASM and verify with pdf.js -- the same reader
 * the product renders with -- because the whole point is that a write reported as
 * a success is not the same as words that survive a round-trip.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { PDFDocument, StandardFonts, rgb, degrees } from '@cantoo/pdf-lib';
import {
  configurePdfiumRuntime,
  configurePdfjsRuntime,
  loadPdfiumModule,
  editPdfText,
  extractTextRuns,
  applyContentStreamEdits,
  inspectDocumentCapabilities,
  readFontCharcodes,
  TextEditUnsafeError,
} from '../src/index.js';
import { testContext } from './fixtures.js';

function readPdfiumWasm(): Uint8Array {
  const proc = (globalThis as unknown as {
    process: { getBuiltinModule(name: string): unknown };
  }).process;
  const fs = proc.getBuiltinModule('node:fs') as {
    readFileSync(path: URL): Uint8Array;
  };
  return fs.readFileSync(
    new URL('../node_modules/@embedpdf/pdfium/dist/pdfium.wasm', import.meta.url),
  );
}

beforeAll(async () => {
  configurePdfiumRuntime({ wasmBinary: readPdfiumWasm() });
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
      .href,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  });
  await loadPdfiumModule();
});

/** Every run text on the page, joined for substring assertions. */
async function pageText(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const runs = await extractTextRuns(bytes, [pageIndex]);
  return runs[0]!.map((run) => run.text).join('\n');
}

/** Minimal hand-built PDF with an arbitrary page content stream (ASCII only). */
function build(content: string): Uint8Array {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R ' +
    '/Resources << /Font << /F1 5 0 R >> >> >>';
  objects[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  return assemble(objects);
}

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

const WIDTHS = Array.from({ length: 126 - 32 + 1 }, () => '600').join(' ');

/** A Type 1 subset font with a /Differences-only /Encoding (the shape TeX ships). */
function subsetFont(encoding: string, withToUnicode: boolean): string {
  return (
    '<< /Type /Font /Subtype /Type1 /BaseFont /AAAAAA+SampleFont ' +
    '/FirstChar 32 /LastChar 126 ' +
    `/Widths [${WIDTHS}] ` +
    (withToUnicode ? '/ToUnicode 6 0 R ' : '') +
    `/Encoding ${encoding} >>`
  );
}

const SAMPLE_TO_UNICODE =
  [
    'begincmap',
    '1 begincodespacerange',
    '<00> <FF>',
    'endcodespacerange',
    '3 beginbfchar',
    '<2D> <0020>',
    '<2E> <002D>',
    '<20> <0020>',
    'endbfchar',
    '2 beginbfrange',
    '<41> <5A> <0041>',
    '<61> <7A> <0061>',
    'endbfrange',
    'endcmap',
  ].join('\n') + '\n';

/**
 * One-page document drawing `content` with a subset font whose /Differences puts
 * space at 45 and hyphen at 46 (i.e. NOT at their ASCII positions). This is the
 * shape where PDFium's own Unicode re-encoding writes the wrong glyph but still
 * reports success, so the engine must use the document's own charcode map.
 */
function subsetPdf(content: string, withToUnicode: boolean): Uint8Array {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R ' +
    '/Resources << /Font << /F1 5 0 R >> >> >>';
  objects[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objects[5] = subsetFont('<< /Differences [ 45 /space 46 /hyphen ] >>', withToUnicode);
  if (withToUnicode) {
    objects[6] =
      `<< /Length ${SAMPLE_TO_UNICODE.length} >>\nstream\n${SAMPLE_TO_UNICODE}\nendstream`;
  }
  return assemble(objects);
}

/** A Type0/CID font with an /Identity-H encoding and an explicit /ToUnicode. */
function cidPdf(content: string, withToUnicode: boolean): Uint8Array {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R ' +
    '/Resources << /Font << /F1 5 0 R >> >> >>';
  objects[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objects[5] =
    '<< /Type /Font /Subtype /Type0 /BaseFont /SampleCID /Encoding /Identity-H ' +
    '/DescendantFonts [7 0 R]' +
    (withToUnicode ? ' /ToUnicode 8 0 R' : '') +
    ' >>';
  objects[7] =
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SampleCID ' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
    '/FontDescriptor 9 0 R /DW 600 /CIDToGIDMap /Identity >>';
  objects[9] =
    '<< /Type /FontDescriptor /FontName /SampleCID /Flags 32 /FontBBox [0 0 600 600] ' +
    '/ItalicAngle 0 /Ascent 600 /Descent 0 /CapHeight 600 /StemV 80 >>';
  if (withToUnicode) {
    const cmap =
      [
        'begincmap',
        '1 begincodespacerange',
        '<0000> <FFFF>',
        'endcodespacerange',
        '5 beginbfchar',
        '<0048> <0048>',
        '<0065> <0065>',
        '<006C> <006C>',
        '<006F> <006F>',
        '<0020> <0020>',
        'endbfchar',
        'endcmap',
      ].join('\n') + '\n';
    objects[8] = `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`;
  }
  return assemble(objects);
}

/** Encodes ASCII text as two-byte /Identity-H CIDs (identity here for the probe). */
function cidHex(text: string): string {
  return (
    '<' +
    [...text]
      .map((ch) => ch.charCodeAt(0).toString(16).padStart(4, '0'))
      .join('') +
    '>'
  );
}

function twoFontLine(): Uint8Array {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R ' +
    '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>';
  // One visual line, two fonts: "Invoice " in Helvetica, "number 42" in Courier.
  const content = 'BT /F1 18 Tf 72 700 Td (Invoice ) Tj /F2 18 Tf (number 42) Tj ET';
  objects[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[6] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>';
  return assemble(objects);
}

describe('subset fonts (non-standard /Encoding)', () => {
  it('rewrites a /Differences-only run in place using the document charcode map', async () => {
    // Space lives at 45, not 32. A rewrite through PDFium's Unicode path would
    // write 32 and render a different glyph while reporting success, so the
    // engine must go through the /Encoding-derived map and survive re-extraction.
    const source = subsetPdf('BT /F1 12 Tf 72 700 Td (Hello World) Tj ET', false);
    const result = await editPdfText(
      source,
      { edits: [{ id: 's1', pageIndex: 0, find: 'Hello World', replace: 'Goodbye there' }] },
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('in-place');
    const text = await pageText(result.bytes, 0);
    expect(text).toContain('Goodbye there');
    expect(text).not.toContain('Hello World');
  });

  it('round-trips a subset font with a /ToUnicode the same way', async () => {
    const source = subsetPdf('BT /F1 12 Tf 72 700 Td (Hello World) Tj ET', true);
    const result = await editPdfText(
      source,
      { edits: [{ id: 's2', pageIndex: 0, find: 'Hello World', replace: 'Hello Werld' }] },
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('in-place');
    expect(await pageText(result.bytes, 0)).toContain('Hello Werld');
  });

  it('refuses a replacement the subset font cannot encode rather than writing filler', async () => {
    // CJK glyphs are absent from the subset; encodeWithMap must refuse the whole
    // run so the engine demotes honestly instead of silently dropping characters.
    const source = subsetPdf('BT /F1 12 Tf 72 700 Td (Hello World) Tj ET', false);
    await expect(
      editPdfText(
        source,
        { edits: [{ id: 's3', pageIndex: 0, find: 'Hello World', replace: 'Hello 中文' }] },
        testContext(),
      ),
    ).rejects.toBeInstanceOf(TextEditUnsafeError);
  });
});

describe('CID / Type0 fonts', () => {
  it('rewrites a CID run that carries a /ToUnicode in place', async () => {
    const source = cidPdf(`BT /F1 12 Tf 1 0 0 1 72 700 Tm ${cidHex('Hello')} Tj ET`, true);
    const result = await editPdfText(
      source,
      { edits: [{ id: 'c1', pageIndex: 0, find: 'Hello', replace: 'Helo' }] },
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('in-place');
    expect(await pageText(result.bytes, 0)).toContain('Helo');
  });

  it('demotes a CID run with no /ToUnicode instead of guessing an encoding', async () => {
    // Without /ToUnicode the engine has no honest map. It must not fabricate one;
    // with no fallback supplied the edit is refused loudly (fail-closed).
    const source = cidPdf(`BT /F1 12 Tf 1 0 0 1 72 700 Tm ${cidHex('Hello')} Tj ET`, false);
    await expect(
      editPdfText(
        source,
        { edits: [{ id: 'c2', pageIndex: 0, find: 'Hello', replace: 'Helo' }] },
        testContext(),
      ),
    ).rejects.toBeInstanceOf(TextEditUnsafeError);
  });
});

describe('geometry: rotation, crop box, degenerate sizes', () => {
  it('edits a rotated page in place (the box is display-space, the object is not)', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('Rotate Me', { x: 40, y: 240, size: 18, font, color: rgb(0, 0, 0) });
    page.setRotation(degrees(90));
    const source = await doc.save({ useObjectStreams: false });
    const result = await editPdfText(
      source,
      { edits: [{ id: 'r1', pageIndex: 0, find: 'Rotate Me', replace: 'Rotated Yes' }] },
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('in-place');
    expect(await pageText(result.bytes, 0)).toContain('Rotated Yes');
  });

  it('edits text that sits inside a CropBox smaller than the MediaBox', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    page.drawText('Cropped Text', { x: 40, y: 400, size: 16, font, color: rgb(0, 0, 0) });
    page.setCropBox(20, 360, 300, 120);
    const source = await doc.save({ useObjectStreams: false });
    const result = await editPdfText(
      source,
      { edits: [{ id: 'cb1', pageIndex: 0, find: 'Cropped Text', replace: 'Crop Done' }] },
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('in-place');
    expect(await pageText(result.bytes, 0)).toContain('Crop Done');
  });
});

describe('opaque content-stream string forms', () => {
  // The content-stream strategy matches the literal bytes of a show operator. A
  // string written with escapes, octal or hex does not contain the plain text, so
  // that strategy refuses (fail-closed). The full engine ladder still handles the
  // edit natively, because PDFium decodes the string before the object is matched.
  const CASES: Array<{ label: string; tj: string; find: string }> = [
    { label: 'escaped parens', tj: String.raw`(\(Secret\) info)`, find: '(Secret) info' },
    { label: 'octal escapes', tj: String.raw`(\123\145\143\162\145\164)`, find: 'Secret' },
    { label: 'hex string', tj: '<536563726574>', find: 'Secret' },
  ];

  for (const { label, tj, find } of CASES) {
    it(`refuses ${label} via content-stream but edits it natively`, async () => {
      const source = build(`BT /F1 12 Tf 72 700 Td ${tj} Tj ET`);
      const fonts = await readFontCharcodes(source);
      const stream = await applyContentStreamEdits(
        source,
        [{ id: 'cs', pageIndex: 0, find, replace: 'REDACTED' }],
        fonts,
        testContext(),
      );
      expect(stream.outcomes[0]!.mode).toBe('manual-review');

      const full = await editPdfText(
        source,
        { edits: [{ id: 'native', pageIndex: 0, find, replace: 'REDACTED' }] },
        testContext(),
      );
      expect(full.outcomes[0]!.mode).toBe('in-place');
      expect(await pageText(full.bytes, 0)).toContain('REDACTED');
    });
  }
});

describe('multi-font lines', () => {
  it('collapses a two-font line into a single in-place rewrite and consumes the dropped font', async () => {
    const source = twoFontLine();
    const find = (await extractTextRuns(source, [0]))[0]!.map((r) => r.text).join('');
    expect(find).toContain('Invoice');

    const result = await editPdfText(
      source,
      { edits: [{ id: 'm1', pageIndex: 0, find, replace: 'Invoice paid' }] },
      testContext(),
    );
    // The whole run is rewritten through the first member's font; the Courier tail
    // object is removed, so Courier is legitimately gone from the page afterwards.
    expect(result.outcomes[0]!.mode).toBe('in-place');
    const text = await pageText(result.bytes, 0);
    expect(text).toContain('Invoice paid');
    expect(text).not.toContain('number 42');

    const caps = inspectDocumentCapabilities(result.bytes, {
      module: await loadPdfiumModule(),
      pageIndexes: [0],
    });
    const families = new Set(
      caps.pages[0]!.textObjects
        .map((object) => object.font?.baseName.replace(/^[A-Z]{6}\+/, ''))
        .filter((name): name is string => Boolean(name)),
    );
    // Helvetica survives (the rewrite used it); Courier was consumed by the edit.
    expect(families.has('Helvetica')).toBe(true);
    expect(families.has('Courier')).toBe(false);
  });
});

describe('deletion in place', () => {
  it('removes the only run on a page, consuming its font entirely', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('Sensitive', { x: 40, y: 240, size: 18, font, color: rgb(0, 0, 0) });
    const source = await doc.save({ useObjectStreams: false });

    const result = await editPdfText(
      source,
      { edits: [{ id: 'd1', pageIndex: 0, find: 'Sensitive', replace: '' }] },
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('in-place');
    expect(await pageText(result.bytes, 0)).not.toContain('Sensitive');

    // The page legitimately has no text (and therefore no font) left. That must
    // not be treated as a lost font resource.
    const caps = inspectDocumentCapabilities(result.bytes, {
      module: await loadPdfiumModule(),
      pageIndexes: [0],
    });
    expect(caps.pages[0]!.textObjects.every((object) => !object.text.includes('Sensitive'))).toBe(
      true,
    );
  });
});
