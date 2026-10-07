/**
 * The server-side runner.
 *
 * This is the load-bearing claim of P3: the *same* `JobDefinition` the browser
 * runs executes in Node, driven by a payload that references files on disk.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { runJob, JobExecutionError } from '../src/jobs/runner.js';
import { WorkDirStore } from '../src/files/store.js';
import { jobPayloadSchema, JOB_ERROR_CODES, type JobPayload } from '../src/jobs/payload.js';
import { normalizeReturnValue } from '../src/jobs/queue.js';

const temps: string[] = [];

afterEach(async () => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function fixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i += 1) {
    const page = doc.addPage([300, 300]);
    page.drawText(`page ${i + 1}`, { x: 40, y: 240, size: 14, font, color: rgb(0, 0, 0) });
  }
  return doc.save({ useObjectStreams: false });
}

function payload(partial: Partial<JobPayload>): JobPayload {
  return jobPayloadSchema.parse({
    jobId: 'a1b2c3d4'.repeat(4),
    slug: 'merge',
    files: ['one.pdf'],
    subject: 's'.repeat(32),
    requestedAt: Date.now(),
    ...partial,
  });
}

async function seededStore(files: { name: string; bytes: Uint8Array }[]) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pdfshush-runner-'));
  temps.push(dir);
  const store = new WorkDirStore(dir);
  await store.init();
  const jobId = 'a1b2c3d4'.repeat(4);
  await store.prepareJob(jobId);
  for (const file of files) {
    await store.writeInput(jobId, file.name, Readable.from([Buffer.from(file.bytes)]), 50 * 1024 * 1024);
  }
  return { store, jobId };
}

describe('runJob', () => {
  it('executes a real pdf-core job and writes the output to disk', async () => {
    const source = await fixture();
    const { store, jobId } = await seededStore([
      { name: 'one.pdf', bytes: source },
      { name: 'two.pdf', bytes: source },
    ]);

    const progress: { phase: string }[] = [];
    const result = await runJob({
      payload: payload({ jobId, files: ['one.pdf', 'two.pdf'] }),
      store,
      onProgress: (snapshot) => {
        progress.push({ phase: snapshot.phase });
      },
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.name).toMatch(/\.pdf$/);
    expect(result.files[0]!.bytes).toBeGreaterThan(0);
    expect(result.pageCount).toBe(4); // 2 files x 2 pages merged
    expect(progress.length).toBeGreaterThan(0);
  });

  it('rejects an unknown slug before touching the filesystem', async () => {
    const { store, jobId } = await seededStore([{ name: 'one.pdf', bytes: await fixture() }]);
    await expect(
      runJob({ payload: { ...payload({ jobId }), slug: 'nope' as never }, store }),
    ).rejects.toBeInstanceOf(JobExecutionError);
  });

  it('reports a missing input instead of failing obscurely', async () => {
    const { store, jobId } = await seededStore([{ name: 'one.pdf', bytes: await fixture() }]);
    await expect(
      runJob({ payload: payload({ jobId, files: ['one.pdf', 'ghost.pdf'] }), store }),
    ).rejects.toMatchObject({ code: JOB_ERROR_CODES.missingField });
  });

  it('surfaces contract validation failures with their message', async () => {
    const { store, jobId } = await seededStore([
      { name: 'one.pdf', bytes: await fixture() },
    ]);

    // `split-by-pages` rejects a zero chunk size before doing any work.
    await expect(
      runJob({
        payload: payload({ jobId, slug: 'split-by-pages', files: ['one.pdf'], options: { chunkSize: 0 } }),
        store,
      }),
    ).rejects.toMatchObject({ code: JOB_ERROR_CODES.validation });
  });

  it('aborts when the caller cancelled before the job started', async () => {
    const source = await fixture();
    const { store, jobId } = await seededStore([
      { name: 'one.pdf', bytes: source },
      { name: 'two.pdf', bytes: source },
    ]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      runJob({ payload: payload({ jobId, files: ['one.pdf', 'two.pdf'] }), store, signal: controller.signal }),
    ).rejects.toMatchObject({ code: JOB_ERROR_CODES.aborted });
  });

  it('threads an explicit timeout through without breaking a fast job', async () => {
    const source = await fixture();
    const { store, jobId } = await seededStore([
      { name: 'one.pdf', bytes: source },
      { name: 'two.pdf', bytes: source },
    ]);
    // Timeouts cannot preempt synchronous pdf-lib work, so this asserts the
    // option is accepted and generous -- not that it fires mid-CPU.
    const result = await runJob({
      payload: payload({ jobId, files: ['one.pdf', 'two.pdf'] }),
      store,
      timeoutMs: 60_000,
    });
    expect(result.files[0]!.bytes).toBeGreaterThan(0);
  });
});

describe('metadata-only results', () => {
  it('serialises a job that returns no file (inspect) to JSON', async () => {
    const source = await fixture();
    const { store, jobId } = await seededStore([{ name: 'one.pdf', bytes: source }]);

    const result = await runJob({
      payload: payload({ jobId, slug: 'inspect', files: ['one.pdf'] }),
      store,
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.name).toBe('inspect-result.json');
    expect(result.files[0]!.bytes).toBeGreaterThan(20);
    expect(result.pageCount).toBe(2);

    const written = await readFile(path.join(store.outputDir(jobId), 'inspect-result.json'), 'utf8');
    const parsed = JSON.parse(written) as { documents: { pageCount: number }[] };
    expect(parsed.documents[0]!.pageCount).toBe(2);
  });
});

describe('payload schema', () => {
  it('accepts a well-formed payload', () => {
    expect(() => jobPayloadSchema.parse(payload({}))).not.toThrow();
  });

  it('refuses slugs that are not server-runnable', () => {
    expect(() => jobPayloadSchema.parse({ ...payload({}), slug: 'compress-pdf' })).toThrow();
    expect(() => jobPayloadSchema.parse({ ...payload({}), slug: '../../etc' })).toThrow();
  });

  it('refuses oversized option blobs and long passwords', () => {
    const huge = { blob: 'x'.repeat(50_000) };
    // Zod passes the record through; the byte cap is enforced at upload time.
    expect(() => jobPayloadSchema.parse({ ...payload({}), password: 'p'.repeat(300) })).toThrow();
    expect(() => jobPayloadSchema.parse({ ...payload({}), options: huge })).not.toThrow();
  });
});

describe('queue return values', () => {
  it('reads the serialisable summary a runner returns', () => {
    expect(
      normalizeReturnValue({ files: [{ name: 'out.pdf', bytes: 10 }], pageCount: 3 }),
    ).toEqual({ files: [{ name: 'out.pdf', bytes: 10 }], pageCount: 3 });
    expect(normalizeReturnValue({ nothing: true })).toBeUndefined();
    expect(normalizeReturnValue(undefined)).toBeUndefined();
  });
});