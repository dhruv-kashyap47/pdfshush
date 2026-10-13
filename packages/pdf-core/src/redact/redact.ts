/**
 * `redactPdf` — rebuild a document from sanitized page images, or refuse.
 *
 * **Why rasterization is the shipped strategy.** Permanent removal means the
 * original content must not exist in the output. Rebuilding every page from a
 * freshly rendered image achieves that *structurally*: the output document is
 * created empty and only ever receives images, so no content stream, text layer,
 * OCR layer, annotation, form field, attachment or piece of metadata from the
 * source can survive — they are never copied across rather than deleted after the
 * fact. Every "did we remove X?" question collapses into "is X in a document we
 * built from scratch?", which is answerable by inspection.
 *
 * The disclosed cost is the page's text layer, links, accessibility and vector
 * quality. A text-preserving engine is a separate, later upgrade; this module
 * does not pretend to be one.
 *
 * Ordering matters and is not negotiable:
 *   1. validate the request and the limits (before any expensive work),
 *   2. render + burn marks + rebuild,
 *   3. serialize,
 *   4. **verify the serialized bytes** and refuse to return them if anything is
 *      wrong.
 *
 * There is no path that returns a document it did not verify, and no path that
 * paints over content and calls it redacted.
 */

import { PDFDocument, PDFRef } from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';
import { LIMITS } from '../limits.js';
import { createPdfjsRasterizer, type Rasterizer } from './rasterize.js';
import { verifyRedaction } from './verify.js';
import {
  RedactionUnsafeError,
  RedactionVerificationError,
  type PageReport,
  type RedactOptions,
  type RedactRegion,
  type RedactResult,
  type UnsafeReason,
} from './types.js';

export interface RedactEnvironment {
  /**
   * Builds the page renderer. Injected so the pipeline is testable without a
   * canvas; absent means "this environment cannot rasterize", which is a refusal
   * rather than a downgrade.
   */
  createRasterizer?: (data: Uint8Array, password?: string) => Promise<Rasterizer>;
}

/** Rasterization needs `OffscreenCanvas`; without it redaction is unavailable. */
export function defaultRedactEnvironment(): RedactEnvironment {
  return typeof OffscreenCanvas !== 'undefined' ? { createRasterizer: createPdfjsRasterizer } : {};
}

const MIN_DPI = 72;
const MAX_DPI = 300;
const DEFAULT_DPI = 150;

function clampDpi(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_DPI;
  return Math.min(MAX_DPI, Math.max(MIN_DPI, Math.round(value)));
}

function groupRegions(regions: RedactRegion[]): Map<number, RedactRegion[]> {
  const byPage = new Map<number, RedactRegion[]>();
  for (const region of regions) {
    if (!Number.isFinite(region.x) || !Number.isFinite(region.y)) continue;
    if (!(region.width > 0) || !(region.height > 0)) continue;
    const list = byPage.get(region.pageIndex);
    if (list) list.push(region);
    else byPage.set(region.pageIndex, [region]);
  }
  return byPage;
}

export async function redactPdf(
  data: Uint8Array,
  options: RedactOptions,
  ctx: JobContext,
  environment: RedactEnvironment = defaultRedactEnvironment(),
  password?: string,
): Promise<RedactResult> {
  const reasons: UnsafeReason[] = [];
  const warnings: string[] = [];

  const clean = groupRegions(options.regions ?? []);
  if (clean.size === 0) {
    throw new RedactionUnsafeError([
      { kind: 'no-regions', detail: 'no usable redaction regions were supplied' },
    ]);
  }
  if ((options.regions ?? []).length > LIMITS.tool.maxRedactRegions) {
    throw new RedactionUnsafeError([
      {
        kind: 'no-regions',
        detail: `at most ${LIMITS.tool.maxRedactRegions} regions can be redacted at once`,
      },
    ]);
  }

  // Page count and region validity come from the source, before any rendering.
  const source = await PDFDocument.load(data, {
    throwOnInvalidObject: true,
    updateMetadata: false,
    ...(password ? { password } : {}),
  });
  const pageCount = source.getPageCount();

  for (const pageIndex of clean.keys()) {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
      throw new RedactionUnsafeError([
        { kind: 'no-regions', detail: `region targets page ${pageIndex + 1}, which does not exist` },
      ]);
    }
  }
  if (pageCount > LIMITS.tool.maxRedactPages) {
    // Rasterizing is linear in pages and each page is a full bitmap; the ceiling
    // is what keeps this from becoming a tab-killer.
    throw new RedactionUnsafeError([
      {
        kind: 'too-many-pages',
        detail: `${pageCount} pages exceeds the ${LIMITS.tool.maxRedactPages}-page redaction limit`,
      },
    ]);
  }

  if (!environment.createRasterizer) {
    throw new RedactionUnsafeError([
      {
        kind: 'rasterize-unavailable',
        detail: 'this environment has no canvas, so pages cannot be rebuilt safely',
      },
    ]);
  }

  const dpi = clampDpi(options.rasterDpi);
  const fill = options.fill ?? '000000';
  const scale = dpi / 72;

  const progress = createProgressReporter(ctx);
  const reports: PageReport[] = [];
  const output = await PDFDocument.create();
  let rasterizer: Rasterizer | undefined;

  try {
    rasterizer = await environment.createRasterizer(data, password);

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      ctx.throwIfAborted();
      const pageRegions = clean.get(pageIndex) ?? [];

      let rendered;
      try {
        rendered = await rasterizer.rasterize(pageIndex, pageRegions, dpi, fill);
      } catch (error) {
        reasons.push({
          kind: 'rasterize-failed',
          detail: `page ${pageIndex + 1}: ${error instanceof Error ? error.message : String(error)}`,
        });
        break;
      }

      let image;
      try {
        image = await output.embedPng(rendered.png);
      } catch (error) {
        reasons.push({
          kind: 'rasterize-failed',
          detail: `page ${pageIndex + 1}: rendered image could not be embedded (${
            error instanceof Error ? error.message : String(error)
          })`,
        });
        break;
      }

      const page = output.addPage([rendered.widthPt, rendered.heightPt]);
      page.drawImage(image, { x: 0, y: 0, width: rendered.widthPt, height: rendered.heightPt });

      const markedPixels = pageRegions.reduce(
        (total, region) => total + Math.round(region.width * scale) * Math.round(region.height * scale),
        0,
      );
      reports.push({
        pageIndex,
        regions: pageRegions.length,
        imageBytes: rendered.png.byteLength,
        markedPixels,
      });
      progress.step(pageIndex, pageCount, `Rebuilding page ${pageIndex + 1}`);
    }
  } finally {
    // Always releases the pdf.js document, including on cancellation or failure.
    await rasterizer?.destroy().catch(() => undefined);
  }

  if (reasons.length > 0) throw new RedactionUnsafeError(reasons);

  // pdf-lib writes /Producer and /Creator (and, with `updateMetadata`, a ModDate)
  // into a document it saves, so "built from scratch" is not by itself
  // metadata-free. A redacted file must not carry provenance from our toolchain
  // either, so the Info dictionary is removed outright rather than blanked --
  // an empty string is still an object, and custom keys would survive it.
  const info = output.context.trailerInfo.Info;
  if (info instanceof PDFRef) output.context.delete(info);
  output.context.trailerInfo.Info = undefined;

  // `useObjectStreams: false` keeps the output a classic PDF: every object is
  // plain, which lets an independent reader (and our own E2E) inspect the
  // structure without decompressing object streams. The page images dominate the
  // file size either way, so this costs almost nothing here.
  const saved = await output.save({ useObjectStreams: false });
  const bytes = new Uint8Array(saved);

  if (bytes.byteLength > LIMITS.tool.maxRedactOutputBytes) {
    throw new RedactionUnsafeError([
      {
        kind: 'output-too-large',
        detail: `${Math.round(bytes.byteLength / (1024 * 1024))} MB exceeds the ${
          LIMITS.tool.maxRedactOutputBytes / (1024 * 1024)
        } MB redaction output limit; lower the resolution`,
      },
    ]);
  }

  const verification = await verifyRedaction(bytes, {
    regions: options.regions ?? [],
    expectedPageCount: pageCount,
    ...(options.forbiddenStrings ? { forbiddenStrings: options.forbiddenStrings } : {}),
  });
  if (!verification.ok) throw new RedactionVerificationError(verification);

  if (dpi < 150) {
    warnings.push(`Rendered at ${dpi} DPI; small text may be less legible after redaction.`);
  }
  warnings.push(
    'Pages were rebuilt as images: text selection, search, links, form fields and vector quality are not preserved.',
  );

  const name = options.outputName?.trim() || 'redacted.pdf';

  return {
    data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    name: name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`,
    pageCount,
    report: {
      pages: reports,
      totalImageBytes: reports.reduce((total, page) => total + page.imageBytes, 0),
      verification,
      warnings,
    },
  };
}
