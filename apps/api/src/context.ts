/**
 * Composition root.
 *
 * One object owns every dependency the HTTP layer needs, so tests can build a
 * fully wired app (fake queue, in-memory quota counters, temp work dir) without
 * Redis, and without touching module-level singletons.
 */

import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ApiConfig } from './config.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import type { Logger } from './logger.js';
import { WorkDirStore } from './files/store.js';
import { QuotaService, newPepper } from './quota/quota.js';
import type { QuotaStore } from './quota/store.js';
import type { JobQueue } from './jobs/queue.js';
import type { QuotaCounter } from './quota/quota.js';
import type { AuthStore } from './auth/store.js';
import type { AccountStore } from './account/store.js';
import type { GoogleOidc } from './auth/google.js';
import type { RedisConnectionHealth } from './jobs/redis.js';

/** Accounts and sessions, present only when the deployment is configured for them. */
export interface AuthServices {
  store: AuthStore;
  account: AccountStore;
  oidc: GoogleOidc;
  close(): Promise<void>;
}

export interface ApiContext {
  config: ApiConfig;
  logger: Logger;
  store: WorkDirStore;
  queue: JobQueue;
  quota: QuotaService;
  /**
   * The raw counters behind `quota`. Exposed because limiters that are not the
   * anonymous tool quota (the auth endpoints) need a window of their own, and
   * routing them through `QuotaService` would mean teaching it about routes it
   * does not own.
   */
  counters: QuotaCounter;
  /** Secret for hashing subjects and deriving job tokens. */
  pepper: string;
  /**
   * Live Redis connection state for `/api/health`. Absent when the context is
   * built with an in-memory queue double, where the queue itself is the only
   * signal and there is nothing to distinguish.
   */
  redisHealth?: () => RedisConnectionHealth;
  /**
   * Undefined means anonymous-only: no Mongo, no Google credentials, and every
   * auth route answers 503 while every tool keeps working.
   */
  auth?: AuthServices;
}

/**
 * The pepper from configuration, or one generated on first boot and kept on the
 * work volume. Generating a fresh one per process silently invalidated every job
 * token and reset every quota on each restart.
 */
export function resolvePepper(config: ApiConfig): string {
  if (config.pepper) return config.pepper;
  const file = path.join(config.workDir, 'control', 'pepper');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    // Not created yet: fall through.
  }
  const pepper = newPepper();
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    writeFileSync(file, pepper, { flag: 'wx', mode: 0o600 });
    return pepper;
  } catch {
    // Another process created it first: use theirs.
    return readFileSync(file, 'utf8').trim();
  }
}

/** Fresh, URL-safe-ish job id (32 hex chars; also passes `safeJobId`). */
export function newJobId(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * Ownership token, derived rather than stored: knowing the pepper is enough to
 * prove a job is yours, and nothing has to be kept to check it later.
 */
export function jobToken(pepper: string, jobId: string): string {
  return createHash('sha256').update(`${pepper}:${jobId}`).digest('hex');
}

export interface ContextOverrides {
  config?: Partial<ApiConfig>;
  logger?: Logger;
  store?: WorkDirStore;
  queue: JobQueue;
  quotaStore: QuotaStore;
  pepper?: string;
  redisHealth?: () => RedisConnectionHealth;
  auth?: AuthServices;
}

export function createContext(overrides: ContextOverrides): ApiContext {
  const base = loadConfig();
  const config = {
    ...base,
    ...overrides.config,
    quota: { ...base.quota, ...(overrides.config?.quota ?? {}) },
    auth: { ...base.auth, ...(overrides.config?.auth ?? {}) },
  } as ApiConfig;

  return {
    config,
    logger: overrides.logger ?? createLogger(config),
    store: overrides.store ?? new WorkDirStore(config.workDir),
    queue: overrides.queue,
    quota: new QuotaService(overrides.quotaStore as QuotaCounter, config.quota),
    counters: overrides.quotaStore as QuotaCounter,
    pepper: overrides.pepper ?? resolvePepper(config),
    ...(overrides.redisHealth ? { redisHealth: overrides.redisHealth } : {}),
    ...(overrides.auth ? { auth: overrides.auth } : {}),
  };
}
