/**
 * What a verified webhook event does to the database.
 *
 * Kept out of the route so the effects can be tested without an HTTP round trip,
 * and so the route stays a thin wrapper: verify, claim, apply, acknowledge.
 *
 * The event types are the four Dodo sends for a subscription plus
 * `payment.succeeded` for the one-time rails. Every branch is deliberately
 * idempotent on its own as well as behind the message-id claim, because a
 * correctly claimed event can still be applied twice during a retry after a
 * released failure.
 */

import type { D1Database } from '../env.js';
import {
  activateSubscription,
  endSubscription,
  extendSubscription,
  grantCredits,
  grantPass,
} from './entitlements.js';
import { asString, asTime } from './dodo.js';
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

export async function applyBillingEvent(
  db: D1Database,
  type: string,
  data: Record<string, unknown>,
  now = Date.now(),
): Promise<void> {
  const meta = metadataOf(data.metadata);
  const subscriptionId = asString(data.subscription_id);
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
        const activated = await activateSubscription(
          db,
          {
            accountId,
            subscriptionId: subscriptionId ?? null,
            endsAt: termEnd(data.next_billing_date, now, termDays(meta.interval)),
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
      switch (meta.kind) {
        case 'credits': {
          const accountId = asString(meta.account_id);
          const credits = Number(meta.credits);
          if (!accountId || !Number.isFinite(credits)) return;
          const balance = await grantCredits(db, accountId, credits);
          if (balance === undefined) console.warn('credit grant found no account', accountId);
          return;
        }
        case 'pass': {
          const accountId = asString(meta.account_id);
          const days = Number(meta.days);
          if (!accountId || !Number.isFinite(days)) return;
          const expires = await grantPass(
            db,
            accountId,
            Math.min(365, Math.max(1, Math.trunc(days))),
          );
          if (expires === undefined) console.warn('pass grant found no account', accountId);
          return;
        }
        // The subscription's first payment can land before, with or instead of
        // `subscription.active`. This fallback only ever moves the term forward.
        case 'pro': {
          const accountId = asString(meta.account_id);
          if (!accountId) return;
          const activated = await activateSubscription(
            db,
            {
              accountId,
              subscriptionId: subscriptionId ?? null,
              endsAt: termEnd(data.next_billing_date, now, termDays(meta.interval)),
            },
            now,
          );
          if (!activated) console.warn('pro payment found no account', accountId);
          return;
        }
        // A sponsor's first payment normally arrives alongside
        // `subscription.active`; this is the fallback for a delivery that lands
        // first or alone. `activate` only moves a draft, so a renewal is a no-op.
        case 'sponsor': {
          const sponsorId = asString(meta.sponsor_id);
          if (!sponsorId) return;
          await sponsors.activate({
            id: sponsorId,
            subscriptionId: subscriptionId ?? null,
            endsAt: termEnd(data.next_billing_date, now),
          });
          return;
        }
        // A donation grants nothing.
        default:
          return;
      }
    }

    default:
      return;
  }
}
