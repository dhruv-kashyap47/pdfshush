/**
 * Workflows: build a recipe, save it, and run it over a file.
 *
 * Recipes are stored locally (IndexedDB) when signed out and mirrored to the
 * account when signed in, so the page behaves identically either way -- accounts
 * are an addition, never a gate.
 *
 * Running is deliberately server-side and sequential: each step is one real job
 * through `/api/jobs`, and the previous step's output becomes the next step's
 * input. A recipe containing a step this deployment cannot run says so up front
 * instead of failing halfway through.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import {
  deleteLocalRecipe,
  fetchServerSlugs,
  hasNonFinalTerminalStep,
  listLocalRecipes,
  relinkWorkflowSteps,
  runRecipe,
  saveLocalRecipe,
  SERVER_JOB_LABELS,
  serverJobLabel,
  TERMINAL_JOB_SLUGS,
  unsupportedSteps,
  type Recipe,
  type RunProgress,
  type StoredRecipe,
  type WorkflowStep,
} from '@/lib/workflows';
import { downloadBytes } from '@/lib/download';

let stepCounter = 0;
function newStepId(): string {
  stepCounter += 1;
  return `s${Date.now().toString(36)}${stepCounter}`;
}

export function WorkflowsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { account, accountsEnabled } = useAuth();
  const [recipes, setRecipes] = useState<StoredRecipe[]>([]);
  const [draft, setDraft] = useState<Recipe>({ name: '', steps: [] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<WorkflowStep[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [runnable, setRunnable] = useState<string[]>([]);
  const runAbortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      runAbortRef.current?.abort();
    };
  }, []);

  // The picker offers the *job* slugs this deployment can actually run, in a
  // stable order, rather than every tool name in the catalog.
  useEffect(() => {
    let cancelled = false;
    void fetchServerSlugs()
      .then((slugs) => {
        if (cancelled) return;
        setRunnable(
          Object.keys(SERVER_JOB_LABELS)
            .filter((slug) => slugs.has(slug))
            .sort((a, b) => serverJobLabel(a).localeCompare(serverJobLabel(b))),
        );
      })
      .catch(() => {
        if (!cancelled) setRunnable([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    if (account) {
      try {
        const result = await api<{ workflows: StoredRecipe[] }>('/api/account/workflows');
        setRecipes(result?.workflows ?? []);
        return;
      } catch {
        // Fall through to local: an account that cannot be reached must not take
        // the page down.
      }
    }
    setRecipes(await listLocalRecipes());
  }, [account]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Re-check which steps this deployment cannot run whenever the recipe changes.
  // The badge is cosmetic, so an unreachable API (which cannot answer) clears it
  // rather than rejecting: an unhandled rejection here is console noise on a
  // page that is explicitly designed to work signed out and offline.
  useEffect(() => {
    let cancelled = false;
    void unsupportedSteps(draft)
      .then((steps) => {
        if (!cancelled) setBlocked(steps);
      })
      .catch(() => {
        if (!cancelled) setBlocked([]);
      });
    return () => {
      cancelled = true;
    };
  }, [draft]);

  const addStep = (tool: string) => {
    setDraft((current) => {
      const previous = current.steps[current.steps.length - 1];
      // A terminal job cannot feed a later step; the picker hides these once a
      // recipe has started, and this guard keeps keyboard/quick clicks honest.
      if (previous && TERMINAL_JOB_SLUGS.has(previous.tool)) return current;
      const id = newStepId();
      return {
        ...current,
        steps: [
          ...current.steps,
          {
            id,
            tool,
            // The first step consumes the uploaded file; later ones consume the
            // step before them, which is what the engine's validator expects.
            ...(previous ? { input: { kind: 'step' as const, stepId: previous.id } } : {}),
          },
        ],
      };
    });
  };

  const move = (index: number, delta: number) => {
    setDraft((current) => {
      const next = [...current.steps];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item!);
      // Re-link the chain so it stays linear and every reference points backwards.
      return { ...current, steps: relinkWorkflowSteps(next) };
    });
  };

  const save = async () => {
    if (draft.steps.length === 0) {
      toast.error('Add at least one step.');
      return;
    }
    if (hasNonFinalTerminalStep(draft.steps)) {
      toast.error('Inspect and Split by pages must be the final step. Remove what follows them.');
      return;
    }
    if (draft.name.trim().length === 0) {
      toast.error('Give the workflow a name.');
      return;
    }
    try {
      if (account) {
        if (editingId) {
          await api(`/api/account/workflows/${editingId}`, {
            method: 'PUT',
            body: { name: draft.name.trim(), steps: draft.steps },
          });
        } else {
          await api('/api/account/workflows', {
            method: 'POST',
            body: { name: draft.name.trim(), steps: draft.steps },
          });
        }
      } else {
        await saveLocalRecipe({ ...draft, ...(editingId ? { id: editingId } : {}) });
      }
      toast.success('Workflow saved.');
      setDraft({ name: '', steps: [] });
      setEditingId(null);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save that workflow.');
    }
  };

  const remove = async (id: string) => {
    try {
      if (account) await api(`/api/account/workflows/${id}`, { method: 'DELETE' });
      else await deleteLocalRecipe(id);
      if (editingId === id) {
        setEditingId(null);
        setDraft({ name: '', steps: [] });
      }
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete that workflow.');
    }
  };

  const run = async () => {
    if (!file) {
      toast.error('Choose a PDF to run the workflow on.');
      return;
    }
    if (blocked.length > 0) {
      toast.error('Remove steps this deployment cannot run before starting.');
      return;
    }
    if (hasNonFinalTerminalStep(draft.steps)) {
      toast.error('Inspect and Split by pages must be the final step.');
      return;
    }
    setRunning(true);
    setProgress(null);
    const controller = new AbortController();
    runAbortRef.current = controller;
    try {
      const result = await runRecipe(draft, file, setProgress, controller.signal);
      if (aliveRef.current) {
        downloadBytes(result.bytes, result.name);
        toast.success('Workflow finished.');
      }
    } catch (error) {
      if (
        aliveRef.current &&
        !(error instanceof DOMException && error.name === 'AbortError')
      ) {
        toast.error(error instanceof Error ? error.message : 'The workflow failed.');
      }
    } finally {
      if (runAbortRef.current === controller) runAbortRef.current = null;
      if (aliveRef.current) {
        setRunning(false);
        setProgress(null);
      }
    }
  };

  const usingServer = Boolean(account);
  const chainBlocked = hasNonFinalTerminalStep(draft.steps);
  const lastStep = draft.steps[draft.steps.length - 1];
  const canAddStep = !lastStep || !TERMINAL_JOB_SLUGS.has(lastStep.tool);
  const selectableJobs =
    draft.steps.length === 0
      ? runnable
      : runnable.filter((slug) => !TERMINAL_JOB_SLUGS.has(slug));
  const cannotRun = blocked.length > 0 || chainBlocked;

  return (
    <div className={embedded ? 'space-y-6' : 'mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8'}>
      {!embedded && (
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Workflows</h1>
          <p className="mt-2 text-muted-foreground">
            Chain tools together and run them on a file in one pass.
            {usingServer
              ? ' Saved to your account.'
              : ' Saved in this browser; sign in to sync them across devices.'}
          </p>
        </div>
      )}

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>{editingId ? 'Edit workflow' : 'New workflow'}</CardTitle>
          <CardDescription>
            Steps run in order, each one starting from the previous step’s output.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workflow-name">Name</Label>
            <Input
              id="workflow-name"
              value={draft.name}
              maxLength={80}
              placeholder="e.g. Merge, then stamp"
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Steps</Label>
            {draft.steps.length === 0 && (
              <p className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">
                No steps yet: add a tool below.
              </p>
            )}
            <ol className="space-y-2">
              {draft.steps.map((step, index) => {
                const unsupported = blocked.some((entry) => entry.id === step.id);
                return (
                  <li
                    key={step.id}
                    className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2"
                  >
                    <span className="text-xs text-muted-foreground">{index + 1}</span>
                    <span className="flex-1 truncate text-sm">
                    {serverJobLabel(step.tool)}
                    </span>
                    {unsupported && <Badge variant="destructive">server cannot run this</Badge>}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Move step up"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Move step down"
                      disabled={index === draft.steps.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove step"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          steps: relinkWorkflowSteps(
                            current.steps.filter((entry) => entry.id !== step.id),
                          ),
                        }))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ol>

            <select
              aria-label="Add a step"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value=""
              disabled={!canAddStep}
              onChange={(event) => {
                if (event.target.value) addStep(event.target.value);
                event.target.value = '';
              }}
            >
              <option value="">
                {canAddStep ? '+ Add a step…' : 'This step must be last; save or remove it to continue'}
              </option>
              {selectableJobs.map((slug) => (
                <option key={slug} value={slug}>
                  {serverJobLabel(slug)}
                </option>
              ))}
            </select>
            {chainBlocked ? (
              <p role="alert" className="text-xs text-destructive">
                Inspect and Split by pages must be the final step. Move or remove the steps after them
                before saving or running.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Steps run with each tool’s default options. Configurable options arrive with the
              workflow builder’s next pass.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void save()}>
              <Plus className="mr-1.5 h-4 w-4" />
              {editingId ? 'Save changes' : 'Save workflow'}
            </Button>
            {editingId && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditingId(null);
                  setDraft({ name: '', steps: [] });
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Run</CardTitle>
          <CardDescription>
            Runs the workflow above. Every step is processed on the server; files are deleted
            afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            type="file"
            accept=".pdf,application/pdf"
            aria-label="File to run the workflow on"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
          {progress && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Step {progress.stepIndex + 1} of {progress.stepCount} · {progress.phase}
              </p>
              <Progress value={progress.ratio !== undefined ? Math.round(progress.ratio * 100) : undefined} />
            </div>
          )}
          <Button disabled={running || draft.steps.length === 0 || cannotRun} onClick={() => void run()}>
            {running ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-4 w-4" />
            )}
            Run workflow
          </Button>
          {running ? (
            <Button variant="outline" onClick={() => runAbortRef.current?.abort()}>
              Stop
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Saved workflows</h2>
        {recipes.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing saved yet.</p>
        )}
        {recipes.map((recipe) => (
          <div
            key={recipe.id}
            className="flex items-center gap-3 rounded-md border border-border/70 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{recipe.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {recipe.steps.map((step) => serverJobLabel(step.tool)).join(' → ')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft({ name: recipe.name, steps: recipe.steps });
                setEditingId(recipe.id);
              }}
            >
              Edit
            </Button>
            <Button variant="ghost" size="icon" aria-label="Delete workflow" onClick={() => void remove(recipe.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {!usingServer && accountsEnabled && (
        <p className="mt-8 text-sm text-muted-foreground">
          <Link to="/account" className="underline">
            Sign in
          </Link>{' '}
          to sync workflows, keep a history and use them anywhere.
        </p>
      )}
    </div>
  );
}
