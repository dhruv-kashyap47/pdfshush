/**
 * The public prices and the charged prices are two files in two builds.
 *
 * `/pricing` renders `apps/web/src/content/pricing.ts`, while the checkout route
 * charges `apps/edge/src/routes/billing.ts`. A one-dollar drift between them is
 * a false advertisement and a refund request, so the two are asserted equal
 * here rather than trusted to discipline.
 */

import { describe, expect, it } from 'vitest';
import { CREDIT_PACK, PASS, PRO, DONATION } from '../src/routes/billing.js';
import { SPONSOR_SLOTS } from '../src/sponsors/catalog.js';
import { PRICING } from '../../web/src/content/pricing.js';

describe('pricing parity', () => {
  it('charges exactly what the pricing page advertises', () => {
    expect(PRO.monthlyCents).toBe(PRICING.pro.monthlyCents);
    expect(PRO.yearlyCents).toBe(PRICING.pro.yearlyCents);
    expect(PASS.days).toBe(PRICING.pass.days);
    expect(PASS.priceCents).toBe(PRICING.pass.cents);
    expect(CREDIT_PACK.messages).toBe(PRICING.credits.count);
    expect(CREDIT_PACK.priceCents).toBe(PRICING.credits.cents);
  });

  it('keeps both sponsor slots at the advertised rate', () => {
    const featured = SPONSOR_SLOTS.find((slot) => slot.id === 'featured');
    const standard = SPONSOR_SLOTS.find((slot) => slot.id === 'standard');
    expect(featured?.priceCents).toBe(PRICING.sponsor.featuredCents);
    expect(standard?.priceCents).toBe(PRICING.sponsor.standardCents);
  });

  it('keeps the donation floor below every advertised amount', () => {
    expect(DONATION.minCents).toBeLessThan(PRICING.pass.cents);
    expect(DONATION.maxCents).toBeGreaterThan(PRICING.pro.yearlyCents);
  });
});
