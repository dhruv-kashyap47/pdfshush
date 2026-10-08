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

export interface ApiContext {
  config: ApiConfig;
  logger: Logger;
  store: WorkDirStore;
  queue: JobQueue;
  quota: QuotaService;
  /** Secret for hashing subjects and deriving job tokens. */
  pepper: string;
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
}

export function createContext(overrides: ContextOverrides): ApiContext {
  const base = loadConfig();
  const config = {
    ...base,
    ...overrides.config,
    quota: { ...base.quota, ...(overrides.config?.quota ?? {}) },
  } as ApiConfig;

  return {
    config,
    logger: overrides.logger ?? createLogger(config),
    store: overrides.store ?? new WorkDirStore(config.workDir),
    queue: overrides.queue,
    quota: new QuotaService(overrides.quotaStore as QuotaCounter, config.quota),
    pepper: overrides.pepper ?? resolvePepper(config),
  };
}
