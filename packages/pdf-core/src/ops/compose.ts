/**
 * Page composition -- the engine behind Organize, Delete Pages, Extract Pages,
 * Split, Rotate, Crop and every page-selection tool that follows.
 *
 * One operation, many tools: give it a list of `PageRef`s pointing into the
 * source documents and it produces a new PDF containing exactly those pages, in
 * that order, with duplicates.
 */

import { PDFDocument, PDFPage, degrees } from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';
import { loadPdfDocument } from './pages.js';

export interface SourceDocument {
  name: string;
  data: Uint8Array;
  password?: string;
}

export interface PageRef {
  /** Index into the `sources` array. */
  docIndex: number;
  /** Zero-based page index inside that document. */
  pageIndex: number;
  /** Per-page rotation override (wins over `ComposeOptions.rotateDegrees`). */
  rotateDegrees?: 0 | 90 | 180 | 270;
}

export interface CropRect {
  /** Page-coordinate rectangle; clamped to each page's MediaBox. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComposeOptions {
  /** Per-output-page transform applied while copying. */
  transform?: 'none' | 'rotate';
  rotateDegrees?: 0 | 90 | 180 | 270;
  /** Crop every output page to this rectangle (clamped per page). */
  crop?: CropRect;
}

export interface ComposeResult {
  data: Uint8Array;
  pageCount: number;
}

/**
 * Builds the output document without saving -- so callers can stamp text,
 * draw overlays or impose pages onto sheets before serialising.
 */
export async function composeDocument(
  sources: SourceDocument[],
  refs: PageRef[],
  ctx: JobContext,
  options: ComposeOptions = {},
): Promise<PDFDocument> {
  if (sources.length === 0) throw new Error('No source documents');
  if (refs.length === 0) throw new Error('No pages selected');

  const progress = createProgressReporter(ctx);
  progress.report('Opening documents', 0.02);

  const docs = await Promise.all(
    sources.map(async (source) => loadPdfDocument(source.data, { password: source.password })),
  );

  const out = await PDFDocument.create();

  // Validate every reference against the real page counts BEFORE copying, so a
  // bad page index fails fast instead of after a full copy.
  const pageCounts = docs.map((doc) => doc.getPageCount());
  for (const ref of refs) {
    const count = pageCounts[ref.docIndex];
    if (count === undefined || ref.pageIndex < 0 || ref.pageIndex >= count) {
      throw new Error(`Page ${ref.pageIndex + 1} of document ${ref.docIndex + 1} does not exist`);
    }
  }

  // Copy only the referenced pages (each exactly once) and reference them
  // repeatedly. Extracting 2 pages from a 500-page file must not clone 500 page
  // trees, while duplicate entries in the order stay free.
  const needed = pageCounts.map(() => new Set<number>());
  for (const ref of refs) needed[ref.docIndex]!.add(ref.pageIndex);

  const copied: Map<number, PDFPage>[] = [];
  for (let i = 0; i < docs.length; i += 1) {
    ctx.throwIfAborted();
    progress.report('Copying pages', (i + 1) / (docs.length + 1));
    const indexes = [...needed[i]!].sort((a, b) => a - b);
    const pages = indexes.length > 0 ? await out.copyPages(docs[i] as PDFDocument, indexes) : [];
    const byIndex = new Map<number, PDFPage>();
    indexes.forEach((pageIndex, slot) => {
      const page = pages[slot];
      if (page) byIndex.set(pageIndex, page);
    });
    copied.push(byIndex);
  }

  for (let i = 0; i < refs.length; i += 1) {
    const ref = refs[i]!;
    ctx.throwIfAborted();
    const page = copied[ref.docIndex]?.get(ref.pageIndex);
    if (!page) {
      throw new Error(`Page ${ref.pageIndex + 1} of document ${ref.docIndex + 1} does not exist`);
    }

    // Per-page rotation beats the global option; `degrees()` wrapper required.
    const rotation = ref.rotateDegrees ?? (options.transform === 'rotate' ? options.rotateDegrees ?? 90 : undefined);
    if (rotation !== undefined && rotation !== 0) {
      page.setRotation(degrees(normaliseRotation(rotation)));
    }
    if (options.crop) {
      applyCrop(page, options.crop);
    }

    out.addPage(page);
    if (i % 8 === 0 || i === refs.length - 1) {
      progress.report('Building document', (i + 1) / refs.length);
      // Yield to the message loop so cancel buttons stay responsive.
      await Promise.resolve();
    }
  }

  return out;
}

export async function composePageRefs(
  sources: SourceDocument[],
  refs: PageRef[],
  ctx: JobContext,
  options: ComposeOptions = {},
): Promise<ComposeResult> {
  const out = await composeDocument(sources, refs, ctx, options);
  const progress = createProgressReporter(ctx);
  progress.report('Writing file', 0.97);
  const bytes = await out.save({ useObjectStreams: false });
  progress.report('Done', 1);
  return { data: bytes, pageCount: refs.length };
}

/** Applies a crop rectangle, clamped so it always sits inside the MediaBox. */
function applyCrop(page: PDFPage, crop: CropRect): void {
  const media = page.getMediaBox();
  // Intersect the requested rect with the media box; a rectangle poking outside
  // the page shrinks to fit instead of being rejected.
  const left = Math.max(media.x, crop.x);
  const bottom = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  page.setCropBox(left, bottom, Math.max(1, right - left), Math.max(1, top - bottom));
}

/** Inclusive span of pages from one document. */
export function refsForSpan(docIndex: number, start: number, end: number): PageRef[] {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const refs: PageRef[] = [];
  for (let i = from; i <= to; i += 1) refs.push({ docIndex, pageIndex: i });
  return refs;
}

/** Identity page order across all documents, in file order. */
export function identityRefs(pageCounts: number[]): PageRef[] {
  const refs: PageRef[] = [];
  pageCounts.forEach((count, docIndex) => {
    for (let pageIndex = 0; pageIndex < count; pageIndex += 1) {
      refs.push({ docIndex, pageIndex });
    }
  });
  return refs;
}

function normaliseRotation(degreesValue: number): 0 | 90 | 180 | 270 {
  const rounded = (((Math.round(degreesValue / 90) * 90) % 360) + 360) % 360;
  return rounded === 90 || rounded === 180 || rounded === 270 ? rounded : 0;
}
