/**
 * Dodo Payments, the smallest client this deployment needs.
 *
 * Dodo is the merchant of record: it collects the money, handles tax and sends
 * the receipt. This Worker creates a checkout session and verifies webhooks; it
 * never sees a card, a bank account or a tax id.
 *
 * The API is plain `fetch` rather than the Node SDK, because this code runs on
 * Workers and the SDK brings a Node surface the runtime would only have to
 * shim. Two endpoints are used:
 *
 *   POST /checkouts        create a hosted checkout
 *   (webhooks arrive)      verified with the Standard Webhooks signature
 *
 * Everything is optional. With no `DODO_API_KEY`, `config()` returns undefined
 * and every billing route answers 503 with a stable code, which is how a
 * self-hosted copy stays honest instead of rendering a broken button.
 */

import type { Env } from '../env.js';

export type BillingProduct =
  | 'pro-monthly'
  | 'pro-yearly'
  | 'sponsor-featured'
  | 'sponsor-standard'
  | 'credits'
  | 'pass-30d'
  | 'donate';

export interface DodoConfig {
  apiKey: string;
  /** `https://test.dodopayments.com` or `https://live.dodopayments.com`. */
  baseUrl: string;
  environment: 'test' | 'live';
  webhookSecret: string | null;
  products: Partial<Record<BillingProduct, string>>;
}

/** Missing or non-`live` means test mode: a typo must not charge a real card. */
export function dodoConfig(env: Env): DodoConfig | undefined {
  const apiKey = env.DODO_API_KEY?.trim();
  if (!apiKey) return undefined;

  const environment = env.DODO_ENVIRONMENT?.trim() === 'live' ? 'live' : 'test';
  return {
    apiKey,
    environment,
    baseUrl: environment === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com',
    webhookSecret: env.DODO_WEBHOOK_SECRET?.trim() || null,
    products: {
      'pro-monthly': env.DODO_PRODUCT_PRO_MONTHLY?.trim() || undefined,
      'pro-yearly': env.DODO_PRODUCT_PRO_YEARLY?.trim() || undefined,
      'sponsor-featured': env.DODO_PRODUCT_SPONSOR_FEATURED?.trim() || undefined,
      'sponsor-standard': env.DODO_PRODUCT_SPONSOR_STANDARD?.trim() || undefined,
      credits: env.DODO_PRODUCT_CREDITS?.trim() || undefined,
      'pass-30d': env.DODO_PRODUCT_PASS_30D?.trim() || undefined,
      donate: env.DODO_PRODUCT_DONATE?.trim() || undefined,
    },
  };
}

export function productId(config: DodoConfig, product: BillingProduct): string | undefined {
  return config.products[product];
}

export interface CheckoutInput {
  productId: string;
  email: string;
  name?: string;
  returnUrl: string;
  cancelUrl?: string;
  metadata: Record<string, string>;
  /** Pay-what-you-want products only; ignored otherwise. Cents. */
  amountCents?: number;
}

export interface CheckoutResult {
  url: string;
  sessionId: string | null;
}

/** Throws with a short, loggable message; callers translate it to a 502. */
export async function createCheckout(
  config: DodoConfig,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const body = {
    product_cart: [
      {
        product_id: input.productId,
        quantity: 1,
        ...(input.amountCents !== undefined ? { amount: input.amountCents } : {}),
      },
    ],
    customer: { email: input.email, ...(input.name ? { name: input.name } : {}) },
    return_url: input.returnUrl,
    ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
    metadata: input.metadata,
  };

  const response = await fetch(`${config.baseUrl}/checkouts`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    // A hung provider must not hold the Worker until the platform timeout.
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`Dodo checkout failed: ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as {
    checkout_url?: unknown;
    session_id?: unknown;
  };
  if (typeof payload.checkout_url !== 'string' || !payload.checkout_url.startsWith('https://')) {
    throw new Error('Dodo checkout returned no usable checkout_url');
  }

  return {
    url: payload.checkout_url,
    sessionId: typeof payload.session_id === 'string' ? payload.session_id : null,
  };
}

/* ------------------------------------------------------------ dashboard */

export interface PaymentSummary {
  id: string;
  createdAt: string;
  amount: number;
  currency: string;
  status: string;
  refundStatus: string | null;
  /** `metadata.kind` from the checkout: pro, pass, credits, donation. */
  kind: string | null;
  chargeType: string | null;
  invoiceUrl: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Only an absolute `https:` link is ever put in an anchor. The URL comes from
 * the provider, not a visitor, but a dashboard link is still an untrusted
 * string at this boundary: `javascript:` would turn a receipt into script.
 */
export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The customer's payments, read from Dodo rather than a second local ledger.
 *
 * Dodo is the source of truth for amount, tax, status and refunds, and it
 * already keeps every renewal. The dashboard only needs a page, so one
 * subrequest is enough; a failure is reported to the caller, never thrown at
 * the whole account response.
 */
export async function listCustomerPayments(
  config: DodoConfig,
  customerId: string,
  limit = 10,
): Promise<PaymentSummary[]> {
  const url = `${config.baseUrl}/payments?customer_id=${encodeURIComponent(customerId)}&page_size=${limit}`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Dodo payments failed: ${response.status}`);
  }

  const payload = (await response.json()) as
    | { items?: unknown[]; data?: unknown[] }
    | unknown[];
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.data)
        ? payload.data
        : [];
  const out: PaymentSummary[] = [];

  for (const row of rows.slice(0, limit)) {
    const payment = asRecord(row);
    if (!payment) continue;
    const id = textOf(payment.payment_id);
    if (!id) continue;
    const metadata = asRecord(payment.metadata);
    out.push({
      id,
      createdAt: textOf(payment.created_at) ?? '',
      amount: typeof payment.total_amount === 'number' ? payment.total_amount : 0,
      currency: textOf(payment.currency) ?? 'USD',
      status: textOf(payment.status) ?? 'unknown',
      refundStatus: textOf(payment.refund_status),
      kind: metadata ? textOf(metadata.kind) : null,
      chargeType: textOf(payment.charge_type),
      invoiceUrl: safeHttpsUrl(payment.invoice_url),
    });
  }

  return out;
}

/* ---------------------------------------------- refund and dispute lookups */

export interface DodoPaymentRecord {
  paymentId: string;
  customerId: string | null;
  metadata: Record<string, unknown>;
  subscriptionId: string | null;
  productId: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  refundStatus: string | null;
  createdAt: string | null;
}

function firstProductId(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    const item = asRecord(entry);
    const id = item ? textOf(item.product_id) : null;
    if (id) return id;
  }
  return null;
}

function firstSubscriptionId(payment: Record<string, unknown>): string | null {
  const direct = textOf(payment.subscription_id);
  if (direct) return direct;
  if (!Array.isArray(payment.subscription_ids)) return null;
  for (const value of payment.subscription_ids) {
    const id = textOf(value);
    if (id) return id;
  }
  return null;
}

/**
 * Read one payment from Dodo. A refund or dispute event names only a payment
 * id, so this is how the Worker recovers the metadata and subscription that
 * decide which entitlement to take back. The caller lets a failure become a
 * 500, which asks Dodo to retry the webhook.
 */
export async function retrievePayment(
  config: DodoConfig,
  paymentId: string,
): Promise<DodoPaymentRecord> {
  const response = await fetch(`${config.baseUrl}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Dodo payment lookup failed: ${response.status}`);
  }

  const payment = asRecord(await response.json());
  if (!payment) throw new Error('Dodo payment lookup returned no object');
  const id = textOf(payment.payment_id) ?? paymentId;
  const customer = asRecord(payment.customer);

  return {
    paymentId: id,
    customerId: customer ? textOf(customer.customer_id) : null,
    metadata: asRecord(payment.metadata) ?? {},
    subscriptionId: firstSubscriptionId(payment),
    productId: firstProductId(payment.product_cart),
    amount: typeof payment.total_amount === 'number' ? payment.total_amount : null,
    currency: textOf(payment.currency),
    status: textOf(payment.status),
    refundStatus: textOf(payment.refund_status),
    createdAt: textOf(payment.created_at),
  };
}

export interface DodoDisputeRecord {
  disputeId: string;
  paymentId: string;
  customerId: string | null;
}

/**
 * Dispute webhooks carry no customer field, only a dispute id. One read maps it
 * to the payment whose entitlement has to be held while the dispute is open.
 */
export async function retrieveDispute(
  config: DodoConfig,
  disputeId: string,
): Promise<DodoDisputeRecord> {
  const response = await fetch(`${config.baseUrl}/disputes/${encodeURIComponent(disputeId)}`, {
    headers: { authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Dodo dispute lookup failed: ${response.status}`);
  }

  const dispute = asRecord(await response.json());
  if (!dispute) throw new Error('Dodo dispute lookup returned no object');
  const paymentId = textOf(dispute.payment_id);
  if (!paymentId) throw new Error('Dodo dispute lookup returned no payment_id');
  const customer = asRecord(dispute.customer);

  return {
    disputeId: textOf(dispute.dispute_id) ?? disputeId,
    paymentId,
    customerId: customer ? textOf(customer.customer_id) : null,
  };
}

/**
 * A short-lived hosted portal session. Returns the URL only; the Worker never
 * sees a card and does not keep the session.
 */
export async function createCustomerPortalSession(
  config: DodoConfig,
  customerId: string,
  returnUrl: string,
): Promise<string> {
  const response = await fetch(
    `${config.baseUrl}/customers/${encodeURIComponent(customerId)}/customer-portal/session`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ return_url: returnUrl }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`Dodo portal failed: ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as { link?: unknown };
  if (typeof payload.link !== 'string' || !payload.link.startsWith('https://')) {
    throw new Error('Dodo portal returned no usable link');
  }
  return payload.link;
}

/**
 * Stop future charges before an account is deleted.
 *
 * `cancel_at_next_billing_date` keeps the provider from charging again while
 * leaving any already-paid term intact. The caller deletes the account straight
 * after, so the remaining term is intentionally forfeited by the customer.
 */
export async function cancelSubscription(
  config: DodoConfig,
  subscriptionId: string,
): Promise<void> {
  const response = await fetch(
    `${config.baseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ cancel_at_next_billing_date: true }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    // A subscription Dodo no longer knows about cannot charge again. Treat it as
    // already cancelled so an expired term never blocks an erasure request.
    if (response.status === 404) return;
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`Dodo cancel failed: ${response.status} ${detail}`);
  }
}

/* --------------------------------------------------------------- webhooks */

export interface VerifiedWebhook {
  id: string;
  type: string;
  /** `data` from the Standard Webhooks envelope. */
  data: Record<string, unknown>;
}

const encoder = new TextEncoder();
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A fresh ArrayBuffer-backed view; WebCrypto's BufferSource is strict about it. */
function bytesOf(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(length));
}

/** `whsec_…` is base64; a raw secret is accepted as a UTF-8 fallback. */
function secretBytes(secret: string): Uint8Array<ArrayBuffer> {
  const value = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  if (BASE64.test(value)) {
    try {
      const binary = atob(value);
      const bytes = bytesOf(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch {
      // Fall through to the raw form.
    }
  }
  const encoded = encoder.encode(value);
  const bytes = bytesOf(encoded.length);
  bytes.set(encoded);
  return bytes;
}

function signatureBytes(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (!BASE64.test(value)) return undefined;
  try {
    const binary = atob(value);
    const bytes = bytesOf(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

function utf8(value: string): Uint8Array<ArrayBuffer> {
  const encoded = encoder.encode(value);
  const bytes = bytesOf(encoded.length);
  bytes.set(encoded);
  return bytes;
}

/**
 * Standard Webhooks: `HMAC-SHA256(secret, id.timestamp.body)`, base64, sent as
 * one or more `v1,<sig>` tokens. The header is checked against every token,
 * and the timestamp must be recent so a captured request cannot be replayed
 * days later. `crypto.subtle.verify` does the constant-time comparison.
 */
export async function verifyWebhook(
  secret: string,
  rawBody: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  now = Date.now(),
): Promise<Record<string, unknown>> {
  const id = headers.id?.trim();
  const timestamp = headers.timestamp?.trim();
  const signature = headers.signature?.trim();
  if (!id || !timestamp || !signature) throw new Error('missing webhook headers');

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > 5 * 60) {
    throw new Error('webhook timestamp outside the accepted window');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const message = utf8(`${id}.${timestamp}.${rawBody}`);

  const tokens = signature
    .split(/\s+/)
    .map((token) => {
      const separator = token.includes(',') ? ',' : '=';
      const [version, value = ''] = token.split(separator, 2);
      return { version, value };
    })
    .filter((token) => token.version === 'v1');

  for (const token of tokens) {
    const bytes = signatureBytes(token.value);
    if (!bytes) continue;
    if (await crypto.subtle.verify('HMAC', key, bytes, message)) {
      const parsed = JSON.parse(rawBody) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('webhook payload is not an object');
      }
      return { ...(parsed as Record<string, unknown>), __webhookId: id };
    }
  }

  throw new Error('webhook signature did not match');
}

/** Reads the event shape defensively: an unknown type is acknowledged, not retried. */
export function webhookEvent(payload: Record<string, unknown>): VerifiedWebhook {
  const id = typeof payload.__webhookId === 'string' ? payload.__webhookId : '';
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : {};
  return { id, type, data };
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Dodo sends ISO dates; a bad value must not become a 1970 expiry. */
export function asTime(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}
