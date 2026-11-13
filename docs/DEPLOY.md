# Deploying PDFShush

The deployment runbook (PLAN.md §33.4, §33.9). It takes a GitHub repository and a domain to a
public HTTPS site that costs **nothing per month** and needs **no credit card**.

**Scope.** This deploys the **frontend only**: the React application, its 63 prerendered SEO
routes, the sitemap, `robots.txt`, the service worker and every static asset. The Express API,
the BullMQ worker, Redis and MongoDB stay in the repository and in `docker-compose.yml` for
local development, and are **not deployed**. §10 explains what that costs and what it buys back
later.

> **Current hosting target.** The deploy now runs on **Cloudflare Workers +
> Static Assets** from the repository (`wrangler.jsonc`, `npx wrangler deploy`).
> See [`DEPLOY-WORKERS.md`](./DEPLOY-WORKERS.md) for the current runbook. This
> document remains the Pages runbook and the reference for the frontend's
> content, SEO, caching and server-tier reasoning; where the two disagree about
> hosting mechanics (unknown-URL status, build variables, deploy command), the
> Workers guide wins.

---

## 1. The shape

```
GitHub (main)
  └── Cloudflare Pages (free plan, Git integration)
        ├── /                  → the app shell
        ├── /tools/<slug>      → 58 prerendered tool pages (real HTML, no JavaScript needed)
        ├── /workflows /trust /verify /account → prerendered
        ├── /sitemap.xml, /robots.txt, /404.html
        └── /assets/*          → content-hashed, immutable for a year
```

There is no server in this picture, and that is the point: **51 of the 58 tools run entirely in
the visitor's browser**. The file never leaves the tab, there is no upload, no account and no
quota. The site is static files on a CDN — the cheapest possible hosting for the product's
actual centre of gravity.

---

## 2. Accounts

| Account | Cost | Card? | What for |
| --- | --- | --- | --- |
| **Cloudflare** | free | no | Pages (hosting), DNS for the custom domain, free TLS |
| **GitHub** | free | no | The repository and the Pages Git integration |
| ~~Oracle Cloud~~ | — | ~~yes~~ | **Not used.** A VPS was the plan before 2026-11-13; it needed a card, and the worker still is not deployed. |
| ~~MongoDB Atlas~~ | free | no | **Not used yet** — accounts are not deployed in this shape. Create it when the server tier is. |
| ~~Google OAuth~~ | free | no | **Not used yet** — sign-in belongs to the server tier. |

The Cloudflare free plan includes Pages with unlimited static bandwidth, 500 builds a month, a
20-minute build limit and free TLS certificates.

---

## 3. Create the Pages project

1. Sign in at <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**.
2. Authorise GitHub, pick the `pdfshush` repository, and **Save and Deploy**.
   The first build uses the defaults and will fail — that is expected, and the next step fixes it.
3. Open the project → **Settings** → **Build & deployments** → **Build settings** → **Edit**:

   | Setting | Value |
   | --- | --- |
   | Framework preset | **None** |
   | Build command | `pnpm --filter @pdfshush/web build` |
   | Build output directory | `apps/web/dist` |
   | Root directory | *(repository root — leave empty)* |
   | Install command | `pnpm install --frozen-lockfile` |
   | Node version | **24** (also set by the `.node-version` file) |

4. Same page → **Environment variables** → **Add**:

   | Variable | Value | Scope | Why |
   | --- | --- | --- | --- |
   | `VITE_SITE_ORIGIN` | `https://pdfshush.space` | Production + Preview | Canonical URLs, Open Graph cards, `sitemap.xml` and `robots.txt` are **baked into the HTML at build time**. |
   | `VITE_SERVER_API` | `off` | Production + Preview | Tells the app the server is not deployed here. See §4. |
   | `NODE_VERSION` | `24` | Production + Preview | Belt and braces; `.node-version` covers it. |

   `VITE_SITE_ORIGIN` must be **plain text**, not secret. Cloudflare encrypts variables whose name
   starts with `CF_`; everything else is visible to anyone who can read the build settings.

5. **Save and Deploy** again. The build log should end with:

   ```
   [plugin pdfshush-prerender] prerendered 63 routes, 55 in the sitemap (origin https://pdfshush.space, 22 top-level entries)
   ```

   63 routes = 58 tool pages + `/` + `/workflows` + `/trust` + `/verify` + `/account`.

### The install command and pnpm

`package.json` pins `packageManager: pnpm@12.11.2`, and Pages' build image honours it through
corepack, so the container installs the exact pnpm the lockfile expects. `pnpm install
--frozen-lockfile` fails loudly if the lockfile and the manifests ever disagree, which is the
point.

---

## 4. Why `VITE_SERVER_API=off`

The app ships in two shapes, decided at build time (`apps/web/src/lib/deployment.ts`):

- **`server`** (the default) — the SPA, the API, the worker and Redis are deployed together.
  Accounts, workflow recipes, the REST API, the MCP server and the managed-AI trial all work.
- **`frontend`** — the SPA alone. The API is not deployed, so those features have nothing to talk
  to.

The switch is build-time on purpose. A static host has no `/api` to ask, so a runtime probe would
cost every page load a failed request and still only guess: *"the API did not answer"* and
*"there is no API"* are the same observation. The deployment knows which one it is, so the build
records it.

With the switch off the app does not pretend. It never asks for `/api` (so the browser console
stays clean), and it removes the controls that could only fail:

| Surface | What it does instead |
| --- | --- |
| Header "Sign in" | Not rendered. |
| `/account` | "This deployment ships the browser tools only — the PDFShush server is not deployed here." |
| `/workflows` | An explicit notice that recipes run on the server; the step picker and **Run workflow** are disabled. |
| Managed-AI trial | The tab stays disabled with "Not offered by this deployment". BYOK AI still works — it talks to the provider from the browser. |
| `/tools/api`, `/tools/mcp` | The reference is still published; the live slug list and the OpenAPI link are replaced by a sentence saying the server is not deployed. |
| Any `api()` call | Rejects immediately with `server_unavailable` and a sentence, before touching the network. |

What is **not** disabled: all 51 browser tools, the editor, redaction, OCR, the service worker,
the offline mode, and every page of the catalog.

---

## 5. The custom domain

The domain's nameservers must already point at Cloudflare for the simplest path.

1. Project → **Custom domains** → **Set up a domain** → enter `pdfshush.space` → **Continue**.
2. Because the zone is on Cloudflare, Pages creates the DNS record itself and issues the
   certificate. Nothing to paste.
3. Wait for **Active**. The certificate takes a few minutes; the first request may briefly fail
   while it issues.

If the domain is *not* on Cloudflare, Pages tells you to add a `CNAME` to
`<project-name>.pages.dev` and to verify ownership with a TXT record.

Do not add a `www` hostname unless you want one: two hostnames for the same site split the SEO
signals and the canonical URLs. If you do add it, point it at the apex with a **Redirect Rule**
(Cloudflare → **Rules** → **Redirect Rules**) rather than a second Pages hostname.

**Fallback:** if the domain is not ready, the project is already live at
`https://<project-name>.pages.dev`. Build the preview first and switch the domain later; only
`VITE_SITE_ORIGIN` has to change, and it needs a rebuild.

---

## 6. What Pages serves, and how to check it

| Path | Served as | Status |
| --- | --- | --- |
| `/` | `dist/index.html` | 200 |
| `/tools/merge-pdf` | `dist/tools/merge-pdf/index.html` (prerendered HTML) | 200 |
| `/sitemap.xml`, `/robots.txt` | the generated files | 200 |
| `/assets/*` | hashed files, `Cache-Control: public, max-age=31536000, immutable` | 200 |
| `/sw.js`, `manifest.webmanifest` | `Cache-Control: public, max-age=0, must-revalidate` | 200 |
| `/api/anything` | the `404.html` document | **404** |
| `/anything-unknown` | the `404.html` document | **404** |

The `404.html` document is generated by the build (`apps/web/build/prerender.ts`). Without it,
Pages would answer an unknown URL with the app shell and a **200** — a soft 404 that tells a
crawler the page exists. With it, the status is honest.

The cache rules live in `apps/web/public/_headers`, which Vite copies into the build output and
Pages applies. There is deliberately **no `/*` cache rule**: Pages joins the headers of every
matching rule, so a catch-all would also apply to `/assets/*` and turn "immutable" into
"immutable, no-cache".

---

## 7. Verify the deployment

From any machine:

```bash
# 1. The site answers over TLS.
curl -sI https://pdfshush.space | head -1                 # HTTP/2 200

# 2. A prerendered tool page is real HTML, not an empty shell.
curl -fsS https://pdfshush.space/tools/merge-pdf | grep -o '<h1[^>]*>[^<]*</h1>'
#    -> <h1>Merge PDF files</h1>
curl -fsS https://pdfshush.space/tools/merge-pdf | grep -o '<link rel="canonical"[^>]*>'
#    -> <link rel="canonical" href="https://pdfshush.space/tools/merge-pdf" />

# 3. The SEO files exist and point at the right origin.
curl -fsS https://pdfshush.space/sitemap.xml | head -3
curl -fsS https://pdfshush.space/robots.txt

# 4. An unknown URL is a real 404, not a 200 with a 404 page.
curl -s -o /dev/null -w '%{http_code}\n' https://pdfshush.space/no-such-page   # 404

# 5. Assets are immutable; the shell is not.
curl -sI https://pdfshush.space/assets/$(ls apps/web/dist/assets | head -1) | grep -i cache-control
curl -sI https://pdfshush.space/sw.js | grep -i cache-control
```

Then the browser suites against the live URL:

```bash
pnpm install
E2E_BASE_URL=https://pdfshush.space pnpm test:e2e
```

The shared preflight (`tests/support/preflight.mjs`) reads `E2E_BASE_URL`: it checks that origin
and **skips the local compose assertions**, because a running local stack says nothing about the
deployment under test.

The suites are written for exactly this shape. The workflow section of the smoke run detects that
`/api/tools` is unreachable, skips the server-only steps, and says so in its output; the
console-health section tolerates the failed resource loads that the offline posture causes. A
suite that silently passed against a broken backend would be a worse outcome than a skip that
says which dependency was missing.

---

## 8. Continuous deployment

The Pages **Git integration** is the deployment pipeline: every push to `main` builds and
publishes, every pull request gets a preview URL, and every commit to a branch gets its own
preview. Nothing else to configure, no secrets in GitHub, no card.

The existing CI (`.github/workflows/ci.yml`) is unchanged and still runs on every push:
typecheck, the unit suites, a production build, the bundle boundary and the performance/a11y
gates. Pages builds from the same commit, so a green CI run is the precondition for a green
deployment.

**Optional: pull-request previews via the API.** The Git integration already provides them. If you
would rather drive the deployment from Actions, add `.github/workflows/pages.yml`:

```yaml
name: pages
on:
  push:
    branches: [main]
  pull_request:
concurrency:
  group: pages-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
        env:
          VITE_SITE_ORIGIN: https://pdfshush.space
          VITE_SERVER_API: 'off'
      - run: pnpm test:bundle
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy apps/web/dist --project-name=pdfshush --branch=${{ github.ref_name }}
```

This needs two secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and a free API token
from the Cloudflare dashboard. **Do not enable it alongside the Git integration** — two pipelines
publishing to one project race each other. Pick one: the Git integration (no secrets, one click)
or Actions (full control, two secrets).

---

## 9. Day-2 operations

| Task | Where |
| --- | --- |
| Ship a change | Push to `main`; Pages builds and publishes. |
| Roll back | Pages → **Deployments** → pick the previous production build → **Rollback to this deployment**. |
| Rebuild without a code change | Deployments → the build → **Retry deployment**. |
| Purge the cache | Caching → **Configuration** → **Purge Everything**. Rarely needed: hashed assets cannot be stale. |
| Rotate a build variable | Settings → Environment variables → edit → **Save and Deploy**. |
| Check a build log | Deployments → the build → **View build**. |

The build is reproducible from the commit, so a rollback is a click rather than a procedure.

---

## 10. The server tier, parked

The Express API, the BullMQ worker, Redis and MongoDB are unchanged in this repository, and
`docker-compose.yml` still runs them locally:

```bash
pnpm stack:up          # redis + api + worker on :8080
pnpm dev               # the web app on :5173 with the API proxied
```

What a deployed server tier would add: accounts, synced history, workflow recipes, the public
REST API (`/api/v1`), the MCP server's backend, and the managed-AI trial. It needs a host that
runs a persistent Node process and a real queue — a VPS, a container host, or a paid platform —
which is a hosting decision, not a code one.

When it comes, the work is small because nothing here has to change: the app already reads
`VITE_SERVER_API`, so the *same source* produces both shapes. Set the variable to `on`, deploy
the API and the worker next to it, and the account, workflow and API surfaces come back.

The honest cost of not having it yet: **no accounts, no workflow recipes, no REST API, no MCP
server and no managed-AI trial.** Nothing that runs in the browser is affected, and the site says
so where it matters rather than showing controls that would fail.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Build fails at `pnpm install` | The lockfile and the manifests disagree | Run `pnpm install` locally, commit the lockfile change. |
| Build fails at `tsc --noEmit` | A type error | `pnpm typecheck` locally — the Pages build runs the same command. |
| Canonical URLs point at `pdfshush.app` | `VITE_SITE_ORIGIN` is unset or wrong | Set it in the Pages environment variables and rebuild. It is baked in at build time. |
| The page still offers sign-in / workflows | `VITE_SERVER_API` is not `off` | Set it to exactly `off` and rebuild. |
| `/tools/merge-pdf` 404s | The output directory is wrong | It must be `apps/web/dist`, not `dist`. |
| The page loads but shows an empty shell | The JavaScript did not load | Check the build log for the asset paths; the `index.html` must reference `/assets/...`. |
| An unknown URL returns 200 | `404.html` is missing from the output | The build writes it — check `dist/404.html` exists. |
| Assets are not cached | `_headers` was not copied | It must live in `apps/web/public/_headers` so Vite copies it into the output. |
| A preview build has the wrong origin | Preview builds inherit the variable | Both Production and Preview scopes are set to the same origin. |

---

## 12. Not covered here

- **Billing, entitlements, the pricing page, ads** — M6.3–M6.6. The live site must not advertise
  any of them (§33.6).
- **R2 / text-preserving redaction** — deliberately frozen until R1's raster-first redaction has
  been verified in production (§20.3).
- **The server tier** — §10.
