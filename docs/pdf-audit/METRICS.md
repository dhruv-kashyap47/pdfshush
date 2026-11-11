# PDF engine metrics

Session 2 measured the document lifecycle; session 3 measures page rendering.
Both use the same 120-page fixture and the same machine.

## Session 2 — lifecycle

Measured on `pdf/s2-engine` (2026-11-11), Windows 11, Node v24.21.0.

## What was measured

The open/close path of `packages/pdf-core/src/render/pdfjsRuntime.ts`:
`loadPdfForRender` → `getPage(1)` → `getTextContent()` → `page.cleanup()` →
`destroy()`, twenty times over the 120-page fixture
(`tests/fixtures/pdf-audit/long-120page.pdf`, 63,114 bytes).

Two modes:

| Mode | What it does | What it is for |
| --- | --- | --- |
| `cached` | production behaviour; the LRU is allowed to keep the last parsed document (limit 3) | proves the cache retains a bounded number of documents, not one per open |
| `cold` | the same cycle plus `resetPdfCache()` | proves the loading task, page proxy and parser session are really released |

Probe: `docs/pdf-audit/.baseline/measure-doc-lifecycle.ts`.
Raw result: `docs/pdf-audit/.baseline/metrics-after.json`.

```powershell
pnpm --filter @pdfshush/pdf-core exec tsx --expose-gc `
  ../../docs/pdf-audit/.baseline/measure-doc-lifecycle.ts
```

`liveDocuments` is the number of markers attached to a loaded document proxy
that survive a forced V8 collection (`v8.queryObjects`), i.e. documents the
runtime still holds. `workerPorts` counts dedicated worker resources; pdf.js
falls back to an in-thread `LoopbackPort` inside our job worker (the documented
"Setting up fake worker." path), so this is 0 in Node by design, not a leak.

## Before vs after

The defect fixes in this session do not touch `pdfjsRuntime.ts`:

```text
$ git diff pdf/s1-audit -- packages/pdf-core/src/render/pdfjsRuntime.ts
(empty)
```

The measured path is therefore byte-identical before and after, and the numbers
are the same; they are recorded once below. The fixes that *do* change
allocation behaviour (`PDF-ENGINE-007`, canvas release on a failed render) are
not exercised by an open/read/close cycle — no page is rendered — and are
covered by `packages/pdf-core/test/renderPage-cleanliness.test.ts`.

| Metric | `cached` (production) | `cold` (forced teardown) |
| --- | --- | --- |
| Peak RSS during 20 cycles | 124.8 MB | 374.6 MB |
| Peak live heap after GC | 60.1 MB | 59.8 MB |
| Live documents after 20 cycles | **1** (the LRU entry) | **0** |
| Live documents at cycle 1 / 5 / 10 / 15 / 20 | 1 / 1 / 1 / 1 / 1 | 0 / 0 / 0 / 0 / 0 |
| Heap at cycle 1 / 10 / 20 | 60.1 / 60.1 / 60.1 MB | 58.9 / 59.7 / 59.8 MB |
| RSS at cycle 1 / 10 / 20 | 124.9 / 123.9 / 124.3 MB | 329.1 / 125.6 / 126.2 MB |

Interpretation:

- Neither mode grows with the number of opens: heap is flat to ±0.5 MB from
  cycle 1 to cycle 20, so there is no per-open leak.
- `cached` retains exactly one document object (the current document). That is
  the LRU's documented job; it does not grow to one per open.
- `cold` leaves zero document objects, so the loading task and its parser
  session are released. The one-off RSS peak (329 MB at cycle 1) is V8 growing
  its heap during the first parse; it falls back to 125 MB and stays there.
- `resetPdfCache()` is what the app calls on shutdown and what the tests call
  between documents; the 120-page fixture is far above
  `LIMITS.client.thumbnailDegradeAtPages`, so this is the heavy end of the
  normal range.
- Worker count on the measured path is unchanged: 0 dedicated pdf.js workers
  (LoopbackPort by design). The browser `JobPool` still clamps to
  `LIMITS.client.minWorkers`–`maxWorkers` (1–4).

## Gate numbers (session 2)

| Step | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | pass |
| Unit tests | `pnpm test` | 1418 passed, 0 failed, 7 expected fail (baseline: 1409) |
| Build | `pnpm build` | pass (63 routes prerendered) |
| Bundle boundary | `pnpm test:bundle` | pass (0 engines in app chunks) |
| Lint | `pnpm -r --if-present lint` | not configured (same as baseline) |
| E2E / sweep preflight | `node tests/support/preflight.mjs` | exit 1 — Docker/Redis/API unavailable, same environment limitation as `BASELINE.md` |
| Sweep (ungated diagnostic) | `node tests/sweep.mjs` | exit 1 — **60 problem groups, identical routes/breakpoints to the baseline**; all are the known footer-reveal issue, unrelated to the PDF engine. Log: `.baseline/sweep-s2.log` |

The `pdf-core` suite grew from 488 to 492 passing cases (four new regression
tests); seven `it.fails` audit repros remain as the evidence anchor for the
needs-decision findings. `apps/api` grew from 214 to 218; `apps/web` from 161
to 162.

---

## Session 3 — page rendering (PDF-RENDER-001)

Measured on `pdf/s3-render` (2026-11-11), Windows 11, Node v24.21.0 and
Chromium via Playwright, on `tests/fixtures/pdf-audit/long-120page.pdf`
(63,114 bytes, 120 pages).

Probe: `docs/pdf-audit/.baseline/measure-render.ts` (Node, real pdf.js pipeline
with an `@napi-rs/canvas` factory). Raw results:
`.baseline/render-metrics-before.jsonl` and `-after.jsonl`.

```powershell
pnpm --filter @pdfshush/pdf-core exec tsx \
  ../../docs/pdf-audit/.baseline/measure-render.ts
```

### Node: before vs after

"Before" is the tree with the render-budget fix stashed; "after" is `6d49d7d`.
Both use the same fixtures and the same warm-up-free cold parse for the
first-page runs. The fix only changes pages whose requested bitmap exceeds a
canvas limit; the 120-page fixture is in budget, so the difference is noise.

| Metric | Before | After |
| --- | --- | --- |
| First page at 1600 px (median of 3) | 127.72 ms | 122.03 ms |
| First page at 2560 px (median of 3) | 299.07 ms | 298.55 ms |
| Editor window, 20 pages at 1339 px: mean / median per page | 26.36 / 26.29 ms | 26.64 / 26.48 ms |
| Editor window p95 page | 26.89 ms | 27.37 ms |
| Editor window peak RSS / heap | 419.7 / 198.4 MB | 436.7 / 199.1 MB |
| Thumbnail grid, 120 pages at 160 px: mean / median | 1.79 / 1.64 ms | 1.85 / 1.66 ms |
| Thumbnail grid p95 / max page | 2.08 / 11.27 ms | 2.24 / 13.27 ms |
| Thumbnail grid peak RSS / heap | 444.9 / 215.4 MB | 461.1 / 215.6 MB |

The per-page editor cost (26.4 ms in Node) is above one 16.7 ms frame, but it
runs in the job worker. In the browser the main thread only decodes the
returned bitmap; the scroll probe below is the user-facing number.

### Browser: first page and scroll

Playwright driven against the Vite dev server (`--filter @pdfshush/web dev`),
Chromium, default viewport (client height 703 px), light theme, 1x DPR. The
editor was opened at fit-width (~1749 px per page in the canvas). A per-frame
`requestAnimationFrame` loop scrolled the document canvas 220 px per frame for
4 s and recorded every frame delta; a "dropped" frame is one over 33 ms (two
missed 16.7 ms frames). `peakHeap` is `performance.memory.usedJSHeapSize`
sampled during the scroll (coarse, Chrome-only).

| Metric | Before | After (3 runs) |
| --- | --- | --- |
| First raster visible (median of 3 loads) | 1117 ms | 1144 ms |
| Frames sampled / scroll distance | 231 / 50,820 px | 227–274 / 49,940–60,280 px |
| Median frame | 13.3 ms | 13.3–13.4 ms |
| p95 frame | 39.8 ms | 13.8–40.0 ms |
| Frames over 20 ms | 39 | 11–41 |
| Frames over 33 ms (dropped) | 13 (5.6%) | 8–16 (2.9–5.8%) |
| Peak JS heap during scroll | 173.1 MB | 157.3–200.7 MB |
| Resident rasters after scroll | 29 | 29–35 |

Interpretation:

- The render-budget fix is behaviour-identical for the 120-page fixture (every
  page is in budget), so before/after is within run-to-run noise in both Node
  and the browser. That is the point: no regression on the common path.
- The fix's effect is on out-of-budget pages, which the fixture corpus does not
  contain. The regression proof is `render-budget.test.ts`: a 600x6000 pt page
  now renders 819x8192 at 1600 and 2560 px instead of throwing, and a
  5000x5000 pt page stays at 4096x4096 (16.7 MP) instead of allocating 64 MP.
- Scroll jank clusters where new rasters land: the median frame is one frame,
  p95 is 2–2.5 frames and ~3–6% of frames miss two. This is the existing
  raster-decode cost, not changed by this session; it is recorded so a later
  change can be compared against it.
- Two scroll samples in the "before" capture were discarded: the Playwright
  page was backgrounded and Chromium throttled rAF to 1 fps (4–5 frames in
  4 s). `page.bringToFront()` before the evaluate produced the valid sample
  above; the same was done for every "after" run.

### Gate numbers (session 3)

| Step | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | pass |
| Unit tests | `pnpm test` | 1439 passed, 0 failed, 8 expected fail (session 2: 1418 + 7) |
| Test files | `pnpm test` | 111 (session 2: 106) |
| Build | `pnpm build` | pass, 63 routes prerendered |
| Bundle boundary | `pnpm test:bundle` | pass (0 engines in app chunks) |
| Lint | `pnpm -r --if-present lint` | not configured (same as baseline) |
| E2E / sweep preflight | `node tests/support/preflight.mjs` | exit 1 — web/API/Docker unavailable, same environment limitation as `BASELINE.md` |
| Sweep (ungated diagnostic) | `node tests/sweep.mjs` | exit 1 — **60 problem groups, identical route/breakpoint set to the baseline**; all are the known footer-reveal issue. Log: `.baseline/sweep-s3.log` |

`pdf-core` grew from 492 to 513 passing cases (render-budget, the golden
corpus, overlay alignment, and the display-space rotation test) plus one new
expected-fail repro (the CJK `.notdef` case). Logs: `.baseline/test-s3.log`,
`build-s3.log`, `bundle-s3.log`, `preflight-s3.log`.

---

## Session 5 — SHARE boundary (no engine change)

Session 5 changed no parsing, rendering or composition code. The probes below
were re-run on `pdf/s5-share` for the audit's before/after record, with the dev
servers **stopped** so the numbers are not measuring the app.

Probe commands and raw results:

```powershell
pnpm --filter @pdfshush/pdf-core exec tsx --expose-gc `
  ../../docs/pdf-audit/.baseline/measure-doc-lifecycle.ts   # .baseline/metrics-s5-lifecycle.json
pnpm --filter @pdfshush/pdf-core exec tsx `
  ../../docs/pdf-audit/.baseline/measure-render.ts          # .baseline/metrics-s5-render.jsonl
```

### Lifecycle (120-page fixture, 20 open/read/close cycles)

| Metric | Session 2 | Session 5 | Δ |
| --- | --- | --- | --- |
| `cached` peak RSS | 124.8 MB | 126.4 MB | +1.6 MB |
| `cached` peak live heap | 60.1 MB | 60.1 MB | 0 |
| `cached` live documents after 20 cycles | 1 | 1 | 0 |
| `cold` peak RSS | 374.6 MB | 375.9 MB | +1.3 MB |
| `cold` peak live heap | 59.8 MB | 59.8 MB | 0 |
| `cold` live documents after 20 cycles | 0 | 0 | 0 |

No growth with cycle count: `cached` keeps exactly the LRU entry, `cold` keeps
none. The ~1.5 MB RSS difference is run-to-run noise on the same machine.

### Render (120-page fixture, real pdf.js + `@napi-rs/canvas`)

The render path is unchanged since `6d49d7d`
(`git diff 6d49d7d HEAD -- packages/pdf-core/src/render` is empty; only
`document/glyphs.ts` and `document/hitTest.ts` changed, and the probe does not
extract text).

| Metric | Session 3 (`6d49d7d`) | Session 5 | Ratio |
| --- | --- | --- | --- |
| First page at 1600 px, median of 3 | 122.03 ms | 301.59 ms | 2.47× |
| First page at 2560 px, median of 3 | 298.55 ms | 737.22 ms | 2.47× |
| Editor window, 20 pages at 1339 px: mean | 26.64 ms | 58.40 ms | 2.19× |
| … median / p95 | 26.48 / 27.37 ms | 57.82 / 65.23 ms | 2.18× / 2.38× |
| Editor window peak RSS / heap | 436.7 / 199.1 MB | 417.5 / 198.2 MB | — |
| Thumbnails, 120 pages at 160 px: mean | 1.85 ms | 4.71 ms | 2.55× |
| … median / p95 / max | 1.66 / 2.24 / 13.27 ms | 4.22 / 5.99 / 25.06 ms | 2.54× / 2.67× / 1.89× |
| Thumbnail peak RSS / heap | 461.1 / 215.6 MB | 441.8 / 214.6 MB | — |

The slowdown is **uniform across parse, paint and encode**, is stable across two
consecutive session-5 runs (58.4 and 67.1 ms/page; the second was taken with the
dev servers still running), and comes with *lower* peak memory. A code
regression would not scale every stage by the same ~2.4× while freeing memory,
and the render sources are byte-identical to session 3's measured tree. It is
recorded as machine-state (host/CPU frequency) rather than a regression; the
absolute number should not be compared across sessions on this machine, while
the before/after *shape* (flat memory, bounded thumbnails) still holds.

### Gate numbers (session 5)

| Step | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | pass, exit 0 (`.baseline/typecheck-s5.log`) |
| Unit tests | `pnpm test` | **1496 passed, 0 failed, 8 expected fail, 117 files** (`.baseline/test-s5.log`) |
| Build | `pnpm build` | pass, 63 routes prerendered (`.baseline/build-s5.log`) |
| Bundle boundary | `pnpm test:bundle` | pass, 0 engines in app chunks (`.baseline/bundle-s5.log`) |
| Lint | `pnpm lint` | **not configured** (`Command "lint" not found`, same as baseline) |
| E2E / sweep preflight | `node tests/support/preflight.mjs` | **exit 0** — web, API and compose reachable (first session where the stack could start) |
| Browser E2E smoke | `pnpm test:e2e` | **ALL CHECKS PASSED** (`.baseline/e2e-s5.log`) |
| Share walkthrough | `node tests/e2e/share-boundary.mjs` | 17/17 checks pass (upload → process → token download → denied paths) |
| Sweep | `pnpm test:sweep` | 61 problem groups vs 60 at baseline; the only new group is `/` at light 1920, a pre-existing reveal race (see `FINAL-REPORT.md` §4) |
| Round-trip harness | `vitest run test/pdf-audit/roundtrip.test.ts` | 15 passed |
| Render regression | `vitest run test/render-regression.test.ts` | 10 passed, 1 expected fail (`PDF-RENDER-003`, unchanged) |

Suite deltas: `apps/api` 218 → 238 passing plus 1 expected fail (the revocation
repro); `pdf-core` 535 → 540 passing (+5: the full-page redaction case and the
four redaction-output checks) and the same 7 expected fails; total files
115 → 117 (+2 test files).


