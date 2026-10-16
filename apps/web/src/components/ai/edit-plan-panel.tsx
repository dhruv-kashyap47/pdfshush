/**
 * Review panel for the AI editor.
 *
 * Every change the model queued is one card, named in the user's terms and
 * individually discardable. "Apply" is the only thing that writes a file, and it
 * reports each engine step as it runs (text rewrites & overlays → page order →
 * header/footer). Nothing here trusts the model: the numbers on these cards come
 * from the same plan the engine is handed.
 */

import {
  ArrowUpDown,
  Eraser,
  Highlighter,
  Loader2,
  Printer,
  Replace,
  RotateCw,
  Trash2,
  Type,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { AiEditEntry, AiEditKind, ApplyStep } from '@/lib/ai/edit-skill';
import { cn } from '@/lib/utils';

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
  onDiscard(id: string): void;
  onDiscardAll(): void;
  onApply(): void;
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
  onDiscard,
  onDiscardAll,
  onApply,
  onStop,
  onShowPage,
}: EditPlanPanelProps) {
  return (
    <div
      data-testid="ai-edit-plan"
      className="flex max-h-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
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
              return (
                <li
                  key={entry.id}
                  className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-background px-2.5 py-2"
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
