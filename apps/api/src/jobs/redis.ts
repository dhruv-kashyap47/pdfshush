/**
 * Redis connection lifecycle and diagnostics.
 *
 * One place owns how the API and the workers talk to Redis, so the failure
 * modes are uniform:
 *
 * - Every client gets an `error` listener. ioredis prints
 *   "[ioredis] Unhandled error event" to `console.error` when a client has no
 *   listener, and BullMQ falls back to `console.error(err)` when a `Queue`
 *   emits `error` with none. Both produced the unformatted, duplicated
 *   `ECONNREFUSED` spam this module exists to replace, indexing the whole API
 *   log with raw stack traces that the structured logger never saw.
 * - Reconnects use bounded exponential backoff with jitter rather than
 *   ioredis's fixed 2s cadence, so a long outage does not attempt a fresh
 *   connection every two seconds forever (and does not retry in lockstep when
 *   several processes restart together).
 * - Repeated identical failures collapse into one line per window, with a
 *   suppressed count, so a broker that is down does not flood the log. The
 *   first line carries an actionable hint.
 * - `health()` gives `/api/health` a synchronous, non-blocking view of whether
 *   Redis is connected. It reads `client.status`, which never waits, so the
 *   probe cannot hang on a command buffered in ioredis's offline queue.
 */

import type { Redis } from 'ioredis';
import type { Logger } from '../logger.js';

/** Live view of whether Redis is reachable, derived without touching the socket. */
export interface RedisConnectionHealth {
  status: 'connected' | 'connecting' | 'unavailable';
  /** Most recent, secret-free failure description, when there is one. */
  error?: string;
}

/** Shown once per outage so the log says what to do, not only what broke. */
const REDIS_HINT =
  'Is Redis running? Start it with "pnpm redis:up" (Docker) or point REDIS_URL at a reachable instance.';

export interface RetryBackoffOptions {
  /** Delay before the first reconnect attempt. */
  initialDelayMs?: number;
  /** Ceiling the exponential growth is clamped to; the retry loop never stops. */
  maxDelayMs?: number;
  /** Fraction of the delay that is randomised, 0 disables jitter. */
  jitter?: number;
  /** Injectable for deterministic tests. */
  random?: () => number;
}

/**
 * Bounded exponential backoff with jitter.
 *
 * "Bounded" is the delay, not the number of attempts: a queue broker must keep
 * trying for as long as the process lives, because the whole point is to
 * recover when Redis comes back. Returning `null` here would strand every
 * queued job until a manual restart, so the strategy always yields a number and
 * simply grows to `maxDelayMs` and stays there.
 */
export function boundedRetryStrategy({
  initialDelayMs = 250,
  maxDelayMs = 30_000,
  jitter = 0.2,
  random = Math.random,
}: RetryBackoffOptions = {}): (times: number) => number {
  return (times: number) => {
    const attempt = Math.max(1, Math.floor(times));
    const ceiling = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
    const spread = ceiling * jitter;
    const delay = ceiling - spread + random() * spread * 2;
    return Math.max(0, Math.min(Math.round(delay), maxDelayMs));
  };
}

/**
 * Removes credentials from a Redis URL before it reaches a log or an API
 * response. A URL with no password is returned unchanged.
 */
export function redactRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    // Not a parseable URL (a socket path, an odd scheme): strip anything that
    // looks like userinfo rather than risk leaking it.
    return url.replace(/\/\/[^@/]*@/, '//***@');
  }
}

/**
 * A concise, credential-free description of a connection failure. ioredis
 * errors carry the address but never the password, so the message is safe to
 * log; the `code` is prefixed only when the message omits it.
 */
export function describeRedisError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as NodeJS.ErrnoException).code;
  const message = error.message || error.name;
  if (code && !message.includes(code)) return `${code}: ${message}`;
  return message;
}

interface ClientState {
  lastError?: string;
}

export interface RedisErrorReport {
  logger: Logger;
  role: string;
  /** Credential-free target, from `redactRedisUrl`. */
  target: string;
  /** How long an identical failure is suppressed after being logged once. */
  windowMs?: number;
}

/** Per-client state for `health()`, keyed weakly so a closed client is collectable. */
const clientStates = new WeakMap<Redis, ClientState>();

/**
 * Dedupe window per distinct failure, shared by every client in this process.
 * Keyed by target + cause (not by connection), so the API's queue client, its
 * quota client, an embedded worker and BullMQ's own internal connections all
 * collapse into one line when they fail for the same reason.
 */
const errorWindows = new Map<string, { at: number; suppressed: number }>();

/** Test seam: forget suppression state between cases. */
export function resetRedisDiagnostics(): void {
  errorWindows.clear();
}

/**
 * Records one connection failure at most once per window, counting repeats
 * instead of printing them. Never throws and never swallows silently.
 */
export function reportRedisConnectionError(
  { logger, role, target, windowMs = 30_000 }: RedisErrorReport,
  error: unknown,
): void {
  const cause = describeRedisError(error);
  const key = `${target}||${cause}`;
  const now = Date.now();
  const previous = errorWindows.get(key);

  if (previous && now - previous.at < windowMs) {
    previous.suppressed += 1;
    return;
  }

  const suppressed = previous?.suppressed ?? 0;
  errorWindows.set(key, { at: now, suppressed: 0 });
  logger.error(
    {
      redis: target,
      role,
      error: cause,
      ...(suppressed > 0 ? { suppressed } : {}),
      ...(previous ? {} : { hint: REDIS_HINT }),
    },
    previous ? 'redis still unavailable' : 'redis unavailable; retrying with bounded backoff',
  );
}

export type RedisDiagnosticsOptions = RedisErrorReport;

/**
 * Attaches the lifecycle listeners a client needs to be safe and diagnosable.
 *
 * `ready` logs the one startup line that matters ("redis connected", or
 * "redis connection restored" after an outage); `error` records the cause and
 * routes it through the deduped reporter. Both also update the state `health()`
 * reads.
 */
export function attachRedisDiagnostics(client: Redis, options: RedisDiagnosticsOptions): void {
  const { logger, role, target } = options;
  const state: ClientState = {};
  clientStates.set(client, state);

  client.on('ready', () => {
    const recovered = state.lastError !== undefined;
    state.lastError = undefined;
    logger.info(
      { redis: target, role },
      recovered ? 'redis connection restored' : 'redis connected',
    );
  });

  // Without this listener ioredis falls back to `console.error` with a raw
  // stack trace for every failed reconnect attempt.
  client.on('error', (error: Error) => {
    state.lastError = describeRedisError(error);
    reportRedisConnectionError(options, error);
  });
}

/**
 * Aggregates the state of every client behind a connection. `connected` only
 * when all of them are ready; otherwise the first recorded cause is surfaced so
 * `/api/health` can name it.
 */
export function redisHealth(clients: readonly Redis[]): RedisConnectionHealth {
  const errors = clients
    .map((client) => clientStates.get(client)?.lastError)
    .filter((value): value is string => typeof value === 'string');

  if (clients.every((client) => client.status === 'ready')) return { status: 'connected' };
  if (errors.length > 0) return { status: 'unavailable', error: errors[0] };
  return { status: 'connecting' };
}
