/**
 * Audit repros for `docs/pdf-audit/FINDINGS.md`.
 *
 * Each case asserts the behaviour a user is entitled to expect and is marked
 * `it.fails` because the bug is still open at the time of writing. Vitest keeps
 * the suite green while the assertion fails; the moment a fix lands the test
 * turns red and must be promoted to a normal `it` (delete `.fails`). Do not
 * weaken the assertions -- they are the evidence for the finding.
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
  return extractFormWidgets(doc).map((field) => field.name);
}

const ACROFORM_FIELDS = [
  'person.name',
  'person.agree',
  'person.color',
  'person.color',
  'person.country',
  'person.tags',
];

describe('page-copy pipelines', () => {
  // PDF-ENGINE-001: copyPages carries a page's /Annots but not the catalog-level
  // /AcroForm, so the widget annotations survive as unregistered orphans.
  it.fails('PDF-ENGINE-001: organize keeps fillable AcroForm fields', async () => {
    const form = source('acroform.pdf');
    const out = await composePageRefs(
      [form],
      [{ docIndex: 0, pageIndex: 0 }],
      testContext(),
    );
    expect(await fieldNames(out.data)).toEqual(ACROFORM_FIELDS);
  });

  it.fails('PDF-ENGINE-001: merge keeps fillable AcroForm fields', async () => {
    const out = await mergePdfs([source('acroform.pdf')], testContext());
    expect(await fieldNames(out.data)).toEqual(ACROFORM_FIELDS);
  });

  it.fails('PDF-ENGINE-001: combine keeps fillable AcroForm fields', async () => {
    const out = await combineToPdf([source('acroform.pdf')], {}, testContext());
    expect(await fieldNames(out.data)).toEqual(ACROFORM_FIELDS);
  });

  // PDF-ENGINE-002: `composeDocument` applies only /CreationDate and /ModDate to
  // the new Info dictionary; Title/Author/Subject/Keywords are left behind.
  it.fails('PDF-ENGINE-002: organizing a page keeps its document metadata', async () => {
    const meta = source('metadata.pdf');
    const out = await composePageRefs(
      [meta],
      [{ docIndex: 0, pageIndex: 0 }],
      testContext(),
    );
    const info = await inspectPdf(out.data);
    expect(info.metadata.title).toBe('pdfshush metadata fixture');
    expect(info.metadata.author).toBe('pdfshush audit');
    expect(info.metadata.subject).toBe('Metadata preservation probe');
    expect(info.metadata.keywords).toBe('pdf-audit metadata FIXTURE');
  });
});
