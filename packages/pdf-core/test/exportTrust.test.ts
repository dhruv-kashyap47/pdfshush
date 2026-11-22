/**
 * X-02 / X-03: the receipt's numbers and the untouched-page override.
 *
 * A receipt that invents its counts is worse than no receipt. These tests take
 * the stats from the job that did the work, prove an object-only export still
 * runs real verification, and pin the only verification failure a user may
 * knowingly accept.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { textEditJob } from '../src/jobs/textEdit.job.js';
import { countCharacterChanges, enforceVerification } from '../src/textedit/engine.js';
import { verifyExportArtifact } from '../src/textedit/exportVerify.js';
import { configurePdfjsRuntime } from '../src/render/pdfjsRuntime.js';
import { configurePdfiumRuntime, loadPdfiumModule } from '../src/textedit/runtime.js';
import { TextEditUnsafeError } from '../src/textedit/types.js';
import { testContext } from './fixtures.js';

function readPdfiumWasm(): Uint8Array {
  const proc = (globalThis as unknown as {
    process: { getBuiltinModule(name: string): unknown };
  }).process;
  const fs = proc.getBuiltinModule('node:fs') as { readFileSync(path: URL): Uint8Array };
  return fs.readFileSync(
    new URL('../node_modules/@embedpdf/pdfium/dist/pdfium.wasm', import.meta.url),
  );
}

beforeAll(async () => {
  configurePdfiumRuntime({ wasmBinary: readPdfiumWasm() });
  await loadPdfiumModule();
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
      .href,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  });
});

async function twoPageDocument(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([320, 240]);
  first.drawText('FIRST PAGE WORDS', { x: 24, y: 180, size: 14, font });
  const second = doc.addPage([320, 240]);
  second.drawText('SECOND PAGE WORDS', { x: 24, y: 180, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

describe('X-02 receipt stats', () => {
  test('character counts distinguish removal from an overlay', () => {
    const edits = [
      { id: 'a', pageIndex: 0, find: 'hello', replace: 'hi' },
      { id: 'b', pageIndex: 0, find: 'fallback', replace: 'X' },
      { id: 'c', pageIndex: 0, find: 'manual', replace: 'Y' },
      { id: 'd', pageIndex: 0, find: 'delete', replace: '' },
    ];
    const outcomes = [
      { id: 'a', pageIndex: 0, mode: 'in-place' },
      { id: 'b', pageIndex: 0, mode: 'fallback' },
      { id: 'c', pageIndex: 0, mode: 'manual-review' },
      { id: 'd', pageIndex: 0, mode: 'content-stream' },
    ] as Parameters<typeof countCharacterChanges>[1];
    expect(countCharacterChanges(edits, outcomes)).toEqual({
      // Only the two natively consumed originals count as removed.
      removed: 'hello'.length + 'delete'.length,
      // Added text is present for both native and overlaid replacements;
      // manual-review added nothing.
      added: 'hi'.length + 'X'.length,
    });
  });

  test('validates the override and OCR-count options', () => {
    const files = [{ name: 'a.pdf', type: 'application/pdf', data: new Uint8Array() }];
    expect(
      textEditJob.validate({
        files,
        options: { acceptUntouchedPageChanges: 'yes' as unknown as boolean },
      }),
    ).toMatchObject({ ok: false });
    expect(
      textEditJob.validate({ files, options: { ocrPages: -1 } }),
    ).toMatchObject({ ok: false });
    expect(
      textEditJob.validate({ files, options: { acceptUntouchedPageChanges: true, ocrPages: 2 } }),
    ).toMatchObject({ ok: true });
  });

  test('a text export reports the counts from the engine and edits', async () => {
    const source = await twoPageDocument();
    const result = await textEditJob.run(
      {
        files: [{ name: 'stats.pdf', data: source }],
        options: {
          edits: [{ id: 's1', pageIndex: 0, find: 'FIRST PAGE WORDS', replace: 'CHANGED' }],
          verifyVisual: false,
          ocrPages: 2,
        },
      },
      testContext(),
    );
    const stats = result.report.stats;
    expect(stats.pages).toBe(2);
    expect(stats.ocrPages).toBe(2);
    expect(stats.textEdits).toBe(1);
    expect(stats.charactersRemoved).toBe('FIRST PAGE WORDS'.length);
    expect(stats.charactersAdded).toBe('CHANGED'.length);
    expect(stats.strategy).toBe('auto');
    expect(stats.verification).toBe('passed');
    expect(stats.verificationChecks).toBeGreaterThan(0);
    // A text-only edit legitimately carries an `edit-coverage` notice; what
    // matters is that it reached the report as a coded warning.
    expect(result.report.warnings[0]?.code).toBe('edit-coverage');
  }, 60_000);

  test('an object-only export gets real verification, not an empty verdict', async () => {
    const source = await twoPageDocument();
    const result = await textEditJob.run(
      {
        files: [{ name: 'objects.pdf', data: source }],
        options: {
          objects: [
            {
              id: 'box',
              kind: 'rect',
              role: 'content',
              pageIndex: 0,
              x: 40,
              y: 40,
              width: 80,
              height: 30,
              fill: '#ff0000',
            },
            {
              // No fill and no stroke: validated but invisible, so it must not
              // inflate the receipt's "objects drawn" count.
              id: 'invisible',
              kind: 'rect',
              role: 'content',
              pageIndex: 0,
              x: 150,
              y: 150,
              width: 10,
              height: 10,
            },
          ],
          verifyVisual: false,
        },
      },
      testContext(),
    );
    expect(result.report.inPlace).toBe(0);
    expect(result.report.stats.objectsDrawn).toBe(1);
    expect(result.report.stats.textEdits).toBe(0);
    expect(result.report.stats.verification).toBe('passed');
    expect(result.report.verification.checks.length).toBeGreaterThan(0);
    expect(result.report.verification.checks.map((check) => check.name)).toContain('untouched-pages');
  }, 60_000);
});

describe('X-03 untouched-page gate', () => {
  test('detects a changed untouched page and refuses by default', async () => {
    const original = await twoPageDocument();
    const editedDoc = await PDFDocument.load(original);
    const page = editedPage(editedDoc);
    const font = await editedDoc.embedFont(StandardFonts.Helvetica);
    page.drawText('LEAKED INTO PAGE TWO', { x: 24, y: 120, size: 12, font });
    const output = await editedDoc.save({ useObjectStreams: false });

    const verification = await verifyExportArtifact({
      original,
      output,
      expectedPageCount: 2,
      expectations: [],
      editedRegions: [{ pageIndex: 0, box: { x: 20, y: 150, width: 200, height: 30 } }],
      visual: false,
    });
    expect(verification.ok).toBe(false);
    expect(
      verification.checks.some(
        (check) => check.name === 'untouched-page-text:page-2' && !check.ok,
      ),
    ).toBe(true);

    const warnings: string[] = [];
    expect(() => enforceVerification(verification, undefined, warnings)).toThrow(
      TextEditUnsafeError,
    );
  }, 60_000);

  test('accepts only that failure, and records the acceptance', async () => {
    const verification = {
      ok: false,
      checks: [
        {
          name: 'untouched-page-text:page-2',
          ok: false,
          detail: 'text changed (aaa != bbb)',
        },
        { name: 'untouched-pages', ok: false, detail: '1 of 2 checked pages text-identical' },
      ],
    };
    const warnings: string[] = [];
    enforceVerification(verification, true, warnings);
    expect(warnings).toEqual([
      expect.stringMatching(/^untouched-page-accepted:/),
    ]);
  });

  test('a structural failure cannot be overridden', () => {
    const verification = {
      ok: false,
      checks: [
        { name: 'page-count', ok: false, detail: '1 pages' },
        { name: 'untouched-pages', ok: false, detail: 'text changed' },
      ],
    };
    expect(() => enforceVerification(verification, true, [])).toThrow(TextEditUnsafeError);
  });
});

function editedPage(doc: PDFDocument) {
  return doc.getPages()[1]!;
}
