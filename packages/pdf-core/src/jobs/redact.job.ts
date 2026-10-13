/**
 * Redact PDF -- rebuild the document from sanitized page images.
 *
 * The output contains no original content stream, text layer, annotation, form
 * field, attachment or metadata, because every page is re-rendered, has the marks
 * burned into its pixels, and the document is assembled from those images alone.
 * The trade the user is making — loss of text selection, search, links and vector
 * quality — is returned in the report and must be disclosed before confirmation.
 *
 * Fail-closed throughout: no canvas, too many pages, an oversized result, a
 * render failure or a failed verification all produce an error rather than a file.
 */

import type { JobDefinition } from '../job.js';
import { defaultRedactEnvironment, redactPdf } from '../redact/redact.js';
import type { RedactOptions, RedactRegion, RedactionReport } from '../redact/types.js';
import { baseName, safeOutputName, totalInputBytes } from './helpers.js';
import { LIMITS } from '../limits.js';

export type RedactJobOptions = {
  regions?: RedactRegion[];
  /** Opaque mark colour; defaults to black. */
  fill?: string;
  rasterDpi?: number;
  /** Strings that must not survive, checked against the serialized output. */
  forbiddenStrings?: string[];
  outputName?: string;
};

export interface RedactJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: RedactJobOptions;
}

export interface RedactJobOutput {
  data: ArrayBuffer;
  name: string;
  pageCount: number;
  /** Always true on success: the serialized bytes passed independent verification. */
  verified: boolean;
  report: RedactionReport;
}

export const redactJob: JobDefinition<RedactJobInput, RedactJobOutput> = {
  slug: 'redact',
  label: 'Redact PDF',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Redact works on exactly one PDF at a time' });
    const regions = input.options?.regions ?? [];
    if (regions.length === 0) issues.push({ message: 'Mark at least one area to redact' });
    if (regions.length > LIMITS.tool.maxRedactRegions) {
      issues.push({ message: `At most ${LIMITS.tool.maxRedactRegions} areas can be redacted at once` });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    // Rasterization holds the source document plus one page bitmap at a time,
    // plus the accumulating output.
    return { memoryBytes: totalInputBytes(input) * 2 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const options = input.options ?? {};
    ctx.throwIfAborted();

    const result = await redactPdf(
      file.data,
      {
        regions: options.regions ?? [],
        ...(options.fill !== undefined ? { fill: options.fill } : {}),
        ...(options.rasterDpi !== undefined ? { rasterDpi: options.rasterDpi } : {}),
        ...(options.forbiddenStrings ? { forbiddenStrings: options.forbiddenStrings } : {}),
      } satisfies RedactOptions,
      ctx,
      defaultRedactEnvironment(),
      file.password,
    );

    return {
      data: result.data,
      name: safeOutputName(options.outputName, `${baseName(file.name)}-redacted`),
      pageCount: result.pageCount,
      verified: true,
      report: result.report,
    };
  },
};
