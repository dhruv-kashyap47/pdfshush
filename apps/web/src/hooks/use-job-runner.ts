import { useCallback, useEffect, useRef, useState } from 'react';
import {
  JobAbortedError,
  type JobInputFile,
  type JobProgress,
} from '@pdfshush/pdf-core';
import { jobPool } from '@/lib/job-pool';

export type JobState<T> =
  | { status: 'idle' }
  | { status: 'running'; progress: JobProgress | null }
  | { status: 'done'; result: T }
  | { status: 'error'; message: string };

export type RunOutcome<T> =
  | { ok: true; result: T }
  | { ok: false; aborted: true }
  | { ok: false; aborted: false; message: string };

/**
 * Runs one job slug with lifecycle state, progress, cancellation and safe
 * unmount handling. Aborts in-flight work when the component unmounts so a
 * closed tab never leaves an orphaned worker chewing on a file.
 */
export function useJobRunner<T>(slug: string) {
  const [state, setState] = useState<JobState<T>>({ status: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  /**
   * Id of the newest run. A superseded run still settles (as aborted), and its
   * handler used to write `{status:'idle'}` over the state of the run that
   * replaced it -- so starting a second job made the first one's cancellation
   * hide the second job's progress panel while it was still running.
   */
  const runIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  /** State writes are only valid while this run is still the current one. */
  const isCurrent = (runId: number) => mountedRef.current && runId === runIdRef.current;

  const run = useCallback(
    async (
      files: JobInputFile[],
      options?: Record<string, unknown>,
      runOptions?: { timeoutMs?: number },
    ): Promise<RunOutcome<T>> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const runId = (runIdRef.current += 1);
      setState({ status: 'running', progress: null });

      try {
        const result = await jobPool.run<T>(slug, files, options, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (isCurrent(runId)) setState({ status: 'running', progress });
          },
          ...(runOptions?.timeoutMs !== undefined ? { timeoutMs: runOptions.timeoutMs } : {}),
        });
        if (isCurrent(runId)) setState({ status: 'done', result });
        return { ok: true, result };
      } catch (error) {
        const aborted =
          error instanceof JobAbortedError ||
          (error instanceof Error && error.name === 'AbortError');
        if (!aborted) {
          // Callers show one short toast, which is right for a user and useless
          // for a bug. The stack rides along on the error (the worker preserves it
          // across the thread hop), so log it once here rather than at every
          // call site. Only the error object is logged -- no file bytes, page
          // contents or local paths.
          console.error(`[job:${slug}] run failed:`, error);
        }
        if (isCurrent(runId)) setState(aborted ? { status: 'idle' } : { status: 'error', message: messageOf(error) });
        return aborted ? { ok: false, aborted: true } : { ok: false, aborted: false, message: messageOf(error) };
      }
    },
    [slug],
  );

  const cancel = useCallback(() => {
    // A cancel is a user action on the *current* run, so it retires that run's
    // id: its eventual abort handler must not write state either.
    runIdRef.current += 1;
    controllerRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    controllerRef.current?.abort();
    setState({ status: 'idle' });
  }, []);

  return { state, run, cancel, reset };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
