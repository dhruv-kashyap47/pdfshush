/**
 * Dedicated worker entry point.
 *
 * Kept separate from `host.ts` on purpose: the API bundle inlines that module,
 * and a top-level "am I the entry file?" check inside it compared
 * `import.meta.url` with `process.argv[1]` -- which match in `dist/server.js`
 * too, so the API silently started a second, unbounded worker in production.
 * Nothing that is imported may start a worker; only this file does.
 */

import { startWorkerHost } from './host.js';

startWorkerHost().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('worker host failed to start:', error);
  process.exit(1);
});
