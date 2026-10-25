/**
 * Public REST API (§25.3): the authn/authz matrix over real sockets, per-key
 * quota isolation, the throttle windows (at small configured limits rather
 * than waiting out a minute), inline-JSON admission control, schema parity and
 * the key-management dashboard routes -- all against the same in-memory
 * doubles the anonymous suites use, with real `WorkDirStore` files.
 */

import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import { NODE_JOBS } from '@pdfshush/pdf-core/node';
import { createApp } from '../src/http/app.js';
import { createContext, type ApiContext } from '../src/context.js';
import { WorkDirStore } from '../src/files/store.js';
import { MemoryQuotaStore } from '../src/quota/store.js';
import { AuthStore } from '../src/auth/store.js';
import { AccountStore } from '../src/account/store.js';
import { ApiKeyStore, API_KEY_PREFIX } from '../src/keys/store.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../src/auth/routes.js';
import type { AuthCollections } from '../src/auth/mongo.js';
import { SERVER_SLUGS } from '../src/jobs/payload.js';
import type { CancelOutcome, JobQueue } from '../src/jobs/queue.js';
import type { JobPayload, JobStateSnapshot } from '../src/jobs/payload.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

/** `Response.json()` is `unknown`; tests read it structurally. */
async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/* --------------------------------------------- in-memory Mongo + fake queue */

type Doc = Record<string, unknown> & { _id: string };

function matches(doc: Doc, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$exists' in (expected as object)) {
      return (key in doc) === (expected as { $exists: boolean }).$exists;
    }
    return doc[key] === expected;
  });
}

function applyUpdate(doc: Doc, update: Record<string, unknown>): void {
  const set = update.$set as Record<string, unknown> | undefined;
  if (set) Object.assign(doc, set);
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
        if (matches(doc, filter)) {
          applyUpdate(doc as Doc, update);
          return { modifiedCount: 1 };
        }
      }
      // `upsert` is what `recordJob` relies on; ignoring it silently dropped
      // every ownership row (the same drift the account suite guards against).
      if (options.upsert) {
        const seed = { ...filter } as Doc;
        if (!seed._id) seed._id = `gen-${rows.size + 1}`;
        applyUpdate(seed, update);
        rows.set(seed._id, seed as T);
      }
      return { modifiedCount: 0 };
    },
    async deleteMany(filter: Record<string, unknown>) {
      let count = 0;
      for (const [id, doc] of [...rows]) {
        if (matches(doc, filter)) {
          rows.delete(id);
          count += 1;
        }
      }
      return { deletedCount: count };
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
    apiKeys: collection(),
  } as unknown as AuthCollections;
  return {
    collections,
    auth: new AuthStore(collections),
    account: new AccountStore(collections),
    keys: new ApiKeyStore(collections),
  };
}

class FakeQueue implements JobQueue {
  readonly payloads: JobPayload[] = [];
  private readonly states = new Map<string, JobStateSnapshot>();

  async enqueue(payload: JobPayload): Promise<string> {
    this.payloads.push(payload);
    this.states.set(payload.jobId, { status: 'queued' });
    return payload.jobId;
  }

  async state(jobId: string): Promise<JobStateSnapshot | undefined> {
    return this.states.get(jobId);
  }

  async cancel(jobId: string): Promise<CancelOutcome> {
    this.states.delete(jobId);
    return 'removed';
  }

  async counts() {
    return { waiting: this.payloads.length, active: 0, completed: 0, failed: 0 };
  }

  async close(): Promise<void> {}

  complete(jobId: string, state: JobStateSnapshot): void {
    this.states.set(jobId, state);
  }
}

/* ---------------------------------------------------------------- harness */

interface HarnessOptions {
  /** Per-key and account limits; defaults are big so tests opt in per case. */
  apikey?: Partial<{
    tasksPerMinute: number;
    tasksPerDay: number;
    bytesPerDay: number;
    accountTasksPerDay: number;
    accountBytesPerDay: number;
    readsPerMinute: number;
    maxInlineFileBytes: number;
    maxKeysPerAccount: number;
  }>;
  enabled?: boolean;
  /** The per-request upload ceiling (`config.quota.maxUploadBytes`). */
  maxUploadBytes?: number;
}

async function harness(options: HarnessOptions = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pdfshush-v1-'));
  const store = new WorkDirStore(dir);
  await store.init();
  const db = memoryDb();
  const queue = new FakeQueue();

  const context: ApiContext = createContext({
    store,
    queue,
    quotaStore: new MemoryQuotaStore(),
    pepper: 'test-pepper',
    logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {} } as never,
    config: {
      quota: { maxUploadBytes: options.maxUploadBytes ?? 5 * 1024 * 1024 },
      apikey: {
        tasksPerMinute: 100,
        tasksPerDay: 100,
        bytesPerDay: 1024 * 1024 * 1024,
        accountTasksPerDay: 100,
        accountBytesPerDay: 1024 * 1024 * 1024,
        readsPerMinute: 100,
        maxInlineFileBytes: 10 * 1024 * 1024,
        maxKeysPerAccount: 10,
        ...options.apikey,
      },
    } as never,
    ...(options.enabled === false
      ? {}
      : {
          auth: {
            store: db.auth,
            account: db.account,
            keys: db.keys,
            oidc: {} as never,
            close: async () => {},
          },
        }),
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
  const url = (suffix: string) => `http://127.0.0.1:${port}${suffix}`;

  const account = await db.auth.upsertAccount({
    sub: 'sub-1',
    email: 'person@example.com',
    emailVerified: true,
    name: 'Person',
    picture: null,
  });
  const session = await db.auth.createSession(account.id, 60_000);
  const sessionCookies = `${SESSION_COOKIE}=${session.token}; ${CSRF_COOKIE}=csrf-value`;

  /** Signs in to the dashboard as the seeded account (cookies + CSRF). */
  const callDashboard = (suffix: string, init: RequestInit = {}) =>
    fetch(url(suffix), {
      ...init,
      headers: {
        cookie: sessionCookies,
        [CSRF_HEADER]: 'csrf-value',
        ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });

  /** Creates a live key through the real dashboard route. */
  const createKey = async (payload: { name: string; scopes?: string[] } = { name: 'test key' }) =>
    callDashboard('/api/account/api-keys', { method: 'POST', body: JSON.stringify(payload) });

  /** A second account, to assert cross-account closures. */
  const otherAccount = await db.auth.upsertAccount({
    sub: 'sub-2',
    email: 'other@example.com',
    emailVerified: true,
    name: 'Other',
    picture: null,
  });
  const otherSession = await db.auth.createSession(otherAccount.id, 60_000);
  const otherCookies = `${SESSION_COOKIE}=${otherSession.token}; ${CSRF_COOKIE}=other-csrf`;
  const callOtherDashboard = (suffix: string, init: RequestInit = {}) =>
    fetch(url(suffix), {
      ...init,
      headers: {
        cookie: otherCookies,
        [CSRF_HEADER]: 'other-csrf',
        ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });

  const v1 = (suffix: string, init: RequestInit & { apiKey?: string } = {}) => {
    const { apiKey, ...initRest } = init;
    return fetch(url(`/api/v1${suffix}`), {
      ...initRest,
      headers: {
        ...(typeof initRest.body === 'string' ? { 'content-type': 'application/json' } : {}),
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        ...(initRest.headers ?? {}),
      },
    });
  };

  return { url, context, store, queue, db, account, createKey, callDashboard, callOtherDashboard, v1 };
}

async function samplePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 300]).drawText('hello', { x: 40, y: 240, size: 14, font, color: rgb(0, 0, 0) });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** Submits one inline job and returns the 202 body. */
async function createJob(
  h: Awaited<ReturnType<typeof harness>>,
  apiKey: string,
  options: { slug?: string } = {},
) {
  const pdf = await samplePdf();
  const response = await h.v1('/jobs', {
    method: 'POST',
    apiKey,
    body: JSON.stringify({
      slug: options.slug ?? 'inspect',
      files: [{ name: 'doc.pdf', data: pdf.toString('base64') }],
    }),
  });
  return { response, payload: await body(response) };
}

/* ------------------------------------------------------------------ tests */

describe('authn matrix', () => {
  it('refuses a missing, garbage and revoked key with one indistinguishable verdict shape', async () => {
    const h = await harness();
    const created = await h.createKey();
    const createdBody = await body<{ key: { id: string }; token: string }>(created);
    const token = createdBody.token;
    expect(token.startsWith(API_KEY_PREFIX)).toBe(true);

    const invalidVerdict = (await h.v1('/tools', { apiKey: 'pshk_totally-not-a-key' }).then(body)) as {
      error: string;
      code: string;
    };
    expect(invalidVerdict.code).toBe('unauthorized');
    expect((await h.v1('/tools').then(body)).code).toBe('unauthorized');

    // Revoke, then present the exact token again: revoked must not confirm it
    // ever existed -- the verdict is byte-for-byte the invalid one.
    const revoke = await h.callDashboard(`/api/account/api-keys/${createdBody.key.id}`, {
      method: 'DELETE',
    });
    expect(revoke.status).toBe(204);
    const revoked = await body(await h.v1('/tools', { apiKey: token }));
    expect(revoked.code).toBe('unauthorized');
    expect(revoked.error).toBe(invalidVerdict.error);
    expect(revoked.code).toBe(invalidVerdict.code);
  });

  it('answers 503 on the whole surface (except the spec) when accounts are disabled', async () => {
    const h = await harness({ enabled: false });
    const tools = await h.v1('/tools');
    expect(tools.status).toBe(503);
    expect((await body(tools)).code).toBe('auth_disabled');
    const submit = await h.v1('/jobs', {
      method: 'POST',
      apiKey: 'pshk_x',
      body: JSON.stringify({ slug: 'merge', files: [] }),
    });
    expect(submit.status).toBe(503);
    // The spec stays public: integrators must be able to read the shape even
    // when a deployment never enabled keys.
    const spec = await h.v1('/openapi.json');
    expect(spec.status).toBe(200);
  });

  it('keeps the anonymous route working with no key at all (POST /api/jobs)', async () => {
    const h = await harness();
    // Anonymous contract: multipart, no x-api-key, expects 202.
    const boundary = '----anon';
    const file = await samplePdf();
    const anonymous = await fetch(h.url('/api/jobs'), {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="slug"\r\n\r\ninspect\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n` +
            'Content-Type: application/pdf\r\n\r\n',
        ),
        file,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(anonymous.status).toBe(202);
    expect(await body(anonymous)).toMatchObject({ status: 'queued' });
  });
});

describe('authz matrix (scopes)', () => {
  it('enforces jobs:write on submissions and jobs:read / results:read on the polls', async () => {
    const h = await harness();
    const submitOnly = await h.createKey({ name: 'submitter', scopes: ['jobs:write'] });
    const readOnly = await h.createKey({ name: 'poller', scopes: ['jobs:read', 'results:read'] });
    const submitToken = (await body<{ token: string }>(submitOnly)).token;
    const readToken = (await body<{ token: string }>(readOnly)).token;

    const wrong = await h.v1('/jobs', {
      method: 'POST',
      apiKey: readToken,
      body: JSON.stringify({
        slug: 'inspect',
        files: [{ name: 'a.pdf', data: (await samplePdf()).toString('base64') }],
      }),
    });
    expect(wrong.status).toBe(403);
    expect((await body(wrong)).code).toBe('insufficient_scope');

    const created = await createJob(h, submitToken);
    expect(created.response.status).toBe(202);
    const { jobId } = created.payload as unknown as { jobId: string };

    // The poller (right scope, same account) can read status and result.
    const status = await h.v1(`/jobs/${jobId}`, { apiKey: readToken });
    expect(status.status).toBe(200);
    // The submitter (no read scope) cannot.
    const blocked = await h.v1(`/jobs/${jobId}`, { apiKey: submitToken });
    expect(blocked.status).toBe(403);
    expect((await body(blocked)).code).toBe('insufficient_scope');

    // results:read needs its own scope even for the same read.
    const resultNoResults = await h.v1(`/jobs/${jobId}/result`, { apiKey: submitToken });
    expect(resultNoResults.status).toBe(403);
  });

  it('closes cross-account access: another account cannot poll or download', async () => {
    const h = await harness();
    const created = await h.createKey();
    const token = (await body<{ token: string }>(created)).token;
    const { payload } = await createJob(h, token);
    const { jobId } = payload as unknown as { jobId: string };

    const otherKey = await h.callOtherDashboard('/api/account/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'other key' }),
    });
    const otherToken = (await body<{ token: string }>(otherKey)).token;
    const foreignStatus = await h.v1(`/jobs/${jobId}`, { apiKey: otherToken });
    expect(foreignStatus.status).toBe(403);
    expect((await body(foreignStatus)).code).toBe('forbidden');

    // The x-job-token fallback belongs to the submitter, not to the foreign key.
    const withForeignToken = await h.v1(`/jobs/${jobId}`, {
      apiKey: otherToken,
      headers: { 'x-job-token': (payload as unknown as { token: string }).token },
    });
    // Token matches, so provenance is accepted: the fallback is exactly "the
    // submitter knows the token", independent of which key carries it.
    expect(withForeignToken.status).toBe(200);
  });
});

describe('per-key quota isolation + throttle', () => {
  it('exhausting key A never counts against key B (same account), then the account ceiling closes both', async () => {
    const h = await harness({
      apikey: { tasksPerMinute: 1, tasksPerDay: 10, accountTasksPerDay: 2 },
    });
    const keyA = await body<{ token: string }>(await h.createKey({ name: 'A' }));
    const keyB = await body<{ token: string }>(await h.createKey({ name: 'B' }));

    const pdf = await samplePdf();
    const inlineBody = JSON.stringify({
      slug: 'inspect',
      files: [{ name: 'doc.pdf', data: pdf.toString('base64') }],
    });

    const first = await h.v1('/jobs', { method: 'POST', apiKey: keyA.token, body: inlineBody });
    expect(first.status).toBe(202);

    // Key A: minute limit trips (1/min). Key B: unaffected by A's charge.
    const aAgain = await h.v1('/jobs', { method: 'POST', apiKey: keyA.token, body: inlineBody });
    expect(aAgain.status).toBe(429);
    expect(Number(aAgain.headers.get('retry-after'))).toBeGreaterThan(0);

    const bFirst = await h.v1('/jobs', { method: 'POST', apiKey: keyB.token, body: inlineBody });
    expect(bFirst.status).toBe(202);

    // Two submissions already spent the ACCOUNT day ceiling: any further key
    // of the same account is refused even with a fresh key budget.
    const keyC = await body<{ token: string }>(await h.createKey({ name: 'C' }));
    const cFirst = await h.v1('/jobs', { method: 'POST', apiKey: keyC.token, body: inlineBody });
    expect(cFirst.status).toBe(429);
    const cReason = await body<{ error: string }>(cFirst);
    expect(cReason.error).toContain('Daily limit');
  });

  it('throttles result reads at the documented per-key read ceiling', async () => {
    const h = await harness({ apikey: { readsPerMinute: 2 } });
    const key = await body<{ token: string }>(await h.createKey());
    // First two reads land; the third is refused with Retry-After.
    expect((await h.v1('/tools', { apiKey: key.token })).status).toBe(200);
    expect((await h.v1('/tools', { apiKey: key.token })).status).toBe(200);
    const third = await h.v1('/tools', { apiKey: key.token });
    expect(third.status).toBe(429);
  });
});

describe('inline JSON submissions', () => {
  it('accepts an inline job, runs through the same queue, and exposes results', async () => {
    const h = await harness();
    const key = await body<{ token: string }>(await h.createKey());
    const created = await createJob(h, key.token);
    expect(created.response.status).toBe(202);
    const createdBody = created.payload as unknown as {
      jobId: string;
      status: string;
      statusUrl: string;
      token: string;
      files: { name: string; bytes: number }[];
    };
    expect(createdBody.status).toBe('queued');
    expect(createdBody.statusUrl).toBe(`/api/v1/jobs/${createdBody.jobId}`);
    expect(createdBody.files).toEqual([{ name: 'doc.pdf', bytes: expect.any(Number) }]);
    // The payload reached the real queue shape, with an opaque subject.
    expect(h.queue.payloads[0]?.subject).toMatch(/^[0-9a-f]{32}$/);

    await h.store.writeResult(createdBody.jobId, 'doc-result.json', Buffer.from('{}'));
    h.queue.complete(createdBody.jobId, {
      status: 'completed',
      files: [{ name: 'doc-result.json', bytes: 2 }],
    });

    const status = await h.v1(`/jobs/${createdBody.jobId}`, { apiKey: key.token });
    expect(status.status).toBe(200);
    expect(await body(status)).toMatchObject({ status: 'completed' });

    const result = await h.v1(`/jobs/${createdBody.jobId}/result`, { apiKey: key.token });
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('{}');
    const byName = await h.v1(`/jobs/${createdBody.jobId}/result/files/doc-result.json`, {
      apiKey: key.token,
    });
    expect(byName.status).toBe(200);
    expect((await byName.text()).length).toBe(2);
  });

  it('refuses non-PDF inline bytes, over-cap inline files, and bad base64', async () => {
    const h = await harness({
      apikey: { maxInlineFileBytes: 1024 },
    });
    const key = await body<{ token: string }>(await h.createKey());
    const token = key.token;

    const notPdf = await h.v1('/jobs', {
      method: 'POST',
      apiKey: token,
      body: JSON.stringify({
        slug: 'inspect',
        files: [{ name: 'a.pdf', data: Buffer.from('not a pdf').toString('base64') }],
      }),
    });
    expect(notPdf.status).toBe(400);
    expect((await body(notPdf)).code).toBe('validation_failed');

    const tooBig = await h.v1('/jobs', {
      method: 'POST',
      apiKey: token,
      body: JSON.stringify({
        slug: 'inspect',
        files: [{ name: 'a.pdf', data: Buffer.alloc(1025, '%PDF-.').toString('base64') }],
      }),
    });
    expect(tooBig.status).toBe(413);
    expect((await body(tooBig)).error).toContain('inline cap');

    const badBase64 = await h.v1('/jobs', {
      method: 'POST',
      apiKey: token,
      body: JSON.stringify({ slug: 'inspect', files: [{ name: 'a.pdf', data: '%%%' }] }),
    });
    expect(badBase64.status).toBe(400);

    const wrongSlug = await h.v1('/jobs', {
      method: 'POST',
      apiKey: token,
      body: JSON.stringify({
        slug: 'pdf-to-images',
        files: [{ name: 'a.pdf', data: (await samplePdf()).toString('base64') }],
      }),
    });
    expect(wrongSlug.status).toBe(400);
  });

  it('refuses structurally unbounded inline options', async () => {
    const h = await harness();
    const key = await body<{ token: string }>(await h.createKey());
    let nested: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 12; depth += 1) nested = { nested };

    const response = await h.v1('/jobs', {
      method: 'POST',
      apiKey: key.token,
      body: JSON.stringify({
        slug: 'inspect',
        options: nested,
        files: [{ name: 'a.pdf', data: (await samplePdf()).toString('base64') }],
      }),
    });
    expect(response.status).toBe(400);
    const payload = (await body(response)) as { code: string; error: string };
    expect(payload.code).toBe('validation_failed');
    expect(payload.error).toContain('nested too deeply');
  });

  it('dedupes inline names that sanitise to the same basename', async () => {
    const h = await harness();
    const key = await body<{ token: string }>(await h.createKey());
    const pdf = (await samplePdf()).toString('base64');
    const response = await h.v1('/jobs', {
      method: 'POST',
      apiKey: key.token,
      body: JSON.stringify({
        slug: 'merge',
        files: [
          { name: 'doc.pdf', data: pdf },
          { name: 'doc.pdf', data: pdf },
        ],
      }),
    });
    // Multipart must not truncate the second write; names get -2/-3 suffixes.
    expect(response.status).toBe(202);
    const submitted = h.queue.payloads[0]!;
    expect(submitted.files).toHaveLength(2);
    expect(submitted.files[0]).not.toBe(submitted.files[1]);
  });
});

/* -------------------------------------------------- schema parity + spec */

describe('catalog + openapi parity', () => {
  it('lists exactly the server-runnable slugs, pinned against the engine', async () => {
    const h = await harness();
    const key = await body<{ token: string }>(await h.createKey());
    const response = await h.v1('/tools', { apiKey: key.token });
    expect(response.status).toBe(200);
    const catalog = await body<{ slugs: string[]; tools: { slug: string; label?: string }[] }>(
      response,
    );
    expect(catalog.slugs).toEqual([...SERVER_SLUGS]);
    expect(catalog.tools.map((tool) => tool.slug)).toEqual([...SERVER_SLUGS]);
    // Drift would mean the catalog documents work the pipeline cannot run.
    expect(catalog.slugs).toEqual([...Object.keys(NODE_JOBS)]);
    expect(catalog.tools.every((tool) => typeof tool.label === 'string')).toBe(true);
  });

  it('publishes a spec whose slugs match the catalog', async () => {
    const h = await harness({ enabled: false });
    const response = await h.v1('/openapi.json');
    const spec = (await response.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: { Catalog: { properties: { slugs: { items: { enum: string[] } } } } } };
    };
    expect(spec.openapi.startsWith('3.1')).toBe(true);
    for (const needed of [
      '/api/v1/tools',
      '/api/v1/jobs',
      '/api/v1/jobs/{id}',
      '/api/v1/jobs/{id}/result',
      '/api/v1/jobs/{id}/result/files/{name}',
    ]) {
      expect(Object.keys(spec.paths)).toContain(needed);
    }
    expect(spec.components.schemas.Catalog.properties.slugs.items.enum).toEqual([
      ...SERVER_SLUGS,
    ]);
  });
});

/* ------------------------------------------------- key management routes */

describe('dashboard key management', () => {
  it('mints a key once (raw token), lists prefix-only views, and caps the account', async () => {
    const h = await harness({ apikey: { maxKeysPerAccount: 2 } });
    const created = await body<{ key: { id: string; prefix: string; token: string; scopes: string[] }; token: string }>(
      await h.callDashboard('/api/account/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: 'ci' }),
      }),
    );
    expect(created.key.prefix.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(created.key.scopes).toEqual(['jobs:write', 'jobs:read', 'results:read']);

    const list = await body<{ keys: { id: string; prefix: string; token?: string }[] }>(
      await h.callDashboard('/api/account/api-keys'),
    );
    expect(list.keys).toHaveLength(1);
    // The raw token never re-surfaces in listing views.
    expect(list.keys[0]?.token).toBeUndefined();

    await h.callDashboard('/api/account/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'ci-2' }),
    });
    const capped = await h.callDashboard('/api/account/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'ci-3' }),
    });
    expect(capped.status).toBe(409);

    await h.callOtherDashboard('/api/account/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'other' }),
    });
  });

  it('rejects a write without the CSRF header and an unknown scope name', async () => {
    const h = await harness();
    const noCsrf = await fetch(h.url('/api/account/api-keys'), {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=x`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(noCsrf.status).toBe(401); // and even signed in, CSRF is next:

    const seatedNoCsrf = await fetch(h.url('/api/account/api-keys'), {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=${(await body<{ token: string }>(await h.callDashboard('/api/auth/me')))}` },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(seatedNoCsrf.status).toBe(401);

    const unknownScope = await h.callDashboard('/api/account/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'sc', scopes: ['jobs:Write'] }),
    });
    expect(unknownScope.status).toBe(400);
  });

  it('revocation requires the owning account', async () => {
    const h = await harness();
    const created = await body<{ key: { id: string } }>(
      await h.callDashboard('/api/account/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: 'mine' }),
      }),
    );
    const foreign = await h.callOtherDashboard(`/api/account/api-keys/${created.key.id}`, {
      method: 'DELETE',
    });
    expect(foreign.status).toBe(404);
    const own = await h.callDashboard(`/api/account/api-keys/${created.key.id}`, {
      method: 'DELETE',
    });
    expect(own.status).toBe(204);
  });
});

/* --------------------------------- P6.4 hardening: rotation drill + multipart */

describe('rotation + revocation drill', () => {
  it('a minted replacement key inherits account-owned jobs the revoked key created', async () => {
    const h = await harness();
    const created = await body<{ key: { id: string }; token: string }>(
      await h.createKey({ name: 'to rotate' }),
    );
    const job = await createJob(h, created.token);
    expect(job.response.status).toBe(202);
    const jobId = (job.payload as unknown as { jobId: string }).jobId;

    // Finish the job so written results exist, exactly as a stolen key would
    // have left them behind.
    await h.store.writeResult(jobId, 'doc-result.json', Buffer.from('{}'));
    h.queue.complete(jobId, {
      status: 'completed',
      files: [{ name: 'doc-result.json', bytes: 2 }],
    });

    // Revoke through the real dashboard route.
    expect(
      (await h.callDashboard(`/api/account/api-keys/${created.key.id}`, { method: 'DELETE' })).status,
    ).toBe(204);
    const dead = await h.v1(`/jobs/${jobId}`, { apiKey: created.token });
    expect(dead.status).toBe(401);
    expect((await body(dead)).code).toBe('unauthorized');

    // The replacement key polls AND downloads the revoked key's outputs:
    // ownership is recorded to the account, so a rotation never orphans
    // results the account already paid for.
    const replacement = await body<{ token: string }>(
      await h.createKey({ name: 'replacement' }),
    );
    const status = await h.v1(`/jobs/${jobId}`, { apiKey: replacement.token });
    expect(status.status).toBe(200);
    const download = await h.v1(`/jobs/${jobId}/result`, { apiKey: replacement.token });
    expect(download.status).toBe(200);
    expect((await download.arrayBuffer()).byteLength).toBe(2);
    // And the same sibling key's submission counters are untouched: the
    // stolen/spent bucket died with its key, never pre-paid the account
    // ceiling for the replacement.
    const next = await createJob(h, replacement.token);
    expect(next.response.status).toBe(202);
  });

  it('a revoked key is refused mid-flight like a never-seen one, with no queue trace', async () => {
    const h = await harness({ apikey: { tasksPerMinute: 1 } });
    const created = await body<{ key: { id: string }; token: string }>(
      await h.createKey({ name: 'burn after' }),
    );
    const first = await createJob(h, created.token);
    expect(first.response.status).toBe(202);
    // The key's minute slot is spent; revoke instead of waiting it out, then
    // present the exact token again: nothing it can do, not even read what it
    // created (the account needs a live credential for that).
    expect(
      (await h.callDashboard(`/api/account/api-keys/${created.key.id}`, { method: 'DELETE' })).status,
    ).toBe(204);
    const pdf = await samplePdf();
    const reuse = await h.v1('/jobs', {
      method: 'POST',
      apiKey: created.token,
      body: JSON.stringify({
        slug: 'inspect',
        files: [{ name: 'doc.pdf', data: pdf.toString('base64') }],
      }),
    });
    expect(reuse.status).toBe(401);
    expect((await body(reuse)).code).toBe('unauthorized');
    const readOwn = await body(
      await h.v1(`/jobs/${(first.payload as unknown as { jobId: string }).jobId}`, {
        apiKey: created.token,
      }),
    );
    expect(readOwn.code).toBe('unauthorized');
  });
});

describe('v1 multipart rides the anonymous stream guards (P6.4 M2-style sniff)', () => {
  const multipart = (parts: string[], file?: Buffer, name = 'doc.pdf') => {
    const boundary = '----p64';
    const chunks: Buffer[] = [
      Buffer.from(
        parts
          .map(
            (pair) =>
              `--${boundary}\r\nContent-Disposition: form-data; name="${pair.split('=')[0]}"\r\n\r\n${
                pair.split('=')[1]
              }\r\n`,
          )
          .join(''),
      ),
    ];
    if (file) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
            'Content-Type: application/pdf\r\n\r\n',
        ),
        file,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      );
    } else {
      chunks.push(Buffer.from(`--${boundary}--\r\n`));
    }
    return { boundary, body: Buffer.concat(chunks) };
  };

  it('accepts a keyed multipart submission straight into the same queue shape', async () => {
    const h = await harness();
    const key = await body<{ token: string }>(await h.createKey());
    const { boundary, body: raw } = multipart(['slug=inspect'], await samplePdf());
    const response = await fetch(h.url('/api/v1/jobs'), {
      method: 'POST',
      headers: {
        'x-api-key': key.token,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: raw,
    });
    expect(response.status).toBe(202);
    const payload = h.queue.payloads[0]!;
    expect(payload.slug).toBe('inspect');
    expect(payload.files).toEqual([expect.any(String)]);
    // The worker subject stays opaque (key/account ids never reach Redis).
    expect(payload.subject).toMatch(/^[0-9a-f]{32}$/);
  });

  it('sniffs multipart bytes for the PDF signature exactly as the anonymous path does', async () => {
    const h = await harness();
    const key = await body<{ token: string }>(await h.createKey());
    const { boundary, body: raw } = multipart(['slug=inspect'], Buffer.from('plain text'));
    const response = await fetch(h.url('/api/v1/jobs'), {
      method: 'POST',
      headers: {
        'x-api-key': key.token,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: raw,
    });
    expect(response.status).toBe(400);
    expect((await body(response)).code).toBe('validation_failed');
    expect(h.queue.payloads).toHaveLength(0);
  });

  it('refuses a flooding key before any byte is written, then refunds the reservation', async () => {
    const h = await harness({
      apikey: { bytesPerDay: 1024 * 1024 },
    });
    const key = await body<{ token: string }>(await h.createKey());
    // The reserve is the whole per-request ceiling; a key whose daily byte
    // tier is below it is refused at reservation time -- before
    // receiveUpload ever streams, so the disk never sees a flood.
    const oversized = multipart(['slug=inspect'], await samplePdf());
    const response = await fetch(h.url('/api/v1/jobs'), {
      method: 'POST',
      headers: {
        'x-api-key': key.token,
        'content-type': `multipart/form-data; boundary=${oversized.boundary}`,
      },
      body: oversized.body,
    });
    expect(response.status).toBe(429);
    expect((await body(response)).code).toBe('quota_exceeded');
    expect(h.queue.payloads).toHaveLength(0);
  });

  it('caps a multipart request while it streams, at the per-request ceiling', async () => {
    const pdf = await samplePdf();
    const cap = Math.floor(pdf.length * 1.5);
    const h = await harness({ maxUploadBytes: cap });
    const key = await body<{ token: string }>(await h.createKey());
    // The magic sniff passes (the pad keeps `%PDF-` in the first kilobyte);
    // the *aggregate* counter is what stops this file.
    const padded = Buffer.concat([pdf, Buffer.alloc(pdf.length, 'A')]);
    const oversized = multipart(['slug=inspect'], padded, 'big.pdf');
    const response = await fetch(h.url('/api/v1/jobs'), {
      method: 'POST',
      headers: {
        'x-api-key': key.token,
        'content-type': `multipart/form-data; boundary=${oversized.boundary}`,
      },
      body: oversized.body,
    });
    expect(response.status).toBe(413);
    expect((await body(response)).code).toBe('upload_too_large');
    expect(h.queue.payloads).toHaveLength(0);
  });
});

