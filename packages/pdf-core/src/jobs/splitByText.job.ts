/**
 * Split by text job.
 *
 * Reads text with the same pdf.js pipeline the editor uses (so rotated pages,
 * embedded fonts and form XObjects behave the same everywhere), plans the
 * boundaries purely, then composes each part from the source -- parts are real
 * standalone PDFs, not byte slices.
 */

import type { JobDefinition } from '../job.js';
import { composePageRefs, refsForSpan } from '../ops/compose.js';
import { planSplitByText } from '../ops/splitByText.js';
import { probePageCount } from '../ops/pages.js';
import { createZip, dedupeNames } from '../ops/zip.js';
import { extractTextRuns } from '../render/textRuns.js';
import { baseName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type SplitByTextOptions = {
  /** Text that marks the first page of each new part. */
  needle?: string;
  /** Defaults to off: case-insensitive matching is what people expect for prose. */
  caseSensitive?: boolean;
};

export interface SplitByTextInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: SplitByTextOptions;
}

export interface SplitByTextOutput {
  zip: ArrayBuffer;
  zipName: string;
  parts: { name: string; pageCount: number; bytes: number; startPage: number; endPage: number }[];
  pageCount: number;
  /** 1-based page numbers that matched, for the result summary. */
  matchedPages: number[];
}

export const splitByTextJob: JobDefinition<SplitByTextInput, SplitByTextOutput> = {
  slug: 'split-by-text',
  label: 'Split at matching text',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const needle = input.options?.needle?.trim() ?? '';
    if (needle.length === 0) issues.push({ message: 'Type the text that starts each new part' });
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    // Text extraction holds one page at a time; the copies dominate.
    return { memoryBytes: totalInputBytes(input) * 3 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const password = file.password;
    const pageCount = await probePageCount(file.data, {
      ...(password ? { password } : {}),
    });

    const runs = await extractTextRuns(file.data, [], ctx, password);
    if (runs.length !== pageCount) {
      throw new Error('Could not read every page consistently; try the PDF in a viewer first');
    }

    const pageTexts = runs.map((pageRuns) => pageRuns.map((run) => run.text).join('\n'));
    const plan = planSplitByText(pageTexts, input.options?.needle ?? '', input.options?.caseSensitive ?? false);

    const sources = [
      { name: file.name, data: file.data, ...(password ? { password } : {}) },
    ];
    const stem = baseName(file.name);
    const width = String(plan.ranges.length).length;

    const entries: { name: string; data: Uint8Array; pages: number; startPage: number; endPage: number }[] = [];
    for (let index = 0; index < plan.ranges.length; index += 1) {
      ctx.throwIfAborted();
      const range = plan.ranges[index]!;
      const composed = await composePageRefs(
        sources,
        refsForSpan(0, range.start, range.end),
        ctx,
      );
      entries.push({
        name: `${stem}-part-${String(index + 1).padStart(width, '0')}.pdf`,
        data: composed.data,
        pages: composed.pageCount,
        startPage: range.start + 1,
        endPage: range.end + 1,
      });
    }

    const names = dedupeNames(entries.map((entry) => entry.name));
    const zip = createZip(
      entries.map((entry, index) => ({ name: names[index]!, data: entry.data })),
    );

    return {
      zip: toArrayBuffer(zip),
      zipName: `${stem}-split.zip`,
      parts: entries.map((entry, index) => ({
        name: names[index]!,
        pageCount: entry.pages,
        bytes: entry.data.byteLength,
        startPage: entry.startPage,
        endPage: entry.endPage,
      })),
      pageCount,
      matchedPages: plan.matchPages.map((page) => page + 1),
    };
  },
};
