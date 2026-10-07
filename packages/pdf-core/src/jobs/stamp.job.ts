/**
 * Stamp job -- powers Page Numbers and Header & Footer.
 *
 * Composes the selected pages first (so stamping respects page selection),
 * then draws header/footer text with `{n}` / `{N}` template tokens.
 */

import type { JobDefinition } from '../job.js';
import { composeDocument, identityRefs, type PageRef } from '../ops/compose.js';
import { probePageCount } from '../ops/pages.js';
import { stampDocument, type StampContent, type StampStyle } from '../ops/stamp.js';
import { baseName, toArrayBuffer, toSources, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type StampJobOptions = {
  /** Output pages in order; defaults to every page of every file. */
  pageOrder?: PageRef[];
  header?: StampContent['header'];
  footer?: StampContent['footer'];
  style?: StampStyle;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface StampJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: StampJobOptions;
}

export interface StampJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
}

export const stampJob: JobDefinition<StampJobInput, StampJobOutput> = {
  slug: 'stamp',
  label: 'Add text to pages',

  validate(input) {
    const issues = [];
    if (input.files.length === 0) issues.push({ message: 'Add at least one PDF' });
    const header = input.options?.header?.text?.trim();
    const footer = input.options?.footer?.text?.trim();
    if (!header && !footer) issues.push({ message: 'Enter header or footer text' });
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input) * 2 };
  },

  async run(input, ctx) {
    const sources = toSources(input.files);
    const options = input.options ?? {};

    let refs = options.pageOrder;
    if (!refs?.length) {
      const counts = await Promise.all(
        input.files.map((file) =>
          probePageCount(file.data, { ...(file.password ? { password: file.password } : {}) }),
        ),
      );
      refs = identityRefs(counts);
    }

    const doc = await composeDocument(sources, refs, ctx);
    await stampDocument(
      doc,
      { ...(options.header ? { header: options.header } : {}), ...(options.footer ? { footer: options.footer } : {}) },
      ctx,
      options.style ?? {},
    );

    const bytes = await doc.save({ useObjectStreams: false });
    const stem = options.outputName?.trim() || `${baseName(input.files[0]?.name ?? 'document')}-stamped`;
    return {
      data: toArrayBuffer(bytes),
      pageCount: refs.length,
      fileName: stem.endsWith('.pdf') ? stem : `${stem}.pdf`,
    };
  },
};
