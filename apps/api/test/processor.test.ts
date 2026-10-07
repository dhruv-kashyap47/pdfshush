/**
 * The sandboxed processor, exercised in-process.
 *
 * BullMQ loads this module with `require()` in its own child process, so what
 * matters here is that it: exports a function, reads its work dir from the
 * environment, honours the payload contract, and returns a summary the API can
 * serialise. It needs no Redis, which is exactly why it can be tested.
 */

import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { processJob } from '../src/worker/processor.js';
import { WorkDirStore } from '../src/files/store.js';
import { jobPayloadSchema, type JobPayload } from '../src/jobs/payload.js';
import { requestCancel, isCancelRequested, clearCancel } from '../src/jobs/cancel.js';

let workDir = '';
let previousWorkDir: string | undefined;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'pdfshush-processor-'));
  previousWorkDir = process.env.WORK_DIR;
  process.env.WORK_DIR = workDir;
});

afterEach(async () => {
  if (previousWorkDir === undefined) delete process.env.WORK_DIR;
  else process.env.WORK_DIR = previousWorkDir;
  await rm(workDir, { recursive: true, force: true });
});

async function pdfWithText(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 300]).drawText(text, { x: 40, y: 240, size: 14, font, color: rgb(0, 0, 0) });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

async function seed(payloadInput: Partial<JobPayload>): Promise<JobPayload> {
  const store = new WorkDirStore(workDir);
  await store.init();
  const payload = jobPayloadSchema.parse(payloadInput);
  await store.prepareJob(payload.jobId);
  for (const [index, name] of payload.files.entries()) {
    const data = await pdfWithText(`file ${index + 1}`);
    await store.writeInput(payload.jobId, name, Readable.from([data]), 50 * 1024 * 1024);
  }
  return payload;
}

function jobFor(payload: JobPayload) {
  const progress: unknown[] = [];
  return {
    job: {
      id: payload.jobId,
      data: payload,
      async updateProgress(value: unknown) {
        progress.push(value);
      },
    },
    progress,
  };
}

describe('sandboxed processor', () => {
  it('runs a job and returns a serialisable summary', async () => {
    const payload = await seed({
      jobId: 'a'.repeat(32),
      slug: 'merge',
      files: ['one.pdf', 'two.pdf'],
      subject: 's'.repeat(32),
      requestedAt: Date.now(),
    });

    const { job, progress } = jobFor(payload);
    const result = (await processJob(job)) as { files: { name: string; bytes: number }[] };

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.name).toMatch(/\.pdf$/);
    expect(result.files[0]!.bytes).toBeGreaterThan(500);
    expect(progress.length).toBeGreaterThan(0);

    // The bytes really landed on disk, and they are a PDF.
    const written = await readFile(path.join(workDir, 'jobs', payload.jobId, 'output', result.files[0]!.name));
    expect(written.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('fails with a stable code when the payload is invalid', async () => {
    const store = new WorkDirStore(workDir);
    await store.init();
    await expect(
      processJob({
        id: 'x',
        data: { jobId: 'short', slug: 'merge' },
        updateProgress: async () => {},
      }),
    ).rejects.toThrow();
    await expect(store.usage()).resolves.toEqual({ jobDirs: 0, bytes: 0 });
  });

  it('reports a missing input instead of crashing opaquely', async () => {
    const payload = await seed({
      jobId: 'b'.repeat(32),
      slug: 'merge',
      files: ['one.pdf'],
      subject: 's'.repeat(32),
      requestedAt: Date.now(),
    });
    await rm(path.join(workDir, 'jobs', payload.jobId, 'input', 'one.pdf'));

    const { job } = jobFor(payload);
    await expect(processJob(job)).rejects.toThrow(/missing/i);
  });
});

describe('cancellation signalling', () => {
  it('writes a marker the worker can observe, and clears it afterwards', async () => {
    const store = new WorkDirStore(workDir);
    await store.init();
    const jobId = 'c'.repeat(32);

    expect(await isCancelRequested(store, jobId)).toBe(false);
    await requestCancel(store, jobId);
    expect(await isCancelRequested(store, jobId)).toBe(true);
    await clearCancel(store, jobId);
    expect(await isCancelRequested(store, jobId)).toBe(false);
  });

  it('leaves no cancel marker behind after a successful job', async () => {
    const payload = await seed({
      jobId: 'd'.repeat(32),
      slug: 'merge',
      files: ['one.pdf', 'two.pdf'],
      subject: 's'.repeat(32),
      requestedAt: Date.now(),
    });
    const store = new WorkDirStore(workDir);
    const { job } = jobFor(payload);
    await processJob(job);
    expect(await isCancelRequested(store, payload.jobId)).toBe(false);
  });
});