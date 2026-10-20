/**
 * Watermark job -- powers Watermark.
 *
 * The PDF is required; the watermark image, when used, rides in `options`
 * (structured-cloned over postMessage, like the editor's embedded images).
 * Composition first (page selection applies), then the mark is drawn by
 * `ops/watermark`.
 */

import type { JobDefinition } from '../job.js';
import { composeDocument, identityRefs } from '../ops/compose.js';
import { probePageCount } from '../ops/pages.js';
import { watermarkDocument, type WatermarkSpec } from '../ops/watermark.js';
import { baseName, safeOutputName, toArrayBuffer, toSources, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type WatermarkJobOptions = {
  spec?: WatermarkSpec;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface WatermarkJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: WatermarkJobOptions;
}

export interface WatermarkJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
}

export const watermarkJob: JobDefinition<WatermarkJobInput, WatermarkJobOutput> = {
  slug: 'watermark',
  label: 'Apply a watermark',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const spec = input.options?.spec;
    if (!spec) issues.push({ message: 'Configure the watermark first' });
    else if (spec.mode === 'text') {
      if (!spec.text?.trim()) issues.push({ message: 'Enter watermark text' });
    } else if (spec.mode === 'image') {
      if (!spec.image?.data?.length) issues.push({ message: 'Choose a PNG or JPEG image' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input) * 2 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const spec = input.options!.spec!;
    const pageCount = await probePageCount(file.data, {
      ...(file.password ? { password: file.password } : {}),
    });

    const sources = toSources([file]);
    const doc = await composeDocument(sources, identityRefs([pageCount]), ctx);
    await watermarkDocument(doc, spec, ctx);

    const bytes = await doc.save({ useObjectStreams: false });
    return {
      data: toArrayBuffer(bytes),
      pageCount,
      fileName: safeOutputName(input.options?.outputName, `${baseName(file.name)}-watermarked`),
    };
  },
};
