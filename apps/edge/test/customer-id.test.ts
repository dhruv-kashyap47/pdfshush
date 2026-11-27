import { describe, expect, it } from 'vitest';
import { applyBillingEvent } from '../src/billing/webhook.js';
import { TestD1 } from './support/db.js';
import { seedAccount } from './support/env.js';

describe('billing customer id', () => {
  it('stores the Dodo customer id from a verified payment', async () => {
    const db = new TestD1();
    const buyer = await seedAccount(db);

    await applyBillingEvent(
      db,
      'payment.succeeded',
      {
        payment_id: 'pay_fixture',
        metadata: { kind: 'credits', account_id: buyer.accountId, credits: '10' },
        customer: { customer_id: 'cus_first' },
      },
      Date.now(),
    );

    const row = db.get<{ dodo_customer_id: string | null }>(
      'SELECT dodo_customer_id FROM accounts WHERE id = ?',
      buyer.accountId,
    );
    expect(row?.dodo_customer_id).toBe('cus_first');
  });

  it('keeps the first customer id when a later event names another', async () => {
    const db = new TestD1();
    const buyer = await seedAccount(db);

    for (const customerId of ['cus_first', 'cus_second']) {
      await applyBillingEvent(
        db,
        'payment.succeeded',
        {
          payment_id: `pay_${customerId}`,
          metadata: { kind: 'credits', account_id: buyer.accountId, credits: '10' },
          customer: { customer_id: customerId },
        },
        Date.now(),
      );
    }

    const row = db.get<{ dodo_customer_id: string | null }>(
      'SELECT dodo_customer_id FROM accounts WHERE id = ?',
      buyer.accountId,
    );
    expect(row?.dodo_customer_id).toBe('cus_first');
  });
});
