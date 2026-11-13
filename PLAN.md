# PDFShush — Plan & Progress

> Single source of truth for scope, decisions, and status. **Update this file at the end of
> every work session** (status board, changelog, next move). If context is ever lost, this
> file + the codebase is enough to resume.

**Product:** PDFShush — a 100%-feature-parity-plus clone of Sejda.com, with "disruption"
extras (AI, e-sign, public API + own MCP server, workflow automation).
**Stack:** MERN + TypeScript (React 19, Vite 8, Express, MongoDB) · pnpm monorepo.
**License:** AGPL-3.0-or-later · **Name:** PDFShush (locked).
**Last updated:** 2026-11-13

---

## 1. Status board

| Phase | Scope | Status |
| --- | --- | --- |
| **P0 — Foundation** | Monorepo, `pdf-core` engine + job contract, guardrails, web shell, 3 pilot tools | ✅ **Done (2026-10-07)** — see §5 |
| **P1 — Top-10 tools** | 10 client-side tools off the existing engine (delete/extract/rotate/split/mix/stamp/crop/n-up) | ✅ **Done (2026-10-07)** — see §6 |
| **P2 — Editor** | Sejda-class PDF editor (3 edit modes, undo, export validation) | ✅ **Done (2026-10-07)** — see §10 |
| **P3 — Server pipeline** | Express + BullMQ workers, quotas, isolation → **hardening gate** | ✅ **Done (2026-10-08)** — see §11 |
| **Audit remediation (P0/P1/P2)** | Full-codebase audit fixes: output contracts, page cap, filenames, cancel contract, janitor, recent history | ✅ **Done (2026-10-08)** — see §14 |
| **P4 — Accounts & workflows** | Anonymous-first auth, saved history, workflow builder | ✅ **Done (2026-10-12); P4.4 triggers deliberately gated** — see §18 |
| **R1 — Secure redaction (ship first)** | Rasterization-first: marks burned into pixels, document rebuilt, output independently verified → **security gate** | ✅ **Done (2026-10-14)** — see §20 |
| **R2 — Advanced redaction (final phase)** | Native text-level redaction, preserving searchable/selectable text and vector quality | ⛔ **Deferred until R1 is verified in production** — see §20.3 |
| **T — In-place text editing** | PDFium genuine rewrite of existing text objects (`SetCharcodes`/`SetText`), multi-object line matching, verification-driven pdf-lib overlay fallback | ✅ **engine + job shipped, browser-verified (2026-10-14)** · charcode resolver + multi-object matching landed · full smoke green — see §22 |
| **P5 — AI** | Hybrid BYOK + managed keys, budgets, redaction tool → **leakage gate** | ✅ **shipped (2026-10-16): BYOK summarize/chat/edit-with-AI, smart redaction + leakage gate, managed client + server budgets, in-place AI rewrites, IndexedDB key store, managed browser E2E** — see §23 |
| **P6 — E-sign / API / MCP** | Signature flows, public REST API, PDFShush MCP server | ✅ **done 2026-10-19** — P6.0 decision record (§25.1, D1–D8), P6.1 Fill & Sign (§25.2), P6.2 REST API (§25.3), P6.3 MCP server (§25.4), P6.4 hardening incl. the base-URL smuggle fix (§25.5); the vector-signature path was dropped explicitly to P7 (§25.6) |
| **Plain-tools batch** | Ten client-side tools over the existing engine in one wave: flip, watermark, edit-metadata, remove-annotations, pdf-to-text, grayscale, resize, extract-images, split-by-size, flatten | ✅ **shipped 2026-10-20** — see §8 first entry |
| **Next-tools batch** | Six more client-side tools off the same engine: unlock, JPG to PDF, rename, Bates numbering, split by text, compress | ✅ **shipped 2026-10-21** — see §8 first entry |
| **AI access pass** | Groq BYOK (free tier), cost-tier tags, managed default → OpenRouter free models, plain-English first-run onboarding overlay with anime.js motion | ✅ **shipped 2026-10-21** — see §26 |
| **Authoring batch** | Two client-side authoring tools off the same engine: Create Forms (AcroForm text fields/checkboxes) and Create Bookmarks (`/Outlines` writer + heading detection) | ✅ **shipped 2026-10-26** — see §8 |
| **Security batch** | Real AES-256 Protect PDF (open/owner passwords + permission flags) and a Smart Compress pass that re-encodes safe embedded images while preserving text, links and forms | ✅ **shipped 2026-10-27** — see §8 first entry |
| **Dark-mode batch** | Dark Mode PDF: three pixel-remap kinds (theme / smart hue-preserving / invert) over a live before/after wipe preview, ported from the MIT-licensed `chizkiyahu/pdf-dark-mode-converter` | ✅ **shipped 2026-10-28** — see §8 first entry |
| **P7.0 — reconcile & cheap backlog** | L1/L2 CSRF, L4 bounded `options`, L5 result-type allowlist, L7 input-token reservation, L8 cross-instance AI lock, CI, doc counts | ✅ **done 2026-10-25** — see §8 top entry; L3/L9 verified already closed |
| **P7 — Hardening** | Adversarial torture suite, SEO prerendering, perf/a11y pass | 🟡 **P7.2/P7.3 absorbed by M5.5/M5.6; P7.1 partial** — the Q4 corpus covers 0-byte, 1-page, 2 000-page, encrypted, scanned, truncated, non-PDF, non-ASCII and 200 MB, but 10k-page, broken-font and linearized fixtures are still missing (§4, §31.21) |
| **Text editing Phase 1** | Serializable glyph→word→line→paragraph→block→region model, centralized geometry, hit testing, inline paragraph editing | ✅ **done 2026-10-31** — engine 339 tests, web 39; see §27 |
| **Text editing Phase 2** | Native object editing ladder, content-stream fallback, font metrics/substitution, layout reflow, OCR-layer/scan capability, export + pixel verification | ✅ **done 2026-10-31** — engine 362 tests, web 39, both text E2Es; see §28 |
| **Text editing Phase 2.5** | Adversarial reliability audit: corpus of awkward documents, verification hardening (no-op/deletion absence, consumed-font tolerance), failure-recovery/concurrency/memory gates | ✅ **done 2026-11-01** — 27 new engine tests, 4 defects fixed; see §28.10 |
| **Text editing Phase 3** | Advanced document intelligence: layout-relationship engine, evidence-based structure confidence, table/column/role/typography fixes, image obstacles for reflow, held-out synthetic **and** real-PDF benchmark | ✅ **done 2026-11-02** — 38 new engine tests, 12 defects fixed; see §29 |
| **Phase 4 — Production hardening** | Audit-first performance work (profiled, output-preserving), native/worker lifecycle fixes, document-intelligence stabilization, editing/logging privacy, export/redaction isolation, dependency + bundle audit, full E2E campaign, observability | ✅ **done 2026-11-03** — see §30; **SHIP** |
| **Milestone 5 — Product excellence & competitive differentiation** | Verifiable privacy (offline PWA, CSP proof, user-facing redaction verifier), honest editing/structure receipts, measured perf + a11y + SEO baselines, parity-debt resolution for the 9 `planned` entries | ✅ **M5.0-M5.8 done 2026-11-04** — baseline (§31.12), Q2 determinism fix (§31.13), truthful surface (§31.14), verifiable privacy (§31.15), receipts/structure confidence (§31.16), performance gate (§31.17), reach/prerender (§31.18), accessibility/input parity (§31.19), parity decisions (§31.20) and release evidence (§31.21). Container `test:api`/`test:hardening` were not runnable here (Docker daemon unavailable) and are not claimed green. |
| **Responsive product shell** | One shared editor and document session across three interaction models: desktop workstation, tablet drawers, phone bottom-nav app; mobile marketing stripped to a lightweight editorial surface | ✅ **done 2026-11-05** — see §34; 1 356 unit tests, responsive sweep clean, phone/tablet editor checks green |
| **Deploy recovery** | Stale hashed CSS/JS can no longer strand an open tab: empty stylesheet/SPA-fallback detection, one guarded fresh-shell reload, hard-reset reload, service-worker navigation cache bypass, critical fallback CSS | ? **done 2026-11-05** - see section 34.7; stale-build E2E 8/8 |
| **M6 - Monetization** | Deploy to a real origin, content/SEO foundation, plan catalog + entitlements + Stripe test mode (managed AI, API volume, priority queue), content-only ads behind two CSP profiles | 🟡 **M6.1 frontend shipped to Cloudflare Pages 2026-11-13 (§33.11); the public gate has not run yet** — domain bought (`pdfshush.space`), build + Pages config committed, deploy pending. The server tier (API/worker/Redis/Mongo) is **parked** (§33.11), not deployed |
| **Reliability pass** | One auth owner, real history write-through, API hardening, route error boundary, mobile/editor keyboard parity, workflow cancellation | ✅ **done 2026-11-05** — see §8; 1 344 unit tests at the time, browser suites re-run green before deskew |
| **Scans batch** | Deskew: projection-profile skew detection, per-page raster rotation, manual override, honest image-rebuild disclosure; also fixes the blank-page raster rebuild in grayscale, dark mode and strong compress | ✅ **shipped 2026-11-05** — see §8 entry; 50 of 58 live, 8 declined, 1 354 unit tests at the time |
| **OCR batch** | OCR: Tesseract in the existing job worker, self-hosted English data, invisible selectable text layer over the original scan, already-searchable pages copied untouched, browser-only with no new origin in the CSP | ✅ **shipped 2026-11-08** — see §8 top entry; 51 of 58 live, 7 declined, 1 409 unit tests |

**Redaction sub-phases** (detail in §20):

| | Scope | Status |
| --- | --- | --- |
| **R1.0** | Decision record: raster-first vs text-level; what is disclosed | ✅ decided 2026-10-13 |
| **R1.1** | Rasterize + burn marks into pixels + rebuild a fresh document | ✅ **done 2026-10-14** |
| **R1.2** | Independent verification of the serialized artifact (text, carriers, **pixels**) | ✅ **done 2026-10-14** |
| **R1.3** | Fail-closed limits (pages, size, canvas, render failure) + resource release | ✅ **done 2026-10-14** |
| **R1.4** | Product integration: region selection, disclosure, progress, cancel, download | ✅ **done 2026-10-14** |
| **R2** | Text-preserving redaction engine — evaluate, audit, then integrate | ⛔ **not started, deliberately** |

**P4 sub-phases** (detail in §18):

| | Scope | Status |
| --- | --- | --- |
| **P4.0** | Decision record: store, identity provider, sync boundary, execution split | ✅ decided 2026-10-12 |
| **P4.1** | Optional accounts + sessions (OAuth/OIDC + cookie sessions + job ownership + CSRF) | ✅ **done 2026-10-12** |
| **P4.2** | Account-owned data: preferences, synced history, export/delete | ✅ **done 2026-10-12** |
| **P4.3** | Workflow recipes: contract, storage, builder, run-now | ✅ **done 2026-10-12** |
| **P4.4** | Automated triggers (upload / URL / schedule) — separate gate | ⛔ **gated, deliberately not built** (§18.5) |

**Current gate:** re-measured 2026-11-13 for the **Pages deployment** (`pnpm -r typecheck`, `pnpm test` -
**1 528/1 528 unit** (1 expected fail) - `pnpm build` with `VITE_SERVER_API=off` +
`VITE_SITE_ORIGIN=https://pdfshush.space` - `pnpm test:bundle` green; main chunk 172.9 kB with 0
engines, 17 lazy app chunks with 0 engines, engines only in worker chunks). The 2026-11-08 OCR
batch is unchanged; the delta since is the **pdf-audit remediation** (engine/API fixes on
`main`) plus this session's five deployment tests. The Phase 4 profile, before/after numbers and
SHIP gate are in §30; the Phase 3 document-intelligence benchmark (§29), the Phase 2.5 adversarial
audit and its four verification fixes (§28.10) are unchanged and still in force. **M5 is complete**
(§31.12-§31.21); the 2026-11-05 passes, the 2026-11-08 OCR batch and the 2026-11-13 Pages work
are recorded in §8. Browser suites re-run green **against Cloudflare Pages' own local emulator**
(`wrangler pages dev`) on 2026-11-13: smoke, reach (51 live, 55 sitemap URLs), offline, a11y,
keyboard, verify, plain-tools, next-tools, forms-bookmarks, bookmark-batch, dark-mode, deskew, OCR,
text-edit and text-model — no console errors. **The containerised `test:api`/`test:hardening` gates
were not re-run**, so those checks stay unclaimed (§31.21), and `tests/e2e/sign.mjs` fails its
"manage page saves a signature" check against any production build — reproduced from an untouched
checkout of `main`, so it is a pre-existing defect and not a claim of green here (§33.11).
The 2026-10-21 next-tools batch (§8, 2026-10-21
entry) sits on top of **P6.4 hardening over the new surface** plus the **landing MCP console** - the
P5 AI port (§23), the gap-closing pass (§23.7), the Phase 1-5 security review + `redactSecrets`
hardening (§24), the P6.9 hardening interlude (§24.2), P6.1 Fill & Sign (§25.2), P6.2 REST API
(§25.3) and P6.3 MCP server (§25.4) all still hold.
**51 of 58 catalog entries live** (7 declined with a documented reason, §31.20; ten plain tools shipped 2026-10-20: `flip-pdf`, `watermark`,
`edit-metadata`, `remove-annotations`, `pdf-to-text`, `grayscale-pdf`, `resize-pdf`,
`extract-images`, `split-by-size`, `flatten-pdf`; six more on 2026-10-21: `unlock-pdf`,
`jpg-to-pdf`, `rename-pdf`, `bates-numbering`, `split-by-text`, `compress-pdf`; seven on
2026-10-25: `stamp`, `repair-pdf`, `combine-pdf`, `image-editor`, `batch-run`,
`split-by-bookmarks`, `workflows`; three on 2026-10-26/27: `create-forms`, `create-bookmarks`,
`protect-pdf`; one on 2026-10-28: `dark-mode-pdf`; one on 2026-11-05: `deskew`; one on
2026-11-08: `ocr-pdf`; `redact-pdf` in
Security; `summarize-pdf` +
`chat-with-pdf` +
`edit-pdf-with-ai` under the **AI** category; `fill-sign` + `signature` under Edit & Sign from P6.1;
`api` under Automate from P6.2 and `mcp` from P6.3 — both docs pages, not pipelines; the hero's third
door opens the MCP console in place from P6.4's polish pass)
· 8 server-runnable slugs over `/api/v1`, one MCP tool apiece ·
**1 528/1 528 unit** (**564 engine** · **242 API** · 375 provider · 152 agent · **177 web** ·
**19 MCP**) — Phase 2 added 23 engine tests (reflow, fonts, content-stream, capabilities,
export/pixel verification), Phase 2.5 added 27 more (adversarial corpus + verification/
robustness gates), and Phase 3 added 38 (held-out synthetic benchmark, real-PDF gate,
focused layout regressions), plus 10 web tests (font mapping, native-plan metadata).
**Browser E2E:** full
smoke (re-run 2026-10-25 with Redis up — no skips: the workflow *run* executes through
`/api/jobs` into the sandboxed processor; the suite still skips that step honestly if
`/api/health` reports Redis down) + **plain-tools suite, 13/13 checks**
(`tests/e2e/plain-tools.mjs`, real downloads with magic-byte asserts: `%PDF-`, `PK`, inflated
`FF D8` JPEG in the extract-images ZIP, page text inside the .txt) + **next-tools suite, 36/36 checks**
(`tests/e2e/next-tools.mjs`: decrypted PDF with no `/Encrypt` and its text intact, image-embedded
PDF page count, renamed ZIP, stamped Bates numbers read back out of zlib streams, split parts,
repack and a real raster compress, plus smart compression shrinking a 1.4 MB Flate photo while
keeping its text, a soft-mask fixture staying valid, and Protect output carrying `/Encrypt` +
`/AESV3`/R6 that pdf.js opens only with the right password, keeps the text and reports the
expected permission bits) + **bookmark-batch suite, 29/29 checks**
(`tests/e2e/bookmark-batch.mjs`: stamped text read back out of the PDF, repaired page count,
mixed PDF+image+PDF ordering, a real `/Outlines` fixture split into three chapters, a two-file
batch ZIP that downloads twice, and a rotated PNG whose exported IHDR dimensions are asserted) +
**authoring suite, 49/49 checks** (`tests/e2e/forms-bookmarks.mjs`: a downloaded two-page form with
`/AcroForm`, `/Tx` and `/Btn` widgets whose field names are read back as UTF-16BE hex, plus page
navigation, drag/resize, numeric placement and duplicate-name blocking; a report fixture whose three
headings are detected, reordered, edited, nested, and written as a real outline with all titles read
back, including a non-Latin one, plus an excluded parent whose child is promoted instead of leaving a
skipped level) · **8/8 focused text-edit E2E** ·
**dark-mode suite, 8/8 checks** (`tests/e2e/dark-mode.mjs`, new root script `test:e2e:dark-mode`:
the page-1 wipe-preview canvas shows the exact theme colours — its top-left pixel reads (0,0,0)
on `ink` and (25,30,45) on `midnight` — a saturated-red page stays red under `smart` and flips to
cyan under `invert`, and the download is `%PDF-`, carries `DCTDecode` inside and ends `-dark.pdf`) ·
**22/22 AI E2E** (re-run 2026-10-25: chat + highlight apply + in-place replacement + key-handling,
local SSE mock, plus the five keyless welcome-overlay checks in the same script, so the old
"17 vs 18" drift is fully explained) · **11/11 managed AI
E2E** (real API routes, in-memory counters, no Redis/docker) ·
**17/17 sign E2E** (P6.1: dialog draw/save/adopt/place, export, audit note read back as JSON,
manage page; `tests/e2e/sign.mjs`) ·
**37 API smoke checks incl. the §6 v1 flow** (21 base + 16 in the key→submit→poll→download→revoke
walk; §6 needs `PSH_SMOKE_MONGODB_URI`; re-run 2026-10-25) · **19/19 hardening** (re-run 2026-10-25
with a 20 s TTL and 5 s janitor)
  · *2026-10-28 note: check totals here are a snapshot — the live count comes from
  `pnpm test:hardening`. Verified today with `FILE_TTL_MS=20000` +
  `JANITOR_INTERVAL_MS=5000` and `docker compose up -d --build`: the gate reports
  **19 PASS / 0 FAIL — GATE PASSED**, matching the number above. When checks are
  added or removed, re-run the gate instead of editing this line.*
 · renderer hosts CMaps + standard fonts and forces
glyph-path rendering off the `FontFace` path in the worker (§16, §17) · accounts live against
Google + MongoDB Atlas (§18) · **secure redaction shipped and independently verified (§20)** ·
**genuine in-place text editing shipped end to end (§22; AI replacements now use it too, §23.7.2)** ·
**AI: BYOK summarize/chat/edit-with-AI + smart redaction proposals in the browser, an opt-in managed
mode with per-subject budgets on the server (off unless a key is set), the P5 leakage gate green, the
key in IndexedDB behind `sanitizeAiSettings` with a one-click delete (§23)** · **P6.1 Fill & Sign
shipped (§25.2): drawn/typed capture, device-only signature assets, editor placement, `edit`-job
export with a fail-closed audit sidecar** · main chunk 0 pdf-lib /
0 pdf.js / 0 pdfium / 0 tesseract / 0 `signature_pad` / 0 Caveat, enforced by the extended `pnpm test:bundle`
(PDFium is a lazy 4.6 MB asset fetched on first text edit; Tesseract's worker, core and English
model are lazy assets fetched only when a scanned page needs recognition; `signature_pad` + the
bundled Caveat faces ride the 33 kB lazy signature-pad dialog chunk).
**Next: finish M6.1 — publish the frontend on Cloudflare Pages and run the §33.4 gate against
`https://pdfshush.space`** (§33.11). The deployment shape changed on 2026-11-13: the frontend
ships on Cloudflare Pages (free, no card) and the **server tier is parked**, so accounts,
workflow recipes, the REST API and the MCP server's backend are switched off in the build rather
than offered and left to fail. **M6.3's global budget breaker** is still the one M6 item that
protects the free tier and can start before the gate runs. P7 is closed except for P7.1's remaining
edge fixtures (10k-page, broken fonts, linearized) and the containerised gates; P7.2 SEO prerender and
P7.3 perf/a11y were absorbed by M5.5/M5.6. R2 stays
deferred until R1 is proven in production, and P4.4 triggers stay gated on the SSRF/scheduling design.
*(2026-10-18 addendum:)* the landing page's editorial band was rebuilt as a stem-plate poster +
rooted-tree silent-loop pair (§8, 2026-10-18 entry), gated by typecheck, a fresh production build, the
881-test unit run and targeted browser inspection, not a new measurement of the E2E counts above.
*(2026-10-18 addendum 2:)* the landing hero and AI band were replaced by the premium rework with the
anime.js motion system, gated by typecheck, the 897-test unit run, a fresh build and a screenshot
harness (§8's newest entry); the throwaway harness was deleted and never committed.
Repo public:
`github.com/dhruv-kashyap47/pdfshush` — **run the pre-push secret/PII grep before every push**
(see §9 tooling).

---

## 2. Locked decisions

Do not relitigate these without a strong reason; each was researched and chosen.

- **Reverse-engineering target:** Sejda ≈ ~40 tools across Merge / Split / Edit&Sign /
  Compress / Security / Convert / Other / Scans / Workflows. Free tier: 3 tasks/hr,
  200 pages, 50 MB. We mirror the catalog, URLs, and IA — but **no task quotas** for
  in-browser work (limits instead, §4). Our own catalog is **58 entries** (51 live, 7 declined):
  Sejda's set plus the disruption extras (AI, e-sign, API/MCP, workflows); every slug has a
  permanent page from day one, so a declined tool renders an honest "not built" decision page
  with the real blocker and the closest live alternative (§31.20).
- **UI foundation:** `shadcnstore/shadcn-dashboard-landing-template` (**MIT**, `vite-version/`
  branch) — keep landing sections + shadcn/ui + theme system + auth/dashboard/error pages;
  strip mail/tasks/chat/calendar demos. Attribution preserved in `licenses/`.
- **Not a foundation:** `genspark-ai/genoffice` (Electron, wrong shape) — but an
  Apache-2.0 **code donor**: `apps/pdf` (already used for the P2 editor and its audit),
  `pdf2docx` (P3), `ai-provider` (P5), MCP server (P6). **Avoid its `ee/` dir**
  (enterprise license).
- **E-sign draw pad (decided 2026-10-08, for P6):** `szimek/signature_pad` (**MIT**,
  zero deps, ~6 kB gzip). Variable-width Bézier smoothing is the hard part of a signature
  pad; its `toSVG()` also unlocks **vector** signatures through pdf-lib's `drawSvgPath`.
  Raster output feeds the existing `EditImageObject` pipeline unchanged. Requires a
  NOTICE attribution. Full design notes: §25 (the original session plan file
  `p6-sign-signature-pad.md` is gone from disk; §25 supersedes it).
- **Engine:** maintained pdf-lib fork **`@cantoo/pdf-lib`** (upstream stale since 2021) +
  **`pdfjs-dist` v6** (rendering) + `fflate` (zip). Server tools later: Ghostscript, qpdf,
  LibreOffice, OCRmyPDF, Tesseract.js.
- **Hybrid processing:** light tools run **client-side in a Web Worker** (files never
  upload); heavy tools run on bounded server workers (P3) through the *same* job contract.
- **Anonymous-first:** every tool works without login; accounts (P4) only add value
  (history, API keys, teams).
- **SEO:** stay on Vite; per-tool page SEO via prerendering in **P7** (not Next.js).
- **MCP/automation accelerators:** Context7, GitHub, Playwright, MongoDB, Filesystem, Docker.
- **Verified dep versions:** `@cantoo/pdf-lib@2.11.1`, `pdfjs-dist@6.4.299`, `fflate@0.8.3`,
  `@dnd-kit/*@latest`, `tailwindcss@4.3.3`, `vite@8.3.3`, `react@19.3`, `react-router-dom@7.18`,
  `typescript@~5.9.3` (**never TS 7**), `vitest@5.0.3`.
- **Environment:** Windows 11, Node v24.21.0, pnpm 11.15.0, Docker Desktop (WSL2) —
  installed and verified in P3, but its CLI is per-user and **not on the session PATH**
  (see §9 for the `$env:DOCKER_BIN` workaround). LLM API key only needed for managed-AI mode
  (P5) — BYOK ships first, keyless.
- **User-adopted safeguards** (all in): `limits.ts`, memory guards, timeouts, common
  `JobInterface` (P0) · 3 edit modes + undo + export validation (P2) · quotas, bounded
  concurrency, per-job isolation, janitor, light monitoring (P3) · BYOK never touches
  server + budget middleware (P5) · adversarial fixture corpus (P7), with
  **redaction-leakage tests blocking at P5**.
- **Redaction strategy (locked 2026-10-13).** Ship **rasterization-first** secure redaction
  now (§20): the page pixels are the artifact, the document is rebuilt from them, and the
  exported bytes are independently verified. It is *not* text-preserving, and it says so
  before the user confirms. **Native text-level redaction is deliberately deferred to the
  final phase (§20.3)** — it is a different engine with a different risk profile, and shipping
  a proven-safe rebuild beats shipping an unproven surgical one. Do not present the existing
  **Whiteout** tool as redaction: it paints over text and leaves it recoverable, and it is
  labelled cosmetic for exactly that reason.

### 2.1 Reference reading list

Material to read before touching the relevant area. Licensing is recorded so nobody has to
re-derive it; **none of this is a code dependency** unless a decision below says so.

| Reference | License | Why it is on the list |
| --- | --- | --- |
| `github.com/Stirling-Tools/Stirling-PDF` | MIT | Redaction, content-stream manipulation, rendering, verification and security tests. Its redaction is **server-side Java/PDFBox** (`TextRedactionService`, `ManualRedactionService`, `RedactExecuteService`), so it validates the *technique* rather than supplying reusable code for our client-side engine. |
| `github.com/rock3125/pdf-redaction` | Apache-2.0 | Candidate implementation for **R2** (native text-level redaction). Audit before use. |
| `github.com/marctjones/excise` | MIT | Candidate implementation for **R2**. Audit before use. |
| `github.com/storytold/pdfcraft` | check on first read | General PDF pipeline reference; unread. Confirm the licence before adopting anything. |
| `github.com/affsquadDevs/editorapdf` | check on first read | Browser PDF editor reference (main-thread pdf.js/pdf-lib rendering). |
| `genspark-ai/genoffice` | Apache-2.0 | Existing code donor (editor, `pdf2docx`, `ai-provider`, MCP). **Avoid its `ee/` directory.** |

---

## 3. Architecture (as built through P3)

```
pdfshush/
├── apps/api                        Express + BullMQ (P3) — same job contract as the browser
│   ├── src/http/                     app · routes · streaming multipart uploads
│   ├── src/jobs/                     payload schema · queue/producer · node runner · cancel
│   ├── src/files/                    work dir (streamed uploads) · path safety · TTL janitor
│   ├── src/quota/                    policy · Redis counters (Lua) · in-memory double
│   └── src/worker/                   host (BullMQ Worker) · sandboxed processor
├── apps/web                      Vite + React 19 + Tailwind v4 + shadcn/ui
│   ├── src/workers/job-worker.ts   module worker: configures pdf.js, runs pdf-core jobs
│   ├── src/lib/job-pool.ts         bounded pool · timeout → terminate · zero-copy transfer
│   ├── src/lib/client-capacity.ts  refuse-before-crash capacity checks
│   ├── src/lib/editor-state.ts     editor document + snapshot undo/redo (P2)
│   ├── src/tools/registry.ts       catalog: 58 entries (**51 live**, 7 declined), permanent /tools/:slug pages
│   ├── src/components/editor/*     editor-toolbar · editor-page · editor-inspector (P2)
│   └── src/components/tools/*      50 tool-body files
│                                    + shared dropzone · job-progress · result-panel · tool-frame
├── packages/pdf-core               engine — same code path in worker and Node
│   ├── src/node.ts                  Node-safe barrel: only the isomorphic surface (P3)
│   ├── src/job.ts                   JobDefinition {validate, estimate, run} + withJobLimits
│   ├── src/limits.ts                every capacity number in one file
│   ├── src/ops/                     pages · compose · merge · zip · split · stamp · nup ·
│   │                                geometry · edit · forms (P2) · formFields · outlineWrite ·
│   │                                ranges · textMetrics (dep-free*)
│   ├── src/render/                  pdfjsRuntime · canvas · renderPage · textRuns (P2) ·
│   │                                suggestBookmarks
│   ├── src/redact/                  R1 secure redaction: rasterize · rebuild · verify (§20)
│   └── src/jobs/                    37 jobs: the original 29 + the bookmark batch four + the
│                                    authoring batch two + protect + dark-mode
├── tests/e2e/smoke.mjs             Playwright (system Edge) driving all live tools (101 checks)
├── tests/e2e/plain-tools.mjs       the ten plain tools, magic-byte asserts (13 checks)
├── tests/e2e/next-tools.mjs        the six next tools, incl. a real raster compress (18 checks)
├── tests/e2e/bookmark-batch.mjs    the seven bookmark-batch tools (29 checks)
├── tests/e2e/forms-bookmarks.mjs   forms + outline authoring, downloaded bytes (49 checks)
├── tests/api/smoke.mjs             real stack: upload → Redis → worker → download (21 checks)
├── tests/api/hardening.mjs         the P3 gate: SIGKILL mid-job, prove the pipeline holds
├── docker-compose.yml              redis + api + worker (P3)
├── infra/docker/api.Dockerfile     one image, two entry points (api / worker)
└── PLAN.md                         this file

\* `ranges.ts` and `textMetrics.ts` must stay dependency-free — values imported from them
reach the web app, and a value imported from a pdf-lib-reaching module drags pdf-lib into
the main bundle (§7).
```

**Invariants (do not break):**

1. **One job contract.** `JobDefinition {validate, estimate, run}` is consumed by the
   browser pool now and the BullMQ queue in P3 — tools never know where they run.
2. **Guardrails first.** 100 MB/file, 250 MB total, 500 pages/run, ≤4 workers,
   per-job timeout = `timeoutForPageCount(pages)`, terminate on timeout/cancel
   (synchronous PDF work cannot be interrupted any other way).
3. **Transfer, don't copy.** Input buffers move into the worker (so tools **re-read the
   `File` for every run** — thumbnails then organize), results move back via
   `collectTransferables`. Main bundle must stay free of pdf.js/pdf-lib.
4. **Refuse, don't crash.** `checkClientCapacity` runs *before* work; a tab never dies
   halfway through someone's document.
5. **Every tool has a permanent page from day one.** Unshipped tools render an honest
   "In development" state — links and SEO never churn.

---

## 4. Full phase plan (P1–P7 detail)

### P1 — Top-10 tools ✅ *(done 2026-10-07 — sign-off in §6)*
Engine ops for these already exist (`refsForSpan`, `parsePageRanges`, `composePageRefs`,
`renderPages`). Proposed order, each with unit tests + an E2E check:
**Delete Pages · Extract Pages · Split by pages · Split in half · Alternate & Mix ·
Rotate · Crop · Page Numbers · Header & Footer · N-up.**
Also: per-tool SEO metadata + prerendered sitemap stubs (finalize in P7).

### P2 — Editor *(done 2026-10-07 — sign-off in §10)*
Sejda-class editor: text/image/annotation editing, three edit modes (read the GenOffice
`apps/pdf` patterns, Apache-2.0, skip `ee/`), undo/redo stack, export validation
(re-parse output before offering the download).

### P3 — Server pipeline → **hardening gate** *(done 2026-10-08 — sign-off in §11)*
Express API + BullMQ + Redis; anonymous quotas (150 tasks/day, 6/min, 2 GB/day), bounded
concurrency, per-job isolation (work dir derived from `WORK_DIR` + jobId, nothing in the
payload), TTL janitor, monitoring (queue depth, work-dir usage, structured logs).
**Gate to exit:** kill -9 an in-flight job → no orphan files, queue recovers, limits hold —
**passed** as a repeatable suite (`pnpm test:hardening`, 15/15).
**Deferred out of P3:** Ghostscript/qpdf/LibreOffice/OCRmyPDF workers — no image ships them,
so compress/OCR/Word conversion stayed client-side. That is the next server slice and the
first thing to unblock 8 more of the 53 tools.

### P4 — Accounts & workflows *(in progress — detail in §18)*
Optional JWT + OAuth, saved history (beyond local IndexedDB), workflow builder
(compose jobs, trigger on upload/URL/schedule) — Jobs already serialize cleanly.

Sequenced as five sub-phases so the risky automation does not ride in with identity:

- **P4.0 — Decision record.** Store, identity provider, sync boundary, execution split.
  Nothing is built until these are written down (§18.1).
- **P4.1 — Optional accounts + sessions.** OAuth/OIDC + revocable **cookie** sessions
  (`Secure; HttpOnly; SameSite`), never a long-lived token in `localStorage`. Anonymous
  job tokens keep working; accounts add *ownership*, they do not gate any tool.
- **P4.2 — Account-owned data.** Preferences, opted-in history sync, export/delete.
  Metadata only by default — filenames are user data and are not uploaded silently.
- **P4.3 — Workflow recipes.** The recipe contract plus a local builder and "run now".
  Recipes run anonymously in the browser first; server execution only for the slugs the
  server can actually run.
- **P4.4 — Automated triggers.** Upload / URL / schedule. This is its own gate: URL
  needs SSRF defence, schedule needs idempotency and crash-safe runs.

### P5 — AI → **leakage gate**
Hybrid: BYOK (browser-direct to provider, key never touches our server) + managed keys
with per-user/day budgets enforced by middleware (opt-in, off unless the deployment sets a key).
Features: summarize, chat-with-PDF, agentic editing (propose → review → apply), smart redaction.
**Blocking gate:** redaction-leakage tests (extracted text must never contain redacted spans).

### P6 — E-sign / API / MCP
Signature flows (draw/type/upload via `signature_pad`, ordered recipients, audit trail;
vector output via `toSVG()` → `drawSvgPath`, gated on tests) · public REST API
(rate-limited, API keys) · **PDFShush MCP server** exposing every tool to AI agents
(design donor: GenOffice MCP, Apache-2.0). Reuses the P2 editor for placement/fill.

### P7 — Hardening / torture suite
Adversarial fixture corpus: malformed PDFs, 10k-page files, encrypted docs, broken fonts,
interrupted jobs, cleanup verification. Plus SEO prerendering, Lighthouse/perf, a11y pass.

**Status (2026-11-05).** P7.2 (SEO prerender) and P7.3 (perf/a11y) were absorbed by M5.5/M5.6 and
are closed. P7.1 is **partial**: `tests/support/corpus.mjs` covers 0-byte, 1-page, 2 000-page,
encrypted, scanned, truncated, non-PDF, non-ASCII and 200 MB through the merge class (Q4,
§31.21), and the SIGKILL/TTL recovery gate exists but needs Docker (`test:hardening`). Still
missing: 10k-page documents, broken-font fixtures, and linearized PDFs (`CORPUS_GAPS` records why
no honest fixture exists here). Do not call P7 fully green until those land and the container
gates run.

### R1 — Secure redaction → **security gate** *(shipped 2026-10-14 — see §20)*
Rasterization-first. Every page is re-rendered, the marks are burned into the pixels, and a
fresh document is built from those images alone, so no original content stream, text layer,
OCR layer, annotation, form field, attachment or metadata can survive — they are never copied
across rather than deleted afterwards. The serialized result is reopened and verified
structurally, by two independent text readers, and **at the pixel level**. Fail-closed on
unsupported or oversized work. The disclosed cost is text selection, search, links,
accessibility and vector quality.

### R2 — Advanced redaction (text-preserving) — **final phase, deferred**
Native redaction that removes the targeted glyphs from the content stream while leaving the
rest of the page as searchable, selectable text at full vector quality. **Not started, and it
must not start until R1 is verified in production.** Candidate implementations:
`rock3125/pdf-redaction` (Apache-2.0) and `marctjones/excise` (MIT). Preference is to **adopt
and audit proven code rather than rebuild the engine**, subject to licence compatibility, a
security audit, architecture fit and adversarial testing. Entry criteria, risks and the
acceptance bar are in §20.3.

---

## 5. P0 sign-off (2026-10-07)

**Delivered**
- Monorepo scaffold (strict TS 5.9, shared `tsconfig.base.json`, pnpm 11 supply-chain
  settings in `pnpm-workspace.yaml`), AGPL-3.0 `LICENSE`, MIT attribution in `licenses/`.
- `packages/pdf-core`: job contract + `withJobLimits` (timeout/abort), `limits.ts`,
  ops (pages/compose/merge/zip/ranges), render layer (pdf.js in worker via
  `OffscreenCanvas`), 5 jobs, barrel exports, **21/21 vitest tests**.
- `apps/web`: shadcn theme system (green brand, system fonts — no Google Fonts),
  homepage (hero / popular / all-tools / features / FAQ / CTA), **All Tools mega menu**
  (full catalog, RECENT column from IndexedDB), mobile sheet, footer, breadcrumbs,
  404 + "In development" pages, toast toasts, dark/light/system theme.
- Guardrails: capacity checks (bytes/pages/deviceMemory), pool with bounded workers,
  timeout → `worker.terminate()`, cancel → terminate, AbortSignal wiring, `recordRecent`.
- **3 live tools:** Merge (dnd-kit drag-reorder, reverse option, page-count inspect),
  Organize (worker-rendered thumbnails, delete/duplicate/drag-reorder grid),
  PDF→JPG (page ranges, JPG/PNG, width select, per-image + ZIP download).

**Gates (all green)**
| Gate | Result |
| --- | --- |
| `pnpm typecheck` | ✅ both packages, strict |
| `pnpm test` | ✅ 21/21 vitest |
| `pnpm build` | ✅ main bundle **592 kB / 185 kB gzip** (worker 1 MB + pdf.js 1.3 MB split out; pdf.js/pdf-lib verified absent from main thread) |
| `pnpm test:e2e` | ✅ **17/17** real-Edge checks: merge→valid 5-page PDF, organize→worker thumbnails→valid PDF, JPG→real JPEGs in valid ZIP, routes, zero console errors |

**Bugs caught by E2E and fixed (don't regress):**
1. App not wrapped in `BrowserRouter` → blank page.
2. Pool **silently dropped `options`** (`JobRecord.options` never assigned) — reverse-merge
   would have been a no-op.
3. UI sent `format: 'jpg'` but the job's `ImageFormat` is `'jpeg'` → PNGs labeled JPG.
4. Mega-menu test asserted on a header link (false positive) → now hovers + asserts a
   menu-only item (`Bates Numbering`).
5. `setState` during render (range parser had side effects) → made a pure `parseRange`.

---

## 6. P1 sign-off (2026-10-07)

**Delivered — 10 new tools, all live on the same engine**

| Tool | Engine path | UI pattern |
| --- | --- | --- |
| Delete Pages | `organize` job (kept refs) | mark-to-delete grid |
| Extract Pages | `parsePageRanges` → `organize` | range input |
| Rotate | `PageRef.rotateDegrees` (per-page) | per-tile arrows + rotate-all |
| Split by pages | `split-by-pages` job → ZIP | chunk-size input, 200-part cap |
| Alternate & Mix | interleaved refs → `organize` | two-file dropzone + pattern preview |
| Split in half | `ops/split` (MediaBox/CropBox clip) → ZIP of 2 | direction cards |
| Page Numbers | `stamp` job (`{n}`/`{N}` tokens) | format presets + position |
| Crop | `compose` crop rect (clamped) | margin inputs + live overlay |
| Header & Footer | `stamp` job (shared) | header/footer text + positions |
| N-up | `ops/nup` imposition (2/4/8, source/A4/Letter) | n cards + sheet select |

**Engine additions:** `composeDocument` (pre-save hook) · per-page rotation override ·
`crop` + `outputName` on organize · `ops/stamp|split|nup` · 4 new jobs (registry = 9 jobs)
· `thumbnails.pageIndexes` (Crop previews page 1 only).

**Web additions:** `usePageThumbnails` hook (capacity/inspect/thumbs pipeline, extracted
from Organize so every grid tool shares the guard rails) · `StampTool` is one component
serving both page-numbers and header-footer modes · registry `LIVE` reached **13 slugs** at the end of P1 (14 after P2's editor).

**Gates (all green)**
| Gate | Result |
| --- | --- |
| `pnpm typecheck` | ✅ both packages, strict |
| `pnpm test` | ✅ **46/46** vitest (21 P0 + 17 P1 + 8 audit) |
| `pnpm build` | ✅ main **632 kB / 193 kB gzip**, 0 pdf-lib/pdf.js refs in main chunk (all 94 in `job-worker`) |
| `pnpm test:e2e` | ✅ **41/41** checks over 16 sections in real Edge — every tool uploads → acts → downloads → magic-byte asserts; zero console errors |

**Bugs caught by tests/E2E and fixed (don't regress):**
1. Crop clamp used `clamp(v, edge, edge)` → always the edge; now a proper rect ∩ MediaBox.
2. pdf-lib **deflates content streams** and hex-encodes `drawText` strings → text
   assertions must inflate streams first (`unzlibSync`) and accept hex.
3. Test helper regex `stream\r?\n` also matches inside `endstream\n` → advance past
   `endstream` (9 chars) or every chunk after the first is sliced wrong.
4. `collectTransferables` could push the same `ArrayBuffer` twice → DataCloneError on
   `postMessage` (fixed pre-publish).

### P0 + P1 code audit (2026-10-07)

Line-by-line review of the Phase 0 pool/worker/render/IndexedDB layer and the Phase 1
engine + tools. **Eight real defects found and fixed:**

| # | Where | Defect | Fix |
| --- | --- | --- | --- |
| 1 | `ops/split.ts` | **Correctness.** Halves were cut from `page.getSize()` (the MediaBox), but viewers display the **CropBox** — a scan with a smaller CropBox got sliced through blank margin | Split from `page.getCropBox()` (pdf-lib falls back to the MediaBox) |
| 2 | `ops/compose.ts` | **Perf.** Every page of every source was copied even when only two were referenced (Extract from a 500-page file cloned 500 page trees) | Validate refs first, copy only referenced pages, keep a pageIndex → page map (duplicates still free) |
| 3 | `hooks/use-page-thumbnails.ts` | **Broken previews.** Old blob URLs were revoked *before* the new thumbnails rendered, so a failed re-upload left the grid pointing at dead URLs | Revoke after the swap; a failure now leaves the previous valid grid intact |
| 4 | `jobs/stamp.job.ts` | `pageOrder: []` (explicitly *no* pages) silently stamped **every** page | Only `undefined` means "all pages"; an empty order fails loudly |
| 5 | `jobs/merge.job.ts` | Merging a **single** file returned the source's own filename — a different document would land on the user's original name | `${stem}-merged.pdf` |
| 6 | `components/tools/merge-tool.tsx` | An aborted inspect left rows on `status:'loading'` forever, permanently blocking the merge behind a misleading "remove files" toast | Aborted rows are marked errored with a re-add hint |
| 7 | `ops/stamp.ts` | Options arrive over postMessage (and later over the public API) unsanitised: `fontSize: 9999`, `margin: -50`, colour components outside 0..1 → malformed PDF operators | Clamp size, margin and colour |
| 8 | `tools/recent.ts` · `lib/job-pool.ts` · `lib/download.ts` · `lib/client-capacity.ts` | **Leaks / dead code.** IndexedDB connections never closed on error paths; `pool.dispose()` left every caller hanging forever; blob URLs were revoked after 10s, which can cancel a large download mid-flight; the low-memory capacity warning was computed and then dropped by every caller | `db.close()` in `finally`; dispose rejects queued *and* running jobs; 60s revoke; `announceCapacityWarning()` surfaces the warning once per session |

Also de-duplicated a constant: `LIMITS.client.thumbnailDegradeAtPages` is now the single
threshold (the render layer hard-coded 120 while the UI hook used 250).

One Phase 0 test asserted the *buggy* merge filename — it was updated to the correct
behaviour, because a test that pins a bug is worse than no test.

Gates after the audit: **46/46** unit · **41/41** E2E · typecheck ✅ · build ✅ (632 kB main,
0 pdf-lib/pdf.js refs).

---

## 7. Gotchas (hard-won; keep here so nobody re-learns them)

**@cantoo/pdf-lib**
- `doc.isEncrypted` is a **property**, not a method.
- No `doc.getVersion()` → `context.header.getVersionString()` (wrapped in try/catch).
- `page.setRotation(degrees(n))` — the `degrees()` wrapper is required.
- `getSize()` ignores `/Rotate` (MediaBox unchanged; rotation is display-only).
- `getSize()` returns the **MediaBox**; viewers display the **CropBox**. Any box maths
  (split-in-half, crop overlays) must use `getCropBox()`, which falls back to the MediaBox.
- `drawText` with a standard font does **not** throw on un-encodable characters — emoji are
  silently mangled. Reject them explicitly if you ever need to.
- `PDFDocument.load` only takes the **decrypt** path when `password` is *defined* — pass `''`
  for owner-restricted PDFs (empty user password) or the load throws `EncryptedPDFError`.
  A successful decrypt deletes the trailer `/Encrypt`, so `doc.save()` produces an unencrypted
  copy. That is the whole Unlock tool.
- There is **no encrypt-on-save** in @cantoo/pdf-lib 2.11.1 (no `userPassword` SaveOption, no
  `EncryptStream`). Protect PDF stays planned until it is written properly; never fake it by
  setting permission bits without encryption.

**pdfjs-dist v6**
- Entry `build/pdf.mjs`; types `types/src/pdf.d.ts`.
- `getDocument` params do **not** accept `isEvalSupported`.
- `PDFDocumentProxy.destroy()` does not exist → keep the loading task and call
  `task.destroy()` (also releases the pdf.js worker).
- `RenderParameters.canvas` is **required**: pass `canvas: null` → derives from the
  context → this is what makes **OffscreenCanvas** rendering work.
- Worker URL injected by host: `configurePdfjsRuntime({ workerSrc })` with
  `import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`.
- **pdf.js cannot spawn a real nested worker from inside a Web Worker.** Its
  `PDFWorker.#initialize` dereferences `window` (`_isSameOrigin(window.location,
  workerSrc)`), which does not exist in a worker global, so every document load
  falls back to the sanctioned in-thread path (`#setupFakeWorker` + `LoopbackPort`)
  and logs `Setting up fake worker.` once per worker context. That is expected and
  harmless when pdf.js already runs inside the job worker (work is off the main
  thread either way) — silence it per load with `verbosity:
  VerbosityLevel.ERRORS` threaded through `configurePdfjsRuntime` (see
  `apps/web/src/workers/job-worker.ts` `PDFJS_DOC_OPTS`), never by disabling the
  worker or running pdf.js on the main thread. Confirmed empirically 2026-10-28
  with an instrumented Playwright capture: the warning originates in the job
  workers, relayed to the page console by Vite 8's `server.forwardConsole`
  (attribution shows as `@vite/client`), and `verbosity: ERRORS` removes it while
  corrupt/encrypted-PDF failures still surface (witnessed by the pdf-core suite).

**Rendering / workers**
- Render inside the Web Worker via `OffscreenCanvas`; transfer `ArrayBuffer`s out.
- pdf.js takes ownership of buffers it is given → always `data.slice()` a copy first.
- Call `page.cleanup()` per page, or big documents blow the tab heap.
- Re-read `File` bytes for every run — input transfer detaches main-thread buffers.

**Build / bundling**
- `packages/pdf-core` needs `"sideEffects": false` and `parsePageRanges` in a
  **dependency-free module** (`ops/ranges.ts`), or pdf-lib/pdf.js leak into the main
  bundle (cost us 1599 → 588 kB once fixed).
- pdf.js `canvasContext` must be cast to `CanvasRenderingContext2D` (its types name only
  the DOM variant).
- `JobInputBase['options']` is `Record<string, unknown>` → custom options types must be
  **type aliases** (object literals get implicit index signatures; interfaces do not).
- Live web previews may call an engine formatter, but only from a **pdf-lib-free module**
  (`ops/renamePattern.ts`, `ops/splitByText.ts`, `ops/ranges.ts`, `ops/textMetrics.ts`).
  Importing a job module from a component drags the whole worker engine into the main chunk.
- Vite 8 is Rolldown: `output.manualChunks` is removed (object form) or deprecated (function
  form). Split vendors with `build.rolldownOptions.output.codeSplitting.groups` (`name` +
  `test` regex) — the vendor chunks then get stable names across app deploys.
- A worker's **dynamic** import is emitted as an ordinary app-visible chunk. pdfium therefore
  ships as `index.browser-*.js` and only `job-worker-*.js` imports it, so a "no engine outside
  the worker" scan must follow the worker's imports, not just chunk filenames.
- `apps/web/src/App.tsx` lazy-loads `ToolPage` (all tool bodies, the editor and AI surfaces sit
  behind it). Keep the entry chunk at ~139 kB; the tool chunk loads on navigation.
- A bundle **inlines** its imports, so an `import.meta.url === pathToFileURL(argv[1])` "run me
  directly" guard is true in every bundle that contains the module. The API bundle (which imports
  `worker/host.ts`) started a second, unbounded worker in production for exactly this reason; the
  hardening gate caught it because the `api` container logged "worker host ready". Only a
  dedicated entry (`src/worker/main.ts`) may call `startWorkerHost`.

**Web tools / React 19**
- StrictMode invokes state updaters twice. Never create or revoke object URLs inside
  `setState(prev => …)` — it leaks one URL per file in dev. Compute the next list outside the
  updater (the JPG-to-PDF tool keeps an `entriesRef` mirror for this).
- A button whose label follows a *combined* "busy" flag lies: the Compress/Rename tools run
  `inspect` on upload, and the first build showed "Compressing…" before the user pressed
  anything. Track `inspecting` and the real run separately.

**Tests (anti-regression — all covered by the 46 tests)**
- `parsePageRanges`: bare `"5"` = single page (≠ `"5-"` open range); `"99-200"` on 10
  pages clamps to page 10 (not empty); `pageFileName` pad width = `String(total).length`.
- `timeoutForPageCount(pageCount, baseMs)` needs an explicit `: number` on `baseMs`
  (literal inference from `as const` infects callers).

**P2 editor (display space, cantoo draw, pdf.js in vitest)**
- `page.rgb(r,g,b)` in @cantoo/pdf-lib returns `{ type, red, green, blue }` — **not** `r/g/b`
  (and `embedJpg`, not `embedJpeg`).
- pdf-lib grows widget rects by **half the border on all sides** (200×24 → 201×25) — verify
  form rects against the drawn UI, not the source values.
- `drawText` hex-encodes its output → test text presence via the `pdfContainsText` helper
  (`ops` bytes contain the hex string), not raw ASCII.
- The hex is **uppercase** in the stream (`<43415345…>`). Byte-scanning E2E helpers must
  lowercase both sides before comparing a UTF-8 → hex conversion.
- Node/vitest pdf.js: alias to `pdfjs-dist/legacy/build/pdf.mjs` (regex alias in
  `packages/pdf-core/vitest.config.ts`) and set workerSrc inside tests via
  `new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)` —
  no `node:` imports (pdf-core tsconfig has `"types": []`).
- `job-pool` transfers **only `files[].data` buffers**; `options` are structured-cloned —
  embedded image bytes in `options.objects[].data` survive dispatch. Files, however, are
  detached → re-read `File` bytes for every job run.
- A React handler that calls `stopPropagation()` on `pointerup` blocks bubbling at the
  React root → **window-level** native gesture listeners never fire (drag never ends).
  Gesture handles must only stop `pointerdown`.
- TS aliased-condition narrowing does **not** survive property re-access
  (`runner.state.progress` after `runner.state.status === 'running'`) → narrow a local
  `const state = runner.state` instead.
- Importing a **value** from a module that reaches for `@cantoo/pdf-lib` drags pdf-lib
  into the main browser chunk even with `sideEffects: false` (pdf-lib is not
  tree-shakeable). Shared constants live in `ops/textMetrics.ts`, dependency-free, for
  the same reason `ops/ranges.ts` does — the editor styles its textarea from them.
- `PDFField.addToPage` does **not** write `/P` on the widget annotation; real documents
  (Word/Acrobat/LibreOffice) do. So `extractFormWidgets` trusts `/P` and falls back to a
  rectangle index, which is what pdf-lib-made fixtures need.
- `form.getField()` in this fork compares `getName()` exactly — it does **not** split on
  dots, so `applicant.name` resolves fine.
- A PNG with alpha becomes **two** image XObjects (image + SMask): count XObjects
  comparatively in tests, never by absolute number.
- A deferred/queued fetch must clear its own "pending" marker before re-entering the
  scheduler, or the dequeued item looks busy and is skipped forever (cost us an E2E).
- `setState` inside a state updater is impure (StrictMode double-invokes it) — build the
  next id outside and select it after the update.
- CSS puts a text baseline at `(line-height + ascent - descent) / 2` from the box top —
  with `line-height: 1.2` over an Arial-metric stack that is `0.9465em`, which is what
  `TEXT_ASCENT` reproduces so exports do not shift.

**P3 server (Node, Express, BullMQ, Docker)** — the whole slice was built green on unit
tests and still shipped three production bugs, all of the same species: *config that was
never actually wired, and a stream with no error listener.*
- **esbuild does not typecheck.** A zod schema key that never landed produced a bundle that
  built cleanly, passed 49 unit tests (they construct options directly, not from `process.env`)
  and ran the janitor on its **defaults forever**. `pnpm typecheck` is a separate command —
  never treat a successful build as a successful compile.
- **Read-stream `'error'` with no listener resets the socket.** `createReadStream(...).pipe(res)`
  on a file the janitor deleted one millisecond earlier hangs up on the client instead of
  returning 404. Always `stat` first *and* attach the handler; the race is real, not theoretical.
- A JSON-schema knob that exists in `loadConfig` but not in the schema is silently
  `undefined` at runtime. When adding an env var: schema **and** mapping, in the same edit.
- Enumerate on-disk state through a *content* assertion (`200 → 404` on a known file), not a
  directory count: another job can land, or be swept, inside the same polling window and a
  count flakes where a file's fate does not.
- A rate limiter keyed on the client IP makes any re-runnable test suite flaky by design —
  have the suite wait out the window up front, and assert the limit in its own section.
- **Metadata-only results are not "no output".** A slug that returns `{documents:[…]}`
  produced zero binary candidates and got rejected as undeliverable. Serialise plain-object
  results to `<slug>-result.json`; only throw when nothing is serialisable.
- Docker: a runtime stage that copies `dist/` alone breaks every import — pnpm symlinks live
  in the workspace `node_modules`. Keep `WORKDIR /repo/apps/api` and install with `--prod`.
- The prod install needs `CI=true` **and** `--config.confirmModulesPurge=false`, else
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.
- `docker compose kill` writes to **stderr** and prints nothing to stdout; assert on
  `compose ps --format json` state, never on command output length.
- With `FILE_TTL_MS` shorter than the queue wait, the janitor can delete a **queued** job's
  inputs → it settles as `failed`. Legitimate; a gate should assert "settles" not "completes".
- `busboy` fires `'close'` after every part completes, so appending to an array on *write*
  completion **scrambles multipart order** (merge got its inputs backwards). Capture index at
  `'file'` event time.

**Tooling**
- `pnpm dev`'s embedded worker runs `apps/api/dist/processor.cjs`, and `tsx watch src/server.ts`
  never builds it. `predev` now rebuilds the API bundle first (esbuild, under a second); without
  that step a fresh clone accepts a job and the sandbox fails to require its processor. A stale
  bundle is the subtler failure: jobs that predate the last batch run, new ones do not.
- pnpm 11 ignores the `pnpm` field in `package.json` → `onlyBuiltDependencies` lives in
  `pnpm-workspace.yaml`. Root installs need `pnpm add -Dw`.
- Playwright: use `channel: 'msedge'` (system Edge) — no browser download needed.
- **`/api/tools` answering does not mean the queue works.** It is served without Redis; a
  server-run workflow then submits to `/api/jobs` and dies. Gate server-side E2E on
  `/api/health` reporting `redis.status === 'connected'`, and skip loudly instead of waiting
  out a three-minute download timeout (smoke §19 does).
- **Starting the web server standalone (`$ vite` inside `apps/web`) skips the root
  `predev`,** so the API (and Redis auto-start) never boot and the Vite `/api` proxy floods
  the log with `ECONNREFUSED` on every `/api/auth/me` + `/api/tools` poll. That is what
  `dev2.log` was (2026-10-28): an environmental gap, not a code bug — from the repo root
  use `pnpm dev`, which serialises predev → Redis → web+api. The API itself was verified
  to boot clean and serve `/api/tools` (200) and `/api/auth/me` (204 unauthenticated).
- **`pnpm test:hardening` only makes sense against the Dockerized stack.** Its first real
  check refuses to run unless `/api/health` reports `retentionMs <= 120000` (short TTL for
  the sweep assertions), and it SIGKILLs the compose `worker` container — against the
  in-process `pnpm dev` stack there is no container to kill ("no worker container found").
  Run `FILE_TTL_MS=20000; JANITOR_INTERVAL_MS=5000; docker compose up -d --build` first;
  then the gate is 20/20 green. Caveat learned while running it: on Windows two API
  processes can bind port 8080 simultaneously (SO_REUSEADDR-style co-binding), so a stale
  `tsx watch` from an earlier session keeps serving with *old* config — verify which PID
  owns 8080 (`Get-NetTCPConnection -LocalPort 8080`) before trusting a health payload.
- Encrypted test fixtures: @cantoo/pdf-lib cannot *create* one, so
  `scripts/make-encrypted-fixtures.py` (dev-time pypdf, not a dependency) writes
  `test/fixtures/encrypted-aes128.pdf` (user password `shush123`) and
  `encrypted-owner-only.pdf` (empty user password). The PDFs are committed; the script is not
  part of any build.
- React 19: no global `JSX` namespace → use `ComponentType`; `useNavigate` requires the
  Router context (header is inside `BrowserRouter`).
- **A validation regex with a leading `^` alternative only ever checks the first character.**
  The MCP base-URL guard spent a day refusing control chars everywhere while silently allowing
  `https:\attacker.example` because WHATWG's backslash-folding on special schemes made the
  URL parser accept what looks like a path as a host. When reviewing a "refuse these characters"
  class, assert a smuggle case *at every position* (`test/base-url.test.ts` does), and remember
  that percent-encoding can introduce `?`/`#` that `url.search`/`url.hash` will never see.
- **An effect in a component ABOVE a Radix portal can run before the portal content mounts.**
  The MCP console's entrance animation lived in the dialog shell and therefore queried elements
  that did not exist yet; the panels shipped as `opacity: 0` and never arrived, with no error
  anywhere. Anything that animates content on open now lives *inside* the portal (a `DialogPanels`
  child that mounts with the content), and every screenshot pass looks for "the panel is missing",
  not only "the panel is wrong".
- **Join authored content to live data on the canonical key, not the pretty one.** The console's
  sample calls were keyed `split_by_pages` while the catalog serves `split-by-pages`, and the
  mismatch showed up only as three missing chips. Display names get prettified; joins use the
  canonical slug, and the transformation between them gets its own unit test.

---

## 8. Changelog

- **2026-11-13 - The frontend ships on Cloudflare Pages. The server tier is parked, on purpose.**

  The owner set a hard constraint — **₹0/month, no credit card, no paid infrastructure** — and that
  constraint decided the deployment architecture rather than the other way round. The frontend now
  ships on **Cloudflare Pages** (free, no card, Git integration, free TLS), the custom domain is
  `pdfshush.space`, and the Express API, the BullMQ worker, Redis and MongoDB **stay in the
  repository** for local development and are **not deployed**.

  **The draft VPS deployment was deleted, not parked.** The Caddyfile, the web Dockerfile, the
  `web`/`cloudflared` compose services, the SSH deploy script and the production env file were
  removed; `docker-compose.yml` and `package.json` went back to their previous state, so
  `pnpm stack:up` still brings up exactly the redis + api + worker it always did. The backend code
  was not touched.

  **The app learned what deployment it is in.** `apps/web/src/lib/deployment.ts` reads one build
  variable, `VITE_SERVER_API=off`, and every server-backed surface asks it first: the header hides
  sign-in, the account page says the server is not deployed here, the workflow builder disables the
  step picker and **Run workflow**, the managed-AI trial stays off, and the API/MCP reference pages
  document the surface without pretending it is reachable. `api()` rejects with
  `server_unavailable` **before touching the network**, so the browser console stays clean instead
  of filling with failed requests to a host that never had an API. The switch is build-time on
  purpose: a static host has no `/api` to ask, and "the API did not answer" and "there is no API"
  are the same observation.

  **Two static-host facts were measured, not assumed** (with Cloudflare's own `pages dev`
  emulator). First: Pages resolves a directory's `index.html` only at the **trailing-slash** URL —
  `/tools/merge-pdf` 308-redirects to `/tools/merge-pdf/` — which would have left every canonical
  URL and all 55 sitemap entries pointing at a redirect. The prerender now writes **flat**
  `dist/<route>.html` files, and the extension-less path answers **200** with the same document.
  Second: without a top-level `404.html`, Pages answers an unknown URL with the app shell and a
  **200** (a soft 404). The build now emits one, so an unknown URL and every `/api/*` path answer a
  real **404**.

  **The Pages cache policy is a file, not a dashboard setting** (`apps/web/public/_headers`):
  `/assets/*` immutable for a year (Vite hashes those names), everything else revalidated, and
  deliberately **no `/*` cache rule** — Pages joins the headers of every matching rule, so a
  catch-all would turn "immutable" into "immutable, no-cache".

  **The gate tooling learned to target a remote origin.** `tests/support/preflight.mjs` now honours
  `E2E_BASE_URL`: it checks that origin and skips the local compose assertions, and it reports a
  missing API as a note rather than a failure, because a frontend-only deployment is a valid shape.
  The smoke suite's account assertions branch on the shape too — they used to read *"no catalog"* as
  *"accounts enabled"*, which is what made them demand a sign-in control on a static deployment.

  **Verified locally against Pages' own emulator**, not claimed: prerendered routes answer 200 with
  the right `<h1>`, canonical and JSON-LD; `/sitemap.xml`, `/robots.txt` and `/sw.js` answer 200 with
  the intended cache headers; unknown URLs and `/api/*` answer 404; and the smoke suite plus reach,
  offline, a11y, keyboard, verify, plain-tools, next-tools, forms-bookmarks, bookmark-batch,
  dark-mode, deskew, OCR, text-edit and text-model are green against that origin with **no console
  errors**. The full unit suite (**1 528** unit tests, one of them an expected fail) and the bundle
  boundary are green.

  **Not claimed:** no Cloudflare account, no Pages project, no public URL yet. M6.1 stays open until
  `docs/DEPLOY.md` §7 is green against `https://pdfshush.space`. And the **server tier is M6.1b**,
  deferred: it needs a host that runs a persistent queue and a writable volume, and every card-free
  option either sleeps (Render), has no free tier (Fly.io), costs $29/month (Koyeb), cannot be the
  BullMQ broker (Upstash has no blocking commands) or needs a card and can be reclaimed after seven
  idle days (Oracle Always Free). The code stays, it runs locally, and when a host is chosen the
  same source produces both builds.

- **2026-11-08 - The OCR batch: scanned documents become searchable without leaving the tab.**

  The second of the nine declined tools is now live. **OCR** renders each page, recognizes it with
  Tesseract inside the existing job worker, and writes an **invisible text layer** over the original
  scan. Search and copy-and-paste work; the page still looks exactly like the scan the user
  supplied. The UI says that before the run, along with the two real costs: the first run downloads
  about 15 MB of recognizer and English language data (then it works offline), and recognition is
  English-only and probabilistic, not a proofread transcript.

  **The engine stayed out of the engine package.** `packages/pdf-core` owns the pipeline (render,
  sanitize, place, rebuild) but takes an injected `OcrEngine`; the Tesseract adapter lives in
  `apps/web/src/workers/ocr-engine.ts`. Node and the server never import WebAssembly, and the 14
  new engine tests cover sanitization, pixel-to-point placement, invisible-text extraction through
  pdf.js and the job envelope without loading a recognizer.

  **Every byte is same-origin.** The nested worker script, the LSTM core and
  `/tessdata/eng.traineddata.gz` are emitted by the build and served by Vite dev; the service worker
  caches `/tessdata/` so a second run is offline. No CDN origin was added to the CSP. The OCR E2E
  records every request and fails if anything leaves the origin; it observed only
  `http://localhost:5173/tessdata/eng.traineddata.gz`.

  **Text quality decisions.** Words are placed individually at their recognized boxes with a
  reserved 0.2 em gap after each run, so extraction keeps spaces instead of gluing `INVOICE2026`
  together; each line gets one font size from its box height. Tesseract output is mapped to
  WinAnsi-safe characters (curly quotes, dashes and ligatures become ASCII) because one unsupported
  code point would fail the whole page. Pages that already carry a text layer (>= 16 non-whitespace
  characters) are copied untouched rather than re-recognized, and the result reports recognized and
  kept pages separately.

  **Limits are explicit.** A run caps at 100 pages, the timeout scales at 5 minutes + 5 seconds per
  page up to the global 15-minute job ceiling, and the per-tool trust card names the page cap, the
  first-run download and the English-only/accuracy caveats. Cancelling aborts the outer job and
  terminates the nested Tesseract worker, since recognition is synchronous inside it.

  **Encrypted sources are handled honestly.** An owner-restricted PDF (permissions set, empty user
  password) is opened with that empty password, recognized, and written back **without** its
  restrictions — the tool says so before the run and points at Protect PDF. A file with a real open
  password is still refused with an Unlock hint, because guessing it would be a lie. This also
  fixed a truthiness bug in `inspect`/OCR that made permission-only files unreadable to every tool.

  **The download is gated on a re-parse.** Before the result panel enables Download, the engine
  reopens the serialized bytes, confirms the page count, and checks that every recognized page
  still yields extractable non-whitespace text; a blank page with no placements is allowed, a page
  that lost its claimed layer fails the job. The deskew result copy stopped claiming a re-parse it
  never performed.

  **Verification.** `pnpm -r typecheck`; `pnpm test` **1 409/1 409** (pdf-core 488, API 214,
  provider 375, agent 152, web 161, MCP 19); `pnpm build` (main chunk 172.9 kB, model emitted at
  `dist/tessdata/eng.traineddata.gz`); `pnpm test:bundle` green with the boundary regex extended to
  `tesseract` (main 0 engines, 17 lazy chunks 0 engines). The new `test:e2e:ocr` passed every check:
  a genuinely text-free JPEG scan recognized at **96 %** confidence (10 words / 43 characters), the
  model fetched only from this origin, zero external requests, a `%PDF-` download still carrying
  `DCTDecode`, and the hidden words read back out by the separate **PDF to Text** tool
  (`INVOICE 2026 ACME SUPPLIES LTD PAID IN FULL TOTAL 42`). A second fixture proved an
  already-searchable page is kept untouched; a third (owner-restricted) proved the disclosure, a
  successful recognition and an unencrypted output; a fourth (real password) was refused with no
  run offered. Catalogue: **58 entries, 51 live, 7 declined**.
  `test:api`/`test:hardening` remain unrun because Docker is unavailable here; they are not claimed.

- **2026-11-05 - Stale-build recovery: an old tab can no longer strand users on an unstyled shell.**

  A `/tools/edit-pdf#main` report showed the giant wordmark, un-styled nav/footer and the route
  error boundary. The tab had outlived a rebuild: its HTML pointed at hashed assets that the new
  build deleted. Vite preview's SPA fallback answers a missing CSS file with `index.html` and a 200,
  so the browser held a stylesheet object with zero rules (no `error` event), and a missing lazy
  chunk opened the route boundary. `lib/build-recovery.ts` now detects chunk/preload errors and
  empty same-origin stylesheets, unregisters the old PDFShush worker, clears only `pdfshush-*`
  caches and performs one guarded reload with a `__build` cache-buster. The boundary's Reload is
  the same hard reset, service-worker navigations use `cache: 'no-store'`, and `index.html` carries
  a minimal critical fallback style so a missing stylesheet is readable rather than a full-screen
  wordmark. The new `tests/e2e/stale-build.mjs` (8/8) reproduces both failures. Web tests are now
  **146**; total **1 356/1 356**. See section 34.7.

- **2026-11-05 - Responsive product shell: desktop workstation, tablet editor, phone app.**

  The editor now adapts its **interaction model**, not just its width, while keeping one PDF
  engine, document session, command set and undo history. Desktop (>=1100 px) keeps the full
  three-column workstation. Tablet (600-1099 px) gets larger targets, a collapsible page drawer,
  a bottom inspector in portrait and a right drawer in landscape; 1024 px iPads are tablets now.
  Phone (<=599 px) becomes a document-first app: one compact top bar, a canvas HUD for page/zoom,
  a horizontal thumb tool strip, four bottom destinations (Edit, Annotate, Pages, AI), a
  contextual properties sheet and a bottom document-actions sheet. Pinch-to-zoom, rotation
  re-fit, safe-area padding and an explicit unsaved-changes close gate were added. The mobile
  marketing surface drops the photographic plate, frosted hero panels, document image and feature
  video; the AI mock becomes three compact tool links.

  **Bugs found and fixed during the pass.** (1) The first mobile build placed two `useCallback`
  hooks after the result-state early returns; saving then crashed with React error #300
  ("rendered fewer hooks than expected"). The handlers are now plain functions after the early
  returns, and hooks remain above them. (2) The result panel's action row clipped the Download
  button at 390 px; actions now stack full-width on phones. (3) The mobile AI links overflowed the
  viewport (438 px document width at 390 px) because the grid item kept a nowrap min-content
  width; `grid-cols-1` + `min-w-0` fixed it. (4) The decorative Greek plate was still downloaded
  on phones even though CSS hid it; `<picture><source media="(min-width:1024px)">` now replaces it
  with a 1x1 transparent fallback below 1024 px. (5) Mobile axe found a visible-label/accessible-
  name mismatch on the zoom readout and a serious contrast failure in the comparison table; both
  are fixed.

  **Bug-check follow-up (same day).** Three issues survived the first pass and were fixed before
  this record was finalised. (6) The desktop hero's day plate had become `loading="lazy"` while
  still carrying `fetchPriority="high"`; it is eager again, so the <1024 px saving does not cost
  desktop LCP. (7) The responsive sweep counted hidden `data-reveal` blocks (the phone-hidden AI
  tabs and feature video) as "unrevealed"; it now ignores `display:none` blocks, so the sweep is
  clean across 6 breakpoints × 2 themes × 6 routes. (8) The decorative studio waves legitimately
  extend past the viewport inside an `overflow:hidden` cover; they are now marked `data-bleed`,
  the sweep's documented exception for clipped art, instead of being reported as layout overflow.

  **Verification.** `pnpm -r typecheck`; `pnpm test` **1 354/1 354** (engine 455, API 214,
  provider 370, agent 152, web 144, MCP 19); `pnpm build`; `pnpm test:bundle` green (main 150.8 kB,
  0 engines, 17 lazy chunks with 0 engines). `pnpm audit --prod --audit-level high`: no known
  vulnerabilities. Browser: full smoke, `deskew`, `dark-mode`, `plain-tools`, `next-tools`, `a11y`
  (all routes + editor), `keyboard`, `offline`, `reach` and `verify` green against the dev stack and
  the production preview; `test:sweep` clean. Manual Playwright at 320/390/430/599/600/700/768/
  1024/1280 px: zero horizontal overflow, annotation/undo/redo, page nav/delete, properties sheet,
  AI workspace, save and PDF download verified; pinch 65% -> 130%; no `/hero/` request below
  1024 px. Mobile axe (390 px) clean on home, editor and editor-with-properties. See section 34.

- **2026-11-05 - The scans batch: Deskew shipped, and three raster tools stopped producing blank pages.**

  The first of the nine declined tools is now live. **Deskew** estimates each page's skew with a
  projection-profile estimator (the angle that collapses the text rows into the sharpest horizontal
  profile), rotates the page pixels back to level, and rebuilds a fresh document. Automatic
  detection is bounded to ±10°; a manual override covers ±45°. The UI states the cost before the
  run — pages become images, text stops being selectable, and a rotated page keeps its corners with
  thin white wedges — and reports the angle actually applied to each page.

  **A real bug found while building it.** Grayscale PDF, Dark Mode PDF and strong (raster) Compress
  embedded their JPEG and then added an empty page: `embedJpg()` followed by `addPage()` without
  `drawImage()` leaves the image unreferenced, so the downloaded pages rendered blank. Their E2E
  suites only asserted `DCTDecode` and the file name, which is why it hid. All three now go through
  one `addRasterPage()` helper that embeds *and* draws, and a Node test pins the page's `/XObject`
  resource so the blank-page regression cannot come back.

  **The estimator is pure and tested.** `estimateSkewAngle()` takes an ink matrix and returns the
  angle; the worker only reduces a rendered page to that matrix. Synthetic rulers at +4° and −3° are
  recovered within 0.6°, a straight page returns 0, and a blank/malformed matrix refuses to guess.
  The browser E2E does the only assertion that matters: after one pass, the downloaded file is
  re-opened, detected again, and must come back straight (≤ 1.5°).

  **Verification.** `pnpm -r typecheck`; `pnpm test` **1 354/1 354** (pdf-core 455, API 214,
  provider 370, agent 152, web 144, MCP 19); `pnpm build`; `pnpm test:bundle` green (main 149.3 kB,
  0 engines, 17 lazy chunks with 0 engines). Browser suites re-run against this commit: the new
  `test:e2e:deskew`, full smoke, dark-mode, plain-tools, next-tools, a11y (now 16 routes incl.
  deskew), keyboard, offline, reach (**50 live, 54 sitemap URLs**) and verify — all green.
  Catalogue: **58 entries, 50 live, 8 declined**. `test:api`/`test:hardening` remain unrun because
  Docker is unavailable here; they are not claimed.

- **2026-11-05 — Reliability pass: one auth owner, real history sync, and honest failure boundaries.**

  The engine, redaction serialization and editing ladder were not touched. This pass closed a set of
  surface defects found by asking the account, workflow and editor screens to prove their own claims.

  - **Accounts have one owner.** `use-auth.ts` is now an `AuthProvider`; the header, account page and
    workflows page used to mount three independent copies, so signing out in one left the others
    showing a stale user until reload. Refreshes are abortable and ignore results after unmount, a
    failed sign-out no longer pretends the server session was revoked, and `/api/tools` now reports
    `accounts.enabled` so an accounts-off deployment hides the sign-in control instead of sending
    users to a 503.
  - **History sync writes through.** Previously the "sync history" switch copied the browser's
    entries once and stopped. New `lib/history-sync.ts` mirrors every later `recordRecent` to
    `/api/account/history` while the preference is on; uploads are best-effort and never fail a
    finished tool. The account page imports existing rows once per account (localStorage marker),
    sends `clientId` + `createdAt`, and the store makes duplicate imports idempotent (one row, re-read
    on a duplicate-key race). Export now includes history, workflows and jobs.
  - **API hardening.** Preference keys are restricted to `[A-Za-z0-9_-]{1,64}` before reaching a
    Mongo `$set` (a dot or `$` is a field path/operator, not a name); `clientId` is length/charset
    checked and `createdAt` is bounded to `now + 5 min`; preferences now merge per key instead of
    replacing the whole `values` object. The auth callback validates a return path and sends a
    cancelled or failed sign-in back where it started, while still consuming the single-use state.
  - **Failure boundaries and navigation.** A route-level `ErrorBoundary` (keyed by pathname) keeps
    the shell and a way home when a lazy chunk fails after a deploy; SPA navigation resets scroll;
    a skip link precedes the header and `main` is focusable; an HTML/non-JSON API body now becomes a
    typed `ApiError` instead of a raw `SyntaxError`.
  - **Mobile, editor and a11y parity.** The mobile sheet gained account/sign-in controls (it had none);
    the editor text layer is keyboard-drivable (arrow/Home/End between paragraphs, Enter to edit,
    Escape to clear) and resize handles take arrow keys; form widgets are labelled; the image editor
    crops with the keyboard; the theme provider no longer depends on `next-themes` and follows OS
    theme changes live; editor select mode allows vertical touch scrolling.
  - **Workflows can be cancelled and cannot be mis-chained.** `inspect` and `split-by-pages` are
    terminal: they cannot feed a later step and are only allowed last. Cancelling a run now rejects
    the poll delay promptly and best-effort `DELETE`s the server job, so a local cancel does not leave
    a paid job running. The builder re-links steps through one tested helper.

  **Evidence.** `pnpm -r typecheck`, `pnpm test` **1 344/1 344** (pdf-core 445, API 214, provider 370,
  agent 152, web 144, MCP 19), `pnpm build`, `pnpm test:bundle` green (main 149.3 kB / 0 engines;
  17 lazy app chunks / 0 engines; engines only in worker chunks). No engine test changed.

  **Not claimed.** The browser suites were not re-run in this pass, and `test:api`/`test:hardening`
  remain unrunnable here (Docker daemon unavailable). The new editor keyboard paths are documented and
  unit-adjacent but **not** covered by `test:e2e:keyboard` yet; the accounts-disabled header state is
  unit-tested, not browser-tested.


- **2026-11-04 - Post-ship bug pass: the editor's selected state, declined metadata and the popular row.**

  Four surface defects, found by asking each claim to prove itself. Selecting an editor object
  turned the wrapper into a `role="button"` containing four resize buttons, and the font-size input
  had no label; the wrapper is a `group` while selected and the input is labelled. The tool-group
  headings and status text failed colour contrast at 72%/75% muted tokens; they use the full token.
  The a11y suite now creates and selects an object before running axe.

  Declined pages still had a "free and private" title, a "runs in your browser" description and a
  `SoftwareApplication` JSON-LD. They now say "not built", describe the decision page, and emit
  `WebPage`; they stay `noindex`. The home "Most popular" row still linked `pdf-to-word`, a declined
  tool; it now uses `redact-pdf`, and `popularTools()` filters to live with a test. The prerendered
  `/tools/workflows`, `/tools/api` and `/tools/mcp` pages also no longer claim "parsed inside this
  browser tab"; each states its real server data path. README no longer says "in development".

  Most serious: `apps/web/build/prerender.ts` was ignored by the repo-wide `build/` rule, so the
  pushed M5.5 commit imported a file that was never committed and a clean checkout could not build.
  `.gitignore` now re-includes `apps/web/build/` and the source is tracked.

  Evidence: `pnpm test` **1330/1330**, bundle green, a11y **17 checks** (including the editor with a
  selected object), reach **71**, keyboard 19. No engine, redaction, ID-hash or editing-ladder rule
  was touched.

- **2026-11-04 - M5.8: release evidence, and the verifier moved off the main thread.**

  The last engine-bearing app chunk is gone. `/verify` now posts bytes to a dedicated
  `verify-worker.ts`, which owns pdf.js/pdf-lib and returns the checks; the page chunk is 12.9 kB and
  `pnpm test:bundle` is **green** (main 141.2 kB / 0 engines, 11 lazy app chunks / 0 engines, engines
  only in worker chunks). `tests/bundle-boundary.mjs` now classifies every `*-worker-*.js` as worker
  code instead of only `job-worker-*`; the rule is unchanged, the classification is correct.

  Final campaign: typecheck, `pnpm test` **1330/1330**, build, bundle; dev E2E smoke, text-edit,
  text-model, sign, plain-tools, next-tools, bookmark-batch, forms-bookmarks, dark-mode; preview
  E2E offline/privacy (26), reach (71), a11y (17), keyboard (19), verifier (4). Final baseline:
  p95 **499 ms**, first interaction 14 ms, long task 122 ms, iPhone heap 10 MB, **49/49** live tools
  zero serious axe, **52/52** crawled routes with content, **49/49** limit copy, determinism
  identical, 0 egress. The per-tool Q1-Q8 table is in §31.21.

  Not hidden: `test:api` and `test:hardening` could not run because the Docker daemon is unavailable
  in this environment. They were green in Phase 4 and no API/worker code changed here beyond M5.2's
  test-only poll, but the release gate is not called fully green without them. The tool chunk is
  still 589 kB, p95 has limited headroom, OCR is declined, and no real screen reader or iOS device
  was exercised.

- **2026-11-04 - M5.7: the nine "planned" entries became nine documented decisions.**

  The `planned` state is gone. All 58 catalog entries are `live` (49) or `declined` (9). Each
  declined page keeps its URL, says "Not built — and here is exactly why", names the real blocker and
  links the closest live path: Word/Excel/PowerPoint conversions point at PDF to Text or PDF to JPG;
  Word/HTML→PDF point at the browser's own Print → Save as PDF; deskew points at Rotate + Crop; OCR
  points at PDF to Text with the honest warning that a scan returns empty; sign routing points at
  Fill & Sign; batch conversion points at Batch run.

  The reasons are data in `apps/web/src/tools/declined.ts`, pinned by five tests: every entry is
  live or declined, the nine slugs match the record exactly, counts are 58/49/9, every reason is
  substantive, and every named alternative is live. There is no "in development" fallback, no email
  capture, no date. Declined pages are `noindex` and absent from the sitemap.

  Honest gap: declining is not shipping. A visitor who needs OCR or DOCX still has to use another
  product. This is one commit for a single catalog-state change, not nine mechanical commits.

- **2026-11-04 - M5.6: zero serious axe findings, and a canvas the keyboard can drive.**

  `pnpm test:e2e:a11y` runs WCAG 2.2 AA axe over the shell, `/workflows` and 13 tool routes and
  fails on critical/serious findings. Two shared defects were responsible for almost every
  violation: the "live" badge (`emerald-600` on a 10% wash) and the footer/card "soon" labels
  (`text-muted-foreground/60` and `/70`). Fixing them at the chrome level cleared all 49 home cards
  and every tool page. The hero dropzone's `aria-label` contradicted its visible text; it now uses
  the visible sentence as its name.

  The editor gained a real keyboard path. The page is focusable and described; **T** selects the
  text tool, **Enter** places a text box at the centre and opens it (or selects the topmost object
  in Select mode), arrow keys nudge, Delete removes and Ctrl+Z restores. Overlay objects are
  focusable with a spoken description and Enter selects them.

  Evidence: `pnpm test:e2e:a11y` **17 checks** green; `pnpm test:e2e:keyboard` **19 checks** green,
  including a text object created, nudged 7 px, deleted and undone without a mouse. CI's perf job
  now runs axe, keyboard and reach against the production preview. Honest gaps: 15 routes in the
  axe budget, six representative tool classes, and no real VoiceOver/NVDA session.

- **2026-11-04 - M5.5: every tool URL has real HTML before JavaScript, and the catalog is machine-readable.**

  The build now prerenders the home page, the four shell routes and all 58 tool URLs to
  `<route>/index.html` with an h1, description, explanation, limits and related tools. React replaces
  the subtree on mount, so there is no hydration contract and no second source of truth. Each route
  gets its title, description, canonical, Open Graph/Twitter tags and a 1200x630 card; the 59 cards
  were generated once and committed, so the build needs no native canvas. Live tools emit
  `SoftwareApplication` JSON-LD; not-built pages are `noindex, follow` and stay out of the sitemap.

  `sitemap.xml` has 53 URLs (49 live tools + 4 shell routes), `robots.txt` disallows `/account` and
  `/api/` and points at it, and a preview-only middleware serves `route/index.html` so local testing
  matches a static host instead of the SPA fallback. `VITE_SITE_ORIGIN` sets the canonical origin;
  the default is `https://pdfshush.app` and the build prints what it used.

  Evidence: new `pnpm test:e2e:reach` **65 checks** green against the production preview (crawlable
  content for 49 tools, 5 unbuilt pages noindex, sitemap/robots, a real PNG card, 3,951 characters of
  home text without JS); the 26-check offline/privacy suite still passes on the same build. Honest
  gaps: this is static HTML, not React SSR; the default origin is a placeholder a deploy must
  override; the cards share one layout.

- **2026-11-04 - M5.4: the performance ceilings became a gate, and the tool route stopped parsing pdf-lib.**

  `pnpm test:perf` re-measures Q3/Q7 against a production build: every live tool route at 4x CPU
  (two warm reloads, faster sample, both kept), a 50-page merge's long tasks, a 200-page merge on
  iPhone-13 Chromium, and a WebKit iPhone run. It exits non-zero on a breach and writes
  `tests/benchmarks/m5-4-ceilings.md`. CI runs it with `M5_PERF_CI=1` and the public spec ceilings;
  the tighter ratified numbers stay on the machine that produced them.

  Two measured findings changed the code. `IMAGE_LIMITS` sat beside its pdf-lib import, so every
  tool route parsed an engine to read two integers; the constants moved to `limits.ts` and the tool
  chunk is now engine-free. The AI studio moved behind its own lazy chunk (`AI_EDIT_COPY` left
  `ai-workspace.tsx`), so the manual editor no longer pulls the provider protocols. Tool chunk
  608 → 589 kB. Worker sizing also became a pure, tested rule: ≤2 GB devices get one worker.

  Evidence: p95 **549 ms** (ceiling 583) over 51 routes, first interaction 16 ms, worst long task
  **125 ms**, 200-page iPhone heap **10 MB**, WebKit 50-page merge **257 ms**. Five runs of the same
  build measured p95 549-672; the variance and both samples are recorded. 3 new web tests; pdf-core
  445/445.

  Not hidden: p95 has little headroom; WebKit is not iOS Safari and reports no heap; the 200-page
  number is a merge, not a render; and `test:bundle` moved its remaining failure from `tool-*.js` to
  the verifier route (`verify-*.js`, 164 engine modules), which still keeps pdf.js/pdf-lib on the
  main thread for `/verify`. That is M5.8's remaining gate, not a passed check.

- **2026-11-04 - M5.3: what the export did, and what the engine thinks it read.**

  The editor now keeps two kinds of receipt. The first is the editing ladder made durable: after an
  export, `ExportReceipt` lists how many edits were rewritten in place, rewritten in the content
  stream, merely drawn over the original, or left for manual review. The `fallback` sentence says
  the original words are still in the file underneath, so they remain selectable, searchable and
  recoverable, and points at Redact when they must be gone. The receipt has no timestamp and is
  byte-identical for the same export, so it can be copied, downloaded and compared.

  The second is structure confidence. The Document panel shows the engine's banded score, all eight
  facets, the `basis` sentences that moved them, and an "Explain this extraction" section with the
  real counts and the limitations. The score is the mean of the facets, never a second measurement,
  and a page with no text model says so rather than showing a zero.

  The measured §29.6 limitations moved where the engine could close them honestly. Form-like pages
  are detected from dot leaders and read as one column: the IRS 1040 page went from four columns,
  nine tables and 229 shredded paragraphs to one column, one table and 141 paragraphs with field
  labels whole. Mixed-alignment tables (left labels, right numbers) are accepted per cell, and table
  columns are built from recurring gutters instead of cell starts. Justified prose is still refused,
  as is a two-row group whose cells align on different edges; form pages need three rows; dot-leader
  rows are not table cells. Cross-page paragraphs are linked additively (`DocumentLayout.continuations`)
  without regrouping pages, and a footnote tail above the margin band is absorbed when it matches
  typography and sits one line pitch below. The editor's disclosed limit list drops the three that
  are closed and rewrites the table and cross-page sentences to what is still true.

  Evidence: 30 new web tests, 10 new engine tests; `pnpm test` **1321/1321** (pdf-core 445, API 210,
  provider 370, agent 152, web 125, MCP 19); `pnpm -r typecheck` and `pnpm build` green. Real corpus:
  IRS page 0 as above; arXiv table counts identical to `HEAD` (4 and 25), so the per-cell change did
  not inflate tables on prose; continuations 1 (1409) and 2 (BERT). "Fonts" confidence now measures
  recognised family and font resource name rather than adjacency, which the form fix exposed: the
  IRS page-1 score of 0.796 for fonts had every family recognised. Honest gaps are recorded in
  §31.16: two-row grids stay text, a form without dot leaders is still read as columns, a
  continuation is a link not a reflow, and 2-row false positives on non-form pages are pre-existing
  and unchanged. `pnpm test:bundle` is still red: the failing lazy-chunk rule moved from `tool-*.js`
  at `HEAD` to `file-dropzone-*.js` (177) plus `verify-*.js` (3) after this workstream's editor
  imports; the rule and the engine boundary are unchanged, and M5.4/M5.8 own it.

- **2026-11-04 - M5.2: the privacy claims became things a user can check.**

  Three claims moved from prose to artifacts. First, the Content-Security-Policy is now produced by
  `apps/web/src/lib/csp.ts` and injected by the build, so the shipped HTML carries the policy the
  browser enforces: an allowlist `connect-src` (`'self'`, `blob:`, the shipped AI origins, loopback),
  `form-action 'self'`, `object-src 'none'`, `frame-src 'none'`, with `'wasm-unsafe-eval'` for the
  PDF engines. Second, a service worker emitted as `/sw.js` makes the shell and the assets you have
  already loaded work with the network off; the cache is named after a build id derived from the
  emitted asset names, so a deploy installs a fresh cache and deletes the old one, and a new version
  waits for the user to reload instead of swapping under an open document. Third, two pages make the
  claims falsifiable: `/trust` shows the policy read from the document itself, the worker's real
  state, and a live proof that runs a real `inspect` job with the five page-level network APIs
  patched (0 body-bearing, 0 cross-origin); `/verify` runs the same `verifyRedaction` the Redact tool
  requires before export on any PDF and prints a SHA-256 receipt with no timestamp.

  The verifier refuses to round up: `marks-burned-in` is reported as not checked because no regions
  were supplied, `page-count` as information because it was read from the same file, and the image
  checks that pass vacuously when a page is not a single image are downgraded to n/a instead of
  contradicting the failure above them. A manifest with 192/512/maskable icons makes the app
  installable.

  Evidence: 28 new web tests; `pnpm test` **1281/1281**; `pnpm -r typecheck` and `pnpm build` green.
  New `tests/e2e/offline.mjs` (`pnpm test:e2e:offline`, 26 checks) runs against a production build on
  `vite preview` and proves the manifest, the policy, the versioned worker, an online merge with 0
  external and 0 body-bearing requests, then the same merge **with the browser offline** after a
  reload from the cached shell. A real arXiv PDF verified as CONTENT REMAINS and, after redaction
  through the tool, as CLEAN. One test-only fix outside the brief: the API watchdog test's fixed
  60 ms sleep became a poll after it failed once under full-suite contention. `pnpm test:bundle` is
  **not** green and was not green before this workstream - the entry chunk is clean but the tool
  page's lazy chunk already carries pdf-lib (161 modules, reproduced at `HEAD`); the verifier's own
  lazy chunk adds 3. That pre-existing violation is recorded as M5.4/M5.8 work instead of being
  hidden behind the passing entry-chunk check.

- **2026-11-04 - M5.1: the product tells the truth about failure, limits and what is not built.**

  Failures now go through one vocabulary instead of whatever string the worker happened to throw.
  `apps/web/src/lib/job-errors.ts` classifies a job error by stable code (`encrypted`, `damaged`,
  `unsupported`, `too-large`, `timeout`, `cancelled`, `canvas-unavailable`, `ai`, `network`,
  `validation`, `refused`, `internal`), chooses human copy with a next step, and keeps the engine's
  own sentence when it is more useful than a generic label. Validation failures show the engine's
  issues rather than "Invalid input"; the fail-closed redaction and text-edit errors get their own
  `refused` code so their check list is never mislabelled. `use-job-runner` applies it once, so
  every existing `toast.error(outcome.message)` call site benefits, and logs only the stable code
  and the error - never document content, a filename or a path.

  Progress can no longer be an endless spinner: the panel shows elapsed time and, after 8 s, says
  it is still working and that Cancel is immediate. The shared trust card no longer claims "No
  limits" above a contradicting 500-page cap - every live tool states its own limit from the engine
  constants. `workflows`, `api` and `mcp` stop claiming "nothing is uploaded"; they say they are
  server-run and state their quota. The nine planned pages replace "In development" with what the
  tool will do, the real blocker and a direct link to the closest live alternative. The editor
  discloses the measured text-model limits (cross-page paragraphs, footnote tails, drop caps,
  vector figures, forms read as columns, refused mixed-alignment tables, no OCR), and Create
  Bookmarks says heading detection is a heuristic.

  Evidence: 21 new web tests (`job-errors`, `tool-limits`, `text-model-limits`); `pnpm test`
  **1253/1253**; `pnpm -r typecheck` and `pnpm build` green. Browser-verified on the production
  preview: an encrypted file produced "This PDF is password protected. Unlock the PDF first..." and
  a malformed file produced "That file could not be read as a PDF... Re-download or re-export the
  file, then try again." The limitations are **disclosed, not fixed** - the engine work belongs to
  M5.3/M5.7.

- **2026-11-04 - Q2 fixed: the same input now produces the same bytes.**

  pdf-lib's `PDFDocument.create()` stamps `/CreationDate` and `/ModDate` from the wall clock in its
  constructor, so two identical merges differed. The new `ops/dates.ts` applies one of two policies
  at every synthetic-document site: documents assembled from PDFs (merge, split, N-up, compose,
  combine) inherit the earliest creation and latest modification date of their sources; documents
  rebuilt from pixels or images alone (JPG-to-PDF, raster compression, dark mode, grayscale) omit
  both keys instead of inventing a timestamp. Malformed source dates are treated as absent.
  Redaction already removed the Info dictionary and is unchanged.

  Evidence: `packages/pdf-core/test/determinism.test.ts` pins the clock to two different moments and
  asserts byte equality for five operations plus both date policies; `pnpm test` **1232/1232**;
  `pnpm -r typecheck` green. The production baseline was re-run and Q2 now reports an **identical
  digest** (`2669defb6e61…`, 1408 bytes) instead of naming `/CreationDate` and `/ModDate`. The
  failing pre-fix run remains in history at `b474dee`.

  The baseline harness no longer recomputes its ceilings from the run it is measuring: the ratified
  values (583 ms p95, 200 ms long task, 23 ms first interaction, 15 MB mobile heap) are constants.
  Post-fix measurement: p95 **528 ms**, worst long task **178 ms**, first interaction **16 ms**,
  mobile heap **10 MB** - all inside the ratified ceilings.

- **2026-11-04 - M5.0: the product is instrumented and the starting line is recorded.**

  Milestone 5 opens with the gate it specified: measure first. `apps/web` now publishes three inert
  User Timing marks (`app-ready`, `page-ready`, `tool-ready`) from `lib/marks.ts`, and
  `tests/benchmarks/m5-0-baseline.mjs` (`pnpm test:baseline`) measures the production build at a 4×
  CPU throttle. The generated report is `tests/benchmarks/product-baseline.md` (+ `.json`), covering
  all 49 live tools.

  What the baseline says, without rounding up: **Q3** p95 tool-ready **486 ms** (ceiling ratified at
  583 ms), worst long task **133 ms** during a 50-page merge, first interaction **19 ms**; **Q6**
  11 requests, **0 external, 0 non-API uploads** during a client job; **Q7** an iPhone-13 emulated
  50-page merge completes at **10 MB** heap; **Q1/Q4** all **9/9** corpus cases reach a terminal
  state and no refusal echoes document text or the filename. Honest failures: **Q2** merge output
  differs run to run because pdf-lib stamps `/CreationDate` and `/ModDate`; **Q5** **0/49** tool
  pages are free of serious axe violations (footer contrast, the green "live" badge); the crawler
  sees **0 characters** of content on every route, confirming the M5.5 SEO gap.

  Gaps are reported, not papered over: no linearised fixture exists and neither qpdf nor Ghostscript
  is available, so that Q4 edge is listed as a gap rather than faked.

  Verified: `pnpm -r typecheck`, `pnpm test` **1224/1224**, `pnpm test:bundle` (main chunk 138.7 kB,
  0 engines). The harness itself ran green twice, including the 200 MB refusal.

- **2026-11-04 - Truthfulness fix on the planned-tool CTA, and the monetization decision record.**

  The nine `planned` tool pages carried a "Tell me when it ships" button whose handler toasted
  *"we have no account system yet"* - false since P4 shipped Google sign-in. It now links to the
  public roadmap (`PLAN.md` on GitHub), which is a real destination and needs no notification
  system that does not exist. No behaviour changed on any live tool.

  §33 records the freemium model, the free/paid boundary (all client-side tools free forever), the
  content-only ad policy with two CSP profiles, the deployment shape (§33.4), the pricing
  truthfulness invariant (§33.6) and the AGPL/CLA question that must be answered before billing
  code is written. **Nothing in §33 is built**; the status board row says so.

  Verified: `pnpm -r typecheck` (web included), `pnpm test` **1224/1224**, `pnpm test:bundle` green
  (main chunk 138.1 kB, 0 engines).

- **2026-11-03 - Security pass: four dependency advisories closed and a managed-AI log leak fixed.**

  The pass combined `pnpm audit`, the pre-push sink grep (`child_process`, `eval`, DOM sinks — all
  hits are the documented fixed-argv/fixture exceptions) and a read of the security-critical paths:
  session/cookie handling, double-submit CSRF, job-token comparison, path containment, upload
  caps and magic-byte checks, API-key hashing, OIDC verification, the child-process env allowlist,
  and the MCP base-URL guard. No defect was found in any of those.

  Two classes of problem were:

  - **Dependency advisories (2 high, 1 moderate, 2 low).** `zod < 4.6.6` can exhaust memory
    validating oversized constrained collections — directly relevant, since `/api/v1` and every
    job payload are zod-validated. `body-parser < 2.4.0` has a DoS via trailing bytes after a
    compressed body; `qs <= 6.16.0` throws on hostile array elements; `fast-uri < 3.1.9` has
    scheme/host-confusion issues inside the MCP SDK's ajv. Fixed by moving `zod` to `^4.6.7` and
    pinning the three transitive packages in `pnpm-workspace.yaml` (pnpm 12 no longer reads
    `pnpm.overrides` from `package.json`). Every pin is a patched release inside the range its
    direct dependent already declares. `pnpm audit` is now clean.
  - **Managed-AI error text reached the log.** `POST /api/ai/chat` logged the provider error
    message, and that message embeds up to 500 characters of the provider's response body
    (`httpBodyDetail`). A gateway that rejects a turn can quote the request back — and in managed
    mode the request contains the document. The key was already scrubbed by `redactSecrets`; the
    document was not. The log now records provider, model, error class, the structural head of the
    message (`HTTP 429`, `AI returned a non-JSON response`) and its length — never the body. The
    caller still receives the detailed, key-redacted message, because it is their own text.
    A regression test asserts the sentinel text never enters the logger while the status stays
    identifiable.

  Verified: `pnpm -r typecheck`, `pnpm test` **1217/1217** (api 210), `pnpm build`,
  `pnpm test:bundle`, and `pnpm audit` with zero findings at every severity.

  Residual, unchanged: managed AI is still the one path where document text reaches the server
  (disclosed in §23), and the three rollup pins should be removed once each direct dependent's own
  range resolves to the patched version.

- **2026-10-31 — Phase 2 hardening: partial rewrites now fail closed, collisions include text, and export verification covers the original line region.**

  Four bugs found and fixed after the initial Phase 2 pass:

  - **Partial native reflow is refused, not overlaid.** A failure after the first original
    line had been rewritten or removed could leave native glyphs plus fallback text. A
    `LayoutMutationError` now marks that state and `editPdfText` refuses the export instead of
    applying an overlay on top of a partially rewritten paragraph.
  - **Reflow collisions now include neighbouring text objects.** The planner previously checked
    only images, paths and forms; an expanded paragraph could overlap another text block. All
    non-consumed text objects participate in the collision test.
  - **Content-stream parsing no longer promotes unexpected array tokens to operators.**
    Unsupported tokens now raise `UnsupportedStream` and take the safe fallback instead of
    risking a corrupted operation stream.
  - **Visual verification covers shrinking paragraphs.** The declared edited region is the union
    of the original and replacement line boxes, not only the new lines.

  The browser E2E now generates its fixture with pdf-lib and asserts both the “replaced in place”
  toast and the disappearance of the original glyphs from the downloaded PDF. Verified: typecheck,
  362 engine tests, 39 web tests, 208 API, 19 MCP, 152 agent, 370 provider, production build, and
  both text browser suites. Commit `fb1c598`.

- **2026-10-31 — Text editing Phase 2: the editing ladder, real reflow, font metrics and pixel verification.**

  **Native strategy ladder.** `text-edit` now chooses in order: native PDFium object
  rewrite → content-stream show-operator rewrite (simple fonts only) → declared
  localized reconstruction → manual review. `TextEdit` gained
  `strategy` and `layout`; outcomes report `in-place`, `content-stream`,
  `fallback` or `manual-review` with fidelity. Manual-review edits fail closed;
  they are never silently covered.

  **Native paragraph reflow.** The PDFium adapter now inspects fonts, metrics,
  matrices, fill colours, render modes and page-object bounds, and can create
  new text objects in the original font (with a standard-font reload fallback).
  A layout edit matches every original line, measures the replacement with the
  document font's glyph advances, wraps against the available width, checks page
  bounds and collisions with non-text objects, rewrites original line objects,
  removes surplus lines and creates overflow lines. OCR text keeps render mode 3.
  If a build cannot create the overflow object atomically, the edit demotes to
  the declared overlay rather than leaving a half-rewritten paragraph.

  **Content-stream strategy.** New `textedit/contentStream.ts` decodes page
  content streams, tracks `Tf` and rewrites a single grounded `Tj`/`TJ` string
  with document-derived charcodes. It preserves all surrounding operators and
  refuses ambiguous matches, CID fonts, deletions, inline images, reflow and
  wider-than-box replacements. After serialization the result is reopened and
  re-extracted like every other path.

  **Fonts.** New `textedit/fonts.ts` classifies families from descriptor flags
  and names, computes explicit substitutes and fidelity, detects missing glyphs,
  and marks non-embedded custom fonts as high/unknown rather than exact.

  **Reflow/overflow.** New `document/reflow.ts` provides deterministic wrapping,
  height calculation, first-line indent, hard breaks, max-line limits, overflow
  and collision assessment against text, tables and extra page objects.

  **Capability API.** `inspectDocumentCapabilities` returns per-page text objects,
  fonts, render modes, object counts and `native`/`ocr`/`mixed`/`none` text-layer
  classification. `text-runs` can return `capabilities` alongside layouts; the
  editor shows the status in the block inspector.

  **Export verification.** New `textedit/exportVerify.ts` reopens output,
  checks page count/geometry, annotations/links and font resources, re-extracts
  text, renders edited pages and compares pixels outside the declared edit
  regions. A pure export with a changed region fails the gate. `@napi-rs/canvas`
  (MIT, test-only) makes the pixel path testable in Node; browser workers use
  OffscreenCanvas.

  **Results.** `pnpm -r typecheck`; `pnpm test` — pdf-core **362**, web 39, api 208,
  mcp 19, ai-agent 152, ai-provider 370 (one transient Windows `EPERM` on an API
  temp-dir cleanup; rerun green); `pnpm build` green. `tests/e2e/text-edit.mjs`
  and `tests/e2e/text-model.mjs` pass, the latter proving a browser paragraph
  edit is a native rewrite (toast "replaced in place", original glyphs absent).
  Benchmark: 20 pages / 100 native edits in **240 ms** in Node.

- **2026-10-31 — Structured text editing, Phase 1: the editor now understands text, not just boxes.**

  **Engine (`packages/pdf-core/src/document`).** A framework-independent, serializable six-level model
  (`glyph → word → line → paragraph → block → region`) with display *and* PDF-space geometry, stable
  FNV-1a ids, reading order, typography, headings, list nesting, columns, tables, repeated
  headers/footers and confidence flags. Extraction is adaptive: baselines, alignment, gap, indent,
  font and column heuristics decide grouping; ambiguous structures are preserved rather than
  discarded. `PageInteractionModel` adds spatial grids, deepest-target hit testing, caret/offset
  mapping, word/paragraph/cross-paragraph selection and caret rectangles. `TextEditSession` keeps
  typing state (draft, selection, undo) separate from the immutable document. `PageGeometry`
  centralizes PDF↔view↔screen↔DPR↔CropBox/MediaBox/rotation maths. `text-runs` keeps its old shape
  and gains optional `includeLayout` output produced from the same pdf.js parse.

  **Web (`apps/web`).** `TextLayer` adds hover highlighting, single-click block selection,
  triple-click paragraph selection, drag selection, double-click inline editing, copy/cut/paste and
  Delete on the extracted text, with the native textarea owning caret/word/selection/undo while
  typing. Commits become one whiteout-per-line + text object through the existing save path and one
  document undo step. Add Text is preserved, layouts are fetched per visible page, and pages remain
  memoized. Rotated text is selectable/copyable but editing is refused with an explanation until the
  Phase 2 native rewrite.

  **Bug found by the browser pass:** `normalizeFontFamily('sans-serif')` matched the `serif`
  substring first, so every generic sans-serif face was exported as Times. Fixed, with a regression
  test; this was invisible in the model tests but obvious the moment replacement text rendered.

  **Gates:** `pnpm -r typecheck`, `pnpm test` (pdf-core 339, web 39, api 208, mcp 19, ai-agent 152,
  ai-provider 370), `pnpm build`; `tests/e2e/text-edit.mjs` still passes the genuine in-place path,
  and the new `tests/e2e/text-model.mjs` passes the structured Select-tool flow. The manual browser
  pass additionally covered multi-line paragraphs, lists, columns, copy/cut/undo, Add Text, save +
  re-parse, and a rotated page.

- **2026-10-30 — The AI editor's hard refusal is fixed in the engine, and the page became an agentic workspace.**

  **Engine (`packages/pdf-core/src/textedit`).** The AI editor could refuse an entire apply with
  `unresolvable: edit "ai-1" deletes text that could not be removed in place (no text object on the
  page matches the selected run); refusing to cover it cosmetically`. The refusal itself was honest
  (the product never covers a deletion cosmetically) — the *matching* behind it was too narrow. An
  erase could only be grounded by comparing the editor's extracted text against PDFium's decoded
  objects, so a document that segments or decodes the same run differently (a bullet glyph the
  reader normalises away, objects split mid-word, a subset font whose `/ToUnicode` disagrees with
  the reader) left the erase with no anchor at all: the engine refused to write anything, and the
  user got a dead end instead of a deleted word.

  - **Box-only erase matching (`matchEraseByBox`).** When no text comparison can anchor an erase,
    the run's own geometry gets the last word: every PDFium text object whose display-space centre
    sits inside the run's box *is* that run's glyphs, however they are chunked, and removing those
    objects is a genuine deletion — the same content-stream removal the text-matched path gives,
    never a cover. Only deletes qualify (a replacement keeps its own honest overlay fallback), and
    the sweep is bounded to the run's band (`marginX = max(2, height·0.5)`,
    `marginY = max(2, height·0.15)`; an object taller than 3× the run is a stacked multi-line
    stream, not the run), so a neighbouring line can never be collateral damage.
  - **A real geometry bug found on the way (`pdfium.ts`).** `readBox` ignored the boolean return of
    `FPDFPage_GetCropBox` / `FPDFPage_GetMediaBox`: a page with **no** CropBox — pdf-lib writes
    none — read *uninitialised WASM heap floats* as the page's crop box and handed them to
    `geomFromBoxes`. Nothing depended on it before (the numbers only reached the display maths), but
    the box matcher would have inherited the garbage. `readBox` now returns `null` on `false`, and
    `geom()` falls through to the MediaBox (a NaN crop box is the existing "no crop box" signal).
  - Three new tests in `test/textEdit.test.ts` (`describe('box-only erase matching')`): a run
    removed by geometry alone while the neighbouring line survives, a guard that a line whose centre
    falls outside the band is never removed, and the unchanged refusal for a deletion with neither a
    text anchor nor a box. The pre-existing "refuses to cosmetically cover a deletion" test still
    passes.

  **Web (`apps/web/src/components/ai`).** Two separate problems: the refusal arrived as a raw red
  error string with no way forward, and the page was flat — no motion, no feedback loop.

  - **A refusal is now triage, not a dead end (`ai-workspace.tsx` + `edit-plan-panel.tsx`).** The
    engine's report is parsed back into one reason per refused edit (its stable
    `- kind: edit "id" detail` shape; each quoted id is an overlay object id an additive entry
    owns, so id → entry is a membership check), and every refused change keeps its review card,
    flagged amber, carrying the engine's own words. The card leads with the one thing that matters
    — *nothing was written* — and offers two ways forward: **"Discard failed & apply N changes"**
    (one click: drop the refused entries, apply the rest) and "Discard all". A "Why was it
    refused?" disclosure keeps the raw report one click away. The blocked list is derived from the
    *current* plan, so discarding a refused entry by hand shrinks the card live; anything that is
    not a parseable refusal still surfaces as a plain error.
  - **Motion, on the project's own system** (`lib/motion.ts` contract: transform + opacity only,
    `prefers-reduced-motion` collapses every duration and delay to zero). The chat rows (messages,
    tool steps, the running-tool chip) carry stable `data-motion-id`s and enter once each with the
    shared enter ease and a short stagger — settled rows never re-animate while a stream is still
    writing into them. The review panel's edit cards do the same, and the two workspace panes slide
    in once per document (`data-ai-enter`; the hidden base is applied inside the effect, so a
    cut-short run can never strand content invisible). The composer grows with its text now (capped
    at 160 px, then it scrolls) instead of a fixed box that swallowed long prompts, and the
    transcript follows the stream with a smooth scroll (instant under reduced motion). The activity
    timeline gained the two new agent tools (`scan_document` → "Surveying every page",
    `replace_everywhere` → "Queuing replacements across the document").

  Gates: `pnpm typecheck` ✅ · **1096/1096 unit** ✅ (3 new engine tests) · `tests/e2e/ai.mjs`
  (21 checks) ✅ · `tests/e2e/text-edit.mjs` ✅. Browser-verified against a mocked provider: the
  erase now applies and the erased run is *genuinely* gone from the exported bytes (the
  neighbouring line survives) — and with the refusal re-created on purpose, the amber card appears
  with the engine's reason and "Discard failed & apply 1 change" applies the remaining change.

- **2026-10-30 — OpenRouter defaults to the free-models router, and the PDF editing agent got a document-scale toolkit.**

  **Provider (`packages/ai-provider`).** The OpenRouter entry carried `openrouter/auto` as its
  default and first list item — OpenRouter's paid auto-router, which quietly contradicted the
  provider's `tier: 'free'` tag. Replaced with **`openrouter/free`**
  (https://openrouter.ai/openrouter/free, verified against its `llms.txt` catalogue): the
  free-models router that routes every call to the best currently-serving `…:free` model, so no
  hard-coded free slug churns and the "Free" tag is now factually true for the default path. A
  one-line migration in `sanitizeAiSettings` maps a stored `openrouter/auto` model to
  `openrouter/free` on load, so existing configs land on the router too. The provider picker's
  tag gained a hover `title` spelling out what "Free" means (default model free, other ids may be
  paid), and `AiProviderMeta.tier`'s doc comment notes where the tag is earned. Gates:
  `pnpm --filter @pdfshush/ai-provider typecheck` ✅ · **370/370 provider unit** ✅.

  **Agent skill (`apps/web/src/lib/ai/edit-skill.ts`).** Reviewed against the tool surfaces of
  `@aryanbv/pdf-toolkit-mcp` (search/count, document-wide writes, explicit truncation envelopes)
  and Open-Document-Alliance/PDF-Tools (page-level analysis, per-occurrence search). Changes are
  additive and bounded, on the same propose-review-apply plan — no new engine jobs, no new
  dependencies:

  - `scan_document` — a one-line-per-page overview (text amount + first ~80 chars, budgeted at
    18,000 characters with an explicit omission note it would trip), so a large document can be
    triaged before `${MAX_PAGES_PER_READ}`-page reads, and image-only pages surface as "no
    extractable text (may be a scan or image-only)" instead of an empty string.
  - `replace_everywhere` — document-wide find/replace: tallies matches per page first and refuses
    the whole batch if it would exceed the plan limit (never half-queues), then queues the exact
    same rewrite-in-place intents via a shared `queueReplacement` helper extracted from
    `replace_text` (behaviour byte-identical for the existing tool).
  - `read_pages` says when it stopped early at the 24,000-character limit and names the last page
    it emitted, instead of silently dropping the tail of the range.
  - `search_text` counts every occurrence per page (shown when > 1, snippets bounded as before)
    and reports matched-page totals; the no-hits branch now distinguishes
    "document has no extractable text" from "nothing matches it literally".
  - The system prompt teaches the triage-first rule, `replace_everywhere`,
    `scan_document`, and the scanned-page honesty rule; the pending-edits context builder is
    unchanged.

  Gates: `pnpm --filter @pdfshush/web typecheck` ✅. The mocked-provider E2E (`tests/e2e/ai.mjs`,
  22 checks) drives its own scripted tool calls, so the two new tools are invisible to it; no test
  enumerates tool names or the old `openrouter/auto` id.

- **2026-10-28 — The dark-mode batch: Dark Mode PDF, taking the catalog from 48 to 49 live.**
  Ported from the MIT-licensed `chizkiyahu/pdf-dark-mode-converter` (attribution and theme
  provenance in `licenses/pdf-dark-mode-converter-MIT.txt`; the six theme colours are that
  project's values under neutral ids `ink/warm/cool/sepia/midnight/forest`) and rebuilt on the
  grayscale pipeline: rasterize on the product's pdf.js runtime → per-pixel transform → JPEG
  rebuild, high quality (0.9 default) instead of the reference's heavyweight PNGs. Browser-only,
  so `SERVER_SLUGS`, `/api/v1`, the MCP surface and `NODE_JOBS` stay unchanged at eight slugs
  (server-side render without the rasterize pipeline would be a lie). No new dependencies.

  - **Engine** (`darkmode/darkModes.ts` + `darkmode/dark.ts` + `jobs/darkMode.job.ts`, slug
    `dark-mode`). Three transform kinds behind one pure, dependency-free module that the main
    thread and the worker share so the preview and the output agree to the byte (the 2026-10-25
    `IMAGE_LIMITS` lesson: value imports only from import-free modules): `theme` — the reference
    remap (`factor = 1 − BT.601 brightness/255`; white paper lands on the theme background, black
    ink on white), best for text documents; `smart` — new, an HSL lightness flip that keeps every
    hue, so charts and photos survive; `invert` — the classic 255−channel negative. `dark-mode`
    joined `WORKFLOW_OUTPUT_JOBS` (document-in, document-out), keeps the grayscale caps: the
    150-page rasterize-rebuild ceiling (`LIMITS.tool.maxRedactPages`), width 320..4000 px,
    password passthrough, `destroy()` in `finally`, progress + cancel.
  - **Web** (`dark-mode-pdf-tool.tsx`, icon Moon, category Other). The feature the reference never
    had: a live before/after wipe preview — page 1 renders through the `thumbnails` job at 1000 px,
    pristine pixels are cached on the main thread, and the same pure transform repaints a canvas
    clipped against the original (a `clip-path` wipe driven by a real range input, so the preview
    is keyboard reachable). Three mode cards, six theme chips, the honest rebuild disclosure
    (flat page images, like secure redaction), the over-cap card naming the 150-page gate,
    progress + cancel, ResultPanel. `TOOL_NEXT` adds `dark-mode-pdf → ['compress-pdf',
    'resize-pdf']` and `grayscale-pdf` now suggests Dark Mode first.
  - **Verification.** 14 new engine tests in `test/darkMode.test.ts`: exact RGB pins for all six
    themes, transform math (exact white→theme/black→white, mid-grey interpolation, hue
    preservation on a saturated red, exact grey branch), all three kinds dispatched through
    `applyDarkModeRgba`, job validation (one file, kind/theme membership, clamped width/quality),
    `WORKFLOW_OUTPUT_JOBS` + `JOB_SLUGS`/`JOBS` membership, and the Node no-canvas refusal —
    **1093/1093 unit**. Browser E2E `tests/e2e/dark-mode.mjs` (**8/8 checks**): the wipe preview's
    top-left pixel reads (0,0,0) on `ink` and (25,30,45) on `midnight`, a saturated-red page stays
    red under `smart` and flips to cyan under `invert`, the download is `%PDF-`, carries
    `DCTDecode`, ends `-dark.pdf`. Gates on 2026-10-28: `pnpm typecheck` · `pnpm build` ·
    `pnpm test:bundle` (0 engines outside the worker) · `test:sweep` clean (6 breakpoints ×
    2 themes × 6 routes) · full smoke `ALL CHECKS PASSED`.

- **2026-10-28 — Debug session: pdf.js "fake worker" warnings traced and silenced; every
  gate re-run green.** Evidence-first sweep over `dev2.log`, `.vite-dev.err.log` (empty),
  and the full command surface.

  - **Findings.** `dev2.log` contained ~2,000 `ECONNREFUSED` proxy errors for
    `/api/auth/me` + `/api/tools` — the web server had been started standalone (`$ vite`)
    so the root `predev` never ran and the API was simply down; the API was re-booted and
    verified healthy (tools 200, auth/me 204, no boot errors). `test:hardening` "fails"
    against the in-process dev stack by design (it needs the Docker `worker` container);
    it is **20/20 green** under its documented Docker prerequisites. The one real code
    finding: **pdf.js logged `Setting up fake worker.` from inside the job workers** — its
    browser build cannot spawn a nested worker there (`window` is absent), so it always
    fell back to in-thread parsing. Functionally benign (work already runs off the main
    thread), but it meant the documented assumption in `pdfjsRuntime.ts` ("browsers
    support nested workers") was wrong and the console was noisy. A stale 8080 bind was
    also caught mid-session: two API processes co-bound port 8080 on Windows, serving
    stale config.

  - **Fix (commit `adf37af`, "chore(pdf): silence expected pdf.js fake-worker warning in
    job workers").** `PdfjsRuntimeConfig` grew an optional `verbosity`
    (`packages/pdf-core/src/render/pdfjsRuntime.ts`) that is spread into the single
    `getDocument` call every job funnels through; the job-worker bootstrap defines
    `PDFJS_DOC_OPTS = { verbosity: VerbosityLevel.ERRORS }` with a comment explaining the
    fallback and passes it via `configurePdfjsRuntime`
    (`apps/web/src/workers/job-worker.ts`). Global verbosity is not touched; the
    main-thread pdf.js copy (dev tooling pages) is untouched; no nested-worker machinery
    was added (no CSP/port-lifecycle risk on a tested path).

  - **Verification.** Instrument Playwright capture: `fake-worker log origins: 0 distinct`
    on the live dev app, thumbnails still render; typecheck (packages, strict) ✅; serial
    unit run **1079/1079** (pdf-core's corrupt-PDF "too damaged", wrong-password, AES-128
    and `loadPdfForRender({password})` suites prove errors still surface) ✅; full e2e
    smoke `ALL CHECKS PASSED` incl. §20 console health ✅; `test:sweep` clean (6
    breakpoints × 2 themes × 6 routes) ✅; `test:api` smoke `ALL CHECKS PASSED` ✅;
    `test:hardening` **GATE PASSED** (Docker stack, 20/20) ✅; `pnpm build` + `test:bundle`
    ("main chunk carries no PDF engine") ✅.

- **2026-10-27 — The security batch: Protect PDF (real AES-256) and Smart Compress, taking the
  catalog from 47 to 48 live.** Both are browser-only, so `SERVER_SLUGS`, `/api/v1`, the MCP
  surface and `NODE_JOBS` stay unchanged at eight slugs. No new dependencies: the encryption
  write path already exists in `@cantoo/pdf-lib` 2.11.1, and smart compression reuses the
  existing pdf-lib/OffscreenCanvas path.

  **Protect (`ops/protect.ts` + `ops/protectConfig.ts` + `jobs/protect.job.ts` +
  `protect-pdf-tool.tsx`).**
  - The engine calls `PDFDocument.encrypt({ algorithm: 'AES-256' })` and saves with object
    streams. It verifies `/Encrypt` **and** `/AESV3` in the output before returning; a missing
    marker is a hard failure, not a toast. This is genuine R6/V5 encryption, not permission bits
    over a plaintext file.
  - The open password is required (8–256 characters). The optional owner password must also be
    8+ characters and must differ from the open password. When omitted, 192 bits of
    `crypto.getRandomValues` generate a separate owner key and it is never returned, so the
    permission switches are real and cannot be turned off with the open password alone.
    `/AESV3` uses SHA-256 and the password is encoded as UTF-8, so non-Latin passwords work.
  - Permission defaults are useful rather than hostile: printing (high resolution), annotations
    and form filling allowed; copying, editing and page assembly blocked. Accessibility
    extraction is always granted. The UI states the honest limit: mainstream readers honour
    these flags, but they do not stop screenshots or someone who already has the open password.
  - Already-encrypted sources are refused with a pointer to Unlock instead of being double-locked
    (the parse uses `ignoreEncryption` only to detect that case and is never saved). PDF/A's
    prohibition is mapped to a clear message; passwords never enter a result, progress message or
    filename. Output is `<stem>-protected.pdf`.
  - Unlock was hardened alongside Protect: pdf-lib can leave the old encryption dictionary and
    xref stream in the saved file even after decrypting. `unlockDocument` now deletes those dead
    artefacts, so removing protection produces a genuinely unencrypted PDF with no `/Encrypt`
    marker. The Protect test round-trips through Unlock and re-checks the text layer.
  - UI: open/confirm fields with reveal controls, live strength and mismatch feedback, an optional
    owner-password drawer, six permission checkboxes with a reset, an encrypted-source warning,
    and a result panel that names AES-256 and summarizes the granted permissions. The limits and
    defaults live in `ops/protectConfig.ts`, which has no pdf-lib import, so the lazy tool chunk
    stays engine-free; `test:bundle` pins that boundary.

  **Smart Compress (`compress/compress.ts` + the job + three-mode UI).**
  - Smart is now the default. It walks image XObjects and re-encodes only 8-bit DeviceRGB /
    DeviceGray Flate or JPEG images with `OffscreenCanvas`, then replaces the stream only when
    the new JPEG is at least 3% smaller. Text, links, forms, annotations and vector content are
    never rasterized.
  - It refuses the cases where a round-trip changes meaning: images used as soft or colour-key
    masks, `/ImageMask`, `/Decode`, external `/F` streams, JPEGs with `/DecodeParms`, CMYK/ICC/
    indexed/16-bit content, and images over 16 million pixels or 3,000 px on the long edge.
    Masked base images are never downscaled, so mask alignment survives. A declared-pixel check
    runs before inflation to keep decompression bombs out of the worker; at most 200 image
    objects are considered.
  - The job returns measured image counts and byte totals; the UI shows how many images were
    re-encoded, the image payload before/after, a “text preserved” badge, and an honest
    no-saving message when the 3% threshold is not met. `raster` (strong, text becomes pixels)
    and `lossless` (repack, may save nothing) remain available and are labelled as such; DPI is
    shown only for raster.

  **Verification.** `test/protect.test.ts` (7 tests) opens the encrypted output independently:
  pdf-lib proves the password gate and non-Latin password, pdf.js proves permissions and text
  extraction, and the raw bytes are checked for `/AESV3`, `/V 5` and `/R 6`. `next-tools.test.ts`
  adds the smart default/Node-refusal contract. The browser suite independently opens Protect
  output with pdf.js, checks the text and permission bits, and rejects both a wrong password and
  no password; smart compression shrinks a generated 1,441,208-byte Flate photo to 225,497 bytes
  while keeping its text, and leaves a soft-mask fixture valid. **Gates:** typecheck 7/7 projects ·
  **1079/1079 unit** (engine 301, +8; serial full run) · `pnpm build` · bundle boundary green ·
  **next-tools E2E 36/36** in real Edge. The default parallel unit run can still hit a
  pre-existing API child-watchdog timing test; it passed on isolated rerun and in the full serial
  run. The other browser suites were last green for the authoring batch.

- **2026-10-26 — The authoring batch: Create Forms and Create Bookmarks, taking the catalog from
  45 to 47 live.** Both are browser-only pdf-lib jobs, so `SERVER_SLUGS`, `/api/v1`, the MCP surface
  and `NODE_JOBS` stay unchanged at eight slugs. No new dependencies — the Mantine skills installed
  for the batch were not needed, because the app is React + Tailwind + shadcn/Radix and adding
  `@mantine/*` would have duplicated the design system.

  **Create Forms (`ops/formFields.ts` + `jobs/createForms.job.ts`).**
  - Text fields and checkboxes are created from display-space specs (top-left, y-down) through
    `viewRectToPdf`/`pageGeom`, so rotated pages need no UI math and the result reads back through
    `extractFormWidgets` with the same rectangle.
  - The whole batch is validated before the first widget exists: name shape/length, unique names
    (in-batch and against the document's existing fields), page range, finite in-page geometry,
    minimum sizes, font size, default-value length and flags. A rejected batch leaves no partial
    form.
  - Existing fields are extended, not replaced; 500 fields per run, 64-char names, 1 000-char
    defaults. Output `<stem>-fillable.pdf`, saved with `useObjectStreams: false` so the widgets are
    inspectable in the bytes.
  - UI: a 900 px page render, click-to-place or explicit add, pointer drag/resize with
    display→point scaling, a page strip, a numeric X/Y/W/H/font panel, a field list that surfaces
    duplicate-name errors, and a run button disabled until the form is valid.

  **Create Bookmarks (`ops/outlineWrite.ts` + `render/suggestBookmarks.ts` + the job).**
  - pdf-lib has no outline API, so the writer allocates the `/Outlines` root and one dictionary per
    bookmark, then links `/Parent`, `/Prev`, `/Next`, `/First`, `/Last` and `/Count`. Titles go
    through `PDFHexString.fromText` (UTF-16BE), so non-Latin titles survive; the hex title is what
    the E2E reads back.
  - Existing outlines are replaced (the result says so); titles have control characters collapsed
    and a 200-character cap, pages are bounds-checked, and levels (0–8, no skipped level, first
    entry top-level) are written as a real tree rather than as indentation in a list.
  - `suggestBookmarks` is a pure function over the editor's text runs: body size is the most common
    line size, headings are ≥1.15× body or bold at body size, running headers/footers (repeated on
    half the pages, no larger than 1.2× body) and page-number lines are excluded, one pick per page,
    consecutive duplicates are dropped, and the list caps at 500. `pages` mode takes each page's top
    line; a scanned document falls back to `Page N`.
  - UI: detection reuses the existing `text-runs` job (no new server surface), Headings/Every-page
    modes, editable titles and pages, include toggles, indent/outdent/up/down, manual add/remove,
    live validation and a result note when an outline was replaced. Output
    `<stem>-bookmarked.pdf`.

  **Security review.** Field names and bookmark titles are untrusted strings written into PDF
  dictionaries: names are ASCII-restricted and length-capped, titles are C0/C1-normalised,
  whitespace-collapsed and length-capped, and both are encoded by pdf-lib rather than concatenated
  into a content stream. Geometry is finite, positive and bounded by the display page, so no
  negative or huge `/Rect` reaches the document, and page indexes are integers checked against the
  page count. Output names still pass through `safeOutputName`. Neither job is in `SERVER_SLUGS` or
  `NODE_JOBS`, so the API and MCP input surface is unchanged. 500 fields / 2 000 bookmarks bound the
  work, and `estimate()` stays far below the job working-set cap.

  **Gates.** typecheck 7/7 · **1071/1071 unit** (engine 293, +26 for form creation, outline writing
  and the suggestion heuristic; web 29) · `pnpm build` · bundle boundary green (no engine in the
  main or lazy app chunks) · **authoring E2E 49/49** in real Edge against downloaded bytes (a
  two-page form with `/AcroForm`, `/FT /Tx` and `/FT /Btn` plus UTF-16BE field names, page
  navigation, drag/resize, numeric placement and duplicate-name blocking; a report fixture whose
  three headings become an edited, reordered, nested outline including a non-Latin title, and whose
  excluded parent promotes its child) · the existing bookmark-batch, plain-tools, next-tools,
  AI, sign and text-edit suites re-ran green as part of the nine browser suites (smoke skipped only
  its API-stack step) · `pnpm test:sweep` clean across 6 breakpoints × 2 themes × 6 routes.

  **Follow-up bug-check (same day).** Excluding a middle bookmark left its child at the old depth in
  the payload, so the writer correctly rejected the run as a skipped level. Included rows now reflow
  when a parent is hidden (and are re-normalised on write), so the visible indentation matches the
  saved outline; form field removal also no longer calls a state setter from inside an updater, and
  the API child watchdog now shares an in-flight sweep so two interval ticks cannot kill the same
  pid twice. The authoring E2E grew from 27 to 49 checks: form page navigation, drag/resize, numeric
  placement and duplicate-name blocking, plus bookmark reorder, out-of-range pages, a non-Latin title
  and the excluded-parent write.

- **2026-10-25 — The bookmark batch: seven more tools, taking the catalog from 38 to 45 live.**
  Stamp, Repair PDF, Combine files, Image Editor, Batch run, Split by bookmarks and the Workflows
  tool page. Chosen because each one either reuses a shipped operation or needs only a small new
  one; all seven are client-side, so `SERVER_SLUGS`, the REST API and the MCP surface stay at
  eight slugs. No new dependencies.

  **Engine (4 new jobs, all browser-only).**
  - `ops/repair.ts` + `jobs/repair.job.ts` — a strict `PDFDocument.load` first (so the UI can
    honestly say "this file was already valid"), then a lenient parse when strict fails, then a
    save with `useObjectStreams: false` that rebuilds the xref/trailer. Owner-restricted files
    unlock with `''`; password-protected ones are refused with a pointer to Unlock PDF. It is
    labelled as structural repair, not data recovery, in the UI and in the result copy.
  - `ops/combine.ts` + `jobs/combine.job.ts` — PDFs contribute all pages, JPEG/PNG contribute one
    page each through `planImagePlacement`, and everything else is refused *by name*. Built as one
    pass rather than "JPG-to-PDF then merge" so images are never re-encoded. 50-file and 500-page
    caps; magic-byte sniffing, not extensions.
  - `render/outline.ts` + `jobs/splitByBookmarks.job.ts` — pdf.js resolves both destination
    syntaxes (array and named through `/Dests`), flattening the tree with nesting levels. The split
    level is the shallowest level *that carries more than one entry*, so a lone "Contents" root
    descends to its children; pages before the first bookmark become an explicit "Front matter"
    part. 2 000 nodes / 200 parts caps. The job is absent from `SERVER_SLUGS` because the server
    has no pdf.js worker.
  - `jobs/zip.job.ts` — batch outputs are zipped in the worker, keeping `fflate` out of the app
    bundle exactly as Split by pages does.
  - `safeEntryName` / `safeZipName` in `jobs/helpers.ts` — every caller-supplied archive entry name
    is reduced to a basename, stripped of control characters and leading dots, and de-duplicated
    before `createZip`; a `../../x.pdf` input cannot become a zip-slip entry. The zip job reports
    the *deduped* names, so metadata and archive agree.

  **UI.** Stamp is a preset surface (APPROVED / DRAFT / CONFIDENTIAL / VOID / PAID / custom) over
  the existing watermark job, with a CSS preview. Combine renders an explicit, reorderable list.
  Batch run walks the pool sequentially (not five raster compressions at once), survives per-file
  failures by naming them, and keeps the produced archive so it can be downloaded twice. The image
  editor replays an operation list (rotate / flip / crop) from the original bitmap every render, so
  undo is exact and repeated edits never stack resampling loss; tone filters are applied identically
  to the preview and the exported bytes, JPEG export is composited on white, and "Create a PDF"
  goes through the normal JPG-to-PDF job. Workflows reuses the existing builder with an `embedded`
  prop instead of duplicating it.

  **Bug caught by the bundle gate.** Importing `IMAGE_LIMITS` from the package root pulled
  `ops/imageDocs.ts` (and therefore pdf-lib) into the ToolPage chunk: `tool-*.js` jumped from
  ~414 kB to 980 kB and `pnpm test:bundle` failed its "no lazy app chunk carries an engine" check.
  The cap now lives beside the UI that uses it; the chunk is back to 414 kB. This is the failure
  mode the boundary test exists for, caught before commit.

  **Gates.** typecheck 7/7 · **1045/1045 unit** (engine 267, web 29) · `pnpm build` · bundle
  boundary green (6 app chunks, 0 engines) · **bookmark-batch E2E 29/29** in real Edge, including a
  hand-built `/Outlines` fixture and byte-level asserts on every download · **`pnpm test:sweep`
  clean** across 6 breakpoints × 2 themes × 6 routes. The sweep had been failing on the homepage
  with 7-8 "unrevealed" blocks: `html { scroll-behavior: smooth }` makes each `scrollTo` interrupt
  the previous animation, so the sweep never actually reached the lower sections. The sweep now
  scrolls instantly for its own duration, and the band's deliberately scaled-and-clipped photograph
  is marked `data-bleed` so the overflow detector does not flag intentional art.

- **2026-10-25 — P7.0: the §24.5 low backlog closed, managed AI metered on input, CI added.**
  A reconcile pass before P7.1, so the auth and budget findings did not wait behind the torture
  suite.

  **CSRF, one implementation (L1, L2).** `http/csrf.ts` now owns the double-submit check and the
  cookie names live in `auth/cookies.ts`; the account routes, API-key routes, logout and managed
  AI all read one helper, so no surface can drift back to a length-only comparison. `POST
  /api/auth/logout` with a session cookie but no matching header is **403 and the session
  survives** (a cross-site page can send the cookie, not read it). `/api/ai/chat` requires the
  same header **whenever a session cookie is present**, so a cross-site call cannot spend the
  signed-in account's trial; anonymous calls have no session to protect and stay IP/rate
  metered. The SPA already echoed the header on both calls, so no client change was needed.

  **Bounded `options` (L4).** The shared contract walks the record before the queue sees it:
  **8 levels deep, 64 keys per object, 1024 values total**, keys ≤ 128 chars. `/api/jobs`
  multipart and `/api/v1` inline JSON both reject a violation with 400
  ("nested too deeply" / "too many keys"), and the MCP tool shapes inherit the schema.
  Legitimate tool options are an order of magnitude under every bound.

  **Managed-AI budget (L7, L8).** `reserve()` takes the turn's prompt estimate and reserves
  output ceiling + prompt together; `settle()` adjusts against that actual reservation. The
  estimate is chars/4 over system, message text/reasoning and tool schemas, plus a **flat 1,500
  tokens per image** — base64 must not be billed as text. `AiConcurrencyGuard` now also takes a
  per-subject counter slot (`ai:<subject>:live`, 300 s TTL, undone on release), so the one-turn
  rule holds across API instances; a counter outage degrades to the per-process set and the
  daily budget remains the backstop.

  **Result types (L5).** `.html` left the allowlist. No job emits it; a stored name ending in
  `.html` now downloads as `application/octet-stream`.

  **CI.** `.github/workflows/ci.yml` runs `pnpm typecheck`, `pnpm test`, `pnpm build` and
  `pnpm test:bundle` on every push and PR, with the pnpm version read from `packageManager`.
  The Docker/Redis gates are deliberately out: a green CI run does not claim they passed, and
  §9 says so.

  **Docs reconciled.** README reports the real surface (38 of 57 tools, P6 shipped, 1008 tests)
  instead of the P6.0-era 18/862 text. §1/§9 use one unit total: **1019** (251 engine + 208 API
  + 370 provider + 152 agent + 19 web + 19 MCP; the old 1002 did not match its own breakdown).
  The AI E2E figure is explained rather than guessed: 17 seeded checks plus 5 keyless-overlay
  checks = 22, and the re-run executed all 22. Hardening is **19** executed checks (17 call
  sites; the container-health check loops over three services), corrected from the old 17.
  **L3 and L9 were verified already closed** (413 mapping in `http/app.ts`; `ownsJob` is used by
  `/api/v1` ownership).

  **Gates.** `pnpm test` **1019/1019** · `pnpm typecheck` clean · API suite **208** (+11: logout
  CSRF, AI CSRF in both directions, input reservation, prompt estimator, shared guard, deep and
  wide `options`, `/api/v1` options, the content-type map) · MCP 19/19 · `pnpm build` +
  `pnpm test:bundle` green. Full-stack re-run later the same day: `test:api` **37/37** with the
  §6 key walk (`PSH_SMOKE_MONGODB_URI` set; 21 checks without §6), `test:hardening` **19/19**
  (20 s TTL, 5 s janitor), and every browser suite — smoke **101/101**, plain-tools **13/13**,
  next-tools **18/18**, sign **17/17**, text-edit **8/8**, AI **22/22**, managed AI **11/11**.
  The managed suite boots its own API on :8080, so the Docker api container was stopped for that
  single run and started again afterwards; every other suite used the live stack.

- **2026-10-21 (later) — Landing hero theme polish and MCP CTA terminal cue.**

  **Hero.** The Greek day plate now uses a lighter, neutral copy-side wash with a restrained
  vertical lower scrim: the image stays saturated and legible while the four privacy claims retain
  black-text contrast and settle smoothly into the next white section. The night plate remains
  cinematic, with slightly more present artwork and subtly stronger dark tool-chip and upload-panel
  surfaces. No layout, copy, breakpoints, routes, or theme-toggle behavior changed.

  **CTA.** The hero's `Wire up an agent` control now carries an Anime.js terminal cursor blink,
  registered through the shared `useMotionScope` cleanup path. Reduced-motion visitors see the
  cursor in its final visible state rather than an animated loop.

  **Verification.** `pnpm --filter @pdfshush/web typecheck` completed without reported errors;
  `git diff --check` is clean. The local Vite server served the updated page; headless Chrome
  screenshot capture remains unavailable in this environment because its GPU process fails.

- **2026-10-21 (later) — Redis live: the skipped workflow path exercised, and the stack exposed two
  production-only bugs.** With Docker started, every stack-dependent gate ran against real
  containers instead of skipping.
  - **The workflow run is verified.** Smoke §19 queues `organize` then `merge` through `/api/jobs`,
    the sandboxed child executes both, and the browser downloads
    `alpha-organized-merged.pdf` (1664 B). `tests/api/smoke.mjs` passed on the compose stack too
    (real job through Redis into the sandboxed processor, ownership refusals, the anonymous quota,
    work-dir accounting). Its §6 v1 walk skips on this machine only because accounts are enabled
    and `PSH_SMOKE_MONGODB_URI` is not set; that skip is reported, not green.
    `tests/api/hardening.mjs` passes all 18 checks after the fixes below.

  **Bug 1 — the dev worker ran a stale engine.** `pnpm dev` starts the API with `tsx watch`, while
  the embedded worker forks `apps/api/dist/processor.cjs`. Nothing built that file, and the one on
  disk was from Oct 17 — before the plain-tools and next-tools batches. A freshly pulled checkout
  would queue jobs the sandbox could not run, and an old checkout silently ran yesterday's code.
  `predev` now rebuilds the API bundle (esbuild, under a second) before either dev server starts.

  **Bug 2 — the API bundle started a second worker.** `worker/host.ts` ended with a
  "run me directly" guard comparing `import.meta.url` to `pathToFileURL(process.argv[1])`. esbuild
  inlines the module into `dist/server.js`, where both values are the same file, so the guard was
  true and the API container called `startWorkerHost()` even with `EMBEDDED_WORKER=false`. The
  consequences were real: jobs ran inside the 1 GB API container instead of the 5 GB worker, a
  worker crash could take the API down, and the hardening gate "passed" while the worker container
  was already dead because the API kept consuming. The guard is gone; a dedicated
  `src/worker/main.ts` is the only place that starts a host, and both the build
  (`dist/worker-host.js`) and `pnpm worker` point at it. Verified in the container: the API process
  has no BullMQ child and `/api/health` reports exactly one worker.

  **Gate corrections found while proving the above.** Hardening read `FILE_TTL_MS` from its own
  shell (unset when the suite and `docker compose up` run in different terminals) and waited 90 s
  for a 120 s TTL — it now reads `retentionMs` from `/api/health`. Its SIGKILL assertion
  (`state !== 'running'`) passed when no container existed at all; it now requires `exited`/137 and
  a live consumer before the kill. And `docker compose kill` deliberately marks a container
  stopped, so no restart policy applies: the gate now restarts the worker explicitly, the way an
  orchestrator would, then asserts the new container is healthy.

  **Entry chunk: 1,074 kB → 139 kB (gzip 320 → 40).** The build warning was legitimate. `App.tsx`
  now lazy-loads `ToolPage` (every tool body, the editor and the AI surfaces live behind that
  route), and vendor code is split with Rolldown's `codeSplitting` groups (`vendor-react` 258 kB,
  `vendor-ui` 275 kB, `vendor-motion` 37 kB) so framework chunks survive app deploys. The tool
  chunk is 369 kB (97 kB gzip), fetched on navigation. Both build warnings are gone; the auth
  toast's `import('sonner')` became a static import because the Toaster already keeps sonner on the
  entry path, so it could never split. `tests/bundle-boundary.mjs` now scans every app chunk
  (excluding chunks the worker imports) instead of only the entry — which caught pdfium's
  worker-owned `index.browser-*.js` and forced the check to follow imports rather than filenames.
  Result: 6 app chunks, 0 engines; the pad stays lazy; the engines still ship in the worker chunks.

  **Gates.** 1002/1002 unit · web 19/19 · API 197/197 · typecheck clean · smoke green **with no
  skips** (workflow run included) · API smoke all passed on the Docker stack · hardening 18/18 ·
  bundle boundary green. Dev stack stopped afterwards and `pnpm dev` restored (with the new
  `predev` build).

- **2026-10-21 — The next-tools batch: six more client-side tools, taking the catalog from 32 to
  38 live.** Unlock, JPG to PDF, Rename, Bates Numbering, Split by Text and Compress — chosen
  because every one reuses engine machinery that already ships and passes its gates. All
  client-side, so `SERVER_SLUGS`, the REST API and the MCP surface are untouched; no new
  dependencies.

  **Engine.**
  - `ops/unlock.ts` — `PDFDocument.load` takes its decrypt path whenever `password` is
    *defined*, so the tool passes the user's password or `''` (which opens owner-restricted
    PDFs) and saves: the trailer `/Encrypt` is gone and the output is a normal PDF. A separate
    `ignoreEncryption` parse answers `wasEncrypted` without decrypting twice. Wrong or missing
    passwords map to a plain sentence, not `Password incorrect` from the crypto layer. This is
    explicitly not a cracker — and Protect PDF remains blocked because @cantoo/pdf-lib 2.11.1
    has no encrypt-on-save (§7).
  - `ops/imageDocs.ts` + `jobs/jpgToPdf.job.ts` — JPEG/PNG sniffed by magic bytes (a `.jpg` that
    is really HEIC is rejected by name, not decoded and re-compressed), embedded verbatim, one
    page per image. `planImagePlacement` is pure: A4/Letter/own-size paper, auto or forced
    orientation, margin-clamped contain fit with centring, so the UI can reason about placement
    without opening a document.
  - `ops/renamePattern.ts` + `jobs/rename.job.ts` — dependency-free token expander
    (`{name}`, `{title}`, `{n}`, `{total}`, `{date}`), filename sanitisation and collision
    suffixing. The job opens each document once to read its real title, then returns the
    **original bytes** under the new name — no re-encode — as a ZIP when the batch is larger
    than one. Keeping the formatter pdf-lib-free is what lets the live preview run on the main
    thread without dragging the engine into the entry chunk.
  - `ops/bates.ts` + job — `formatBatesNumber` (prefix, offset, zero padding, clamped) plus
    `batesNumberDocument`. `StampRegion` gained an optional
    `textFor(pageIndex, pageCount)` resolver, so Bates reuses the existing display-space,
    rotation-safe stamp placement instead of a second copy of that maths; the `{n}`/`{N}`
    template behaviour is untouched and still pinned by the stamp tests.
  - `ops/splitByText.ts` + job — a pure planner splits *before* every matching page (the match
    page opens its part), treats page 1 as the implicit start, never emits an empty part for
    consecutive markers, and refuses a no-op plan or more than 200 parts with a specific
    message. The job extracts text through the editor's pdf.js pipeline and composes each part
    as a standalone PDF in a ZIP.
  - `compress/compress.ts` + job — two strategies, stated honestly. `lossless` re-serializes
    with object streams: text and images survive exactly, and the UI says gains may be zero.
    `raster` renders each page at a chosen DPI, JPEG-encodes at a chosen quality and rebuilds —
    the same rasterize-and-rebuild contract as redaction and grayscale, gated by the same
    150-page ceiling, with the loss of selectable text disclosed before the run. The job returns
    `originalBytes` so the result panel shows a measured percentage (including "no saving")
    rather than a promise.

  **Web.** Six components on the established dropzone → progress → result shape, with capacity
  checks and recent history. Unlock has a reveal toggle and a plain "we cannot guess it" note;
  JPG to PDF orders images with real thumbnail previews and up/down controls (`FileDropzone` grew
  `accept`/`accepts`/`kind` props, defaults unchanged for every PDF tool); Rename runs `inspect`
  on upload so the `{title}` preview is the actual title, offers token chips and previews the
  whole batch before the run; Bates draws a mini page with the user's own sample number at the
  chosen corner; Split by Text pairs the needle with an honest "text layer only, scans need OCR"
  explainer; Compress presents the two modes as cards with quality/DPI controls, an over-cap
  notice and a before/after strip. Registry: six slugs live with `nextFor` suggestions;
  `bates-numbering`, `compress`, `rename` and `unlock` joined `WORKFLOW_OUTPUT_JOBS` (single-document
  deliverables only — the ZIP-producing splits stay out).

  **Tests.** 29 new engine tests in `test/next-tools.test.ts` (+29 → **251**), each re-opening the
  output: Bates numbers scanned out of the deflated stream, image XObjects counted, renamed ZIP
  entries byte-compared to the originals, split parts re-opened page by page, the lossless
  repack re-parsed, and Unlock run against two committed fixtures — AES-128 with a real user
  password (`shush123`), and an owner-only PDF that opens with the empty password. Wrong-password
  and missing-password paths assert the friendly message, and an unencrypted input still reports
  `wasEncrypted: false`. Because pdf-lib cannot create encrypted files,
  `scripts/make-encrypted-fixtures.py` (dev-time pypdf, not a dependency) generated the PDFs; the
  fixtures are committed, the script documents itself. New `tests/e2e/next-tools.mjs`: 18 checks
  driving all six tools in real Edge and asserting downloaded bytes — `%PDF-` on five outputs,
  no `/Encrypt` and the original page text inside the unlocked PDF, `/Count 2` for the image
  build, `PK` plus a PDF first entry for both ZIP tools, stamped `CASE-0007`/`CASE-0009` read
  back through zlib, the preserved text layer after a repack, and a real browser raster
  compression.

  **Smoke fixes found by the batch.** The routing check still pointed at `compress-pdf` as
  "planned" now that it ships (moved to `protect-pdf`), and the workflow *run* was gated on
  `/api/tools` — which answers without Redis — so an API-up/queue-down session died as a
  three-minute download timeout. It now asks `/api/health` for
  `redis.status === 'connected'` and skips loudly. Full smoke re-run green.

  **Visual pass.** Full-page screenshots of all six tools (working state) caught two real
  problems: Compress and Rename said "Compressing…"/"Renaming…" while the upload-time `inspect`
  was running, and Split by Text had a half-empty card. Busy states are now separate
  (`inspecting` vs the real run), the split card carries a matching explainer, and the JPG list
  moved object-URL management out of a StrictMode-double-invoked state updater (§7).

  **Gates.** pdf-core **251/251** + `tsc` clean · full unit **1002/1002** · web unit **19/19** ·
  `pnpm build` clean with the main chunk still 0 pdf-lib / 0 pdf.js / 0 pdfium (string-scanned) ·
  browser E2E: next-tools **18/18**, plain-tools **13/13**, smoke **ALL CHECKS PASSED** — with the
  server-run workflow **skipped** because Redis was not running in this session. That one path is
  unverified here, not green; it needs the compose stack (§9), exactly as the smoke's own skip
  says.

- **2026-10-20 — The plain-tools batch: ten more client-side tools shipped in one wave, taking the
  catalog from 22 to 32 live.** Flip, Watermark, Edit Metadata, Remove Annotations, PDF to Text,
  Grayscale, Resize, Extract Images, Split by Size and Flatten — every one off the existing engine
  contract, all client-side (none joined `SERVER_SLUGS`, API/MCP surface untouched), no new
  dependencies.

  **Engine.** New ops: `ops/transform.ts` (mirror + resize pages through the verified
  `embedPage`/`drawPage` negative-scale technique — flipping emits the exact `-1 0 0 1` /
  `1 0 0 -1` matrix, re-renders preserve `/Rotate`, and pages with no `/Contents` pass through
  untouched because `embedPage` refuses them), `ops/watermark.ts` (single `viewToPdf` placement,
  display-space angle with the rotation-90° axis swap, RGB color, pivot-at-corner math),
  `ops/annotations.ts` (strips every `/Annots` subtype except Widget so forms stay fillable),
  `ops/metadata.ts` (writes/clears Info fields with a 500-char clamp), `ops/images.ts` +
  `img/png.ts` (JPEG passthrough at byte parity; FlateDecode 8-bit DeviceGray/DeviceRGB re-encoded
  as PNG through zlibSync with PNG-predictor 12/15 inflating; CMYK/16-bit/JBIG2/predictor-2 honestly
  counted as skipped, never silently dropped), `gray/gray.ts` (rasterize → BT.601 luma → JPEG
  rebuild, browser-only, gated by the same `LIMITS.tool.maxRedactPages` 150-page ceiling secure
  redaction uses, and disclosed as image-based in the UI exactly like redaction is).
  `splitBySize.job.ts` exports a pure `planSplitBySize` planner; part sizes are measured by
  serializing each part, and the output ships `approximate: true` for the pre-run estimate.
  `renderPage.ts` was split into `renderPageToCanvas` (reused by thumbnails, grayscale and the
  raster tests) with an optional `release()` on both canvas adapters.

  **Web.** Ten components under `components/tools/` following the rotate/stamp patterns
  (FileDropzone + `useJobRunner` + progress + result panels, capacity checks, recent history):
  flip is a thumbnail grid with per-tile H/V toggles, flip-all and live CSS-mirror previews;
  watermark is a live first-page overlay preview (angle/opacity/color/size/placement all rendered
  before the job, and the preview shows the user's own text, not a placeholder); metadata prefills
  from inspect and only sends touched fields (clearing a field deletes the entry);
  remove-annotations and flatten get precise counts from the job output, flatten behind an explicit
  irreversible warning; pdf-to-text shows the text inline with an honest "this is a scan, no OCR"
  empty state; grayscale shows a colour-vs-luma side-by-side disclosure before running;
  resize is preset cards + a 25–400% custom scale; extract-images renders the extracted files as a
  blob-URL gallery with per-file pixel sizes and the skipped count; split-by-size previews the
  part plan with the measured table in the result. Registry: 10 slugs flipped live with `nextFor`
  suggestions, all wired into `WORKFLOW_OUTPUT_JOBS` where a single-file deliverable exists.

  **Tests.** 32 new engine tests in `test/plain-tools.test.ts` (+33 → **222**) — every job gets a
  validation case and a real-run case whose serialized output is re-opened, not trusted (text
  scanned through zlib streams, AcroForm field arrays counted, PNG dimensions re-declared,
  classification honestly null on mismatched samples). New `tests/e2e/plain-tools.mjs`:
  13 checks driving all ten tools in real Edge, asserting on actual downloaded bytes —
  `%PDF-` magic on the seven PDF outputs, `PK` plus the inflated first-entry `FF D8` JPEG magic for
  both ZIP tools, and the fixture's page text inside the .txt. Full smoke re-run green after the
  registry change.

  **Process note.** The first E2E attempt timed out waiting for downloads because the run button
  and the result-panel **Download** are two separate clicks — the tool suites assert the result
  state first, then drive the download; mirror that shape for future tool E2Es.

  **Gates.** pdf-core `pnpm test` **222/222** + `tsc` clean · web unit **19/19** · web build clean
  with the main browser chunk still 0 pdf-lib / 0 pdf.js / 0 pdfium (string-scanned post-build) ·
  browser E2E: smoke **ALL CHECKS PASSED** (re-run 2026-10-20) + plain-tools **13/13** ·
  full-page screenshots inspected for every new tool page (landing, working and result states).

- **2026-10-19 — Landing MCP console: the hero gained a third door, and the agent surface is now
  explainable without leaving the page.**

  **What shipped.** A new `Wire up an agent` button in the hero actions (`McpShowcaseButton`) opens a
  full console dialog (`components/landing/mcp-dialog.tsx`) instead of a link: a three-step connect
  guide (create a key → paste the client config → just ask), copy buttons on both snippets, and a
  **live wire** panel where picking any of the eight tools shows the literal `tools/call` JSON the
  client sends, the prompt a person types, and, on **Send it**, the animated round trip
  (request lines → the `submit`/`poll`/`attach` legs → the response envelope with its real file
  listing and the honest note about what rides along). Footer carries the per-key limits read live
  and links to `/tools/mcp` + `/tools/api`.

  **Honesty properties kept.** The tool list is not invented client side: both this dialog and
  `/tools/mcp` now read one shared `lib/mcp-catalog.ts` hook over the public OpenAPI document, so a
  deployment that cannot run a slug never shows it. When the document is unreachable the console says
  "catalog unreachable, showing the shipped tool set" and falls back to the shipped eight (verified
  by aborting the request in a real browser). Every sample is the server's own shapes, quoted from
  `apps/mcp/src/run.ts`: the 32-hex `jobId`, `{files:[{name,bytes,inline}], pageCount}`, the
  multi-file listing, the four-minute wait, and the `edit` limitation that image objects are not
  expressible over JSON. Copy carries **no em dashes**.

  **Two bugs the browser found (both would have shipped silently).** (1) The sample cases were
  authored with underscored slugs (`split_by_pages`) while the API's slugs are dashed
  (`split-by-pages`), so the live-catalog join silently dropped three of the eight tools. The gate
  test in `lib/mcp-catalog.test.ts` now pins the mapping in both directions, including that a
  converted name is not converted twice. (2) The entrance animation originally lived in the dialog
  shell; an effect in the shell can run before Radix has mounted its portal content, so the panels
  stayed at `opacity: 0` and the console body never arrived. Everything animated now lives in
  `DialogPanels`, which mounts with the content (see §7).

  **Motion.** One anime timeline for the entrance (title, lede, the three steps at 70 ms, chips at
  26 ms, console, footer), one for the round trip (request lines at 24 ms, the three legs at their
  real offsets, response at 580 ms). Transform and opacity only, every delay through `dur()`/
  `staggerUI()`, and the blinking caret in the button is a CSS loop the global reduced-motion rule
  nullifies. Verified in Edge at 1440/820/390 in light and dark, under `prefers-reduced-motion`
  (everything lands at opacity 1 instantly) and with the catalog aborted.

  **Gates.** Web unit **19/19** (+3, the naming rule) · full **940/940** unit · browser smoke
  **all checks passed, no console or page errors** · `pnpm test:bundle` boundary intact (364 modules,
  0 engines in the main chunk) · `pnpm typecheck` clean.

- **2026-10-19 — P6.4 hardening pass over the P6 surface: one real fix (MCP base-URL smuggle class),
  one drill, one stream-sniff matrix, three recorded reviews, the vector flag dropped on the record.**

  **The fix.** `resolveBaseUrl`'s forbidden-character class anchored its first alternative (`/^[…]/`),
  so `< > " ' \` \\ ~ ^ | {` were only refused at position 0 — i.e. never for a real `https://…`
  string. `https:\attacker.example` sailed through as a smuggled host (WHATWG folds backslashes into
  slashes on special schemes), and percent-encoded `?`/`#` introduced a query/fragment the
  `url.search`/`url.hash` checks could never see. The class now matches anywhere
  (``[\x00-\x20\x7f<>"'`\\~^|{}?#]``), with `test/base-url.test.ts > refuses origin-smuggling shapes`
  pinning protocol-relative strings, backslash hosts and decoded `%2e%2e/%3f`; every prior refusal case
  still passes, plus IPv6 non-loopback (`[fe80::1]`, `0.0.0.0`) now explicitly refused for plain http.

  **The drill.** Rotation/revocation became tests instead of a hope (`v1.test.ts` "rotation +
  revocation drill"): a replacement key inherits the account — it polls and downloads the revoked
  key's completed job and keeps submitting with its own quota; the revoked token 401s identically to a
  never-seen one on any endpoint, with no queue trace, even mid-window with its minute slot spent.

  **The sniff.** The v1 multipart branch — previously only covered through its shared code — is now
  behavior-tested end to end: keyed multipart accepted into the same queue shape with an opaque worker
  subject; non-PDF magic refused mid-stream (400 `validation_failed`, nothing enqueued); the
  per-request ceiling caps mid-stream (413 `upload_too_large` after a passing reservation); and a key
  whose daily byte tier sits below the ceiling is refused at reservation time before the first disk
  byte (429 `quota_exceeded`).

  **The reviews (recorded, no code change needed).** SSRF: `apps/api` has zero `fetch(` of
  request-shaped URLs (worker child included); Google endpoints are fixed constants; managed-AI's
  provider URL is deployment config; BYOK is browser-direct (accepted in §24.2); P4.4 URL-fetch stays
  gated. Signing abuse: the audit sidecar is honestly a re-signable, rewritable note whose only claim
  is the recomputable `output.digest` — `certified: false` says so; pad memory is device-local
  IndexedDB with the existing delete story. Vector-signature flag: no flag existed; raster is the
  shipping path and vector re-enters at P7 only behind a round-trip fidelity test (§25.6 item closed
  rather than left open).

  **Gates.** Unit **937/937** (189 engine · **197 API** (+6) · 364 provider · 152 agent · 16 web ·
  **19 MCP** (+1)); `pnpm typecheck` ✅ across all packages; MCP bin rebuilt (spawned-stdio E2E re-ran
  against the fixed binary).

- **2026-10-19 — P6.3 PDFShush MCP server shipped (`@pdfshush/mcp`, local stdio): every
  server-runnable slug as a tool, one REST round-trip per call, zero engine on the client.**

  **One source, finally shared (`packages/api-contracts`).** §25.3's v1 zod module promised spec +
  docs page + MCP from one source; this phase made it structural. The job-payload contracts
  (slugs, `MAX_UPLOAD_FILES`, `jobPayloadSchema`, failure taxonomy) and the v1 request/response
  schemas moved verbatim into a new workspace package (`@pdfshush/api-contracts`, dependency: zod
  only, no engine, no I/O). `apps/api` reads it through two one-line re-export shims
  (`jobs/payload.ts`, `http/v1/schemas.ts`) and `keys/store.ts` re-exports `API_KEY_SCOPES` from it;
  node behavior unchanged — API suite still 191/191 after the move.

  **The server (`apps/mcp/src/`).** A thin stdio bridge over `/api/v1` adapted from the GenOffice
  donor (Apache-2.0, attribution in `licenses/pdfshush-mcp-donor-NOTICE.txt`): one MCP tool per
  `SERVER_SLUGS` entry (`pdfshush_inspect` … `pdfshush_edit`, generated by picking fields out of
  `apiCreateJobSchema` — validators untouchable, only descriptions layered), a `pdfshush://tools`
  catalog resource fetched live from the deployment (falls back to the contract list with an honest
  note when unreachable) and `pdfshush://guide/<slug>` per slug carrying the file rules and the
  `options` vocabulary the engine jobs actually read (checked against the pdf-core sources; the
  `edit` guide states the image-object-over-JSON limitation rather than pretending).

  **Config + no-escape.** `PDFSHUSH_API_URL` (default `https://api.pdfshush.com`) +
  `PDFSHUSH_API_KEY` (required, exit-with-instructions when missing). `resolveBaseUrl` refuses
  non-http(s) schemes, unencrypted non-loopback http (loopback allowed; `PDFSHUSH_ALLOW_HTTP=1`
  makes the risk explicit), userinfo, query/fragment, and percent-encoded smuggles of any of the
  above — every refusal names the repair. The package's only `fetch` lives in `src/api.ts`.

  **Call semantics.** One tool call = validate locally against the contract → submit inline → poll
  (backed off, ≤ 4 min) → fetch result → attach outputs: embedded base64 resources when ≤ 4 MB per
  file and ≤ 8 MB total, otherwise honest resource links with per-file download URLs (foreign-origin
  listing URLs are linked, never fetched). Everything — network refusals, `unauthorized`,
  `quota_exceeded`, `validation_failed`, a result expiring mid-call — surfaces as a truthful tool
  error with a next-step hint, never a hang or a lie.

  **Gates (all green).** Parity: tool list pinned to `SERVER_SLUGS` and shapes valid at every probe
  accepted/rejected identically to `apiCreateJobSchema` (`test/parity.test.ts`). No-escape:
  `test/base-url.test.ts` across scheme/loopback/userinfo/percent tricks. stdio E2E: the *built,
  spawned binary* against a fake `/api/v1` speaking the spec shapes — initialize → pinned
  `tools/list` → guide resources → a full submit → poll → inline-PDF call, the multi-output listing
  path, and the deployment-error verdict as `isError` (`test/stdio-e2e.test.ts`, 18 MCP tests
  total). Plus one live probe against the actual Docker stack (401 verdict through stdio). The move
  also flushed out a container-shaped gap: `@pdfshush/api-contracts` needed the same esbuild-alias +
  Dockerfile COPY treatment as pdf-core/ai-provider (deps-stage manifests, build-stage sources) —
  rebuilt and the **full API smoke re-passed on the rebuilt image**, v1 flow included.

  **Web.** `/tools/mcp` (`components/tools/mcp-tool.tsx`, registry-flipped to live like `api`):
  client config snippet (key-less by policy), per-key metrics from the deployed spec, tool list
  rendered from `x-tool-labels`, cross-link to `/tools/api`. Unit totals now **191 API + 18 MCP =
  930/930**; `pnpm typecheck` ✅ · builds ✅ · `pnpm test:bundle` ✅ (chunk notes unchanged).

- **2026-10-18 — P6.2 Public REST API shipped (`/api/v1`): server-runnable slugs over keys, with
  the same pipeline underneath.**

  **Keys (`apps/api/src/keys/store.ts` + `apiKeys` collection).** `pshk_` + 32 random bytes
  base64url (43 chars); the stored `_id` is the SHA-256 of the full token, so a Mongo leak yields
  nothing usable and lookup is one indexed `findOne`. Only a 16-char display `prefix` is kept —
  the raw token exists solely in the creation response. Scopes `jobs:write` / `jobs:read` /
  `results:read` (no AI scope, D5), validated strictly at mint (unknown names are a 400, not a
  silent all-scope default). Revoke is a mark, not a delete; invalid and revoked keys answer an
  identical 401 so revocation leaks nothing. Key mint/revoke/erasure: management routes in
  `apps/api/src/account/api-keys.ts` (session + CSRF like every account route; cap via
  `API_MAX_KEYS_PER_ACCOUNT`, 409 at the limit), and `deleteAccountData` now removes keys with
  the account so erasure §18.3 leaves no live bearer credential behind.

  **v1 surface (`apps/api/src/http/v1/`).** `GET /tools` (catalog of `SERVER_SLUGS`, labels from
  the engine's `NODE_JOBS`, the documented limits), `POST /jobs` (inline JSON with base64 files
  capped 10 MB/file for agent contexts, or the same streaming multipart as the anonymous route;
  both share `receiveUpload`/`writeInput` admission control), `GET /jobs/:id`, `GET /jobs/:id/result`
  (one file streams verbatim; several return a JSON listing with per-file URLs), plus
  `/result/files/:name` and a public `GET /openapi.json` (no key material; lists shapes and limits
  even where accounts are off, while every other route answers 503 `auth_disabled`). Submission
  walks the same reserve→prepare→settle walk as the anonymous route; the job directory is removed
  and reservations released on every failure path (refund base switches at the settle point so an
  enqueue failure rates the real bytes, not the ceiling). Quota is per key (`apikey:<keyId>` in
  the counter namespace) with the account as a second service whose minute bound can never trip —
  isolation is structural: a spent key cannot pre-pay the account ceiling for its siblings. Job
  ownership is recorded to the account (survives key rotation); `x-job-token` remains the fallback
  for the accepted-but-unrecorded window. Reads get a per-key poll ceiling (`API_READS_PER_MINUTE`,
  240) that fails open on a counter outage. Shared helpers were extracted for both front doors:
  `http/options.ts` (`parseOptionsField`) and `http/result-stream.ts` (`contentTypeFor` +
  `sendResultFile`, with the janitor-race error handling).

  **OpenAPI + docs page.** The spec is generated from the same zod schemas the route validates
  (`z.toJSONSchema`, 2020-12), with a schema-parity gate pinning catalog slugs ≡ `SERVER_SLUGS` ≡
  `NODE_JOBS` keys. The web `/tools/api` page (`components/tools/api-tool.tsx`, now **live** in the
  registry) renders the flow, scopes, quota tier and curl examples straight from the deployed spec,
  so it can only promise slugs this deployment actually runs. The account page gained an
  API-keys panel (`components/account/api-keys.tsx`): create with name, the one-time reveal dialog
  with copy, prefix-only listing with scopes + last-used, and revoke with confirm; deployments
  without accounts show a quiet "not enabled here" notice.

  **D8 / L6 closed.** The logger redact list now strips `apiKey`, `x-job-token`, `cookie` (and the
  `x-api-key`/`x-job-token` headers) alongside the original password/token/authorization set.

  **Config.** New `apikey` section (`API_KEY_TASKS_PER_MINUTE/DAY`, `API_KEY_BYTES_PER_DAY`,
  `API_ACCOUNT_TASKS_PER_DAY/BYTES`, `API_MAX_KEYS_PER_ACCOUNT`, `API_MAX_INLINE_FILE_BYTES`,
  `API_READS_PER_MINUTE`) defaulting to the D5 tier in `LIMITS.server.api`.

  **Gates.** New `apps/api/test/v1.test.ts`: authn matrix (missing/garbage/revoked → one verdict
  shape), scope matrix (`insufficient_scope` per endpoint), cross-account closure, per-key
  isolation with the account ceiling closing both keys, read throttle (small configured windows,
  no waiting out a minute), inline admission (magic bytes, inline cap, bad base64, wrong slug,
  duplicate-name dedupe), anonymous-`/api/jobs`-unchanged, catalog + spec parity, and management
  routes (token shown once, CSRF, cap, ownership-filtered revoke) — **191/191 API** (176+15) and
  **912/912 unit** total. Real-stack (Docker + Redis + worker + Mongo): smoke section 6 verifies
  seed→mint→catalog→inline submit→poll→download→revoke→invalid-verdict plus the read-only-key
  403; hardening gate and browser E2E (smoke, sign 17/17, text-edit, AI, managed-AI) all green.
  Hardening also flushed out a pre-existing landing-page whitespace-node console error — the
  comparison-table JSX comments now sit *outside* `<thead>`/`<tbody>`, and the smoke e2e runs
  error-free. `pnpm typecheck` ✅ · build ✅ (chunk notes unchanged) · `pnpm test:bundle` ✅.

- **2026-10-18 — Landing premium rework + frontend bug sweep shipped.** The homepage is now the
  product's pitch: headline *PDF tools. Smarter document intelligence.* with a privacy-first sub,
  two CTAs (**Talk to a PDF**, **Edit with AI**), and an 8-chip **"Jump straight to a tool"** grid
  (merge/split/compress/edit/convert/organize/sign/protect — every chip routes to a real tool page;
  the two not-yet-built ones carry an honest `soon` badge). The AI band is an **interactive mock
  console** (Chat with a page / Natural language edit / Destructive redaction): example questions are
  live buttons, the document panel highlights/strikes/burns in sync with the assistant, edit mode has
  apply/discard/revert states with tracked-change rendering and a stamp slam, redact mode has a scan
  sweep plus a "peek destroyed data then re-burn" beat. Introduced a motion module
  (`apps/web/src/lib/motion.ts` + `useMotionScope`, **anime.js v4.5.0**): hero intro, chip cascade,
  demo states, all transform/opacity only, parked and paused on unmount (StrictMode-safe), fully
  collapsed under `prefers-reduced-motion`. Verified with typecheck, the 897-test unit suite,
  production build, and a throwaway Playwright harness (desktop light/dark + mobile, every demo
  state) whose only console errors were the pre-existing `/api/*` probe 502s on `vite preview`.
  A follow-up bug sweep (branch `fix/frontend-sweep`) closed: scroll-gated entrance observers now
  disarm on unmount (`onEnterViewport` returns a disconnect fn), the edit tool's nudge-coalescer
  timer is cleared on unmount, and em dashes were rewritten into punctuation in all user-facing copy
  (buttons, toollets, status chips, signature descriptions) — comments and numeric ranges untouched.
  Follow-up (same day): the document band's stem plate is now alive in normal scrolling — its 18s
  Ken-Burns settle arms the first time the band enters the viewport (the load-timed CSS take used to
  burn out off-screen, which is why the artwork only moved on refresh, when scroll restoration put
  the band already on screen), plus a rAF-throttled scroll-linked ±26px drift on a wrapper layer
  (anime's `onScroll` bounds landed before the band was visible, so the parallax is plain scroll
  math). Transform-only, reduced-motion-gated, listener cleanup on unmount.

- **2026-10-18 — P6.1 Fill & Sign shipped (capture → store → place → export → audit sidecar).**
  E-sign slice one is code and green.

  **Capture (`components/signature/signature-pad-dialog.tsx`, lazy chunk).** `signature_pad@5.1.4`
  (zero-dep, §2) drives Draw; Type renders the bundled **Caveat** variable subsets (latin 75 kB +
  latin-ext 29 kB, woff2, SIL OFL 1.1 text in `licenses/caveat-SIL-OFL-1.1.txt`) onto the same
  canvas through `FontFace` with bundled URLs, not hotlinks; a font failure disables
  the Type tab visibly (D4) rather than falling back to a serif. The core preview is paper-white in
  **both** themes (ink here = ink on the page). DPR discipline per the README (canvas = CSS × ratio,
  scaled context, `fromData` redraw on resize); a stable **callback-ref epoch** re-runs the pad
  wiring when the canvas attaches — Radix portals + the lazy boundary can commit this component's
  effects one commit before the canvas exists, which under a plain `useRef` wired the pad to a null
  element forever (found via an injected-stroke probe, fixed and captured in §25.2's log). Undo =
  drop the last `toData()` group → `fromData(rest)`; trim is the in-repo ~30-line alpha scan
  (`computeInkBounds`) applied before every capture, so placed signatures carry no dead margins.
  Saved assets live in a new `signatures` IndexedDB store (**DB v3**, same connection-owner file)
  capped at 5 assets / 200 KB PNG (D3): at-cap is a *visible* refusal, never a silent evict; stroke
  data is pinned into our own `strokesSchema: 1` shape (minimum fields, versioned), never stored
  wholesale. Adopting a saved asset shows its stored PNG over a blanked pad — what you adopt is
  exactly what you place.

  **Placement + export.** The editor toolbar gains a Signature tool (PenLine) and the page routes
  clicks through `onSignatureRequested` → dialog → `EditImageObject` (PNG embed, capped at
  `SIGNATURE_WIDTH_PT` = 150 pt, click-seeded top-left like image insert). `fill-sign` is the edit
  editor in its signing hat (`variant="fill-sign"`: signature tool pre-selected, "Sign & export"
  save, optional signer-name strip for the D2 label, export named `<stem>-signed.pdf` via the edit
  job's `outputName`), and `signature` is a small asset-manager page (`components/tools/
  signature-tool.tsx`): create/review/delete, no upload path by design (an imported bitmap is just
  an image, which Edit already places).

  **Audit sidecar (§25.1 D2, `lib/audit-sidecar.ts`).** `pdfshush.audit-trail/1` JSON with
  source/output SHA-256 (SubtleCrypto, secure-context only), render kind, method, sanitized label,
  placements, client timestamp — plus an in-schema `attestation.certified: false` note so the
  artifact itself states what it does not attest to (D1). **Fail-closed:** when digests are
  impossible no sidecar is written at all and the result panel says why; there is no digest-less
  degraded form. The note rides the ResultPanel as a second download (`<stem>-audit.json`).

  **Tests/gates.** Web app's first unit suite (`apps/web` + vitest, root `pnpm test` aggregates via
  `--if-present`): 16 tests over trim math, label sanitizer (including astral-plane code points)
  and record validation; caps pinned by test (5 / 200 KB / schema 1) — changing one is now a
  §25.1 decision, not a tweak. New `tests/e2e/sign.mjs` (`pnpm test:e2e:sign`): 17/17 — dialog
  draw/save/adopt/place against a real worker, `-signed.pdf` export asserted as `%PDF`, and the
  audit note downloaded and parsed back (schema, label, one placement, 64-hex digests,
  `certified:false`). `pnpm test:bundle` extended and green: main chunk carries 0 pdf-lib / pdf.js /
  pdfium / `signature_pad` / Caveat; the pad ships as a **33 kB (10 kB gzip) lazy dialog chunk**;
  the Caveat woff2 files ride it. Gates re-measured: `pnpm typecheck` ✅ · **897/897 unit**
  (189 engine · 176 API · 364 provider · 152 agent · 16 web) · **101/101 + 8/8 + 17/17 + 11/11 +
  17/17** browser E2E · production build ✅ with the chunk notes unchanged (pre-existing).

  **Deliberately deferred to later in P6.1/P6.4:** the vector path (`toSVG()` → `drawSvgPath`)
  stays behind the §25.2 flag until its round-trip test exists (raster is the shipped path);
  smoke.mjs gains a fill-sign section only if the dedicated suite ever retires.

- **2026-10-18 — P6 planned in detail and P6.0 (decision record) completed; no code written.** The
  lost session file `p6-sign-signature-pad.md` was superseded by new §25 (§2's `szimek/signature_pad`
  decision stands; `signature_pad@5.1.4` pinned). Four decisions recorded from the author: signature
  assets **local-only** (IndexedDB, no sync), e-sign slice one = **Fill & Sign only**
  (`sign-workflow` routed to its own later gate), bundled **Caveat** (OFL) for the Type tab, and an
  **API-tuned quota tier** for public keys (500 tasks/day · 30/min · 5 GB/day per key, 2,000/day ·
  10 GB/day account ceiling; anonymous policy untouched). Technical calls recorded in §25.1 D1–D8:
  no eIDAS/ESIGN claims, `<stem>-audit.json` sidecar fail-closed on SubtleCrypto digest unavailability,
  `x-api-key`-only v1 with `pshk_` keys SHA-256 at rest and `jobs:write`/`jobs:read`/`results:read`
  scopes (no AI scope), MCP inline transfer capped at 10 MB per file with an https-only base URL, and
  D8's invariant that `apiKey`/`cookie`/`x-job-token` join the logger redact list as soon as P6.2
  lands (closes §24.5 L6 early). Status board, §24.5 order and §25.6 updated: **P6.0 done,
  P6.1 unblocked; next is P6.1 code** (pad dialog → editor placement → export), with its gates
  already specified in §25.2.

- **2026-10-18 — accounts went live by diagnosing an Atlas TLS refusal; the last §24 High (H4) closed as an operator action.** A deployment where every `/api/auth/*` and `/api/account/*` route answered 503 `auth_disabled` was not an env-var gap: compose passed all `MONGODB_*` / `GOOGLE_*` values into the container correctly, but `setupAuth` **downgraded to anonymous-only** because the Atlas handshake aborted with `tlsv1 alert internal error` (server alert 80). The probe that settled it: all three shards failed identically on both OpenSSL (Node) and schannel (curl), across TLS 1.2-only / 1.3-only / every ALPN variant, while `cloud.mongodb.com:443` and TLS on other non-443 ports (Gmail SMTP/IMAP) handshook fine — isolating the failure to Atlas's server-side access gate and matching the Community-documented signature for a missing Network Access entry. The operator added the machine's IP in Atlas; boot then logged `accounts enabled` and `/api/auth/google/start` returned a 302 to `accounts.google.com` carrying PKCE (`S256`), `state` and `nonce` — sign-in verified to the consent URL, not through an interactive consent round trip.

  **Code change (`apps/api/src/auth/setup.ts` + `.env.example`).** `createAuthDb` failures are swallowed by design (§18.2: accounts must never gate the anonymous tools), so an operator ever only saw the downgraded boot log — and for this failure mode a raw OpenSSL string instead of a diagnosis: the alert is *server-side*, and for Atlas it means the Network Access list. Connection failures are now re-wrapped in that diagnosis (matched on `tlsv1 alert internal error | ssl alert number 80`; every other failure passes through untouched), the original error stays attached as `cause`, and `.env.example` documents the symptom under the Mongo block. `pnpm --filter @pdfshush/api typecheck` ✅; wording-only change, so the **881-test unit suite is untouched**.

  **Credential verification (no code).** The `.env` `GOOGLE_CLIENT_SECRET` was dead — the token endpoint returned `invalid_client` for it while the downloaded `client_secret_*.json`'s secret was accepted (`invalid_grant` on a probe code) — and the one "client not found" verdict on the `.env` id reduced byte-for-byte to the probe's regex capturing a trailing CR from Windows line endings, not a file defect. The live secret was rewritten into `.env` (single-line regex replace, value never displayed), confirmed by re-probe, and the now-redundant JSON deleted so the values live only in the gitignored `.env` (`.gitignore:9`, verified via `git check-ignore` + `git ls-files`). §9's pre-push secret/PII/dangerous-sink grep ran over tracked files: secret-pattern hits are only the labelled redaction-test fixtures that pre-date this change, and the sink hits are the two in-file-documented exceptions (`redis.eval` on constant scripts, `hardening.mjs`'s fixed-argv `execFileSync`) — **no new hits from this change**. **H4's residue — a fresh-secret rotation and a secrets manager — remains standing deploy-time hygiene (§24.2).**

  **Housekeeping (same day).** Four untracked leftovers from the editorial-band work were dispositioned without deleting anything: `.taste-skill/` (that skill's session captures — window JPGs, critique markdown, `report.json`, capture script) joined the existing agent-tooling ignore block, and `assets/` plus `logo/` acquired a reason-labelled ignore block of their own. Nothing in them needed publishing — the served copies were already committed in `93a05dd` (`apps/web/public/brand/`, `public/hero/`), the two apparent duplicates were proven identical by SHA-256 (`logo/stem-2.png` ≡ `public/brand/stem-2.png`, the pindown mp4 ≡ `public/brand/pindown-tree.mp4`), and nothing under the app's source references the root directories at all (`assets/` holds only the *retired* design's photograph originals and their `credits.json`; `logo/` holds stock downloads and the PNG origins of the webp plates). The bytes stay on disk for the author; third-party raw media stays out of git until its licence terms are recorded in `licenses/`, which the new `.gitignore` comments state explicitly. `git status` was clean of untracked noise afterwards.

- **2026-10-18 — the editorial band became a stem-plate poster, and the prose visual became a rooted-tree silent loop with a one-click access gate.** See `apps/web/src/components/landing/document-band.tsx`, `features.tsx` (`DocumentLoopVideo`), and `public/brand/`.

  **The band (`document-band.tsx`).** The Library of Congress reading-room photograph (and its caption + Highsmith credit) were replaced by the brand `stem-2.png` plate (1854×848, pure-#000 canvas), served from `public/brand/stem-2.png`. The image is now a direct child of the section and paints full-bleed — `object-cover` over fixed strip heights (320/440/500 px) with `objectPosition: 50% 46%` — so the dot peaks run past the frame edges while the blue folder and wordmark hold dead centre at 390/1440/2560; `fullBleed` was asserted equal to the viewport at rest, and the 0.20 band-photo settle still plays over it (it is clipped by the section's `overflow-hidden`, black into black, so the motion is invisible as a crop). Because the plate's own background *is* that black, the section paints `bg-black` in **both** themes; the old photo scrim is gone (it no longer has a job) and no credit line is needed for a brand asset. The statement sits centred in the void below the strip: "The tools stay powerful. The document stays yours." plus a support line ("Every merge, convert, redact and sign runs locally…"), written without em dashes per the project copy rule, with `text-balance` on both lines. The footer's "Photographs:" attribution paragraph was deleted (both photos left the UI), and the now-orphaned `public/archives/` directory was removed. Existing tokens and systems were reused (type scale, `data-reveal`, `.band-photo`).

  **The second visual (`features.tsx`).** The probate photograph + visible caption + Archives New Zealand attribution became `DocumentLoopVideo`: a silent, control-free loop of the pindown tree (H.264/avc1 720×1280, ~2.6 MB, moov first, 10.0 s — verified by parsing the MP4 boxes, not by trust) at the figure's **pre-existing** `aspect-[3/4] rounded-lg` frame, `objectPosition: 50% 40%`, so section proportions, crop and rounded corners are unchanged and both canopy and roots survive the crop. Because the loop's frame is a pure-black still for most of its second half, the figure reads as one leaf with the band above it in both themes. Delivery is measured, not eager: `preload="metadata"` fetches only the header, an IntersectionObserver arms `play()` ~240 px before arrival and pauses only when the frame fully leaves (thresholds `[0, 0.2]` — edge hysteresis, no stutter at the viewport boundary), and a second effect re-asserts the `muted` DOM property because React writes the attribute too late for Safari. A poster frame (`pindown-tree-poster.jpg`, captured from the actual video at t≈8.2 s via the browser so it matches the crop exactly) paints instantly with zero layout shift and doubles as the still of record when motion is withheld or playback fails.

  **"The video won't play."** Diagnosed with real evidence on the dev server: in a normal browser context the loop self-starts fully buffered, with zero errors — but under `prefers-reduced-motion: reduce` the component intentionally refused to autoplay (correct per the accessibility brief), and a browser that denies even muted autoplay produced a silently swallowed `play()` rejection: in both cases the visitor held a frozen frame with **no visible way to start it**. The figure now shows a small one-click play disc (bottom-centre, on the black base, hairline ring, aria-labelled) **exactly** when playback is withheld — reduced motion, denied autoplay, or a failed start — and the disc disappears once the loop runs; on ordinary browsers nothing extra renders at all. Reduced motion is respected by not forcing motion on anyone; it no longer means "content withheld".

  **Verification.** `pnpm typecheck` ✅ all five packages · **881/881 unit** (189 engine · 176 API · 364 provider · 152 agent — the count held) · `pnpm build` ✅ (chunk notes unchanged, pre-existing) · §9 pre-push secret/PII/dangerous-sink grep **clean** over every changed file · `.env` and the Google client-secret JSON confirmed still gitignored and untracked · no stray helper scripts left in the repo. Browser-verified in Playwright Chromium: full-bleed at rest on 390/768/1440/2560 × light/dark; band copy machine-checked dash-free; video advancing in real time (`muted: true`, `readyState 4`, buffered `0→10 s`), paused at 0 under reduce, recovery via the visible control; junctions against the catalog and "Why it runs" section reviewed; only the pre-existing `{" "}` whitespace-node errors from the comparison table appear in the console (untouched code — `feature` §tables are out of this change's scope).

- **2026-10-17 — cinematic Greek hero plate, and a desktop-only grade pass over it.**

  **The backdrop.** The hero now carries a decorative Greek plate (`greek-day` / `greek-night`, plus
  `-sm` variants for the 1080w `srcSet`). Both live in the DOM and the theme picks one — `block
  dark:hidden` / `hidden dark:block` — so a theme switch is a pure class swap, never a reload or a
  flash. Two stacked veils grade it: `.hero-backdrop-wash` (a 100deg text-side veil that keeps a
  calm ground under the copy, lifted off the top by a vertical mask so the sky stays photographic
  rather than milky) and `.hero-backdrop-scrim` (the top/bottom dissolves plus the warm-gold or
  moonlight radial). The light wash is deliberately **neutral white** — tinting it yellow is what
  turns a golden-hour photograph into a beige wash; the warmth has to come from the plate. A
  first-frame `prefers-color-scheme` rule paints the matching plate before React mounts, gated on
  the absence of *both* theme classes so it cannot fight the utilities once `ThemeProvider` has run.

  **The desktop pass.** Two changes, and only two, scoped to `@media (min-width: 1024px)`: the plate
  gains brightness and richness in **both** themes (`saturate/brightness` 0.94/1.02 → 1.06/1.08 by
  day, 0.97/0.95 → 1.08/1.04 by night), and the text-side wash thins past the copy column (light
  63/44/22% → 54/33/14% at the mid-to-far stops) while the stops directly under the headline barely
  move, so contrast is preserved. The bottom dissolve, previously a 58% white haze from 64% and a
  58% black fade from 62% hitting full background at 82%, is now a **subtle breath at the foot**:
  transparent to 64/62%, 18% at 84%, page background only at 98%. Phone and tablet keep the base and
  `max-width: 639px` values **byte-for-byte** — the desktop block is a later, mutually exclusive
  query, and the top dissolves and both radial grades are copied verbatim so nothing else moved.

  **Verification.** Confirmed in real Edge against the dev server at 1440×900 in both themes: the
  computed `filter` / `background-image` on the plate, wash and scrim are the new values, and at
  390×844 they are still the *original* phone values (so mobile is provably unchanged, not merely
  un-looked-at). Also added `tests/sweep.mjs` (`pnpm test:sweep`) — a responsive sweep across six
  breakpoints × both themes reporting horizontal overflow, unrevealed reveal-blocks, and size/contrast
  outliers; it is a diagnostic, **not** a gate. Gates: **881/881 unit** (189 engine · 176 API ·
  364 provider · 152 agent) · `pnpm typecheck` ✅ all five packages · pre-push secret/PII/dangerous-sink
  grep clean, with `.env` and the Google client-secret JSON confirmed untracked **and** gitignored.

- **2026-10-17 — the job worker could not load its own processor on Windows: every server-side job
  failed instantly.** Found while re-running the browser E2E against the hero commit, and fixed.

  **The bug.** `apps/api/src/worker/host.ts` passed a bare Windows path (`path.resolve(...)` →
  `C:\...\dist\processor.cjs`) to BullMQ's `Worker`. BullMQ forwards the processor to Node's ESM
  loader in the forked child, which rejects a `c:` protocol: `Only URLs with a scheme in: file,
  data, and node are supported ... Received protocol 'c:'`. Every job the server accepted died on
  arrival. `POST /api/jobs` still returned `202` — the failure only surfaced on the job's own
  status, which is why this read as a *hang* rather than an error: the workflow run waits on a
  download that a failed job never produces, so the E2E burned its full 180 s `waitForEvent`.

  **The fix is `pathToFileURL(processorPath)`** — and it has to be the URL **object**, not
  `.href`. That distinction is the whole trap: BullMQ branches on `processor instanceof URL` and
  existsSync's it directly (`bullmq/dist/cjs/classes/worker.js`). A `href` string takes the *path*
  branch, where `fs.existsSync('file:///C:/…')` is false and the worker refuses to start with
  "File file:///C:/… does not exist". Verified on this machine: `existsSync(path)` true,
  `existsSync(href)` **false**, `existsSync(new URL(href))` true. So the first attempt at this fix
  traded one instant failure for a different one.

  **Why it survived so long, and why it is worth reading this entry.** All 18 live tools run
  client-side in a Web Worker, so the server pipeline is reached only by `test:api` /
  `test:hardening` (which need Docker + Redis and were, by the admission in §9, only ever
  compose-validated) and by the workflow section of the browser suite — which **skips itself
  whenever `/api/tools` is unreachable**. So the bug was masked whenever the API was absent. The
  `dev` script now starts web *and* API together, which removed the mask: the API answered on the
  host, the skip stopped firing, and the first genuine server-side execution in the browser suite
  hit it. A gate that skips on a missing dependency also hides breakage in that dependency — the
  skip is not evidence the code path works.

  **Verified.** A `merge` job went from instant failure to `completed` with a valid 3-page
  `alpha-merged.pdf`, and the full browser suite went from 86-then-abort to **101/101** with the
  previously unreachable step now asserting on bytes: "workflow runs end to end and downloads a
  PDF — alpha-organized-merged.pdf — 1664 bytes". Gates: typecheck ✅ · 176/176 API unit ✅.

- **2026-10-17 — Redis resilience, diagnostics, and PDFShush wordmark integration.** Redis queue/quota
  connections now use bounded exponential backoff with jitter, credential-redacted targets, deduplicated
  structured failure logs, and non-blocking connection health. `/api/health` has a 2-second timeout around
  queue/worker probes and reports Redis, queue, worker, and work-directory state separately, so a broker
  outage cannot hang the health endpoint. Added focused Redis diagnostics and health-route tests. A
  security pass found no tracked credentials or new shell/eval/DOM sinks; the existing on-disk credential
  rotation action remains open under H4 (§24.2). The supplied monochrome `pdfshush` wordmark now powers
  the shared header, mobile header, and footer logo component; the existing palette and favicon remain
  unchanged. Verification is limited where the local pnpm signature could not be verified; see the release
  note for the exact commands and results.

- **2026-10-17 — P6.9 hardening interlude: the §24 Highs and Mediums are closed.** See §24.2/§24.4.

  **H1** — the job child's environment is now an **allowlist** (`apps/api/src/worker/child-env.ts`),
  handed to BullMQ through `workerForkOptions.env`, so `MONGODB_PASSWORD`, `GOOGLE_CLIENT_SECRET`,
  `AI_MANAGED_API_KEY` and `PEPPER` no longer reach it (the embedded dev worker was the exposed case).
  Per-job filesystem scoping is **accepted by design** and recorded: the processor needs
  `node_modules`, so Node's permission model cannot apply. **H2** — a parent-side kill watchdog
  (`apps/api/src/jobs/children.ts`) kills a child past `JOB_HARD_LIMIT_MS`; a cooperative timer could
  not interrupt a hung synchronous parser. **H3** — `estimate()` is now admission control
  (`jobs/runner.ts` rejects over `LIMITS.job.maxWorkingSetBytes`), each child heap is capped, and every
  container carries `mem_limit`/`cpus` (`docker-compose.yml`: worker 5g/2, api 1g/1, redis 512m/1).
  **M1** — a production boot warning when no proxy hop is trusted (`http/trust-proxy.ts`). **M2** —
  uploads are sniffed for `%PDF-` from the flowing stream, not a second file handle. **M3** —
  `QuotaService.reserveUpload`/`settleUpload` reserve the ceiling before streaming and settle to the
  real byte count. **H4 stays open as an operator action:** rotate the on-disk Atlas password and Google
  client secret. Counts: **862/862 unit** (189 engine · 157 API · 364 provider · 152 agent). Also fixed
  a stray `.pnpm-store/` that a commit had swept into the repo (now gitignored) and tidied the root
  `dev` script to start web and API together.

- **2026-10-16 — P1–P5 security review, `redactSecrets` hardened, and P6 opened.** See §24.

  A read-only review of everything shipped through P5 — server (sessions/CSRF, uploads + path safety,
  the sandboxed worker, quota, the managed-AI gateway) and client (the BYOK key path, custom
  endpoints, the agent loop's bounds, the DOM/sink surface) — plus the §9 pre-push grep over every
  tracked file. **No Critical; four High open** (all resource-isolation / secret-hygiene, none an auth
  bypass — see §24.2 and the §24.5 backlog). Two defects were found and fixed, one client and one server.
  `redactSecrets` claimed to scrub "anything bearer-shaped" but only matched `sk-`/`key-`/`token-`, and
  the one-shot smart-redaction path (`lib/ai/ask.ts`) returned provider errors without calling it at
  all — a proxy echoing the `Authorization` header could have put a key on screen. The managed gateway
  (`api/src/ai/routes.ts`) streamed a raw provider error body to the browser, which could likewise
  carry the *deployment's* key. Both now run the same function, moved to
  `packages/ai-provider/src/redact-secrets.ts` (a package, so it finally has unit tests); it covers the
  prefixes this app actually ships plus `Bearer`/`Basic`/`AIza`/`AKIA`/`xox`/JWT shapes. Counts:
  **837/837 unit** (7 new provider tests and 1 new API test; the API count had already risen to 131
  with the processor-discovery tests) · **101/101 + 8/8 + 18/18 + 11/11** browser E2E ·
  bundle boundary holds. §1 refreshed (`Last updated`, P4 marked done with P4.4 gated) and §24.4 lays
  out the **P6 (e-sign / public API / MCP)** plan, since P1–P5 are verified end to end.

- **2026-10-16 — the four honest P5 gaps closed: real in-place AI rewrites, the key in IndexedDB,
  per-page change markers, and a managed-mode browser E2E.** See §23.7.

  **`replace_text` is now a genuine rewrite.** The edit plan gained `intents: AiInPlaceIntent[]`; a
  replacement becomes a rewrite of the run the document already has, and `applyEditPlan` routes it
  through the `text-edit` job with the old whiteout+redraw demoted to that edit's *fallback* (applied
  by the engine only when the rewrite is impossible or does not verify). `delete_text` follows the
  same path with `replace: ''`, so erased words are removed rather than hidden. `ai.mjs` now proves it
  from the downloaded bytes: the exported PDF contains the replacement and **no longer contains the
  original run** — a silent demotion to the overlay would leave the original text in the stream and
  fail the check. Overlay-only plans still never load PDFium.

  **The BYOK key left localStorage.** All AI state at rest (provider settings *and* the mode) now lives
  in one IndexedDB record (`apps/web/src/lib/ai/storage.ts`), with the old key pair adopted once and
  deleted, `sanitizeAiSettings` still gating every read and write, and a "Forget key" action that
  deletes the record. Doing it properly surfaced two real defects: a **hydration race** (two mounts in
  the same tick; the second read landed between the first one's migration read and its write, found an
  empty store and cleared localStorage, and returned defaults — the key was on disk but gone from the
  session) now fixed with single-flight hydration, and a **key-in-error-message** path closed by
  `redactSecrets` on every BYOK error. The page rail also marks pages with queued changes (amber dot),
  and `apps/api/test/support/managed-server.ts` + `tests/e2e/ai-managed.mjs` cover the managed path in
  a browser against the real routes with in-memory counters (no Redis, no docker).

- **2026-10-16 — P5 UI: one flagship AI workspace, per-change review, and a real bundle leak fixed and
  guarded.** See §23.6.

  **One workspace, three tools.** `components/ai/ai-workspace.tsx` replaces the two old AI shells
  (`ai-chat-panel` and `ai-document-tool`, both deleted) with a single two-pane surface: the document
  on the left — one legible page at a time, rendered by the same `thumbnails` worker path every other
  tool uses, with the *pending* AI changes drawn onto the page as overlay boxes — and the assistant on
  the right (streaming answers, a live tool-by-tool activity timeline, `[page N]` citations rendered as
  chips that jump the preview, token spend). The empty state is a hero dropzone with the settings card
  inline; AI tool pages now use a wider frame with AI-specific trust notes that say what actually
  leaves the tab.

  **Review is now per-change.** The edit plan gained structured `AiEditEntry[]`: every additive change
  owns the object ids it added, and each whole-document family (page order, rotation, header/footer)
  remembers the value from before it was first touched — so one card can be discarded on its own and
  `plan.actions` is *derived* from the survivors rather than appended to. Apply reports each engine step
  (`onStep`: overlays → page order → stamping) as a progress row.

  **A real invariant had broken, and is now guarded.** The new graph made the web app's *main* chunk
  jump from 771 kB to 1426 kB and contain 161 pdf-lib modules: `edit-skill.ts` imported the runtime
  `identityRefs` from pdf-core, which lives in `ops/compose.ts` — a module whose top-level
  `import { PDFDocument } from '@cantoo/pdf-lib'` cannot be shaken out. The helper is three lines, so it
  is now local to `edit-skill.ts`; the main chunk is back to **859 kB / 0 engines**. Because the break
  was invisible to a string grep, `tests/bundle-boundary.mjs` (`pnpm test:bundle`) now fails when the
  entry chunk contains pdf-lib / pdf.js / pdfium, reading the sourcemap's module list (with a
  text-signature fallback) and asserting the engines still ship in the worker chunks.

- **2026-10-16 — Phase P5 landed: ported AI stack, BYOK summarize/chat, smart-redaction leakage
  gate, managed server with budgets.** See §23 for the full record.

  **Ported, not reinvented.** Two new packages — `@pdfshush/ai-provider` (registry + protocols +
  watchdog + settings guard; **357 tests**) and `@pdfshush/ai-agent` (the ReAct loop, skill
  contract, stream-text; **152 tests**) — copied from the Apache-2.0 donor and pruned: the Codex
  app-server (the only Node-built-in source on the browser path), the Genspark/OpenCode provider
  ids and adapters, and the Electron transport are gone. `ai-settings-guard.ts` was made
  browser-safe; `DEFAULT_AI_PROVIDER` is now `openai` instead of `genspark`.

  **BYOK end to end, no server in the loop.** `apps/web/src/lib/ai/{settings,transport,pdf-session,
  pdf-skill}.ts` plus `components/ai/*`: the tab talks straight to the chosen provider with the
  user's key (localStorage at the time — moved to IndexedDB in §23.7.1, sanitized on read and write),
  reads all page text once through the
  existing `text-runs` job, and drives the shared agent loop for `summarize-pdf` and
  `chat-with-pdf` (a new **AI** category; 13 read/answer tools with page citations). The key never
  reaches a PDFShush server.

  **Smart redaction — the leakage gate (blocking).** The model only *proposes*: it is handed a
  bounded, numbered list of text runs and returns the indices it flags; geometry stays in
  pdf-core. `redact-tool.tsx` gained "Find sensitive data with AI" → proposed marks the user
  reviews → the existing R1 `redact` job destroys them → R1's verifier proves it. The gate itself
  is `packages/pdf-core/test/ai-redaction.test.ts`: on the exported bytes, two independent readers
  (pdf.js extraction + raw content-stream scan) find no proposed span; non-targeted content and
  pixel marks survive; and the **negative control** routes the same spans through the cosmetic
  whiteout path and *must fail* the gate.

  **Managed mode (server, off by default).** `apps/api/src/ai/{budget,routes}.ts`: a streaming SSE
  proxy in front of one PDFShush key, with `AiBudgetService` reserving the per-turn worst case and
  settling to the provider's reported usage (per-minute + daily windows over the existing Redis
  counter store, two tiers — anonymous IP-hash vs account), one concurrent stream per subject, and
  fail-closed `429 code:'ai_budget'` with `Retry-After`. Off unless `AI_MANAGED_API_KEY` **and**
  `AI_MANAGED_MODEL` are set, so a default deployment and CI need no secrets. **11 focused API
  tests** cover reserve/settle/refund/tier, the concurrency guard, 503-when-off, validation, SSE
  streaming, and 429.

- **2026-10-16 — P5 finished: agentic edit-by-chat, managed mode in the browser, AI browser E2E.**
  See §23.1.1 and §23.3.

  **Edit PDF with AI** (`edit-pdf-with-ai`, a new LIVE tool) closes the feature surface. The model
  reads the document and *proposes* edits; the user reviews a pending list and presses Apply, which
  chains the existing `edit` → `organize` → `stamp` jobs (each validating its own input and output).
  Markup/replace/delete select a run by page + verbatim text so geometry stays in pdf-core;
  replace is a whiteout over the old run plus a redrawn text object, which is a guaranteed result on
  every document. The plan is capped and cancellable; nothing is written until Apply.

  **Managed mode reached the browser.** `managed.ts` is a dependency-free SSE consumer for
  `/api/ai/chat` (content, reasoning, tool calls, stop, usage), `ask.ts` normalizes BYOK and managed
  into one "ask a question" shape so smart redaction works in both, and a mode toggle in the AI
  settings card is stored under `pdfshush.ai.mode.v1` — outside `AiSettings`, because the package
  guard strips unknown fields. A `/api/tools` `ai.enabled` probe hides the toggle on deployments
  without a managed key, so BYOK stays the default and the shipped path keeps bytes in the tab.

  **AI browser E2E, no keys.** `tests/e2e/ai.mjs` drives the real client stack against
  `tests/support/mock-llm.mjs`, a local OpenAI-compatible SSE mock: it proves a grounded chat answer
  with a citation, and an edit that is queued for review, applied, downloaded as a valid PDF, and
  still carries the marked text. Run with `pnpm test:e2e:ai`.

- **2026-10-14 — Phase T depth: charcode resolver, multi-object matching, editor focus fix.**
  Three findings, each proved before anything was built for it.

  **1. `FPDFText_SetText` corrupts subset-font documents; `SetCharcodes` does not.** On a real
  LaTeX export (Stirling-PDF's `mushroom-life.pdf`, read as *reference only* — the fixture is not
  copied into this repo), an A/B over the same 91 runs: `SetText` produced
  `"The,Lifecycle,of,a,Mushroom,Z"` — every space a comma, so verification reports the
  replacement absent — while `SetCharcodes` with codes read from the document itself produced
  `"The Lifecycle of a Mushroom Z"`. New `packages/pdf-core/src/textedit/charcodes.ts` derives
  that map from the document: `/ToUnicode` inverted first (it is what the reader decodes with),
  then `/Encoding` (`/BaseEncoding` + `/Differences` glyph names) to fill the gaps it leaves —
  exactly where whitespace lives on subset fonts. `encodeWithMap` returns `null` at the first
  character it cannot resolve, never a partial list (`SetCharcodes` replaces the whole glyph
  string), so the caller falls back to `SetText`, and verification still backstops a wrong map
  with an overlay rather than a bad file. Precedence is part of correctness: `/Differences` is
  inserted before the base encoding so the specific declaration claims a character two codes both
  draw — caught by a failing test where `space` resolved to 32 instead of the `/Differences`
  code 45. Font identity comes from `FPDFTextObj_GetFont` → `FPDFFont_GetBaseFontName`, subset
  tag stripped on both sides, keyed per page.

  **2. A visual line is often several text objects.** New `matchObjects` joins contiguous
  same-line objects (the same ink-overlap test `clusterTextRuns` applies to pdf.js items),
  compares whitespace-insensitively, and removes a matched *tail* with `FPDFPage_RemoveObject`
  rather than leaving the old words behind; a tail it cannot remove throws `TextEditUnsafeError`
  instead of shipping a half-replaced line.

  **3. PDFium hands back a glyph no document data explains.** The 14 runs that still failed all
  ended in a hyphen: the content stream writes charcode 45, the font program's own `Encoding`
  says `dup 45 /hyphen put`, `/ToUnicode` maps it to U+002D, pdf.js shows `-` — and
  `FPDFTextObj_GetText` returns `U+0002`. Translating that code would be a guess (routing it
  through `/ToUnicode` yields `Θ`, which was tried and measured), so matching instead **tolerates**
  it: `sameText` requires equal length and identical text everywhere except control codes, so the
  only runs that can match are ones differing solely in a glyph PDFium already failed to decode.
  A failure falls back to an overlay; it cannot select a different line.

  **Measured on that real fixture:** replacement present after the native pass
  **0/91 (`SetText` baseline) → 77/91 (charcodes) → 91/91** (charcodes + multi-object + control
  tolerance), every one of the 91 surviving re-extraction.

  **4. The click that opens an edit also closed it.** Fixing the blur guard to reset
  `focusedWhileEditing` when the session *ends* (React applies `autoFocus` before the passive
  effect) made the first blur commit — but the mousedown that follows the opening pointerdown is
  retargeted at the non-focusable page container, so the browser dropped focus on `<body>` ~4 ms
  after the textarea mounted and the editor closed before a character could be typed. The focused
  E2E failed on `editor-text-input` never becoming visible; focus-event logging pinned the cause
  (`focusin TEXTAREA` → `mousedown target=DIV/editor-page` → `focusout … active=BODY`). Fixed at
  the source: the opening gesture consumes exactly one mousedown default, so focus now holds
  through `mouseup`/`click` while every later outside click still blurs and commits.

  **Gates:** 302/302 unit (185 engine + 117 API; 20 new) · typecheck 3/3 · build ✅ · focused
  browser E2E 8/8 · full smoke green with the API + Redis stack up (Docker's daemon turned out to
  be installed at a non-standard path, so §19's workflow run is covered for real), including the
  editor Delete/undo section and console health. New coverage: 10 multi-object layout shapes,
  8 charcode-map tests (precedence, refusal, parser), 2 control-tolerance tests.
- **2026-10-14 — Genuine in-place text editing engine (§22).** Feasibility spike first:
  `@embedpdf/pdfium` 2.15.1 (MIT wrapper, BSD-3-Clause PDFium) exposes
  `FPDFText_SetText`, `FPDFText_SetCharcodes`, `FPDFTextObj_GetText`, `FPDFPageObj_GetBounds`
  and `FPDFPage_RemoveObject`, i.e. **real mutation of existing text objects**, proven by a
  Node spike (7/7: rewrite, unrelated-line preservation, rotated page) and matched by
  Stirling-PDF's shipped v2 editor (same binding, `PdfTextEditorCharcodeController`). New
  `packages/pdf-core/src/textedit/`: `pdfium.ts` (heap-safe object access), `engine.ts`
  (`editPdfText`: native pass → verification-driven demotion → overlay pass → final verified
  save), `verify.ts` (reopen with pdf.js), `runtime.ts` (lazy WASM bootstrap). New `text-edit`
  job. The editor save path now routes through it and tags click-to-replace boxes with the run
  they replace, so supported edits are rewritten in place and everything else uses the existing
  whiteout+overlay — and the UI says which happened. **Findings that changed the design:**
  `FPDFText_SetCharcodes` in this build takes `(textObject, charcodesPtr, count)`, not upstream
  PDFium's 4-arg form, so it is driven with a text-object pointer; and `FPDFText_SetText(obj, "")`
  is **refused**, so a deletion uses `FPDFPage_RemoveObject` and is never re-expressed as a
  cosmetic whiteout. **Gates:** 165/165 engine (11 new) · 117/117 API · typecheck 3/3 · build ✅
  main chunk 0 pdf-lib / 0 pdf.js / 0 pdfium (PDFium emits as a lazy 4.6 MB asset) ·
  **8/8 focused browser E2E** (`tests/e2e/text-edit.mjs`: click run → retype → save → the exported
  bytes re-extract to the replacement with the original gone). **Note:** the full smoke suite
  stops before its editor save section at a pre-existing Delete-key failure, reproduced with this
  work reverted (see §22).
- **2026-10-14 — Secure redaction shipped (R1); text-level redaction deferred (R2).** Redaction
  now **destroys** content instead of covering it. The custom content-stream engine built for
  this was **abandoned and deleted** (1,403 lines — `engine.ts`, `stream.ts`, `fonts.ts`): its
  correctness was unproven and it **hung**, and I proved the hang was in the strip path, not in
  the test fixture or the verification gate. Replaced with **rasterization-first**: every page is
  re-rendered, the marks are burned into the pixels, and a fresh document is assembled from those
  images alone — so no content stream, text layer, OCR layer, annotation, form field, attachment
  or metadata can survive, because none are copied across. Verification reopens the *serialized*
  file and checks it three ways: **pdf.js extraction**, a **raw content-stream scan** for
  `Tj`/`TJ`/`BT`, and **pixel decoding** of the embedded image (inflate + PNG predictor unfilter)
  to prove the marked areas are opaque and the rest of the page still has content. Fail-closed on
  no canvas, render failure, >150 pages, >100 MB output, no regions or a bad page index; the
  pdf.js document is released on success, failure and cancellation. `Whiteout / erase text` is
  renamed **`Whiteout (cosmetic cover)`** — it leaves text recoverable and must never be read as
  redaction. Delivered as `redact-pdf` in Security with drag-to-mark review, explicit disclosure
  before confirmation, progress, cancel and a verified download. **R2 — native text-preserving
  redaction — is deliberately deferred** until R1 is proven in production, with
  `rock3125/pdf-redaction` (Apache-2.0) and `marctjones/excise` (MIT) as candidates to audit and
  adopt rather than rebuild (§20.3).
  *Bugs the tests caught:* pdf-lib **injects `/Producer` and `/Creator` on save**, so a rebuilt
  document was not metadata-free; a coarse sampling grid reported legitimate text pages as blank
  and blocked the real browser render; and the registry edits that register the job had been
  **silently lost**, so the worker threw `Unknown job "redact"` — visible only to the browser E2E.
  **Gates:** 270/270 unit (153 engine + 117 API) · **101/101** browser E2E (8 new redaction
  checks) · 21/21 API · 17/17 hardening · main chunk 0 pdf-lib / 0 pdf.js. Detail in §20.
- **2026-10-12 - Production-risk closure before any new feature.** Swept the P4 surface for
  production-only risks and found five, one of them a real hole: **the CSRF check compared
  token *lengths*, not values** — any string of the right size passed, so the token guarding
  every state-changing account route guarded nothing. Now a constant-time value comparison, with
  a regression test proven red (reverting the fix fails exactly that test). Also: **the two
  sign-in routes were unthrottled** despite each doing work worth amplifying (a transaction row;
  an outbound request to Google) — now a per-IP 20/min window, verified live at 20×302 then 429
  with `Retry-After: 60`, scoped so the SPA's `/me` probe is unaffected; **a Mongo outage
  surfaced as a 500** instead of a retryable 503 `storage_unavailable`; **a `Secure` cookie over
  plain http failed silently** — the failure mode where a user looks signed in then signed out —
  now warned about loudly at boot; and **there was no `.env.example`**, while a downloaded Google
  client-secret JSON sat untracked in the repo root (now gitignored, values only in `.env`).
  Also removed a `jobs.ownsJob` stub that always returned `false`, and a double history query.
  **Gates:** 242/242 unit (129 engine + 113 API) · 93/93 E2E · 21/21 API · 17/17 hardening.
  Detail in §19.
- **2026-10-12 — P4 complete (P4.1–P4.3), P4.4 gated.** Accounts are live end to end against
  Google + MongoDB Atlas: the API logs `accounts enabled`, `/api/auth/google/start` returns a
  302 to `accounts.google.com` with the real client id, the registered redirect URI
  (`http://localhost:8080/api/auth/callback`), `code_challenge_method=S256`, `state` and
  `nonce`, and clicking **Sign in** in the running app reaches Google's consent screen.
  **P4.1:** sessions (SHA-256-only storage, revocable, `HttpOnly; SameSite=Lax` cookie),
  double-submit CSRF on every write, job ownership in `jobOwners` (TTL'd, recorded at submit
  time because BullMQ prunes completed jobs), SPA `useAuth` + account menu. **P4.2:**
  preferences, metadata-only history sync (opt-in), export-my-data and delete-everything with
  per-collection counts. **P4.3:** the recipe contract plus IndexedDB/account storage, a builder
  whose reorder **re-links the chain**, and a runner that executes each step through the existing
  `/api/jobs` endpoint — one upload → poll → download per step, output feeding input. The E2E
  asserts the downloaded bytes of a two-step run, not just a toast. **P4.4 is deliberately not
  built**; §18.5 records the SSRF/integerity/scheduling threat model that has to exist first.
  *Bugs found while building it:* `organize`'s no-page-list fallback returned `[]`, so the job
  threw "No pages selected" for the one order that needs no decisions — only reachable from
  outside the UI, which is why the workflow runner surfaced it (fixed, two regression tests);
  and the builder initially offered **tool** slugs (`merge-pdf`) where a recipe needs **job**
  slugs (`merge`), which would have posted the wrong slug. Also: a downloaded Google
  client-secret JSON landed in the repo root — now gitignored, and the values live only in the
  gitignored `.env`.
  **Gates:** 236/236 unit (129 engine + 107 API) · 93/93 browser E2E · 21/21 API · 17/17
  hardening · main bundle 698 kB, 0 pdf-lib/mongodb in it. Detail in §18.
- **2026-10-12 — P4.1 accounts: Google OIDC + cookie sessions (API side).** New
  `apps/api/src/auth/`: `mongo.ts` (collections + TTL indexes), `google.ts` (Authorization Code
  + PKCE, `state`, `nonce`, ID-token verification via jose against Google's JWKS),
  `store.ts` (accounts keyed on Google `sub`, sessions stored as SHA-256 only, single-use
  transactions), `routes.ts` (start/callback/me/logout), `setup.ts` (non-fatal wiring).
  **Authorised redirect URI to register in Google Cloud Console:
  `http://localhost:8080/api/auth/callback`** for local dev, `https://<domain>/api/auth/callback`
  in production — both overridable via `GOOGLE_REDIRECT_URI`. Mongo is now the store of record
  for account data (the decision §18.1 recorded); Redis stays queue/quota/job-state. Verified
  against the real Atlas cluster: `createAuthDb` connects and creates `accounts`, `sessions`,
  `authTransactions`. Anonymous-first is preserved structurally — auth is disabled unless a
  Mongo URI *and* both Google credentials resolve, and an unreachable Mongo downgrades to
  anonymous-only instead of failing boot; the live stack reports `/api/auth/me` → 204 and
  `/api/auth/google/start` → 503 with no credentials configured. Added the Vite `/api` dev
  proxy so the SPA talks to the API same-origin, which keeps the session cookie
  `SameSite=Lax` and removes any need for CORS. **28 new tests** (94 API total) cover the
  RFC 7636 PKCE vector, the open-redirect allow-list, real RS256 verification against a local
  JWKS (bad signature, `aud`, `iss`, `exp`, `nonce`), session hashing/revocation/expiry, and
  state replay. Not yet wired: the SPA sign-in button, account ownership of server jobs, and
  an explicit CSRF token. Detail in §18.2.
- **2026-10-12 — P4 opened; workflow recipe contract landed.** P4 split into five sub-phases
  (§18) so identity, data and automation land separately, and P4.0 written down as a decision
  record rather than left implicit: **MongoDB** for account/session/recipe documents with
  **Redis staying queue/quota/job-state only**, one OIDC provider, **server-side revocable
  cookie sessions** (never a long-lived token in `localStorage`), and a sync boundary that
  carries **metadata, never document bytes**. First slice built is the decision-independent
  one: `packages/pdf-core/src/workflow.ts` — `Workflow`/`WorkflowStep` plus
  `validateWorkflow`, which is deliberately in the engine so a recipe cannot be accepted by
  the browser pool and rejected by the queue. It rejects unknown slugs, empty/duplicate step
  ids, forward or cyclic input references, oversized recipes, and a step that needs a file no
  earlier step produced. Also re-measured the gate: the status board had been frozen at the
  pre-renderer-fix counts. Two things the new tests caught while being written: the registry's
  job slug is `split-in-half`, not `split-half` (my hand-written chainable list was wrong), and
  `JobSlug` is not a literal union at all — the registry builds its keys from
  `JobDefinition.slug: string`, so `keyof typeof JOBS` widens to `string | number` and a typo
  would type-check. `workflow.ts` therefore validates against a dependency-free slug list
  (`jobs/slugs.ts`) pinned to `Object.keys(JOBS)` by a test, which also keeps pdf-lib out of the
  main bundle when the builder UI lands. Gate now **193/193 unit** (19 new) · **83/83 E2E**.
  Detail in §18.
- **2026-10-08 — Surgical final pass.** Closed the three items the audit left open. Recent
  history was losing data outright: the trim cursor iterated the index oldest-first, so past
  `MAX_ENTRIES` it deleted the *newest* records including the one just written — the list
  froze at the 12 oldest and no new tool ever appeared again (proved with a 14-write probe:
  `["Tool 12"…"Tool 1"]`). Fixed by iterating newest-first, and removed the `indexedDB.open()`
  wait that navigation could kill. The `worker` container reported unhealthy forever because
  it inherited an HTTP healthcheck it has no listener for; it now overrides that in compose
  with a broker-reachability probe, and reports healthy. Plus a formatting defect in
  `runner.ts` that `tsc` could never catch. 5 files, +180/−70. Gates: 154/154 unit · **76/76**
  E2E · 21/21 API · 17/17 hardening · all three containers healthy. Detail in §15.
- **2026-10-08 — Audit remediation complete.** Full-repository audit → all P0/P1/P2 closed.
  7 P0s (split jobs returned a JSON stub not a ZIP; every server result named `output.pdf`;
  leaked job dirs on rejected uploads; duplicate page refs aliased one page dict; disjoint
  crop produced a blank page; the 500-page cap enforced by only 4 of 13 tools; cancelled
  jobs were retried to completion). 23 P1s (failure codes all collapsed to `internal_error`;
  `DELETE` answered `202` for finished jobs and leaked a cancel marker; janitor aged by
  creation time and could delete a backlogged job's inputs; per-process pepper wiped all
  tokens and quotas on restart; `TRUST_PROXY=true` let a client choose its own quota identity;
  Recent history frozen for the session; blob URLs minted in `useMemo`; hard text-break only
  on the first word; stamp ignoring CropBox/`/Rotate`; `split-in-half` cutting the wrong axis on
  rotated pages; and more). 3 P2s — chiefly that **29 of 64 E2E assertions asserted a literal
  `true`**, which is why the output-naming bugs survived three audits; all now assert real
  conditions. 49 files, +1438/−327. Gates: typecheck 3/3 · **154/154 unit** · **75/75 E2E** ·
  **21/21** API · **17/17** hardening · bundle 688 kB. Detail in §14.
- **2026-10-07 — P0 complete.** Scaffold, `pdf-core` (21 tests), web app, 3 live tools,
  mega menu + catalog, E2E suite (17 checks), bundle-size fix, initial commit `f16ae4e`.
  *Fixed en route:* missing Router, dropped pool options, JPG→JPEG format mismatch,
  range-parser setState-during-render, footer/breadcrumb polish.
- **2026-10-07 — P1 complete + repo public.** Pre-publish audit (secrets/PII/dangerous-sinks
  grep clean; Sejda reference screenshots untracked; transfer-list dedupe fix) → pushed to
  `github.com/dhruv-kashyap47/pdfshush`, tracking issue #1. Then: `composeDocument` +
  per-page rotation + crop, `stamp`/`split`/`nup` ops, 4 jobs, `usePageThumbnails` hook,
  **10 tools live** (Delete, Extract, Rotate, Split-by-pages, Mix, Split-in-half,
  Page Numbers, Crop, Header & Footer, N-up). Gates: 38/38 unit · 41/41 E2E · main
  bundle 632 kB with 0 pdf-refs. *Fixed en route:* crop-clamp math, deflate/hex text
  assertions, `endstream` regex slip.
- **2026-10-07 — P0+P1 code audit.** Line-by-line review found and fixed 8 defects: CropBox
  vs MediaBox in split-in-half, over-copying in `composeDocument`, revoked-too-early blob
  URLs in the thumbnails hook, empty-`pageOrder` stamping everything, single-file merge
  clobbering the source name, merge rows stuck on "reading…" after an abort, unsanitised
  stamp style values, and four leak/dead-code holes (IDB close, pool dispose, blob revoke
  timing, unwarned low-memory path). 8 regression tests added → 46/46 unit, 41/41 E2E.
- **2026-10-07 — P2 complete (editor).** Engine: display-space geometry verified against
  pdf.js for all 4 rotations ± cropbox, 11-object `edit` op (whiteout-and-overlay text,
  rotation-correct draws, `wrapTextToWidth`, save→strict-reparse→page-count export
  validation), AcroForm widget extraction/apply, text-run clustering, `edit` + `text-runs`
  jobs, `fields` on inspect output. Web: snapshot undo/redo (`lib/editor-state.ts`),
  editor toolbar/page/inspector (drag-create · move · resize · seed-replace · lazy
  per-page rasters + runs), form-value overlays, cross-pollination (`nextFor` chips +
  one-time local-processing toast), `edit-pdf` **LIVE as the 14th tool**. Gates: 72/72
  unit (26 new) · 50/50 E2E (11 new) · main bundle 676 kB with 0 pdf-refs. *Fixed en
  route:* inspect job dropping `fields`, stale `info` closure before raster pre-fetch,
  handle `stopPropagation` stranding window gesture listeners, arrow `reverse` never set,
  blob-URL churn while dragging inserted images, ambiguous file-input locator in E2E.
- **2026-10-07 — P2 surgical audit (post-ship).** Line-by-line pass over all 28 P2 files,
  informed by the GenOffice donor (`edit-state.ts` snapshot history, and its note that
  edits made *during* a save must not be dropped). **21 defects fixed**, 14 engine
  regression tests (72 → 86) and 10 E2E checks (50 → 60) added. Highlights: *state
  leak* — "start over" kept the previous document's objects and page indexes, so the
  next file would be annotated with the last one's overlay; *raster storm* — 20
  concurrent fetches, each holding a full copy of the source file; *no input
  validation* — NaN coordinates became NaN PDF operators and any image could exhaust the
  worker (this path becomes the public API in P6); *text jumped on save* — export
  baseline 1.0em vs the preview's 0.9465em; *main chunk +575 kB* — importing a metrics
  constant from a pdf-lib module pulled the whole library in (fixed with dependency-free
  `ops/textMetrics.ts`); *queue self-deadlock* caught by the new E2E. Also: repeated
  images re-embedded per object, widgets on cloned form pages landing on page 1, emptied
  dropdowns exporting stale values, `outputName` accepting `../../etc/passwd`,
  zero-width text items dropped, vertical watermarks breaking line clustering,
  per-page re-render storms, one undo step per font-size keystroke, stale selection after
  undo, thin objects nearly ungrabbable. Added: fit-width opening zoom, continue-editing
  after save, unsaved-changes guard, Ctrl+S / Ctrl+D, arrow-key nudge, z-order controls,
  text boxes that grow to fit, editing frozen during save.
  Gates: 86/86 unit · 60/60 E2E · main bundle 684 kB with 0 pdf-refs.
- **2026-10-08 — P3 started (server pipeline, first slice).** New `apps/api`:
  Express 5 + BullMQ 6 + Redis, reusing the *same* `JobDefinition` the browser
  runs. Decisions worth keeping: **PDF bytes never enter Redis** (payloads carry
  filenames; the worker derives directories from `WORK_DIR` + jobId, so a crafted
  payload cannot point it anywhere else); jobs run in **BullMQ sandboxed child
  processes** (CPU-bound pdf-lib would stall queue bookkeeping otherwise, and an
  OOM kills one job, not the worker); uploads **stream to disk** and stop at the
  byte cap; filenames sanitised and every path goes through `resolveWithin`;
  quotas key on a **peppered hash of the IP** (150/day, 6/min, 2 GB/day) with
  increment+expiry in one Lua script; ownership tokens are **derived** from the
  pepper rather than stored; a TTL **janitor** in both api and worker sweeps stale
  job directories, which is what makes the kill -9 gate achievable. New
  `pdf-core` entry `@pdfshush/pdf-core/node` exposes only the isomorphic surface —
  importing the browser barrel into Node would drag `OffscreenCanvas` types in and
  ship renderer code the server can never run. Gates: **134/134 tests (86 engine +
48 API)**, typecheck green in 3 packages, processor verified to load under
  `require()` and run a real job end to end. *Bugs its own tests caught:*
  multipart completion order scrambled merge input order, validation errors
  escaping untranslated, and a payload `inputDir` field that was redundant *and* a
  path hole.
- **2026-10-08 — Donor lessons applied.** Second pass over the Apache-2.0 GenOffice donor
  for techniques rather than features: pixel-budgeted raster sizing (a 2000 pt poster page
  was asking for an 88-megapixel bitmap, ~350 MB for one page), releasing bitmaps for pages
  far from view (the editor held every page it had ever scrolled past), refusing
  unencodable text instead of writing it mangled, atomic result writes, and resetting the
  nudge coalescer on undo. Also fixed the same load race in `usePageThumbnails` and a
  superseded-run state clobber in `useJobRunner`. See §13.- **2026-10-08 — Phase 3 surgical bug hunt.** Found and fixed the editor showing the previous document's pages (page-index-keyed raster/text-run caches with no document identity, so same-geometry PDFs hit each other's entries), plus the half-resolution rasters hidden behind it, JSON results served as `application/pdf`, an uncapped aggregate upload size, non-atomic rejected-upload cleanup, a failed save that silently disarmed the unsaved-changes guard, Ctrl+Z deleting text objects, and one undo step per held arrow key. Six new regression tests, each verified to fail with its defect reintroduced. See §12.
- **2026-10-08 — P3 complete; hardening gate passed.** Stack: `redis` + `api` + `worker`
  from one unprivileged image (`docker compose up -d --build`). API surface: `POST
  /api/jobs` (streaming multipart), `GET /api/jobs/:id`, `GET /api/jobs/:id/files/:name`,
  `DELETE /api/jobs/:id`, `/api/health`, `/api/tools`, `/api/quota`. **8 job slugs run
  server-side** (inspect, merge, organize, stamp, split-by-pages, split-half, n-up, edit)
  — rendering jobs and `text-runs` stay client-only until the server has a canvas or a
  pdf.js worker. *Hardening gate (`node tests/api/hardening.mjs`, 15/15):* a 220-page
  merge observed **active**, then `SIGKILL` on the worker container — the API never
  blinked, the job **settled as completed** (BullMQ retry + stalled detection), the
  janitor **removed the orphaned directory** (`jobDirs: 0`), Redis quota counters
  survived, and the restarted worker processed the next job. Ops knobs `FILE_TTL_MS` /
  `JANITOR_INTERVAL_MS` make retention tunable without a rebuild. Gates: **142/142 unit
  (88 engine + 54 API) · 62/62 browser E2E · 21/21 API integration · 17/17 hardening**,
  typecheck green in 3 packages, web bundle unchanged (684 kB, 0 pdf-refs).
  *Bugs the integration suites caught:* the janitor silently ignored its env config (the
  zod schema keys never landed, so every deployment would have used the 1-hour default —
  unit tests passed because they construct options directly); `inspect` was advertised as
  a server slug but its metadata-only result was rejected as "no deliverable output"
  (now serialised to `inspect-result.json`); and the runtime stage shipped `dist/` without
  the workspace `node_modules`, so every server-side import was unresolvable.

---

## 9. Resume cheat-sheet

```bash
pnpm install          # deps (Node ≥ 20.19, pnpm 11)
pnpm dev              # http://localhost:5173 (web app + API together)
pnpm typecheck        # strict tsc, all seven workspace projects
pnpm test             # vitest: pdf-core + api + ai-provider + ai-agent + web + mcp (1 528 tests)
pnpm test:e2e         # Playwright vs. running dev server (system Edge, 101 checks); E2E_BASE_URL=https://… runs it against a deployed origin
pnpm test:e2e:plain-tools # the ten plain tools end to end, magic-byte asserts (13 checks)
pnpm test:e2e:next-tools  # unlock, JPG→PDF, rename, Bates, split-by-text, compress (18 checks)
pnpm test:e2e:dark-mode   # Dark Mode PDF: preview pixels exact, download checks (8 checks)
pnpm test:e2e:deskew      # Deskew: +4° detection, output reopened and re-detected as straight
pnpm test:e2e:ocr         # OCR: real scan recognized on this origin, text read back, encrypted inputs
pnpm test:e2e:sign    # Fill & Sign flow end to end (17 checks)
pnpm test:e2e:text-edit  # the in-place text-edit flow (8 checks)
pnpm test:e2e:ai      # AI chat + highlight apply + in-place replacement + key handling (22 checks: 17 seeded + 5 keyless overlay)
pnpm test:e2e:ai-managed # managed trial via its own API on :8080 -- stop the Docker api container first (11 checks)
pnpm test:e2e:text-model  # structured text model + native paragraph edit (Select tool)
pnpm test:e2e:bookmark-batch # stamp, repair, combine, bookmarks, batch ZIP, image editor (29 checks)
pnpm test:e2e:forms-bookmarks # Create Forms + Create Bookmarks, downloaded bytes (49 checks)
pnpm test:e2e:offline    # production preview: manifest, CSP, service worker, offline merge (26 checks)
pnpm test:e2e:reach      # prerendered content, sitemap, robots, OG cards (production preview)
pnpm test:e2e:a11y       # axe WCAG 2.2 AA on the shell + tool routes (zero serious)
pnpm test:e2e:keyboard   # keyboard-only path through tool classes and the editor
pnpm test:e2e:verify     # the user-facing redaction verifier (needs `pnpm build` + preview)
pnpm test:perf           # Q3/Q7 ceilings against a production build (writes tests/benchmarks)
pnpm test:baseline       # product baseline: performance, a11y, crawler, corpus, network
pnpm test:bundle      # after `pnpm build`: entry chunk must carry no PDF engine
pnpm test:sweep       # responsive sweep (not a gate): overflow, reveal + size/contrast outliers
pnpm build            # production build (web + api bundles)
pnpm --filter @pdfshush/web build   # the Pages build; VITE_SITE_ORIGIN=<origin> VITE_SERVER_API=off for the deployed frontend
pnpm stack:up         # docker compose up -d --build (redis + api + worker)
pnpm stack:prod       # the deployed shape: --profile web --profile tunnel up -d --build (needs .env)
pnpm stack:down       # docker compose down (profiles included)
pnpm test:api         # 37 checks against a running stack on :8080 (21 without §6; set PSH_SMOKE_MONGODB_URI for the v1 key walk)
pnpm test:hardening   # 19 checks: SIGKILL a worker mid-job, prove the pipeline holds (recreate with FILE_TTL_MS=20000 JANITOR_INTERVAL_MS=5000)
pnpm --filter @pdfshush/mcp test        # parity + no-escape + spawned-stdio E2E (19 checks)
pnpm --filter @pdfshush/mcp dev         # run the stdio server locally against the stack
pnpm --filter @pdfshush/mcp build       # single-file dist/bin.js (bundled contracts)
```

CI (`.github/workflows/ci.yml`) runs typecheck, `pnpm test`, `pnpm build` and `pnpm test:bundle`
on every push and pull request. It deliberately excludes the gates that need Docker/Redis --
`test:api`, `test:hardening` and the browser suites -- so a green CI run is **not** a claim
that those passed.

Docker Desktop's CLI is **not on the session PATH** by default — a per-user install lands in
`%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe` (no shell expands `$env`).
Either prepend that directory or set `$env:DOCKER_BIN` (the gate script honours `DOCKER_BIN`).
Run the gate with short
TTLs so the janitor sweep is observable inside the run — **the test process must wear the same
TTL the stack wears**, or its wait budget under-runs the container's window (the gate itself also
refuses to run unless `/api/health` reports `retentionMs <= 120000`):
`$env:FILE_TTL_MS=120000; $env:JANITOR_INTERVAL_MS=10000; docker compose up -d --build` then
`node tests/api/hardening.mjs`. The suite reads `retentionMs` from `/api/health` (the shell that
runs it may not be the one that started the stack) and, after SIGKILLing the worker, explicitly
runs `docker compose start worker`: `compose kill` marks the container stopped on purpose, so the
restart policy cannot resurrect it and the summary line would otherwise hide a worker that never
came back. With a TTL that short the janitor can also delete a *queued*
job's inputs — which is why the killed job may legitimately settle as `failed`; the gate
accepts either outcome, because the claim being tested is "the queue recovers". Note also that
back-to-back quota-consuming runs (smoke → hardening) leave the anonymous day counters partially
spent — `docker compose restart redis` resets them. *(2026-10-18 addendum: Docker's server **is**
on PATH now — `docker compose up -d --build` works directly from the session.)*

**Next move:** **finish M6.1 by publishing the frontend on Cloudflare Pages and running the §33.4
gate against `https://pdfshush.space`** — the domain exists, the build is verified locally
(`VITE_SERVER_API=off` + `VITE_SITE_ORIGIN`), and the Pages configuration is documented in
`docs/DEPLOY.md` §3; what remains is the Cloudflare account, the Pages project and the gate
itself. The **server tier is parked** (§33.11): the API, the BullMQ worker, Redis and MongoDB stay
in the repository and in `docker-compose.yml` for local development, and every server-backed
surface is switched off in the deployed build rather than left to fail. **M6.3's global budget
breaker** is the one M6 item that can start now. The remaining P7.1 edges (10k-page, broken-font
and linearized fixtures) and the containerised `test:api`/`test:hardening` gates are the only open
hardening checks; P7.2 and P7.3 were absorbed by M5.5/M5.6.
**P7.0 — the reconcile pass — shipped 2026-10-25** (§8 top entry): L1/L2 CSRF, bounded `options`,
L5 result types, L7 input-token reservation, L8 cross-instance AI lock, CI, and the doc counts.
The 2026-10-28 dark-mode batch (§8) took the catalog to 49 of 58 live entries and the engine to
315 tests with its own 8-check E2E; the 2026-10-27 security batch left it at 48 of 57 with 301
tests and a 36-check E2E; the 2026-10-26 authoring batch left it at 47 with 293
tests, the 2026-10-25 bookmark batch at 45 with 267 tests,
the 2026-10-21 next-tools batch at 38 with 251 tests, and the 2026-10-20 plain-tools batch added
ten more plus the first dedicated tool suite.
**P6.4, the hardening pass, has shipped** (§25.5: rotation drill, v1 multipart-sniff matrix,
the base-URL smuggle class fixed and pinned, SSRF/signing reviews recorded); **P6.3, the MCP
server, shipped** (`@pdfshush/mcp`, §25.4): stdio server over `/api/v1` with the user's own key,
one tool per server-runnable slug built from `@pdfshush/api-contracts`, `pdfshush://tools` +
`pdfshush://guide/<slug>` resources, `/tools/mcp` docs page live, attribution in
`licenses/pdfshush-mcp-donor-NOTICE.txt`. R1 has shipped — secure
redaction is live as `redact-pdf` (§20), verified on
the exported artifact, with the browser E2E asserting the downloaded bytes. R2 (native text-level
redaction) stays deliberately deferred until R1 is proven in production (§20.3), and **P4.4**
(automated triggers) stays gated on the SSRF/scheduling design (§18.5).
One live gate limitation: `test:api` and `test:hardening` need a running Redis + Docker stack. **Since the worker-loader fix
(§8) this is no longer hypothetical**: bring up the compose with `docker compose up -d --build` and
`/api/health` should report `"status":"ok"` with a non-zero `workers.count` before trusting any
server-side E2E. The smoke's **section 6** exercises `/api/v1`: without accounts enabled it
asserts the `503 auth_disabled` stance + public spec; with `PSH_SMOKE_MONGODB_URI` (and optional
`PSH_SMOKE_MONGODB_DB`) set to the stack's own Mongo it seeds an account + session exactly the way
the AuthStore would (SHA-256 `_id`s — no Google round trip, no test back door in the app) and walks
key → catalog → inline submit → poll → download → revoke → invalid-verdict on the real stack
(verified 2026-10-18 against Docker + Redis + worker + Atlas; re-verified 2026-10-19 after the
api-contracts extraction added the esbuild-alias/COPY treatment to the API image). The MCP
server's env: `PDFSHUSH_API_KEY` (required), `PDFSHUSH_API_URL` (default
`https://api.pdfshush.com`; http refused outside loopback unless `PDFSHUSH_ALLOW_HTTP=1`),
optional `PDFSHUSH_POLL_INTERVAL_MS`/`PDFSHUSH_POLL_TIMEOUT_MS` for the tests. Then append
a changelog entry and tick §1. Before every
push run the **pre-push
grep** over tracked/changed files: (1) secret-key patterns (API keys, PEM blocks, cloud
access keys), (2) local username or machine-path markers, (3) dangerous sink APIs —
HTML-injection helpers, dynamic code evaluation, shell exec (`redis.eval` is ioredis Lua
with constant scripts — documented inline; `tests/api/hardening.mjs` uses
`execFileSync` with fixed argv to SIGKILL a container — documented inline). All three
must come back empty.

**A skipped check is not a passing check.** The workflow section of the browser suite skips itself
whenever `/api/tools` is unreachable, which is exactly how a broken server pipeline stayed
invisible until §8's second entry. It now also skips the *run* when `/api/health` reports Redis
down — an honest skip, not a pass: a plain `pnpm dev` without Docker leaves that path unverified,
so run `pnpm test:e2e` against the compose stack before trusting a release. When a gate
self-skips, treat the skipped path as *unverified*, not as covered.

**E2E notes.** `tests/support/e2e-util.mjs` holds the shared fixtures (`buildPdf`,
`extractText`, `waitFor`). The AI scripts run against `tests/support/mock-llm.mjs`; the
managed one additionally boots `apps/api/test/support/managed-server.ts` with
`node --import tsx` from `apps/api` (in-memory quota counters, no Redis/Mongo) and points the
trial at the mock via `AI_MANAGED_BASE_URL`, so `pnpm test:e2e:ai-managed` needs only
`pnpm dev` running. With no API up, the app's own `/api/*` probes fail; the scripts tolerate
exactly those *resource-load* failures and still fail on any real console error.

---

## 10. P2 sign-off (2026-10-07)

**Engine (`packages/pdf-core`)**
- `ops/geometry.ts` — display space (top-left origin, y down, `/Rotate` applied, CropBox
  respected); verified against pdf.js `getViewport` for rotations 0/90/180/270 ± cropbox.
- `ops/edit.ts` — 11 object kinds (text, image, rect, ellipse, line, arrow, highlight,
  strikeout, underline, whiteout); every draw maps display→PDF so rotated pages match the
  UI; `wrapTextToWidth` against the embedded font; `validateEditObjects` (unknown-kind +
  id checks); **export validation** = save → strict `PDFDocument.load(throwOnInvalidObject)`
  → page-count match (`expected N pages, found M`, else `Export validation failed`).
- `ops/forms.ts` — widgets carry display-space `rect`s, radio `option`/boolean `value`,
  option lists; `applyFormValues` throws `Form field "X" does not exist` for unknowns.
- `render/textRuns.ts` — runs with `horizontal` + baseline `line` key (fixes interleaved
  line grouping); fragment join gap ≤0.15em; same-line = cross overlap ≥60% + gap ≤0.8em.
- Jobs: `edit` (slug `edit`, `LIMITS.tool.maxEditObjects` = 2000, output
  `<stem>-edited.pdf` or `outputName`) + `text-runs`, both registered; `inspect` output
  now includes `fields`.
- Tests: `test/editor.test.ts` — **26 new → 72/72 total** (geometry vs pdf.js, rotation
  drawing, form round-trip, job contract, export validation failures).

**Web (`apps/web` — no test runner; interaction covered by E2E)**
- `lib/editor-state.ts` — snapshot undo/redo: `past`/`future` stacks, `live` for in-flight
  gestures, `beginTx`/`endTx` wrap a drag or a text-editing session into one undo step.
- `components/editor/` — toolbar (Edit / Insert / Annotate groups, zoom 50–200%, undo/
  redo/delete/save, `tool-*` testids), page (raster + DOM overlay: drag-create with ghost,
  move, corner resize, textarea editing, whiteout-seed on run click, window-level gesture
  listeners with blur safety, IntersectionObserver lazy rasters), inspector (font size,
  bold, align, colors, stroke/fill/width — discrete edits = one undo step each).
- `edit-pdf-tool.tsx` — dropzone → capacity check → inspect → eager rasters (first 20
  pages, `thumbnails` job at `displayWidth × zoom × dpr`) + lazy per-page + lazy
  text-runs → edit → `edit` job save → ResultPanel (validated-download note).
- Cross-pollination: `edit-pdf` **LIVE (14th tool)**, `nextFor()` map in registry,
  chips rendered in `ResultPanel` via `ToolSlugContext`, one-time-per-session
  `announceLocalProcessing()` toast (`lib/privacy.ts`).

**Gates:** typecheck ✓ · 72/72 unit ✓ · build ✓ (main chunk 676 kB, **0** pdf-lib/pdf.js
refs) · 50/50 E2E vs system Edge ✓ (11 new editor checks: raster, text create+type,
highlight drag, undo/redo, delete+undo, validated export bytes, chips — zero console
errors) · pre-push grep ✓.

### Post-ship audit (same day)
Re-reviewed every P2 file against the GenOffice donor. 21 defects fixed (see the §8
changelog entry for the list). Engine now validates untrusted object input before drawing
anything, dedupes repeated images, attributes widgets via `/P`, and shares its text
metrics with the UI through a dependency-free module. The editor resets its document on
"start over", fetches rasters through a bounded queue, memoizes pages, and freezes edits
during a save. Gates after the audit: **86/86 unit · 60/60 E2E · main chunk 684 kB with
0 pdf-lib/pdf.js refs**.

---

## 11. P3 sign-off (2026-10-08)

**Delivered** — `apps/api` + a Docker topology, reusing the browser's job contract.

| Concern | How it is met |
| --- | --- |
| Same contract, two runtimes | `JobDefinition` from `@pdfshush/pdf-core/node` runs in Node unchanged; the browser barrel stays browser-only (it needs `OffscreenCanvas`) |
| No bytes in the queue | Payloads carry filenames; the worker derives `WORK_DIR` + jobId, so a payload cannot point it anywhere else |
| CPU isolation | BullMQ **sandboxed processor** (CommonJS child process) — pdf-lib cannot stall the worker's event loop or its stalled-detection |
| Quotas | 150/day · 6/min · 2 GB/day on a peppered SHA-256 of the IP; `INCR`+`EXPIRE` in one Lua script; rejected calls still consume budget |
| Ownership | Tokens derived from the pepper, not stored — nothing to keep or leak |
| Files | Streamed to disk with a byte cap; names sanitised; every path through `resolveWithin` |
| Cleanup | TTL janitor in **both** api and worker — whichever process survives the crash sweeps |
| Ops | `FILE_TTL_MS` / `JANITOR_INTERVAL_MS` tune retention without a rebuild; structured logs; `/api/health` exposes queue depth + work-dir usage |

**Hardening gate — `node tests/api/hardening.mjs` (15/15, this is the P3 exit criterion)**
1. A 220-page merge is observed **active**, then the worker container takes `SIGKILL`.
2. The API never stops answering; the killed job **settles as completed** (retry + stalled
   detection) instead of hanging in `active`.
3. The crash leaves files behind, and the **janitor removes them** (`jobDirs: 0`) — the
   mechanism is deletion by the survivor, not by the victim.
4. Quota counters survive in Redis; the restarted worker processes the next job.
5. All containers are running again afterwards.

**Gates (as re-measured by the Phase 3 audit in §12):** typecheck ✓ 3 packages ·
**142/142 unit** (88 engine + 54 API) · **62/62** browser E2E · **21/21** API
integration (`node tests/api/smoke.mjs`, real PDFs → Redis → sandboxed worker → bytes on
disk → verified download) · **17/17** hardening · web bundle 685 kB with 0 pdf-lib/pdf.js
refs · pre-push grep clean.

**Known limits, deliberately not hidden**
- Server-side slugs are the 8 pdf-lib-only jobs; rendering (`thumbnails`,
  `pdf-to-images`) and `text-runs` need a canvas or a pdf.js worker the server lacks.
- One image runs both roles via entry point; a production deployment should scale
  `worker` replicas and give Redis a real volume rather than the default.
- Rate limits are per-IP-hash with no distributed session; a shared NAT can exhaust a
  budget. P4's accounts replace the hash with a real subject.
- Heavy binaries (Ghostscript, qpdf, LibreOffice, OCRmyPDF) are *not* wired yet — that is
  the next slice, and it is what unlocks compress/OCR/Word conversion.

---

## 13. Donor lessons applied (2026-10-08)

A second pass over the GenOffice donor (`genspark-ai/genoffice`, Apache-2.0), this time
reading for *techniques* rather than features. Five adopted, four deliberately not.

### Adopted

1. **Pixel-budgeted raster sizing** (`PdfPage.tsx`, donor). Capping the device-pixel-ratio
   at 2 is not a memory bound: a 2000 pt-wide poster page at 200% zoom on a hi-dpi screen
   asks for 8000 × 11000 = 88 megapixels, about 350 MB for **one** page. Now the width is
   derived from a 12-megapixel area budget (`sqrt(MAX_PX / (w·h))`), so large-format
   documents render at a lower scale instead of crashing the tab.
2. **Release bitmaps for pages far from view** (`PdfPage.tsx` `useVisibleSet`). The editor
   kept every page it ever scrolled past: ~9 MB of decoded RGBA each once decoded, so a
   500-page document was a guaranteed crash. The page observer now reports both entering and
   leaving, and an eviction pass keeps a 12-page window around the viewport, pinning pages
   that carry overlay objects or cached text runs.
3. **Verify the output, and refuse rather than mangle** (`save-pdf.ts` `verifyTextEdits`).
   `drawText` into a WinAnsi standard font does **not** throw on characters it cannot
   encode — it writes them mangled, so the user got "saved, 3 pages" and only later found
   their name had become mojibake. Text objects are now validated against WinAnsi before
   anything is drawn, with the offending code point named in the error.
4. **Atomic result writes** (`atomic-write.ts`). `writeResult` streamed straight to the
   final path, so a crash or full disk left a truncated PDF sitting where the janitor would
   keep it for an hour and a caller could download it as a corrupt "successful" export.
   Now written to a sibling temp file and `rename`d into place: a result is either absent
   or whole.
5. **Coalesce-key reset on undo** (`App.tsx` `pushUndo`). The nudge coalescer held its own
   open-transaction flag that `editor.undo()` knew nothing about, so undoing mid-burst left
   it set and the *next* nudge — possibly seconds later — took the `live` path with no open
   snapshot and became an un-undoable move.

### Deliberately not adopted

- **`chainPdfium` mutex** — real, but we have no WASM heap; the equivalent hazard (shared
  mutable state across concurrent jobs) does not exist in pdf-lib.
- **Save-queue + `SavedSnapshot` subtraction** — their bug is "edits made during a save are
  silently discarded". Ours is already immune for a different reason: `readOnly` freezes the
  document for the duration of a save, so no edit can exist that the snapshot missed. Worth
  remembering if a future feature allows editing during a save.
- **Per-`webContents` path grants** — Electron-only. Our equivalent boundary is
  `resolveWithin` plus a sanitised basename, which the P3 audit already exercised.
- **Font subsetting / OCR / redaction layers** — P5/P6 features, not bug fixes.

### Also fixed while in there

- **`usePageThumbnails` had the same load race I fixed in the editor**: a superseded
  `prepare()` could install its tiles and file list over the newer request, so the grid
  could show pages from a document that was no longer loaded. Guarded by the same
  monotonic-sequence pattern.
- **`useJobRunner` let a superseded run clobber the current one**: starting job B aborts
  job A, and A's abort handler wrote `{status:'idle'}` over B — hiding B's progress panel
  while it was still running. State writes are now scoped to the run that owns them.

**Gates:** typecheck ✓ 3 packages · **142/142 unit** (88 engine + 54 API) · **62/62** browser
E2E · **21/21** API integration · **17/17** hardening · web bundle 687 kB, 0 pdf-lib/pdf.js
refs · pre-push grep clean.

---

## 12. Phase 3 surgical bug hunt (2026-10-08)

An end-to-end audit of the whole Phase 3 codebase, driven by reproducing in a real browser
rather than by reading. The headline defect was the editor, and it was worse than "renders
slowly".

### The critical bug: the editor showed the wrong document's pages

**Symptom.** "Change file" from one PDF to another left pages of the *previous* file on
screen — including the object overlays, which belonged to the document the user had just
discarded.

**Root cause.** Rasters and text runs are cached in `Record<pageIndex, …>`, keyed by page
index alone, and `ensureRaster` treated "a cached bitmap within 25% of the width I want"
as *the right document's page*. Page geometry is not a document identity: virtually every
PDF is A4 or Letter, so page 1 of the new file satisfied the cache test against page 1 of
the old one and was never re-rendered. Text runs had the same lifetime problem, so
"click this line to replace it" would have quoted the old file's text into the new one.

**Fix.** Cache entries are now scoped to a *document generation*, bumped whenever the source
document changes (new file, start over, unmount). Every async raster/text-run request
captures the generation it started under and discards its result if the document moved on
mid-flight — without that, swapping files while pages were rendering painted the old
document back over the new one. Caches are dropped at the same moment, which also releases
the blob URLs.

**A second bug hid behind the first.** The opening fit-width zoom is applied in a *layout*
effect, which runs before the eagerly requested rasters come back. The re-request-on-zoom
effect therefore iterated an empty cache and did nothing, and a request that arrived while
a page was already rendering was rejected as "already pending" with no retry — so every
eager page kept its initial, half-resolution bitmap for the rest of the session. Fixed by
recording the *requested* width and re-checking a page when its render completes. That
check immediately exposed a third bug in the fix itself: recording the request at *enqueue*
time made a bounced page believe it had been drawn, and it never rendered at all. The
marker now moves to the point where the render actually starts, which also bounds the
reconciliation loop.

Rendering the first page of a 3-page file went from ~10 s of churn (double renders) to
0.5 s with every page at full resolution.

### Everything else found and fixed

| # | Defect | Fix |
| --- | --- | --- |
| 1 | Every result downloaded as `application/pdf` — including `inspect-result.json`, which is JSON | Content type derived from the stored extension, with an allowlist |
| 2 | Per-file upload cap but **no aggregate cap**: one anonymous POST could write 50 × 500 MB to disk before any quota was charged | Shared byte counter across concurrent file streams, aborting mid-flight; the partial file is destroyed, not written |
| 3 | Rejected uploads cleaned up fire-and-forget, so a caller that immediately retried raced its own leftovers | Cleanup awaited before the response is sent |
| 4 | A **failed** save marked the document saved up front, silently disabling the unsaved-changes guard | The baseline advances only on a successful write, and only if the same file is still open |
| 5 | Ctrl+Z inside a text box ran *document* undo. Text edits use `live` (no history entry), so it skipped the keystrokes and deleted the whole object | Typing keeps native undo; Ctrl+S still saves |
| 6 | Every arrow-key repeat was its own undo step, burying real edits under dozens of 1-point nudges | Nudge bursts coalesce into one transaction |
| 7 | A superseded file selection could install the slower request's results | Monotonic load sequence; a stale response is dropped |
| 8 | Per-page render failures toasted once *per page* — up to 500 toasts on a large document | Aborts are no longer reported as failures |
| 9 | `docker compose up -d` does not recreate a container whose command is unchanged, so the hardening gate failed for invisible reasons while running on the 1-hour default TTL | Retention published in `/api/health`; the gate now refuses to start unless the TTL is actually short |

### Regression tests

Each fix is pinned by a test that **fails without it** — verified by reintroducing the
defect and watching the check go red, not by assertion that it should:

- swap documents → blob-URL comparison proves every page re-rendered (red: *"2/2 pages
  still showed the previous document"*)
- Ctrl+Z while typing → the text object must survive
- nudge burst → one undo restores the exact pre-burst position
- request-level upload cap → 413 and nothing left on disk
- JSON result → correct content type
- expired result → 404 instead of a reset socket

**Gates:** typecheck ✓ 3 packages · **142/142 unit** (88 engine + 54 API) · **62/62** browser
E2E · **21/21** API integration · **17/17** hardening · web bundle 685 kB, 0 pdf-lib/pdf.js
refs · pre-push grep clean.

---

## 14. Audit remediation sign-off (2026-10-08)

A full-repository audit (all 4 packages, not a sample) produced a P0/P1/P2 list. Every item
is closed; each behavioural fix is pinned by a test proven red without it.

### The seven P0s

| # | Defect | Fix | Proof |
| --- | --- | --- | --- |
| 1 | `split-in-half` / `split-by-pages` returned a **156-byte JSON stub**, not the ZIP | `runner.ts` output visitor reads `record.zip` under `record.zipName` | API integration downloads a real ZIP |
| 2 | merge / n-up / stamp / organize all downloaded as `output.pdf` | visitor also accepts `record.fileName` and `record.name` | E2E asserts the exact filenames |
| 3 | a request rejected at the content-type check left an empty job dir forever, unmetered | dir created after every fail-fast check; `removeJob` on **all 5** failure paths incl. enqueue failure | `jobDirs === 0` after every reject |
| 4 | duplicate page refs shared one page dict — `[90,270]` became `[270,270]` | each repeat gets its own `copyPages` clone | engine suite |
| 5 | a crop box fully outside the page produced a **blank page** | disjoint rect now raises *"The crop area does not overlap the page"* | engine suite |
| 6 | the 500-page client cap was enforced by **4 of 13** tools | second capacity pass after inspect in every tool; `split-in-half` gained an inspect | E2E: 501-page fixture refused, 3-page accepted |
| 7 | a cancelled job was **retried and ran to completion** (`attempts: 2`) | `UnrecoverableError` when the abort signal fired | processor suite |

**Deliberately not done:** rejected uploads are still not charged quota. With #3 fixed nothing
reaches disk, so there is no resource to meter, and charging task quota would penalise a user
for a typo — a product decision, not a bug.

### The P1s

- **Job failure codes were lost.** Every failure reached clients as `internal_error`, making
  the whole `JOB_ERROR_CODES` map unreachable. Added `formatFailure` / `parseFailure`
  (one wire format, both ends) and `CancelOutcome` (`removed`/`running`/`finished`/`unknown`).
- **`DELETE /api/jobs/:id` answered `202 "cancelling"` for a job that had already finished**,
  telling the caller to keep polling for a change that could never come — and writing a cancel
  marker nothing would ever clear. Now `200` / `202` / `404` / `409`.
- **The janitor aged jobs by creation time** and never swept `control/`. Now ages by mtime,
  sweeps orphaned cancel markers, and takes an `isLive` predicate so a **backlogged job's inputs
  can no longer be deleted underneath it** (wired in both `server.ts` and `worker/host.ts`).
- **The pepper was random per process**, so every restart invalidated all job tokens and reset
  all quotas. Now persisted at `work/control/pepper` (mode 0600, written `wx`).
- **`TRUST_PROXY=true` trusted every client-supplied `X-Forwarded-For`**, letting anyone pick
  their own quota identity. Now a hop count (0–10).
- **`EMBEDDED_WORKER` unset became `false`**, so its environment-dependent default never ran.
- Duplicate upload names no longer overwrite each other (`-2`, `-3`); the `options` field is
  refused **with its real size** instead of being truncated at 8192 and blamed as bad JSON;
  bad multipart is a 400, not a 500; unused `CORS_ORIGINS` removed.
- Engine: hard text-break now applies to *every* line (was first-word only); stamp honours
  CropBox and `/Rotate` and its `clamp` is NaN-safe; `split-in-half` cuts in display space so
  "left/right" on a `/Rotate 90` page is really left/right; `geometry.ts` normalises box corners
  *before* intersecting; a rect with neither fill nor stroke draws nothing instead of a black
  box; `createZip` dedupes entries; `stripExtension(baseName(...))` no longer double-strips
  `report.final.pdf`; one shared `safeOutputName`; a failed pdf.js load releases its worker;
  oversized renders are refused up front.
- Web: **Recent history never refreshed** — `useRecent` read IndexedDB once on mount while the
  header is a persistent layout component, so the menu stayed empty for the whole session.
  Added a subscription the store notifies on write.
- Web: `createObjectURL` moved out of `useMemo` into an effect. `useMemo` may discard its value
  (StrictMode double-invoke, a re-render before commit) and only the *committed* URL was ever
  revoked, leaking one per discarded render.

### The P2s

- **29 of 64 E2E assertions asserted a literal `true`**, passing only because a preceding
  `waitFor` had thrown — which is precisely why the output-naming bugs survived three rounds.
  **All 64 now assert real conditions**, and the suite grew to **75 checks**.
- Unit coverage added for the failure-code round trip and the liveness predicate.
- `DELETE /api/jobs/:id` had **zero** coverage (the only `.delete(` in the suite was inside the
  fake). Now 5 tests over all four outcomes.

### Two corrections to the audit itself

- `pdf-to-images-tool` **already enforced** the page cap; the original grep reported only the
  first of its two `checkClientCapacity` call sites. Real count was 8 tools, not 7.
- All **three** grid tools (not two) shared the `-organized.pdf` fallback, because all three run
  the same `organize` job.

### Known issues left open

- ~~The `worker` container reports unhealthy forever~~ — **fixed**, see §15.
- ~~Recent-history writes can be lost~~ — **fixed**, see §15.

**Gates:** typecheck ✓ 3 packages · **154/154 unit** (88 engine + 66 API) · **76/76** browser
E2E · **21/21** API integration · **17/17** hardening · web bundle 688 kB with 0 pdf-lib/pdf.js
refs in the main chunk · pre-push secret/PII/dangerous-sink grep clean.

---

## 15. Surgical final pass (2026-10-08)

The three items §14 left open, closed. Nothing else was touched.

- **A formatting defect in `runner.ts`.** `}` and the next `if` had been collapsed onto one
  line by an earlier scripted edit. Valid JS — `tsc` accepts it, which is why it survived —
  but it read as corruption. Split back onto two lines; statements byte-identical. A sweep of
  every `.ts/.tsx/.mjs` in the repo for the pattern now returns zero hits.
- **The worker reported permanently unhealthy.** The image's `HEALTHCHECK` curls
  `/api/health`, which only `server.js` serves; `worker-host.js` opens no HTTP listener, so
  the inherited probe could never pass. The worker service now overrides it in compose to
  probe what that process actually depends on — Docker only runs a probe on a live container,
  so the open question is broker reachability, via `ioredis` (already a production
  dependency). Verified to exit 0 when reachable and 1 against a dead port. **No worker code
  changed** and the API's own check is untouched.
- **Recent history lost entries.** Probing 14 sequential writes showed the real defect was
  worse than "a write racing navigation": the trim cursor used
  `IDBKeyRange.upperBound(createdAt, false)`, which iterates **oldest → newest**, so once
  there were more than `MAX_ENTRIES` records the deletion fell on the *newest* ones —
  including the record just written. The list froze at the 12 oldest and no new tool ever
  appeared again. Fixed by iterating `'prev'`. Also removed the `indexedDB.open()` wait
  before each write (one shared, never-closed connection; writes serialised), which is the
  window a navigation could kill. Exported signatures and all 13 call sites unchanged, so the
  UX is identical.

  Regression test — *"a history write survives navigating away immediately"* — runs merge,
  navigates away the instant the result lands with no grace period, and asserts the newest
  Recent entry is that tool. Deliberately the last thing recorded in the suite, so more than
  `MAX_ENTRIES` writes have already happened: it pins the trim **and** the navigation race.
  Proven red before the fixes (newest entry was a stale `Header & Footer`).

**Still open (deliberate):** Recent writes stay fire-and-forget. The trim bug and the
open-latency race are gone, so entries now survive navigation and the cap behaves, but a
browser that hard-kills the tab mid-transaction could still drop one. Making it durable needs
awaiting the write or an unload flush — both change UX, so neither was done.

**Gates:** typecheck ✓ 3 packages · **154/154 unit** · **76/76** browser E2E · **21/21** API
integration · **17/17** hardening · bundle 688 kB, 0 pdf-lib/pdf.js · all three containers
**healthy** (api, worker, redis) · `/api/health` ok · pre-push grep clean.

## 16. Raster pipeline: pages with images never rendered (2026-10-09)

Reported from the field: the editor opened, the canvas stayed blank, and the console showed
`Could not render page 2` / `Could not render page 3`. Read-only diagnosis first, then the fix.

### The crash

`loadPdfForRender` calls pdf.js `getDocument()` **without a `CanvasFactory`**. pdf.js is not
content to draw onto the canvas we hand it: image downscaling, soft masks, tiling patterns,
shadings and transparency groups all ask its canvas factory for scratch space. It defaults to
`DOMCanvasFactory`, built from `src.ownerDocument || globalThis.document` — and inside a Web
Worker that is `undefined`. It is a *property* read, not a bare identifier, so there was no
`ReferenceError`; the first scratch canvas of a page painting an image simply threw:

```
TypeError: Cannot read properties of undefined (reading 'createElement')
    at DOMCanvasFactory._createCanvas
    at CanvasGraphics._scaleImage
    at CanvasGraphics.paintInlineImageXObject
```

Proven causally, not just correlated: same PDF, same worker, only the factory differing —
pages 2 and 3 (the two named in the report) go FAIL → OK. A/B across 8 PDFs: every
text/vector-only PDF was fine, and `27-09-proposal.pdf` failed p1 but passed p2, so the failing
set is per-page and follows the image content, not the file.

The fix is `PdfjsCanvasFactory` in `render/canvas.ts`, passed to **`getDocument`**. Not
`page.render`: `PDFPageProxy.render` hard-codes `canvasFactory: this._transport.canvasFactory`
(pdf.js `13410`), so a per-render argument is silently ignored — it is a *constructor*, too, so
passing an instance fails with "is not a constructor". Guarded on `hasOffscreenCanvas()` so Node
keeps pdf.js's `NodeCanvasFactory` and the unit tests are unaffected.

**`DOMFilterFactory` was checked, not assumed.** It carries the identical hazard
(`ownerDocument = globalThis.document`), so it was instrumented rather than assumed safe: across
9 PDFs — image-heavy, alpha/soft-mask, scanned — display rendering only ever calls its base
`destroy`. Every DOM-touching method is a colour-management/selection path we never take. Left
alone deliberately: a no-op filter factory would silently drop filter effects, a worse failure
than a loud one. Revisit if print intent or selection styling lands.

### The blank pages were also a units bug

Independently, `rasterWidthPx` compared `sqrt(MAX_RASTER_PIXELS / (widthPt * heightPt))` — a
**scale** in px-per-point — against `widthPt * zoom * dpr`, a **width** in pixels. `min()` always
picked the budget number, so every page was asked to render ~7px wide; `scaleForWidth`'s 0.05
floor turned that into a **29×42px** bitmap stretched across an 891px column. Measured in the live
app before the fix. A 29px page still satisfies "the raster `<img>` exists", which is precisely
why the suite never noticed. The clamp now caps the *scale* and converts to a width
(`rasterWidthWithinBudget`, in the engine so it is unit-testable and has one owner), keeping the
12 MP budget intact — area stays within budget at any aspect ratio, and high-DPR cannot inflate
it because `RASTER_SCALE` already caps at 2.

### Why it shipped

Every PDF in the repo is text and vector: all five E2E fixtures have `/Subtype /Image = 0`, so
pdf.js's scratch-canvas path was never reached. `editor.test.ts` is the only test that called
`loadPdfForRender`, and it asserted **viewport geometry only** — it never called `page.render()`.
The E2E asserted `editor-page-raster` **count**, and its one deliberate pixel comparison was
replaced with a blob-URL identity check ("a pixel comparison would pass on two blank white
pages"), which removed the last signal that could have caught either defect. Node cannot catch it
either: `isNodeJS` makes pdf.js pick `NodeCanvasFactory`, so 154 unit tests were structurally
incapable of failing.

`tests/e2e/fixtures/imaged.pdf` is now the first fixture with images in it — p1 text/vector
only, p2 an opaque image downscaled, p3 an alpha image (soft mask + downscale). The images are
1600×1200 painted into 180×135pt, so the downscale holds at every zoom the editor can reach and
the test cannot pass by accident. It needed a `.gitignore` change to be committable at all:
`tests/e2e/fixtures/` was ignored wholesale, so **no fixture was ever tracked** and the browser
E2E could not run on a clean clone. Narrowed to `fixtures/*` with a negation for `imaged.pdf`
alone; the other fixtures keep their existing ignored status, undecided.

### Why it was invisible

Two places dropped the cause: `serializeError` returned `{name, message}` with no `stack`, and
the editor's `catch` discarded even the message. `serializeJobError` now lives in the engine next
to the error classes (where it can be tested) and carries a 4 kB-trimmed stack, which
`job-pool` restores onto the reconstructed `Error`. The toast stays one short line; the console
gets the cause. Stirling-PDF's `reportThumbnailFailure` logs the failing cause for the same
reason — their note that an empty thumbnail is indistinguishable from "no preview" is the
accurate description of this bug.

### Lifecycle

A failed page was **poisoned for the session**: the requested-width marker was written before the
job ran, so the `finally` re-check saw it as satisfied and nothing ever asked again. Failures are
now counted, the marker cleared so a later zoom or scroll-into-view can retry, and the count caps
retries at 2 so a page that reliably fails cannot loop.

Clearing the marker alone was **not** enough, and the first attempt at this shipped a comment
that was simply false: the zoom pass iterates the raster *cache*, and a page that never produced
a bitmap is not in it, so nothing ever re-asked. Instrumenting it with the fix switched off
showed a single `attempt 1/2` per page and no retry at all. The pass now also walks the pages
that failed and are still under the cap. Re-measured with the fix off: pages 2 and 3 record
`attempts 1, 2` and stop — two each, no page over the cap, four logs total. With the fix on, zero.
It cannot spin: a failure leaves `rasters` untouched, so it does not re-trigger the pass.

**Gates:** typecheck ✓ 3 packages · **172/172 unit** (18 new) · **83/83** browser E2E (7 new) ·
**21/21** API integration · **17/17** hardening · main chunk 688.59 kB · all three containers **healthy** · pre-push grep clean.

### Standard font and CMap hosting

Standard fonts (`FoxitFixed`, `FoxitSerif`, etc.) and binary character maps (`.bcmap`) are now hosted
under `apps/web/public/standard_fonts/` and `apps/web/public/cmaps/`, served statically and copied on build.
`job-worker.ts` injects their URLs into `configurePdfjsRuntime({ cMapUrl, standardFontDataUrl })`, and
`pdfjsRuntime.ts` explicitly sets `useWorkerFetch: true` when either is supplied. This resolves the
`Warning: UnknownErrorException: Ensure standardFontDataUrl API parameter is provided` notices, prevents
`document.baseURI` ReferenceErrors inside the worker, and fixes missing font glyphs / fallback tofu boxes (`▯`).

**Still open (deliberate):** recent-history writes stay fire-and-forget (see §15).
Render-task cancellation stays between pages (`ctx.throwIfAborted()`); a single pathological page is bounded
by the pool terminating the worker on timeout rather than by cooperative mid-render cancel.

## 17. Browser-worker font rendering and final audit (2026-10-09)

The editor's browser worker was still vulnerable to PDF.js's browser-font path. In a dedicated
worker there is no reliable `document.fonts`/`FontFace` installation surface, so standard or
embedded fonts could become tofu boxes even though CMaps and standard-font files were present.

The loader now forces deterministic PDF glyph-path rendering with `disableFontFace: true`,
`useSystemFonts: false`, and `isEvalSupported: false`. CMap and standard-font URLs are resolved
from Vite's base URL, so the same worker works at the site root and under a deployed sub-path.
The existing OffscreenCanvas factory and `useWorkerFetch` configuration remain unchanged.

The final audit intentionally stayed narrow: no additional speculative refactors were made after
the renderer fix. The full validation gate passed: **172/172 unit tests**, **all browser E2E
checks**, workspace typechecks, production web build, asset HTTP checks for CMaps and standard
fonts, and `git diff --check`. The local `Stirling-PDF-main/` checkout is reference material and
is ignored rather than included in the application commit.

## 18. P4 — Accounts & workflows

Sequenced so identity, data and automation land separately. Only a slice that is *already
decided* gets built; the rest waits for the decision that unblocks it.

### 18.1 P4.0 — Decision record (decided 2026-10-12)

- **Store: MongoDB.** `PLAN.md` has claimed MERN since P0 while `apps/api` actually runs
  Express + Redis only. **Redis stays what it is — queue, quota counters, job state — and is
  never the store of record for account data.** Account, session and recipe documents go to
  MongoDB, which is what the stated stack implies and what the `MONGODB_*` accelerator
  targets. Job *state* remains in Redis; job *metadata* is temporary by design (the janitor
  deletes result files), so nothing durable is built on top of it.
- **Identity: one OIDC provider first.** Authorization Code + PKCE, validated `state`, and an
  allow-listed `redirect_uri`. More providers are additive, not a prerequisite.
- **Sessions: server-side and revocable, carried in a cookie.** `Secure; HttpOnly;
  SameSite=Lax`; a CSRF token for state-changing requests. No long-lived bearer token in
  `localStorage` — that is the XSS-exfiltration shape this product should not ship. Sessions
  are rows that can be listed and revoked, so "sign out everywhere" is real.
- **Sync boundary: metadata, never document bytes.** The product promise is "the file is
  parsed inside this browser tab". Account sync may carry *recipe definitions*, *preferences*
  and (opt-in) *history metadata* — filenames, page counts, timestamps. PDF bytes and
  rendered output are not uploaded to make sync work. Server-side *jobs* still upload a file
  to be processed; that is the existing anonymous flow and is unchanged and still temporary.
- **Execution split: browser-first.** A recipe runs in the browser worker pool when every step
  is a browser-capable slug; it needs the server only for slugs the server can run (8 today).
  A recipe mixing the two runs step-by-step and is explicit about which steps leave the device.
- **Quotas stay per-IP-hash after login.** Accounts add ownership, not an unlimited tier;
  substituting the account id for the IP hash as the quota subject is a P4.4 concern.

### 18.2 P4.1 — Optional accounts + sessions *(complete 2026-10-12)*

**The callback URL.** Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client
IDs → **Authorized redirect URIs**. It must match byte for byte, including scheme, host and
port:

| Environment | Authorised redirect URI |
| --- | --- |
| Local development | `http://localhost:8080/api/auth/callback` |
| Production | `https://<your-domain>/api/auth/callback` |

Both are overridable with `GOOGLE_REDIRECT_URI`. The dev value is the default in
`apps/api/src/config.ts`, is set in `docker-compose.yml`, and — as of 2026-10-12 — is the exact
value registered on the live development client. Only *redirect URIs* matter here; *Authorized
JavaScript origins* belong to the implicit/One Tap flows and are unused by this design.

**Shipped**

- `Authorization Code + PKCE (S256)`, `state`, and `nonce`, all minted server-side per login.
- `state` is a **server-side, single-use** record (`findOneAndDelete`), so a replayed callback
  is a miss rather than a second login. It is not a cookie the client asserts about itself.
- The ID token is **signature-verified** against Google's JWKS *and* checked for `iss`, `aud`,
  `exp` and `nonce`. The `nonce` check is what proves the token answers *our* request.
- Accounts are keyed on Google's `sub`, never on email — an email can be reassigned between
  accounts, and linking on it would hand one person another's history.
- Sessions are server-side rows that can be revoked, carried in an
  `HttpOnly; SameSite=Lax; Secure` cookie. **Only a SHA-256 of the token is stored**, so a
  database dump cannot be replayed as live sessions. Expiry is enforced in code as well as by
  a TTL index, because a TTL monitor runs about once a minute.
- Routes: `GET /api/auth/google/start`, `GET /api/auth/callback`, `GET /api/auth/me`
  (204 = nobody, which is not an error), `POST /api/auth/logout`.
- **SPA:** `useAuth` + an account menu in the header; `Sign in` performs a real redirect.
  Signed-out is a first-class state — the control, the workflows page and the account page all
  work without a session.
- **Job ownership:** a signed-in submission is recorded in a `jobOwners` collection (TTL'd to
  the file retention), so `GET /api/account/jobs` lists a user's jobs with live queue status.
  Recording happens at submit time, because BullMQ prunes its own completed entries and could
  not answer "which are mine".
- **CSRF:** a double-submit token (`pdfshush_csrf`, readable by design) echoed in
  `x-csrf-token`. Required on every state-changing account route; `SameSite=Lax` already blocks
  cross-site POSTs, so this is the second lock and covers a deployment that relaxes the cookie.
- **Anonymous-first preserved:** auth is off unless a Mongo URI *and* both Google credentials
  resolve; when off, `/api/auth/*` answers 503, `/api/account/*` answers 503, `/api/auth/me`
  answers 204, and no other route consults a session. An unreachable Mongo downgrades to
  anonymous-only rather than failing boot.
- Same-origin by default: the Vite dev server proxies `/api` to `:8080`, so the session cookie
  stays `SameSite=Lax` and no CORS layer is needed. Production serves web and `/api` from one
  origin the same way.

**Verified against the real provider (2026-10-12).** With the live client configured, the API
logs `accounts enabled` after connecting to Atlas; `/api/auth/google/start` returns a 302 to
`accounts.google.com` carrying the real `client_id`, the registered `redirect_uri`,
`code_challenge_method=S256`, a `state` and a `nonce`; and clicking **Sign in** in the running
app lands on Google's consent screen. `/api/account` answers 401 (not 503) once auth is on.

**Tests:** 28 auth tests (RFC 7636 PKCE vector, open-redirect allow-list, real RS256
verification against a local JWKS covering bad signature/`aud`/`iss`/`exp`/`nonce`, session
hashing/revocation/expiry, state replay) plus 13 account tests (authorisation on every route,
CSRF on every write, preferences round-trip and size caps, history, workflow CRUD and the
per-account cap, cross-account 404, job ownership, and full erasure).

### 18.3 P4.2 — Account-owned data *(complete 2026-10-12)*

Preferences, synced history, and erasure. History is **metadata only** — tool, file name, page
count, time — never a document, and it is only pushed when the user turns sync on. The account
page offers **Export my data** (a JSON download) and **Delete everything**, which removes the
account, its sessions, preferences, history, workflows and job records in one call and returns
per-collection counts so the sweep is provable rather than assumed.

**Exit condition met:** a user can see, export and delete everything stored about them.

### 18.4 P4.3 — Workflow recipes *(complete 2026-10-12)*

The recipe **contract is in the engine** (`packages/pdf-core/src/workflow.ts`) so the browser and
the server validate a recipe with the same rules. `validateWorkflow` rejects unknown slugs,
duplicate/empty step ids, forward or cyclic input references, oversized recipes, and chaining
from a job that produces no document.

- **Storage:** IndexedDB when signed out, mirrored to the account when signed in, so the page
  behaves identically either way.
- **Builder:** name, ordered steps, add/remove/reorder. Reordering **re-links the chain** so a
  step still points at its predecessor, which is what keeps the recipe valid after a move.
- **Run-now:** executes through the existing `/api/jobs` endpoint — one upload → poll → download
  per step, with each step's output feeding the next. No second execution path, one job
  contract, one queue, one set of limits.
- **Honest limits:** steps run with each job's **default options**; option editing is the next
  pass. The builder offers **job** slugs (`merge`), not tool slugs (`merge-pdf`) — the two
  namespaces overlap but are not the same, and offering tool names would have posted the wrong
  slug. A recipe naming a slug this deployment cannot run says so in the builder rather than
  failing mid-run.

**Bug fixed while building it:** `organize`'s no-page-list fallback returned `[]`, which
`composePageRefs` rejects with "No pages selected" — so the job was documented as callable
without a selection and was not. It now keeps every page in order. Two regression tests. This
was only reachable from outside the UI (the API, a workflow step), which is exactly why the
workflow runner found it.

**Exit condition met:** a saved two-step recipe runs end to end and downloads its result — the
E2E asserts the downloaded bytes are a PDF, not just that a toast appeared.

### 18.5 P4.4 — Automated triggers: threat model, **not implemented**

Deliberately not built. The capability is unattended execution driven by something other than
the user's click, and each trigger carries a distinct risk that needs its own defence before any
code is written:

- **Upload trigger** (run a recipe when a file appears): needs a watched source that is not the
  user's drag-and-drop, i.e. server-side storage, which contradicts "your files never leave this
  device". The browser-local variant is just the existing Run button.
- **URL trigger** (fetch a PDF from a URL and run): **SSRF**. Requires a scheme allow-list
  (`http`/`https` only, no `file:`/`gopher:`), DNS resolution with private/link-local/loopback
  and metadata-endpoint blocking, redirect-chasing with the *same* check on every hop (and on
  the resolved address, not just the hostname, to defeat DNS rebinding), plus byte and time caps
  and a content-type check. None of that exists yet.
- **Schedule trigger**: needs durable scheduling (a repeatable job source, not in-process
  timers), idempotency so a retry cannot double-run, per-account concurrency caps so one user
  cannot occupy the queue, crash-safe recovery, and observable pause/cancel/delete semantics.
  BullMQ has repeatable jobs, but the ownership, idempotency and quota interaction with the
  existing per-IP budget is undesigned.

Shipping any of these without that work would be adding an attack surface to a product whose
stated value is that files stay on the device. The recommendation is to treat P4.4 as its own
phase with its own gate — the P3 hardening gate is the model: prove the failure mode is
contained before the feature is called done.

**Exit condition (unmet, by design):** threat model reviewed, abuse limits tested, scheduled runs
survive a worker restart, pause/cancel/delete work.

### 18.3 P4.2 — Account-owned data

Preferences and recipe definitions persisted per account; history sync only as an explicit
opt-in, metadata-only, with export and account deletion. Deletion must remove documents,
sessions and any account-owned job metadata.

**Exit condition:** a user can see, export and delete everything stored about them.

### 18.4 P4.3 — Workflow recipes

The **recipe contract is in the engine** (`packages/pdf-core/src/workflow.ts`) rather than in
the UI, because a recipe must mean the same thing to the browser pool and the Phase 3 queue.
`validateWorkflow` rejects unknown slugs, duplicate/empty step ids, forward or cyclic input
references, oversized recipes, and steps that would need a file no step produced. Saved
recipes live in IndexedDB (anonymous) and later per account (P4.2); the builder and "run now"
follow.

**Exit condition:** a saved multi-step recipe survives reload, runs with progress and
cancellation, and fails a step with a diagnosable error rather than silently skipping it.

### 18.5 P4.4 — Automated triggers (separate gate)

Upload / URL / schedule. Deferred out of P4.3 on purpose: a URL trigger needs SSRF defence
(scheme allow-list, private-address and redirect/DNS-rebinding blocks, byte and time caps), and
a schedule needs durable scheduling, idempotency, per-account concurrency caps and crash-safe
recovery. Server triggers may only start recipes whose steps the server can actually run.

**Exit condition:** threat model written, abuse limits tested, scheduled runs survive a worker
restart, and a user can pause, cancel and delete a trigger.

## 19. Production-risk closure (2026-10-12)

Before adding any further feature, the P4 surface was swept for risks that only bite in
production. Five were found; the first is a genuine security hole.

| # | Risk | Fix |
| --- | --- | --- |
| **1** | **CSRF check compared lengths, not values.** `requireCsrf` accepted any token of the right length, so the token that exists to stop a cross-site write stopped nothing. | Constant-time value comparison via the existing `tokensMatch` (`timingSafeEqual`). Regression test proven red: reverting to the length check fails **exactly** the new test and nothing else. |
| **2** | **Sign-in routes were unthrottled.** A loop against `/api/auth/google/start` wrote an `authTransactions` row per call, and against `/callback` forced an outbound request to Google. | Per-IP window (Redis counters, `AUTH_RATE_LIMIT_PER_MINUTE`, default 20/min) mounting **only** on those two routes. Verified live: 20×302 then 429 with `Retry-After: 60`. Fails **open** on a counter outage — locking everyone out of sign-in because Redis blinked is worse than a short burst. |
| **3** | **A storage outage surfaced as a 500.** A Mongo blip looked like an application defect, and clients treated it as permanent. | The error handler classifies the MongoDB driver's public transport/connection error classes, including wrapped causes, and answers **503 `storage_unavailable`**, logged as an outage rather than a bug. Ordinary server/application errors remain 500. |
| **4** | **A `Secure` cookie on a plain-http origin fails silently.** The browser drops it and the user appears signed in, then signed out. Compose defaults the flag **on**, so a self-hoster without TLS would have hit exactly this. | Boot-time warnings when `SESSION_COOKIE_SECURE` is on over non-localhost http, and when production `WEB_ORIGIN` is plain http. |
| **5** | **No `.env.example`.** Every variable the server reads was undocumented, and a downloaded Google client-secret JSON had been left in the repo root, untracked but *not* ignored. | Added `.env.example` (no secrets, every var explained, including how to generate `PEPPER` and where to register the redirect URI). The secret JSON is now gitignored, and the values live only in the gitignored `.env`. |

Also cleaned while in there: the `/api/account` summary fetched history **twice** (once to test
for emptiness, once to count); it now issues one query per collection. And a `jobs.ownsJob` stub
was being passed into the route deps that always returned `false` — dead code that lied. Job
ownership is decided by the job token, not the session, so the dependency was removed rather
than implemented.

**Deliberately not changed:** `/api/auth/me` and `/api/auth/logout` stay unthrottled. `/me` is a
single indexed read and the SPA calls it on every page that shows the account menu; throttling it
would break normal navigation long before it inconvenienced an attacker. `/logout` is a single
update and CSRF on it would be low-impact (a forced logout).

**Tests added:** 6 — the CSRF bypass (with its red-proof), the positive CSRF control, the
storage-outage 503 mapping, the rate limiter (throttles the costly routes, leaves `/me` alone),
and the `Secure` cookie flag, which is the one leg a browser could not verify here because
completing a real Google login needs a real Google account.

**Verified live after the fixes:** 20 sign-in redirects then 429 with `Retry-After: 60`; `/me`
12/12 at 204; accounts enabled against Atlas; `/api/account` 401 when signed out; boot logs clean
for a localhost origin.

**Gates:** typecheck 3/3 · **242/242 unit** (129 engine + 113 API) · **93/93 browser E2E** ·
21/21 API integration · 17/17 hardening · build ok, main chunk 698 kB with 0 pdf-lib/mongodb in
it · pre-push grep clean · all three containers healthy.

### 19.1 Security review and release status (2026-10-12)

The release review was limited to the current working tree and did not add features:

- **P4.4 remains gated.** No upload, URL, or schedule trigger endpoint or scheduler was
  introduced. The SSRF, durable-scheduling, idempotency, concurrency, and crash-recovery exit
  conditions in §18.5 remain unmet by design.
- **Mongo classification is hardened.** `isStorageOutage` uses public MongoDB driver classes and
  walks `cause`/`AggregateError` chains; regression coverage includes network, closed-topology,
  wrapped errors, and a non-outage `MongoServerError`.
- **Secrets check passed.** The downloaded Google client JSON is ignored, `.env` is ignored, no
  matching secret files are tracked, and no files were staged during review.
- **Verification:** workspace typecheck passed; 246 unit tests passed; the production web build
  passed; live API smoke passed all checks. The Docker hardening gate was not rerun to completion
  because the running stack used the default one-hour retention instead of the gate's short-test
  retention. The browser smoke suite passed through workflow coverage before hanging and being
  stopped. A real Google-account browser login remains unverified and requires an interactive
  throwaway account/consent flow.
- **Dependency audit:** `pnpm audit --prod` could not contact the npm advisory endpoint because
  the environment denied registry access; this is a verification limitation, not a clean audit
  result.

## 20. Secure redaction (R1 shipped, R2 deferred)

The plan for destroying content rather than covering it. **R1 is the minimum safe,
production-ready release and it has shipped. R2 is explicitly deferred until R1 is proven in
production.**

### 20.1 R1 — Rasterization-first redaction ✅ shipped 2026-10-14

**Why rasterization first.** Permanent removal means the original content must not exist in the
output. Rebuilding every page from a freshly rendered image achieves that *structurally*: the
output document is created empty and only ever receives images, so every "did we remove X?"
question collapses into "is X in a document we built from scratch?" — which is answerable by
inspection. A surgical content-stream engine was built for this and **abandoned** (§8,
2026-10-14): its correctness was unproven and it hung. That is recorded rather than hidden,
because the code was deleted on purpose.

**Milestones**

| # | Milestone | Status |
| --- | --- | --- |
| R1.0 | Decision record: raster-first vs text-level; what is disclosed to the user | ✅ |
| R1.1 | Render → burn marks into the bitmap → rebuild a fresh PDF | ✅ |
| R1.2 | Independent verification of the **serialized** artifact | ✅ |
| R1.3 | Fail-closed limits and resource release | ✅ |
| R1.4 | Product integration: marking, disclosure, progress, cancel, download | ✅ |
| R1.5 | Whiteout relabelled as cosmetic so it is never mistaken for redaction | ✅ |

**Dependencies**

- `pdfjs-dist` (rendering) and `@cantoo/pdf-lib` (rebuild) — **both already present**; R1 added
  **no new dependency**. `fflate` (already present) is used to inflate image streams during
  verification.
- `OffscreenCanvas` for rendering; where it is absent the run is refused, never downgraded.
- Client-side only: no API, no `SERVER_SLUGS` entry, **files never leave the device**.

**Acceptance criteria (all met, with evidence in §8)**

1. The exported bytes reopen as a valid PDF with the original page count.
2. **No text is extractable**, proven by two independent readers — pdf.js extraction *and* a raw
   content-stream scan for `Tj`/`TJ`/`BT`.
3. No annotation, attachment, form field or metadata survives.
4. Every page is exactly one substantial image matching its page box's aspect ratio.
5. **The marks are in the output pixels**: the embedded image is decoded from the exported file
   and every marked area is opaque.
6. Unaffected content survives: pages retain contrast outside the marks.
7. Fail-closed on: no canvas, render failure, >150 pages, >100 MB output, no regions, a region on
   a nonexistent page.
8. The pdf.js document is released on success, failure **and cancellation**.

**Security gates.** Every item above runs on *every export* inside `verify.ts`, and a failing
check throws instead of returning bytes — there is no path that hands back an unverified
document. Adversarial tests prove the gates can fail: an unredacted document, marks never
burned, blank placeholder pages, a wrong aspect ratio, and malformed bytes are all rejected.
The browser E2E asserts on the downloaded artifact (valid PDF, page count, **no `/Type /Font`**,
no attachment tree, one image XObject per page) and that the console stays clean.

**Risks and mitigations**

| Risk | Mitigation |
| --- | --- |
| The tool quietly becomes a cosmetic mask | Verification decodes the *output* pixels; a page with no opaque mark fails |
| Text/OCR layers silently retained | Two independent readers plus a structural single-image check |
| Large documents kill the tab | 150-page and 100 MB ceilings, plus the pool's timeout/terminate |
| A render failure produces a partial file | Fail-closed; nothing is returned on any page failure |
| Leaked workers/documents | `destroy()` in a `finally`; asserted in tests for success, failure and cancel |
| Users mistake loss of text for a defect | Disclosed before confirmation and repeated in the result note |

**Known limitations (stated, not hidden).** Text selection, search, links, form fields,
accessibility and vector quality are lost. The 100 MB output ceiling is enforced but only
exercised at scale. The real pdf.js rasterization path is proven by the browser E2E rather than
by unit tests (Node has no canvas, so unit tests inject a rasterizer). R1 makes **no** claim of
universal PDF compatibility or absolute security beyond the checks above.

### 20.2 R1 is not the end state

R1 is deliberately conservative: it trades fidelity for a property that can be proven. The
trade is acceptable for a first release and unacceptable as a permanent answer, which is why
R2 exists and why the disclosure is explicit.

### 20.3 R2 — Native text-preserving redaction ⛔ deferred (final phase)

**Goal.** Remove the targeted glyphs from the content stream so the rest of the page stays
searchable, selectable text at full vector quality.

**Candidates.** `rock3125/pdf-redaction` (Apache-2.0) and `marctjones/excise` (MIT). Both are
licence-compatible with AGPL-3.0-or-later; **licence compatibility is necessary but not
sufficient** — each must pass the audit below. Preference is to **adopt and verify proven code
rather than rebuild**, because R1's predecessor was rebuilt from scratch and failed.

**Entry criteria (all must hold before any R2 code lands)**

1. **R1 has shipped and been verified in production** — no field failures, and the R1 gates
   passing on real user documents.
2. A **security audit** of the chosen implementation: what it removes, what it leaves, and how
   it behaves on the structures that make text removal hard — nested Form XObjects, Type3 and
   CID fonts, glyph-level positioning, invisible/OCR render modes, annotations, metadata and
   attachments.
3. **Adversarial testing** of the same class R1 has: partial-word, rotated text, nested objects,
   images, OCR layers, metadata, and negative controls that prove the gate can fail.
4. An **independent verifier** for the exported artifact, equivalent in strength to R1's — two
   readers for retained text, structure checks, and pixel evidence for the marks.
5. **Licence and attribution** recorded (`licenses/`), with no copyleft-incompatible code.
6. **Architecture fit**: it must run in the existing browser worker and keep documents on the
   device. A server-side engine (as Stirling-PDF uses) is not acceptable as a default.

**Acceptance criteria.** Every R1 criterion, plus: the redacted span is gone from the text
layer and from the raw content stream, while surrounding text remains extractable and
selectable; and the page keeps its vector/text quality.

**Risks.** Content-stream surgery is the class of code that failed once already; a wrong glyph
box under-redacts *silently*, which is the worst outcome. It must therefore be gated on proven
removal, not on appearance — the same rule R1 follows.

**Fallback.** If no candidate passes the audit, R2 does not ship and R1 remains the answer,
with its limitations stated. That is an acceptable outcome; shipping an unproven text-level
engine is not.


## 21. 2026-10-14 - Editor text fidelity and content-stream migration plan

Implemented in this session:

- Standard font family (helvetica, times, courier) and italic support across EditTextObject, exporter, text-run extraction, inspector, and seed-replace.
- Text-run extraction now captures PDF.js font family/weight/style metadata.
- Editor text boxes now support in-place click-to-edit reliably, smart auto-height, and smart horizontal expansion while typing.
- Inspector panel made draggable and scrollable to avoid overflow.
- Regression coverage added in packages/pdf-core/test/editor.test.ts.

Planned next (no code yet):

- ~~Convert the remaining click-to-replace affordances and the E2E suite to the new `text-edit`
  save path once it is verified in the browser (§22).~~ ✅ done the same day — the affordance
  sends in-place intents, `tests/e2e/text-edit.mjs` asserts them, and the full smoke is green.
- Keep raster redaction as the secure default until a text-preserving verifier is proven.
- Unicode/CID/subset-font replacement beyond the font-resolvable cases is still deferred; the
  engine's honest fallback covered it, and the charcode-resolver + multi-object work in §22 has
  since landed and closed the subset-font gap (the CID/Type0 gap remains — no `/ToUnicode` means
  no map, so those edits still fall back).

---

## 22. In-place text editing (engine shipped 2026-10-14)

**Goal.** Click existing PDF text, edit it, and have the *original* glyphs replaced — not
covered. Preserve layout, font, colour and rotation for the document's own content.

**Feasibility spike (read-only, before any code).** Ran `@embedpdf/pdfium` 2.15.1 as real WASM
in Node against generated fixtures. Result: **7/7 checks** — `FPDFText_SetText` and
`FPDFText_SetCharcodes` rewrite an existing text object; unrelated text objects and a rotated
page survive `FPDFPage_GenerateContent` + `PDFiumExt_SaveAsCopy` + reopen. Confirmed the same
binding is what Stirling-PDF's shipped v2 editor mutates through (`PdfTextEditorCharcodeController`
encodes Unicode→charcodes server-side because PDFium's reverse lookup is unreliable for subsets).
**Conclusion:** in-place mutation is real and available; the smallest viable path is a PDFium
mutation pass with a pdf-lib overlay fallback, *not* a from-scratch content-stream engine.

**Why the earlier content-stream engine (deleted in §20) is not revived for this.** That engine
tried to *strip* text for redaction and had unproven correctness. Text editing does not need
byte surgery: PDFium already re-encodes against the object's own font and writes the operator
sequence. Redaction stays on the proven raster path and is untouched by any of this.

**What shipped**

- `packages/pdf-core/src/textedit/`
  - `pdfium.ts` — heap-safe access to page text objects: enumerate, read text/bounds/font size,
    `setText`, `setCharcodes`, `removeObject`, `generate`, `serialize`, `close`. Owns every
    WASM pointer lifetime; object pointers are invalidated by `generate`.
  - `engine.ts` — `editPdfText`: (1) native PDFium pass matching each edit to a text object,
    (2) reopen the serialized result with pdf.js and demote any replacement that did not survive
    (PDFium returns `true` even when it writes filler for an unencodable glyph), (3) apply the
    caller's overlay for demoted edits plus any extra editor objects with pdf-lib, (4) final
    verified save. Deleting a run uses `FPDFPage_RemoveObject`; a deletion that cannot be done in
    place is **refused**, never whiteout-covered. An unresolvable edit with no fallback is refused.
  - `verify.ts` — reopen + re-extract with pdf.js (the product's own reader) and assert each
    replacement is present.
  - `runtime.ts` — lazy, cached WASM bootstrap; `configurePdfiumRuntime({ wasmUrl })` mirrors
    `configurePdfjsRuntime`, and the dynamic `import('@embedpdf/pdfium')` keeps the glue out of
    every bundle that only type-imports it.
- `packages/pdf-core/src/jobs/textEdit.job.ts` — the `text-edit` job (slug registered in
  `registry.ts` / `slugs.ts`). Output reports per-edit `mode: 'in-place' | 'fallback'`, counts,
  the verification checks and warnings.
- `ops/edit.ts` — `EditTextObject.inPlace` links a replacement box to the run it replaces.
- `apps/web/src/workers/job-worker.ts` — `configurePdfiumRuntime({ wasmUrl })`.
- `apps/web/.../edit-pdf-tool.tsx` — saves via `text-edit`, derives in-place intents from
  `inPlace` boxes, excludes their whiteout/box from the overlay pass, and toasts the
  in-place vs overlay split.
- `licenses/embedpdf-pdfium-MIT.txt`, `licenses/pdfium-BSD-3-Clause.txt`.

**Phase T depth (2026-10-14, same day): the resolver that makes subset fonts edit natively.**
Full narrative in §8; the code:

- `textedit/charcodes.ts` — derives Unicode→charcode maps **from the document itself**
  (`/ToUnicode` first, then `/Encoding`'s base + `/Differences`, per page, keyed by
  subset-tag-stripped base font name) and `encodeWithMap`, which refuses the whole run at the
  first unresolvable character instead of writing a partial glyph string. `pdfium.ts` gained
  `fontNameOf` (via `FPDFTextObj_GetFont` → `FPDFFont_GetBaseFontName`) to look the map up for
  the object being written; `editPdfText` loads the maps once and the write branch prefers
  `setCharcodes`, falling back to `setText` only when there is no map for that text.
- `textedit/engine.ts` — `matchObjects` joins contiguous same-line objects (whitespace-
  insensitive, ink-overlap test matching `clusterTextRuns`), removes a matched tail with
  `FPDFPage_RemoveObject`, and throws rather than half-replacing a line. `sameText` tolerates
  exactly one thing: a control code in PDFium's object text, which is a glyph it failed to decode
  (every other character, and the length, must still match).
- Evidence, on Stirling-PDF's `mushroom-life.pdf` — **reference only, not copied into this
  repo**; reproduce by pointing a temporary probe at
  `Stirling-PDF-main/app/core/src/test/resources/pdftexteditor/mushroom-life.pdf`: replacement
  present after the native pass **0/91 (`SetText`) → 77/91 (charcodes) → 91/91** (charcodes +
  multi-object + control tolerance), all 91 surviving re-extraction. The 14 runs the tolerance
  fixed all ended in a hyphen whose charcode nothing in the document explains (§8, finding 3).

**Known compatibility limits (disclosed, not hidden).**

- Matching joins contiguous same-line objects and compares whitespace-insensitively, tolerating
  only control codes PDFium returned without decoding (§8 finding 3). A line whose objects still
  do not match — a scanned page, a CID font with no `/ToUnicode`, text the reader and PDFium
  disagree about beyond that — takes the overlay fallback and the output says so.
- Font encoding: PDFium rewrites Unicode using the object's font; a glyph the subset lacks
  produces filler, which verification catches and demotes. A replacement that *neither* PDFium
  nor the WinAnsi overlay font can represent is refused, not mangled (this is deliberate — see
  `assertEncodable` in `ops/edit.ts`).
- Scanned/image-only pages have no text objects, so every edit there is an overlay — which is
  what OCR-assisted editing is for (§4 P7); the engine does not pretend otherwise.
- Encrypted documents load with a password; PDFium and pdf-lib must both accept the same one.

**Verified in the browser.** `tests/e2e/text-edit.mjs` (`pnpm test:e2e:text-edit`) drives the
real app in Edge: click an existing run → retype → save → download. It asserts the toast says
"1 replaced in place", the download is a valid PDF, and **pdf.js re-extraction of the exported
bytes contains the replacement and no longer contains the original** — 8/8 checks. The **full
smoke suite is green too (101/101, API + Redis up, nothing skipped)**, including the editor
Delete/undo/redo section and console health. Getting there needed one editor fix beyond the
engine: the click that opens an edit also closed it, because the mousedown of the same gesture
dropped focus on `<body>` ~4 ms after the textarea mounted — the opening gesture now consumes
exactly one mousedown default (§8 finding 4).

**Not yet done (honest status).**

- The API/server pipeline does not run `text-edit` (it needs the WASM asset and pdf.js worker
  configuration the server has not set up); it is intentionally absent from `NODE_JOBS`.
- A CID/Type0 font with no `/ToUnicode` has no derivable map, so those replacements fall back to
  the overlay rather than guessing codes — by design, not oversight.
- Paragraph/table reflow and Unicode fallback fonts; OCR-assisted editing of scanned pages (P7).
- Redaction (§20) was not touched and its guarantees are unchanged.

---

## 23. P5 — AI (ported 2026-10-16)

### 23.1 What was built

Port GenOffice's production AI stack into PDFShush, then wire two features, a smart-redaction
proposal flow, and a metered server path.

| Piece | Where | Notes |
| --- | --- | --- |
| `@pdfshush/ai-provider` | `packages/ai-provider` | Provider registry + protocols (OpenAI-compatible, Anthropic, Gemini), SSE framing, watchdog, output-cap fallback, settings guard, `browser` barrel (no Node). **357 tests.** |
| `@pdfshush/ai-agent` | `packages/ai-agent` | ReAct loop (`AgentLoop`, stateful multi-turn, cancel/reset), skill contract, stream-text, redact-core. Zero-dep, isomorphic. **152 tests.** |
| BYOK transport | `apps/web/src/lib/ai/transport.ts` | `AgentTransport` over `streamForProvider`, directly from the tab. |
| Settings | `apps/web/src/lib/ai/settings.ts` | `AiSettings` in localStorage, `sanitizeAiSettings` on every read/write; `aiReady` availability predicate. |
| PDF read skill | `apps/web/src/lib/ai/{pdf-session,pdf-skill}.ts` | Page text extracted once via the `text-runs` job; tools `get_document` / `read_pages` / `search_text` / `goto_page`, each output-capped. |
| Summarize / chat / edit UI | `components/ai/ai-workspace.tsx` (+ `ai-chat`, `ai-document-pane`, `edit-plan-panel`, `ai-trust-notes`), reached via the thin `components/tools/{summarize-pdf,chat-with-pdf,edit-pdf-with-ai}-tool.tsx` wrappers | One two-pane workspace shared by all three tools: page preview with pending-change overlays on the left, streaming chat + activity timeline + clickable citations on the right. New **AI** category. See §23.6. |
| Agentic editing | `apps/web/src/lib/ai/edit-skill.ts` + `components/tools/edit-pdf-with-ai-tool.tsx` | Model **proposes**, user reviews, "Apply" chains the existing `edit` → `organize` → `stamp` jobs. |
| Smart redaction | `apps/web/src/lib/ai/redaction-propose.ts` + `redact-tool.tsx` | Model returns run **indices**; pdf-core owns the geometry; R1 destroys; R1 verifies. |
| Leakage gate | `packages/pdf-core/test/ai-redaction.test.ts` | The blocking gate (below). |
| Managed server | `apps/api/src/ai/{budget,routes}.ts` | SSE proxy + `AiBudgetService`; off unless configured. |
| Managed client | `apps/web/src/lib/ai/{managed,mode,ask}.ts` | SSE consumer for the same route; one-shot for redaction; mode toggle outside `AiSettings`; `/api/tools` capability probe. |
| AI browser E2E | `tests/e2e/ai.mjs` + `tests/support/mock-llm.mjs` | Real client stack against a local SSE mock; chat + edit-apply, no keys. |
| Limits | `packages/pdf-core/src/limits.ts` `LIMITS.ai` | Single source for managed budgets + client caps. |

#### 23.1.1 Agentic editing (P5.5)

The donor's edit tools are mapped onto the engine PDFShush already ships, reusing the same
"propose → review → apply" discipline as smart redaction:

- **The model never touches bytes.** It reads text runs (`text-runs`) and page sizes (`inspect`),
  then calls tools that append to a pending plan: `markup_text`, `replace_text`, `delete_text`,
  `insert_text`, `rotate_pages`, `delete_pages`, `set_page_order`, `add_header_footer`,
  `add_page_numbers` (plus the read tools and `list_pending_edits`).
- **Geometry stays in pdf-core.** Markup/replace/delete select a run by *page + verbatim text*;
  the box comes from the extracted run, so a paraphrase cannot move a mark. Replace is a real,
  guaranteed result on every document: a `whiteout` over the old run plus a redrawn text object.
- **Every proposed change becomes one of three validated engine inputs** — overlay objects (`edit`),
  page order/rotation (`organize`, via `PageRef[]`), header/footer (`stamp`). Each job validates its
  input and re-parses its own output, so a wrong plan fails a step loudly instead of producing a bad
  download.
- **Apply is a sequential chain**: `edit` → `organize` → `stamp`, each step consuming the previous
  step's bytes. The plan is capped (`MAX_PENDING_EDITS`) and cancellable; nothing is written until
  the user presses Apply. Registered as the LIVE tool `edit-pdf-with-ai` in the **AI** category.

### 23.2 The leakage gate (blocking, green)

`packages/pdf-core/test/ai-redaction.test.ts`, on the **exported bytes** of a fixture with a known
secret:

1. **Two independent readers find no proposed span** — pdf.js text extraction
   (`no-extractable-text`) *and* a raw content-stream scan (`content-has-no-text-operators`), plus a
   `forbidden-strings-absent` sweep.
2. **Non-targeted content survives** — `page-not-blank` + `page-images-substantial`, and the marks
   are confined to the proposed rectangles (a page with no proposal has zero marks).
3. **The marks are in the pixels** — R1's `marks-burned-in` pixel evidence.
4. **Negative control** — the same spans routed through the cosmetic whiteout path keep the text
   layer, so the gate **fails** (`no-extractable-text` and `forbidden-strings-absent` both false).
   Without this, a gate that always answered "safe" would look identical to one that works.

The hard edges on the path: the model may only **select runs by index** (a paraphrase cannot move a
mark), the run list is capitally bounded (`MAX_OFFERED_RUNS`, `MAX_PROMPT_CHARS`), and R1 remains
the only destructive path — so R2 stays deferred.

### 23.3 Managed mode (server)

- **Off unless `AI_MANAGED_API_KEY` and `AI_MANAGED_MODEL` are both set.** A default deployment and
  CI behave exactly as before (BYOK only).
- `AiBudgetService`: keys `ai:{subject}:tok:d` (TTL 24h) and `ai:{subject}:req:m` (TTL 60s) over the
  existing Redis/Memory counter store; **reserve** the per-turn worst case, **settle** to reported
  usage, refund the difference; unreported usage keeps the reservation (no free tier). Two tiers:
  anonymous IP-hash (`AI_MANAGED_ANON_DAILY_TOKENS`) vs account (`AI_MANAGED_DAILY_TOKENS`).
- One concurrent stream per subject (`AiConcurrencyGuard`; per instance — the shipped topology is a
  single API process, and the daily budget is the backstop either way).
- `POST /api/ai/chat` streams SSE (`meta`/`delta`/`reasoning`/`tool`/`stop`/`usage`/`done`/`error`)
  and fails closed with `429 code:'ai_budget'` + `Retry-After`. Never logs prompt content.
- **Privacy:** managed is the one path where document text reaches our server. It is wired into the
  browser as an explicit, user-chosen mode (a toggle in the AI settings card, stored under a
  separate key from `AiSettings` because the package guard strips unknown fields). The default is
  still BYOK, and a deployment without a managed key hides the toggle (`/api/tools` reports
  `ai.enabled`), so the shipped client path keeps every byte in the tab unless the user opts in.
  `managed.ts` consumes the SSE stream for both the agent loop and the redaction proposal's one-shot
  call; `ask.ts` normalizes BYOK and managed into the same "ask one question" shape.

### 23.4 Gates run

- `pnpm typecheck` — 5 packages clean (web, api, pdf-core, ai-provider, ai-agent).
- `pnpm test` — **827/827** (189 engine · 129 API · 357 provider · 152 agent).
- `pnpm --filter @pdfshush/api build` — server bundles (AI provider aliased into `dist/server.js`).
- `pnpm --filter @pdfshush/web build` — main chunk **864 kB, 0 pdf-lib / 0 pdf.js / 0 pdfium** (322
  modules); the worker and pdfium chunks are unchanged, and nothing in the AI packages pulls a Node
  built-in into the browser graph.
- `pnpm test:bundle` — the boundary guard (§23.6). It is what caught the `identityRefs` leak: a string
  grep over the minified chunk cannot see it, the sourcemap's module list can.
- `node tests/e2e/ai.mjs` — **18/18** after §23.7 (was 8/8): chat + citation, the migration/leak
  checks, a queued highlight applied and re-extracted, and a **replacement proven in place** — the
  exported PDF contains `Annual Summary` and no longer contains `Quarterly Report`.
- `node tests/e2e/ai-managed.mjs` — **11/11** against the real API routes (in-memory counters) and the
  local mock (§23.7.4).
- `node tests/e2e/smoke.mjs` — **101/101**; `node tests/e2e/text-edit.mjs` — **8/8**.

### 23.5 Not yet done (honest status)

- **BYOK key storage.** ✅ **Done (§23.7.1):** the settings and the mode now live in one IndexedDB
  record, the old localStorage keys are migrated away, and "Forget key" deletes the record.
- **In-place text rewrite.** ✅ **Done (§23.7.2):** `replace_text` (and `delete_text`) now route
  through `text-edit`, so the document's own run is rewritten; the whiteout+redraw is only that edit's
  engine fallback. Proven from the exported bytes, not from a toast.
- **Edit-review preview.** ✅ **Done (§23.6):** pending changes are drawn as overlay boxes on the
  page preview and listed as individually discardable cards; **§23.7.3** adds a per-page dot on the
  rail so a change on another page is discoverable.
- **Managed mode in CI.** ✅ **Done (§23.7.4):** `tests/e2e/ai-managed.mjs` drives the real API
  routes (booted with in-memory counters, no Redis/Mongo) against the local mock from a browser.
- **R2 (text-level redaction)** stays gated behind R1 in production (§20.3) — unchanged, deliberate.

### 23.6 The AI workspace (P5 UI, 2026-10-16)

P5.1–P5.7 shipped the machinery; the surfaces it landed on were two thin shells. This is the UI pass
that makes the AI features read as one of the app's main MVPs, and it hides no behaviour — the whole
path is still "the model proposes, the user reviews, the engine writes".

**Layout.** `ai-workspace.tsx` is the single shell for `summarize-pdf`, `chat-with-pdf` and
`edit-pdf-with-ai`; only the copy, the skill and one extra panel differ.

- **Left — the document.** `ai-document-pane.tsx` renders *one* legible page (900 px) through the same
  `thumbnails` job every other tool uses, re-rendered per active page rather than caching a whole
  document's worth of images; a numbered rail scrolls to any page, and pages the last answer cited get
  a dot. Overlay boxes for the pending plan are positioned as percentages of the display-space page
  size — the same contract `redact-tool` uses — so a highlight lands on the right glyphs at any zoom.
- **Right — the assistant.** `ai-chat.tsx` streams the loop's output, shows each tool call as it
  happens (`TOOL_COPY` verbs, running → done/failed), turns each `[page N]` into a violet chip
  (`lib/ai/citations.ts` parses `[page N]`, `[pages N, M]`, `[pages 4-6]`, tolerant of spacing) that
  jumps the preview, offers starter prompts, reports token spend, and keeps the conversation in the
  loop so follow-ups carry context. Turn text is joined with a blank line so a turn that ended to call
  a tool does not run into the next turn's prose.
- **Below (edit only) — the review.** `edit-plan-panel.tsx` lists one card per change with a page chip
  and a discard button, then one Apply button.

**Per-change review (`edit-skill.ts`).** The plan now carries `entries: AiEditEntry[]`:

- An *additive* change (markup / replace / erase / insert) records the ids of the objects it added; its
  `undo` subtracts exactly those, so discarding one card cannot disturb the others.
- A *whole-document* family (page order, rotation, header/footer) keeps the value captured before the
  family was first touched, and a newer op in the same family supersedes the previous card; discarding
  the survivor restores that captured value.
- `plan.actions` (the model-facing summary) is **derived** from `entries` on every mutation, so the list
  the model reads and the list the user sees cannot drift apart.
- `applyEditPlan` takes `onStep?: (step: ApplyStep) => void` and reports `edit` → `organize` → `stamp`
  in order, which is what the progress row renders.

**The bundle boundary.** The preview pane and the AI graph pulled `identityRefs` (defined in
`ops/compose.ts`, which imports pdf-lib at module scope) into the entry chunk: 771 kB → 1426 kB, 161
pdf-lib modules. `identityRefs` is a three-line loop and is now local to `edit-skill.ts` (859 kB, 0
engines). `tests/bundle-boundary.mjs` reads the sourcemap's module list after a build and fails on any
pdf-lib/pdfjs/pdfium module in the entry chunk — a grep over minified output would not have caught this,
which is exactly why the guard exists.

**Honest limits of this pass.** The preview renders one page per interaction (citations and edits on
other pages are one click away, not simultaneous); above roughly 200 pages the rail is long but still
works; `replace_text` was still whiteout-plus-redraw at this point (**fixed in §23.7.2**); and the
overlays show *where* a change lands, not a pixel-accurate simulation of the final render.

**Smaller fixes from the same pass.** `FileDropzone` takes an optional `note`, so the AI pages say
"Parsed on this device — no file is ever uploaded" rather than the engine's blanket "never uploaded" —
true for a job-only tool, too broad next to a provider form. The settings card's Save button now
reflects whether the form is actually *dirty* instead of whether the config merely looks usable, and
the chat aborts an in-flight stream when it unmounts. The provider/model catalogue is untouched: it is
the donor's curated, date-stamped list, not a placeholder.

### 23.7 Closing the four gaps (2026-10-16)

§23.5 named four gaps, plus "complete the security". All four are closed. What is still open is named
at the end, and it is not a gap I am hiding behind a green check.

**23.7.1 The key moved out of localStorage — and the move found a real bug.**

`lib/ai/storage.ts` is now the single home of the AI state at rest: one IndexedDB record
(`pdfshush.ai` → `state` → `ai`) holding *both* the provider settings and the chosen mode, so the two
are read, migrated and erased together and can never come from different generations of the record.
`settings.ts` and `mode.ts` became thin synchronous facades over an in-memory snapshot, because
components hold these values in React state.

Why bother, honestly: neither store encrypts, and anything running in the origin can read either — do
not let the file's comments oversell it. What does change is that the key is no longer a
string-keyed `localStorage` entry (the store a review, an extension, or a generic "clear site data"
sweep enumerates by name), and it is now erasable by an explicit `delete` instead of overwriting
fields. The guarantees that actually matter were already elsewhere and are unchanged: the key never
leaves the device (`transport.ts` talks to the provider directly), it is never a job payload, a URL, a
log line, or part of the recent-files record.

Three things came out of doing it properly:

- **A hydration race that silently dropped the key.** Two components mount in the same tick — and
  React's dev-mode double mount makes that the norm, not an edge case. The second hydration ran
  *between* the first one's legacy read and its write, found an empty store **and** an
  already-cleared localStorage, and returned defaults; the first one's result was discarded by its
  own `alive` guard. Net effect: the key was on disk but gone from the session. Hydration is now
  single-flight (`hydrateAiState` memoizes one promise) and an empty store returns the current
  snapshot rather than clobbering it. Found by the E2E, which seeds the *legacy* keys on purpose.
- **The key could reach the DOM through an error message.** Provider error bodies are echoed to the
  user, and a 4xx from a proxy can quote the request it rejected. `redactSecrets` now scrubs the key
  (and anything bearer-shaped) from every message the BYOK transport surfaces.
- **"Forget key".** A real affordance, not a doc line: it deletes the record and returns to defaults,
  and it appears whenever *any* provider slot holds a key — not just the active one.

**23.7.2 `replace_text` rewrites the document's own run.**

The plan now carries `intents: AiInPlaceIntent[]` next to `objects`. An intent is `{pageIndex, find
(the run's own verbatim text), replace, box, fallbackIds}` — the honest form of a replacement.
`applyEditPlan` splits the plan: intents go to `text-edit` (PDFium rewrites the glyphs where they
already are, so the run keeps the document's own font, size and matrix), and each intent's
`fallbackIds` — the whiteout and the drawn text the plan already held — are handed to the engine as
that edit's fallback, which it applies **only** when the rewrite is impossible or does not survive
re-extraction. Passing them as ordinary overlays would paint the fallback over a rewrite that worked,
which is exactly the double-draw this split exists to prevent. A plan with no intents still never
loads the PDFium engine: pure overlays stay with `edit`.

`delete_text` goes through the same path with `replace: ''`, so the words are *removed*, not hidden.
That is the stance §22 already took for the editor — a deletion that is only covered is not a
deletion — and the engine enforces it: it refuses an empty replacement it cannot perform rather than
quietly whiteouting the run.

The test is the point: `tests/e2e/ai.mjs` asks for a replacement, applies it, downloads the file and
extracts its text. The exported PDF contains `Annual Summary` **and no longer contains** `Quarterly
Report`. A silent demotion to the overlay would leave the original text in the content stream and fail
that check — which is why the assertion is on the bytes rather than on the report the UI prints.

**23.7.3 A change on another page is discoverable.** The page rail marks every page with a queued
change (amber dot, `data-testid="ai-changed-page"`), alongside the violet dot for cited pages. The
overlay boxes still only cover the page on screen; the rail is what tells you the plan touches page 7
while you are looking at page 1.

**23.7.4 Managed mode is covered by a browser E2E.** `apps/api/test/support/managed-server.ts` boots
the *shipped* `createApp` — routing, schema, budget, SSE framing, provider adapter — with the same
in-memory counters the API's own tests use, so the run needs no Redis, no Mongo and no docker; the
"provider" is the same local SSE mock BYOK uses (`AI_MANAGED_BASE_URL`). `tests/e2e/ai-managed.mjs`
then proves, in a browser: `/api/tools` advertises the trial, the settings card offers it, the choice
is persisted in the same IndexedDB record, a turn streams through `/api/ai/chat` and renders with a
citation, the edit tool proposes a reviewable change, **no provider key is sent from the browser**,
and — stated rather than implied — the document text that *does* cross the wire is present in the
request body.

**Still open, deliberately.** The preview renders one page per interaction and the rail dots are the
discovery mechanism, not a full-document render; above ~200 pages the rail is long; the overlay boxes
show *where* a change lands, not a pixel-accurate simulation of the final render; and R2 (text-level
redaction) remains gated behind R1 in production (§20.3).

---

## 24. Security review (P1–P5) + P6 opening plan (2026-10-16)

### 24.1 Scope and method

A read-only review of everything shipped through P5, split by trust boundary: (a) the server —
sessions/CSRF, uploads + path safety, the sandboxed worker, quota accounting, the managed-AI
gateway; (b) the client — the BYOK key path, custom-endpoint handling, the agent loop's bounds, and
the DOM/code-execution sinks. Plus the pre-push grep from §9 over every tracked file (secret patterns,
machine-path markers, dangerous sinks). **No files were changed to review them; the fixes below are
the review's output.**

### 24.2 Findings

**No Critical.** But a second, wider pass over `apps/api/src` found **four High**, three Medium and a
handful of Low — all *resource-isolation and secret-hygiene* gaps, **not** auth bypasses. Every auth,
ownership, CSRF and path control held, and the pipeline is functionally sound and end-to-end ready;
what was **not** yet true was "hardened for an internet-facing deployment". **The four Highs and all
three Mediums were closed in the P6.9 hardening interlude (§24.4); H4 remains an operator action
(rotate the on-disk credentials).** The one sub-item left open by design — scoping a child to its own
`jobs/<id>` directory — is called out under H1 and in the accepted-by-design list below.

Two defects were found and **fixed** during the review (one Medium, one Low) — the same class, one
client and one server:

- **`redactSecrets` under-delivered its own contract (Medium, fixed).** Its comment promised to scrub
  "anything that looks like a bearer token", but the regex only matched `sk-`/`key-`/`token-` shapes,
  and the one-shot path (`lib/ai/ask.ts` → smart-redaction proposals) returned provider errors
  **without calling it at all** — so a proxy that echoes the `Authorization` header could put a key on
  screen. Fixed: the function moved to `packages/ai-provider/src/redact-secrets.ts` (a package, so it
  is unit-testable — `apps/web` has no runner), now covers the prefixes this app actually ships
  (`gsk_`/`xai-`/`ci_live_`/`ak-`/`apikey-`), `Bearer`/`Basic` header echoes, and
  `AIza`/`AKIA`/`xox`/compact-JWT shapes, and runs on **both** the streaming and one-shot error paths.
  `packages/ai-provider/test/redact-secrets.test.ts` is the first test this function has ever had.
- **The managed gateway streamed a raw provider error to the client (Low, fixed).** A provider error
  embeds up to 500 chars of the response body (`httpBodyDetail`), and `apps/api/src/ai/routes.ts`
  logged and streamed that message unchanged. A gateway that answers `401` while quoting the request
  it rejected would have carried the *deployment's* managed key into a browser event (and the log) —
  the server-side twin of the bug above. It now runs the same `redactSecrets` (the `index.ts` export,
  so the API reuses one implementation), proven by a test that stubs a key-echoing `401` and asserts
  the key never appears in the stream while the redaction marker does.

**High findings (closed in P6.9; one sub-item accepted by design):**

- **H1 — the server "sandbox" was a process boundary, not a security sandbox.** `worker/host.ts`
  handed BullMQ a processor path; BullMQ `fork()`s it. In the dedicated `worker` container that is
  contained by least privilege, but the **embedded dev worker** (`server.ts`) runs inside the API
  process, so its child **inherited `MONGODB_PASSWORD`, `GOOGLE_CLIENT_SECRET`, `AI_MANAGED_API_KEY`
  and `PEPPER`**. **Fixed:** the child's environment is now an **allowlist**
  (`worker/child-env.ts`) — `WORK_DIR`, `NODE_ENV`, the resource-ceiling knobs, and a fixed set of
  authority-free OS/locale variables (`PATH`, `PATHEXT`, `TEMP`, `SystemRoot`, `HOME`, `LANG`, …) —
  spread into BullMQ's `workerForkOptions.env` (BullMQ 6.3.11 accepts the option and spreads it last in
  `fork()`), proven by `test/worker-child-env.test.ts`, which asserts no known secret is present.
  **Accepted by design: the child's filesystem is still the whole work volume, not one `jobs/<id>`.**
  The processor `require`s its dependencies from `node_modules` (built with `--packages=external`), so
  Node's permission model cannot be applied without breaking it, and a real per-job FS scope means
  reimplementing BullMQ's sandbox runner. In the shipped posture the child only ever reads the one
  `jobs/<id>` path it is handed and writes that job's result; the cross-tenant read is a residual risk
  recorded here, not a hidden one.
- **H2 — job timeouts are cooperative; a hung synchronous parser was never killed.** `withJobLimits`
  (`pdf-core/src/job.ts`) is an `AbortController` + timer and cannot interrupt synchronous CPU work.
  **Fixed:** a **parent-side** kill watchdog. The child publishes its pid (`jobs/children.ts`); the
  host runs `startChildWatchdog`, and `killExpiredChildren` kills any child past `JOB_HARD_LIMIT_MS`
  (default `LIMITS.job.maxTimeoutMs + 5min`). It is guarded by a `stateView.isActive` check so a
  re-queued job keeps its child. Proven by `test/children.test.ts`.
- **H3 — there was no admission control or memory ceiling on PDF jobs.** `estimate()` existed on every
  job definition but was never called, and `docker-compose.yml` set no `mem_limit`/`cpus`. **Fixed on
  both axes.** *Admission:* `jobs/runner.ts` calls `definition.estimate(input, pageCountHint)` and
  rejects a job over `LIMITS.job.maxWorkingSetBytes` (1536 MB, overridable with
  `MAX_JOB_WORKING_SET_BYTES`) with `JOB_ERROR_CODES.tooLarge`; the ceiling travels into the child's
  allowlisted env (it can no longer read config) and becomes the processor's `readByteLimit`. *Ceiling:*
  each child heap is capped (`WORKER_CHILD_MAX_OLD_SPACE_MB`, default 2048) via `--max-old-space-size`,
  and the containers carry `mem_limit`/`cpus` — `worker` 5g/2 (2 × 2 GB heap cap plus pdf.js off-heap
  buffers), `api` 1g/1, `redis` 512m/1. Proven by a `runner.test.ts` case and `docker compose config`.
- **H4 — live credentials sit in the local working tree (operator action, not code).** The project-root
  `.env` holds a real MongoDB Atlas connection string and a Google OAuth client secret, and
  `client_secret_*.json` sits beside it. Both are **correctly gitignored and untracked** (verified with
  `git ls-files`), and the pre-push grep is clean — so this is not a leak into the repo, it is on-disk
  hygiene. **Action: if those values are production credentials, rotate them and move to a secrets
  manager.** No code change is involved, which is why this stays open.

  **Closed 2026-10-18 (operator action, verified — method in §8's same-day entry).** The `.env`
  Google secret was found **dead** against the live token endpoint while the downloaded
  `client_secret_*.json` held the accepted one, so deleting that JSON outright would have removed
  the only valid credentials from the machine. The live pair was rewritten into `.env` and
  re-probed as accepting (the `.env` client id was fine: the one "client not found" error reduced
  byte-for-byte to the probe's regex capturing a trailing CR from Windows line endings, not a file
  defect); the stray JSON was then deleted so the values once again live only in the gitignored
  `.env`; and the Mongo Atlas **Network Access** entry for the machine's IP was added — that
  refusal was the actual root cause of a deployment where every auth route answered 503
  `auth_disabled` (§8). A fresh-secret rotation and a secrets manager remain standing deploy-time
  hygiene.

**Medium (all closed in P6.9):** a shared proxy IP collapsed the anonymous quota, the AI daily budget
*and* the AI concurrency slot into one bucket when `TRUST_PROXY` was unset behind a proxy — **M1:** the
server cannot tell "behind a proxy" from "not" at runtime, so it now logs a **boot warning** in
production when no hop is trusted (`http/trust-proxy.ts`, `test/trust-proxy.test.ts`), leaving the
operator to set `TRUST_PROXY`; uploads were extension-checked with no magic-byte sniff — **M2:**
`uploads.ts` now sniffs `%PDF-` **from the already-flowing stream** (a second file handle caused
`EPERM ... rmdir` on Windows); and the byte quota was a read-`precheck` → stream → `consume`, so N
concurrent uploads each wrote up to the cap before any was charged — **M3:** `QuotaService` gained
`reserveUpload`/`settleUpload`, so `maxUploadBytes` is reserved before streaming and settled to the
real total (refunded on failure).

Accepted / by-design (recorded, not "fixed"):

- **The job child sees the whole work volume, not one job.** See H1: the processor needs
  `node_modules`, so the filesystem cannot be scoped with Node's permission model without breaking
  `--packages=external`. The child is handed exactly one `jobs/<id>` path and reads nothing else; the
  residual cross-tenant read is accepted and tracked here rather than silently skipped.
- **BYOK key is stored unencrypted in IndexedDB** (§23.7.1). Honest: IndexedDB does not encrypt and
  any same-origin script can read it. It is out of `localStorage`'s name-enumerable surface, erasable
  by one call, and never sent to our server, logged, or put in a URL.
- **No host allowlist on a custom provider base URL.** The request is the user's own, from the user's
  own browser, to the user's own endpoint (Ollama/LM Studio is the case); scheme+credentials are
  already validated and tested.
- **Document text reaches the chosen provider** (that is the feature) and, in managed mode, our API —
  disclosed in the trust notes and asserted by `tests/e2e/ai-managed.mjs`.

Low-severity items left open, deliberately, with reasons: model output is **never** passed through
`redactSecrets` (a document may legitimately contain a credential the user asked about — corrupting a
real answer is worse); the one new `child_process` use (`tests/e2e/ai-managed.mjs`) spawns a fixed
argv with no shell.

### 24.3 Controls the review confirmed (already in place)

- **Server.** httpOnly + SameSite=Lax + Secure session cookie with server-side revocation;
  double-submit CSRF; `timingSafeEqual` job-token comparison with a derived (never stored) token;
  `resolveWithin` for every work-dir path; streaming uploads with a per-*request* byte ceiling and
  sanitised basenames; anonymous quota keyed by a peppered IP hash with `trust proxy` set to a hop
  count; `helmet` with `default-src 'none'`; auth rate-limiting scoped to the two expensive routes and
  failing open only on a counter outage.
- **Client.** Key never in a URL (headers only, all three protocols), never to our API, never logged,
  masked in the DOM; base-URL and custom-header validation on read *and* write; no
  `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function` anywhere, no markdown renderer, no
  telemetry; agent loop bounded by turn cap, tool allowlist, cancellation, and a
  **user-Apply gate before any document mutation**.

### 24.4 P6 — E-sign / public REST API / MCP: opening plan

P1–P5 pass every gate and are **functionally** end to end ready, so P6 can open. §24 found four Highs,
so the plan opened with a short hardening interlude (now **done** — see P6.9) before the
identity-sensitive API and the agent-facing MCP server, which are precisely the surfaces that make
H1–H3 reachable at scale.

**Functional gate met 2026-10-16:** 837/837 unit · 101/101 + 8/8 + 18/18 + 11/11 browser E2E ·
bundle boundary holds · pre-push grep clean · §24 review: **no Critical, four High open** (all now
closed — see the P6.9 status below and §24.2).

- **P6.0 — Decision record (first, nothing built before it).** Signature form (draw/type/upload),
  what an "audit trail" actually attests to and what it does **not** (no eIDAS/ESIGN certification
  claim), where signature artifacts are stored, the API-key model (hashing at rest, scopes, rotation),
  and the MCP transport(s) — all written down like §18.1/§20.3.
- **P6.9 — Hardening interlude: close the §24 Highs.** Do this **before** P6.2/P6.3. H1 — stop the child
  inheriting the API's secrets and scope each child to its own `jobs/<id>`; H2 — a **parent-side** kill
  watchdog, not a cooperative timer; H3 — call `estimate()` as admission control and put
  `mem_limit`/`cpus` on the containers; H4 — rotate the on-disk credentials; plus M1–M3. **Gate:** a hung
  or oversized job is killed and the queue stays healthy; memory is bounded under a parallel flood; a
  child holds no secret. Extends P3's hardening gate (§11) from "survives a crash" to "survives abuse".

  **Status — done 2026-10-17 (five commits `f0f3bda`…`4d59d7f` plus M1/M3 and the container caps):**
  H1 env allowlist (`worker/child-env.ts`), H2 parent-side kill watchdog (`jobs/children.ts`), H3
  admission control + heap cap + `mem_limit`/`cpus`, M1 boot warning (`http/trust-proxy.ts`), M2
  `%PDF-` stream sniff (`uploads.ts`), M3 reserve-then-settle (`quota/quota.ts`). **Amended gate:** a
  child cannot read a *sibling's* directory is **not** claimed — the filesystem scope is accepted
  by design (§24.2, H1) because the processor needs `node_modules`. **H4 closed 2026-10-18** (§24.2's
  H4 entry); a fresh-secret rotation and a secrets manager remain deploy-time hygiene. Unit
  **862/862** now; the live Redis/Docker leg of the gate (`test:api`, `test:hardening`) still needs
  a running stack.
- **P6.1 — E-sign.** `szimek/signature_pad` (MIT, §2) for capture, its `toSVG()` → pdf-lib
  `drawSvgPath` for vector output, placement/fill through the P2 editor, ordered recipients, and an
  append-only audit record (document hash, signer identity, timestamps). **Gate:** a signature
  round-trips and re-extracts; vector path proven by test; no key material ever enters the document;
  a tamper after signing is detectable.
- **P6.2 — Public REST API.** API keys bound to an account, hashed at rest and shown once, scoped,
  with per-key rate limits and quotas on the existing P3 job contract; OpenAPI spec + docs. **Gate:**
  authn/authz matrix (missing/garbage/expired/revoked key, wrong scope), per-key isolation, and proof
  that anonymous tool access is unchanged.
- **P6.3 — PDFShush MCP server.** Expose the tool catalog to agents (design donor: GenOffice MCP,
  Apache-2.0), reusing the same job contract and the same server-side sandbox — **not** a new
  execution path. **Gate:** tool-schema parity with the registry (auto-checked), every job still runs
  inside the bounded worker, and no filesystem/network escape.
- **P6.4 — Hardening pass for the new surface.** Abuse cases for keys and signing, SSRF review for any
  URL a new tool fetches, and a rotation/revocation drill — folded into P7's torture suite.

**Still gated, unchanged:** **P4.4** automated triggers (SSRF + scheduling, §18.5) and **R2** text-level
redaction (not before R1 is proven in production, §20.3). P6 does not depend on either.

### 24.5 Findings backlog (owner phase)

| ID | Sev | Finding | Fix | Phase |
| --- | --- | --- | --- | --- |
| H1 | High | `fork()` "sandbox" inherits env + full filesystem | child env is now an **allowlist** (`child-env.ts`); **per-job FS scope accepted by design** (§24.2) | P6.9 — done |
| H2 | High | timeout is cooperative; no hard kill of a hung parser | parent-side kill watchdog (`jobs/children.ts`) | P6.9 — done |
| H3 | High | no admission control; no container memory/CPU cap | `estimate()` admission control + heap cap + `mem_limit`/`cpus` | P6.9 — done |
| H4 | High | live credentials on disk (gitignored, untracked) | dead values replaced with the verified-live pair; stray client JSON deleted; secrets manager at deploy | ops — **done 2026-10-18** |
| M1 | Med | a proxy IP collapses quota + AI budget + AI concurrency | boot warning when production trusts no hop (`http/trust-proxy.ts`) | P6.9 — done |
| M2 | Med | uploads are extension-checked only | sniff `%PDF-` from the upload stream before enqueue | P6.9 — done |
| M3 | Med | parallel uploads bypass the byte quota until `consume` | `reserveUpload`/`settleUpload` before streaming | P6.9 — done |
| L1 | Low | `POST /api/auth/logout` not CSRF-checked | token check in the route (shared `http/csrf.ts`); cookie-only POST is 403 | **P7.0 — done 2026-10-25** |
| L2 | Low | `/api/ai/chat` cross-site can burn a victim IP's trial | CSRF header required whenever a session cookie is present | **P7.0 — done 2026-10-25** |
| L3 | Low | oversized JSON body → 500, not 413 | `entity.too.large` → 413 already mapped in `http/app.ts` | **closed 2026-10-25 (verified, no code change needed)** |
| L4 | Low | unbounded `options` record (nested depth/keys) | structural bounds in `@pdfshush/api-contracts` (8 deep, 64 keys/object, 1024 values), used by `/api/jobs` and `/api/v1` | **P7.0 — done 2026-10-25** |
| L5 | Low | `text/html` entry in the result content-type map | dropped; `.html` falls through to `application/octet-stream` | **P7.0 — done 2026-10-25** |
| L6 | ✅ **closed 2026-10-18 (P6.2)** | logger redaction omits `cookie`/`apiKey`/`x-job-token` | extend the redact list | ~~P7~~ done in P6.2 (§25.3) |
| L7 | Low | AI budget reserves output tokens only | input estimate (chars/4 + flat per image) reserved and settled | **P7.0 — done 2026-10-25** |
| L8 | Low | AI concurrency guard is per-process | per-subject counter slot (300 s TTL) alongside the in-process set; degrades to per-process on a counter outage | **P7.0 — done 2026-10-25** |
| L9 | Low | `AccountStore.ownsJob` is dead code | **not dead**: `/api/v1` ownership calls it (`http/v1/routes.ts`) | **closed 2026-10-25 (verified)** |
| — | Low | **fixed in this review:** `redactSecrets` gaps (client) and the raw managed-gateway error (server) | §24.2 | done |

**Order:** **P6.9 hardening — done 2026-10-17** · **P6.0 decision record — done 2026-10-18**
(§25.1) → **P6.1 e-sign — done 2026-10-18** → **P6.2 public API — done 2026-10-18** (§25.3) →
**P6.3 MCP — done 2026-10-19** → **P6.4 hardening — done 2026-10-19** → **P7.0 reconcile — done
2026-10-25**. The §24.5 low backlog is closed; P7.1 (torture suite) is next.

---

## 25. P6 detailed plan — e-sign / public API / MCP (written 2026-10-18)

Plan for the four open P6 sub-phases (P6.9 is done, §24.4). This section supersedes the lost
session file `p6-sign-signature-pad.md`; the `szimek/signature_pad` decision itself was locked
2026-10-08 in §2 and is unchanged.

### 25.0 Decisions locked 2026-10-18 (author-confirmed)

1. **Signature assets are local-only (IndexedDB).** A saved signature (strokes or rendered
   PNG) never leaves the device in slice one; no account sync, no server copy. Deletion is a
   delete in the object store. Account sync may arrive later under the P4.2 sync boundary with
   its own review — do not pre-build it.
2. **E-sign slice one = Fill & Sign only.** Draw/type a signature, place it in the P2 editor,
   export a signed PDF with an honest audit note. Ordered recipients, routing and a server-side
   signature session model (`sign-workflow`) are **deferred to their own gate** — they need the
   public API/db layer and a much larger trust surface; do not smuggle them into P6.1.
3. **MCP transport = local stdio talking to the public REST API.** The server runs on the user's
   machine (`@pdfshush/mcp` bin) and calls `/api/v1` with the user's own API key; the key lives in
   their env/MCP client config, never on our servers. One execution path (P6.2's bounded workers).

**Pinned version:** `signature_pad@5.1.4` (MIT, zero runtime deps, SLSA provenance, TS 5.9
compatible; module + UMD exports). NOTICE attribution required in `licenses/`.

### 25.1 P6.0 — Decision record (completed 2026-10-18)

Written with the author. Items D2, D3, D4 and D6 carry the author's answers (§25.0 + this
session); the rest are technical calls recorded so nobody re-derives them. Per the
§18.1/§20.3 pattern:
**the record is the P6.0 deliverable — no code was built in this phase, by design.** Exits:
P6.0 done 2026-10-18; nothing in §25 relitigates without a strong reason.

- **D1 — What Fill & Sign attests to, and what it does not.** The flow produces an
  *ordinary electronic signature* someone chose to draw/type themselves. It does **not**
  certify identity, meet eIDAS advanced/qualified levels or ESIGN evidentiary standards, and
  we never claim so — not in UI copy, docs, or the audit note. The sidecar is *evidence the
  signer owns*, tamper-*evident* (a digest the signer can recompute), not tamper-*proof*,
  and it is not our infrastructure: PDFShush stores nothing (D3), so nothing can independently
  vouch for the signer. UI copy must say "keep the audit file together with the signed PDF".
- **D2 — The audit sidecar (author-confirmed: JSON sidecar, produced locally).** A
  `<output-stem>-audit.json` offered as a second download beside the signed PDF. Draft schema
  `pdfshush.audit-trail/1`: `source` (pre-signing digest + filename), `output` (post-export
  digest + filename), `signed` (`method: "drawn" | "typed"`, optional signer label, per-page
  placement rects, render kind raster/vector), `time` (ISO 8601 + `timeSource: "client"` — the
  clock is the browser's, stated in-band), `engine` (app version, engine, library version).
  Facts worth writing down: digests are SHA-256 via `SubtleCrypto`, which needs a secure
  context — if the context can't digest, the sidecar is **not** produced at all (fail-closed,
  with a visible message), never a digest-less sidecar. The signer label is sanitized: trimmed,
  ≤ 80 chars, control characters stripped; it is not a secret field. The sidecar contains
  filenames and stays on the user's disk — it is the P4.2 principle applied honestly: nothing
  uploads, so there is nothing to suppress.
- **D3 — Signature assets: local-only IndexedDB (author-confirmed).** New object store
  `signatures` in the existing client DB: `{ id, createdAt, label?, method, strokes?, png
  (Blob), width, height }` — `strokes` kept so a drawn signature can be re-rendered and later
  re-exported as vectors. Cap **5 assets** and **~200 KB per PNG**; deletion is per-asset with
  a confirm. The record shape is versioned (`strokesSchema: 1`) because it mirrors
  `signature_pad`'s `toData()` format, which the library may change across majors — mirror and
  version, never store library internals wholesale. **No account sync, no server copy** in any
  slice until a reviewed decision says otherwise (§25.0 #1).
- **D4 — Typed-signature font: bundle one OFL font (author-confirmed), chosen = Caveat**
  (Pablo Impallari, SIL OFL 1.1 — casual pen look, wide latin incl. diacritics coverage, single
  variable woff2 in the tens of kB in the lazy dialog chunk). License copy lands in
  `licenses/` with attribution. The font is a *preview and raster source* only — typed
  signatures are rendered to canvas (D3/§25.2), so no font embedding ever reaches the PDF and
  the export pipeline is identical for drawn and typed. Fallback stack `cursive`; if the
  bundled font fails to load, the Type tab disables with a visible message (fail-visible).
- **D5 — Public API v1 auth and key model.** Header: **`x-api-key` only** — no
  `Authorization: Bearer` scheme in v1, so API auth can never be confused with the browser
  cookie session in shared middleware. Key format `pshk_<48 base62>` (~285 bits), shown
  **once** at creation, stored as a SHA-256 digest + last-4 display fragment + name + scopes +
  create/last-used/revoked timestamps, owned by an account. V1 scopes: `jobs:write`,
  `jobs:read`, `results:read` (new keys get all three; per-key scope selection is a later
  addition — record the field now, enforce it now, expose choice later). **No AI scope in
  v1.** Revocation takes effect immediately (next request 403s); rotation = create new, revoke
  old, delete the old row after a grace window the operator chooses.
- **D6 — API quota tier (author-confirmed: API-tuned).** Per key: **500 tasks/day ·
  30 tasks/min · 5 GB/day**. Account ceiling (sum of its keys, daily + bytes only:
  **2,000 tasks/day · 10 GB/day**) so N keys cannot multiply past it. Anonymous tools keep
  §4's P3 policy untouched. Numbers live in the API limits config as the single source and
  appear verbatim on the `/tools/api` page; revisit after the first month of real keys.
- **D7 — MCP file transfer policy.** Tool inputs are `{name, base64}` inline, capped at
  **10 MB per file** — deliberately tighter than the 100 MB API multipart limit because MCP
  payloads flow through the agent's context, not just the wire; larger files are explicitly
  told to go via the REST multipart path with curl. Outputs return as `{files:
  [{name, base64}]}` mirroring the API's result shape. `PDFSHUSH_API_URL` is validated
  https-only at startup (the ported `urlErrorOutcome` guard); the package touches **no**
  filesystem and no other origin.
- **D8 — Security invariants that land with P6.2/P6.3 (not deferred to P7).** `apiKey`,
  `cookie` and `x-job-token` join the logger redact list the moment keys exist (this closes
  §24.5 L6 early); keys never ride URLs or query strings; per-key rate limits key on keyId,
  never IP (M1); API-submitted uploads pass the M2 `%PDF-` sniff unchanged; tool-schema parity
  is pinned in CI (§25.4), not asserted by hand.

**Explicitly not decided here:** pricing/tiers, teams/orgs, per-key scope selection UI,
R2 redaction (§20.3 gate) and P4.4 triggers (§18.5 gate) — all stay out of P6.

### 25.2 P6.1 — Fill & Sign (e-sign slice one)

**Scope:** capture → save/reuse → place → export, all client-side; the file never uploads.
New live slug: `fill-sign` (the `signature` editors-slug is the asset manager; ships in the same
slice as a small dedicated page).

**Capture — `components/tools/signature-pad-dialog.tsx`** (lazy chunk):
- Two tabs: **Draw** and **Type**. Draw is `new SignaturePad(canvas, { penColor, minWidth,
  maxWidth, velocityFilterWeight })` on a fixed max-size canvas.
- **DPI/resize discipline (from the README's tips, will bite otherwise):** canvas must be sized
  `offsetWidth × devicePixelRatio` (min ratio 1) with a `scale(ratio)` on the 2D context, and a
  resize handler must `signaturePad.clear()` or `redraw()` — a cleared-but-not-redrawn canvas
  makes `isEmpty()` lie. Test the dialog at both 1× and 2× DPR in E2E.
- **Undo / clear:** undo = drop the last point-group from `toData()` then `fromData(rest)`
  (the library's own jsfiddle pattern); `isEmpty()` gates the confirm button; `clear()` before
  re-draw.
- **Trim:** implement a ~30-line in-repo trim (scan transparent margins of the canvas) instead
  of adding `trim-canvas` as a dependency; it is the same math and keeps the dep tree flat.
  Trim before persisting *and* before export, or placed signatures carry giant dead margins
  and resist placement.
- **Type tab:** text → rendered onto the *same* canvas with the bundled handwriting font, so
  typed and drawn share one export pipeline (canvas → PNG bytes / stroke data).
- **Reusable asset:** dialog offers save; store picker lists previously saved signatures.
  Cap the store (proposal: 5 assets, ~200 KB PNG each + strokes JSON; strokes kept so a saved
  signature can be re-rendered and, later, re-exported as vectors). Delete per asset.

**Placement — P2 editor integration:**
- A "Signature" mode in the editor toolbar (and the `fill-sign` tool body lands the file
  straight in the editor with that mode pre-selected, plus a short "how signing works" panel).
- Click (or click-drag) on a page inserts an image object from the stored PNG at that spot;
  move/resize via the existing editor object handling; everything rides the snapshot
  undo/redo stack exactly like an image insert.

**Export — engine:**
- **Raster path (default, ships first):** the existing `edit` job unchanged — the PNG is just
  another embedded image object; export validation gate applies as it already does.
- **Vector path (feature-flagged, gated on tests):** `toSVG()` → parse the filled `<path>`
  segments → `@cantoo/pdf-lib` `drawSvgPath`, one path per stroke at export scale. Vector only
  for *freshly drawn* strokes (strokes JSON present), never for re-saving a raster asset as
  vectors (it would bake a raster under the path). If the round-trip test shows drift, ship
  raster and keep the flag off — do not hold the slice hostage to vector fidelity.
- **Audit note (D2):** a local `<stem>-audit.json` sidecar — source digest, output digest,
  timestamp (client clock, stated in-band), optional sanitized label, placements. Never
  informational PDF metadata. The UI copy says exactly what this is and is not (D1). No key
  material, no signature *image* in the note.

**Tests/gates:**
| Gate | How |
| --- | --- |
| signature round-trips + re-extracts | export → re-open → embedded image found on the target page at the placed rect |
| vector proven | flag-on test: stroke path operators present in the content stream; off: flag stays off |
| tamper detectable | digest-before-signing stored → flip a byte in the exported file → digest mismatch test |
| no key material | grep-level + code review; no field in the audit note accepts secrets |
| unit | trim math, store CRUD + cap, undo/clear semantics, sanitizer for the label text |
| browser E2E | open dialog, *inject stroke data via `fromData()`* (synthetic pointer events on a smooth-Bezier canvas are flaky — save pointer-path driving for one happy-path check), place with a fixed click point, export, `%PDF` assert; typed tab; asset delete |
| bundle | `pnpm test:bundle` extended: `signature_pad` must sit in the lazy dialog chunk, and reach neither the main chunk beyond that nor the worker |

**Also:** NOTICE attribution in `licenses/`; registry flips `fill-sign` (+ `signature`) to live;
smoke suite gains the fill-sign section.

> **Shipped 2026-10-18 (see the §8 entry for 2026-10-18 for the full record):** everything in the Capture,
> Placement, Export(raster) and Audit-note bullets plus the unit / browser E2E / bundle gates —
> trim math, store CRUD + cap, sanitizer (unit), real-stroke browser E2E (`tests/e2e/sign.mjs`,
> 17/17), `test:bundle` extended (0 pad modules in main; pad + Caveat in the 33 kB lazy chunk).
> **Still open:** the *vector proven* and *tamper detectable* rows (raster path shipped; the flag
> stays off until both rows land) and the smoke.mjs section (the dedicated suite covers the slice;
> retire-or-fold decision rides with P6.4).

### 25.3 P6.2 — Public REST API (`/api/v1`)

**Scope:** programmatic access to the server-runnable slugs over the P3 job contract. No new
execution path: the API keys submit into the *same* BullMQ pipeline with the same admission
control (P6.9), quotas and janitor.

- **Transport/router:** `apps/api/src/http/v1/` mounted in `app.ts`; `x-api-key` header only
  (D5); JSON request bodies + the existing multipart for large uploads.
- **Endpoints:** `GET /api/v1/tools` (catalog: slugs the API can run, each with its payload
  schema), `POST /api/v1/jobs` (`{slug, options, files?}` → `{jobId, statusUrl}`),
  `GET /api/v1/jobs/:id` (status/poll TTL), `GET /api/v1/jobs/:id/result`.
- **Key model (D5):** keys belong to an account; a key's quota is measured against the
  *key*, with the account ceiling from D6. Anonymous quotas and the P4 policy stay untouched.
- **Rate limiting:** per-key Redis counters (keyId, never bare IP — the M1 trust-proxy finding
  makes IP keyed limits meaningless behind a proxy), then the shared P3 quota path.
- **OpenAPI spec + `/tools/api` page:** spec generated from the payload zod schemas (the same
  schema the job `validate` uses — one source of truth); the `api` tool page renders catalog +
  curl examples and the key-management link. Docs must not claim slugs the API cannot run.
- **UI:** account dashboard API-keys page — create (shown once, with copy), list with
  last-used, revoke. Everything server-rendered-agnostic SPA like the rest of the app.

**Tests/gates:**
| Gate | How |
| --- | --- |
| authn/authz matrix | missing, garbage, expired, revoked, wrong-scope, right-scope; every verdict asserted |
| anonymous unchanged | the existing anonymous tool/job suites stay green untouched |
| per-key isolation | two keys, one account: key A's usage never counts against key B |
| throttle | per-key limit trips on the documented numbers (suite waits out the window first — §7 gotcha) |
| schema parity | `GET /tools` slugs == server-runnable job slugs, pinned like `JOB_SLUGS` |
| E2E | real stack (Redis + worker) end-to-end: create key → submit → poll → download; against the hardened pipeline, not a mock |

**Shipped 2026-10-18 — all six gates met.** The changed-versus-planned notes that matter for the
next session:

- **Keys:** `pshk_<43 base64url chars>`; stored `_id` = SHA-256 of the token (indexed lookup, no
  scan). `keys/store.ts` owns token minting/scoping; the `apiKeys` collection rides the auth Mongo
  db (`auth/mongo.ts`), management routes are `account/api-keys.ts` (session + CSRF), and account
  erasure deletes keys too.
- **Quota shape:** two `QuotaService` instances — per key
  (`apikey:<keyId>`, 30/min · 500/day · 5 GB/day) and per account
  (`apikeyacct:<accountId>`, 2,000/day · 10 GB/day, minute bound unreachable) — with a
  two-stage reservation and the refund base switching at the settle point (ceiling before the
  settle, real bytes after). The worker payload carries the same opaque `subjectId` shape the
  anonymous path uses; no key/account id ever enters Redis.
- **Workers note:** v1 carries no `/delete` (cancel stays a browser/x-job-token capability —
  bearer-key cancellation is a P6.4 question, not a P6.2 one).
- **Inline JSON:** `POST /jobs` accepts `{slug, password?, options?, files:[{name, data(base64)}]}`
  cap 10 MB/file (D7) with the PDF magic check applied before any disk write; multipart keeps the
  streaming anonymous path untouched.
- **Spec:** `z.toJSONSchema` (2020-12) at request time from `http/v1/schemas.ts` — the same zod the
  route validates; parity pinned in `test/v1.test.ts` (catalog ≡ `SERVER_SLUGS` ≡ `NODE_JOBS`).
- **Docs page:** `/tools/api` (registry-flipped to live) renders catalog/scopes/quota/curl from the
  deployed spec; the account page gained the API-keys panel (`components/account/api-keys.tsx`)
  with the one-time token reveal.
- **Real-stack verdicts:** smoke §6 ran the full key flow on Docker (Redis + worker + Atlas, auth
  enabled) — 202 accepted from inline JSON, real worker completion, byte-exact download, read-only
  key refused 403, revoked key refusing with the identical invalid-verdict. The harness seeds its
  account + session directly into Mongo (`PSH_SMOKE_MONGODB_URI`) so no Google round trip and no
  test back door in the app are needed.
- **D8/L6:** redact list extended (also covers `req.headers.cookie` wholesale). L6 closed ahead of
  P7 as planned.

### 25.4 P6.3 — PDFShush MCP server (`@pdfshush/mcp`, local stdio)

**Scope:** a small standalone package (`apps/mcp`) the user runs locally via npx/config; it
speaks stdio (modelcontextprotocol/sdk) and calls `/api/v1` with the user's own key.

- **Config:** env `PDFSHUSH_API_URL` + `PDFSHUSH_API_KEY`; the `mcp` tool page documents the
  Claude/other-client snippet. The server is stateless; nothing is stored on disk.
- **Tool surface:** one MCP tool per **server-runnable** slug, generated from the same zod
  payload schemas as P6.2's spec (so spec, tool page, and MCP share one source). File inputs =
  `{name, base64}` capped at the D7 limit (10 MB — agents pass payloads through context, not
  just the wire); outputs = `{files:[{name, base64}]}`. Plus `pdfshush://tools` resource + a
  guide resource per slug (the GenOffice `genoffice://guide/*` pattern).
- **Design donor — read first, Apache-2.0, already local:**
  `genoffice-main/packages/cli/src/mcp/` — `tools.ts` (`toolShape`, param/inline-json kinds),
  `remote.ts` (`materializeInputs`, `attachOutputs`, `urlErrorOutcome`), `server.ts`
  (`INSTRUCTIONS` / `remoteInstructions`). Adapt the shapes, attribute in `licenses/`;
  `urlErrorOutcome` is the SSRF guard for the configured base URL — keep an equivalent
  (https-only base, no path escape) when porting.
- **Parity + no-escape gates (from §24.4):**
  | Gate | How |
  | --- | --- |
  | tool-schema parity | generated MCP tool list pinned to the server-runnable slug set in a unit test (drift fails CI) |
  | bounded execution | every call lands in the same BullMQ worker/limits path — the MCP package ships no engine, imports no pdf-core job implementation |
  | no fs/network escape | the package touches the configured base URL only; https enforced; unit test hits a wrong-URL case and asserts the refusal |
  | stdio E2E | drive the bin over a spawned child with a fake-API harness: list tools → call one → get files back |

**Shipped 2026-10-19 — all four gates met.** Notes for the next session:

- **One source made structural:** the v1 zod contracts live in `packages/api-contracts` now; apps/api
  reads them via two re-export shims (`jobs/payload.ts`, `http/v1/schemas.ts`) and `keys/store.ts`
  re-exports `API_KEY_SCOPES`. Node behavior unchanged; the container image bundles the package the
  same way it bundles pdf-core/ai-provider (esbuild `--alias` in all three build steps + deps-stage
  manifest COPY + build-stage source COPY in `infra/docker/api.Dockerfile`) — without that the
  runtime import of a TypeScript main is an instant `ERR_MODULE_NOT_FOUND`.
- **Where the tools come from:** `apps/mcp/src/tools.ts` picks `{password, options, files}` out of
  `apiCreateJobSchema` and describes each field — the validators are the contract's, exactly; the
  slug never travels in the arguments. `run.ts` owns submit → poll → result → content blocks;
  inline output caps (4 MB/file, 8 MB total) turn into honest resource links past the line.
- **Anatomical honesty in the guides:** `src/guides.ts` read the option vocabulary out of the
  pdf-core job sources; the `edit` guide states the image-over-JSON limitation — keep it in sync if
  a decode is ever added.
- **Config posture:** http outside loopback requires `PDFSHUSH_ALLOW_HTTP=1`; missing key exits
  with dashboard instructions; the package's only `fetch` lives in `src/api.ts`.
- **What was *not* done on purpose:** no seeded-real-key MCP walk (the spawned-bin fake-API E2E plus
  a live 401 probe through stdio were the gates; P6.4 may add the seeded variant), no npm publish
  story (the `bin` is workspace-local; distribution is a P7 question). Attribution for the donor
  design: `licenses/pdfshush-mcp-donor-NOTICE.txt`.
- **Flaky-infrastructure lesson:** `tests/e2e/ai-managed.mjs` can leave its own server listening on
  `0.0.0.0:8080` after an interrupted run — a leaked listener wins IPv4 over the Docker publish and
  silently answers `127.0.0.1` probes with 503 `auth_disabled` while the real stack answers on
  `localhost`. `Get-NetTCPConnection -LocalPort 8080 -State Listen` before trusting any local-port
  probe.

**P6.4 review found and fixed (2026-10-19):** the P6.3 config work left one real hole —
`resolveBaseUrl`'s forbidden-character class was anchored (`/^[…]/`), so `< > " ' \` \\ ~ ^ | { ? # }`
were only ever refused as the **first character** of the URL. In practice WHATWG parse errors and the
unanchored control-char alternative masked that — but `https:\attacker.example` parsed fine (WHATWG
folds backslashes into slashes on special schemes → a smuggled `attacker.example` host). The class now
matches anywhere and includes the percent-smuggled `?`/`#` introducers (``[\x00-\x20\x7f<>"'`\\~^|{}?#]``),
asserted by `test/base-url.test.ts > refuses origin-smuggling shapes`. Every earlier case in the file
still passes — the refusals just no longer depend on which end of the string the crook sat at.

### 25.5 P6.4 — hardening pass for the new surface

Key-abuse cases (stolen key = reduced-quota anonymous-equivalent abuse model, scope
enforcement, rotation drill), signing-abuse review (audit-note tampering, pad memory), SSRF
review of anything that fetches URLs (MCP base URL, any future URL-fetch tool), and the
M2-style stream sniff for API-submitted multipart. Findings feed §24.5's backlog and P7's
torture suite; expected to be short because P6.2/P6.3 reuse hardened paths.

**Done 2026-10-19.** The pass stayed short as predicted, but it caught one real hole (the anchored
character class above, fixed + tested) and turned four reviews and one drill into recorded verdicts:

1. **Rotation / revocation drill — pinned as tests** (`apps/api/test/v1.test.ts`):
   a minted *replacement* key inherits the account — it polls and downloads a job the revoked key
   created (ownership is account-scoped, so rotation never orphans paid-for results) and keeps
   submitting with its own counters; the revoked token answers 401 exactly like a never-seen one on
   every endpoint, with no queue trace. Stolen-key model recorded: a key is a bearer credential —
   theft is invisible to us by design, and the whole model is (a) per-key quota so one stolen key
   cannot pre-pay the family ceiling, (b) instant revocation, (c) identical verdicts for
   revoked/invalid so revocation leaks nothing, (d) rotation costs the abuser the results but not
   the account its history.
2. **M2-style stream sniff over API-submitted multipart — pinned as tests:** the v1 multipart branch
   demonstrably runs the same `receiveUpload` guards (`test/v1.test.ts > v1 multipart rides the
   anonymous stream guards`): a flagged multipart submission is accepted into the same queue shape
   with an opaque subject, non-PDF magic bytes are sniffed from the streaming write (400
   `validation_failed`, nothing enqueued), the per-request ceiling caps mid-stream (413 after a
   reserve that passed), and a flooding key whose `bytesPerDay` tier is below the ceiling is refused
   at reservation time before any byte reaches disk (429).
3. **SSRF review — no new defence needed, one hole fixed, inventory written down.** Server egress
   inventory: `apps/api` fetches nothing URL-shaped from users (grep: zero `fetch(` in `apps/api/src`;
   the worker child has none either); `auth/google.ts` uses fixed issuer/token/JWKS constants; the
   managed-AI proxy's provider `baseUrl` is deployment config, never request data; BYOK runs
   browser-direct to the user's own endpoint (no allowlist, recorded as accepted in §24.2). The MCP
   package's only egress is the boot-validated base URL — the single place a hostile string could
   matter, and where the anchored-class hole lived. Future URL-fetch tools (P4.4 triggers, §18.5)
   remain gated on an SSRF design before they exist.
4. **Signing-abuse review — accepted with disclosed limits (matches D1/D2, no code change).** The
   audit sidecar is a client-built JSON note, not a certificate: anyone holding it can rewrite the
   `signerLabel`/`time` fields, and the review confirms the schema neither hides nor advertises more
   than that — `certified: false` with a plain-language note. Tamper detection is exactly the
   recomputable `output.digest` (§20-style independent verification, device-side SHA-256, fail-closed
   when SubtleCrypto is absent — a re-signing of the *same* document by an attacker produces a fresh
   valid-looking note, which is the honest boundary of an unkeyed digest). Pad memory: exports keep
   the capture canvas device-local, saved assets live in the `signatures` IndexedDB store behind DB v3
   with the existing one-click delete; no signature material is transmitted except inside the
   `edit`-job payload the user deliberately submits.
5. **Vector-signature flag — dropped explicitly (§25.6 order item 2 resolved).** No flag ever shipped:
   slice one export is raster-only, the audit schema's `renderKind` field is the only vector
   accommodation, and P6.9's "behind a feature flag" wording described an intention, not code. The
   decision is recorded rather than left silently open: **raster is the shipping path; vector returns
   to *P7* only with a round-trip fidelity test written first** (`toSVG()` → `drawSvgPath`, fresh
   strokes only, never re-vectorizing a raster asset). No dead flag remains in code or docs.

### 25.6 Order

1. **P6.0 — done 2026-10-18** (§25.1: the record is written; D1–D8 stand).
2. **P6.1 — done 2026-10-18** (code shipped, gates green; §8 entry for 2026-10-18. Raster export ships; the
   vector path remains behind the §25.2 flag until its round-trip test is written — revisit within
   P6.4's window or drop it explicitly rather than leaving it silently open).
3. **P6.2 — done 2026-10-18** (code shipped, all six §25.3 gates met, §8 entry for 2026-10-18) →
   **P6.3 — done 2026-10-19** (`@pdfshush/api-contracts` + `@pdfshush/mcp` + `/tools/mcp`; §25.4
   gates all green, §8 entry).
4. **P6.4 — done 2026-10-19** (§25.5: rotation drill + multipart-sniff matrix as tests, the
   base-URL smuggle class fixed and pinned, SSRF + signing-abuse reviews recorded, **vector
   signature dropped explicitly to P7 behind a round-trip fidelity test** — the "revisit within
   P6.4's window" clause is resolved, not left open).

**Expected surface after P6:** `fill-sign` + `signature` live (18–20 live tools - **this part is**
**already true**; `api` and `mcp` pages flip to real docs), one new package (`apps/mcp`), one new
router (`v1`), one new IndexedDB store (**shipped**, `signatures` at DB v3), signature_pad as the
slice's only new runtime dep (**shipped**).

## 26. Groq BYOK + OpenRouter managed default + AI onboarding (2026-10-21)

**Goal:** the full AI suite must be reachable for free and for non-experts — register Groq as a
BYOK provider (its permanently free no-card tier: 30 RPM / 14,400 requests/day), point the managed
trial at OpenRouter, and give users who have never bought an API key a plain-English walkthrough.

**Shipped this session:**

1. **Groq provider** (`packages/ai-provider`): `'groq'` in the `AiProviderId` union, a catalogue
   entry (label `Groq`, default `openai/gpt-oss-120b` — reasoning + tool calling + 131k context at
   $0.15/$0.60 per 1M, chosen against "agentic, intelligent, cost-effective"; the
   Enterprise-only `llama-3.*` ids are deliberately not listed — those 404 for ordinary keys), an
   adapter (`openai-compatible`, `https://api.groq.com/openai/v1`,
   `useMaxCompletionTokens: true` — Groq answers 400 on the renamed-field-less shape), and
   conservative provider-level vision (`false`): the production catalogue is text-first, so
   screenshots never reach it. Pinned by `test/groq-capabilities.test.ts` (6 checks: registration,
   endpoint resolution, regional base URL, vision refusal, untouched default provider, a streamed
   turn with `max_completion_tokens` on the wire).
2. **Provider cost tiers** (`AiProviderMeta.tier?: 'free' | 'budget'`, rendered by the settings
   picker): Groq + OpenRouter tagged `free`, DeepSeek + GLM tagged `budget`. Tags are declared
   facts the picker renders verbatim — no heuristic pricing.
3. **Managed route on OpenRouter** (`apps/api/src/config.ts`): `AI_MANAGED_PROVIDER` default
   `openai` → `openrouter`; `AI_MANAGED_MODEL` default → `minimax/minimax-m3.1-flash:free`
   (verified live 2026-10-21: 404 on `openrouter/free` — the requested intent, resolved to the
   strongest currently-serving free id, intelligence index 42.7 / 1M context / $0; the
   `:free` line-up rotates, so `AI_MANAGED_MODEL` stays the override lever). The managed verdict
   is now: **on whenever a deployment sets only `AI_MANAGED_API_KEY`** — the model default stands
   in so one variable turns the trial on. Budgets/concurrency untouched.
4. **AI welcome overlay** (`apps/web/src/components/ai/ai-welcome-overlay.tsx` +
   `lib/ai/welcome.ts`): a three-step, plain-English first-run walkthrough shown full-screen the
   first time an AI surface (`ai-workspace.tsx`, `redact-tool.tsx`) opens with BYOK started and no
   key anywhere — *what a key is* ("like a password that tells the AI 'this person is allowed'"),
   *get a free one* (four numbered moves + an auto-selecting Groq provider), *paste & save*
   (through the same `onSave` pipeline; never a direct credential write). Escape and
   "skip for now" always available; "Too much? Use ours" flips managed mode when the deployment
   offers it. Motion walks the existing contract (`lib/motion.ts` tokens, per-component scope via
   `useMotionScope`, transform + opacity only, zero duration under reduced motion — an entrance
   timeline, step reveals, a focus pulse, a save flash). Overlay fires once per browser
   (`localStorage` marker — a UI preference, deliberately not IndexedDB: the key store stays
   key-material-only); the 350 ms open delay lets the IndexedDB hydration race decide, so a
   browser that already had a key never sees it blink.
5. **E2E coverage**: `test/dismissAiWelcome` in `tests/support/e2e-util.mjs`; `ai-managed.mjs` and
   `smoke.mjs` (redact flow) dismiss the overlay first — a fresh profile trips it there;
   `ai.mjs` seeds a key so the seeded flows are unaffected, and **gains a 5-check block** in a
   keyless context: overlay opens, the password analogy copy holds, step 2 offers the walkthrough,
   dismiss works, and a reload never shows it again.

**What was *not* done on purpose:** Groq is not the default provider — the user's key, the user's
decision; the walkthrough merely presents a free path. No media/image-generation wiring (Groq has
none). `openrouter/free` was specified by the product owner but does not exist (404); the recorded
resolution is the live free-slug fallback above.

## 27. Structured text editing — Phase 1 (2026-10-31)

**Goal:** replace “hit a raster run, paint a box over it” with a real document model the editor can
reason about — without starting the Phase 2 native content-stream rewrite.

### 27.1 Architecture

- **Model in `@pdfshush/pdf-core`, not React.** `packages/pdf-core/src/document/` has no DOM,
  Fabric, pdf-lib or pdf.js import. It is plain serializable data, safe to send across the worker
  boundary and to snapshot in history.
- **Two coordinate frames on every object.** `bbox`/`quad` are display space (top-left, y down,
  points at 100% zoom); `pdfBox`/`pdfQuad` are PDF user space (y up). `PageGeometry` is the only
  conversion engine (PDF↔view→screen, zoom, DPR, rotation, CropBox/MediaBox), reusing the tested
  `ops/geometry.ts` formulas.
- **Deterministic ids.** FNV-1a over page/text/quantized geometry, so re-extracting a page yields the
  same ids and an edit still points at the same logical object.
- **Six-level hierarchy.** `glyph → word → line → paragraph → block → region`, with reading order,
  per-level confidence and an `ambiguous` flag. Low-confidence groupings are preserved and flagged,
  never silently flattened.
- **Extraction is adaptive.** Baseline/alignment/gap/indent/font/column heuristics; heading levels;
  nested list levels clustered from real marker indents; table cells; repeated header/footer
  classification across pages; rotated text; multi-column gutters guarded by vertical span so a table
  is not mistaken for a column.
- **Interaction model.** `PageInteractionModel` builds spatial grids for glyphs/words/lines/
  paragraphs/blocks/regions, resolves the deepest target first, maps carets to paragraph offsets and
  back, and produces rects for word/paragraph/cross-paragraph selection.
- **Editing state is separate.** `TextEditSession` owns draft text, selection, and its own undo
  stack; the document model stays immutable. Committing produces a serializable edit intent.
- **One parse, two outputs.** `text-runs` keeps its existing `{ runs }` contract and gains optional
  `{ layouts }` when `includeLayout: true`, produced from the same `getTextContent` pass.
- **Frontend overlay, not Fabric.** `TextLayer` uses the model for hover/selection/hit testing; the
  actual typing surface is a native `<textarea>` (caret, word/character selection, drag selection,
  clipboard and native undo come for free). Commits reuse the existing whiteout + text-object save
  path, so redaction, AI and every other tool are untouched.

### 27.2 Files

Engine: `packages/pdf-core/src/document/{types,geometry,ids,glyphs,group,document,hitTest,editing,index}.ts`,
`packages/pdf-core/src/render/textLayout.ts`; refactor in `src/render/textRuns.ts`; job extension in
`src/jobs/textRuns.job.ts`; root exports in `src/index.ts`.

Web: `apps/web/src/components/editor/text-layer.tsx`,
`apps/web/src/lib/text-editing.ts` (+ `.test.ts`), integration in
`apps/web/src/components/editor/editor-page.tsx` and
`apps/web/src/components/tools/edit-pdf-tool.tsx`.

Tests: `packages/pdf-core/test/textModel.test.ts` (19 checks) and
`apps/web/src/lib/text-editing.test.ts` (10 checks).

### 27.3 Capabilities shipped

- Hover highlighting; single-click block select; triple-click paragraph select; double-click inline
  edit; drag selection; word selection; cross-paragraph selection. These live in the **Select** tool.
- Copy / cut / paste / Delete on the extracted selection; Enter/Backspace/Delete in the inline editor;
  native textarea undo; document-level undo/redo for commits, cuts, pastes and destructive deletes.
- Add Text is preserved: empty-space drag still creates a new text object, and an existing text
  object still wins over the paragraph underneath. The **Text** tool also keeps its legacy
  single-run replacement path (genuine in-place rewrite when possible).
- Paragraph edits become one whiteout per original line plus one text object, replacing previous
  objects for the same paragraph, in one undo step.
- Layouts are fetched incrementally per visible page (and warmed around the current page); pages stay
  memoized; no full-document scan just to open the Select tool.
- Rotated text is detected, selectable and copyable. Inline editing is refused with an explanation
  rather than drawing horizontal text over vertical text.

### 27.4 Verified

- `pnpm -r typecheck` — all workspace packages.
- `pnpm test` — pdf-core 339/339, web 39/39, api 208/208, mcp 19/19, ai-agent 152/152,
  ai-provider 370/370.
- `pnpm build` — production web build succeeds (existing >500 kB chunk warning only).
- `node tests/e2e/text-edit.mjs` — the legacy true in-place rewrite path still passes every check
  (run replacement, no overlay claim, original gone from the exported bytes).
- `node tests/e2e/text-model.mjs` — hover, block select, inspector preview, double-click editor,
  prefilled text, commit objects, save + download + re-parse, no console errors.
- Manual browser pass: multi-line paragraph hover/edit/commit, list item marker preservation,
  two-column page, text drag selection, Ctrl+C/Ctrl+X/Ctrl+Z, Add Text, save + re-parse + download,
  and a `/Rotate 90` page (hover alignment works; edit is refused).

### 27.5 Honest limitations

- Paragraph commits are **overlay replacements**, not native rewrites: the original text remains in
  the content stream under the whiteout (verified in the exported file). Search/selection can still
  find both strings until Phase 2.
- Whiteouts are white; coloured/tinted backgrounds and coloured text are not sampled. Replacement
  colour is dark by default.
- The exporter has no per-object rotation, so rotated text editing is deliberately blocked.
- Cross-page drag selection is not implemented (within-page cross-paragraph is).
- Justified paragraphs are approximated as left-aligned; line height for the overlay follows the
  extracted leading while the exporter draws at its own 1.2 line-height.
- Glyph positions are estimated by distributing pdf.js item widths; caret placement is stable but
  not glyph-exact for exotic fonts/kerning.
- `pdf-chisel` was not confirmed MIT (no licence file/SPDX detected); only `pdf-edit-engine` and
  `PdfZero` were confirmed MIT. No donor code was copied wholesale.

### 27.6 Phase 2 integration points

1. **Native rewrite sink.** `ParagraphTextEdit` (`before`, `after`, `bbox`, `pdfBox`, `typography`,
   `role`) is the intended input to the existing PDFium text-edit engine. Replace the
   whiteout+overlay commit in `appendMutationObjects` with a native rewrite when the paragraph can be
   anchored, keeping the overlay as the verified fallback.
2. **In-place run fallback already exists.** `EditTextObject.inPlace` remains wired in the save path;
   per-run replace can use it while paragraph-level work moves to the native sink.
3. **Extend the model, not the UI, for tables/lists.** Table/list metadata is already on paragraphs,
   blocks and regions; a Phase 2 table editor can address cells by id without re-parsing.
4. **Rotated/vertical text** becomes editable once the exporter or native sink carries rotation.
5. **Visual fidelity:** sample local background colour for covers and text colour from the raster or
   content stream; carry line-height/justification into the export object.
6. **Cross-page selection** can reuse `DocumentLayout.readingOrder`; the current interaction model is
   page-local by design.
7. **Confidence-driven review:** `ambiguous` / low-confidence paragraphs are already flagged; surface
   them in the inspector rather than guessing.

**Next move:** Phase 2 is now implemented — see §28. The Phase 1 overlay remains the declared
fallback and the reconstruction path.

## 28. Native PDF editing, reflow and fidelity engine — Phase 2 (2026-10-31)

**Goal:** turn the Phase 1 model into a dependable editing engine with an explicit
fidelity ladder, not a universal whiteout. The existing PDFium engine (§22) was
extended, not replaced.

### 28.1 Editing ladder

`TextEdit` now carries an optional `strategy` and multi-line `layout`. The engine
resolves every edit in this order:

1. **Native object** (`in-place`): PDFium rewrites the document's own text
   object(s) with their font, matrix, size, colour and render mode.
2. **Content stream** (`content-stream`): when native matching is impossible and
   the font encoding is fully understood, rewrite the grounded `Tj`/`TJ` string
   in the page content stream, preserving every surrounding operator.
3. **Localized reconstruction** (`fallback`): the caller's whiteout + text box,
   with the substitute font and fidelity disclosed in the report.
4. **Manual review** (`manual-review`): no safe path; the save fails closed.

Deletions are special: a failed native/content-stream deletion is refused, never
covered cosmetically.

### 28.2 Native adapter and reflow

- `textedit/pdfium.ts` now exposes font facts (`FPDFFont_*`), object matrices,
  fill colours, render modes, page-object bounds and a safe text-object creator.
  It records `lastCreateError` so a refusal is explainable.
- `textedit/engine.ts` adds `planLayoutEdit` + `applyLayoutEdit`: match every
  original line, measure the replacement with the document font's glyph widths,
  wrap to the requested width, reject page/collision violations, rewrite original
  lines, remove surplus lines and create overflow lines with the original font.
  Creation is all-or-nothing; a failed overflow line demotes the edit instead of
  leaving a half-paragraph.
- `textedit/fonts.ts` classifies fonts from descriptor flags/names, computes
  explicit standard-font substitutes and fidelity, detects missing glyphs, and
  never calls a non-embedded custom font exact.
- `document/reflow.ts` is the pure wrapping/overflow/collision layer.

### 28.3 Capability and OCR/scanned support

`inspectDocumentCapabilities` reports per page:

- text objects in display space, font descriptors, font sizes and render modes;
- object counts (text/image/path/form/unknown);
- text layer classification `native` / `ocr` / `mixed` / `none`;
- `likelyScanned` when images exist and no text layer does.

`text-runs` can return these alongside layouts; the editor's block inspector
shows native/OCR/scan status. Invisible OCR text is rewritten natively with
render mode 3 preserved. For an image-only page, the capability is manual review:
there is no text object to rewrite. The repository has no OCRmyPDF/Tesseract
runtime, so full image-to-text OCR is **not** claimed here.

> **Superseded 2026-11-08.** An in-browser Tesseract runtime now exists as the
> separate `ocr-pdf` tool (§8); this section describes the editor's text model,
> which still does not recognize scans in place. Run OCR first, then reopen the
> result here.

### 28.4 Content-stream safety rules

`textedit/contentStream.ts` deliberately supports a narrow, provable subset:

- simple fonts with a document-derived charcode map (Type0/CID refused);
- a single matching show operation per edit (ambiguity is refused);
- single-string `Tj`/`TJ`/`'`/`"` forms, no inline images;
- no deletions and no reflow (those need native object creation);
- replacement must fit the original box; wider text is refused.

The original operator bytes outside the replaced string are copied verbatim, and
the result is reopened/re-extracted by the final gate.

### 28.5 Export and visual verification

`verifyExportArtifact` reopens both documents and checks:

- page count and page geometry;
- annotation/link entry counts;
- font resources (base names preserved; no invalid references);
- replacement text via the product's own reader;
- rendered pixels outside declared edit regions (when a canvas exists).

The native layout planner records the applied region (including new lines) so
safe reflow is not mistaken for outside-page damage. Node tests use
`@napi-rs/canvas` (MIT, dev-only) for a real pixel diff; browser workers use
OffscreenCanvas.

### 28.6 Files

Engine: `textedit/{pdfium,engine,types,fonts,capabilities,contentStream,exportVerify}.ts`,
`document/reflow.ts`, `jobs/{textEdit,textRuns}.job.ts`, `ops/edit.ts`, root exports.
Web: `lib/text-editing.ts`, `components/tools/edit-pdf-tool.tsx` (native plan
metadata, save-path derivation, capability status).
Tests: `test/{textEdit,reflow,fonts}.test.ts`, `tests/e2e/text-model.mjs`.
Licence: `licenses/napi-rs-canvas-MIT.txt` (new dev-only dependency).

### 28.7 Verified

- `pnpm -r typecheck` — green.
- `pnpm test` — pdf-core 362/362, web 39/39, api 208/208, mcp 19/19,
  ai-agent 152/152, ai-provider 370/370.
- `pnpm build` — green (existing >500 kB chunk warning).
- `node tests/e2e/text-model.mjs` — Select-tool hover/select/edit/save; native
  replacement, original glyphs absent.
- `node tests/e2e/text-edit.mjs` — existing run-level true in-place path.
- Benchmark (Node): 20 pages / 100 native edits, **240 ms**, 100% in-place.

### 28.8 Known limitations and remaining risks

- **Overflow line creation is not universal.** Some PDFium builds reject
  `FPDFPageObj_CreateTextObj` for a document-standard font pointer even though
  the same font rewrites existing objects. The edit then demotes to the declared
  overlay; the report says so. The PDFium engine has no embedded-font test corpus
  beyond generated fixtures yet.
- **Content-stream support is intentionally narrow**: simple fonts only, no
  CID/CMap rewriting, no font-resource creation, no deletions/reflow, and no
  inline images.
- **OCR engine absent.** OCR layers are detected and protected; image-only scans
  are manual-review. No Tesseract/OCRmyPDF binary exists in this repo.
- **Visual verification is browser/Node-with-canvas only.** In a canvas-free
  runtime it reports the check as skipped rather than pretending.
- **Export pixel tolerance**: 0.5% outside the declared regions, 24/255 channel
  tolerance. A deliberate change outside the region fails; heavy font raster
  re-encoding could still be a false positive on exotic pages.
- **Cross-page selection and downstream block reflow** remain out of scope; the
  engine does not move neighbouring paragraphs.
- **PDFium heap safety** is worker-isolated; a WASM abort terminates that job,
  not the tab. The PDFium adapter owns/frees every pointer it allocates.
- **Licensing:** `@napi-rs/canvas` is MIT and dev-only; PDFium/embedpdf notices
  already exist in `licenses/`. No PDF Chisel code was copied (no licence file
  was present upstream), and no AGPL/GPL dependency was introduced.

### 28.9 Hardening pass (2026-10-31)

- Partial native reflow failures are now `LayoutMutationError`s and fail the
  export instead of allowing an overlay to duplicate surviving lines.
- Text objects are included in reflow collision checks.
- Content-stream array parsing refuses unexpected tokens.
- Visual verification declares the union of original and replacement line boxes.
- The browser paragraph E2E uses a pdf-lib fixture and asserts native replacement
  (`replaced in place`) and original-glyph removal.
- Security review: no injection sinks, secrets, path leakage, or redaction-path
  changes; `pnpm audit --prod` still reports only the pre-existing `zod` and
  `body-parser` advisories.
- Commit: `fb1c598` (`feat(editor): native reflow, content-stream fallback and
  export verification`).

### 28.10 Adversarial reliability audit — Phase 2.5 (2026-11-01)

Phase 2 shipped the ladder; Phase 2.5 attacked it. The pass built an adversarial
corpus, probed real PDFium behaviour before trusting documentation, and fixed only
defects the probes actually reproduced. Phase 3 was not started.

**Method.** Baseline first (`pnpm -r typecheck`, `pnpm test` green). Then throwaway
probe tests exercised each ambiguous behaviour on the real WASM build before any
deliverable test or fix was written — the probes established *actual* PDFium
behaviour (e.g. a `/Differences`-only subset font round-trips natively, so the
"PDFium mis-encodes `setText`" suspicion was **not** reproducible and nothing was
"fixed" for it). Probes were deleted before delivery; their fixtures were folded
into the corpus.

**Confirmed defects fixed.**

1. **Verification could pass a no-op artifact (D1, highest risk).** `verifyTextEdits`
   only checked that the replacement string was *present*. If that string already
   existed on the page (a common redaction target, e.g. `REDACTED`), handing back the
   *original* bytes passed. Deletions had **no** post-export absence check at all.
   Fix: `TextEditExpectation` gained an optional `find`, and `verifyTextEdits` gained
   an optional `original`; a new `residual-original:<label>` check counts occurrences
   of the original text before and after and fails when the edit did not consume it.
   The engine now passes `find` + `original` at both the stage-2 and final gates, so a
   no-op in-place write is demoted (non-layout) or hard-failed (layout), and a deletion
   that left its text behind fails the export. Overlay edits do not carry `find` (the
   original is still readable under the whiteout) and reflow edits do not either (a
   paragraph rewrites many objects), so neither produces a false failure.
2. **Legitimate multi-font collapse was refused (D2).** A line split across two fonts
   (`Invoice ` in Helvetica + `number 42` in Courier) is correctly rewritten as one
   run in the first font, which removes the Courier object; the `font-resources` check
   then flagged "missing Courier" and refused a correct edit. Fix: the native pass now
   records the base names of fonts whose last text object it removed
   (`NativeTextEditResult.consumedFonts`), and `verifyExportArtifact` tolerates exactly
   those. A font no edit touched disappearing still fails (negative-control test).
3. **Deleting the only run on a page was refused (D3).** Same root cause: after a
   correct deletion the page legitimately has no fonts left, which the check read as
   "no font resources". Fixed by the same consumed-font tolerance.
4. **Encrypted documents could not be edited (D4).** The final gate reopened the
   output with `loadPdfDocument` *without* the password, so verification always failed
   with "the exported document did not load: No password given". `verifyTextEdits` now
   accepts a `password`, uses it for both the original and the output reintroduction
   (and for the residual re-read), and the engine forwards it at both gates. A
   password-protected fixture now edits in place and verifies.

**Verified boundaries (probed, not changed).** CID/Type0 fonts with a `/ToUnicode`
are natively editable via charcode inversion; a CID font *without* `/ToUnicode`, and
non-embedded custom fonts (`createTextObject` fails), demote honestly; opaque
content-stream string forms (escaped parens, octal, hex) are refused by the
content-stream strategy but still edit natively; rotated (90°) and `CropBox` pages
edit in place; translucent text keeps its `ExtGState` alpha through the native
rewrite (darkest pixel 204/204 before and after).

**Cosmetic/latent fixes.** Removed a dead ternary (`… ? 'fallback' : 'fallback'`) in
the strategy branch, and fixed the pixel-difference loop to index each render with its
own row stride instead of the shared minimum (latent, only bites if the two renders
ever differ in width).

**Regression tests added (27).** `test/textEditCorpus.test.ts` (12): subset fonts with
and without `/ToUnicode`, unencodable CJK refusal, CID with/without `/ToUnicode`,
rotation, `CropBox`, the three opaque string forms (content-stream refusal + native
success), multi-font collapse incl. consumed-font assertion, and sole-run deletion.
`test/textEditGates.test.ts` (15): no-op artifact detection, deletion absence
(positive + negative), replacement-contains-find skip, uncountable-original skip,
multi-consumption counting, the D2/D3 font tolerances with a negative control,
encrypted-document edit + verification, concurrent runs, cancellation before WASM
work, and 20 open/edit/close cycles.

**Result.** `pnpm -r typecheck` green, `pnpm test` **1177/1177** (pdf-core 389, api
208, web 39, provider 370, agent 152, mcp 19), `pnpm build` green, `pnpm test:bundle`
green. (The api `v1` suite hit a one-off Windows `EPERM … rmdir` on a temp dir during
a full run; it passes in isolation and on a clean re-run — a filesystem flake, not a
logic change.)

**Remaining limitations (unchanged by this pass).** No OCR engine; CID fonts without
`/ToUnicode` cannot be rewritten natively; content-stream matching is byte-literal so
escaped/octal/hex show operators fall through to native rather than being rewritten
in the stream; visual verification needs a canvas and reports *skipped* otherwise;
cross-page selection and neighbouring-block reflow stay out of scope.

---

## 29. Advanced document intelligence — Phase 3 (2026-11-02)

**Goal.** Make the layout model's inferred structure *measurably* better and its
confidence *informative*: hierarchical grouping (glyph → word → line → paragraph →
block → region → document), layout relationships, typography/glyph intelligence,
table quality, OCR/mixed-document awareness, and incremental analysis — without
touching the editing strategies Phase 2 proved, and without a new AI dependency.

### 29.1 Method: audit → baseline → fix → re-measure

Nothing was changed before a number existed. The pass first built a benchmark, then
read the numbers, then fixed only defects the numbers or the real documents exposed.

- **Held-out synthetic corpus** (`test/corpus/synthetic.ts`): twelve document shapes
  (prose, indented/APA prose, heading ladder, lists, two-column, 4×4 table, 2×3 table,
  page furniture, wrapped caption + footnote, figure collision, mixed typography,
  24-page dense) drawn line-by-line with pdf-lib, so the ground truth is *known*, not
  inferred: which drawn lines form a paragraph, each line's role/level/column/font, the
  table grid, the image box, the reading order.
- **Two seed pools.** `DEV_SEEDS` (12) is what the implementation was tuned against;
  `HELD_OUT_SEEDS` (12, one per shape) is scored and never tuned on. The held-out pool
  originally covered only six shapes; it was extended to all twelve *before* the final
  measurement, and the PLAN records which six are strictly comparable to the baseline.
- **Real publisher corpus** (`test/corpus/real/`): the 2025 IRS 1040 (a 700-line
  form), arXiv 1409.0473 (ICLR 2015, 15 pages) and arXiv 1810.04805 (BERT, 16 pages),
  committed verbatim and hand-annotated with landmark roles and verbatim sentences.
- **Metrics** (`test/corpus/metrics.ts`), defined before the fixes: pairwise paragraph
  precision/recall/F1, pairwise reading-order accuracy, role/heading-level/column/font
  accuracy, table cell precision/recall, confidence AUROC + spread + flagged/unflagged
  errors, reflow collision precision/recall, line recall, and latency. Line matching is
  *coverage*-based, so a table row the model splits into cells is not scored as lost text.
- **Reproduce:** `pnpm --filter @pdfshush/pdf-core exec vitest run test/layoutBenchmark.test.ts`
  writes `tests/benchmarks/layout-benchmark-latest.md`; the Phase 3 before/after pair is
  `layout-benchmark-before.md` / `layout-benchmark-after.md`.

### 29.2 Defects the audit found (each reproduced before it was fixed)

1. **Table detection never fired** (0/2 and 0/1 tables, cell P/R 0%). Producers encode
   an inter-cell gap as one very wide *space glyph* (`str=" " width=134`), and
   `splitRow` measured the gap from that glyph's own advance, so every table row collapsed
   into a single fragment (`cells.length < 2`).
2. **Table rows could not match each other.** `detectTables` compared gap *midpoints*,
   which move with each cell's text width; a left-aligned column therefore never lined
   up row-to-row.
3. **Columns swallowed their own lines.** Gutter classification used median edges and
   midpoint clustering; single-linkage chaining split one corridor into several, and any
   line longer than the median was reported as "spanning the gutter" (`columnIndex = -1`).
   Ten of 45 left-column lines lost their column, which then shattered their paragraphs
   (two-column grouping F1 56–68%).
4. **Paragraph gaps merged** (prose F1 50–89%, dense 73%). The cut-off was 1.65× the
   measured line pitch while real paragraphs separate at 1.45–1.8×.
5. **Ragged-right text was cut mid-paragraph.** `previousShort` compared a line to the
   column's outer edge, so a 7-line paragraph split into three.
6. **Confidence carried no information.** Glyphs were flat 0.85, paragraphs ≈0.82
   (spread sd 0.0026); "flagged wrong" and "unflagged wrong" were equally likely.
7. **Roles missed what readers see.** Same-size bold/uppercase headings were body text
   (heading-level accuracy 60%), there was no footnote role (real paper footnotes became
   page furniture), a wrapped caption's second line became a stray body paragraph, and
   any line starting with the word "Table" was a caption.
8. **Reflow ignored figures.** Obstacles were lines and tables only; a paragraph could
   grow straight through an image (image case 50%).
9. **Overlapping text objects interleaved.** On the IRS 1040 the masthead extracted as
   `1040 DUep.aSrtm. eInnt odf itvhei Tdreuasaurly…` — two text objects sharing a baseline
   were joined glyph-by-glyph in x order.
10. **A rejected table orphaned its paragraphs.** Cell paragraphs kept a `tableId` whose
    `TableModel` never materialized, so they belonged to no block, appeared in no
    `readingOrder`, and were in no region — silently unaddressable text. Found by the
    new *every line is in exactly one paragraph and every paragraph in the outline*
    invariant on the real corpus.
11. **One-off margin lines became furniture.** On a multi-page document, a paragraph
    continuing across a page break was labelled `header` because it happens to sit in the
    margin band (BERT p.2).
12. **Font conventions were ignored.** Computer Modern names (`CMBX12` bold, `CMTI10`
    italic, `CMSSBX10` bold sans) produced regular-weight Helvetica/Times, so LaTeX
    headings were invisible; `analyzeEditCapability` also still claimed `high` fidelity
    for a non-embedded custom font, contradicting Phase 2.5's probe.

### 29.3 Algorithms improved

**New modules.**
- `document/relations.ts` — the layout-relationship engine: per-pair baseline gap, gap
  ratio, indent/right delta, shared alignment, typography agreement, a continuation
  score, `collisionRisk(box, obstacles)` and a page-level `PageRelations` summary.
  Consumed by `mergeDecision` (gap/indent/continuation), `assessReflow` (collision) and
  `computeStructureConfidence`.
- `document/confidence.ts` — `computeStructureConfidence(layout)` producing
  `StructureConfidence` with `grouping`, `paragraphBoundaries`, `readingOrder`,
  `fontIdentification`, `tableDetection`, `regionClassification`,
  `layoutRelationships`, `reflowSafety` and a plain-language `basis` list.
- `render/imageBoxes.ts` — image/stencil-mask boxes from `page.getOperatorList()` by
  walking a CTM stack (`save`/`restore`/`transform`/`paintImageXObject`…), in display
  space with a PDF-space twin.
- `textedit/text.ts` — ligature/soft-hyphen folding for match and verification.

**Line assembly.** Inter-cell gaps are measured from the last *inked* glyph (wide space
glyphs no longer hide them); rows are split on text-object boundaries; runs are re-joined
by typography instead of glyph x-order, so a drop cap or an inline formula stays in its
line while two overlapping objects become two readable strings.

**Columns.** Corridors are built by intersecting the per-row gap intervals (one corridor
per physical gutter), and a line belongs to a column when it does not enter the corridor.

**Paragraphs.** The break cut is 1.4× the measured pitch; "short line" is measured
against the column's *typical* right edge; spanning content gets its own bounds so a
full-measure paragraph is not shattered; wrapped captions continue when set at caption
size.

**Roles.** Heading ladder from size ratio **plus** bold/uppercase/shout signals, level 1
for the page's largest text, whitespace-isolated headings (guarded against figure
labels); new `footnote` role with multi-line tails absorbed; captions require a *numbered*
label and continue across a wrap; furniture requires repetition across pages (one-off
margin lines are demoted to body).

**Tables.** Row matching accepts one consistent alignment mode per row (start, end or
centre), cells are coalesced across text objects, 2×3 and 2×2 tables work, cells carry
row/column/span, and a rejected candidate is demoted back to body text instead of
orphaning its paragraphs.

**Confidence.** Paragraph confidence is now the mean of the merge-decision margins
multiplied by how sure the two boundaries were — "confidently merged and confidently
bounded" is high, "merged at the threshold" is low. Page-level structure confidence is
derived from those numbers, from column/typography agreement, table cell alignment and
obstacle coverage, with `basis` strings for the drivers.

**Typography.** `fontNameSignals()` reads conventions out of PostScript names (Computer
Modern/Latin Modern, subset prefixes, `-Bold`/`-It`), and `normalizeFontFamily()` uses it;
`nativeEditFidelity()` stops calling a non-embedded custom face `high`.

**Incremental.** A bounded LRU (3 documents) reuses a parsed pdf.js document across calls,
and `resetPdfCache()` exists for tests/shutdown.

### 29.4 Before / after

**Synthetic — DEV seeds (all twelve shapes; baseline and final both measured).**

| metric | before | after |
| --- | --- | --- |
| paragraph grouping F1 | 76.0% | **100.0%** |
| role accuracy | 88.0% | **100.0%** |
| heading-level accuracy | 60.0% | **100.0%** |
| table cell P / R | 0.0% / 0.0% | **100.0% / 100.0%** |
| reading-order accuracy | 100.0% | 100.0% |
| reflow accuracy | 66.7% (1 false-safe) | **100.0%** |
| confidence spread (sd) | 0.0026 | **0.0528** |
| mean confidence correct / wrong | 0.820 / 0.343 | **0.913 / 0.000** |
| extraction latency | 48.2 ms/page | 53.3 ms/page |

**Synthetic — HELD-OUT seeds.** Six shapes were measurable at baseline; the final run
covers all twelve, so the three rows marked * are shape-matched and the rest are the
final generalisation numbers.

| metric | before (6 shapes) | after (12 shapes) |
| --- | --- | --- |
| paragraph grouping F1 | 66.3% | **99.9%** |
| role accuracy | 88.6% | **100.0%** |
| heading-level accuracy | 60.0% | **100.0%** |
| table cell P / R | 0.0% / 0.0% | **100.0% / 100.0%** |
| reading-order accuracy | 99.0% | **100.0%** |
| reflow accuracy | 100.0% | 100.0% |
| column accuracy | 21.2% (pre-fix GT) | **100.0%** |
| confidence spread (sd) | 0.0200 | **0.0569** |
| mean confidence correct / wrong | 0.820 / 0.507 | **0.908 / 0.073** |
| confidence AUROC | 0.880 (n=29 errors) | 0.611 (n=2 errors) |

The AUROC drop is a sample-size artefact, not a regression: the held-out set now has two
wrong paragraphs instead of 27, and with two positives the rank statistic is noisy. What
matters is the separation (0.908 vs 0.073) and that the count of undetected-wrong
paragraphs fell from 27 to 2.

**Real documents** (`extractDocumentLayout`, before → after).

| document | lines | paragraphs | tables / cells | interleaved lines | headings | mean paragraph confidence |
| --- | --- | --- | --- | --- | --- | --- |
| IRS 1040 | 347 → 693 | 237 → 520 | 0/0 → **16/298** | 0 → 0 | 13 → 15 | 0.82 → 0.74 |
| arXiv 1409.0473 | 865 → 1124 | 524 → 705 | 3/22 → **4/67** | **5 → 1** | 4 → 51 | 0.82 → 0.75 |
| arXiv 1810.04805 (BERT) | 1448 → 2029 | 689 → 1197 | 3/17 → **25/304** | 0 → 0 | 6 → 79 | 0.82 → 0.75 |

The line count rises because composite text objects are no longer glued into one line:
that is what removes the interleaved masthead and lets table cells be cells. Real
documents are also now gated by invariants that would have failed before: every line in
exactly one paragraph, every paragraph in exactly one block and in the reading order,
reading order a permutation of the paragraph list, plus verbatim sentence probes.

**Latency.** One bulk extraction of the 24-page dense document: 273 ms (11.4 ms/page);
reading pages one at a time with a warm document: 274 ms; the same loop evicting the
parsed document between reads (what the pre-Phase-3 code did on every call): 318 ms.
Measured on real files the reuse win is small (BERT: 66 ms/page cached vs 64 ms/page
cold) because pdf.js parses lazily — the audit's "O(n²) scroll" hypothesis was **not**
confirmed, and the cache is kept for worker churn rather than a quadratic cost.

### 29.5 Regression tests added (38 engine tests)

- `test/layoutBenchmark.test.ts` (1): builds both seed pools, scores every metric, asserts
  the harness (100% line recall), asserts repeated extraction is id-stable, and writes the
  report artifact.
- `test/realCorpus.test.ts` (14): per-document invariants (line/paragraph/block/reading-order
  ownership), structure-confidence presence and bounds, hand-annotated landmark roles,
  column counts, grid detection, image geometry sanity, and verbatim sentence probes.
- `test/layoutIntelligence.test.ts` (23): one test per fixed defect — wide-space table row,
  2×3 table, cell paragraphs owned by a block, rejected-table demotion, long-line column
  membership, full-width paragraph not shattered, overlapping text objects not interleaved,
  bold lead-in still joined, same-size bold heading, largest-text level 1, footnote + wrap,
  "Table" body line not a caption, Computer Modern signals/families, ligature folding,
  non-embedded font fidelity honesty, image box → reflow refusal, structure-confidence
  ordering, relations measurement, collision hairline tolerance, cache id stability, and
  document-level furniture demotion.

### 29.6 Remaining limitations (measured, not guessed)

- **Drop caps.** A title whose initial is set at a larger size can detach that letter into
  its own line (arXiv 1409.0473: the `T` of `TRANSLATION`). Text is preserved; the line
  break is wrong.
- **Vector figures are not regions.** Only raster images are modelled as obstacles, and
  heading promotion cannot see that it is inside a diagram: BERT p.2 yields 17 headings,
  most of them Figure 1 labels. Fixing this needs figure/region segmentation.
- **Forms read as columns.** The IRS 1040 is still detected as four columns with many small
  cells. Its structure confidence falls to 0.74/0.67 accordingly, which is the honest
  signal, but the grouping is coarse for form filling.
- **Mixed-alignment tables** (text left, numbers right) are refused: one alignment mode
  must hold for every cell in a row.
- **Merged cells.** `rowSpan`/`colSpan` are always 1; spans are not reconstructed.
- **Footnote tails** whose second line sits above the margin band can still split from the
  footnote paragraph.
- **Cross-page paragraphs** are not joined; the continuation is body text (correct role)
  but a separate paragraph.
- **Confidence AUROC** is only measurable when the corpus contains errors; on a corpus at
  100% grouping it is reported `n/a` rather than as a flattering number.
- **OCR** is unchanged: scanned pages still have no text model, and `likelyScanned` still
  drives the capability report.

**Status after M5.3 (2026-11-04, §31.16).** Closed: *forms read as columns* (dot-leader pages are
read as one column), *mixed-alignment tables* (per-cell alignment, with two-row and form guards),
*footnote tails* (absorbed when the tail is one line pitch below and not larger), and *cross-page
paragraphs* (linked as `DocumentLayout.continuations`; still not merged). Still open: drop caps,
vector figures, merged cells/spans, confidence AUROC and OCR. The measurements above are left as
they were recorded; they are not re-labelled.

### 29.7 Phase 4 integration points

- `document/relations.ts` is the geometry substrate for structural editing (move/insert a
  block, renumber a list, split/join a paragraph) — the measurements already exist.
- `PageLayout.images` + `assessReflow` obstacles are the collision basis for inserting text
  that must push existing content.
- `StructureConfidence` + `basis` gives the UI a per-page explanation to gate "smart"
  actions (auto-outline, auto-tagging, bulk restyle) behind a visible number.
- `ParagraphRole.footnote` / `BlockKind.footnote` flow into outline, export and the
  heading-based Create Bookmarks tool; `fontNameSignals` feeds the substitution ladder for
  non-embedded LaTeX faces.
- `TableModel` now has per-table confidence and a stable cell grid: row/column operations
  are the next step, gated on span reconstruction.

**Result.** `pnpm -r typecheck` green, `pnpm test` **1215/1215** (pdf-core 427, api 208,
web 39, provider 370, agent 152, mcp 19), `pnpm build` green, `pnpm test:bundle` green.
No editing strategy, verification gate or redaction guarantee was weakened; the Phase 2.5
no-op/deletion/consumed-font checks are untouched and still green.

## 30. Production hardening and optimisation — Phase 4 (2026-11-03)

Scope was hardening and measured optimisation only: no architecture rewrite, no new tool, no
UI redesign. The starting point was the Phase 3 baseline (`c49dba1`, tag
`pdfshush-phase-3-stable`): a clean tree, `pnpm -r typecheck` green, `pnpm test` **1215/1215**
in 24.3 s, `pnpm build` green in 14.9 s, `pnpm test:bundle` green. Nothing in this phase was
driven by "the suite is green"; every change below answers a profile, a benchmark or a real
document.

### 30.1 Method: profile first, change only what the numbers justify

A temporary in-process harness (deleted before commit) opened a 128-page document built by
copying the real BERT PDF eight times and timed each extraction phase separately. On that
document the split was:

| phase | share |
| --- | --- |
| `buildPageLayout` (grouping) | 34.8% |
| pdf.js `getTextContent` | 25.1% |
| glyph extraction | 21.6% |
| image operator list | 17.6% |
| `computeStructureConfidence` | 0.8% |

This retired a standing suspicion: the Phase 3 `relations.ts` O(n²) pass is **not** hot
(0.41 ms/page, 0.8% total), so it was left alone. A CPU profile put `dominantTypography`
(6.73% self), GC (6.47%), the glyph loop (5.86%), `projectGlyph` (2.70%) and the ID hashers
(≈6.5% combined) at the top. Only the first four were optimised — the IDs are the
deterministic identity of the model, and changing them would break edits and history.

### 30.2 Optimisations (each proved output-preserving)

1. **`dominantTypography` memoises its key per typography object** (`group.ts`). Every glyph
   of one pdf.js text item shares the same immutable `TextTypography`, so the `toFixed`
   formatting is cached in a `WeakMap` instead of rebuilt per glyph. The key string is
   byte-identical to the inline version, so weighted-mode tie-breaking is unchanged.
2. **Single-glyph fast path.** A one-glyph run has one candidate; the weighted maps are
   skipped and that typography returned. This is the common table-cell case and cannot
   change the result.
3. **`projectGlyph` is allocation-free.** The four corners are projected with scalars rather
   than an array of point objects plus `Math.min(...)`, removing two allocations per glyph.
4. **`coverageRatio` uses numeric cell keys** instead of `${cx},${cy}` strings, with a stride
   (1,048,576) far above any real page's cell count. Only the count is consumed.
5. **Glyph extraction hoists the whitespace regex** and drops `Array.from(char).length`,
   because the input is already split per code point (`unicodeLength` is always 1).

**Proof of equivalence.** The harness checksum over the 128 pages
(`paragraphs×3 + lines×5 + tables×11`) was **112088 before and after every step**, and the
Phase 3 layout benchmark's entire quality table is byte-identical to
`tests/benchmarks/layout-benchmark-after.md`. The engine's 427 tests stayed green throughout
(a scratch profiling test was deleted rather than committed).

### 30.3 Before / after (same machine, controlled A/B)

The two optimised files were reverted, measured three times, re-applied, and measured three
times again on the Phase 3 layout benchmark (24-page dense document):

| access pattern | before (median) | after (median) | change |
| --- | --- | --- | --- |
| one bulk extraction | 318 ms / 13.2 ms per page | 252 ms / 10.5 ms per page | ≈ −21% |
| page-by-page (cached document) | 267 ms / 11.1 ms | 257 ms / 10.7 ms | ≈ −4% |
| page-by-page (re-parse each call) | 306 ms / 12.7 ms | 260 ms / 10.8 ms | ≈ −15% |

On the 128-page real-PDF harness, process CPU time fell from ≈11.5 s to ≈10.9 s (−4–5%) and
wall time from 7.9–8.5 s to 7.3–7.5 s. The per-run spread is large (shared machine, pdf.js
worker scheduling), so only the direction and the bulk-extraction medians are claimed; the
strongest evidence remains the identical checksum and quality table.

### 30.4 Native / worker lifecycle audit

`pdfjsRuntime.ts`, `textedit/pdfium.ts`, `textedit/engine.ts`, `redact/redact.ts`,
`redact/verify.ts` and the API runner/processor/host/store were re-read for pointer
lifetimes, close/free paths, cache eviction and the redaction rebuild/verify ordering. No
unsafe lifetime, double-free or fail-open path was found; PDFium object pointers are still
documented as valid only until the next `generate`, the LRU is still bounded at three
documents, and redaction still builds the output from scratch then verifies it. The two real
defects were at the HTTP/temp-file boundary, not in the engines:

- **`http/result-stream.ts` leaked a file handle on client disconnect.** `stream.pipe(response)`
  unpipes when the response closes but never destroys the source, so the read stream's file
  descriptor lived until GC. On Windows that open handle makes the janitor's later
  `rm -rf` fail with `EPERM`. The response's `close` now destroys the source. Error handling
  is unchanged.
- **Directory deletes did not tolerate Windows' post-close handle lag.** `WorkDirStore`
  used `{ recursive: true, force: true }` only; Node ignores `maxRetries` unless the delete
  is recursive and the option is set, so a delete that raced a closing writer surfaced as
  `EPERM`/`EBUSY`. `removeJob` and the janitor's job-directory sweep now use
  `maxRetries: 10, retryDelay: 100`. The identical options were added to the API tests' own
  temp-directory cleanups.

### 30.5 Privacy: document text out of logs and verification details

Four places could have written document content into a log, an error detail or a job
diagnostic. All four were changed without touching any decision logic:

- `textedit/engine.ts`: a reflow refusal quoted `line.text.slice(0, 40)`. It now reports the
  line's **index**.
- `redact/verify.ts`: two check details echoed surviving/forbidden text. They now report
  **counts and positions in the caller's own list**. The `ok` computation and the fail-closed
  policy are byte-for-byte unchanged.
- `worker/processor.ts`: job-failure logging wrote `error.message`, which is the caller-facing
  text and may quote the document. It now logs the stable error **code** and class name.
- `worker/host.ts`: the `failed` handler did the same; it now parses the failure code with
  `parseFailure` and logs that.

A Phase 2.5 redaction test was extended to assert the failure details do not contain the
sentinel secret, so this stays fixed.

### 30.6 Observability without content

`RunResult` now carries an optional `JobDiagnostics`: `durationMs`, `outputFiles`,
`outputBytes`, `pageCount`, the text-edit **strategy mix** (`inPlace` / `contentStream` /
`fallback` / `manualReview`, `nativeEngine`), the job's own `verified` flag and a
`warningCount`. It is built by reading only fixed-shape numeric/boolean fields, counts
warnings instead of copying them, and is forwarded by the processor to the host, which logs
it in the `completed` record. A new runner test asserts every value is a number/boolean and
that no document string rides along. The point is that a silent regression in the editing
ladder or a redaction verification failure is now visible in structured logs without ever
logging a document.

### 30.7 The Windows `EPERM … rmdir` flake

- **Reproduction:** `apps/api/test/v1.test.ts` intermittently failed with
  `EPERM: operation not permitted, rmdir '…\pdfshush-v1-*\jobs\*'` under parallel load, and
  passed on re-run or in isolation.
- **Root cause:** the test's `afterEach` deleted its temp tree immediately after in-flight
  HTTP responses; Windows releases the last handle a moment after the writer's promise
  settles, so the recursive delete raced the close. It was a test/temp-file lifecycle issue,
  not an engine or API logic failure (no job state was lost; a re-run was always clean).
- **Fix:** retry only the documented transient codes (Node's `maxRetries`/`retryDelay` on
  recursive deletes), in the store and in the eight API test cleanups.
- **Evidence:** the v1 suite ran **8/8 clean** (≈1.5 s each) after the fix, and the full
  `pnpm test` runs in this phase were green (1215, then 1216 with the new test). The retry is
  a bounded, visible policy — it does not swallow a non-transient error, and the root cause
  is recorded here rather than the failure being quietly ignored.

### 30.8 Dependency, licensing and bundle audit

- **Dependency licences.** 573 installed packages were scanned by `license` field: MIT 165,
  ISC 12, Apache-2.0 12, MPL-2.0 4, BSD-3-Clause 3, BSD-2-Clause 2, 0BSD 1. **No GPL, AGPL,
  LGPL, SSPL, BUSL, CC-BY-NC, Commons-Clause, proprietary or unknown licence.** The four
  MPL-2.0 entries are `lightningcss` and its Windows binary — a build-time CSS transformer
  used unmodified by Vite/Tailwind, not shipped in the app bundle. Direct runtime engines:
  `@cantoo/pdf-lib` (MIT), `@embedpdf/pdfium` (MIT wrapper; the PDFium binary is
  BSD-3-Clause, notices in `licenses/`), `pdfjs-dist` (Apache-2.0), `fflate` (MIT),
  `signature_pad` (MIT), `bullmq` / `express` / `ioredis` / `jose` / `helmet` / `pino` /
  `busboy` / `zod` (MIT), `mongodb` (Apache-2.0). The repository's own licence is
  AGPL-3.0-or-later, which is a project decision, not a dependency.
- **Workspace boundary.** `pnpm-workspace.yaml` covers `apps/*` and `packages/*` only.
  `genoffice-main/` and `Stirling-PDF-main/` are gitignored, untracked reference trees; they
  are not workspace members, contribute no dependency, and are not read by any build.
- **Bundle boundary.** `pnpm test:bundle` is green: the main chunk is 138.1 kB with **0**
  PDF-engine modules, the signature pad is in a lazy chunk, no lazy app chunk carries an
  engine, and the engines still ship in the worker chunks.
- **Supply-chain stance.** Build scripts stay deny-by-default (`esbuild` only; the optional
  native `msgpackr-extract` accelerator remains off).

### 30.9 Verification campaign (2026-11-03)

| gate | result |
| --- | --- |
| `pnpm -r typecheck` | green |
| `pnpm test` | **1216/1216** (pdf-core 427, api 209, web 39, provider 370, agent 152, mcp 19) |
| `pnpm build` | green (11.2 s) |
| `pnpm test:bundle` | green |
| layout benchmark | quality table identical to Phase 3; latency improved (§30.3) |
| `test:e2e:text-edit` | 8/8 |
| `test:e2e:text-model` | all checks |
| `test:e2e` (full smoke, incl. Redact PDF) | ALL CHECKS PASSED |
| `test:e2e:plain-tools` | ALL PASS |
| `test:e2e:forms-bookmarks` | ALL PASS |
| `test:e2e:next-tools` | ALL PASS |
| `test:e2e:bookmark-batch` | ALL PASS |
| `test:e2e:dark-mode` | ok |
| `test:api` | ALL CHECKS PASSED |
| `test:hardening` (compose stack, `FILE_TTL_MS=20000`, `JANITOR_INTERVAL_MS=5000`) | **GATE PASSED** — SIGKILL mid-job, API survives, job settles, janitor removes the expired files, quota counters survive, worker recovers |

The redaction tool was exercised by the full smoke suite (marks burned into pixels, no font
object, no annotation/attachment tree, every page replaced by an image) and the Phase 2.5
fail-closed verification tests remain green. No editing strategy, no redaction serialization
and no verification gate was changed in this phase.

### 30.10 Remaining limitations (measured; classified)

- **Critical:** none open.
- **High:** none open.
- **Medium** — all carried over and documented, none regressed by this phase:
  mixed-alignment tables are still refused rather than guessed; the IRS 1040 form still reads
  as four columns (confidence ≈0.74); cross-page paragraphs are not joined; a footnote tail
  above the margin band can still split; the editor does not OCR a scan in place (run the
  separate `ocr-pdf` tool first — shipped 2026-11-08 — then reopen the result), which is the
  capability boundary disclosed in the editor.
- **Low:** drop caps can detach their first letter (arXiv 1409.0473 `T`); vector figures are
  not reported as regions (BERT p.2 gains heading labels from Figure 1 text); `rowSpan` /
  `colSpan` remain 1; confidence AUROC is `n/a` on a 100%-correct synthetic corpus.
- Deliberately not attempted in Phase 4: any change to ID hashing, table span
  reconstruction, or redaction strategy. Each would alter model output or a security
  boundary and belongs to a phase with its own benchmark.

### 30.11 SHIP / NO-SHIP gate — **SHIP**

Every gate above is green, the optimisations are output-preserving by checksum and by a
byte-identical benchmark, the two real defects found by the audit are fixed, no dependency
carries a copyleft/proprietary licence, and the redaction/editing guarantees are intact. The
remaining limitations are measured, disclosed and unchanged from Phase 3. The Windows temp-dir
flake is understood and bounded rather than suppressed. Phase 4 ships on `main`; no further
phase was started.

**Result.** `pnpm -r typecheck` green, `pnpm test` **1216/1216**, `pnpm build` green,
`pnpm test:bundle` green, full browser E2E campaign green, containerised hardening gate
passed. Files changed: `document/group.ts`, `document/glyphs.ts` (optimisations),
`textedit/engine.ts`, `redact/verify.ts` (privacy of details), `http/result-stream.ts`,
`files/store.ts` (lifecycle/retry), `jobs/runner.ts`, `worker/processor.ts`,
`worker/host.ts` (content-free diagnostics + safe logging), and the API test cleanups.

## 31. Product excellence and competitive differentiation — Milestone 5 (planned 2026-11-03)

Phase 4 closed the *engineering* risk: the pipeline survives a SIGKILL, the hot paths are profiled,
the licences are clean and the suite is 1216/1216. It deliberately said nothing about whether the
product is **good**. This milestone is that gap — the distance between "nothing is broken" and
"nothing else is worth using".

It is the first milestone in this plan driven by the product surface rather than by a defect list.
It still obeys the house rule — **measure, then change** (§31.6 starts with an instrument-first gate)
— and it still may not touch a security boundary to buy a feature.

### 31.1 Where the product actually stands (2026-11-03)

| fact | value | source |
| --- | --- | --- |
| catalog entries | 58 | `apps/web/src/tools/registry.ts` |
| live tools | 49 | same |
| entries still `planned` | 9 | same, listed in §31.5 |
| tools that run entirely client-side | 46 of 49 live | worker pool; `workflows`, `api`, `mcp` are server-backed by nature |
| unit / integration tests | 1216 | `pnpm test` |
| browser E2E | 11 suites (smoke, sign, text-edit, text-model, AI, managed AI, plain, next, bookmark-batch, forms-bookmarks, dark-mode) | `tests/e2e/` |
| main bundle | 138.1 kB, 0 PDF engines | `pnpm test:bundle` |
| **SEO** | none — SPA shell, no prerender, no `sitemap.xml`, no `robots.txt` | `apps/web/index.html`, `apps/web/public/` |
| **accessibility** | unmeasured — no axe/pa11y, no keyboard E2E | no tooling in repo |
| **performance budget** | unmeasured on real devices | no harness |
| **offline** | unsupported — no service worker, no manifest | `apps/web/public/` |

Two honest conclusions, and they are the reason this milestone exists.

1. **The engineering is ahead of the product.** A fail-closed, independently verified redaction
   engine and a deterministic layout model sit behind a shell that a crawler cannot read and a
   keyboard-only user cannot fully drive.
2. **The strongest claims are prose, not evidence.** *Your file never leaves the device*, *redaction
   is verified, not promised*, *editing never silently degrades* are all true — and all currently
   **unfalsifiable by a user in ten seconds**. A competitor can make the same claims; we can prove
   ours. Proving them is the differentiator.

### 31.2 Thesis

> Compete on **verifiable trust and honest behaviour**, not on tool count.

Tool count is a losing axis: the suites that beat us on breadth (Stirling-PDF, PDF24, Adobe) are
server-side, and the suites that beat us on polish (Sejda, Smallpdf, iLovePDF) are server-side too.
Our one structural advantage is that the document never moves. Everything here either (a) makes that
advantage *checkable*, or (b) removes a reason a user would leave for a competitor anyway — speed,
accessibility, mobile, or a missing capability.

### 31.3 The bar: what "excellent" means for a live tool

Eight non-negotiables. A tool is not "done" until all eight hold, with evidence recorded.

| # | Bar | Evidence required |
| --- | --- | --- |
| Q1 | **Truthful state.** No spinner that can hang, no "done" without a verified output file, no silently ignored option. Every failure names the cause and the next action, and is content-free. | E2E per failure class; log assertion that no document text is emitted |
| Q2 | **Deterministic where the format allows.** Same input + options → same output bytes. | Digest fixture per tool |
| Q3 | **Fast by budget.** Tool-ready ≤ 1.5 s on a 4× CPU throttle; first interaction ≤ 100 ms; no main-thread task > 200 ms during a 50-page client job. | Recorded trace, not an impression |
| Q4 | **Works at the edges.** 0-byte, 1-page, 2000-page, encrypted, linearized, scanned, malformed, non-ASCII filenames, 200 MB. | Adversarial corpus run per tool class |
| Q5 | **Accessible.** Keyboard-only path to every action including the canvas editor; visible focus; labelled controls; no colour-only meaning. | axe run + keyboard E2E per tool class |
| Q6 | **Private by construction.** Client tools never transmit document bytes — enforced by CSP and asserted at runtime, not promised in copy. | CSP `connect-src` allowlist; offline run; network assertion |
| Q7 | **Honest on mobile.** Real iOS Safari memory behaviour tested, not "responsive CSS". | Device-emulated run of the 10 heaviest tools |
| Q8 | **Limits in the product.** A refusal, a cap or a fidelity compromise is surfaced where it happens, not only in `PLAN.md`. | UI copy per known limitation (§29.6, §30.10) |

### 31.4 Differentiation bets

Five bets, each backed by something already built and each independently checkable by a user.

- **D1 — Verifiable locality.** An installable PWA that runs the client tools offline, plus a
  "prove it" panel: the CSP forbids uploads, the service worker keeps the app available with the
  network off, and a runtime assertion proves a job completed with zero document egress.
- **D2 — Verifiable redaction.** The same independent verifier the engine uses, exposed to the user:
  drop in any PDF and get the check list plus a digest receipt. *"Don't trust us — verify it."*
- **D3 — An honest editing ladder.** The per-edit mode (in-place / content-stream / overlay) is
  already recorded. Surface it in the editor and in an export receipt so degradation is visible at
  the moment it happens. No competitor publishes this.
- **D4 — Inspectable structure confidence.** Per-page confidence with its `basis` exposed, refusal
  preferred over a guess. The engine already refuses mixed-alignment tables; make that a visible
  product promise instead of a hidden behaviour.
- **D5 — Open, local AI.** BYOK keys stay in the browser, managed mode is labelled, and no document
  is sent for a client-side operation. The AI features inherit D1's proof.

### 31.5 Parity debt: the nine `planned` entries must resolve

A permanent "in development" page is a broken promise with a nicer font. Every entry below ends this
milestone **live**, **re-scoped** (renamed and described to match what it actually does), or
**removed** with a redirect to the closest honest tool.

| entry | real obstacle | decision required |
| --- | --- | --- |
| `ocr-pdf` | needs a real OCR engine (WASM or server); scanned documents are the single largest competitive gap | ship client-side WASM within worker limits **or** declare a server-only tool with a visible quota |
| `pdf-to-word` / `pdf-to-excel` / `pdf-to-ppt` | layout-preserving conversion is a different product and a research-grade problem | export text + structure under an honest name, **or** decline |
| `word-to-pdf` / `html-to-pdf` | needs a renderer (LibreOffice / headless Chromium) and heavier ops | server worker with a real cost model, **or** decline |
| `convert-batch` | orchestration only; meaningless before conversions exist | follows the conversion decision |
| `deskew` | image analysis; genuinely feasible client-side and small | ship |
| `sign-workflow` | routing and audit beyond the current sidecar | ship a narrow version **or** re-scope the page |

**Decision (2026-11-04, M5.7).** All nine are **declined**, not deferred: each page now says
"Not built — and here is exactly why", names the real blocker and points at the closest live tool.
No page promises a date, captures an email or shows "in development". The reasons live in
`apps/web/src/tools/declined.ts` and are pinned by `declined.test.ts`; the catalog status is
`'declined'`, so `planned` no longer exists as a state. The largest honest gap is OCR: scans still
have no text layer, and `pdf-to-text` returns empty on them rather than inventing text.

> **Superseded in part (2026-11-05 and 2026-11-08).** `deskew` and `ocr-pdf` were later shipped
> client-side (see §8); the other seven remain declined. Everything above is the 2026-11-04
> decision as recorded, not today's catalog state.

Declining is an acceptable, documented outcome. A ship-or-decline decision with a reason is
excellence; an indefinite "coming soon" is not.

### 31.6 Workstreams

**M5.0 — Instrument the product (gate: no behaviour change ships before this).**
Add the measurement the plan currently lacks: a throttled performance harness per tool class, an axe
run over the shell and the 10 highest-traffic tools, a crawler view of every route, a mobile-emulated
memory run, and an adversarial corpus per tool class. Output: `tests/benchmarks/product-baseline.md`
and a scored Q1–Q8 table for all 49 live tools. **This is the honest starting line**; the targets in
§31.7 are ratified against it rather than guessed now.

**M5.1 — Truthful surface.** Apply Q1 and Q8 everywhere: error taxonomy with human text + stable
code, no infinite spinners, every known limitation surfaced in the UI, "in development" pages that
say what will actually happen. Absorbs the honesty debt recorded in §29.6 and §30.10.

**M5.2 — Verifiable privacy (D1, D2).** Service worker + manifest, offline tool set, CSP `connect-src`
allowlist, the locality "prove it" panel, and the standalone redaction verifier with a digest
receipt. Ships a page that states exactly what leaves the device and what does not — and a test that
fails if anything new does.

**M5.3 — Editing and structure excellence (D3, D4).** Surface the edit-mode receipt; expose page
confidence and `basis`; add the "explain this extraction" panel. Then close the measured Medium
limitations in ranked order (mixed-alignment tables, IRS-1040 column read, cross-page paragraphs,
footnote tails), each with a corpus fixture and a benchmark delta, each allowed to keep refusing
rather than guess.

**M5.4 — Performance and resilience.** Hit Q3 and Q7: extraction and export budgets per tool, worker
pool sizing under a 4× throttle, a 200-page path that stays under the memory ceiling, iOS Safari
large-document behaviour, and a CI guard for the ceilings that need no stack.

**M5.5 — Reach (prerender, SEO, sharing).** Static prerender of every tool route with real content,
`sitemap.xml`, `robots.txt`, `SoftwareApplication` structured data, canonical URLs and per-tool OG
images — while keeping the one-URL-per-tool promise intact. Absorbs the P7 "SEO prerender" carry-over.

**M5.6 — Accessibility and input parity (Q5).** axe in CI with a zero-critical budget, keyboard E2E
for each tool class including the canvas editor (select, nudge, delete, undo without a mouse), focus
order and screen-reader descriptions for edited objects, and WCAG 2.2 AA on the shell plus the top
10 tools. Absorbs the P7 "perf/a11y pass" carry-over.

**M5.7 — Parity debt (§31.5).** Execute the decisions, one commit per entry, each with a working tool
or a redirect and a documented reason.

**M5.8 — Release evidence.** The full campaign (unit, E2E, bundle, hardening, product baseline) plus
a per-tool evidence table for Q1–Q8, recorded in §32.

### 31.7 Targets

Measured in M5.0, then ratified. The **commitments** are structural and can be stated now:

- No regression against the Phase 4 numbers: the main chunk stays engine-free, 128-page extraction
  stays within the §30.3 range, the bundle boundary test stays green.
- Zero critical/serious axe violations on the shell and the top 10 tools.
- Zero live tools that fail to reach a terminal state on any adversarial input.
- Zero live tools that send document bytes while claiming to be client-side.
- Zero catalog entries left in `planned` at the close of M5.

Numeric ceilings (Q3, Q7) are set from the M5.0 baseline, in the same commit that records it, so the
milestone never ships a target invented before the first measurement — exactly the mistake §29 and
§30 exist to avoid.

### 31.8 Non-goals and hard boundaries

- **No change to the redaction serialization, the rebuild order or the fail-closed verification
  policy.** D2 exposes the verifier; it does not redefine it.
- **No change to ID hashing, the layout model's identity or the editing ladder's decision rules.**
  M5.3 adds visibility and fixes measured defects; it does not re-architect the engine.
- **No telemetry that could carry document content, filenames or PII** (§30.5 stands). Product
  analytics, if any, are aggregate and documented.
- **No tool may move from client-side to server-side to make a number look better.** That would
  trade the one structural advantage for a benchmark.
- **No growth by tool count alone.** A new tool clears Q1–Q8 or it does not ship live.
- **No dark patterns:** no sign-up wall in front of a client-side tool, no artificial cap, no
  urgency copy. The free tier is the product, not a funnel.
- **No unrelated redesign.** Visual work is limited to what Q1/Q5/Q8 require.

### 31.9 Risks

| risk | impact | mitigation |
| --- | --- | --- |
| OCR and Office conversion turn out to need a server | High — the two biggest parity gaps | decide early in M5.7; declining with a clear page is an allowed outcome |
| prerender collides with the SPA router or the worker bundles | Medium — SEO is the cheapest acquisition channel | static prerender of route shells + content, hydrate the same routes; extend the bundle boundary test to the prerender output |
| offline/SW caching serves a stale engine after a deploy | High — a correctness bug disguised as convenience | versioned cache, `skipWaiting` only on user action, cache version asserted in E2E |
| mobile Safari OOM on large PDFs | Medium | the Q7 run gates the claim; the ceiling is enforced and disclosed, not hidden |
| accessibility work is larger than it looks for a canvas editor | Medium | design the keyboard model before implementing; phase the axe budget |
| the milestone sprawls into a redesign | Medium — this plan's usual failure mode | §31.8 non-goals + one commit per workstream, checked against the Q1–Q8 table |

### 31.10 Exit criteria (M5 ship gate)

1. Q1–Q8 evidence recorded for all 49 live tools; every failure either fixed or documented as an
   accepted limitation with a severity.
2. All nine `planned` entries resolved: live, re-scoped, or removed with a redirect and a reason.
3. Prerendered, crawlable pages for every tool route; sitemap and structured data validate.
4. Offline run green for the client tool set; the CSP allowlist proven by a test that fails on a new
   outbound request carrying document bytes.
5. Redaction verifier available to users with a digest receipt; §28.10 and §30.5 guarantees still
   green and unmodified in behaviour.
6. Zero critical/serious axe violations on the shell + top 10 tools; keyboard E2E per tool class.
7. Performance ceilings from §31.7 met on the throttled profile; no regression against §30.3.
8. Full campaign green: `pnpm -r typecheck`, `pnpm test`, `pnpm build`, `pnpm test:bundle`, all E2E
   suites, `test:api`, containerised `test:hardening`.
9. `PLAN.md` §32 records the result, the evidence tables and any remaining limitation classified
   Critical / High / Medium / Low.

### 31.11 Tracking

One commit per workstream (M5.0…M5.8), each stating the evidence it adds. The status board gains a
Milestone 5 row the moment M5.0 lands; until then the gate above stays the Phase 4 **SHIP** result and
nothing in this section is claimed as delivered.

### 31.12 M5.0 result — the instrumented baseline (2026-11-04)

**Delivered.** `apps/web/src/lib/marks.ts` publishes `app-ready`, `page-ready` and `tool-ready` as
User Timing marks (inert, no network, no storage). `tests/benchmarks/m5-0-baseline.mjs` writes
`tests/benchmarks/product-baseline.md` and `.json` from a production build behind `vite preview`,
and `pnpm test:baseline` runs it. Every one of the 49 live tools has a row in the Q1–Q8 matrix; the
table labels class-inherited evidence instead of implying a per-tool run.

| measured | baseline | ratified ceiling |
| --- | --- | --- |
| Q3 tool-ready, p95 @ 4× CPU | **486 ms** | **583 ms** (p95 + 20%, under the 1500 ms spec) |
| Q3 worst long task, 50-page merge | **133 ms** | 200 ms (spec floor) |
| Q3 first interaction, worst | **19 ms** | 23 ms |
| Q7 iPhone 13 50-page merge | completes, **10 MB** heap | 15 MB |
| Q6 egress during a client job | 11 requests, **0 external / 0 non-API uploads** | zero remains the rule |
| Q1/Q4 corpus | **9/9 terminal**, no refusal echoes text or filename | all terminal |

**Failures the milestone now has to fix** (this is the point of the gate):

1. **Q2 - non-deterministic output.** Merging the same two files twice produces different bytes:
   `/CreationDate` and `/ModDate` move with the clock. Same input must not imply same output until
   this is fixed; the harness names the fields rather than reporting a bare hash. **Fixed in
   §31.13; the baseline was re-measured after the fix.**
2. **Q5 — 0/49 clean.** Every route carries at least one serious axe violation. The two causes are
   shared chrome, not per-tool markup: the footer's `text-muted-foreground/60` links ("Pricing
   (soon)", "About (soon)") and the emerald "live" badge on `bg-emerald-500/10`.
3. **Q8 — currently a heuristic, not proof.** All 49 pages mention a limit because the shared trust
   note does; that is not the same as surfacing the *specific* limitation where it happens. M5.1
   replaces this check with per-limit assertions.

**Confirmed gaps:** no route has crawler-visible content (`rootChars` 0 on all 52 routes), which is
the M5.5 work; no linearised fixture and no qpdf/Ghostscript, so that Q4 edge is recorded as a gap.

**Not claimed:** nothing in M5.1-M5.8 has started. The Phase 4 SHIP result still stands as the last
full-campaign gate.

### 31.13 Q2 fix - deterministic output (2026-11-04)

**Cause.** `PDFDocument.create()` calls `updateInfoDict()` in its constructor, which stamps
`/ModDate` and (when absent) `/CreationDate` with `new Date()`. Every synthetic document therefore
carried the moment of the run, and two identical merges produced different bytes. `save()` does not
re-stamp; the value was fixed at construction.

**Policy.** `packages/pdf-core/src/ops/dates.ts` replaces the stamp on every `create()` site:

- **inherit** -- merge, split (both halves), N-up, compose and combine keep the *earliest*
  `/CreationDate` and the *latest* `/ModDate` among their PDF sources. The output is derived from
  those documents, so it inherits their provenance instead of inventing a new moment.
- **omit** -- image-to-PDF, raster compression, dark mode and grayscale remove both keys. A
  pixel-rebuilt document has no source PDF to inherit from, and a fabricated timestamp is worse
  than none. Redaction already removed the whole Info dictionary and is unchanged.

Malformed source dates are treated as absent rather than crashing a tool. Source date literals are
normalised to a UTC instant, so the same input always yields the same string. `/Producer` and
`/Creator` are library constants and stay, so they do not vary between runs. The single-source
`mergeIfNeeded` path, which copies the source document through `updateMetadata: false`, was already
deterministic and is untouched.

**Evidence.**

- `packages/pdf-core/test/determinism.test.ts` (8 tests) pins the system clock to two different
  moments and asserts byte equality for merge, split, compose, PDF+image combine and image-to-PDF.
  It also asserts the inheritance rule, the date-free case and the image-only omission.
- `pnpm test`: **1232/1232** (previously 1224; +8 determinism tests). `pnpm -r typecheck` green.
- `pnpm test:baseline` re-run on the production build: Q2 now reports **identical digest**
  `2669defb6e61…` for both merges (1408 bytes), `differingFields: []`. The failing pre-fix run stays
  in history at `b474dee`; the committed `product-baseline.md` is the post-fix measurement.

**Ceilings no longer drift.** The harness previously recomputed each ceiling from its own run, so a
lucky run tightened the target and an unlucky one loosened it. The ratified numbers (583 ms p95,
200 ms long task, 23 ms first interaction, 15 MB mobile heap) are now constants; a re-run measures
against them and M5.4 will fail CI if one is breached. Re-measured after the fix: p95 **528 ms**,
worst long task **178 ms**, first interaction **16 ms**, mobile heap **10 MB** - all within the
ratified ceilings.

**Not changed.** Redaction serialisation and verification, ID hashing, layout-model identity and the
editing-ladder rules are untouched. No content enters any telemetry, and nothing moved from client
to server.

### 31.14 M5.1 result - the truthful surface (2026-11-04)

**Delivered.**

1. **One error vocabulary.** `apps/web/src/lib/job-errors.ts` classifies every job failure by stable
   code - `encrypted`, `damaged`, `unsupported`, `too-large`, `timeout`, `cancelled`,
   `canvas-unavailable`, `ai`, `network`, `validation`, `refused`, `internal` - by error **name**
   first (the name survives the worker hop) and message second. `describeJobError` returns
   `{ code, message, action, retryable, detail, issues }`. `message` is complete on its own and
   includes the next step, so the existing `toast.error(outcome.message)` call sites improve
   without being edited one by one. Validation now shows the engine's own issues instead of
   "Invalid input"; refusals keep their full check-by-check text and are never folded into
   "unsupported". `refused` was added for the fail-closed redaction and text-edit errors because
   those messages name specific checks. `use-job-runner` logs `[job:<slug>] <code> failed:` once
   (no content, no filename, no path) and exposes the structured info on both the hook state and
   the failed outcome.

2. **No infinite spinners.** `JobProgressPanel` shows an elapsed clock from mount and, after 8 s,
   says the job is still working, that large documents can take a minute, and that Cancel stops it
   immediately and keeps the files. Cancel was already always present; the ticking clock is
   `aria-hidden`, so a screen reader is not read a timer every second. A slow job now looks like a
   job that is taking time, not a spinner with no end state.

3. **Per-tool limits, not a global boast.** The shared trust card said "No limits." above a
   contradicting 500-page / 250 MB cap. `apps/web/src/lib/tool-limits.ts` now carries a specific
   sentence for all 49 live slugs, derived from the engine constants (`LIMITS`, `IMAGE_LIMITS`,
   `PROTECT_LIMITS`, `RENAME_LIMITS`, `BATES_LIMITS`), so the copy moves when a limit moves.
   Raster-rebuild tools state their real 150-page cap; combine and JPG-to-PDF state file counts;
   AI tools state context and turn bounds; workflows, API and MCP state their server quotas.

4. **Server-backed tools stop claiming locality.** `workflows`, `api` and `mcp` have explicit
   `REMOTE_TRUST` notes: workflows is server-run per step, the API is server-side by design, and
   the MCP server is a local process that calls the API. The old default note ("nothing is
   uploaded") was false for all three. Their limit card says "Quotas are explicit." instead of
   "No account or quota."

5. **Planned pages say what will actually happen.** All nine entries have a `PLANNED_COPY` entry:
   what the tool will do, the real blocker, and the closest live tool with a direct link and a
   "Use X" button. The generic "In development" remains only as a fallback for a slug not yet
   written, and no ship date is invented.

6. **The measured text-model limits are disclosed.** The editor's Document inspector gains a
   collapsed "What this editor does not do yet" list covering the 29.6/30.10 findings that change
   what a user sees: cross-page paragraphs are not joined, footnote tails can split, drop caps can
   detach, vector figures are not regions, forms can read as columns, mixed-alignment tables are
   refused and merged cells are not reconstructed, and scanned pages have no text layer. The OCR
   boundary was already stated in three places (`edit-pdf` status, `pdf-to-text` footer,
   `split-by-text` hint) and is repeated so this one list is complete. Create Bookmarks now warns
   that heading detection is a heuristic and figure or caption text can be offered as a heading.

**Evidence.**

- 21 new tests: `job-errors.test.ts` (12 - every code class, worker-hop reconstruction, validation
  issues, refusal preservation, a thrown non-`Error`), `tool-limits.test.ts` (5 - every live slug
  covered, no orphan entries, no "no limits" claim, a number in every sentence, fallback), and
  `text-model-limits.test.ts` (4 - every measured limitation mapped, no invented entries, full
  sentences, the OCR boundary stated plainly).
- `pnpm test` **1253/1253** (pdf-core 435, API 210, provider 370, agent 152, web 67, MCP 19).
  `pnpm -r typecheck` green. `pnpm build` green.
- Browser-verified against the production build on `vite preview` (`:4173`), not the dev server:
  - an encrypted fixture produced `"This PDF is password protected. Unlock the PDF first, or enter
    its password if this tool asks for one."` - the classified message plus its action, from a real
    worker failure;
  - a non-PDF produced `"That file could not be read as a PDF. Failed to parse PDF document
    (line:0 col:48 offset=24): No PDF header found. Re-download or re-export the file, then try
    again."`;
  - merge read "Up to 500 pages and 250 MB...", redact read "Up to 150 pages and 500 regions...",
    workflows read "Server-run by design." plus its quota line, and `word-to-pdf` showed the
    why-it-is-not-here copy with a live `pdf-to-text` alternative;
  - the editor's limits list expanded to all seven entries on a real arXiv PDF.

**Not claimed / accepted gaps.**

- `retryable` and the structured `action` are exposed, but no surface offers a one-click retry
  yet. The action is folded into `message`, so no failure is a dead end; retry is still a manual
  re-run.
- Failures outside `useJobRunner` (a dropzone's own file-read error, for example) keep their local
  copy. Those messages were already specific. Converting them to the taxonomy belongs to the
  surface that owns them, not to a forced rewrite of every component.
- The 29.6 limitations are **disclosed, not fixed**. Mixed-alignment tables, the IRS-1040 read,
  cross-page paragraphs, footnote tails and OCR are M5.3/M5.7 work, each behind its own fixture
  and benchmark. Nothing here changes the engine.
- No redaction, serialization, hashing, layout-model or editing-ladder code was touched; the only
  engine import added is constants.

### 31.15 M5.2 result - verifiable privacy (2026-11-04)

**Delivered.** Five artifacts, each falsifiable in a browser rather than asserted in prose.

1. **The policy is part of the build.** `apps/web/src/lib/csp.ts` builds one policy and
   `vite.config.ts` injects it as a head-prepended `Content-Security-Policy` meta tag on `vite
   build` only (the dev server keeps its inline HMR client). `connect-src` is an allowlist: `'self'`,
   `blob:`, the shipped AI provider origins and loopback wildcards - never `https:` and never `*`.
   `form-action 'self'` closes the other route for POSTing bytes off-origin, `object-src 'none'`,
   `base-uri 'self'` and `frame-src 'none'` are set, and `script-src` keeps `'wasm-unsafe-eval'`
   because pdfium/pdf.js compile WebAssembly. A self-hoster whose AI endpoint is not in the list adds
   it at build time with `VITE_CSP_CONNECT_EXTRA`; values are normalised to origins so a pasted URL
   with a path cannot widen the match.

2. **Offline is versioned, not optimistic.** `apps/web/service-worker.js` is emitted as `/sw.js` by a
   build plugin that substitutes a build id derived from the sorted emitted asset names. The cache
   name is `pdfshush-shell-<build-id>`, so a deploy installs a fresh cache and deletes the old one -
   a new page can never be served a previous engine. The shell is precached; `/assets/` and
   `/icons/` are cache-first because their names are content hashes; navigation is network-first with
   a cached-shell fallback and a 503 page that says to open the tool once online. Non-GET requests,
   `/api/*` and cross-origin traffic are never intercepted. A new build waits and offers a reload
   instead of calling `skipWaiting` under an open tool. Registration happens at idle time in
   production builds only, so it costs nothing on the Q3 path.

3. **`/trust` reads the running build, not a copy.** It parses the meta tag that is actually in the
   document, so the chips and the full policy are what the browser is enforcing. It reports the
   service worker's real state, and "Prove it now" runs a genuine `inspect` job on a one-page PDF
   built in memory with `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` and `EventSource`
   patched, plus Resource Timing sampled for module/worker/WebAssembly loads. It reports page-API
   calls, resources loaded, body-bearing requests and cross-origin traffic, and lists what the proof
   cannot see. Request bodies are recorded as a boolean, never read.

4. **`/verify` exposes the verifier the Redact tool already trusts.** It calls `verifyRedaction` on
   the serialized bytes of any PDF, shows one row per check, and prints a receipt containing the
   SHA-256 of the exact bytes. The receipt has no timestamp, so the same file always produces the
   same text. Two rows are reported for what they are: `marks-burned-in` is **n/a** (the page has no
   regions to compare against, so the engine's vacuous pass is not presented as evidence) and
   `page-count` is **information** (it was probed from the same file). When
   `pages-are-single-images` fails, the two image checks that would then pass vacuously are
   downgraded to n/a instead of contradicting the failure above them.

5. **Installable metadata.** `manifest.webmanifest` with 192/512/maskable icons generated from the
   brand mark, linked from `index.html` together with the apple-touch icon and app name.

**Evidence.**

- 28 new web tests: `csp.test.ts` (7 - lockdown directives, WebAssembly/worker allowances, no `https:`
  or `*` in `connect-src`, every provider origin present exactly once, loopback retained, extra-origin
  normalisation, endpoint would-be-blocked answer), `locality-proof.test.ts` (7 - same/cross-origin
  split, every body-bearing request counted as an upload regardless of method label, websocket and
  event source counted, resource loads counted separately, and the sample PDF's trailer, `startxref`
  target and text escaping), `redaction-verify.test.ts` (14 - a label for every engine check,
  `marks-burned-in` never a pass, page count always information, vacuous image rows downgraded, clean
  verdict with n/a and info rows, failure counted, byte-identical receipt, failure wording, SHA-256
  vectors).
- `pnpm test` **1281/1281** (pdf-core 435, API 210, provider 370, agent 152, web 95, MCP 19).
  `pnpm -r typecheck` and `pnpm build` green; the built `dist/index.html` carries the meta policy and
  `dist/sw.js` carries a real build id. The entry chunk grows 138.7 → **139.8 kB** for the CSP-aware
  registration and SW client (~1.1 kB).
- New `tests/e2e/offline.mjs` (`pnpm test:e2e:offline`), 26 checks, green against a production build
  behind `vite preview`:
  - manifest served, valid JSON, name/`start_url`, 192 + 512 + maskable icons, a real PNG icon;
  - CSP present in the built HTML, `connect-src` an allowlist with `'self'` and no wildcard,
    `form-action 'self'`, `object-src 'none'`, manifest linked;
  - a service worker controls the page, `sw.js` carries a build id and precaches the shell;
  - an online merge records **0 external and 0 body-bearing** requests;
  - with the browser context actually offline, the tool route reloads **from the cached shell** and a
    real client-side merge completes; and
  - `/trust` renders the live `connect-src`, its proof reports **0 body-bearing / 0 cross-origin**
    (page APIs and resources), and the worker reads as active; `/verify` loads with a drop target and
    states what it does not check.
- Browser-verified on the preview with real files: arXiv `1409.0473` verified as **CONTENT REMAINS**
  (no annotations, text operators, metadata stripped all fail, digest
  `84801c8410da51b4…`); the same file redacted through the real Redact tool and re-verified as
  **CLEAN**. A document whose only page content sat under the mark was **refused** by the existing
  fail-closed gate (`page-not-blank: contrast spread only 0`) rather than exported blank - the M5.2
  surface reports the engine's refusal, it does not bypass it.

**Fix outside the brief, recorded because it touched the campaign.** `apps/api/test/children.test.ts`
asserted the watchdog's first kill after a fixed 60 ms sleep; under `pnpm -r test` contention it
failed once (209/210) and passed on every isolated re-run. The fixed sleep is now a 5 s poll and the
post-stop window is longer. Test-only; the watchdog is unchanged.

**Not claimed / accepted gaps.**

- **The CSP is an egress policy, not a full XSS defence.** `script-src` needs `'unsafe-inline'` for
  the inline theme bootstrap and `'wasm-unsafe-eval'` for the PDF engines. Both are stated on
  `/trust` next to the policy instead of being left for a reader to discover.
- **Offline covers what you have already loaded.** The shell is always available once the worker
  installs; a tool's chunk, worker and WebAssembly are cached on first use. A tool never opened while
  online fails offline, and server-backed surfaces (API, workflows, MCP) fail correctly. The suite
  asserts the reload path, not an arbitrary deep link.
- **The verifier cannot see intent or marks.** With no regions it cannot confirm a mark covered the
  right area, and it reads structure rather than pixels, so a photograph of a page passes. Both rows
  are labelled, not silently dropped. Using the Redact tool is the path that checks marks against
  pixels before export.
- **The proof's blind spot.** A worker's internal fetches do not appear in the page's Resource
  Timing. The structural guarantee there is the policy, and the page says so.
- **Not started here:** prerender/sitemap/structured data (M5.5), axe budget and keyboard E2E
  (M5.6), receipt work for editing and structure (M5.3), and the nine `planned` entries (M5.7).
- **`pnpm test:bundle` is red, and was red before this workstream.** The entry chunk is clean
  (139.8 kB, 0 engines), but the "no lazy app chunk carries a PDF engine" rule fails on
  `tool-*.js (161 engine modules)`. Verified against `HEAD` by stashing this workstream, rebuilding
  and re-running the check: the same rule fails there with `tool-B_FHu5Y9.js (161)`. So the tool
  page already runs pdf-lib on the main thread; this commit adds `verify-*.js (3)` for the main-thread
  verifier, a lazy route that only downloads when someone opens `/verify`. Fixing the pre-existing
  violation is engine work with its own plan, so it is recorded rather than quietly re-labelled:
  **M5.4 (perf) owns the tool-page engines, M5.8 owns the campaign staying red-or-green on a
  documented gate.** Nothing here claims §31.10 item 8.
- `test:e2e:offline` is deliberately not chained into `pnpm test:e2e`, which starts from the dev
  server, because this suite needs `pnpm build && pnpm preview`. M5.8's campaign run documents the
  two-server sequence rather than pretending one command covers both.

---

### 31.16 M5.3 result - receipts, structure confidence and the measured limitations (2026-11-04)

**Delivered.** Two surfaces and four engine fixes, each with a test that can fail.

1. **D3 - the editing ladder is a receipt, not a toast.** `apps/web/src/lib/edit-receipt.ts` turns
   `TextEditJobReport` into stable plain text. Every mode has copy that names its consequence;
   `fallback` says the original text is **still in the file underneath**, so it remains selectable,
   searchable and recoverable, and points at Redact if the words must be gone. The receipt has no
   timestamp, so the same export always produces the same bytes. `ExportReceipt` shows it on the
   result screen with a warning treatment when any original remains, and offers Copy and Download.
   The existing one-shot toast now points at it instead of being the only record.

2. **D4 - structure confidence is inspectable and explainable.** `StructurePanel` in the Document
   panel shows the engine's banded overall score (the mean of its eight facets, never a new
   measurement), every facet with its 0..1 value, the engine's own `basis` sentences, and an
   "Explain this extraction" section with the counts it actually read (words → lines → paragraphs →
   blocks, roles, columns, tables, cells, images) plus what it refused to infer. A page with no text
   model says so and offers to read it. `structure-report.ts` adds no confidence of its own: the
   bands (`high ≥ 0.85`, `medium ≥ 0.65`, `low`) are thresholds on the engine's values.

3. **Form-like pages are read as one column.** `looksLikeForm` uses dot leaders as the cheap,
   narrow signal (`≥ 20` rows, leaders on `≥ 3%` of them, at least 5). On the IRS 1040 the leaders
   appear on 21/297 and 23/396 lines; the arXiv papers have 0. When a page looks like a form, gutter
   inference is skipped and the warning/basis say so. Page 0 went from **4 columns / 9 tables / 229
   paragraphs** with shredded cells (`"than four"`, `"(3)"`, `"dependents,"`) to **1 column / 1
   table / 141 paragraphs**, with `"Your first name and middle initial"` intact.

4. **Mixed-alignment tables are accepted, with limits.** Cell alignment is now judged per cell
   (a left-aligned label column and a right-aligned number column can coexist), and table columns
   are built from the recurring gutters rather than clusters of cell starts - the old start-cluster
   split a right-aligned numeric column into one column per number width. The guards that keep prose
   out: a cell's text may not reach into the next column's leftmost start, disjointness is checked
   against the whole group, and a **two-row group whose cells align on different edges is refused**
   (justified prose produces exactly that pattern). On a form-like page a grid needs **three rows**,
   and dot-leader rows are excluded from table detection, because the dots otherwise became cells
   whose text was `"."`.

5. **Cross-page paragraphs are linked, not regrouped.** `DocumentLayout.continuations` records
   `fromPageIndex/fromParagraphId → toPageIndex/toParagraphId` only when the previous last body
   paragraph has no terminal punctuation and the next first body paragraph starts lowercase or with
   a continuation mark, with matching family/size. Pages keep their own paragraphs; the link is an
   annotation. On the real corpus it emits 1 link for arXiv 1409 (page 2 → 3) and 2 for BERT
   (0 → 1, 10 → 11).

6. **Footnote tails are kept above the margin band.** `absorbFootnoteTails` no longer requires the
   margin rule to have called the tail furniture: any unmarked line directly below a footnote, in
   the same column and typography, one line pitch away, and not larger, is re-hinted as a footnote.
   A body-sized paragraph below a footnote is not absorbed.

**Evidence.**

- 30 new web tests: `edit-receipt.test.ts` (15 - only modes that occurred, stable order, no
  timestamp, fallback named by consequence, failed checks carry engine detail, no claim when no
  checks ran, deterministic file name) and `structure-report.test.ts` (15 - mean not re-measurement,
  band thresholds, `basis` passed through unchanged, honest unavailable state, deterministic role
  order, refused-grid wording, image-only page).
- 10 new engine tests: mixed-alignment table, justified-prose refusal, dot-leader form refusal and
  non-form control, footnote tail above the band, body-sized text below a footnote, three
  cross-page cases (linked, terminal punctuation, heading), and the real IRS form assertion.
- `pnpm test` **1321/1321** (pdf-core 445, API 210, provider 370, agent 152, web 125, MCP 19);
  `pnpm -r typecheck` and `pnpm build` green.
- Real corpus: IRS page 0 as above; arXiv table counts are **identical to `HEAD`** (1409: 4, 1810:
  25), so the per-cell change did not inflate tables on prose. Continuations: 1 + 2 as above.
- The editor E2Es `pnpm test:e2e:text-model` (15 checks) and `pnpm test:e2e:text-edit` (8 checks)
  are green on the dev stack after the receipt integration. The text-model suite caught a real
  regression: the receipt's second download button made the primary one's accessible name ambiguous
  (`getByRole('button', { name: 'Download' })` resolved to two elements), so the receipt button is
  labelled **Save receipt**. No E2E selector was weakened to hide it.
- `fontIdentification` now measures what its name says: family recognised by name plus the font
  resource name, instead of blending in adjacency. The form fix exposed the old formula: the IRS
  page 1 scored 0.796 for "Fonts" because its fields sit in many sizes, even though every family
  was recognised. The real-corpus gate (`> 0.9` for standard Latin faces) passes again for the
  stated reason, not because the threshold moved.

**Not claimed / accepted gaps.**

- **Two-row grids are still refused when their cells align on different edges**, and on a form-like
  page any two-row grid is refused. A header plus one data row is therefore text. This is the
  conservative side of the trade: the alternative was accepting justified prose as a table.
- **A form without dot leaders is still read as columns.** The heuristic is deliberately narrow; it
  is not a general form detector. A dotted table of contents will also stay text, because its rows
  are excluded from table detection with the form lines.
- **Continuations are links, not reflow.** Editing the first half of a cross-page paragraph still
  does not move the second half; the editor exposes the link, not a merge.
- **The overall score is the mean of the facets, not a calibrated probability.** It is useful for
  comparing pages and for explaining a refusal; it is not a claim that 62% of the structure is
  right.
- **Two-row false positives on non-form pages pre-date this work and are unchanged.** arXiv 1810
  still reports 25 tables, several of them two-line reference or diagram fragments; the count is
  recorded here rather than presented as a fix.
- **Nothing here changes the editing ladder's decision rules**, redaction serialization or ID
  hashing. The receipt reports the engine's outcomes; it does not re-judge them.
- **`pnpm test:bundle` remains red and pre-existing.** Re-run after this workstream: the main chunk
  is clean (139.8 kB, 0 engines) but the lazy-chunk rule fails on `file-dropzone-*.js` (177 engine
  modules) and `verify-*.js` (3). At `HEAD` the same rule failed on `tool-*.js` (161); the failing
  chunk names moved because this workstream added imports to the editor route, not because the rule
  or the engine boundary changed. M5.4 owns the tool-page engines; M5.8 owns the campaign gate.

---

### 31.17 M5.4 result - performance and resilience (2026-11-04)

**Delivered.** A repeatable ceiling gate, a low-memory worker rule, and two real bundle findings
that the measurement exposed.

1. **`pnpm test:perf` is the Q3/Q7 gate.** `tests/benchmarks/m5-4-ceilings.mjs` measures every live
   tool route at 4x CPU, a 50-page merge's main-thread long tasks, a **200-page** merge on an
   iPhone-13 viewport, and a WebKit (Safari engine) run. It exits non-zero on a breach and writes
   `m5-4-ceilings.md`/`.json`. Each route is measured twice on warm reloads and the faster sample is
   used; both samples are kept in the JSON so a slow outlier is visible rather than silently
   averaged away. CI runs the same script with `M5_PERF_CI=1`, which enforces the public spec
   (1500 ms p95, 100 ms interaction, 200 ms long task, 24 MB heap) rather than the tighter local
   ceilings.

2. **Low-memory worker sizing.** `workerCountFor(cores, deviceMemoryGb)` keeps one spare core per
   worker, capped at four, and drops to **one worker** when the device reports ≤ 2 GB. The rule is a
   pure function with tests; a 4x CPU throttle does not change `hardwareConcurrency`, so the old
   core-only count could not see the phone that actually runs out of memory.

3. **pdf-lib left the tool route.** `IMAGE_LIMITS` lived in `ops/imageDocs.ts`, next to its pdf-lib
   import, and `tool-limits.ts` imported it from the barrel. Every tool page therefore parsed
   pdf-lib to read two integers. The constants moved to `limits.ts`; the tool chunk no longer carries
   an engine, and `test:bundle` moved from `tool-*.js` to only the verifier route. The AI studio is
   also its own lazy chunk now: `AI_EDIT_COPY` moved out of `ai-workspace.tsx`, so the manual editor
   no longer pulls the provider protocols and assistant loop into every route. Tool chunk:
   **608 → 589 kB**.

**Evidence.**

- `pnpm test:perf` (ratified, production preview):
  - tool-ready p95 **549 ms** (ceiling 583) over 51 routes; first interaction **16 ms** (ceiling 23);
    0 script errors. Earlier runs measured 672, 603 and 593 - the threshold is close and the noise is
    real; the two-sample rule and all samples are recorded rather than a single lucky number.
  - 50-page merge at 4x: worst main-thread task **125 ms** (ceiling 200).
  - iPhone-13 Chromium, **200-page** merge: completed in 376 ms, heap **10 MB** (ceiling 15).
  - WebKit iPhone-13, 50-page merge: completed in **257 ms**; heap `n/a` because
    `performance.memory` is Chromium-only. This is the Safari engine under an iPhone viewport, not a
    real iOS device.
- 3 new web tests (`workerCountFor`); `pnpm --filter @pdfshush/pdf-core test` **445/445**.
- `pnpm test:bundle`: main chunk clean; the only remaining engine-bearing app chunk is
  `verify-*.js` (164 modules, the standalone verifier's main-thread pdf.js/pdf-lib path). That is a
  real remaining violation, not a pass.

**Not claimed / accepted gaps.**

- **p95 is close to its ceiling.** The ratified number is 583 ms and this run is 549 ms; across five
  runs the same build measured 549-672. The gate is honest about that by keeping both samples, but a
  single green run is not proof of headroom.
- **iOS Safari itself was not run.** WebKit is not iOS Safari; the run reports `webkit-iphone` and
  the missing heap instead of claiming device coverage.
- **The 200-page measurement is a merge.** Render, redact and dark-mode jobs have per-page costs;
  their ceilings remain the E2E suites' terminal-state checks, not this heap number.
- **The verifier still carries pdf.js/pdf-lib on the main thread.** It is a lazy route and loads
  only when someone opens `/verify`, but it violates the "only workers carry engines" rule. **Closed
  in M5.8 (§31.21)**: the verifier now runs in `verify-worker.ts`, and `test:bundle` is green.

---

### 31.18 M5.5 result - reach without giving up the client (2026-11-04)

**Delivered.** Every route now has real HTML before JavaScript runs, plus the machine-readable
surface a crawler expects.

1. **Prerender at build time.** `apps/web/build/prerender.ts` writes `dist/<route>/index.html` for
   the home page, `/workflows`, `/trust`, `/verify`, `/account` and all 58 tool URLs. The body is
   real content: an h1, the tool description, a plain explanation, the limits and related live
   tools. React replaces it on mount; there is no hydration contract, so the static copy cannot
   disagree with the app after load. One URL per tool is preserved.

2. **Metadata per route.** Title, description, canonical, Open Graph/Twitter tags and a 1200x630
   card under `/og/<slug>.png`. The 59 cards are generated once by `scripts/gen-og.mjs` and
   committed, so the build does not need a native canvas or a browser. Live tools emit
   `SoftwareApplication` JSON-LD (`offers.price = 0`, `operatingSystem = Web`); the home page emits
   `WebSite`. Not-built pages carry `noindex, follow` instead of advertising a missing product.

3. **`sitemap.xml` and `robots.txt`.** The sitemap lists the 49 live tools and the four indexable
   shell routes (53 URLs), with no duplicates and no not-built entries. `robots.txt` allows the
   catalog, disallows `/account` and `/api/`, and points at the sitemap.

4. **The local preview serves the files a static host would.** `vite preview` uses the SPA fallback
   and would answer `/tools/merge-pdf` with the root document; a preview-only middleware rewrites
   it to the prerendered directory index, so the reach test checks the real bytes. A self-hoster
   needs directory-index support (the default for static hosts) and sets `VITE_SITE_ORIGIN` to the
   deployed origin; the default is `https://pdfshush.app`.

**Evidence.**

- New `tests/e2e/reach.mjs` (`pnpm test:e2e:reach`), **65 checks**, green against a production
  preview: canonical origin, sitemap XML, robots, 49 live tool pages with title/description/h1/
  visible text/`SoftwareApplication`, 5 not-built pages `noindex`, a real 41 KB PNG OG card, and
  3,951 characters of visible home text with no JavaScript.
- `pnpm build` emits 63 route files and 53 sitemap URLs; the offline/privacy suite (26 checks) still
  passes against the same build, including the offline deep-link path through the service worker.
- The existing crawler phase of the M5.0 harness will now see content; its old "0 of 52 routes"
  conclusion is superseded by this workstream.

**Not claimed / accepted gaps.**

- **The static body is not React SSR.** It is a separate, deliberately simple document; interactive
  state still starts after the bundle loads. The duplication is bounded because React replaces the
  subtree, but it is not a hydration architecture.
- **The default origin is a project placeholder.** A deployment that forgets `VITE_SITE_ORIGIN` will
  publish canonicals for `pdfshush.app`, which may not be the real domain. The build prints the
  origin it used; M6's deploy step owns setting it.
- **OG cards are generated, not designed per tool.** They share one layout and differ by name,
  description, category and live/not-built state. They are honest cards, not bespoke art.
- **Not-built pages are excluded from the sitemap and `noindex`.** That is deliberate: a search
  result for a tool that does not exist is the broken promise §31.5 exists to remove.

---

### 31.19 M5.6 result - accessibility and input parity (2026-11-04)

**Delivered.** A zero-serious axe gate, a keyboard path through the editor that did not exist
before, and two contrast defects fixed at the shared-chrome level so every tool inherits the fix.

1. **axe over the shell and the top tools.** `tests/e2e/a11y.mjs` runs WCAG 2.2 AA tags over the
   home page, `/workflows` and 13 tool routes (the M5.0 top ten plus Organize, Alternate & Mix and the two AI studios)
   and fails on **critical or serious** findings. Moderate/minor rules are printed with their nodes
   but do not turn the gate red; the budget is zero serious, not "zero anything".

2. **The two shared defects.** The "live" badge used `emerald-600` on a 10% emerald wash; it is now
   `emerald-800` (dark mode `emerald-300`). Footer and tool-card "soon" labels used
   `text-muted-foreground/60` and `/70`; both are now the full token. One fix cleared all 49 home
   cards and every tool page because the chrome is shared. The hero dropzone's `aria-label` did not
   contain its visible text; the label is gone, so its visible sentence is its name.

3. **Keyboard-editable canvas.** The editor page is focusable and described
   ("Press T for the text tool, then Enter to place a text box at the centre…"). With the page
   focused, **T** selects the text tool, **Enter** creates a text box and opens its editor (or, in
   Select mode, selects the topmost object). Overlay objects are focusable with a spoken description
   (`Text object: …, page 1, x …, y …`); Enter selects. Arrow keys nudge, Delete removes and Ctrl+Z
   undoes through the existing global handler.

**Evidence.**

- `pnpm test:e2e:a11y` **17 checks**, green: 15 routes plus the editor with a selected object, zero critical/serious violations, Tab
  traverses the shell, every focused control has a name, and the first stop has a visible focus ring.
- `pnpm test:e2e:keyboard` **19 checks**, green: six tool classes reach a named file picker in 10
  Tab stops; the editor creates a text object with T + Enter, nudges it 7 px with ArrowRight, deletes
  it, restores it with Ctrl+Z, and selects an object with Enter in Select mode.
- CI's perf job now runs axe, keyboard and reach against the same production preview, so the a11y
  gate is not a local-only ritual.

**Not claimed / accepted gaps.**

- **Only 15 routes are in the axe budget.** The shell and the ten highest-traffic tools are the
  §31.10 requirement; the rest share the same chrome, and the final full sweep found 49/49 live
  tools with zero serious violations (§31.21).
- **Keyboard classes are representative, not exhaustive.** Merge, split, page-ops, security, raster
  and stamp are covered; the AI studio and signature pad have their own E2E paths but not this
  keyboard script.
- **No real screen reader was run.** Names, roles and descriptions are asserted through axe and the
  accessibility tree's DOM attributes; that is not the same as a VoiceOver/NVDA session.
- **Focus order starts with the skip-free header.** There is no skip link; Tab reaches the catalog
  in 10 stops, which is recorded rather than called ideal.

---

### 31.20 M5.7 result - the nine parity entries are decisions, not promises (2026-11-04)

**Delivered.** The `planned` state is gone. All 58 catalog entries are now `live` (49) or
`declined` (9); no entry is waiting for a date.

| entry | decision | closest live path |
| --- | --- | --- |
| `pdf-to-word` | declined: faithful DOCX needs styles, lists, tables and font mapping | PDF to Text |
| `pdf-to-excel` | declined: a text dump into cells produces wrong numbers | PDF to Text |
| `pdf-to-ppt` | declined: a JPEG in a `.pptx` is a picture of a slide, not an editable one | PDF to JPG |
| `word-to-pdf` | declined: needs a full office engine, not a tab | print to PDF from Word/Docs |
| `html-to-pdf` | declined: needs a headless browser, SSRF policy and a server | browser Print → Save as PDF |
| `deskew` | declined: angle detection can crop or soften a scan; no guessing | Rotate PDF (exact 90°) + Crop |
| `ocr-pdf` | declined: needs Tesseract/OCRmyPDF; "searchable" would be false | PDF to Text (existing layer only) |
| `sign-workflow` | declined: routing needs accounts, email and a retention policy | Fill & Sign (local) |
| `convert-batch` | declined: depends on the converters above | Batch run (live tools) |

Each declined page keeps its URL, says **"Not built — and here is exactly why"**, states the blocker
and links the closest live path. It is `noindex` and absent from the sitemap. There is no
"Tell me when it ships", no "in development" fallback and no email capture. The reasons are data
(`apps/web/src/tools/declined.ts`) rather than prose scattered through JSX.

> **Superseded in part (2026-11-05 and 2026-11-08).** `deskew` and `ocr-pdf` have since shipped
> client-side (see §8), so today the catalog is 58 entries: **51 live, 7 declined**. The table and
> counts above are the 2026-11-04 record.

**Evidence.**

- `apps/web/src/tools/declined.test.ts` (5 tests): every entry is `live` or `declined`; the 9
  declined slugs match the decision record exactly; counts 58/49/9; every reason is substantive;
  every named alternative is live.
- Browser check on `/tools/pdf-to-word`: "Not built" present, "In development" absent, no
  "coming soon", two links to PDF to Text, one link to the decision record.
- Reach suite still green: 53 sitemap URLs (49 live + 4 shell) and the five sampled declined routes
  are `noindex`.

**Not claimed / accepted gaps.**

- **Declining is not shipping.** A visitor who needs OCR, DOCX or HTML→PDF still has to use another
  product; the page says so rather than pretending a browser tab can do it.
- **This is one commit, not nine.** The workstream text said "one commit per entry"; the change is a
  single catalog-state change with nine records and one test, so splitting it would manufacture nine
  commits that each leave the catalog in the same valid state.
- **A future server product could reopen an entry.** If M6 adds a server renderer or OCR worker, the
  decision is revisited in the open; a declined page is not a permanent prohibition.

---

### 31.21 M5.8 result - release evidence (2026-11-04)

**Delivered.** The final campaign, the verifier moved off the main thread, and the per-tool evidence
table. The `test:bundle` violation that M5.4 recorded was closed by moving `verifyRedaction` into
`apps/web/src/workers/verify-worker.ts`; the verifier route now ships a 12.9 kB page and a worker
chunk, and no app chunk carries an engine.

**Exit criteria (§31.10), item by item.**

| # | criterion | result |
| --- | --- | --- |
| 1 | Q1-Q8 for all 49 live tools | **done** - table below; no undocumented failure |
| 2 | nine `planned` entries resolved | **done** - all nine declined with a reason and a live alternative (§31.20); zero `planned` |
| 3 | prerendered routes, sitemap, structured data | **done** - 63 route files, 53 sitemap URLs, 49 `SoftwareApplication` blocks; reach suite 65 checks |
| 4 | offline + CSP proof | **done** - 26 checks, 0 external / 0 body-bearing, offline merge |
| 5 | user redaction verifier with digest | **done** - `/verify`, worker-backed, 4-check E2E, SHA-256 receipt |
| 6 | axe + keyboard | **done** - 49/49 live tools zero serious on the baseline sweep; 16 a11y checks and 19 keyboard checks |
| 7 | Q3/Q7 ceilings | **done** - p95 499 ms baseline / 545 ms guard, long task 122 ms, interaction 14 ms, heap 10 MB |
| 8 | full campaign | **green except the two container gates** - `test:api` and `test:hardening` could not run because the Docker daemon is unavailable in this environment |
| 9 | result recorded | **this section and §31.12-§31.21** |

**Campaign evidence.**

- `pnpm -r typecheck` green; `pnpm test` **1330/1330** (pdf-core 445, API 210, provider 370, agent
  152, web 134, MCP 19); `pnpm build` green; `pnpm test:bundle` **green** (main 141.2 kB, 0 engines;
  11 lazy app chunks, 0 engines; engines in the worker chunks).
- Browser E2E green on the dev stack: smoke (20 sections), text-edit, text-model, sign, plain-tools,
  next-tools, bookmark-batch, forms-bookmarks, dark-mode.
- Production-preview suites green: offline/privacy (26), reach (71), a11y (17), keyboard (19),
  verifier (4).
- Final `pnpm test:baseline` (production preview, 52 routes): p95 **499 ms** (ceiling 583), first
  interaction **14 ms** (23), 50-page worst long task **122 ms** (200), iPhone-13 heap **10 MB**
  (15), **49/49** live tools zero serious axe, **52/52** crawled routes contain HTML content,
  **49/49** tool pages state a limit, merge determinism identical, 0 external / 0 non-API uploads.
- Final `pnpm test:perf`: p95 **545 ms**, 200-page iPhone heap **10 MB**, WebKit 50-page merge
  **212 ms**.

**Q1-Q8 table (all 49 live tools).** `class-pass` means the row inherits the measured result of a
representative tool in its class, as the baseline labels it; it is not a per-tool run. `heuristic-pass`
for Q8 means the page states a limit (regex, not a human review). `n/a` is used where the class is
server-run or the quality cannot be measured from the client.

| tool | class | Q1 | Q2 | Q3 | Q4 | Q5 | Q6 | Q7 | Q8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `alternate-mix` | merge | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `merge-pdf` | merge | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `organize-pdf` | organize | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `extract-pages` | page-ops | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `split-by-pages` | split | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `split-by-bookmarks` | split | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `split-in-half` | split | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `split-by-size` | split | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `split-by-text` | split | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `edit-pdf` | editor | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `fill-sign` | editor | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `create-forms` | authoring | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `delete-pages` | page-ops | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `compress-pdf` | compress | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `redact-pdf` | security | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `protect-pdf` | security | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `unlock-pdf` | security | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `watermark` | stamp | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `flatten-pdf` | security | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `pdf-to-jpg` | raster | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `pdf-to-text` | extract | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `jpg-to-pdf` | ingest | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `summarize-pdf` | ai | n/a | n/a | pass | n/a | pass | n/a | n/a | heuristic-pass |
| `chat-with-pdf` | ai | n/a | n/a | pass | n/a | pass | n/a | n/a | heuristic-pass |
| `edit-pdf-with-ai` | ai | n/a | n/a | pass | n/a | pass | n/a | n/a | heuristic-pass |
| `bates-numbering` | stamp | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `create-bookmarks` | authoring | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `crop-pdf` | geometry | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `dark-mode-pdf` | raster | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `edit-metadata` | metadata | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `extract-images` | raster | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `flip-pdf` | geometry | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `grayscale-pdf` | raster | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `header-footer` | stamp | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `n-up` | geometry | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `page-numbers` | stamp | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `rename-pdf` | metadata | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `repair-pdf` | compress | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `resize-pdf` | geometry | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `rotate-pdf` | page-ops | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `remove-annotations` | security | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `workflows` | orchestration | n/a | n/a | pass | n/a | pass | n/a | n/a | heuristic-pass |
| `batch-run` | orchestration | n/a | n/a | pass | n/a | pass | n/a | n/a | heuristic-pass |
| `api` | docs | n/a | n/a | pass | n/a | pass | n/a | n/a | heuristic-pass |
| `mcp` | docs | n/a | n/a | pass | n/a | pass | n/a | n/a | heuristic-pass |
| `image-editor` | raster | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `signature` | editor | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `stamp` | stamp | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |
| `combine-pdf` | ingest | class-pass | class-pass | pass | class-pass | pass | class-pass | class-pass | heuristic-pass |

**Remaining limitations, classified.**

- **High - `test:api` and `test:hardening` were not run.** The Docker daemon is not available in this
  environment, so the containerised API/worker and SIGKILL recovery gates cannot be claimed. They
  were green in Phase 4 (§30.8); this milestone changed no API or worker code except the test-only
  poll in M5.2. Re-run `pnpm stack:up && pnpm test:api && pnpm test:hardening` on a Docker host
  before calling the release gate green.
- **Medium - the web bundle still contains a 589 kB tool chunk.** It carries every tool body in one
  lazy chunk; engines are out. Per-tool splitting is a future performance project, not a correctness
  gap.
- **Medium - p95 is close to its ceiling and varies.** 499 ms in the final baseline, 545 ms in the
  guard, 549-672 across runs; the ratified 583 ms is not a large margin.
- **Medium - OCR remains unavailable.** The largest parity gap is now an explicit decline, not an
  unfinished page.
- **Low - the reach origin defaults to `https://pdfshush.app`.** A deployment must set
  `VITE_SITE_ORIGIN`; the build prints what it used.
- **Low - no real screen reader or iOS device was exercised.** axe, the DOM accessibility tree and
  WebKit emulation stand in; the gaps are stated in §31.19 and §31.17.

---

### 31.22 Post-ship bug pass (2026-11-04)

Six defects were found by asking the shipped surfaces to prove their own claims, and fixed
surgically.

1. **The editor failed axe once an object was selected.** The selection state turned the object
   wrapper into a `role="button"` that contained four resize `<button>`s, and the inspector's font
   size input had no label. The wrapper is now a `group` while selected (no nested interactive
   controls), and the input has `aria-label="Font size"`. The editor tool-group headings and status
   text used 72%/75% muted tokens and failed colour contrast; both are now the full
   `--muted-foreground`. `a11y.mjs` now opens the editor, creates a text object and selects it before
   running axe, so the fix is pinned.

2. **Declined pages still advertised themselves as working software.** Their `<title>` said "free and
   private", the description said the file runs in the browser, and the JSON-LD was a
   `SoftwareApplication`. They now say "not built", describe the decision page, and emit a
   `WebPage` entity. They remain `noindex` and out of the sitemap.

3. **The popular row still linked `pdf-to-word`.** A declined tool sat in the home page's
   "Most popular" row. It is replaced by `redact-pdf`, and `popularTools()` now filters to `live` so a
   future catalog edit cannot reintroduce the same bug. A test pins it.

4. **README still promised "in development".** The status table and the permanent-page paragraph now
   describe the not-built decision page and the M5 completion, with the container-gate caveat.

5. **The prerendered pages claimed local processing for server-run tools.** `/tools/workflows`,
   `/tools/api` and `/tools/mcp` were rendered with the generic "parsed inside this browser tab"
   sentence and a local "how it works" list, contradicting the React trust card. Each now carries its
   real data path (server-run, server-side, local process calling the API) and the home lead says
   "every client-side tool", not "every live tool". The reach suite now rejects the local-claim
   phrasing on those three routes.

6. **The prerender source was never committed.** The repo-wide `build/` ignore rule matched
   `apps/web/build/prerender.ts`, so `vite.config.ts` imported a file that existed only on the
   development machine. `.gitignore` now re-includes `apps/web/build/` and the file is tracked; a
   fresh clone can build. This was the most serious finding in the pass: the pushed M5.5 commit was
   not buildable from a clean checkout.

**Evidence.** `pnpm test` **1330/1330** (web 134), `pnpm test:bundle` green, `pnpm test:e2e:a11y`
**17 checks** (including the editor-with-object case), reach **71**, keyboard 19. The declined page
on the production preview now has the title `PDF to Word - not built | PDFShush`, a `WebPage` JSON-LD
block, and the not-built body.

**Not changed.** No engine, redaction, ID-hash or editing-ladder rule was touched. These are surface
fixes: roles, labels, colours, metadata and one catalog row.

---

## 32. Shared editor workspace and interaction pass (2026-11-03)

**Goal.** One PDF editor for the product. Text editing, Edit with AI, redaction and page
organisation now open the same document session, viewport, selection model, undo history and export
surface. The proven PDF engine, the redaction serialization and every fail-closed verification gate
are unchanged.

### 32.1 What the audit found

- One real editor (`edit-pdf-tool`) already owned the page rasters, text model, overlay document and
  history, but Edit with AI, Redact and Organize each shipped a separate document surface, state and
  save path.
- The toolbar was a flat 12-button row with every control visible at once, the inspector was
  object-only, and there was no page rail.
- Motion tokens and React Bits were absent from the editor. The existing anime.js system was used
  only by marketing and the AI studio.

### 32.2 Architecture

- `lib/editor-tools.ts` is the capability registry: tool id, group, shortcut, icon and declared
  capability (selection kind, contextual controls, history, export pipeline, workspace membership).
- `lib/editor-session.ts` is the shared session: tool, zoom, current page, selection, page order,
  overlay document, undo/redo and save status. Every mode reads and writes this one session.
- `components/editor/editor-chrome.tsx` owns the top bar, vertical tool rail, contextual bar, page
  rail and status bar. All presentational; no component opens a second document.
- `components/editor/editor-ai-panel.tsx` hosts the assistant in the shared inspector. It receives
  the workspace's file, page and text selection; proposals are read-only overlays in the same
  viewport and only apply through the existing `applyEditPlan` engine path.
- `editor-page.tsx` gained read-only proposal overlays and redaction review geometry, but its
  gesture/rendering contract is unchanged.

Mode switching keeps the open document, zoom, page, overlay objects and history. Redaction marks are
ordinary display-space geometry that the redact job receives as `RedactRegion`s; the engine still
rebuilds and verifies every page. Organize uses the same rail and sends an explicit `PageRef[]` to the
existing organize job.

### 32.3 Interaction and visual system

- Fixed application frame: document first, one quiet tool rail, one contextual bar, compact page
  rail, contextual inspector and a 30 px status bar.
- Six motion tokens in `lib/motion.ts` (`UI.micro` 120 ms to `UI.complex` 360 ms). The active-tool
  indicator, contextual content, inspector content and proposal counts use anime.js through the
  existing scope/cleanup wrapper. `prefers-reduced-motion` collapses all of it.
- React Bits `SpotlightCard` is vendored (TS + Tailwind) and bound to the theme. `AnimatedContent`
  and `CountUp` keep the React Bits API but use anime.js because the official variants require GSAP
  and `motion/react`, which are not dependencies. No component sits above a page pointer target.
- The AI editor's existing frontispiece and export receipt were preserved inside the new flow:
  `AiCover` and `AiExport` still carry `StudioWaves` (the React Bits `GradientWaves` shader) and
  their anime.js entrance timelines. The cover is shown before a document is open; the receipt is
  shown after the proposal ledger is applied. The in-editor assistant rail adds a quiet emerald wash
  rather than a second shader, so the document itself stays the hero.
- Keyboard: V/S select, T text, H highlight, A assistant, R redact, Ctrl+Z/Y, Ctrl+S, Ctrl+0,
  Ctrl +/- and arrow nudges. Focus is visible, the confirm dialog autofocuses and closes on Escape.

### 32.4 Verification

| gate | result |
| --- | --- |
| `pnpm -r typecheck` | green |
| `pnpm test` | **1224/1224** (web 46) |
| `pnpm build` | green |
| `pnpm test:bundle` | green (main chunk 138.1 kB, 0 engines) |
| `test:e2e:text-edit` | all checks |
| `test:e2e:text-model` | all checks |
| `test:e2e:sign` | all checks |
| `test:e2e:ai` | all checks |
| `test:e2e:ai-managed` | all checks |
| `test:e2e` (full smoke incl. editor, Organize, Redact) | **ALL CHECKS PASSED** |

### 32.5 Deliberate boundaries

- AI proposals are a review ledger, not a silent mutation. Manual edits and AI proposals do not share
  a single undo step because applying the ledger writes a new document; the ledger itself supports
  per-change discard and the engine result is re-parsed before download.
- Redaction remains destructive by design and still rebuilds every page. The shared editor makes the
  loss visible before confirmation rather than changing the security boundary.
- Page organisation exports page order only. If manual overlay objects exist, the inspector says so
  explicitly; it never silently claims they were included.

---

## 33. Monetization — freemium, ads and the revenue spine (decided 2026-11-04)

**Status: a decision record, with M6.1 partly built.** It exists because the site already promises
things the plan never decided (`Pricing (soon)` in the footer, "optional paid plans will exist in
the future" in the landing FAQ), and §25.1 fences pricing out of P6 without ever picking it up
again. A promise with no owner is the §31.5 failure mode. **The launch shape was decided and built
on 2026-11-13 (§33.4, §33.11): the frontend ships on Cloudflare Pages and the server tier is
parked.** Nothing in §33.3–§33.6 — the plan catalog, entitlements, Stripe, the pricing page, ads —
is built, and the live site must not imply otherwise.

### 33.1 The decision

**Business model.** Freemium SaaS. All client-side PDF tools stay **free forever, unmetered and
ungated**; revenue comes from server-side and premium services. This is not a concession — it is
the cost model (§33.2).

**Free tier.** All 50 client-side tools, no sign-up, no watermark, no task quota; BYOK AI; tight
server quotas; content-page ads.

**Paid tiers.** Ad-free everywhere, higher/unlimited server limits, priority processing, premium
AI, API volume, batch, cloud retention, teams. Explicitly **not** gated: any tool that runs in the
worker.

**Ads.** Content routes only — home, pricing, blog, guides, documentation, tool *marketing* pages.
**Never** on `/tools/*` tool bodies, the editor, upload/preview/download states, AI workflows,
auth, account or billing. No ad that resembles a download button, system notice or app control.
Paid = zero ads platform-wide.

**Budget.** Bootstrap: near-zero fixed monthly cost at launch, upgrading only from revenue. The
architecture must therefore stay deployable on free tiers (§33.4) and must never put an unmetered
server-side feature in the free tier (§33.2).

**Timeline.** First revenue in 1–3 months, with a polished launch rather than a rushed one;
prices are ratified against a measured cost model (§33.7) and then iterated.

### 33.2 The cost asymmetry — the rule everything else follows

A client-side tool costs **$0 marginal** per use: compute is the user's, bytes never touch us, the
CDN serves a cached chunk. A server-side job costs real money per use: worker CPU, Redis, storage
TTL, and (for managed AI) tokens.

Three rules follow, and they are not negotiable while the budget is near-zero:

1. **SEO growth must land on client-side tools.** Free traffic is only free if it runs in the
   browser. A campaign that drives anonymous traffic into server slugs is a bill, not growth.
2. **Every free server-side entitlement needs a global circuit breaker,** not only per-subject
   caps. `quota/quota.ts` enforces per-subject limits today; there is no global daily ceiling, so
   a botnet with many IPs can still run up CPU and AI spend. Add a deployment-wide budget that
   fails closed with an honest "capacity reached, try later" message.
3. **Free managed AI is a cost leak with no revenue.** `AI_MANAGED_*` budgets exist (200k/day
   signed in, 20k/day anonymous) and are off unless a key is set. Keep it that way: free AI is
   **BYOK (zero server cost)**, plus at most a small one-time trial under the global breaker.
   Never an ongoing free managed allowance.

### 33.3 Launch scope — what the first paid release sells

Only features that already exist, or that are a small delta on what exists. A pricing page may not
advertise anything else (§33.6).

| Sellable now | Already built | Delta needed |
| --- | --- | --- |
| Managed AI credits | `apps/api` AI gateway + per-subject budgets | plan-aware budgets, usage ledger |
| API volume | `/api/v1`, keys, scopes, 8 server slugs | metered monthly ledger, plan tiers |
| Priority processing | BullMQ worker | a second queue lane + plan check |
| Cloud retention / history sync | accounts, Mongo, synced history | retention window per plan |
| Batch running | local batch runner + workflows | higher file caps for paid |

**Explicitly not in the first release** (and therefore not on the pricing page): OCR, Office
conversion, teams/seats/SSO, hosted MCP, cloud document storage. Each is either a research-grade
build (conversion), a paid dependency (OCR), or a data model that does not exist (teams). They are
the *revenue-funded* roadmap, not the launch.

### 33.4 Deployment — the hard blocker before any revenue

**State on 2026-11-04:** absent — no web Dockerfile, no reverse-proxy config, no deploy workflow,
no `web` service in `docker-compose.yml`, and no hosting doc anywhere in the plan.

**State on 2026-11-13:** the owner bought `https://pdfshush.space`, and the deployment shape was
**changed** on that day: the frontend ships on **Cloudflare Pages** (free, no card) and the server
tier is **parked** (§33.11). The Caddy/Tunnel/VPS artifacts that were drafted earlier the same
day were removed rather than left behind as dead configuration. **M6.1 is still not delivered**:
it is delivered when the gate at the end of this section passes on the public URL. Files are not
evidence.

**One origin, or none of the auth works.** `apps/web/src/lib/api.ts` calls `/api` with
`SameSite=Lax` session cookies and **there is no CORS layer in `apps/api`**. Splitting the SPA and
the API across hosts requires CORS + `SameSite=None; Secure` + re-proving the double-submit CSRF
design. Do not do that to save $0.

**Chosen shape (as built, 2026-11-13):**

```
GitHub (main)
  └── Cloudflare Pages (free plan, Git integration, no card)
        ├── /              → the app shell
        ├── /tools/<slug>  → 58 prerendered tool pages (real HTML, no JavaScript needed)
        ├── /sitemap.xml, /robots.txt, /404.html
        └── /assets/*      → content-hashed, immutable for a year
```

The API, the BullMQ worker, Redis and MongoDB **stay in the repository and in
`docker-compose.yml`** for local development. They are not deployed, and the app is built with
`VITE_SERVER_API=off` so that every server-backed surface says so instead of offering a control
that could only fail (§33.11).

This replaced the 2026-11-04 sketch (one VPS behind Caddy, Cloudflare DNS/TLS) and the
same-day draft of it (a VPS behind Caddy and a Cloudflare Tunnel). The reason is cost and
honesty, not convenience: the Always Free A1 instance needs a credit or debit card that behaves
like a credit card, and a free instance that can be reclaimed after seven idle days is not a place
to put a product's public face. Cloudflare Pages needs no card, has no idle-reclamation rule, and
costs nothing — and **51 of the 58 tools run in the visitor's browser**, so a static host is not a
demotion, it is the cheapest correct hosting for the product's actual centre of gravity.

The server tier is deferred to a later milestone, not cancelled. When it comes, the work is small
because the app already reads the deployment shape: the same source produces both builds.

**Exit gate:** the production URL serves the prerendered routes, the sitemap and `robots.txt`;
`/api/*` answers **404** (there is no API, by design); one client tool runs end to end; and
`tests/e2e/smoke.mjs` is green against `E2E_BASE_URL`. The server-backed checks (accounts, a
workflow run, the REST API) **skip** in this shape and say which dependency was missing.

**Gate mechanics (2026-11-13).** `E2E_BASE_URL=https://pdfshush.space pnpm test:e2e` now works: the
shared `tests/support/preflight.mjs` checks that origin and **skips the local compose assertions**,
because a running local stack says nothing about the deployment under test. The preflight reports a
missing API as a note rather than a failure — a frontend-only deployment is a valid shape, and the
suites themselves branch on what they need. `docs/DEPLOY.md` §7 is the executable form of this
paragraph.

### 33.5 Ads — scoped so they cannot damage the claim

Prerequisites before applying (all currently missing): a deployed domain, a real **privacy policy**
disclosing third-party ad cookies, `robots.txt` + `sitemap.xml`, prerendered content, and enough
substantive copy per page to clear a "low value content" review. The nine `planned` entries must
be resolved (§31.5) or excluded from the ad-bearing set.

- **Two CSP profiles.** Tool routes keep the strict policy with **zero** ad origins; content
  routes get an explicit ad allowlist (`script-src`, `connect-src`, `frame-src`, `img-src`). The
  locality proof from §31.4/D1 is scoped to tool routes, which is where the claim matters.
- **Non-personalized ads + a Google-certified CMP** (TCF v2.2) for EEA/UK/CH. Lower RPM, intact
  story. Personalised ads are a later, explicit decision.
- **A test that fails the build** if an ad origin is reachable from, or an ad slot renders on, a
  document-processing route.
- **Revenue honesty:** utility SEO traffic earns little and approval is not guaranteed. Ads are a
  hedge on content traffic; **subscriptions are the business.** Do not model the plan on ads.

### 33.6 The truthfulness invariant (this is what makes pricing "superb")

One plan catalog — `packages/api-contracts/src/plans.ts` — is the single source of truth for price,
limits and feature flags. The `/pricing` page, the entitlement resolver, the Stripe price lookup
and the marketing copy all derive from it.

- **CI parity test:** a plan may not advertise a feature the entitlement resolver cannot enforce,
  and a rendered limit must equal the enforced limit. A pricing page that lies is a Q1 failure, not
  a copy bug.
- **No tier ships before its gate.** Selling "priority queue" before the lane exists is the same
  class of defect as the toast that claimed there was no account system (fixed 2026-11-04, §8).
- **Provisional anchors** (to be ratified, not published): Free $0 · Pro ~$7/mo · Team ~$16/seat ·
  API metered from usage. Annual ≈ two months free. Numbers are set *after* §33.7, never before.

### 33.7 Cost model, then price

Required before any price is published: managed-AI cost per 1k tokens at the default model; worker
cost per job-minute; Redis/storage per GB-month. Then price at a target gross margin, with the
free-tier global breaker sized to the monthly infrastructure budget. Same discipline as §30: no
target before the first measurement.

### 33.8 Licensing — decide before Stripe code lands

PDFShush is **AGPL-3.0-or-later**. Running it as a network service means users are entitled to the
source of what they interact with, and a billing/entitlement module written into this repository is
AGPL code like everything else. "Open core with a closed billing module" needs a **CLA and a
dual-licence decision first**. Options: (a) keep everything AGPL and monetize the hosted service
(simplest, current default), (b) add a CLA now while the contributor set is small and dual-licence
later. Decide before `billing/` exists, not after.

### 33.9 Milestones and gates

| | Scope | Exit gate |
| --- | --- | --- |
| **M6.1** | Deploy the frontend to a real origin (Cloudflare Pages), production env, custom domain | §33.4 gate green on the public URL — 🟡 **build + configuration verified locally 2026-11-13 (§33.11); the public gate has not run** |
| **M6.1b** | Server tier: the Express API, the BullMQ worker, Redis and MongoDB on a persistent host | ⛔ **deferred** — it needs a host that runs a queue and a writable volume, and every card-free option either sleeps or expires (§33.11). The code stays and runs locally |
| **M6.2** | Content + policy: privacy, terms, about, contact, status; per-tool content; prerender, sitemap, robots, JSON-LD (absorbs M5.5) | crawler sees unique title/h1/canonical per route with JS off |
| **M6.3** | Plan catalog + entitlements + usage ledger + global budget breaker | parity test green; breaker verified by a load test |
| **M6.4** | Stripe test mode: Checkout, portal, webhook, subscription state | buy → limit rises → cancel → reverts; replay idempotent |
| **M6.5** | `/pricing` + landing pricing band, generated from the catalog | Q1 review: every claim maps to an enforced entitlement |
| **M6.6** | Ads on content routes only, CMP, two CSP profiles | ad absent on every tool route; zero document bytes to ad origins |

### 33.10 Open decisions owned by the project owner

1. ~~Domain + VPS/Cloudflare access~~ → **domain bought (`pdfshush.space`)**; a free Cloudflare
   account is still needed to create the Pages project and attach the domain (§33.11). No VPS and no
   card are required.
2. Stripe account + business entity/tax details (M6.4; no card data ever reaches us).
3. AGPL/CLA stance (§33.8) before billing code.
4. Ratified prices after §33.7.
5. Keep ads, decline ads, or defer to M7 — the pricing page works either way.

### 33.11 M6.1 — the frontend ships on Cloudflare Pages, the server tier is parked (2026-11-13)

The owner bought `https://pdfshush.space` and set a hard constraint: **₹0/month, no credit card,
no paid infrastructure.** That constraint decided the architecture, and it deleted more than it
added.

**What was removed.** The same-day drafts of a VPS deployment — `infra/docker/web.Dockerfile`,
`infra/caddy/Caddyfile`, the `web` and `cloudflared` compose services, `infra/deploy.sh`,
`.env.production.example` — were **deleted**, not left behind as dead configuration. The
`docker-compose.yml` and `package.json` were restored to their pre-draft state, so `pnpm stack:up`
still brings up exactly the redis + api + worker it always did. The backend is untouched: it is the
same Express API, the same BullMQ worker, the same Redis, the same MongoDB, still in the repository
and still runnable locally.

**Why the VPS plan did not survive the constraint.** Every genuinely free always-on host for a
Node process with a persistent queue requires a card:

- **Oracle Always Free A1** — 2 OCPU / 12 GB (the 4/24 figure in older material is stale), 200 GB
  of storage, 10 TB of egress, and **no end date** — but it **requires a credit or debit card that
  behaves like a credit card** (it refuses PIN-debit, virtual, single-use and prepaid cards), and
  it can **reclaim the instance** when CPU, network and memory all sit under 20% at the 95th
  percentile for seven days. An Always-Free-only tenancy gets no support.
- **Fly.io** — no free tier for new organisations, only a $1 seven-day trial.
- **Koyeb** — the free Starter plan was discontinued on 17 Feb 2026; new accounts start on Pro at
  $29/month. The docs still describe a free instance; it is not available to new users.
- **Render** — a free web service exists (512 MB, 0.1 CPU) but spins down after 15 idle minutes,
  has an ephemeral disk and **no free background worker**, and its free Postgres expires after 30
  days. The BullMQ worker and the `PEPPER` secret both break on a sleeping host.
- **Upstash Redis** — verified to **not support blocking commands** (BLPOP/BRPOP/BRPOPLPUSH), which
  BullMQ requires, so it cannot be the broker.
- **Cloudflare Pages** — free, **no card**, 500 builds a month, unlimited static bandwidth, free
  TLS, and a Git integration that deploys on every push. This is what ships.

**What was built.**

| Artifact | Why it exists |
| --- | --- |
| `apps/web/src/lib/deployment.ts` | The deployment shape, decided at **build time** by `VITE_SERVER_API=off`. A static host has no `/api` to ask, so a runtime probe would cost every page load a failed request and still only guess — *"the API did not answer"* and *"there is no API"* are the same observation. The deployment knows; the build records it. |
| `apps/web/public/_headers` | The Pages cache policy: `/assets/*` immutable for a year (Vite hashes those names), the shell, the service worker and the manifest revalidated. Deliberately **no `/*` cache rule**: Pages joins the headers of every matching rule, so a catch-all would turn "immutable" into "immutable, no-cache". |
| `apps/web/build/prerender.ts` → flat `dist/<route>.html` | Cloudflare Pages resolves a directory's `index.html` only at the **trailing-slash** URL (`/tools/merge-pdf` → 308 → `/tools/merge-pdf/`), which would leave every canonical URL and all 55 sitemap entries pointing at a redirect. A flat file is served at the extension-less path with a **200**, verified against Pages' own emulator. The build also emits a top-level `404.html`, so an unknown URL gets a real **404** instead of the app shell and a 200. |
| `apps/web/src/lib/api.ts`, `hooks/use-auth.ts`, `lib/ai/managed.ts`, `lib/workflows.ts`, `lib/mcp-catalog.ts` | Every server-backed surface asks the deployment shape first: no request is made, no control is offered, and the copy says why. The MCP catalog gains an `unavailable` state, which is a different answer from `failed` — nothing is wrong, there is simply no server, and a "Retry" button would be a lie. |
| `pages/account.tsx`, `pages/workflows.tsx`, `components/tools/api-tool.tsx`, `components/tools/mcp-tool.tsx`, `components/landing/mcp-dialog.tsx` | The honest surface: no sign-in, no account panel, no workflow runner, an API reference that documents the surface without pretending it is reachable. What is **not** disabled: all 51 browser tools, the editor, redaction, OCR, the service worker, the offline mode, and every catalog page. |
| `tests/support/preflight.mjs` | `E2E_BASE_URL` makes the shared preflight check the **remote** origin and skip the local compose assertions. Before this, the documented §33.4 gate could not run against production at all. A missing API is now a **note**, not a failure: a frontend-only deployment is a valid shape. |
| `tests/e2e/smoke.mjs` | The account assertions branch on the deployment shape. They used to read *"no catalog"* as *"accounts enabled"*, which is what made the suite demand a sign-in control on a static deployment. |
| `docs/DEPLOY.md` | The runbook: the Pages project, the two build variables, the custom domain, the verification commands, day-2 operations and troubleshooting. |
| `.node-version` | Node 24 for the Pages build image. |

**Verified locally, against Pages' own emulator** (`wrangler pages dev`, Cloudflare's local
implementation of the Pages asset router): the prerendered routes answer **200** with the right
`<h1>`, canonical and JSON-LD; the trailing-slash and `.html` forms 308 to the canonical URL;
`/sitemap.xml`, `/robots.txt` and `/sw.js` answer 200 with the intended cache headers; an unknown
URL and `/api/*` answer **404**; and the full smoke suite plus reach, offline, a11y, keyboard,
verify, plain-tools, next-tools, forms-bookmarks, bookmark-batch, dark-mode, deskew, OCR, text-edit
and text-model suites are green against that origin, with **no console errors**.

**Not claimed.** No Cloudflare account has been created, no Pages project exists, the public URL
has never answered, and **M6.1 stays open** until `docs/DEPLOY.md` §7 is green against
`https://pdfshush.space`. §33.4's rule applies to this section too — files are not evidence.

**Known, pre-existing, unrelated:** `tests/e2e/sign.mjs` fails its "the manage page saves a
signature" check against any **production build** (it passes against the dev server). Reproduced
from an untouched checkout of `main`, so it is not a regression from this work; it is a separate
defect and it is not claimed green here.









---

## 34. Responsive product shell (2026-11-05)

### 34.1 One session, three interaction models

The PDF engine, `useEditorDoc` snapshot history, `useEditorSession`, page order, save/export
pipelines, annotations, text editing and AI proposal flow are untouched. Only the chrome and the
shell's layout rules changed. There is no mobile fork and no second editor.

- **Desktop (>=1100 px):** the existing three-column workstation. Tool rail, page rail and
  properties inspector stay docked; the full toolbar, hints, zoom controls and keyboard help
  remain. The desktop marketing hero is unchanged.
- **Tablet (600-1099 px):** the same surfaces with touch-sized controls and reduced density.
  The page rail is a collapsible overlay. The inspector is a bottom panel in portrait and a right
  drawer in landscape. The tool rail is 56 px wide with 38 px buttons. 1024 px is deliberately
  classified as tablet, not desktop.
- **Phone (<=599 px):** a document-first application (below). The marketing site is a quiet
  editorial page rather than a compressed desktop composition.

### 34.2 Phone editor

- **Top bar:** back, filename, page count, save state/save action, and a document-actions sheet
  (save, open another file, workspaces, start over, close). The site header is hidden while the
  editor is open, so the application owns the full viewport.
- **Canvas:** maximum height. Small gutters, no decorative radial wash. Floating page/zoom HUD with
  36-40 px targets. Pinch-to-zoom owns two-finger gestures; one-finger pan and drawing keep their
  existing pointer path. Rotating the device re-fits the page when the user has not chosen a zoom.
- **Tools:** the existing tool registry rendered as a horizontal thumb strip. Group labels and the
  page-rail toggle are hidden; the active tool gets a filled accent.
- **Bottom navigation:** Edit, Annotate, Pages, AI. Annotate is not a second mode: it opens Edit
  with the highlighter armed. Sign and Redact routes substitute their own first tab.
- **Contextual controls:** object/style actions come first in the context bar; detailed colour,
  font, size and stroke controls scroll after them. The properties sheet is explicitly opened via
  the sliders button and dismissed via close or deselect. Creating a new mark does not slam a
  sheet over the page.
- **Workspaces:** Pages becomes a full-width two-column page grid with page actions. AI becomes a
  full-height pane with its own composer and model gate. Redaction keeps its disclosure panel
  visible.
- **Safety:** closing a dirty document opens an explicit Keep editing / Discard and close dialog.
  Bottom bars and sheets account for `env(safe-area-inset-bottom)`; the top bar announces save
  state through a polite live region.

### 34.3 Marketing

Phones no longer receive the Greek plate, frosted hero panels, document poster image or feature
video. The hero keeps one functional upload console. The AI section keeps only an "AI tools" kicker
and three compact links; the large interactive mock is desktop/tablet only. The comparison table
and CTA keep their content with reduced padding. At 600-1023 px the marketing page uses the same
clean editorial treatment, while >=1024 px keeps the full photographic composition.

The hero plate is also no longer downloaded below 1024 px: `<picture><source media="(min-width:
1024px)">` chooses the real image on desktop and a 1x1 transparent fallback elsewhere. A Playwright
request audit confirms zero `/hero/` requests at 390 px and only the active theme's plate at 1024 px
(light: day; dark: night).

### 34.4 Defects found and fixed in this session

1. **Hook-order crash on save (critical).** Two `useCallback` hooks were placed after the
   `editState.status === 'done'` early return. Saving changed the hook count and React aborted the
   route with error #300. The handlers became plain functions below the early returns; every hook
   is now above them. Verified by saving and downloading on a 390 px viewport.
2. **Result action row clipped Download (mobile).** `shrink-0` prevented the three actions from
   fitting at 390 px. Buttons now stack full-width under `sm` and return to a row at `sm+`.
3. **Mobile AI links overflowed the page.** A nowrap child set the grid item's min-content width,
   producing a 438 px document at a 390 px viewport. `grid-cols-1` and `min-w-0` fixed it; the
   overflow sweep is now clean on home, editor, merge, workflows and trust.
4. **Mobile still downloaded the decorative hero.** CSS `display:none` does not stop an eager
   image request. The `<picture>` media source removes the transfer entirely below 1024 px.
5. **Accessibility regressions caught by axe at 390 px.** The zoom readout's accessible name did
   not include its visible percentage, and the comparison table's emerald text failed AA contrast.
   The name now starts with the visible percentage and the row uses the theme's deep emerald
   `text-primary`.
6. **The desktop hero regressed to lazy loading.** The phone-saving change left the day plate at
   `loading="lazy"` while still asking for `fetchPriority="high"`. Those are contradictory: the
   plate is above the fold on desktop, so it is eager again. The `<source media>` still prevents
   the download below 1024 px, which is the actual mobile saving.
7. **The responsive sweep counted hidden content as unrevealed.** The phone hides two
   `data-reveal` blocks (the AI tabs and the feature video); an IntersectionObserver can never
   reveal `display:none`, so the sweep now ignores non-rendered blocks. It is clean across 6
   breakpoints × 2 themes × 6 routes.
8. **Decorative studio waves were reported as overflow.** They extend past the viewport inside an
   `overflow:hidden` cover, so the page never scrolls; they are now marked `data-bleed` (the
   sweep's documented exception for deliberately clipped art) instead of being treated as a
   layout defect.

### 34.5 Verification

- `pnpm -r typecheck` - all packages.
- `pnpm test` - **1 356/1 356** unit tests: engine 455, API 214, provider 370, agent 152, web 146,
  MCP 19.
- `pnpm build` - green; `pnpm test:bundle` - green (main 152.7 kB, 0 engines, 17 lazy app chunks
  with 0 engines, engines only in worker chunks).
- `pnpm audit --prod --audit-level high` - no known vulnerabilities.
- Browser E2E against the dev stack and the production preview: full smoke, `deskew`, `dark-mode`,
  `plain-tools`, `next-tools`, `keyboard`, `a11y` (all routes plus the editor with a selected
  object, zero critical/serious axe findings), `offline`, `reach` and `verify` all green. The
  preview's intentionally absent API still produces two 502 console entries on the AI route; the
  suite reports them honestly and they are not a responsive failure.
- `pnpm test:sweep` - clean across 6 breakpoints × 2 themes × 6 routes after ignoring hidden
  reveal blocks and marking the clipped studio waves as `data-bleed`.
- Manual Playwright at **320, 390, 430, 599, 600, 700, 768, 1024 and 1280 px**: no horizontal
  overflow; editor opens; annotation draw; undo/redo; page next/previous; page delete; properties
  sheet; AI workspace; save and browser PDF download; pinch 65% -> 130% and fit reset. Mobile axe
  (390 px) is clean on home, editor and editor-with-properties. An independent 390/768 px pass
  additionally verified the bottom nav, HUD, properties sheet open/close, unsaved-close guard,
  phone save/download and tablet nav hiding.

- `pnpm test:e2e:stale-build` - 8/8. Simulates a missing hashed stylesheet (SPA fallback returns
  HTML with zero CSS rules) and an aborted lazy route chunk; both recover to a fresh shell once,
  with real style rules, the tool page and a usable file input.

### 34.6 Boundaries and next device pass

- No new dependencies and no new network requests from the responsive work.
- Chrome/Edge emulation with real touch events was used; a physical iOS Safari and Android Chrome
  pass is still the right next check (notch safe areas, software keyboard, pinch inertia).
- AI model completion was not exercised here because no provider key is configured in this
  environment; the panel, model gate and navigation were verified, and the existing AI E2E covers
  the real model path.
- The containerised `test:api` / `test:hardening` gates remain unrun (Docker unavailable), as
  recorded in section 31.21.

### 34.7 Stale-build recovery (2026-11-05 follow-up)

A report from `localhost:4173/tools/edit-pdf#main` showed an unstyled page - a giant wordmark,
inline nav/footer and the route error boundary. Reproduction on the same preview was clean, so the
state was a tab that had outlived a rebuild: its HTML referenced a hashed stylesheet/lazy chunk
that the new build had deleted. Vite preview's SPA fallback answers a missing `/assets/*.css`
request with `index.html` and a 200, so the browser had a stylesheet object with **zero rules**
instead of a 404. The missing route chunk then opened the error boundary. A reload alone was not
guaranteed to clear a waiting worker or the old shell.

The fix is in `lib/build-recovery.ts`, wired from `main.tsx`:

- `vite:preloadError` and chunk-shaped `unhandledrejection` errors trigger a fresh-shell reload.
- Same-origin stylesheets are considered failed when `link.sheet` is null **or** `cssRules.length`
  is zero. The zero-rule case is the SPA-fallback failure that a normal `error` event never sees.
- Recovery is allowed once per 15 s. It unregisters PDFShush's service worker, deletes only
  `pdfshush-*` caches, and reloads with a `__build=<timestamp>` query so neither the browser nor a
  worker can hand back the old shell.
- The route error boundary's **Reload page** now performs the same hard reset instead of a plain
  `window.location.reload()`.
- Service-worker navigations fetch with `cache: 'no-store'`; the offline `/index.html` remains the
  fallback when the network is genuinely unavailable.
- Vite preview now returns a real 404 for a missing `/assets/*` file instead of its history
  fallback shell. The empty-stylesheet case is still handled for production servers that fall back,
  but locally the mismatch now fails visibly.
- `index.html` gained a tiny critical fallback style: body surface/ink and a 9 rem cap on the
  wordmark SVG. Even if a future deploy loses the stylesheet entirely, the failure is readable
  instead of a full-viewport logo. It deliberately does not redefine Tailwind's `sr-only`; the
  accessibility utility stays owned by the layered stylesheet.

A permanent regression suite, `tests/e2e/stale-build.mjs` (`pnpm test:e2e:stale-build`), simulates
both failures against the production preview and fails if recovery does not happen. It passes 8/8:
a fresh `__build` URL, 749 real style rules, no error boundary, no stale link, the Edit PDF heading,
a usable file input and no route boundary after the chunk retry.

**Verification for this follow-up:** `pnpm -r typecheck`; `pnpm test` **1 356/1 356** (web 146,
including the new recovery-guard tests); `pnpm build`; `pnpm test:bundle` green; `a11y` green; the
new `stale-build` E2E green. An already-open tab from a previous build still needs one manual
refresh to pick up this recovery code; every later stale state is handled automatically.

## 35. PDF audit — session 5: the share boundary (2026-11-11)

Branch `pdf/s5-share`, cut from `pdf/s4-editor` at `20280e5`. Documents:
`docs/pdf-audit/FINDINGS.md` (session 5), `SHARE-SPEC.md`, `FINAL-REPORT.md`,
`METRICS.md` (session 5).

### 35.1 SHARE is not implemented

The session was scoped to sharing. There is no share route, token, link format
or viewer page in `apps/` or `packages/`, and no commit in `git log --all` ever
added one (`FINDINGS.md`, `PDF-SHARE-000`). Building it means choosing a public
API, a storage schema and a link format, so it was not guessed. The session
instead audited the capability that does let a second party reach a document —
the per-job `jobId` + `x-job-token` — and wrote `SHARE-SPEC.md` (32-byte CSPRNG
token, base64url path `/s/<token>`, SHA-256 at rest, TTL + revoke, scrypt
password, `no-referrer`, range support, view/download permissions, storage
schema, routes and threat model) as a decision document only.

### 35.2 Fixed

- `PDF-SHARE-001` (MEDIUM, `2cba94c`) — job state and results carried no
  `Cache-Control`, while the URL carries no secret (the token is a header). A
  shared cache could replay a document to a caller without the token and keep
  replaying it after expiry/revocation. `Cache-Control: private, no-store` and
  `Vary: x-job-token` now apply to `/api/jobs` and `/api/v1/jobs`, ahead of
  auth, so 400/403/404/503 answers are covered too.
- `PDF-SHARE-003` (LOW, `8e2fd65`) — the download's `Content-Disposition`
  trusted the queue's file name instead of re-sanitising it at the header; a
  quote produced a malformed quoted-string.
- `PDF-REDACT-001` (LOW, `f922d62`) — a page fully covered by its marks was
  refused ("contrast spread only -255") because the blank-page scan asserted
  over an empty sample set. It now skips the vacuous comparison; blankness is
  still caught by `marks-burned-in`.

### 35.3 Needs decision

- `PDF-SHARE-002` (MEDIUM) — a finished result cannot be revoked: `DELETE
  /api/jobs/:id` answers 409 and the same token keeps downloading until the
  one-hour TTL. Making DELETE remove a finished result changes a shipped status
  code and public contract, so it is parked with an `it.fails` repro.
- `SHARE-SPEC.md` §9 lists twelve share-design decisions (storage lifetime,
  view/download semantics, edit permission, expiry, status codes, password
  policy, backend, cascade, origin, audit, anonymous owners, embedding).

### 35.4 Verification (live, this session)

The stack could start for the first time in this audit (Docker 29.8.2 + Redis
container + API + web), so the gated suites ran for real:

| Step | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | pass |
| Unit | `pnpm test` | 1496 passed, 0 failed, 8 expected fail, 117 files |
| Build | `pnpm build` | pass, 63 routes prerendered |
| Bundle | `pnpm test:bundle` | pass, 0 engines in app chunks |
| Preflight | `node tests/support/preflight.mjs` | exit 0 |
| Browser E2E | `pnpm test:e2e` | ALL CHECKS PASSED |
| Share walkthrough | `node tests/e2e/share-boundary.mjs` | 17/17 |
| Sweep | `pnpm test:sweep` | 61 groups vs 60 at baseline; new group is a pre-existing `/` reveal race (`FINAL-REPORT.md` §4) |
| Round-trip | `vitest run test/pdf-audit/roundtrip.test.ts` | 15 passed |
| Render regression | `vitest run test/render-regression.test.ts` | 10 passed, 1 expected fail |
| Lint | `pnpm lint` | not configured |

Performance on the 120-page fixture was re-measured (`METRICS.md` session 5):
lifecycle memory is flat and unchanged; render timings are ~2.4× slower than
session 3 across every stage on an unchanged render path, recorded as machine
state rather than a code regression.

### 35.5 Boundaries

- No share feature was built and no dependency was added.
- The sweep's 60 footer-reveal groups and the new `/` group are web-chrome
  issues, explicitly outside the PDF engine audit (`BASELINE.md`).
- Redaction removal was verified from the output bytes (pdf.js extraction,
  decompressing text-operator scan, object-graph scan) on a real fixture; no
  defect was found in removal.

## 36. PDF audit - session 6: decisions implemented (2026-11-11)

Branch `pdf/s6-decisions`, cut from `pdf/s5-share` at `012c82c`. This session
did not re-audit: it implemented the owner's decisions for the parked items, one
root cause per commit, converting the former `it.fails` repros into ordinary
passing tests. The single remaining expected fail is the actual CJK glyph render
(`PDF-RENDER-003`), kept because the owner chose to warn rather than bundle a
fallback font.

### 36.1 Implemented

- `PDF-SHARE-002` (`9263c69`): DELETE on a finished job removes the result
  directory and answers 2xx; the token then gets 404 on download. Running jobs
  keep cooperative cancellation; queued jobs keep `200 cancelled`. The same
  commit added `Cache-Control: private, no-store` + `Vary: cookie` to
  `/api/account*` and `/api/auth/me`.
- Warning contract (`7d0f75d`): optional `warnings?: string[]` on successful job
  results, carried through the server runner/BullMQ state and rendered by
  `ResultPanel` as a non-blocking notice.
- `PDF-ENGINE-001` (`b721487`): AcroForm preserved across page-copy tools;
  merged field trees, `_2`/`_3` collision suffixes, duplicated-page field copies,
  widget `/P` rewired to real output pages with no page-tree duplication.
- `PDF-ENGINE-002` (`0d7dda8`): Title/Author/Subject/Keywords preserved;
  merge/combine use the first document; date policy unchanged.
- `PDF-ENGINE-003` (`2160778`): Flip/Resize flatten annotation and widget
  appearances into page content, emit a warning, and refuse a document with a
  signature field.
- `PDF-RENDER-003` (`6d499f0`): detect non-embedded CJK fonts and warn in the
  render jobs; **no font is bundled** and the glyph repro stays `it.fails`.
- `PDF-EXPORT-002/003` (`7bd3051`): surface `alphaDropped` through
  `warnings[]`; name PDF-to-images outputs by source page number.

`PDF-RENDER-004/005/006` are deferred with reasons in `FINDINGS.md`.

### 36.2 Verification (live, stack up)

| Step | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | pass |
| Unit | `pnpm test` | 1523 passed, 0 failed, 1 expected fail, 119 files |
| Build | `pnpm build` | pass, 63 routes prerendered |
| Bundle | `pnpm test:bundle` | pass, 0 engines in app chunks |
| Preflight | `node tests/support/preflight.mjs` | exit 0 |
| Browser E2E | `pnpm test:e2e` | ALL CHECKS PASSED |
| Share walkthrough | `node tests/e2e/share-boundary.mjs` | 18/18 (revocation included) |
| Sweep | `pnpm test:sweep` | 60 groups, same as baseline |
| Round-trip | `vitest run test/pdf-audit/roundtrip.test.ts` | 17 passed |
| Render regression | `vitest run test/render-regression.test.ts` | 11 passed, 1 expected fail |

Session-5 comparison: 1496/0/8/117 -> 1523/0/1/119; round-trip 15 -> 17;
render 10/1 -> 11/1; share walkthrough 17 -> 18; sweep 61 -> 60 (baseline).
Nothing regressed. Details: `FINDINGS.md` "Session 6 evidence",
`FINAL-REPORT.md` session-6 addendum.
