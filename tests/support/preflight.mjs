/**
 * Preflight shared by `pnpm test:sweep` and the `pnpm test:e2e:*` entries.
 *
 * The site is Cloudflare-shaped: the web app is the product, and the Worker on
 * :8787 only adds sign-in, sync, the managed-AI trial and billing. Every PDF
 * tool runs in the browser, so a missing Worker must not fail a tool suite.
 *
 * This checks only that the web app answers, and prints an honest note when the
 * Worker is not running. It never starts anything.
 *
 * Usage: `node tests/support/preflight.mjs` -- exits non-zero only when the web
 * app itself is unreachable.
 */

import { pathToFileURL } from 'node:url';

/**
 * A remote origin (any deployed build) checks the public URL only. Local runs
 * check the Vite dev server and the local `wrangler dev` Worker separately.
 */
const REMOTE = process.env.E2E_BASE_URL?.replace(/\/$/, '');

const WEB = REMOTE ?? 'http://localhost:5173';
const API = REMOTE ?? 'http://localhost:8787';

async function reachable(url) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(5_000) });
  } catch {
    return undefined;
  }
}

export async function preflight({ log = console.log } = {}) {
  const problems = [];

  const web = await reachable(WEB);
  if (!web) {
    problems.push(
      REMOTE
        ? `the deployed app at ${WEB} did not answer -- check the custom domain and the Worker (docs/DEPLOY-WORKERS.md)`
        : `the web app at ${WEB} is down -- start it first:  pnpm dev`,
    );
  }

  const api = await reachable(`${API}/api/health`);
  if (!api) {
    log(
      REMOTE
        ? `note: ${API}/api/health did not answer -- server-backed steps (accounts, sync, managed AI) will be skipped`
        : `note: no Worker on ${API} -- server-backed steps (accounts, sync, managed AI) will be skipped. Start it with:  pnpm dev:edge`,
    );
  } else if (api.status === 404) {
    log(
      'note: no API on this origin -- a frontend-only deployment (accounts, workflows and the REST API are switched off)',
    );
  } else if (!api.ok) {
    log(`note: ${API}/api/health answered ${api.status} -- the server-backed steps will be skipped`);
  }

  if (problems.length > 0) {
    for (const problem of problems) log(`[preflight] ${problem}`);
    return false;
  }
  log(
    REMOTE
      ? `preflight: ${REMOTE} reachable (remote origin)`
      : 'preflight: web reachable' + (api?.ok ? ', Worker reachable' : ''),
  );
  return true;
}

/* Run directly from the npm script wiring. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ok = await preflight();
  process.exit(ok ? 0 : 1);
}
