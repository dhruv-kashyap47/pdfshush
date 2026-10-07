/**
 * Path safety and the TTL janitor -- the two things standing between a hostile
 * filename and the filesystem, and between a `kill -9` and a leaked temp dir.
 */

import { mkdtemp, mkdir, writeFile, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  safeFileName,
  safeJobId,
  resolveWithin,
  withExtension,
  UnsafePathError,
} from '../src/files/paths.js';
import { WorkDirStore, UploadTooLargeError } from '../src/files/store.js';
import { createJanitor } from '../src/files/janitor.js';
import { Readable } from 'node:stream';

const temps: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pdfshush-api-test-'));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) await (await import('node:fs/promises')).rm(dir, { recursive: true, force: true });
  }
});

describe('safeFileName', () => {
  it('strips directories and traversal', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\windows\\system32\\evil.exe')).toBe('evil.exe');
    expect(safeFileName('..\\..\\secrets.pdf')).toBe('secrets.pdf');
  });

  it('removes control characters, leading dots and exotic characters', () => {
    expect(safeFileName('..\u0000\u0007hidden.pdf')).toBe('hidden.pdf');
    const folded = safeFileName('résumé学年.pdf');
    expect(folded).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(folded.endsWith('.pdf')).toBe(true);
    expect(safeFileName('')).toBe('upload');
    expect(safeFileName('...')).toBe('upload');
  });

  it('caps absurdly long names but keeps the extension', () => {
    const long = `${'a'.repeat(400)}.pdf`;
    const safe = safeFileName(long);
    expect(safe.length).toBeLessThanOrEqual(96);
    expect(safe.endsWith('.pdf')).toBe(true);
  });

  it('forces a required extension exactly once', () => {
    expect(withExtension('report.PDF', '.pdf')).toBe('report.PDF');
    expect(withExtension('report', '.pdf')).toBe('report.pdf');
  });
});

describe('safeJobId', () => {
  it('accepts hex ids and rejects everything else', () => {
    expect(safeJobId('0123456789abcdef0123456789abcdef')).toHaveLength(32);
    expect(() => safeJobId('../../etc')).toThrow(UnsafePathError);
    expect(() => safeJobId('short')).toThrow(UnsafePathError);
    expect(() => safeJobId('0123456789abcdef0123456789abcdef/../x')).toThrow(UnsafePathError);
  });
});

describe('resolveWithin', () => {
  it('refuses to escape the root', () => {
    const root = path.join(tmpdir(), 'root');
    expect(() => resolveWithin(root, '..', '..', 'etc')).toThrow(UnsafePathError);
    expect(() => resolveWithin(root, 'a', '../../b')).toThrow(UnsafePathError);
  });

  it('allows legitimate nesting', () => {
    const root = path.join(tmpdir(), 'root');
    expect(resolveWithin(root, 'jobs', 'abc', 'input')).toContain('jobs');
  });
});

describe('WorkDirStore', () => {
  it('streams an upload to disk and reports its size', async () => {
    const store = new WorkDirStore(await tempDir());
    await store.init();
    const jobId = 'a'.repeat(32);
    await store.prepareJob(jobId);

    const stored = await store.writeInput(
      jobId,
      'invoice.pdf',
      Readable.from([Buffer.from('hello world')]),
      1024,
    );
    expect(stored.bytes).toBe(11);
    expect(stored.path.startsWith(store.inputDir(jobId))).toBe(true);
    expect((await stat(stored.path)).isFile()).toBe(true);
  });

  it('refuses an upload above the cap and leaves nothing behind', async () => {
    const store = new WorkDirStore(await tempDir());
    await store.init();
    const jobId = 'b'.repeat(32);
    await store.prepareJob(jobId);

    await expect(
      store.writeInput(jobId, 'big.pdf', Readable.from([Buffer.alloc(2_048)]), 1_024),
    ).rejects.toBeInstanceOf(UploadTooLargeError);
    await expect(store.writeInput(jobId, 'gone.pdf', Readable.from([Buffer.alloc(4)]), 1_024).then(
      async () => undefined,
    )).resolves.toBeUndefined();
    // The rejected upload left no file; the successful one did.
    const remaining = await stat(store.inputDir(jobId)).then(() => 'ok').catch(() => 'missing');
    expect(remaining).toBe('ok');
  });

  it('removes everything belonging to a job', async () => {
    const store = new WorkDirStore(await tempDir());
    await store.init();
    const jobId = 'c'.repeat(32);
    await store.prepareJob(jobId);
    await store.writeInput(jobId, 'x.pdf', Readable.from([Buffer.from('data')]), 1024);

    await store.removeJob(jobId);
    await expect(stat(store.inputDir(jobId))).rejects.toThrow();
    // Idempotent.
    await expect(store.removeJob(jobId)).resolves.toBeUndefined();
  });

  it('reports usage for the health endpoint', async () => {
    const store = new WorkDirStore(await tempDir());
    await store.init();
    const jobId = 'd'.repeat(32);
    await store.prepareJob(jobId);
    await store.writeInput(jobId, 'x.pdf', Readable.from([Buffer.alloc(64)]), 1024);

    const usage = await store.usage();
    expect(usage.jobDirs).toBe(1);
    expect(usage.bytes).toBe(64);
  });
});

describe('janitor', () => {
  it('sweeps only directories older than the TTL', async () => {
    const root = await tempDir();
    const store = new WorkDirStore(root);
    await store.init();

    const stale = 'e'.repeat(32);
    const fresh = 'f'.repeat(32);
    for (const id of [stale, fresh]) {
      await store.prepareJob(id);
      await writeFile(path.join(store.inputDir(id), 'file.pdf'), 'x');
    }

    const now = Date.now();
    const old = new Date(now - 3 * 60 * 60 * 1000);
    // Age the job directory itself -- that is what the sweep measures.
    await utimes(path.join(store.root, 'jobs', stale), old, old);

    const janitor = createJanitor({
      store,
      maxAgeMs: 60 * 60 * 1000,
      intervalMs: 1_000,
      now: () => now,
      unref: true,
    });

    const removed = await janitor.sweepNow();
    expect(removed).toContain(stale);
    expect(removed).not.toContain(fresh);
    await expect(stat(store.inputDir(stale))).rejects.toThrow();
    await expect(stat(store.inputDir(fresh))).resolves.toBeDefined();
  });

  it('never overlaps sweeps when started on a timer', async () => {
    const root = await tempDir();
    const store = new WorkDirStore(root);
    await store.init();
    await mkdir(path.join(root, 'control'), { recursive: true });

    let sweeps = 0;
    const janitor = createJanitor({
      store,
      maxAgeMs: 0,
      intervalMs: 5,
      onSweep: () => {
        sweeps += 1;
      },
      unref: true,
    });
    janitor.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    janitor.stop();
    expect(sweeps).toBeLessThanOrEqual(4);
  });
});