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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { Queue, Worker } from 'bullmq';
import { QUEUE_PDF, type JobPayload } from '../jobs/payload.js';
import { createConnections, isLiveStatus } from '../jobs/queue.js';
import { createJanitor } from '../files/janitor.js';
import { startChildWatchdog } from '../jobs/children.js';
import { WorkDirStore } from '../files/store.js';
import { loadConfig, type ApiConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { childEnv } from './child-env.js';

export interface WorkerHostOptions {
  /** Path to the bundled CommonJS processor; defaults to dist/processor.cjs. */
  processorPath?: string;
}

export function resolveProcessorPath(explicit?: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Built: the bundle sits next to the processor, so `dist/worker-host.js` and
  // the bundled `dist/server.js` both find `dist/processor.cjs` as a sibling.
  // Dev: `tsx` reports the real source path, so the sibling guess lands in
  // `src/worker/`, where nothing is ever emitted -- fall back to the package's
  // `dist/`, or `pnpm dev`/`pnpm worker` could never process a job locally.
  const candidates = explicit
    ? [explicit]
    : [path.resolve(here, 'processor.cjs'), path.resolve(here, '..', '..', 'dist', 'processor.cjs')];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error(
    `Sandboxed processor not found at ${candidates.join(' or ')}. Run "pnpm --filter @pdfshush/api build" first.`,
  );
}

/**
 * The BullMQ options that bound a sandboxed child, pulled out of
 * `startWorkerHost` so the security-relevant ones are unit-testable without a
 * running Redis.
 *
 * `workerForkOptions.env` is the allowlist from `child-env.ts`: `fork()` replaces
 * the child's environment with it at exec time, so the API's secrets are absent
 * rather than merely hidden. `execArgv` replaces the inherited one outright --
 * which also drops any `--inspect` or dev-loader flag the parent was started
 * with -- and caps the child's V8 heap so a runaway job aborts itself instead of
 * provoking the host's OOM killer.
 */
export function sandboxOptions(
  config: Pick<ApiConfig, 'env' | 'workerConcurrency' | 'workerChildMaxOldSpaceMb' | 'maxJobWorkingSetBytes'>,
  workDir: string,
) {
  return {
    concurrency: config.workerConcurrency,
    workerForkOptions: {
      env: childEnv({
        workDir,
        nodeEnv: config.env,
        maxJobWorkingSetBytes: config.maxJobWorkingSetBytes,
      }),
      execArgv: [`--max-old-space-size=${config.workerChildMaxOldSpaceMb}`],
    },
    // A job that takes longer than this without renewing its lock is assumed
    // dead: BullMQ reclaims it instead of leaving the queue wedged.
    lockDuration: 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  };
}

export async function startWorkerHost(options: WorkerHostOptions = {}) {
  const config = loadConfig();
  const logger = createLogger(config);
  const store = new WorkDirStore(config.workDir);
  await store.init();

  const processorPath = resolveProcessorPath(options.processorPath);

  const connections = createConnections(config.redis.url, logger);
  // BullMQ hands the processor to Node's ESM loader in the forked child, so it
  // must reach that loader as a URL. A bare Windows path (`C:\...\processor.cjs`)
  // is handed straight through and the child then rejects it -- "Only URLs with
  // a scheme in: file, data, and node are supported ... Received protocol 'c:'" --
  // so every job failed instantly, on Windows only.
  //
  // It has to be the URL *object*, not `pathToFileURL(...).href`: BullMQ branches
  // on `processor instanceof URL` and existsSync's it directly (worker.js), so a
  // href string falls into the path branch and fails its existence check.
  const worker = new Worker<JobPayload>(QUEUE_PDF, pathToFileURL(processorPath), {
    connection: connections.queue,
    // Environment allowlist + heap ceiling for the forked child; see
    // `sandboxOptions` and `child-env.ts`.
    ...sandboxOptions(config, store.root),
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, slug: job.name }, 'job completed');
  });
  worker.on('failed', (job, error) => {
    logger.warn({ jobId: job?.id, slug: job?.name, error: error.message }, 'job failed');
  });
  // BullMQ forwards each connection failure here (twice for the blocking and
  // non-blocking clients). Routing it through the shared reporter collapses the
  // duplicates and keeps the raw error out of `console.error`.
  worker.on('error', (error) => {
    connections.report('worker', error);
  });
  worker.on('stalled', (jobId) => {
    logger.warn({ jobId }, 'job stalled -- reclaimed');
  });

  // `Worker` extends `QueueBase`, not `Queue`, so it cannot read a job's state
  // itself. This lightweight view shares the worker's IORedis connection and is
  // only used to answer the janitor's liveness question.
  const stateView = new Queue<JobPayload>(QUEUE_PDF, { connection: connections.queue });
  stateView.on('error', (error) => connections.report('worker-state', error));

  // The worker also sweeps: whichever process is alive can clean up after the
  // other one being killed.
  const janitor = createJanitor({
    store,
    maxAgeMs: config.retentionMs,
    intervalMs: config.janitorIntervalMs,
    // A job the queue still owns keeps its directory regardless of age.
    isLive: async (jobId) => {
      const job = await stateView.getJob(jobId).catch(() => undefined);
      if (!job) return false;
      return isLiveStatus(await job.getState());
    },
    onSweep: (removed) => logger.info({ removed }, 'janitor swept stale job directories'),
    onError: (error) => logger.error({ error: String(error) }, 'janitor sweep failed'),
  });
  janitor.start();

  // The cooperative in-job timeout cannot interrupt synchronous CPU work, and
  // BullMQ renews the job lock from *this* process -- not the child that is
  // stuck -- so a wedged child never looks stalled to anyone. This is the only
  // thing that actually ends it. Killing the child makes BullMQ fail the job.
  const watchdog = startChildWatchdog(store, {
    hardLimitMs: config.jobHardLimitMs,
    isActive: async (jobId) => {
      const job = await stateView.getJob(jobId).catch(() => undefined);
      if (!job) return false;
      return (await job.getState()) === 'active';
    },
    onKill: (child) =>
      logger.warn(
        { jobId: child.jobId, pid: child.pid, ageMs: Date.now() - child.startedAt },
        'job child exceeded its hard limit and was killed',
      ),
    onError: (error) => logger.error({ error: String(error) }, 'child watchdog sweep failed'),
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    watchdog.stop();
    janitor.stop();
    // Give in-flight jobs a moment to finish before the child processes die.
    await worker.close();
    await stateView.close();
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
      // The broker is named so a misconfigured REDIS_URL is visible at boot;
      // the connection module logs "redis connected" / "redis unavailable"
      // as soon as the first connection attempt resolves.
      redis: connections.target,
    },
    'worker host ready',
  );

  return { worker, janitor, watchdog, shutdown, store, logger };
}

// Run directly (not when imported by tests or the embedded worker).
// `pathToFileURL` produces the same `file:///C:/...` form as `import.meta.url`.
// The previous `file://` + path concatenation dropped the drive slash, so it
// was never true on Windows and `pnpm worker` exited without starting.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  startWorkerHost().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('worker host failed to start:', error);
    process.exit(1);
  });
}
