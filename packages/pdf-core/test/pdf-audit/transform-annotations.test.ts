/**
 * Audit regressions for `docs/pdf-audit/FINDINGS.md`.
 *
 * Session 6 decided the annotation policy for geometric rebuilds: Flip and
 * Resize flatten every annotation and widget appearance into the page content,
 * so nothing silently disappears, and emit a warning. A document carrying a
 * digital signature is refused instead of producing an invalid signature.
 */

import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { flipJob } from '../../src/jobs/flip.job.js';
import { resizeJob } from '../../src/jobs/resize.job.js';
import { testContext } from '../fixtures.js';
import { readAuditFixture } from './fixtures.js';

async function annotationCount(bytes: ArrayBuffer | Uint8Array): Promise<number> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  return doc
    .getPages()
    .reduce((total, page) => total + (page.node.Annots()?.size() ?? 0), 0);
}

const annotations = () => ({
  name: 'annotations.pdf',
  data: readAuditFixture('annotations.pdf'),
});

describe('page rebuilds flatten annotations (PDF-ENGINE-003)', () => {
  it('flip keeps the annotation appearance as page content', async () => {
    const out = await flipJob.run(
      { files: [annotations()], options: { horizontal: true } },
      testContext(),
    );
    // Flattened, not dropped: the page dictionary no longer carries live
    // annotations, but the result says what it did.
    expect(await annotationCount(out.data)).toBe(0);
    expect(out.warnings?.join(' ')).toMatch(/flattened \d+ annotation/i);
  });

  it('resize keeps the annotation appearance as page content', async () => {
    const out = await resizeJob.run(
      { files: [annotations()], options: { request: { kind: 'preset', preset: 'a4' } } },
      testContext(),
    );
    expect(await annotationCount(out.data)).toBe(0);
    expect(out.warnings?.join(' ')).toMatch(/flattened \d+ annotation/i);
  });

  it('flattens widget appearances and removes the form registration', async () => {
    const out = await flipJob.run(
      {
        files: [{ name: 'acroform.pdf', data: readAuditFixture('acroform.pdf') }],
        options: { horizontal: true },
      },
      testContext(),
    );
    expect(out.warnings?.join(' ')).toMatch(/form fields were flattened/i);
    const doc = await PDFDocument.load(new Uint8Array(out.data), { updateMetadata: false });
    expect(doc.catalog.get(PDFName.of('AcroForm'))).toBeUndefined();
    expect(await annotationCount(out.data)).toBe(0);
  });

  it('refuses a document with a signature field', async () => {
    const signed = await signedPdf();
    for (const run of [
      () => flipJob.run({ files: [{ name: 'signed.pdf', data: signed }], options: { horizontal: true } }, testContext()),
      () =>
        resizeJob.run(
          {
            files: [{ name: 'signed.pdf', data: signed }],
            options: { request: { kind: 'preset', preset: 'a4' } },
          },
          testContext(),
        ),
    ]) {
      await expect(run()).rejects.toThrow(/signature/i);
    }
  });
});

/** A one-page PDF whose AcroForm carries a `/FT /Sig` field. */
async function signedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const form = doc.getForm();
  const field = form.createTextField('signature');
  field.addToPage(page, { x: 40, y: 220, width: 180, height: 32 });
  // pdf-lib has no signature-field builder; the audit only needs the raw /FT
  // marker a real signed document carries.
  field.acroField.dict.set(PDFName.of('FT'), PDFName.of('Sig'));
  field.acroField.dict.set(PDFName.of('V'), PDFName.of('Sig'));
  return doc.save({ useObjectStreams: false });
}
