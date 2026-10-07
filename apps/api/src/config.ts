/**
 * Runtime configuration.
 *
 * Everything comes from the environment and is validated once at boot: a
 * misconfigured server should fail immediately and loudly, not at the first
 * upload. Defaults are the development posture (localhost Redis, in-process
 * worker disabled).
 */

import { z } from 'zod';
import { LIMITS } from '@pdfshush/pdf-core/node';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),

  /** Redis connection. BullMQ accepts a URL; keep credentials out of code. */
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),

  /** Where uploads and results live. Must be on a real volume in production. */
  WORK_DIR: z.string().min(1).default('.work'),

  /** Run the worker in this same process (dev convenience; off in production). */
  EMBEDDED_WORKER: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),

  /** Jobs processed at once by one worker process (CPU-bound: keep it small). */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),

  /** Anonymous quota overrides. Unset means "use LIMITS.server". */
  QUOTA_TASKS_PER_DAY: z.coerce.number().int().positive().optional(),
  QUOTA_TASKS_PER_MINUTE: z.coerce.number().int().positive().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().optional(),

  /** Comma-separated allowlist for CORS; empty means same-origin only. */
  CORS_ORIGINS: z.string().optional(),

  /** Trust `X-Forwarded-For` only behind a proxy we control. */
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type ApiConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid API configuration:\n  - ${detail.join('\n  - ')}`);
  }
  const raw = parsed.data;

  return {
    env: raw.NODE_ENV,
    isProduction: raw.NODE_ENV === 'production',
    http: { port: raw.PORT, host: raw.HOST, trustProxy: raw.TRUST_PROXY },
    redis: { url: raw.REDIS_URL },
    workDir: raw.WORK_DIR,
    embeddedWorker: raw.EMBEDDED_WORKER ?? !raw.NODE_ENV.startsWith('production'),
    workerConcurrency: raw.WORKER_CONCURRENCY,
    quota: {
      tasksPerDay: raw.QUOTA_TASKS_PER_DAY ?? LIMITS.server.anonymousTasksPerDay,
      tasksPerMinute: raw.QUOTA_TASKS_PER_MINUTE ?? LIMITS.server.anonymousTasksPerMinute,
      maxUploadBytes: raw.MAX_UPLOAD_BYTES ?? LIMITS.server.maxUploadBytes,
      bytesPerDay: LIMITS.server.anonymousBytesPerDay,
    },
    retentionMs: LIMITS.server.fileTtlMs,
    corsOrigins: (raw.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    logLevel: raw.LOG_LEVEL,
  } as const;
}