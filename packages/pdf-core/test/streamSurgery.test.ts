import { beforeAll, describe, expect, it } from 'vitest';
import {
  PDFDocument,
  PDFName,
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
  readFontCharcodes,
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
});
