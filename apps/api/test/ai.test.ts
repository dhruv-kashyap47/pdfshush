/**
 * Managed-AI budget policy and HTTP surface.
 *
 * The provider is stubbed at the global `fetch` boundary, so these run with no
 * network and no real key -- the same posture the client-side AI tests take.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/http/app.js';
import { createContext, type ApiContext } from '../src/context.js';
import { WorkDirStore } from '../src/files/store.js';
import { MemoryQuotaStore } from '../src/quota/store.js';
import { subjectId } from '../src/quota/quota.js';
import { AiBudgetService, AiConcurrencyGuard } from '../src/ai/budget.js';
import type { CancelOutcome, JobQueue } from '../src/jobs/queue.js';
import type { JobPayload, JobStateSnapshot } from '../src/jobs/payload.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  while (cleanups.length > 0) await cleanups.pop()?.();
});

/**
 * The real global fetch, captured before any test stubs it. The provider stub
 * replaces `globalThis.fetch`, which the server uses for its outbound call; the
 * tests still need an unstubbed fetch to reach the test server itself.
 */
const httpFetch = globalThis.fetch.bind(globalThis);

class NoopQueue implements JobQueue {
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

const LIMITS = { dailyTokens: 1000, anonDailyTokens: 400, perMinute: 2, reserveTokens: 100 };

describe('AiBudgetService', () => {
  it('allows up to the per-minute ceiling, then refuses', async () => {
    const service = new AiBudgetService(new MemoryQuotaStore(), LIMITS);
    expect((await service.reserve('s', false)).allowed).toBe(true);
    expect((await service.reserve('s', false)).allowed).toBe(true);
    const denied = await service.reserve('s', false);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('per minute');
    expect(denied.retryAfterSeconds).toBe(60);
  });

  it('refuses over the anonymous daily ceiling and refunds the reservation', async () => {
    const store = new MemoryQuotaStore();
    const limits = { dailyTokens: 1000, anonDailyTokens: 400, perMinute: 100, reserveTokens: 100 };
    const service = new AiBudgetService(store, limits);
    for (let i = 0; i < 4; i += 1) {
      expect((await service.reserve('s', false)).allowed).toBe(true);
    }
    // Four reservations reach anonDailyTokens (400); the next crosses it.
    const denied = await service.reserve('s', false);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('Daily');
    // The failed attempt must not consume the day.
    expect(await store.read('ai:s:tok:d')).toBe(400);
    expect((await service.peek('s', false)).daily.used).toBe(400);
  });

  it('gives a signed-in subject the larger allowance', async () => {
    const service = new AiBudgetService(new MemoryQuotaStore(), LIMITS);
    expect((await service.reserve('acct', true)).limitTokens).toBe(1000);
    expect((await service.reserve('ip', false)).limitTokens).toBe(400);
  });

  it('settles the reservation down to the reported usage', async () => {
    const store = new MemoryQuotaStore();
    const service = new AiBudgetService(store, LIMITS);
    await service.reserve('s', true);
    expect(await store.read('ai:s:tok:d')).toBe(100);
    await service.settle('s', 15);
    expect(await store.read('ai:s:tok:d')).toBe(15);
    expect((await service.peek('s', true)).daily.used).toBe(15);
  });

  it('keeps the reservation when the provider reports no usage', async () => {
    const store = new MemoryQuotaStore();
    const service = new AiBudgetService(store, LIMITS);
    await service.reserve('s', true);
    await service.settle('s', undefined);
    expect(await store.read('ai:s:tok:d')).toBe(100);
  });
});

describe('AiConcurrencyGuard', () => {
  it('admits one turn per subject at a time', () => {
    const guard = new AiConcurrencyGuard();
    expect(guard.acquire('a')).toBe(true);
    expect(guard.acquire('a')).toBe(false);
    expect(guard.acquire('b')).toBe(true);
    guard.release('a');
    expect(guard.acquire('a')).toBe(true);
  });
});

const PEPPER = 'test-pepper';

async function harness(ai: Partial<ApiContext['config']['ai']> | undefined, quotaStore?: MemoryQuotaStore) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pdfshush-ai-'));
  const store = new WorkDirStore(dir);
  await store.init();
  const counters = quotaStore ?? new MemoryQuotaStore();
  const context = createContext({
    store,
    queue: new NoopQueue(),
    quotaStore: counters,
    pepper: PEPPER,
    logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {} } as never,
    config: {
      quota: { maxUploadBytes: 5 * 1024 * 1024 },
      ai: {
        enabled: false,
        provider: 'openai',
        model: '',
        apiKey: '',
        baseUrl: undefined,
        dailyTokens: 1000,
        anonDailyTokens: 400,
        perMinute: 2,
        maxOutputTokens: 100,
        ...ai,
      },
    } as never,
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
  return { url: (suffix: string) => `http://127.0.0.1:${port}${suffix}`, counters };
}

function sseBody(): string {
  return [
    'data: {"id":"1","choices":[{"index":0,"delta":{"content":"Hello"}}]}',
    '',
    'data: {"id":"1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
}

describe('POST /api/ai/chat', () => {
  it('answers 503 when managed AI is not configured', async () => {
    const { url } = await harness(undefined);
    const response = await httpFetch(url('/api/ai/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system: 's', messages: [{ role: 'user', text: 'hi' }] }),
    });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { code: string }).code).toBe('ai_disabled');
  });

  it('rejects an invalid payload', async () => {
    const { url } = await harness({ enabled: true, model: 'm', apiKey: 'k' });
    const response = await httpFetch(url('/api/ai/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system: 's', messages: [] }),
    });
    expect(response.status).toBe(400);
  });

  it('streams provider events and settles the budget to the reported usage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(sseBody(), { status: 200, headers: { 'content-type': 'text/event-stream' } })),
    );
    const { url, counters } = await harness({ enabled: true, model: 'gpt-4o-mini', apiKey: 'k' });

    const response = await httpFetch(url('/api/ai/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system: 's', messages: [{ role: 'user', text: 'hi' }], tools: [] }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('event: meta');
    expect(text).toContain('event: delta');
    expect(text).toContain('"Hello"');
    expect(text).toContain('event: done');

    const subject = subjectId('127.0.0.1', PEPPER);
    expect(await counters.read(`ai:${subject}:tok:d`)).toBe(15);
  });

  it('never echoes the managed key when a gateway quotes the request back', async () => {
    // A provider error embeds part of the response body. If a proxy answers
    // 401 while quoting the Authorization header, that body carries our key --
    // and this route streams it to the browser. It must not.
    const KEY = 'sk-managed-0123456789abcdefghij'; // public-hygiene: fixture
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: `invalid api key: ${KEY}` } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const { url } = await harness({ enabled: true, model: 'gpt-4o-mini', apiKey: KEY });

    const response = await httpFetch(url('/api/ai/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system: 's', messages: [{ role: 'user', text: 'hi' }] }),
    });
    // SSE headers open before the provider is called, so the failure is an
    // event rather than a status code.
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('event: error');
    expect(text).toContain('[redacted]');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('sk-managed');
  });

  it('refuses a second concurrent turn for the same subject', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate;
        return new Response(sseBody(), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }),
    );
    const { url } = await harness({ enabled: true, model: 'gpt-4o-mini', apiKey: 'k', perMinute: 10 });

    const body = JSON.stringify({ system: 's', messages: [{ role: 'user', text: 'hi' }] });
    const first = httpFetch(url('/api/ai/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    // Let the first request reach the provider before the second arrives.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await httpFetch(url('/api/ai/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(second.status).toBe(409);
    release?.();
    await (await first).text();
  });

  it('refuses over the daily allowance with 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(sseBody(), { status: 200, headers: { 'content-type': 'text/event-stream' } })),
    );
    // reserveTokens (maxOutputTokens) never fits under a 50-token day.
    const { url } = await harness({
      enabled: true,
      model: 'gpt-4o-mini',
      apiKey: 'k',
      anonDailyTokens: 50,
    });
    const response = await httpFetch(url('/api/ai/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system: 's', messages: [{ role: 'user', text: 'hi' }] }),
    });
    expect(response.status).toBe(429);
    expect(((await response.json()) as { code: string }).code).toBe('ai_budget');
  });
});
