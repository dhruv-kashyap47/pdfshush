# PDFShush

**Free, private PDF tools that run in your browser.**

PDFShush is an open-source (AGPL-3.0) alternative to online PDF suites: merge, organize,
convert, edit, sign, secure, automate. The core difference is architectural — light tools
run **client-side in a Web Worker**, so your files never leave your device. Heavy tools
(OCR, compression, Office conversion) will run on bounded server workers with anonymous
quotas, through the exact same job contract.

## Status: Phase 1-5 Shipped (18 client-side tools + the server stack)

> **Plan, decisions & progress tracker: [`PLAN.md`](./PLAN.md)** — read this first when
> resuming work; it is updated at the end of every session.

| Layer | State |
| --- | --- |
| `packages/pdf-core` | ✅ Environment-agnostic engine: jobs, limits, merge/compose/render/zip/stamp/split/n-up/edit, **in-place text editing (PDFium) with verified overlay fallback**, OffscreenCanvas worker factory, CMap/standard font support |
| `packages/ai-provider` | ✅ BYOK + managed streaming, curated provider catalogue, budgeted context window |
| `packages/ai-agent` | ✅ Tool-calling agent: edit plans and redaction proposals, bounded turns, cancellation |
| `apps/web` | ✅ Vite + React 19 + Tailwind v4 + shadcn/ui, full tool catalog, mega-menu, web worker pool, AI workspace |
| `apps/api` | ✅ Express + Redis + BullMQ sandboxed worker + TTL janitor, plus an optional managed-AI gateway |
| Live tools (18) | ✅ Merge, Organize, PDF → JPG, Delete Pages, Extract Pages, Rotate, Split by pages, Alternate & Mix, Split in half, Page Numbers, Crop, Header & Footer, N-up, Edit PDF, **Redact PDF (verified)**, Summarize, Chat with PDF, Edit PDF with AI |
| Accounts (P4) | ✅ Google sign-in; every tool stays anonymous-only when no Mongo/Google config is present |
| AI (P5) | ✅ BYOK keys never leave the browser; the managed trial is off unless `AI_MANAGED_MODEL` and `AI_MANAGED_API_KEY` are both set |
| E-sign / public API / MCP (P6) | ⏳ Planned |

Every tool has a permanent page from day one (`/tools/:slug`); unshipped tools show an
honest "in development" state so links and SEO never churn.

## Quick start

```bash
pnpm install
pnpm dev              # web app: http://localhost:5173 (every client-side tool + BYOK AI)
pnpm typecheck        # tsc across all workspace projects
pnpm test             # vitest unit suite (836 tests)
pnpm build            # production web bundle
```

**The web app is fully usable on its own.** Everything in the table above except the
workflows page runs in the browser, so `pnpm dev` is the fastest way to see the product end
to end — no API, no keys, no Docker.

### Running the backend

Either route puts the API on `http://localhost:8080`, which the dev server proxies `/api` to:

```bash
pnpm stack:up                       # A. Docker: redis + api + worker, one command
pnpm --filter @pdfshush/api dev     # B. local API + worker, hot reload (tsx watch)
pnpm stack:down                     # stop the Docker stack
```

- **A** needs Docker Desktop running. Compose reads the project-root `.env` for the optional
  accounts (`MONGODB_*`, `GOOGLE_*`) and managed-AI (`AI_MANAGED_*`) settings.
- **B** needs a Redis on `127.0.0.1:6379` (`docker run -d -p 6379:6379 redis:7-alpine`), plus
  one `pnpm --filter @pdfshush/api build` so the sandboxed processor bundle exists — the API
  itself still boots and serves tools without either, it just cannot process queued jobs.
  `tsx` does not read `.env`, so accounts and managed AI need those variables exported in
  your shell. Both are optional: anonymous tools and BYOK AI need nothing.

### Checks

```bash
pnpm test:e2e          # Playwright suite against a running dev server (101 checks)
pnpm test:e2e:ai       # AI workspace, mocked provider (18 checks)
pnpm test:bundle       # main-chunk boundary: no pdf-lib / pdf.js / pdfium, no Node built-ins
pnpm test:api          # API integration suite (21 checks)
pnpm test:hardening    # Hardening gate (SIGKILL recovery, TTL sweep)
```

Requirements: Node ≥ 20.19 and pnpm 12 (`corepack enable pnpm`); Docker Desktop only for
the server stack.

## Architecture

```
apps/web                 React SPA (Vite, Tailwind v4, shadcn/ui)
  src/workers/           module worker: runs pdf-core, OffscreenCanvas, font & CMap runtime
  src/lib/job-pool.ts    bounded pool, timeouts, error stacks, terminate-on-cancel, zero-copy
  src/components/tools/  tool UI components, including the hybrid canvas Edit PDF tool
  public/                static assets: standard fonts (.pfb) and binary CMaps (.bcmap)
packages/pdf-core        environment-agnostic PDF engine (Web Worker + Node)
  src/job.ts             JobDefinition / JobContext / withJobLimits / serializeJobError
  src/limits.ts          every capacity number in one single source of truth
  src/ops/               pages, compose, merge, zip, ranges, edit, stamp, split, n-up
  src/render/            pdf.js bootstrap, PdfjsCanvasFactory (OffscreenCanvas), budgeting
  src/textedit/          PDFium in-place text editing + verified pdf-lib overlay fallback
  src/jobs/              inspect, merge, organize, pdf-to-images, thumbnails, edit, text-runs, text-edit
apps/api                 Phase 3 background queue & server API
  src/server.ts          Express HTTP API + BullMQ producer + TTL janitor
  src/worker/            sandboxed worker processes (isolated memory & CPU)
```

Key invariants:

- **One job contract.** `JobDefinition { validate, estimate, run }` is consumed identically
  by the browser pool and the server queue — tools never know where they execute.
- **Off-main-thread rendering.** Page rendering runs entirely inside Web Workers with
  `OffscreenCanvas`, worker-safe canvas factories, and static CMap/standard font hosting so
  large PDFs and non-embedded fonts render cleanly without blocking UI responsiveness.
- **Budgeted rasters.** Raster bitmaps use area-based allocation (`rasterWidthWithinBudget`)
  so large-format pages respect the 12 MP memory budget regardless of zoom or display density.
- **Guardrails first.** File/page/byte limits, per-job timeouts derived from page count,
  abort signals, bounded worker concurrency, and terminate-on-timeout.
- **Transfer, don't copy.** Input buffers are moved into the worker and results transferred
  back; main-thread bundle contains neither pdf.js nor pdf-lib.
- **Refuse, don't crash.** Capacity checks run before work starts; browser tabs never die
  halfway through a user document.
- **Edit text honestly.** Existing text is rewritten in place through PDFium and the result is
  reopened and re-extracted before download; anything that cannot be rewritten safely falls back
  to a whiteout-and-overlay and the UI says which happened. Redaction always uses the proven
  raster path and never routes through the text editor.

## Credits & licensing

- UI foundation: [shadcn dashboard & landing template](https://github.com/shadcnstore/shadcn-dashboard-landing-template) (MIT, full text in `licenses/`) — landing sections, shadcn/ui components, theme system.
- Product scope modeled on [Sejda.com](https://www.sejda.com/) (not affiliated).
- Engine: [pdf-lib fork `@cantoo/pdf-lib`](https://github.com/cantoo-pdf-lib/pdf-lib), [pdf.js](https://mozilla.github.io/pdf.js/), [PDFium WASM `@embedpdf/pdfium`](https://github.com/embedpdf/embed-pdf-viewer) (in-place text editing), [fflate](https://github.com/101arrowz/fflate). Licences for the redistributed PDFium WASM are in `licenses/` (MIT wrapper + BSD-3-Clause PDFium).

Code from the template retains its MIT license; the rest is **AGPL-3.0-or-later** (see `LICENSE`).
