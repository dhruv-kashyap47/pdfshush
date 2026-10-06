# PDFShush — Plan & Progress

> Single source of truth for scope, decisions, and status. **Update this file at the end of
> every work session** (status board, changelog, next move). If context is ever lost, this
> file + the codebase is enough to resume.

**Product:** PDFShush — a 100%-feature-parity-plus clone of Sejda.com, with "disruption"
extras (AI, e-sign, public API + own MCP server, workflow automation).
**Stack:** MERN + TypeScript (React 19, Vite 8, Express, MongoDB) · pnpm monorepo.
**License:** AGPL-3.0-or-later · **Name:** PDFShush (locked).
**Last updated:** 2026-10-07

---

## 1. Status board

| Phase | Scope | Status |
| --- | --- | --- |
| **P0 — Foundation** | Monorepo, `pdf-core` engine + job contract, guardrails, web shell, 3 pilot tools | ✅ **Done (2026-10-07)** — see §5 |
| **P1 — Top-10 tools** | Next wave of client-side tools off existing engine ops | ⬜ Not started (proposal in §6) |
| **P2 — Editor** | Sejda-class PDF editor (3 edit modes, undo, export validation) | ⬜ |
| **P3 — Server pipeline** | Express + BullMQ workers, quotas, isolation → **hardening gate** | ⬜ |
| **P4 — Accounts & workflows** | Anonymous-first JWT/OAuth, saved history, workflow builder | ⬜ |
| **P5 — AI** | Hybrid BYOK + managed keys, budgets, redaction tool → **leakage gate** | ⬜ |
| **P6 — E-sign / API / MCP** | Signature flows, public REST API, PDFShush MCP server | ⬜ |
| **P7 — Hardening** | Adversarial torture suite, SEO prerendering, perf/a11y pass | ⬜ |

**Current gate:** P0 signed off (all four gates green, §5). Ready for P1.

---

## 2. Locked decisions

Do not relitigate these without a strong reason; each was researched and chosen.

- **Reverse-engineering target:** Sejda ≈ ~40 tools across Merge / Split / Edit&Sign /
  Compress / Security / Convert / Other / Scans / Workflows. Free tier: 3 tasks/hr,
  200 pages, 50 MB. We mirror the catalog, URLs, and IA — but **no task quotas** for
  in-browser work (limits instead, §4).
- **UI foundation:** `shadcnstore/shadcn-dashboard-landing-template` (**MIT**, `vite-version/`
  branch) — keep landing sections + shadcn/ui + theme system + auth/dashboard/error pages;
  strip mail/tasks/chat/calendar demos. Attribution preserved in `licenses/`.
- **Not a foundation:** `genspark-ai/genoffice` (Electron, wrong shape) — but an
  Apache-2.0 **code donor** for later phases: `apps/pdf` (P2 editor), `pdf2docx` (P3),
  `ai-provider` (P5), MCP server (P6). **Avoid its `ee/` dir** (enterprise license).
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
- **Environment:** Windows 11, Node v24.21.0, pnpm 11.15.0, Docker Desktop (WSL2) required
  from P3. LLM API key only needed for managed-AI mode (P5) — BYOK ships first, keyless.
- **User-adopted safeguards** (all in): `limits.ts`, memory guards, timeouts, common
  `JobInterface` (P0) · 3 edit modes + undo + export validation (P2) · quotas, bounded
  concurrency, `mkdtemp` job isolation, janitor, light monitoring (P3) · BYOK never touches
  server + budget middleware (P5) · adversarial fixture corpus (P7), with
  **redaction-leakage tests blocking at P5**.

---

## 3. Architecture (as built in P0)

```
pdfshush/
├── apps/web                      Vite + React 19 + Tailwind v4 + shadcn/ui
│   ├── src/workers/job-worker.ts   module worker: configures pdf.js, runs pdf-core jobs
│   ├── src/lib/job-pool.ts         bounded pool · timeout → terminate · zero-copy transfer
│   ├── src/lib/client-capacity.ts  refuse-before-crash capacity checks
│   ├── src/tools/registry.ts       full catalog: 45 tools, permanent /tools/:slug pages
│   └── src/components/tools/*      dropzone, progress, result panel, 3 tool bodies
├── packages/pdf-core               engine — same code path in worker and Node
│   ├── src/job.ts                   JobDefinition {validate, estimate, run} + withJobLimits
│   ├── src/limits.ts                every capacity number in one file
│   ├── src/ops/                     pages · compose · merge · zip · ranges (dep-free)
│   ├── src/render/                  pdfjsRuntime · canvas · renderPage
│   └── src/jobs/                    inspect · merge · organize · pdf-to-images · thumbnails
├── tests/e2e/smoke.mjs             Playwright (system Edge) driving all live tools
└── PLAN.md                         this file
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

### P1 — Top-10 tools *(proposal; amend per your feedback)*
Engine ops for these already exist (`refsForSpan`, `parsePageRanges`, `composePageRefs`,
`renderPages`). Proposed order, each with unit tests + an E2E check:
**Delete Pages · Extract Pages · Split by pages · Split in half · Alternate & Mix ·
Rotate · Crop · Page Numbers · Header & Footer · N-up.**
Also: per-tool SEO metadata + prerendered sitemap stubs (finalize in P7).

### P2 — Editor
Sejda-class editor: text/image/annotation editing, three edit modes (read the GenOffice
`apps/pdf` patterns, Apache-2.0, skip `ee/`), undo/redo stack, export validation
(re-parse output before offering the download).

### P3 — Server pipeline → **hardening gate**
Express API + BullMQ + Redis; Ghostscript/qpdf/LibreOffice/OCRmyPDF workers; anonymous
quotas (150 tasks/day, 6/min, 500 MB upload), bounded concurrency, `mkdtemp` per-job
isolation, TTL janitor, light monitoring (queue depth, duration, error rate).
**Gate to exit:** kill -9 an in-flight job → no orphan files, queue recovers, limits hold.
Requires Docker Desktop (WSL2).

### P4 — Accounts & workflows
Optional JWT + OAuth, saved history (beyond local IndexedDB), workflow builder
(compose jobs, trigger on upload/URL/schedule) — Jobs already serialize cleanly.

### P5 — AI → **leakage gate**
Hybrid: BYOK (browser-direct to provider, key never touches our server) + managed keys
with per-user/day budgets enforced by middleware. Features: smart redaction, summarize,
chat-with-PDF. **Blocking gate:** redaction-leakage tests (extracted text must never
contain redacted spans).

### P6 — E-sign / API / MCP
Signature flows (draw/type/upload, ordered recipients, audit trail) · public REST API
(rate-limited, API keys) · **PDFShush MCP server** exposing every tool to AI agents
(design donor: GenOffice MCP, Apache-2.0).

### P7 — Hardening / torture suite
Adversarial fixture corpus: malformed PDFs, 10k-page files, encrypted docs, broken fonts,
interrupted jobs, cleanup verification. Plus SEO prerendering, Lighthouse/perf, a11y pass.

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

## 6. Gotchas (hard-won; keep here so nobody re-learns them)

**@cantoo/pdf-lib**
- `doc.isEncrypted` is a **property**, not a method.
- No `doc.getVersion()` → `context.header.getVersionString()` (wrapped in try/catch).
- `page.setRotation(degrees(n))` — the `degrees()` wrapper is required.
- `getSize()` ignores `/Rotate` (MediaBox unchanged; rotation is display-only).

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

**Tests (anti-regression — all now covered by the 21 tests)**
- `parsePageRanges`: bare `"5"` = single page (≠ `"5-"` open range); `"99-200"` on 10
  pages clamps to page 10 (not empty); `pageFileName` pad width = `String(total).length`.
- `timeoutForPageCount(pageCount, baseMs)` needs an explicit `: number` on `baseMs`
  (literal inference from `as const` infects callers).

**Tooling**
- pnpm 11 ignores the `pnpm` field in `package.json` → `onlyBuiltDependencies` lives in
  `pnpm-workspace.yaml`. Root installs need `pnpm add -Dw`.
- Playwright: use `channel: 'msedge'` (system Edge) — no browser download needed.
- React 19: no global `JSX` namespace → use `ComponentType`; `useNavigate` requires the
  Router context (header is inside `BrowserRouter`).

---

## 7. Changelog

- **2026-10-07 — P0 complete.** Scaffold, `pdf-core` (21 tests), web app, 3 live tools,
  mega menu + catalog, E2E suite (17 checks), bundle-size fix, initial commit `f16ae4e`.
  *Fixed en route:* missing Router, dropped pool options, JPG→JPEG format mismatch,
  range-parser setState-during-render, footer/breadcrumb polish.

---

## 8. Resume cheat-sheet

```bash
pnpm install          # deps (Node ≥ 20.19, pnpm 11)
pnpm dev              # http://localhost:5173
pnpm typecheck        # strict tsc, both packages
pnpm test             # vitest (pdf-core)
pnpm test:e2e         # Playwright vs. running dev server (system Edge)
pnpm build            # production build
```

**Next move:** start P1 (§6 proposal — confirm or amend the tool order), then append a
changelog entry and tick the status board.
