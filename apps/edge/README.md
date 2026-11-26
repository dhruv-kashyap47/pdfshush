# @pdfshush/edge — the free deployment shape

One Cloudflare Worker that serves the SPA from Static Assets and the API from
this package. Accounts live in D1. There is no Redis, no MongoDB, and no
server-side PDF worker: every tool runs in the visitor's browser.

This is a *second* deployment shape, not a replacement for `apps/api`. The
Express + BullMQ + Mongo stack still exists and still runs from
`docker-compose.yml`; it is the shape that can execute PDF work on the server.

## What it serves

| Route | Behaviour |
|---|---|
| `/api/health` | Liveness JSON |
| `/api/capabilities` | Which features this shape supports |
| `/api/tools` | Catalog, `accounts.enabled`, `ai.enabled` (the SPA's feature switches) |
| `/api/auth/*` | Google OIDC start/callback, `/me`, logout |
| `/api/account*` | Preferences, synced history, saved workflows, `plan`, erasure |
| `/api/ai/chat` | Metered streaming proxy to OpenRouter (SSE) |
| `/api/jobs*`, `/api/v1/*`, `/api/keys*`, `/api/mcp/*` | `503` with a stable `code` — capability-gated |
| everything else | Static asset, with SPA fallback |

## Deploy

```bash
pnpm --filter @pdfshush/web build

npx wrangler d1 create pdfshush          # once; paste the id into wrangler.jsonc
npx wrangler d1 migrations apply pdfshush --remote

npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put AI_MANAGED_API_KEY   # OpenRouter key, sk-or-v1-...

npx wrangler deploy
```

`GOOGLE_REDIRECT_URI` must be the public callback URL
(`https://pdfshush.com/api/auth/callback`). Google rejects a mismatch.

## Managed AI

Off unless **both** a model (`AI_MANAGED_MODEL` in `wrangler.jsonc`) and a key
(`AI_MANAGED_API_KEY` secret) exist. That way a fresh deploy behaves exactly like
the pre-AI shape.

**Buy 10 credits on OpenRouter once.** Below 10 credits its free-model limit is
**50 requests/day for the whole account**; at 10+ it is **1,000/day**. This is
not optional at any real traffic.

Changing model is one variable. Any OpenRouter model id works:

```jsonc
"AI_MANAGED_MODEL": "deepseek/deepseek-chat-v3:free"
```

Metering is by **message**, not token, because that is what the price is:

| Tier | Allowance |
|---|---|
| Anonymous | 3 messages/day |
| Free account | 3 messages/day |
| Pro | 500 messages/month, ≤60/day |

Plus a deployment-wide daily budget — 700 anonymous, 200 Pro, out of OpenRouter's
1,000. Without it the trial would spend the day's capacity in an hour and every
later visitor, including paying ones, would get a 429. The split reserves
capacity for Pro so the paid tier cannot be starved by the trial.

**Privacy:** `/api/ai/chat` is the one path where document text reaches the
server. The 51 tools still never upload anything; the AI panel has to say so.

## Plans

`accounts.plan` is `'free'` or `'pro'`, returned by `/api/auth/me` and
`/api/account`. The SPA uses it for two things: the AI allowance, and whether to
render ads.

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | All tools, BYOK AI, 3 managed AI messages/day, ads |
| Pro | $6/mo or $48/yr | 500 messages/month, cloud sync, **no ads** |

Payments are not wired yet. When they are, the shape is: a checkout route that
creates a Dodo Payments session, and a webhook that verifies the signature and
sets `plan = 'pro'` with an expiry column the cron can downgrade.

## Ads (not enabled)

Ads are **not** built here yet, deliberately. Google AdSense cannot run under
the current CSP (`default-src 'self'`, pinned by `edge-headers.test.ts`), so a
slot shipped now would be blocked and look broken.

Turning AdSense on needs all of:

1. An approved AdSense account and a `ca-pub-…` publisher id.
2. `public/ads.txt` with the `google.com, pub-…, DIRECT, f08c47fec0942fa0` line.
3. CSP widened for `pagead2.googlesyndication.com`,
   `googleads.g.doubleclick.net`, `adservice.google.com`, plus `frame-src` and
   `img-src` for the same — and the CSP test updated with it.
4. A consent mechanism for EEA/UK traffic (Google's CMP or a certified one).
5. A slot component gated on `account?.plan !== 'pro'`, placed below the fold on
   tool pages, and never on a result or error screen.

Rule: **every non-Pro visitor sees ads; Pro never does.** A signed-in free user
still sees them — signing in is not paying.

## Local development

```bash
cp apps/edge/.dev.vars.example apps/edge/.dev.vars   # then fill it in
npx wrangler d1 migrations apply pdfshush --local
npx wrangler dev --port 8787
```

To exercise the AI path without a real key, override the model and key on the
command line. The stream will report the provider's 401 through the normal SSE
`error` event, which still proves the meter and the stream:

```bash
npx wrangler dev --port 8787 --local \
  --var AI_MANAGED_MODEL:deepseek/deepseek-chat-v3:free \
  --var AI_MANAGED_API_KEY:sk-or-invalid
```

Two things to know about local runs:

- `wrangler dev` also reads the repository-root `.env`, so the Express stack's
  `MONGODB_*`/`REDIS_*` values appear as bindings. They are ignored here, but a
  local `GOOGLE_REDIRECT_URI` pointing at port 8080 produces the wrong redirect.
- Scheduled handlers do not fire automatically. The cron only sweeps expired
  sessions; every query already filters on `expires_at`.

## Tests

`pnpm --filter @pdfshush/edge typecheck` is the gate today. The behaviours worth
pinning next are CSRF rejection, single-use OAuth state, session expiry, and the
AI meter's daily/monthly rollover — all pure store/route logic, no network.
