# PDFShush — Plan & Progress

> Single source of truth for scope, decisions, and status. **Update this file at the end of
> every work session** (status board, changelog, next move). If context is ever lost, this
> file + the codebase is enough to resume.

**Product:** PDFShush — a 100%-feature-parity-plus clone of Sejda.com, with "disruption"
extras (AI, e-sign, public API + own MCP server, workflow automation).
**Stack:** MERN + TypeScript (React 19, Vite 8, Express, MongoDB) · pnpm monorepo.
**License:** AGPL-3.0-or-later · **Name:** PDFShush (locked).
**Last updated:** 2026-10-18

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
| **P6 — E-sign / API / MCP** | Signature flows, public REST API, PDFShush MCP server | 🔄 **opened 2026-10-16**; P6.0 decision record ✅ **done 2026-10-18** (§25.1, D1–D8); P6.9 hardening interlude ✅ **done 2026-10-17** (H1–H3 + M1–M3 closed; H4 = operator action); detailed plan written **2026-10-18** (§25): signatures local-only, Fill & Sign first, MCP = local stdio over the public API — see §24.4 + §25 |
| **P7 — Hardening** | Adversarial torture suite, SEO prerendering, perf/a11y pass | ⬜ |

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

**Current gate:** re-measured 2026-10-18 with **P6.2 Public REST API shipped** (§8 first entry) —
the P5 AI port (§23), the gap-closing pass (§23.7), the Phase 1-5 security review + `redactSecrets`
hardening (§24), the P6.9 hardening interlude (§24.2) and P6.1 Fill & Sign (§25.2) all still hold.
**21 of 56 tools live** (`redact-pdf` in Security; `summarize-pdf` + `chat-with-pdf` +
`edit-pdf-with-ai` under the **AI** category; `fill-sign` + `signature` under Edit & Sign from P6.1;
`api` under Automate from P6.2)
· 8 server-runnable slugs over `/api/v1` ·
**912/912 unit** (189 engine · **191 API** · 364 provider · 152 agent · **16 web** — the web app's own
unit suite covers the signature trim math and validation) · browser E2E: full
smoke (re-run 2026-10-18 error-free, incl. the comparison-table fix) · **8/8 focused text-edit E2E** ·
**17/17 AI E2E**
(chat + highlight apply + in-place replacement + key-handling, local SSE mock; re-measured — 17, not
the 18 previously recorded, all passing, so the drift came from the §23.6 AI-workspace consolidation
rather than a lost assertion, but treat 18 as a contract worth confirming) · **11/11 managed AI
E2E** (real API routes, in-memory counters, no Redis/docker) ·
**17/17 sign E2E** (P6.1: dialog draw/save/adopt/place, export, audit note read back as JSON,
manage page; `tests/e2e/sign.mjs`) ·
**41 API smoke sections incl. the new §6 v1 flow** (section 6 in either mode: 503-when-disabled or
the full key→submit→poll→download→revoke walk on the real stack, 2026-10-18) · 17/17 hardening · renderer hosts CMaps + standard fonts and forces
glyph-path rendering off the `FontFace` path in the worker (§16, §17) · accounts live against
Google + MongoDB Atlas (§18) · **secure redaction shipped and independently verified (§20)** ·
**genuine in-place text editing shipped end to end (§22; AI replacements now use it too, §23.7.2)** ·
**AI: BYOK summarize/chat/edit-with-AI + smart redaction proposals in the browser, an opt-in managed
mode with per-subject budgets on the server (off unless a key is set), the P5 leakage gate green, the
key in IndexedDB behind `sanitizeAiSettings` with a one-click delete (§23)** · **P6.1 Fill & Sign
shipped (§25.2): drawn/typed capture, device-only signature assets, editor placement, `edit`-job
export with a fail-closed audit sidecar** · main chunk 0 pdf-lib /
0 pdf.js / 0 pdfium / 0 `signature_pad` / 0 Caveat, enforced by the extended `pnpm test:bundle`
(PDFium is a lazy 4.6 MB asset fetched on first text edit; `signature_pad` + the bundled Caveat
faces ride the 33 kB lazy signature-pad dialog chunk).
**Next: P6.3 MCP server (§25.4) — P6.0, P6.1 and P6.2 are done** (P6.2 code 2026-10-18: keys,
`/api/v1`, per-key quota, OpenAPI + docs page, D8 redact — all unit + real-stack E2E green);
P6.3 → P6.4 hardening per
§25.6. R2 stays
deferred until R1 is proven in production, and P4.4 triggers stay gated.
*(2026-10-18 addendum:)* the landing page's editorial band was rebuilt as a stem-plate poster +
rooted-tree silent-loop pair (§8 top entry), gated by typecheck, a fresh production build, the
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
  in-browser work (limits instead, §4). Our own catalog is **53 slugs**: Sejda's set plus
  the disruption extras (AI, e-sign, API/MCP, workflows); every slug has a permanent page
  from day one, so unshipped tools render an honest "In development" state.
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
│   ├── src/tools/registry.ts       catalog: 53 tools (**15 live**), permanent /tools/:slug pages
│   ├── src/components/editor/*     editor-toolbar · editor-page · editor-inspector (P2)
│   └── src/components/tools/*      14 tool-body files (15 tools — stamp.tsx serves two)
│                                    + shared dropzone · job-progress · result-panel · tool-frame
├── packages/pdf-core               engine — same code path in worker and Node
│   ├── src/node.ts                  Node-safe barrel: only the isomorphic surface (P3)
│   ├── src/job.ts                   JobDefinition {validate, estimate, run} + withJobLimits
│   ├── src/limits.ts                every capacity number in one file
│   ├── src/ops/                     pages · compose · merge · zip · split · stamp · nup ·
│   │                                geometry · edit · forms (P2) · ranges · textMetrics (dep-free*)
│   ├── src/render/                  pdfjsRuntime · canvas · renderPage · textRuns (P2)
│   ├── src/redact/                  R1 secure redaction: rasterize · rebuild · verify (§20)
│   └── src/jobs/                    12: inspect · merge · organize · pdf-to-images · thumbnails ·
│                                     stamp · split-by-pages · split-half · n-up · edit · text-runs ·
│                                     redact
├── tests/e2e/smoke.mjs             Playwright (system Edge) driving all live tools (101 checks)
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

**pdfjs-dist v6**
- Entry `build/pdf.mjs`; types `types/src/pdf.d.ts`.
- `getDocument` params do **not** accept `isEvalSupported`.
- `PDFDocumentProxy.destroy()` does not exist → keep the loading task and call
  `task.destroy()` (also releases the pdf.js worker).
- `RenderParameters.canvas` is **required**: pass `canvas: null` → derives from the
  context → this is what makes **OffscreenCanvas** rendering work.
- Worker URL injected by host: `configurePdfjsRuntime({ workerSrc })` with
  `import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`.

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
- pnpm 11 ignores the `pnpm` field in `package.json` → `onlyBuiltDependencies` lives in
  `pnpm-workspace.yaml`. Root installs need `pnpm add -Dw`.
- Playwright: use `channel: 'msedge'` (system Edge) — no browser download needed.
- React 19: no global `JSX` namespace → use `ComponentType`; `useNavigate` requires the
  Router context (header is inside `BrowserRouter`).

---

## 8. Changelog

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
pnpm typecheck        # strict tsc, all five packages
pnpm test             # vitest: pdf-core + api + ai-provider + ai-agent + web (897 tests)
pnpm test:e2e         # Playwright vs. running dev server (system Edge, 101 checks)
pnpm test:e2e:sign    # Fill & Sign flow end to end (17 checks)
pnpm test:e2e:text-edit  # the in-place text-edit flow (8 checks)
pnpm test:e2e:ai      # AI chat + highlight apply + in-place replacement + key handling (18 checks)
pnpm test:e2e:ai-managed # managed trial through the real API routes, in-memory counters (11 checks)
pnpm test:bundle      # after `pnpm build`: entry chunk must carry no PDF engine
pnpm test:sweep       # responsive sweep (not a gate): overflow, reveal + size/contrast outliers
pnpm build            # production build (web + api bundles)
pnpm stack:up         # docker compose up -d --build (redis + api + worker)
pnpm stack:down       # docker compose down
pnpm test:api         # 21 checks against a running stack on :8080
pnpm test:hardening   # 17 checks: SIGKILL a worker mid-job, prove the pipeline holds
```

Docker Desktop's CLI is **not on the session PATH** by default — a per-user install lands in
`%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe` (no shell expands `$env`).
Either prepend that directory or set `$env:DOCKER_BIN` (the gate script honours `DOCKER_BIN`).
Run the gate with short
TTLs so the janitor sweep is observable inside the run — **the test process must wear the same
TTL the stack wears**, or its wait budget under-runs the container's window (the gate itself also
refuses to run unless `/api/health` reports `retentionMs <= 120000`):
`$env:FILE_TTL_MS=120000; $env:JANITOR_INTERVAL_MS=10000; docker compose up -d --build` then
`node tests/api/hardening.mjs`. With a TTL that short the janitor can also delete a *queued*
job's inputs — which is why the killed job may legitimately settle as `failed`; the gate
accepts either outcome, because the claim being tested is "the queue recovers". Note also that
back-to-back quota-consuming runs (smoke → hardening) leave the anonymous day counters partially
spent — `docker compose restart redis` resets them. *(2026-10-18 addendum: Docker's server **is**
on PATH now — `docker compose up -d --build` works directly from the session.)*

**Next move:** **P6.2, the public REST API, has shipped** (`/api/v1` §8 top entry, §25.3 with its
six gates met): `pshk_` keys minted on the account page (SHA-256 at rest, SHA-shown-once), per-key
+ per-account tier from D5, inline-JSON or multipart submission into the same pipeline, OpenAPI
spec from the payload zod, the `/tools/api` docs page live, and D8 redact (§24.5's L6 closed).
**The next build step is P6.3, the MCP server over v1** (`@pdfshush/mcp`, §25.4 — donor code in
`genoffice-main/packages/cli/src/mcp/`, Apache-2.0, read-first), then P6.4 hardening for the new
surface. R1 has shipped — secure redaction is live as `redact-pdf` (§20), verified on
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
(verified 2026-10-18 against Docker + Redis + worker + Atlas). Then append
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
invisible until §8's second entry. When a gate self-skips, treat the skipped path as *unverified*,
not as covered.

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
| L1 | Low | `POST /api/auth/logout` not CSRF-checked | add the token check or document the Lax reliance | P7 |
| L2 | Low | `/api/ai/chat` cross-site can burn a victim IP's trial | require the CSRF header when a cookie is present | P7 |
| L3 | Low | oversized JSON body → 500, not 413 | map `entity.too.large` in `errorHandler` | P7 |
| L4 | Low | unbounded `options` record (nested depth/keys) | bound structurally in `payloadSchema` | P7 |
| L5 | Low | `text/html` entry in the result content-type map | drop it (no job emits `.html`) | P7 |
| L6 | ✅ **closed 2026-10-18 (P6.2)** | logger redaction omits `cookie`/`apiKey`/`x-job-token` | extend the redact list | ~~P7~~ done in P6.2 (§25.3) |
| L7 | Low | AI budget reserves output tokens only | reserve an input estimate too | P7 |
| L8 | Low | AI concurrency guard is per-process | note for multi-instance, or move to Redis | P7 |
| L9 | Low | `AccountStore.ownsJob` is dead code | delete it, or use it as the record | P7 |
| — | Low | **fixed in this review:** `redactSecrets` gaps (client) and the raw managed-gateway error (server) | §24.2 | done |

**Order:** **P6.9 hardening — done 2026-10-17** · **P6.0 decision record — done 2026-10-18**
(§25.1) → **P6.1 e-sign — done 2026-10-18** → **P6.2 public API — done 2026-10-18** (§25.3) →
P6.3 MCP. Next is **P6.3**.

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

> **Shipped 2026-10-18 (see §8 top entry for the full record):** everything in the Capture,
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

### 25.5 P6.4 — hardening pass for the new surface

Key-abuse cases (stolen key = reduced-quota anonymous-equivalent abuse model, scope
enforcement, rotation drill), signing-abuse review (audit-note tampering, pad memory), SSRF
review of anything that fetches URLs (MCP base URL, any future URL-fetch tool), and the
M2-style stream sniff for API-submitted multipart. Findings feed §24.5's backlog and P7's
torture suite; expected to be short because P6.2/P6.3 reuse hardened paths.

### 25.6 Order

1. **P6.0 — done 2026-10-18** (§25.1: the record is written; D1–D8 stand).
2. **P6.1 — done 2026-10-18** (code shipped, gates green; §8 top entry. Raster export ships; the
   vector path remains behind the §25.2 flag until its round-trip test is written — revisit within
   P6.4's window or drop it explicitly rather than leaving it silently open).
3. **P6.2 — done 2026-10-18** (code shipped, all six §25.3 gates met, §8 top entry) →
   **P6.3** (depends on P6.2's endpoints and the D5/D6 key model — now in place).
4. **P6.4** last, folding findings into P7.

**Expected surface after P6:** `fill-sign` + `signature` live (18→20 live tools — **this part is
already true**; `api` and `mcp` pages flip to real docs), one new package (`apps/mcp`), one new
router (`v1`), one new IndexedDB store (**shipped**, `signatures` at DB v3), signature_pad as the
slice's only new runtime dep (**shipped**).


