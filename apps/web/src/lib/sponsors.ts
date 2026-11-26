/**
 * Sponsor inventory and the rules for showing a card.
 *
 * The server owns price, availability and creative; this module only fetches it
 * once per page load and decides whether the current route and visitor may see
 * the card. Keeping the decision pure makes the three rules that matter
 * testable: no card for Pro, no card off an allowlisted route, and no card while
 * the session is still loading (so a Pro visitor never sees a flash of one).
 *
 * There is no third-party script here. A sponsor card is markup this app
 * renders, with a logo served from this origin — which is why the strict CSP is
 * unchanged by sponsorship.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { serverDeployed } from '@/lib/deployment';

export type SponsorSlotId = 'featured' | 'standard';
export type SponsorPlacement = 'home' | 'guides' | 'article';

export interface PublicSponsor {
  id: string;
  name: string;
  url: string;
  blurb: string;
  brandColor: string | null;
  hasLogo: boolean;
}

export interface SponsorSlotDef {
  id: SponsorSlotId;
  label: string;
  priceCents: number;
  currency: 'USD';
  placement: string;
  summary: string;
}

export interface SponsorSlotView {
  slot: SponsorSlotDef;
  available: boolean;
  sponsor: PublicSponsor | null;
}

export interface SponsorInventory {
  slots: SponsorSlotView[];
  billing: { enabled: boolean };
}

/**
 * An allowlist, like the ad gate it replaces: a new route is sponsor-free by
 * default, which is the direction that cannot go wrong. The tool workspace and
 * every result, account and checkout screen are absent on purpose — a sponsor
 * buys content pages, not a working session.
 */
export function sponsorPlacementFor(pathname: string): SponsorPlacement | undefined {
  if (pathname === '/') return 'home';
  if (pathname === '/guides' || pathname === '/guides/') return 'guides';
  if (/^\/guides\/[a-z0-9-]+\/?$/.test(pathname)) return 'article';
  return undefined;
}

/** The home page has the featured slot; the guide surfaces share the standard one. */
export function slotForPlacement(placement: SponsorPlacement): SponsorSlotId {
  return placement === 'home' ? 'featured' : 'standard';
}

export function sponsorVisible(input: {
  placement: SponsorPlacement | undefined;
  /** `undefined` means the session is still loading. */
  plan: 'free' | 'pro' | undefined;
  only?: readonly SponsorPlacement[];
  inventory: SponsorInventory | null;
}): PublicSponsor | null {
  const { placement, plan, only, inventory } = input;
  if (!placement) return null;
  if (plan !== 'free') return null;
  if (only && !only.includes(placement)) return null;
  if (!inventory) return null;

  const slot = inventory.slots.find((entry) => entry.slot.id === slotForPlacement(placement));
  return slot?.sponsor ?? null;
}

/* ------------------------------------------------------------- fetching */

const TTL_MS = 60_000;

let cache: { at: number; value: SponsorInventory | null } | undefined;
let inflight: Promise<SponsorInventory | null> | undefined;

/**
 * One request per page load, shared by every slot. A failure is cached as
 * `null` for the same minute: a broken inventory must hide the card, not retry
 * on every navigation.
 */
export async function sponsorInventory(): Promise<SponsorInventory | null> {
  if (!serverDeployed) return null;
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  if (inflight) return inflight;

  inflight = api<SponsorInventory>('/api/sponsors')
    .then((result) => result ?? null)
    .catch(() => null)
    .then((value) => {
      cache = { at: Date.now(), value };
      inflight = undefined;
      return value;
    });

  return inflight;
}

/** The `/sponsor` page needs a live view, so it bypasses the cache once. */
export async function refreshSponsorInventory(): Promise<SponsorInventory | null> {
  cache = undefined;
  return sponsorInventory();
}

export function useSponsorInventory(): {
  inventory: SponsorInventory | null;
  loading: boolean;
  reload: () => void;
} {
  const [inventory, setInventory] = useState<SponsorInventory | null>(() => cache?.value ?? null);
  const [loading, setLoading] = useState(cache === undefined);

  const load = useCallback(() => {
    setLoading(true);
    void refreshSponsorInventory().then((value) => {
      setInventory(value);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (cache) {
      setInventory(cache.value);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void sponsorInventory().then((value) => {
      if (cancelled) return;
      setInventory(value);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { inventory, loading, reload: load };
}
