/**
 * The paid rails, end to end at the HTTP boundary: checkout creation against a
 * stubbed Dodo, then signed webhooks applied to the real schema.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { D1AuthStore } from '../src/db/auth-store.js';
import { D1SponsorStore } from '../src/db/sponsor-store.js';
import { downgradeLapsed } from '../src/billing/entitlements.js';
import { TestD1 } from './support/db.js';
import {
  ORIGIN,
  PRODUCTS,
  executionContext,
  seedAccount,
  signedWebhook,
  testEnv,
  type SignedIn,
} from './support/env.js';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

type Json = Record<string, unknown>;
let db: TestD1;
let env: ReturnType<typeof testEnv>;
let buyer: SignedIn;

beforeEach(async () => {
  db = new TestD1();
  env = testEnv(db);
  buyer = await seedAccount(db);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function post(
  path: string,
  body?: Json,
  headers: Record<string, string> = {},
  targetEnv = env,
): Promise<Response> {
  return app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    targetEnv as never,
    executionContext as never,
  );
}

async function postWebhook(payload: unknown, id = 'msg_1', targetEnv = env) {
  return app.fetch(
    (await signedWebhook(payload, { id })) as unknown as Request,
    targetEnv as never,
    executionContext as never,
  );
}

/** Records what `createCheckout` sends and answers like Dodo does. */
function stubCheckout() {
  const calls: { url: string; body: Json }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init: { body?: string } = {}) => {
      calls.push({ url: String(input), body: JSON.parse(String(init.body)) as Json });
      return new Response(
        JSON.stringify({
          checkout_url: 'https://checkout.dodopayments.test/cs_live_fixture',
          session_id: 'cs_live_fixture',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
  return calls;
}

function accountRow() {
  return db.get<{
    plan: string;
    plan_expires_at: number | null;
    credit_messages: number;
    dodo_subscription_id: string | null;
  }>('SELECT plan, plan_expires_at, credit_messages, dodo_subscription_id FROM accounts WHERE id = ?', buyer.accountId);
}

function effectivePlan(): Promise<string | undefined> {
  return new D1AuthStore(db as never)
    .resolveSession(buyer.token)
    .then((account) => account?.plan);
}

describe('an unconfigured deployment', () => {
  it('answers 503 for every paid rail instead of showing a broken button', async () => {
    const disabled = testEnv(db, { DODO_API_KEY: undefined });
    for (const path of ['/api/billing/pro', '/api/billing/credits', '/api/billing/pass']) {
      const response = await post(path, { interval: 'month' }, buyer.headers, disabled);
      expect(response.status, path).toBe(503);
      expect(((await response.json()) as Json).code).toBe('billing_disabled');
    }
  });

  it('answers 503 for the webhook when no secret is set', async () => {
    const disabled = testEnv(db, { DODO_WEBHOOK_SECRET: undefined });
    const response = await postWebhook({ type: 'payment.succeeded', data: {} }, 'msg_x', disabled);
    expect(response.status).toBe(503);
  });
});

describe('Pro checkout', () => {
  it('requires an account and a CSRF token', async () => {
    expect((await post('/api/billing/pro', { interval: 'month' })).status).toBe(401);
    const noCsrf = await post('/api/billing/pro', { interval: 'month' }, { cookie: buyer.cookie });
    expect(noCsrf.status).toBe(403);
    expect(((await noCsrf.json()) as Json).code).toBe('csrf');
  });

  it('creates a monthly checkout that names the account and the interval', async () => {
    const calls = stubCheckout();
    const response = await post('/api/billing/pro', { interval: 'month' }, buyer.headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: 'https://checkout.dodopayments.test/cs_live_fixture',
      interval: 'month',
      priceCents: 600,
    });

    const sent = calls[0]!.body as unknown as {
      product_cart: { product_id: string; quantity: number }[];
      customer: { email: string };
      metadata: Json;
      return_url: string;
    };
    expect(sent.product_cart).toEqual([{ product_id: PRODUCTS['pro-monthly'], quantity: 1 }]);
    expect(sent.customer.email).toBe('buyer@example.test');
    expect(sent.metadata).toEqual({
      kind: 'pro',
      account_id: buyer.accountId,
      interval: 'month',
    });
    expect(sent.return_url).toBe(`${ORIGIN}/account?status=pro`);
  });

  it('uses the yearly product and price for a yearly checkout', async () => {
    const calls = stubCheckout();
    const response = await post('/api/billing/pro', { interval: 'year' }, buyer.headers);
    expect(((await response.json()) as Json).priceCents).toBe(4_800);
    const sent = calls[0]!.body as unknown as { product_cart: { product_id: string }[]; metadata: Json };
    expect(sent.product_cart[0]!.product_id).toBe(PRODUCTS['pro-yearly']);
    expect(sent.metadata.interval).toBe('year');
  });

  it('defaults an unknown interval to monthly rather than failing open', async () => {
    const calls = stubCheckout();
    const response = await post('/api/billing/pro', { interval: 'decade' }, buyer.headers);
    expect(((await response.json()) as Json).interval).toBe('month');
    expect((calls[0]!.body as unknown as { metadata: Json }).metadata.interval).toBe('month');
  });

  it('says so when only that one product is missing', async () => {
    stubCheckout();
    const partial = testEnv(db, { DODO_PRODUCT_PRO_MONTHLY: '' });
    const response = await post('/api/billing/pro', { interval: 'month' }, buyer.headers, partial);
    expect(response.status).toBe(503);
    expect(((await response.json()) as Json).code).toBe('billing_disabled');
  });

  it('turns a provider failure into a 502, not a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const response = await post('/api/billing/pro', { interval: 'month' }, buyer.headers);
    expect(response.status).toBe(502);
    expect(((await response.json()) as Json).code).toBe('billing_error');
  });
});

describe('Pro subscription webhooks', () => {
  const subscriptionEvent = (type: string, nextBilling: number, id = 'msg_active') => ({
    type,
    data: {
      subscription_id: 'sub_fixture',
      next_billing_date: iso(nextBilling),
      metadata: { kind: 'pro', account_id: buyer.accountId, interval: 'month' },
    },
    id,
  });

  it('activation stores the term and the subscription id, and the account is Pro', async () => {
    const endsAt = Date.now() + 31 * DAY;
    const response = await postWebhook(subscriptionEvent('subscription.active', endsAt));
    expect(response.status).toBe(200);
    expect(accountRow()).toMatchObject({
      plan: 'pro',
      plan_expires_at: endsAt,
      dodo_subscription_id: 'sub_fixture',
    });
    expect(await effectivePlan()).toBe('pro');
  });

  it('a renewal moves the date forward', async () => {
    const first = Date.now() + 31 * DAY;
    await postWebhook(subscriptionEvent('subscription.active', first), 'msg_a');
    const second = first + 31 * DAY;
    await postWebhook(subscriptionEvent('subscription.renewed', second), 'msg_b');
    expect(accountRow()!.plan_expires_at).toBe(second);
    expect(await effectivePlan()).toBe('pro');
  });

  it('a cancellation keeps the paid term and the account stays Pro', async () => {
    const endsAt = Date.now() + 10 * DAY;
    await postWebhook(subscriptionEvent('subscription.active', endsAt), 'msg_a');
    const response = await postWebhook(subscriptionEvent('subscription.cancelled', endsAt), 'msg_b');
    expect(response.status).toBe(200);
    expect(accountRow()!.plan_expires_at).toBe(endsAt);
    expect(await effectivePlan()).toBe('pro');
  });

  it('expiry ends access immediately', async () => {
    const endsAt = Date.now() + 10 * DAY;
    await postWebhook(subscriptionEvent('subscription.active', endsAt), 'msg_a');
    await postWebhook(subscriptionEvent('subscription.expired', endsAt), 'msg_b');
    expect(accountRow()!.plan).toBe('free');
    expect(await effectivePlan()).toBe('free');
  });

  it('a lapsed term is free before the cron runs, and the cron then flips the column', async () => {
    await postWebhook(subscriptionEvent('subscription.active', Date.now() - DAY), 'msg_a');
    expect(await effectivePlan()).toBe('free');
    expect(await downgradeLapsed(db as never)).toBe(1);
    expect(accountRow()!.plan).toBe('free');
  });

  it('a subscription with no account id is acknowledged but grants nothing', async () => {
    const response = await postWebhook({
      type: 'subscription.active',
      data: {
        subscription_id: 'sub_orphan',
        next_billing_date: iso(Date.now() + DAY),
        metadata: { kind: 'pro' },
      },
    });
    expect(response.status).toBe(200);
    expect(accountRow()!.plan).toBe('free');
  });

  it('a first payment that lands alone still activates Pro', async () => {
    const endsAt = Date.now() + 31 * DAY;
    await postWebhook({
      type: 'payment.succeeded',
      data: {
        subscription_id: 'sub_fixture',
        next_billing_date: iso(endsAt),
        metadata: { kind: 'pro', account_id: buyer.accountId, interval: 'month' },
      },
    });
    expect(accountRow()).toMatchObject({
      plan: 'pro',
      plan_expires_at: endsAt,
      dodo_subscription_id: 'sub_fixture',
    });
  });

  it('a subscription already owned by another account fails closed and releases the claim', async () => {
    await postWebhook(subscriptionEvent('subscription.active', Date.now() + DAY), 'msg_a');

    db.sqlite
      .prepare(
        `INSERT INTO accounts (id, google_sub, email, email_verified, created_at, last_login_at)
         VALUES ('acct_other', 'google_other', 'other@example.test', 1, ?, ?)`,
      )
      .run(Date.now(), Date.now());

    const clash = await postWebhook(
      {
        type: 'subscription.active',
        data: {
          subscription_id: 'sub_fixture',
          next_billing_date: iso(Date.now() + DAY),
          metadata: { kind: 'pro', account_id: 'acct_other', interval: 'month' },
        },
      },
      'msg_clash',
    );

    expect(clash.status).toBe(500);
    // The claim is gone, so the provider's retry can be applied once the
    // operator fixes the underlying condition.
    expect(db.get(`SELECT COUNT(*) AS n FROM billing_events WHERE id = 'msg_clash'`)?.n).toBe(0);
    expect(accountRow()!.dodo_subscription_id).toBe('sub_fixture');
  });
});

describe('one-time rails', () => {
  it('a credit pack raises the balance once, however often it is delivered', async () => {
    const event = {
      type: 'payment.succeeded',
      data: { metadata: { kind: 'credits', account_id: buyer.accountId, credits: '1000' } },
    };

    expect((await postWebhook(event, 'msg_credits')).status).toBe(200);
    expect(accountRow()!.credit_messages).toBe(1_000);

    const replay = await postWebhook(event, 'msg_credits');
    expect(((await replay.json()) as Json).duplicate).toBe(true);
    expect(accountRow()!.credit_messages).toBe(1_000);
  });

  it('caps a hostile credit value at the documented maximum', async () => {
    await postWebhook({
      type: 'payment.succeeded',
      data: { metadata: { kind: 'credits', account_id: buyer.accountId, credits: '999999999' } },
    });
    expect(accountRow()!.credit_messages).toBe(50_000);
  });

  it('a 30-day pass extends a longer subscription without shortening it', async () => {
    const subscriptionEnd = Date.now() + 90 * DAY;
    await postWebhook(
      {
        type: 'subscription.active',
        data: {
          subscription_id: 'sub_fixture',
          next_billing_date: iso(subscriptionEnd),
          metadata: { kind: 'pro', account_id: buyer.accountId, interval: 'month' },
        },
      },
      'msg_sub_for_pass',
    );
    await postWebhook(
      {
        type: 'payment.succeeded',
        data: { metadata: { kind: 'pass', account_id: buyer.accountId, days: '30' } },
      },
      'msg_pass_after_sub',
    );
    expect(accountRow()!.plan_expires_at).toBe(subscriptionEnd + 30 * DAY);
  });

  it('a pass on a free account is Pro for roughly thirty days', async () => {
    const before = Date.now();
    await postWebhook({
      type: 'payment.succeeded',
      data: { metadata: { kind: 'pass', account_id: buyer.accountId, days: '30' } },
    });
    const expires = accountRow()!.plan_expires_at!;
    expect(expires).toBeGreaterThanOrEqual(before + 30 * DAY);
    expect(expires).toBeLessThan(before + 31 * DAY);
    expect(await effectivePlan()).toBe('pro');
  });

  it('a donation grants nothing at all', async () => {
    const response = await postWebhook({
      type: 'payment.succeeded',
      data: {
        subscription_id: null,
        metadata: { kind: 'donation' },
      },
    });
    expect(response.status).toBe(200);
    expect(accountRow()).toMatchObject({ plan: 'free', credit_messages: 0 });
  });
});

describe('sponsor subscriptions share the webhook', () => {
  it('activation, cancellation and renewal run against the sponsor row', async () => {
    const sponsors = new D1SponsorStore(db as never);
    const draft = await sponsors.createDraft({
      slot: 'featured',
      name: 'Acme PDF',
      url: 'https://acme.example.test',
      blurb: 'The finest fictional PDFs.',
      email: 'sponsor@acme.example.test',
      brandColor: '#2f9e6a',
      logo: null,
    });

    const endsAt = Date.now() + 31 * DAY;
    await postWebhook(
      {
        type: 'subscription.active',
        data: {
          subscription_id: 'sub_sponsor',
          next_billing_date: iso(endsAt),
          metadata: { kind: 'sponsor', sponsor_id: draft.id, slot: 'featured' },
        },
      },
      'msg_s1',
    );
    expect(await sponsors.byId(draft.id)).toMatchObject({ status: 'active', endsAt });

    await postWebhook(
      { type: 'subscription.cancelled', data: { subscription_id: 'sub_sponsor' } },
      'msg_s2',
    );
    expect((await sponsors.byId(draft.id))!.status).toBe('cancelled');

    const renewed = endsAt + 31 * DAY;
    await postWebhook(
      {
        type: 'subscription.renewed',
        data: { subscription_id: 'sub_sponsor', next_billing_date: iso(renewed) },
      },
      'msg_s3',
    );
    expect((await sponsors.byId(draft.id))!.endsAt).toBe(renewed);
  });
});

describe('webhook authenticity', () => {
  it('refuses an unsigned request', async () => {
    const response = await post('/api/billing/webhook', { type: 'payment.succeeded', data: {} }, {
      cookie: buyer.cookie,
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as Json).code).toBe('invalid_signature');
  });

  it('refuses a body signed by a different secret', async () => {
    const response = await app.fetch(
      (await signedWebhook(
        { type: 'payment.succeeded', data: { metadata: { kind: 'credits', account_id: buyer.accountId, credits: '1000' } } },
        { id: 'msg_forged', secret: 'whsec_' + Buffer.from('attacker').toString('base64') },
      )) as unknown as Request,
      env as never,
      executionContext as never,
    );
    expect(response.status).toBe(400);
    expect(accountRow()!.credit_messages).toBe(0);
  });
});
