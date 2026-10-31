/**
 * pdf.js → structured page layouts.
 *
 * This is the read side of the text editor. It deliberately reuses the same
 * page boxes and rotation normalization as `ops/geometry.ts`, so the layout
 * model, the raster and the overlay all share one coordinate frame.
 *
 * Extraction is sequential and releases each page's text buffers immediately;
 * a 500-page document must not hold every page's glyph array in memory at once
 * when the caller only asks for one page.
 */

import type { JobContext } from '../job.js';
import type { BBox } from '../document/types.js';
import type { PageLayout, DocumentLayout } from '../document/types.js';
import { PageGeometry } from '../document/geometry.js';
import { glyphsFromTextItems, type RawTextContent } from '../document/glyphs.js';
import { buildPageLayout, type LayoutBuildOptions } from '../document/group.js';
import { buildDocumentLayout } from '../document/document.js';
import { loadPdfForRender } from './pdfjsRuntime.js';
import {
  clusterTextRuns,
  runItemsFromTextContent,
  type TextContentLike,
  type TextRun,
} from './textRuns.js';

export interface ExtractLayoutsOptions {
  /** Zero-based page indexes. Empty or missing means every page. */
  pageIndexes?: number[];
  password?: string;
  ctx?: JobContext;
  layout?: LayoutBuildOptions;
}

function normalizeRotation(rotate: number): 0 | 90 | 180 | 270 {
  const rounded = Math.round(rotate / 90) * 90;
  return (((rounded % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

function boxesFromView(
  view: readonly number[] | undefined,
  fallback: { width: number; height: number },
): BBox {
  const x0 = view?.[0];
  const y0 = view?.[1];
  const x1 = view?.[2];
  const y1 = view?.[3];
  if (
    x0 !== undefined &&
    y0 !== undefined &&
    x1 !== undefined &&
    y1 !== undefined &&
    [x0, y0, x1, y1].every(Number.isFinite) &&
    x1 > x0 &&
    y1 > y0
  ) {
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  return { x: 0, y: 0, width: fallback.width, height: fallback.height };
}

/**
 * Extracts structured layouts for the requested pages, in request order.
 */
export async function extractPageLayouts(
  data: Uint8Array,
  options: ExtractLayoutsOptions = {},
): Promise<PageLayout[]> {
  const loaded = await loadPdfForRender(data, {
    ...(options.password ? { password: options.password } : {}),
  });
  try {
    const pageCount = loaded.doc.numPages;
    const targets =
      options.pageIndexes && options.pageIndexes.length > 0
        ? options.pageIndexes
        : Array.from({ length: pageCount }, (_, index) => index);
    for (const index of targets) {
      if (!Number.isInteger(index) || index < 0 || index >= pageCount) {
        throw new Error(`Page ${index + 1} does not exist (document has ${pageCount} pages)`);
      }
    }

    const layouts: PageLayout[] = [];
    for (let i = 0; i < targets.length; i += 1) {
      const pageIndex = targets[i]!;
      options.ctx?.throwIfAborted();
      const page = await loaded.doc.getPage(pageIndex + 1);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const boxes = boxesFromView(page.view, {
          width: viewport.width,
          height: viewport.height,
        });
        const rotation = normalizeRotation(page.rotate ?? 0);
        const geometry = new PageGeometry({
          mediaBox: boxes,
          cropBox: boxes,
          rotation,
        });
        const content = (await page.getTextContent()) as unknown as RawTextContent;
        const extracted = glyphsFromTextItems(content, {
          pageIndex,
          geometry,
        });
        const layout = buildPageLayout({
          pageIndex,
          geometry,
          mediaBox: boxes,
          cropBox: boxes,
          rotation,
          glyphs: extracted.glyphs,
          ...(options.layout ? { options: options.layout } : {}),
        });
        if (extracted.warnings.length > 0) {
          layout.warnings = [...new Set([...layout.warnings, ...extracted.warnings])];
        }
        layouts.push(layout);
      } finally {
        // Text content buffers are the biggest per-page allocation here; on a
        // 500-page run, holding them all is how you kill a tab.
        page.cleanup();
      }
      options.ctx?.onProgress({
        phase: 'Reading text structure',
        ratio: (i + 1) / targets.length,
        message: `Page ${pageIndex + 1}`,
      });
    }
    return layouts;
  } finally {
    await loaded.destroy();
  }
}

/**
 * Extracts every page and classifies repeated headers/footers across the whole
 * document. This is the snapshot the Phase 1 editor consumes.
 */
export async function extractDocumentLayout(
  data: Uint8Array,
  options: ExtractLayoutsOptions = {},
): Promise<DocumentLayout> {
  const pages = await extractPageLayouts(data, options);
  return buildDocumentLayout(pages);
}

/**
 * One pdf.js load for both the legacy text runs and the structured layouts.
 * Keeping them in a single pass avoids parsing every page twice when the
 * editor asks for the text layer.
 */
export async function extractTextRunsAndLayouts(
  data: Uint8Array,
  pageIndexes: number[],
  ctx?: JobContext,
  password?: string,
  layoutOptions?: LayoutBuildOptions,
): Promise<{ runs: TextRun[][]; layouts: PageLayout[] }> {
  const loaded = await loadPdfForRender(data, { ...(password ? { password } : {}) });
  try {
    const pageCount = loaded.doc.numPages;
    const targets =
      pageIndexes.length > 0
        ? pageIndexes
        : Array.from({ length: pageCount }, (_, index) => index);
    for (const index of targets) {
      if (!Number.isInteger(index) || index < 0 || index >= pageCount) {
        throw new Error(`Page ${index + 1} does not exist (document has ${pageCount} pages)`);
      }
    }

    const runs: TextRun[][] = [];
    const layouts: PageLayout[] = [];
    for (let i = 0; i < targets.length; i += 1) {
      const pageIndex = targets[i]!;
      ctx?.throwIfAborted();
      const page = await loaded.doc.getPage(pageIndex + 1);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = (await page.getTextContent()) as unknown as TextContentLike;
        runs.push(clusterTextRuns(runItemsFromTextContent(content, viewport)));

        const boxes = boxesFromView(page.view, {
          width: viewport.width,
          height: viewport.height,
        });
        const rotation = normalizeRotation(page.rotate ?? 0);
        const geometry = new PageGeometry({ mediaBox: boxes, cropBox: boxes, rotation });
        const extracted = glyphsFromTextItems(
          content as unknown as RawTextContent,
          { pageIndex, geometry },
        );
        const layout = buildPageLayout({
          pageIndex,
          geometry,
          mediaBox: boxes,
          cropBox: boxes,
          rotation,
          glyphs: extracted.glyphs,
          ...(layoutOptions ? { options: layoutOptions } : {}),
        });
        if (extracted.warnings.length > 0) {
          layout.warnings = [...new Set([...layout.warnings, ...extracted.warnings])];
        }
        layouts.push(layout);
      } finally {
        page.cleanup();
      }
      ctx?.onProgress({
        phase: 'Reading text structure',
        ratio: (i + 1) / targets.length,
        message: `Page ${pageIndex + 1}`,
      });
    }
    return { runs, layouts };
  } finally {
    await loaded.destroy();
  }
}
