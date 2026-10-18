/**
 * Zod contracts for the public `/api/v1` surface.
 *
 * Schemas here are the one source of truth for three consumers (§25.3):
 * the route validation, the generated OpenAPI document, and -- in P6.3 -- the
 * MCP tool shapes. They re-use the P3 job contract (`createJobSchema`) rather
 * than describing the pipeline a second time.
 */

import { z } from 'zod';
import { MAX_UPLOAD_FILES, SERVER_SLUGS, JOB_ERROR_CODES } from '../../jobs/payload.js';

export { API_KEY_SCOPES, type ApiKeyScope } from '../../keys/store.js';

/**
 * Stable v1-only error codes. Everything a shared with the anonymous surface
 * comes from `JOB_ERROR_CODES`; codes here are the API-key equivalents of the
 * auth-layer verdicts.
 */
export const V1_ERROR_CODES = {
  unauthorized: 'unauthorized',
  insufficientScope: 'insufficient_scope',
  authDisabled: 'auth_disabled',
  tooManyKeys: 'too_many_keys',
} as const;

/**
 * `POST /api/v1/jobs` with an inline JSON body (D7). Files ride as base64 so
 * agents can submit without multipart; the 10 MB per-file ceiling keeps them
 * within an agent's context budget, and anything larger should use the
 * multipart form, which streams to disk without buffering.
 */
export const apiCreateJobSchema = z.object({
  slug: z.enum(SERVER_SLUGS),
  password: z.string().max(256).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        data: z.string().base64(),
      }),
    )
    .min(1)
    .max(MAX_UPLOAD_FILES),
});

export type ApiCreateJobRequest = z.infer<typeof apiCreateJobSchema>;

/** `POST /api/v1/jobs` response body. */
export const apiJobCreatedSchema = z.object({
  jobId: z.string(),
  status: z.literal('queued'),
  statusUrl: z.string(),
  /** Same ownership token the anonymous surface issues. */
  token: z.string(),
  files: z.array(z.object({ name: z.string(), bytes: z.number() })),
});

/** `GET /api/v1/jobs/:id` response body -- the anonymous snapshot, unchanged. */
export const apiJobStateSchema = z.object({
  status: z.enum(['queued', 'active', 'completed', 'failed']),
  progress: z
    .object({
      phase: z.string(),
      ratio: z.number().optional(),
      message: z.string().optional(),
    })
    .optional(),
  files: z.array(z.object({ name: z.string(), bytes: z.number() })).optional(),
  pageCount: z.number().optional(),
  error: z
    .object({
      message: z.string(),
      code: z.string().optional(),
    })
    .optional(),
});

export type ApiJobState = z.infer<typeof apiJobStateSchema>;

/** `GET /api/v1/jobs/:id/result` when the job produced more than one file. */
export const apiJobResultListingSchema = z.object({
  jobId: z.string(),
  files: z.array(
    z.object({
      name: z.string(),
      bytes: z.number(),
      url: z.string(),
    }),
  ),
});

/** Codes a v1 error body may carry, all stable for clients to branch on. */
export const V1_ERROR_CODE_VALUES = [...Object.values(JOB_ERROR_CODES), ...Object.values(V1_ERROR_CODES)];
