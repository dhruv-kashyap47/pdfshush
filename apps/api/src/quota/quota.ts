/**
 * Anonymous quota policy.
 *
 * Subjects are hashed, never stored raw: a quota key must not become a database
 * of who visited. The pepper makes the hash non-reversible for the IPv4 space;
 * without a configured pepper it degrades to best-effort (documented, not
 * silently weak).
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface QuotaLimits {
  tasksPerMinute: number;
  tasksPerDay: number;
  bytesPerDay: number;
}

export type QuotaWindow = 'minute' | 'day' | 'bytes';

export interface QuotaVerdict {
  allowed: boolean;
  /** Which ceiling stopped it, when `allowed` is false. */
  window?: QuotaWindow;
  limit?: number;
  used?: number;
  /** Seconds the caller should wait before retrying. */
  retryAfterSeconds: number;
  reason?: string;
}

const MINUTE_SECONDS = 60;
const DAY_SECONDS = 86_400;

/**
 * Stable, non-reversible subject id. `pepper` should be a long random string
 * kept in the deployment environment; a random per-process pepper still
 * protects the data at rest, it just cannot share counters across restarts.
 */
export function subjectId(identifier: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${identifier}`).digest('hex').slice(0, 32);
}

/** Constant-time comparison for tokens issued when a job is created. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function newPepper(): string {
  return randomBytes(32).toString('hex');
}

export interface QuotaCounter {
  increment(key: string, windowSeconds: number): Promise<number>;
  addBytes(key: string, amount: number, windowSeconds: number): Promise<number>;
  read(key: string): Promise<number>;
}

export class QuotaService {
  constructor(
    private readonly counters: QuotaCounter,
    private readonly limits: QuotaLimits,
  ) {}

  /**
   * Consumes one unit of quota for `subject`, plus `bytes` of daily upload
   * budget. Counting happens even when the call is rejected, so a client that
   * keeps hammering cannot reset its own window by being rejected.
   */
  async consume(subject: string, bytes: number): Promise<QuotaVerdict> {
    const perMinute = await this.counters.increment(
      `quota:${subject}:m`,
      MINUTE_SECONDS,
    );
    if (perMinute > this.limits.tasksPerMinute) {
      return {
        allowed: false,
        window: 'minute',
        limit: this.limits.tasksPerMinute,
        used: perMinute,
        retryAfterSeconds: MINUTE_SECONDS,
        reason: `Rate limit reached: ${this.limits.tasksPerMinute} requests per minute.`,
      };
    }

    const perDay = await this.counters.increment(`quota:${subject}:d`, DAY_SECONDS);
    if (perDay > this.limits.tasksPerDay) {
      return {
        allowed: false,
        window: 'day',
        limit: this.limits.tasksPerDay,
        used: perDay,
        retryAfterSeconds: DAY_SECONDS,
        reason: `Daily limit reached: ${this.limits.tasksPerDay} tasks per day.`,
      };
    }

    if (bytes > 0) {
      const uploaded = await this.counters.addBytes(`quota:${subject}:bytes`, bytes, DAY_SECONDS);
      if (uploaded > this.limits.bytesPerDay) {
        return {
          allowed: false,
          window: 'bytes',
          limit: this.limits.bytesPerDay,
          used: uploaded,
          retryAfterSeconds: DAY_SECONDS,
          reason: 'Daily upload allowance reached.',
        };
      }
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  /**
   * Read-only check, used *before* streaming a large upload so an over-quota
   * client never sends 500 MB for a job that would be refused anyway. It does
   * not consume budget; `consume` does that after the bytes land.
   */
  async precheck(subject: string): Promise<QuotaVerdict> {
    const [perMinute, perDay] = await Promise.all([
      this.counters.read(`quota:${subject}:m`),
      this.counters.read(`quota:${subject}:d`),
    ]);
    if (perMinute >= this.limits.tasksPerMinute) {
      return {
        allowed: false,
        window: 'minute',
        limit: this.limits.tasksPerMinute,
        used: perMinute,
        retryAfterSeconds: MINUTE_SECONDS,
        reason: `Rate limit reached: ${this.limits.tasksPerMinute} requests per minute.`,
      };
    }
    if (perDay >= this.limits.tasksPerDay) {
      return {
        allowed: false,
        window: 'day',
        limit: this.limits.tasksPerDay,
        used: perDay,
        retryAfterSeconds: DAY_SECONDS,
        reason: `Daily limit reached: ${this.limits.tasksPerDay} tasks per day.`,
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Read-only variant for `/api/quota` so the UI can show remaining budget. */
  async peek(subject: string): Promise<{ tasksPerMinute: QuotaVerdict; tasksPerDay: QuotaVerdict }> {
    const [minute, day] = await Promise.all([
      this.counters.read(`quota:${subject}:m`),
      this.counters.read(`quota:${subject}:d`),
    ]);
    return {
      tasksPerMinute: {
        allowed: minute < this.limits.tasksPerMinute,
        used: minute,
        limit: this.limits.tasksPerMinute,
        retryAfterSeconds: MINUTE_SECONDS,
      },
      tasksPerDay: {
        allowed: day < this.limits.tasksPerDay,
        used: day,
        limit: this.limits.tasksPerDay,
        retryAfterSeconds: DAY_SECONDS,
      },
    };
  }
}