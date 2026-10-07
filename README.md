# PDFShush

**Free, private PDF tools that run in your browser.**

PDFShush is an open-source (AGPL-3.0) alternative to online PDF suites: merge, organize,
convert, edit, sign, secure, automate. The core difference is architectural — light tools
run **client-side in a Web Worker**, so your files never leave your device. Heavy tools
(OCR, compression, Office conversion) will run on bounded server workers with anonymous
quotas, through the exact same job contract.

## Status: Phase 1 (10 client-side tools shipped)

> **Plan, decisions & progress tracker: [`PLAN.md`](./PLAN.md)** — read this first when
> resuming work; it is updated at the end of every session.

| Layer | State |
| --- | --- |
| `packages/pdf-core` | ✅ Engine: job contract, limits, merge/compose/render/zip/stamp/split/n-up, 38 tests |
| `apps/web` | ✅ Vite + React 19 + Tailwind v4 + shadcn/ui, full tool catalog, mega-menu |
| Live tools (13) | ✅ Merge, Organize, PDF → JPG · Delete, Extract, Rotate, Split by pages, Alternate & Mix, Split in half, Page Numbers, Crop, Header & Footer, N-up |
| Server (P3), accounts (P4), AI (P5), e-sign/API/MCP (P6) | ⏳ Planned |

Every tool has a permanent page from day one (`/tools/:slug`); unshipped tools show an
honest "in development" state so links and SEO never churn.

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm typecheck    # tsc across the workspace
pnpm test         # vitest (pdf-core)
pnpm build        # production build
pnpm test:e2e     # Playwright suite vs. running dev server (system Edge)
```

Requirements: Node ≥ 20.19, pnpm 11.

## Architecture

```
apps/web                 React SPA (Vite, Tailwind v4, shadcn/ui)
  src/workers/           module worker: configures pdf.js, runs pdf-core jobs
  src/lib/job-pool.ts    bounded pool, timeouts, terminate-on-cancel, zero-copy transfer
  src/tools/registry.ts  the full catalog (~45 tools, categorized like Sejda)
packages/pdf-core        environment-agnostic engine (worker + Node)
  src/job.ts             JobDefinition / JobContext / withJobLimits
  src/limits.ts          every capacity number in one file
  src/ops/               pages, compose, merge, zip, ranges
  src/render/            pdf.js runtime, canvas abstraction, page rendering
  src/jobs/              inspect, merge, organize, pdf-to-images, thumbnails
```

Key invariants:

- **One job contract.** `JobDefinition { validate, estimate, run }` is consumed by the
  browser pool today and the server queue (Phase 3) later — tools never know where they run.
- **Guardrails first.** File/page/byte limits, per-job timeouts derived from page count,
  abort signals, bounded worker concurrency, terminate-on-timeout (synchronous PDF work
  cannot be interrupted any other way).
- **Transfer, don't copy.** Input buffers are moved into the worker and results are moved
  back; main-thread bundle contains neither pdf.js nor pdf-lib (verified: ~184 kB gzip).
- **Refuse, don't crash.** Capacity checks run before work starts; a browser tab never
  dies halfway through someone's document.

## Credits & licensing

- UI foundation: [shadcn dashboard & landing template](https://github.com/shadcnstore/shadcn-dashboard-landing-template) (MIT, full text in `licenses/`) — landing sections, shadcn/ui components, theme system.
- Product scope modeled on [Sejda.com](https://www.sejda.com/) (not affiliated).
- Engine: [pdf-lib fork `@cantoo/pdf-lib`](https://github.com/cantoo-pdf-lib/pdf-lib), [pdf.js](https://mozilla.github.io/pdf.js/), [fflate](https://github.com/101arrowz/fflate).

Code from the template retains its MIT license; the rest is **AGPL-3.0-or-later** (see `LICENSE`).
