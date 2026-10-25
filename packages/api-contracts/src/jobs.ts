/**
 * Job payload contract between the API and the workers (moved from
 * `apps/api/src/jobs/payload.ts` in §25.3/§25.4 so the REST spec, the docs
 * page and the MCP package all read one module).
 *
 * The payload carries **paths, never bytes**: PDF data never enters Redis, so
 * queue depth costs kilobytes regardless of file size, and the TTL janitor has
 * exactly one place to sweep.
 */

import { z } from 'zod';

/** Most files one request may carry. Schema, route and uploader all read this. */
export const MAX_UPLOAD_FILES = 50;

/** Queue name for pdf-core work (light and heavy jobs share the contract). */
export const QUEUE_PDF = 'pdf';

/**
 * Slugs the server may run.
 *
 * Everything listed here runs on pdf-lib alone, through the same
 * `JobDefinition` the browser uses. Rendering jobs (`thumbnails`,
 * `pdf-to-images`) and `text-runs` stay client-only: they need a canvas or a
 * pdf.js worker configuration the server does not have yet.
 */
export const SERVER_SLUGS = [
  'inspect',
  'merge',
  'organize',
  'stamp',
  'split-by-pages',
  'split-in-half',
  'n-up',
  'edit',
] as const;

const MAX_OPTION_KEY_LENGTH = 128;
/** Keys allowed on any one object in `options`. */
export const MAX_OPTION_KEYS = 64;
/** Container nesting allowed in `options` (the top-level object is depth 1). */
export const MAX_OPTION_DEPTH = 8;
/** Total values (keys, array entries, primitives) accepted in `options`. */
export const MAX_OPTION_NODES = 1024;

/**
 * Structural verdict for a free-form `options` value.
 *
 * Tools own their option shapes, so this cannot be a closed schema; but it must
 * not be an open door either. Without a bound, one request can hand the queue a
 * deeply nested / very wide object that every downstream reader has to walk.
 * The limits are generous by an order of magnitude over any shipped tool.
 */
export function optionsProblem(value: unknown): string | undefined {
  let nodes = 0;
  const containers = new Set<object>();

  const walk = (node: unknown, depth: number): string | undefined => {
    nodes += 1;
    if (nodes > MAX_OPTION_NODES) {
      return `The "options" field is too large (limit ${MAX_OPTION_NODES} values).`;
    }
    if (node === null || typeof node !== 'object') return undefined;
    if (depth > MAX_OPTION_DEPTH) {
      return `The "options" field is nested too deeply (limit ${MAX_OPTION_DEPTH}).`;
    }
    // JSON cannot produce a cycle, but a caller of the schema can. The set is
    // path-scoped so the same (acyclic) object appearing twice is not a cycle.
    if (containers.has(node)) return 'The "options" field contains a cycle.';
    containers.add(node);
    if (Array.isArray(node)) {
      for (const entry of node) {
        const problem = walk(entry, depth + 1);
        if (problem) return problem;
      }
    } else {
      const keys = Object.keys(node);
      if (keys.length > MAX_OPTION_KEYS) {
        return `The "options" field has too many keys at one level (limit ${MAX_OPTION_KEYS}).`;
      }
      for (const key of keys) {
        const problem = walk((node as Record<string, unknown>)[key], depth + 1);
        if (problem) return problem;
      }
    }
    containers.delete(node);
    return undefined;
  };

  return walk(value, 1);
}

/**
 * Optional, structurally bounded `options` object.
 *
 * Exported because `/api/v1` validates the same field before it ever becomes a
 * job payload; both paths must reject the same shapes.
 */
export const optionsSchema = z
  .record(z.string().max(MAX_OPTION_KEY_LENGTH), z.unknown())
  .superRefine((value, ctx) => {
    const problem = optionsProblem(value);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  })
  .optional();

/** What the API hands to BullMQ. */
export const jobPayloadSchema = z.object({
  jobId: z.string().min(8).max(64),
  slug: z.enum(SERVER_SLUGS),
  /**
   * Filenames only. The worker derives its directories from `WORK_DIR` + jobId,
   * so a payload can never point a worker at an arbitrary path.
   */
  files: z.array(z.string().min(1)).min(1).max(MAX_UPLOAD_FILES),
  password: z.string().max(256).optional(),
  options: optionsSchema,
  /** Opaque hash of the submitter -- never their IP. */
  subject: z.string().min(8).max(64),
  requestedAt: z.number().int().nonnegative(),
});

export type JobPayload = z.infer<typeof jobPayloadSchema>;

/** Body of `POST /api/jobs` (after the upload has been written to disk). */
export const createJobSchema = z.object({
  slug: z.enum(SERVER_SLUGS),
  password: z.string().max(256).optional(),
  options: optionsSchema,
  /** Filenames as uploaded; order is preserved (merge depends on it). */
  files: z.array(z.string().min(1)).min(1).max(MAX_UPLOAD_FILES),
});

export type JobStatus = 'queued' | 'active' | 'completed' | 'failed';

export interface JobProgressSnapshot {
  phase: string;
  ratio?: number;
  message?: string;
}

export interface JobResultFile {
  name: string;
  bytes: number;
}

export interface JobStateSnapshot {
  status: JobStatus;
  progress?: JobProgressSnapshot;
  /** Output files, relative names inside the job's output directory. */
  files?: JobResultFile[];
  pageCount?: number;
  error?: { message: string; code?: string };
}

/** Reason codes the API returns, stable enough for the web app to branch on. */
export const JOB_ERROR_CODES = {
  validation: 'validation_failed',
  unknownSlug: 'unknown_slug',
  missingField: 'missing_field',
  quota: 'quota_exceeded',
  tooLarge: 'upload_too_large',
  timeout: 'timeout',
  aborted: 'aborted',
  output: 'unsupported_output',
  internal: 'internal_error',
  unknownJob: 'unknown_job',
  resultNotFound: 'result_not_found',
  forbidden: 'forbidden',
  notCancellable: 'not_cancellable',
} as const;

export type JobErrorCode = (typeof JOB_ERROR_CODES)[keyof typeof JOB_ERROR_CODES];
/**
 * Failure reasons travel through BullMQ as plain text. The stable code is
 * prefixed onto the message so the API can recover it; without this every
 * failure reached clients as `internal_error`, and the codes above were
 * unreachable.
 */
export function formatFailure(code: string, message: string): string {
  return `[${code}] ${message}`;
}

export function parseFailure(reason: string | undefined): { code: JobErrorCode; message: string } {
  const match = reason ? /^\[([a-z_]+)\] ([\s\S]*)$/.exec(reason) : null;
  const known = new Set<string>(Object.values(JOB_ERROR_CODES));
  if (match && known.has(match[1]!)) {
    return { code: match[1] as JobErrorCode, message: match[2]! };
  }
  return { code: JOB_ERROR_CODES.internal, message: reason ?? 'Job failed' };
}
