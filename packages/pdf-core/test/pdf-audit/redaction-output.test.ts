/**
 * Redaction, end to end on the bytes a second party would receive.
 *
 * The unit gate (`test/redact.test.ts`) drives the pipeline with a synthetic
 * source. This file asks the question the share boundary actually cares about:
 * *after* a real audit fixture goes through the shipped redaction job, is the
 * content gone from the serialized output, or merely covered?
 *
 * The evidence is the output byte string, read three ways:
 *
 *   1. pdf.js text extraction of the output (what a recipient's viewer reads);
 *   2. the verification gate's decompressing scan for text-showing operators
 *      and forbidden strings, re-run independently on the returned bytes;
 *   3. the uncompressed object graph, where no `/Font`, `/Annots`, `/AcroForm`,
 *      `/Metadata`, `/Info` or attachment tree may appear.
 *
 * The control run proves none of it is vacuous: the same assertions against the
 * unredacted source fail.
 *
 * Node has no canvas, so the rasterizer is injected through the pipeline's own
 * seam (`RedactEnvironment`). Everything downstream of it is the shipped path.
 */

import { describe, expect, it } from 'vitest';
import { configurePdfjsRuntime } from '../../src/render/pdfjsRuntime.js';
import { extractTextRuns } from '../../src/render/textRuns.js';
import { redactPdf } from '../../src/redact/redact.js';
import { verifyRedaction } from '../../src/redact/verify.js';
import type { RasterizedPage, Rasterizer } from '../../src/redact/rasterize.js';
import { testContext } from '../fixtures.js';
import { encodePng } from '../png.js';
import { readAuditFixture } from './fixtures.js';

configurePdfjsRuntime({
  workerSrc: new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
    .href,
});

const A4 = { width: 595, height: 842 };
const FORBIDDEN = 'pdfshush audit fixture';

/** Covers the fixture's text line; the rest of the page must survive. */
const TEXT_REGION = { pageIndex: 0, x: 0, y: 640, width: A4.width, height: 202 };

/** Deterministic stand-in for the canvas rasterizer; marks become black bars. */
function fakeRasterizer(): Rasterizer {
  return {
    async rasterize(_pageIndex, regions, dpi): Promise<RasterizedPage> {
      const scale = dpi / 72;
      const width = Math.ceil(A4.width * scale);
      const height = Math.ceil(A4.height * scale);
      const dark = regions.map((region) => ({
        x: Math.floor(region.x * scale),
        y: Math.floor(region.y * scale),
        w: Math.ceil(region.width * scale),
        h: Math.ceil(region.height * scale),
      }));
      return { png: encodePng(width, height, dark), widthPt: A4.width, heightPt: A4.height };
    },
    async destroy() {},
  };
}

const env = { createRasterizer: async () => fakeRasterizer() };

async function textOf(bytes: Uint8Array): Promise<string[]> {
  const runs = await extractTextRuns(bytes, []);
  return runs.flat().map((run) => run.text);
}

/** ASCII view of the bytes, enough to spot an object key or operator. */
function latin1(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

describe('control: the source is not already clean', () => {
  it('extracts the fixture text and contains text operators before redaction', async () => {
    const source = readAuditFixture('tiny-1page.pdf');
    const before = (await textOf(source)).join(' ');
    expect(before).toMatch(FORBIDDEN);

    const verification = await verifyRedaction(source, {
      regions: [TEXT_REGION],
      expectedPageCount: 1,
      forbiddenStrings: [FORBIDDEN],
    });
    expect(verification.ok).toBe(false);
    expect(verification.checks.find((c) => c.name === 'no-extractable-text')?.ok).toBe(false);
    expect(verification.checks.find((c) => c.name === 'forbidden-strings-absent')?.ok).toBe(false);
  });
});

describe('a real fixture after the shipped redaction pipeline', () => {
  it('leaves no extractable text in the output bytes', async () => {
    const source = readAuditFixture('tiny-1page.pdf');
    const result = await redactPdf(
      source,
      { regions: [TEXT_REGION], forbiddenStrings: [FORBIDDEN] },
      testContext(),
      env,
    );

    const output = new Uint8Array(result.data);
    const after = (await textOf(output)).join(' ');
    expect(after.trim()).toBe('');
    expect(after).not.toMatch(new RegExp(FORBIDDEN, 'i'));

    // Independent second opinion on the same bytes: the gate's decompressing
    // scan must agree, with the forbidden string supplied out of band.
    const verification = await verifyRedaction(output, {
      regions: [TEXT_REGION],
      expectedPageCount: 1,
      forbiddenStrings: [FORBIDDEN],
    });
    expect(verification.ok).toBe(true);
    for (const name of [
      'no-extractable-text',
      'content-has-no-text-operators',
      'forbidden-strings-absent',
      'marks-burned-in',
    ]) {
      expect(verification.checks.find((check) => check.name === name)?.ok, name).toBe(true);
    }
  });

  it('carries no font, annotation, form, attachment or metadata object', async () => {
    const source = readAuditFixture('acroform.pdf');
    const result = await redactPdf(source, { regions: [TEXT_REGION] }, testContext(), env);
    const raw = latin1(new Uint8Array(result.data));

    // Object keys live outside the compressed page stream, so a plain byte
    // scan is decisive here. Any of these would mean original structure
    // travelled into a document that is supposed to be images only. pdf-lib
    // writes an empty `/Font << >>` and `/Annots [ ]` on a fresh page, so fonts
    // and annotations are checked as objects/entries rather than as bare keys.
    for (const key of ['/AcroForm', '/EmbeddedFiles', '/Metadata', '/Info']) {
      expect(raw, key).not.toContain(key);
    }
    expect(raw).not.toMatch(/\/Type\s*\/Font\b/);
    expect(raw).not.toMatch(/\/BaseFont\b/);
    expect(raw).not.toMatch(/\/(Type0|Type1|TrueType|CIDFontType0|CIDFontType2)\b/);

    const verification = await verifyRedaction(new Uint8Array(result.data), {
      regions: [TEXT_REGION],
      expectedPageCount: 1,
    });
    expect(verification.ok).toBe(true);
    for (const name of [
      'pages-are-single-images',
      'page-images-substantial',
      'no-annotations',
      'no-attachments',
      'metadata-stripped',
      'no-extractable-text',
    ]) {
      expect(verification.checks.find((check) => check.name === name)?.ok, name).toBe(true);
    }
  });

  it('reports the visual coverage it actually wrote', async () => {
    const source = readAuditFixture('tiny-1page.pdf');
    const result = await redactPdf(source, { regions: [TEXT_REGION] }, testContext(), env);
    const marks = result.report.verification.checks.find((c) => c.name === 'marks-burned-in');
    // "Covered" and "removed" are different claims: the pixel check proves the
    // mark is opaque, the text checks prove nothing is underneath it.
    expect(marks?.ok).toBe(true);
    expect(marks?.detail).toMatch(/opaque/);
    expect(result.report.pages[0]?.markedPixels).toBeGreaterThan(0);
  });
});
