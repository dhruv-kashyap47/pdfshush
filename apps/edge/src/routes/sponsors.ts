/**
 * The sponsor surface: public inventory, logo bytes, and a self-serve checkout.
 *
 * There is no ad network involved. A sponsor fills a form, pays Dodo, and the
 * webhook activates the row; the site then renders first-party markup. The
 * `sponsors` table never holds a script URL, which is why this feature cannot
 * widen the Content-Security-Policy.
 *
 * The checkout route is deliberately unauthenticated — a sponsor is a business,
 * not necessarily a pdfshush account — so it is validated hard and rate-limited
 * by address. Everything it creates is a `draft`, invisible until a signed
 * webhook says the money arrived.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../app-env.js';
import { D1SponsorStore, type DraftInput } from '../db/sponsor-store.js';
import { dodoConfig, createCheckout, productId } from '../billing/dodo.js';
import { fail, readJsonObject, sameOriginRequest, webOrigin } from '../lib/http.js';
import { underHourlyLimit } from '../lib/rate-limit.js';
import {
  SPONSOR_BLURB_MAX,
  SPONSOR_EMAIL_MAX,
  SPONSOR_LOGO_MAX_BYTES,
  SPONSOR_LOGO_TYPES,
  SPONSOR_NAME_MAX,
  SPONSOR_URL_MAX,
  sponsorSlot,
} from '../sponsors/catalog.js';

export const sponsorRoutes = new Hono<AppEnv>();

/** Five attempts an hour is generous for a purchase and stingy for a script. */
const CHECKOUT_PER_HOUR = 5;

/** Trim, collapse interior whitespace, and refuse control characters. */
function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || text.length > max) return undefined;
  return text;
}

/** `https:` only: no `javascript:`, no credentials, no localhost, no IP literal. */
function cleanUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > SPONSOR_URL_MAX) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) return undefined;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function cleanEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const email = value.trim();
  if (email.length > SPONSOR_EMAIL_MAX) return undefined;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : undefined;
}

function cleanColor(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) return undefined;
  return value.toLowerCase();
}

/** A base64 image data URL, decoded here so the row stores bytes, not markup. */
function cleanLogo(value: unknown): DraftInput['logo'] | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;

  const match = /^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!match) return undefined;
  const type = match[1]!.toLowerCase();
  if (!(SPONSOR_LOGO_TYPES as readonly string[]).includes(type)) return undefined;

  let binary: string;
  try {
    binary = atob(match[2]!);
  } catch {
    return undefined;
  }
  if (binary.length === 0 || binary.length > SPONSOR_LOGO_MAX_BYTES) return undefined;

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { bytes, type };
}

/* ----------------------------------------------------------- public read */

sponsorRoutes.get('/api/sponsors', async (c) => {
  const slots = await new D1SponsorStore(c.env.DB).slots();
  c.header('cache-control', 'public, max-age=60');
  return c.json({
    slots,
    billing: { enabled: dodoConfig(c.env) !== undefined },
  });
});

sponsorRoutes.get('/api/sponsors/:id/logo', async (c) => {
  const logo = await new D1SponsorStore(c.env.DB).logo(c.req.param('id'));
  if (!logo) return fail(c, 404, 'not_found', 'No such logo.');

  // An SVG opened directly must not be able to run anything or load a remote
  // resource. As an <img> the browser already refuses script; this covers the
  // navigation case too.
  return new Response(logo.bytes as BodyInit, {
    headers: {
      'content-type': logo.type,
      'cache-control': 'public, max-age=300',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    },
  });
});

/* --------------------------------------------------------------- checkout */

sponsorRoutes.post('/api/sponsors/checkout', async (c) => {
  const config = dodoConfig(c.env);
  if (!config) {
    return fail(
      c,
      503,
      'billing_disabled',
      'Sponsor checkout is not configured on this deployment. Email us to reserve a slot.',
    );
  }

  // A cross-site form post is refused. A missing Origin is allowed for
  // non-browser clients; a mismatched one is never a real sponsor.
  if (!sameOriginRequest(c)) {
    return fail(c, 403, 'origin', 'Cross-origin checkout is not allowed.');
  }

  if (!(await underHourlyLimit(c, 'sponsor:chk', CHECKOUT_PER_HOUR))) {
    return fail(c, 429, 'rate_limited', 'Too many checkout attempts. Try again in an hour.');
  }

  const body = await readJsonObject(c);
  const slot = sponsorSlot(body.slot);
  if (!slot) return fail(c, 400, 'validation_failed', 'Unknown sponsor slot.');

  const name = cleanText(body.name, SPONSOR_NAME_MAX);
  const url = cleanUrl(body.url);
  const blurb = cleanText(body.blurb, SPONSOR_BLURB_MAX);
  const email = cleanEmail(body.email);
  const brandColor = cleanColor(body.brandColor);
  const logo = cleanLogo(body.logo);

  if (!name) {
    return fail(c, 400, 'validation_failed', `Name must be 1-${SPONSOR_NAME_MAX} characters.`);
  }
  if (!url) {
    return fail(c, 400, 'validation_failed', 'Link must be a public https:// address.');
  }
  if (!blurb) {
    return fail(c, 400, 'validation_failed', `Description must be 1-${SPONSOR_BLURB_MAX} characters.`);
  }
  if (!email) {
    return fail(c, 400, 'validation_failed', 'A valid email is required for the receipt.');
  }
  if (brandColor === undefined) {
    return fail(c, 400, 'validation_failed', 'Brand colour must be a hex value like #2f9e6a.');
  }
  if (logo === undefined) {
    return fail(
      c,
      400,
      'validation_failed',
      `Logo must be a PNG, JPG, WebP or SVG under ${Math.round(SPONSOR_LOGO_MAX_BYTES / 1024)} KB.`,
    );
  }

  const product = productId(
    config,
    slot.id === 'featured' ? 'sponsor-featured' : 'sponsor-standard',
  );
  if (!product) {
    return fail(
      c,
      503,
      'billing_disabled',
      `The ${slot.label} slot has no Dodo product configured yet.`,
    );
  }

  const store = new D1SponsorStore(c.env.DB);
  const inventory = await store.slots();
  if (!inventory.find((entry) => entry.slot.id === slot.id)?.available) {
    return fail(c, 409, 'slot_taken', `The ${slot.label} slot is taken. Email us for the waitlist.`);
  }

  const draft = await store.createDraft({
    slot: slot.id,
    name,
    url,
    blurb,
    email,
    brandColor,
    logo,
  });

  const base = webOrigin(c.env, c.req.url);
  let checkout;
  try {
    checkout = await createCheckout(config, {
      productId: product,
      email,
      name,
      returnUrl: `${base}/sponsor?status=success&slot=${slot.id}`,
      cancelUrl: `${base}/sponsor?status=cancelled`,
      metadata: { kind: 'sponsor', sponsor_id: draft.id, slot: slot.id },
    });
  } catch (error) {
    console.error('dodo sponsor checkout failed', error);
    return fail(c, 502, 'billing_error', 'The payment provider did not answer. Try again.');
  }

  return c.json({ url: checkout.url, sponsorId: draft.id });
});
