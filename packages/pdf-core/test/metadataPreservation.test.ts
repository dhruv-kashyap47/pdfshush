/**
 * X-04: document-level preservation.
 *
 * Text editing loads and rewrites a document; page composition builds a new
 * one. Both are easy places to lose the parts a raster never shows: the Info
 * dictionary, the outline tree, page labels and form fields. These tests pin
 * the promise rather than the implementation.
 */

import { describe, expect, test, beforeAll } from 'vitest';
import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { composePageRefs } from '../src/ops/compose.js';
import { extractFormWidgets } from '../src/ops/forms.js';
import { loadPdfDocument } from '../src/ops/pages.js';
import { textEditJob } from '../src/jobs/textEdit.job.js';
import { inspectJob } from '../src/jobs/inspect.job.js';
import { configurePdfiumRuntime, loadPdfiumModule } from '../src/textedit/runtime.js';
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
  await loadPdfiumModule();
});

async function richDocument(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Preservation fixture');
  doc.setAuthor('pdfshush');
  doc.setSubject('X-04');
  doc.setKeywords(['metadata', 'outline', 'labels']);
  doc.setCreator('Fixture Creator');
  doc.setProducer('Fixture Producer');
  doc.setCreationDate(new Date('2020-01-02T03:04:05Z'));

  const page = doc.addPage([320, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('ORIGINAL WORD', { x: 24, y: 140, size: 16, font });

  // A real outline: /First + /Last + a destination back to the page.
  const outlines = doc.context.obj({ Type: 'Outlines', Count: 1 });
  const outlinesRef = doc.context.register(outlines);
  const item = doc.context.obj({
    Title: PDFString.of('Chapter One'),
    Parent: outlinesRef,
    Dest: [page.ref, 'XYZ', 0, 200, 0],
  });
  const itemRef = doc.context.register(item);
  outlines.set(PDFName.of('First'), itemRef);
  outlines.set(PDFName.of('Last'), itemRef);
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);

  // Page labels: lower-case roman numerals starting at page 1.
  doc.catalog.set(
    PDFName.of('PageLabels'),
    doc.context.obj({ Nums: [0, doc.context.obj({ S: 'r' })] }),
  );

  const form = doc.getForm();
  const field = form.createTextField('signer');
  field.addToPage(page, { x: 24, y: 32, width: 140, height: 20, font });

  return doc.save({ useObjectStreams: false });
}

describe('X-04 document-level preservation', () => {
  test('a native text edit keeps metadata, outline, page labels and AcroForm', async () => {
    const source = await richDocument();
    const result = await textEditJob.run(
      {
        files: [{ name: 'preserve.pdf', data: source }],
        options: {
          edits: [
            {
              id: 'x04',
              pageIndex: 0,
              find: 'ORIGINAL WORD',
              replace: 'REPLACED WORD',
            },
          ],
          verifyVisual: false,
        },
      },
      testContext(),
    );

    const output = await loadPdfDocument(new Uint8Array(result.data));
    expect(output.getTitle()).toBe('Preservation fixture');
    expect(output.getAuthor()).toBe('pdfshush');
    expect(output.getSubject()).toBe('X-04');
    expect(output.getKeywords()).toBe('metadata outline labels');
    expect(output.getCreator()).toBe('Fixture Creator');
    expect(output.getProducer()).toBe('Fixture Producer');
    expect(output.getCreationDate()?.toISOString()).toBe('2020-01-02T03:04:05.000Z');

    expect(output.catalog.lookup(PDFName.of('Outlines'))).toBeTruthy();
    expect(output.catalog.lookup(PDFName.of('PageLabels'))).toBeTruthy();
    expect(output.getForm()?.getFields().map((field) => field.getName())).toEqual(['signer']);

    // The text rewrite still worked; preservation did not mean "wrote nothing".
    expect(result.report.inPlace).toBeGreaterThan(0);
  }, 60_000);

  test('composition inherits creator and producer from the source', async () => {
    const source = await richDocument();
    const composed = await composePageRefs(
      [{ name: 'preserve.pdf', data: source }],
      [{ docIndex: 0, pageIndex: 0 }],
      testContext(),
    );
    const output = await loadPdfDocument(composed.data);
    expect(output.getTitle()).toBe('Preservation fixture');
    expect(output.getCreator()).toBe('Fixture Creator');
    expect(output.getProducer()).toBe('Fixture Producer');
    expect(output.getCreationDate()?.toISOString()).toBe('2020-01-02T03:04:05.000Z');
  }, 60_000);

  test('extractFormWidgets still sees the field after a native edit', async () => {
    const source = await richDocument();
    const result = await textEditJob.run(
      {
        files: [{ name: 'preserve.pdf', data: source }],
        options: {
          edits: [
            { id: 'x04-form', pageIndex: 0, find: 'ORIGINAL WORD', replace: 'REPLACED WORD' },
          ],
          verifyVisual: false,
        },
      },
      testContext(),
    );
    const output = await loadPdfDocument(new Uint8Array(result.data));
    expect(extractFormWidgets(output).map((widget) => widget.name)).toContain('signer');
  }, 60_000);

  test('inspect reports the creation date as a JSON-safe ISO string', async () => {
    const source = await richDocument();
    const result = await inspectJob.run(
      { files: [{ name: 'preserve.pdf', data: source }] },
      testContext(),
    );
    expect(result.documents[0]?.metadata.creationDate).toBe('2020-01-02T03:04:05.000Z');
    expect(result.documents[0]?.metadata.producer).toBe('Fixture Producer');
  }, 60_000);
});
