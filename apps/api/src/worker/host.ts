/**
 * Worker host process.
 *
 * Owns the BullMQ `Worker` and its lifecycle. Jobs execute in a sandboxed child
 * process (`dist/processor.cjs`), so:
 * - a segfaulting or OOM-killing job cannot take the queue down;
 * - CPU-bound work does not block the event loop, so locks keep renewing and
 *   stalled-job detection keeps working.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { Worker } from 'bullmq';
import { QUEUE_PDF, type JobPayload } from '../jobs/payload.js';
import { createConnections } from '../jobs/queue.js';
import { createJanitor } from '../files/janitor.js';
import { WorkDirStore } from '../files/store.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';

export interface WorkerHostOptions {
  /** Path to the bundled CommonJS processor; defaults to dist/processor.cjs. */
  processorPath?: string;
}

export function resolveProcessorPath(explicit?: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/worker-host.js -> dist/processor.cjs ; src/worker/host.ts -> same guess
  const candidate = explicit ?? path.resolve(here, 'processor.cjs');
  if (existsSync(candidate)) return candidate;
  throw new Error(
    `Sandboxed processor not found at ${candidate}. Run "pnpm --filter @pdfshush/api build" first.`,
  );
}

export async function startWorkerHost(options: WorkerHostOptions = {}) {
  const config = loadConfig();
  const logger = createLogger(config);
  const store = new WorkDirStore(config.workDir);
  await store.init();

  const processorPath = resolveProcessorPath(options.processorPath);
  process.env.WORK_DIR = store.root;

  const connections = createConnections(config.redis.url);
  const worker = new Worker<JobPayload>(QUEUE_PDF, processorPath, {
    connection: connections.queue,
    concurrency: config.workerConcurrency,
    // A job that takes longer than this without renewing its lock is assumed
    // dead: BullMQ reclaims it instead of leaving the queue wedged.
    lockDuration: 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, slug: job.name }, 'job completed');
  });
  worker.on('failed', (job, error) => {
    logger.warn({ jobId: job?.id, slug: job?.name, error: error.message }, 'job failed');
  });
  worker.on('error', (error) => {
    logger.error({ error: error.message }, 'worker error');
  });
  worker.on('stalled', (jobId) => {
    logger.warn({ jobId }, 'job stalled -- reclaimed');
  });

  // The worker also sweeps: whichever process is alive can clean up after the
  // other one being killed.
  const janitor = createJanitor({
    store,
    maxAgeMs: config.retentionMs,
    intervalMs: config.janitorIntervalMs,
    onSweep: (removed) => logger.info({ removed }, 'janitor swept stale job directories'),
    onError: (error) => logger.error({ error: String(error) }, 'janitor sweep failed'),
  });
  janitor.start();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    janitor.stop();
    // Give in-flight jobs a moment to finish before the child processes die.
    await worker.close();
    await connections.close();
  };

  process.on('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown('SIGTERM').then(() => process.exit(0)));

  logger.info(
    {
      queue: QUEUE_PDF,
      concurrency: config.workerConcurrency,
      processorPath,
      workDir: store.root,
    },
    'worker host ready',
  );

  return { worker, janitor, shutdown, store, logger };
}

// Run directly (not when imported by tests or the embedded worker).
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;

if (invokedDirectly) {
  startWorkerHost().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('worker host failed to start:', error);
    process.exit(1);
  });
}