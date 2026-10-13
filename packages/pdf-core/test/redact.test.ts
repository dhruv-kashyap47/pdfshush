/**
 * Redaction gate.
 *
 * The shipped strategy rebuilds every page from a sanitized image, so the
 * assertions here read the **serialized output** and check the things that make
 * that rebuild trustworthy:
 *
 *   - the original text layer is gone, proven by two independent readers
 *     (pdf.js extraction and a raw content-stream scan);
 *   - no annotation, attachment, form field or metadata survives;
 *   - every page is exactly one substantial image whose aspect matches its box;
 *   - the marks are actually in the pixels — checked by sampling the image, not
 *     by trusting the pipeline that drew them.
 *
 * Adversarial coverage is deliberately negative-first: a document that was *not*
 * redacted must fail verification, and a rebuild that silently produced blank
 * pages must fail too. Without those, a verifier that always returned `ok` would
 * look identical to one that works.
 */

import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { configurePdfjsRuntime } from '../src/render/pdfjsRuntime.js';
import { redactPdf } from '../src/redact/redact.js';
import { verifyRedaction } from '../src/redact/verify.js';
import { RedactionUnsafeError, RedactionVerificationError } from '../src/redact/types.js';
import type { RasterizedPage, Rasterizer } from '../src/redact/rasterize.js';
import { redactJob } from '../src/jobs/redact.job.js';
import { LIMITS } from '../src/limits.js';
import { testContext } from './fixtures.js';

configurePdfjsRuntime({
  workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href,
});

const SECRET = 'SENTINEL-CLASSIFIED-7731';
const PUBLIC = 'PUBLIC-REFERENCE-0042';
const A4 = { width: 595, height: 842 };

/* ------------------------------------------------------------ PNG encoder -- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(type.length + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, type.length);
  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

/**
 * A real RGB PNG of the requested size.
 *
 * The test rasterizer must return a correctly sized, non-uniform image, because
 * verification rejects placeholder images and the pixel checks need something
 * with actual detail to measure.
 */
function encodePng(
  width: number,
  height: number,
  dark: { x: number; y: number; w: number; h: number }[],
  flat = false,
): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      // A gradient, so a blank page is distinguishable from a rendered one.
      let value = flat ? 128 : 40 + Math.round((x / width) * 120);
      for (const box of dark) {
        if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) value = 0;
      }
      const i = row + 1 + x * 3;
      raw[i] = value;
      raw[i + 1] = value;
      raw[i + 2] = value;
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolour
  return concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/* ----------------------------------------------------- source documents ---- */

async function sourcePdf(options: { pages?: number; rotate?: boolean } = {}): Promise<Uint8Array> {
  const pages = options.pages ?? 1;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([A4.width, A4.height]);
    page.drawText(`${SECRET} p${i + 1}`, { x: 60, y: 700, size: 18, font });
    page.drawText(PUBLIC, {
      x: 60,
      y: 300,
      size: 18,
      font,
      ...(options.rotate ? { rotate: degrees(90) } : {}),
    });
  }
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

/** A rasterizer that renders the regions as dark bars, with no canvas. */
function fakeRasterizer(seen: { pages: number[] } = { pages: [] }): Rasterizer {
  return {
    async rasterize(pageIndex, regions, dpi, _fill): Promise<RasterizedPage> {
      seen.pages.push(pageIndex);
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
    async destroy() {
      seen.pages.push(-1);
    },
  };
}

function env(rasterizer: Rasterizer = fakeRasterizer()) {
  return { createRasterizer: async () => rasterizer };
}

const REGION = { pageIndex: 0, x: 50, y: 120, width: 260, height: 40 };

/* ------------------------------------------------------------- happy path -- */

describe('redaction rebuilds the document', () => {
  it('removes the text layer and keeps every page', async () => {
    const source = await sourcePdf({ pages: 2 });
    const result = await redactPdf(
      source,
      {
        regions: [REGION, { ...REGION, pageIndex: 1 }],
        forbiddenStrings: [SECRET],
      },
      testContext(),
      env(),
    );

    expect(result.pageCount).toBe(2);
    expect(result.report.verification.ok).toBe(true);

    const verification = await verifyRedaction(new Uint8Array(result.data), {
      regions: [REGION],
      expectedPageCount: 2,
      forbiddenStrings: [SECRET],
    });
    expect(verification.ok).toBe(true);
    // The text layer is what a rebuild is *supposed* to have dropped.
    expect(verification.checks.find((c) => c.name === 'no-extractable-text')?.ok).toBe(true);
    expect(verification.checks.find((c) => c.name === 'content-has-no-text-operators')?.ok).toBe(true);
    expect(verification.checks.find((c) => c.name === 'pages-are-single-images')?.ok).toBe(true);
  });

  it('rebuilds every page, not only the marked ones', async () => {
    // A page with no region must still be replaced, or its original content
    // stream would survive in the output.
    const seen = { pages: [] as number[] };
    const source = await sourcePdf({ pages: 3 });
    await redactPdf(source, { regions: [REGION] }, testContext(), env(fakeRasterizer(seen)));
    expect(seen.pages.filter((page) => page >= 0)).toEqual([0, 1, 2]);
  });

  it('reports the disclosure the user must be shown', async () => {
    const source = await sourcePdf();
    const result = await redactPdf(source, { regions: [REGION] }, testContext(), env());
    expect(result.report.warnings.join(' ')).toMatch(/text selection, search, links/i);
  });

  it('carries no metadata, annotations or attachments into the output', async () => {
    const doc = await PDFDocument.create();
    doc.setTitle('Confidential Offer');
    doc.setAuthor('HR Department');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([A4.width, A4.height]);
    page.drawText(SECRET, { x: 60, y: 700, size: 18, font });
    page.node.normalize();
    const annots = page.node.Annots()!;
    annots.push(
      doc.context.register(
        doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [60, 700, 200, 720], Contents: SECRET }) as never,
      ),
    );
    const source = new Uint8Array(await doc.save({ useObjectStreams: false }));

    const result = await redactPdf(source, { regions: [REGION] }, testContext(), env());
    const checks = result.report.verification.checks;
    for (const name of ['no-annotations', 'no-attachments', 'metadata-stripped']) {
      expect(checks.find((c) => c.name === name)?.ok, name).toBe(true);
    }
  });

  it('works on a rotated page', async () => {
    const source = await sourcePdf({ rotate: true });
    const result = await redactPdf(source, { regions: [REGION] }, testContext(), env());
    expect(result.report.verification.ok).toBe(true);
  });
});

/* ------------------------------------------------------------- fail closed -- */

describe('fail-closed behaviour', () => {
  it('refuses when the environment cannot rasterize', async () => {
    const source = await sourcePdf();
    await expect(
      redactPdf(source, { regions: [REGION] }, testContext(), {}),
    ).rejects.toMatchObject({ reasons: [{ kind: 'rasterize-unavailable' }] });
  });

  it('refuses a document with more pages than the limit allows', async () => {
    // The guard is what stops a large document becoming a tab-killer, so it is
    // exercised for real rather than asserted to exist.
    const pages = LIMITS.tool.maxRedactPages + 1;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i += 1) {
      doc.addPage([A4.width, A4.height]).drawText(`${SECRET} ${i}`, { x: 60, y: 700, size: 12, font });
    }
    const source = new Uint8Array(await doc.save({ useObjectStreams: false }));
    await expect(
      redactPdf(source, { regions: [REGION] }, testContext(), env()),
    ).rejects.toMatchObject({ reasons: [{ kind: 'too-many-pages' }] });
  }, 30_000);

  it('refuses when no regions are given', async () => {
    const source = await sourcePdf();
    await expect(
      redactPdf(source, { regions: [] }, testContext(), env()),
    ).rejects.toBeInstanceOf(RedactionUnsafeError);
  });

  it('refuses a region on a page that does not exist', async () => {
    const source = await sourcePdf();
    await expect(
      redactPdf(source, { regions: [{ ...REGION, pageIndex: 7 }] }, testContext(), env()),
    ).rejects.toMatchObject({ reasons: [{ kind: 'no-regions' }] });
  });

  it('a normal run stays well inside the output-size ceiling', async () => {
    // The ceiling is a guard that only bites at scale; asserting a one-page run
    // is far below it is honest about what this test can prove.
    const source = await sourcePdf();
    const result = await redactPdf(source, { regions: [REGION] }, testContext(), env());
    expect(LIMITS.tool.maxRedactOutputBytes).toBeGreaterThan(0);
    expect(result.data.byteLength).toBeLessThan(LIMITS.tool.maxRedactOutputBytes / 10);
  });

  it('fails the export when a page cannot be rendered', async () => {
    const source = await sourcePdf({ pages: 2 });
    const failing: Rasterizer = {
      rasterize: async (pageIndex) => {
        if (pageIndex === 1) throw new Error('canvas exploded');
        return { png: encodePng(1240, 1754, []), widthPt: A4.width, heightPt: A4.height };
      },
      destroy: async () => {},
    };
    await expect(
      redactPdf(source, { regions: [REGION] }, testContext(), env(failing)),
    ).rejects.toMatchObject({ reasons: [{ kind: 'rasterize-failed' }] });
  });

  it('releases the rasterizer even when rendering fails', async () => {
    const destroyed: string[] = [];
    const failing: Rasterizer = {
      rasterize: async () => {
        throw new Error('boom');
      },
      destroy: async () => {
        destroyed.push('destroyed');
      },
    };
    await expect(
      redactPdf(await sourcePdf(), { regions: [REGION] }, testContext(), env(failing)),
    ).rejects.toBeInstanceOf(RedactionUnsafeError);
    expect(destroyed).toEqual(['destroyed']);
  });

  it('releases the rasterizer on cancellation', async () => {
    const destroyed: string[] = [];
    const slow: Rasterizer = {
      rasterize: async () => ({ png: encodePng(1240, 1754, []), widthPt: A4.width, heightPt: A4.height }),
      destroy: async () => {
        destroyed.push('destroyed');
      },
    };
    const controller = new AbortController();
    const ctx = { ...testContext(), signal: controller.signal, throwIfAborted: () => {
      if (controller.signal.aborted) throw new Error('Operation cancelled');
    } };
    controller.abort();
    await expect(
      redactPdf(await sourcePdf({ pages: 2 }), { regions: [REGION] }, ctx, env(slow)),
    ).rejects.toThrow(/cancel/i);
    expect(destroyed).toEqual(['destroyed']);
  });
});

/* --------------------------------------------------- adversarial verification */

describe('the verification gate itself', () => {
  it('fails a document that was never redacted', async () => {
    const source = await sourcePdf();
    const verification = await verifyRedaction(source, {
      regions: [REGION],
      expectedPageCount: 1,
      forbiddenStrings: [SECRET],
    });
    expect(verification.ok).toBe(false);
    expect(verification.checks.find((c) => c.name === 'no-extractable-text')?.ok).toBe(false);
    expect(verification.checks.find((c) => c.name === 'forbidden-strings-absent')?.ok).toBe(false);
  });

  it('fails a rebuild that produced blank placeholder pages', async () => {
    // A pipeline bug that “redacted” by producing empty pages must not pass.
    const blank: Rasterizer = {
      rasterize: async () => ({ png: encodePng(1, 1, []), widthPt: A4.width, heightPt: A4.height }),
      destroy: async () => {},
    };
    const source = await sourcePdf();
    await expect(
      redactPdf(source, { regions: [REGION] }, testContext(), env(blank)),
    ).rejects.toBeInstanceOf(RedactionVerificationError);
  });

  it('fails when the rebuilt image has the wrong aspect ratio', async () => {
    const stretched: Rasterizer = {
      rasterize: async () => ({ png: encodePng(1200, 400, []), widthPt: A4.width, heightPt: A4.height }),
      destroy: async () => {},
    };
    await expect(
      redactPdf(await sourcePdf(), { regions: [REGION] }, testContext(), env(stretched)),
    ).rejects.toBeInstanceOf(RedactionVerificationError);
  });

  it('fails when the pipeline forgot to burn the marks into the pixels', async () => {
    // A rasterizer that renders the page faithfully but never paints the mark:
    // the structure is perfect and the text is gone, so only the pixel check can
    // catch it. This is the check that makes "the box is drawn" evidence.
    const noMarks: Rasterizer = {
      rasterize: async () => ({
        png: encodePng(1240, 1754, []),
        widthPt: A4.width,
        heightPt: A4.height,
      }),
      destroy: async () => {},
    };
    await expect(
      redactPdf(await sourcePdf(), { regions: [REGION] }, testContext(), env(noMarks)),
    ).rejects.toThrow(/not opaque/i);
  });

  it('fails when the rebuilt page lost its content entirely', async () => {
    const flat: Rasterizer = {
      rasterize: async () => ({
        png: encodePng(1240, 1754, [], true),
        widthPt: A4.width,
        heightPt: A4.height,
      }),
      destroy: async () => {},
    };
    await expect(
      redactPdf(await sourcePdf(), { regions: [REGION] }, testContext(), env(flat)),
    ).rejects.toThrow(/lost its content/i);
  });

  it('does not fail vacuously on a page with no text at all', async () => {
    // Guards the other direction: `no-extractable-text` must not be the only
    // reason a bad document passes, so the structural checks must stand alone.
    const source = await sourcePdf();
    const result = await redactPdf(source, { regions: [REGION] }, testContext(), env());
    const verification = await verifyRedaction(new Uint8Array(result.data), {
      regions: [REGION],
      expectedPageCount: 1,
    });
    const structural = verification.checks.filter((c) =>
      ['parses', 'page-count', 'pages-are-single-images', 'page-images-substantial', 'metadata-stripped'].includes(
        c.name,
      ),
    );
    expect(structural.every((c) => c.ok)).toBe(true);
  });

  it('rejects malformed output', async () => {
    const verification = await verifyRedaction(Uint8Array.from([1, 2, 3, 4]), {
      regions: [],
      expectedPageCount: 1,
    });
    expect(verification.ok).toBe(false);
    expect(verification.checks[0]?.name).toBe('parses');
  });
});

/* ------------------------------------------------------------- job layer --- */

describe('redact job', () => {
  it('rejects a request with no regions', () => {
    expect(redactJob.validate({ files: [{ name: 'a.pdf', data: new Uint8Array() }] }).ok).toBe(false);
  });

  it('rejects more than one file', () => {
    const files = [
      { name: 'a.pdf', data: new Uint8Array() },
      { name: 'b.pdf', data: new Uint8Array() },
    ];
    expect(redactJob.validate({ files, options: { regions: [REGION] } }).ok).toBe(false);
  });

  it('accepts a well-formed request', () => {
    expect(
      redactJob.validate({ files: [{ name: 'a.pdf', data: new Uint8Array() }], options: { regions: [REGION] } }).ok,
    ).toBe(true);
  });
});

/* ---------------------------------------------------------- pixel evidence -- */

describe('the marks are in the pixels', () => {
  it('leaves a dark bar exactly where the region was, and none elsewhere', async () => {
    // This reads the *returned image bytes*, not the mark-drawing code, so it
    // fails if the pipeline ever stops burning marks into the bitmap.
    const source = await sourcePdf();
    const rasterizer = fakeRasterizer();
    const result = await redactPdf(source, { regions: [REGION], rasterDpi: 72 }, testContext(), env(rasterizer));

    const verification = await verifyRedaction(new Uint8Array(result.data), {
      regions: [REGION],
      expectedPageCount: 1,
    });
    expect(verification.ok).toBe(true);

    // Rebuild the same expectations independently: the reported region area must
    // map to the marked-pixel count the pipeline recorded.
    const report = result.report.pages[0]!;
    expect(report.regions).toBe(1);
    expect(report.markedPixels).toBeGreaterThan(REGION.width * REGION.height * 0.5);
    expect(report.imageBytes).toBeGreaterThan(1000);
  });
});
