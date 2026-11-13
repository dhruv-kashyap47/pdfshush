/**
 * Workflow recipes: local storage (IndexedDB, works signed out) and a runner.
 *
 * The runner orchestrates the *existing* job API rather than inventing a second
 * execution path: each step is one upload → poll → download, and the previous
 * step's output file becomes the next step's input. That keeps one job contract,
 * one queue, one set of limits -- and means a workflow cannot do anything a user
 * could not do by hand in the same order.
 *
 * Server-run for now, so every step must be a slug the server actually has. The
 * recipe validator already refuses anything that is not a real tool; this adds
 * the narrower "the server can run it" check and says so plainly rather than
 * failing halfway through a run.
 */

import { api, ApiError } from '@/lib/api';
import { serverDeployed } from '@/lib/deployment';
import { WORKFLOW_STORE, pdfshushDb } from '@/lib/idb';

/** Mirrors `validateWorkflow`'s shape in the engine. */
export interface WorkflowStep {
  id: string;
  tool: string;
  input?: { kind: 'source' } | { kind: 'step'; stepId: string };
  options?: Record<string, unknown>;
}

export interface Recipe {
  id?: string;
  name: string;
  steps: WorkflowStep[];
}

const STORE = WORKFLOW_STORE;
const MAX_LOCAL = 50;

/** One connection for the whole app, owned by `lib/idb.ts`. */
function db(): Promise<IDBDatabase> {
  return pdfshushDb();
}

export interface StoredRecipe extends Recipe {
  id: string;
  updatedAt: number;
}

/* ------------------------------------------------------------ local store */

export async function listLocalRecipes(): Promise<StoredRecipe[]> {
  try {
    const database = await db();
    const rows = await new Promise<StoredRecipe[]>((resolve, reject) => {
      const tx = database.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as StoredRecipe[]) ?? []);
      request.onerror = () => reject(request.error);
    });
    return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_LOCAL);
  } catch {
    return [];
  }
}

export async function saveLocalRecipe(recipe: Recipe): Promise<StoredRecipe> {
  const database = await db();
  const stored: StoredRecipe = {
    id: recipe.id ?? `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: recipe.name,
    steps: recipe.steps,
    updatedAt: Date.now(),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(stored);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return stored;
}

export async function deleteLocalRecipe(id: string): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ----------------------------------------------------------- server slugs */

let serverSlugs: Set<string> | undefined;

/** Which slugs this deployment can run server-side. */
export async function fetchServerSlugs(): Promise<Set<string>> {
  // A frontend-only deployment runs no server jobs, so the set is empty and
  // nothing is asked over the network. An empty picker is the honest answer:
  // a full one would offer steps that could only fail.
  if (!serverDeployed) return new Set<string>();
  if (serverSlugs) return serverSlugs;
  const result = await api<{ slugs: string[] }>('/api/tools');
  serverSlugs = new Set(result?.slugs ?? []);
  return serverSlugs;
}

/**
 * Labels for the *job* slugs a recipe is built from.
 *
 * A recipe names engine jobs (`merge`), not web tools (`merge-pdf`). The two
 * namespaces overlap but are not the same -- several web tools are the same job
 * with different options, and some jobs have no tool of their own -- so the
 * builder lists jobs and labels them honestly rather than offering tool names
 * that would post the wrong slug.
 */
export const SERVER_JOB_LABELS: Record<string, string> = {
  merge: 'Merge PDFs',
  organize: 'Organize pages',
  'split-by-pages': 'Split by pages',
  'split-in-half': 'Split in half',
  'n-up': 'N-up',
  edit: 'Edit PDF',
  stamp: 'Stamp',
  inspect: 'Inspect (report)',
};

/**
 * Server jobs whose result is not a document another step can consume.
 *
 * `inspect` returns a JSON report. `split-by-pages` returns a ZIP of parts
 * (plus listings), and the API's upload allow-list refuses the re-typed ZIP as
 * step 2's input. The engine's `WORKFLOW_OUTPUT_JOBS` has the same rule; this
 * local set keeps the builder's picker honest even when talking to an older API.
 */
export const TERMINAL_JOB_SLUGS: ReadonlySet<string> = new Set(['inspect', 'split-by-pages']);

/**
 * Own-property lookup for a job label. Step tools can come from saved recipes
 * (and older server data), so the indexed read must not resolve inherited
 * `Object.prototype` keys like `constructor`.
 */
export function serverJobLabel(slug: string): string {
  return (Object.hasOwn(SERVER_JOB_LABELS, slug) ? SERVER_JOB_LABELS[slug] : undefined) ?? slug;
}

/** Re-link a linear recipe after an insert, move or delete. */
export function relinkWorkflowSteps(steps: readonly WorkflowStep[]): WorkflowStep[] {
  return steps.map((step, index) => {
    const previous = steps[index - 1];
    if (!previous) {
      const { input: _input, ...first } = step;
      void _input;
      return first;
    }
    return { ...step, input: { kind: 'step' as const, stepId: previous.id } };
  });
}

/** True when a terminal step appears anywhere except the final position. */
export function hasNonFinalTerminalStep(steps: readonly WorkflowStep[]): boolean {
  return steps.slice(0, -1).some((step) => TERMINAL_JOB_SLUGS.has(step.tool));
}

/** The steps that stop a recipe from running, so the UI can say which and why. */
export async function unsupportedSteps(recipe: Recipe): Promise<WorkflowStep[]> {
  const slugs = await fetchServerSlugs();
  return recipe.steps.filter((step) => !slugs.has(step.tool));
}

/* ---------------------------------------------------------------- runner */

export interface RunProgress {
  stepIndex: number;
  stepCount: number;
  tool: string;
  phase: string;
  ratio?: number;
}

export interface RunResult {
  /** The final step's output, ready to download. */
  name: string;
  bytes: Uint8Array;
}

const POLL_MS = 900;

/** A delay that rejects promptly when the run is cancelled. */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function pollJob(
  jobId: string,
  token: string,
  onProgress: (phase: string, ratio?: number) => void,
  signal: AbortSignal,
): Promise<{ name: string; bytes: Uint8Array }[]> {
  for (;;) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const state = await api<{
      status: string;
      progress?: { phase: string; ratio?: number };
      files?: { name: string; bytes: number }[];
      error?: { message: string; code?: string };
    }>(`/api/jobs/${jobId}`, { jobToken: token, signal });

    if (!state) throw new ApiError(404, 'not_found', 'That job disappeared.');
    if (state.progress) onProgress(state.progress.phase, state.progress.ratio);
    else onProgress(state.status);

    if (state.status === 'failed') {
      throw new ApiError(
        500,
        state.error?.code ?? 'job_failed',
        state.error?.message ?? 'That step failed.',
      );
    }
    if (state.status === 'completed') {
      const files = state.files ?? [];
      if (files.length === 0) throw new ApiError(500, 'no_output', 'That step produced no file.');
      return Promise.all(
        files.map(async (file) => {
          const response = await fetch(`/api/jobs/${jobId}/files/${encodeURIComponent(file.name)}`, {
            headers: { 'x-job-token': token },
            signal,
          });
          if (!response.ok) throw new ApiError(response.status, 'download_failed', 'Could not fetch that step’s output.');
          return { name: file.name, bytes: new Uint8Array(await response.arrayBuffer()) };
        }),
      );
    }
    await abortableDelay(POLL_MS, signal);
  }
}

/**
 * Runs a recipe end to end. Each step's primary output feeds the next.
 *
 * A step that consumes an earlier step resolves against `outputs`, which is why
 * the engine's validator insists a reference points *backwards*: by the time a
 * step runs, its input is already in hand and never has to be fetched twice.
 */
export async function runRecipe(
  recipe: Recipe,
  source: File,
  onProgress: (progress: RunProgress) => void,
  signal: AbortSignal,
): Promise<RunResult> {
  const outputs = new Map<string, { name: string; bytes: Uint8Array }>();

  for (let index = 0; index < recipe.steps.length; index += 1) {
    const step = recipe.steps[index]!;
    const input =
      step.input?.kind === 'step' ? outputs.get(step.input.stepId) : undefined;
    if (step.input?.kind === 'step' && !input) {
      throw new ApiError(400, 'missing_input', `Step “${step.id}” has no output to consume.`);
    }

    const form = new FormData();
    form.append('slug', step.tool);
    if (input) {
      form.append('files', new File([input.bytes as BlobPart], input.name, { type: 'application/pdf' }));
    } else {
      form.append('files', source, source.name);
    }
    if (step.options && Object.keys(step.options).length > 0) {
      form.append('options', JSON.stringify(step.options));
    }

    onProgress({ stepIndex: index, stepCount: recipe.steps.length, tool: step.tool, phase: 'Uploading' });
    const created = await api<{ jobId: string; token: string }>('/api/jobs', { formData: form, signal });
    if (!created) throw new ApiError(500, 'no_job', 'The server did not accept that step.');

    const files = await pollJob(
      created.jobId,
      created.token,
      (phase, ratio) =>
        onProgress({
          stepIndex: index,
          stepCount: recipe.steps.length,
          tool: step.tool,
          phase,
          ...(ratio !== undefined ? { ratio } : {}),
        }),
      signal,
    ).catch((error: unknown) => {
      // Cancelling locally must not leave the paid server job running. The
      // DELETE is best-effort: the caller still gets the original abort/error.
      if (signal.aborted) {
        void api(`/api/jobs/${created.jobId}`, {
          method: 'DELETE',
          jobToken: created.token,
        }).catch(() => undefined);
      }
      throw error;
    });

    // The first output is the document the rest of the recipe works on. Extra
    // outputs (a split's ZIP members) are kept only for the final download.
    outputs.set(step.id, files[0]!);
    if (index === recipe.steps.length - 1) {
      return { name: files[0]!.name, bytes: files[0]!.bytes };
    }
  }

  throw new ApiError(400, 'empty_recipe', 'That workflow has no steps.');
}
