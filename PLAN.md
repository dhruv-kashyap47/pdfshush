# PDFShush — Plan & Progress

> Single source of truth for scope, decisions, and status. **Update this file at the end of
> every work session** (status board, changelog, next move). If context is ever lost, this
> file + the codebase is enough to resume.

**Product:** PDFShush — a 100%-feature-parity-plus clone of Sejda.com, with "disruption"
extras (AI, e-sign, public API + own MCP server, workflow automation).
**Stack:** MERN + TypeScript (React 19, Vite 8, Express, MongoDB) · pnpm monorepo.
**License:** AGPL-3.0-or-later · **Name:** PDFShush (locked).
**Last updated:** 2026-10-08

---

## 1. Status board

| Phase | Scope | Status |
| --- | --- | --- |
| **P0 — Foundation** | Monorepo, `pdf-core` engine + job contract, guardrails, web shell, 3 pilot tools | ✅ **Done (2026-10-07)** — see §5 |
| **P1 — Top-10 tools** | 10 client-side tools off the existing engine (delete/extract/rotate/split/mix/stamp/crop/n-up) | ✅ **Done (2026-10-07)** — see §6 |
| **P2 — Editor** | Sejda-class PDF editor (3 edit modes, undo, export validation) | ✅ **Done (2026-10-07)** — see §10 |
| **P3 — Server pipeline** | Express + BullMQ workers, quotas, isolation → **hardening gate** | 🔄 **In progress** (2026-10-08) — API, queue, sandboxed workers, quotas, janitor built and tested; Docker verification pending |
| **P4 — Accounts & workflows** | Anonymous-first JWT/OAuth, saved history, workflow builder | ⬜ |
| **P5 — AI** | Hybrid BYOK + managed keys, budgets, redaction tool → **leakage gate** | ⬜ |
| **P6 — E-sign / API / MCP** | Signature flows, public REST API, PDFShush MCP server | ⬜ |
| **P7 — Hardening** | Adversarial torture suite, SEO prerendering, perf/a11y pass | ⬜ |

**Current gate:** P2 shipped **and audited** — **14 of 53 tools live**, 60/60 E2E checks,
86/86 unit tests, main bundle 684 kB with 0 pdf-lib/pdf.js refs (§10).
**P3 in flight:** `apps/api` (Express + BullMQ + sandboxed workers + quotas + janitor)
with 134 tests green (86 engine + 48 API). Remaining: the Docker stack verification and the
kill -9 hardening gate — **blocked on Docker Desktop being installed.**
Repo public: `github.com/dhruv-kashyap47/pdfshush` — **run the pre-push secret/PII grep
before every push** (see §8 tooling).

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
  NOTICE attribution. Full design notes: session plan file `p6-sign-signature-pad.md`.
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

## 3. Architecture (as built through P2)

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
│   ├── src/tools/registry.ts       catalog: 53 tools (**14 live**), permanent /tools/:slug pages
│   ├── src/components/editor/*     editor-toolbar · editor-page · editor-inspector (P2)
│   └── src/components/tools/*      13 tool-body files (14 tools — stamp.tsx serves two)
│                                    + shared dropzone · job-progress · result-panel · tool-frame
├── packages/pdf-core               engine — same code path in worker and Node
│   ├── src/job.ts                   JobDefinition {validate, estimate, run} + withJobLimits
│   ├── src/limits.ts                every capacity number in one file
│   ├── src/ops/                     pages · compose · merge · zip · split · stamp · nup ·
│   │                                geometry · edit · forms (P2) · ranges · textMetrics (dep-free*)
│   ├── src/render/                  pdfjsRuntime · canvas · renderPage · textRuns (P2)
│   └── src/jobs/                    11: inspect · merge · organize · pdf-to-images · thumbnails ·
│                                     stamp · split-by-pages · split-half · n-up · edit · text-runs
├── tests/e2e/smoke.mjs             Playwright (system Edge) driving all live tools
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
Signature flows (draw/type/upload via `signature_pad`, ordered recipients, audit trail;
vector output via `toSVG()` → `drawSvgPath`, gated on tests) · public REST API
(rate-limited, API keys) · **PDFShush MCP server** exposing every tool to AI agents
(design donor: GenOffice MCP, Apache-2.0). Reuses the P2 editor for placement/fill.

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
  path hole. **Remaining: Docker stack verification + kill -9 gate** (Docker Desktop
  not installed yet).

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

**Next move:** P3 (server pipeline → hardening gate) — requires Docker Desktop (WSL2):
Express API + BullMQ/Redis, worker isolation (`mkdtemp`, kill -9 mid-job → no orphans),
quotas, TTL janitor. Then append a changelog entry and tick the status board. Before every
push run the **pre-push grep** over tracked/changed files: (1) secret-key patterns (API
keys, PEM blocks, cloud access keys), (2) local username or machine-path markers, (3)
dangerous sink APIs — HTML-injection helpers, dynamic code evaluation, shell exec. All
three must come back empty.

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
