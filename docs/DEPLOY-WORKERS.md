# Deploy PDFShush on Cloudflare (Workers + D1)

The active product is **one Cloudflare Worker** that serves:

- the SPA and every prerendered page from **Static Assets**;
- `/api/*` from `apps/edge` — Google sign-in, D1 account data, the managed AI
  proxy, sponsor cards and Dodo billing.

Every PDF operation runs in the visitor's browser. There is no Redis, no Mongo,
no BullMQ, no server-side PDF worker, and no `_worker.js` on a page host. The old
Express tier is archived in [`archive/`](../archive/README.md) (tag
`server-tier-v1`).

Production: **https://pdfshush.com** — the only attached custom domain.
`pdfshush.space` no longer resolves.

---

## 1. Prerequisites

| Thing | Why |
|---|---|
| Node 20.19+ and pnpm 12 | The repo's pinned toolchain |
| Cloudflare account with `pdfshush.com` as an active zone | Custom domain + D1 |
| `npx wrangler login` | OAuth token with `workers`, `d1`, `zone` scopes |
| Google Cloud OAuth client | Optional; without it sign-in stays hidden |
| OpenRouter API key | Optional; without it managed AI stays off. BYOK still works |

---

## 2. First deploy (already done once)

```bash
pnpm install

# 1. D1 (once). Paste the id into wrangler.jsonc.
npx wrangler d1 create pdfshush
npx wrangler d1 migrations apply pdfshush --remote

# 2. Secrets (see §4). Skip until you have the values.
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put AI_MANAGED_API_KEY

# 3. Build the SPA and deploy the Worker.
pnpm build
npx wrangler deploy
```

`pnpm deploy` does the last two steps together.

The committed `apps/web/.env.production` builds the Worker-connected shape
(`VITE_SERVER_API=on`) at `https://pdfshush.com`. A shell/CI variable with the
same name wins over that file.

**Current D1 id:** `64dee00a-9259-465f-8462-f053c6fa4d95` (APAC), set in
`wrangler.jsonc`.

### Git-connected Workers Builds

If the Worker is connected to the GitHub repo, the build runs on a branch and
reads **that branch's** `wrangler.jsonc`. A stale branch produces a build that
looks healthy until the deploy step, then fails with:

```
D1 binding 'DB' references database '00000000-0000-0000-0000-000000000000'
```

That is a wrong-branch symptom, not a Cloudflare problem. The production branch
must be **`main`** (or `cloudflare-only`), and both were updated to the same
commit on 2026-11-26. Set:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Build command | `pnpm --filter @pdfshush/web build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | repository root (the `wrangler.jsonc` is there) |

The guard runs before a local/CI deploy:

```bash
pnpm test:deploy-config
```

It fails on the placeholder D1 id, a missing `pdfshush.com` route, a
frontend-only `.env.production`, or a redirect URI that does not match
`WEB_ORIGIN`.

---

## 3. Configuration

| Where | Key | Value / meaning |
|---|---|---|
| `apps/web/.env.production` | `VITE_SITE_ORIGIN` | `https://pdfshush.com` — canonical URLs, sitemap, OG |
| `apps/web/.env.production` | `VITE_SERVER_API` | `on` for the Worker shape; `off` for a static-only build |
| `wrangler.jsonc` | `routes` | `pdfshush.com` custom domain |
| `wrangler.jsonc` | `workers_dev` | `false` — no second origin |
| `wrangler.jsonc` | `WEB_ORIGIN` | `https://pdfshush.com` |
| `wrangler.jsonc` | `GOOGLE_REDIRECT_URI` | `https://pdfshush.com/api/auth/callback` |
| `wrangler.jsonc` | `AI_MANAGED_PROVIDER` | `openrouter` |
| `wrangler.jsonc` | `AI_MANAGED_MODEL` | `openrouter/free` (OpenRouter's free-model router) |
| `wrangler.jsonc` | `AI_ANON_GLOBAL_PER_DAY` | `30` while the account is under $10 of credit |
| `wrangler.jsonc` | `AI_PRO_GLOBAL_PER_DAY` | `10` while the account is under $10 of credit |
| `wrangler.jsonc` | `DODO_ENVIRONMENT` | `test` — a typo cannot charge a real card |

The two AI global caps must always sum to **less than** the OpenRouter free-model
quota: 50/day below $10 of credit, 1,000/day at $10+. At $10+, raise them to
`700` and `200` together.

---

## 4. Secrets

Never put these in a file that git can see. `wrangler secret put` prompts and
stores them on the Worker:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put AI_MANAGED_API_KEY      # sk-or-v1-...
# Optional, only when Dodo billing is switched on:
npx wrangler secret put DODO_API_KEY
npx wrangler secret put DODO_WEBHOOK_SECRET
```

Secrets are read at request time, so adding one does **not** need a rebuild or a
redeploy. The next request sees it.

Check what is set (names only, never values):

```bash
npx wrangler secret list
```

---

## 5. Google sign-in

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client
   ID → Web application**.
2. **Authorized redirect URI** (exact, byte for byte):
   `https://pdfshush.com/api/auth/callback`
3. **Authorized JavaScript origins** are unused by the Authorization Code flow.
4. Put the client id and secret in the two Worker secrets above.
5. Verify:
   ```bash
   curl -s https://pdfshush.com/api/tools
   ```
   `accounts.enabled` must be `true`.
6. Open `https://pdfshush.com/api/auth/google/start` in a browser. It must answer
   with a redirect to `accounts.google.com`, not `503 auth_disabled`.

Without the secrets, the SPA hides the sign-in control instead of offering a
button that lands on a 503.

---

## 6. Managed AI (OpenRouter)

1. Create an account at **openrouter.ai** and an API key at
   `https://openrouter.ai/settings/keys`.
2. Put the key in `AI_MANAGED_API_KEY` (§4). `AI_MANAGED_MODEL` is already
   `openrouter/free`.
3. Verify:
   ```bash
   curl -s https://pdfshush.com/api/tools
   ```
   `ai.enabled` must be `true`. `GET /api/health` also reports `managedAi`.
4. Open any AI tool (`summarize-pdf`, `chat-with-pdf`, `edit-pdf-with-ai`) and
   send one message. The fourth anonymous message in a day should be refused.

**The honest limit.** Below $10 of OpenRouter credit, the free-model quota is
**50 requests/day for the whole account**. The deployment caps are set to 30
anonymous + 10 signed-in, which is why the trial is deliberately small. At $10+
the quota is 1,000/day; raise the two caps to 700/200.

**BYOK still works with no key.** The AI settings panel stores the visitor's own
provider key in IndexedDB and sends requests straight to that provider. All four
AI features — summarize, chat, edit-with-AI and smart redaction — accept both
BYOK and managed mode.

---

## 7. Local development

```bash
pnpm dev          # http://localhost:5173 — every tool, no Worker needed
pnpm dev:edge     # http://localhost:8787 — Worker only
pnpm dev:full     # build once, then web + Worker together
```

`pnpm dev` proxies `/api` to `:8787`. Most tool work needs no Worker at all; start
`pnpm dev:edge` only when testing sign-in, sync or AI.

Local secrets go in `apps/edge/.dev.vars` (gitignored):

```bash
cp apps/edge/.dev.vars.example apps/edge/.dev.vars
# then fill in GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / AI_MANAGED_API_KEY
pnpm db:local
```

Local D1 migrations: `pnpm db:local`. Remote: `pnpm db:remote`.

---

## 8. Verify a deploy

```bash
# 1. Worker shape
curl -s https://pdfshush.com/api/health
curl -s https://pdfshush.com/api/capabilities
curl -s https://pdfshush.com/api/tools

# 2. Static + SEO
curl -s https://pdfshush.com/ | grep -o '<link rel="canonical"[^>]*>'
curl -s https://pdfshush.com/sitemap.xml | grep -c '<loc>'

# 3. Archived surfaces stay out
curl -sI https://pdfshush.com/tools/workflows | grep -i robots
curl -s  https://pdfshush.com/tools/workflows | grep -o 'Not available on this deployment'

# 4. Browser suites
E2E_BASE_URL=https://pdfshush.com pnpm test:e2e
E2E_BASE_URL=https://pdfshush.com pnpm test:e2e:reach
E2E_BASE_URL=https://pdfshush.com pnpm test:e2e:offline
```

The last verified production run (2026-11-26, Worker `372f97f0` before the
static-only surface deploy) passed: smoke **all checks**, reach **all checks**,
48 live tools, 71 sitemap URLs, 84 prerendered routes, archived pages
`noindex`, `/api/*` healthy, no console errors.

---

## 9. Operations

```bash
npx wrangler tail                      # live errors
npx wrangler deployments list
npx wrangler rollback                  # previous Worker version
npx wrangler d1 execute pdfshush --remote --command "SELECT COUNT(*) FROM accounts"
```

The Worker runs a cron at `17 * * * *` to expire sessions, sponsor rows and
abandoned drafts.

---

## 10. What is deliberately not deployed

| Surface | Why |
|---|---|
| Workflows / recipe runner | Needs the archived server queue |
| REST API `/api/v1` | Needs server-side PDF execution and a durable job store |
| MCP server | Local stdio bridge over the archived REST API |
| Server-side PDF jobs | No canvas in workerd; the browser is the processor |
| Dodo billing | Code is built; routes answer `503 billing_disabled` until configured |

Their permanent pages say "not available on this deployment" and are `noindex`.
They are not in the catalog, menus or sitemap.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `503 auth_disabled` | One of the three Google values is missing | Set all three secrets; redirect URI must match exactly |
| `503 ai_disabled` | No `AI_MANAGED_API_KEY` or empty model | Set the key; keep `AI_MANAGED_MODEL=openrouter/free` |
| `429 ai_capacity` | Deployment-wide daily cap reached | Expected on a sub-$10 account; raise caps after buying credit |
| `429 ai_budget` | This person used their allowance | Expected; they wait or upgrade |
| AI panel never appears | `VITE_SERVER_API=off`, or `/api/tools` says `ai.enabled:false` | Rebuild with `on`; check the secret |
| Sign-in loops | Redirect URI mismatch, or cookie secure on http | Match Google exactly; `SESSION_COOKIE_SECURE=true` only on https |
| Deploy says custom domain already exists | Domain was attached in the dashboard | It is already attached; remove the duplicate `routes` entry |
| Stale HTML after deploy | Browser or Cloudflare cache | HTML is `must-revalidate`; hard reload, or check `_headers` |

---

## 12. Security headers

`apps/web/public/_headers` is applied by Workers Static Assets. It sets
`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, HSTS and the
cache policy. The Content-Security-Policy is a **meta tag** generated by
`apps/web/src/lib/csp.ts` and stays `default-src 'self'`; no third-party
monetization script is allowed.
