/**
 * A small write limiter on D1.
 *
 * Both unauthenticated checkout routes need one: they create rows and call a
 * payment provider, and neither should be a free script target. The counter is
 * the same `quota_counters` mechanism the AI meter uses, so there is one place
 * that knows how to increment a window atomically.
 */

import type { Context } from 'hono';
import type { AppEnv } from '../app-env.js';
import { sha256Hex } from './crypto.js';

export function clientAddress(c: Context<AppEnv>): string {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-real-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

/**
 * Counts this address in the current hour and reports whether it is still under
 * `limit`. A refusal still costs a count, which is the safe direction: a client
 * that keeps hammering stays locked out instead of resetting its window.
 */
export async function underHourlyLimit(
  c: Context<AppEnv>,
  prefix: string,
  limit: number,
): Promise<boolean> {
  const now = Date.now();
  const hour = Math.floor(now / (60 * 60 * 1000));
  const key = `${prefix}:${await sha256Hex(clientAddress(c))}:${hour}`;
  const expiresAt = (hour + 1) * 60 * 60 * 1000;
  const row = await c.env.DB.prepare(
    `INSERT INTO quota_counters (key, count, expires_at)
     VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN quota_counters.expires_at <= ? THEN 1 ELSE quota_counters.count + 1 END,
       expires_at = CASE WHEN quota_counters.expires_at <= ? THEN ? ELSE quota_counters.expires_at END
     RETURNING count`,
  )
    .bind(key, expiresAt, now, now, expiresAt)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}
