# What we built, what's next, and how to run the AI

**Last updated:** 2026-11-27
**Read this first if:** you are picking the project back up after a break.

---

## Where we are, in one paragraph

The website is live at **https://pdfshush.com** and every PDF tool runs in the
visitor's browser. The product is **Cloudflare-only**: one Worker on the free
tier handles sign-in, cloud sync, the AI trial and payments, and it costs $0 at
your traffic. The Express/BullMQ/Redis/Mongo server tier has been archived in
`archive/` for a later paid tier. The Worker and D1 are deployed, **accounts,
the managed AI trial and the paid rails are live**: seven live Dodo products,
`/pricing`, the membership dashboard and the hosted billing portal. Refunds and
disputes now revoke the entitlement they paid for instead of leaving access
behind. The 20 guides are published and the sitemap carries 92 URLs. AdSense is
gone by decision; sponsorship and the one-time rails are switchable now that
Dodo is configured. Nothing is broken; the remaining work is verification,
monitoring and growth.

**Latest (2026-11-27, later):** a payment-safety pass closed the last revenue
hole. `refund.succeeded` and the dispute lifecycle are handled from a signed
webhook plus a `billing_payments` ledger, so a full refund takes back exactly
what one payment granted, a partial refund keeps access, and a refund that
arrives before its payment cannot be followed by a grant. The webhook body is
bounded, checkout creation is rate-limited per account and address, the paid
product is compared with the checkout metadata, and receipt links are restricted
to `https:`. Shipped as Worker `e7df7e58-4927-4f26-8e0c-b9ca2724858d` after
migration `0006`; production smoke and reach are green with 93 sitemap URLs.
See `PLAN.md` §48.

**Latest (2026-11-27):** the Dodo rails went **live**. The seven live products
replaced the test ids in `wrangler.jsonc`, `DODO_ENVIRONMENT=live`, the live API
key and webhook secret are Worker secrets, and one real $3 pass was purchased and
granted. The membership dashboard, AI usage meter and hosted portal shipped in
the same release. See `docs/dodo-products.md`.

**Latest (2026-11-26):** the Dodo billing rails, the consent-gated measurement
tag and the 20 published guides shipped as Worker
`2bcd75e8-9dc3-4fff-9dc8-f35819af587a`, after migration `0004` was applied to
the remote D1. Production `test:e2e` and `test:e2e:reach` are green with 92
sitemap URLs. See `PLAN.md` §46-47.

---

## 1. What we built (plain English)

| Thing | What it means | State |
|---|---|---|
| Server tier | Express API + BullMQ + Redis + Mongo + MCP, kept for a later paid tier | **Archived** in `archive/`, tag `server-tier-v1` |
| Free backend | A Cloudflare Worker serving the site and `/api` from one address | **Deployed** |
| Accounts | Google sign-in, stored in Cloudflare D1 (not MongoDB) | **Live** (OIDC on D1) |
| Cloud sync | Preferences, history, workflows saved per account | **Live** for signed-in accounts |
| AI proxy | Your OpenRouter key stays on the server; visitors never see it | **On** (managed trial; BYOK always) |
| Plans | Free = 3 AI messages/day. Pro = 500/month, cloud sync, no sponsor cards | **Live** ($6/mo, $48/yr) |
| Guides | `/guides` plus 20 articles (~39,000 words) | **Live** (2026-11-26) |
| Measurement | One Google Tag Manager container; opt-in in the EEA/UK, off switch in the footer | **Live** with consent gate |
| Sponsorship | Two first-party slots ($39 + $19/mo, founding). No ad network, no CSP change | **Live**, self-serve checkout |
| One-time rails | 30-day pass, AI credit pack, donation | **Live** |
| Refunds / disputes | Full refund or a lost dispute revokes the paid grant; partial refunds keep it | **Handled** (2026-11-27) |
| Capability switch | The site hides features a deployment cannot run | Built |
| Audit / CI | Repository audit, licence ledger, CI recovery and browser gates | **Done 2026-11-26** (1 586 unit tests; 29 E2E suites) |

Two rules that shaped everything:

1. **The 51 PDF tools never upload anything.** Only the AI panel sends text, and
   the site says so.
2. **Free is not a trial.** It is a real, permanent tier funded by Pro and
   sponsorships, with a limited AI allowance.

---

## 2. How to enable and manage the AI

**Status: live in production** (verified 2026-11-26: `/api/tools` reports
`ai.enabled: true`). The steps below are for a fresh deployment or a key
rotation, not a pending launch task.

This is the part that earns money, so it is worth doing carefully.

### 2.1 Before you start

1. Create an account at **openrouter.ai**.
2. **Buy 10 credits once (~$10).** This is not optional. Below 10 credits
   OpenRouter allows **50 free-model requests per day for your whole account**.
   At 10+ it is **1,000/day**. Without it, the site runs out before lunch.
3. Create an API key (`sk-or-v1-…`).

### 2.2 Turn it on (or rotate the key)

```bash
# 1. Store the key as a Worker secret (never in a file)
npx wrangler secret put AI_MANAGED_API_KEY

# 2. Pick a model in wrangler.jsonc
#    "AI_MANAGED_MODEL": "deepseek/deepseek-chat-v3:free"

# 3. Deploy
npx wrangler deploy

# 4. Check it answered
curl -s https://pdfshush.com/api/tools
```

The response should contain:

```json
"ai": { "enabled": true, "limits": { "anonymousPerDay": 3, "proPerMonth": 500 } }
```

If `enabled` is `false`, either the key or the model is missing. Both must be
present; an empty model is how you switch AI off.

### 2.3 Test it like a user

1. Open a PDF tool that has the AI panel.
2. Send one message. It should stream back.
3. Send three. The fourth should say you have used today's messages.
4. Sign in with Google. You get 3 more per day as a free account.

### 2.4 Change the model

One line in `wrangler.jsonc`, then deploy. Any OpenRouter model id works:

```jsonc
"AI_MANAGED_MODEL": "deepseek/deepseek-chat-v3:free"     // free, fine for the trial
"AI_MANAGED_MODEL": "openai/gpt-4o-mini"                  // cheap and reliable
"AI_MANAGED_MODEL": "google/gemini-2.5-flash"             // cheap and fast
```

**The honest recommendation:** free models for the anonymous trial, a cheap paid
model for Pro. Free models are shared capacity — they queue and sometimes
disappear. Paying customers should not meet that.

### 2.5 Change the limits

All of them live in `apps/edge/src/ai/budget.ts`:

```ts
export const AI_LIMITS = {
  anonymousPerDay: 3,        // taste of the feature
  proPerMonth: 500,          // what the $6 buys
  proPerDay: 60,             // stops one afternoon burning the month
  anonymousGlobalPerDay: 700, // of OpenRouter's 1,000
  proGlobalPerDay: 200,       // reserved so Pro is never starved
};
```

The two global numbers must add up to **less than 1,000** while you are on free
models. That is the whole reason they exist.

### 2.6 Give someone Pro (before payments exist)

```bash
npx wrangler d1 execute pdfshush --remote \
  --command "UPDATE accounts SET plan='pro' WHERE email='customer@example.com'"
```

To take it away: same command with `plan='free'`.

### 2.7 Watch the cost

- OpenRouter dashboard → Activity shows spend per day.
- `curl https://openrouter.ai/api/v1/key -H "Authorization: Bearer $KEY"`
  returns `usage_daily`, `limit_remaining` and the free-model daily counter.
- `npx wrangler tail` streams live errors from the Worker.

### 2.8 Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| `503 ai_disabled` | No key, or no model | Set both |
| `429 ai_budget` | This person hit their daily/monthly cap | Expected; they wait or upgrade |
| `429 ai_capacity` | The whole site hit today's global cap | Check the OpenRouter daily counter |
| SSE `error: HTTP 401` | The key is wrong or revoked | New key, `wrangler secret put` again |
| `402` or `403` inside the error | OpenRouter credits or budget | Add credits / raise the key limit |
| Panel does not appear at all | The site was built with `VITE_SERVER_API=off` | Rebuild with `on` |
| 500 errors | Unhandled exception | `npx wrangler tail` and read the message |

### 2.9 Turn it off

Set `"AI_MANAGED_MODEL": ""` and deploy. The panel disappears, `/api/ai/*`
answers 503, and every other feature keeps working. This is the safe switch if
costs ever surprise you.

---

## 3. What's left, as sprints

A sprint here is **one focused block of work**, not a calendar week. Finish it,
tick the boxes, move on. Each one is independent enough to stop after.

### Sprint 0 — Archive the server tier — done 2026-11-26

**Why:** no servers, no monthly bill. One Worker and D1 cover everything the
product actually needs.

- [x] Tag the pre-cut commit `server-tier-v1`
- [x] Move `apps/api`, `apps/mcp`, `api-contracts`, Docker/infra, server tests
      and server-only docs into `archive/`
- [x] Remove Redis/Mongo/Docker from `pnpm dev`, the workspace and CI
- [x] Point the web dev proxy and E2E preflight at the Worker on `:8787`
- [x] Verify: typecheck, 1 586 unit tests, build, bundle, guardrails, SEO

**Done when:** the active workspace builds and tests without a server. ✅

### Sprint 1 — Publish the guides — done 2026-11-26

**Why:** the guides are the traffic engine. Sponsorship only becomes sellable once
there are pages for search to send people to; nothing else on this list changes
that.

- [x] Read all 20 files in `apps/web/src/content/guides/`
- [x] Replace the "NEEDS HUMAN EDIT" notes with copy that holds up: no invented
      screenshots, no measured numbers, no legal advice
- [x] Change `draft: true` to `draft: false`
- [x] `pnpm --filter @pdfshush/web guides:check` → **OK: 20**
- [x] Build and confirm the 20 pages exist in `dist/guides/` (104 prerendered
      routes, 92 sitemap URLs, SEO audit PASS)
- [ ] Submit `/guides` and each article in Search Console

**Done when:** 20 articles are live, indexed, and each links to its tool. The
last box is an operator step in Search Console, not code.

### Sprint 2 — Deploy the free backend

**Why:** accounts, sync and AI do not exist in production until this happens.

- [x] `npx wrangler d1 create pdfshush` → id in `wrangler.jsonc`
- [x] `npx wrangler d1 migrations apply pdfshush --remote`
- [x] Add Google secrets + the AI key
      (verified 2026-11-26: `/api/tools` reports `accounts.enabled: true` and
      `ai.enabled: true`)
- [x] `GOOGLE_REDIRECT_URI` set to `https://pdfshush.com/api/auth/callback`
      (still register the same URL in Google Cloud Console)
- [x] `npx wrangler deploy` to the `pdfshush.com` custom domain
      (`workers.dev` is deliberately disabled)
- [ ] Sign in, sync history, delete the account — all three must work

**Done when:** sign-in works on `pdfshush.com` and the data survives a reload.

### Sprint 3 — Switch the website on

**Why:** the build is Worker-connected and the archived surfaces are hidden;
what remains is proving the account and AI paths with real secrets.

- [x] Per-feature capability switch (`apps/web/src/lib/capabilities.ts`)
- [x] Hide Workflows / API / MCP in the header, hero and catalog; keep honest
      permanent pages instead of dead links
- [x] Build with `VITE_SERVER_API=on`
- [x] Confirm the AI panel appears after `AI_MANAGED_API_KEY` is set
      (the client gates on `/api/tools`; `ai.enabled: true` on 2026-11-26)
- [x] Point `pdfshush.com` at the Worker (the single custom domain;
      `workers.dev` is disabled)

**Done when:** the AI half is confirmed by `/api/tools`; the interactive Google
round-trip is the one manual check worth doing before announcing accounts. The
server-side switch is live, so the panel appears.

### Sprint 3.5 — Audit, CI and licence close-out — done 2026-11-26

**Why:** the production deploy exposed a failing browser gate and a stale profile
photo; the pre-launch audit also needed a licence ledger and a clean dependency
inventory.

- [x] Fix the cross-browser 502: preview no longer proxies `/api` to an absent
      Worker, and the gate probes `/api/health` and names the failing URL
- [x] Fix the profile photo: CSP avatar origin, `picture`/`avatar_url`
      normalisation, initials fallback and `?auth=success` refresh
- [x] Harden malformed-cookie parsing, blocked IndexedDB upgrades, private API
      caching and the AI client identity
- [x] Add `NOTICE` + `THIRD_PARTY_LICENSES.md` + the generated dependency
      notices; record GenOffice, React Bits, fonts and bundled engine data
- [x] Run the gates: 1 586 unit tests + 1 expected fail, build/bundle,
      guardrails/provenance/deploy-config, all 29 `test:e2e:*` suites, perf
- [x] Redeploy: Worker `b6bde10b-1e27-44f4-8e6a-13d4aa1fa9ad` on
      `pdfshush.com`; audit close `ada18b3` on both branches
- [ ] Owner decisions: React Bits Commons Clause, hero-image provenance, four
      MIT packages without a licence file, linter/formatter choice

**Done when:** CI is green, production is redeployed, and the only remaining
items are decisions rather than code. ✅ (tracked in `PLAN.md` §45)

### Sprint 4 — Payments (Dodo) — live 2026-11-27

**Why:** this is the actual revenue. Every paid rail shares one Dodo account and
one webhook: Pro, the two sponsor slots, the 30-day pass, credit packs and
donations.

**Built:** `/api/billing/pro` (monthly and yearly recurring), `/api/billing/credits`,
`/api/billing/pass`, `/api/billing/donate`, `/api/billing/webhook` (Standard
Webhooks verification + `billing_events` idempotency), credit spending after the
monthly cap, and the account-page buy buttons. The Pro rail landed in this sprint:
until then `subscription.active` only looked for a `sponsor_id`, so a Pro
subscriber would have paid and received nothing.

The subscription lifecycle is now explicit:

| Event | Effect |
|---|---|
| `subscription.active` | `plan = 'pro'`, term from `next_billing_date`, Dodo subscription id stored on the account |
| `subscription.renewed` | term moves forward, matched by the stored subscription id |
| `subscription.cancelled` | nothing changes; access runs to the paid-through date |
| `subscription.expired` | `plan = 'free'` immediately |
| `payment.succeeded` (kind `pro`) | fallback activation if it lands before `subscription.active` |
| `refund.succeeded` | a full refund ends the grant that payment bought; a partial refund keeps it |
| `dispute.opened` / `won` / `cancelled` | access is held while the case is open and restored if the merchant wins or the customer withdraws |

`plan_expires_at` is the single source of truth, so a pass, a manual grant and a
subscription all write the same column and the hourly cron is the only sweep.

**Refund and dispute safety (2026-11-27).** `billing_payments` records what each
payment granted (`credits`, `previous_expires_at`, `granted_until`). A full
refund reverses exactly that grant: credits are removed up to the amount the pack
added, a pass restores the term before it, a subscription payment restores the
previous paid month, and a sponsor payment hides the card and frees the slot. A
refund that arrives before its payment marks the ledger first, so the later
payment cannot grant. The webhook is also bounded to 256 KiB, checkout creation
is capped at ten an hour per account and thirty per address, and the paid product
is compared with the checkout metadata.

**Verified locally:**

- The edge suite runs the real migrations through `node:sqlite` and calls
  `app.fetch()` — no mock of the schema. 75 tests as of 2026-11-27.
- Signed webhooks prove activation, renewal, cancellation-still-Pro, expiry,
  credit grants (once, and capped at 50 000), the 30-day pass, a donation
  granting nothing, full and partial refunds, disputes, replay, forged
  signatures, product mismatch, an oversized body and the checkout limiter.
- A replayed webhook id is acknowledged as `duplicate` and grants nothing twice.
- A forged signature is `400`; a subscription owned by another account fails
  closed with `500` and releases its claim so the retry can succeed.
- An unconfigured deployment answers `503 billing_disabled` on every rail.
- The same flow was re-run against `wrangler dev` + local D1 (`workerd`, not
  just `app.fetch()`): activation flips the row, replay is a duplicate, forged
  and stale signatures are refused, and a fixture API key produces a translated
  `502` with Dodo's own `401` in the log.

**Go-live record (2026-11-27):**

- [x] Create the seven products in Dodo, test and live mode; ids are in
      `docs/dodo-products.md`
- [x] `npx wrangler secret put DODO_API_KEY` and `DODO_WEBHOOK_SECRET`
- [x] Put the seven live product ids in `wrangler.jsonc` and set
      `DODO_ENVIRONMENT=live`
- [x] `npx wrangler d1 migrations apply pdfshush --remote` (migrations `0004`
      and `0005`)
- [x] Point the webhook at `/api/billing/webhook` and subscribe to
      `subscription.active`, `subscription.renewed`, `subscription.cancelled`,
      `subscription.expired`, `payment.succeeded`
- [x] One real purchase: the $3 pass granted Pro (`pay_0Nsr107WnveRWS1WiWlI4`)
- [ ] **Add `refund.succeeded`, `refund.failed` and `dispute.opened`,
      `dispute.challenged`, `dispute.won`, `dispute.cancelled`,
      `dispute.accepted`, `dispute.lost`, `dispute.expired` to the webhook's
      event list in the Dodo dashboard.** The code handles them; an endpoint
      that is not subscribed never receives them. Webhooks cannot be changed
      over OAuth, so this is a dashboard-only step.
- [ ] Buy one of each remaining live rail (Pro monthly, Pro yearly, credits,
      donation, both sponsors) and confirm the entitlement, then refund after
      settlement
- [ ] Decide whether a full subscription refund should also cancel the Dodo
      subscription. The Worker revokes access but does not cancel; cancel it in
      the dashboard when the refund ends the relationship.

**Done when:** paying flips the entitlement within seconds, cancelling eventually
flips it back, a refund takes the grant back, and an unconfigured deployment
still answers `503` instead of showing a broken button.

### Sprint 5 — Sponsorship — live 2026-11-27

**Why:** the replacement for AdSense, and the only revenue rail that scales with
traffic. Do it after payments, not before.

**Built:** `/sponsor`, the two-slot inventory, self-serve checkout, logo storage
in D1, the sponsor card on home/guides/article-end, the Pro gate and the
`default-src 'self'` CSP proof. The checklist below is verification and launch.

- [ ] Read `docs/SPONSORSHIP.md`
- [ ] Confirm both slots read "Open" on `/sponsor`
- [ ] Buy one slot live and confirm the card appears on the home page within a
      minute
- [ ] Confirm a Pro account renders no card at all
- [x] Confirm the CSP is unchanged (`default-src 'self'`, no Google origins) —
      asserted by `apps/web/src/lib/csp.test.ts`
- [ ] Publish the page in Search Console; link it from the footer (already done)

**Done when:** a stranger can pay for a slot without an email, and the card is
live on the right page and nowhere else.

### Sprint 6 — Growth

**Why:** neither sponsorship nor subscriptions matter without traffic.

- [x] Add page-view measurement: one Google Tag Manager container, opt-in in the
      EEA/UK, and a footer off switch that works everywhere
- [ ] Decide whether to ask every visitor for consent or keep the EEA/UK-only gate
- [ ] Publish 20 more guides around the queries that already get impressions
- [ ] Add internal links: tool → guide → guide → tool
- [ ] Measure: which pages convert to sign-in, which convert to Pro
- [ ] Kill the pages that get traffic and convert nobody

**Done when:** you can answer "which article earns money?" from data.

### Sprint 7 — Operational polish

**Why:** cheap now, expensive later.

- [ ] Uptime check on `/api/health` with an alert
- [ ] D1 backup/export weekly (accounts are the only irreplaceable data)
- [ ] Worker error alerting (`wrangler tail` is not monitoring)
- [x] Add a test for the AI meter rollover (`apps/edge/test/usage.test.ts`)
- [ ] Add a test for the guide route's hook split
- [ ] Document the "turn AI off" switch in the README

**Done when:** a failure pages you before a customer emails.

---

## 4. Suggested order

```
Sprint 0 (archive) ──► Sprint 1 (content) ──► Sprint 2 (deploy) ──► Sprint 3 (switch on)
                                                                        │
                                                        Sprint 3.5 (audit) ✅
                                                                        │
                                                        ├──► Sprint 4 (payments)
                                                        └──► Sprint 5 (sponsorship)
                                                                   │
                                                          Sprint 6 (growth)
                                                                   │
                                                          Sprint 7 (polish)
```

Sprint 1 and Sprint 2 can run in parallel: one is writing, one is accounts.
Sprint 3.5 is complete; only its owner decisions remain.

---

## 5. Rules we do not break

1. **No servers.** The active product runs in the browser and on one Cloudflare
   Worker + D1. The archived Express/Redis/Mongo tier is not a fallback.
2. **No third-party monetization script, ever.** A sponsor card is first-party
   markup with a same-origin logo; the CSP stays `default-src 'self'`.
3. **Pro never renders a sponsor card.** Not hidden — the card is not rendered.
4. **Drafts never reach production.** The build enforces it, not discipline.
5. **The 51 tools never upload.** Only the AI panel does, and it says so.
6. **No secrets in the repo.** Keys go through `wrangler secret`.
7. **No dark patterns.** No fake download buttons, no ads next to a real one, no
   ad-blocker wall.

---

## 6. Useful commands

```bash
# website (all tools work with no backend)
pnpm dev
pnpm test
pnpm build
pnpm --filter @pdfshush/web guides:status
pnpm --filter @pdfshush/web guides:check

# Worker (optional: accounts, sync, managed AI, billing)
pnpm dev:edge
pnpm --filter @pdfshush/edge typecheck
pnpm db:local
pnpm db:remote
pnpm deploy
npx wrangler tail

# quality gates that must stay green
pnpm typecheck
pnpm test
pnpm test:bundle
pnpm test:guardrails
pnpm seo:audit
```
