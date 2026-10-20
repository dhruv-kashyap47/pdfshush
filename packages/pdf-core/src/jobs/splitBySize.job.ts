/**
 * Split by size job.
 *
 * The honest constraint: a PDF's per-page cost is not knowable without
 * composing the copies (shared resources, object streams, cross-references).
 * Split-in-half and split-by-pages get exact behaviour for free; size-targeted
 * splitting is inherently approximate everywhere, including on Sejda.
 *
 * The estimate is still a real measurement, not a guess: pages are composed
 * into parts under the running estimate, every part is SERIALIZED once, and
 * the actual byte counts are reported back. The UI labels the target as a
 * target, never a guarantee.
 */

import type { JobDefinition } from '../job.js';
import { composePageRefs, refsForSpan } from '../ops/compose.js';
import { probePageCount } from '../ops/pages.js';
import { createZip, dedupeNames } from '../ops/zip.js';
import { baseName, toArrayBuffer, totalInputBytes } from './helpers.js';

export type SplitBySizeOptions = {
  /** Target size per part in bytes. */
  targetBytes?: number;
};

export interface SplitBySizeInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: SplitBySizeOptions;
}

export interface SplitBySizeOutput {
  zip: ArrayBuffer;
  zipName: string;
  parts: { name: string; pageCount: number; bytes: number }[];
  pageCount: number;
  approximate: true;
}

/** Same flood guard as split-by-pages. */
const MAX_PARTS = 200;

export interface SplitBySizePlan {
  pagesPerPart: number;
  parts: number;
}

/**
 * The pure estimator: bytes per page drives a uniform segment size, floored,
 * at least one page per part and at most MAX_PARTS parts.
 */
export function planSplitBySize(
  totalBytes: number,
  totalPages: number,
  targetBytes: number,
): SplitBySizePlan {
  const perPageBytes = Math.ceil(totalBytes / totalPages);
  const pagesPerPart = Math.min(
    Math.max(1, Math.floor(targetBytes / perPageBytes)),
    totalPages,
  );
  const parts = Math.ceil(totalPages / pagesPerPart);
  if (parts > MAX_PARTS) {
    throw new Error(`That would create ${parts} files (limit ${MAX_PARTS}). Raise the target size.`);
  }
  return { pagesPerPart, parts };
}

export const splitBySizeJob: JobDefinition<SplitBySizeInput, SplitBySizeOutput> = {
  slug: 'split-by-size',
  label: 'Split by file size',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const target = input.options?.targetBytes;
    if (target === undefined || !Number.isFinite(target) || target < 100 * 1024) {
      issues.push({ message: 'Target size must be at least 100 KB' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    // Source stays open while every part is composed and serialized.
    return { memoryBytes: totalInputBytes(input) * 3 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const targetBytes = input.options?.targetBytes ?? Number.POSITIVE_INFINITY;
    const totalPages = await probePageCount(file.data, {
      ...(file.password ? { password: file.password } : {}),
    });

    const sources = [{ name: file.name, data: file.data, ...(file.password ? { password: file.password } : {}) }];
    const stem = baseName(file.name);

    // Segment pages first (cheap estimate), then measure each part once.
    const { pagesPerPart, parts: partCount } = planSplitBySize(
      totalInputBytes(input),
      totalPages,
      targetBytes,
    );

    const entries: { name: string; data: Uint8Array; pages: number; bytes: number }[] = [];
    const width = String(partCount).length;
    for (let part = 0; part < partCount; part += 1) {
      ctx.throwIfAborted();
      const start = part * pagesPerPart;
      const end = Math.min(start + pagesPerPart, totalPages) - 1;
      const composed = await composePageRefs(sources, refsForSpan(0, start, end), ctx);
      entries.push({
        name: `${stem}-part-${String(part + 1).padStart(width, '0')}.pdf`,
        data: composed.data,
        pages: composed.pageCount,
        bytes: composed.data.length,
      });
    }

    const zip = createZip(
      dedupeNames(entries.map((entry) => entry.name)).map((name, i) => ({
        name,
        data: entries[i]!.data,
      })),
    );

    return {
      zip: toArrayBuffer(zip),
      zipName: `${stem}-sized.zip`,
      parts: entries.map((entry) => ({ name: entry.name, pageCount: entry.pages, bytes: entry.bytes })),
      pageCount: totalPages,
      approximate: true,
    };
  },
};
