/**
 * Split by bookmarks -- cut a PDF at its own outline.
 *
 * Browser-only on purpose: resolving bookmark destinations is pdf.js work (the
 * same runtime the editor and text-run reader use), while the actual cutting is
 * the existing `composePageRefs`. The server has no pdf.js worker configured, so
 * this slug is deliberately absent from SERVER_SLUGS.
 *
 * Two shape decisions worth knowing:
 *  - the split level is the *shallowest level present*, so a lone "Contents"
 *    root with real sections beneath it does not produce a single part;
 *  - pages before the first bookmark become an explicit "Front matter" part
 *    instead of being dropped.
 */

import type { JobDefinition } from '../job.js';
import { LIMITS } from '../limits.js';
import { composePageRefs, refsForSpan } from '../ops/compose.js';
import { probePageCount } from '../ops/pages.js';
import { createZip } from '../ops/zip.js';
import { extractOutline, splitLevel } from '../render/outline.js';
import { baseName, safeEntryName, safeZipName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type SplitByBookmarksOptions = {
  /** Override the archive name (extension optional). */
  outputName?: string;
};

export interface SplitByBookmarksInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: SplitByBookmarksOptions;
}

export interface SplitByBookmarksPart {
  name: string;
  title: string;
  pageCount: number;
  /** Zero-based page in the source document. */
  startPage: number;
}

export interface SplitByBookmarksOutput {
  zip: ArrayBuffer;
  zipName: string;
  parts: SplitByBookmarksPart[];
  pageCount: number;
  /** All bookmark nodes that resolved to a page, including nested ones. */
  bookmarkCount: number;
}

/** Keeps a chapter title readable as a filename without letting it be a path. */
function chapterStem(title: string): string {
  const cleaned = title
    .replace(/[^\p{L}\p{N}._ -]+/gu, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return cleaned || 'chapter';
}

export const splitByBookmarksJob: JobDefinition<
  SplitByBookmarksInput,
  SplitByBookmarksOutput
> = {
  slug: 'split-by-bookmarks',
  label: 'Split by bookmarks',

  validate(input) {
    if (input.files.length !== 1) {
      return { ok: false, issues: [{ message: 'Choose exactly one PDF' }] };
    }
    return { ok: true };
  },

  estimate(input) {
    // pdf.js holds a decoded copy, and the composed parts plus the zip stay
    // resident until the archive is written.
    return { memoryBytes: totalInputBytes(input) * 3 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const totalPages = await probePageCount(file.data, {
      ...(file.password ? { password: file.password } : {}),
    });

    const outline = await extractOutline(file.data, ctx, file.password);
    if (outline.entries.length === 0) {
      throw new Error(
        outline.hadUnresolvableNodes
          ? 'This PDF has bookmarks, but none of them point to a page in the document.'
          : 'This PDF has no bookmarks. Use Split by pages, or add bookmarks first.',
      );
    }

    const level = splitLevel(outline.entries);
    const seenPages = new Set<number>();
    const starts = outline.entries.filter((entry) => {
      if (entry.level !== level) return false;
      if (entry.pageIndex < 0 || entry.pageIndex >= totalPages) return false;
      // Two bookmarks can target the same page; a split there would produce an
      // empty part, so the first one names the section.
      if (seenPages.has(entry.pageIndex)) return false;
      seenPages.add(entry.pageIndex);
      return true;
    });
    if (starts.length === 0) {
      throw new Error('None of this PDF’s bookmarks point to a page in the document.');
    }

    const segments: { title: string; start: number }[] = [];
    const firstStart = starts[0]!.pageIndex;
    if (firstStart > 0) segments.push({ title: 'Front matter', start: 0 });
    for (const entry of starts) segments.push({ title: entry.title, start: entry.pageIndex });

    if (segments.length > LIMITS.tool.maxBookmarkParts) {
      throw new Error(
        `That outline would create ${segments.length} files (limit ${LIMITS.tool.maxBookmarkParts}).`,
      );
    }

    const sources = [
      { name: file.name, data: file.data, ...(file.password ? { password: file.password } : {}) },
    ];
    const width = String(segments.length).length;
    const entries: { name: string; data: Uint8Array }[] = [];
    const parts: SplitByBookmarksPart[] = [];

    for (let index = 0; index < segments.length; index += 1) {
      ctx.throwIfAborted();
      const segment = segments[index]!;
      const next = segments[index + 1]?.start ?? totalPages;
      const end = Math.min(totalPages - 1, next - 1);
      if (end < segment.start) continue;

      const result = await composePageRefs(sources, refsForSpan(0, segment.start, end), ctx);
      const prefix = String(index + 1).padStart(width, '0');
      const name = safeEntryName(
        `${prefix}-${chapterStem(segment.title)}.pdf`,
        `${prefix}-chapter.pdf`,
      );
      entries.push({ name, data: result.data });
      parts.push({
        name,
        title: segment.title,
        pageCount: result.pageCount,
        startPage: segment.start,
      });
    }

    if (entries.length === 0) throw new Error('No sections could be cut from this outline');

    const stem = baseName(file.name);
    return {
      zip: toArrayBuffer(createZip(entries)),
      zipName: safeZipName(input.options?.outputName, `${stem}-bookmarks`),
      parts,
      pageCount: totalPages,
      bookmarkCount: outline.entries.length,
    };
  },
};
