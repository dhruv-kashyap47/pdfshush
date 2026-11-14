# Deploying the frontend on Cloudflare Workers

The current production target: **Workers + Static Assets**, frontend only. The
configuration lives in the repository root (`wrangler.jsonc`), so the deploy is
the same command on a laptop and in CI.

This supersedes the Cloudflare Pages steps in [`DEPLOY.md`](./DEPLOY.md) for the
hosting layer. The scope is unchanged: the React app, its prerendered routes,
the service worker and every static asset. The Express API, the BullMQ worker,
Redis and MongoDB are **not** deployed and are untouched.

```
apps/web/dist  ->  wrangler.jsonc  ->  Cloudflare Workers (static assets)
                                        └── /api, /api/*  ->  404 (tiny Worker script)
```

One small Worker script (`infra/cloudflare/api-404.js`) exists only to return a
real 404 for `/api/*`; `assets.run_worker_first` scopes it to those paths, so
everything else keeps asset-first routing. Nothing in `apps/api`, `apps/worker`
or `docker-compose.yml` is read or uploaded, and `pnpm stack:up` still brings up
the local server stack.

---

## 1. One-time setup

```bash
pnpm install
npx wrangler login        # opens the browser; writes a local OAuth token
npx wrangler whoami       # confirms the account and the token
```

For CI, skip `login` and set `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit) and
`CLOUDFLARE_ACCOUNT_ID` in the environment instead.

Wrangler is run through `npx`; it is deliberately not a package dependency, so
the repository does not gain a second toolchain.

---

## 2. Build

```bash
pnpm --filter @pdfshush/web build
```

The build reads `apps/web/.env.production`, which is committed and contains:

| Variable | Value | Effect |
| --- | --- | --- |
| `VITE_SITE_ORIGIN` | `https://pdfshush.space` | Canonical links, Open Graph, `sitemap.xml`, `robots.txt` |
| `VITE_SERVER_API` | `off` | Frontend shape: no sign-in, no workflow runner, no `/api` calls |

Both are public and baked into the HTML. A shell or CI variable of the same
name wins over the file, which is how a self-hoster points at another origin.

The build should end with the prerender summary and produce, at minimum:

```text
apps/web/dist/index.html
apps/web/dist/tools/merge-pdf.html      # flat file, not tools/merge-pdf/index.html
apps/web/dist/sw.js
apps/web/dist/tessdata/eng.traineddata.gz
apps/web/dist/sitemap.xml
apps/web/dist/robots.txt
apps/web/dist/404.html                  # generated, but not served by the SPA fallback
apps/web/dist/_headers
```

---

## 3. Preview locally, before publishing

```bash
npx wrangler dev          # http://localhost:8787, same asset router as production
```

Then, in another shell:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/                     # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/tools/merge-pdf      # 200
curl -s http://localhost:8787/tools/merge-pdf | grep -o '<h1[^>]*>[^<]*</h1>'       # real prerendered HTML
curl -sI http://localhost:8787/assets/$(ls apps/web/dist/assets | head -1) | grep -i cache-control
curl -sI http://localhost:8787/sw.js | grep -i cache-control
curl -sI http://localhost:8787/ | grep -i cache-control        # ... must-revalidate, no-transform
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/no-such-page         # 200 (SPA shell)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/api/health           # 404 (JSON)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/API/health           # 404 (case-insensitive)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/api                  # 404 (JSON)
```

`npx wrangler dev` serves the local build; it does not rebuild. Re-run the build
after any source change.

---

## 4. Deploy

```bash
npx wrangler deploy
```

The command uploads the current `apps/web/dist` and prints the public URL
(`https://pdfshush.<account-subdomain>.workers.dev`) plus the version ID. It
does **not** build: deploying without running step 2 publishes whatever is
already in `dist`, so treat the build as part of the deploy.

---

## 5. Verify the deployment

```bash
BASE=https://pdfshush.space

curl -sI "$BASE" | head -1                                       # 200
curl -s "$BASE/tools/merge-pdf" | grep -o '<h1[^>]*>[^<]*</h1>'  # <h1>Merge PDF files</h1>
curl -s "$BASE/tools/merge-pdf" | grep -o '<link rel="canonical"[^>]*>'
curl -s "$BASE/sitemap.xml" | head -3
curl -s "$BASE/robots.txt"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/no-such-page"    # 200 (see below)
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/health"      # 404
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/API/health"      # 404
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api"             # 404
curl -s "$BASE/api/health"                                        # {"error":"not_found"}
curl -sI "$BASE/assets/$(ls apps/web/dist/assets | head -1)" | grep -i cache-control
curl -sI "$BASE/sw.js" | grep -i cache-control
```

Then, against the same origin:

```bash
E2E_BASE_URL="$BASE" pnpm test:e2e
E2E_BASE_URL="$BASE" pnpm test:e2e:reach
E2E_BASE_URL="$BASE" pnpm test:e2e:offline
```

`tests/support/preflight.mjs` reads `E2E_BASE_URL` and skips the local compose
assertions, which is what makes the suites meaningful against a static host.

In a browser, also check the things curl cannot: open a tool and process a
file, install the PWA, reload it offline, and confirm there is **no** "Sign in"
control and no failed `/api/*` request in the console.

---

## 6. What changed from the Pages behaviour

| Topic | Pages runbook | Workers Static Assets |
| --- | --- | --- |
| Deploy | Git integration or `wrangler pages deploy` | `npx wrangler deploy` |
| Configuration | dashboard build settings | `wrangler.jsonc` in the repository |
| Build variables | dashboard environment variables | `apps/web/.env.production` (or shell env) |
| Unknown frontend URL | `404.html` with **404** | `/index.html` with **200** (SPA fallback) |
| Unknown `/api/*` URL | `404.html` with **404** | JSON **404** from the Worker fence |
| `_headers` | supported | supported |
| `_redirects` | supported | supported (not applied to Worker-generated responses) |

### Unknown URLs: SPA fallback plus an API fence

`not_found_handling: "single-page-application"` makes deep links work without a
server: an unmatched frontend path returns the app shell with status 200, and
React's router renders the in-app "page not found" view. That is still a soft
404 for crawlers, and it is the documented behaviour for `/no-such-page`,
`/account`, and any client-only route.

`/api` and `/api/*` are deliberately excluded. `run_worker_first` sends exactly
those paths to `infra/cloudflare/api-404.js`, which answers:

```http
HTTP/1.1 404 Not Found
Content-Type: application/json; charset=utf-8
Cache-Control: no-store

{"error":"not_found"}
```

Cloudflare matches `run_worker_first` patterns case-sensitively while Express
does not, so `wrangler.jsonc` lists all eight spellings of `api` (`/api`, `/Api`,
`/API`, …) and the Worker compares the lowercased path. `/API/health` is
therefore a 404 too, not a 200 shell for a misspelled endpoint.

This is not a server: there is no routing table, no auth, and no PDF work in the
Worker. It exists so a static deployment does not lie to API clients with a 200
and an HTML body. A path outside the fence still gets the shell:

| Request | Result |
| --- | --- |
| `/tools/merge-pdf` | 200, prerendered HTML |
| `/account`, `/workflows`, `/trust` | 200, prerendered HTML |
| `/no-such-page` | 200, `index.html` (in-app not-found) |
| `/api`, `/api/health`, `/API/health`, `/api/anything` | 404, JSON |

`dist/404.html` is still generated, but Static Assets only serves it when
`not_found_handling` is `"404-page"`. Switching to that would break the SPA deep
links above, so it stays unused.

### Flat prerendered files

The prerender plugin writes `dist/<route>.html`, not `<route>/index.html`.
`html_handling: "auto-trailing-slash"` serves those files at the extensionless
canonical URL and redirects `/foo.html` to `/foo`. Do not switch to
`"force-trailing-slash"`; it would make every prerendered route unreachable at
its canonical URL.

---

## 7. Custom domain

1. **Workers & Pages** → `pdfshush` → **Settings** → **Domains & Routes** →
   **Add** → **Custom domain** → `pdfshush.space`.
2. If the zone is on Cloudflare, the DNS record and certificate are created
   automatically. Wait for **Active**.
3. A `www` hostname should be a Redirect Rule to the apex, not a second Worker
   custom domain, so canonical URLs and SEO signals stay on one host.

Remove or detach any Pages project still attached to the same hostname first;
two deployments competing for one DNS name is an outage waiting to happen.

---

## 8. Continuous deployment (optional, not configured)

The existing `.github/workflows/ci.yml` already builds on every push and pull
request. To publish from CI as well, add a workflow step after the build:

```yaml
- uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    command: deploy
```

This repository does not contain that step or those secrets today; deploys are
manual until it is added.

---

## 9. Rollback

```bash
npx wrangler deployments list
npx wrangler rollback <version-id>
```

Static assets are versioned with the Worker deployment, and every hashed asset
URL is immutable, so a rollback also restores the exact chunk set the previous
HTML references.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `wrangler deploy` uploads an old site | `dist` was not rebuilt | Run the build first; the deploy does not build. |
| Canonical URLs show `pdfshush.app` or `localhost` | `VITE_SITE_ORIGIN` was overridden or the build ran in dev mode | Rebuild with `pnpm --filter @pdfshush/web build` and check `dist/trust.html`. |
| The live site still offers sign-in | `VITE_SERVER_API` is not exactly `off` | Check the effective environment and rebuild. |
| `/tools/merge-pdf` 404s or redirects oddly | `html_handling` changed | Keep `"auto-trailing-slash"`. |
| `/api/health` or `/API/health` returns the HTML shell | `run_worker_first` is missing or no longer covers every case spelling of the prefix | Restore the full `run_worker_first` list from `wrangler.jsonc`; the Worker lowercases before comparing. |
| Security headers missing | `_headers` did not reach `dist` | Confirm `apps/web/dist/_headers` exists before deploying. Custom headers apply to static asset responses; the API 404 sets its own headers in `infra/cloudflare/api-404.js`. |
| Assets are not cached for a year | The request did not match `/assets/*` | Check the URL; only hashed build assets are meant to be immutable. |
| Console shows `static.cloudflareinsights.com/beacon.min.js` blocked by CSP | Cloudflare injected its Web Analytics beacon into the HTML | The `/*` rule in `_headers` sets `no-transform` so the rewrite cannot happen; confirm the live `/` response carries it (`curl -sI https://pdfshush.space/ \| grep -i cache-control`). If it does and the beacon is still injected, Web Analytics is on for the zone: turn it off in **Analytics → Web Analytics**. Do not widen `script-src` ([`edge-headers.test.ts`](../apps/web/src/lib/edge-headers.test.ts) pins that). |
| HTML arrives uncompressed | Expected: `no-transform` disables Cloudflare's HTML compression | Hashed assets are detached from that rule, so JS/CSS still compress. The documents are ~16 kB. |

---

## 11. What is deliberately not covered

Uploading the Express API, the BullMQ worker, Redis or MongoDB (they remain a
local `docker compose` stack), managed AI (needs the server), and accounts
(also server-side). See [`DEPLOY.md`](./DEPLOY.md) §10 for that parked tier.