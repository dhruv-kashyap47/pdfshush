/**
 * Worker-pool sizing is a memory safeguard, not a performance guess.
 *
 * The 4x CPU emulation used by Q3 does not change `hardwareConcurrency`, so a
 * test that only counted cores would miss the device that actually dies: a
 * small phone reporting 2 GB. This pins both inputs and the cap.
 */

import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { LIMITS } from '@pdfshush/pdf-core';
import { JobPool, workerCountFor } from './job-pool';

/**
 * Minimal stand-in for a dedicated worker. `postMessage` records the request;
 * the test decides when (and whether) the worker answers, which is exactly what
 * a crashed worker never does.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminated = false;
  readonly posts: { type: string; id: number; slug: string }[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: { type: string; id: number; slug: string }): void {
    this.posts.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  done(id: number, result: unknown): void {
    this.onmessage?.({ data: { type: 'done', id, result } });
  }

  crash(): void {
    this.onerror?.({ message: 'worker crashed' });
  }
}

const realWorker = (globalThis as { Worker?: unknown }).Worker;

beforeEach(() => {
  FakeWorker.instances = [];
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
});

afterEach(() => {
  (globalThis as { Worker?: unknown }).Worker = realWorker;
});

describe('JobPool worker lifecycle', () => {
  // Regression: `onerror` only did anything when a job was assigned. A worker
  // that crashed between jobs stayed in the pool, so the next dispatch was
  // posted into a dead global that could never answer and the job hung until
  // its full timeout.
  it('replaces a worker that crashes while idle', async () => {
    const pool = new JobPool();
    try {
      const first = pool.run('inspect', [], {});
      const crashed = FakeWorker.instances[0]!;
      crashed.done(crashed.posts[0]!.id, 'first');
      await expect(first).resolves.toBe('first');

      crashed.crash();
      expect(crashed.terminated).toBe(true);

      const second = pool.run('inspect', [], {}, { timeoutMs: 500 });
      second.catch(() => undefined);
      await Promise.resolve();

      expect(FakeWorker.instances).toHaveLength(2);
      const fresh = FakeWorker.instances[1]!;
      expect(fresh.terminated).toBe(false);
      expect(fresh.posts).toHaveLength(1);
      fresh.done(fresh.posts[0]!.id, 'second');
      await expect(second).resolves.toBe('second');
    } finally {
      pool.dispose();
    }
  });
});

describe('workerCountFor', () => {
  it('uses one spare core per worker, capped at four', () => {
    expect(workerCountFor(8)).toBe(4);
    expect(workerCountFor(4)).toBe(3);
    expect(workerCountFor(2)).toBe(1);
    expect(workerCountFor(1)).toBe(1);
  });

  it('never opens more than one worker on a low-memory device', () => {
    expect(workerCountFor(8, 2)).toBe(1);
    expect(workerCountFor(8, 1)).toBe(1);
    expect(workerCountFor(8, 4)).toBe(4);
  });

  it('treats missing or nonsensical evidence as the conservative case', () => {
    expect(workerCountFor(Number.NaN)).toBe(LIMITS.client.minWorkers);
    expect(workerCountFor(0)).toBe(LIMITS.client.minWorkers);
    expect(workerCountFor(-4)).toBe(LIMITS.client.minWorkers);
    expect(workerCountFor(8, Number.NaN)).toBe(4);
  });
});
