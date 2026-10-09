/**
 * The PDF processing worker.
 *
 * Runs pdf-core off the main thread. The main thread never touches a PDF
 * parser directly: it dispatches a job and listens for progress/result/error.
 * The pdf.js worker URL is injected by the bundler (`?url` import).
 */

import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  JobAbortedError,
  JobValidationError,
  configurePdfjsRuntime,
  getJob,
  serializeJobError,
  withJobLimits,
  type JobInputBase,
  type JobProgress,
} from '@pdfshush/pdf-core';

const origin = typeof self !== 'undefined' && self.location ? self.location.origin : '';
configurePdfjsRuntime({
  workerSrc,
  cMapUrl: origin ? `${origin}/cmaps/` : '/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: origin ? `${origin}/standard_fonts/` : '/standard_fonts/',
});

interface JobRequest {
  type: 'job';
  id: number;
  slug: string;
  input: JobInputBase;
  timeoutMs?: number;
}

interface CancelRequest {
  type: 'cancel';
  id: number;
}

type Incoming = JobRequest | CancelRequest;

const inflight = new Map<number, AbortController>();

/**
 * With the DOM lib, the global `postMessage` resolves to the window overload
 * (message, targetOrigin). Narrow it to the dedicated-worker signature once.
 */
const workerScope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<Incoming>) => void) | null;
};

workerScope.onmessage = (event: MessageEvent<Incoming>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    inflight.get(message.id)?.abort();
    return;
  }
  void handleJob(message);
};

async function handleJob(request: JobRequest): Promise<void> {
  const external = new AbortController();
  inflight.set(request.id, external);

  try {
    const job = getJob(request.slug);

    const validation = job.validate(request.input);
    if (!validation.ok) {
      throw new JobValidationError('Invalid input', validation.issues);
    }

    const result = await withJobLimits(
      (signal) =>
        job.run(request.input, {
          signal,
          env: 'browser',
          onProgress: (progress: JobProgress) =>
            workerScope.postMessage({ type: 'progress', id: request.id, progress }),
          throwIfAborted: () => {
            if (signal.aborted) throw new JobAbortedError();
          },
        }),
      {
        env: 'browser',
        ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
        parentSignal: external.signal,
      },
    );

    workerScope.postMessage({ type: 'done', id: request.id, result }, collectTransferables(result));
  } catch (error) {
    // `serializeJobError` keeps the throw site. Without it this worker is a wall:
    // the main thread rebuilds a fresh Error and every frame underneath is lost.
    workerScope.postMessage({ type: 'error', id: request.id, error: serializeJobError(error) });
  } finally {
    inflight.delete(request.id);
  }
}

/**
 * Finds every ArrayBuffer in the result so it can be moved (not copied) to the
 * main thread. Deep-walks plain objects/arrays only -- results are ours, so
 * there are no cycles.
 */
function collectTransferables(value: unknown, depth = 0, out: ArrayBuffer[] = []): Transferable[] {
  if (depth > 8) return out;
  if (value instanceof ArrayBuffer) {
    // De-dupe: a result referencing the same buffer twice would make
    // postMessage throw DataCloneError on a duplicate transfer entry.
    if (!out.includes(value)) out.push(value);
    return out;
  }
  if (ArrayBuffer.isView(value)) {
    const buffer = value.buffer;
    if (buffer instanceof ArrayBuffer && !out.includes(buffer)) out.push(buffer);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTransferables(item, depth + 1, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectTransferables(item, depth + 1, out);
  }
  return out;
}