/**
 * Authoring batch (2026-10-26): Create Forms and Create Bookmarks.
 *
 * As with every earlier batch, the produced bytes are re-opened instead of
 * trusting the job's return value: forms through pdf-lib's form API and the
 * display-space extractor, outlines through pdf.js -- the same reader Split by
 * bookmarks uses. Suggestion tests build text runs by hand, so the heuristic is
 * tested without a renderer.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import { createBookmarksJob } from '../src/jobs/createBookmarks.job.js';
import { createFormsJob } from '../src/jobs/createForms.job.js';
import { addFormFields } from '../src/ops/formFields.js';
import { extractFormWidgets } from '../src/ops/forms.js';
import { writeOutline } from '../src/ops/outlineWrite.js';
import { extractOutline } from '../src/render/outline.js';
import { configurePdfjsRuntime } from '../src/render/pdfjsRuntime.js';
import { suggestBookmarks } from '../src/render/suggestBookmarks.js';
import type { TextRun } from '../src/render/textRuns.js';
import { makeFixturePdf, testContext } from './fixtures.js';
import { pdfContainsText } from './helpers.js';

beforeAll(() => {
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href,
  });
});

function inputFor(file: Uint8Array, options: Record<string, unknown> = {}, name = 'doc.pdf') {
  return { files: [{ name, data: file }], options };
}

/* ------------------------------------------------------------------- forms */

describe('adding form fields', () => {
  test('writes text fields and checkboxes that survive a save', async () => {
    const source = await makeFixturePdf({ pages: 2, label: 'Forms' });
    const doc = await PDFDocument.load(source);

    const count = addFormFields(doc, [
      {
        type: 'text',
        name: 'full_name',
        pageIndex: 0,
        x: 40,
        y: 60,
        width: 200,
        height: 24,
        fontSize: 11,
        required: true,
        defaultValue: 'Ada Lovelace',
      },
      { type: 'checkbox', name: 'agree', pageIndex: 1, x: 40, y: 80, width: 16, height: 16, checked: true },
    ]);
    expect(count).toBe(2);

    const bytes = await doc.save({ useObjectStreams: false });
    const reopened = await PDFDocument.load(bytes);
    const form = reopened.getForm();
    expect(form.getFields().map((field) => field.getName()).sort()).toEqual(['agree', 'full_name']);

    const text = form.getTextField('full_name');
    expect(text.getText()).toBe('Ada Lovelace');
    expect(text.isRequired()).toBe(true);
    expect(text.acroField.getDefaultAppearance()).toMatch(/11(\.0+)? Tf/);

    const checkbox = form.getCheckBox('agree');
    expect(checkbox.isChecked()).toBe(true);
    expect(checkbox.isRequired()).toBe(false);
  });

  test('places a field on a rotated page in display space', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    page.setRotation(degrees(90));

    addFormFields(doc, [
      { type: 'text', name: 'rotated', pageIndex: 0, x: 10, y: 20, width: 120, height: 24 },
    ]);
    const bytes = await doc.save({ useObjectStreams: false });

    const reopened = await PDFDocument.load(bytes);
    const widgets = extractFormWidgets(reopened);
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.name).toBe('rotated');
    // pdf-lib expands a widget by half its border width on each side, so the
    // rectangle comes back one point wider/taller and half a point offset.
    expect(Math.abs(widgets[0]!.rect.x - 10)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(widgets[0]!.rect.y - 20)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(widgets[0]!.rect.width - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(widgets[0]!.rect.height - 24)).toBeLessThanOrEqual(1);

    // 90 degrees means the display width is the page's original height (300).
    const second = await PDFDocument.load(bytes);
    expect(() =>
      addFormFields(second, [
        { type: 'text', name: 'too_far', pageIndex: 0, x: 250, y: 20, width: 100, height: 24 },
      ]),
    ).toThrow(/inside page 1/i);
  });

  test('extends an existing form without touching its fields', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const form = doc.getForm();
    form.createTextField('existing').addToPage(page, { x: 20, y: 20, width: 100, height: 20 });
    const source = await doc.save();

    const reopened = await PDFDocument.load(source);
    addFormFields(reopened, [
      { type: 'checkbox', name: 'added', pageIndex: 0, x: 200, y: 20, width: 16, height: 16 },
    ]);

    const bytes = await reopened.save({ useObjectStreams: false });
    const result = await PDFDocument.load(bytes);
    expect(result.getForm().getFields().map((field) => field.getName()).sort()).toEqual([
      'added',
      'existing',
    ]);
  });

  test('rejects duplicate and colliding names before creating anything', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    const doc = await PDFDocument.load(source);

    expect(() =>
      addFormFields(doc, [
        { type: 'text', name: 'name', pageIndex: 0, x: 20, y: 20, width: 100, height: 20 },
        { type: 'text', name: 'name', pageIndex: 0, x: 20, y: 60, width: 100, height: 20 },
      ]),
    ).toThrow(/used twice/i);
    expect(doc.getForm().getFields()).toHaveLength(0);

    addFormFields(doc, [
      { type: 'text', name: 'taken', pageIndex: 0, x: 20, y: 20, width: 100, height: 20 },
    ]);
    expect(() =>
      addFormFields(doc, [
        { type: 'checkbox', name: 'taken', pageIndex: 0, x: 20, y: 60, width: 16, height: 16 },
      ]),
    ).toThrow(/already exists/i);
  });

  test('refuses names, geometry and values that would produce a broken form', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    const base = { type: 'text' as const, pageIndex: 0, x: 20, y: 20, width: 100, height: 20 };

    const cases: { fields: Parameters<typeof addFormFields>[1]; error: RegExp }[] = [
      { fields: [{ ...base, name: '' }], error: /needs a name/i },
      { fields: [{ ...base, name: 'bad/name' }], error: /may only use/i },
      { fields: [{ ...base, name: 'x'.repeat(65) }], error: /too long/i },
      { fields: [{ ...base, name: 'tiny', width: 4, height: 4 }], error: /too small/i },
      { fields: [{ ...base, name: 'off', x: 500, width: 200 }], error: /inside page 1/i },
      { fields: [{ ...base, name: 'page', pageIndex: 9 }], error: /does not exist/i },
      { fields: [{ ...base, name: 'size', fontSize: 100 }], error: /font size between/i },
      {
        fields: [
          { type: 'checkbox', name: 'check', pageIndex: 0, x: 20, y: 20, width: 16, height: 16 },
          { type: 'checkbox', name: 'check', pageIndex: 0, x: 40, y: 20, width: 16, height: 16 },
        ],
        error: /used twice/i,
      },
    ];

    for (const testCase of cases) {
      const doc = await PDFDocument.load(source);
      expect(() => addFormFields(doc, testCase.fields)).toThrow(testCase.error);
      expect(doc.getForm().getFields()).toHaveLength(0);
    }
  });

  test('caps one batch at the configured field count', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    const doc = await PDFDocument.load(source);
    const fields = Array.from({ length: 501 }, (_, index) => ({
      type: 'checkbox' as const,
      name: `check_${index}`,
      pageIndex: 0,
      x: 10,
      y: 10,
      width: 8,
      height: 8,
    }));
    expect(() => addFormFields(doc, fields)).toThrow(/at most 500/i);
  });
});

describe('create forms job', () => {
  test('returns a fillable copy with the fields and the original content', async () => {
    const source = await makeFixturePdf({ pages: 2, label: 'Forms' });
    const result = await createFormsJob.run(
      inputFor(source, {
        fields: [
          {
            type: 'text',
            name: 'customer_name',
            pageIndex: 0,
            x: 40,
            y: 60,
            width: 220,
            height: 24,
          },
          { type: 'checkbox', name: 'consent', pageIndex: 1, x: 40, y: 90, width: 16, height: 16 },
        ],
      }),
      testContext(),
    );

    expect(result.fileName).toBe('doc-fillable.pdf');
    expect(result.fieldCount).toBe(2);
    expect(result.pageCount).toBe(2);

    const reopened = await PDFDocument.load(result.data);
    expect(reopened.getForm().getFields().map((field) => field.getName()).sort()).toEqual([
      'consent',
      'customer_name',
    ]);
    expect(pdfContainsText(new Uint8Array(result.data), 'Forms page 2')).toBe(true);
  });

  test('validates the request before loading a document', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    expect(createFormsJob.validate(inputFor(source, { fields: [] })).ok).toBe(false);
    expect(createFormsJob.validate(inputFor(source, {})).ok).toBe(false);
    expect(
      createFormsJob.validate({
        files: [
          { name: 'a.pdf', data: source },
          { name: 'b.pdf', data: source },
        ],
        options: {
          fields: [
            { type: 'text', name: 'a', pageIndex: 0, x: 1, y: 1, width: 30, height: 10 },
          ],
        },
      }).ok,
    ).toBe(false);
    expect(
      createFormsJob.validate(
        inputFor(source, {
          fields: [
            { type: 'text', name: 'a', pageIndex: 0, x: 1, y: 1, width: 30, height: 10 },
            { type: 'text', name: 'a', pageIndex: 0, x: 1, y: 1, width: 30, height: 10 },
          ],
        }),
      ).ok,
    ).toBe(true); // Uniqueness needs the resolved document; the op reports it.
  });

  test('honours a safe custom output name', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    const result = await createFormsJob.run(
      inputFor(
        source,
        {
          outputName: '../../Custom Form',
          fields: [
            { type: 'checkbox', name: 'ok', pageIndex: 0, x: 10, y: 10, width: 16, height: 16 },
          ],
        },
        'invoice.pdf',
      ),
      testContext(),
    );
    expect(result.fileName).toBe('Custom Form.pdf');
  });
});

/* --------------------------------------------------------------- bookmarks */

describe('writing an outline', () => {
  test('writes a flat outline the product reader can resolve', async () => {
    const source = await makeFixturePdf({ pages: 4 });
    const doc = await PDFDocument.load(source);
    const result = writeOutline(doc, [
      { title: 'Introduction', pageIndex: 0 },
      { title: 'Method & data', pageIndex: 1 },
      { title: 'Results', pageIndex: 3 },
    ]);
    expect(result).toEqual({ count: 3, replaced: false });

    const bytes = await doc.save({ useObjectStreams: false });
    const outline = await extractOutline(bytes, testContext());
    expect(outline.entries.map((entry) => entry.title)).toEqual([
      'Introduction',
      'Method & data',
      'Results',
    ]);
    expect(outline.entries.map((entry) => entry.pageIndex)).toEqual([0, 1, 3]);
    expect(outline.entries.every((entry) => entry.level === 0)).toBe(true);
  });

  test('writes nesting as a real linked tree', async () => {
    const source = await makeFixturePdf({ pages: 4 });
    const doc = await PDFDocument.load(source);
    writeOutline(doc, [
      { title: 'Part one', pageIndex: 0, level: 0 },
      { title: 'Chapter one', pageIndex: 1, level: 1 },
      { title: 'Chapter two', pageIndex: 2, level: 1 },
      { title: 'Part two', pageIndex: 3, level: 0 },
    ]);

    const bytes = await doc.save({ useObjectStreams: false });
    const outline = await extractOutline(bytes, testContext());
    expect(outline.entries.map((entry) => entry.title)).toEqual([
      'Part one',
      'Chapter one',
      'Chapter two',
      'Part two',
    ]);
    expect(outline.entries.map((entry) => entry.level)).toEqual([0, 1, 1, 0]);
  });

  test('keeps non-Latin titles intact through UTF-16BE', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    const doc = await PDFDocument.load(source);
    writeOutline(doc, [{ title: 'Résumé — 日本語', pageIndex: 0 }]);

    const bytes = await doc.save({ useObjectStreams: false });
    const outline = await extractOutline(bytes, testContext());
    expect(outline.entries[0]!.title).toBe('Résumé — 日本語');
  });

  test('replaces an existing outline atomically', async () => {
    const source = await makeFixturePdf({ pages: 2 });
    const doc = await PDFDocument.load(source);
    writeOutline(doc, [{ title: 'Old', pageIndex: 0 }]);

    const second = writeOutline(doc, [{ title: 'New', pageIndex: 1 }]);
    expect(second.replaced).toBe(true);

    const bytes = await doc.save({ useObjectStreams: false });
    const outline = await extractOutline(bytes, testContext());
    expect(outline.entries.map((entry) => entry.title)).toEqual(['New']);
  });

  test('normalises control characters instead of writing broken strings', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    const doc = await PDFDocument.load(source);
    writeOutline(doc, [{ title: 'Chapter\n\tOne\u0085', pageIndex: 0 }]);

    const bytes = await doc.save({ useObjectStreams: false });
    const outline = await extractOutline(bytes, testContext());
    expect(outline.entries[0]!.title).toBe('Chapter One');
  });

  test('rejects invalid titles, pages and nesting', async () => {
    const source = await makeFixturePdf({ pages: 2 });
    const doc = await PDFDocument.load(source);

    expect(() => writeOutline(doc, [])).toThrow(/at least one bookmark/i);
    expect(() => writeOutline(doc, [{ title: '   ', pageIndex: 0 }])).toThrow(/needs a title/i);
    expect(() => writeOutline(doc, [{ title: 'x'.repeat(201), pageIndex: 0 }])).toThrow(/too long/i);
    expect(() => writeOutline(doc, [{ title: 'Lost', pageIndex: 9 }])).toThrow(/does not exist/i);
    expect(() => writeOutline(doc, [{ title: 'Child', pageIndex: 0, level: 1 }])).toThrow(
      /top level/i,
    );
    expect(() =>
      writeOutline(doc, [
        { title: 'Parent', pageIndex: 0, level: 0 },
        { title: 'Grandchild', pageIndex: 1, level: 2 },
      ]),
    ).toThrow(/one level at a time/i);
    expect(() => writeOutline(doc, [{ title: 'Bad', pageIndex: 0, level: -1 }])).toThrow(
      /invalid nesting level/i,
    );
  });
});

describe('create bookmarks job', () => {
  test('returns a copy whose outline is readable', async () => {
    const source = await makeFixturePdf({ pages: 3, label: 'Outline' });
    const result = await createBookmarksJob.run(
      inputFor(
        source,
        {
          bookmarks: [
            { title: 'Start', pageIndex: 0 },
            { title: 'Finish', pageIndex: 2 },
          ],
        },
        'paper.pdf',
      ),
      testContext(),
    );

    expect(result.fileName).toBe('paper-bookmarked.pdf');
    expect(result.bookmarkCount).toBe(2);
    expect(result.replaced).toBe(false);
    expect(result.pageCount).toBe(3);

    const outline = await extractOutline(new Uint8Array(result.data), testContext());
    expect(outline.entries.map((entry) => entry.title)).toEqual(['Start', 'Finish']);
    expect(pdfContainsText(new Uint8Array(result.data), 'Outline page 2')).toBe(true);
  });

  test('reports replacement when the source already had an outline', async () => {
    const source = await makeFixturePdf({ pages: 2 });
    const first = await createBookmarksJob.run(
      inputFor(source, { bookmarks: [{ title: 'First', pageIndex: 0 }] }),
      testContext(),
    );
    const second = await createBookmarksJob.run(
      inputFor(new Uint8Array(first.data), { bookmarks: [{ title: 'Second', pageIndex: 1 }] }),
      testContext(),
    );

    expect(second.replaced).toBe(true);
    const outline = await extractOutline(new Uint8Array(second.data), testContext());
    expect(outline.entries.map((entry) => entry.title)).toEqual(['Second']);
  });

  test('validates the request before loading a document', async () => {
    const source = await makeFixturePdf({ pages: 1 });
    expect(createBookmarksJob.validate(inputFor(source, {})).ok).toBe(false);
    expect(createBookmarksJob.validate(inputFor(source, { bookmarks: [] })).ok).toBe(false);
    expect(
      createBookmarksJob.validate(
        inputFor(source, { bookmarks: [{ title: '', pageIndex: 0 }] }),
      ).ok,
    ).toBe(false);
    expect(
      createBookmarksJob.validate(
        inputFor(source, { bookmarks: [{ title: 'A', pageIndex: 0, level: -1 }] }),
      ).ok,
    ).toBe(false);
    expect(
      createBookmarksJob.validate(
        inputFor(source, { bookmarks: [{ title: 'A', pageIndex: 0 }] }),
      ).ok,
    ).toBe(true);
  });
});

/* -------------------------------------------------------------- suggestions */

function line(text: string, fontSize: number, y = 100, bold = false): TextRun {
  return {
    text,
    fontSize,
    x: 40,
    y,
    width: text.length * fontSize * 0.5,
    height: fontSize,
    horizontal: true,
    ...(bold ? { bold: true } : {}),
  };
}

function bodyPage(heading: string): TextRun[] {
  return [line(heading, 24, 60), line('Body line one', 10, 120), line('Body line two', 10, 140)];
}

describe('bookmark suggestions', () => {
  test('picks the largest line on each page when it clears the body size', () => {
    const suggestions = suggestBookmarks([
      bodyPage('Introduction'),
      bodyPage('Method'),
      bodyPage('Results'),
    ]);
    expect(suggestions).toEqual([
      { title: 'Introduction', pageIndex: 0, level: 0 },
      { title: 'Method', pageIndex: 1, level: 0 },
      { title: 'Results', pageIndex: 2, level: 0 },
    ]);
  });

  test('ignores running headers and page numbers', () => {
    const pages = ['Introduction', 'Method', 'Results', 'Appendix'].map((heading, index) => [
      line('ACME CONFIDENTIAL', 8, 20),
      line(heading, 24, 60),
      line('Body line one', 10, 120),
      line('Body line two', 10, 140),
      line(String(index + 1), 9, 800),
      line(`Page ${index + 1}`, 9, 820),
    ]);
    const suggestions = suggestBookmarks(pages);
    expect(suggestions.map((entry) => entry.title)).toEqual([
      'Introduction',
      'Method',
      'Results',
      'Appendix',
    ]);
  });

  test('falls back to the first content line when nothing is a heading', () => {
    const pages = [
      [line('Page 1', 9, 800), line('Alpha report', 10, 120), line('More text', 10, 140)],
      [line('Page 2', 9, 800), line('Beta report', 10, 120), line('More text', 10, 140)],
    ];
    expect(suggestBookmarks(pages).map((entry) => entry.title)).toEqual([
      'Alpha report',
      'Beta report',
    ]);
  });

  test('page mode ignores size contrast and takes the top line', () => {
    const pages = [
      [line('Running title', 10, 30), line('Chapter One', 26, 80), line('Body', 10, 140)],
      [line('Running title', 10, 30), line('Chapter Two', 26, 80), line('Body', 10, 140)],
      [line('Running title', 10, 30), line('Chapter Three', 26, 80), line('Body', 10, 140)],
    ];
    // "Running title" repeats on every page and is body-sized, so it is
    // boilerplate in both modes; the first real line is the chapter heading.
    expect(suggestBookmarks(pages).map((entry) => entry.title)).toEqual([
      'Chapter One',
      'Chapter Two',
      'Chapter Three',
    ]);
    expect(suggestBookmarks(pages, { mode: 'pages' })).toHaveLength(3);
  });

  test('emits page bookmarks for a scanned document with no text', () => {
    expect(suggestBookmarks([[], []])).toEqual([
      { title: 'Page 1', pageIndex: 0, level: 0 },
      { title: 'Page 2', pageIndex: 1, level: 0 },
    ]);
  });

  test('drops consecutive duplicates and caps the list', () => {
    const repeated = [bodyPage('Overview'), bodyPage('Overview')];
    expect(suggestBookmarks(repeated)).toHaveLength(1);

    const pages = Array.from({ length: 8 }, (_, index) =>
      bodyPage(`Heading ${index + 1}`),
    );
    expect(suggestBookmarks(pages, { maxBookmarks: 3 })).toHaveLength(3);
    expect(suggestBookmarks(pages, { maxBookmarks: 0 })).toHaveLength(1);
  });

  test('accepts bold lines at body size as headings', () => {
    const pages = [
      [line('Bold lead', 10, 60, true), line('Body line one', 10, 120), line('Body line two', 10, 140)],
      [line('Plain lead', 10, 60), line('Body line one', 10, 120), line('Body line two', 10, 140)],
    ];
    const suggestions = suggestBookmarks(pages);
    expect(suggestions).toEqual([{ title: 'Bold lead', pageIndex: 0, level: 0 }]);
  });

  test('returns nothing only when there are no pages', () => {
    expect(suggestBookmarks([])).toEqual([]);
  });
});
