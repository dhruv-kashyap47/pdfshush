/**
 * API entry point.
 *
 * Boots Redis-backed quota counters, the work directory, the janitor, the HTTP
 * server and -- in development -- an embedded worker host, then shuts all of it
 * down cleanly on a signal. In production the worker runs as its own process
 * (`pnpm --filter @pdfshush/api worker`), so a worker crash cannot take the API
 * with it.
 */

import { createApp } from './http/app.js';
import { createContext } from './context.js';
import { loadConfig } from './config.js';
import { createJanitor } from './files/janitor.js';
import { WorkDirStore } from './files/store.js';
import { BullJobQueue, createConnections } from './jobs/queue.js';
import { RedisQuotaStore } from './quota/redisStore.js';
import { resolveProcessorPath, startWorkerHost } from './worker/host.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const connections = createConnections(config.redis.url);
  const store = new WorkDirStore(config.workDir);
  await store.init();

  const queue = new BullJobQueue(connections.queue, store);
  const context = createContext({
    config,
    store,
    queue,
    quotaStore: new RedisQuotaStore(connections.client),
  });

  const janitor = createJanitor({
    store,
    maxAgeMs: config.retentionMs,
    intervalMs: Math.min(config.retentionMs, 5 * 60_000),
    onSweep: (removed) => context.logger.info({ removed }, 'janitor swept stale jobs'),
    onError: (error) => context.logger.error({ error: String(error) }, 'janitor sweep failed'),
  });
  janitor.start();

  const app = createApp(context);
  const server = app.listen(config.http.port, config.http.host, () => {
    context.logger.info(
      { host: config.http.host, port: config.http.port, env: config.env },
      'api listening',
    );
  });

  let worker: Awaited<ReturnType<typeof startWorkerHost>> | undefined;
  if (config.embeddedWorker) {
    try {
      worker = await startWorkerHost({ processorPath: resolveProcessorPath() });
    } catch (error) {
      // A missing processor build must not take the API down: the queue simply
      // stays idle until a worker is deployed.
      context.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'embedded worker not started',
      );
    }
  }

  const shutdown = async (signal: string) => {
    context.logger.info({ signal }, 'api shutting down');
    janitor.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (worker) await worker.shutdown(signal);
    await queue.close();
    await connections.close();
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal)
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          context.logger.error({ error: String(error) }, 'shutdown failed');
          process.exit(1);
        });
    });
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('api failed to start:', error);
  process.exit(1);
});