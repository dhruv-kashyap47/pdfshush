/**
 * Audit repro for `docs/pdf-audit/FINDINGS.md`.
 *
 * `textJob` counts `line.length + 1` per page, so a page with no extractable
 * text reports one character even though the emitted .txt body is empty.
 * Expected to fail until the finding is fixed; see `page-pipelines.test.ts`.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { textJob } from '../../src/jobs/text.job.js';
import { configurePdfjsRuntime } from '../../src/render/pdfjsRuntime.js';
import { testContext } from '../fixtures.js';
import { readAuditFixture } from './fixtures.js';

beforeAll(() => {
  configurePdfjsRuntime({
    workerSrc: new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href,
  });
});

describe('text extraction counts', () => {
  it('PDF-ENGINE-004: a scan with no text layer reports charCount 0', async () => {
    const out = await textJob.run(
      {
        files: [{ name: 'image-only.pdf', data: readAuditFixture('image-only.pdf') }],
        options: {},
      },
      testContext(),
    );
    expect(out.text).toBe('');
    expect(out.charCount).toBe(0);
  });
});
