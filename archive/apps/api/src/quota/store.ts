/**
 * Counters behind the anonymous quotas.
 *
 * Redis in production, an in-process map in tests and single-node development --
 * the policy layer above never learns which one it is talking to.
 */

export interface QuotaStore {
  /** Increments `key` inside a rolling window; returns the new count. */
  increment(key: string, windowSeconds: number): Promise<number>;
  /** Adds `amount` to a byte counter inside a rolling window. */
  addBytes(key: string, amount: number, windowSeconds: number): Promise<number>;
  /** Reads a counter without consuming it (0 when absent or expired). */
  read(key: string): Promise<number>;
  /** Drops expired keys. Cheap no-op for Redis (TTL handles it). */
  sweep(): Promise<void>;
}

interface Window {
  count: number;
  expiresAt: number;
}

/** In-memory counters with lazy expiry -- deterministic under `Date.now()`. */
export class MemoryQuotaStore implements QuotaStore {
  private readonly counters = new Map<string, Window>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private bump(key: string, amount: number, windowSeconds: number): number {
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= this.now()) {
      const fresh = { count: amount, expiresAt: this.now() + windowSeconds * 1000 };
      this.counters.set(key, fresh);
      return fresh.count;
    }
    existing.count += amount;
    return existing.count;
  }

  async increment(key: string, windowSeconds: number): Promise<number> {
    return this.bump(key, 1, windowSeconds);
  }

  async addBytes(key: string, amount: number, windowSeconds: number): Promise<number> {
    return this.bump(key, amount, windowSeconds);
  }

  async read(key: string): Promise<number> {
    const existing = this.counters.get(key);
    if (!existing) return 0;
    if (existing.expiresAt <= this.now()) {
      this.counters.delete(key);
      return 0;
    }
    return existing.count;
  }

  async sweep(): Promise<void> {
    const now = this.now();
    for (const [key, window] of this.counters) {
      if (window.expiresAt <= now) this.counters.delete(key);
    }
  }

  /** Test helper: seed a counter without going through the policy layer. */
  seed(key: string, count: number, windowSeconds: number): void {
    this.counters.set(key, { count, expiresAt: this.now() + windowSeconds * 1000 });
  }
}