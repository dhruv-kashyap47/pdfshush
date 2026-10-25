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
  /** Tokens reserved per turn for the output ceiling. */
  reserveTokens: number;
}

export interface AiBudgetVerdict {
  allowed: boolean;
  code?: 'ai_budget';
  reason?: string;
  retryAfterSeconds: number;
  remainingTokens?: number;
  limitTokens?: number;
  /** What this turn actually reserved (output ceiling + input estimate). */
  reservedTokens?: number;
}

const MINUTE_SECONDS = 60;
const DAY_SECONDS = 86_400;
/** How long a crash may hold the distributed one-turn lock. */
const LIVE_KEY_TTL_SECONDS = 300;

/** Rough chars-per-token for mixed English/JSON. An estimate, settled to usage. */
const CHARS_PER_TOKEN = 4;
/** A vision input is billed per image; base64 length is not a token count. */
const IMAGE_TOKENS = 1_500;

interface EstimableMessage {
  text?: string | undefined;
  reasoning?: string | undefined;
  images?: readonly unknown[] | undefined;
  toolCalls?: readonly unknown[] | undefined;
  results?: readonly unknown[] | undefined;
}

function jsonLength(value: unknown): number {
  if (value === undefined) return 0;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    // A cyclic value cannot come from JSON.parse; if a caller builds one, it is
    // not free to send, so charge a conservative fixed amount.
    return 4_096;
  }
}

/**
 * Input-side token estimate for the daily budget.
 *
 * Output is bounded by `maxOutputTokens`; without this, a request could carry
 * an arbitrarily large prompt and only ever reserve the output ceiling.
 * Text is estimated from character count (the provider's own usage settles it
 * down), and each image is charged a flat amount rather than its base64 size.
 */
export function estimateInputTokens(input: {
  system: string;
  messages: readonly EstimableMessage[];
  tools?: readonly unknown[];
}): number {
  let chars = input.system.length + jsonLength(input.tools);
  let images = 0;
  for (const message of input.messages) {
    chars += (message.text?.length ?? 0) + (message.reasoning?.length ?? 0);
    chars += jsonLength(message.toolCalls) + jsonLength(message.results);
    images += message.images?.length ?? 0;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN) + images * IMAGE_TOKENS;
}

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
  async reserve(
    subject: string,
    authenticated: boolean,
    inputTokens = 0,
  ): Promise<AiBudgetVerdict> {
    const perMinute = await this.counters.increment(this.requestsKey(subject), MINUTE_SECONDS);
    if (perMinute > this.limits.perMinute) {
      return {
        allowed: false,
        code: 'ai_budget',
        reason: `Too many AI requests: ${this.limits.perMinute} per minute.`,
        retryAfterSeconds: MINUTE_SECONDS,
      };
    }

    const reservedTokens = this.limits.reserveTokens + Math.max(0, Math.floor(inputTokens));
    const limit = this.dailyLimit(authenticated);
    const used = await this.counters.addBytes(
      this.tokensKey(subject),
      reservedTokens,
      DAY_SECONDS,
    );
    if (used > limit) {
      // Refund the reservation: a refused attempt must not spend the day.
      await this.counters.addBytes(this.tokensKey(subject), -reservedTokens, DAY_SECONDS);
      const remaining = Math.max(0, used - reservedTokens);
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
      reservedTokens,
    };
  }

  /**
   * Adjust the reservation to what the provider actually billed. An
   * unreported usage (`undefined`) keeps the reservation: providers that never
   * report must not become a free tier. `reservedTokens` must be the value the
   * matching `reserve` returned; the default keeps older single-turn callers
   * (and tests) working.
   */
  async settle(
    subject: string,
    usedTokens: number | undefined,
    reservedTokens = this.limits.reserveTokens,
  ): Promise<void> {
    if (usedTokens === undefined) return;
    const delta = usedTokens - reservedTokens;
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
 * One in-flight managed turn per subject.
 *
 * The in-process set covers the shipped single-instance topology; the counter
 * makes the same rule hold across instances. The counter is an increment (the
 * atomic part) that is undone on release; a crashed holder is cleared by the
 * TTL, so the worst case is a few minutes of "busy" rather than a permanently
 * stuck subject. The daily budget remains the real backstop: if counters are
 * down, this degrades to the per-process guard and every turn is still metered.
 */
export class AiConcurrencyGuard {
  private readonly active = new Set<string>();

  constructor(private readonly counters?: QuotaCounter) {}

  async acquire(subject: string): Promise<boolean> {
    if (this.active.has(subject)) return false;
    if (!this.counters) {
      this.active.add(subject);
      return true;
    }
    const key = this.liveKey(subject);
    let live: number;
    try {
      live = await this.counters.increment(key, LIVE_KEY_TTL_SECONDS);
    } catch {
      // A counter outage must not take managed AI down.
      this.active.add(subject);
      return true;
    }
    if (live > 1) {
      // Our increment lost the race: give it back so the winner's slot stays 1.
      await this.counters.addBytes(key, -1, LIVE_KEY_TTL_SECONDS).catch(() => undefined);
      return false;
    }
    this.active.add(subject);
    return true;
  }

  async release(subject: string): Promise<void> {
    this.active.delete(subject);
    if (!this.counters) return;
    const key = this.liveKey(subject);
    try {
      const remaining = await this.counters.addBytes(key, -1, LIVE_KEY_TTL_SECONDS);
      // A release without a matching acquire must not drive the counter below
      // zero, where a later subscriber would read a stale "busy".
      if (remaining < 0) {
        await this.counters.addBytes(key, -remaining, LIVE_KEY_TTL_SECONDS);
      }
    } catch {
      // The TTL is the cleanup path; failing the user's request is not.
    }
  }

  private liveKey(subject: string): string {
    return `ai:${subject}:live`;
  }
}
