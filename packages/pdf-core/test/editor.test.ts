/**
 * Phase 2 (editor) engine tests: display-space geometry against the real
 * pdf.js viewport, text-run extraction/clustering, the edit op (rotation,
 * wrapping, validation), AcroForm extract/apply, and both new jobs.
 */

import { PDFDocument, PDFName, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
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
  imagePixelSize,
  parseHexColor,
  TEXT_ASCENT,
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
    // pdf.js reports the item box as one em tall above the baseline, so the
    // baseline we drew -- box top + TEXT_ASCENT -- must show up as
    // `run.y + run.fontSize`. This is the WYSIWYG contract: the CSS preview puts
    // its first baseline at the same offset.
    expect(run!.y + run!.fontSize).toBeCloseTo(40 + 18 * TEXT_ASCENT, 1);
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

/* ------------------------------------------------------------- P2 audit */

describe('edit object validation (hostile input)', () => {
  it('rejects non-finite geometry before any operator is emitted', () => {
    expect(() => validateEditObjects([textObject({ x: Number.NaN })], 1)).toThrow(/finite numbers/);
    expect(() => validateEditObjects([textObject({ height: Number.POSITIVE_INFINITY })], 1)).toThrow(
      /finite numbers/,
    );
  });

  it('rejects duplicate ids (they key selection and React lists)', () => {
    expect(() =>
      validateEditObjects([textObject({ id: 'dup' }), textObject({ id: 'dup' })], 1),
    ).toThrow(/duplicate object id "dup"/);
  });

  it('rejects objects dragged entirely off the page', () => {
    const pageSize = (): { width: number; height: number } => ({ width: 595, height: 842 });
    const off = textObject({ x: 5000, y: 5000 });
    expect(() => validateEditObjects([off], 1, pageSize)).toThrow(/off page 1/);
    // but a little overhang is fine (whiteouts at the edge are normal)
    expect(() => validateEditObjects([textObject({ x: -40, y: -20 })], 1, pageSize)).not.toThrow();
  });

  it('caps runaway text and absurd font sizes', () => {
    expect(() =>
      validateEditObjects([textObject({ text: 'x'.repeat(20_001) })], 1),
    ).toThrow(/too long/);
    expect(() => validateEditObjects([textObject({ fontSize: Number.NaN })], 1)).toThrow(/font size/);
    expect(() => validateEditObjects([textObject({ fontSize: 5000 })], 1)).toThrow(/font size/);
  });

  it('rejects unusable images by type, size and pixel count', () => {
    const bytes = new Uint8Array(pngHeader(9000, 20));
    const base = { kind: 'image', pageIndex: 0, x: 10, y: 10, width: 20, height: 20 } as const;
    expect(() =>
      validateEditObjects([{ ...base, id: 'i1', mimeType: 'image/gif', data: bytes } as EditorObject], 1),
    ).toThrow(/PNG or JPEG only/);
    expect(() =>
      validateEditObjects([{ ...base, id: 'i1', mimeType: 'image/png', data: new Uint8Array(0) } as EditorObject], 1),
    ).toThrow(/image data is empty/);
    expect(() =>
      validateEditObjects([{ ...base, id: 'i1', mimeType: 'image/png', data: bytes } as EditorObject], 1),
    ).toThrow(/exceeds the 8192 px limit/);
  });

  it('rejects malformed colours and stroke widths instead of drawing garbage', () => {
    const shape = { kind: 'rect', pageIndex: 0, x: 10, y: 10, width: 50, height: 40 } as const;
    expect(() =>
      validateEditObjects([{ ...shape, id: 'r1', stroke: 'url(#x)' } as EditorObject], 1),
    ).toThrow(/hex colour/);
    expect(() =>
      validateEditObjects([{ ...shape, id: 'r1', strokeWidth: Number.NaN } as EditorObject], 1),
    ).toThrow(/stroke width/);
  });
});

describe('image pixel probing', () => {
  it('reads PNG and JPEG dimensions straight from the header', () => {
    expect(imagePixelSize(new Uint8Array(pngHeader(120, 45)), 'image/png')).toEqual({
      width: 120,
      height: 45,
    });
    expect(imagePixelSize(new Uint8Array(jpegHeader(300, 200)), 'image/jpeg')).toEqual({
      width: 300,
      height: 200,
    });
  });

  it('returns null for anything that is not really that format', () => {
    expect(imagePixelSize(new Uint8Array([1, 2, 3, 4]), 'image/png')).toBeNull();
    expect(imagePixelSize(new Uint8Array([0xff, 0xd8, 0x00, 0x00]), 'image/jpeg')).toBeNull();
  });
});

describe('editing efficiency', () => {
  it('embeds a repeated image once, not once per object', async () => {
    const embedCount = async (ids: string[]): Promise<number> => {
      const doc = await PDFDocument.create();
      doc.addPage([300, 300]);
      await applyEdits(
        doc,
        ids.map((id, index) => ({
          id,
          kind: 'image',
          pageIndex: 0,
          x: 10 + index * 50,
          y: 10,
          width: 40,
          height: 40,
          data: ONE_PIXEL_PNG,
          mimeType: 'image/png',
        })),
        testContext(),
      );
      // A PNG with alpha becomes two XObjects (image + soft mask), so compare
      // counts rather than pinning pdf-lib's internals.
      return countMatches(
        new TextDecoder('latin1').decode(await doc.save({ useObjectStreams: false })),
        '/Subtype /Image',
      );
    };

    const single = await embedCount(['a']);
    const triple = await embedCount(['a', 'b', 'c']);
    expect(triple).toBe(single);
  });
});

describe('form fixes', () => {
  it('really clears a dropdown when the user empties it', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const dropdown = doc.getForm().createDropdown('country');
    dropdown.setOptions(['US', 'FR', 'JP']);
    dropdown.addToPage(page, { x: 20, y: 200, width: 120, height: 20 });
    dropdown.select('FR');

    applyFormValues(doc, { country: '' });

    const reloaded = await PDFDocument.load(await doc.save({ useObjectStreams: false }));
    expect(reloaded.getForm().getDropdown('country').getSelected()).toEqual([]);
  });

  it('places widgets on the page their /P entry names, even at identical rects', async () => {
    const doc = await PDFDocument.create();
    const first = doc.addPage([300, 300]);
    const second = doc.addPage([300, 300]);
    const form = doc.getForm();
    const rect = { x: 40, y: 100, width: 120, height: 20 };

    const one = form.createTextField('first');
    one.addToPage(first, rect);
    const two = form.createTextField('second');
    two.addToPage(second, rect);
    // Real writers (Word, Acrobat, LibreOffice) record the owning page in /P;
    // pdf-lib does not, so set it the way a viewer would find it.
    stampPageRef(one.acroField.getWidgets()[0], first.ref);
    stampPageRef(two.acroField.getWidgets()[0], second.ref);

    const widgets = extractFormWidgets(doc);
    expect(widgets.find((w) => w.name === 'first')?.pageIndex).toBe(0);
    expect(widgets.find((w) => w.name === 'second')?.pageIndex).toBe(1);
  });
});

describe('text-run clustering edge cases', () => {
  it('still merges a line when a vertical item sorts between its fragments', () => {
    const runs = clusterTextRuns([
      { text: 'Hello', fontSize: 12, x: 10, y: 100, width: 40, height: 14, horizontal: true, line: 110 },
      { text: '|', fontSize: 12, x: 200, y: 20, width: 12, height: 200, horizontal: false, line: 105 },
      { text: 'world', fontSize: 12, x: 56, y: 100, width: 42, height: 14, horizontal: true, line: 110.4 },
    ]);
    const joined = runs.filter((run) => run.horizontal).map((run) => run.text);
    expect(joined).toEqual(['Hello world']);
    expect(runs.filter((run) => !run.horizontal).map((run) => run.text)).toEqual(['|']);
  });

  it('keeps zero-width items in the line they belong to', () => {
    const runs = clusterTextRuns([
      { text: 'ab', fontSize: 12, x: 10, y: 100, width: 0, height: 14, horizontal: true, line: 110 },
      { text: 'cd', fontSize: 12, x: 10, y: 100, width: 24, height: 14, horizontal: true, line: 110.2 },
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe('abcd');
    expect(runs[0]!.width).toBe(24);
  });
});

describe('edit job output naming', () => {
  it('refuses to take a path from an untrusted name', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    const run = (outputName: string) =>
      editJob.run(
        { files: [{ name: 'alpha.pdf', data: source }], options: { outputName } },
        testContext(),
      );
    expect((await run('../../etc/passwd')).name).toBe('passwd.pdf');
    expect((await run('C:\\windows\\system32\\evil')).name).toBe('evil.pdf');
    expect((await run('..')).name).toBe('alpha-edited.pdf');
    expect((await run('   ')).name).toBe('alpha-edited.pdf');
    expect((await run('report')).name).toBe('report.pdf');
  });
});

/* ---------------------------------------------------------------- helpers */

const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (char) => char.charCodeAt(0),
);

function countMatches(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Minimal PNG header (signature + IHDR) with the given pixel dimensions. */
function pngHeader(width: number, height: number): number[] {
  const bytes = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 0,
    0, 0, 0, 0,
  ];
  const view = new DataView(Uint8Array.from(bytes).buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return Array.from(new Uint8Array(view.buffer));
}

/** JPEG start-of-frame marker carrying the given dimensions. */
function jpegHeader(width: number, height: number): number[] {
  return [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00,
    0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff,
    width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
}

/** Writes an owning page reference onto a widget annotation, like real PDFs. */
function stampPageRef(
  widget: unknown,
  ref: unknown,
): void {
  const dict = (widget as { getDictionary?: () => { set: (key: unknown, value: unknown) => void } })
    .getDictionary?.();
  dict?.set(PDFName.of('P'), ref);
}
