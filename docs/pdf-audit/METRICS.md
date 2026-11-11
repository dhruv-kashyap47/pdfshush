# PDF engine lifecycle metrics — session 2

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
