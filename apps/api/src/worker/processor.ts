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
import { WorkDirStore } from '../files/store.js';

interface ProcessorJob {
  id?: string;
  data: unknown;
  updateProgress(progress: unknown): Promise<void>;
  log?: { info(payload: unknown, message?: string): void; error(payload: unknown, message?: string): void };
}

export async function processJob(job: ProcessorJob): Promise<unknown> {
  const payload = jobPayloadSchema.parse(job.data) as JobPayload;
  const store = new WorkDirStore(process.env.WORK_DIR ?? '.work');
  const controller = new AbortController();
  const stopWatching = watchForCancel(store, payload.jobId, controller);

  try {
    const result = await runJob({
      payload,
      store,
      signal: controller.signal,
      onProgress: (progress) => job.updateProgress(progress),
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
  }
}

export default processJob;
