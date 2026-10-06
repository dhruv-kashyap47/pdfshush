import { PDFDocument } from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';
import { loadPdfDocument } from './pages.js';
import type { SourceDocument } from './compose.js';

export interface MergeResult {
  data: Uint8Array;
  pageCount: number;
  sources: { name: string; pageCount: number }[];
}

/**
 * Concatenates documents in the order given.
 *
 * Page sizes are intentionally left untouched -- like every other merge tool we
 * do not silently scale content, because that is how documents get mangled.
 */
export async function mergePdfs(sources: SourceDocument[], ctx: JobContext): Promise<MergeResult> {
  if (sources.length === 0) throw new Error('Add at least one PDF');

  const progress = createProgressReporter(ctx);
  progress.report('Opening documents', 0.02);

  const docs: PDFDocument[] = [];
  for (const source of sources) {
    ctx.throwIfAborted();
    docs.push(await loadPdfDocument(source.data, { password: source.password }));
  }

  const out = await PDFDocument.create();
  const totalPages = docs.reduce((sum, doc) => sum + doc.getPageCount(), 0);
  const summary = docs.map((doc, i) => ({
    name: sources[i]?.name ?? `Document ${i + 1}`,
    pageCount: doc.getPageCount(),
  }));

  let copiedSoFar = 0;
  for (let i = 0; i < docs.length; i += 1) {
    ctx.throwIfAborted();
    const doc = docs[i]!;
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const page of pages) out.addPage(page);
    copiedSoFar += pages.length;
    progress.report(`Merging ${summary[i]?.name ?? ''}`.trim(), copiedSoFar / Math.max(1, totalPages));
    // Keep the worker's message loop alive on very large documents.
    await Promise.resolve();
  }

  progress.report('Writing file', 0.97);
  const data = await out.save({ useObjectStreams: false });
  progress.report('Done', 1);
  return { data, pageCount: out.getPageCount(), sources: summary };
}

/** Merges only when there is more than one document -- avoids a pointless copy. */
export async function mergeIfNeeded(sources: SourceDocument[], ctx: JobContext): Promise<MergeResult> {
  if (sources.length === 1) {
    const only = sources[0]!;
    const doc = await loadPdfDocument(only.data, { password: only.password });
    ctx.throwIfAborted();
    const data = await doc.save({ useObjectStreams: false });
    return {
      data,
      pageCount: doc.getPageCount(),
      sources: [{ name: only.name, pageCount: doc.getPageCount() }],
    };
  }
  return mergePdfs(sources, ctx);
}