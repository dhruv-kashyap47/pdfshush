/**
 * Create Bookmarks job -- replace a PDF's outline with a supplied list.
 *
 * Detection happens in the browser from pdf.js text runs; this job only writes
 * the result. Separating the two means the writer is pure pdf-lib object work
 * and the suggestion heuristic is a pure function with its own tests.
 */

import type { JobDefinition } from '../job.js';
import { LIMITS } from '../limits.js';
import { writeOutline, type OutlineWriteEntry } from '../ops/outlineWrite.js';
import { loadPdfDocument } from '../ops/pages.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type CreateBookmarksJobOptions = {
  /** Bookmarks in reading order. Required. */
  bookmarks?: OutlineWriteEntry[];
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface CreateBookmarksJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: CreateBookmarksJobOptions;
}

export interface CreateBookmarksJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  bookmarkCount: number;
  /** The source already had an outline; it was replaced. */
  replaced: boolean;
  fileName: string;
}

export const createBookmarksJob: JobDefinition<
  CreateBookmarksJobInput,
  CreateBookmarksJobOutput
> = {
  slug: 'create-bookmarks',
  label: 'Create bookmarks',

  validate(input) {
    const issues: { field?: string; message: string }[] = [];
    if (input.files.length !== 1) {
      issues.push({ field: 'files', message: 'Add exactly one PDF' });
    }
    const bookmarks = input.options?.bookmarks;
    if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
      issues.push({ field: 'bookmarks', message: 'Add at least one bookmark' });
    } else if (bookmarks.length > LIMITS.tool.maxOutlineEntries) {
      issues.push({
        field: 'bookmarks',
        message: `At most ${LIMITS.tool.maxOutlineEntries} bookmarks can be written at once`,
      });
    } else {
      bookmarks.forEach((bookmark, index) => {
        if (!bookmark || typeof bookmark !== 'object') {
          issues.push({ field: `bookmarks[${index}]`, message: 'Bookmark must be an object' });
          return;
        }
        if (typeof bookmark.title !== 'string' || !bookmark.title.trim()) {
          issues.push({
            field: `bookmarks[${index}].title`,
            message: 'Bookmark needs a title',
          });
        } else if (bookmark.title.length > LIMITS.tool.maxBookmarkTitleChars) {
          issues.push({
            field: `bookmarks[${index}].title`,
            message: `Title is longer than ${LIMITS.tool.maxBookmarkTitleChars} characters`,
          });
        }
        if (!Number.isInteger(bookmark.pageIndex) || bookmark.pageIndex < 0) {
          issues.push({
            field: `bookmarks[${index}].pageIndex`,
            message: 'Bookmark needs a page',
          });
        }
        if (
          bookmark.level !== undefined &&
          (!Number.isInteger(bookmark.level) || bookmark.level < 0)
        ) {
          issues.push({
            field: `bookmarks[${index}].level`,
            message: 'Nesting level must be zero or a positive whole number',
          });
        }
      });
    }

    const outputName = input.options?.outputName;
    if (outputName !== undefined && typeof outputName !== 'string') {
      issues.push({ field: 'outputName', message: 'The output name must be text' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    return {
      memoryBytes:
        totalInputBytes(input) * 2 + (input.options?.bookmarks?.length ?? 0) * 512,
    };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const options = input.options ?? {};
    const bookmarks = options.bookmarks ?? [];

    const doc = await loadPdfDocument(
      file.data,
      file.password !== undefined ? { password: file.password } : {},
    );
    ctx.throwIfAborted();

    const result = writeOutline(doc, bookmarks);
    ctx.onProgress({
      phase: 'Writing outline',
      ratio: 0.7,
      message: `${result.count} bookmarks`,
    });

    const bytes = await doc.save({ useObjectStreams: false });
    ctx.throwIfAborted();

    return {
      data: toArrayBuffer(bytes),
      pageCount: doc.getPageCount(),
      bookmarkCount: result.count,
      replaced: result.replaced,
      fileName: safeOutputName(options.outputName, `${baseName(file.name)}-bookmarked`),
    };
  },
};
