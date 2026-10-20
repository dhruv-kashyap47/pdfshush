/**
 * Resize job -- powers Resize PDF.
 *
 * Every page is recomposed per its own plan: a paper-size preset (A4/Letter)
 * with a uniform "fit" scale, or a custom percentage. Content is embedded and
 * redrawn, so vectors survive and the page boxes are exact.
 */

import type { JobDefinition } from '../job.js';
import { composeDocument, identityRefs } from '../ops/compose.js';
import { probePageCount } from '../ops/pages.js';
import {
  planResize,
  resizePages,
  type ResizePlan,
  type ResizeRequest,
} from '../ops/transform.js';
import { baseName, safeOutputName, toArrayBuffer, toSources, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type ResizeJobOptions = {
  request?: ResizeRequest;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface ResizeJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: ResizeJobOptions;
}

export interface ResizeJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
}

export const resizeJob: JobDefinition<ResizeJobInput, ResizeJobOutput> = {
  slug: 'resize',
  label: 'Resize pages',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const request = input.options?.request;
    if (!request) {
      issues.push({ message: 'Choose a paper size or a custom scale' });
    } else if (request.kind === 'percent') {
      if (!Number.isFinite(request.percent) || request.percent < 25 || request.percent > 400) {
        issues.push({ message: 'Custom scale must be between 25% and 400%' });
      }
    } else if (request.kind === 'preset') {
      if (request.preset !== 'a4' && request.preset !== 'letter') {
        issues.push({ message: 'Choose A4 or Letter' });
      }
    } else {
      issues.push({ message: 'Choose a paper size or a custom scale' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input) * 3 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const request = input.options!.request!;
    const pageCount = await probePageCount(file.data, {
      ...(file.password ? { password: file.password } : {}),
    });

    const sources = toSources([file]);
    const doc = await composeDocument(sources, identityRefs([pageCount]), ctx);
    const plans: ResizePlan[] = doc
      .getPages()
      .map((page) => planResize({ width: page.getSize().width, height: page.getSize().height }, request));
    await resizePages(doc, plans, ctx);

    const bytes = await doc.save({ useObjectStreams: false });
    return {
      data: toArrayBuffer(bytes),
      pageCount,
      fileName: safeOutputName(input.options?.outputName, `${baseName(file.name)}-resized`),
    };
  },
};
