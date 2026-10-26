/**
 * A registry of live job children, so the host can kill a stuck one.
 *
 * The processor's timeout is cooperative: `withJobLimits` aborts through a
 * signal, which cannot interrupt synchronous CPU work inside a PDF parser. The
 * lock that would let BullMQ notice a stall is renewed by the *host* process,
 * which is not the one that is stuck, so that never fires either. A document
 * that pins a parser loop therefore pins a core until the code happens to
 * return -- unbounded, by construction.
 *
 * The child cannot fix this alone: a blocked event loop cannot run its own
 * timer. So it publishes its pid, and the host -- which *can* kill a process an
 * event loop cannot reach -- enforces a deadline the child has no say in. The
 * markers live beside the cancel markers under `control/`, and a pid is only
 * killed while the queue still reports that job active, so a marker left behind
 * by a crashed host cannot reach a pid the OS has since recycled.
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveWithin } from '../files/paths.js';
import type { WorkDirStore } from '../files/store.js';

const MARKER = 'child.pid';

function markerPath(store: WorkDirStore, jobId: string): string {
  return resolveWithin(path.join(store.root, 'control'), MARKER, jobId);
}

export interface LiveChild {
  jobId: string;
  pid: number;
  /** When the child announced itself; the deadline is measured from here. */
  startedAt: number;
}

/** Called by the processor, in the child's own process. */
export async function publishChild(store: WorkDirStore, jobId: string, pid: number): Promise<void> {
  const file = markerPath(store, jobId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, String(pid), 'utf8');
}

/** Called by the processor when the job ends, however it ends. */
export async function clearChild(store: WorkDirStore, jobId: string): Promise<void> {
  await rm(markerPath(store, jobId), { force: true });
}

export async function listChildren(store: WorkDirStore): Promise<LiveChild[]> {
  let entries: string[];
  try {
    entries = await readdir(path.join(store.root, 'control', MARKER));
  } catch {
    return []; // No child has run yet, or the control directory is gone.
  }

  const children: LiveChild[] = [];
  for (const jobId of entries) {
    try {
      const file = markerPath(store, jobId);
      const [raw, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
      const pid = Number.parseInt(raw.trim(), 10);
      if (Number.isInteger(pid) && pid > 0) children.push({ jobId, pid, startedAt: info.mtimeMs });
    } catch {
      // Vanished between readdir and stat: the child finished on its own.
    }
  }
  return children;
}

export interface SweepOptions {
  /** A child older than this is killed. */
  hardLimitMs: number;
  /**
   * Only kill while the queue still reports the job active. This is what keeps
   * a stale marker from terminating an unrelated process, so the host always
   * supplies it; tests may omit it to mean "always active".
   */
  isActive?: (jobId: string) => Promise<boolean>;
  /** Overridable clock, for tests. */
  now?: number;
  /** Overridable kill, for tests. Defaults to SIGKILL (TerminateProcess on Windows). */
  kill?: (pid: number) => void;
  onKill?: (child: LiveChild) => void;
}

/**
 * Kills every child past its deadline. Returns the ones it killed, so the caller
 * can log them and a test can assert on them.
 */
export async function killExpiredChildren(store: WorkDirStore, options: SweepOptions): Promise<LiveChild[]> {
  const now = options.now ?? Date.now();
  const kill = options.kill ?? ((pid: number) => process.kill(pid, 'SIGKILL'));
  const killed: LiveChild[] = [];

  for (const child of await listChildren(store)) {
    if (now - child.startedAt <= options.hardLimitMs) continue;

    const active = options.isActive ? await options.isActive(child.jobId).catch(() => false) : true;
    if (active) {
      try {
        kill(child.pid);
        killed.push(child);
        options.onKill?.(child);
      } catch {
        // Already gone (ESRCH), or not ours to kill. Cleanup still applies.
      }
    }

    // Drop the marker either way. Leaving an expired one behind would re-test a
    // pid that has had time to be recycled.
    await rm(markerPath(store, child.jobId), { force: true }).catch(() => {});
  }

  return killed;
}

export interface WatchdogOptions extends SweepOptions {
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

export function startChildWatchdog(
  store: WorkDirStore,
  options: WatchdogOptions,
): { stop(): void; sweep(): Promise<LiveChild[]> } {
  /**
   * A sweep awaits Redis and the filesystem, so the next interval tick can
   * arrive before it finishes. Sharing the in-flight promise keeps two passes
   * from listing the same marker and killing the same pid twice.
   */
  let inFlight: Promise<LiveChild[]> | null = null;
  const sweep = () => {
    if (!inFlight) {
      inFlight = killExpiredChildren(store, options).finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
  const timer = setInterval(() => {
    void sweep().catch((error: unknown) => options.onError?.(error));
  }, options.intervalMs ?? 15_000);
  timer.unref();
  return { stop: () => clearInterval(timer), sweep };
}
