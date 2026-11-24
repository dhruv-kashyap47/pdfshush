# Remaining work → sprint plan (2026-11-24, post-deploy reality)

> This replaces the earlier ship-first draft. Production is already live at
> `https://pdfshush.space`, all 63 `reaTask.md` cards are closed, and the
> production smoke + sign suites are green. The remaining work is the public
> launch surface, hardening evidence, and monetization decisions — not the
> editor or engine.

## 0. Verified state (2026-11-24)

**Sprint 8 is complete.** The five policy routes are live on
`https://pdfshush.space` (Worker `0d763fc6-75f5-4f4c-b819-ce46182a3591`), with
68 prerendered routes / 60 sitemap URLs. Production `reach`, `smoke`, `a11y`,
`offline` and `sign` all pass. Continue with Sprint 9.

| Item | State |
| --- | --- |
| `origin/main` / `origin/rea-uplift` | `a8b0cf4`, identical |
| Production | `https://pdfshush.space`, Cloudflare Workers + Static Assets |
| Production smoke | **ALL CHECKS PASSED** (89 mega-menu links, all tools, editor, redaction, no console errors) |
| Production sign E2E | **18/18 green**, including “the manage page saves a signature” |
| Cloudflare Wrangler | authenticated as `7468dhruv@gmail.com` (account `c50c0cc04ad6e0bfea4db65b2b615b69`) |
| reaTask | **63/63 cards `[x]`**; Gate D met for the documented scope |
| `PLAN.md` P7 | only recorded corpus gap is a linearized fixture; container gates depend on Docker |
| Docker daemon | **unavailable in this session**, so `test:api` / `test:hardening` still cannot run |

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

## Sprint 9 — EVIDENCE CLOSE (P0/P1, 1–2 days)

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

---

## Sprint 10 — DECISION GATE (owner, ~half a day)

**Goal:** stop open-ended work; choose the next track.

| Decision | Options |
| --- | --- |
| Server tier (M6.1b) | fund/find a persistent free host, or keep it parked |
| Stripe / AGPL | create the Stripe test account and decide CLA/dual-licence before billing code |
| Ads (M6.6) | yes with CMP + two CSP profiles, or decline |
| R2 | go/no-go after the R1 production proof; R2 gets its own security sprint |
| P4.4 | keep gated or write the SSRF/scheduling design first |

If the server tier stays parked, **development is complete after Sprint 9** and
Sprints 11–12 stay closed. Do not advertise a paid feature the deployment cannot
enforce.

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

## Cut list (do not block ship)

| Item | Why it waits |
| --- | --- |
| Pricing, Stripe, entitlements | need an enforceable server tier |
| Ads / CMP | no traffic/privacy-policy prerequisite yet |
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
