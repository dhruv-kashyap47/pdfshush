/**
 * Billing: the three one-time rails and the webhook that makes them real.
 *
 *   30-day pass   $3   — Pro for 30 days, no renewal
 *   credit pack   $5   — 1,000 managed AI messages, spent after the monthly cap
 *   donation      any  — a thank-you, no entitlement
 *
 * The subscription and the sponsor slots are created elsewhere; all four share
 * the same Dodo account and the same webhook. Dodo is the merchant of record, so
 * the money, tax and receipts never enter this Worker.
 *
 * The webhook is the only place a payment becomes an entitlement. It verifies
 * the Standard Webhooks signature against the raw body, claims the message id
 * once, applies the effect, and answers 200 so a retry does not loop forever.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../app-env.js';
import { grantCredits, grantPass, PASS_DAYS } from '../billing/entitlements.js';
import {
  asString,
  asTime,
  createCheckout,
  dodoConfig,
  productId,
  verifyWebhook,
  webhookEvent,
} from '../billing/dodo.js';
import { D1BillingStore } from '../db/billing-store.js';
import { D1SponsorStore } from '../db/sponsor-store.js';
import { fail, readJsonObject, requireCsrf, sameOriginRequest, webOrigin } from '../lib/http.js';
import { underHourlyLimit } from '../lib/rate-limit.js';
import { requireAccount } from '../lib/session.js';

export const billingRoutes = new Hono<AppEnv>();

/** One SKU each; the numbers live here, not in three copies of a landing page. */
export const CREDIT_PACK = { messages: 1_000, priceCents: 500 } as const;
export const PASS = { days: PASS_DAYS, priceCents: 300 } as const;
export const DONATION = { minCents: 100, maxCents: 50_000 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A Dodo subscription with no usable next date still gets a full month. */
function termEnd(value: unknown, now: number): number {
  return asTime(value) ?? now + 31 * DAY_MS;
}

/** Dodo metadata is a string map; anything else is ignored, not coerced. */
function metadataOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

function billingDown(c: Context<AppEnv>, product: string) {
  return fail(
    c,
    503,
    'billing_disabled',
    `Billing is not configured on this deployment (${product}).`,
  );
}

/* ------------------------------------------------------------ one-time */

billingRoutes.post('/api/billing/credits', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;
  const denied = requireCsrf(c);
  if (denied) return denied;
  if (!account.email) return fail(c, 400, 'email_required', 'Add an email before buying.');

  const config = dodoConfig(c.env);
  const product = config ? productId(config, 'credits') : undefined;
  if (!config || !product) return billingDown(c, 'credit pack');

  try {
    const checkout = await createCheckout(config, {
      productId: product,
      email: account.email,
      ...(account.name ? { name: account.name } : {}),
      returnUrl: `${webOrigin(c.env, c.req.url)}/account?status=credits`,
      metadata: {
        kind: 'credits',
        account_id: account.id,
        credits: String(CREDIT_PACK.messages),
      },
    });
    return c.json({ url: checkout.url, messages: CREDIT_PACK.messages, priceCents: CREDIT_PACK.priceCents });
  } catch (error) {
    console.error('dodo credits checkout failed', error);
    return fail(c, 502, 'billing_error', 'The payment provider did not answer. Try again.');
  }
});

billingRoutes.post('/api/billing/pass', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;
  const denied = requireCsrf(c);
  if (denied) return denied;
  if (!account.email) return fail(c, 400, 'email_required', 'Add an email before buying.');

  const config = dodoConfig(c.env);
  const product = config ? productId(config, 'pass-30d') : undefined;
  if (!config || !product) return billingDown(c, '30-day pass');

  try {
    const checkout = await createCheckout(config, {
      productId: product,
      email: account.email,
      ...(account.name ? { name: account.name } : {}),
      returnUrl: `${webOrigin(c.env, c.req.url)}/account?status=pass`,
      metadata: {
        kind: 'pass',
        account_id: account.id,
        days: String(PASS.days),
      },
    });
    return c.json({ url: checkout.url, days: PASS.days, priceCents: PASS.priceCents });
  } catch (error) {
    console.error('dodo pass checkout failed', error);
    return fail(c, 502, 'billing_error', 'The payment provider did not answer. Try again.');
  }
});

billingRoutes.post('/api/billing/donate', async (c) => {
  const config = dodoConfig(c.env);
  const product = config ? productId(config, 'donate') : undefined;
  if (!config || !product) return billingDown(c, 'donations');

  if (!sameOriginRequest(c)) {
    return fail(c, 403, 'origin', 'Cross-origin checkout is not allowed.');
  }
  if (!(await underHourlyLimit(c, 'donate:chk', 5))) {
    return fail(c, 429, 'rate_limited', 'Too many attempts. Try again in an hour.');
  }

  const body = await readJsonObject(c);
  const amount = Number(body.amountCents);
  if (!Number.isInteger(amount) || amount < DONATION.minCents || amount > DONATION.maxCents) {
    return fail(
      c,
      400,
      'validation_failed',
      `Donation must be between $${DONATION.minCents / 100} and $${DONATION.maxCents / 100}.`,
    );
  }

  // Dodo needs somewhere to send the receipt; a donation without one would be
  // paid against a placeholder address, which is not a receipt anyone can keep.
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) {
    return fail(c, 400, 'validation_failed', 'A valid email is required for the receipt.');
  }

  const base = webOrigin(c.env, c.req.url);
  try {
    const checkout = await createCheckout(config, {
      productId: product,
      email,
      returnUrl: `${base}/sponsor?status=thanks#donate`,
      cancelUrl: `${base}/sponsor?status=cancelled#donate`,
      metadata: { kind: 'donation' },
      amountCents: amount,
    });
    return c.json({ url: checkout.url });
  } catch (error) {
    console.error('dodo donation checkout failed', error);
    return fail(c, 502, 'billing_error', 'The payment provider did not answer. Try again.');
  }
});

/* -------------------------------------------------------------- webhook */

billingRoutes.post('/api/billing/webhook', async (c) => {
  const config = dodoConfig(c.env);
  if (!config?.webhookSecret) return billingDown(c, 'webhook');

  // The exact bytes Dodo signed; parsing first and re-serialising would change
  // them, and a single differing byte is a failed signature.
  const raw = await c.req.text();
  let payload: Record<string, unknown>;
  try {
    payload = await verifyWebhook(config.webhookSecret, raw, {
      id: c.req.header('webhook-id') ?? undefined,
      timestamp: c.req.header('webhook-timestamp') ?? undefined,
      signature: c.req.header('webhook-signature') ?? undefined,
    });
  } catch (error) {
    console.warn('webhook rejected', error);
    return fail(c, 400, 'invalid_signature', 'Webhook signature did not verify.');
  }

  const event = webhookEvent(payload);
  if (!event.id || !event.type) return c.json({ received: true, ignored: 'malformed' });

  const billing = new D1BillingStore(c.env.DB);
  const claimed = await billing.claimEvent(event.id, event.type);
  if (!claimed) return c.json({ received: true, duplicate: true });

  try {
    await apply(c, event.type, event.data);
  } catch (error) {
    // Release the claim so the provider's retry can try again; a 500 asks for it.
    await billing.releaseEvent(event.id);
    console.error('webhook handler failed', event.type, error);
    return fail(c, 500, 'webhook_failed', 'Could not apply this event.');
  }

  return c.json({ received: true });
});

async function apply(c: Context<AppEnv>, type: string, data: Record<string, unknown>): Promise<void> {
  const now = Date.now();
  const meta = metadataOf(data.metadata);
  const subscriptionId = asString(data.subscription_id);
  const store = new D1SponsorStore(c.env.DB);

  switch (type) {
    case 'subscription.active': {
      const sponsorId = asString(meta.sponsor_id);
      if (!sponsorId) {
        console.warn('subscription.active without a sponsor_id', subscriptionId);
        return;
      }
      const activated = await store.activate({
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
      await store.renew(subscriptionId, termEnd(data.next_billing_date, now));
      return;
    }

    case 'subscription.cancelled':
    case 'subscription.expired': {
      if (!subscriptionId) return;
      await store.cancel(subscriptionId);
      return;
    }

    case 'payment.succeeded': {
      switch (meta.kind) {
        case 'credits': {
          const accountId = asString(meta.account_id);
          const credits = Number(meta.credits);
          if (!accountId || !Number.isFinite(credits)) return;
          const balance = await grantCredits(c.env.DB, accountId, credits);
          if (balance === undefined) console.warn('credit grant found no account', accountId);
          return;
        }
        case 'pass': {
          const accountId = asString(meta.account_id);
          const days = Number(meta.days);
          if (!accountId || !Number.isFinite(days)) return;
          const expires = await grantPass(
            c.env.DB,
            accountId,
            Math.min(365, Math.max(1, Math.trunc(days))),
          );
          if (expires === undefined) console.warn('pass grant found no account', accountId);
          return;
        }
        // A sponsor's first payment normally arrives alongside
        // `subscription.active`; this is the fallback for a delivery that lands
        // first or alone. `activate` only moves a draft, so a renewal is a no-op.
        case 'sponsor': {
          const sponsorId = asString(meta.sponsor_id);
          if (!sponsorId) return;
          await store.activate({
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
