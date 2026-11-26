# What we built, what's next, and how to run the AI

**Last updated:** 2026-11-26
**Read this first if:** you are picking the project back up after a break.

---

## Where we are, in one paragraph

The website is live and every PDF tool runs in the visitor's browser. A second,
free backend now exists on Cloudflare: it handles sign-in, cloud sync and the AI
trial, and it costs $0 at your traffic. The 20 AdSense articles are written but
not published. Ads are fully built but switched off, because there is no
publisher ID yet. Nothing is broken; most things are just waiting on a decision
or an account.

---

## 1. What we built (plain English)

| Thing | What it means | State |
|---|---|---|
| Free backend | A Cloudflare Worker serving the site and `/api` from one address | Built, runs locally |
| Accounts | Google sign-in, stored in Cloudflare D1 (not MongoDB) | Built |
| Cloud sync | Preferences, history, workflows saved per account | Built |
| AI proxy | Your OpenRouter key stays on the server; visitors never see it | Built, **off** |
| Plans | Free = 3 AI messages/day + ads. Pro = 500/month + no ads | Built, no payments |
| Guides | `/guides` plus 20 article drafts (~39,000 words) | Drafts only |
| Ads | One unit on home/tool pages, two in articles, Pro never | Built, **off** |
| Capability switch | The site hides features a deployment cannot run | Built |

Two rules that shaped everything:

1. **The 51 PDF tools never upload anything.** Only the AI panel sends text, and
   the site says so.
2. **Free is not a trial.** It is a real, permanent tier funded by ads and
   limited AI.

---

## 2. How to enable and manage the AI

This is the part that earns money, so it is worth doing carefully.

### 2.1 Before you start

1. Create an account at **openrouter.ai**.
2. **Buy 10 credits once (~$10).** This is not optional. Below 10 credits
   OpenRouter allows **50 free-model requests per day for your whole account**.
   At 10+ it is **1,000/day**. Without it, the site runs out before lunch.
3. Create an API key (`sk-or-v1-…`).

### 2.2 Turn it on (4 commands)

```bash
# 1. Store the key as a Worker secret (never in a file)
npx wrangler secret put AI_MANAGED_API_KEY

# 2. Pick a model in wrangler.jsonc
#    "AI_MANAGED_MODEL": "deepseek/deepseek-chat-v3:free"

# 3. Deploy
npx wrangler deploy

# 4. Check it answered
curl -s https://pdfshush.com/api/tools
```

The response should contain:

```json
"ai": { "enabled": true, "limits": { "anonymousPerDay": 3, "proPerMonth": 500 } }
```

If `enabled` is `false`, either the key or the model is missing. Both must be
present; an empty model is how you switch AI off.

### 2.3 Test it like a user

1. Open a PDF tool that has the AI panel.
2. Send one message. It should stream back.
3. Send three. The fourth should say you have used today's messages.
4. Sign in with Google. You get 3 more per day as a free account.

### 2.4 Change the model

One line in `wrangler.jsonc`, then deploy. Any OpenRouter model id works:

```jsonc
"AI_MANAGED_MODEL": "deepseek/deepseek-chat-v3:free"     // free, fine for the trial
"AI_MANAGED_MODEL": "openai/gpt-4o-mini"                  // cheap and reliable
"AI_MANAGED_MODEL": "google/gemini-2.5-flash"             // cheap and fast
```

**The honest recommendation:** free models for the anonymous trial, a cheap paid
model for Pro. Free models are shared capacity — they queue and sometimes
disappear. Paying customers should not meet that.

### 2.5 Change the limits

All of them live in `apps/edge/src/ai/budget.ts`:

```ts
export const AI_LIMITS = {
  anonymousPerDay: 3,        // taste of the feature
  proPerMonth: 500,          // what the $6 buys
  proPerDay: 60,             // stops one afternoon burning the month
  anonymousGlobalPerDay: 700, // of OpenRouter's 1,000
  proGlobalPerDay: 200,       // reserved so Pro is never starved
};
```

The two global numbers must add up to **less than 1,000** while you are on free
models. That is the whole reason they exist.

### 2.6 Give someone Pro (before payments exist)

```bash
npx wrangler d1 execute pdfshush --remote \
  --command "UPDATE accounts SET plan='pro' WHERE email='customer@example.com'"
```

To take it away: same command with `plan='free'`.

### 2.7 Watch the cost

- OpenRouter dashboard → Activity shows spend per day.
- `curl https://openrouter.ai/api/v1/key -H "Authorization: Bearer $KEY"`
  returns `usage_daily`, `limit_remaining` and the free-model daily counter.
- `npx wrangler tail` streams live errors from the Worker.

### 2.8 Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| `503 ai_disabled` | No key, or no model | Set both |
| `429 ai_budget` | This person hit their daily/monthly cap | Expected; they wait or upgrade |
| `429 ai_capacity` | The whole site hit today's global cap | Check the OpenRouter daily counter |
| SSE `error: HTTP 401` | The key is wrong or revoked | New key, `wrangler secret put` again |
| `402` or `403` inside the error | OpenRouter credits or budget | Add credits / raise the key limit |
| Panel does not appear at all | The site was built with `VITE_SERVER_API=off` | Rebuild with `on` |
| 500 errors | Unhandled exception | `npx wrangler tail` and read the message |

### 2.9 Turn it off

Set `"AI_MANAGED_MODEL": ""` and deploy. The panel disappears, `/api/ai/*`
answers 503, and every other feature keeps working. This is the safe switch if
costs ever surprise you.

---

## 3. What's left, as sprints

A sprint here is **one focused block of work**, not a calendar week. Finish it,
tick the boxes, move on. Each one is independent enough to stop after.

### Sprint 1 — Publish the guides (content, no code)

**Why:** AdSense will not approve thin or unedited content, and this is also your
US traffic engine.

- [ ] Read all 20 files in `apps/web/src/content/guides/`
- [ ] Tick every `NEEDS HUMAN EDIT` box (facts, screenshots, legal wording)
- [ ] Change `draft: true` to `draft: false`
- [ ] Run `pnpm --filter @pdfshush/web guides:check` → must print **OK: 20**
- [ ] Build and confirm the 20 pages exist in `dist/guides/`
- [ ] Submit `/guides` and each article in Search Console

**Done when:** 20 articles are live, indexed, and each links to its tool.

### Sprint 2 — Deploy the free backend

**Why:** accounts, sync and AI do not exist in production until this happens.

- [ ] `npx wrangler d1 create pdfshush` → paste the id into `wrangler.jsonc`
- [ ] `npx wrangler d1 migrations apply pdfshush --remote`
- [ ] Add Google secrets + the AI key
- [ ] Set `GOOGLE_REDIRECT_URI` to `https://pdfshush.com/api/auth/callback`
      (and register the same URL in Google Cloud Console)
- [ ] `npx wrangler deploy` and test on the `workers.dev` URL first
- [ ] Sign in, save a workflow, delete the account — all three must work

**Done when:** sign-in works on `workers.dev` and the data survives a reload.

### Sprint 3 — Switch the website on

**Why:** the site is still built as "no server", so nothing new is visible.

- [ ] Split the site's one `serverDeployed` flag into per-feature capabilities
- [ ] Hide Workflows / API / MCP where the deployment says they are unavailable
- [ ] Build with `VITE_SERVER_API=on`
- [ ] Confirm the AI panel appears and the nav has Guides
- [ ] Point the domain at the Worker

**Done when:** a visitor can sign in and use the AI trial on the real domain.

### Sprint 4 — Payments (Dodo)

**Why:** this is the actual revenue, and it unlocks "no ads in Pro".

- [ ] Create the product in Dodo Payments ($6/mo, $48/yr)
- [ ] `POST /api/billing/checkout` → creates a Dodo session
- [ ] `POST /api/billing/webhook` → verify the signature, set `plan='pro'`
- [ ] Add `plan_expires_at` and a cron downgrade when it lapses
- [ ] Show "Manage subscription" on the account page
- [ ] Test with Dodo's sandbox mode end to end

**Done when:** paying flips the account to Pro within seconds, and cancelling
eventually flips it back.

### Sprint 5 — Ads

**Why:** a small floor under the free tier. Do it after payments, not before.

- [ ] Apply to AdSense once the 20 guides are live
- [ ] On approval: real publisher ID in `public/ads.txt`, verify with `curl`
- [ ] Configure the GDPR message in AdSense, copy its id
- [ ] Set `VITE_ADS_ENABLED=true`, `VITE_ADSENSE_CLIENT`, 4 slot ids, `VITE_ADSENSE_CMP_ID`
- [ ] Deploy, then verify with an EU VPN that the dialog appears **before** any ad
- [ ] Verify a Pro account loads no ad script at all

**Done when:** an EU visitor sees consent first, and declining leaves no ad
requests.

### Sprint 6 — Growth

**Why:** neither ads nor subscriptions matter without traffic.

- [ ] Add privacy-friendly analytics (no cookies, no banner)
- [ ] Publish 20 more guides around the queries that already get impressions
- [ ] Add internal links: tool → guide → guide → tool
- [ ] Measure: which pages convert to sign-in, which convert to Pro
- [ ] Kill the pages that get traffic and convert nobody

**Done when:** you can answer "which article earns money?" from data.

### Sprint 7 — Operational polish

**Why:** cheap now, expensive later.

- [ ] Uptime check on `/api/health` with an alert
- [ ] D1 backup/export weekly (accounts are the only irreplaceable data)
- [ ] Worker error alerting (`wrangler tail` is not monitoring)
- [ ] Add a test for the guide route's hook split and the AI meter rollover
- [ ] Document the "turn AI off" switch in the README

**Done when:** a failure pages you before a customer emails.

---

## 4. Suggested order

```
Sprint 1 (content)  ──►  Sprint 2 (deploy)  ──►  Sprint 3 (switch on)
                                                      │
                                                      ├──► Sprint 4 (payments)
                                                      └──► Sprint 5 (ads)
                                                                 │
                                                      Sprint 6 (growth)
                                                                 │
                                                      Sprint 7 (polish)
```

Sprint 1 and Sprint 2 can run in parallel: one is writing, one is accounts.

---

## 5. Rules we do not break

1. **No fake publisher ID, ever.** An empty `ads.txt` is honest; a made-up one is
   fraud.
2. **Pro never loads the ad script.** Not hidden — never fetched.
3. **Drafts never reach production.** The build enforces it, not discipline.
4. **The 51 tools never upload.** Only the AI panel does, and it says so.
5. **No secrets in the repo.** Keys go through `wrangler secret`.
6. **No dark patterns.** No fake download buttons, no ads next to a real one, no
   ad-blocker wall.

---

## 6. Useful commands

```bash
# website
pnpm --filter @pdfshush/web dev
pnpm --filter @pdfshush/web test
pnpm --filter @pdfshush/web build
pnpm --filter @pdfshush/web guides:status
pnpm --filter @pdfshush/web guides:check

# backend
pnpm --filter @pdfshush/edge typecheck
npx wrangler dev --port 8787 --local
npx wrangler deploy
npx wrangler tail
npx wrangler d1 execute pdfshush --remote --command "SELECT COUNT(*) FROM accounts"

# quality gates that must stay green
node scripts/seo-audit.mjs
node tests/bundle-boundary.mjs
```
