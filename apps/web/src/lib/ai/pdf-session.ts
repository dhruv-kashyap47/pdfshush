/**
 * Page-text extraction for the AI tools.
 *
 * The `text-runs` job already produces display-space text runs for the editor;
 * the AI layer reuses it once per upload and caches both a plain-text blob and
 * the run geometry per page. One job call also returns the document's *true*
 * page count (and, for the editor, display-space page sizes), so the AI layer
 * does not need a second `inspect` parse of the same bytes.
 *
 * The cap applies to *text extraction*, not to the document: a long file keeps
 * its real page count, page-structure edits still cover every page, and the
 * skills say plainly that later pages were not read. Silently pretending a
 * 400-page document has 300 pages would let a page operation drop the tail.
 */

import type { JobInputFile, TextRun } from '@pdfshush/pdf-core';
import { jobPool } from '@/lib/job-pool';

/** Cap on pages whose text is carried into the AI context. */
export const MAX_AI_PAGES = 300;

export interface AiDocument {
  fileName: string;
  /** True page count of the PDF, even when only some pages were extracted. */
  pageCount: number;
  /** Pages whose text was extracted (<= MAX_AI_PAGES). */
  textPageCount: number;
  /** One whitespace-normalized text blob per extracted page; index = page - 1. */
  pages: string[];
  /** Display-space runs per extracted page (same indexing); the AI geometry. */
  runs: TextRun[][];
  /**
   * Display-space page size per extracted page. Used by the edit tool to place
   * inserted text safely. Absent when the extraction path did not report it.
   */
  pageSizes?: { width: number; height: number }[];
}

interface TextRunsResult {
  runs: TextRun[][];
  pageCount?: number;
  pageSizes?: { width: number; height: number }[];
}

const toInput = async (file: File): Promise<JobInputFile> => ({
  name: file.name,
  type: file.type || 'application/pdf',
  data: new Uint8Array(await file.arrayBuffer()),
});

const pageText = (runs: TextRun[]): string =>
  runs.map((run) => run.text).join(' ').replace(/\s+/g, ' ').trim();

function buildDocument(fileName: string, result: TextRunsResult, withSizes: boolean): AiDocument {
  const allRuns = result.runs ?? [];
  const runs = allRuns.slice(0, MAX_AI_PAGES);
  const pageSizes = withSizes ? result.pageSizes?.slice(0, runs.length) : undefined;
  return {
    fileName,
    pageCount: Math.max(result.pageCount ?? allRuns.length, runs.length),
    textPageCount: runs.length,
    runs,
    pages: runs.map(pageText),
    ...(pageSizes && pageSizes.length > 0 ? { pageSizes } : {}),
  };
}

/**
 * Extract every page's text runs once (a fresh read per call: the pool
 * transfers the bytes). `maxPages` bounds the work on unusually long files.
 */
async function readRuns(
  file: File,
  signal?: AbortSignal,
  onProgress?: (ratio: number) => void,
  includePageInfo = true,
): Promise<TextRunsResult> {
  return jobPool.run<TextRunsResult>(
    'text-runs',
    [await toInput(file)],
    { maxPages: MAX_AI_PAGES, includePageInfo },
    {
      ...(signal ? { signal } : {}),
      ...(onProgress ? { onProgress: (progress) => onProgress(progress.ratio ?? 0) } : {}),
    },
  );
}

/** Read-only extraction for summarize / chat: text runs, no geometry handed to tools. */
export async function extractDocumentText(
  file: File,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<AiDocument> {
  return buildDocument(file.name, await readRuns(file, signal, onProgress), false);
}

/**
 * Extraction for the AI editor: text runs plus per-page display sizes, so the
 * model can position inserted text in real page coordinates.
 */
export async function extractEditDocument(
  file: File,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<AiDocument> {
  return buildDocument(file.name, await readRuns(file, signal, onProgress), true);
}
