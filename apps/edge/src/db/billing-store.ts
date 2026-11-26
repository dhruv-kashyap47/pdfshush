/**
 * Webhook idempotency, in one place.
 *
 * Standard Webhooks retries on anything that is not a 2xx, and a retried
 * `payment.succeeded` must never grant a second credit pack. The claim is taken
 * *before* the side effect: `INSERT OR IGNORE` returning zero rows means another
 * delivery already owns this event.
 *
 * If the side effect fails, the claim is released so the provider's retry can
 * succeed. That is the opposite of the usual "record first, crash later" bug.
 */

import type { D1Database } from '../env.js';

export class D1BillingStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** True when this delivery is the first one for this message id. */
  async claimEvent(id: string, type: string): Promise<boolean> {
    if (!id) return false;
    const result = await this.db
      .prepare(`INSERT OR IGNORE INTO billing_events (id, type, created_at) VALUES (?, ?, ?)`)
      .bind(id, type, this.now())
      .run();
    return result.meta.changes > 0;
  }

  async releaseEvent(id: string): Promise<void> {
    if (!id) return;
    await this.db.prepare(`DELETE FROM billing_events WHERE id = ?`).bind(id).run();
  }

  /** Keeps the table bounded; 30 days is far past any retry window. */
  async purgeEvents(): Promise<number> {
    const cutoff = this.now() - 30 * 24 * 60 * 60 * 1000;
    const result = await this.db
      .prepare(`DELETE FROM billing_events WHERE created_at <= ?`)
      .bind(cutoff)
      .run();
    return result.meta.changes;
  }
}
