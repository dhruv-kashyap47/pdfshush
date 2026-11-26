import { describe, expect, it } from 'vitest';
import { purchaseRequest } from './billing';

describe('purchaseRequest', () => {
  it('sends each one-time purchase to its own route with no interval', () => {
    expect(purchaseRequest('credits')).toEqual({ path: '/api/billing/credits' });
    expect(purchaseRequest('pass')).toEqual({ path: '/api/billing/pass' });
  });

  it('sends the yearly subscription with interval year, not month', () => {
    expect(purchaseRequest('pro-yearly')).toEqual({
      path: '/api/billing/pro',
      body: { interval: 'year' },
    });
  });

  it('sends the monthly subscription with interval month', () => {
    expect(purchaseRequest('pro-monthly')).toEqual({
      path: '/api/billing/pro',
      body: { interval: 'month' },
    });
  });
});
