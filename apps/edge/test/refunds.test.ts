/**
 * Refunds, disputes and the locks around them.
 *
 * The money is Dodo's; access is this Worker's. These tests prove a full refund
 * takes back exactly what one payment bought, a partial refund does not, a
 * dispute holds access while it is open, and a refund that arrives before its
 * payment cannot be followed by a grant.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { D1SponsorStore } from '../src/db/sponsor-store.js';
import { safeHttpsUrl } from '../src/billing/dodo.js';
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

async function postWebhook(payload: unknown, id = `msg_${Math.random()}`) {
  return app.fetch(
    (await signedWebhook(payload, { id })) as unknown as Request,
    env as never,
    executionContext as never,
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Answers the payment and dispute reads the refund applier may make. */
function stubDodoLookups(options: {
  payment?: unknown;
  dispute?: unknown;
  paymentStatus?: number;
  disputeStatus?: number;
} = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/disputes/')) {
        return json(options.dispute ?? {}, options.disputeStatus ?? 200);
      }
      return json(options.payment ?? {}, options.paymentStatus ?? 200);
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
    dodo_customer_id: string | null;
  }>(
    'SELECT plan, plan_expires_at, credit_messages, dodo_subscription_id, dodo_customer_id FROM accounts WHERE id = ?',
    buyer.accountId,
  );
}

function paymentEvent(
  paymentId: string,
  meta: Json,
  extra: Json = {},
): { type: string; data: Json } {
  return {
    type: 'payment.succeeded',
    data: {
      payment_id: paymentId,
      metadata: meta,
      customer: { customer_id: 'cus_fixture' },
      ...extra,
    },
  };
}

async function buyCredits(paymentId: string, credits = '1000') {
  const response = await postWebhook(
    paymentEvent(paymentId, { kind: 'credits', account_id: buyer.accountId, credits }, {
      product_cart: [{ product_id: PRODUCTS.credits, quantity: 1 }],
      total_amount: 500,
      currency: 'USD',
    }),
    `msg_${paymentId}`,
  );
  expect(response.status).toBe(200);
}

async function refund(paymentId: string, extra: Json = {}, id = `refund_${paymentId}`) {
  return postWebhook(
    {
      type: 'refund.succeeded',
      data: { payment_id: paymentId, refund_id: `ref_${paymentId}`, is_partial: false, ...extra },
    },
    id,
  );
}

describe('refunding one-time purchases', () => {
  it('takes back the credits that payment added and leaves another pack alone', async () => {
    await buyCredits('pay_pack_1');
    await buyCredits('pay_pack_2');
    expect(accountRow()!.credit_messages).toBe(2_000);

    const response = await refund('pay_pack_1');
    expect(response.status).toBe(200);
    expect(accountRow()!.credit_messages).toBe(1_000);

    // A second delivery of the same refund is a duplicate, not a second debit.
    const replay = await refund('pay_pack_1');
    expect(((await replay.json()) as Json).duplicate).toBe(true);
    expect(accountRow()!.credit_messages).toBe(1_000);
  });

  it('never takes a balance below zero when the credits were already spent', async () => {
    await buyCredits('pay_spent', '10');
    db.sqlite
      .prepare('UPDATE accounts SET credit_messages = 0 WHERE id = ?')
      .run(buyer.accountId);
    await refund('pay_spent');
    expect(accountRow()!.credit_messages).toBe(0);
  });

  it('a partial refund keeps access, because only part of the value returned', async () => {
    await buyCredits('pay_partial');
    stubDodoLookups({
      payment: {
        payment_id: 'pay_partial',
        refund_status: 'partial',
        metadata: { kind: 'credits', account_id: buyer.accountId, credits: '1000' },
      },
    });
    const response = await refund('pay_partial', { is_partial: true });
    expect(response.status).toBe(200);
    expect(accountRow()!.credit_messages).toBe(1_000);
  });

  it('a payment refunded in parts ends access once the provider says full', async () => {
    await buyCredits('pay_two_parts');
    stubDodoLookups({
      payment: {
        payment_id: 'pay_two_parts',
        refund_status: 'full',
        metadata: { kind: 'credits', account_id: buyer.accountId, credits: '1000' },
      },
    });
    const response = await refund('pay_two_parts', { is_partial: true });
    expect(response.status).toBe(200);
    expect(accountRow()!.credit_messages).toBe(0);
  });

  it('a failed refund keeps access', async () => {
    await buyCredits('pay_failed_refund');
    const response = await postWebhook(
      { type: 'refund.failed', data: { payment_id: 'pay_failed_refund', reason: 'declined' } },
      'msg_refund_failed',
    );
    expect(response.status).toBe(200);
    expect(accountRow()!.credit_messages).toBe(1_000);
  });

  it('a refund of a payment that predates the ledger still revokes', async () => {
    // The real $3 pass was bought before `billing_payments` existed. The refund
    // handler recovers the grant from the provider's payment record.
    const expires = Date.now() + 30 * DAY;
    db.sqlite
      .prepare('UPDATE accounts SET plan = ?, plan_expires_at = ? WHERE id = ?')
      .run('pro', expires, buyer.accountId);
    stubDodoLookups({
      payment: {
        payment_id: 'pay_legacy_pass',
        created_at: new Date(Date.now()).toISOString(),
        metadata: { kind: 'pass', account_id: buyer.accountId, days: '30' },
        customer: { customer_id: 'cus_fixture' },
        product_cart: [{ product_id: PRODUCTS['pass-30d'], quantity: 1 }],
      },
    });

    await refund('pay_legacy_pass');
    expect(accountRow()!.plan).toBe('free');
  });

  it('a historical pass refund does not cut a subscription it cannot unwind', async () => {
    const subscriptionEnd = Date.now() + 90 * DAY;
    db.sqlite
      .prepare(
        'UPDATE accounts SET plan = ?, plan_expires_at = ?, dodo_subscription_id = ? WHERE id = ?',
      )
      .run('pro', subscriptionEnd, 'sub_keep', buyer.accountId);
    stubDodoLookups({
      payment: {
        payment_id: 'pay_legacy_pass_sub',
        created_at: new Date(Date.now() - DAY).toISOString(),
        metadata: { kind: 'pass', account_id: buyer.accountId, days: '30' },
        product_cart: [{ product_id: PRODUCTS['pass-30d'], quantity: 1 }],
      },
    });

    await refund('pay_legacy_pass_sub');
    expect(accountRow()).toMatchObject({ plan: 'pro', plan_expires_at: subscriptionEnd });
  });

  it('a refund of a donation changes nothing', async () => {
    await postWebhook(
      paymentEvent('pay_donation', { kind: 'donation', account_id: buyer.accountId }, {
        product_cart: [{ product_id: PRODUCTS.donate, quantity: 1 }],
      }),
      'msg_donation',
    );
    await refund('pay_donation');
    expect(accountRow()).toMatchObject({ plan: 'free', credit_messages: 0 });
  });
});

describe('refunding Pro grants', () => {
  it('a refunded pass ends the term that pass created', async () => {
    await postWebhook(
      paymentEvent('pay_pass', { kind: 'pass', account_id: buyer.accountId, days: '30' }, {
        product_cart: [{ product_id: PRODUCTS['pass-30d'], quantity: 1 }],
      }),
      'msg_pass',
    );
    expect(accountRow()!.plan).toBe('pro');

    await refund('pay_pass');
    expect(accountRow()).toMatchObject({ plan: 'free' });
  });

  it('a refunded pass does not shorten an active subscription', async () => {
    const subscriptionEnd = Date.now() + 90 * DAY;
    await postWebhook(
      {
        type: 'subscription.active',
        data: {
          subscription_id: 'sub_long',
          next_billing_date: iso(subscriptionEnd),
          metadata: { kind: 'pro', account_id: buyer.accountId, interval: 'month' },
        },
      },
      'msg_sub_long',
    );
    await postWebhook(
      paymentEvent('pay_pass_on_sub', { kind: 'pass', account_id: buyer.accountId, days: '30' }, {
        product_cart: [{ product_id: PRODUCTS['pass-30d'], quantity: 1 }],
      }),
      'msg_pass_on_sub',
    );
    await refund('pay_pass_on_sub');
    expect(accountRow()).toMatchObject({ plan: 'pro', plan_expires_at: subscriptionEnd });
  });

  it('a refunded pass bought before a subscription does not cut that subscription', async () => {
    await postWebhook(
      paymentEvent('pay_pass_first', { kind: 'pass', account_id: buyer.accountId, days: '30' }, {
        product_cart: [{ product_id: PRODUCTS['pass-30d'], quantity: 1 }],
      }),
      'msg_pass_first',
    );
    const subscriptionEnd = Date.now() + 90 * DAY;
    await postWebhook(
      {
        type: 'subscription.active',
        data: {
          subscription_id: 'sub_after_pass',
          next_billing_date: iso(subscriptionEnd),
          metadata: { kind: 'pro', account_id: buyer.accountId, interval: 'month' },
        },
      },
      'msg_sub_after_pass',
    );

    await refund('pay_pass_first');
    expect(accountRow()).toMatchObject({ plan: 'pro', plan_expires_at: subscriptionEnd });
  });

  it('a refunded renewal falls back to the month that was already paid', async () => {
    const firstEnd = Date.now() + 31 * DAY;
    await postWebhook(
      paymentEvent(
        'pay_month_1',
        { kind: 'pro', account_id: buyer.accountId, interval: 'month' },
        {
          subscription_id: 'sub_renew',
          next_billing_date: iso(firstEnd),
          product_cart: [{ product_id: PRODUCTS['pro-monthly'], quantity: 1 }],
        },
      ),
      'msg_month_1',
    );

    const secondEnd = firstEnd + 31 * DAY;
    await postWebhook(
      paymentEvent(
        'pay_month_2',
        { kind: 'pro', account_id: buyer.accountId, interval: 'month' },
        {
          subscription_id: 'sub_renew',
          next_billing_date: iso(secondEnd),
          product_cart: [{ product_id: PRODUCTS['pro-monthly'], quantity: 1 }],
        },
      ),
      'msg_month_2',
    );
    expect(accountRow()!.plan_expires_at).toBe(secondEnd);

    await refund('pay_month_2');
    expect(accountRow()).toMatchObject({ plan: 'pro', plan_expires_at: firstEnd });
  });

  it('a refunded renewal with no checkout metadata still ends access by subscription id', async () => {
    await postWebhook(
      {
        type: 'subscription.active',
        data: {
          subscription_id: 'sub_no_meta',
          next_billing_date: iso(Date.now() + 31 * DAY),
          metadata: { kind: 'pro', account_id: buyer.accountId, interval: 'month' },
        },
      },
      'msg_no_meta_active',
    );

    // A renewal payment normally has no checkout metadata. The product id and
    // the subscription id are the only handles left.
    await postWebhook(
      {
        type: 'payment.succeeded',
        data: {
          payment_id: 'pay_no_meta',
          subscription_id: 'sub_no_meta',
          next_billing_date: iso(Date.now() + 62 * DAY),
          product_cart: [{ product_id: PRODUCTS['pro-monthly'], quantity: 1 }],
        },
      },
      'msg_no_meta_payment',
    );
    expect(accountRow()!.plan).toBe('pro');

    await refund('pay_no_meta');
    expect(accountRow()!.plan).toBe('free');
  });

  it('a delayed activation for a refunded term does not restore access', async () => {
    const endsAt = Date.now() + 31 * DAY;
    const activation = {
      type: 'subscription.active',
      data: {
        subscription_id: 'sub_delayed',
        next_billing_date: iso(endsAt),
        metadata: { kind: 'pro', account_id: buyer.accountId, interval: 'month' },
      },
    };
    await postWebhook(activation, 'msg_delayed_active');
    await postWebhook(
      paymentEvent(
        'pay_delayed',
        { kind: 'pro', account_id: buyer.accountId, interval: 'month' },
        {
          subscription_id: 'sub_delayed',
          next_billing_date: iso(endsAt),
          product_cart: [{ product_id: PRODUCTS['pro-monthly'], quantity: 1 }],
        },
      ),
      'msg_delayed_payment',
    );
    await refund('pay_delayed');
    expect(accountRow()!.plan).toBe('free');

    // The provider retries the original activation after the refund.
    await postWebhook(activation, 'msg_delayed_retry');
    expect(accountRow()!.plan).toBe('free');

    // A genuine renewal is a later term and does restore access.
    await postWebhook(
      {
        type: 'subscription.renewed',
        data: {
          subscription_id: 'sub_delayed',
          next_billing_date: iso(endsAt + 31 * DAY),
          metadata: { kind: 'pro', account_id: buyer.accountId, interval: 'month' },
        },
      },
      'msg_delayed_renewal',
    );
    expect(accountRow()).toMatchObject({ plan: 'pro', plan_expires_at: endsAt + 31 * DAY });
  });

  it('a refunded subscription ends access for the account that owns it', async () => {
    const endsAt = Date.now() + 31 * DAY;
    await postWebhook(
      paymentEvent(
        'pay_pro',
        { kind: 'pro', account_id: buyer.accountId, interval: 'month' },
        {
          subscription_id: 'sub_pro',
          next_billing_date: iso(endsAt),
          product_cart: [{ product_id: PRODUCTS['pro-monthly'], quantity: 1 }],
        },
      ),
      'msg_pro',
    );
    expect(accountRow()).toMatchObject({ plan: 'pro', dodo_subscription_id: 'sub_pro' });

    await refund('pay_pro');
    expect(accountRow()!.plan).toBe('free');
    expect(accountRow()!.plan_expires_at).toBeLessThanOrEqual(Date.now());
  });

  it('a refund cannot end a subscription that belongs to a different purchase', async () => {
    await postWebhook(
      paymentEvent(
        'pay_pro_old',
        { kind: 'pro', account_id: buyer.accountId, interval: 'month' },
        {
          subscription_id: 'sub_old',
          next_billing_date: iso(Date.now() + 31 * DAY),
          product_cart: [{ product_id: PRODUCTS['pro-monthly'], quantity: 1 }],
        },
      ),
      'msg_pro_old',
    );
    db.sqlite
      .prepare('UPDATE accounts SET dodo_subscription_id = ? WHERE id = ?')
      .run('sub_new', buyer.accountId);

    await refund('pay_pro_old');
    expect(accountRow()!.plan).toBe('pro');
  });
});

describe('ordering and duplicate deliveries', () => {
  it('a payment delivered twice under different message ids grants once', async () => {
    const event = paymentEvent(
      'pay_twice',
      { kind: 'credits', account_id: buyer.accountId, credits: '1000' },
      { product_cart: [{ product_id: PRODUCTS.credits, quantity: 1 }] },
    );
    await postWebhook(event, 'msg_a');
    await postWebhook(event, 'msg_b');
    expect(accountRow()!.credit_messages).toBe(1_000);
  });

  it('a refund before its payment event blocks the later grant', async () => {
    stubDodoLookups({
      payment: {
        payment_id: 'pay_early_refund',
        metadata: { kind: 'credits', account_id: buyer.accountId, credits: '1000' },
        customer: { customer_id: 'cus_fixture' },
        product_cart: [{ product_id: PRODUCTS.credits, quantity: 1 }],
      },
    });

    await refund('pay_early_refund');
    expect(accountRow()!.credit_messages).toBe(0);

    await postWebhook(
      paymentEvent(
        'pay_early_refund',
        { kind: 'credits', account_id: buyer.accountId, credits: '1000' },
        { product_cart: [{ product_id: PRODUCTS.credits, quantity: 1 }] },
      ),
      'msg_after_refund',
    );
    expect(accountRow()!.credit_messages).toBe(0);
  });

  it('a provider lookup failure is a 500 and releases the claim for the retry', async () => {
    stubDodoLookups({ paymentStatus: 500 });
    const response = await refund('pay_unknown', {}, 'msg_lookup_fail');
    expect(response.status).toBe(500);
    expect(
      db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM billing_events WHERE id = 'msg_lookup_fail'`)?.n,
    ).toBe(0);
  });
});

describe('disputes', () => {
  it('holds access while open and restores it when the merchant wins', async () => {
    await buyCredits('pay_disputed');
    stubDodoLookups({
      dispute: {
        dispute_id: 'dis_1',
        payment_id: 'pay_disputed',
        customer: { customer_id: 'cus_fixture' },
      },
      payment: {
        payment_id: 'pay_disputed',
        metadata: { kind: 'credits', account_id: buyer.accountId, credits: '1000' },
        product_cart: [{ product_id: PRODUCTS.credits, quantity: 1 }],
      },
    });

    const opened = await postWebhook(
      { type: 'dispute.opened', data: { dispute_id: 'dis_1' } },
      'msg_dispute_open',
    );
    expect(opened.status).toBe(200);
    expect(accountRow()!.credit_messages).toBe(0);

    const won = await postWebhook(
      { type: 'dispute.won', data: { dispute_id: 'dis_1' } },
      'msg_dispute_won',
    );
    expect(won.status).toBe(200);
    expect(accountRow()!.credit_messages).toBe(1_000);
  });

  it('keeps access revoked when the dispute is lost', async () => {
    await buyCredits('pay_lost');
    stubDodoLookups({
      dispute: {
        dispute_id: 'dis_lost',
        payment_id: 'pay_lost',
        customer: { customer_id: 'cus_fixture' },
      },
    });
    await postWebhook(
      { type: 'dispute.opened', data: { dispute_id: 'dis_lost' } },
      'msg_lost_open',
    );
    await postWebhook(
      { type: 'dispute.lost', data: { dispute_id: 'dis_lost' } },
      'msg_lost_lost',
    );
    expect(accountRow()!.credit_messages).toBe(0);
  });
});

describe('sponsor refunds', () => {
  it('a refunded sponsor payment hides the card and frees the slot', async () => {
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

    await postWebhook(
      paymentEvent(
        'pay_sponsor',
        { kind: 'sponsor', sponsor_id: draft.id, slot: 'featured' },
        {
          subscription_id: 'sub_sponsor',
          next_billing_date: iso(Date.now() + 31 * DAY),
          product_cart: [{ product_id: PRODUCTS['sponsor-featured'], quantity: 1 }],
        },
      ),
      'msg_sponsor',
    );
    expect((await sponsors.byId(draft.id))!.status).toBe('active');

    await refund('pay_sponsor');
    expect((await sponsors.byId(draft.id))!.status).toBe('expired');
    expect((await sponsors.slots()).find((entry) => entry.slot.id === 'featured')?.available).toBe(
      true,
    );
  });
});

describe('payment integrity', () => {
  it('refuses a signed payment whose product does not match its metadata', async () => {
    const response = await postWebhook(
      paymentEvent(
        'pay_wrong_product',
        { kind: 'credits', account_id: buyer.accountId, credits: '1000' },
        { product_cart: [{ product_id: PRODUCTS.donate, quantity: 1 }] },
      ),
      'msg_wrong_product',
    );
    expect(response.status).toBe(500);
    expect(((await response.json()) as Json).code).toBe('product_mismatch');
    expect(accountRow()!.credit_messages).toBe(0);
    // Not claimed, so a corrected deployment can still apply the retry.
    expect(
      db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM billing_events WHERE id = 'msg_wrong_product'`)?.n,
    ).toBe(0);
  });

  it('rejects an oversized webhook body before reading or verifying it', async () => {
    const response = await app.fetch(
      new Request(`${ORIGIN}/api/billing/webhook`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'webhook-id': 'msg_big',
          'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
          'webhook-signature': 'v1,AAAA',
        },
        body: 'x'.repeat(300 * 1024),
      }),
      env as never,
      executionContext as never,
    );
    expect(response.status).toBe(413);
    expect(((await response.json()) as Json).code).toBe('payload_too_large');
  });

  it('sanitises a receipt link to https', () => {
    expect(safeHttpsUrl('https://pay.example.test/receipt.pdf')).toBe(
      'https://pay.example.test/receipt.pdf',
    );
    expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpsUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHttpsUrl(null)).toBeNull();
  });

  it('rate-limits a signed-in account that loops checkout creation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          checkout_url: 'https://checkout.dodopayments.test/cs_fixture',
          session_id: 'cs_fixture',
        }),
      ),
    );

    for (let index = 0; index < 10; index += 1) {
      const response = await app.fetch(
        new Request(`${ORIGIN}/api/billing/credits`, {
          method: 'POST',
          headers: { ...buyer.headers, origin: ORIGIN },
        }),
        env as never,
        executionContext as never,
      );
      expect(response.status, `attempt ${index + 1}`).toBe(200);
    }

    const blocked = await app.fetch(
      new Request(`${ORIGIN}/api/billing/credits`, {
        method: 'POST',
        headers: { ...buyer.headers, origin: ORIGIN },
      }),
      env as never,
      executionContext as never,
    );
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as Json).code).toBe('rate_limited');
  });
});
