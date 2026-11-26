/**
 * TTL janitor.
 *
 * The hardening gate is "kill -9 mid-job leaves nothing behind". A crashed
 * worker cannot clean up after itself, so a timer sweeping the work directory
 * is the mechanism that actually guarantees deletion. It runs in the API
 * process, which is the one process still alive after a worker dies (and in the
 * worker too, for the mirror case).
 */

import type { WorkDirStore } from './store.js';

export interface JanitorOptions {
  store: WorkDirStore;
  maxAgeMs: number;
  intervalMs: number;
  onStart?: (info: { intervalMs: number; maxAgeMs: number }) => void;
  onSweep?: (removed: string[]) => void;
  onError?: (error: unknown) => void;
  now?: () => number;
  /** True while the queue still owns a job; such a job is never swept. */
  isLive?: (jobId: string) => Promise<boolean>;
  /** Timers keep the process alive by default; tests and embedded use opt out. */
  unref?: boolean;
}

export interface Janitor {
  start(): void;
  stop(): void;
  /** Runs one pass immediately. */
  sweepNow(): Promise<string[]>;
}

export function createJanitor(options: JanitorOptions): Janitor {
  const now = options.now ?? Date.now;
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  const sweepNow = async (): Promise<string[]> => {
    const removed = await options.store.sweep(options.maxAgeMs, now(), options.isLive);
    if (removed.length > 0) options.onSweep?.(removed);
    return removed;
  };

  const tick = () => {
    if (running) return; // never overlap passes
    running = true;
    sweepNow()
      .catch((error: unknown) => options.onError?.(error))
      .finally(() => {
        running = false;
      });
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(tick, options.intervalMs);
      if (options.unref) timer.unref();
      // One pass at boot clears anything a previous crash left behind.
      tick();
      options.onStart?.({ intervalMs: options.intervalMs, maxAgeMs: options.maxAgeMs });
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    sweepNow,
  };
}
