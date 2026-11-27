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
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../app-env.js';
import { PASS_DAYS } from '../billing/entitlements.js';
import {
  createCheckout,
  createCustomerPortalSession,
  dodoConfig,
  productId,
  verifyWebhook,
  webhookEvent,
} from '../billing/dodo.js';
import { applyRefundEvent, productMismatch } from '../billing/refunds.js';
import { applyBillingEvent } from '../billing/webhook.js';
import { D1AuthStore } from '../db/auth-store.js';
import { D1BillingStore } from '../db/billing-store.js';
import {
  SESSION_COOKIE,
  fail,
  readJsonObject,
  readTextLimited,
  requireCsrf,
  sameOriginRequest,
  webOrigin,
} from '../lib/http.js';
import { underHourlyLimit } from '../lib/rate-limit.js';
import { requireAccount } from '../lib/session.js';

export const billingRoutes = new Hono<AppEnv>();

/** One SKU each; the numbers live here, not in three copies of a landing page. */
export const CREDIT_PACK = { messages: 1_000, priceCents: 500 } as const;
export const PASS = { days: PASS_DAYS, priceCents: 300 } as const;
export const PRO = { monthlyCents: 600, yearlyCents: 4_800 } as const;
export const DONATION = { minCents: 100, maxCents: 50_000 } as const;

/**
 * A Dodo webhook is a small JSON envelope. The ceiling is generous (256 KiB)
 * and exists so an unauthenticated caller cannot stream a huge body into the
 * Worker before the signature check rejects it.
 */
export const WEBHOOK_MAX_BYTES = 256 * 1024;

/** Ten checkouts an hour is generous for a person and stingy for a script. */
const CHECKOUT_PER_HOUR = 10;
const CHECKOUT_PER_ADDRESS_PER_HOUR = 30;

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

/**
 * Checkout creation is authenticated, but an account can still loop it to burn
 * provider quota or create sessions it never pays for. Both ceilings are
 * counted: the account survives an IP change, the address survives account
 * churn.
 */
async function underCheckoutLimit(c: Context<AppEnv>, accountId: string): Promise<boolean> {
  if (!(await underHourlyLimit(c, 'billing:checkout', CHECKOUT_PER_HOUR, `acct:${accountId}`))) {
    return false;
  }
  return underHourlyLimit(c, 'billing:checkout:ip', CHECKOUT_PER_ADDRESS_PER_HOUR);
}

function checkoutLimited(c: Context<AppEnv>) {
  return fail(c, 429, 'rate_limited', 'Too many checkout attempts. Try again in an hour.');
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
  if (!(await underCheckoutLimit(c, account.id))) return checkoutLimited(c);

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
  if (!(await underCheckoutLimit(c, account.id))) return checkoutLimited(c);

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
  if (!(await underCheckoutLimit(c, account.id))) return checkoutLimited(c);

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

  // A signed-in donor gets the donation attached to the account so it can appear
  // in their dashboard history. A signed-out donor stays anonymous, exactly as
  // before: donating never requires an account.
  const token = getCookie(c, SESSION_COOKIE) ?? '';
  const donor = token
    ? await new D1AuthStore(c.env.DB).resolveSession(token).catch(() => undefined)
    : undefined;

  try {
    const checkout = await createCheckout(config, {
      productId: product,
      email,
      returnUrl: `${base}/sponsor?status=thanks#donate`,
      cancelUrl: `${base}/sponsor?status=cancelled#donate`,
      metadata: { kind: 'donation', ...(donor ? { account_id: donor.id } : {}) },
      amountCents: amount,
    });
    return c.json({ url: checkout.url });
  } catch (error) {
    console.error('dodo donation checkout failed', error);
    return fail(c, 502, 'billing_error', 'The payment provider did not answer. Try again.');
  }
});

/* --------------------------------------------------------------- portal */

/**
 * A hosted Dodo portal session for the signed-in customer. The Worker returns a
 * short-lived URL and keeps nothing: card updates, invoices and cancellation
 * all happen on Dodo's origin.
 */
billingRoutes.post('/api/billing/portal', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;
  const denied = requireCsrf(c);
  if (denied) return denied;

  const config = dodoConfig(c.env);
  if (!config) return billingDown(c, 'billing portal');

  // One portal session is cheap; a loop is not. Ten an hour is generous for a
  // person changing a card and stingy for a script. The account key survives an
  // IP change; the address key survives account churn.
  if (!(await underHourlyLimit(c, 'billing:portal', 10, `acct:${account.id}`))) {
    return fail(c, 429, 'rate_limited', 'Too many portal attempts. Try again in an hour.');
  }
  if (!(await underHourlyLimit(c, 'billing:portal:ip', 30))) {
    return fail(c, 429, 'rate_limited', 'Too many portal attempts. Try again in an hour.');
  }

  const row = await c.env.DB.prepare('SELECT dodo_customer_id FROM accounts WHERE id = ?')
    .bind(account.id)
    .first<{ dodo_customer_id: string | null }>();
  if (!row?.dodo_customer_id) {
    return fail(c, 409, 'no_customer', 'No billing profile yet. Make a purchase first.');
  }

  try {
    const url = await createCustomerPortalSession(
      config,
      row.dodo_customer_id,
      `${webOrigin(c.env, c.req.url)}/account`,
    );
    return c.json({ url });
  } catch (error) {
    console.error('dodo portal failed', error);
    return fail(c, 502, 'billing_error', 'The billing portal did not answer. Try again.');
  }
});

/* -------------------------------------------------------------- webhook */

billingRoutes.post('/api/billing/webhook', async (c) => {
  const config = dodoConfig(c.env);
  if (!config?.webhookSecret) return billingDown(c, 'webhook');

  // Reject an obviously unsigned request before reading a body at all.
  const webhookId = c.req.header('webhook-id') ?? undefined;
  const webhookTimestamp = c.req.header('webhook-timestamp') ?? undefined;
  const webhookSignature = c.req.header('webhook-signature') ?? undefined;
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return fail(c, 400, 'invalid_signature', 'Webhook signature did not verify.');
  }

  // The exact bytes Dodo signed; parsing first and re-serialising would change
  // them, and a single differing byte is a failed signature. The read is
  // bounded so an unsigned caller cannot stream a huge body into the Worker.
  const raw = await readTextLimited(c.req.raw, WEBHOOK_MAX_BYTES);
  if (raw === undefined) {
    return fail(c, 413, 'payload_too_large', 'Webhook body is too large.');
  }
  let payload: Record<string, unknown>;
  try {
    payload = await verifyWebhook(config.webhookSecret, raw, {
      id: webhookId,
      timestamp: webhookTimestamp,
      signature: webhookSignature,
    });
  } catch (error) {
    console.warn('webhook rejected', error);
    return fail(c, 400, 'invalid_signature', 'Webhook signature did not verify.');
  }

  const event = webhookEvent(payload);
  if (!event.id || !event.type) return c.json({ received: true, ignored: 'malformed' });

  const refundOrDispute = event.type.startsWith('refund.') || event.type.startsWith('dispute.');

  // Defence in depth: the signature proves Dodo sent it, and the product id
  // proves the thing paid for is the thing the metadata names. A mismatch is a
  // deployment/config fault, not a customer error, so answer 500 and let the
  // provider retry; the event is not claimed and can still grant once the
  // product ids are corrected.
  if (!refundOrDispute) {
    const mismatch = productMismatch(config, event.data);
    if (mismatch) {
      console.error('webhook product mismatch', event.type, mismatch);
      return fail(c, 500, 'product_mismatch', 'The paid product does not match the event.');
    }
  }

  const billing = new D1BillingStore(c.env.DB);
  const claimed = await billing.claimEvent(event.id, event.type);
  if (!claimed) return c.json({ received: true, duplicate: true });

  try {
    if (refundOrDispute) {
      await applyRefundEvent(c.env.DB, config, event.type, event.data);
    } else {
      await applyBillingEvent(c.env.DB, event.type, event.data);
    }
  } catch (error) {
    // Release the claim so the provider's retry can try again; a 500 asks for it.
    await billing.releaseEvent(event.id);
    console.error('webhook handler failed', event.type, error);
    return fail(c, 500, 'webhook_failed', 'Could not apply this event.');
  }

  return c.json({ received: true });
});

