import { describe, expect, it } from 'vitest';
import { readAiUsage, spendAiMessage } from '../src/ai/budget.js';
import { TestD1 } from './support/db.js';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

describe('readAiUsage', () => {
  it('reads the same free daily counter that a message spends', async () => {
    const db = new TestD1();
    const accountId = 'acct_usage_free';

    await spendAiMessage(db, { subject: `acct:${accountId}`, plan: 'free', now: NOW });
    await spendAiMessage(db, { subject: `acct:${accountId}`, plan: 'free', now: NOW });

    const usage = await readAiUsage(db, { accountId, plan: 'free', now: NOW });
    expect(usage).toMatchObject({ plan: 'free', used: 2, limit: 3 });
    expect(usage.daily.used).toBe(2);
    expect(usage.resetsAt).toBe(Date.UTC(2026, 0, 16));
  });

  it('reports the Pro month and the Pro daily ceiling', async () => {
    const db = new TestD1();
    const accountId = 'acct_usage_pro';

    for (let index = 0; index < 3; index += 1) {
      await spendAiMessage(db, { subject: `acct:${accountId}`, plan: 'pro', now: NOW });
    }

    const usage = await readAiUsage(db, { accountId, plan: 'pro', now: NOW });
    expect(usage).toMatchObject({ plan: 'pro', used: 3, limit: 500 });
    expect(usage.daily).toMatchObject({ used: 3, limit: 60 });
    expect(usage.resetsAt).toBe(Date.UTC(2026, 1, 1));
  });

  it('never reports more than the free limit, even after a refused message', async () => {
    const db = new TestD1();
    const accountId = 'acct_usage_refused';

    for (let index = 0; index < 4; index += 1) {
      await spendAiMessage(db, { subject: `acct:${accountId}`, plan: 'free', now: NOW });
    }

    const usage = await readAiUsage(db, { accountId, plan: 'free', now: NOW });
    expect(usage.used).toBe(3);
    expect(usage.daily.used).toBe(3);
  });

  it('rolls the month window without the process clock', async () => {
    const db = new TestD1();
    const accountId = 'acct_usage_roll';
    const january = Date.UTC(2026, 0, 31, 23, 0, 0);
    const february = Date.UTC(2026, 1, 1, 0, 30, 0);

    await spendAiMessage(db, { subject: `acct:${accountId}`, plan: 'pro', now: january });

    const usage = await readAiUsage(db, { accountId, plan: 'pro', now: february });
    expect(usage.used).toBe(0);
    expect(usage.daily.used).toBe(0);
  });
});
