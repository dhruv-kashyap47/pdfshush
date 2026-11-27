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
`workers.dev` is disabled. `www.pdfshush.com` is a **301 to the apex**, not a
second copy of the site: a proxied CNAME plus one zone Redirect Rule
([§3.1](#31-www-and-the-apex)).

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
| Cloudflare zone | `www` DNS | proxied CNAME to `pdfshush.com` ([§3.1](#31-www-and-the-apex)) |
| Cloudflare zone | Redirect Rule | `www.pdfshush.com` → `https://pdfshush.com`, 301, path and query kept |
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

### 3.1 www and the apex

`www.pdfshush.com` resolves and serves, but it is deliberately **not** a second
origin. Two things in the Cloudflare zone make it work:

| Where | Setting | Value |
|---|---|---|
| DNS → Records | `www` record | **CNAME** → `pdfshush.com`, **Proxied** (orange cloud) |
| Rules → Redirect Rules | one rule, "www to apex" | see below |

```
When incoming requests match:  http.host eq "www.pdfshush.com"
Then redirect to:              Dynamic
Expression:                    concat("https://pdfshush.com", http.request.uri.path)
Status code:                   301
Preserve query string:         on
```

Every path and query survives, so `https://www.pdfshush.com/tools/merge-pdf?x=1`
answers `301 https://pdfshush.com/tools/merge-pdf?x=1` in one hop. The target is
always `https`, so a plain-`http` request lands on the secure apex directly.

**Why not attach it as a Worker custom domain?** The Worker is built around one
origin: canonical URLs, the Google redirect URI, session cookies and the CSP all
name `https://pdfshush.com`. Serving a second hostname would hand out a second
set of cookies and make every page reachable at two URLs, which is exactly the
duplicate-origin problem `workers_dev: false` avoids. A redirect also costs no
Worker invocations.

To recreate it from scratch (after pointing the nameservers at Cloudflare):

1. **DNS → Records → Add record**: type `CNAME`, name `www`, target
   `pdfshush.com`, proxy **on**.
2. **Rules → Redirect Rules → Create rule**: paste the expression and options
   above. The free plan includes Redirect Rules.
3. Verify from a shell:

   ```bash
   curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' \
     'https://www.pdfshush.com/tools/merge-pdf?x=1'
   # 301 https://pdfshush.com/tools/merge-pdf?x=1
   ```

`pnpm test:e2e:reach` against production (`E2E_BASE_URL=https://pdfshush.com`)
asserts this redirect, so a deleted rule fails the reach suite rather than
silently splitting the site.

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

## 4a. Billing: live in production, test locally

The seven **live** Dodo ids are the `DODO_PRODUCT_*` values in `wrangler.jsonc`,
with `DODO_ENVIRONMENT=live`. The test ids live in `<repo>/.dev.vars`, which
overrides `wrangler.jsonc` for a local run; they are documented in
[`dodo-products.md`](./dodo-products.md).

Wrangler resolves its config at the repository root, so the file it reads is
`<repo>/.dev.vars`, **not** `apps/edge/.dev.vars` (they were moved; the copy under
`apps/edge` is only documentation). A local run needs:

```
pnpm db:local                 # migrations, credits, billing_events, payment ledger
pnpm dev:session              # local account + session + CSRF cookie
pnpm dev                      # Vite on :5173
pnpm dev:edge                 # Worker on :8787
```

`.dev.vars` also overrides `WEB_ORIGIN` to `http://localhost:5173`; without it a
checkout returns to production and the local cookie jar loses the account.

**Webhooks cannot be managed over OAuth.** The Dodo consent page exposes 16
resources and none of them is Webhooks, so the CLI listener and the MCP both
answer `403 webhooks:read`. Register the endpoint in the dashboard instead:

```bash
cloudflared tunnel --url http://localhost:8787 --no-autoupdate
```

Add `https://<tunnel>.trycloudflare.com/api/billing/webhook` in **Developer →
Webhooks** with:

```
payment.succeeded
subscription.active  subscription.renewed  subscription.cancelled  subscription.expired
refund.succeeded     refund.failed
dispute.opened       dispute.challenged     dispute.won
dispute.cancelled    dispute.accepted       dispute.lost       dispute.expired
```

and put the signing secret in `DODO_WEBHOOK_SECRET`. The production endpoint is
`https://pdfshush.com/api/billing/webhook` with the same list. **If the endpoint
is not subscribed to the refund and dispute events, the Worker never receives
them**; the code is there, but the dashboard must be updated by hand.

Verified against the real test API on 2026-11-27, one purchase per rail:

| Rail | Result in local D1 |
|---|---|
| Pro monthly (`$6`) | `plan=pro`, term ≈ 31 days, `dodo_subscription_id` stored |
| 30-day pass (`$3`) | `plan=pro`, term ≈ 30 days, no subscription id |
| 1,000 credits (`$5`) | `credit_messages=1000` |
| Donation (`$5`) | `payment.succeeded` claimed, no entitlement change |
| Sponsor featured (`$39/mo`) | draft → `status=active`, slot unavailable, card renders for free visitors |

Live status (2026-11-27): the live products, live key and live webhook secret are
set, and one real `$3` pass granted Pro (`pay_0Nsr107WnveRWS1WiWlI4`). The
remaining live verification is one purchase per other rail and a real refund
after settlement. A full refund revokes the grant; a partial refund keeps it.

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

# 4. www is a 301 to the apex, with the path and query intact
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  'https://www.pdfshush.com/tools/merge-pdf?x=1'

# 5. Browser suites
E2E_BASE_URL=https://pdfshush.com pnpm test:e2e
E2E_BASE_URL=https://pdfshush.com pnpm test:e2e:reach
E2E_BASE_URL=https://pdfshush.com pnpm test:e2e:offline
```

The last recorded production run before the live-billing release
(2026-11-26, Worker `372f97f0`) passed: smoke **all checks**, reach **all
checks**, 48 live tools, 71 sitemap URLs, 84 prerendered routes, archived pages
`noindex`, `/api/*` healthy, no console errors. The guides release raised this to
92 sitemap URLs and 104 prerendered routes. Re-run both suites after every
deploy; `/pricing` is part of the reach check.

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

Dodo billing is **deployed and live** (seven live products, `/pricing`, the
membership dashboard and the hosted portal). It is not in this table because it
is no longer withheld.

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
`apps/web/src/lib/csp.ts` and stays `default-src 'self'`. The only named
third-party hosts are the page-view measurement tag (`googletagmanager.com`,
`google-analytics.com`) and the AI providers a visitor configures; no
advertising or sponsor script origin is allowed.
