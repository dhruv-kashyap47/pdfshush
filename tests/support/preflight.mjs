/**
 * Preflight shared by `pnpm test:sweep` and the `pnpm test:e2e:*` entries.
 *
 * These suites assume a running stack but historically failed with generic
 * messages from deep inside the drive scripts, so the wiring in package.json
 * runs this check first. It verifies only: the web app answers on 5173, the
 * API answers on 8080, and -- when a compose stack is in play -- every
 * compose container is actually running. It never starts anything: on
 * failure it says precisely what is down and the command to bring it up.
 *
 * Usage: `node tests/support/preflight.mjs` -- run before the suite; exits
 * non-zero and prints the fix when the stack is not reachable.
 */

import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const WEB = 'http://localhost:5173';
const API = 'http://localhost:8080';

async function composing() {
  try {
    await access('docker-compose.yml');
    return 'docker-compose.yml';
  } catch {
    return undefined;
  }
}

/**
 * The runtime `docker compose ps` sees (containers created for *this*
 * project). An empty list is fine: it just means the stack runs without
 * compose, e.g. a system Redis, and the web/API checks above already
 * covered what the suites depend on.
 */
function composeServices() {
  const result = spawnSync('docker', ['compose', 'ps', '--format', 'json', '--all'], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) return undefined; // docker absent or daemon down
  // The stream is one pretty-printed object, one JSON object per line, or one
  // array -- accept all three shapes.
  const text = (result.stdout ?? '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch {
    /* fall through to the per-line shape */
  }
  const entries = [];
  for (const chunk of text.split(/\}\s*\r?\n\{/)) {
    try {
      entries.push(JSON.parse(chunk.startsWith('{') ? chunk : `{${chunk}` + (chunk.endsWith('}') ? '' : '}')));
    } catch {
      return undefined;
    }
  }
  return entries;
}

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
  if (!web) problems.push(`the web app at ${WEB} is down -- start the stack first:  pnpm dev`);

  const api = await reachable(`${API}/api/health`);
  if (!api) {
    problems.push(
      `the api at ${API} is down${web ? '' : ' (also see above)'} -- start the stack first:  pnpm dev   (or for the full server stack:  pnpm stack:up)`,
    );
  }

  const composeFile = await composing();
  if (composeFile) {
    const services = composeServices();
    if (services === undefined) {
      log(`note: ${composeFile} exists but docker compose is unavailable -- skipping compose checks`);
    } else if (services.length === 0) {
      log(`note: ${composeFile} exists but no compose containers exist -- compose checks skipped`);
    } else {
      const down = services.filter((entry) => entry.State !== 'running');
      for (const entry of down) {
        problems.push(
          `compose service ${entry.Service} is ${entry.State} -- restart it:  docker compose up -d   (or check:  docker compose ps)`,
        );
      }
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) log(`[preflight] ${problem}`);
    return false;
  }
  log('preflight: web + api reachable' + (composeFile ? ', compose status ok' : ''));
  return true;
}

/* Run directly from the npm script wiring. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ok = await preflight();
  process.exit(ok ? 0 : 1);
}
