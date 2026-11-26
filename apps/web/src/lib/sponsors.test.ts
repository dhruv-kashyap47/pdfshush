import { describe, expect, it } from 'vitest';
import {
  slotForPlacement,
  sponsorPlacementFor,
  sponsorVisible,
  type SponsorInventory,
  type SponsorSlotDef,
} from './sponsors';

const FEATURED: SponsorSlotDef = {
  id: 'featured',
  label: 'Featured',
  priceCents: 3900,
  currency: 'USD',
  placement: 'The home page, under the tool grid',
  summary: 'Featured.',
};

const STANDARD: SponsorSlotDef = {
  id: 'standard',
  label: 'Standard',
  priceCents: 1900,
  currency: 'USD',
  placement: 'The guides index and the end of every guide',
  summary: 'Standard.',
};

const SPONSOR = {
  id: 'spn_1',
  name: 'Acme',
  url: 'https://acme.example',
  blurb: 'Private PDF tools',
  brandColor: '#2f9e6a',
  hasLogo: true,
};

const INVENTORY: SponsorInventory = {
  slots: [
    { slot: FEATURED, available: false, sponsor: SPONSOR },
    { slot: STANDARD, available: false, sponsor: SPONSOR },
  ],
  billing: { enabled: true },
};

describe('sponsorPlacementFor', () => {
  it('allowlists exactly the three content surfaces', () => {
    expect(sponsorPlacementFor('/')).toBe('home');
    expect(sponsorPlacementFor('/guides')).toBe('guides');
    expect(sponsorPlacementFor('/guides/redact-a-pdf')).toBe('article');
  });

  it('returns nothing for tools, results, checkout and account', () => {
    for (const path of [
      '/tools/merge-pdf',
      '/account',
      '/sponsor',
      '/privacy',
      '/guides/redact-a-pdf/extra',
      '/checkout',
    ]) {
      expect(sponsorPlacementFor(path), path).toBeUndefined();
    }
  });
});

describe('slotForPlacement', () => {
  it('gives the home page the featured slot and both guide surfaces the standard one', () => {
    expect(slotForPlacement('home')).toBe('featured');
    expect(slotForPlacement('guides')).toBe('standard');
    expect(slotForPlacement('article')).toBe('standard');
  });
});

describe('sponsorVisible', () => {
  it('shows the matching sponsor to a free visitor on an allowed route', () => {
    expect(
      sponsorVisible({ placement: 'home', plan: 'free', inventory: INVENTORY })?.id,
    ).toBe('spn_1');
  });

  it('never shows a card to Pro', () => {
    expect(sponsorVisible({ placement: 'home', plan: 'pro', inventory: INVENTORY })).toBeNull();
  });

  it('waits while the session is unknown, rather than flashing a card at Pro', () => {
    expect(
      sponsorVisible({ placement: 'home', plan: undefined, inventory: INVENTORY }),
    ).toBeNull();
  });

  it('respects the route allowlist passed by the caller', () => {
    expect(
      sponsorVisible({ placement: 'home', plan: 'free', only: ['guides'], inventory: INVENTORY }),
    ).toBeNull();
    expect(
      sponsorVisible({ placement: 'article', plan: 'free', only: ['article'], inventory: INVENTORY })
        ?.name,
    ).toBe('Acme');
  });

  it('renders nothing when the inventory is missing or the slot is empty', () => {
    expect(sponsorVisible({ placement: 'home', plan: 'free', inventory: null })).toBeNull();
    const empty: SponsorInventory = {
      slots: [{ slot: FEATURED, available: true, sponsor: null }],
      billing: { enabled: true },
    };
    expect(sponsorVisible({ placement: 'home', plan: 'free', inventory: empty })).toBeNull();
  });
});
