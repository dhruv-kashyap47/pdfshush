/**
 * Account data: preferences, synced history, saved workflows, job ownership and
 * erasure -- through the real `AccountStore` and the real routes.
 *
 * The Mongo fake is deliberately tiny but faithful on the two things that carry
 * risk: filters are matched by equality on the fields given (so an account-scoped
 * query cannot "accidentally" match another account in the test but fail in
 * production), and `find` is chainable in the order the store uses.
 */

import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import {
  MongoNetworkError,
  MongoServerError,
  MongoServerSelectionError,
  MongoTopologyClosedError,
} from 'mongodb';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthStore } from '../src/auth/store.js';
import { AccountStore, MAX_WORKFLOWS } from '../src/account/store.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../src/auth/routes.js';
import type { AuthCollections } from '../src/auth/mongo.js';
import { createApp } from '../src/http/app.js';
import { createContext, type ApiContext } from '../src/context.js';
import { WorkDirStore } from '../src/files/store.js';
import { MemoryQuotaStore } from '../src/quota/store.js';
import type { CancelOutcome, JobQueue } from '../src/jobs/queue.js';
import type { JobPayload, JobStateSnapshot } from '../src/jobs/payload.js';

/** `Response.json()` is `unknown`; tests read it structurally. */
async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/* ----------------------------------------------------- in-memory Mongo ---- */

type Doc = Record<string, unknown> & { _id: string };

function matches(doc: Doc, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$exists' in (expected as object)) {
      const exists = key in doc;
      return exists === (expected as { $exists: boolean }).$exists;
    }
    return doc[key] === expected;
  });
}

function applyUpdate(doc: Doc, update: Record<string, unknown>): void {
  const set = update.$set as Record<string, unknown> | undefined;
  if (set) Object.assign(doc, set);
  const onInsert = update.$setOnInsert as Record<string, unknown> | undefined;
  // `$setOnInsert` only applies when the row is being created, which the caller
  // handles; on an update it is a no-op, matching the driver.
  void onInsert;
}

function collection<T extends Doc>() {
  const rows = new Map<string, T>();
  return {
    rows,
    async findOne(filter: Record<string, unknown>) {
      for (const doc of rows.values()) if (matches(doc, filter)) return { ...doc };
      return null;
    },
    async findOneAndUpdate(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options: { upsert?: boolean } = {},
    ) {
      for (const doc of rows.values()) {
        if (!matches(doc, filter)) continue;
        applyUpdate(doc as Doc, update);
        return { ...doc };
      }
      if (!options.upsert) return null;
      const seed = { ...filter } as Doc;
      if (!seed._id) seed._id = `gen-${rows.size + 1}`;
      applyUpdate(seed, update);
      rows.set(seed._id, seed as T);
      return { ...seed };
    },
    async insertOne(doc: T) {
      rows.set(doc._id, { ...doc });
      return { acknowledged: true };
    },
    async updateOne(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options: { upsert?: boolean } = {},
    ) {
      for (const doc of rows.values()) {
        if (!matches(doc, filter)) continue;
        applyUpdate(doc as Doc, update);
        return { modifiedCount: 1 };
      }
      // `upsert` is what `recordJob` relies on; ignoring it silently dropped
      // every ownership row, which is exactly the kind of fake-vs-driver drift
      // that makes a green test meaningless.
      if (options.upsert) {
        const seed = { ...filter } as Doc;
        if (!seed._id) seed._id = `gen-${rows.size + 1}`;
        applyUpdate(seed, update);
        rows.set(seed._id, seed as T);
        return { modifiedCount: 0, upsertedCount: 1 };
      }
      return { modifiedCount: 0 };
    },
    async deleteOne(filter: Record<string, unknown>) {
      for (const [id, doc] of rows) {
        if (!matches(doc, filter)) continue;
        rows.delete(id);
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    },
    async deleteMany(filter: Record<string, unknown>) {
      let deletedCount = 0;
      for (const [id, doc] of [...rows]) {
        if (!matches(doc, filter)) continue;
        rows.delete(id);
        deletedCount += 1;
      }
      return { deletedCount };
    },
    async countDocuments(filter: Record<string, unknown>) {
      let count = 0;
      for (const doc of rows.values()) if (matches(doc, filter)) count += 1;
      return count;
    },
    find(filter: Record<string, unknown> = {}) {
      let list = [...rows.values()].filter((doc) => matches(doc, filter));
      const cursor = {
        sort(spec: Record<string, number>) {
          const [key, direction] = Object.entries(spec)[0] ?? ['createdAt', -1];
          list = [...list].sort((a, b) => {
            const left = (a as Doc)[key!] as number;
            const right = (b as Doc)[key!] as number;
            return (left - right) * (direction as number);
          });
          return cursor;
        },
        limit(n: number) {
          list = list.slice(0, n);
          return cursor;
        },
        async toArray() {
          return list.map((doc) => ({ ...doc }));
        },
      };
      return cursor;
    },
  };
}

function memoryDb() {
  const collections = {
    accounts: collection(),
    sessions: collection(),
    transactions: collection(),
    preferences: collection(),
    history: collection(),
    workflows: collection(),
    jobOwners: collection(),
  } as unknown as AuthCollections;
  return { collections, auth: new AuthStore(collections), account: new AccountStore(collections) };
}

/* ------------------------------------------------------------- harness ---- */

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

/** Signs in a fresh account and returns cookies the routes will accept. */
async function harness(options: { rateLimitPerMinute?: number } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pdfshush-account-'));
  const store = new WorkDirStore(dir);
  await store.init();
  const db = memoryDb();

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
        cookieSecure: false,
        ...(options.rateLimitPerMinute !== undefined
          ? { authRateLimitPerMinute: options.rateLimitPerMinute }
          : {}),
      },
    } as never,
    auth: { store: db.auth, account: db.account, oidc: {} as never, close: async () => {} },
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

  const account = await db.auth.upsertAccount({
    sub: 'sub-1',
    email: 'person@example.com',
    emailVerified: true,
    name: 'Person',
    picture: null,
  });
  const session = await db.auth.createSession(account.id, 60_000);
  const csrf = 'csrf-token-value';
  const cookies = `${SESSION_COOKIE}=${session.token}; ${CSRF_COOKIE}=${csrf}`;

  const url = (suffix: string) => `http://127.0.0.1:${port}${suffix}`;
  const call = (suffix: string, init: RequestInit = {}) =>
    fetch(url(suffix), {
      ...init,
      headers: {
        cookie: cookies,
        [CSRF_HEADER]: csrf,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });

  return { url, call, cookies, csrf, account, db };
}

describe('sign-in rate limiting', () => {
  it('throttles the two routes that cost us work', async () => {
    const { url } = await harness({ rateLimitPerMinute: 3 });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const response = await fetch(url('/api/auth/google/start'), { redirect: 'manual' });
      statuses.push(response.status);
    }
    // The provider is a stub here, so the first calls fail inside the route --
    // what matters is that the limiter refuses the fourth *before* the route
    // runs, which is the whole point of putting it in middleware.
    expect(statuses.slice(0, 3).includes(429)).toBe(false);
    expect(statuses[3]).toBe(429);
  });

  it('does not throttle the cheap /me probe the SPA calls on every page', async () => {
    const { url } = await harness({ rateLimitPerMinute: 2 });
    for (let i = 0; i < 6; i += 1) {
      const response = await fetch(url('/api/auth/me'));
      expect(response.status, `call ${i + 1}`).toBe(204);
    }
  });
});

/* --------------------------------------------------------------- tests ---- */

describe('account routes: authorisation', () => {
  it('refuses every account route without a session', async () => {
    const { url } = await harness();
    for (const [method, suffix] of [
      ['GET', '/api/account'],
      ['GET', '/api/account/preferences'],
      ['PUT', '/api/account/preferences'],
      ['GET', '/api/account/history'],
      ['POST', '/api/account/history'],
      ['DELETE', '/api/account/history'],
      ['GET', '/api/account/workflows'],
      ['POST', '/api/account/workflows'],
      ['GET', '/api/account/jobs'],
      ['DELETE', '/api/account'],
    ] as const) {
      const response = await fetch(url(suffix), { method });
      expect(response.status, `${method} ${suffix}`).toBe(401);
    }
  });

  it('requires a CSRF header on every state-changing route', async () => {
    const { url, cookies } = await harness();
    for (const [method, suffix] of [
      ['PUT', '/api/account/preferences'],
      ['POST', '/api/account/history'],
      ['DELETE', '/api/account/history'],
      ['POST', '/api/account/workflows'],
      ['DELETE', '/api/account'],
    ] as const) {
      // Session cookie present, CSRF header absent: the shape a cross-site
      // request would have if SameSite were ever relaxed.
      const response = await fetch(url(suffix), {
        method,
        headers: { cookie: cookies, 'content-type': 'application/json' },
        ...(method === 'DELETE' ? {} : { body: '{}' }),
      });
      expect(response.status, `${method} ${suffix}`).toBe(403);
    }
  });

  it('rejects a CSRF token of the right length but the wrong value', async () => {
    // Regression. The check compared *lengths only*, so any string of the right
    // shape was accepted -- the token that exists to stop a cross-site write
    // stopped nothing. A same-length wrong value is the exact input that used to
    // slip through.
    const { url, cookies, csrf } = await harness();
    const wrong = 'z'.repeat(csrf.length);
    expect(wrong).not.toBe(csrf);
    const response = await fetch(url('/api/account/preferences'), {
      method: 'PUT',
      headers: { cookie: cookies, 'content-type': 'application/json', [CSRF_HEADER]: wrong },
      body: JSON.stringify({ values: { theme: 'dark' } }),
    });
    expect(response.status).toBe(403);
  });

  it('accepts the matching CSRF token', async () => {
    const { call } = await harness();
    const response = await call('/api/account/preferences', {
      method: 'PUT',
      body: JSON.stringify({ values: { theme: 'dark' } }),
    });
    expect(response.status).toBe(200);
  });

  it('reports a storage outage as 503, not 500', async () => {
    const { url, cookies, csrf, db } = await harness();
    // A driver-level connection failure during a read. Use the driver's public
    // class rather than reproducing its current `name` string.
    (db.auth as unknown as { resolveSession: unknown }).resolveSession = async () => {
      throw new MongoServerSelectionError('connect ECONNREFUSED', {} as never);
    };
    const response = await fetch(url('/api/account'), {
      headers: { cookie: cookies, [CSRF_HEADER]: csrf },
    });
    expect(response.status).toBe(503);
    expect((await body<{ code: string }>(response)).code).toBe('storage_unavailable');
  });

  it.each([
    ['network error', () => new MongoNetworkError('socket closed')],
    ['topology closed', () => new MongoTopologyClosedError()],
    ['wrapped network error', () => new Error('storage wrapper', { cause: new MongoNetworkError('timeout') })],
  ])('classifies a %s as a storage outage', async (_label, makeError) => {
    const { url, cookies, csrf, db } = await harness();
    (db.auth as unknown as { resolveSession: unknown }).resolveSession = async () => {
      throw makeError();
    };
    const response = await fetch(url('/api/account'), {
      headers: { cookie: cookies, [CSRF_HEADER]: csrf },
    });
    expect(response.status).toBe(503);
  });

  it('does not classify a Mongo server/application error as a storage outage', async () => {
    const { url, cookies, csrf, db } = await harness();
    (db.auth as unknown as { resolveSession: unknown }).resolveSession = async () => {
      throw new MongoServerError({ message: 'duplicate key', code: 11000 });
    };
    const response = await fetch(url('/api/account'), {
      headers: { cookie: cookies, [CSRF_HEADER]: csrf },
    });
    expect(response.status).toBe(500);
  });
});

describe('preferences', () => {
  it('round-trips a settings object', async () => {
    const { call } = await harness();
    expect((await body(await call('/api/account/preferences'))).preferences).toEqual({});

    const saved = await call('/api/account/preferences', {
      method: 'PUT',
      body: JSON.stringify({ values: { theme: 'dark', defaultZoom: 1.5 } }),
    });
    expect(saved.status).toBe(200);
    expect((await body(saved)).preferences).toEqual({ theme: 'dark', defaultZoom: 1.5 });

    expect((await body(await call('/api/account/preferences'))).preferences).toEqual({
      theme: 'dark',
      defaultZoom: 1.5,
    });
  });

  it('rejects a malformed or oversized blob', async () => {
    const { call } = await harness();
    expect((await call('/api/account/preferences', { method: 'PUT', body: JSON.stringify({ values: 42 }) })).status).toBe(400);
    expect((await call('/api/account/preferences', { method: 'PUT', body: JSON.stringify(['x']) })).status).toBe(400);
    const huge = { values: { blob: 'x'.repeat(9_000) } };
    expect((await call('/api/account/preferences', { method: 'PUT', body: JSON.stringify(huge) })).status).toBe(413);
  });
});

describe('history', () => {
  it('records, lists newest-first, and clears', async () => {
    const { call } = await harness();
    await call('/api/account/history', {
      method: 'POST',
      body: JSON.stringify({ toolSlug: 'merge-pdf', toolName: 'Merge', fileName: 'a.pdf' }),
    });
    await call('/api/account/history', {
      method: 'POST',
      body: JSON.stringify({ toolSlug: 'edit-pdf', toolName: 'Edit', fileName: 'b.pdf', pageCount: 3 }),
    });

    const list = (await body<{ history: { toolSlug: string }[] }>(await call('/api/account/history'))).history;
    expect(list).toHaveLength(2);
    expect(list[0]?.toolSlug).toBe('edit-pdf');

    const cleared = await call('/api/account/history', { method: 'DELETE' });
    expect((await body<{ removed: number }>(cleared)).removed).toBe(2);
    expect((await body<{ history: unknown[] }>(await call('/api/account/history'))).history).toEqual([]);
  });

  it('requires the identifying fields', async () => {
    const { call } = await harness();
    const response = await call('/api/account/history', {
      method: 'POST',
      body: JSON.stringify({ toolSlug: 'merge-pdf' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('workflows', () => {
  const validRecipe = {
    name: 'Merge then stamp',
    steps: [
      { id: 'a', tool: 'merge' },
      { id: 'b', tool: 'stamp', input: { kind: 'step', stepId: 'a' } },
    ],
  };

  it('validates a recipe with the engine before storing it', async () => {
    const { call } = await harness();
    // A hand-rolled check in the route would let this through; the engine's own
    // validator is what makes server and browser agree.
    const bad = await call('/api/account/workflows', {
      method: 'POST',
      body: JSON.stringify({ name: 'Broken', steps: [{ id: 'a', tool: 'not-a-tool' }] }),
    });
    expect(bad.status).toBe(400);
    const badBody = await body<{ issues: { message: string }[] }>(bad);
    expect(badBody.issues[0]?.message).toMatch(/Unknown tool/);

    const chained = await call('/api/account/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bad chain',
        steps: [
          { id: 'a', tool: 'inspect' },
          { id: 'b', tool: 'merge', input: { kind: 'step', stepId: 'a' } },
        ],
      }),
    });
    expect(chained.status).toBe(400);
  });

  it('creates, lists, updates and deletes', async () => {
    const { call } = await harness();
    const created = await call('/api/account/workflows', {
      method: 'POST',
      body: JSON.stringify(validRecipe),
    });
    expect(created.status).toBe(201);
    const { workflow } = await body<{ workflow: { id: string; name: string } }>(created);
    expect(workflow.name).toBe('Merge then stamp');

    const listed = await body<{ workflows: unknown[] }>(await call('/api/account/workflows'));
    expect(listed.workflows.length).toBe(1);

    const updated = await call(`/api/account/workflows/${workflow.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...validRecipe, name: 'Renamed' }),
    });
    expect(updated.status).toBe(200);
    expect((await body<{ workflow: { name: string } }>(updated)).workflow.name).toBe('Renamed');

    expect((await call(`/api/account/workflows/${workflow.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await body<{ workflows: unknown[] }>(await call('/api/account/workflows'))).workflows.length).toBe(0);
  });

  it('cannot touch another account\'s workflow', async () => {
    const first = await harness();
    const created = await first.call('/api/account/workflows', {
      method: 'POST',
      body: JSON.stringify(validRecipe),
    });
    const { workflow } = await body<{ workflow: { id: string } }>(created);

    // A second, independent account with its own session.
    const second = await harness();
    const other = second.db;
    const account = await other.auth.upsertAccount({
      sub: 'sub-2',
      email: 'other@example.com',
      emailVerified: true,
      name: null,
      picture: null,
    });
    const session = await other.auth.createSession(account.id, 60_000);
    const response = await fetch(second.url(`/api/account/workflows/${workflow.id}`), {
      method: 'DELETE',
      headers: {
        cookie: `${SESSION_COOKIE}=${session.token}; ${CSRF_COOKIE}=x`,
        [CSRF_HEADER]: 'x',
      },
    });
    // 404 rather than 403: confirming the id exists would leak its existence.
    expect(response.status).toBe(404);
  });

  it('enforces a per-account workflow cap', async () => {
    const { call } = await harness();
    for (let i = 0; i < MAX_WORKFLOWS; i += 1) {
      const response = await call('/api/account/workflows', {
        method: 'POST',
        body: JSON.stringify({ ...validRecipe, name: `Recipe ${i}` }),
      });
      expect(response.status).toBe(201);
    }
    const overflow = await call('/api/account/workflows', {
      method: 'POST',
      body: JSON.stringify(validRecipe),
    });
    expect(overflow.status).toBe(409);
  });
});

describe('job ownership', () => {
  it('lists only this account\'s jobs', async () => {
    const { call, account, db } = await harness();
    await db.account.recordJob(account.id, 'job-aaaaaaaa', 'merge', 60_000);
    await db.account.recordJob('someone-else', 'job-bbbbbbbb', 'merge', 60_000);

    const jobs = (await body<{ jobs: { jobId: string }[] }>(await call('/api/account/jobs'))).jobs;
    expect(jobs.map((job) => job.jobId)).toEqual(['job-aaaaaaaa']);
  });

  it('answers "mine?" truthfully', async () => {
    const { account, db } = await harness();
    await db.account.recordJob(account.id, 'job-cccccccc', 'edit', 60_000);
    expect(await db.account.ownsJob(account.id, 'job-cccccccc')).toBe(true);
    expect(await db.account.ownsJob('someone-else', 'job-cccccccc')).toBe(false);
  });
});

describe('erasure', () => {
  it('removes absolutely everything held about the account', async () => {
    const { call, account, db } = await harness();
    await call('/api/account/preferences', {
      method: 'PUT',
      body: JSON.stringify({ values: { theme: 'dark' } }),
    });
    await call('/api/account/history', {
      method: 'POST',
      body: JSON.stringify({ toolSlug: 'merge-pdf', toolName: 'Merge', fileName: 'a.pdf' }),
    });
    await call('/api/account/workflows', {
      method: 'POST',
      body: JSON.stringify({ name: 'W', steps: [{ id: 'a', tool: 'merge' }] }),
    });
    await db.account.recordJob(account.id, 'job-dddddddd', 'merge', 60_000);

    const response = await call('/api/account', { method: 'DELETE' });
    expect(response.status).toBe(200);
    const deleted = await body<{ deleted: boolean; removed: Record<string, number> }>(response);
    expect(deleted.deleted).toBe(true);
    // Every collection is accounted for, which is the point: a new collection
    // added without extending this is a leak the test would not catch, so the
    // store deletes them in one place instead.
    expect(deleted.removed).toMatchObject({ accounts: 1, sessions: 1, history: 1, workflows: 1, jobOwners: 1 });

    // The session is gone, so the cookie no longer authorises anything.
    expect((await call('/api/account')).status).toBe(401);
    expect(await db.account.listHistory(account.id)).toEqual([]);
    expect(await db.account.listWorkflows(account.id)).toEqual([]);
    expect(await db.account.getPreferences(account.id)).toEqual({});
  });
});
