# Audit notes (temporary)

Working notes for the repository audit. Deleted before the final commit.

## Phase 1 — what this repository is

- **Monorepo** (pnpm 12, Node 24, ESM, TypeScript strict). Workspaces: `apps/web`, `apps/edge`, `packages/pdf-core`, `packages/ai-provider`, `packages/ai-agent`.
- **Product**: a browser-only PDF toolkit (48 tools) served as a React 19 SPA built with Vite 8. Every tool runs in a Web Worker; document bytes never reach the network.
- **Backend**: one Cloudflare Worker (`apps/edge`, Hono on D1) serving `/api` for Google OIDC sessions, account sync, managed-AI proxy, sponsors and Dodo Payments. Static assets come from Workers Static Assets. No Express/Mongo/Redis tier in the deploy; it is archived under `archive/`.
- **Entry points**: `apps/web/src/main.tsx` → `App.tsx` (data router + `AuthProvider`); Worker `apps/edge/src/index.ts` splits `/api` from assets. PDF engine entry `packages/pdf-core/src/index.ts`.
- **Build/deploy**: `pnpm build` (web: `tsc` + Vite + prerender 84 routes), `node scripts/check-deploy-config.mjs`, `npx wrangler deploy`. CI `.github/workflows/ci.yml` has a typecheck/unit/bundle gate and a browser perf/a11y suite against `vite preview` on :4173.
- **Tests**: Vitest across 5 workspaces (≈1,580 tests), plus Playwright E2E scripts under `tests/e2e`, guardrail/provenance/deploy-config scripts, and a bundle-boundary scan.
- **Notable reference material** (git-ignored): `genoffice-main/` (donor for `ai-provider`/`ai-agent`), `Stirling-PDF-main/`, `pdf-redaction-master/`, `pdfcraft-main/`, `excise-develop/`, `rea ihpdf/`.
- **Baseline**: typecheck green; unit suites green; production build green; cross-browser E2E failed on a 502 before these changes.

## Findings and decisions

1. **CI cross-browser 502** — `vite preview` inherits `server.proxy`; `/api/*` was forwarded to `localhost:8787`, where CI starts no Worker. Chromium/WebKit log the 502 as a console error and the "no unexpected page errors" check failed. Fixed by making the preview proxy opt-in (`VITE_PREVIEW_PROXY`) and by classifying console errors by resource URL in the E2E gate.
2. **Profile photo** — the OIDC `picture` is served from `*.googleusercontent.com`, which `img-src` did not allow, so the browser blocked it. Added the avatar CDN origin, validated/normalised the URL, added initials fallback, and a `?auth=success` refresh path. Covered by unit + Chromium E2E tests.
3. **Malformed cookie** — `decodeURIComponent` could throw a `URIError` before `fetch`; now falls back to the raw value.
4. **IndexedDB** — a blocked upgrade left `pdfshushDb()` pending forever; now rejects, can retry, and closes on `versionchange`.
5. **Private API caching** — `/api/auth/*` and `/api/account/*` now send `Cache-Control: private, no-store`.
6. **Foreign donor identifiers** — the AI client still identified as `GenOffice` to providers; changed to `pdfshush` (tests updated).
7. **Licence gaps** — `packages/ai-provider` and `packages/ai-agent` are GenOffice Apache-2.0 code without a notice for those packages; `spotlight-card.tsx` is React Bits “MIT + Commons Clause” with no licence text; the hero plate has no provenance record. Added `NOTICE`, `THIRD_PARTY_LICENSES.md`, generated `THIRD_PARTY_LICENSES.deps.md`, donor NOTICE, React Bits licence, Instrument Serif OFL. Flagged the Commons Clause / AGPL interaction and the unverified hero image for the owner.
8. **CI hygiene** — checkout/setup-node on current majors, Node version from `.node-version`, `ubuntu-24.04`, and a generated-licence drift gate.
9. **No linter/formatter configured** — `tsc` + Vitest + guardrails are the current gates; no formatter was added because it would rewrite the whole tree. Noted, not changed.

## Deliberately not changed

- `archive/` is intentional (documented server tier); not deleted.
- `packages/ai-agent` `redact-core.ts` / `redact-range.ts` are unused by the apps but are exported/tested donor code; left in place and attributed.
- No formatter/linter dependency was introduced.
