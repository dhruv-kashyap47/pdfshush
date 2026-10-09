/**
 * Worker pool with hard guardrails.
 *
 * Rules this class exists to enforce:
 *  - bounded concurrency (never more workers than the machine can handle)
 *  - every job has a timeout; a timed-out worker is TERMINATED, because a
 *    synchronous pdf-lib loop cannot be interrupted any other way
 *  - cancelling from the UI terminates immediately -- no zombie work, and the
 *    heap is reclaimed on the spot
 *  - input/result buffers are transferred, not copied
 */

import { JobAbortedError, JobTimeoutError, LIMITS, type JobInputFile, type JobProgress } from '@pdfshush/pdf-core';

export interface RunJobOptions {
  onProgress?: (progress: JobProgress) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface JobRecord {
  id: number;
  slug: string;
  files: JobInputFile[];
  options?: Record<string, unknown>;
  timeoutMs: number;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  onProgress?: (progress: JobProgress) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

interface Slot {
  worker: Worker;
  job?: JobRecord;
}

type WorkerMessage =
  | { type: 'progress'; id: number; progress: JobProgress }
  | { type: 'done'; id: number; result: unknown }
  | {
      type: 'error';
      id: number;
      error: { name: string; message: string; stack?: string; issues?: { field?: string; message: string }[] };
    };

function workerCount(): number {
  const cores = navigator.hardwareConcurrency ?? 2;
  return Math.max(LIMITS.client.minWorkers, Math.min(LIMITS.client.maxWorkers, cores - 1));
}

export class JobPool {
  private readonly slots: Slot[] = [];
  private readonly queue: JobRecord[] = [];
  private nextId = 1;
  private readonly maxWorkers = workerCount();

  run<T>(slug: string, files: JobInputFile[], options?: Record<string, unknown>, run: RunJobOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const record: JobRecord = {
        id: this.nextId++,
        slug,
        files,
        timeoutMs: run.timeoutMs ?? LIMITS.job.defaultTimeoutMs,
        resolve: resolve as (value: unknown) => void,
        reject,
        ...(options ? { options } : {}),
        ...(run.onProgress ? { onProgress: run.onProgress } : {}),
        ...(run.signal ? { signal: run.signal } : {}),
      };

      if (run.signal?.aborted) {
        reject(new JobAbortedError());
        return;
      }

      if (run.signal) {
        const onAbort = () => this.cancel(record.id, new JobAbortedError());
        run.signal.addEventListener('abort', onAbort, { once: true });
        record.onAbort = onAbort;
      }

      record.timer = setTimeout(() => {
        this.cancel(record.id, new JobTimeoutError(record.timeoutMs));
      }, record.timeoutMs);

      this.queue.push(record);
      this.pump();
    });
  }

  /** Terminates the worker running `id` (if any) and rejects the job. */
  private cancel(id: number, error: unknown): void {
    const queueIndex = this.queue.findIndex((job) => job.id === id);
    if (queueIndex >= 0) {
      const [job] = this.queue.splice(queueIndex, 1);
      if (job) this.finish(job, 'reject', error);
      return;
    }

    const slot = this.slots.find((s) => s.job?.id === id);
    if (slot?.job) {
      const job = slot.job;
      this.finish(job, 'reject', error);
      // Terminating is the only guaranteed way to stop synchronous work.
      this.respawn(slot);
    }
  }

  private pump(): void {
    while (this.queue.length > 0) {
      const slot =
        this.slots.find((s) => !s.job) ??
        (this.slots.length < this.maxWorkers ? this.spawn() : undefined);
      if (!slot) return; // at capacity; a finishing job re-runs pump()
      const job = this.queue.shift();
      if (!job) return;
      if (job.signal?.aborted) {
        this.finish(job, 'reject', new JobAbortedError());
        continue;
      }
      this.dispatch(slot, job);
    }
  }

  private spawn(): Slot {
    const worker = new Worker(new URL('../workers/job-worker.ts', import.meta.url), {
      type: 'module',
    });
    const slot: Slot = { worker };
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.onMessage(slot, event.data);
    worker.onerror = (event) => {
      const job = slot.job;
      if (job) {
        this.finish(job, 'reject', new Error(event.message || 'Worker crashed'));
        this.respawn(slot);
      }
    };
    this.slots.push(slot);
    return slot;
  }

  private dispatch(slot: Slot, job: JobRecord): void {
    slot.job = job;
    const input = { files: job.files, ...(job.options ? { options: job.options } : {}) };
    const transfer: Transferable[] = [];
    for (const file of job.files) {
      const buffer = file.data.buffer;
      if (buffer instanceof ArrayBuffer && !transfer.includes(buffer)) transfer.push(buffer);
    }
    slot.worker.postMessage({ type: 'job', id: job.id, slug: job.slug, input, timeoutMs: job.timeoutMs }, transfer);
  }

  private onMessage(slot: Slot, message: WorkerMessage): void {
    const job = slot.job;
    if (!job || job.id !== message.id) return;

    if (message.type === 'progress') {
      job.onProgress?.(message.progress);
      return;
    }

    if (message.type === 'done') {
      this.finish(job, 'resolve', message.result);
      slot.job = undefined;
      this.pump();
      return;
    }

    const error = new Error(message.error.message);
    error.name = message.error.name;
    // The throw site happened in the worker; without this the reconstructed error
    // points at this line and hides every engine frame underneath it.
    if (message.error.stack) error.stack = message.error.stack;
    if (message.error.issues) {
      (error as Error & { issues?: unknown }).issues = message.error.issues;
    }
    this.finish(job, 'reject', error);
    slot.job = undefined;
    this.pump();
  }

  private finish(job: JobRecord, how: 'resolve' | 'reject', value: unknown): void {
    if (job.timer !== undefined) clearTimeout(job.timer);
    if (job.signal && job.onAbort) job.signal.removeEventListener('abort', job.onAbort);
    job.files = [];
    if (how === 'resolve') job.resolve(value);
    else job.reject(value);
  }

  private respawn(slot: Slot): void {
    slot.worker.terminate();
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
    if (this.queue.length > 0) {
      this.pump();
    }
  }

  /** For tests / teardown. Pending jobs must be rejected, not left hanging. */
  dispose(): void {
    for (const slot of this.slots) {
      slot.worker.terminate();
      const job = slot.job;
      if (job) this.finish(job, 'reject', new JobAbortedError('Worker pool disposed'));
    }
    this.slots.length = 0;
    const queued = this.queue.splice(0, this.queue.length);
    for (const job of queued) this.finish(job, 'reject', new JobAbortedError('Worker pool disposed'));
  }
}

/** App-wide singleton: one pool for every tool. */
export const jobPool = new JobPool();