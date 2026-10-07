/**
 * Phase 2 (editor) engine tests: display-space geometry against the real
 * pdf.js viewport, text-run extraction/clustering, the edit op (rotation,
 * wrapping, validation), AcroForm extract/apply, and both new jobs.
 */

import { PDFDocument, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import {
  displaySize,
  geomFromBoxes,
  pageGeom,
  pdfRectToView,
  pdfToView,
  viewRectToPdf,
  viewToPdf,
} from '../src/ops/geometry.js';
import {
  applyEdits,
  parseHexColor,
  validateEditObjects,
  validateExport,
  wrapTextToWidth,
  type EditorObject,
} from '../src/ops/edit.js';
import { applyFormValues, extractFormWidgets } from '../src/ops/forms.js';
import { inspectPdf } from '../src/ops/pages.js';
import { clusterTextRuns, extractTextRuns, type RunItem } from '../src/render/textRuns.js';
import { configurePdfjsRuntime, loadPdfForRender } from '../src/render/pdfjsRuntime.js';
import { editJob, type EditJobInput } from '../src/jobs/edit.job.js';
import { textRunsJob } from '../src/jobs/textRuns.job.js';
import { makeFixturePdf, testContext } from './fixtures.js';
import { pdfContainsText } from './helpers.js';

// pdf.js must know where its worker lives, even under Node (fake worker).
configurePdfjsRuntime({
  workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href,
});

/** 1x1 transparent PNG. */
const TINY_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

async function docWithText(pageCount = 1): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Invoice number ${i + 1}`, { x: 72, y: 770, size: 18, font, color: rgb(0, 0, 0) });
    page.drawText('Second line here', { x: 72, y: 740, size: 12, font, color: rgb(0, 0, 0) });
  }
  return doc;
}

async function makeFormDoc(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();

  const textField = form.createTextField('applicant.name');
  textField.addToPage(page, { x: 72, y: 700, width: 200, height: 24 });

  const checkBox = form.createCheckBox('agree.terms');
  checkBox.addToPage(page, { x: 72, y: 650, width: 16, height: 16 });

  const dropdown = form.createDropdown('city');
  dropdown.setOptions(['Paris', 'Tokyo']);
  dropdown.addToPage(page, { x: 72, y: 600, width: 140, height: 24 });

  const radio = form.createRadioGroup('color');
  radio.addOptionToPage('red', page, { x: 300, y: 650, width: 14, height: 14 });
  radio.addOptionToPage('blue', page, { x: 330, y: 650, width: 14, height: 14 });

  return doc;
}

function textObject(partial: Partial<Extract<EditorObject, { kind: 'text' }>> = {}): EditorObject {
  return {
    kind: 'text',
    id: 't1',
    pageIndex: 0,
    x: 70,
    y: 50,
    width: 200,
    height: 30,
    text: 'Replacement',
    fontSize: 18,
    ...partial,
  } as EditorObject;
}

describe('editor geometry', () => {
  it('swaps display size on quarter-turn pages', () => {
    const base = geomFromBoxes({ x: 0, y: 0, width: 600, height: 800 }, 0);
    expect(displaySize(base)).toEqual({ width: 600, height: 800 });
    const rotated = geomFromBoxes({ x: 0, y: 0, width: 600, height: 800 }, 90);
    expect(displaySize(rotated)).toEqual({ width: 800, height: 600 });
  });

  it('roundtrips display <-> PDF space on every rotation', () => {
    const samples: [number, number][] = [
      [0, 0],
      [400, 500],
      [123.5, 77.25],
    ];
    for (const rot of [0, 90, 180, 270]) {
      const g = geomFromBoxes({ x: 50, y: 60, width: 400, height: 500 }, rot);
      for (const [vx, vy] of samples) {
        const [x, y] = viewToPdf(g, vx, vy);
        const [backX, backY] = pdfToView(g, x, y);
        expect(backX).toBeCloseTo(vx, 6);
        expect(backY).toBeCloseTo(vy, 6);
      }
    }
  });

  it('agrees with the pdf.js viewport (rotation + crop box)', async () => {
    for (const rotation of [0, 90, 180, 270]) {
      for (const cropped of [false, true]) {
        const doc = await PDFDocument.create();
        const page = doc.addPage([600, 800]);
        if (cropped) page.setCropBox(50, 60, 400, 500);
        page.setRotation(degrees(rotation));
        const bytes = await doc.save();

        const loaded = await loadPdfForRender(bytes);
        try {
          const pdfPage = await loaded.doc.getPage(1);
          const viewport = pdfPage.getViewport({ scale: 1 });
          const g = pageGeom(page);
          const size = displaySize(g);
          expect(viewport.width).toBeCloseTo(size.width, 3);
          expect(viewport.height).toBeCloseTo(size.height, 3);

          const corners: [number, number][] = [
            [g.x0, g.y0],
            [g.x1, g.y1],
            [(g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2],
          ];
          for (const [x, y] of corners) {
            const viaPdfjs = viewport.convertToViewportPoint(x, y);
            const [vx, vy] = pdfToView(g, x, y);
            expect(vx).toBeCloseTo(viaPdfjs[0] ?? NaN, 4);
            expect(vy).toBeCloseTo(viaPdfjs[1] ?? NaN, 4);
          }
        } finally {
          await loaded.destroy();
        }
      }
    }
  });

  it('maps display rects to normalized PDF boxes (rotation-aware)', () => {
    const g = geomFromBoxes({ x: 0, y: 0, width: 595, height: 842 }, 0);
    expect(viewRectToPdf(g, { x: 100, y: 200, width: 50, height: 40 })).toEqual({
      x: 100,
      y: 842 - 240,
      width: 50,
      height: 40,
    });

    const rotated = geomFromBoxes({ x: 0, y: 0, width: 595, height: 842 }, 90);
    const box = viewRectToPdf(rotated, { x: 10, y: 20, width: 30, height: 40 });
    // Corners map first, so w/h swap on the quarter turn.
    expect(box.width).toBeCloseTo(40, 6);
    expect(box.height).toBeCloseTo(30, 6);
    const back = pdfRectToView(rotated, box);
    expect(back.x).toBeCloseTo(10, 6);
    expect(back.y).toBeCloseTo(20, 6);
    expect(back.width).toBeCloseTo(30, 6);
    expect(back.height).toBeCloseTo(40, 6);
  });
});

describe('text runs', () => {
  it('merges fragments on one line and keeps lines apart', () => {
    const items: RunItem[] = [
      { text: 'Hello', fontSize: 12, x: 10, y: 20, width: 30, height: 15, horizontal: true, line: 32 },
      { text: 'world', fontSize: 12, x: 44, y: 20, width: 30, height: 15, horizontal: true, line: 32 },
      { text: 'Next', fontSize: 12, x: 10, y: 40, width: 30, height: 15, horizontal: true, line: 52 },
    ];
    const runs = clusterTextRuns(items);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.text).toBe('Hello world');
    expect(runs[0]!.x).toBe(10);
    expect(runs[0]!.width).toBeCloseTo(64, 6);
    expect(runs[1]!.text).toBe('Next');
    expect(runs[0]!.horizontal).toBe(true);
  });

  it('joins touching fragments without inserting a space', () => {
    const items: RunItem[] = [
      { text: 'Invo', fontSize: 12, x: 10, y: 20, width: 20, height: 15, horizontal: true, line: 32 },
      { text: 'ice', fontSize: 12, x: 30, y: 20, width: 20, height: 15, horizontal: true, line: 32 },
    ];
    expect(clusterTextRuns(items)[0]!.text).toBe('Invoice');
  });

  it('never merges stacked lines at normal leading', () => {
    // 12pt text at 1.2 leading: boxes are 15pt tall, 14.4pt apart.
    const items: RunItem[] = [
      { text: 'Line one', fontSize: 12, x: 10, y: 20, width: 60, height: 15, horizontal: true, line: 32 },
      { text: 'Line two', fontSize: 12, x: 10, y: 34.4, width: 60, height: 15, horizontal: true, line: 46.4 },
    ];
    expect(clusterTextRuns(items)).toHaveLength(2);
  });

  it('keeps vertical columns apart', () => {
    const items: RunItem[] = [
      { text: 'A', fontSize: 12, x: 10, y: 10, width: 15, height: 20, horizontal: false, line: 10 },
      { text: 'B', fontSize: 12, x: 10, y: 30, width: 15, height: 20, horizontal: false, line: 10 },
      { text: 'C', fontSize: 12, x: 40, y: 10, width: 15, height: 20, horizontal: false, line: 40 },
    ];
    const runs = clusterTextRuns(items);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.text).toBe('AB');
    expect(runs[1]!.text).toBe('C');
  });

  it('extracts display-space runs from a real document', async () => {
    const doc = await docWithText();
    const bytes = await doc.save();
    const runs = await extractTextRuns(bytes, [0], testContext());
    expect(runs).toHaveLength(1);
    const page = runs[0]!;
    expect(page.map((r) => r.text)).toEqual(['Invoice number 1', 'Second line here']);

    const first = page[0]!;
    expect(first.fontSize).toBeCloseTo(18, 3);
    expect(first.x).toBeCloseTo(72, 1); // left edge
    expect(first.y).toBeCloseTo(842 - 770 - 18, 1); // ascender top, y down
    expect(first.width).toBeGreaterThan(100);
    expect(first.height).toBeCloseTo(18 * 1.25, 1);
    expect(first.width).toBeLessThan(300);
    expect(page[1]!.fontSize).toBeCloseTo(12, 3);
  });

  it('extracts runs on a /Rotate 90 page in display space', async () => {
    const doc = await docWithText();
    doc.getPage(0).setRotation(degrees(90));
    const bytes = await doc.save();

    const g = pageGeom(doc.getPage(0));
    const runs = await extractTextRuns(bytes, [0], testContext());
    const first = runs[0]!.find((r) => r.text.includes('Invoice'));
    expect(first).toBeDefined();

    expect(first!.horizontal).toBe(false); // reads downward once rotated
    // Cross-check against our own geometry: baseline start (72,770) in display.
    const [vx, vy] = pdfToView(g, 72, 770);
    expect(first!.x).toBeGreaterThan(vx - first!.height - 2);
    expect(first!.x + first!.width).toBeGreaterThan(vx - 2);
    expect(first!.y).toBeCloseTo(vy, 1);
  });

  it('rejects page indexes outside the document', async () => {
    const doc = await docWithText();
    const bytes = await doc.save();
    await expect(extractTextRuns(bytes, [5], testContext())).rejects.toThrow(/Page 6 does not exist/);
  });
});

describe('edit op', () => {
  it('wraps text to the object box using real font metrics', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    const lines = wrapTextToWidth(
      font,
      'The quick brown fox jumps over the lazy dog again and again',
      12,
      120,
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 12)).toBeLessThanOrEqual(120);
    }
    expect(lines.join(' ')).toContain('quick brown fox');

    expect(wrapTextToWidth(font, 'one\ntwo', 12, 500)).toEqual(['one', 'two']);
    const hard = wrapTextToWidth(font, 'A'.repeat(80), 12, 40);
    expect(hard.length).toBeGreaterThan(1);
    expect(hard.every((l) => font.widthOfTextAtSize(l, 12) <= 40 || l.length === 1)).toBe(true);
  });

  it('parses hex colours with clamping and fallback', () => {
    const red = parseHexColor('#ff0000', rgb(0, 0, 0));
    expect(red.red).toBeCloseTo(1);
    expect(red.green).toBeCloseTo(0);
    const short = parseHexColor('0f0', rgb(0, 0, 0));
    expect(short.green).toBeCloseTo(1);
    const fallback = parseHexColor('not-a-colour', rgb(0.2, 0.4, 0.6));
    expect(fallback.red).toBeCloseTo(0.2);
    expect(parseHexColor(undefined, rgb(1, 1, 1)).blue).toBeCloseTo(1);
  });

  it('rejects objects pointing at missing pages', () => {
    const bad = textObject({ pageIndex: 3 });
    expect(() => validateEditObjects([bad], 2)).toThrow(/Page 4 does not exist/);
    expect(() => validateEditObjects([textObject()], 2)).not.toThrow();
  });

  it('draws text, whiteouts and markup, then validates its own export', async () => {
    const doc = await docWithText(2);
    const objects: EditorObject[] = [
      { id: 'w', kind: 'whiteout', pageIndex: 0, x: 70, y: 50, width: 240, height: 26 },
      textObject({ id: 't', text: 'Replaced content', x: 72, y: 52 }),
      { id: 'h', kind: 'highlight', pageIndex: 0, x: 70, y: 100, width: 120, height: 16, color: '#ffe066' },
      { id: 's', kind: 'strikeout', pageIndex: 0, x: 70, y: 130, width: 120, height: 16 },
      { id: 'u', kind: 'underline', pageIndex: 1, x: 70, y: 160, width: 120, height: 16 },
      { id: 'r', kind: 'rect', pageIndex: 1, x: 300, y: 300, width: 80, height: 50, stroke: '#111827', fill: '#dbeafe', strokeWidth: 2 },
      { id: 'e', kind: 'ellipse', pageIndex: 1, x: 400, y: 300, width: 60, height: 60, stroke: '#111827' },
      { id: 'l', kind: 'arrow', pageIndex: 1, x: 300, y: 400, width: 90, height: 40, reverse: true },
      { id: 'i', kind: 'image', pageIndex: 0, x: 400, y: 600, width: 40, height: 40, data: TINY_PNG, mimeType: 'image/png' },
    ];
    await applyEdits(doc, objects, testContext());

    const saved = await doc.save({ useObjectStreams: false });
    await expect(validateExport(saved, 2)).resolves.toBeUndefined();
    expect(pdfContainsText(saved, 'Replaced content')).toBe(true);

    const reloaded = await PDFDocument.load(saved, { throwOnInvalidObject: true });
    expect(reloaded.getPageCount()).toBe(2);
  });

  it('rotates text on /Rotate 90 pages so it reads horizontally in display', async () => {
    const doc = await docWithText(1);
    doc.getPage(0).setRotation(degrees(90));
    const display = displaySize(pageGeom(doc.getPage(0)));

    await applyEdits(
      doc,
      [
        {
          id: 't',
          kind: 'text',
          pageIndex: 0,
          x: 40,
          y: 40,
          width: 200,
          height: 30,
          text: 'ROTATED MARK',
          fontSize: 18,
        },
      ],
      testContext(),
    );
    const saved = await doc.save({ useObjectStreams: false });

    const runs = await extractTextRuns(saved, [0], testContext());
    const run = runs[0]!.find((r) => r.text.includes('ROTATED'));
    expect(run).toBeDefined();
    expect(run!.horizontal).toBe(true); // reads left-to-right in the viewer
    expect(run!.x).toBeCloseTo(40, 0);
    expect(run!.y).toBeCloseTo(40, 0);
    expect(run!.fontSize).toBeCloseTo(18, 1);
    // and stays inside the displayed page
    expect(run!.x + run!.width).toBeLessThanOrEqual(display.width + 1);
  });

  it('validateExport rejects truncated bytes and a changed page count', async () => {
    const doc = await docWithText(1);
    const saved = await doc.save();
    await expect(validateExport(saved, 1)).resolves.toBeUndefined();
    await expect(validateExport(saved, 2)).rejects.toThrow(/expected 2 pages, found 1/);

    const truncated = saved.subarray(0, saved.length - 120);
    await expect(validateExport(truncated, 1)).rejects.toThrow(/Export validation failed/);
  });
});

describe('form fill', () => {
  it('extracts widgets with display-space rects and current values', async () => {
    const doc = await makeFormDoc();
    const widgets = extractFormWidgets(doc);

    const names = widgets.map((w) => w.name);
    expect(names).toContain('applicant.name');
    expect(names).toContain('agree.terms');
    expect(names).toContain('city');
    expect(names).toContain('color');

    const textField = widgets.find((w) => w.name === 'applicant.name')!;
    expect(textField.type).toBe('text');
    expect(textField.pageIndex).toBe(0);
    // pdf-lib grows the widget rect by half the border on every side:
    // (72,700)+200x24 with a 1pt border -> (71.5, 699.5)+201x25 on an
    // 842pt-tall page, i.e. display y = 842 - 724.5.
    expect(textField.rect.x).toBeCloseTo(71.5, 1);
    expect(textField.rect.y).toBeCloseTo(842 - 724.5, 1);
    expect(textField.rect.width).toBeCloseTo(201, 1);
    expect(textField.rect.height).toBeCloseTo(25, 1);

    const dropdown = widgets.find((w) => w.name === 'city')!;
    expect(dropdown.options).toEqual(['Paris', 'Tokyo']);

    const radios = widgets.filter((w) => w.name === 'color');
    expect(radios).toHaveLength(2);
    expect(radios.map((r) => r.option).sort()).toEqual(['blue', 'red']);
    expect(radios.every((r) => r.value === false)).toBe(true);
  });

  it('applies values that survive a save/reload round trip', async () => {
    const doc = await makeFormDoc();
    applyFormValues(doc, {
      'applicant.name': 'Ada Lovelace',
      'agree.terms': true,
      city: 'Tokyo',
      color: 'blue',
    });
    const saved = await doc.save({ useObjectStreams: false });

    const reloaded = await PDFDocument.load(saved);
    const form = reloaded.getForm();
    expect(form.getTextField('applicant.name').getText()).toBe('Ada Lovelace');
    expect(form.getCheckBox('agree.terms').isChecked()).toBe(true);
    expect(form.getDropdown('city').getSelected()).toEqual(['Tokyo']);
    expect(form.getRadioGroup('color').getSelected()).toBe('blue');
  });

  it('fails loudly on unknown field names', async () => {
    const doc = await makeFormDoc();
    expect(() => applyFormValues(doc, { 'no.such.field': 'x' })).toThrow(
      /Form field "no.such.field" does not exist/,
    );
  });

  it('inspect reports fields and display sizes', async () => {
    const doc = await makeFormDoc();
    const info = await inspectPdf(await doc.save());
    expect(info.pages[0]!.displayWidthPt).toBe(595);
    expect(info.pages[0]!.displayHeightPt).toBe(842);
    expect(info.fields.length).toBe(5); // text + checkbox + dropdown + 2 radio dots
    expect(info.fields.map((f) => f.name)).toContain('applicant.name');
  });
});

describe('edit job', () => {
  function input(objects: EditorObject[], files = 1): EditJobInput {
    return {
      files: Array.from({ length: files }, (_, i) => ({
        name: `doc-${i}.pdf`,
        data: new Uint8Array([1, 2, 3]),
      })),
      options: { objects },
    };
  }

  it('validates file count and the object flood limit', () => {
    expect(editJob.validate(input([], 0)).ok).toBe(false);
    expect(editJob.validate(input([], 2)).ok).toBe(false);
    expect(editJob.validate(input([])).ok).toBe(true);

    const flood = Array.from({ length: 2001 }, (_, i) => textObject({ id: `o${i}` }));
    const result = editJob.validate(input(flood));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues[0]!.message).toMatch(/Too many objects/);
  });

  it('applies edits, validates output and names the result', async () => {
    const source = await makeFixturePdf({ pages: 3, label: 'Alpha' });
    const output = await editJob.run(
      {
        files: [{ name: 'alpha.pdf', data: source }],
        options: {
          objects: [
            textObject({ id: 't', pageIndex: 1, text: 'Hello editor', x: 100, y: 100 }),
            { id: 'h', kind: 'highlight', pageIndex: 1, x: 90, y: 90, width: 150, height: 24 },
          ],
        },
      },
      testContext(),
    );

    expect(output.name).toBe('alpha-edited.pdf');
    expect(output.pageCount).toBe(3);
    expect(output.validated).toBe(true);

    const bytes = new Uint8Array(output.data);
    expect(pdfContainsText(bytes, 'Hello editor')).toBe(true);
    const reloaded = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
    expect(reloaded.getPageCount()).toBe(3);
  });

  it('honors an explicit output name', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    const output = await editJob.run(
      { files: [{ name: 'alpha.pdf', data: source }], options: { outputName: ' final.pdf ' } },
      testContext(),
    );
    expect(output.name).toBe('final.pdf');
  });

  it('fails on an unknown form field instead of saving a lie', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    await expect(
      editJob.run(
        { files: [{ name: 'a.pdf', data: source }], options: { formValues: { ghost: 'x' } } },
        testContext(),
      ),
    ).rejects.toThrow(/Form field "ghost" does not exist/);
  });
});

describe('text-runs job', () => {
  it('returns runs only for the requested pages, in order', async () => {
    const source = await makeFixturePdf({ pages: 3, label: 'Alpha' });
    const output = await textRunsJob.run(
      { files: [{ name: 'alpha.pdf', data: source }], options: { pageIndexes: [1, 0] } },
      testContext(),
    );
    expect(output.runs).toHaveLength(2);
    expect(output.runs[0]!.length).toBeGreaterThan(0);
    expect(output.runs[0]![0]!.text).toContain('page 2');
    expect(output.runs[1]![0]!.text).toContain('page 1');
  });
});
