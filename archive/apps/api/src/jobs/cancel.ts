/**
 * Cooperative cancellation for jobs already running.
 *
 * Removing a queued job is easy; stopping a CPU-bound one mid-flight needs a
 * signal the job can observe. The API writes a marker file, the worker polls
 * it, and the runner aborts through the normal `JobContext.signal` path -- so
 * cancellation uses exactly the same code as a timeout.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveWithin } from '../files/paths.js';
import type { WorkDirStore } from '../files/store.js';

const MARKER = 'cancel.request';

function markerPath(store: WorkDirStore, jobId: string): string {
  return resolveWithin(path.join(store.root, 'control'), MARKER, `${jobId}`);
}

/** Marks a running job for cancellation. Safe to call for unknown ids. */
export async function requestCancel(store: WorkDirStore, jobId: string): Promise<void> {
  const file = markerPath(store, jobId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, new Date().toISOString(), 'utf8');
}

export async function isCancelRequested(store: WorkDirStore, jobId: string): Promise<boolean> {
  try {
    await readFile(markerPath(store, jobId), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export async function clearCancel(store: WorkDirStore, jobId: string): Promise<void> {
  await rm(markerPath(store, jobId), { force: true });
}

/**
 * Polls for a cancel marker and trips `abort` when one appears. Returns a stop
 * function; the caller is responsible for calling it.
 */
export function watchForCancel(
  store: WorkDirStore,
  jobId: string,
  abort: AbortController,
  intervalMs = 1_000,
): () => void {
  const timer = setInterval(() => {
    void isCancelRequested(store, jobId).then((requested) => {
      if (requested) abort.abort();
    });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}