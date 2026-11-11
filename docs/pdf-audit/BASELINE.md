# PDF audit — baseline

Snapshot of repository health at the start of session 1. Every number below came
from a command run on this machine; raw logs live in `docs/pdf-audit/.baseline/`.

- Branch: `pdf/s1-audit`, cut from `main` at `c8f2208`
  ("feat(landing): set the hero and close in one serif type system").
- Environment: Windows 11, Node v24.21.0, pnpm 12.11.2.
- Date: 2026-11-11.

## Reproduce

```powershell
pwsh docs/pdf-audit/.baseline/run-baseline.ps1
```

The script writes one JSON line per step to `.baseline/results.jsonl` and a full
log per step.

## Gate results

| Step | Command | Exit | Wall clock | Log |
| --- | --- | --- | --- | --- |
| Typecheck | `pnpm typecheck` | 0 | 16.6s | `.baseline/typecheck.log` |
| Unit tests | `pnpm test` | 0 | 25.7s | `.baseline/test.log` |
| Build | `pnpm build` | 0 | 16.6s | `.baseline/build.log` |
| Bundle boundary | `pnpm test:bundle` | 0 | 0.8s | `.baseline/bundle.log` |

Unit-test totals (`pnpm test`, run through `pnpm -r --if-present test`):

| Package | Test files | Tests |
| --- | --- | --- |
| `packages/pdf-core` | 28 | 488 |
| `apps/api` | 14 | 214 |
| `packages/ai-provider` | 31 | 375 |
| `packages/ai-agent` | 8 | 152 |
| `apps/web` | 22 | 161 |
| `apps/mcp` | 3 | 19 |
| **Total** | **106** | **1409 passed, 0 failed** |

No suite was skipped or filtered.

The audit adds seven known-failing repro tests under
`packages/pdf-core/test/pdf-audit/` (see `FINDINGS.md`). They use `it.fails`, so
the post-audit `pdf-core` run is **488 passed + 7 expected fail = 495 cases**
and the overall count becomes 1409 passed + 7 expected fail. The baseline above
remains the pre-audit snapshot.

## Lint

There is no lint step for `apps/` or `packages/`. The only ESLint config in the
tree is `genoffice-main/eslint.config.mjs`, which belongs to a vendored
subproject that this audit must not touch. `package.json` has no `lint` script.
Baseline lint status is therefore **not configured**, not "passing".

## E2E / sweep preflight

`scripts` shows every e2e entry point runs `node tests/support/preflight.mjs`
first, and `test:sweep` does the same. Preflight failed:

```
note: docker-compose.yml exists but docker compose is unavailable -- skipping compose checks
[preflight] the api at http://localhost:8080 is down -- start the stack first:  pnpm dev   (or for the full server stack:  pnpm stack:up)
```

Full log: `.baseline/preflight.log` (exit 1).

Cause: the Docker daemon is not reachable on this machine
(`npipe:////./pipe/dockerDesktopLinuxEngine` is absent), there is no system
Redis and no Memurai, so the API server cannot be started and
`docker compose up -d redis` fails with `failed to connect to the docker API`.
This matches the container-dependent limitation already recorded in
`PLAN.md` §31.21.

Consequence: the gated e2e suites and the gated sweep
(`pnpm test:sweep = preflight && node tests/sweep.mjs`) **could not be run**.
They are marked blocked here rather than reported as passing. No stand-in API
was substituted to make preflight green.

## Ungated sweep diagnostic

`node tests/sweep.mjs` was run directly against the web dev server on
`http://localhost:5173` as a clearly labelled, non-gated diagnostic. It is
**not** a substitute for `pnpm test:sweep`, because it skips preflight and the
API.

Result: exit 1, 164s, `=== sweep: 60 problem group(s) ===`.
Every route except `/` fails identically in both themes at all six breakpoints
(`1920 / 1440 / 1024 / 768 / 430 / 375`):

```
[FAIL] light 1920 /tools/merge-pdf  overflow=0 unrevealed=1
[FAIL] light 1920 /tools/chat-with-pdf  overflow=0 unrevealed=1
[FAIL] light 1920 /tools/redact-pdf  overflow=0 unrevealed=1
[FAIL] light 1920 /tools/pdf-to-jpg  overflow=0 unrevealed=1
[FAIL] light 1920 /workflows  overflow=0 unrevealed=1
...
=== sweep: 60 problem group(s) ===
```

Full log: `.baseline/sweep.log`. `overflow=0` everywhere, so this is not an
overflow regression; it is a single unrevealed reveal target per route.

### Root cause of the sweep failures

`docs/pdf-audit/.baseline/probe-reveal.mjs` walks each route, scrolls it fully,
and prints every visible `[data-reveal]` element that never got
`data-revealed`. Output:

```
/ []
/tools/merge-pdf [ { "tag": "div", "cls": "footer-wordmark @container mt-14 select-none sm:mt-20", "text": "pdfshush", ... } ]
/workflows       [ { "tag": "div", "cls": "footer-wordmark @container mt-14 select-none sm:mt-20", "text": "pdfshush", ... } ]
```

The element is the footer wordmark:

- `apps/web/src/components/layout/footer.tsx:135` — the `div` carrying
  `data-reveal` (and `aria-hidden="true"`).
- `apps/web/src/hooks/use-reveal.ts:12` — `useReveal()` is what attaches the
  `IntersectionObserver` and sets `data-revealed`
  (`use-reveal.ts:26-41`).
- `apps/web/src/pages/home.tsx:14` — the **only** call site of `useReveal()`.

So the observer is armed on `/` but never on any other route, and the footer is
rendered on all of them. This is a pre-existing marketing-chrome regression on
`main`; it is unrelated to the PDF engine and is **not** tagged as an
ENGINE/RENDER finding. It is recorded here so the baseline is honest and so a
future sweep run against the same tree is not mistaken for a PDF bug.

## Dev log noise

`dev2.log` (repo root, pre-existing) contains 584 `ECONNREFUSED` lines, all from
the Vite dev proxy forwarding `/api/*` to `http://localhost:8080` while the API
was down, and 15 occurrences of `Setting up fake worker.` from pdf.js.
`.vite-dev.err.log` is empty.

`Setting up fake worker.` is expected inside the app's dedicated job worker:
pdf.js cannot spawn a nested worker from a worker global (its bootstrap
dereferences `window`), so it parses in-thread over `LoopbackPort`. The app
still injects a `workerSrc` for contexts that can use one
(`apps/web/src/workers/job-worker.ts:33-50`). It is not a bug and is not
reported as a finding.

## Summary

| Area | Status |
| --- | --- |
| Typecheck | pass (exit 0) |
| Unit tests | pass (1409/1409) |
| Build | pass (exit 0) |
| Bundle boundary | pass (exit 0) |
| Lint | not configured |
| E2E (gated) | blocked — API/Redis unavailable, preflight exit 1 |
| Sweep (gated) | blocked — same |
| Sweep (ungated diagnostic) | 60 failure groups, root-caused to footer reveal, non-PDF |
