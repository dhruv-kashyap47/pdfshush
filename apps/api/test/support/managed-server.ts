/**
 * Dev-only harness: the real managed-AI API on a port, with no Redis and no Mongo.
 *
 * The browser E2E needs the *actual* HTTP surface — `/api/tools` advertising the
 * trial, then `/api/ai/chat` streaming from a provider — but it must not need a
 * docker stack. This boots the shipped `createApp` with the same in-memory
 * counters the API's own tests use; the routing, the request schema, the budget,
 * the SSE framing and the provider adapter are all production code. The only
 * things stubbed are the ones the AI route never touches (the job queue).
 *
 * Run by tests/e2e/ai-managed.mjs:
 *   node --import tsx test/support/managed-server.ts
 *
 * Everything is configured from the environment (`AI_MANAGED_*`, `PORT`,
 * `WORK_DIR`, `PEPPER`), so the script decides which provider the trial points
 * at — in the E2E, the local mock.
 */

import type { Server } from 'node:http';
import { createApp } from '../../src/http/app.js';
import { createContext } from '../../src/context.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { WorkDirStore } from '../../src/files/store.js';
import { MemoryQuotaStore } from '../../src/quota/store.js';
import type { CancelOutcome, JobQueue } from '../../src/jobs/queue.js';
import type { JobPayload, JobStateSnapshot } from '../../src/jobs/payload.js';

/** Nothing is enqueued: the E2E exercises the AI route, not the PDF pipeline. */
class NoopQueue implements JobQueue {
  async enqueue(payload: JobPayload): Promise<string> {
    return payload.jobId;
  }
  async state(): Promise<JobStateSnapshot | undefined> {
    return undefined;
  }
  async cancel(): Promise<CancelOutcome> {
    return 'unknown';
  }
  async counts() {
    return { waiting: 0, active: 0, completed: 0, failed: 0 };
  }
  async close(): Promise<void> {}
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const store = new WorkDirStore(config.workDir);
  await store.init();

  const context = createContext({
    config,
    logger,
    store,
    queue: new NoopQueue(),
    quotaStore: new MemoryQuotaStore(),
  });

  const app = createApp(context);
  const server: Server = await new Promise((resolve) => {
    const created = app.listen(config.http.port, '127.0.0.1', () => resolve(created));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.http.port;

  // The E2E waits for this line rather than polling a port it might race.
  process.stdout.write(`managed-api listening on http://127.0.0.1:${port}\n`);
  process.stdout.write(`managed-ai enabled=${context.config.ai.enabled}\n`);

  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, shutdown);
}

main().catch((error: unknown) => {
  console.error('managed-api harness failed:', error);
  process.exit(1);
});
