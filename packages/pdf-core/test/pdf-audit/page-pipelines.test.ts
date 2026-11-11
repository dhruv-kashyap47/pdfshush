/**
 * Audit regressions for `docs/pdf-audit/FINDINGS.md`.
 *
 * Session 6 turned the session-1 `it.fails` repros into ordinary tests once the
 * owner decided the policy: page-copy tools keep the AcroForm, multi-source
 * outputs merge the field trees with `_2`, `_3` suffixes on collisions, and a
 * duplicated page gets its own renamed field copies. Metadata follows the first
 * (or only) source document.
 */

import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { combineToPdf } from '../../src/ops/combine.js';
import { composePageRefs } from '../../src/ops/compose.js';
import { extractFormWidgets } from '../../src/ops/forms.js';
import { mergePdfs } from '../../src/ops/merge.js';
import { inspectPdf } from '../../src/ops/pages.js';
import { testContext } from '../fixtures.js';
import { readAuditFixture } from './fixtures.js';

const source = (name: string) => ({ name, data: readAuditFixture(name) });

/** Fillable field names, read from the raw catalog so `getForm()` cannot invent one. */
async function fieldNames(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (doc.catalog.get(PDFName.of('AcroForm')) === undefined) return [];
  return extractFormWidgets(doc)
    .map((field) => field.name)
    .sort();
}

async function hasAcroForm(bytes: Uint8Array): Promise<boolean> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.catalog.get(PDFName.of('AcroForm')) !== undefined;
}

const ACROFORM_FIELDS = [
  'person.agree',
  'person.color',
  'person.color',
  'person.country',
  'person.name',
  'person.tags',
];

describe('page-copy pipelines: AcroForm (PDF-ENGINE-001)', () => {
  it('organize keeps fillable AcroForm fields', async () => {
    const form = source('acroform.pdf');
    const out = await composePageRefs(
      [form],
      [{ docIndex: 0, pageIndex: 0 }],
      testContext(),
    );
    expect(await fieldNames(out.data)).toEqual(ACROFORM_FIELDS);
  });

  it('merge keeps fillable AcroForm fields', async () => {
    const out = await mergePdfs([source('acroform.pdf')], testContext());
    expect(await fieldNames(out.data)).toEqual(ACROFORM_FIELDS);
  });

  it('combine keeps fillable AcroForm fields', async () => {
    const out = await combineToPdf([source('acroform.pdf')], {}, testContext());
    expect(await fieldNames(out.data)).toEqual(ACROFORM_FIELDS);
  });

  it('keeps the form values through a copy, save and reopen', async () => {
    const out = await composePageRefs(
      [source('acroform.pdf')],
      [{ docIndex: 0, pageIndex: 0 }],
      testContext(),
    );
    const doc = await PDFDocument.load(out.data, { updateMetadata: false });
    expect(doc.catalog.get(PDFName.of('AcroForm'))).toBeDefined();
    const form = doc.getForm();
    form.getTextField('person.name').setText('Grace Hopper');
    form.getDropdown('person.country').select('India');
    form.getOptionList('person.tags').select('gamma');
    const saved = await doc.save({ useObjectStreams: false });

    const reopened = await PDFDocument.load(saved, { updateMetadata: false });
    expect(reopened.catalog.get(PDFName.of('AcroForm'))).toBeDefined();
    const widgets = extractFormWidgets(reopened);
    expect(widgets.find((widget) => widget.name === 'person.name')?.value).toBe('Grace Hopper');
    expect(widgets.find((widget) => widget.name === 'person.country')?.value).toBe('India');
    expect(widgets.find((widget) => widget.name === 'person.tags')?.value).toBe('gamma');
  });

  it('renames colliding fully-qualified names when merging two forms', async () => {
    const out = await mergePdfs(
      [source('acroform.pdf'), source('acroform.pdf')],
      testContext(),
    );
    const names = await fieldNames(out.data);
    expect(names).toContain('person.name');
    expect(names).toContain('person.name_2');
    expect(names).toContain('person.country_2');
    // The radio group is one field with two widgets: it is renamed once.
    expect(names.filter((name) => name === 'person.color')).toHaveLength(2);
    expect(names.filter((name) => name === 'person.color_2')).toHaveLength(2);
    // Two documents, two field trees, one page each: the pages are not cloned.
    const info = await inspectPdf(out.data);
    expect(info.pageCount).toBe(2);
    expect(info.fields).toHaveLength(12);
  });

  it('renames fields on a duplicated page instead of sharing one widget tree', async () => {
    const out = await composePageRefs(
      [source('acroform.pdf')],
      [
        { docIndex: 0, pageIndex: 0 },
        { docIndex: 0, pageIndex: 0 },
      ],
      testContext(),
    );
    const names = await fieldNames(out.data);
    expect(names).toContain('person.name');
    expect(names).toContain('person.name_2');
    expect(names.filter((name) => name === 'person.color')).toHaveLength(2);
    expect(names.filter((name) => name === 'person.color_2')).toHaveLength(2);

    const doc = await PDFDocument.load(out.data, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(2);
    const pageRefs = new Set(
      doc.getPages().map((page) => `${page.ref.objectNumber} ${page.ref.generationNumber}`),
    );
    const widgetPages: string[] = [];
    for (const field of doc.getForm().getFields()) {
      for (const widget of field.acroField.getWidgets()) {
        const page = widget.P();
        expect(page, `${field.getName()} widget has no /P`).toBeDefined();
        widgetPages.push(`${page!.objectNumber} ${page!.generationNumber}`);
      }
    }
    // Every widget points at one of the two real output pages, never at a
    // duplicate page dictionary created only for the appearance tree.
    expect(widgetPages.every((ref) => pageRefs.has(ref))).toBe(true);
  });

  it('registers the merged form even when the first source has none', async () => {
    const out = await mergePdfs(
      [source('tiny-1page.pdf'), source('acroform.pdf')],
      testContext(),
    );
    expect(await hasAcroForm(out.data)).toBe(true);
    expect(await fieldNames(out.data)).toEqual(ACROFORM_FIELDS);
  });
});
