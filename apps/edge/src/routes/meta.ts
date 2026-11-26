/**
 * Deployment-shape and capability endpoints, plus the surfaces this shape
 * deliberately does not run.
 *
 * `/api/tools` matters more than it looks: the SPA reads `accounts.enabled` from
 * it before it renders a Sign in control, and `ai.enabled` before it offers the
 * managed AI trial (`apps/web/src/lib/ai/managed.ts`). An absent or failing
 * `/api/tools` is treated as "maybe", so this route must answer.
 *
 * The blocked surfaces are the capability gate expressed at the HTTP layer: the
 * code for server-side execution and the public API still exists in `apps/api`,
 * and the self-host shape still runs it. Here it answers 503 with a stable code,
 * which is exactly what `v1/routes.ts` already did when accounts were disabled.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../app-env.js';
import type { Env } from '../env.js';
import { googleConfig } from '../auth/oidc.js';
import { managedAiConfig } from '../ai/config.js';
import { AI_LIMITS } from '../ai/budget.js';
import { fail } from '../lib/http.js';

export const metaRoutes = new Hono<AppEnv>();

/** What this deployment can do. The SPA's capability split reads this. */
export function capabilities(env: Env) {
  return {
    shape: 'free' as const,
    accounts: true,
    // Server-side PDF execution needs CPU the free plan does not have (10 ms per
    // invocation) and a canvas workerd does not provide. Every tool runs in the
    // browser instead, which is the product's actual claim.
    serverJobs: false,
    workflows: false,
    publicApi: false,
    mcp: false,
    managedAi: managedAiConfig(env) !== undefined,
  };
}

metaRoutes.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    shape: 'free',
    database: 'ok',
    serverJobs: false,
    managedAi: managedAiConfig(c.env) !== undefined,
    time: new Date().toISOString(),
  }),
);

metaRoutes.get('/api/capabilities', (c) => c.json(capabilities(c.env)));

metaRoutes.get('/api/tools', (c) => {
  const caps = capabilities(c.env);
  return c.json({
    // `SERVER_SLUGS` is the set of slugs this deployment can execute on the
    // server. On the free shape that set is empty on purpose.
    slugs: [],
    maxUploadBytes: 0,
    quota: { tasksPerMinute: 0, tasksPerDay: 0 },
    ai: {
      enabled: caps.managedAi,
      // Published so a pricing page or an upgrade prompt can state the numbers
      // without hard-coding them in the client.
      limits: {
        anonymousPerDay: AI_LIMITS.anonymousPerDay,
        proPerMonth: AI_LIMITS.proPerMonth,
      },
    },
    // Sign-in is advertised only when Google is actually configured, so the SPA
    // never renders a button that lands on a 503.
    accounts: { enabled: googleConfig(c.env) !== undefined },
    capabilities: caps,
  });
});

metaRoutes.get('/api/quota', (c) =>
  c.json({
    // Anonymous server-side processing does not exist here; the browser is the
    // processor. Reported as zero rather than 404 so an older SPA renders a
    // number instead of an error.
    tasksPerMinute: 0,
    tasksPerDay: 0,
    bytesPerDay: 0,
  }),
);

/* ------------------------------------------------------- gated surfaces */

const gated = (code: string, message: string) => (c: Context<AppEnv>) => {
  c.header('cache-control', 'no-store');
  return fail(c, 503, code, message);
};

const noServerJobs = gated(
  'server_execution_disabled',
  'This deployment runs every tool in your browser, so there is no server-side job queue. ' +
    'Open the tool itself instead — no upload is needed.',
);

const noPublicApi = gated(
  'api_disabled',
  'The public REST API is not enabled on this deployment. Self-hosted deployments expose it at /api/v1.',
);

const noMcp = gated(
  'mcp_disabled',
  'The MCP bridge needs a server-side worker. It is available on self-hosted deployments.',
);

/**
 * Both the bare path and its subtree: a request to `/api/jobs/x` must not fall
 * through to the SPA shell and come back as HTML with a 200.
 *
 * Note there is no `/api/ai/*` gate any more — that route is real now, and it
 * answers its own 503 when the deployment has no managed key.
 */
for (const path of ['/api/jobs', '/api/jobs/*']) metaRoutes.all(path, noServerJobs);
for (const path of ['/api/v1', '/api/v1/*']) metaRoutes.all(path, noPublicApi);
for (const path of ['/api/mcp', '/api/mcp/*']) metaRoutes.all(path, noMcp);
// API keys exist to authenticate the public API, which is gated above.
for (const path of ['/api/keys', '/api/keys/*']) metaRoutes.all(path, noPublicApi);
