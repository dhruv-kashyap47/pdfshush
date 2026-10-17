/**
 * Accounts: PKCE, the redirect allow-list, ID-token verification, the
 * account/session store, and the four auth routes over a real socket.
 *
 * The OIDC tests do not stub verification. A local issuer serves a real JWKS,
 * signs real RS256 tokens, and the production `GoogleOidc` class verifies them --
 * so a bug in issuer/audience/nonce/expiry handling fails here rather than in
 * production. Only the network endpoints are redirected, nothing else is faked.
 */

import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
} from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GoogleOidc, GoogleOidcError, codeChallengeFor } from '../src/auth/google.js';
import { AUTH_TRANSACTION_TTL_MS, AuthStore } from '../src/auth/store.js';
import { AccountStore } from '../src/account/store.js';
import { SESSION_COOKIE, safeReturnTo } from '../src/auth/routes.js';
import type { AccountDoc, AuthCollections, AuthTransactionDoc, SessionDoc } from '../src/auth/mongo.js';
import { createApp } from '../src/http/app.js';
import { createContext, type ApiContext } from '../src/context.js';
import { WorkDirStore } from '../src/files/store.js';
import { MemoryQuotaStore } from '../src/quota/store.js';
import type { CancelOutcome, JobQueue } from '../src/jobs/queue.js';
import type { JobPayload, JobStateSnapshot } from '../src/jobs/payload.js';

const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';

/* ------------------------------------------------------- local OIDC issuer */

let issuer: string;
/** The pair's private key type, without naming a jose export that may move. */
type TestPrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let privateKey: TestPrivateKey;
let server: Server;
/** Signed token the stub token endpoint will hand back for the next exchange. */
let nextIdToken = '';
/**
 * `null` accepts any verifier, which is what the route tests need: `/start`
 * generates it internally. The PKCE test pins it to prove the binding is real.
 */
let expectedVerifier: string | null = null;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = 'test-key';
  publicJwk.alg = 'RS256';

  server = createServer((request, response) => {
    if (request.url === '/certs') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    if (request.url === '/token' && request.method === 'POST') {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        const params = new URLSearchParams(body);
        // A real token endpoint refuses a mismatched verifier; mirroring that is
        // what makes the PKCE test meaningful rather than decorative.
        const verifierOk =
          expectedVerifier === null || params.get('code_verifier') === expectedVerifier;
        if (!verifierOk || params.get('code') !== 'good-code') {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ id_token: nextIdToken, access_token: 'irrelevant' }));
      });
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  issuer = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function oidc(): GoogleOidc {
  return new GoogleOidc({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: 'http://localhost:8080/api/auth/callback',
    issuer,
    jwksUri: `${issuer}/certs`,
    tokenEndpoint: `${issuer}/token`,
    authorizationEndpoint: `${issuer}/authorize`,
  });
}

async function signIdToken(overrides: {
  sub?: string;
  aud?: string;
  iss?: string;
  nonce?: string;
  email?: string;
  emailVerified?: boolean;
  expiresInSeconds?: number;
} = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    nonce: overrides.nonce ?? 'the-nonce',
    email: overrides.email ?? 'person@example.com',
    email_verified: overrides.emailVerified ?? true,
    name: 'Test Person',
    picture: 'https://example.com/a.png',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject(overrides.sub ?? 'google-subject-1')
    .setIssuer(overrides.iss ?? issuer)
    .setAudience(overrides.aud ?? CLIENT_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + (overrides.expiresInSeconds ?? 300))
    .sign(privateKey);
}

/* --------------------------------------------------------- in-memory store */

/**
 * Just enough Mongo to run the real `AuthStore`. A fake rather than a live
 * cluster so the suite runs anywhere; the store's own logic is what is under
 * test, not the driver.
 */
function memoryCollections() {
  const accounts = new Map<string, AccountDoc>();
  const sessions = new Map<string, SessionDoc>();
  const transactions = new Map<string, AuthTransactionDoc>();

  const collections = {
    accounts: {
      async findOneAndUpdate(filter: { googleSub: string }, update: Record<string, never>) {
        void update;
        const existing = [...accounts.values()].find((a) => a.googleSub === filter.googleSub);
        const doc: AccountDoc = existing ?? {
          _id: `acct-${accounts.size + 1}`,
          googleSub: filter.googleSub,
          email: null,
          emailVerified: false,
          name: null,
          picture: null,
          createdAt: new Date(),
          lastLoginAt: new Date(),
        };
        accounts.set(doc._id, doc);
        const fields = (update as unknown as { $set: Partial<AccountDoc> }).$set ?? {};
        Object.assign(doc, fields);
        return { ...doc };
      },
      async findOne(filter: { _id: string }) {
        const doc = accounts.get(filter._id);
        return doc ? { ...doc } : null;
      },
    },
    sessions: {
      async insertOne(doc: SessionDoc) {
        sessions.set(doc._id, { ...doc });
        return { acknowledged: true };
      },
      async findOne(filter: { _id: string }) {
        const doc = sessions.get(filter._id);
        return doc ? { ...doc } : null;
      },
      async updateOne(filter: { _id: string }, update: { $set: { revokedAt: Date } }) {
        const doc = sessions.get(filter._id);
        if (!doc || doc.revokedAt) return { modifiedCount: 0 };
        doc.revokedAt = update.$set.revokedAt;
        return { modifiedCount: 1 };
      },
      async updateMany(filter: { accountId: string }, update: { $set: { revokedAt: Date } }) {
        let modifiedCount = 0;
        for (const doc of sessions.values()) {
          if (doc.accountId !== filter.accountId || doc.revokedAt) continue;
          doc.revokedAt = update.$set.revokedAt;
          modifiedCount += 1;
        }
        return { modifiedCount };
      },
    },
    transactions: {
      async insertOne(doc: AuthTransactionDoc) {
        transactions.set(doc._id, { ...doc });
        return { acknowledged: true };
      },
      async findOneAndDelete(filter: { _id: string }) {
        const doc = transactions.get(filter._id);
        if (!doc) return null;
        transactions.delete(filter._id);
        return { ...doc };
      },
    },
  };

  return { collections: collections as unknown as AuthCollections, accounts, sessions, transactions };
}

function memoryStore(now: () => Date = () => new Date()) {
  const backing = memoryCollections();
  return { store: new AuthStore(backing.collections, now), ...backing };
}

/* ------------------------------------------------------------------- tests */

describe('PKCE', () => {
  it('derives the S256 challenge from RFC 7636 Appendix B', () => {
    // The published vector: if this drifts, every provider rejects our logins.
    expect(codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('produces a URL-safe challenge with no padding', () => {
    const challenge = codeChallengeFor('some-verifier');
    expect(challenge).not.toMatch(/[+/=]/);
  });
});

describe('authorizationUrl', () => {
  it('asks for an authorization code with S256, state, nonce and account choice', () => {
    const url = new URL(
      oidc().authorizationUrl({ state: 'st', codeChallenge: 'ch', nonce: 'no' }),
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('nonce')).toBe('no');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8080/api/auth/callback');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    // We are not holding refresh tokens, so asking for offline access would
    // collect a durable Google credential we have no use for.
    expect(url.searchParams.get('access_type')).toBeNull();
  });
});

describe('verifyIdToken', () => {
  it('accepts a well-formed token and returns the profile', async () => {
    const token = await signIdToken({ nonce: 'n1', sub: 'sub-1' });
    const profile = await oidc().verifyIdToken(token, 'n1');
    expect(profile).toEqual({
      sub: 'sub-1',
      email: 'person@example.com',
      emailVerified: true,
      name: 'Test Person',
      picture: 'https://example.com/a.png',
    });
  });

  it('rejects a token minted for a different request (nonce)', async () => {
    const token = await signIdToken({ nonce: 'other-nonce' });
    await expect(oidc().verifyIdToken(token, 'n1')).rejects.toMatchObject({
      code: 'nonce_mismatch',
    });
  });

  it('rejects a token for another audience', async () => {
    const token = await signIdToken({ aud: 'someone-else', nonce: 'n1' });
    await expect(oidc().verifyIdToken(token, 'n1')).rejects.toMatchObject({
      code: 'invalid_id_token',
    });
  });

  it('rejects a token from another issuer', async () => {
    const token = await signIdToken({ iss: 'https://evil.example.com', nonce: 'n1' });
    await expect(oidc().verifyIdToken(token, 'n1')).rejects.toMatchObject({
      code: 'invalid_id_token',
    });
  });

  it('rejects an expired token', async () => {
    const token = await signIdToken({ nonce: 'n1', expiresInSeconds: -60 });
    await expect(oidc().verifyIdToken(token, 'n1')).rejects.toMatchObject({
      code: 'invalid_id_token',
    });
  });

  it('rejects a token with no subject', async () => {
    const token = await signIdToken({ nonce: 'n1', sub: '' });
    await expect(oidc().verifyIdToken(token, 'n1')).rejects.toBeInstanceOf(GoogleOidcError);
  });

  it('rejects a token signed by a key we do not trust', async () => {
    const rogue = await generateKeyPair('RS256');
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ nonce: 'n1' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('sub-1')
      .setIssuer(issuer)
      .setAudience(CLIENT_ID)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(rogue.privateKey);
    await expect(oidc().verifyIdToken(token, 'n1')).rejects.toMatchObject({
      code: 'invalid_id_token',
    });
  });
});

describe('exchangeCode', () => {
  it('binds the exchange to the PKCE verifier', async () => {
    expectedVerifier = 'the-right-verifier';
    nextIdToken = await signIdToken({ nonce: 'n1' });

    await expect(
      oidc().exchangeCode({ code: 'good-code', codeVerifier: 'the-wrong-verifier' }),
    ).rejects.toMatchObject({ code: 'token_exchange_failed' });

    await expect(
      oidc().exchangeCode({ code: 'good-code', codeVerifier: 'the-right-verifier' }),
    ).resolves.toBe(nextIdToken);

    expectedVerifier = null;
  });
});

describe('safeReturnTo', () => {
  it('keeps same-origin paths', () => {
    expect(safeReturnTo('/tools/edit-pdf')).toBe('/tools/edit-pdf');
    expect(safeReturnTo('/')).toBe('/');
  });

  it('collapses anything that could leave the origin', () => {
    // The open-redirect set: protocol-relative, absolute, and backslash forms
    // (browsers normalise `\` to `/`, so `/\evil.com` is protocol-relative too).
    for (const hostile of [
      '//evil.example.com',
      'https://evil.example.com',
      'http://evil.example.com/x',
      '/\\evil.example.com',
      '\\\\evil.example.com',
      'javascript:alert(1)',
      'tools/edit-pdf',
      '',
    ]) {
      expect(safeReturnTo(hostile), hostile).toBe('/');
    }
    expect(safeReturnTo(42)).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
  });

  it('strips control characters that could split a header', () => {
    expect(safeReturnTo('/a\r\nSet-Cookie: x=1')).toBe('/');
    expect(safeReturnTo('/a\u0000b')).toBe('/');
  });
});

describe('AuthStore', () => {
  it('keys accounts on the Google subject, not the email', async () => {
    const { store } = memoryStore();
    const first = await store.upsertAccount({
      sub: 'sub-1',
      email: 'a@example.com',
      emailVerified: true,
      name: 'A',
      picture: null,
    });
    // Same subject, changed email: same account.
    const again = await store.upsertAccount({
      sub: 'sub-1',
      email: 'b@example.com',
      emailVerified: true,
      name: 'A renamed',
      picture: null,
    });
    expect(again.id).toBe(first.id);
    expect(again.email).toBe('b@example.com');

    // Different subject, same email: a different account. Linking on email would
    // hand one person another's history after a mailbox is reassigned.
    const other = await store.upsertAccount({
      sub: 'sub-2',
      email: 'b@example.com',
      emailVerified: true,
      name: 'B',
      picture: null,
    });
    expect(other.id).not.toBe(first.id);
  });

  it('stores only a hash of the session token', async () => {
    const { store, sessions } = memoryStore();
    const account = await store.upsertAccount({
      sub: 's',
      email: null,
      emailVerified: false,
      name: null,
      picture: null,
    });
    const session = await store.createSession(account.id, 60_000);

    expect(session.token).toHaveLength(43);
    for (const key of sessions.keys()) {
      expect(key).not.toBe(session.token);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('resolves a live session and refuses unknown, revoked and expired ones', async () => {
    let clock = new Date('2026-01-01T00:00:00Z');
    const { store } = memoryStore(() => clock);
    const account = await store.upsertAccount({
      sub: 's',
      email: null,
      emailVerified: false,
      name: null,
      picture: null,
    });

    const live = await store.createSession(account.id, 60_000);
    expect((await store.resolveSession(live.token))?.id).toBe(account.id);
    expect(await store.resolveSession('not-a-real-token')).toBeUndefined();

    const toRevoke = await store.createSession(account.id, 60_000);
    await store.revokeSession(toRevoke.token);
    expect(await store.resolveSession(toRevoke.token)).toBeUndefined();

    // Expiry is enforced in code, not only by the TTL index: a TTL monitor runs
    // about once a minute and the row is still present in that gap.
    const expiring = await store.createSession(account.id, 1_000);
    clock = new Date(clock.getTime() + 2_000);
    expect(await store.resolveSession(expiring.token)).toBeUndefined();
  });

  it('revokes every session for an account', async () => {
    const { store } = memoryStore();
    const account = await store.upsertAccount({
      sub: 's',
      email: null,
      emailVerified: false,
      name: null,
      picture: null,
    });
    const a = await store.createSession(account.id, 60_000);
    const b = await store.createSession(account.id, 60_000);
    expect(await store.revokeAllSessions(account.id)).toBe(2);
    expect(await store.resolveSession(a.token)).toBeUndefined();
    expect(await store.resolveSession(b.token)).toBeUndefined();
  });

  it('consumes an auth transaction exactly once', async () => {
    const { store } = memoryStore();
    await store.startTransaction({
      state: 'st-1',
      codeVerifier: 'v',
      nonce: 'n',
      returnTo: '/tools/edit-pdf',
    });
    const taken = await store.takeTransaction('st-1');
    expect(taken).toMatchObject({ codeVerifier: 'v', nonce: 'n', returnTo: '/tools/edit-pdf' });
    // Replay finds nothing: this is what makes `state` single-use.
    expect(await store.takeTransaction('st-1')).toBeUndefined();
    expect(await store.takeTransaction('never-existed')).toBeUndefined();
  });

  it('refuses an expired transaction even if the TTL monitor has not run', async () => {
    let clock = new Date('2026-01-01T00:00:00Z');
    const { store } = memoryStore(() => clock);
    await store.startTransaction({ state: 'st-2', codeVerifier: 'v', nonce: 'n', returnTo: '/' });
    clock = new Date(clock.getTime() + AUTH_TRANSACTION_TTL_MS + 1_000);
    expect(await store.takeTransaction('st-2')).toBeUndefined();
  });
});

/* ------------------------------------------------------------ HTTP surface */

class FakeQueue implements JobQueue {
  async enqueue(payload: JobPayload): Promise<string> {
    return payload.jobId;
  }
  async state(): Promise<JobStateSnapshot | undefined> {
    return undefined;
  }
  async cancel(): Promise<CancelOutcome> {
    return 'unknown';
  }
  async counts() {
    return { waiting: 0, active: 0, completed: 0, failed: 0 };
  }
  async close(): Promise<void> {}
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function harness(options: { withAuth: boolean; cookieSecure?: boolean }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pdfshush-auth-'));
  const store = new WorkDirStore(dir);
  await store.init();

  const memory = memoryStore();
  const context: ApiContext = createContext({
    store,
    queue: new FakeQueue(),
    quotaStore: new MemoryQuotaStore(),
    pepper: 'test-pepper',
    logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {} } as never,
    config: {
      auth: {
        webOrigin: 'http://localhost:5173',
        sessionTtlMs: 60_000,
        cookieSecure: options.cookieSecure ?? false,
      },
    } as never,
    ...(options.withAuth
      ? {
          auth: {
            store: memory.store,
            account: new AccountStore(memory.collections),
            oidc: oidc(),
            close: async () => {},
          },
        }
      : {}),
  });

  const app = createApp(context);
  const server: Server = await new Promise((resolve) => {
    const created = app.listen(0, '127.0.0.1', () => resolve(created));
  });
  const port = (server.address() as AddressInfo).port;
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }).then(async () => rm(dir, { recursive: true, force: true })),
  );
  return { url: (suffix: string) => `http://127.0.0.1:${port}${suffix}`, memory };
}

describe('auth routes', () => {
  it('reports nobody signed in as 204, which is not an error', async () => {
    const { url } = await harness({ withAuth: true });
    const response = await fetch(url('/api/auth/me'));
    expect(response.status).toBe(204);
  });

  it('degrades to 503 when the deployment has no credentials', async () => {
    const { url } = await harness({ withAuth: false });
    const start = await fetch(url('/api/auth/google/start'), { redirect: 'manual' });
    expect(start.status).toBe(503);
    // `me` is the SPA's "who am I" probe: anonymous is the normal answer, not a
    // 503, or every page load would log an error.
    const me = await fetch(url('/api/auth/me'));
    expect(me.status).toBe(204);
  });

  it('starts a login by redirecting to the provider with PKCE and state', async () => {
    const { url } = await harness({ withAuth: true });
    const response = await fetch(url('/api/auth/google/start?returnTo=/tools/merge'), {
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') as string);
    expect(location.origin).toBe(issuer);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('nonce')).toBeTruthy();
  });

  it('completes a login, sets an HttpOnly session cookie, and honours me/logout', async () => {
    const { url, memory } = await harness({ withAuth: true });
    // PKCE and nonce are generated inside /start, so the stub cannot know them in
    // advance. Read the real transaction back, then make the stub demand exactly
    // what /start produced: the binding is still exercised end to end.
    expectedVerifier = null;

    const start = await fetch(url('/api/auth/google/start?returnTo=/tools/merge'), {
      redirect: 'manual',
    });
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string;

    const transaction = memory.transactions.get(state);
    expect(transaction).toBeDefined();
    expectedVerifier = (transaction as { codeVerifier: string }).codeVerifier;
    nextIdToken = await signIdToken({ nonce: (transaction as { nonce: string }).nonce, sub: 'sub-http' });

    const callback = await fetch(url(`/api/auth/callback?code=good-code&state=${state}`), {
      redirect: 'manual',
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('http://localhost:5173/tools/merge');

    const setCookie = callback.headers.getSetCookie?.() ?? [];
    const cookie = setCookie.find((value) => value.startsWith(SESSION_COOKIE));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    // The token must not be readable from JavaScript, and must not be the value
    // the server stores.
    expect(cookie).not.toContain('Secure');

    const cookieHeader = (cookie as string).split(';')[0] as string;
    const me = await fetch(url('/api/auth/me'), { headers: { cookie: cookieHeader } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { account: { email: string } };
    expect(body.account.email).toBe('person@example.com');

    const logout = await fetch(url('/api/auth/logout'), {
      method: 'POST',
      headers: { cookie: cookieHeader },
    });
    expect(logout.status).toBe(204);

    const after = await fetch(url('/api/auth/me'), { headers: { cookie: cookieHeader } });
    expect(after.status).toBe(204);
  });

  it('marks the session cookie Secure when TLS terminates in front of the API', async () => {
    // The one leg a browser could not verify here: production runs with
    // SESSION_COOKIE_SECURE=true, and a cookie the browser silently drops would
    // look like "signed in, then signed out". Asserted on the flag itself.
    const { url, memory } = await harness({ withAuth: true, cookieSecure: true });
    expectedVerifier = null;

    const start = await fetch(url('/api/auth/google/start'), { redirect: 'manual' });
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string;
    const transaction = memory.transactions.get(state) as { codeVerifier: string; nonce: string };
    expectedVerifier = transaction.codeVerifier;
    nextIdToken = await signIdToken({ nonce: transaction.nonce });

    const callback = await fetch(url(`/api/auth/callback?code=good-code&state=${state}`), {
      redirect: 'manual',
    });
    const cookie = (callback.headers.getSetCookie?.() ?? []).find((value) =>
      value.startsWith(SESSION_COOKIE),
    ) as string;
    expect(cookie).toMatch(/Secure/i);
  });

  it('refuses a replayed state', async () => {
    const { url } = await harness({ withAuth: true });
    const start = await fetch(url('/api/auth/google/start'), { redirect: 'manual' });
    const state = new URL(start.headers.get('location') as string).searchParams.get('state');
    await fetch(url(`/api/auth/callback?code=good-code&state=${state as string}`), {
      redirect: 'manual',
    });
    const replay = await fetch(url(`/api/auth/callback?code=good-code&state=${state as string}`), {
      redirect: 'manual',
    });
    expect(replay.headers.get('location')).toBe('http://localhost:5173/?auth=error&reason=expired');
  });

  it('redirects a cancelled sign-in without creating a session', async () => {
    const { url } = await harness({ withAuth: true });
    const response = await fetch(url('/api/auth/callback?error=access_denied'), {
      redirect: 'manual',
    });
    expect(response.headers.get('location')).toBe(
      'http://localhost:5173/?auth=error&reason=cancelled',
    );
    expect(response.headers.getSetCookie?.() ?? []).toHaveLength(0);
  });

  it('ignores a callback with no code or state', async () => {
    const { url } = await harness({ withAuth: true });
    const response = await fetch(url('/api/auth/callback'), { redirect: 'manual' });
    expect(response.headers.get('location')).toBe(
      'http://localhost:5173/?auth=error&reason=invalid_request',
    );
  });

  it('does not leak whether credentials are misconfigured', async () => {
    const { url } = await harness({ withAuth: true });
    const start = await fetch(url('/api/auth/google/start'), { redirect: 'manual' });
    const state = new URL(start.headers.get('location') as string).searchParams.get('state');
    // Force the exchange to fail (the stub only accepts `good-code`).
    const response = await fetch(url(`/api/auth/callback?code=bad-code&state=${state as string}`), {
      redirect: 'manual',
    });
    expect(response.headers.get('location')).toBe(
      'http://localhost:5173/?auth=error&reason=signin_failed',
    );
  });
});
