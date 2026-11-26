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
 *
 * The routes themselves live in `app.ts`, so tests can call them directly with a
 * binding-shaped environment and no runtime.
 */

import type { Env, ExecutionContextLike } from './env.js';
import { D1AuthStore } from './db/auth-store.js';
import { D1BillingStore } from './db/billing-store.js';
import { D1SponsorStore } from './db/sponsor-store.js';
import { downgradeLapsed } from './billing/entitlements.js';
import { app } from './app.js';

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
        const [auth, sponsors, drafts, events, accounts] = await Promise.all([
          new D1AuthStore(env.DB).purgeExpired(now),
          new D1SponsorStore(env.DB).expireDue(),
          new D1SponsorStore(env.DB).purgeDrafts(),
          new D1BillingStore(env.DB).purgeEvents(),
          downgradeLapsed(env.DB, now),
          env.DB.prepare(`DELETE FROM quota_counters WHERE expires_at <= ?`).bind(now).run(),
        ]);
        console.log('purged expired rows', { auth, sponsors, drafts, events, accounts });
      })().catch((error: unknown) => console.error('purge failed', error)),
    );
  },
};
