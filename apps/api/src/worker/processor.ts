/**
 * Sandboxed job processor.
 *
 * BullMQ loads this file in its **own process** (see `worker/host.ts`), which
 * is the point: pdf-lib and the external binaries are CPU-bound, so running
 * them in the worker's event loop would stall queue bookkeeping and stall
 * detection. A crash here kills one job, never the worker.
 *
 * The build emits CommonJS with `module.exports = processJob`, because that is
 * how BullMQ expects a sandboxed processor to export.
 */

import { UnrecoverableError } from 'bullmq';
import { runJob, JobExecutionError } from '../jobs/runner.js';
import { JOB_ERROR_CODES, formatFailure, jobPayloadSchema, type JobPayload } from '../jobs/payload.js';
import { clearCancel, watchForCancel } from '../jobs/cancel.js';
import { clearChild, publishChild } from '../jobs/children.js';
import { WorkDirStore } from '../files/store.js';

interface ProcessorJob {
  id?: string;
  data: unknown;
  updateProgress(progress: unknown): Promise<void>;
  log?: { info(payload: unknown, message?: string): void; error(payload: unknown, message?: string): void };
}

/** Reads a positive byte count from the environment, ignoring anything else. */
function readByteLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export async function processJob(job: ProcessorJob): Promise<unknown> {
  const payload = jobPayloadSchema.parse(job.data) as JobPayload;
  const store = new WorkDirStore(process.env.WORK_DIR ?? '.work');
  const controller = new AbortController();
  const stopWatching = watchForCancel(store, payload.jobId, controller);

  // Announce this process so the host can kill it if the work below pins the
  // event loop. A cooperative timeout cannot interrupt synchronous parsing, and
  // this process cannot time itself out either -- see `jobs/children.ts`.
  await publishChild(store, payload.jobId, process.pid);

  // The host forwards its admission ceiling: this process's environment is an
  // allowlist, so it cannot read the configuration itself.
  const maxWorkingSetBytes = readByteLimit(process.env.MAX_JOB_WORKING_SET_BYTES);

  try {
    const result = await runJob({
      payload,
      store,
      signal: controller.signal,
      onProgress: (progress) => job.updateProgress(progress),
      ...(maxWorkingSetBytes !== undefined ? { maxWorkingSetBytes } : {}),
    });
    return { files: result.files, ...(result.pageCount !== undefined ? { pageCount: result.pageCount } : {}) };
  } catch (error) {
    job.log?.error?.(
      { jobId: payload.jobId, slug: payload.slug, message: error instanceof Error ? error.message : String(error) },
      'job failed',
    );
    // A cancelled job must not be retried. BullMQ re-runs an ordinary failure
    // (attempts: 2), and the retry used to run the job to completion after the
    // user had been told it was cancelled.
    if (controller.signal.aborted) {
      throw new UnrecoverableError(formatFailure(JOB_ERROR_CODES.aborted, 'Job was cancelled'));
    }
    // Fail the job with a stable, machine-readable reason.
    const code = error instanceof JobExecutionError ? error.code : JOB_ERROR_CODES.internal;
    const message = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(formatFailure(code, message)), { name: 'JobExecutionError', code });
  } finally {
    stopWatching();
    await clearCancel(store, payload.jobId);
    await clearChild(store, payload.jobId);
  }
}

export default processJob;
