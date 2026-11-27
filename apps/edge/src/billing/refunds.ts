/**
 * Refunds and disputes: events that take access back.
 *
 * Dodo is the money and the source of truth; this Worker decides what access
 * remains. A full refund reverses the entitlement the payment bought, a partial
 * refund keeps it (only part of the value was returned), and a dispute holds it
 * while the card-network case is open. A won or withdrawn dispute restores it.
 *
 * The ledger is read first so a normal refund costs no provider subrequest. If
 * the refund arrives before `payment.succeeded`, or the payment predates the
 * ledger, one `GET /payments/{id}` recovers the metadata and subscription id.
 * A lookup failure is thrown so the route answers 500 and Dodo retries.
 */

import type { D1Database } from '../env.js';
import type { BillingProduct, DodoConfig } from './dodo.js';
import { asString, retrieveDispute, retrievePayment } from './dodo.js';
import {
  getPayment,
  markGranted,
  markRefunded,
  markRestored,
  markRevoked,
  recordPayment,
  restoreEntitlement,
  revokeEntitlement,
  setPaymentKind,
  type PaymentLedgerRow,
} from './ledger.js';
import { metadataOf, productIdsOf } from './webhook.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const PRODUCT_KIND: Record<BillingProduct, string> = {
  'pro-monthly': 'pro',
  'pro-yearly': 'pro',
  'sponsor-featured': 'sponsor',
  'sponsor-standard': 'sponsor',
  credits: 'credits',
  'pass-30d': 'pass',
  donate: 'donation',
};

/** Recover the rail from the product id when checkout metadata is absent. */
export function kindFromProduct(
  config: DodoConfig,
  productId: string | null,
): string | undefined {
  if (!productId) return undefined;
  for (const [key, kind] of Object.entries(PRODUCT_KIND)) {
    if (config.products[key as BillingProduct] === productId) return kind;
  }
  return undefined;
}

/**
 * A short product comparison for defence in depth. The signature already proves
 * the event came from Dodo; this additionally proves the product that was paid
 * for is the product the metadata claims, so a mis-created checkout cannot turn
 * a $1 donation into a credit pack.
 *
 * Returns `null` when there is nothing to compare (no product id, no expected
 * product, or unknown metadata), which is every legitimate renewal without
 * metadata.
 */
export function productMismatch(
  config: DodoConfig,
  data: Record<string, unknown>,
): { expected: string; actual: string } | null {
  const meta = metadataOf(data.metadata);
  let expectedKey: BillingProduct | undefined;

  switch (meta.kind) {
    case 'pro':
      expectedKey = meta.interval === 'year' ? 'pro-yearly' : 'pro-monthly';
      break;
    case 'credits':
      expectedKey = 'credits';
      break;
    case 'pass':
      expectedKey = 'pass-30d';
      break;
    case 'donation':
      expectedKey = 'donate';
      break;
    case 'sponsor':
      expectedKey =
        meta.slot === 'standard'
          ? 'sponsor-standard'
          : meta.slot === 'featured'
            ? 'sponsor-featured'
            : undefined;
      break;
    default:
      expectedKey = undefined;
  }

  if (!expectedKey) return null;
  const expected = config.products[expectedKey];
  if (!expected) return null;
  const actual = productIdsOf(data)[0];
  if (!actual || actual === expected) return null;
  return { expected, actual };
}

/**
 * The ledger row for this payment, created from Dodo when it is not known yet.
 * A row created here is not marked granted: the grant may have come from
 * `subscription.active`, and revocation is written so that an absent grant is a
 * no-op rather than a guess.
 */
async function ledgerFor(
  db: D1Database,
  config: DodoConfig,
  paymentId: string,
  now: number,
): Promise<PaymentLedgerRow> {
  const existing = await getPayment(db, paymentId);
  if (existing) {
    if (existing.kind !== 'unknown') return existing;
    // A renewal often arrives without checkout metadata. Its product id still
    // names the rail, so correct the row before deciding what to revoke.
    const inferred = kindFromProduct(config, existing.product_id);
    if (!inferred) return existing;
    await setPaymentKind(db, paymentId, inferred);
    return { ...existing, kind: inferred };
  }

  const payment = await retrievePayment(config, paymentId);
  const meta = metadataOf(payment.metadata);
  const kind = meta.kind ?? kindFromProduct(config, payment.productId) ?? 'unknown';
  const createdAtMs = payment.createdAt ? Date.parse(payment.createdAt) : Number.NaN;
  const days = Number(meta.days);
  const credits = Number(meta.credits);
  const grantedUntil =
    kind === 'pass' && Number.isFinite(days) && Number.isFinite(createdAtMs)
      ? createdAtMs + Math.min(365, Math.max(1, Math.trunc(days))) * DAY_MS
      : null;

  const { row } = await recordPayment(db, {
    paymentId,
    accountId: asString(meta.account_id) ?? null,
    customerId: payment.customerId,
    kind,
    productId: payment.productId,
    subscriptionId: payment.subscriptionId,
    sponsorId: asString(meta.sponsor_id) ?? null,
    amount: payment.amount,
    currency: payment.currency,
    createdAt: Number.isFinite(createdAtMs) ? createdAtMs : now,
  });

  // A payment that predates the ledger still has to be revocable. Recover the
  // pass term from its creation date and the credits from the metadata; the
  // previous term is unknowable, so revocation stays conservative.
  await markGranted(db, paymentId, {
    grantedAt: Number.isFinite(createdAtMs) ? createdAtMs : now,
    grantedUntil,
    credits: kind === 'credits' && Number.isFinite(credits) ? credits : 0,
  });
  return (await getPayment(db, paymentId)) ?? row;
}

export async function applyRefundEvent(
  db: D1Database,
  config: DodoConfig,
  type: string,
  data: Record<string, unknown>,
  now = Date.now(),
): Promise<void> {
  if (type === 'refund.failed') {
    // The money did not move, so access stays. Log enough to investigate.
    console.warn('refund failed; access kept', asString(data.payment_id), asString(data.refund_id));
    return;
  }

  if (type === 'refund.succeeded') {
    const paymentId = asString(data.payment_id);
    if (!paymentId) return;

    // A partial refund is a price adjustment; revoking everything would be the
    // documented common mistake. The exception is a payment refunded in two or
    // more parts: once the provider's own status is `full`, the value has all
    // come back and access must end.
    if (data.is_partial === true) {
      const payment = await retrievePayment(config, paymentId);
      if (payment.refundStatus !== 'full') {
        console.warn('partial refund; access kept', paymentId);
        return;
      }
    }

    const row = await ledgerFor(db, config, paymentId, now);
    await markRefunded(db, paymentId, now);
    if (row.revoked_at) return;

    const effect = await revokeEntitlement(db, row, 'refund', now);
    await markRevoked(db, paymentId, 'refund', now);
    console.warn('refund revoked access', paymentId, row.kind, effect);
    return;
  }

  if (!type.startsWith('dispute.')) return;

  const disputeId = asString(data.dispute_id);
  if (!disputeId) return;

  // Dispute payloads carry no customer or metadata; one read maps the dispute
  // to the payment whose entitlement is in question.
  const dispute = await retrieveDispute(config, disputeId);
  const row = await ledgerFor(db, config, dispute.paymentId, now);

  if (type === 'dispute.opened' || type === 'dispute.challenged') {
    if (row.revoked_at) return;
    const effect = await revokeEntitlement(db, row, 'dispute', now);
    await markRevoked(db, dispute.paymentId, `dispute:${type}`, now);
    console.warn('dispute revoked access', disputeId, row.kind, effect);
    return;
  }

  // The card network returned the money to the merchant.
  if (type === 'dispute.won' || type === 'dispute.cancelled') {
    if (!row.revoked_at) return;
    const effect = await restoreEntitlement(db, row, now);
    await markRestored(db, dispute.paymentId, now);
    console.warn('dispute restored access', disputeId, row.kind, effect);
    return;
  }

  // accepted, lost and expired all keep the revocation.
}
