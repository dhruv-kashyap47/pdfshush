/**
 * AI metering on D1.
 *
 * We meter **messages**, not tokens, because that is what the price is: 3/day
 * free, 500/month Pro. Token accounting would be more precise and much harder to
 * explain on a pricing page.
 *
 * Two ceilings exist for every request:
 *
 *   - the subject's own allowance (a visitor, or an account);
 *   - a deployment-wide daily budget, split between anonymous and Pro traffic.
 *
 * The second one is not paranoia. OpenRouter rate-limits free models per
 * *account*: 50 requests/day below 10 credits, 1,000/day at or above. Without a
 * global gate, the trial would spend the whole day's capacity in an hour and
 * every later visitor — including paying ones — would get a 429. The split
 * reserves capacity for Pro so the paying tier cannot be starved by the trial.
 */

import type { D1Database } from '../env.js';
import { spendCredit } from '../billing/entitlements.js';

export type Plan = 'free' | 'pro';

export const AI_LIMITS = {
  /** One taste of the feature; enough to feel it, too little to farm. */
  anonymousPerDay: 3,
  /** 500 messages a month, with a daily ceiling so one afternoon cannot burn it. */
  proPerMonth: 500,
  proPerDay: 60,
  /** Of OpenRouter's 1,000/day, the trial may never take the whole thing. */
  anonymousGlobalPerDay: 700,
  proGlobalPerDay: 200,
} as const;

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function utcMonth(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function nextUtcMonth(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/**
 * Increment and read in one statement. The window can have rolled over between
 * two requests, so the counter resets itself when it is past `expires_at`
 * instead of relying on the cron sweep having run.
 */
async function bump(db: D1Database, key: string, expiresAt: number, now: number): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO quota_counters (key, count, expires_at)
       VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN quota_counters.expires_at <= ? THEN 1 ELSE quota_counters.count + 1 END,
         expires_at = CASE WHEN quota_counters.expires_at <= ? THEN ? ELSE quota_counters.expires_at END
       RETURNING count`,
    )
    .bind(key, expiresAt, now, now, expiresAt)
    .first<{ count: number }>();

  return row?.count ?? 1;
}

async function peek(db: D1Database, key: string, now: number): Promise<number> {
  const row = await db
    .prepare(`SELECT count FROM quota_counters WHERE key = ? AND expires_at > ?`)
    .bind(key, now)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export interface AiSpend {
  ok: boolean;
  /** Present when `ok` is false. */
  code?: 'ai_budget' | 'ai_capacity';
  message?: string;
  retryAfterSeconds?: number;
  /** Messages left in the subject's window after this one (or credits left). */
  remaining?: number;
  /** True when this message came out of a one-time credit pack. */
  usedCredit?: boolean;
}

export interface SpendOptions {
  /** `visit:<hash>` for anonymous, `acct:<id>` when signed in. Never a raw IP. */
  subject: string;
  plan: Plan;
  /** Present for signed-in callers; credits can only be spent by an account. */
  accountId?: string;
  /** False on a deployment with no billing, so the refusal does not advertise one. */
  offerCredits?: boolean;
  now?: number;
}

/**
 * Charges one message.
 *
 * The per-subject counter is incremented before the provider is called, so a
 * request that dies mid-stream still costs its message — that is intentional:
 * otherwise a client could abort every request right before the billable part
 * and use the feature for free.
 */
export async function spendAiMessage(db: D1Database, options: SpendOptions): Promise<AiSpend> {
  const now = options.now ?? Date.now();
  const paid = options.plan === 'pro';
  const day = utcDay(now);
  const dawn = nextUtcMidnight(now);

  const globalKey = `ai:g:${paid ? 'pro' : 'anon'}:${day}`;
  const globalCap = paid ? AI_LIMITS.proGlobalPerDay : AI_LIMITS.anonymousGlobalPerDay;

  // Checked before the subject is charged, so a full deployment does not also
  // cost the visitor one of their three messages.
  if ((await peek(db, globalKey, now)) >= globalCap) {
    return {
      ok: false,
      code: 'ai_capacity',
      message: paid
        ? 'The AI allowance is busy right now. Try again in a few minutes.'
        : 'The free AI trial is used up for today. Sign in to keep going, or try again tomorrow.',
      retryAfterSeconds: Math.max(1, Math.round((dawn - now) / 1000)),
    };
  }

  if (paid) {
    // The daily ceiling is checked first: a Pro user who hits 60 messages in a
    // day should not also lose one of their 500 monthly messages for the
    // request that was refused.
    const dayKey = `ai:pd:${options.subject}:${day}`;
    const daily = await bump(db, dayKey, dawn, now);
    if (daily > AI_LIMITS.proPerDay) {
      return {
        ok: false,
        code: 'ai_budget',
        message: `That is ${AI_LIMITS.proPerDay} messages today. Your monthly allowance resumes tomorrow.`,
        retryAfterSeconds: Math.max(1, Math.round((dawn - now) / 1000)),
      };
    }

    const month = utcMonth(now);
    const monthKey = `ai:m:${options.subject}:${month}`;
    const monthly = await bump(db, monthKey, nextUtcMonth(now), now);
    if (monthly > AI_LIMITS.proPerMonth) {
      // The monthly allowance is gone. A credit pack, if one was bought, is the
      // next place to look: it is a real entitlement with no renewal, so it is
      // drained before the request is refused. `spendCredit` is one conditional
      // UPDATE, so two concurrent messages cannot take the last credit twice.
      const left = options.accountId ? await spendCredit(db, options.accountId) : undefined;
      if (left !== undefined) {
        await bump(db, globalKey, dawn, now);
        return { ok: true, remaining: left, usedCredit: true };
      }

      return {
        ok: false,
        code: 'ai_budget',
        message: options.offerCredits
          ? `You have used all ${AI_LIMITS.proPerMonth} AI messages this month. A credit pack adds 1,000 more, or your allowance resumes next month.`
          : `You have used all ${AI_LIMITS.proPerMonth} AI messages this month. Your allowance resumes next month.`,
        retryAfterSeconds: Math.max(1, Math.round((nextUtcMonth(now) - now) / 1000)),
      };
    }

    await bump(db, globalKey, dawn, now);
    return { ok: true, remaining: AI_LIMITS.proPerMonth - monthly };
  }

  const dayKey = `ai:d:${options.subject}:${day}`;
  const used = await bump(db, dayKey, dawn, now);
  if (used > AI_LIMITS.anonymousPerDay) {
    return {
      ok: false,
      code: 'ai_budget',
      message: `That is all ${AI_LIMITS.anonymousPerDay} free AI messages for today. Sign in for a larger allowance, or come back tomorrow.`,
      retryAfterSeconds: Math.max(1, Math.round((dawn - now) / 1000)),
    };
  }

  await bump(db, globalKey, dawn, now);
  return { ok: true, remaining: AI_LIMITS.anonymousPerDay - used };
}
