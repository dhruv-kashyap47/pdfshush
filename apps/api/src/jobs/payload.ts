/**
 * Job payload contract between the API and the workers.
 *
 * The payload carries **paths, never bytes**: PDF data never enters Redis, so
 * queue depth costs kilobytes regardless of file size, and the TTL janitor has
 * exactly one place to sweep.
 */

import { z } from 'zod';

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

export type ServerSlug = (typeof SERVER_SLUGS)[number];

const optionsSchema = z.record(z.string(), z.unknown()).optional();

/** What the API hands to BullMQ. */
export const jobPayloadSchema = z.object({
  jobId: z.string().min(8).max(64),
  slug: z.enum(SERVER_SLUGS),
  /**
   * Filenames only. The worker derives its directories from `WORK_DIR` + jobId,
   * so a payload can never point a worker at an arbitrary path.
   */
  files: z.array(z.string().min(1)).min(1).max(50),
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
  files: z.array(z.string().min(1)).min(1).max(50),
});

export type CreateJobRequest = z.infer<typeof createJobSchema>;

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
} as const;

export type JobErrorCode = (typeof JOB_ERROR_CODES)[keyof typeof JOB_ERROR_CODES];