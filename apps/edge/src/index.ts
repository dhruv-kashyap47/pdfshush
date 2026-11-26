/**
 * The Worker entry point.
 *
 * One script does two jobs:
 *   - `/api/*` is the Hono app (accounts, capabilities, gated surfaces);
 *   - everything else is a static asset, served by the ASSETS binding, which is
 *     free and unlimited on every plan.
 *
 * Splitting them here rather than in `wrangler.jsonc` alone is what keeps an
 * unknown `/api/...` path from falling through to the SPA shell and returning
 * HTML with a 200. The static router is never consulted for API paths, so the
 * same origin serves both without a rewrite rule.
 */

import { Hono } from 'hono';
import type { AppEnv } from './app-env.js';
import type { Env, ExecutionContextLike } from './env.js';
import { D1AuthStore } from './db/auth-store.js';
import { fail } from './lib/http.js';
import { accountRoutes } from './routes/account.js';
import { aiRoutes } from './routes/ai.js';
import { authRoutes } from './routes/auth.js';
import { metaRoutes } from './routes/meta.js';

const app = new Hono<AppEnv>();

// Registered before the gate table in `metaRoutes`, which owns the catch-all
// `/api/jobs/*`, `/api/v1/*` and friends. `/api/ai/chat` is a real route now.
app.route('/', aiRoutes);
app.route('/', metaRoutes);
app.route('/', authRoutes);
app.route('/', accountRoutes);

app.notFound((c) => fail(c, 404, 'not_found', 'No such endpoint.'));
app.onError((error, c) => {
  // The message can quote a request or a row; the log keeps it, the client does
  // not need it.
  console.error('unhandled error', error);
  return fail(c, 500, 'internal', 'Something went wrong on the server.');
});

/** `/api`, `/api/`, `/API/health` — the eight spellings the asset router sees. */
function isApiPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return lower === '/api' || lower.startsWith('/api/');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!isApiPath(pathname)) return env.ASSETS.fetch(request);
    return app.fetch(request, env, ctx);
  },

  /**
   * Housekeeping, not correctness: every query already filters on `expires_at`,
   * so an unswept row is inert. This only keeps storage bounded.
   */
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContextLike): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const now = Date.now();
        const [auth] = await Promise.all([
          new D1AuthStore(env.DB).purgeExpired(now),
          env.DB.prepare(`DELETE FROM quota_counters WHERE expires_at <= ?`).bind(now).run(),
        ]);
        console.log('purged expired rows', auth);
      })().catch((error: unknown) => console.error('purge failed', error)),
    );
  },
};
