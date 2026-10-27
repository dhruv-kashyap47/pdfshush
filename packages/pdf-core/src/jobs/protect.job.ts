/**
 * Protect job: real encryption in the browser worker.
 *
 * Passwords arrive as tool options (the UI) or on the input file (workflow
 * steps). They are never written to the job result, progress messages or the
 * output file name.
 */

import type { JobDefinition } from '../job.js';
import { protectDocument } from '../ops/protect.js';
import {
  PROTECT_DEFAULT_PERMISSIONS,
  PROTECT_LIMITS,
  type ProtectPermissions,
} from '../ops/protectConfig.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

const PERMISSION_KEYS = new Set<keyof ProtectPermissions>([
  'printing',
  'copying',
  'modifying',
  'annotating',
  'fillingForms',
  'documentAssembly',
]);

/** Type alias (not interface) for the implicit index signature constraint. */
export type ProtectJobOptions = {
  userPassword?: string;
  ownerPassword?: string;
  permissions?: Partial<ProtectPermissions>;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface ProtectJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: ProtectJobOptions;
}

export interface ProtectJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
  algorithm: 'AES-256';
  permissions: ProtectPermissions;
  ownerPasswordGenerated: boolean;
  originalBytes: number;
}

export const protectJob: JobDefinition<ProtectJobInput, ProtectJobOutput> = {
  slug: 'protect',
  label: 'Protect PDF',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });

    const options = input.options ?? {};
    const userPassword = options.userPassword;
    if (typeof userPassword !== 'string' || userPassword.length === 0) {
      issues.push({ message: 'Choose an open password' });
    } else if (userPassword.length < PROTECT_LIMITS.minPasswordLength) {
      issues.push({
        message: `Use at least ${PROTECT_LIMITS.minPasswordLength} characters for the open password`,
      });
    } else if (userPassword.length > PROTECT_LIMITS.maxPasswordLength) {
      issues.push({
        message: `Keep the password under ${PROTECT_LIMITS.maxPasswordLength} characters`,
      });
    }

    const ownerPassword = options.ownerPassword;
    if (ownerPassword !== undefined) {
      if (typeof ownerPassword !== 'string') {
        issues.push({ message: 'The owner password must be text' });
      } else if (
        ownerPassword.length > 0 &&
        ownerPassword.length < PROTECT_LIMITS.minPasswordLength
      ) {
        issues.push({
          message: `Use at least ${PROTECT_LIMITS.minPasswordLength} characters for the owner password, or leave it blank`,
        });
      } else if (ownerPassword.length > PROTECT_LIMITS.maxPasswordLength) {
        issues.push({
          message: `Keep the owner password under ${PROTECT_LIMITS.maxPasswordLength} characters`,
        });
      } else if (ownerPassword.length > 0 && ownerPassword === userPassword) {
        issues.push({ message: 'The owner password must be different from the open password' });
      }
    }

    const permissions = options.permissions;
    if (permissions !== undefined) {
      if (permissions === null || typeof permissions !== 'object' || Array.isArray(permissions)) {
        issues.push({ message: 'Permissions must be a set of on/off choices' });
      } else {
        for (const [key, value] of Object.entries(permissions)) {
          if (!PERMISSION_KEYS.has(key as keyof ProtectPermissions)) {
            issues.push({ message: `Unknown permission "${key}"` });
          } else if (typeof value !== 'boolean') {
            issues.push({ message: `Permission "${key}" must be true or false` });
          }
        }
      }
    }

    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    // Encrypting rewrites every stream; keep room for the plaintext parse plus
    // the encrypted copy (and pdf-lib's serialization buffers).
    return { memoryBytes: totalInputBytes(input) * 3 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const options = input.options ?? {};
    const permissions = {
      ...PROTECT_DEFAULT_PERMISSIONS,
      ...(options.permissions ?? {}),
    };

    const result = await protectDocument(
      file.data,
      {
        userPassword: options.userPassword ?? '',
        ...(options.ownerPassword !== undefined
          ? { ownerPassword: options.ownerPassword }
          : {}),
        permissions,
      },
      ctx,
    );

    return {
      data: toArrayBuffer(result.data),
      pageCount: result.pageCount,
      fileName: safeOutputName(options.outputName, `${baseName(file.name)}-protected`),
      algorithm: result.algorithm,
      permissions: result.permissions,
      ownerPasswordGenerated: result.ownerPasswordGenerated,
      originalBytes: file.data.byteLength,
    };
  },
};
