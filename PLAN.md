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
| **P1 — Top-10 tools** | 10 client-side tools off the existing engine (delete/extract/rotate/split/mix/stamp/crop/n-up) | ✅ **Done (2026-10-07)** — see §6 |
| **P2 — Editor** | Sejda-class PDF editor (3 edit modes, undo, export validation) | ⬜ Next |
| **P3 — Server pipeline** | Express + BullMQ workers, quotas, isolation → **hardening gate** | ⬜ |
| **P4 — Accounts & workflows** | Anonymous-first JWT/OAuth, saved history, workflow builder | ⬜ |
| **P5 — AI** | Hybrid BYOK + managed keys, budgets, redaction tool → **leakage gate** | ⬜ |
| **P6 — E-sign / API / MCP** | Signature flows, public REST API, PDFShush MCP server | ⬜ |
| **P7 — Hardening** | Adversarial torture suite, SEO prerendering, perf/a11y pass | ⬜ |

**Current gate:** P1 signed off + audited (41/41 E2E checks, 46/46 unit tests, §6). Ready for P2.
Repo public: `github.com/dhruv-kashyap47/pdfshush` — **run the pre-push secret/PII grep
before every push** (see §8 tooling).

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

### P1 — Top-10 tools ✅ *(done 2026-10-07 — sign-off in §6)*
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
serving both page-numbers and header-footer modes · registry `LIVE` now has 13 slugs.

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

**Tooling**
- pnpm 11 ignores the `pnpm` field in `package.json` → `onlyBuiltDependencies` lives in
  `pnpm-workspace.yaml`. Root installs need `pnpm add -Dw`.
- Playwright: use `channel: 'msedge'` (system Edge) — no browser download needed.
- React 19: no global `JSX` namespace → use `ComponentType`; `useNavigate` requires the
  Router context (header is inside `BrowserRouter`).

---

## 8. Changelog

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

---

## 9. Resume cheat-sheet

```bash
pnpm install          # deps (Node ≥ 20.19, pnpm 11)
pnpm dev              # http://localhost:5173
pnpm typecheck        # strict tsc, both packages
pnpm test             # vitest (pdf-core)
pnpm test:e2e         # Playwright vs. running dev server (system Edge)
pnpm build            # production build
```

**Next move:** P2 (editor) — read GenOffice `apps/pdf` patterns first (Apache-2.0, skip
`ee/`), then append a changelog entry and tick the status board. Before every push run the
**pre-push grep** over tracked/changed files: (1) secret-key patterns (API keys, PEM
blocks, cloud access keys), (2) local username or machine-path markers, (3) dangerous sink
APIs — HTML-injection helpers, dynamic code evaluation, shell exec. All three must come
back empty.
