/**
 * Bates numbering job.
 *
 * Every option is clamped by `ops/bates`; the job validates the envelope so a
 * malformed request is rejected before pdf-lib is asked to open anything.
 */

import type { JobDefinition } from '../job.js';
import { batesNumberDocument, BATES_LIMITS } from '../ops/bates.js';
import type { StampPosition } from '../ops/stamp.js';
import { loadPdfDocument } from '../ops/pages.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

const POSITIONS: ReadonlySet<string> = new Set<StampPosition>([
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]);

/** Type alias (not interface) for the implicit index signature constraint. */
export type BatesJobOptions = {
  prefix?: string;
  start?: number;
  digits?: number;
  position?: StampPosition;
  fontSize?: number;
  margin?: number;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface BatesJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: BatesJobOptions;
}

export interface BatesJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
  /** First and last number written, so the UI can state the range it produced. */
  start: number;
  end: number;
}

export const batesJob: JobDefinition<BatesJobInput, BatesJobOutput> = {
  slug: 'bates-numbering',
  label: 'Add Bates numbering',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const options = input.options ?? {};
    if (options.prefix !== undefined && options.prefix.length > BATES_LIMITS.maxPrefixChars) {
      issues.push({ message: `Prefix is longer than ${BATES_LIMITS.maxPrefixChars} characters` });
    }
    if (
      options.start !== undefined &&
      (!Number.isInteger(options.start) ||
        options.start < BATES_LIMITS.minStart ||
        options.start > BATES_LIMITS.maxStart)
    ) {
      issues.push({ message: 'Starting number must be a positive whole number' });
    }
    if (
      options.digits !== undefined &&
      (!Number.isInteger(options.digits) ||
        options.digits < BATES_LIMITS.minDigits ||
        options.digits > BATES_LIMITS.maxDigits)
    ) {
      issues.push({ message: `Digits must be between ${BATES_LIMITS.minDigits} and ${BATES_LIMITS.maxDigits}` });
    }
    if (options.position !== undefined && !POSITIONS.has(options.position)) {
      issues.push({ message: 'Choose a valid stamp position' });
    }
    if (
      options.fontSize !== undefined &&
      (!Number.isFinite(options.fontSize) || options.fontSize < 4 || options.fontSize > 72)
    ) {
      issues.push({ message: 'Font size must be between 4 and 72 pt' });
    }
    if (
      options.margin !== undefined &&
      (!Number.isFinite(options.margin) || options.margin < 0 || options.margin > 200)
    ) {
      issues.push({ message: 'Margin must be between 0 and 200 pt' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input) * 2 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const doc = await loadPdfDocument(file.data, {
      ...(file.password ? { password: file.password } : {}),
    });
    ctx.throwIfAborted();

    const options = input.options ?? {};
    const result = await batesNumberDocument(doc, options, ctx, {
      ...(options.fontSize !== undefined ? { fontSize: options.fontSize } : {}),
      ...(options.margin !== undefined ? { margin: options.margin } : {}),
    });

    const bytes = await doc.save({ useObjectStreams: false });
    return {
      data: toArrayBuffer(bytes),
      pageCount: result.pages,
      fileName: safeOutputName(options.outputName, `${baseName(file.name)}-bates`),
      start: result.start,
      end: result.end,
    };
  },
};
