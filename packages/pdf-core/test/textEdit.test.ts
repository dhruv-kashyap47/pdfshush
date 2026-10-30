/**
 * In-place text editing.
 *
 * These tests run the real PDFium WASM (not a mock): the point of the engine is
 * that it mutates the document's own text objects, so a mock would prove
 * nothing. Verification is the product's own reader (pdf.js), which is also how
 * the engine decides whether a native write survived.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import {
  TextEditUnsafeError,
  applyNativeTextEdits,
  configurePdfiumRuntime,
  configurePdfjsRuntime,
  editPdfText,
  extractTextRuns,
  loadPdfiumModule,
  verifyTextEdits,
  type EditorObject,
  type TextEdit,
} from '../src/index.js';
import { sameText } from '../src/textedit/engine.js';
import { testContext } from './fixtures.js';
import { pdfContainsText } from './helpers.js';

/** Reads the WASM bytes without importing `node:*` types (pdf-core has none). */
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

/** Two text objects on page 1 and one on page 2. */
async function makeTextFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page1 = doc.addPage([400, 300]);
  page1.drawText('Hello World', { x: 40, y: 240, size: 24, font, color: rgb(0, 0, 0) });
  page1.drawText('KEEP THIS LINE', { x: 40, y: 180, size: 14, font, color: rgb(0, 0, 0) });
  const page2 = doc.addPage([400, 300]);
  page2.drawText('Page Two Text', { x: 40, y: 240, size: 18, font, color: rgb(0, 0, 0) });
  return doc.save({ useObjectStreams: false });
}

/** Every run text on the page, joined for substring assertions. */
async function pageText(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const runs = await extractTextRuns(bytes, [pageIndex]);
  return runs[0]!.map((run) => run.text).join('\n');
}

/** A whiteout + replacement text box in display space, for fallback tests. */
function fallbackOverlay(
  pageIndex: number,
  box: { x: number; y: number; width: number; height: number },
  text: string,
): EditorObject[] {
  return [
    { id: 'fb-cover', kind: 'whiteout', pageIndex, ...box },
    {
      id: 'fb-text',
      kind: 'text',
      pageIndex,
      ...box,
      text,
      fontSize: 12,
      fontFamily: 'helvetica',
    },
  ];
}

describe('in-place text editing', () => {
  it('rewrites an existing run through PDFium without a whiteout', async () => {
    const source = await makeTextFixture();
    const edit: TextEdit = { id: 'e1', pageIndex: 0, find: 'Hello World', replace: 'Jello Wurld' };

    const result = await editPdfText(source, { edits: [edit] }, testContext());

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]!.mode).toBe('in-place');
    expect(result.inPlace).toBe(1);
    expect(result.fallback).toBe(0);
    expect(result.usedNativeEngine).toBe(true);

    const text = await pageText(result.bytes, 0);
    expect(text).toContain('Jello Wurld');
    expect(text).not.toContain('Hello World');
    // The unrelated run is untouched.
    expect(text).toContain('KEEP THIS LINE');
    // The replacement must be real content, not an overlay-only claim.
    expect(pdfContainsText(result.bytes, 'Jello')).toBe(true);
  });

  it('leaves other pages untouched', async () => {
    const source = await makeTextFixture();
    const result = await editPdfText(
      source,
      { edits: [{ id: 'e1', pageIndex: 0, find: 'Hello World', replace: 'Changed' }] },
      testContext(),
    );
    expect(result.pageCount).toBe(2);
    expect(await pageText(result.bytes, 1)).toContain('Page Two Text');
  });

  it('deletes a run in place (never covers it cosmetically)', async () => {
    const source = await makeTextFixture();
    const result = await editPdfText(
      source,
      { edits: [{ id: 'del', pageIndex: 0, find: 'KEEP THIS LINE', replace: '' }] },
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('in-place');
    const text = await pageText(result.bytes, 0);
    expect(text).not.toContain('KEEP THIS LINE');
    expect(text).toContain('Hello World');
    // No overlay objects were written.
    expect(pdfContainsText(result.bytes, 'KEEP')).toBe(false);
  });

  it('does not confuse two identical runs on one page when a box disambiguates', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('DUP', { x: 40, y: 240, size: 18, font, color: rgb(0, 0, 0) });
    page.drawText('DUP', { x: 40, y: 180, size: 18, font, color: rgb(0, 0, 0) });
    const source = await doc.save({ useObjectStreams: false });

    const result = await editPdfText(
      source,
      {
        edits: [
          {
            id: 'lower',
            pageIndex: 0,
            find: 'DUP',
            replace: 'SECOND',
            // Display space: the lower run is the one with the larger y.
            box: { x: 40, y: 114, width: 60, height: 20 },
          },
        ],
      },
      testContext(),
    );

    expect(result.outcomes[0]!.mode).toBe('in-place');
    const text = await pageText(result.bytes, 0);
    expect(text).toContain('DUP');
    expect(text).toContain('SECOND');
  });
});

describe('fallback honesty', () => {
  it('falls back to the overlay when no text object matches, and says so', async () => {
    const source = await makeTextFixture();
    const box = { x: 40, y: 60, width: 120, height: 20 };
    const result = await editPdfText(
      source,
      {
        edits: [
          {
            id: 'fb',
            pageIndex: 0,
            find: 'Text that does not exist',
            replace: 'OVERLAY TEXT',
            box,
            fallback: fallbackOverlay(0, box, 'OVERLAY TEXT'),
          },
        ],
      },
      testContext(),
    );

    expect(result.outcomes[0]!.mode).toBe('fallback');
    expect(result.outcomes[0]!.reason).toMatch(/no text object/i);
    expect(result.inPlace).toBe(0);
    expect(result.fallback).toBe(1);
    // The overlay text is genuinely extractable.
    expect(await pageText(result.bytes, 0)).toContain('OVERLAY TEXT');
    // The original content is still there — this was an overlay, not a rewrite.
    expect(await pageText(result.bytes, 0)).toContain('Hello World');
  });

  it('refuses an edit that cannot be resolved and has no fallback', async () => {
    const source = await makeTextFixture();
    await expect(
      editPdfText(
        source,
        { edits: [{ id: 'x', pageIndex: 0, find: 'Not present', replace: 'nope' }] },
        testContext(),
      ),
    ).rejects.toBeInstanceOf(TextEditUnsafeError);
  });

  it('refuses to cosmetically cover a deletion it cannot perform in place', async () => {
    const source = await makeTextFixture();
    const box = { x: 40, y: 60, width: 120, height: 20 };
    await expect(
      editPdfText(
        source,
        {
          edits: [
            {
              id: 'del',
              pageIndex: 0,
              find: 'Not present',
              replace: '',
              box,
              fallback: fallbackOverlay(0, box, ''),
            },
          ],
        },
        testContext(),
      ),
    ).rejects.toBeInstanceOf(TextEditUnsafeError);
  });
});

describe('box-only erase matching', () => {
  it('removes a run by geometry when no text comparison can anchor it', async () => {
    const source = await makeTextFixture();
    // `find` is deliberately a string no concatenation of the page's objects
    // can ever equal — the shape of a run whose glyphs the document decodes
    // differently than the editor's extractor reads them — so the only way to
    // locate the selection is its own box. The box wraps Hello World in the
    // fixture's display space (400x300 page, text drawn at PDF y = 240).
    const result = await editPdfText(
      source,
      {
        edits: [
          {
            id: 'geo',
            pageIndex: 0,
            find: 'unmatchable glyph-stream',
            replace: '',
            box: { x: 32, y: 34, width: 180, height: 34 },
          },
        ],
      },
      testContext(),
    );

    expect(result.outcomes[0]!.mode).toBe('in-place');
    const text = await pageText(result.bytes, 0);
    // The run is genuinely gone from the content stream, not covered.
    expect(text).not.toContain('Hello World');
    expect(pdfContainsText(result.bytes, 'Hello')).toBe(false);
    // The unrelated run below it survives the sweep.
    expect(text).toContain('KEEP THIS LINE');
  });

  it('never removes a neighbouring line whose centre falls outside the box band', async () => {
    const source = await makeTextFixture();
    // Two stacked runs, one tight selection: the box wraps Hello World, and
    // KEEP THIS LINE sits just below it — close enough that a loose tolerance
    // would reach across. The band's margins must keep the neighbour.
    const result = await editPdfText(
      source,
      {
        edits: [
          {
            id: 'geo-guard',
            pageIndex: 0,
            find: 'whatever the extractor could not anchor',
            replace: '',
            box: { x: 32, y: 36, width: 200, height: 22 },
          },
        ],
      },
      testContext(),
    );

    const text = await pageText(result.bytes, 0);
    expect(text).toContain('KEEP THIS LINE');
  });

  it('refuses a deletion with no text anchor and no box geometry', async () => {
    const source = await makeTextFixture();
    await expect(
      editPdfText(
        source,
        { edits: [{ id: 'del-no-box', pageIndex: 0, find: 'Not present', replace: '' }] },
        testContext(),
      ),
    ).rejects.toBeInstanceOf(TextEditUnsafeError);
  });
});

describe('overlay-only documents', () => {
  it('applies extra objects without touching PDFium when there are no edits', async () => {
    const source = await makeTextFixture();
    const box = { x: 40, y: 60, width: 160, height: 24 };
    const result = await editPdfText(
      source,
      { edits: [], objects: fallbackOverlay(0, box, 'BRAND NEW') },
      testContext(),
    );
    expect(result.usedNativeEngine).toBe(false);
    expect(result.outcomes).toHaveLength(0);
    expect(await pageText(result.bytes, 0)).toContain('BRAND NEW');
    // Existing content is preserved.
    expect(await pageText(result.bytes, 0)).toContain('Hello World');
  });
});

describe('low-level native pass', () => {
  it('reports an in-place outcome and serializes a reopenable document', async () => {
    const source = await makeTextFixture();
    const module = await loadPdfiumModule();
    const native = applyNativeTextEdits(
      module,
      source,
      [{ id: 'n1', pageIndex: 0, find: 'Hello World', replace: 'NATIVE' }],
      testContext(),
    );
    expect(native.outcomes[0]!.mode).toBe('in-place');
    expect(native.pageCount).toBe(2);
    expect(await pageText(native.bytes, 0)).toContain('NATIVE');
  });
});

describe('validation', () => {
  it('rejects duplicate edit ids before doing any work', async () => {
    const source = await makeTextFixture();
    await expect(
      editPdfText(
        source,
        {
          edits: [
            { id: 'dup', pageIndex: 0, find: 'Hello World', replace: 'A' },
            { id: 'dup', pageIndex: 0, find: 'KEEP THIS LINE', replace: 'B' },
          ],
        },
        testContext(),
      ),
    ).rejects.toBeInstanceOf(TextEditUnsafeError);
  });

  it('rejects an out-of-range page', async () => {
    const source = await makeTextFixture();
    await expect(
      editPdfText(
        source,
        { edits: [{ id: 'p', pageIndex: 9, find: 'Hello World', replace: 'A' }] },
        testContext(),
      ),
    ).rejects.toBeInstanceOf(TextEditUnsafeError);
  });
});

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
 * One visual line can be many objects in the file -- a TJ array, a Td shift, a
 * font change mid-sentence. pdf.js clusters those into the single run the user
 * clicked, so every shape here must reach PDFium as one in-place edit rather
 * than an overlay.
 */
describe('lines written as several objects', () => {
  const CASES: Record<string, string> = {
    'one Tj per word': 'BT /F1 18 Tf 72 700 Td (Hello) Tj (World) Tj ET',
    'TJ array, kerned': 'BT /F1 18 Tf 72 700 Td [(Hello) -120 (World)] TJ ET',
    'TJ array, wide gap': 'BT /F1 18 Tf 72 700 Td [(Hello) 400 (World)] TJ ET',
    'two Tm positions':
      'BT /F1 18 Tf 1 0 0 1 72 700 Tm (Hello) Tj ET BT /F1 18 Tf 1 0 0 1 119 700 Tm (World) Tj ET',
    'Td inside one BT': 'BT /F1 18 Tf 72 700 Td (Hello) Tj 50 0 Td (World) Tj ET',
    'single Tj': 'BT /F1 18 Tf 72 700 Td (Hello World) Tj ET',
    'bold word inside line': 'BT /F1 18 Tf 72 700 Td (Invoice ) Tj /F1 10 Tf 12 TL (42) Tj ET',
    'trailing space own object': 'BT /F1 18 Tf 72 700 Td (Hello ) Tj (World) Tj ET',
    'ligature split': 'BT /F1 18 Tf 72 700 Td (Eff) Tj (icient) Tj ET',
    'many words': 'BT /F1 18 Tf 72 700 Td (Invoice) Tj ( number) Tj ( 42) Tj ET',
  };

  for (const [label, content] of Object.entries(CASES)) {
    it(`edits ${label} in place`, async () => {
      const source = build(content);
      const find = (await extractTextRuns(source, [0]))[0]![0]!.text;
      const result = await editPdfText(
        source,
        { edits: [{ id: 'e', pageIndex: 0, find, replace: 'REPLACED' }] },
        testContext(),
      );
      expect(result.outcomes[0]!.mode).toBe('in-place');
      expect(await pageText(result.bytes, 0)).toContain('REPLACED');
    });
  }
});

/**
 * PDFium hands back U+0002 for the trailing hyphen of a LaTeX line whose
 * content stream writes that character at charcode 45, which the font's own
 * `/Encoding` calls `/hyphen`, `/ToUnicode` maps to U+002D, and every reader
 * displays as `-`. Nothing in the document explains the 0x02, so matching
 * tolerates a control code in object text -- but only there, and only when
 * everything else lines up.
 */
describe('glyphs PDFium could not decode', () => {
  it('lets a control code stand in for the character the reader sees', () => {
    expect(sameText('occupying a unique posi\u0002', 'occupying a unique posi-')).toBe(true);
    expect(sameText('The fun\u0002 part', 'The fun- part')).toBe(true);
  });

  it('still refuses text that differs anywhere else', () => {
    expect(sameText('a different line entirely\u0002', 'occupying a unique posi-')).toBe(false);
    expect(sameText('occupying a unique posi\u0002x', 'occupying a unique posi-')).toBe(false);
    expect(sameText('occupying a uniqu\u0002', 'occupying a unique posi-')).toBe(false);
    // Printable characters are never waived, only control codes.
    expect(sameText('occupying a unique posi', 'occupying a unique posi-')).toBe(false);
    expect(sameText('occupying a unique posi-', 'occupying a unique posi-')).toBe(true);
  });
});

describe('text-edit verification', () => {
  it('fails the page-count check when the output lost a page', async () => {
    // The check has to read the count back from the exported bytes. Echoing the
    // caller's `expectedPageCount` back at itself would make it unfailable.
    const bytes = await makeTextFixture(); // two pages
    const result = await verifyTextEdits(bytes, { expectedPageCount: 1, expectations: [] });
    const pageCount = result.checks.find((check) => check.name === 'page-count');
    expect(pageCount?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });
});
