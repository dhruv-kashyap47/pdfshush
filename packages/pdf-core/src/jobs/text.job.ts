/**
 * PDF to Text job: the page text, extracted on the pdf.js pipeline the editor
 * already reads with, joined into a plain .txt document.
 *
 * Lines come from the same clustered runs the editor edits with, so the
 * output reads the way the page looks: one line per visual line, blank lines
 * between pages.
 */

import type { JobDefinition } from '../job.js';
import { probePageCount } from '../ops/pages.js';
import { extractTextRuns } from '../render/textRuns.js';
import { stripExtension } from '../ops/zip.js';
import { toArrayBuffer, totalInputBytes } from './helpers.js';

export type TextJobOptions = {
  /** Zero-based page indexes; missing means every page. */
  pageIndexes?: number[];
};

export interface TextJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: TextJobOptions;
}

export interface TextJobOutput {
  /** UTF-8 encoded .txt bytes. */
  data: ArrayBuffer;
  fileName: string;
  pageCount: number;
  charCount: number;
  /** The text itself for the result preview (kept under a sane size). */
  text: string;
}

/** Characters of text echoed back to the result panel (the download has it all). */
const PREVIEW_CHARS = 4096;

function assemblePageText(runs: { text: string; y: number; x: number }[]): string {
  // Runs arrive clustered but not reading-ordered; sort top-to-bottom, then
  // left-to-right. Runs carry their display boxes, so the visual reading axis
  // survives even on 90°-rotated pages.
  const sorted = [...runs].sort((a, b) => (Math.abs(a.y - b.y) > 1 ? a.y - b.y : a.x - b.x));
  return sorted.map((run) => run.text).join('\n');
}

export const textJob: JobDefinition<TextJobInput, TextJobOutput> = {
  slug: 'pdf-to-text',
  label: 'Extract text',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const indexes = input.options?.pageIndexes ?? undefined;
    if (
      indexes && Array.isArray(indexes) &&
      indexes.some((entry) => !Number.isInteger(entry) || entry < 0)
    ) {
      issues.push({ message: 'Page indexes must be non-negative whole numbers' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input) };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const pageCount = await probePageCount(file.data, {
      ...(file.password ? { password: file.password } : {}),
    });

    const indexes =
      input.options?.pageIndexes && input.options.pageIndexes.length > 0
        ? input.options.pageIndexes.filter((entry) => entry < pageCount)
        : undefined;

    const perPage = await extractTextRuns(
      file.data,
      indexes ?? Array.from({ length: pageCount }, (_, i) => i),
      ctx,
      file.password,
    );
    ctx.throwIfAborted();

    // One entry per page; an empty page yields an empty string and remains a
    // blank line in the output so page boundaries stay visible.
    const texts = (indexes ?? Array.from({ length: pageCount }, (_, i) => i)).map((_, i) =>
      assemblePageText(perPage[i] ?? []),
    );

    const body = texts.join('\n\n');
    const charCount = [...texts].reduce((sum, line) => sum + line.length + 1, 0);
    const bytes = new TextEncoder().encode(body);
    const stem = stripExtension(file.name.split(/[\\/]/).pop() ?? '');

    return {
      data: toArrayBuffer(bytes),
      fileName: `${stem || 'document'}.txt`,
      pageCount: texts.length,
      charCount,
      text: body.length > PREVIEW_CHARS ? `${body.slice(0, PREVIEW_CHARS)}…` : body,
    };
  },
};
