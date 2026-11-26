/**
 * Make `pnpm dev` self-sufficient about its broker.
 *
 * The API is useless without Redis: BullMQ refuses to enqueue and the quota
 * ledger cannot settle, so every tool fails with a 5xx that looks like an app
 * bug rather than a missing dependency. The failure mode is also slow and
 * quiet -- `ioredis` retries with backoff forever, so `pnpm dev` looks healthy
 * while nothing works.
 *
 * So before the parallel dev run, make sure something is answering on
 * REDIS_URL's host/port. Two acceptable answers:
 *
 *   1. something already listens there (a system Redis, a container the user
 *      started, Memurai, ...) -- then do nothing at all, and never touch their
 *      setup;
 *   2. nothing listens -- then `docker compose up -d redis`, the documented
 *      fallback.
 *
 * Failure here is a warning, never an error. Someone may be starting Redis by
 * hand in another terminal a second later, and refusing to boot the dev server
 * for them would be worse than the backoff logging they can already read.
 */

import { spawnSync } from 'node:child_process';
import net from 'node:net';

/** Resolve the broker endpoint the same way the API does, with its default. */
function redisEndpoint() {
  const raw = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  let url;
  try {
    url = new URL(raw);
  } catch {
    console.warn(`[dev] REDIS_URL is not a valid URL (${raw}); falling back to 127.0.0.1:6379`);
    return { host: '127.0.0.1', port: 6379 };
  }
  return {
    host: url.hostname || '127.0.0.1',
    // BullMQ defaults to 6379 when the URL omits a port.
    port: url.port ? Number(url.port) : 6379,
  };
}

/** A connect attempt is enough -- we are asking "is the port open", not speaking the protocol. */
function isListening({ host, port }, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

const endpoint = redisEndpoint();

if (await isListening(endpoint)) {
  console.log(`[dev] redis already reachable on ${endpoint.host}:${endpoint.port}`);
  process.exit(0);
}

console.log(`[dev] nothing listening on ${endpoint.host}:${endpoint.port} -- starting the compose redis service`);

// On Windows `docker` is `docker.cmd`, which spawn cannot exec without a shell.
// With a shell the whole command must be a single string (the `args` array is
// rejected outright), and it is concatenated rather than escaped, so the fixed
// arguments are safe as-is here.
const useShell = process.platform === 'win32';
const result = spawnSync('docker compose up -d redis', {
  stdio: 'inherit',
  shell: useShell,
});

if (result.error || result.status !== 0) {
  console.warn('[dev] could not start redis via docker compose.');
  console.warn('[dev] start it yourself (`pnpm redis:up`, or any Redis on this endpoint)');
  console.warn('[dev] and point REDIS_URL at it; the API will keep retrying in the meantime.');
  process.exit(0);
}

// `up -d` returns before the container is ready, so poll instead of assuming.
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (await isListening(endpoint)) {
    console.log(`[dev] redis ready on ${endpoint.host}:${endpoint.port}`);
    process.exit(0);
  }
}

console.warn('[dev] redis container started but is not answering yet; the API will keep retrying.');
process.exit(0);