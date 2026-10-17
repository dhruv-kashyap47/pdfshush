/**
 * Redis connection diagnostics, exercised without a broker.
 *
 * The failures these guard against were observed live: an unreachable Redis
 * printed `[ioredis] Unhandled error event` and raw `ECONNREFUSED` objects to
 * stderr every retry, twice per connection. The assertions below pin the two
 * fixes -- an `error` listener on every client, and one deduped, actionable log
 * line -- plus the non-blocking `health()` `/api/health` now depends on.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import {
  attachRedisDiagnostics,
  boundedRetryStrategy,
  describeRedisError,
  redactRedisUrl,
  redisHealth,
  reportRedisConnectionError,
  resetRedisDiagnostics,
} from '../src/jobs/redis.js';
import type { Logger } from '../src/logger.js';

/** Minimal stand-in for an ioredis client: an EventEmitter with a `status`. */
class FakeRedis extends EventEmitter {
  status: string;

  constructor(status = 'connecting') {
    super();
    this.status = status;
  }
}

const asRedis = (fake: FakeRedis): Redis => fake as unknown as Redis;

interface Captured {
  level: string;
  message?: string;
  fields?: Record<string, unknown>;
}

function captureLogger(): { logger: Logger; entries: Captured[] } {
  const entries: Captured[] = [];
  const record =
    (level: string) =>
    (fields: unknown, message?: string): void => {
      entries.push({ level, message, fields: fields as Record<string, unknown> });
    };
  const logger = {
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    debug: record('debug'),
  } as unknown as Logger;
  return { logger, entries };
}

const refused = () =>
  Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' });

beforeEach(() => {
  resetRedisDiagnostics();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('redactRedisUrl', () => {
  it('removes the password but keeps the user, host and port', () => {
    expect(redactRedisUrl('redis://user:s3cret@redis.example.com:6380/0')).toBe(
      'redis://user:***@redis.example.com:6380/0',
    );
  });

  it('leaves a passwordless URL unchanged', () => {
    expect(redactRedisUrl('redis://127.0.0.1:6379')).toBe('redis://127.0.0.1:6379');
  });

  it('redacts userinfo when the value cannot be parsed as a URL', () => {
    expect(redactRedisUrl('??//user:secret@host')).toBe('??//***@host');
  });
});

describe('boundedRetryStrategy', () => {
  it('grows exponentially and clamps at the ceiling', () => {
    const strategy = boundedRetryStrategy({ initialDelayMs: 100, maxDelayMs: 1_000, jitter: 0 });
    expect([1, 2, 3, 4, 5, 6].map((times) => strategy(times))).toEqual([
      100, 200, 400, 800, 1_000, 1_000,
    ]);
  });

  it('keeps jittered delays inside the jitter band and never exceeds the ceiling', () => {
    const low = boundedRetryStrategy({
      initialDelayMs: 1_000,
      maxDelayMs: 8_000,
      jitter: 0.5,
      random: () => 0,
    });
    const high = boundedRetryStrategy({
      initialDelayMs: 1_000,
      maxDelayMs: 8_000,
      jitter: 0.5,
      random: () => 1,
    });
    expect(low(1)).toBe(500);
    expect(high(1)).toBe(1_500);
    // Jitter is applied after the clamp, so the cap can never be breached.
    expect(high(99)).toBe(8_000);
  });
});

describe('describeRedisError', () => {
  it('keeps the code out of a message that already carries it', () => {
    expect(describeRedisError(refused())).toBe('connect ECONNREFUSED 127.0.0.1:6379');
  });

  it('prefixes a code the message omits', () => {
    const error = Object.assign(new Error('unreachable'), { code: 'EHOSTUNREACH' });
    expect(describeRedisError(error)).toBe('EHOSTUNREACH: unreachable');
  });

  it('stringifies a non-error', () => {
    expect(describeRedisError('nope')).toBe('nope');
  });
});

describe('attachRedisDiagnostics', () => {
  it('attaches an error listener, which is what stops ioredis printing the raw stack', () => {
    const client = new FakeRedis();
    const { logger } = captureLogger();
    attachRedisDiagnostics(asRedis(client), {
      logger,
      role: 'queue',
      target: 'redis://127.0.0.1:6379',
    });
    expect(client.listenerCount('error')).toBeGreaterThan(0);
  });

  it('logs one actionable line per window and reports the cause via health()', () => {
    const client = new FakeRedis();
    const { logger, entries } = captureLogger();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    attachRedisDiagnostics(asRedis(client), {
      logger,
      role: 'queue',
      target: 'redis://127.0.0.1:6379',
      windowMs: 30_000,
    });

    client.emit('error', refused());
    client.emit('error', refused());
    const first = entries.filter((entry) => entry.level === 'error');
    expect(first).toHaveLength(1);
    expect(first[0]?.message).toBe('redis unavailable; retrying with bounded backoff');
    expect(first[0]?.fields?.hint).toBeTruthy();
    expect(first[0]?.fields?.error).toBe('connect ECONNREFUSED 127.0.0.1:6379');
    expect(redisHealth([asRedis(client)])).toEqual({
      status: 'unavailable',
      error: 'connect ECONNREFUSED 127.0.0.1:6379',
    });

    // Past the window the outage is worth repeating, with the count that was
    // folded away in between rather than a second stack trace.
    now.mockReturnValue(1_000 + 31_000);
    client.emit('error', refused());
    const errors = entries.filter((entry) => entry.level === 'error');
    expect(errors).toHaveLength(2);
    expect(errors[1]?.message).toBe('redis still unavailable');
    expect(errors[1]?.fields?.suppressed).toBe(1);
  });

  it('logs recovery once and clears the stale cause', () => {
    const client = new FakeRedis();
    const { logger, entries } = captureLogger();
    attachRedisDiagnostics(asRedis(client), {
      logger,
      role: 'quota',
      target: 'redis://127.0.0.1:6379',
    });

    client.emit('error', refused());
    client.status = 'ready';
    client.emit('ready');

    expect(entries.at(-1)?.message).toBe('redis connection restored');
    expect(redisHealth([asRedis(client)])).toEqual({ status: 'connected' });
  });

  it('logs a first connection as connected rather than restored', () => {
    const client = new FakeRedis();
    const { logger, entries } = captureLogger();
    attachRedisDiagnostics(asRedis(client), {
      logger,
      role: 'quota',
      target: 'redis://127.0.0.1:6379',
    });
    client.status = 'ready';
    client.emit('ready');
    expect(entries.at(-1)?.message).toBe('redis connected');
  });
});

describe('redisHealth', () => {
  it('is connected only when every client is ready', () => {
    const queue = new FakeRedis('ready');
    const quota = new FakeRedis('ready');
    expect(redisHealth([asRedis(queue), asRedis(quota)])).toEqual({ status: 'connected' });
  });

  it('is connecting while a client has neither failed nor become ready', () => {
    expect(redisHealth([asRedis(new FakeRedis('connecting'))])).toEqual({ status: 'connecting' });
  });

  it('surfaces the first recorded cause when a client is down', () => {
    const queue = new FakeRedis('ready');
    const quota = new FakeRedis('reconnecting');
    const { logger } = captureLogger();
    attachRedisDiagnostics(asRedis(quota), {
      logger,
      role: 'quota',
      target: 'redis://127.0.0.1:6379',
    });
    quota.emit('error', refused());
    expect(redisHealth([asRedis(queue), asRedis(quota)])).toEqual({
      status: 'unavailable',
      error: 'connect ECONNREFUSED 127.0.0.1:6379',
    });
  });
});

describe('reportRedisConnectionError', () => {
  it('counts suppressed repeats and logs again after the window', () => {
    const { logger, entries } = captureLogger();
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const report = { logger, role: 'worker', target: 'redis://127.0.0.1:6379', windowMs: 5_000 };

    reportRedisConnectionError(report, refused());
    reportRedisConnectionError(report, refused());
    reportRedisConnectionError(report, refused());
    expect(entries.filter((entry) => entry.level === 'error')).toHaveLength(1);

    now.mockReturnValue(10_000 + 5_001);
    reportRedisConnectionError(report, refused());
    const errors = entries.filter((entry) => entry.level === 'error');
    expect(errors).toHaveLength(2);
    expect(errors[1]?.fields?.suppressed).toBe(2);
  });
});
