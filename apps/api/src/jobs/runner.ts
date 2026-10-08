/**
 * Server-side job runner.
 *
 * This is the "same job contract" made real on the server: it loads the inputs
 * from the work directory, builds a `JobContext` with `env: 'node'`, runs the
 * exact `JobDefinition` the browser would have run, streams progress back, and
 * writes the output to disk instead of shipping bytes through Redis.
 */

import { readFile } from 'node:fs/promises';
import {
  JOB_ERROR_CODES,
  type JobErrorCode,
  type JobPayload,
  type JobProgressSnapshot,
} from './payload.js';
import {
  createProgressReporter,
  getNodeJob,
  isAbortError,
  LIMITS,
  timeoutForPageCount,
  withJobLimits,
  JobTimeoutError,
  JobAbortedError,
  JobValidationError,
  type JobContext,
  type JobInputFile,
  type JobProgress,
} from '@pdfshush/pdf-core/node';
import { resolveWithin } from '../files/paths.js';
import type { WorkDirStore } from '../files/store.js';

export class JobExecutionError extends Error {
  constructor(
    readonly code: JobErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'JobExecutionError';
  }
}

export interface RunResult {
  /** Output files written under the job's output directory. */
  files: { name: string; bytes: number }[];
  pageCount?: number;
}

export interface RunOptions {
  payload: JobPayload;
  store: WorkDirStore;
  /** Called for every progress report (the worker forwards it to BullMQ). */
  onProgress?: (progress: JobProgressSnapshot) => void | Promise<void>;
  /** External cancellation (BullMQ stalled/token detection, shutdown). */
  signal?: AbortSignal;
  /** Overrides the contract-derived timeout (used by tests). */
  timeoutMs?: number;
}

export async function runJob(options: RunOptions): Promise<RunResult> {
  const { payload, store, onProgress, signal } = options;
  const definition = getNodeJob(payload.slug);
  if (!definition) {
    throw new JobExecutionError(JOB_ERROR_CODES.unknownSlug, `Unknown job "${payload.slug}"`);
  }

  const files = await readInputs(payload, store);
  const input = {
    files,
    ...(payload.options ? { options: payload.options } : {}),
  } as Parameters<typeof definition.run>[0];

  // Cheap pre-flight, so a bad request fails before reading 500 MB.
  let validation;
  try {
    validation = definition.validate(input);
  } catch (error) {
    throw translateError(error);
  }
  if (!validation.ok) {
    throw new JobExecutionError(
      JOB_ERROR_CODES.validation,
      validation.issues[0]?.message ?? 'Invalid job input',
    );
  }

  let lastReported: JobProgressSnapshot | undefined;
  const report = (progress: JobProgress): void => {
    const snapshot: JobProgressSnapshot = {
      phase: progress.phase,
      ...(progress.ratio !== undefined ? { ratio: progress.ratio } : {}),
      ...(progress.message ? { message: progress.message } : {}),
    };
    // Collapse identical consecutive reports so we do not hammer Redis.
    if (
      lastReported &&
      lastReported.phase === snapshot.phase &&
      lastReported.ratio === snapshot.ratio
    ) {
      return;
    }
    lastReported = snapshot;
    // A transient Redis error here must not become an unhandled rejection: under
    // Node's default that terminates the sandboxed child and BullMQ re-runs the
    // whole job. Progress is best-effort.
    Promise.resolve(onProgress?.(snapshot)).catch(() => undefined);
  };

  // Built inside the limits wrapper: that is where the real (timeout-aware)
  // signal comes from, and the job must observe that same signal.
  const contextFor = (jobSignal: AbortSignal): JobContext => ({
    env: 'node',
    signal: jobSignal,
    onProgress: report,
    throwIfAborted() {
      if (jobSignal.aborted) throw new JobAbortedError();
    },
  });

  // The page count sizes the timeout. It comes from the request body, so it is
  // clamped: a huge claimed count would hold a worker slot for 15 minutes, and a
  // too-small one turns a valid 400-page job into a spurious timeout.
  const hint = payload.options?.pageCount;
  const pageCountHint =
    typeof hint === 'number' && Number.isFinite(hint)
      ? Math.min(Math.max(Math.floor(hint), 1), LIMITS.client.maxPages)
      : 1;

  let result: unknown;
  try {
    result = await withJobLimits((jobSignal) => definition.run(input, contextFor(jobSignal)), {
      env: 'node',
      ...(signal ? { parentSignal: signal } : {}),
      pageCount: pageCountHint,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  } catch (error) {
    throw translateError(error);
  }

  const outputs = await writeOutputs(payload.jobId, result, store, payload.slug);
  return outputs;
}

async function readInputs(payload: JobPayload, store: WorkDirStore): Promise<JobInputFile[]> {
  const out: JobInputFile[] = [];
  for (const name of payload.files) {
    let bytes: Buffer;
    try {
      bytes = await readFile(resolveWithin(store.inputDir(payload.jobId), name));
    } catch {
      throw new JobExecutionError(
        JOB_ERROR_CODES.missingField,
        `Uploaded file "${name}" is missing`,
      );
    }
    if (bytes.byteLength === 0) {
      throw new JobExecutionError(JOB_ERROR_CODES.missingField, `Uploaded file "${name}" is empty`);
    }
    out.push({
      name,
      data: new Uint8Array(bytes),
      ...(payload.password ? { password: payload.password } : {}),
    });
  }
  return out;
}

/**
 * Turns whatever a job returned into files on disk.
 *
 * Binary output (`ArrayBuffer`/`Uint8Array`, bare or behind
 * `{ data, name, pageCount }`, or arrays/parts/images of those) is written as
 * files. Jobs whose result is *metadata* -- `inspect` returns page counts and
 * dimensions, nothing to download -- are serialised to a JSON result rather than
 * rejected: a server that refuses to answer "how many pages is this?" would be
 * useless to exactly the callers who need it.
 */
async function writeOutputs(
  jobId: string,
  result: unknown,
  store: WorkDirStore,
  slug: string,
): Promise<RunResult> {
  const candidates = collectBinaryOutputs(result);

  if (candidates.length === 0) {
    const serialised = trySerialise(result);
    if (!serialised) {
      throw new JobExecutionError(JOB_ERROR_CODES.output, 'This job produced no deliverable output');
    }
    const stored = await store.writeResult(jobId, `${slug}-result.json`, serialised);
    const pageCount = readPageCount(result);
    return {
      files: [{ name: stored.name, bytes: stored.bytes }],
      ...(pageCount !== undefined ? { pageCount } : {}),
    };
  }

  const written: { name: string; bytes: number }[] = [];
  for (const candidate of candidates) {
    const stored = await store.writeResult(jobId, candidate.name, candidate.bytes);
    written.push({ name: stored.name, bytes: stored.bytes });
  }

  const pageCount = readPageCount(result);
  return {
    files: written,
    ...(pageCount !== undefined ? { pageCount } : {}),
  };
}

/** JSON bytes for plain-object results; undefined for anything unserialisable. */
function trySerialise(result: unknown): Uint8Array | undefined {
  if (!result || typeof result !== 'object') return undefined;
  try {
    const json = JSON.stringify(result, (_key, value: unknown) => {
      // Byte arrays would serialise as object maps of indices; say what they are.
      if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
        return `<${value.byteLength} bytes>`;
      }
      return value;
    });
    if (typeof json !== 'string') return undefined;
    return new TextEncoder().encode(json);
  } catch {
    return undefined;
  }
}

interface BinaryOutput {
  name: string;
  bytes: Uint8Array;
}

function collectBinaryOutputs(result: unknown): BinaryOutput[] {
  const found: BinaryOutput[] = [];
  const visit = (value: unknown, index: number, fallbackName: string): void => {
    if (value instanceof Uint8Array) {
      found.push({ name: index === 0 ? fallbackName : `${fallbackName}-${index + 1}`, bytes: value });
      return;
    }
    if (value instanceof ArrayBuffer) {
      found.push({ name: fallbackName, bytes: new Uint8Array(value) });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, i) => visit(entry, i, fallbackName));
      return;
    }
    if (value && typeof value === 'object') {
      // Jobs disagree on their shape: most return `data` + `fileName`, `edit`
      // returns `data` + `name`, and the split jobs return a `zip` + `zipName`.
      // Reading only `data` + `name` silently named every other result
      // `output.pdf` and dropped the bytes of the split jobs entirely.
      const record = value as {
        data?: unknown;
        zip?: unknown;
        name?: unknown;
        fileName?: unknown;
        zipName?: unknown;
        parts?: unknown;
        images?: unknown;
      };
      const binary = record.data ?? record.zip;
      if (binary instanceof Uint8Array || binary instanceof ArrayBuffer) {
        const label = [record.name, record.fileName, record.zipName].find(
          (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
        );
        found.push({
          name: label ?? fallbackName,
          bytes: binary instanceof Uint8Array ? binary : new Uint8Array(binary),
        });
      }      if (record.parts) visit(record.parts, index, fallbackName.replace(/\.pdf$/, '') + '-part');
      if (record.images) visit(record.images, index, fallbackName.replace(/\.pdf$/, '') + '-image');
    }
  };
  visit(result, 0, 'output.pdf');
  return found;
}

/**
 * Page count for the job result. Some jobs report it directly; `inspect`
 * reports it per document, so a single-document run borrows that number.
 */
function readPageCount(result: unknown): number | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const record = result as { pageCount?: unknown; documents?: unknown };
  if (typeof record.pageCount === 'number') return record.pageCount;
  if (Array.isArray(record.documents) && record.documents.length === 1) {
    const first = record.documents[0] as { pageCount?: unknown } | undefined;
    if (typeof first?.pageCount === 'number') return first.pageCount;
  }
  return undefined;
}

function translateError(error: unknown): Error {
  if (error instanceof JobValidationError) {
    return new JobExecutionError(JOB_ERROR_CODES.validation, error.message);
  }
  if (error instanceof JobTimeoutError) {
    return new JobExecutionError(JOB_ERROR_CODES.timeout, error.message);
  }
  if (error instanceof JobAbortedError || isAbortError(error)) {
    return new JobExecutionError(JOB_ERROR_CODES.aborted, 'Job was cancelled');
  }
  if (error instanceof JobExecutionError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new JobExecutionError(JOB_ERROR_CODES.internal, message);
}

export { createProgressReporter, timeoutForPageCount };
