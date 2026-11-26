# Archived server tier

This directory is **not part of the build, the pnpm workspace, the tests or the
deployment**. It is kept so the server-heavy implementation can be restored when
there is revenue to pay for a persistent host.

The active product is Cloudflare-only:

```
apps/web        the SPA, static assets and every PDF tool (all in the browser)
apps/edge       one Cloudflare Worker: auth, D1 account data, AI proxy, billing
packages/*      the engine and AI provider code the browser and Worker share
```

## What is here

| Path | What it was |
|---|---|
| `apps/api` | Express API + BullMQ worker + Redis queue + MongoDB accounts; 8 server-side job slugs, public `/api/v1` REST API, API keys and quotas |
| `apps/mcp` | Local stdio MCP server that drove the archived `/api/v1` REST API |
| `packages/api-contracts` | Shared request/response contracts used only by `apps/api` and `apps/mcp` |
| `infra` | Dockerfiles for the API and worker images |
| `docker-compose.yml` | Redis + API + worker local stack |
| `tests/api` | Container smoke and SIGKILL hardening suites |
| `tests/e2e/ai-managed.mjs` | Managed-AI E2E that booted the archived API harness |
| `tests/e2e/share-boundary.mjs` | Job-file path-traversal E2E against the archived API |
| `scripts/ensure-redis.mjs` | Started a local Redis before `pnpm dev` |
| `scripts/check-merge-clean.mjs` | Merge-clean check for the `rea-uplift` branch era |
| `docs/DEPLOY-server.md` | The old server + static-host deployment guide |
| `.env.example` | The old server environment template |
| `.dockerignore` | The old server image ignore file |

## Safety net

The commit before the archive was tagged:

```bash
git tag -l server-tier-v1
git show --stat server-tier-v1
```

To restore the *whole* server tier exactly as it was:

```bash
git switch -c restore-server-tier server-tier-v1
```

## Restoring a single piece

The archived projects still have their own `package.json` and source. Move the
directory back into the workspace, then re-install:

```bash
git mv archive/apps/api apps/api
git mv archive/packages/api-contracts packages/api-contracts
pnpm install
pnpm --filter @pdfshush/api typecheck
```

The root `pnpm-workspace.yaml` uses `apps/*` and `packages/*`, so a directory
moved back is picked up automatically. `archive/` is deliberately outside those
globs.

## Why it was archived

- Every customer-facing PDF operation already runs in the visitor's browser.
- Cloudflare Workers + D1 cover the only server needs: sign-in, sync, the AI
  proxy and payments.
- The free Worker plan has no Redis, no Mongo and no long-lived queue, and the
  product no longer promises server-side jobs, the public REST API or MCP.
- The archived code is an asset for a later paid tier, not dead code to delete.
