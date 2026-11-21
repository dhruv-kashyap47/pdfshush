/**
 * Export verification beyond "the replacement string is present".
 *
 * A text replacement can be extractable and still wrong: an unrelated graphic
 * can shift, a font resource can disappear, a page can be re-sized, or an
 * annotation can be dropped. This module reopens both documents, checks page
 * geometry and resource structure, then renders the edited pages and compares
 * pixels outside the edit regions. It is fail-closed when a canvas exists; in a
 * runtime without a canvas the visual check is explicitly reported as skipped.
 */

import { PDFDict, PDFName, PDFRef } from '@cantoo/pdf-lib';
import type { JobContext } from '../job.js';
import { loadPdfDocument } from '../ops/pages.js';
import { renderPageToCanvas } from '../render/renderPage.js';
import { loadPdfForRender } from '../render/pdfjsRuntime.js';
import type { CanvasFactory } from '../render/canvas.js';
import { verifyTextEdits, type TextEditExpectation } from './verify.js';
import { extractTextRuns } from '../render/textRuns.js';
import { normalizeForMatch } from './text.js';
import type { TextEditBox, TextEditCheck, TextEditVerification } from './types.js';

export interface VisualEditRegion {
  pageIndex: number;
  box: TextEditBox;
}

export interface ExportVerifyOptions {
  original: Uint8Array;
  output: Uint8Array;
  expectedPageCount: number;
  expectations: TextEditExpectation[];
  editedRegions?: VisualEditRegion[];
  /** Render/compare edited pages. Default true when the runtime has a canvas. */
  visual?: boolean;
  /** Target raster width for the comparison. */
  renderWidthPx?: number;
  /** Per-channel difference that counts as changed (0-255). */
  pixelTolerance?: number;
  /** Allowed fraction of differing pixels outside edit regions. */
  outsideToleranceRatio?: number;
  ctx?: JobContext;
  password?: string;
  /**
   * Base names of fonts the edit legitimately consumed (their last text object was
   * removed in place). The font-resources check tolerates these disappearing -- a
   * two-font run collapsed into one rewrite, or a deleted sole run, can leave a page
   * with fewer fonts than it started with, which is correct, not corruption. A font
   * no edit touched that goes missing still fails the check.
   */
  consumedFonts?: Set<string>;
  /** Canvas implementation for the visual comparison (browser worker or Node test). */
  canvasFactory?: CanvasFactory;
}

interface SampledPage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

async function readPixels(
  bytes: Uint8Array,
  pageIndex: number,
  targetWidthPx: number,
  password?: string,
  canvasFactory?: CanvasFactory,
): Promise<SampledPage> {
  const loaded = await loadPdfForRender(bytes, { ...(password ? { password } : {}) });
  try {
    const page = await loaded.doc.getPage(pageIndex + 1);
    try {
      const rendered = await renderPageToCanvas(page, {
        targetWidthPx,
        format: 'png',
        ...(canvasFactory ? { canvasFactory } : {}),
      });
      const image = rendered.context.getImageData(0, 0, rendered.width, rendered.height);
      return { width: rendered.width, height: rendered.height, data: image.data };
    } finally {
      page.cleanup();
    }
  } finally {
    await loaded.destroy();
  }
}

function inside(box: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

function differences(
  original: SampledPage,
  edited: SampledPage,
  regions: VisualEditRegion[],
  tolerance: number,
): { outside: number; total: number } {
  const width = Math.min(original.width, edited.width);
  const height = Math.min(original.height, edited.height);
  let outside = 0;
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Each buffer is addressed with its own row stride: if the two renders ever
      // differ in width, using the shared minimum for both would read the wrong
      // pixels and compare unrelated regions of the image.
      const originalIndex = (y * original.width + x) * 4;
      const editedIndex = (y * edited.width + x) * 4;
      if (insideAny(regions, x, y)) continue;
      total += 1;
      const dr = Math.abs((original.data[originalIndex] ?? 0) - (edited.data[editedIndex] ?? 0));
      const dg = Math.abs((original.data[originalIndex + 1] ?? 0) - (edited.data[editedIndex + 1] ?? 0));
      const db = Math.abs((original.data[originalIndex + 2] ?? 0) - (edited.data[editedIndex + 2] ?? 0));
      const da = Math.abs((original.data[originalIndex + 3] ?? 0) - (edited.data[editedIndex + 3] ?? 0));
      if (Math.max(dr, dg, db, da) > tolerance) outside += 1;
    }
  }
  return { outside, total };
}

// Region coordinates are display points; both renders use the same target
// width, so the scale is uniform. The caller passes the scale used below.
function insideAny(regions: VisualEditRegion[], x: number, y: number): boolean {
  return regions.some((region) => inside(region.box, x, y));
}

function scaledRegions(regions: VisualEditRegion[], scale: number): VisualEditRegion[] {
  const pad = 4;
  return regions.map((region) => ({
    pageIndex: region.pageIndex,
    box: {
      x: region.box.x * scale - pad,
      y: region.box.y * scale - pad,
      width: region.box.width * scale + pad * 2,
      height: region.box.height * scale + pad * 2,
    },
  }));
}

function collectFonts(doc: Awaited<ReturnType<typeof loadPdfDocument>>): {
  names: string[];
  invalid: string[];
} {
  const fonts = new Set<string>();
  const invalid: string[] = [];
  for (const page of doc.getPages()) {
    const entries = page.node.normalizedEntries();
    const dict = entries.Font;
    if (!(dict instanceof PDFDict)) continue;
    for (const key of dict.keys()) {
      const value = dict.lookup(key);
      const font =
        value instanceof PDFDict
          ? value
          : value instanceof PDFRef && doc.context.lookup(value) instanceof PDFDict
            ? (doc.context.lookup(value) as PDFDict)
            : null;
      if (!font) {
        invalid.push(key.asString());
        continue;
      }
      const base = font.lookup(PDFName.of('BaseFont'));
      if (base instanceof PDFName) fonts.add(base.decodeText().replace(/^[A-Z]{6}\+/, ''));
      else invalid.push(key.asString());
    }
  }
  return { names: [...fonts].sort(), invalid };
}

function add(check: TextEditCheck[], name: string, ok: boolean, detail: string): void {
  check.push({ name, ok, detail });
}

/** Small non-cryptographic fingerprint used to describe a text change. */
function textFingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}:${text.length}`;
}

/**
 * Full artifact verification: structure, resources, text extraction and (when a
 * canvas exists) a rendered comparison outside the declared edit regions.
 */
export async function verifyExportArtifact(
  options: ExportVerifyOptions,
): Promise<TextEditVerification> {
  const checks: TextEditCheck[] = [];
  let originalDoc: Awaited<ReturnType<typeof loadPdfDocument>>;
  let outputDoc: Awaited<ReturnType<typeof loadPdfDocument>>;
  try {
    originalDoc = await loadPdfDocument(options.original, {
      ...(options.password ? { password: options.password } : {}),
    });
    outputDoc = await loadPdfDocument(options.output, {
      ...(options.password ? { password: options.password } : {}),
    });
  } catch (error) {
    return {
      ok: false,
      checks: [
        {
          name: 'reopens',
          ok: false,
          detail: `exported document did not reopen: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  add(checks, 'page-count', outputDoc.getPageCount() === options.expectedPageCount, `${outputDoc.getPageCount()} pages`);
  const originalPages = originalDoc.getPages();
  const outputPages = outputDoc.getPages();
  const sameSizes =
    originalPages.length === outputPages.length &&
    originalPages.every((page, index) => {
      const a = page.getSize();
      const b = outputPages[index]!.getSize();
      return Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01;
    });
  add(checks, 'page-geometry', sameSizes, 'page dimensions preserved');

  // C-12: a /Rotate change moves every glyph on the page without touching its
  // text, so geometry alone cannot catch it.
  const sameRotation =
    originalPages.length === outputPages.length &&
    originalPages.every(
      (page, index) => (page.getRotation().angle % 360) === (outputPages[index]!.getRotation().angle % 360),
    );
  add(
    checks,
    'page-rotation',
    sameRotation,
    sameRotation ? 'page rotation preserved' : 'page rotation changed',
  );

  const originalAnnots = originalPages.reduce(
    (sum, page) => sum + (page.node.Annots()?.size() ?? 0),
    0,
  );
  const outputAnnots = outputPages.reduce(
    (sum, page) => sum + (page.node.Annots()?.size() ?? 0),
    0,
  );
  add(
    checks,
    'annotations-and-links',
    outputAnnots >= originalAnnots,
    `${outputAnnots} annotation/link entries (original ${originalAnnots})`,
  );

  const originalFonts = collectFonts(originalDoc);
  const outputFonts = collectFonts(outputDoc);
  // A font the edit consumed (its last text object was removed in place) may
  // legitimately be gone from the output. Tolerate only those; a font no edit
  // touched that disappears is still a failure.
  const consumed = options.consumedFonts ?? new Set<string>();
  const missingFonts = originalFonts.names.filter(
    (font) => !outputFonts.names.includes(font) && !consumed.has(font),
  );
  add(
    checks,
    'font-resources',
    missingFonts.length === 0 && outputFonts.invalid.length === 0,
    outputFonts.names.length === 0
      ? consumed.size > 0
        ? `no font resources remain (edits consumed ${[...consumed].sort().join(', ')})`
        : 'no font resources'
      : `${outputFonts.names.length} font family/families` +
        (missingFonts.length > 0 ? `; missing ${missingFonts.join(', ')}` : '') +
        (outputFonts.invalid.length > 0 ? `; invalid ${outputFonts.invalid.join(', ')}` : ''),
  );

  const textVerification = await verifyTextEdits(options.output, {
    expectedPageCount: options.expectedPageCount,
    expectations: options.expectations,
    // Forward the pre-edit bytes so the residual-original absence checks can run:
    // they are what catch a no-op write whose replacement string already existed on
    // the page, and what give deletions a real post-export absence check.
    original: options.original,
    // Encrypted documents must be reopened with their password in both the original
    // and the output, or verification fails with "No password given".
    ...(options.password ? { password: options.password } : {}),
  });
  checks.push(...textVerification.checks);

  const editedRegions = options.editedRegions ?? [];

  // C-12: pages no edit touched must extract exactly the same text as before.
  // Page geometry, rotation and fonts are checked above; this is the check that
  // catches a stream rewrite leaking into a neighbouring page or a global
  // encoding/resource mutation.
  const editedPages = new Set<number>();
  for (const region of editedRegions) editedPages.add(region.pageIndex);
  for (const expectation of options.expectations) editedPages.add(expectation.pageIndex);
  const untouchedPages: number[] = [];
  for (let index = 0; index < options.expectedPageCount; index += 1) {
    if (!editedPages.has(index)) untouchedPages.push(index);
  }
  if (editedPages.size === 0) {
    // Object-only exports and structural gates declare no text edit; there is no
    // "untouched" page to compare, so do not invent a text assertion.
    add(checks, 'untouched-pages', true, 'no text edit scope declared');
  } else if (untouchedPages.length > 0) {
    try {
      const [originalRuns, outputRuns] = await Promise.all([
        extractTextRuns(options.original, untouchedPages, undefined, options.password),
        extractTextRuns(options.output, untouchedPages, undefined, options.password),
      ]);
      const join = (runs: Array<Array<{ text: string }>>): string[] =>
        runs.map((page) => normalizeForMatch(page.map((run) => run.text).join('\n')));
      const before = join(originalRuns);
      const after = join(outputRuns);
      let changed = 0;
      untouchedPages.forEach((pageIndex, position) => {
        const a = before[position] ?? '';
        const b = after[position] ?? '';
        const same = a === b;
        if (!same) changed += 1;
        add(
          checks,
          `untouched-page-text:page-${pageIndex + 1}`,
          same,
          same
            ? `text unchanged (${textFingerprint(a)})`
            : `text changed (${textFingerprint(a)} != ${textFingerprint(b)})`,
        );
      });
      add(
        checks,
        'untouched-pages',
        changed === 0,
        `${untouchedPages.length - changed} of ${untouchedPages.length} untouched pages text-identical`,
      );
    } catch (error) {
      add(
        checks,
        'untouched-pages',
        false,
        `could not compare untouched pages: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    add(checks, 'untouched-pages', true, 'every page has an edited region');
  }
  const hasCanvas =
    Boolean(options.canvasFactory) ||
    typeof OffscreenCanvas !== 'undefined' ||
    typeof document !== 'undefined';
  if (options.visual !== false && editedRegions.length > 0 && hasCanvas) {
    try {
      const byPage = new Map<number, VisualEditRegion[]>();
      for (const region of editedRegions) {
        const list = byPage.get(region.pageIndex);
        if (list) list.push(region);
        else byPage.set(region.pageIndex, [region]);
      }
      const targetWidth = Math.max(320, Math.min(1400, options.renderWidthPx ?? 1000));
      for (const [pageIndex, regions] of byPage) {
        // Same target width on both sides means one uniform point->pixel scale.
        const viewport = await (async () => {
          const loaded = await loadPdfForRender(options.original, {
            ...(options.password ? { password: options.password } : {}),
          });
          try {
            const page = await loaded.doc.getPage(pageIndex + 1);
            const size = page.getViewport({ scale: 1 });
            page.cleanup();
            return size;
          } finally {
            await loaded.destroy();
          }
        })();
        const scale = targetWidth / Math.max(1, viewport.width);
        const originalPixels = await readPixels(
          options.original,
          pageIndex,
          targetWidth,
          options.password,
          options.canvasFactory,
        );
        const editedPixels = await readPixels(
          options.output,
          pageIndex,
          targetWidth,
          options.password,
          options.canvasFactory,
        );
        const result = differences(
          originalPixels,
          editedPixels,
          scaledRegions(regions, scale),
          options.pixelTolerance ?? 24,
        );
        const ratio = result.total > 0 ? result.outside / result.total : 1;
        const allowed = options.outsideToleranceRatio ?? 0.005;
        add(
          checks,
          `visual-unchanged:page-${pageIndex + 1}`,
          originalPixels.width === editedPixels.width &&
            originalPixels.height === editedPixels.height &&
            ratio <= allowed,
          `${(ratio * 100).toFixed(3)}% of pixels outside edited regions differ (limit ${(allowed * 100).toFixed(2)}%)`,
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!/canvas implementation/i.test(detail)) {
        add(checks, 'visual-unchanged', false, `render comparison failed: ${detail}`);
      } else {
        add(checks, 'visual-unchanged', true, 'skipped: runtime has no canvas implementation');
      }
    }
  } else {
    add(
      checks,
      'visual-unchanged',
      true,
      hasCanvas
        ? 'skipped: no rendered edit regions requested'
        : 'skipped: runtime has no canvas implementation',
    );
  }

  return { ok: checks.every((check) => check.ok), checks };
}
