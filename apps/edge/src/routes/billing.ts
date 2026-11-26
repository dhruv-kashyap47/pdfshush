/**
 * Billing: the recurring Pro rail, the three one-time rails, and the webhook
 * that makes them all real.
 *
 *   Pro             $6/mo · $48/yr — a Dodo subscription
 *   30-day pass     $3             — Pro for 30 days, no renewal
 *   credit pack     $5             — 1,000 managed AI messages
 *   donation        any            — a thank-you, no entitlement
 *
 * The sponsor slots are created in `routes/sponsors.ts`; every rail shares the
 * same Dodo account and the same webhook. Dodo is the merchant of record, so the
 * money, tax and receipts never enter this Worker.
 *
 * The webhook is the only place a payment becomes an entitlement. It verifies
 * the Standard Webhooks signature against the raw body, claims the message id
 * once, applies the effect, and answers 200 so a retry does not loop forever.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../app-env.js';
import { PASS_DAYS } from '../billing/entitlements.js';
import {
  createCheckout,
  dodoConfig,
  productId,
  verifyWebhook,
  webhookEvent,
} from '../billing/dodo.js';
import { applyBillingEvent } from '../billing/webhook.js';
import { D1BillingStore } from '../db/billing-store.js';
import { fail, readJsonObject, requireCsrf, sameOriginRequest, webOrigin } from '../lib/http.js';
import { underHourlyLimit } from '../lib/rate-limit.js';
import { requireAccount } from '../lib/session.js';

export const billingRoutes = new Hono<AppEnv>();

/** One SKU each; the numbers live here, not in three copies of a landing page. */
export const CREDIT_PACK = { messages: 1_000, priceCents: 500 } as const;
export const PASS = { days: PASS_DAYS, priceCents: 300 } as const;
export const PRO = { monthlyCents: 600, yearlyCents: 4_800 } as const;
export const DONATION = { minCents: 100, maxCents: 50_000 } as const;

type ProInterval = 'month' | 'year';

function proInterval(value: unknown): ProInterval {
  return value === 'year' ? 'year' : 'month';
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

billingRoutes.post('/api/billing/pro', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;
  const denied = requireCsrf(c);
  if (denied) return denied;
  if (!account.email) return fail(c, 400, 'email_required', 'Add an email before subscribing.');

  const body = await readJsonObject(c);
  const interval = proInterval(body.interval);

  const config = dodoConfig(c.env);
  const product = config
    ? productId(config, interval === 'year' ? 'pro-yearly' : 'pro-monthly')
    : undefined;
  if (!config || !product) return billingDown(c, 'Pro subscription');

  const priceCents = interval === 'year' ? PRO.yearlyCents : PRO.monthlyCents;

  try {
    const checkout = await createCheckout(config, {
      productId: product,
      email: account.email,
      ...(account.name ? { name: account.name } : {}),
      returnUrl: `${webOrigin(c.env, c.req.url)}/account?status=pro`,
      metadata: {
        kind: 'pro',
        account_id: account.id,
        interval,
      },
    });
    return c.json({ url: checkout.url, interval, priceCents });
  } catch (error) {
    console.error('dodo pro checkout failed', error);
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
    await applyBillingEvent(c.env.DB, event.type, event.data);
  } catch (error) {
    // Release the claim so the provider's retry can try again; a 500 asks for it.
    await billing.releaseEvent(event.id);
    console.error('webhook handler failed', event.type, error);
    return fail(c, 500, 'webhook_failed', 'Could not apply this event.');
  }

  return c.json({ received: true });
});

