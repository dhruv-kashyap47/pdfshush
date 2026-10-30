/**
 * Review panel for the AI editor.
 *
 * Every change the model queued is one card, named in the user's terms and
 * individually discardable. "Apply" is the only thing that writes a file, and it
 * reports each engine step as it runs (text rewrites & overlays → page order →
 * header/footer). Nothing here trusts the model: the numbers on these cards come
 * from the same plan the engine is handed.
 */

import { useEffect, useRef } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  Eraser,
  Highlighter,
  Loader2,
  Printer,
  Replace,
  RotateCw,
  ShieldX,
  Trash2,
  Type,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useMotionScope } from '@/hooks/use-motion';
import type { AiEditEntry, AiEditKind, ApplyStep } from '@/lib/ai/edit-skill';
import { cn } from '@/lib/utils';
import { EASE, dur, staggerUI, prefersReducedMotion } from '@/lib/motion';

/** A queued change the engine refused, with the engine's own reason. */
export interface BlockedEditChange {
  entry: AiEditEntry;
  reason: string;
}

const KIND_ICON: Record<AiEditKind, LucideIcon> = {
  markup: Highlighter,
  replace: Replace,
  erase: Eraser,
  insert: Type,
  rotate: RotateCw,
  'delete-pages': Trash2,
  reorder: ArrowUpDown,
  stamp: Printer,
};

interface EditPlanPanelProps {
  entries: AiEditEntry[];
  applying: boolean;
  /** The engine step currently running, when applying. */
  step: ApplyStep | null;
  progress: number;
  error: string | null;
  /** Queued changes the last apply refused, with per-entry engine reasons. */
  blocked?: BlockedEditChange[];
  /** The engine's full refusal report, for the "why" disclosure. */
  blockedDetail?: string | null;
  onDiscard(id: string): void;
  onDiscardAll(): void;
  onApply(): void;
  /** Discard every refused entry, then apply what remains. */
  onRetryWithoutFailed?(): void;
  onStop(): void;
  onShowPage(page: number): void;
}

/** The queued-change review list and the single Apply action. */
export function EditPlanPanel({
  entries,
  applying,
  step,
  progress,
  error,
  blocked,
  blockedDetail,
  onDiscard,
  onDiscardAll,
  onApply,
  onRetryWithoutFailed,
  onStop,
  onShowPage,
}: EditPlanPanelProps) {
  const motion = useMotionScope();
  const seenRef = useRef<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * Card entrances: the same choreography the chat pane uses, applied to the
   * review list — each edit card the model queues slides in individually, and
   * settled cards never re-animate on re-render.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;
    const fresh: HTMLElement[] = [];
    for (const node of root.querySelectorAll<HTMLElement>('[data-motion-id]')) {
      const id = node.dataset.motionId;
      if (!id || seenRef.current.has(id)) continue;
      seenRef.current.add(id);
      fresh.push(node);
    }
    if (fresh.length === 0) return;
    motion.animate(fresh, {
      translateY: [8, 0],
      opacity: [0, 1],
      duration: dur(320),
      ease: EASE.out,
      delay: staggerUI(45),
    });
  }, [entries, blocked, motion]);
  useEffect(() => () => seenRef.current.clear(), []);

  const blockedCount = blocked?.length ?? 0;
  const remaining = Math.max(0, entries.length - blockedCount);
  return (
    <div
      data-testid="ai-edit-plan"
      className={cn(
        'flex shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card',
        // A refusal needs room for its card and its two ways forward; the
        // chat pane above gives the space up (it is the flexible one).
        blockedCount > 0 ? 'max-h-[26rem]' : 'max-h-72',
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Wand2 className="h-4 w-4 shrink-0 text-primary" />
        <p className="text-sm font-semibold">Changes to apply</p>
        {entries.length > 0 ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
            {entries.length}
          </span>
        ) : null}
        {entries.length > 0 && !applying ? (
          <button
            type="button"
            onClick={onDiscardAll}
            className="ml-auto text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Discard all
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {blockedCount > 0 ? (
          <div
            data-testid="ai-edit-blocked"
            data-motion-id="blocked-card"
            className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
          >
            <div className="flex items-start gap-2">
              <ShieldX className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                  The engine refused {blockedCount === 1 ? 'this change' : `${blockedCount} changes`} on the
                  last apply
                </p>
                <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-300/80">
                  Nothing was written. Discard the refused changes and the rest can still be applied.
                </p>
              </div>
            </div>
            <ul className="mt-2 space-y-1.5">
              {blocked!.map((change) => {
                const Icon = KIND_ICON[change.entry.kind];
                return (
                  <li
                    key={change.entry.id}
                    data-motion-id={`blocked:${change.entry.id}`}
                    className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-background/60 px-2 py-1.5"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      <Icon className="h-3 w-3" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-xs font-medium">{change.entry.title}</p>
                        {change.entry.pages.slice(0, 3).map((page) => (
                          <button
                            key={page}
                            type="button"
                            onClick={() => onShowPage(page)}
                            className="rounded bg-violet-500/10 px-1 py-px text-[0.65rem] font-medium tabular-nums text-violet-600 transition-colors hover:bg-violet-500/20 dark:text-violet-300"
                            title={`Show page ${page}`}
                          >
                            p.{page}
                          </button>
                        ))}
                      </div>
                      <p className="mt-0.5 text-[0.7rem] leading-snug text-muted-foreground">{change.reason}</p>
                    </div>
                    {!applying ? (
                      <button
                        type="button"
                        onClick={() => onDiscard(change.entry.id)}
                        aria-label={`Discard: ${change.entry.title}`}
                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <details className="group mt-2">
              <summary className="flex cursor-pointer items-center gap-1 text-[0.7rem] font-medium text-amber-700 transition-colors hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200">
                <AlertTriangle className="h-3 w-3" /> Why was it refused?
              </summary>
              <p className="mt-1 whitespace-pre-wrap break-words rounded bg-background/60 px-2 py-1.5 text-[0.7rem] leading-snug text-muted-foreground">
                {blockedDetail}
              </p>
            </details>
            {!applying && onRetryWithoutFailed ? (
              <div className="mt-2.5 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 flex-1 border-amber-500/50 text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
                  onClick={onRetryWithoutFailed}
                  data-testid="ai-edit-retry-without-failed"
                >
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                  {remaining > 0
                    ? `Discard failed & apply ${remaining} change${remaining === 1 ? '' : 's'}`
                    : `Discard the refused change${blockedCount === 1 ? '' : 's'}`}
                </Button>
                <Button size="sm" variant="ghost" className="h-7" onClick={onDiscardAll}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Discard all
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {entries.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Describe a change and every edit the assistant proposes appears here for review before
            anything is written. Highlighting, rewriting, erasing, inserting, rotating, reordering
            and stamping are all supported.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((entry) => {
              const Icon = KIND_ICON[entry.kind];
              const isBlocked = blocked?.some((change) => change.entry.id === entry.id);
              return (
                <li
                  key={entry.id}
                  data-motion-id={`entry:${entry.id}`}
                  className={cn(
                    'flex items-start gap-2.5 rounded-lg border bg-background px-2.5 py-2',
                    isBlocked
                      ? 'border-amber-500/40 bg-amber-500/5'
                      : 'border-border/70',
                  )}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-medium">{entry.title}</p>
                      {entry.pages.slice(0, 4).map((page) => (
                        <button
                          key={page}
                          type="button"
                          onClick={() => onShowPage(page)}
                          className="rounded bg-violet-500/10 px-1 py-px text-[0.7rem] font-medium tabular-nums text-violet-600 transition-colors hover:bg-violet-500/20 dark:text-violet-300"
                          title={`Show page ${page}`}
                        >
                          p.{page}
                        </button>
                      ))}
                      {entry.pages.length > 4 ? (
                        <span className="text-[0.7rem] text-muted-foreground">
                          +{entry.pages.length - 4}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground" title={entry.detail}>
                      {entry.detail}
                    </p>
                  </div>
                  {!applying ? (
                    <button
                      type="button"
                      onClick={() => onDiscard(entry.id)}
                      aria-label={`Discard: ${entry.title}`}
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-3">
        {error ? (
          <p className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        {applying ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span className="truncate">
                {step ? `${step.label} (${step.index + 1}/${step.total})` : 'Applying changes…'}
              </span>
              <button
                type="button"
                onClick={onStop}
                className="ml-auto font-medium text-foreground transition-colors hover:text-destructive"
              >
                Stop
              </button>
            </div>
            <Progress value={Math.round(progress * 100)} />
          </div>
        ) : (
          <Button
            className={cn('w-full')}
            disabled={entries.length === 0}
            onClick={onApply}
            data-testid="ai-edit-apply"
          >
            <Wand2 className="mr-1.5 h-4 w-4" />
            {entries.length === 0
              ? 'No changes queued'
              : `Apply ${entries.length} change${entries.length === 1 ? '' : 's'} & download`}
          </Button>
        )}
      </div>
    </div>
  );
}
