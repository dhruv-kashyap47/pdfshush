/**
 * The common job contract.
 *
 * Every PDFShush tool -- merge, split, OCR, compress, edit, AI redaction -- is a
 * `JobDefinition`. The browser pool and the server queue (Phase 3) both consume
 * this exact interface, so a tool never has to know where it is running.
 */

import { LIMITS, timeoutForPageCount } from './limits.js';

export interface JobProgress {
  /** Short human label, e.g. "Rendering pages". */
  phase: string;
  /** 0..1 when known, otherwise undefined for indeterminate work. */
  ratio?: number;
  /** Optional detail line. */
  message?: string;
}

export type JobEnvironment = 'browser' | 'node';

export interface JobContext {
  readonly signal: AbortSignal;
  readonly env: JobEnvironment;
  onProgress(progress: JobProgress): void;
  /** Convenience: throw if the caller cancelled. */
  throwIfAborted(): void;
}

export interface JobInputFile {
  name: string;
  type?: string;
  data: Uint8Array;
  /** Password for this specific document, when encrypted. */
  password?: string;
}

export interface JobInputBase {
  files: JobInputFile[];
  /** Free-form tool options; shape is defined by the tool. */
  options?: Record<string, unknown>;
}

export interface ValidationIssue {
  field?: string;
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; issues: ValidationIssue[] };

export interface JobCost {
  /** Estimated peak working set in bytes. Used for capacity checks. */
  memoryBytes: number;
  /** Total pages the job will touch, when known up front. */
  pageCount?: number;
  /** Explicit timeout override; otherwise derived from pageCount. */
  timeoutMs?: number;
}

export interface JobDefinition<I extends JobInputBase = JobInputBase, O = unknown> {
  readonly slug: string;
  readonly label: string;
  /** Cheap pre-flight checks that need no PDF parsing. */
  validate(input: I): ValidationResult;
  /** Resource estimate, called after we know the page count. */
  estimate(input: I, pageCount: number): JobCost;
  /** The actual work. Must honour `ctx.signal`. */
  run(input: I, ctx: JobContext): Promise<O>;
}

export class JobValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(message: string, issues: ValidationIssue[]) {
    super(message);
    this.name = 'JobValidationError';
    this.issues = issues;
  }
}

export class JobAbortedError extends Error {
  constructor(message = 'Operation cancelled') {
    super(message);
    this.name = 'JobAbortedError';
  }
}

export class JobTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Operation timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'JobTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof JobAbortedError ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/**
 * What a worker can carry back across a thread boundary.
 *
 * Lives here, next to the error classes, rather than inside the worker bundle:
 * this is the contract that decides whether a production failure is diagnosable,
 * and it needs a test.
 */
export interface SerializedJobError {
  name: string;
  message: string;
  /**
   * Where it was thrown, trimmed to a sane size.
   *
   * This is the only copy that can survive the hop: the receiver rebuilds a fresh
   * `Error`, so without it a failure inside an engine or third-party library is
   * reduced to a one-line toast with no trace of the frames underneath. That is
   * not hypothetical -- a pdf.js rendering fault was reported as nothing but
   * "Could not render page 3" until the stack was carried here.
   */
  stack?: string;
  issues?: ValidationIssue[];
}

/** A pathological stack must not become a multi-megabyte message payload. */
const MAX_SERIALIZED_STACK = 4000;

function trimmedStack(error: unknown): { stack?: string } {
  if (!(error instanceof Error) || typeof error.stack !== 'string' || error.stack.length === 0) {
    return {};
  }
  const { stack } = error;
  return {
    stack: stack.length > MAX_SERIALIZED_STACK ? `${stack.slice(0, MAX_SERIALIZED_STACK)}…` : stack,
  };
}

/** Flattens any thrown value into something structured-cloneable and loggable. */
export function serializeJobError(error: unknown): SerializedJobError {
  if (error instanceof JobValidationError) {
    return { name: error.name, message: error.message, ...trimmedStack(error), issues: error.issues };
  }
  if (error instanceof JobTimeoutError) {
    return { name: error.name, message: error.message, ...trimmedStack(error) };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, ...trimmedStack(error) };
  }
  return { name: 'Error', message: String(error) };
}

/**
 * Runs `work` with a hard timeout and cooperative cancellation.
 *
 * Abort cannot interrupt synchronous CPU work inside pdf-lib, so the pool also
 * terminates the worker on timeout -- that is what actually frees the heap.
 * This helper exists so the caller sees a typed error instead of a hang.
 */
export async function withJobLimits<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: {
    timeoutMs?: number;
    pageCount?: number;
    parentSignal?: AbortSignal;
    env: JobEnvironment;
  },
): Promise<T> {
  const timeoutMs =
    options.timeoutMs ?? timeoutForPageCount(options.pageCount ?? 1, LIMITS.job.defaultTimeoutMs);

  const controller = new AbortController();
  let timedOut = false;

  const onParentAbort = () => controller.abort();
  if (options.parentSignal) {
    if (options.parentSignal.aborted) throw new JobAbortedError();
    options.parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await work(controller.signal);
  } catch (error) {
    if (timedOut) throw new JobTimeoutError(timeoutMs);
    if (controller.signal.aborted) throw new JobAbortedError();
    throw error;
  } finally {
    clearTimeout(timer);
    options.parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

/** Progress reporter that coalesces no-op updates and respects aborts. */
export function createProgressReporter(ctx: JobContext) {
  let last = -1;
  const reporter = {
    report(phase: string, ratio?: number, message?: string): void {
      if (ratio !== undefined && last >= 0 && Math.abs(ratio - last) < 0.02 && ratio < 1) return;
      if (ratio !== undefined) last = ratio;
      ctx.onProgress({
        phase,
        ...(ratio !== undefined ? { ratio } : {}),
        ...(message ? { message } : {}),
      });
    },
    /** 0..1 over a known item count, with a stable phase label. */
    step(index: number, total: number, phase: string): void {
      ctx.throwIfAborted();
      const ratio = total <= 0 ? 1 : (index + 1) / total;
      // Routed through report(): posting every item of a 500-page run to the
      // host defeated the coalescing this reporter exists for.
      reporter.report(phase, ratio);
    },
  };
  return reporter;
}
