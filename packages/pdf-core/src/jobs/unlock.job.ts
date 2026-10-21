/**
 * Unlock job. Accepts the password either as a tool option (what the UI sends)
 * or on the input file (the contract every other tool already supports), so a
 * workflow step can carry it too.
 */

import type { JobDefinition } from '../job.js';
import { unlockDocument } from '../ops/unlock.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type UnlockJobOptions = {
  password?: string;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface UnlockJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: UnlockJobOptions;
}

export interface UnlockJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
  wasEncrypted: boolean;
}

export const unlockJob: JobDefinition<UnlockJobInput, UnlockJobOutput> = {
  slug: 'unlock',
  label: 'Remove PDF password',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const password = input.options?.password;
    if (password !== undefined && typeof password !== 'string') {
      issues.push({ message: 'Password must be text' });
    } else if (typeof password === 'string' && password.length > 256) {
      issues.push({ message: 'That password is longer than any PDF supports' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input) * 2 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const password = input.options?.password ?? file.password;
    const result = await unlockDocument(file.data, password, ctx);

    return {
      data: toArrayBuffer(result.data),
      pageCount: result.pageCount,
      fileName: safeOutputName(input.options?.outputName, `${baseName(file.name)}-unlocked`),
      wasEncrypted: result.wasEncrypted,
    };
  },
};
