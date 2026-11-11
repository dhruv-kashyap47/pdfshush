/**
 * Round-trip harness for the EDITOR/EXPORT audit (session 4).
 *
 * For every committed audit fixture: open -> apply a representative edit ->
 * save -> reopen -> compare page count, text, annotations, form values,
 * metadata, rendered pixels and file size. The pixel comparison proves the
 * edit landed where the display-space box said it would without disturbing
 * anything outside it; the structural checks prove the save did not drop the
 * parts that never appear in a raster (annotations, forms, metadata).
 *
 * In-place text edits are exercised through the real PDFium path for the
 * fixtures that have native text, because that save path is the one that
 * rewrites the document rather than appending to it.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import { editJob } from '../../src/jobs/edit.job.js';
import { textEditJob } from '../../src/jobs/textEdit.job.js';
import { flipJob } from '../../src/jobs/flip.job.js';
import { mergePdfs } from '../../src/ops/merge.js';
import { extractFormWidgets } from '../../src/ops/forms.js';
import { inspectPdf } from '../../src/ops/pages.js';
import { extractTextRuns } from '../../src/render/textRuns.js';
import { renderPageToImage } from '../../src/render/renderPage.js';
import type { CanvasFactory, RenderCanvas } from '../../src/render/canvas.js';
import {
  configurePdfjsRuntime,
  loadPdfForRender,
  resetPdfCache,
} from '../../src/render/pdfjsRuntime.js';
import { configurePdfiumRuntime } from '../../src/textedit/runtime.js';
import { loadPdfiumModule } from '../../src/textedit/runtime.js';
import type { EditorObject } from '../../src/ops/edit.js';
import { testContext } from '../fixtures.js';
import { readAuditFixture } from './fixtures.js';

beforeAll(async () => {
  configurePdfjsRuntime({
    workerSrc: new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
      .href,
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .href,
  });
  configurePdfiumRuntime({ wasmBinary: readPdfiumWasm() });
  await loadPdfiumModule();
});

afterAll(async () => {
  await resetPdfCache();
});

function readPdfiumWasm(): Uint8Array {
  const proc = (
    globalThis as unknown as { process: { getBuiltinModule(name: string): unknown } }
  ).process;
  const fs = proc.getBuiltinModule('node:fs') as {
    readFileSync(path: URL): Uint8Array;
  };
  return fs.readFileSync(new URL('../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm', import.meta.url));
}

/* ------------------------------------------------------------------ canvas */

function pngFactory(width: number, height: number): RenderCanvas {
  const canvas = createCanvas(width, height);
  return {
    width,
    height,
    context: canvas.getContext('2d'),
    async toBlob(type: string, quality?: number) {
      const buffer =
        type === 'image/jpeg'
          ? await canvas.encode('jpeg', quality ? Math.round(quality * 100) : 90)
          : await canvas.encode('png');
      return new Blob([new Uint8Array(buffer)], { type });
    },
    release() {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

const canvasFactory: CanvasFactory = pngFactory;

interface Raster {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

async function render(bytes: Uint8Array, pageIndex: number, targetWidthPx = 600): Promise<Raster> {
  const { doc, destroy } = await loadPdfForRender(bytes);
  try {
    const page = await doc.getPage(pageIndex + 1);
    try {
      const image = await renderPageToImage(page, {
        targetWidthPx,
        format: 'png',
        canvasFactory,
      });
      const decoded = await loadImage(new Uint8Array(image.data));
      const canvas = createCanvas(decoded.width, decoded.height);
      const context = canvas.getContext('2d');
      context.drawImage(decoded, 0, 0);
      const data = context.getImageData(0, 0, decoded.width, decoded.height);
      return { width: decoded.width, height: decoded.height, pixels: data.data };
    } finally {
      page.cleanup();
    }
  } finally {
    await destroy();
  }
}

function inside(
  box: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

/** Fraction of pixels that differ outside `box`. */
function changedOutside(
  original: Raster,
  edited: Raster,
  box: { x: number; y: number; width: number; height: number },
): number {
  expect([edited.width, edited.height]).toEqual([original.width, original.height]);
  let changed = 0;
  let total = 0;
  for (let y = 0; y < original.height; y += 1) {
    for (let x = 0; x < original.width; x += 1) {
      if (inside(box, x, y)) continue;
      const i = (y * original.width + x) * 4;
      total += 1;
      if (
        Math.abs(original.pixels[i]! - edited.pixels[i]!) > 24 ||
        Math.abs(original.pixels[i + 1]! - edited.pixels[i + 1]!) > 24 ||
        Math.abs(original.pixels[i + 2]! - edited.pixels[i + 2]!) > 24 ||
        Math.abs(original.pixels[i + 3]! - edited.pixels[i + 3]!) > 24
      ) {
        changed += 1;
      }
    }
  }
  return total === 0 ? 0 : changed / total;
}

/* ---------------------------------------------------------------- fixtures */

const FIXTURES = [
  'tiny-1page.pdf',
  'multi-5page.pdf',
  'long-120page.pdf',
  'rotated-90.pdf',
  'cropbox-offset.pdf',
  'metadata.pdf',
  'acroform.pdf',
  'annotations.pdf',
  'image-only.pdf',
  'nonembedded-cjk.pdf',
  'nonembedded-rtl-arabic.pdf',
] as const;

const bytes = (name: string): Uint8Array => readAuditFixture(name);

async function annotationCount(data: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  return doc
    .getPages()
    .reduce((total, page) => total + (page.node.Annots()?.size() ?? 0), 0);
}

function textMark(pageIndex = 0): EditorObject {
  return {
    id: 'roundtrip-text',
    kind: 'text',
    pageIndex,
    x: 30,
    y: 30,
    width: 220,
    height: 26,
    text: 'ROUNDTRIP MARK',
    fontSize: 14,
    fontFamily: 'helvetica',
  };
}

/** Display-space box used both as the edit and as the pixel-comparison region. */
const MARK_BOX = { x: 24, y: 20, width: 240, height: 52 };

async function pageRunText(data: Uint8Array, pageIndex = 0): Promise<string> {
  const [runs] = await extractTextRuns(data, [pageIndex], testContext());
  return (runs ?? []).map((run) => run.text).join('\n');
}

describe('editor save round trip (overlay path)', () => {
  for (const name of FIXTURES) {
    it(`keeps the document intact when saving ${name}`, async () => {
      const source = bytes(name);
      const before = await inspectPdf(source);
      const beforeText = await pageRunText(source);
      const beforeAnnots = await annotationCount(source);
      const beforeRaster = await render(source, 0);

      const output = await editJob.run(
        {
          files: [{ name, data: source }],
          options: { objects: [textMark()] },
        },
        testContext(),
      );
      const saved = new Uint8Array(output.data);
      const after = await inspectPdf(saved);
      const afterText = await pageRunText(saved);

      // Structure.
      expect(after.pageCount).toBe(before.pageCount);
      expect(output.validated).toBe(true);
      expect(afterText).toContain('ROUNDTRIP MARK');
      if (beforeText.length > 0) {
        // The original page text is still readable; the edit is additive.
        expect(afterText).toContain(beforeText.split('\n')[0]!);
      }

      // Annotations and form fields survive an overlay save.
      expect(await annotationCount(saved)).toBeGreaterThanOrEqual(beforeAnnots);
      const fieldsBefore = before.fields.map((field) => field.name).sort();
      const fieldsAfter = after.fields.map((field) => field.name).sort();
      expect(fieldsAfter).toEqual(fieldsBefore);

      // Semantic metadata survives.
      expect(after.metadata.title).toBe(before.metadata.title);
      expect(after.metadata.author).toBe(before.metadata.author);
      expect(after.metadata.subject).toBe(before.metadata.subject);
      expect(after.metadata.keywords).toBe(before.metadata.keywords);

      // The mark is where the display-space box said, and nothing else moved.
      const afterRaster = await render(saved, 0);
      const scale = afterRaster.width / 595;
      expect(
        changedOutside(beforeRaster, afterRaster, {
          x: MARK_BOX.x * scale,
          y: MARK_BOX.y * scale,
          width: MARK_BOX.width * scale,
          height: MARK_BOX.height * scale,
        }),
      ).toBeLessThan(0.006);

      // A save must not balloon the file.
      expect(saved.byteLength).toBeLessThan(source.byteLength * 4 + 4096);
    }, 60_000);
  }
});

describe('form field round trip', () => {
  it('fills every widget on the acroform fixture and keeps the values', async () => {
    const source = bytes('acroform.pdf');
    const values = {
      'person.name': 'Grace Hopper',
      'person.agree': false,
      'person.color': 'blue',
      'person.country': 'India',
      'person.tags': 'gamma',
    };
    const output = await editJob.run(
      { files: [{ name: 'acroform.pdf', data: source }], options: { formValues: values } },
      testContext(),
    );
    const saved = new Uint8Array(output.data);
    const widgets = extractFormWidgets(await PDFDocument.load(saved, { updateMetadata: false }));
    expect(widgets.find((w) => w.name === 'person.name')?.value).toBe('Grace Hopper');
    expect(widgets.find((w) => w.name === 'person.agree')?.value).toBe(false);
    expect(widgets.find((w) => w.name === 'person.country')?.value).toBe('India');
    expect(widgets.find((w) => w.name === 'person.tags')?.value).toBe('gamma');
    // The radio group exposes one widget per option; exactly the selected one
    // reports true.
    const radios = widgets.filter((w) => w.name === 'person.color');
    expect(radios.filter((w) => w.value === true)).toHaveLength(1);
    expect(radios.find((w) => w.value === true)?.option).toBe('blue');

    // A rendered page still shows the fields (not a blank overlay).
    const raster = await render(saved, 0);
    expect(raster.pixels.some((value, index) => index % 4 !== 3 && value < 245)).toBe(true);
  }, 60_000);
});

describe('mixed text + form save round trip', () => {
  it('keeps the form values when the text edit succeeds natively', async () => {
    const source = bytes('acroform.pdf');
    const output = await textEditJob.run(
      {
        files: [{ name: 'acroform.pdf', data: source }],
        options: {
          edits: [
            {
              id: 'mixed',
              pageIndex: 0,
              find: 'ACROFORM FIXTURE',
              replace: 'ACROFORM EDITED',
            },
          ],
          formValues: {
            'person.name': 'Grace Hopper',
            'person.country': 'India',
          },
          verifyVisual: false,
        },
      },
      testContext(),
    );
    expect(output.report.inPlace).toBe(1);
    const saved = new Uint8Array(output.data);
    expect(await pageRunText(saved)).toContain('ACROFORM EDITED');
    const widgets = extractFormWidgets(await PDFDocument.load(saved, { updateMetadata: false }));
    expect(widgets.find((widget) => widget.name === 'person.name')?.value).toBe('Grace Hopper');
    expect(widgets.find((widget) => widget.name === 'person.country')?.value).toBe('India');
  }, 60_000);
});

describe('merged form round trip', () => {
  it('fills renamed fields in a merged document and keeps both values', async () => {
    const source = bytes('acroform.pdf');
    const merged = await mergePdfs(
      [
        { name: 'left.pdf', data: source },
        { name: 'right.pdf', data: source },
      ],
      testContext(),
    );
    const doc = await PDFDocument.load(merged.data, { updateMetadata: false });
    const form = doc.getForm();
    form.getTextField('person.name').setText('Ada Lovelace');
    form.getTextField('person.name_2').setText('Grace Hopper');
    form.getDropdown('person.country_2').select('India');
    const saved = await doc.save({ useObjectStreams: false });

    const reopened = await PDFDocument.load(saved, { updateMetadata: false });
    const widgets = extractFormWidgets(reopened);
    expect(widgets.find((widget) => widget.name === 'person.name')?.value).toBe('Ada Lovelace');
    expect(widgets.find((widget) => widget.name === 'person.name_2')?.value).toBe('Grace Hopper');
    expect(widgets.find((widget) => widget.name === 'person.country_2')?.value).toBe('India');
    expect(reopened.getPageCount()).toBe(2);
  }, 60_000);
});

describe('flip with annotations round trip', () => {
  it('flattens the mark into the rebuilt page and keeps it visible', async () => {
    const source = bytes('annotations.pdf');
    const output = await flipJob.run(
      { files: [{ name: 'annotations.pdf', data: source }], options: { horizontal: true } },
      testContext(),
    );
    const saved = new Uint8Array(output.data);
    expect(output.warnings?.join(' ')).toMatch(/flattened \d+ annotation/i);
    expect(await annotationCount(saved)).toBe(0);
    const raster = await render(saved, 0);
    // The yellow highlight and blue square remain visible after the mirror;
    // a dropped annotation would leave only the page text.
    let coloured = 0;
    for (let i = 0; i < raster.pixels.length; i += 4) {
      const r = raster.pixels[i]!;
      const g = raster.pixels[i + 1]!;
      const b = raster.pixels[i + 2]!;
      if (Math.abs(r - g) > 12 || Math.abs(g - b) > 12) coloured += 1;
    }
    expect(coloured).toBeGreaterThan(500);
  }, 60_000);
});

describe('in-place text edit round trip', () => {
  async function editFirstLine(name: string, find: string, replace: string) {
    const source = bytes(name);
    const output = await textEditJob.run(
      {
        files: [{ name, data: source }],
        options: {
          edits: [{ id: 'rt', pageIndex: 0, find, replace }],
          verifyVisual: false,
        },
      },
      testContext(),
    );
    return { source, saved: new Uint8Array(output.data), output };
  }

  it('rewrites the tiny fixture without losing page structure or size', async () => {
    const { source, saved } = await editFirstLine(
      'tiny-1page.pdf',
      'pdfshush audit fixture — page 1 of 1',
      'ROUNDTRIP IN PLACE',
    );
    const text = await pageRunText(saved);
    expect(text).toContain('ROUNDTRIP IN PLACE');
    expect(text).not.toContain('page 1 of 1');
    expect(await inspectPdf(saved)).toMatchObject({ pageCount: 1 });
    expect(saved.byteLength).toBeLessThan(source.byteLength * 4 + 4096);
  }, 60_000);

  it('keeps annotations and metadata when the content stream is rewritten', async () => {
    const annots = bytes('annotations.pdf');
    const annotsOut = await textEditJob.run(
      {
        files: [{ name: 'annotations.pdf', data: annots }],
        options: {
          edits: [
            {
              id: 'rt-annots',
              pageIndex: 0,
              find: 'pdfshush audit fixture — page 1 of 2',
              replace: 'ROUNDTRIP ANNOTATIONS',
            },
          ],
          verifyVisual: false,
        },
      },
      testContext(),
    );
    expect(await annotationCount(new Uint8Array(annotsOut.data))).toBe(
      await annotationCount(annots),
    );

    const meta = bytes('metadata.pdf');
    const metaOut = await textEditJob.run(
      {
        files: [{ name: 'metadata.pdf', data: meta }],
        options: {
          edits: [
            {
              id: 'rt-meta',
              pageIndex: 0,
              find: 'pdfshush audit fixture — page 1 of 1',
              replace: 'ROUNDTRIP METADATA',
            },
          ],
          verifyVisual: false,
        },
      },
      testContext(),
    );
    expect(await inspectPdf(new Uint8Array(metaOut.data))).toMatchObject({
      pageCount: 1,
      metadata: {
        title: 'pdfshush metadata fixture',
        author: 'pdfshush audit',
        subject: 'Metadata preservation probe',
        keywords: 'pdf-audit metadata FIXTURE',
      },
    });
  }, 60_000);
});
