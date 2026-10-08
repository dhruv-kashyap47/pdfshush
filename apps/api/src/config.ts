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

  /**
   * Run the worker in this same process (dev convenience; off in production).
   * Left undefined when unset so the environment-dependent default applies. The
   * old transform turned "unset" into `false`, so the default never ran and
   * `pnpm dev` accepted jobs it never processed.
   */
  EMBEDDED_WORKER: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true' || value === '1')),

  /**
   * Secret that keys quota subjects and job tokens. Set it explicitly in any
   * real deployment. When unset, a random one is created once and kept on the
   * work volume, so restarts do not invalidate job tokens or reset quotas.
   */
  PEPPER: z.string().min(16).optional(),

  /** Jobs processed at once by one worker process (CPU-bound: keep it small). */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),

  /**
   * How long a job's files may sit in the work directory before the janitor
   * removes them, and how often it looks. Both are ops knobs: the hardening
   * gate shortens them so a sweep is observable, and a deployment can tune
   * retention without a rebuild.
   */
  FILE_TTL_MS: z.coerce.number().int().min(1_000).optional(),
  JANITOR_INTERVAL_MS: z.coerce.number().int().min(250).optional(),

  /** Anonymous quota overrides. Unset means "use LIMITS.server". */
  QUOTA_TASKS_PER_DAY: z.coerce.number().int().positive().optional(),
  QUOTA_TASKS_PER_MINUTE: z.coerce.number().int().positive().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().optional(),

  /**
   * Proxies in front of the API whose `X-Forwarded-For` we trust: a hop count
   * (`1`, `2`) or `true` for one hop. `true` used to mean "trust every
   * client-supplied header", which let anyone bypass the per-IP quota.
   */
  TRUST_PROXY: z.string().optional(),

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
    http: { port: raw.PORT, host: raw.HOST, trustProxy: parseTrustProxy(raw.TRUST_PROXY) },
    pepper: raw.PEPPER,
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
    retentionMs: raw.FILE_TTL_MS ?? LIMITS.server.fileTtlMs,
    janitorIntervalMs: raw.JANITOR_INTERVAL_MS ?? 5 * 60_000,
    logLevel: raw.LOG_LEVEL,
  } as const;
}
/** Express \	rust proxy\ value: 0 (none) or a hop count. */
function parseTrustProxy(value: string | undefined): number {
  if (value === undefined || value === '' || value === 'false' || value === '0') return 0;
  if (value === 'true') return 1;
  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
    throw new Error('TRUST_PROXY must be a hop count between 0 and 10, or true');
  }
  return hops;
}
