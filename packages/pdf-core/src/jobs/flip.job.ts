/**
 * Flip job -- powers Flip PDF.
 *
 * Composes the document first (so page selection and rotation overrides
 * apply), then mirrors pages in place through `ops/transform`. Options carry
 * per-page flips as page indexes so the UI's grid das not have to expand to a
 * dense boolean array for 500-page documents.
 */

import type { JobDefinition } from '../job.js';
import { composeDocument, identityRefs } from '../ops/compose.js';
import { probePageCount } from '../ops/pages.js';
import { mirrorPages, type FlipAxis } from '../ops/transform.js';
import { baseName, safeOutputName, toArrayBuffer, toSources, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type FlipJobOptions = {
  /** Zero-based page indexes to mirror horizontally (across the vertical axis). */
  horizontal?: number[] | true;
  /** Zero-based page indexes to mirror vertically. */
  vertical?: number[] | true;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface FlipJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: FlipJobOptions;
}

export interface FlipJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
  flipped: number;
}

/** Resolves `true` (all pages) or an explicit list into a per-page axis map. */
export function axisPerPageCount(
  specification: number[] | true | undefined,
  pageCount: number,
): boolean[] {
  if (specification === undefined) return new Array<boolean>(pageCount).fill(false);
  if (specification === true) return new Array<boolean>(pageCount).fill(true);
  const flags = new Array<boolean>(pageCount).fill(false);
  for (const index of specification) {
    if (Number.isInteger(index) && index >= 0 && index < pageCount) flags[index] = true;
  }
  return flags;
}

export const flipJob: JobDefinition<FlipJobInput, FlipJobOutput> = {
  slug: 'flip',
  label: 'Flip pages',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const options = input.options ?? {};
    if (options.horizontal === undefined && options.vertical === undefined) {
      issues.push({ message: 'Flip at least one page' });
    }
    if (
      options.horizontal !== true &&
      options.horizontal !== undefined &&
      (!Array.isArray(options.horizontal) || options.horizontal.some((entry) => !Number.isInteger(entry)))
    ) {
      issues.push({ message: 'Flip targets must be whole page indexes' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    // Source + an embedded redraw of everything; a page embed keeps the
    // source's streams alive once more.
    return { memoryBytes: totalInputBytes(input) * 3 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const pageCount = await probePageCount(file.data, {
      ...(file.password ? { password: file.password } : {}),
    });

    const sources = toSources([file]);
    const doc = await composeDocument(sources, identityRefs([pageCount]), ctx);

    const horizontal = axisPerPageCount(input.options?.horizontal, pageCount);
    const vertical = axisPerPageCount(input.options?.vertical, pageCount);
    let flipped = 0;
    for (let i = 0; i < pageCount; i += 1) if (horizontal[i] || vertical[i]) flipped += 1;
    // A both-axes flip (double mirror) is a 180° turn: one pass cannot express
    // it, so those pages run through both passes.
    const both = horizontal.map((h, i) => h && vertical[i]);
    if (both.every((value) => !value)) {
      const axes: (FlipAxis | null)[] = [];
      for (let i = 0; i < pageCount; i += 1) {
        if (horizontal[i]) axes.push('horizontal');
        else if (vertical[i]) axes.push('vertical');
        else axes.push(null);
      }
      await mirrorPages(doc, axes, ctx);
    } else {
      await mirrorPages(
        doc,
        horizontal.map((h, i) => (h || both[i] ? ('horizontal' as FlipAxis) : null)),
        ctx,
      );
      await mirrorPages(
        doc,
        vertical.map((v) => (v ? ('vertical' as FlipAxis) : null)),
        ctx,
      );
    }

    const bytes = await doc.save({ useObjectStreams: false });
    return {
      data: toArrayBuffer(bytes),
      pageCount,
      fileName: safeOutputName(input.options?.outputName, `${baseName(file.name)}-flipped`),
      flipped,
    };
  },
};
