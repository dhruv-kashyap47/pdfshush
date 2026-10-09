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
| **P3 — Server pipeline** | Express + BullMQ workers, quotas, isolation → **hardening gate** | ✅ **Done (2026-10-08)** — see §11 |
| **Audit remediation (P0/P1/P2)** | Full-codebase audit fixes: output contracts, page cap, filenames, cancel contract, janitor, recent history | ✅ **Done (2026-10-08)** — see §14 |
| **P4 — Accounts & workflows** | Anonymous-first JWT/OAuth, saved history, workflow builder | ⬜ |
| **P5 — AI** | Hybrid BYOK + managed keys, budgets, redaction tool → **leakage gate** | ⬜ |
| **P6 — E-sign / API / MCP** | Signature flows, public REST API, PDFShush MCP server | ⬜ |
| **P7 — Hardening** | Adversarial torture suite, SEO prerendering, perf/a11y pass | ⬜ |

**Current gate:** audit remediation shipped — all P0/P1/P2 findings closed. 14 of 53 tools
live · 8 of them also runnable server-side · **154/154 unit** (88 engine + 66 API) ·
**76/76 browser E2E** · 21/21 API integration · 17/17 hardening · bundle 688 kB, 0 pdf-lib/pdf.js
in the main chunk.
**Next: P4** (accounts & workflows). Repo public: `github.com/dhruv-kashyap47/pdfshush` —
**run the pre-push secret/PII grep before every push** (see §9 tooling).

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
- **Environment:** Windows 11, Node v24.21.0, pnpm 11.15.0, Docker Desktop (WSL2) —
  installed and verified in P3, but its CLI is per-user and **not on the session PATH**
  (see §9 for the `$env:DOCKER_BIN` workaround). LLM API key only needed for managed-AI mode
  (P5) — BYOK ships first, keyless.
- **User-adopted safeguards** (all in): `limits.ts`, memory guards, timeouts, common
  `JobInterface` (P0) · 3 edit modes + undo + export validation (P2) · quotas, bounded
  concurrency, per-job isolation, janitor, light monitoring (P3) · BYOK never touches
  server + budget middleware (P5) · adversarial fixture corpus (P7), with
  **redaction-leakage tests blocking at P5**.

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
│   ├── src/tools/registry.ts       catalog: 53 tools (**14 live**), permanent /tools/:slug pages
│   ├── src/components/editor/*     editor-toolbar · editor-page · editor-inspector (P2)
│   └── src/components/tools/*      13 tool-body files (14 tools — stamp.tsx serves two)
│                                    + shared dropzone · job-progress · result-panel · tool-frame
├── packages/pdf-core               engine — same code path in worker and Node
│   ├── src/node.ts                  Node-safe barrel: only the isomorphic surface (P3)
│   ├── src/job.ts                   JobDefinition {validate, estimate, run} + withJobLimits
│   ├── src/limits.ts                every capacity number in one file
│   ├── src/ops/                     pages · compose · merge · zip · split · stamp · nup ·
│   │                                geometry · edit · forms (P2) · ranges · textMetrics (dep-free*)
│   ├── src/render/                  pdfjsRuntime · canvas · renderPage · textRuns (P2)
│   └── src/jobs/                    11: inspect · merge · organize · pdf-to-images · thumbnails ·
│                                     stamp · split-by-pages · split-half · n-up · edit · text-runs
├── tests/e2e/smoke.mjs             Playwright (system Edge) driving all live tools (60 checks)
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
pnpm dev              # http://localhost:5173 (browser app only)
pnpm typecheck        # strict tsc, all three packages
pnpm test             # vitest: pdf-core + api (135 tests)
pnpm test:e2e         # Playwright vs. running dev server (system Edge)
pnpm build            # production build (web + api bundles)
pnpm stack:up         # docker compose up -d --build (redis + api + worker)
pnpm stack:down       # docker compose down
pnpm test:api         # 21 checks against a running stack on :8080
pnpm test:hardening   # 15 checks: SIGKILL a worker mid-job, prove the pipeline holds
```

Docker Desktop's CLI is **not on the session PATH** by default — a per-user install lands in
`%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe` (no shell expands `$env`).
Either prepend that directory or set `$env:DOCKER_BIN` (the gate script honours `DOCKER_BIN`).
Run the gate with short
TTLs so the janitor sweep is observable inside the run:
`$env:FILE_TTL_MS=20000; $env:JANITOR_INTERVAL_MS=5000; docker compose up -d` then
`node tests/api/hardening.mjs`. With a TTL that short the janitor can also delete a *queued*
job's inputs — which is why the killed job may legitimately settle as `failed`; the gate
accepts either outcome, because the claim being tested is "the queue recovers".

**Next move:** P4 (accounts & workflows). The server foundation it needs is in place: the
job contract composes, ownership tokens exist, quotas and monitoring are live. First task
is anonymous-first auth (JWT + optional OAuth) plus server-side history in MongoDB. Then
append a changelog entry and tick the status board. Before every push run the **pre-push
grep** over tracked/changed files: (1) secret-key patterns (API keys, PEM blocks, cloud
access keys), (2) local username or machine-path markers, (3) dangerous sink APIs —
HTML-injection helpers, dynamic code evaluation, shell exec (`redis.eval` is ioredis Lua
with constant scripts — documented inline; `tests/api/hardening.mjs` uses
`execFileSync` with fixed argv to SIGKILL a container — documented inline). All three
must come back empty.

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

