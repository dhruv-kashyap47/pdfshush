/**
 * Page-text extraction for the AI tools.
 *
 * The `text-runs` job already produces display-space text runs for the editor;
 * the AI layer reuses it once per upload and caches both a plain-text blob and
 * the run geometry per page. Nothing here talks to a model; it is the read side
 * the skills draw on. The edit tool additionally reads page sizes (`inspect`) so
 * the model can place new text in real coordinates.
 */

import type { InspectOutput, JobInputFile, TextRun } from '@pdfshush/pdf-core';
import { jobPool } from '@/lib/job-pool';

/** Cap on pages carried into the AI context; longer documents are truncated. */
export const MAX_AI_PAGES = 300;

export interface AiDocument {
  fileName: string;
  /** One whitespace-normalized text blob per page; index = page number - 1. */
  pages: string[];
  /** Display-space runs per page (same indexing); the editor/AI geometry. */
  runs: TextRun[][];
  /**
   * Display-space page size per page when known (the edit tool reads it), used
   * to place inserted text. Absent for the read-only tools.
   */
  pageSizes?: { width: number; height: number }[];
}

const toInput = async (file: File): Promise<JobInputFile> => ({
  name: file.name,
  type: file.type || 'application/pdf',
  data: new Uint8Array(await file.arrayBuffer()),
});

const pageText = (runs: TextRun[]): string =>
  runs.map((run) => run.text).join(' ').replace(/\s+/g, ' ').trim();

function buildDocument(fileName: string, allRuns: TextRun[][]): AiDocument {
  const runs = allRuns.slice(0, MAX_AI_PAGES);
  return { fileName, runs, pages: runs.map(pageText) };
}

/** Extract every page's text runs once (a fresh read per call: the pool transfers). */
async function readRuns(
  file: File,
  signal?: AbortSignal,
  onProgress?: (ratio: number) => void,
): Promise<TextRun[][]> {
  const result = await jobPool.run<{ runs: TextRun[][] }>('text-runs', [await toInput(file)], {}, {
    ...(signal ? { signal } : {}),
    ...(onProgress ? { onProgress: (progress) => onProgress(progress.ratio ?? 0) } : {}),
  });
  return result.runs ?? [];
}

async function readPageSizes(
  file: File,
  signal?: AbortSignal,
): Promise<{ width: number; height: number }[]> {
  const info = await jobPool.run<InspectOutput>('inspect', [await toInput(file)], {}, {
    ...(signal ? { signal } : {}),
  });
  return (info.documents[0]?.pages ?? []).map((page) => ({
    width: page.displayWidthPt ?? page.widthPt,
    height: page.displayHeightPt ?? page.heightPt,
  }));
}

/** Read-only extraction for summarize / chat: text runs, no geometry handed to tools. */
export async function extractDocumentText(
  file: File,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<AiDocument> {
  return buildDocument(file.name, await readRuns(file, signal, onProgress));
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
  const runs = await readRuns(file, signal, onProgress);
  const pageSizes = await readPageSizes(file, signal);
  return { ...buildDocument(file.name, runs), pageSizes };
}
