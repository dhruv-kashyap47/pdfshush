/**
 * The smart-redaction **leakage gate**.
 *
 * Smart redaction lets the model *propose* which text looks sensitive. It never
 * destroys anything: the model picks runs, pdf-core turns those runs into
 * rectangles, and R1 — the rasterizing `redact` job — is the only destructive
 * path. This test states the guarantee the product makes, on the **exported
 * bytes**:
 *
 *   1. no proposed span is recoverable — proven by two independent readers
 *      (pdf.js text extraction *and* a raw content-stream scan) plus a
 *      forbidden-string sweep;
 *   2. non-targeted content survives — the rebuild kept real page detail and the
 *      marks are confined to the proposed rectangles;
 *   3. the marks are in the pixels (R1's existing pixel evidence);
 *   4. **adversarial negative control** — routing the same spans through the
 *      cosmetic whiteout path MUST fail the gate. Without this, a gate that
 *      always answered "safe" would look identical to one that works.
 *
 * The propose step is modelled faithfully: text runs are extracted with the same
 * renderer the browser uses, and run boxes become regions. Only the *selection*
 * of runs is the model's; geometry stays in pdf-core.
 */

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { configurePdfjsRuntime } from '../src/render/pdfjsRuntime.js';
import { extractTextRuns, type TextRun } from '../src/render/textRuns.js';
import { redactPdf } from '../src/redact/redact.js';
import { verifyRedaction } from '../src/redact/verify.js';
import type { RedactRegion } from '../src/redact/types.js';
import type { RasterizedPage, Rasterizer } from '../src/redact/rasterize.js';
import { testContext } from './fixtures.js';
import { encodePng } from './png.js';

configurePdfjsRuntime({
  workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href,
});

const SECRET = 'SENTINEL-CLASSIFIED-7731';
/** Must not be redacted; its page must keep its content. */
const PUBLIC = 'PUBLIC-REFERENCE-0042';
const A4 = { width: 595, height: 842 };

/* ---------------------------------------------------------- source fixture -- */

async function sourcePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const page1 = doc.addPage([A4.width, A4.height]);
  page1.drawText(SECRET, { x: 60, y: 700, size: 18, font });
  page1.drawText(PUBLIC, { x: 60, y: 320, size: 18, font });

  const page2 = doc.addPage([A4.width, A4.height]);
  page2.drawText(PUBLIC, { x: 60, y: 700, size: 18, font });
  page2.drawText('Quarterly revenue rose 12 percent.', { x: 60, y: 320, size: 14, font, color: rgb(0.1, 0.1, 0.1) });

  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

/* ------------------------------------------------------- the propose step -- */

/**
 * Turn "the model said these runs are sensitive" into rectangles. A run counts
 * as sensitive when it is (part of) a known secret, so a secret split across
 * several runs is covered by all of their boxes.
 */
function proposeRegions(runsPerPage: TextRun[][], secrets: string[]): RedactRegion[] {
  const regions: RedactRegion[] = [];
  const pad = 1;
  runsPerPage.forEach((runs, pageIndex) => {
    for (const run of runs) {
      const text = run.text.trim();
      if (text.length < 4) continue;
      if (!secrets.some((secret) => run.text.includes(secret) || secret.includes(text))) continue;
      regions.push({
        pageIndex,
        x: run.x - pad,
        y: run.y - pad,
        width: run.width + pad * 2,
        height: run.height + pad * 2,
        label: 'proposed',
      });
    }
  });
  return regions;
}

/* ---------------------------------------------------------- test rasterizer -- */

/** Renders each page as a gradient with dark bars exactly where regions land. */
function fakeRasterizer(): Rasterizer {
  return {
    async rasterize(pageIndex, regions, dpi): Promise<RasterizedPage> {
      void pageIndex;
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

function env(): { createRasterizer: () => Promise<Rasterizer> } {
  const rasterizer = fakeRasterizer();
  return { createRasterizer: async () => rasterizer };
}

/** The cosmetic path: cover the text with a white box and keep the text layer. */
async function whiteoutPdf(source: Uint8Array, regions: RedactRegion[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source);
  for (const region of regions) {
    const page = doc.getPage(region.pageIndex);
    page.drawRectangle({
      x: region.x,
      // Regions are top-left display space; pdf-lib draws from the bottom-left.
      y: page.getHeight() - region.y - region.height,
      width: region.width,
      height: region.height,
      color: rgb(1, 1, 1),
    });
  }
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

/* ------------------------------------------------------------------- gate -- */

describe('smart-redaction leakage gate', () => {
  it('removes every proposed span from the exported bytes', async () => {
    const source = await sourcePdf();
    const runs = await extractTextRuns(source, [0, 1], testContext());
    const regions = proposeRegions(runs, [SECRET]);

    // The propose step must actually find the secret, on the page it is on.
    expect(regions.length).toBeGreaterThan(0);
    expect(regions.every((region) => region.pageIndex === 0)).toBe(true);

    const result = await redactPdf(
      source,
      { regions, forbiddenStrings: [SECRET, 'SENTINEL', 'CLASSIFIED'] },
      testContext(),
      env(),
    );

    const verification = await verifyRedaction(new Uint8Array(result.data), {
      regions,
      expectedPageCount: 2,
      forbiddenStrings: [SECRET, 'SENTINEL', 'CLASSIFIED'],
    });

    expect(verification.ok).toBe(true);
    const checks = new Map(verification.checks.map((check) => [check.name, check.ok]));
    // Two independent readers: pdf.js extraction, and the raw byte scan.
    expect(checks.get('no-extractable-text')).toBe(true);
    expect(checks.get('content-has-no-text-operators')).toBe(true);
    // And the explicit sweep for the strings we meant to destroy.
    expect(checks.get('forbidden-strings-absent')).toBe(true);
  });

  it('keeps non-targeted content and confines the marks to the proposed regions', async () => {
    const source = await sourcePdf();
    const runs = await extractTextRuns(source, [0, 1], testContext());
    const regions = proposeRegions(runs, [SECRET]);

    const result = await redactPdf(source, { regions }, testContext(), env());

    // The page that was never targeted has no marks and a full-size image.
    const page2 = result.report.pages[1]!;
    expect(page2.regions).toBe(0);
    expect(page2.imageBytes).toBeGreaterThan(1000);
    expect(result.report.pages[0]!.regions).toBe(regions.length);

    const verification = await verifyRedaction(new Uint8Array(result.data), {
      regions,
      expectedPageCount: 2,
    });
    const checks = new Map(verification.checks.map((check) => [check.name, check.ok]));
    // Content survives outside the marks, so the rebuild is not a blank page.
    expect(checks.get('page-not-blank')).toBe(true);
    // The marks are actually opaque in the output pixels.
    expect(checks.get('marks-burned-in')).toBe(true);
    // And every page is still a substantial image (un-targeted detail kept).
    expect(checks.get('page-images-substantial')).toBe(true);
  });

  it('negative control: the cosmetic whiteout path fails the same gate', async () => {
    const source = await sourcePdf();
    const runs = await extractTextRuns(source, [0], testContext());
    const regions = proposeRegions(runs, [SECRET]);
    expect(regions.length).toBeGreaterThan(0);

    const cosmetic = await whiteoutPdf(source, regions);

    // The secret was never destroyed — only painted over — so the gate must say
    // no. This is what makes the passing cases above meaningful.
    const verification = await verifyRedaction(cosmetic, {
      regions,
      expectedPageCount: 2,
      forbiddenStrings: [SECRET],
    });
    expect(verification.ok).toBe(false);
    const checks = new Map(verification.checks.map((check) => [check.name, check.ok]));
    expect(checks.get('no-extractable-text')).toBe(false);
    expect(checks.get('forbidden-strings-absent')).toBe(false);
    // Baseline sanity: the cosmetics really did leave the text in place.
    const survivors = (await extractTextRuns(cosmetic, [0, 1], testContext())).flat();
    expect(survivors.some((run) => run.text.includes(SECRET))).toBe(true);
  });
});
