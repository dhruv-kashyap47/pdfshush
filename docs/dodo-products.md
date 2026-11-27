# Dodo products: test and live

Dodo keeps test and live data completely separate. Product ids, API keys and
webhook secrets never cross, and `DODO_ENVIRONMENT` decides which API host the
Worker calls (`test.dodopayments.com` vs `live.dodopayments.com`).

Both sets were created through the Dodo MCP (`client.products.create`). Prices
are in USD cents.

## The seven products

| Rail | Env var | Test id | Live id | Price |
|---|---|---|---|---|
| Pro — Monthly | `DODO_PRODUCT_PRO_MONTHLY` | `pdt_0NspezoRyRyI4Mu41i6Ak` | `pdt_0NspqtQ1Yu9uiXZ6Q4ppY` | 600 / month |
| Pro — Yearly | `DODO_PRODUCT_PRO_YEARLY` | `pdt_0NspezqoXeiOYo0Ua7DgK` | `pdt_0NspqtS4SKo4v3qwdBVUi` | 4800 / year |
| 30-Day Pass | `DODO_PRODUCT_PASS_30D` | `pdt_0NspezsDNfSDVpNazP3pa` | `pdt_0NspqtUB97p5Zdcf3CA33` | 300 one-time |
| 1,000 AI Credits | `DODO_PRODUCT_CREDITS` | `pdt_0NspezuGKBTuOsC6Ymi01` | `pdt_0NspqtVTFlAPtXXWFkqAL` | 500 one-time |
| Donation | `DODO_PRODUCT_DONATE` | `pdt_0NspezvsnCg9Ltlh5oiXf` | `pdt_0NspqtXBlkuduR5i5Fj14` | 100 min, PWYW, suggested 500 |
| Sponsor — Featured | `DODO_PRODUCT_SPONSOR_FEATURED` | `pdt_0NspezwnSgFJMHTGUse49` | `pdt_0NspqtYEiWtbb55QMwxt6` | 3900 / month |
| Sponsor — Standard | `DODO_PRODUCT_SPONSOR_STANDARD` | `pdt_0Nspf0uSzqcsG4ilzeZKH` | `pdt_0NspqtaPwrSw1aWI3rjiJ` | 1900 / month |

Tax categories: the donation is `digital_products` and **tax-inclusive** (the
amount the donor types is the amount they pay). The other six are `saas` and
tax-exclusive, so the advertised price has tax added at checkout. If consumer
prices must be shown tax-inclusive in the EU, the UK or India, flip those six
with `client.products.update(id, { price: { ...price, tax_inclusive: true } })`
before launch; it affects future purchases only.

## Where each set is used

- **Local** (`pnpm dev:edge`) reads `<repo>/.dev.vars`, which overrides the
  `wrangler.jsonc` vars. That file holds the **test** ids and
  `DODO_ENVIRONMENT=test`, plus `WEB_ORIGIN=http://localhost:5173`.
- **Deployed** reads `wrangler.jsonc` only. It currently holds the **test** ids
  and `DODO_ENVIRONMENT=test`, so production answers `503 billing_disabled`
  until live secrets exist. That is deliberate.

## Live verification (2026-11-27)

Production was switched to this set on 2026-11-27.

- Worker version `4aefbbc1`, `DODO_ENVIRONMENT=live`, all seven live ids in
  `wrangler.jsonc`. The test ids moved to `<repo>/.dev.vars`, so local dev still
  uses test mode.
- Dashboard release `18c5d055` adds the customer dashboard, the stored customer
  id and the hosted billing portal. Migration `0005` was applied first.
- `DODO_API_KEY` and `DODO_WEBHOOK_SECRET` set as Worker secrets.
  `GET /api/sponsors` reports `billing.enabled: true`, and an unsigned POST to
  `/api/billing/webhook` answers `400 invalid_signature`.
- One real purchase: the $3 30-Day Pass, charged $3.54 including tax,
  payment `pay_0Nsr107WnveRWS1WiWlI4`. Production D1 then held `plan = pro`,
  `plan_expires_at = 2026-12-27`, `dodo_subscription_id = null`, and one
  `payment.succeeded` claim.

**Two operational notes from that test.**

1. A refund requested minutes after the payment failed with
   `409 Insufficient funds in wallet`; `balances.retrieveLedger` was empty
   because the sale had not settled. Refunds need a settled balance, so retry
   from the dashboard or the API after settlement. The paid access stays granted
   until the refund actually succeeds.
2. The Worker handles `payment.succeeded` and the subscription lifecycle but not
   `refund.succeeded`, so a successful refund does not revoke access. Until that
   handler exists, revoke a refunded term by hand in D1 (`plan`, `plan_expires_at`)
   or accept the access as a goodwill grant.

## Customer dashboard (2026-11-27)

The account page is a real dashboard now, not a settings dump.

- Migration `0005_billing_portal.sql` adds `accounts.dodo_customer_id`. It was
  applied to remote D1 **before** the Worker that reads it was deployed.
- The verified webhook writes the customer id once
  (`COALESCE(dodo_customer_id, ?)`) from `payment.*` and subscription events.
  The existing live account was backfilled from `pay_0Nsr107WnveRWS1WiWlI4`
  (`cus_0Nsr107T26BjFgUeGY2Oc`).
- `GET /api/account` now returns the plan, AI usage counters, synced history,
  billing flags and the current page of Dodo payments in one response. This is
  deliberate for the Free plan: one Worker request, one provider subrequest for
  paying customers, no extra routes on page load.
- `POST /api/billing/portal` creates a hosted Dodo customer portal session
  (signed in, CSRF checked) so the customer can update a card, download invoices
  or cancel. The Worker returns a short-lived link and keeps nothing.
- A signed-in donation now carries `metadata.account_id`, so the donor appears
  in the payment history and gets a Supporter state. A signed-out donation stays
  anonymous and still requires no account.
- AI usage is read from the same `quota_counters` keys that meter the messages,
  so the meter can never disagree with the next refusal.

Free plan footprint: one D1 column, two counter reads, one account row read and
one Dodo subrequest for a paying customer. No new Workers, cron, KV or R2
resources, and no paid-only APIs.

**Hardening from the review pass.**

- Deleting an account now cancels a live Dodo subscription first
  (`cancel_at_next_billing_date`). If the cancellation fails, the deletion is
  refused so a customer can never be charged for an account that no longer
  exists. A `404` from Dodo is treated as already gone.
- The portal route is rate limited to ten sessions an hour per address.
- Every new Dodo call has a timeout (checkout 10 s, payments 5 s, portal and
  cancel 10 s), so a hung provider cannot hold a Worker request.
- The usage meter clamps to the limit, including after a refused message that
  still increments the counter.
- `/api/account` returns a history *count*, not the rows. Export fetches the
  rows on demand, which keeps a dashboard load at one count query instead of up
  to 100 rows.
- Payment amounts use the currency's own minor-unit precision, so INR and USD
  show correctly and a zero-decimal currency would too.

## Go-live checklist

1. In `wrangler.jsonc`, replace the seven `DODO_PRODUCT_*` values with the live
   ids above and set `"DODO_ENVIRONMENT": "live"`.
2. Live-mode dashboard → **Developer → API Keys** → create a `dodo_live_` key.
3. `npx wrangler secret put DODO_API_KEY`
4. Live-mode dashboard → **Developer → Webhooks** → add
   `https://pdfshush.com/api/billing/webhook` with `payment.succeeded`,
   `subscription.active`, `subscription.renewed`, `subscription.cancelled` and
   `subscription.expired`. Copy the signing secret.
   Webhooks are not offered on the OAuth consent page, so this step is dashboard
   only — the CLI listener and the MCP both answer `403 webhooks:read`.
5. `npx wrangler secret put DODO_WEBHOOK_SECRET`
6. `pnpm deploy`
7. Buy the cheapest rail for real, confirm the entitlement, then refund it.
8. Leave the test ids in `.dev.vars`; local development keeps using them.
