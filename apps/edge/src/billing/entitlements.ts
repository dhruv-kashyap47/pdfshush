/**
 * What a one-time purchase grants: AI messages, or 30 days of Pro.
 *
 * These are deliberately small SQL operations, each a single statement, because
 * the webhook that calls them may be delivered twice. Credits are capped so a
 * malformed or hostile metadata value cannot become an unbounded balance, and a
 * credit is spent with `WHERE credit_messages > 0`, which is what makes two
 * concurrent messages unable to take the last one twice.
 */

import type { D1Database } from '../env.js';

/** 50,000 messages is years of use; anything more is a bug, not a purchase. */
export const MAX_CREDITS = 50_000;
export const PASS_DAYS = 30;

export async function grantCredits(
  db: D1Database,
  accountId: string,
  count: number,
): Promise<number | undefined> {
  const safe = Math.min(MAX_CREDITS, Math.max(0, Math.trunc(count)));
  if (safe === 0) return undefined;

  const row = await db
    .prepare(
      `UPDATE accounts
          SET credit_messages = MIN(credit_messages + ?, ${MAX_CREDITS})
        WHERE id = ?
        RETURNING credit_messages`,
    )
    .bind(safe, accountId)
    .first<{ credit_messages: number }>();
  return row?.credit_messages;
}

/** True when a credit was available and was taken. */
export async function spendCredit(db: D1Database, accountId: string): Promise<number | undefined> {
  const row = await db
    .prepare(
      `UPDATE accounts
          SET credit_messages = credit_messages - 1
        WHERE id = ? AND credit_messages > 0
        RETURNING credit_messages`,
    )
    .bind(accountId)
    .first<{ credit_messages: number }>();
  return row?.credit_messages;
}

/**
 * Extends from whichever is later: now, or the term already paid for.
 *
 * A manual Pro grant has no expiry (`NULL`) and must not acquire one by buying a
 * pass, so that case is left untouched and reported as unchanged.
 */
export async function grantPass(
  db: D1Database,
  accountId: string,
  days = PASS_DAYS,
  now = Date.now(),
): Promise<number | null | undefined> {
  const row = await db
    .prepare(
      `UPDATE accounts
          SET plan = 'pro',
              plan_expires_at = CASE
                WHEN plan = 'pro' AND plan_expires_at IS NULL THEN NULL
                ELSE MAX(COALESCE(plan_expires_at, ?), ?) + ?
              END
        WHERE id = ?
        RETURNING plan_expires_at`,
    )
    .bind(now, now, days * 24 * 60 * 60 * 1000, accountId)
    .first<{ plan_expires_at: number | null }>();
  return row === null ? undefined : row.plan_expires_at;
}

/** Cron: a lapsed term stops being Pro even before the next request. */
export async function downgradeLapsed(db: D1Database, now = Date.now()): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE accounts SET plan = 'free'
        WHERE plan = 'pro' AND plan_expires_at IS NOT NULL AND plan_expires_at <= ?`,
    )
    .bind(now)
    .run();
  return result.meta.changes;
}
