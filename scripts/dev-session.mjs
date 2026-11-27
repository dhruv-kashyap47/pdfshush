/**
 * Creates a local development account and session in the `wrangler dev` D1,
 * then prints the cookie to paste into the browser.
 *
 * Why: the local Worker only needs Google OAuth to *create* an account, and the
 * localhost redirect URI is often not registered in Google Cloud. The billing
 * rail (checkout, webhook, entitlement) is unrelated to how the session was
 * made, so seeding one keeps the test focused.
 *
 * This script only ever opens `.wrangler/state`, the local Miniflare copy. It
 * cannot reach remote D1: there is no API call and no account id.
 *
 * Usage:
 *   node scripts/dev-session.mjs            # create account + session
 *   node scripts/dev-session.mjs --email me@example.com
 *
 * Then, in the browser devtools for http://localhost:5173:
 *   document.cookie = 'pdfshush_session=<token>; path=/'
 */

import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const D1_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function localDatabase() {
  let entries;
  try {
    entries = readdirSync(D1_DIR).filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
  } catch {
    throw new Error(`no local D1 at ${D1_DIR} -- run "pnpm db:local" first`);
  }
  if (entries.length === 0) throw new Error(`no local D1 at ${D1_DIR} -- run "pnpm db:local" first`);

  const candidates = [];
  for (const name of entries) {
    const path = join(D1_DIR, name);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const applied = db
        .prepare("SELECT name FROM d1_migrations WHERE name LIKE '0004%'")
        .all()
        .length;
      if (applied > 0) candidates.push({ path, mtime: statSync(path).mtimeMs });
    } catch {
      // A database without d1_migrations is not ours.
    } finally {
      db.close();
    }
  }
  if (candidates.length === 0) {
    throw new Error('the local D1 has no 0004_pro_subscription migration -- run "pnpm db:local"');
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].path;
}

const base64url = (bytes) =>
  bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

const email = (arg('email') ?? 'dev@pdfshush.test').trim();
const name = arg('name') ?? 'Local Dev';
const googleSub = `local-dev:${email}`;
const path = localDatabase();
const now = Date.now();
const token = base64url(randomBytes(32));
const accountId = randomBytes(8).toString('hex');

const db = new DatabaseSync(path);
try {
  db.prepare(
    `INSERT INTO accounts (id, google_sub, email, email_verified, name, picture, created_at, last_login_at)
     VALUES (?, ?, ?, 1, ?, NULL, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       last_login_at = excluded.last_login_at`,
  ).run(accountId, googleSub, email, name, now, now);

  const row = db
    .prepare('SELECT id FROM accounts WHERE google_sub = ?')
    .get(googleSub);

  db.prepare(
    `INSERT INTO sessions (token_hash, account_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).run(sha256Hex(token), row.id, now, now + TTL_MS);

  console.log(`account  ${row.id}  <${email}>`);
  console.log(`database ${path}`);
  console.log(`token    ${token}`);
  console.log('');
  console.log('In the browser console at http://localhost:5173 (both cookies are needed:');
  console.log('the session, and the CSRF double-submit token the OAuth callback would set):');
  console.log(`  document.cookie = 'pdfshush_session=${token}; path=/'`);
  console.log("  document.cookie = 'pdfshush_csrf=localdevcsrf; path=/'");
} finally {
  db.close();
}

