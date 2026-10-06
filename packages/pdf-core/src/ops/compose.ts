/**
 * Page composition -- the engine behind Organize, Delete Pages, Extract Pages,
 * Split, Rotate and every page-selection tool that follows.
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
}

export interface ComposeOptions {
  /** Per-output-page transform applied while copying. */
  transform?: 'none' | 'rotate';
  rotateDegrees?: 0 | 90 | 180 | 270;
}

export interface ComposeResult {
  data: Uint8Array;
  pageCount: number;
}

export async function composePageRefs(
  sources: SourceDocument[],
  refs: PageRef[],
  ctx: JobContext,
  options: ComposeOptions = {},
): Promise<ComposeResult> {
  if (sources.length === 0) throw new Error('No source documents');
  if (refs.length === 0) throw new Error('No pages selected');

  const progress = createProgressReporter(ctx);
  progress.report('Opening documents', 0.02);

  const docs = await Promise.all(
    sources.map(async (source) => loadPdfDocument(source.data, { password: source.password })),
  );

  const out = await PDFDocument.create();

  // Copy each source document's pages once, then reference them repeatedly; this
  // keeps large reorganised documents cheap.
  const copied: PDFPage[][] = [];
  for (let i = 0; i < docs.length; i += 1) {
    ctx.throwIfAborted();
    progress.report('Copying pages', (i + 1) / (docs.length + 1));
    copied.push(await out.copyPages(docs[i] as PDFDocument, docs[i]!.getPageIndices()));
  }

  for (let i = 0; i < refs.length; i += 1) {
    const ref = refs[i]!;
    ctx.throwIfAborted();
    const sourceDoc = copied[ref.docIndex];
    const page = sourceDoc?.[ref.pageIndex];
    if (!page) {
      throw new Error(`Page ${ref.pageIndex + 1} of document ${ref.docIndex + 1} does not exist`);
    }
    if (options.transform === 'rotate') {
      // setRotation takes a `Rotation` object, not a bare number.
      page.setRotation(degrees(normaliseRotation(options.rotateDegrees ?? 90)));
    }
    out.addPage(page);
    if (i % 8 === 0 || i === refs.length - 1) {
      progress.report('Building document', (i + 1) / refs.length);
      // Yield to the message loop so cancel buttons stay responsive.
      await Promise.resolve();
    }
  }

  progress.report('Writing file', 0.97);
  const bytes = await out.save({ useObjectStreams: false });
  progress.report('Done', 1);
  return { data: bytes, pageCount: refs.length };
}

/** Inclusive span of pages from one document. */
export function refsForSpan(docIndex: number, start: number, end: number): PageRef[] {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const refs: PageRef[] = [];
  for (let i = from; i <= to; i += 1) refs.push({ docIndex, pageIndex: i });
  return refs;
}

function normaliseRotation(degreesValue: number): 0 | 90 | 180 | 270 {
  const rounded = (((Math.round(degreesValue / 90) * 90) % 360) + 360) % 360;
  return rounded === 90 || rounded === 180 || rounded === 270 ? rounded : 0;
}