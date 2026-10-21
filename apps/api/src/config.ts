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
   * Hard V8 heap ceiling for a single sandboxed job child, in MB. Node aborts
   * that child with a heap error at this bound instead of letting the host's
   * OOM killer pick a victim (which could be the API). Sized above the largest
   * job admission control will accept, so a legitimate job still finishes.
   */
  WORKER_CHILD_MAX_OLD_SPACE_MB: z.coerce.number().int().min(128).max(16_384).optional(),

  /**
   * How long a job's files may sit in the work directory before the janitor
   * removes them, and how often it looks. Both are ops knobs: the hardening
   * gate shortens them so a sweep is observable, and a deployment can tune
   * retention without a rebuild.
   */
  FILE_TTL_MS: z.coerce.number().int().min(1_000).optional(),
  JANITOR_INTERVAL_MS: z.coerce.number().int().min(250).optional(),

  /**
   * Wall-clock ceiling for a single job child, in ms. Past this the host kills
   * it outright. The in-job timeout is cooperative -- it cannot interrupt
   * synchronous CPU work -- and BullMQ renews the job lock from the host, so a
   * stuck child never looks stalled to anyone. Defaults to the job timeout
   * ceiling plus a margin, because a job still running past that point is stuck
   * rather than slow.
   */
  JOB_HARD_LIMIT_MS: z.coerce.number().int().min(1_000).optional(),

  /** Anonymous quota overrides. Unset means "use LIMITS.server". */
  QUOTA_TASKS_PER_DAY: z.coerce.number().int().positive().optional(),
  QUOTA_TASKS_PER_MINUTE: z.coerce.number().int().positive().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().optional(),

  /**
   * Public API tier overrides (PLAN.md §25.3 D6). Unset means
   * "use LIMITS.server.api". Quota is measured per key, with the account
   * values as the ceiling over every key of that account.
   */
  API_KEY_TASKS_PER_MINUTE: z.coerce.number().int().positive().optional(),
  API_KEY_TASKS_PER_DAY: z.coerce.number().int().positive().optional(),
  API_KEY_BYTES_PER_DAY: z.coerce.number().int().positive().optional(),
  API_ACCOUNT_TASKS_PER_DAY: z.coerce.number().int().positive().optional(),
  API_ACCOUNT_BYTES_PER_DAY: z.coerce.number().int().positive().optional(),
  API_MAX_KEYS_PER_ACCOUNT: z.coerce.number().int().positive().optional(),
  API_MAX_INLINE_FILE_BYTES: z.coerce.number().int().positive().optional(),
  /** Per-key ceiling on status/result reads per minute (poll loops). */
  API_READS_PER_MINUTE: z.coerce.number().int().positive().optional(),

  /**
   * Largest working set `estimate()` may report for one job before the worker
   * refuses it. Unset means "use LIMITS.job.maxWorkingSetBytes". Raise it
   * together with MAX_UPLOAD_BYTES: a bigger input cap means bigger estimates.
   */
  MAX_JOB_WORKING_SET_BYTES: z.coerce.number().int().positive().optional(),

  /**
   * Per-IP ceiling on `/api/auth/*`, in requests per minute.
   *
   * The anonymous tool quota deliberately does not cover these routes: each one
   * is unauthenticated and does work worth amplifying -- `/start` writes a
   * transaction row and `/callback` performs an outbound token exchange -- so a
   * loop against them is cheap for the attacker and costs us storage and
   * outbound requests.
   */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().optional(),

  /**
   * Proxies in front of the API whose `X-Forwarded-For` we trust: a hop count
   * (`1`, `2`) or `true` for one hop. `true` used to mean "trust every
   * client-supplied header", which let anyone bypass the per-IP quota.
   */
  TRUST_PROXY: z.string().optional(),

  /** Mongo connection for accounts, sessions and in-flight auth state. */
  MONGODB_URI: z.string().optional(),
  MONGODB_DB: z.string().min(1).default('pdfshush'),
  /** Only needed when the URI itself carries no credentials. */
  MONGODB_USERNAME: z.string().optional(),
  MONGODB_PASSWORD: z.string().optional(),

  /**
   * Google OIDC. Authentication stays off unless a Mongo URI and both Google
   * credentials are present, so a deployment (and CI) without them behaves
   * exactly as it did before: every tool anonymous, nothing to sign into.
   */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /**
   * Sent verbatim as `redirect_uri` and registered verbatim in Google Cloud
   * Console. Google rejects the request unless the two match byte for byte,
   * including scheme, host and port.
   */
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  /** Origin the SPA is served from. Login returns the browser here. */
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  /** Session lifetime; also the cookie's max-age and the DB TTL. */
  SESSION_TTL_MS: z.coerce.number().int().min(60_000).default(30 * 24 * 60 * 60 * 1000),
  /**
   * `Secure` flag on the session cookie. Defaults to on in production, where
   * TLS terminates; a dev server on http://localhost cannot set it.
   */
  SESSION_COOKIE_SECURE: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /**
   * Managed AI. Off unless the deployment sets a key (the model has a default
   * now: OpenRouter's strongest free-tier model, rotated on deprecation), so a
   * deployment without them behaves exactly as before (BYOK only) and CI needs
   * no secrets. `AI_MANAGED_MODEL` still overrides the default, and any
   * registered provider id is accepted here ('anthropic', 'groq', …).
   */
  AI_MANAGED_PROVIDER: z.string().default('openrouter'),
  AI_MANAGED_MODEL: z.string().default('minimax/minimax-m3.1-flash:free'),
  AI_MANAGED_API_KEY: z.string().optional(),
  AI_MANAGED_BASE_URL: z.string().optional(),
  AI_MANAGED_DAILY_TOKENS: z.coerce.number().int().positive().optional(),
  AI_MANAGED_ANON_DAILY_TOKENS: z.coerce.number().int().positive().optional(),
  AI_MANAGED_PER_MINUTE: z.coerce.number().int().positive().optional(),
  AI_MANAGED_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().optional(),
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
    workerChildMaxOldSpaceMb: raw.WORKER_CHILD_MAX_OLD_SPACE_MB ?? 2048,
    maxJobWorkingSetBytes: raw.MAX_JOB_WORKING_SET_BYTES ?? LIMITS.job.maxWorkingSetBytes,
    quota: {
      tasksPerDay: raw.QUOTA_TASKS_PER_DAY ?? LIMITS.server.anonymousTasksPerDay,
      tasksPerMinute: raw.QUOTA_TASKS_PER_MINUTE ?? LIMITS.server.anonymousTasksPerMinute,
      maxUploadBytes: raw.MAX_UPLOAD_BYTES ?? LIMITS.server.maxUploadBytes,
      bytesPerDay: LIMITS.server.anonymousBytesPerDay,
    },
    /**
     * Limits for the public REST API. Present whether or not accounts are
     * enabled -- the numbers are deployment policy, and the v1 surface reports
     * them even where keys cannot exist yet.
     */
    apikey: {
      tasksPerMinute: raw.API_KEY_TASKS_PER_MINUTE ?? LIMITS.server.api.tasksPerMinute,
      tasksPerDay: raw.API_KEY_TASKS_PER_DAY ?? LIMITS.server.api.tasksPerDay,
      bytesPerDay: raw.API_KEY_BYTES_PER_DAY ?? LIMITS.server.api.bytesPerDay,
      accountTasksPerDay: raw.API_ACCOUNT_TASKS_PER_DAY ?? LIMITS.server.api.accountTasksPerDay,
      accountBytesPerDay: raw.API_ACCOUNT_BYTES_PER_DAY ?? LIMITS.server.api.accountBytesPerDay,
      maxKeysPerAccount: raw.API_MAX_KEYS_PER_ACCOUNT ?? LIMITS.server.api.maxKeysPerAccount,
      maxInlineFileBytes: raw.API_MAX_INLINE_FILE_BYTES ?? LIMITS.server.api.maxInlineFileBytes,
      readsPerMinute: raw.API_READS_PER_MINUTE ?? 240,
    },
    retentionMs: raw.FILE_TTL_MS ?? LIMITS.server.fileTtlMs,
    janitorIntervalMs: raw.JANITOR_INTERVAL_MS ?? 5 * 60_000,
    jobHardLimitMs: raw.JOB_HARD_LIMIT_MS ?? LIMITS.job.maxTimeoutMs + 5 * 60_000,
    auth: {
      // Both halves are required: a Mongo URI with no Google credentials has
      // nothing to authenticate, and credentials with no store have nowhere to
      // put the account.
      enabled: Boolean(raw.MONGODB_URI && raw.GOOGLE_CLIENT_ID && raw.GOOGLE_CLIENT_SECRET),
      mongoUri: raw.MONGODB_URI,
      mongoDb: raw.MONGODB_DB,
      mongoUsername: raw.MONGODB_USERNAME,
      mongoPassword: raw.MONGODB_PASSWORD,
      googleClientId: raw.GOOGLE_CLIENT_ID,
      googleClientSecret: raw.GOOGLE_CLIENT_SECRET,
      // The dev default points at the API's own port, because that is the URL a
      // developer pastes into Google Cloud Console and the one the browser is
      // actually redirected to.
      redirectUri: raw.GOOGLE_REDIRECT_URI ?? 'http://localhost:8080/api/auth/callback',
      webOrigin: raw.WEB_ORIGIN,
      sessionTtlMs: raw.SESSION_TTL_MS,
      authRateLimitPerMinute: raw.AUTH_RATE_LIMIT_PER_MINUTE ?? 20,
      cookieSecure:
        raw.SESSION_COOKIE_SECURE === undefined
          ? raw.NODE_ENV === 'production'
          : raw.SESSION_COOKIE_SECURE === 'true' || raw.SESSION_COOKIE_SECURE === '1',
    },
    logLevel: raw.LOG_LEVEL,
    ai: {
      enabled: Boolean(raw.AI_MANAGED_API_KEY && raw.AI_MANAGED_MODEL),
      provider: raw.AI_MANAGED_PROVIDER,
      model: raw.AI_MANAGED_MODEL ?? '',
      apiKey: raw.AI_MANAGED_API_KEY ?? '',
      baseUrl: raw.AI_MANAGED_BASE_URL,
      dailyTokens: raw.AI_MANAGED_DAILY_TOKENS ?? LIMITS.ai.managedDailyTokens,
      anonDailyTokens: raw.AI_MANAGED_ANON_DAILY_TOKENS ?? LIMITS.ai.managedAnonDailyTokens,
      perMinute: raw.AI_MANAGED_PER_MINUTE ?? LIMITS.ai.managedRequestsPerMinute,
      maxOutputTokens: raw.AI_MANAGED_MAX_OUTPUT_TOKENS ?? LIMITS.ai.managedMaxOutputTokens,
    },
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
