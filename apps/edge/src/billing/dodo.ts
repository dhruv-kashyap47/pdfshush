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
