/**
 * HTTP surface, exercised end to end over a real socket with a fake queue --
 * no Redis, no supertest dependency.
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
import type { JobQueue } from '../src/jobs/queue.js';
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

  async cancel(jobId: string): Promise<boolean> {
    return this.states.delete(jobId);
  }

  async counts() {
    return { waiting: this.payloads.length, active: 0, completed: 0, failed: 0 };
  }

  async close(): Promise<void> {}

  complete(jobId: string, state: JobStateSnapshot): void {
    this.states.set(jobId, state);
  }
}

async function harness(
  overrides: { quotaStore?: MemoryQuotaStore; pepper?: string; maxUploadBytes?: number } = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pdfshush-http-'));
  const store = new WorkDirStore(dir);
  await store.init();
  const queue = new FakeQueue();
  const context: ApiContext = createContext({
    store,
    queue,
    quotaStore: overrides.quotaStore ?? new MemoryQuotaStore(),
    pepper: overrides.pepper ?? 'test-pepper',
    logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {} } as never,
    config: {
      quota: { maxUploadBytes: overrides.maxUploadBytes ?? 5 * 1024 * 1024 },
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
  const url = (suffix: string) => `http://127.0.0.1:${port}${suffix}`;
  return { context, queue, store, url, dir };
}

async function samplePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 300]).drawText('hello', { x: 40, y: 240, size: 14, font, color: rgb(0, 0, 0) });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

function multipart(fields: Record<string, string>, files: { name: string; data: Buffer }[]): { body: Buffer; contentType: string } {
  const boundary = `----pdfshush${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
          'Content-Type: application/pdf\r\n\r\n',
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('GET /api/health', () => {
  it('reports queue depth and work-dir usage', async () => {
    const { url } = await harness();
    const response = await fetch(url('/api/health'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; queue: { waiting: number }; workDir: { bytes: number } };
    expect(body.status).toBe('ok');
    expect(body.queue.waiting).toBe(0);
    expect(body.workDir.bytes).toBe(0);
  });
});

describe('GET /api/tools', () => {
  it('lists server-runnable slugs and the limits', async () => {
    const { url, context } = await harness();
    const body = (await (await fetch(url('/api/tools'))).json()) as {
      slugs: string[];
      maxUploadBytes: number;
    };
    expect(body.slugs).toContain('merge');
    expect(body.slugs).not.toContain('compress-pdf');
    expect(body.maxUploadBytes).toBe(context.config.quota.maxUploadBytes);
  });
});

describe('POST /api/jobs', () => {
  it('accepts an upload, queues the job and returns an ownership token', async () => {
    const { url, queue } = await harness();
    const pdf = await samplePdf();
    const { body, contentType } = multipart({ slug: 'merge', options: '{}' }, [
      { name: 'one.pdf', data: pdf },
      { name: 'two.pdf', data: pdf },
    ]);

    const response = await fetch(url('/api/jobs'), {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    expect(response.status).toBe(202);
    const created = (await response.json()) as { jobId: string; token: string; files: { bytes: number }[] };
    expect(created.jobId).toHaveLength(32);
    expect(created.token).toHaveLength(64);
    expect(created.files).toHaveLength(2);
    expect(queue.payloads).toHaveLength(1);
    expect(queue.payloads[0]!.files).toEqual(['one.pdf', 'two.pdf']);
    // The payload references files, never bytes.
    expect(JSON.stringify(queue.payloads[0]!)).not.toContain('%PDF');
  });

  it('sanitises hostile filenames before they reach disk', async () => {
    const { url, store } = await harness();
    const pdf = await samplePdf();
    const { body, contentType } = multipart({ slug: 'merge' }, [
      { name: '../../../evil.pdf', data: pdf },
      { name: 'ok.pdf', data: pdf },
    ]);

    const response = await fetch(url('/api/jobs'), {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    expect(response.status).toBe(202);
    const created = (await response.json()) as { jobId: string; files: { name: string }[] };
    expect(created.files.map((file) => file.name)).toEqual(['evil.pdf', 'ok.pdf']);
    // And the files really landed inside the work dir.
    await expect(store.statResult(created.jobId, 'evil.pdf')).resolves.toBeUndefined();
  });

  it('refuses a non-multipart body', async () => {
    const { url } = await harness();
    const response = await fetch(url('/api/jobs'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'merge' }),
    });
    expect(response.status).toBe(400);
  });

  it('refuses an unsupported file type', async () => {
    const { url } = await harness();
    const { body, contentType } = multipart({ slug: 'merge' }, [
      { name: 'payload.png', data: Buffer.from('not a pdf') },
    ]);
    const response = await fetch(url('/api/jobs'), {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    expect(response.status).toBe(400);
  });

  it('refuses an unknown slug and cleans up the upload', async () => {
    const { url, store } = await harness();
    const pdf = await samplePdf();
    const { body, contentType } = multipart({ slug: 'compress-pdf' }, [
      { name: 'one.pdf', data: pdf },
    ]);
    const response = await fetch(url('/api/jobs'), {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    expect(response.status).toBe(400);
    // Nothing left on disk for the rejected job.
    const usage = await store.usage();
    expect(usage.jobDirs).toBe(0);
  });

  it('enforces the anonymous quota before accepting bytes', async () => {
    const quotaStore = new MemoryQuotaStore();
    // The loopback client may present as ::1, 127.0.0.1 or the v4-mapped form,
    // depending on the platform: seed the subject for each.
    const { subjectId } = await import('../src/quota/quota.js');
    for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) {
      quotaStore.seed(`quota:${subjectId(ip, 'test-pepper')}:m`, 99, 60);
    }
    const { url } = await harness({ quotaStore });
    const pdf = await samplePdf();
    const { body, contentType } = multipart({ slug: 'merge' }, [
      { name: 'one.pdf', data: pdf },
    ]);
    const response = await fetch(url('/api/jobs'), {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeTruthy();
  });

  // Regression: the cap was per file only, so one anonymous POST could write
  // maxFiles x maxBytes to disk before the daily byte quota was ever charged.
  it('caps the whole request, not just each file', async () => {
    const pdf = await samplePdf();
    // Two files, each comfortably under the per-file cap, together over the
    // request cap: only an aggregate limit can reject this.
    const cap = Math.floor(pdf.length * 1.5);
    expect(pdf.length).toBeLessThan(cap);
    const { url, store } = await harness({ maxUploadBytes: cap });
    const { body, contentType } = multipart({ slug: 'merge' }, [
      { name: 'one.pdf', data: pdf },
      { name: 'two.pdf', data: pdf },
    ]);
    const response = await fetch(url('/api/jobs'), {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    expect(response.status).toBe(413);
    const payload = (await response.json()) as { code: string };
    expect(payload.code).toBe('upload_too_large');
    // The partial request must not leave anything behind.
    expect((await store.usage()).jobDirs).toBe(0);
  });
});

describe('job ownership', () => {
  it('requires the token to read state', async () => {
    const { url, queue, context } = await harness();
    const pdf = await samplePdf();
    const { body, contentType } = multipart({ slug: 'merge' }, [
      { name: 'one.pdf', data: pdf },
    ]);
    const created = (await (
      await fetch(url('/api/jobs'), { method: 'POST', headers: { 'content-type': contentType }, body })
    ).json()) as { jobId: string; token: string };

    expect((await fetch(url(`/api/jobs/${created.jobId}`))).status).toBe(403);
    expect(
      (
        await fetch(url(`/api/jobs/${created.jobId}`), {
          headers: { 'x-job-token': jobToken(context.pepper, created.jobId) },
        })
      ).status,
    ).toBe(200);
    queue.complete(created.jobId, { status: 'completed', files: [{ name: 'out.pdf', bytes: 4 }] });
    expect(queue.payloads).toHaveLength(1);
  });

  it('rejects a malformed job id without touching the queue', async () => {
    const { url } = await harness();
    const response = await fetch(url('/api/jobs/not-a-valid-id'), {
      headers: { 'x-job-token': 'whatever' },
    });
    expect(response.status).toBe(400);
  });

  it('serves a completed file with a PDF content type', async () => {
    const { url, queue, store, context } = await harness();
    const jobId = 'f'.repeat(32);
    await store.prepareJob(jobId);
    const payload = Buffer.from('%PDF-1.7 fake');
    await store.writeResult(jobId, 'out.pdf', payload);
    queue.complete(jobId, { status: 'completed', files: [{ name: 'out.pdf', bytes: payload.length }] });

    const response = await fetch(url(`/api/jobs/${jobId}/files/out.pdf`), {
      headers: { 'x-job-token': jobToken(context.pepper, jobId) },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(await response.text()).toBe('%PDF-1.7 fake');
  });

  // Regression: every result was labelled application/pdf. `inspect` returns
  // <slug>-result.json, so a correct download arrived with a content type that
  // made browsers and strict clients treat it as a corrupt PDF.
  it('serves a JSON result with a JSON content type', async () => {
    const { url, queue, store, context } = await harness();
    const jobId = 'e'.repeat(32);
    await store.prepareJob(jobId);
    const payload = Buffer.from('{"documents":[{"pageCount":3}]}');
    await store.writeResult(jobId, 'inspect-result.json', payload);
    queue.complete(jobId, {
      status: 'completed',
      files: [{ name: 'inspect-result.json', bytes: payload.length }],
    });

    const response = await fetch(url(`/api/jobs/${jobId}/files/inspect-result.json`), {
      headers: { 'x-job-token': jobToken(context.pepper, jobId) },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(JSON.parse(await response.text())).toEqual({ documents: [{ pageCount: 3 }] });
  });

  it('404s a result whose files the janitor already deleted', async () => {
    const { url, queue, context } = await harness();
    const jobId = 'd'.repeat(32);
    queue.complete(jobId, { status: 'completed', files: [{ name: 'gone.pdf', bytes: 10 }] });

    // The job state still lists the file, but nothing is on disk: the exact
    // state a TTL expiry leaves behind.
    const response = await fetch(url(`/api/jobs/${jobId}/files/gone.pdf`), {
      headers: { 'x-job-token': jobToken(context.pepper, jobId) },
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe('result_not_found');
  });
});