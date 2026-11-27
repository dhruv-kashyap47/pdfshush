/**
 * The payment ledger and what a refund or a dispute does to access.
 *
 * `billing_events` makes a webhook message id apply once. This table makes the
 * *payment* apply once, which matters for three cases the message id cannot
 * cover:
 *
 *   - Dodo delivers the same payment under a second message id;
 *   - `refund.succeeded` arrives before the `payment.succeeded` that granted;
 *   - a refund is only known by `payment_id`, so the grant has to be recoverable.
 *
 * Revocation is deliberately exact. A refunded pass restores the term the buyer
 * already owned; a refunded subscription ends the term that payment paid for,
 * not a later one; a refunded credit pack removes at most the messages that pack
 * added, so a second pack is untouched. A partial refund keeps access: only the
 * full reversal of a payment takes the entitlement back.
 */

import type { D1Database } from '../env.js';

export const MAX_LEDGER_CREDITS = 50_000;

export interface PaymentLedgerRow {
  payment_id: string;
  account_id: string | null;
  customer_id: string | null;
  kind: string;
  product_id: string | null;
  subscription_id: string | null;
  sponsor_id: string | null;
  credits: number;
  previous_expires_at: number | null;
  granted_until: number | null;
  amount: number | null;
  currency: string | null;
  created_at: number;
  granted_at: number | null;
  refunded_at: number | null;
  revoked_at: number | null;
  restored_at: number | null;
  revoke_reason: string | null;
}

export interface PaymentInput {
  paymentId: string;
  accountId: string | null;
  customerId: string | null;
  kind: string;
  productId: string | null;
  subscriptionId: string | null;
  sponsorId: string | null;
  amount: number | null;
  currency: string | null;
  createdAt: number;
}

const SELECT = `SELECT payment_id, account_id, customer_id, kind, product_id,
                       subscription_id, sponsor_id, credits, previous_expires_at,
                       granted_until, amount, currency, created_at, granted_at,
                       refunded_at, revoked_at, restored_at, revoke_reason
                  FROM billing_payments`;

export async function getPayment(
  db: D1Database,
  paymentId: string,
): Promise<PaymentLedgerRow | undefined> {
  if (!paymentId) return undefined;
  const row = await db
    .prepare(`${SELECT} WHERE payment_id = ?`)
    .bind(paymentId)
    .first<PaymentLedgerRow>();
  return row ?? undefined;
}

/**
 * Insert the payment if this is its first sighting. `inserted` is the grant
 * permission: a row that already exists must not grant a second time, and a row
 * that already carries `refunded_at` must not grant at all.
 */
export async function recordPayment(
  db: D1Database,
  input: PaymentInput,
): Promise<{ inserted: boolean; row: PaymentLedgerRow }> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO billing_payments
         (payment_id, account_id, customer_id, kind, product_id,
          subscription_id, sponsor_id, amount, currency, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.paymentId,
      input.accountId,
      input.customerId,
      input.kind,
      input.productId,
      input.subscriptionId,
      input.sponsorId,
      input.amount,
      input.currency,
      input.createdAt,
    )
    .run();

  const row = await getPayment(db, input.paymentId);
  if (!row) throw new Error('payment ledger insert returned no row');
  return { inserted: result.meta.changes > 0, row };
}

/** Record exactly what the grant changed, once. */
export async function markGranted(
  db: D1Database,
  paymentId: string,
  grant: { grantedAt: number; previousExpiresAt?: number | null; grantedUntil?: number | null; credits?: number },
): Promise<void> {
  await db
    .prepare(
      `UPDATE billing_payments
          SET granted_at = COALESCE(granted_at, ?),
              previous_expires_at = COALESCE(previous_expires_at, ?),
              granted_until = COALESCE(granted_until, ?),
              credits = CASE WHEN credits = 0 THEN ? ELSE credits END
        WHERE payment_id = ?`,
    )
    .bind(
      grant.grantedAt,
      grant.previousExpiresAt ?? null,
      grant.grantedUntil ?? null,
      Math.min(MAX_LEDGER_CREDITS, Math.max(0, Math.trunc(grant.credits ?? 0))),
      paymentId,
    )
    .run();
}

export async function markRefunded(
  db: D1Database,
  paymentId: string,
  now: number,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE billing_payments
          SET refunded_at = COALESCE(refunded_at, ?)
        WHERE payment_id = ?`,
    )
    .bind(now, paymentId)
    .run();
  return result.meta.changes;
}

/**
 * The furthest term a refunded payment for this subscription paid through.
 *
 * A delayed `subscription.active` or `subscription.renewed` can arrive after a
 * refund and would otherwise grant the term the customer just got back. If the
 * event describes a term at or before this date, it is stale; a later date is a
 * new paid period and is allowed.
 */
export async function refundedThrough(
  db: D1Database,
  subscriptionId: string,
): Promise<number | null> {
  if (!subscriptionId) return null;
  const row = await db
    .prepare(
      `SELECT MAX(granted_until) AS term
         FROM billing_payments
        WHERE subscription_id = ? AND refunded_at IS NOT NULL`,
    )
    .bind(subscriptionId)
    .first<{ term: number | null }>();
  return row?.term ?? null;
}

export async function markRevoked(
  db: D1Database,
  paymentId: string,
  reason: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE billing_payments
          SET revoked_at = COALESCE(revoked_at, ?), revoke_reason = ?
        WHERE payment_id = ?`,
    )
    .bind(now, reason, paymentId)
    .run();
}

export async function markRestored(
  db: D1Database,
  paymentId: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE billing_payments
          SET revoked_at = NULL, restored_at = ?, revoke_reason = NULL
        WHERE payment_id = ?`,
    )
    .bind(now, paymentId)
    .run();
}

/** Correct an `unknown` row once a product id identifies what was bought. */
export async function setPaymentKind(
  db: D1Database,
  paymentId: string,
  kind: string,
): Promise<void> {
  await db
    .prepare(`UPDATE billing_payments SET kind = ? WHERE payment_id = ? AND kind = 'unknown'`)
    .bind(kind, paymentId)
    .run();
}

/** The expiry before a grant, used to restore a refunded pass or subscription. */
export async function currentExpiry(
  db: D1Database,
  accountId: string,
): Promise<number | null> {
  const row = await db
    .prepare('SELECT plan_expires_at FROM accounts WHERE id = ?')
    .bind(accountId)
    .first<{ plan_expires_at: number | null }>();
  return row?.plan_expires_at ?? null;
}

/* --------------------------------------------------------------- revocation */

async function subscriptionForAccount(
  db: D1Database,
  accountId: string,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT dodo_subscription_id FROM accounts WHERE id = ?')
    .bind(accountId)
    .first<{ dodo_subscription_id: string | null }>();
  return row?.dodo_subscription_id ?? null;
}

async function accountForSubscription(
  db: D1Database,
  subscriptionId: string,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT id FROM accounts WHERE dodo_subscription_id = ?')
    .bind(subscriptionId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * Take back what one payment granted.
 *
 * Returns a short description for the webhook log. The caller has already
 * marked the payment refunded, so this is safe to retry: every statement is
 * guarded by the values it is allowed to touch, and a second call is a no-op on
 * an already-free row.
 */
export async function revokeEntitlement(
  db: D1Database,
  row: PaymentLedgerRow,
  reason: string,
  now = Date.now(),
): Promise<string> {
  switch (row.kind) {
    case 'credits': {
      if (!row.account_id || row.credits <= 0) return 'credits:no_account';
      const result = await db
        .prepare(
          `UPDATE accounts
              SET credit_messages = MAX(0, credit_messages - ?)
            WHERE id = ?`,
        )
        .bind(row.credits, row.account_id)
        .run();
      return result.meta.changes > 0 ? `credits:-${row.credits}` : 'credits:no_account';
    }

    case 'pass': {
      if (!row.account_id) return 'pass:no_account';
      // Restore the term the buyer already owned. The `granted_until` guard is
      // what keeps a later grant intact: if a second pass or a subscription has
      // since moved the term beyond what this pass produced, the refund does
      // nothing. When the pass sat on top of a subscription, `previous` is that
      // subscription's end, so the subscription survives and the extra pass
      // days do not.
      const result = await db
        .prepare(
          `UPDATE accounts
              SET plan = CASE WHEN COALESCE(?, 0) > ? THEN 'pro' ELSE 'free' END,
                  plan_expires_at = CASE WHEN COALESCE(?, 0) > ? THEN ? ELSE ? END
            WHERE id = ?
              AND plan_expires_at IS NOT NULL
              AND ? IS NOT NULL
              AND plan_expires_at <= ?
              AND (dodo_subscription_id IS NULL OR ? IS NOT NULL)`,
        )
        .bind(
          row.previous_expires_at,
          now,
          row.previous_expires_at,
          now,
          row.previous_expires_at,
          now,
          row.account_id,
          row.granted_until,
          row.granted_until,
          row.previous_expires_at,
        )
        .run();
      return result.meta.changes > 0 ? 'pass:reverted' : 'pass:not_active';
    }

    case 'pro': {
      // A renewal payment often carries no checkout metadata, so the account is
      // found through the subscription id recorded at activation.
      const subscriptionId =
        row.subscription_id ?? (row.account_id ? await subscriptionForAccount(db, row.account_id) : null);
      if (!subscriptionId) return 'pro:no_subscription';
      const accountId = row.account_id ?? (await accountForSubscription(db, subscriptionId));
      if (!accountId) return 'pro:no_account';
      // Restore the term that existed before this subscription payment. A
      // refunded renewal therefore falls back to the previous paid month, not
      // to a free account if that month is still running. The `granted_until`
      // guard keeps a later pass or renewal intact: if the account has since
      // moved beyond what this payment paid for, the refund changes nothing.
      const result = await db
        .prepare(
          `UPDATE accounts
              SET plan = CASE WHEN COALESCE(?, 0) > ? THEN 'pro' ELSE 'free' END,
                  plan_expires_at = CASE WHEN COALESCE(?, 0) > ? THEN ? ELSE ? END
            WHERE id = ? AND dodo_subscription_id = ?
              AND plan_expires_at IS NOT NULL
              AND (? IS NULL OR plan_expires_at <= ?)`,
        )
        .bind(
          row.previous_expires_at,
          now,
          row.previous_expires_at,
          now,
          row.previous_expires_at,
          now,
          accountId,
          subscriptionId,
          row.granted_until,
          row.granted_until,
        )
        .run();
      return result.meta.changes > 0 ? 'pro:ended' : 'pro:not_owned';
    }

    case 'sponsor': {
      if (row.sponsor_id) {
        // `expired` is correct even for a still-draft row: it stops a later
        // `subscription.active` from turning a refunded checkout live.
        const result = await db
          .prepare(
            `UPDATE sponsors SET status = 'expired', ends_at = ?
              WHERE id = ? AND status <> 'expired'`,
          )
          .bind(now, row.sponsor_id)
          .run();
        return result.meta.changes > 0 ? 'sponsor:hidden' : 'sponsor:absent';
      }
      if (row.subscription_id) {
        const result = await db
          .prepare(
            `UPDATE sponsors SET status = 'expired', ends_at = ?
              WHERE dodo_subscription_id = ? AND status <> 'expired'`,
          )
          .bind(now, row.subscription_id)
          .run();
        return result.meta.changes > 0 ? 'sponsor:hidden' : 'sponsor:absent';
      }
      return 'sponsor:no_row';
    }

    // A donation is not an entitlement, so there is nothing to revoke. An
    // unknown kind with a subscription id is a renewal whose payment carried no
    // checkout metadata; the id still says whether it belongs to an account or
    // a sponsor, so access is not left behind.
    default: {
      if (row.subscription_id) {
        const accountId = await accountForSubscription(db, row.subscription_id);
        if (accountId) {
          const result = await db
            .prepare(
              `UPDATE accounts SET plan = 'free', plan_expires_at = ?
                WHERE id = ? AND dodo_subscription_id = ?`,
            )
            .bind(now, accountId, row.subscription_id)
            .run();
          return result.meta.changes > 0 ? 'pro:ended' : 'pro:not_owned';
        }
        const result = await db
          .prepare(
            `UPDATE sponsors SET status = 'expired', ends_at = ?
              WHERE dodo_subscription_id = ? AND status <> 'expired'`,
          )
          .bind(now, row.subscription_id)
          .run();
        if (result.meta.changes > 0) return 'sponsor:hidden';
      }
      return `noop:${reason}`;
    }
  }
}

/* ----------------------------------------------------------------- restore */

/**
 * A won or withdrawn dispute returns the money to the merchant, so the access
 * the payment bought is restored as far as its paid term still runs. Credits
 * go back up to the documented cap; nothing is invented beyond the grant.
 */
export async function restoreEntitlement(
  db: D1Database,
  row: PaymentLedgerRow,
  now = Date.now(),
): Promise<string> {
  switch (row.kind) {
    case 'credits': {
      if (!row.account_id || row.credits <= 0) return 'credits:no_account';
      const result = await db
        .prepare(
          `UPDATE accounts
              SET credit_messages = MIN(credit_messages + ?, ${MAX_LEDGER_CREDITS})
            WHERE id = ?`,
        )
        .bind(row.credits, row.account_id)
        .run();
      return result.meta.changes > 0 ? `credits:+${row.credits}` : 'credits:no_account';
    }

    case 'pass': {
      if (!row.account_id || !row.granted_until || row.granted_until <= now) {
        return 'pass:expired';
      }
      const result = await db
        .prepare(
          `UPDATE accounts
              SET plan = 'pro',
                  plan_expires_at = MAX(COALESCE(plan_expires_at, ?), ?)
            WHERE id = ? AND dodo_subscription_id IS NULL`,
        )
        .bind(now, row.granted_until, row.account_id)
        .run();
      return result.meta.changes > 0 ? 'pass:restored' : 'pass:not_restorable';
    }

    case 'pro': {
      if (!row.granted_until || row.granted_until <= now) {
        return 'pro:expired';
      }
      const subscriptionId =
        row.subscription_id ?? (row.account_id ? await subscriptionForAccount(db, row.account_id) : null);
      if (!subscriptionId) return 'pro:no_subscription';
      const accountId = row.account_id ?? (await accountForSubscription(db, subscriptionId));
      if (!accountId) return 'pro:no_account';
      const result = await db
        .prepare(
          `UPDATE accounts
              SET plan = 'pro',
                  plan_expires_at = MAX(COALESCE(plan_expires_at, ?), ?)
            WHERE id = ? AND dodo_subscription_id = ?`,
        )
        .bind(now, row.granted_until, accountId, subscriptionId)
        .run();
      return result.meta.changes > 0 ? 'pro:restored' : 'pro:not_owned';
    }

    case 'sponsor': {
      if (!row.granted_until || row.granted_until <= now) return 'sponsor:expired';
      if (!row.sponsor_id) return 'sponsor:no_row';
      const result = await db
        .prepare(
          `UPDATE sponsors
              SET status = 'active', ends_at = ?
            WHERE id = ?
              AND status = 'expired'
              AND NOT EXISTS (
                SELECT 1 FROM sponsors other
                 WHERE other.slot = sponsors.slot
                   AND other.id <> sponsors.id
                   AND other.status IN ('active', 'cancelled')
                   AND other.ends_at > ?
              )`,
        )
        .bind(row.granted_until, row.sponsor_id, now)
        .run();
      return result.meta.changes > 0 ? 'sponsor:restored' : 'sponsor:slot_taken';
    }

    default:
      return 'noop';
  }
}
