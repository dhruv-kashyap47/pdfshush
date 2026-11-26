import { describe, expect, it } from 'vitest';
import {
  adConfig,
  adEligible,
  adPlacementFor,
  consentPermits,
  shouldRenderAd,
  type AdConfig,
} from './ads';

const ON: AdConfig = {
  enabled: true,
  client: 'ca-pub-1234567890123456',
  cmpId: '',
  slots: { home: '1', tool: '2', articleTop: '3', articleEnd: '4' },
};

const base = {
  VITE_ADS_ENABLED: 'true',
  VITE_ADSENSE_CLIENT: 'ca-pub-1234567890123456',
  VITE_ADSENSE_SLOT_HOME: '1',
  VITE_ADSENSE_SLOT_TOOL: '2',
  VITE_ADSENSE_SLOT_ARTICLE_TOP: '3',
  VITE_ADSENSE_SLOT_ARTICLE_END: '4',
};

describe('adConfig', () => {
  it('is off when the flag is absent', () => {
    expect(adConfig({ ...base, VITE_ADS_ENABLED: 'false' }).enabled).toBe(false);
  });

  it('is off without a publisher id', () => {
    expect(adConfig({ ...base, VITE_ADSENSE_CLIENT: '' }).enabled).toBe(false);
  });

  it('is off for an all-zero placeholder id', () => {
    expect(adConfig({ ...base, VITE_ADSENSE_CLIENT: 'ca-pub-0000000000000000' }).enabled).toBe(false);
  });

  it('is on when the flag and a real-looking id are present', () => {
    expect(adConfig(base).enabled).toBe(true);
  });
});

describe('adPlacementFor', () => {
  it('allows home, tool and article routes', () => {
    expect(adPlacementFor('/')).toBe('home');
    expect(adPlacementFor('/tools/merge-pdf')).toBe('tool');
    expect(adPlacementFor('/guides/redact-a-pdf-properly')).toBe('article');
  });

  it('refuses every other route', () => {
    for (const route of [
      '/account',
      '/status',
      '/login',
      '/checkout',
      '/verify',
      '/guides',
      '/workflows',
      '/trust',
    ]) {
      expect(adPlacementFor(route), route).toBeUndefined();
    }
  });
});

describe('adEligible', () => {
  it('is true before consent is known, so the CMP can actually be loaded', () => {
    // Regression: the slot used to require consent before it would load the CMP,
    // which meant a configured CMP could never produce a decision and no ad ever
    // rendered.
    expect(
      adEligible({ config: { ...ON, cmpId: 'pub-123' }, pathname: '/guides/x', plan: 'free' }),
    ).toBe(true);
  });

  it('is false for Pro, an unresolved plan, a blocked route and a disabled build', () => {
    expect(adEligible({ config: ON, pathname: '/guides/x', plan: 'pro' })).toBe(false);
    expect(adEligible({ config: ON, pathname: '/guides/x', plan: undefined })).toBe(false);
    expect(adEligible({ config: ON, pathname: '/account', plan: 'free' })).toBe(false);
    expect(
      adEligible({ config: { ...ON, enabled: false }, pathname: '/guides/x', plan: 'free' }),
    ).toBe(false);
  });
});

describe('consentPermits', () => {
  it('requires an explicit grant only when a CMP is configured', () => {
    expect(consentPermits({ ...ON, cmpId: 'pub-123' }, 'unknown')).toBe(false);
    expect(consentPermits({ ...ON, cmpId: 'pub-123' }, 'denied')).toBe(false);
    expect(consentPermits({ ...ON, cmpId: 'pub-123' }, 'granted')).toBe(true);
    expect(consentPermits(ON, 'unknown')).toBe(true);
  });
});

describe('shouldRenderAd', () => {
  const allow = (overrides: Partial<Parameters<typeof shouldRenderAd>[0]> = {}) =>
    shouldRenderAd({
      config: ON,
      pathname: '/guides/redact-a-pdf-properly',
      plan: 'free',
      consent: 'granted',
      ...overrides,
    });

  it('renders for an allowed route, a known free plan and consent', () => {
    expect(allow()).toBe(true);
  });

  it('never renders when the flag is off', () => {
    expect(allow({ config: { ...ON, enabled: false } })).toBe(false);
  });

  it('never renders for Pro', () => {
    expect(allow({ plan: 'pro' })).toBe(false);
  });

  it('waits rather than flashing ads for a Pro user whose plan is unknown', () => {
    expect(allow({ plan: undefined })).toBe(false);
  });

  it('never renders on an excluded route', () => {
    expect(allow({ pathname: '/account' })).toBe(false);
    expect(allow({ pathname: '/status' })).toBe(false);
    expect(allow({ pathname: '/' })).toBe(true);
  });

  it('requires consent when a CMP is configured', () => {
    const withCmp = { ...ON, cmpId: 'pub-123' };
    expect(allow({ config: withCmp, consent: 'denied' })).toBe(false);
    expect(allow({ config: withCmp, consent: 'unknown' })).toBe(false);
    expect(allow({ config: withCmp, consent: 'granted' })).toBe(true);
  });

  it('does not require consent when no CMP is configured', () => {
    expect(allow({ consent: 'unknown' })).toBe(true);
  });
});
