/**
 * Pre-deploy guard for the Cloudflare-only shape.
 *
 * A Git-connected Workers Build reads `wrangler.jsonc` from the branch it is
 * told to build. If that branch is stale, the build succeeds right up to the
 * deploy and then fails with:
 *
 *   D1 binding 'DB' references database '00000000-...' which was not found
 *
 * That error is late, opaque and looks like a Cloudflare problem rather than a
 * wrong-branch problem. This check fails first, in one line, with the fix.
 *
 * Run by `pnpm test:deploy-config` and by `pnpm deploy`. CI runs it too, so a
 * commit that reintroduces the placeholder cannot reach main.
 */

import { readFile } from 'node:fs/promises';

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function note(message) {
  notes.push(message);
}

const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const production = await readFile(
  new URL('../apps/web/.env.production', import.meta.url),
  'utf8',
);

const databaseId = /"database_id"\s*:\s*"([^"]+)"/.exec(wrangler)?.[1];
if (!databaseId) {
  fail('wrangler.jsonc has no "database_id". Create D1 and paste the id.');
} else if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(databaseId)) {
  fail(
    'wrangler.jsonc still has the placeholder D1 id 00000000-0000-0000-0000-000000000000. ' +
      'Run `npx wrangler d1 create pdfshush` and paste the real id.',
  );
}

if (!/"workers_dev"\s*:\s*false/.test(wrangler)) {
  fail('wrangler.jsonc must set "workers_dev": false; the only origin is pdfshush.com.');
}

if (!/"pattern"\s*:\s*"pdfshush\.com"/.test(wrangler)) {
  fail('wrangler.jsonc is missing the pdfshush.com custom-domain route.');
}

const webOrigin = /"WEB_ORIGIN"\s*:\s*"(https?:\/\/[^"]+)"/.exec(wrangler)?.[1];
const redirect = /"GOOGLE_REDIRECT_URI"\s*:\s*"([^"]+)"/.exec(wrangler)?.[1];
if (!webOrigin) {
  fail('wrangler.jsonc has no WEB_ORIGIN.');
} else if (redirect && !redirect.startsWith(`${webOrigin}/api/auth/callback`)) {
  fail(`GOOGLE_REDIRECT_URI (${redirect}) does not match WEB_ORIGIN (${webOrigin}).`);
}
if (!redirect) {
  note('GOOGLE_REDIRECT_URI is unset; sign-in will stay hidden.');
}

if (!/^VITE_SERVER_API=on$/m.test(production)) {
  fail('apps/web/.env.production must build the Worker shape: VITE_SERVER_API=on.');
}
if (!/^VITE_SITE_ORIGIN=https:\/\/pdfshush\.com$/m.test(production)) {
  fail('apps/web/.env.production must set VITE_SITE_ORIGIN=https://pdfshush.com.');
}

const model = /"AI_MANAGED_MODEL"\s*:\s*"([^"]*)"/.exec(wrangler)?.[1];
if (!model) {
  note('AI_MANAGED_MODEL is empty; managed AI stays off (BYOK still works).');
}

const anonCap = /"AI_ANON_GLOBAL_PER_DAY"\s*:\s*"(\d+)"/.exec(wrangler)?.[1];
const proCap = /"AI_PRO_GLOBAL_PER_DAY"\s*:\s*"(\d+)"/.exec(wrangler)?.[1];
if (anonCap && proCap) {
  const total = Number(anonCap) + Number(proCap);
  if (total >= 1_000) {
    note(`Deployment AI caps sum to ${total}/day; at 1,000+ you must be on $10+ OpenRouter credit.`);
  } else if (total >= 50) {
    note(
      `Deployment AI caps sum to ${total}/day. OpenRouter's sub-$10 free quota is 50/day; keep the total below it.`,
    );
  }
}

for (const message of notes) console.log(`[deploy-config] note: ${message}`);
if (failures.length > 0) {
  for (const message of failures) console.error(`[deploy-config] FAIL: ${message}`);
  process.exit(1);
}
console.log('[deploy-config] OK: D1, origin, custom domain, build shape and AI caps are consistent.');
