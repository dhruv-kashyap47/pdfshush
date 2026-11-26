# Sponsorship and one-time payments

Decision record from 2026-11-26. **AdSense is gone.** This replaces it with a
model that does not contradict the product's one claim: a PDF tool should not
need your file, and a page about one should not need a tracking script.

## 1. Why AdSense was dropped

| Reason | Detail |
|---|---|
| Brand | "Your documents are nobody else's business" is hard to say next to a Google ad iframe. |
| Security posture | Ads need a widened CSP and a CMP. The strict `default-src 'self'` is a product feature, asserted by a test. |
| Economics | Utility and tool pages earn the low end of RPM; approval is a content judgement and not guaranteed. |
| Surface area | `ads.txt`, a certified CMP, consent mode, two CSP profiles, and a publisher account — for a revenue line the plan itself described as "under 15%". |

The honest framing did not change: **subscriptions are the business.** Ads were a
weak floor, and the floor was not worth the cost.

## 2. What replaced it

All of it is first-party. There is no ad network, no advertising script, no
iframe, no ad pixel, and **no CSP change for a sponsor**. The one third-party
script on the site is the owner's own page-view tag (GTM-W5QPVR3Z); a sponsor
cannot extend it, target it or add a script of its own.

| Rail | Price | Type | Surface |
|---|---|---|---|
| Pro | $6/mo · $48/yr | subscription | 500 managed AI messages/month, cloud sync, no sponsor cards |
| Sponsor — Featured | $39/mo (founding) | subscription | The home page, under the tool grid |
| Sponsor — Standard | $19/mo (founding) | subscription | The guides index, and the end of each published guide |
| 30-day pass | $3 | one-time | 30 days of Pro, no renewal |
| AI credit pack | $5 / 1,000 messages | one-time | Spent after the monthly Pro allowance is gone |
| Donation | any | one-time | Nothing. It buys nothing and changes nothing. |

Founding prices are locked for twelve months. Raise them after roughly 10k
sessions/month — not before. A $149 slot at 1k sessions is a $149 CPM, and nobody
buys that cold.

### What each rail is for

- **Sponsorship** scales with traffic and costs nothing to run. It is the rail
  that replaces ad revenue, but it earns ~$0 until there is traffic to sell.
- **Credit packs** are the only rail that can earn before traffic, because the
  buyer is already in the product and has just hit the cap. The upsell appears at
  the 429, not on a pricing page.
- **The 30-day pass** exists for people who will never start a subscription. It
  is a one-time SKU, not a discount on the subscription.
- **Donations** are a trust signal for an open-source project, not a plan.

## 3. Rules

1. **No third-party monetization script, ever.** A sponsor card is HTML this app
   renders, with its logo served from this origin at `/api/sponsors/:id/logo`.
2. **Pro never renders a sponsor card.** Not hidden — the card is not rendered at
   all. The gate is the effective plan from `/api/auth/me`.
3. **Allowlisted routes only.** Home, `/guides`, `/guides/:slug`. Never a tool
   workspace, a result, checkout, the account page, the verifier or status.
4. **Labelled.** Every card carries a `Sponsored` label, `rel="sponsored nofollow
   noopener noreferrer"`, and `target="_blank"`.
5. **Refused content.** Anything that uploads documents, imitates a download
   button, or misleads the reader. A sponsor that contradicts the product is
   refused regardless of price.
6. **No fake numbers.** The page does not invent traffic or claim an audience it
   does not have. The founding rate is cheap because the site is early.

## 4. How it is built

### Data

`apps/edge/migrations/0003_sponsors.sql`:

- `sponsors` — one row per purchase; `status` is `draft | active | cancelled |
  expired`. A partial unique index allows one live row per slot.
- `billing_events` — webhook idempotency, keyed by the Standard Webhooks message
  id. The claim is taken before the side effect; a failure releases it so a retry
  can succeed.
- `accounts.plan_expires_at` — `NULL` means "no end date" (a manual grant).
- `accounts.credit_messages` — one-time AI messages.

### Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/sponsors` | none | Public inventory + whether billing is configured. 60 s cache. |
| `GET` | `/api/sponsors/:id/logo` | none | Live sponsors only. `nosniff`, 5 min cache, locked-down CSP. |
| `POST` | `/api/sponsors/checkout` | none | Validates, rate-limits by address, creates a draft, returns a Dodo URL. |
| `POST` | `/api/billing/credits` | session + CSRF | 1,000 messages. |
| `POST` | `/api/billing/pass` | session + CSRF | 30 days. |
| `POST` | `/api/billing/donate` | none | Pay-what-you-want; email required for the receipt. |
| `POST` | `/api/billing/webhook` | Dodo signature | The only place money becomes an entitlement. |

### Webhook behaviour

| Event | Effect |
|---|---|
| `subscription.active` | Activate the draft named in `metadata.sponsor_id`; `ends_at` = `next_billing_date` or +31 days. |
| `subscription.renewed` | Extend `ends_at`, never shorten it. |
| `subscription.cancelled` | Mark `cancelled`; the card stays up until the paid term ends. |
| `payment.succeeded` | `kind: credits` → grant messages; `kind: pass` → extend Pro. Otherwise acknowledged and ignored. |

A retried delivery is acknowledged with `{ duplicate: true }` and applies
nothing.

### What the AI meter does

`spendAiMessage` checks the monthly Pro allowance first, then a credit pack, then
refuses. The refusals read:

- 500 used, no credits: *"A credit pack adds 1,000 more, or your allowance
  resumes next month."*
- Deployment-wide cap: unchanged.

`spendCredit` is a single conditional `UPDATE ... WHERE credit_messages > 0`, so
two concurrent messages cannot take the last credit twice.

## 5. Dodo Payments setup

Dodo is the merchant of record: it collects the money, handles tax, and sends the
receipt. No card data reaches this Worker.

Create five products in the Dodo dashboard, then set the non-secret ids as
Worker vars:

```bash
npx wrangler secret put DODO_API_KEY          # test key first
npx wrangler secret put DODO_WEBHOOK_SECRET   # whsec_...
```

```jsonc
// wrangler.jsonc → vars
"DODO_ENVIRONMENT": "test",
"DODO_PRODUCT_SPONSOR_FEATURED": "pdt_...",
"DODO_PRODUCT_SPONSOR_STANDARD": "pdt_...",
"DODO_PRODUCT_CREDITS": "pdt_...",
"DODO_PRODUCT_PASS_30D": "pdt_...",
"DODO_PRODUCT_DONATE": "pdt_..."      // pay-what-you-want must be enabled
```

Product settings that matter:

- **Sponsor products:** recurring, monthly. Metadata is set by the checkout call,
  not in the dashboard.
- **Credit pack:** one-time, 1,000 units.
- **30-day pass:** one-time.
- **Donation:** one-time, pay-what-you-want enabled. The server sends `amount` in
  cents.

Point the webhook at `https://<origin>/api/billing/webhook` and subscribe to
`subscription.active`, `subscription.renewed`, `subscription.cancelled` and
`payment.succeeded`.

**Missing anything switches the rail off.** With no `DODO_API_KEY`, every billing
route answers `503 billing_disabled` and the page shows an email address instead
of a broken button. A missing or non-`live` `DODO_ENVIRONMENT` means test mode, so
a typo cannot charge a real card.

## 6. Operating notes

- **Cancellations:** Dodo owns the customer portal. The card comes down when
  `ends_at` passes; the hourly cron flips `cancelled` → `expired`.
- **Slot races:** checkout refuses a slot that is already held, and activation
  re-checks inside a batch. If two payments land for one slot anyway, the second
  row stays `draft` and needs a manual refund — the log line is
  `sponsor activation refused`.
- **Abandoned checkouts:** drafts older than 24 hours are deleted by the cron.
- **Logo limits:** 64 KB, PNG/JPG/WebP/SVG. SVG is served with
  `default-src 'none'` so a direct navigation cannot execute anything.
- **Draft rows are never public.** Only `active` and `cancelled` with a future
  `ends_at` are returned by the public endpoint.

## 7. What "working" looks like

| Metric | Target | Note |
|---|---|---|
| Sponsor slots sold | 2 of 2 by month 6 | Two is the whole inventory; a waitlist is the signal to add more |
| Sponsor revenue | covers domain + AI credits | ~$58/month at founding rates |
| Credit pack attach | 5% of accounts that hit the 429 | The only pre-traffic revenue |
| Donations | any | A trust signal, not a line item |
| Pro conversion | 1% of signed-in users | Still the business |

The order that matters: **publish the guides, then sell the slots.** Sponsorship
is the better model than AdSense at equal traffic, but it is still a
traffic-shaped business. At under 1k sessions, the correct expectation for every
rail in this document is roughly zero — and the correct work is the content that
changes that.
