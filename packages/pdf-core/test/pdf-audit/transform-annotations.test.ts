/**
 * Audit repros for `docs/pdf-audit/FINDINGS.md`.
 *
 * `mirrorPages` / `resizePages` append a replacement page and remove the
 * original, so the source page's `/Annots` array is never carried across.
 * Both cases assert the desired behaviour and are expected to fail until the
 * finding is fixed; see the header of `page-pipelines.test.ts`.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
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

describe('page rebuilds', () => {
  // PDF-ENGINE-003: the replacement page is blank; annotations are not content.
  it.fails('PDF-ENGINE-003: flip keeps page annotations', async () => {
    const out = await flipJob.run(
      { files: [annotations()], options: { horizontal: true } },
      testContext(),
    );
    expect(await annotationCount(out.data)).toBeGreaterThan(0);
  });

  it.fails('PDF-ENGINE-003: resize keeps page annotations', async () => {
    const out = await resizeJob.run(
      { files: [annotations()], options: { request: { kind: 'preset', preset: 'a4' } } },
      testContext(),
    );
    expect(await annotationCount(out.data)).toBeGreaterThan(0);
  });
});
