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
import { createCanvas } from '@napi-rs/canvas';
import {
  TextEditUnsafeError,
  applyNativeTextEdits,
  configurePdfiumRuntime,
  configurePdfjsRuntime,
  editPdfText,
  extractPageLayouts,
  extractTextRuns,
  applyContentStreamEdits,
  analyzeEditCapability,
  inspectDocumentCapabilities,
  readFontCharcodes,
  loadPdfiumModule,
  verifyTextEdits,
  verifyExportArtifact,
  type EditorObject,
  type TextEdit,
  type CanvasFactory,
} from '../src/index.js';
import { sameText } from '../src/textedit/engine.js';
import { testContext } from './fixtures.js';
import { pdfContainsText } from './helpers.js';
import { encodePng } from './png.js';

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

  it('applies form values even when the text edit succeeds natively', async () => {
    // The overlay pass used to run only when an overlay object existed, so this
    // combination silently saved the rewritten text and dropped the form value.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('Hello World', { x: 40, y: 240, size: 18, font, color: rgb(0, 0, 0) });
    const field = doc.getForm().createTextField('person.name');
    field.setText('Ada Lovelace');
    field.addToPage(page, { x: 40, y: 120, width: 160, height: 20 });
    const source = await doc.save({ useObjectStreams: false });

    const result = await editPdfText(
      source,
      {
        edits: [{ id: 'e1', pageIndex: 0, find: 'Hello World', replace: 'Jello Wurld' }],
        formValues: { 'person.name': 'Grace Hopper' },
      },
      testContext(),
    );

    expect(result.outcomes[0]!.mode).toBe('in-place');
    expect(await pageText(result.bytes, 0)).toContain('Jello Wurld');
    const reloaded = await PDFDocument.load(result.bytes);
    expect(reloaded.getForm().getTextField('person.name').getText()).toBe('Grace Hopper');
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

async function makeReflowFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText(
    'Reflow this paragraph starts here and keeps going across the page before the second',
    { x: 72, y: 700, size: 12, font },
  );
  page.drawText('and continues on the second line', { x: 72, y: 686, size: 12, font });
  page.drawText('KEEP THIS NEIGHBOUR', { x: 72, y: 620, size: 12, font });
  return doc.save({ useObjectStreams: false });
}

async function layoutEditFor(
  source: Uint8Array,
  replace: string,
  needle = 'Reflow',
): Promise<{ edit: TextEdit; paragraphText: string }> {
  const layouts = await extractPageLayouts(source, { pageIndexes: [0] });
  const page = layouts[0]!;
  const paragraph = page.paragraphs.find((entry) => entry.text.includes(needle))!;
  const lines = paragraph.lineIds
    .map((id) => page.lines.find((line) => line.id === id)!)
    .filter(Boolean);
  const first = lines[0]!;
  const width = Math.max(...lines.map((line) => line.bbox.width)) + 40;
  const edit: TextEdit = {
    id: 'reflow-1',
    pageIndex: 0,
    find: paragraph.text,
    replace,
    box: paragraph.bbox,
    layout: {
      paragraphId: paragraph.id,
      fontFamily: 'helvetica',
      beforeLines: lines.map((line) => ({ text: line.text, box: line.bbox })),
      reflow: {
        width,
        lineHeight: first.typography.fontSize * 1.25,
        firstBaselineY: first.bbox.y + first.typography.fontSize * 0.82,
        x: paragraph.bbox.x,
      },
    },
  };
  return { edit, paragraphText: paragraph.text };
}

describe('native multi-line reflow', () => {
  it('wraps a longer paragraph using the original font and creates extra lines', async () => {
    const source = await makeReflowFixture();
    // The editor inspects capabilities before the save; make sure that read pass
    // does not invalidate the font pointers used by native line creation.
    inspectDocumentCapabilities(source, { module: await loadPdfiumModule() });
    const replacement =
      'Reflow this paragraph starts here and continues on the second line with enough extra words to require a third and fourth line while the neighbour stays untouched.';
    const { edit } = await layoutEditFor(source, replacement);
    const result = await editPdfText(source, { edits: [edit] }, testContext());

    expect(result.outcomes[0]!.mode).toBe('in-place');
    expect(result.inPlace).toBe(1);
    const text = await pageText(result.bytes, 0);
    expect(text).toContain('enough extra words');
    expect(text).toContain('KEEP THIS NEIGHBOUR');
    const runs = await extractTextRuns(result.bytes, [0]);
    expect(runs[0]!.filter((run) => run.y < 200).length).toBeGreaterThanOrEqual(3);
  });

  it('removes extra original lines when the paragraph becomes shorter', async () => {
    const source = await makeReflowFixture();
    const { edit } = await layoutEditFor(source, 'Short.');
    const result = await editPdfText(source, { edits: [edit] }, testContext());
    expect(result.outcomes[0]!.mode).toBe('in-place');
    const text = await pageText(result.bytes, 0);
    expect(text).toContain('Short.');
    expect(text).not.toContain('and continues');
    expect(text).toContain('KEEP THIS NEIGHBOUR');
  });

  it('refuses a reflow that would leave the page instead of clipping it', async () => {
    const source = await makeReflowFixture();
    const { edit } = await layoutEditFor(
      source,
      `${'overflow '.repeat(120)}end`,
    );
    edit.layout!.reflow.width = 120;
    edit.layout!.reflow.lineHeight = 18;
    await expect(
      editPdfText(source, { edits: [edit] }, testContext()),
    ).rejects.toThrow(/Refusing to export|layout edit|reflow/i);
  });

  it('keeps an invisible OCR layer invisible when its text is rewritten', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('ocr source line with enough width to anchor', {
      x: 30,
      y: 240,
      size: 10,
      font,
      renderMode: 3,
    } as Parameters<typeof page.drawText>[1]);
    const source = await doc.save({ useObjectStreams: false });
    const { edit } = await layoutEditFor(source, 'ocr source line rewritten', 'ocr');
    const result = await editPdfText(source, { edits: [edit] }, testContext());
    expect(result.outcomes[0]!.mode).toBe('in-place');
    const caps = inspectDocumentCapabilities(result.bytes, { module: await loadPdfiumModule() });
    expect(caps.pages[0]!.textLayer).toBe('ocr');
    expect(caps.pages[0]!.textObjects.every((object) => object.renderMode === 3)).toBe(true);
    expect(caps.pages[0]!.textObjects.map((object) => object.text).join(' ')).toContain('rewritten');
  });
});

describe('content-stream replacement', () => {
  it('rewrites a show operator when native matching is bypassed', async () => {
    const source = await makeTextFixture();
    const fonts = await readFontCharcodes(source);
    const result = await applyContentStreamEdits(
      source,
      [
        {
          id: 'stream-1',
          pageIndex: 0,
          find: 'Hello World',
          replace: 'Jello Wurld',
          box: { x: 40, y: 40, width: 300, height: 40 },
        },
      ],
      fonts,
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('content-stream');
    const text = await pageText(result.bytes, 0);
    expect(text).toContain('Jello Wurld');
    expect(text).toContain('KEEP THIS LINE');
    expect(text).not.toContain('Hello World');
  });

  it('refuses an ambiguous replacement instead of changing the wrong line', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('SAME TEXT', { x: 40, y: 240, size: 14, font });
    page.drawText('SAME TEXT', { x: 40, y: 200, size: 14, font });
    const source = await doc.save({ useObjectStreams: false });
    const fonts = await readFontCharcodes(source);
    const result = await applyContentStreamEdits(
      source,
      [{ id: 'ambiguous', pageIndex: 0, find: 'SAME TEXT', replace: 'CHANGED' }],
      fonts,
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('manual-review');
    expect(result.applied).toBe(0);
    expect(await pageText(result.bytes, 0)).toContain('SAME TEXT');
  });

  it('is used by the engine when the requested strategy is content-stream', async () => {
    const source = await makeTextFixture();
    const result = await editPdfText(
      source,
      {
        edits: [
          {
            id: 'stream-engine',
            pageIndex: 0,
            find: 'Hello World',
            replace: 'Stream Edit',
            box: { x: 40, y: 30, width: 260, height: 40 },
            strategy: 'content-stream',
          },
        ],
      },
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('content-stream');
    expect(result.contentStream).toBe(1);
    expect(result.inPlace).toBe(0);
    const text = await pageText(result.bytes, 0);
    expect(text).toContain('Stream Edit');
    expect(text).not.toContain('Hello World');
  });

  it('keeps both replacements and the bytes between them when two edits target one page', async () => {
    const source = await makeTextFixture();
    const fonts = await readFontCharcodes(source);
    const result = await applyContentStreamEdits(
      source,
      [
        { id: 'a', pageIndex: 0, find: 'Hello World', replace: 'First' },
        { id: 'b', pageIndex: 0, find: 'KEEP THIS LINE', replace: 'Second' },
      ],
      fonts,
      testContext(),
    );
    expect(result.outcomes.filter((outcome) => outcome.mode === 'content-stream')).toHaveLength(2);
    const text = await pageText(result.bytes, 0);
    expect(text).toContain('First');
    expect(text).toContain('Second');
  });
});

describe('export verification', () => {
  const canvasFactory: CanvasFactory = (width, height) => {
    const canvas = createCanvas(width, height);
    return {
      width,
      height,
      get context() {
        return canvas.getContext('2d');
      },
      async toBlob(type: string): Promise<Blob> {
        return new Blob([canvas.toBuffer('image/png')], { type });
      },
      release() {
        canvas.width = 0;
        canvas.height = 0;
      },
    };
  };

  it('checks structure, font resources and text expectations', async () => {
    const source = await makeTextFixture();
    const result = await editPdfText(
      source,
      {
        edits: [{ id: 'e1', pageIndex: 0, find: 'Hello World', replace: 'Verified Text' }],
        verifyVisual: false,
      },
      testContext(),
    );
    const verification = await verifyExportArtifact({
      original: source,
      output: result.bytes,
      expectedPageCount: 2,
      expectations: [{ label: 'e1', pageIndex: 0, expect: 'Verified Text' }],
      editedRegions: [{ pageIndex: 0, box: { x: 40, y: 30, width: 220, height: 40 } }],
      visual: false,
    });
    expect(verification.ok).toBe(true);
    expect(verification.checks.find((check) => check.name === 'font-resources')?.ok).toBe(true);
    expect(verification.checks.find((check) => check.name === 'page-geometry')?.ok).toBe(true);
    expect(verification.checks.find((check) => check.name === 'annotations-and-links')?.ok).toBe(
      true,
    );
  });

  it('fails page geometry when the output was resized', async () => {
    const source = await makeTextFixture();
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const resized = await doc.save();
    const verification = await verifyExportArtifact({
      original: source,
      output: resized,
      expectedPageCount: 1,
      expectations: [],
      visual: false,
    });
    expect(verification.checks.find((check) => check.name === 'page-geometry')?.ok).toBe(false);
    expect(verification.ok).toBe(false);
  });

  it('detects a rendered change outside the declared edit region', async () => {
    const source = await makeTextFixture();
    const doc = await PDFDocument.load(source);
    const first = doc.getPage(0);
    first.drawRectangle({
      x: 20,
      y: 20,
      width: 200,
      height: 40,
      color: rgb(1, 0, 0),
    });
    const changed = new Uint8Array(await doc.save());
    const verification = await verifyExportArtifact({
      original: source,
      output: changed,
      expectedPageCount: 2,
      expectations: [],
      editedRegions: [{ pageIndex: 0, box: { x: 40, y: 30, width: 220, height: 40 } }],
      canvasFactory,
      renderWidthPx: 500,
      visual: true,
    });
    const visual = verification.checks.find((check) => check.name === 'visual-unchanged:page-1');
    expect(visual?.ok).toBe(false);
    expect(verification.ok).toBe(false);
  });

  it('passes the visual check when only the declared edit region changes', async () => {
    const source = await makeTextFixture();
    const result = await editPdfText(
      source,
      {
        edits: [{ id: 'e1', pageIndex: 0, find: 'Hello World', replace: 'Visual Text' }],
        verifyVisual: false,
      },
      testContext(),
    );
    const verification = await verifyExportArtifact({
      original: source,
      output: result.bytes,
      expectedPageCount: 2,
      expectations: [{ label: 'e1', pageIndex: 0, expect: 'Visual Text' }],
      editedRegions: [{ pageIndex: 0, box: { x: 40, y: 30, width: 300, height: 60 } }],
      canvasFactory,
      renderWidthPx: 500,
      visual: true,
    });
    expect(verification.checks.find((check) => check.name === 'visual-unchanged:page-1')?.ok).toBe(
      true,
    );
    expect(verification.ok).toBe(true);
  });
});

describe('capability inspection', () => {
  it('distinguishes native text, invisible OCR layers and image-only scans', async () => {
    const module = await loadPdfiumModule();
    const native = await makeTextFixture();
    const nativeCaps = inspectDocumentCapabilities(native, { module, pageIndexes: [0] });
    const nativePage = nativeCaps.pages[0]!;
    expect(nativePage.textLayer).toBe('native');
    expect(nativePage.likelyScanned).toBe(false);
    expect(nativePage.textObjects.some((object) => object.text.includes('Hello'))).toBe(true);
    expect(nativePage.fonts.length).toBeGreaterThan(0);

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const ocrPage = doc.addPage([400, 300]);
    ocrPage.drawText('OCR TEXT', {
      x: 40,
      y: 240,
      size: 14,
      font,
      renderMode: 3,
    } as Parameters<typeof ocrPage.drawText>[1]);
    const image = await doc.embedPng(encodePng(40, 40, []));
    const scannedPage = doc.addPage([400, 300]);
    scannedPage.drawImage(image, { x: 40, y: 100, width: 200, height: 200 });
    const source = await doc.save({ useObjectStreams: false });
    const caps = inspectDocumentCapabilities(source, { module });
    expect(caps.pages[0]!.textLayer).toBe('ocr');
    expect(caps.pages[0]!.textObjects[0]!.renderMode).toBe(3);
    expect(caps.pages[1]!.textLayer).toBe('none');
    expect(caps.pages[1]!.likelyScanned).toBe(true);
    expect(caps.warnings.some((warning) => warning.includes('image-only'))).toBe(true);

    const nativeEdit: TextEdit = {
      id: 'native',
      pageIndex: 0,
      find: 'OCR TEXT',
      replace: 'OCR EDITED',
    };
    const assessment = analyzeEditCapability(nativeEdit, caps.pages[0]!);
    expect(assessment.strategy).toBe('native-object');
    expect(assessment.reasons.some((reason) => reason.includes('render mode'))).toBe(true);

    const scannedEdit: TextEdit = {
      id: 'scan',
      pageIndex: 1,
      find: 'not present',
      replace: 'image text',
    };
    expect(analyzeEditCapability(scannedEdit, caps.pages[1]!).strategy).toBe('manual-review');
    const withFallback: TextEdit = {
      ...scannedEdit,
      fallback: fallbackOverlay(1, { x: 40, y: 100, width: 200, height: 40 }, 'image text'),
    };
    expect(analyzeEditCapability(withFallback, caps.pages[1]!).strategy).toBe(
      'localized-reconstruction',
    );
  });
});
