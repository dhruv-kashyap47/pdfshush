/** Shared fixtures: a binding-shaped env, a signed-in account, signed webhooks. */

import { Buffer } from 'node:buffer';
import { TestD1 } from './db.js';
import { D1AuthStore } from '../../src/db/auth-store.js';
import type { Env, ExecutionContextLike } from '../../src/env.js';

const encoder = new TextEncoder();

/** 32 deterministic bytes, so a failure is reproducible. */
const SECRET_BYTES = new Uint8Array(32).map((_, index) => (index * 7 + 3) % 256);

export const WEBHOOK_SECRET = `whsec_${Buffer.from(SECRET_BYTES).toString('base64')}`;

export const PRODUCTS = {
  'pro-monthly': 'prod_pro_monthly',
  'pro-yearly': 'prod_pro_yearly',
  credits: 'prod_credits',
  'pass-30d': 'prod_pass',
  donate: 'prod_donate',
  'sponsor-featured': 'prod_sponsor_featured',
  'sponsor-standard': 'prod_sponsor_standard',
} as const;

export const ORIGIN = 'https://pdfshush.test';

export function testEnv(db: TestD1, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    ASSETS: { fetch: async () => new Response('asset') },
    WEB_ORIGIN: ORIGIN,
    SESSION_COOKIE_SECURE: 'false',
    DODO_ENVIRONMENT: 'test',
    DODO_API_KEY: 'dodo_test_fixture',
    DODO_WEBHOOK_SECRET: WEBHOOK_SECRET,
    DODO_PRODUCT_PRO_MONTHLY: PRODUCTS['pro-monthly'],
    DODO_PRODUCT_PRO_YEARLY: PRODUCTS['pro-yearly'],
    DODO_PRODUCT_CREDITS: PRODUCTS.credits,
    DODO_PRODUCT_PASS_30D: PRODUCTS['pass-30d'],
    DODO_PRODUCT_DONATE: PRODUCTS.donate,
    DODO_PRODUCT_SPONSOR_FEATURED: PRODUCTS['sponsor-featured'],
    DODO_PRODUCT_SPONSOR_STANDARD: PRODUCTS['sponsor-standard'],
    ...overrides,
  } as Env;
}

export const executionContext: ExecutionContextLike = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
};

export interface SignedIn {
  accountId: string;
  token: string;
  csrf: string;
  cookie: string;
  headers: Record<string, string>;
}

/**
 * Inserts an account and a real session row. The cookie carries the raw token;
 * only its hash is stored, exactly as production does it.
 */
export async function seedAccount(
  db: TestD1,
  options: { email?: string | null; plan?: 'free' | 'pro'; planExpiresAt?: number | null } = {},
): Promise<SignedIn> {
  const accountId = 'acct_fixture';
  const now = Date.now();
  db.sqlite
    .prepare(
      `INSERT INTO accounts
         (id, google_sub, email, email_verified, name, picture, created_at, last_login_at,
          plan, plan_expires_at)
       VALUES (?, ?, ?, 1, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(
      accountId,
      'google_sub_fixture',
      options.email === undefined ? 'buyer@example.test' : options.email,
      'Buyer',
      now,
      now,
      options.plan ?? 'free',
      options.planExpiresAt ?? null,
    );

  const session = await new D1AuthStore(db as never).createSession(accountId, 60 * 60 * 1000);
  const csrf = 'csrf_fixture_token';
  return {
    accountId,
    token: session.token,
    csrf,
    cookie: `pdfshush_session=${session.token}; pdfshush_csrf=${csrf}`,
    headers: { cookie: `pdfshush_session=${session.token}; pdfshush_csrf=${csrf}`, 'x-csrf-token': csrf },
  };
}

/** Standard Webhooks: `HMAC-SHA256(secret, id.timestamp.body)`, base64. */
export async function signedWebhook(
  body: unknown,
  options: { id?: string; secret?: string; timestamp?: number; url?: string } = {},
): Promise<Request> {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const id = options.id ?? 'msg_fixture';
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const secret = options.secret ?? WEBHOOK_SECRET;
  const keyBytes = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice('whsec_'.length), 'base64')
    : encoder.encode(secret);

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${id}.${timestamp}.${raw}`),
  );

  return new Request(`${options.url ?? ORIGIN}/api/billing/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': `v1,${Buffer.from(signature).toString('base64')}`,
    },
    body: raw,
  });
}
