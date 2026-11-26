/**
 * Sponsor rows on D1.
 *
 * Two invariants matter and both are enforced in the database as well as here:
 *
 *   - one live sponsor per slot (partial unique index `sponsors_live_slot`);
 *   - a webhook retry never applies twice (`billing_events` keyed by the
 *     Standard Webhooks message id).
 *
 * The public shape never includes the sponsor's email. That column exists for
 * the receipt trail, not for rendering.
 */

import type { D1Database } from '../env.js';
import { randomToken } from '../lib/crypto.js';
import {
  SPONSOR_SLOTS,
  type SponsorSlotDef,
  type SponsorSlotId,
  type SponsorStatus,
} from '../sponsors/catalog.js';

export interface Sponsor {
  id: string;
  slot: SponsorSlotId;
  status: SponsorStatus;
  name: string;
  url: string;
  blurb: string;
  email: string;
  brandColor: string | null;
  createdAt: number;
  startsAt: number | null;
  endsAt: number | null;
  dodoSubscriptionId: string | null;
  dodoPaymentId: string | null;
  hasLogo: boolean;
}

/** What a visitor can see: no email, no billing ids. */
export interface PublicSponsor {
  id: string;
  name: string;
  url: string;
  blurb: string;
  brandColor: string | null;
  hasLogo: boolean;
}

export interface SlotView {
  slot: SponsorSlotDef;
  available: boolean;
  sponsor: PublicSponsor | null;
}

interface SponsorRow {
  id: string;
  slot: string;
  status: string;
  name: string;
  url: string;
  blurb: string;
  email: string;
  brand_color: string | null;
  created_at: number;
  starts_at: number | null;
  ends_at: number | null;
  dodo_subscription_id: string | null;
  dodo_payment_id: string | null;
  has_logo: number;
}

function toSponsor(row: SponsorRow): Sponsor {
  return {
    id: row.id,
    slot: row.slot === 'featured' ? 'featured' : 'standard',
    status: (['draft', 'active', 'cancelled', 'expired'] as const).includes(
      row.status as SponsorStatus,
    )
      ? (row.status as SponsorStatus)
      : 'draft',
    name: row.name,
    url: row.url,
    blurb: row.blurb,
    email: row.email,
    brandColor: row.brand_color,
    createdAt: row.created_at,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    dodoSubscriptionId: row.dodo_subscription_id,
    dodoPaymentId: row.dodo_payment_id,
    hasLogo: row.has_logo === 1,
  };
}

function toPublic(sponsor: Sponsor): PublicSponsor {
  return {
    id: sponsor.id,
    name: sponsor.name,
    url: sponsor.url,
    blurb: sponsor.blurb,
    brandColor: sponsor.brandColor,
    hasLogo: sponsor.hasLogo,
  };
}

const SELECT = `SELECT id, slot, status, name, url, blurb, email, brand_color,
                       created_at, starts_at, ends_at, dodo_subscription_id,
                       dodo_payment_id,
                       CASE WHEN logo_bytes IS NULL THEN 0 ELSE 1 END AS has_logo
                  FROM sponsors`;

export interface DraftInput {
  slot: SponsorSlotId;
  name: string;
  url: string;
  blurb: string;
  email: string;
  brandColor?: string | null;
  logo?: { bytes: Uint8Array; type: string } | null;
}

export class D1SponsorStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Live means a paid row whose term has not ended. Drafts are never public. */
  async listLive(): Promise<Sponsor[]> {
    const now = this.now();
    const result = await this.db
      .prepare(
        `${SELECT}
          WHERE status IN ('active', 'cancelled')
            AND ends_at IS NOT NULL
            AND ends_at > ?
          ORDER BY slot`,
      )
      .bind(now)
      .all<SponsorRow>();
    return result.results.map(toSponsor);
  }

  /** The public inventory: every slot, whether it is open, and who holds it. */
  async slots(): Promise<SlotView[]> {
    const live = await this.listLive();
    const bySlot = new Map(live.map((sponsor) => [sponsor.slot, sponsor]));
    return SPONSOR_SLOTS.map((slot) => {
      const sponsor = bySlot.get(slot.id);
      return {
        slot,
        available: sponsor === undefined,
        sponsor: sponsor ? toPublic(sponsor) : null,
      };
    });
  }

  async byId(id: string): Promise<Sponsor | undefined> {
    const row = await this.db.prepare(`${SELECT} WHERE id = ?`).bind(id).first<SponsorRow>();
    return row ? toSponsor(row) : undefined;
  }

  async bySubscription(subscriptionId: string): Promise<Sponsor | undefined> {
    const row = await this.db
      .prepare(`${SELECT} WHERE dodo_subscription_id = ?`)
      .bind(subscriptionId)
      .first<SponsorRow>();
    return row ? toSponsor(row) : undefined;
  }

  async createDraft(input: DraftInput): Promise<Sponsor> {
    const id = `spn_${randomToken(12)}`;
    const now = this.now();
    await this.db
      .prepare(
        `INSERT INTO sponsors
           (id, slot, status, name, url, blurb, email, brand_color,
            logo_bytes, logo_type, created_at)
         VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.slot,
        input.name,
        input.url,
        input.blurb,
        input.email,
        input.brandColor ?? null,
        input.logo?.bytes ?? null,
        input.logo?.type ?? null,
        now,
      )
      .run();

    const created = await this.byId(id);
    if (!created) throw new Error('Sponsor draft insert returned no row');
    return created;
  }

  /**
   * Activate a draft. Returns false — and changes nothing — when another sponsor
   * already holds the slot, so a double checkout cannot evict a paying sponsor.
   */
  async activate(input: {
    id: string;
    subscriptionId: string | null;
    endsAt: number;
  }): Promise<boolean> {
    const now = this.now();
    const [, activated] = await this.db.batch([
      this.db
        .prepare(
          `UPDATE sponsors SET status = 'expired'
            WHERE status IN ('active', 'cancelled') AND ends_at IS NOT NULL AND ends_at <= ?`,
        )
        .bind(now),
      this.db
        .prepare(
          `UPDATE sponsors
              SET status = 'active',
                  starts_at = ?,
                  ends_at = ?,
                  dodo_subscription_id = COALESCE(dodo_subscription_id, ?)
            WHERE id = ?
              AND status = 'draft'
              AND NOT EXISTS (
                SELECT 1 FROM sponsors other
                 WHERE other.slot = sponsors.slot
                   AND other.id <> sponsors.id
                   AND other.status IN ('active', 'cancelled')
                   AND other.ends_at > ?
              )`,
        )
        .bind(now, input.endsAt, input.subscriptionId, input.id, now),
    ]);

    return (activated?.meta.changes ?? 0) > 0;
  }

  /** A recognised renewal extends the paid-through date, never shortens it. */
  async renew(subscriptionId: string, endsAt: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE sponsors
            SET ends_at = MAX(COALESCE(ends_at, 0), ?),
                status = CASE WHEN status = 'expired' THEN 'active' ELSE status END
          WHERE dodo_subscription_id = ?
            AND status IN ('active', 'cancelled', 'expired')`,
      )
      .bind(endsAt, subscriptionId)
      .run();
    return result.meta.changes > 0;
  }

  /** Cancellation keeps the card up until the already-paid term ends. */
  async cancel(subscriptionId: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE sponsors SET status = 'cancelled'
          WHERE dodo_subscription_id = ? AND status = 'active'`,
      )
      .bind(subscriptionId)
      .run();
    return result.meta.changes > 0;
  }

  /** Housekeeping; every read already filters on `ends_at`. */
  async expireDue(): Promise<number> {
    const result = await this.db
      .prepare(
        `UPDATE sponsors SET status = 'expired'
          WHERE status IN ('active', 'cancelled') AND ends_at IS NOT NULL AND ends_at <= ?`,
      )
      .bind(this.now())
      .run();
    return result.meta.changes;
  }

  /** Abandoned checkouts never become public, but they should not live forever. */
  async purgeDrafts(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
    const result = await this.db
      .prepare(`DELETE FROM sponsors WHERE status = 'draft' AND created_at <= ?`)
      .bind(this.now() - olderThanMs)
      .run();
    return result.meta.changes;
  }

  async logo(id: string): Promise<{ bytes: ArrayBuffer | Uint8Array; type: string } | undefined> {
    const row = await this.db
      .prepare(
        `SELECT logo_bytes, logo_type FROM sponsors
          WHERE id = ? AND logo_bytes IS NOT NULL
            AND status IN ('active', 'cancelled')`,
      )
      .bind(id)
      .first<{ logo_bytes: ArrayBuffer | Uint8Array; logo_type: string | null }>();
    if (!row?.logo_bytes) return undefined;
    return { bytes: row.logo_bytes, type: row.logo_type ?? 'image/png' };
  }
}
