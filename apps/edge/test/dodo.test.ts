/**
 * The webhook verifier and the config surface: the parts that decide whether a
 * payment can become an entitlement at all.
 */

import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { dodoConfig, productId, verifyWebhook, webhookEvent } from '../src/billing/dodo.js';
import { applyBillingEvent, metadataOf, termEnd } from '../src/billing/webhook.js';
import { PRODUCTS, WEBHOOK_SECRET, testEnv } from './support/env.js';
import { TestD1 } from './support/db.js';

const bytes = (value: string) => new TextEncoder().encode(value);

async function sign(secret: string, id: string, timestamp: string, body: string) {
  const raw = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice('whsec_'.length), 'base64')
    : bytes(secret);
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, bytes(`${id}.${timestamp}.${body}`));
  return `v1,${Buffer.from(signature).toString('base64')}`;
}

describe('dodoConfig', () => {
  it('is undefined without an API key, so nothing can be sold by accident', () => {
    expect(dodoConfig(testEnv(new TestD1(), { DODO_API_KEY: undefined }))).toBeUndefined();
  });

  it('defaults to test mode and only goes live on the exact word', () => {
    const db = new TestD1();
    expect(dodoConfig(testEnv(db, { DODO_ENVIRONMENT: undefined }))?.environment).toBe('test');
    expect(dodoConfig(testEnv(db, { DODO_ENVIRONMENT: 'Test' }))?.environment).toBe('test');
    expect(dodoConfig(testEnv(db, { DODO_ENVIRONMENT: 'prod' }))?.environment).toBe('test');
    expect(dodoConfig(testEnv(db, { DODO_ENVIRONMENT: 'live' }))?.environment).toBe('live');
  });

  it('treats a blank product id as unconfigured, not as an empty product', () => {
    const config = dodoConfig(testEnv(new TestD1(), { DODO_PRODUCT_PRO_MONTHLY: '  ' }));
    expect(productId(config!, 'pro-monthly')).toBeUndefined();
    expect(productId(config!, 'pro-yearly')).toBe(PRODUCTS['pro-yearly']);
    expect(productId(config!, 'credits')).toBe(PRODUCTS.credits);
  });
});

describe('verifyWebhook', () => {
  const body = JSON.stringify({ type: 'payment.succeeded', data: { metadata: { a: 'b' } } });

  it('accepts a valid v1 signature and returns the payload plus the message id', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = await verifyWebhook(WEBHOOK_SECRET, body, {
      id: 'msg_1',
      timestamp,
      signature: await sign(WEBHOOK_SECRET, 'msg_1', timestamp, body),
    });
    expect(payload.type).toBe('payment.succeeded');
    expect(payload.__webhookId).toBe('msg_1');
    expect(webhookEvent(payload)).toMatchObject({ id: 'msg_1', type: 'payment.succeeded' });
  });

  it('accepts a signature when the payload sits among several tokens', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const good = await sign(WEBHOOK_SECRET, 'msg_2', timestamp, body);
    const payload = await verifyWebhook(WEBHOOK_SECRET, body, {
      id: 'msg_2',
      timestamp,
      signature: `v1,AAAA ${good}`,
    });
    expect(payload.__webhookId).toBe('msg_2');
  });

  it('rejects a signature made with another secret', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    await expect(
      verifyWebhook(WEBHOOK_SECRET, body, {
        id: 'msg_3',
        timestamp,
        signature: await sign('whsec_' + Buffer.from('other').toString('base64'), 'msg_3', timestamp, body),
      }),
    ).rejects.toThrow(/did not match/);
  });

  it('rejects a replayed timestamp outside the five-minute window', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 600);
    await expect(
      verifyWebhook(WEBHOOK_SECRET, body, {
        id: 'msg_4',
        timestamp,
        signature: await sign(WEBHOOK_SECRET, 'msg_4', timestamp, body),
      }),
    ).rejects.toThrow(/timestamp/);
  });

  it('rejects missing headers before doing any crypto', async () => {
    await expect(verifyWebhook(WEBHOOK_SECRET, body, {})).rejects.toThrow(/missing/);
  });
});

describe('webhook payload reading', () => {
  it('ignores non-string metadata instead of coercing it', () => {
    expect(metadataOf({ a: 'x', b: 1, c: null, d: { e: 'f' } })).toEqual({ a: 'x' });
    expect(metadataOf(null)).toEqual({});
    expect(metadataOf(['a'])).toEqual({});
  });

  it('falls back to a full term only when the date is unusable', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(termEnd('2026-02-01T00:00:00Z', now)).toBe(Date.parse('2026-02-01T00:00:00Z'));
    expect(termEnd('not a date', now)).toBe(now + 31 * 86_400_000);
    expect(termEnd(undefined, now, 366)).toBe(now + 366 * 86_400_000);
  });

  it('applies nothing for an event type it does not know', async () => {
    const db = new TestD1();
    await applyBillingEvent(db as never, 'refund.created', { metadata: { kind: 'credits' } });
    expect(db.get('SELECT COUNT(*) AS n FROM billing_events')?.n).toBe(0);
  });
});
