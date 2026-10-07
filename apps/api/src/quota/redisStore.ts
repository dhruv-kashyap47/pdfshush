/**
 * Redis-backed counters.
 *
 * The increment-plus-expiry pair is one Lua script so a burst of parallel
 * requests cannot create a key that never expires (the classic Redis rate-limit
 * bug: `INCR` succeeds, the process dies before `EXPIRE`, key lives forever).
 *
 * Note for the pre-push dangerous-sink grep: the `redis.eval(...)` calls below
 * are ioredis's server-side *Lua* execution, not JavaScript `eval`. The scripts
 * are module constants and keys/numbers travel as `KEYS`/`ARGV`, so nothing
 * user-supplied is ever interpolated into a script string.
 */

import type { Redis } from 'ioredis';
import type { QuotaStore } from './store.js';

const INCREMENT_SCRIPT = `
local value = redis.call('INCR', KEYS[1])
if value == tonumber(ARGV[2]) then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return value
`;

const ADD_BYTES_SCRIPT = `
local value = redis.call('INCRBY', KEYS[1], ARGV[2])
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return value
`;

export class RedisQuotaStore implements QuotaStore {
  constructor(private readonly redis: Redis) {}

  async increment(key: string, windowSeconds: number): Promise<number> {
    const value = await this.redis.eval(
      INCREMENT_SCRIPT,
      1,
      key,
      String(windowSeconds),
      '1',
    );
    return Number(value);
  }

  async addBytes(key: string, amount: number, windowSeconds: number): Promise<number> {
    const value = await this.redis.eval(
      ADD_BYTES_SCRIPT,
      1,
      key,
      String(windowSeconds),
      String(amount),
    );
    return Number(value);
  }

  async read(key: string): Promise<number> {
    const value = await this.redis.get(key);
    return value === null ? 0 : Number(value);
  }

  async sweep(): Promise<void> {
    // Redis expires keys itself; nothing to sweep.
  }
}