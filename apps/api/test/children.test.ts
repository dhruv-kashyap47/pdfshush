/**
 * The hard-kill watchdog is the only thing that ends a child stuck in
 * synchronous CPU work, so its decisions are worth pinning down: kill exactly
 * the children past the deadline, only while the queue still owns the job, and
 * always clean up the marker afterwards.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkDirStore } from '../src/files/store.js';
import {
  clearChild,
  killExpiredChildren,
  listChildren,
  publishChild,
  startChildWatchdog,
} from '../src/jobs/children.js';

let root = '';
let store: WorkDirStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pdfshush-children-'));
  store = new WorkDirStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A moment far enough ahead that any freshly written marker looks expired. */
const LONG_AFTER = () => Date.now() + 60 * 60_000;

describe('child registry', () => {
  it('round-trips a published pid', async () => {
    await publishChild(store, 'job-0000000001', 4242);
    const children = await listChildren(store);
    expect(children).toHaveLength(1);
    expect(children[0]?.jobId).toBe('job-0000000001');
    expect(children[0]?.pid).toBe(4242);
  });

  it('forgets a child that cleared its marker', async () => {
    await publishChild(store, 'job-0000000002', 4243);
    await clearChild(store, 'job-0000000002');
    expect(await listChildren(store)).toEqual([]);
  });

  it('reports nothing when no child has ever run', async () => {
    expect(await listChildren(store)).toEqual([]);
  });
});

describe('killExpiredChildren', () => {
  it('leaves a child inside its deadline alone', async () => {
    await publishChild(store, 'job-0000000003', 5001);
    const killed: number[] = [];
    const result = await killExpiredChildren(store, {
      hardLimitMs: 60_000,
      kill: (pid) => killed.push(pid),
    });
    expect(result).toEqual([]);
    expect(killed).toEqual([]);
    expect(await listChildren(store)).toHaveLength(1);
  });

  it('kills the child, reports it, and drops the marker', async () => {
    await publishChild(store, 'job-0000000004', 5002);
    const killed: number[] = [];
    const result = await killExpiredChildren(store, {
      hardLimitMs: 60_000,
      now: LONG_AFTER(),
      kill: (pid) => killed.push(pid),
    });
    expect(killed).toEqual([5002]);
    expect(result.map((child) => child.jobId)).toEqual(['job-0000000004']);
    expect(await listChildren(store)).toEqual([]);
  });

  it('will not kill a pid the queue no longer reports active', async () => {
    await publishChild(store, 'job-0000000005', 5003);
    const killed: number[] = [];
    const result = await killExpiredChildren(store, {
      hardLimitMs: 60_000,
      now: LONG_AFTER(),
      isActive: async () => false,
      kill: (pid) => killed.push(pid),
    });
    expect(killed).toEqual([]);
    expect(result).toEqual([]);
    // The stale marker is still cleaned up, so the pid is never re-examined.
    expect(await listChildren(store)).toEqual([]);
  });

  it('shrugs off a pid that is already gone', async () => {
    await publishChild(store, 'job-0000000006', 5004);
    const result = await killExpiredChildren(store, {
      hardLimitMs: 60_000,
      now: LONG_AFTER(),
      kill: () => {
        throw new Error('ESRCH');
      },
    });
    expect(result).toEqual([]);
    expect(await listChildren(store)).toEqual([]);
  });
});

describe('startChildWatchdog', () => {
  it('sweeps on its interval and stops when asked', async () => {
    await publishChild(store, 'job-0000000007', 5005);
    const killed: number[] = [];
    const watchdog = startChildWatchdog(store, {
      hardLimitMs: 0,
      intervalMs: 10,
      // Slower than the interval: without sweep serialisation the ticks overlap
      // and the same marker can be killed twice.
      isActive: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return true;
      },
      kill: (pid) => killed.push(pid),
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    watchdog.stop();
    expect(killed).toEqual([5005]);

    // Nothing left to sweep, and stopped means stopped.
    await publishChild(store, 'job-0000000008', 5006);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(killed).toEqual([5005]);
  });
});
