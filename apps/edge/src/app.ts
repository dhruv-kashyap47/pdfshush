/**
 * The HTTP surface, separated from the Worker entry point so tests can call
 * `app.fetch()` directly with a binding-shaped environment: no `workerd`, no
 * network, no asset router.
 *
 * `index.ts` owns the two jobs the Worker itself does — split `/api` from the
 * static assets, and run the cron housekeeping.
 */

import { Hono } from 'hono';
import type { AppEnv } from './app-env.js';
import { fail } from './lib/http.js';
import { accountRoutes } from './routes/account.js';
import { aiRoutes } from './routes/ai.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { metaRoutes } from './routes/meta.js';
import { sponsorRoutes } from './routes/sponsors.js';

export const app = new Hono<AppEnv>();

// Registered before the gate table in `metaRoutes`, which owns the catch-all
// `/api/jobs/*`, `/api/v1/*` and friends. `/api/ai/chat` is a real route now.
app.route('/', aiRoutes);
app.route('/', metaRoutes);
app.route('/', authRoutes);
app.route('/', accountRoutes);
app.route('/', sponsorRoutes);
app.route('/', billingRoutes);

app.notFound((c) => fail(c, 404, 'not_found', 'No such endpoint.'));
app.onError((error, c) => {
  // The message can quote a request or a row; the log keeps it, the client does
  // not need it.
  console.error('unhandled error', error);
  return fail(c, 500, 'internal', 'Something went wrong on the server.');
});
