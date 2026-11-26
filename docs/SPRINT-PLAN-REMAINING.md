# Remaining work → sprint plan (2026-11-24, post-deploy reality)

> **2026-11-26 update: the server tier is archived.** `apps/api`, BullMQ/Redis,
> Mongo, Docker, the REST API and MCP now live in `archive/` (tag
> `server-tier-v1`). The active product is one Cloudflare Worker + Static Assets
> + D1. Sprints 11–12 below are historical and will not run; the current plan is
> [`WHATS-NEXT.md`](./WHATS-NEXT.md).
>
> This replaces the earlier ship-first draft. Production is already live at
> `https://pdfshush.space`, all 63 `reaTask.md` cards are closed, and the
> production smoke + sign suites are green. The remaining work is the public
> launch surface, hardening evidence, and monetization decisions — not the
> editor or engine.
>
> **2026-11-26:** the monetization decision landed. AdSense is dropped, Dodo
> Payments replaces Stripe, and the rails run on the existing free Worker tier.
> See Sprint 14 below and [`SPONSORSHIP.md`](./SPONSORSHIP.md).

## 0. Verified state (2026-11-24)

**Sprint 8 is complete.** The five policy routes are live on
`https://pdfshush.space` (Worker `54210160-c9b5-4a57-a43f-e6f3d9a82127`), with
68 prerendered routes / 60 sitemap URLs. Production `reach`, `smoke`, `a11y`,
`offline` and `sign` all pass.

**Sprint 9 is complete with one documented exception.** Docker 29.8.2 ran the
local stack: `test:api` ALL CHECKS PASSED (21 checks), `test:hardening` GATE
PASSED (SIGKILL, janitor, quota, recovery). The linearized-PDF fixture remains
an explicit `CORPUS_GAPS` exception because no honest generator is installed.

**Sprint 10 is decided: ship static.** The server tier stays parked; M6.3–M6.6,
ads, R2, P4.4 and vector signatures are future decisions, not unfinished launch
work. **Tracked development is complete.**

| Item | State |
| --- | --- |
| `origin/main` / `origin/rea-uplift` | `a8b0cf4`, identical |
| Production | `https://pdfshush.space`, Cloudflare Workers + Static Assets |
| Production smoke | **ALL CHECKS PASSED** (89 mega-menu links, all tools, editor, redaction, no console errors) |
| Production sign E2E | **18/18 green**, including “the manage page saves a signature” |
| Cloudflare Wrangler | authenticated as `7468dhruv@gmail.com` (account `c50c0cc04ad6e0bfea4db65b2b615b69`) |
| reaTask | **63/63 cards `[x]`**; Gate D met for the documented scope |
| `PLAN.md` P7 | only recorded corpus gap is a linearized fixture; container gates depend on Docker |
| Docker daemon | **available**; engine 29.8.2. `test:api` 21 checks + §6 skip; `test:hardening` GATE PASSED on 2026-11-24 |

## 1. Actual remaining work

### A. Public launch surface (Sprint 8)

The site is live but the policy surface is still marked “soon”:

- `/privacy`, `/terms`, `/about`, `/contact`, `/status` are **not real routes**.
  The SPA fallback answers them with the home shell and a 200; the footer marks
  About/Contact/Status/Pricing as “soon” and Terms as “soon”.
- The footer’s legal links need real destinations.
- Prerender entries, sitemap entries and canonicals are missing for those pages.
- A production `reach`/`a11y` pass after the pages land.

### B. Hardening evidence (Sprint 9)

- Docker daemon off: `pnpm test:api` and `pnpm test:hardening` are unclaimed.
- `tests/support/corpus.mjs` records one honest gap: **linearized PDF** (no
  qpdf/Ghostscript in this environment).
- P7.1’s other named edges (10k-page, broken-font) are covered by the closed
  G-02/corpus work; verify rather than rebuild.

### C. Revenue track (Sprints 10–12, decision-gated)

- **M6.1b** server tier: API + BullMQ worker + Redis + Mongo on a persistent host.
  Parked under the ₹0/no-card constraint.
- **M6.3** plan catalog + entitlements + usage ledger + global budget breaker.
- **M6.4** Stripe test mode; **M6.5** `/pricing`.
- **M6.6** ads/CMP/two CSP profiles — optional.

Nothing in this track can honestly ship while the server tier is parked: managed
AI, API volume and priority queue are server features.

### D. Decisions and optional work (Sprint 13)

- R2 native text-preserving redaction: R1 now has a production path, but it still
  needs a dedicated production proof and a separate security gate.
- P4.4 automated triggers: still gated on SSRF/idempotent scheduling.
- Physical iOS/Android pass; Playwright WebKit’s missing OffscreenCanvas remains a
  recorded test-environment limit.
- Vector signatures: only with a round-trip fidelity test.

---

## Sprint 8 — LAUNCH SURFACE (P0, 1–2 days) — ✅ DONE 2026-11-24

**Goal:** the live site has a complete, truthful public surface.

| ID | Task | Done when |
| --- | --- | --- |
| S8.1 | Add real `/privacy`, `/terms`, `/about`, `/contact`, `/status` routes | Each renders its own page with a unique `<h1>`, title, description and canonical; no placeholder copy |
| S8.2 | Wire the footer and mobile header | About, Contact, Status, Privacy and Terms link to real routes; “soon” labels removed from live pages |
| S8.3 | Prerender and sitemap | Each route is in `apps/web/build/prerender.ts` routes, has static HTML and appears once in `sitemap.xml` |
| S8.4 | Build, deploy and verify | `pnpm typecheck`, relevant tests, `pnpm build`, `pnpm test:bundle`; `npx wrangler deploy`; `E2E_BASE_URL=https://pdfshush.space pnpm test:e2e:reach` and `pnpm test:e2e` green |
| S8.5 | Record | `PLAN.md`/`reaTask.md` updated with the deployed worker version and route evidence |

**Exit gate:** all five routes answer 200 with their own prerendered content;
footer has no dead legal link; production smoke/reach green.

---

## Sprint 9 — EVIDENCE CLOSE (P0/P1, 1–2 days) — ✅ DONE 2026-11-24

**Goal:** close the remaining unclaimed hardening evidence.

| ID | Task | Done when |
| --- | --- | --- |
| S9.1 | Run the container gates | Start Docker Desktop; `docker compose up -d --build`; `pnpm test:api` and `pnpm test:hardening` pass with counts recorded |
| S9.2 | Linearized fixture | Add a real linearized PDF or record a dated, explicit decision that the gap stays open; do not fabricate a dictionary |
| S9.3 | Verify P7.1 edges | Confirm 10k-page and broken-font coverage from the closed corpus; update `CORPUS_GAPS`/`PLAN.md` so no stale gap remains |
| S9.4 | Live quality pass | `reach`, `offline`, `a11y`, `keyboard` and `verify` against production; no console errors |
| S9.5 | Close P7.1 | `PLAN.md` P7 status reflects measured evidence, not prose |

**Exit gate:** no “unrun” hardening gate is claimed; P7.1 is either closed or has
one dated, explicit exception.

**Evidence:** `pnpm test:api` → ALL CHECKS PASSED (21; §6 skipped without Mongo
accounts). `pnpm test:hardening` → GATE PASSED with `FILE_TTL_MS=20000` and
`JANITOR_INTERVAL_MS=5000` after a real SIGKILL. The linearized fixture remains
the one dated exception in `tests/support/corpus.mjs`.

---

## Sprint 10 — DECISION GATE (owner, ~half a day) — ✅ DECIDED 2026-11-24

**Decision: ship static now.** The server tier stays parked. M6.3–M6.6 are
deliberately deferred; no pricing page and no ad surface ship. R2, P4.4 and
vector signatures remain separate future gates.

> **Superseded on 2026-11-26.** AdSense is dropped, Stripe is replaced by Dodo
> Payments, and the monetization rails that remain — two sponsor slots, a 30-day
> pass, AI credit packs and donations — run on the existing free Worker tier and
> its D1 database. They do not need the parked server tier. The current record is
> [`SPONSORSHIP.md`](./SPONSORSHIP.md); this section is kept as the S10 history.

| Decision | Result |
| --- | --- |
| Server tier (M6.1b) | stays parked |
| Stripe / AGPL | not needed while there is no paid tier |
| Ads (M6.6) | not shipping |
| R2 | future gate after a dedicated R1 production proof |
| P4.4 | stays gated on the SSRF/scheduling design |

**Sprints 11–13 are not scheduled under this decision.** They reopen only if the
owner reverses the server-tier or ads/R2 decisions.

---

## Sprint 11 — SERVER TIER + BUDGET BREAKER (conditional, 4–6 days)

Only if Sprint 10 says the server tier returns.

1. Deploy API + BullMQ worker + Redis + Mongo on a persistent host.
2. Re-enable the server shape (`VITE_SERVER_API` on) and prove accounts, workflow
   run, REST API and MCP against the deployed stack.
3. M6.3 global budget breaker: deployment-wide daily ceiling, fail closed, load
   test.
4. Keep the static frontend deploy path working.

**Exit gate:** server-backed smoke §6 green; breaker fails closed under load; no
document bytes on any ad origin.

---

## Sprint 12 — CATALOG, STRIPE, PRICING (conditional, 5–7 days)

1. `packages/api-contracts/src/plans.ts` as the one plan catalog.
2. Entitlement resolver + usage ledger; CI parity test.
3. M6.4 Stripe test mode: Checkout, portal, webhook, subscription state.
4. M6.5 `/pricing` generated from the catalog; every claim maps to an enforced
   entitlement.
5. Buy → limit rises → cancel → reverts; replay idempotent.

**Exit gate:** billing parity test, Stripe round-trip and pricing truthfulness.

---

## Sprint 13 — OPTIONAL / DECISION-DRIVEN

- **M6.6 ads** only if approved: content-only placement, CMP, two CSP profiles,
  build failure if an ad origin is reachable from a tool route.
- **R2 native redaction** only if approved after the R1 production proof: adopt
  and audit proven code, threat model, glyph removal, adversarial leakage tests,
  independent verification, security review. This is an XL project, not a
  launch task.
- **P4.4 triggers** only after the SSRF/idempotent-scheduling design.
- **Physical iOS/Android** verification, recorded in `docs/CROSS-BROWSER.md`.
- **Vector signatures** only with a round-trip fidelity test.

---

## Sprint 14 — MONETIZATION RESET: SPONSORSHIP + DODO (done 2026-11-26)

**Decision.** Drop AdSense. Replace it with first-party sponsorship and three
one-time rails, all through Dodo Payments on the existing free Worker tier. No
ad network, no CMP, no CSP widening, no server tier. Full record:
[`SPONSORSHIP.md`](./SPONSORSHIP.md).

**Shipped.**

1. **AdSense removed.** Slot, loader, CMP, consent mode, `ads.txt`, the Google
   CSP branch and both ad tests are deleted. The build policy is back to
   `default-src 'self'` and the CSP test asserts it.
2. **Sponsor inventory.** Two slots: Featured $39/mo (home, under the tool grid)
   and Standard $19/mo (guides index + end of each guide), founding rates locked
   for twelve months. D1 migration `0003_sponsors.sql`; `sponsors` +
   `billing_events`; one live sponsor per slot enforced by a partial unique index.
3. **Self-serve checkout.** `/sponsor` explains the model, shows availability,
   accepts a logo + 60-character line, and creates a Dodo session. Drafts are
   private until a verified webhook activates them.
4. **Webhook.** Standard Webhooks HMAC over the raw body, five-minute window,
   message-id claim before the side effect, release on failure. Handles
   `subscription.active`, `subscription.renewed`, `subscription.cancelled` and
   `payment.succeeded`.
5. **One-time rails.** 30-day pass ($3), AI credit pack ($5 / 1,000 messages)
   and donation (pay-what-you-want). Credits are spent only after the monthly Pro
   allowance and are drained by a single conditional `UPDATE`.
6. **Surfaces.** Sponsor cards render on content routes only and never for Pro;
   `/sponsor` carries the pricing, form, donation and FAQ; `/account` shows plan,
   expiry, credit balance and the two buy buttons.
7. **Tooling.** `@dodopayments/opencode-plugin` installed at the workspace root;
   `opencode.jsonc` loads its skill and MCP.

**Verification.**

| Gate | Result |
| --- | --- |
| `pnpm -r typecheck` | green (all packages) |
| Web unit tests | 348 passed, including 8 sponsor-gating tests |
| `pnpm build` + `seo:audit` | 84 prerendered routes / 75 sitemap; PASS |
| `test:bundle` / `test:guardrails` | PASS |
| Local Worker + D1 | signed webhook activates a sponsor; replay is a no-op; bad signature 400; credits granted once; pass sets a 30-day term |

**Open operator steps (not code).**

1. Create the five Dodo products; set `DODO_API_KEY` and `DODO_WEBHOOK_SECRET`;
   put the product ids in `wrangler.jsonc`; point the webhook at
   `/api/billing/webhook`.
2. Deploy with `VITE_SERVER_API=on` — the committed `.env.production` is the
   frontend-only shape, which has no API and therefore no sponsor card.
3. Publish the 20 guides. Sponsorship is sellable around 10k sessions/month; the
   rails are built to be ready, not to earn before the traffic exists.
4. Optional: `/pricing`, generated from the same numbers, replacing the footer's
   "Pricing (soon)".

**Exit gate:** a stranger can buy a slot without an email, the card appears only
on the pages it names, and an unconfigured deployment still answers
`503 billing_disabled` instead of showing a broken button.

---

## Cut list (do not block ship)

| Item | Why it waits |
| --- | --- |
| Team/seat plans | need org features and a buyer who takes calls |
| Lifetime Pro | a forever promise on a metered AI cost; price after the cost is measured |
| White-label / OEM | ruled out by the hosted-only AGPL decision |
| Ad networks | dropped 2026-11-26; first-party sponsorship instead |
| `/pricing` | the account page sells; a public page is optional polish |
| R2 | separate security gate; R1 proof first |
| P4.4 triggers | SSRF/scheduling design gate |
| Server tier | ₹0/no-card constraint |
| Vector signatures | no fidelity test yet |
| Physical mobile | verification, not a launch blocker |

## Commands at every close

```bash
pnpm -r typecheck
pnpm test
pnpm build
pnpm test:bundle
pnpm test:provenance
pnpm test:corpus
pnpm test:fuzz
pnpm test:guardrails
pnpm test:editor-perf

# after a deploy:
E2E_BASE_URL=https://pdfshush.space pnpm test:e2e
E2E_BASE_URL=https://pdfshush.space pnpm test:e2e:reach
E2E_BASE_URL=https://pdfshush.space pnpm test:e2e:offline

# Sprint 9, with Docker running:
docker compose up -d --build
pnpm test:api
pnpm test:hardening
```
