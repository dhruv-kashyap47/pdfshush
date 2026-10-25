/**
 * Repair PDF job -- re-serialize a document to rebuild its structure.
 *
 * The engine work lives in `ops/repair`; this job owns validation, the output
 * name and reporting. It deliberately does not claim to recover lost content.
 */

import type { JobDefinition } from '../job.js';
import { repairPdf } from '../ops/repair.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type RepairJobOptions = {
  /** Password for an encrypted source. */
  password?: string;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface RepairJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: RepairJobOptions;
}

export interface RepairJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  /** The source failed a strict structural load and had to be parsed leniently. */
  rebuilt: boolean;
  fileName: string;
}

export const repairJob: JobDefinition<RepairJobInput, RepairJobOutput> = {
  slug: 'repair',
  label: 'Repair a PDF',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const password = input.options?.password;
    if (password !== undefined && typeof password !== 'string') {
      issues.push({ message: 'The password must be text' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    // Source + rebuilt object graph + the serialized output.
    return { memoryBytes: totalInputBytes(input) * 3 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const options = input.options ?? {};
    const password = options.password ?? file.password;
    const result = await repairPdf(file.data, ctx, {
      ...(password !== undefined ? { password } : {}),
    });

    return {
      data: toArrayBuffer(result.data),
      pageCount: result.pageCount,
      rebuilt: result.rebuilt,
      fileName: safeOutputName(options.outputName, `${baseName(file.name)}-repaired`),
    };
  },
};
