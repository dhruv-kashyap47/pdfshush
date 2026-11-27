import { describe, expect, it } from 'vitest';
import {
  PRICING,
  PRICING_COMPARISON,
  PRICING_FAQ,
  PRICING_STATIC_BODY,
  usd,
} from './pricing.js';

describe('pricing content', () => {
  it('formats whole and fractional dollars without noise', () => {
    expect(usd(600)).toBe('$6');
    expect(usd(4_800)).toBe('$48');
    expect(usd(450)).toBe('$4.50');
    expect(usd(0)).toBe('$0');
  });

  it('shows every charged price in the crawlable body', () => {
    for (const cents of [
      PRICING.pro.monthlyCents,
      PRICING.pro.yearlyCents,
      PRICING.pass.cents,
      PRICING.credits.cents,
      PRICING.sponsor.featuredCents,
      PRICING.sponsor.standardCents,
    ]) {
      expect(PRICING_STATIC_BODY).toContain(usd(cents));
    }
  });

  it('has a complete comparison row and a non-empty FAQ', () => {
    for (const row of PRICING_COMPARISON) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.free).not.toBe('');
      expect(row.pro).not.toBe('');
      expect(row.topup).not.toBe('');
    }
    expect(PRICING_FAQ.length).toBeGreaterThanOrEqual(4);
    for (const entry of PRICING_FAQ) {
      expect(entry.q.length).toBeGreaterThan(10);
      expect(entry.a.length).toBeGreaterThan(40);
    }
  });

  it('never promises a feature the product does not sell', () => {
    expect(PRICING_STATIC_BODY).not.toMatch(/unlimited AI|no limits|free forever/i);
    expect(PRICING_FAQ.map((entry) => entry.a).join(' ')).not.toMatch(/unlimited/i);
  });
});
