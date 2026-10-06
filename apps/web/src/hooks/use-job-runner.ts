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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const run = useCallback(
    async (
      files: JobInputFile[],
      options?: Record<string, unknown>,
      runOptions?: { timeoutMs?: number },
    ): Promise<RunOutcome<T>> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ status: 'running', progress: null });

      try {
        const result = await jobPool.run<T>(slug, files, options, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (mountedRef.current) setState({ status: 'running', progress });
          },
          ...(runOptions?.timeoutMs !== undefined ? { timeoutMs: runOptions.timeoutMs } : {}),
        });
        if (mountedRef.current) setState({ status: 'done', result });
        return { ok: true, result };
      } catch (error) {
        if (error instanceof JobAbortedError || (error instanceof Error && error.name === 'AbortError')) {
          if (mountedRef.current) setState({ status: 'idle' });
          return { ok: false, aborted: true };
        }
        const message = error instanceof Error ? error.message : String(error);
        if (mountedRef.current) setState({ status: 'error', message });
        return { ok: false, aborted: false, message };
      }
    },
    [slug],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState({ status: 'idle' });
  }, []);

  return { state, run, cancel, reset };
}
