/**
 * The only Worker script in this repository.
 *
 * Its entire job is a 404 fence around `/api/*`. The deployed product is the
 * static frontend: the Express API is not part of this Worker or this deploy.
 * Without this fence the Static Assets SPA fallback would answer `/api/health`
 * with `index.html` and a 200, which tells an API client that a missing server
 * route exists and gives it HTML to parse as JSON.
 *
 * Everything else never reaches this code: `wrangler.jsonc` scopes it with
 * `assets.run_worker_first` to `/api` and its case variants, so normal
 * navigation (`/tools/merge-pdf`, `/account`, deep links into client-only
 * routes) keeps the asset-first routing and the documented SPA fallback.
 *
 * The `env.ASSETS` fallback is kept as a safety net if that scoping changes; it
 * applies the same HTML handling and `not_found_handling` as an asset-first
 * request. Custom `_headers` rules do not apply to responses generated here, so
 * the API 404 carries the same security headers explicitly.
 */

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    // Express matches routes case-insensitively by default, so `/API/health`
    // and `/api/health` are the same endpoint on the server shape. Compare the
    // same way here: Cloudflare's `run_worker_first` patterns are
    // case-sensitive, so `wrangler.jsonc` lists every spelling of the prefix,
    // and this test must not let a matched variant fall through to the shell.
    const path = pathname.toLowerCase();

    if (path === '/api' || path.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'X-Frame-Options': 'DENY',
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};