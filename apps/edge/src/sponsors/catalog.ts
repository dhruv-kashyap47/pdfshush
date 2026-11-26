/**
 * The sponsor catalogue: what can be bought, for how much, and where it shows.
 *
 * This is the server's source of truth. The `/sponsor` page reads it through
 * `GET /api/sponsors` rather than keeping a second price list that could drift
 * (the same rule the plan catalogue follows for subscriptions).
 *
 * Prices are in cents so no floating point ever touches money.
 */

export type SponsorSlotId = 'featured' | 'standard';
export type SponsorStatus = 'draft' | 'active' | 'cancelled' | 'expired';

export interface SponsorSlotDef {
  id: SponsorSlotId;
  label: string;
  /** Founding rate, locked for 12 months. Raise after ~10k sessions. */
  priceCents: number;
  currency: 'USD';
  /** Where the card renders. One slot owns one surface, so no rotation logic. */
  placement: string;
  summary: string;
}

export const SPONSOR_SLOTS: readonly SponsorSlotDef[] = [
  {
    id: 'featured',
    label: 'Featured',
    priceCents: 3_900,
    currency: 'USD',
    placement: 'The home page, under the tool grid',
    summary:
      'A single card with your logo, name, one line and a link, at the foot of the busiest page on the site.',
  },
  {
    id: 'standard',
    label: 'Standard',
    priceCents: 1_900,
    currency: 'USD',
    placement: 'The guides index and the end of every guide',
    summary:
      'The same card on the pages people reach from search, which is where the site earns its traffic.',
  },
] as const;

export const SPONSOR_BLURB_MAX = 60;
export const SPONSOR_NAME_MAX = 40;
export const SPONSOR_URL_MAX = 300;
export const SPONSOR_EMAIL_MAX = 200;
export const SPONSOR_LOGO_MAX_BYTES = 64 * 1024;

export const SPONSOR_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;

export function sponsorSlot(id: unknown): SponsorSlotDef | undefined {
  return SPONSOR_SLOTS.find((slot) => slot.id === id);
}
