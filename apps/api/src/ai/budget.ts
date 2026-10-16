/**
 * Managed-AI budget.
 *
 * Managed mode spends PDFShush's own provider key, so every turn is metered.
 * Two windows mirror the anonymous tool quota: a per-minute request rate and a
 * daily token allowance. Tokens are *reserved* up front at the per-turn
 * worst case and *settled* to the provider's reported usage afterwards, so a
 * client cannot exceed its day by starting many turns at once.
 *
 * Counters live in the same Redis-backed store as the task quota. That store
 * tolerates the negative adjustment a refund applies.
 */

import type { QuotaCounter } from '../quota/quota.js';

export interface AiBudgetLimits {
  /** Daily token allowance for a signed-in account. */
  dailyTokens: number;
  /** Daily token allowance for an anonymous IP trial. */
  anonDailyTokens: number;
  /** Requests one subject may start per minute. */
  perMinute: number;
  /** Tokens reserved per turn (the per-turn output ceiling). */
  reserveTokens: number;
}

export interface AiBudgetVerdict {
  allowed: boolean;
  code?: 'ai_budget';
  reason?: string;
  retryAfterSeconds: number;
  remainingTokens?: number;
  limitTokens?: number;
}

const MINUTE_SECONDS = 60;
const DAY_SECONDS = 86_400;

export class AiBudgetService {
  constructor(
    private readonly counters: QuotaCounter,
    private readonly limits: AiBudgetLimits,
  ) {}

  private dailyLimit(authenticated: boolean): number {
    return authenticated ? this.limits.dailyTokens : this.limits.anonDailyTokens;
  }

  private tokensKey(subject: string): string {
    return `ai:${subject}:tok:d`;
  }

  private requestsKey(subject: string): string {
    return `ai:${subject}:req:m`;
  }

  /** Reserve one turn's worst-case budget; call `settle` when it ends. */
  async reserve(subject: string, authenticated: boolean): Promise<AiBudgetVerdict> {
    const perMinute = await this.counters.increment(this.requestsKey(subject), MINUTE_SECONDS);
    if (perMinute > this.limits.perMinute) {
      return {
        allowed: false,
        code: 'ai_budget',
        reason: `Too many AI requests: ${this.limits.perMinute} per minute.`,
        retryAfterSeconds: MINUTE_SECONDS,
      };
    }

    const limit = this.dailyLimit(authenticated);
    const used = await this.counters.addBytes(
      this.tokensKey(subject),
      this.limits.reserveTokens,
      DAY_SECONDS,
    );
    if (used > limit) {
      // Refund the reservation: a refused attempt must not spend the day.
      await this.counters.addBytes(this.tokensKey(subject), -this.limits.reserveTokens, DAY_SECONDS);
      const remaining = Math.max(0, used - this.limits.reserveTokens);
      return {
        allowed: false,
        code: 'ai_budget',
        reason: 'Daily AI allowance reached.',
        retryAfterSeconds: DAY_SECONDS,
        remainingTokens: Math.max(0, limit - remaining),
        limitTokens: limit,
      };
    }

    return {
      allowed: true,
      retryAfterSeconds: 0,
      remainingTokens: Math.max(0, limit - used),
      limitTokens: limit,
    };
  }

  /**
   * Adjust the reservation to what the provider actually billed. An
   * unreported usage (`undefined`) keeps the reservation: providers that never
   * report must not become a free tier.
   */
  async settle(subject: string, usedTokens: number | undefined): Promise<void> {
    if (usedTokens === undefined) return;
    const delta = usedTokens - this.limits.reserveTokens;
    if (delta !== 0) {
      await this.counters.addBytes(this.tokensKey(subject), delta, DAY_SECONDS);
    }
  }

  async peek(subject: string, authenticated: boolean) {
    const limit = this.dailyLimit(authenticated);
    const [tokens, requests] = await Promise.all([
      this.counters.read(this.tokensKey(subject)),
      this.counters.read(this.requestsKey(subject)),
    ]);
    return {
      daily: { used: tokens, limit, remaining: Math.max(0, limit - tokens) },
      minute: { used: requests, limit: this.limits.perMinute },
    };
  }
}

/**
 * One in-flight managed turn per subject. Best-effort and per instance: a
 * multi-instance deployment would need a Redis lock, but a single API process
 * (the shipped topology) is fully covered, and the daily budget is the real
 * backstop either way.
 */
export class AiConcurrencyGuard {
  private readonly active = new Set<string>();

  acquire(subject: string): boolean {
    if (this.active.has(subject)) return false;
    this.active.add(subject);
    return true;
  }

  release(subject: string): void {
    this.active.delete(subject);
  }
}
