/**
 * Verification-hardening and robustness gates for the text-edit engine.
 *
 * These tests exist because a rewrite being *reported* as a success is not the
 * same as the document actually changing. They pin the fail-closed behaviour that
 * makes a passing verification trustworthy:
 *
 *  - a replacement that is already present on the page cannot mask a no-op write,
 *  - a deletion that left the text in place is a failure, not a success,
 *  - a font that an edit legitimately consumed may disappear, but a font no edit
 *    touched disappearing is still corruption,
 *  - the pipeline survives concurrent runs, cancellation, and many open/close
 *    cycles without corrupting shared WASM state.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import {
  configurePdfiumRuntime,
  configurePdfjsRuntime,
  loadPdfiumModule,
  editPdfText,
  extractTextRuns,
  verifyTextEdits,
  verifyExportArtifact,
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

async function pageText(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const runs = await extractTextRuns(bytes, [pageIndex]);
  return runs[0]!.map((run) => run.text).join('\n');
}

/** One page with a single Helvetica line, drawn with pdf-lib (a real font dict). */
async function oneLine(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText(text, { x: 40, y: 240, size: 18, font, color: rgb(0, 0, 0) });
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

/** One page carrying a Helvetica line and a Courier line (two font resources). */
async function twoFontPage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const courier = await doc.embedFont(StandardFonts.Courier);
  const page = doc.addPage([400, 300]);
  page.drawText('Invoice', { x: 40, y: 240, size: 18, font: helvetica, color: rgb(0, 0, 0) });
  page.drawText('number 42', { x: 40, y: 200, size: 18, font: courier, color: rgb(0, 0, 0) });
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

/** One page with an empty content stream — no fonts at all. */
async function blankPage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

function check(verification: Awaited<ReturnType<typeof verifyTextEdits>>, name: string) {
  const found = verification.checks.find((entry) => entry.name === name);
  expect(found, `expected a "${name}" check`).toBeDefined();
  return found!;
}

/* ------------------------------------------------ D1: no-op / deletion absence */

describe('residual-original absence checks', () => {
  it('fails a no-op artifact when the replacement string already existed on the page', async () => {
    // The page already says "REDACTED". Replacing "Secret" with "REDACTED" and then
    // handing back the *original* bytes is a no-op -- but "REDACTED" is present, so
    // a presence-only check would pass it. The residual check must catch it.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('Secret', { x: 40, y: 240, size: 18, font, color: rgb(0, 0, 0) });
    page.drawText('REDACTED', { x: 40, y: 200, size: 18, font, color: rgb(0, 0, 0) });
    const original = new Uint8Array(await doc.save({ useObjectStreams: false }));

    const passive = await verifyTextEdits(original, {
      expectedPageCount: 1,
      expectations: [{ label: 'e', pageIndex: 0, expect: 'REDACTED' }],
    });
    // Without `find` the old presence-only behaviour still (honestly) passes; this
    // is the loophole the engine must not rely on.
    expect(passive.checks.find((entry) => entry.name === 'residual-original:e')).toBeUndefined();

    const guarded = await verifyTextEdits(original, {
      expectedPageCount: 1,
      expectations: [{ label: 'e', pageIndex: 0, expect: 'REDACTED', find: 'Secret' }],
      original,
    });
    expect(check(guarded, 'replacement-present:e').ok).toBe(true);
    expect(check(guarded, 'residual-original:e').ok).toBe(false);
    expect(guarded.ok).toBe(false);
  });

  it('passes when the original was genuinely replaced', async () => {
    const original = await oneLine('Secret');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('REDACTED', { x: 40, y: 240, size: 18, font, color: rgb(0, 0, 0) });
    const output = new Uint8Array(await doc.save({ useObjectStreams: false }));

    const verification = await verifyTextEdits(output, {
      expectedPageCount: 1,
      expectations: [{ label: 'e', pageIndex: 0, expect: 'REDACTED', find: 'Secret' }],
      original,
    });
    expect(check(verification, 'residual-original:e').ok).toBe(true);
    expect(verification.ok).toBe(true);
  });

  it('fails a deletion that left the original text in place', async () => {
    const original = await oneLine('Sensitive');
    const verification = await verifyTextEdits(original, {
      expectedPageCount: 1,
      expectations: [{ label: 'del', pageIndex: 0, expect: '', find: 'Sensitive' }],
      original,
    });
    expect(check(verification, 'residual-original:del').ok).toBe(false);
    expect(verification.ok).toBe(false);
  });

  it('passes a deletion that really removed the text', async () => {
    const original = await oneLine('Sensitive');
    const output = await blankPage();
    const verification = await verifyTextEdits(output, {
      expectedPageCount: 1,
      expectations: [{ label: 'del', pageIndex: 0, expect: '', find: 'Sensitive' }],
      original,
    });
    expect(check(verification, 'residual-original:del').ok).toBe(true);
    expect(verification.ok).toBe(true);
  });

  it('skips the absence check when the replacement reintroduces the original as a substring', async () => {
    // "Sec" -> "Secret Info": the original stays present as part of the replacement,
    // so occurrence counting cannot judge it. It must be skipped, not failed.
    const original = await oneLine('Sec');
    const verification = await verifyTextEdits(original, {
      expectedPageCount: 1,
      expectations: [{ label: 'e', pageIndex: 0, expect: 'Secret Info', find: 'Sec' }],
      original,
    });
    expect(check(verification, 'residual-original:e').ok).toBe(true);
  });

  it('skips when the original text was not independently countable', async () => {
    const original = await oneLine('Other text');
    const verification = await verifyTextEdits(original, {
      expectedPageCount: 1,
      expectations: [{ label: 'e', pageIndex: 0, expect: 'Other text', find: 'Absent' }],
      original,
    });
    expect(check(verification, 'residual-original:e').ok).toBe(true);
  });

  it('accounts for several edits consuming the same string on one page', async () => {
    // Two "DUP" runs, one consumed: the page must still show exactly one.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('DUP', { x: 40, y: 240, size: 18, font, color: rgb(0, 0, 0) });
    page.drawText('DUP', { x: 40, y: 200, size: 18, font, color: rgb(0, 0, 0) });
    const original = new Uint8Array(await doc.save({ useObjectStreams: false }));

    const doc2 = await PDFDocument.create();
    const font2 = await doc2.embedFont(StandardFonts.Helvetica);
    const page2 = doc2.addPage([400, 300]);
    page2.drawText('REPLACED', { x: 40, y: 240, size: 18, font: font2, color: rgb(0, 0, 0) });
    page2.drawText('DUP', { x: 40, y: 200, size: 18, font: font2, color: rgb(0, 0, 0) });
    const output = new Uint8Array(await doc2.save({ useObjectStreams: false }));

    const verification = await verifyTextEdits(output, {
      expectedPageCount: 1,
      expectations: [{ label: 'e', pageIndex: 0, expect: 'REPLACED', find: 'DUP' }],
      original,
    });
    expect(check(verification, 'residual-original:e').ok).toBe(true);
  });
});

/* ------------------------------------------------------ D2/D3: font resources */

describe('font-resources tolerance for consumed fonts', () => {
  it('passes when a two-font run collapses into one rewrite and drops a font (D2)', async () => {
    const original = await twoFontPage();
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('Invoice paid', { x: 40, y: 240, size: 18, font, color: rgb(0, 0, 0) });
    const output = new Uint8Array(await doc.save({ useObjectStreams: false }));

    const verification = await verifyExportArtifact({
      original,
      output,
      expectedPageCount: 1,
      expectations: [],
      consumedFonts: new Set(['Courier']),
      visual: false,
    });
    expect(check(verification, 'font-resources').ok).toBe(true);
    expect(verification.ok).toBe(true);
  });

  it('passes when a deletion removes the only run and leaves no font resources (D3)', async () => {
    const original = await oneLine('Sensitive');
    const output = await blankPage();
    const verification = await verifyExportArtifact({
      original,
      output,
      expectedPageCount: 1,
      expectations: [],
      consumedFonts: new Set(['Helvetica']),
      visual: false,
    });
    expect(check(verification, 'font-resources').ok).toBe(true);
    expect(verification.ok).toBe(true);
  });

  it('still fails when a font no edit touched disappears (negative control)', async () => {
    const original = await twoFontPage();
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('Invoice', { x: 40, y: 240, size: 18, font, color: rgb(0, 0, 0) });
    const output = new Uint8Array(await doc.save({ useObjectStreams: false }));

    const verification = await verifyExportArtifact({
      original,
      output,
      expectedPageCount: 1,
      expectations: [],
      consumedFonts: new Set<string>(), // nothing declared consumed
      visual: false,
    });
    expect(check(verification, 'font-resources').ok).toBe(false);
    expect(verification.ok).toBe(false);
  });
});

/* ------------------------------------------------ end-to-end: deletions verify */

describe('end-to-end deletion is verified, not just trusted', () => {
  it('deletes a run and passes the final gate with a real absence check', async () => {
    const original = await oneLine('Sensitive');
    const result = await editPdfText(
      original,
      { edits: [{ id: 'del', pageIndex: 0, find: 'Sensitive', replace: '' }] },
      testContext(),
    );
    expect(result.outcomes[0]!.mode).toBe('in-place');
    expect(await pageText(result.bytes, 0)).not.toContain('Sensitive');
  });
});

describe('encrypted documents', () => {
  it('edits a password-protected PDF and verifies the encrypted output', async () => {
    // Verification reopens both the original and the output. Without forwarding the
    // password it failed with "No password given", so encrypted edits could never
    // pass the final gate. This pins the password threading.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('Secret Text', { x: 40, y: 240, size: 18, font, color: rgb(0, 0, 0) });
    doc.encrypt({ userPassword: 'pw', ownerPassword: 'pw', permissions: {} });
    const source = new Uint8Array(await doc.save());

    const result = await editPdfText(
      source,
      { edits: [{ id: 'enc', pageIndex: 0, find: 'Secret Text', replace: 'Public Text' }] },
      testContext(),
      undefined,
      'pw',
    );
    expect(result.outcomes[0]!.mode).toBe('in-place');
    const runs = await extractTextRuns(result.bytes, [0], undefined, 'pw');
    const text = runs[0]!.map((run) => run.text).join(' ');
    expect(text).toContain('Public Text');
    expect(text).not.toContain('Secret Text');
  });
});

/* ---------------------------------------------------------- robustness gates */

describe('robustness', () => {
  it('runs several edits concurrently without cross-contaminating results', async () => {
    const sources = await Promise.all([oneLine('Alpha'), oneLine('Bravo'), oneLine('Charlie')]);
    const replacements = ['One', 'Two', 'Three'];
    const results = await Promise.all(
      sources.map((source, index) =>
        editPdfText(
          source,
          { edits: [{ id: `e${index}`, pageIndex: 0, find: ['Alpha', 'Bravo', 'Charlie'][index]!, replace: replacements[index]! }] },
          testContext(),
        ),
      ),
    );
    for (let index = 0; index < results.length; index += 1) {
      expect(results[index]!.outcomes[0]!.mode).toBe('in-place');
      expect(await pageText(results[index]!.bytes, 0)).toContain(replacements[index]!);
    }
  });

  it('honours cancellation before doing any PDFium work', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = {
      ...testContext(),
      signal: controller.signal,
      throwIfAborted: () => {
        if (controller.signal.aborted) throw new Error('Operation cancelled');
      },
    };
    await expect(
      editPdfText(
        await oneLine('Cancel Me'),
        { edits: [{ id: 'c', pageIndex: 0, find: 'Cancel Me', replace: 'Never' }] },
        ctx,
      ),
    ).rejects.toThrow(/cancel/i);
  });

  it('stays stable across many open/edit/close cycles', async () => {
    // Each cycle opens a fresh PDFium document, edits, serializes and closes. A
    // leak or a stale shared pointer would surface as a failed cycle here.
    for (let index = 0; index < 20; index += 1) {
      const source = await oneLine(`Cycle ${index}`);
      const result = await editPdfText(
        source,
        { edits: [{ id: `cycle-${index}`, pageIndex: 0, find: `Cycle ${index}`, replace: `Done ${index}` }] },
        testContext(),
      );
      expect(result.outcomes[0]!.mode).toBe('in-place');
      expect(await pageText(result.bytes, 0)).toContain(`Done ${index}`);
    }
  }, 120_000);
});
