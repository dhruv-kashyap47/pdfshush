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

`accounts.plan` is the *effective* plan: `'pro'` only while a paid term is
running (`plan_expires_at` is null or in the future). It is returned by
`/api/auth/me` and `/api/account`, and the SPA uses it for the AI allowance and
for whether a sponsor card may render. `accounts.credit_messages` is a one-time
balance, spent after the monthly Pro allowance is gone.

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | All tools, BYOK AI, 3 managed AI messages/day |
| Pro | $6/mo or $48/yr | 500 messages/month, cloud sync, **no sponsor cards** |
| 30-day pass | $3 one-time | 30 days of Pro, no renewal |
| Credit pack | $5 one-time | 1,000 messages, spent after the monthly cap |

## Billing

Four rails share one Dodo Payments account and one webhook, in
`routes/billing.ts`, `billing/webhook.ts` and `billing/dodo.ts`:

- Pro subscription (`$6/mo`, `$48/yr`) — `DODO_PRODUCT_PRO_MONTHLY` and
  `DODO_PRODUCT_PRO_YEARLY`, two recurring products;
- two sponsor slots (see below);
- 30-day pass;
- AI credit pack and donation.

A subscription is attached to the account by the `account_id` in the checkout
metadata and then by the Dodo subscription id stored on the account row, so
`subscription.renewed` does not depend on metadata surviving. `subscription.active`
sets the term, `renewed` moves it, `cancelled` keeps the paid month, and only
`subscription.expired` ends access early. `plan_expires_at` is the single source of
truth for every paid grant.

Dodo is the merchant of record, so it owns tax and receipts. With no
`DODO_API_KEY`, every billing route answers `503 billing_disabled`; the SPA shows
an email address rather than a button that lands on an error. `DODO_ENVIRONMENT`
defaults to `test`, so a missing value cannot charge a real card.

Webhooks follow Standard Webhooks: `HMAC-SHA256(secret, id.timestamp.body)`,
verified against the raw body, with a five-minute timestamp window. The message id
is claimed in `billing_events` before the side effect, so a retry grants nothing
twice; a handler failure releases the claim so the retry can succeed.

## Sponsorship (no ad network)

There is no third-party monetization script on this deployment. Two named slots
are sold directly:

| Slot | Price | Renders on |
|---|---|---|
| Featured | $39/mo (founding) | the home page, under the tool grid |
| Standard | $19/mo (founding) | the guides index and the end of each guide |

A card is first-party markup with a logo served from `/api/sponsors/:id/logo`, so
the strict CSP (`default-src 'self'`) is unchanged. The route allowlist is
home, `/guides` and `/guides/:slug`; never a tool workspace, a result, checkout,
the account page, the verifier or status. Pro accounts render no card at all.

The full decision record, data model and Dodo setup live in
[`docs/SPONSORSHIP.md`](../../docs/SPONSORSHIP.md).

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
