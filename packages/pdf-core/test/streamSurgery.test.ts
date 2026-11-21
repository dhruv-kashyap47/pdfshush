import { beforeAll, describe, expect, it } from 'vitest';
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';
import {
  applyContentStreamEdits,
  applyEdits,
  configurePdfiumRuntime,
  configurePdfjsRuntime,
  editPdfText,
  extractTextRuns,
  loadPdfiumModule,
  parseOperations,
  readFontCharcodes,
  scanPageText,
  tokenizeContentStream,
  type FontMetrics,
} from '../src/index.js';
import { buildTextSurgeryFixture } from './corpus/textSurgery.js';
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

async function pageText(bytes: Uint8Array, pageIndex = 0): Promise<string> {
  const runs = await extractTextRuns(bytes, [pageIndex]);
  return runs[0]!.map((run) => run.text).join('\n');
}

async function firstPageContent(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const { Contents } = doc.getPages()[0]!.node.normalizedEntries();
  const parts: string[] = [];
  for (let i = 0; i < (Contents?.size() ?? 0); i += 1) {
    const value = Contents!.lookup(i);
    if (!(value instanceof PDFRawStream)) continue;
    let decoded: Uint8Array;
    try {
      decoded = decodePDFRawStream(value).decode();
    } catch {
      decoded = value.getContents();
    }
    parts.push(new TextDecoder('latin1').decode(decoded));
  }
  return parts.join('\n');
}

async function rawPage(content: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.node.set(
    PDFName.of('Contents'),
    doc.context.register(doc.context.flateStream(content)),
  );
  page.node.set(
    PDFName.of('Resources'),
    doc.context.obj({ Font: { F1: font.ref } }),
  );
  return doc.save({ useObjectStreams: false });
}

function encode(...parts: Array<string | Uint8Array>): Uint8Array {
  const chunks = parts.map((part) =>
    typeof part === 'string' ? new TextEncoder().encode(part) : part,
  );
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function lineRightEdges(bytes: Uint8Array): Promise<number[]> {
  const runs = await extractTextRuns(bytes, [0]);
  return runs[0]!.map((run) => run.x + run.width);
}

describe('per-glyph removal (C-03/C-04)', () => {
  it('removes a word inside one Tj without disturbing the kept text', async () => {
    const fixture = await buildTextSurgeryFixture('partial-word');
    const fonts = await readFontCharcodes(fixture.bytes);
    const before = await lineRightEdges(fixture.bytes);
    const result = await applyContentStreamEdits(
      fixture.bytes,
      [{ id: 'cut', pageIndex: 0, find: '2026', replace: '' }],
      fonts,
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('content-stream');
    expect(result.complete).toBe(true);

    const text = await pageText(result.bytes);
    expect(text).toContain('INVOICE');
    expect(text).toContain('0042');
    expect(text).not.toContain('2026');
    // The line's right edge is where it was: every removed advance became a kern.
    const after = await lineRightEdges(result.bytes);
    expect(after[0]).toBeCloseTo(before[0]!, 1);
  });

  it('preserves a TJ array and keeps the following word at its original x', async () => {
    const fixture = await buildTextSurgeryFixture('tj-kern');
    const fonts = await readFontCharcodes(fixture.bytes);
    const before = await lineRightEdges(fixture.bytes);
    const result = await applyContentStreamEdits(
      fixture.bytes,
      [{ id: 'cut', pageIndex: 0, find: '2026', replace: '' }],
      fonts,
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('content-stream');
    const text = await pageText(result.bytes);
    expect(text).toContain('INVOICE');
    expect(text).toContain('0042');
    expect(text).not.toContain('2026');
    const after = await lineRightEdges(result.bytes);
    expect(after[0]).toBeCloseTo(before[0]!, 1);
  });

  it("re-emits the line move when a ' operator is fully removed", async () => {
    const source = await rawPage(
      encode(
        'BT /F1 12 Tf 14 TL 72 200 Td (Keep first) Tj (Remove me) \' (After) Tj ET',
      ),
    );
    const fonts = await readFontCharcodes(source);
    const beforeRuns = (await extractTextRuns(source, [0]))[0]!;
    const beforeAfter = beforeRuns.find((run) => run.text.includes('After'));
    expect(beforeAfter).toBeDefined();

    const result = await applyContentStreamEdits(
      source,
      [{ id: 'cut', pageIndex: 0, find: 'Remove me', replace: '' }],
      fonts,
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('content-stream');
    const text = await pageText(result.bytes);
    expect(text).toContain('Keep first');
    expect(text).toContain('After');
    expect(text).not.toContain('Remove me');
    const afterRuns = (await extractTextRuns(result.bytes, [0]))[0]!;
    const afterAfter = afterRuns.find((run) => run.text.includes('After'));
    expect(afterAfter).toBeDefined();
    // If the line move had been dropped, "After" would sit on the first line.
    expect(afterAfter!.y).toBeCloseTo(beforeAfter!.y, 1);
  });

  it('keeps the line edge when character, word and horizontal spacing are set', async () => {
    const source = await rawPage(
      encode(
        'BT /F1 18 Tf 2 Tc 3 Tw 50 Tz 1 0 0 1 40 200 Tm (ALPHA BETA GAMMA) Tj ET',
      ),
    );
    const fonts = await readFontCharcodes(source);
    const before = await lineRightEdges(source);
    const result = await applyContentStreamEdits(
      source,
      [{ id: 'spacing', pageIndex: 0, find: 'BETA', replace: '' }],
      fonts,
      testContext(),
    );
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('content-stream');
    const text = await pageText(result.bytes);
    expect(text).toContain('ALPHA');
    expect(text).toContain('GAMMA');
    expect(text).not.toContain('BETA');
    const after = await lineRightEdges(result.bytes);
    expect(after[0]).toBeCloseTo(before[0]!, 1);
  });

  it('removes the first and last strings of a TJ array without moving the rest', async () => {
    const source = await rawPage(
      encode(
        'BT /F1 18 Tf 1 0 0 1 40 200 Tm [(ONE) -200 (TWO) -200 (THREE)] TJ (END) Tj ET',
      ),
    );
    const fonts = await readFontCharcodes(source);

    const first = await applyContentStreamEdits(
      source,
      [{ id: 'first', pageIndex: 0, find: 'ONE', replace: '' }],
      fonts,
      testContext(),
    );
    expect(first.outcomes[0]!.mode, first.outcomes[0]!.reason).toBe('content-stream');
    expect(await pageText(first.bytes)).not.toContain('ONE');
    // The removed first string becomes a leading negative kern, so the rest of
    // the array starts at the same position.
    expect(await firstPageContent(first.bytes)).toMatch(
      /\[\s*-\d+(?:\.\d+)?\s+-200\s+\(TWO\)/,
    );

    const last = await applyContentStreamEdits(
      source,
      [{ id: 'last', pageIndex: 0, find: 'THREE', replace: '' }],
      fonts,
      testContext(),
    );
    expect(last.outcomes[0]!.mode, last.outcomes[0]!.reason).toBe('content-stream');
    expect(await pageText(last.bytes)).not.toContain('THREE');
    // The removed last string leaves a trailing negative kern, preserving the
    // position the following Tj starts from.
    expect(await firstPageContent(last.bytes)).toMatch(
      /-200\s+-\d+(?:\.\d+)?\s*\] TJ/,
    );
  });

  it('re-emits the line move when a " operator is fully removed', async () => {
    const source = await rawPage(
      encode(
        'BT /F1 12 Tf 14 TL 72 200 Td (Keep first) Tj 2 1 (Remove me) " (After) Tj ET',
      ),
    );
    const fonts = await readFontCharcodes(source);
    const beforeRuns = (await extractTextRuns(source, [0]))[0]!;
    const beforeAfter = beforeRuns.find((run) => run.text.includes('After'));
    expect(beforeAfter).toBeDefined();

    const result = await applyContentStreamEdits(
      source,
      [{ id: 'cut', pageIndex: 0, find: 'Remove me', replace: '' }],
      fonts,
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('content-stream');
    const text = await pageText(result.bytes);
    expect(text).toContain('Keep first');
    expect(text).toContain('After');
    expect(text).not.toContain('Remove me');
    const afterRuns = (await extractTextRuns(result.bytes, [0]))[0]!;
    const afterAfter = afterRuns.find((run) => run.text.includes('After'));
    expect(afterAfter).toBeDefined();
    expect(afterAfter!.y).toBeCloseTo(beforeAfter!.y, 1);
  });

  it('refuses a deletion when the same needle appears twice in one run', async () => {
    const source = await rawPage(
      encode('BT /F1 12 Tf 1 0 0 1 40 200 Tm (go go go) Tj ET'),
    );
    const fonts = await readFontCharcodes(source);
    const result = await applyContentStreamEdits(
      source,
      [{ id: 'ambiguous', pageIndex: 0, find: 'go', replace: '' }],
      fonts,
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('manual-review');
    expect(result.outcomes[0]!.reason).toMatch(/more than one occurrence/i);
    expect(await pageText(result.bytes)).toContain('go go go');
  });

  it('reports a display box for a rotated stream removal', async () => {
    const fixture = await buildTextSurgeryFixture('rotated');
    const fonts = await readFontCharcodes(fixture.bytes);
    const result = await applyContentStreamEdits(
      fixture.bytes,
      [{ id: 'rot', pageIndex: 0, find: 'ROTATED', replace: '' }],
      fonts,
      testContext(),
    );
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('content-stream');
    expect(result.outcomes[0]!.box?.width).toBeGreaterThan(0);
    expect(result.outcomes[0]!.box?.height).toBeGreaterThan(0);
    expect(await pageText(result.bytes)).not.toContain('ROTATED');
  });

  it('never re-emits a Type0 string with a trailing half code', () => {
    const metrics: FontMetrics = {
      baseName: 'OddFace',
      subtype: 'Type0',
      codeByteLength: 2,
      reliable: true,
      widthFor: () => 1000,
      unicodeFor: () => 'A',
      decode: () => [{ code: 0x41, unicode: 'A', width: 1000 }],
      encode: () => null,
    };
    const operations = parseOperations(
      tokenizeContentStream(
        encode('BT /F1 12 Tf 1 0 0 1 10 10 Tm (\\000A\\000) Tj ET'),
      ),
    );
    const scan = scanPageText(operations, new Map([['F1', metrics]]));
    expect(scan.runs[0]!.decodable).toBe(false);
  });
});

describe('stream isolation (C-06)', () => {
  it('wraps unclosed source state in q … Q before appending overlays', async () => {
    const fixture = await buildTextSurgeryFixture('unclosed-clip');
    const doc = await PDFDocument.load(fixture.bytes);
    await applyEdits(
      doc,
      [{ id: 'r', pageIndex: 0, kind: 'rect', x: 20, y: 20, width: 40, height: 20 }],
      testContext(),
    );
    const output = await doc.save({ useObjectStreams: false });
    const content = (await firstPageContent(output)).trim();
    expect(content.startsWith('q')).toBe(true);
    expect(content).toContain('Q');
    // The source's own drawing still appears inside the wrapper.
    expect(content).toContain('(CLIPPED) Tj');
  });

  it('does not splice an undecodable filtered stream into a raw wrapper', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    const source = encode('BT /F1 12 Tf 1 0 0 1 40 200 Tm (RAW) Tj ET');
    const dict = doc.context.obj({ Filter: 'BogusDecode' });
    if (!(dict instanceof PDFDict)) throw new Error('expected dict');
    dict.set(PDFName.of('Length'), PDFNumber.of(source.length));
    page.node.set(
      PDFName.of('Contents'),
      doc.context.register(PDFRawStream.of(dict, source)),
    );
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font.ref } }));

    await applyEdits(
      doc,
      [{ id: 'r', pageIndex: 0, kind: 'rect', x: 20, y: 20, width: 40, height: 20 }],
      testContext(),
    );
    const output = await doc.save({ useObjectStreams: false });
    const serialized = new TextDecoder('latin1').decode(output);
    // The source stream is still written as its original operators; a bad
    // wrapper would have spliced the compressed payload into a `q … Q` wrapper.
    expect(serialized).toContain('(RAW) Tj');
    expect(serialized).toContain('/BogusDecode');
    await expect(PDFDocument.load(output)).resolves.toBeDefined();
  });
});

describe('stream completeness honesty (C-14)', () => {
  it('reports text inside a Form XObject as stream-incomplete, not success', async () => {
    const fixture = await buildTextSurgeryFixture('xobject-text');
    const fonts = await readFontCharcodes(fixture.bytes);
    const result = await applyContentStreamEdits(
      fixture.bytes,
      [{ id: 'x', pageIndex: 0, find: 'IN XOBJECT', replace: 'DONE' }],
      fonts,
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('manual-review');
    expect(result.outcomes[0]!.reason).toContain('stream-incomplete');
    expect(result.complete).toBe(false);
    expect(result.limitations.join(' ')).toMatch(/Form XObject/);
  });

  it('handles an inline image and still rewrites the text after it', async () => {
    const source = await rawPage(
      encode(
        'q 10 0 0 10 5 5 cm BI /W 1 /H 1 /BPC 8 /CS /G ID ',
        Uint8Array.of(0x80),
        ' EI Q\nBT /F1 12 Tf 1 0 0 1 40 200 Tm (INLINE OK) Tj ET',
      ),
    );
    const fonts = await readFontCharcodes(source);
    const result = await applyContentStreamEdits(
      source,
      [{ id: 'inline', pageIndex: 0, find: 'INLINE OK', replace: 'INLINE DONE' }],
      fonts,
      testContext(),
    );
    expect(result.outcomes[0]!.mode, result.outcomes[0]!.reason).toBe('content-stream');
    expect(result.complete).toBe(true);
    const text = await pageText(result.bytes);
    expect(text).toContain('INLINE DONE');
    expect(text).not.toContain('INLINE OK');
  });
});

describe('edit coverage invariant (C-13)', () => {
  it('warns when an edit has no geometry instead of dropping it silently', async () => {
    const source = await rawPage(
      encode('BT /F1 14 Tf 1 0 0 1 40 200 Tm (Hello World) Tj ET'),
    );
    const result = await editPdfText(
      source,
      { edits: [{ id: 'no-box', pageIndex: 0, find: 'Hello World', replace: 'Hi there' }] },
      testContext(),
    );
    expect(result.outcomes).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('edit-coverage');
  });

  it('declares overlay objects as expected changes on their own page', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([400, 300]).drawText('OLD TEXT', { x: 40, y: 240, size: 18, font });
    doc.addPage([400, 300]).drawText('SECOND PAGE', { x: 40, y: 240, size: 18, font });
    const source = await doc.save({ useObjectStreams: false });

    const result = await editPdfText(
      source,
      {
        edits: [{ id: 'e', pageIndex: 0, find: 'OLD TEXT', replace: 'NEW TEXT' }],
        objects: [
          {
            id: 'overlay',
            pageIndex: 1,
            kind: 'text',
            x: 40,
            y: 40,
            width: 120,
            height: 20,
            text: 'OVERLAY',
            fontSize: 12,
          },
        ],
      },
      testContext(),
    );
    const first = await pageText(result.bytes, 0);
    const second = await pageText(result.bytes, 1);
    expect(first).toContain('NEW TEXT');
    expect(second).toContain('SECOND PAGE');
    expect(second).toContain('OVERLAY');
  });
});
