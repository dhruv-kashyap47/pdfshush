/**
 * Redis connection and queue/producer wiring.
 *
 * BullMQ needs its own connection semantics (`maxRetriesPerRequest: null` so a
 * blocking command can wait), and the API also uses a plain client for quota
 * counters. Both are created here so the rest of the code never touches ioredis
 * directly and tests can swap in a double.
 */

import { Queue, type Job, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { QUEUE_PDF, parseFailure, type JobPayload, type JobStateSnapshot } from './payload.js';
import { WorkDirStore } from '../files/store.js';
import type { Logger } from '../logger.js';
import {
  attachRedisDiagnostics,
  boundedRetryStrategy,
  redactRedisUrl,
  redisHealth,
  reportRedisConnectionError,
  type RedisConnectionHealth,
} from './redis.js';

export interface QueueConnectionOptions {
  url: string;
  /** Credential-free URL, for logs and health output. */
  target: string;
  /** BullMQ connection: blocking commands must not be retried locally. */
  queue: Redis;
  client: Redis;
  /** Non-blocking view of whether Redis is reachable, for `/api/health`. */
  health(): RedisConnectionHealth;
  /** Routes a connection failure through the shared, deduped reporter. */
  report(role: string, error: unknown): void;
  close(): Promise<void>;
}

export function createConnections(url: string, logger: Logger): QueueConnectionOptions {
  const target = redactRedisUrl(url);
  // Bounded exponential backoff instead of ioredis's fixed 2s cadence: a long
  // outage should not hammer the broker (or the log) at a constant rate, and
  // jitter keeps restarted replicas from reconnecting in lockstep.
  const backoff = boundedRetryStrategy();

  // BullMQ's blocking commands must be allowed to wait (`maxRetriesPerRequest:
  // null`); the quota client stays bounded so a counter outage fails fast
  // rather than hanging a request.
  const queue = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: backoff,
  });
  const client = new IORedis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: backoff,
  });
  attachRedisDiagnostics(queue, { logger, role: 'queue', target });
  attachRedisDiagnostics(client, { logger, role: 'quota', target });

  const report = (role: string, error: unknown) =>
    reportRedisConnectionError({ logger, role, target }, error);

  return {
    url,
    target,
    queue,
    client,
    health: () => redisHealth([queue, client]),
    report,
    async close() {
      await Promise.allSettled([queue.quit(), client.quit()]);
    },
  };
}

/**
 * Producers enqueue and read state. The interface exists so the HTTP layer and
 * its tests can run against a fake queue with no Redis in sight.
 */
/**
 * What a cancel request found. Only `removed` and `running` are actionable;
 * `finished` and `unknown` must not be answered as if something was cancelled.
 */
export type CancelOutcome = 'removed' | 'running' | 'finished' | 'unknown';

/**
 * True while the queue still owns a job. Only `completed` and `failed` are
 * terminal, so anything else -- queued, active, delayed, paused, waiting-children
 * -- means the job's inputs are still needed and must not be swept.
 */
export function isLiveStatus(status: string): boolean {
  return status !== 'completed' && status !== 'failed';
}

export interface JobQueue {
  enqueue(payload: JobPayload, opts?: JobsOptions): Promise<string>;
  state(jobId: string): Promise<JobStateSnapshot | undefined>;
  cancel(jobId: string): Promise<CancelOutcome>;
  counts(): Promise<{ waiting: number; active: number; completed: number; failed: number }>;
  /** How many BullMQ workers are attached to the queue. Absent on test doubles. */
  workerCount?(): Promise<number>;
  close(): Promise<void>;
}

export class BullJobQueue implements JobQueue {
  private readonly queue: Queue<JobPayload, unknown, string>;

  constructor(
    connection: Redis,
    private readonly store: WorkDirStore,
    onError?: (role: string, error: unknown) => void,
  ) {
    this.queue = new Queue<JobPayload>(QUEUE_PDF, {
      connection,
      // The janitor owns file deletion; Redis retention only needs to keep
      // enough history for status polling, then get out of the way.
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 3_600, count: 500 },
        removeOnFail: { age: 86_400, count: 200 },
      },
    });
    // BullMQ re-emits a connection failure on the Queue; with no listener it
    // prints the raw error object to stderr via `QueueBase.emit`. Routing it
    // through the shared reporter keeps every Redis failure structured and
    // deduped, and attaching the listener is itself what stops the fallback.
    this.queue.on('error', (error) => onError?.('queue', error));
  }

  async enqueue(payload: JobPayload, opts?: JobsOptions): Promise<string> {
    const job = await this.queue.add(payload.slug, payload, { jobId: payload.jobId, ...opts });
    return job.id ?? payload.jobId;
  }

  async state(jobId: string): Promise<JobStateSnapshot | undefined> {
    const job = await this.queue.getJob(jobId);
    if (!job) return undefined;
    return readState(job);
  }

  async cancel(jobId: string): Promise<CancelOutcome> {
    const job = await this.queue.getJob(jobId);
    if (!job) return 'unknown';
    if (await job.isActive()) return 'running'; // the worker observes the cancel marker
    const state = await job.getState();
    if (state === 'completed' || state === 'failed') return 'finished';
    if (state === 'active') return 'running';
    if (state !== 'waiting' && state !== 'delayed') return 'unknown';
    try {
      await job.remove();
    } catch {
      // A worker picked the job up between the checks above and holds its lock,
      // so it is running now and has to be cancelled cooperatively.
      return 'running';
    }
    await this.store.removeJob(jobId);
    return 'removed';
  }

  async counts() {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed');
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
    };
  }

  async workerCount(): Promise<number> {
    return this.queue.getWorkersCount();
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

async function readState(job: Job<JobPayload>): Promise<JobStateSnapshot> {
  const state = await job.getState();
  const base = ((): JobStateSnapshot => {
    switch (state) {
      case 'active':
        return { status: 'active' };
      case 'completed':
        return { status: 'completed' };
      case 'failed':
      case 'unknown':
        return {
          status: 'failed',
          error: parseFailure(job.failedReason),
        };
      default:
        return { status: 'queued' };
    }
  })();

  const progress = normalizeProgress(job.progress);
  if (progress) base.progress = progress;

  if (state === 'completed') {
    const outputs = normalizeReturnValue(job.returnvalue);
    if (outputs) {
      base.files = outputs.files;
      if (outputs.pageCount !== undefined) base.pageCount = outputs.pageCount;
    }
  }
  return base;
}

function normalizeProgress(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as { phase?: unknown; ratio?: unknown; message?: unknown };
  if (typeof record.phase !== 'string') return undefined;
  return {
    phase: record.phase,
    ...(typeof record.ratio === 'number' ? { ratio: record.ratio } : {}),
    ...(typeof record.message === 'string' ? { message: record.message } : {}),
  };
}

interface JobOutputs {
  files: { name: string; bytes: number }[];
  pageCount?: number;
}

/** The runner returns a serialisable summary; this is its shape. */
export function normalizeReturnValue(value: unknown): JobOutputs | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as {
    files?: unknown;
    pageCount?: unknown;
  };
  if (!Array.isArray(record.files)) return undefined;
  const files = record.files.filter(
    (file): file is { name: string; bytes: number } =>
      Boolean(file) &&
      typeof (file as { name?: unknown }).name === 'string' &&
      typeof (file as { bytes?: unknown }).bytes === 'number',
  );
  return {
    files,
    ...(typeof record.pageCount === 'number' ? { pageCount: record.pageCount } : {}),
  };
}
