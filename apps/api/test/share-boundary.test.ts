/**
 * The second-party access boundary: a job's result is reachable only through
 * the capability handed out at creation (`x-job-token`), so everything that
 * could leak, replay or outlive that capability is pinned here.
 *
 * Two defects motivated this file (session 5):
 *
 *  - neither the job-state JSON nor a result download carried any cache
 *    directive, so a shared HTTP cache could store a completed document at a
 *    URL that contains no secret and replay it to a caller that never had the
 *    token -- including after the job's retention window;
 *  - the download's `Content-Disposition` was built from the filename the queue
 *    reported instead of re-sanitising it at the header, so a `"` in a stored
 *    name produced a malformed quoted-string.
 *
 * The revocation case is a repro for a decision, not a fixed defect: a finished
 * job answers DELETE with 409 and keeps serving its result. See FINDINGS.md.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.js';
import { createContext, jobToken, type ApiContext } from '../src/context.js';
import { WorkDirStore } from '../src/files/store.js';
import { MemoryQuotaStore } from '../src/quota/store.js';
import { tokensMatch } from '../src/quota/quota.js';
import type { CancelOutcome, JobQueue } from '../src/jobs/queue.js';
import type { JobPayload, JobStateSnapshot } from '../src/jobs/payload.js';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

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
    const snapshot = this.states.get(jobId);
    if (!snapshot) return 'unknown';
    if (snapshot.status === 'active') return 'running';
    if (snapshot.status === 'completed' || snapshot.status === 'failed') return 'finished';
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

async function harness() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pdfshush-share-'));
  const store = new WorkDirStore(dir);
  await store.init();
  const queue = new FakeQueue();
  const context: ApiContext = createContext({
    store,
    queue,
    quotaStore: new MemoryQuotaStore(),
    pepper: 'test-pepper',
    logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {} } as never,
    config: { quota: { maxUploadBytes: 5 * 1024 * 1024 } } as never,
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
      }).then(async () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })),
  );
  const url = (suffix: string) => `http://127.0.0.1:${port}${suffix}`;
  return { context, queue, store, url };
}

/** A completed one-page job with one PDF result on disk. */
async function completedJob(
  h: Awaited<ReturnType<typeof harness>>,
  options: { name?: string; body?: Buffer } = {},
) {
  const jobId = 'a'.repeat(32);
  const name = options.name ?? 'out.pdf';
  const body = options.body ?? Buffer.from('%PDF-1.7 result-bytes');
  await h.store.prepareJob(jobId);
  await h.store.writeResult(jobId, name, body);
  h.queue.complete(jobId, { status: 'completed', files: [{ name, bytes: body.length }] });
  return { jobId, name, body, token: jobToken(h.context.pepper, jobId) };
}

async function samplePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 300]).drawText('hello', { x: 40, y: 240, size: 14, font, color: rgb(0, 0, 0) });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

describe('job capability tokens', () => {
  it('issues 256 bits of token material that is stable per job and pepper', () => {
    const jobId = 'c'.repeat(32);
    const token = jobToken('pepper-a', jobId);

    // 64 hex characters = 32 bytes = 256 bits. The token is derived from the
    // server's CSPRNG pepper (context.ts:resolvePepper), never from the job id.
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(jobToken('pepper-a', jobId)).toBe(token);
    expect(jobToken('pepper-b', jobId)).not.toBe(token);
    expect(jobToken('pepper-a', 'd'.repeat(32))).not.toBe(token);
  });

  it('compares every candidate, including different-length ones', () => {
    const token = jobToken('pepper-a', 'e'.repeat(32));
    expect(tokensMatch(token, token)).toBe(true);
    // Same length, one different byte.
    expect(tokensMatch(token.slice(0, -1) + (token.endsWith('0') ? '1' : '0'), token)).toBe(false);
    // Different length must be a rejection, not a crash in timingSafeEqual.
    expect(tokensMatch('', token)).toBe(false);
    expect(tokensMatch(token + '00', token)).toBe(false);
    expect(tokensMatch('0'.repeat(64), token)).toBe(false);
  });

  it('never accepts the token from the query string', async () => {
    const h = await harness();
    const job = await completedJob(h);
    // A query string is the one place a capability must never live: it is what
    // Referer sends and what logs and proxies keep. Only the header counts.
    const response = await fetch(h.url(`/api/jobs/${job.jobId}/files/out.pdf?token=${job.token}`));
    expect(response.status).toBe(403);
  });
});

describe('second-party access to a result', () => {
  it('requires the ownership token for state and for the file', async () => {
    const h = await harness();
    const job = await completedJob(h);

    expect((await fetch(h.url(`/api/jobs/${job.jobId}`))).status).toBe(403);
    expect((await fetch(h.url(`/api/jobs/${job.jobId}/files/out.pdf`))).status).toBe(403);
    // No partial body: the refusal happens before the stream is opened.
    expect(await (await fetch(h.url(`/api/jobs/${job.jobId}/files/out.pdf`))).text()).not.toContain(
      'result-bytes',
    );

    const ok = await fetch(h.url(`/api/jobs/${job.jobId}/files/out.pdf`), {
      headers: { 'x-job-token': job.token },
    });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('%PDF-1.7 result-bytes');
  });

  it('refuses a token minted for a different job (IDOR)', async () => {
    const h = await harness();
    const mine = await completedJob(h);
    const theirsId = 'b'.repeat(32);
    h.queue.complete(theirsId, { status: 'completed', files: [{ name: 'secret.pdf', bytes: 4 }] });

    const read = await fetch(h.url(`/api/jobs/${theirsId}`), {
      headers: { 'x-job-token': mine.token },
    });
    expect(read.status).toBe(403);
    const file = await fetch(h.url(`/api/jobs/${theirsId}/files/secret.pdf`), {
      headers: { 'x-job-token': mine.token },
    });
    expect(file.status).toBe(403);
  });

  it('does not reveal whether an unknown job exists', async () => {
    const h = await harness();
    const unknown = 'f'.repeat(32);
    const response = await fetch(h.url(`/api/jobs/${unknown}`), {
      headers: { 'x-job-token': '0'.repeat(64) },
    });
    // 403 for both "wrong token" and "no such job": a would-be enumerator
    // cannot tell the two apart, because authorisation comes first.
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('forbidden');
  });

  it('rejects a traversal in the job id before touching the queue', async () => {
    const h = await harness();
    const response = await fetch(h.url('/api/jobs/..%2F..%2Fcontrol%2Fpepper'), {
      headers: { 'x-job-token': '0'.repeat(64) },
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe('validation_failed');
  });

  it('rejects a traversal in the file name', async () => {
    const h = await harness();
    const job = await completedJob(h);
    for (const name of [
      '..%2F..%2Finput%2Fout.pdf',
      encodeURIComponent('../../input/out.pdf'),
      encodeURIComponent('..\\..\\input\\out.pdf'),
    ]) {
      const response = await fetch(h.url(`/api/jobs/${job.jobId}/files/${name}`), {
        headers: { 'x-job-token': job.token },
      });
      expect(response.status, name).toBe(404);
      expect(((await response.json()) as { code: string }).code).toBe('result_not_found');
    }
  });

  it('refuses a file that belongs to another job', async () => {
    const h = await harness();
    const mine = await completedJob(h);
    const otherId = 'b'.repeat(32);
    await h.store.prepareJob(otherId);
    await h.store.writeResult(otherId, 'secret.pdf', Buffer.from('secret'));
    h.queue.complete(otherId, { status: 'completed', files: [{ name: 'secret.pdf', bytes: 6 }] });

    // My own job, my own token, but a name that only exists under another job.
    const response = await fetch(h.url(`/api/jobs/${mine.jobId}/files/secret.pdf`), {
      headers: { 'x-job-token': mine.token },
    });
    expect(response.status).toBe(404);
  });

  it('answers 404 result_not_found once the files are gone (expiry)', async () => {
    const h = await harness();
    const job = await completedJob(h);
    await rm(path.join(h.store.root, 'jobs', job.jobId, 'output'), { recursive: true, force: true });

    const response = await fetch(h.url(`/api/jobs/${job.jobId}/files/out.pdf`), {
      headers: { 'x-job-token': job.token },
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe('result_not_found');
  });

  it('blocks access immediately when a queued job is cancelled', async () => {
    const h = await harness();
    const jobId = 'b'.repeat(32);
    await h.store.prepareJob(jobId);
    await h.store.writeResult(jobId, 'early.pdf', Buffer.from('%PDF-1.7 early'));
    h.queue.complete(jobId, { status: 'queued' });
    const token = jobToken(h.context.pepper, jobId);

    const cancelled = await fetch(h.url(`/api/jobs/${jobId}`), {
      method: 'DELETE',
      headers: { 'x-job-token': token },
    });
    expect(cancelled.status).toBe(200);

    expect((await fetch(h.url(`/api/jobs/${jobId}`), { headers: { 'x-job-token': token } })).status).toBe(
      404,
    );
    expect(
      (await fetch(h.url(`/api/jobs/${jobId}/files/early.pdf`), { headers: { 'x-job-token': token } }))
        .status,
    ).toBe(404);
  });

  // Desired behaviour, not shipped behaviour: a finished job's result stays
  // downloadable until the retention janitor runs, because DELETE answers 409
  // "already finished" and never removes the directory. Fixing it changes the
  // public DELETE contract, so it is a decision (FINDINGS.md, PDF-SHARE-002).
  it.fails('blocks access immediately when a completed job is revoked', async () => {
    const h = await harness();
    const job = await completedJob(h);

    const revoked = await fetch(h.url(`/api/jobs/${job.jobId}`), {
      method: 'DELETE',
      headers: { 'x-job-token': job.token },
    });
    expect(revoked.status).toBe(200);

    const after = await fetch(h.url(`/api/jobs/${job.jobId}/files/out.pdf`), {
      headers: { 'x-job-token': job.token },
    });
    expect(after.status).toBe(404);
  });
});

describe('response contract for a second party', () => {
  it('labels a PDF as a PDF and an attachment', async () => {
    const h = await harness();
    const job = await completedJob(h);
    const response = await fetch(h.url(`/api/jobs/${job.jobId}/files/out.pdf`), {
      headers: { 'x-job-token': job.token },
    });
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="out.pdf"');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('tells every cache not to store a job response', async () => {
    const h = await harness();
    const job = await completedJob(h);

    const cases: [string, RequestInit, number][] = [
      [`/api/jobs/${job.jobId}/files/out.pdf`, { headers: { 'x-job-token': job.token } }, 200],
      [`/api/jobs/${job.jobId}`, { headers: { 'x-job-token': job.token } }, 200],
      [`/api/jobs/${job.jobId}`, {}, 403],
      [`/api/jobs/${job.jobId}/files/missing.pdf`, { headers: { 'x-job-token': job.token } }, 404],
    ];

    for (const [suffix, init, status] of cases) {
      const response = await fetch(h.url(suffix), init);
      expect(response.status, suffix).toBe(status);
      // The URL carries no secret (the capability is a header), so without
      // `no-store` a shared cache could key on the URL alone and replay the
      // document to anyone -- and keep replaying it after expiry or revocation.
      expect(response.headers.get('cache-control'), suffix).toContain('no-store');
      expect(response.headers.get('vary'), suffix).toContain('x-job-token');
    }
  });

  it('tells every cache not to store a v1 job response either', async () => {
    const h = await harness();
    // Accounts are disabled in this harness, so the route answers 503 -- the
    // point is that the no-store middleware runs ahead of auth and therefore
    // covers the authenticated result routes mounted behind it.
    const response = await fetch(h.url('/api/v1/jobs/' + 'a'.repeat(32)));
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('vary')).toContain('x-job-token');
  });

  it('does not grant cross-origin reads to a foreign origin', async () => {
    const h = await harness();
    const job = await completedJob(h);
    const response = await fetch(h.url(`/api/jobs/${job.jobId}/files/out.pdf`), {
      headers: { 'x-job-token': job.token, origin: 'https://evil.example' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('never echoes the token in a response header', async () => {
    const h = await harness();
    const job = await completedJob(h);
    const responses = [
      await fetch(h.url(`/api/jobs/${job.jobId}`), { headers: { 'x-job-token': job.token } }),
      await fetch(h.url(`/api/jobs/${job.jobId}/files/out.pdf`), {
        headers: { 'x-job-token': job.token },
      }),
    ];
    for (const response of responses) {
      let seen = false;
      response.headers.forEach((value) => {
        if (value.includes(job.token)) seen = true;
      });
      expect(seen).toBe(false);
    }
  });

  it('answers HEAD with the download headers and no body', async () => {
    const h = await harness();
    const job = await completedJob(h);
    const response = await fetch(h.url(`/api/jobs/${job.jobId}/files/out.pdf`), {
      method: 'HEAD',
      headers: { 'x-job-token': job.token },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(job.body.length));
    expect(await response.text()).toBe('');
  });

  it('still accepts the token as a header after a queue-state read fails', async () => {
    // Guard against a "fix" that moves authorisation behind the state lookup:
    // an unknown/expired job must be a 404 *after* a valid token, not a leak of
    // the state table to an unauthenticated caller.
    const h = await harness();
    const token = jobToken(h.context.pepper, 'a'.repeat(32));
    const response = await fetch(h.url(`/api/jobs/${'a'.repeat(32)}`), {
      headers: { 'x-job-token': token },
    });
    expect(response.status).toBe(404);
  });
});

describe('upload boundary stays intact for the capability flow', () => {
  it('sanitises two names that collapse to one basename', async () => {
    const h = await harness();
    const pdf = await samplePdf();
    const boundary = '----shareboundary';
    const chunks: Buffer[] = [
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="slug"\r\n\r\nmerge\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a b.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      pdf,
      Buffer.from('\r\n'),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a_b.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      pdf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ];
    const response = await fetch(h.url('/api/jobs'), {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat(chunks),
    });
    expect(response.status).toBe(202);
    const payload = (await response.json()) as { files: { name: string }[] };
    // Distinct stored names: the second upload must not truncate the first, or
    // the job silently processes one document twice.
    expect(new Set(payload.files.map((file) => file.name)).size).toBe(payload.files.length);
  });
});
