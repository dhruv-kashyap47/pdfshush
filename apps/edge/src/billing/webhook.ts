/**
 * What a verified webhook event does to the database.
 *
 * Kept out of the route so the effects can be tested without an HTTP round trip,
 * and so the route stays a thin wrapper: verify, claim, apply, acknowledge.
 *
 * The event types are the four Dodo sends for a subscription plus
 * `payment.succeeded` for the one-time rails. Refunds and disputes have their
 * own applier in `refunds.ts` because they may need one provider read to map a
 * payment id back to the entitlement it bought.
 *
 * Every branch is deliberately idempotent on its own as well as behind the
 * message-id claim, because a correctly claimed event can still be applied twice
 * during a retry after a released failure. The payment ledger adds the second
 * lock: a payment grants once even if Dodo sends it under another message id,
 * and a refunded payment can never grant afterwards.
 */

import type { D1Database } from '../env.js';
import {
  activateSubscription,
  endSubscription,
  extendSubscription,
  grantCredits,
  grantPass,
} from './entitlements.js';
import { asNumber, asString, asTime } from './dodo.js';
import { currentExpiry, markGranted, recordPayment, refundedThrough } from './ledger.js';
import { D1SponsorStore } from '../db/sponsor-store.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monthly when Dodo omits the date, a year for the yearly product. */
export function termEnd(value: unknown, now: number, fallbackDays = 31): number {
  return asTime(value) ?? now + fallbackDays * DAY_MS;
}

/** Dodo metadata is a string map; anything else is ignored, not coerced. */
export function metadataOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

/** The first product id in `product_cart`, or a flat `product_id`. */
export function productIdsOf(value: Record<string, unknown>): string[] {
  const out: string[] = [];
  const flat = asString(value.product_id);
  if (flat) out.push(flat);
  if (Array.isArray(value.product_cart)) {
    for (const entry of value.product_cart) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const id = asString((entry as Record<string, unknown>).product_id);
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/** `subscription_id` on most events, `subscription_ids[0]` on a payment. */
export function subscriptionIdsOf(value: Record<string, unknown>): string[] {
  const out: string[] = [];
  const flat = asString(value.subscription_id);
  if (flat) out.push(flat);
  if (Array.isArray(value.subscription_ids)) {
    for (const entry of value.subscription_ids) {
      const id = asString(entry);
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/** `month` unless the checkout said otherwise; only `year` stretches the term. */
function termDays(interval: string | undefined): number {
  return interval === 'year' ? 366 : 31;
}

/** Dodo nests the customer on some events and flattens the id on others. */
function customerIdOf(data: Record<string, unknown>): string | undefined {
  const customer = data.customer;
  if (customer && typeof customer === 'object' && !Array.isArray(customer)) {
    const nested = (customer as Record<string, unknown>).customer_id;
    if (typeof nested === 'string' && nested.length > 0) return nested;
  }
  return asString(data.customer_id);
}

/**
 * The customer id is what unlocks the hosted billing portal and the payment
 * list. It is written once, from a verified event, and never from the client.
 */
async function rememberCustomerId(
  db: D1Database,
  accountId: string,
  customerId: string | undefined,
): Promise<void> {
  if (!customerId) return;
  await db
    .prepare('UPDATE accounts SET dodo_customer_id = COALESCE(dodo_customer_id, ?) WHERE id = ?')
    .bind(customerId, accountId)
    .run();
}

async function creditBalance(db: D1Database, accountId: string): Promise<number | undefined> {
  const row = await db
    .prepare('SELECT credit_messages FROM accounts WHERE id = ?')
    .bind(accountId)
    .first<{ credit_messages: number }>();
  return row?.credit_messages;
}

export async function applyBillingEvent(
  db: D1Database,
  type: string,
  data: Record<string, unknown>,
  now = Date.now(),
): Promise<void> {
  const meta = metadataOf(data.metadata);
  const subscriptionId = asString(data.subscription_id);
  const subscriptions = subscriptionIdsOf(data);
  const sponsors = new D1SponsorStore(db);

  const ownerId = asString(meta.account_id);
  if (ownerId) await rememberCustomerId(db, ownerId, customerIdOf(data));

  switch (type) {
    case 'subscription.active': {
      if (meta.kind === 'pro') {
        const accountId = asString(meta.account_id);
        if (!accountId) {
          // Without the account id the subscription cannot be attached to
          // anyone; logging is the only honest outcome.
          console.warn('pro subscription.active without an account_id', subscriptionId);
          return;
        }
        const endsAt = termEnd(data.next_billing_date, now, termDays(meta.interval));
        // A delayed delivery for a term that was already refunded must not
        // grant it again. A later date is a new period and is allowed.
        if (subscriptionId && endsAt <= ((await refundedThrough(db, subscriptionId)) ?? 0)) {
          console.warn('subscription.active for a refunded term', subscriptionId);
          return;
        }
        const activated = await activateSubscription(
          db,
          {
            accountId,
            subscriptionId: subscriptionId ?? null,
            endsAt,
          },
          now,
        );
        if (!activated) console.warn('pro activation found no account', accountId);
        return;
      }

      const sponsorId = asString(meta.sponsor_id);
      if (!sponsorId) {
        console.warn('subscription.active without a sponsor_id', subscriptionId);
        return;
      }
      const activated = await sponsors.activate({
        id: sponsorId,
        subscriptionId: subscriptionId ?? null,
        endsAt: termEnd(data.next_billing_date, now),
      });
      if (!activated) {
        console.error('sponsor activation refused: slot taken or draft missing', sponsorId);
      }
      return;
    }

    case 'subscription.renewed': {
      if (!subscriptionId) return;
      const endsAt = termEnd(data.next_billing_date, now, termDays(meta.interval));
      if (endsAt <= ((await refundedThrough(db, subscriptionId)) ?? 0)) {
        console.warn('subscription.renewed for a refunded term', subscriptionId);
        return;
      }
      const extended = await extendSubscription(db, subscriptionId, endsAt, now);
      // No account owns this id, so it is one of the sponsor subscriptions.
      if (extended === undefined) await sponsors.renew(subscriptionId, endsAt);
      return;
    }

    // A cancellation ends the renewal, not the paid term. `plan_expires_at`
    // already stops access on the right day and the cron sweeps the column.
    case 'subscription.cancelled': {
      if (meta.kind === 'pro') return;
      if (subscriptionId) await sponsors.cancel(subscriptionId);
      return;
    }

    case 'subscription.expired': {
      if (!subscriptionId) return;
      const ended = await endSubscription(db, subscriptionId, now);
      if (!ended) await sponsors.cancel(subscriptionId);
      return;
    }

    case 'payment.succeeded': {
      const kind = meta.kind ?? 'unknown';
      const paymentId = asString(data.payment_id);
      const accountId = asString(meta.account_id) ?? null;

      // First sighting of this payment? A row that already exists has either
      // granted or been refunded; neither may happen a second time.
      if (paymentId) {
        const claim = await recordPayment(db, {
          paymentId,
          accountId,
          customerId: customerIdOf(data) ?? null,
          kind,
          productId: productIdsOf(data)[0] ?? null,
          subscriptionId: subscriptionId ?? subscriptions[0] ?? null,
          sponsorId: asString(meta.sponsor_id) ?? null,
          amount: asNumber(data.total_amount) ?? null,
          currency: asString(data.currency) ?? null,
          createdAt: now,
        });
        if (!claim.inserted && (claim.row.refunded_at || claim.row.granted_at)) {
          console.warn('payment already applied or refunded', paymentId);
          return;
        }
      }

      switch (kind) {
        case 'credits': {
          const credits = Number(meta.credits);
          if (!accountId || !Number.isFinite(credits)) return;
          const before = await creditBalance(db, accountId);
          const balance = await grantCredits(db, accountId, credits);
          if (balance === undefined) console.warn('credit grant found no account', accountId);
          if (paymentId) {
            const added =
              before === undefined || balance === undefined ? 0 : Math.max(0, balance - before);
            await markGranted(db, paymentId, { grantedAt: now, credits: added });
          }
          return;
        }
        case 'pass': {
          const days = Number(meta.days);
          if (!accountId || !Number.isFinite(days)) return;
          const previous = await currentExpiry(db, accountId);
          const expires = await grantPass(
            db,
            accountId,
            Math.min(365, Math.max(1, Math.trunc(days))),
          );
          if (expires === undefined) console.warn('pass grant found no account', accountId);
          if (paymentId) {
            await markGranted(db, paymentId, {
              grantedAt: now,
              previousExpiresAt: previous,
              grantedUntil: expires ?? null,
            });
          }
          return;
        }
        // The subscription's first payment can land before, with or instead of
        // `subscription.active`. This fallback only ever moves the term forward.
        case 'pro': {
          if (!accountId) return;
          const subscription = subscriptionId ?? subscriptions[0] ?? null;
          const endsAt = termEnd(data.next_billing_date, now, termDays(meta.interval));
          if (subscription && endsAt <= ((await refundedThrough(db, subscription)) ?? 0)) {
            console.warn('pro payment for a refunded term', subscription);
            return;
          }
          const previous = await currentExpiry(db, accountId);
          const activated = await activateSubscription(
            db,
            {
              accountId,
              subscriptionId: subscription,
              endsAt,
            },
            now,
          );
          if (!activated) console.warn('pro payment found no account', accountId);
          if (paymentId) {
            await markGranted(db, paymentId, {
              grantedAt: now,
              // A term already equal to this payment's term came from the
              // subscription event for the same period, not from an earlier
              // purchase. Refunding it must not restore that same term.
              previousExpiresAt: previous === endsAt ? null : previous,
              grantedUntil: activated?.planExpiresAt ?? null,
            });
          }
          return;
        }
        // A sponsor's first payment normally arrives alongside
        // `subscription.active`; this is the fallback for a delivery that lands
        // first or alone. `activate` only moves a draft, so a renewal is a no-op.
        case 'sponsor': {
          const sponsorId = asString(meta.sponsor_id);
          if (!sponsorId) return;
          const endsAt = termEnd(data.next_billing_date, now);
          await sponsors.activate({
            id: sponsorId,
            subscriptionId: subscriptionId ?? subscriptions[0] ?? null,
            endsAt,
          });
          if (paymentId) await markGranted(db, paymentId, { grantedAt: now, grantedUntil: endsAt });
          return;
        }
        // A donation grants nothing, but it is still recorded: a refund of it
        // must not be mistaken for a refund of the next payment.
        default: {
          if (paymentId) await markGranted(db, paymentId, { grantedAt: now });
          return;
        }
      }
    }

    default:
      return;
  }
}
