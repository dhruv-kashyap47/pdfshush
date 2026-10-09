# PDFShush

**Free, private PDF tools that run in your browser.**

PDFShush is an open-source (AGPL-3.0) alternative to online PDF suites: merge, organize,
convert, edit, sign, secure, automate. The core difference is architectural — light tools
run **client-side in a Web Worker**, so your files never leave your device. Heavy tools
(OCR, compression, Office conversion) will run on bounded server workers with anonymous
quotas, through the exact same job contract.

## Status: Phase 1-3 Shipped (14 client-side tools + Phase 3 API stack)

> **Plan, decisions & progress tracker: [`PLAN.md`](./PLAN.md)** — read this first when
> resuming work; it is updated at the end of every session.

| Layer | State |
| --- | --- |
| `packages/pdf-core` | ✅ Environment-agnostic engine: jobs, limits, merge/compose/render/zip/stamp/split/n-up/edit, OffscreenCanvas worker factory, CMap/standard font support |
| `apps/web` | ✅ Vite + React 19 + Tailwind v4 + shadcn/ui, full tool catalog, mega-menu, web worker pool |
| `apps/api` | ✅ Phase 3 server stack: Express + Redis + BullMQ sandboxed worker + TTL janitor |
| Live tools (14) | ✅ Edit PDF, Merge, Organize, PDF → JPG, Delete Pages, Extract Pages, Rotate, Split by pages, Alternate & Mix, Split in half, Page Numbers, Crop, Header & Footer, N-up |
| Accounts (P4), AI (P5), E-sign/API/MCP (P6) | ⏳ Planned |

Every tool has a permanent page from day one (`/tools/:slug`); unshipped tools show an
honest "in development" state so links and SEO never churn.

## Quick start

```bash
pnpm install
pnpm dev              # http://localhost:5173 (client web app)
pnpm typecheck        # tsc across all workspace projects
pnpm test             # vitest unit suite (172 tests: pdf-core + api)
pnpm build            # production bundle build
pnpm test:e2e         # Playwright suite vs. running dev server (83 checks)
pnpm stack:up         # docker compose up -d --build (API + Redis + Worker stack)
pnpm test:api         # API integration suite (21 checks)
pnpm test:hardening   # Hardening gate (SIGKILL recovery, TTL sweep)
```

Requirements: Node ≥ 20.19, pnpm 11, Docker (for server stack).

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
  src/jobs/              inspect, merge, organize, pdf-to-images, thumbnails, edit, text-runs
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

## Credits & licensing

- UI foundation: [shadcn dashboard & landing template](https://github.com/shadcnstore/shadcn-dashboard-landing-template) (MIT, full text in `licenses/`) — landing sections, shadcn/ui components, theme system.
- Product scope modeled on [Sejda.com](https://www.sejda.com/) (not affiliated).
- Engine: [pdf-lib fork `@cantoo/pdf-lib`](https://github.com/cantoo-pdf-lib/pdf-lib), [pdf.js](https://mozilla.github.io/pdf.js/), [fflate](https://github.com/101arrowz/fflate).

Code from the template retains its MIT license; the rest is **AGPL-3.0-or-later** (see `LICENSE`).
