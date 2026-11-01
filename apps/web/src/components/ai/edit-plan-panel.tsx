/**
 * The change ledger.
 *
 * Every change the model proposed is one line in the ledger, named in the
 * user's terms, individually discardable, and traceable back to its page.
 * "Apply" is the only thing that writes a file, and it reports each engine step
 * as it runs (text rewrites & overlays, then page order, then header/footer).
 * Nothing here trusts the model: the numbers come from the same plan the engine
 * is handed.
 *
 * The ledger is collapsed to a single line when empty and expands with a single
 * height transition the first time a change arrives — the one place a layout
 * transition is the correct answer, because the panel is genuinely changing size.
 */

import { useEffect, useRef } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  ArrowUpRight,
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
import { useMagnetic } from '@/hooks/use-magnetic';
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

const COLLAPSED_HEIGHT = 68;
const LEDGER_CAP = 336;

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
  const rootRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const applyRef = useMagnetic<HTMLButtonElement>(3);

  const blockedCount = blocked?.length ?? 0;
  const remaining = Math.max(0, entries.length - blockedCount);
  const expanded = entries.length > 0 || blockedCount > 0;

  /* One deliberate height transition when the ledger fills or empties. */
  const heightRef = useRef<number | null>(null);
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const wide = window.matchMedia?.('(min-width: 640px)').matches ?? true;
    const cap = wide ? LEDGER_CAP : 300;
    // Header + rows + footer, capped. A one-change ledger should not steal the
    // whole thread; a long one scrolls internally.
    const content =
      136 +
      entries.length * 50 +
      (blockedCount > 0 ? 128 + blockedCount * 42 : 0) +
      (applying ? 14 : 0);
    const target = expanded ? Math.min(cap, content) : COLLAPSED_HEIGHT;
    const from = heightRef.current;
    heightRef.current = target;
    if (from === null || from === target) {
      node.style.height = `${target}px`;
      return;
    }
    if (prefersReducedMotion()) {
      node.style.height = `${target}px`;
      return;
    }
    motion.animate(node, {
      height: [from, target],
      duration: dur(480),
      ease: EASE.out,
    });
  }, [expanded, blockedCount, entries.length, applying, motion]);

  /* Row entrance: the same choreography the chat uses, applied to the ledger. */
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || prefersReducedMotion()) return;
    const fresh: HTMLElement[] = [];
    for (const node of root.querySelectorAll<HTMLElement>('[data-motion-id]')) {
      const id = node.dataset.motionId;
      if (!id || seenRef.current.has(id)) continue;
      seenRef.current.add(id);
      fresh.push(node);
    }
    if (fresh.length === 0) return;
    for (const node of fresh) node.style.opacity = '0';
    motion.animate(fresh, {
      translateY: [7, 0],
      opacity: [0, 1],
      duration: dur(340),
      ease: EASE.out,
      delay: staggerUI(50),
    });
  }, [entries, blocked, motion]);
  useEffect(() => () => seenRef.current.clear(), []);

  return (
    <section
      ref={rootRef}
      data-testid="ai-edit-plan"
      aria-label="Proposed changes"
      className="studio-ledger shrink-0 overflow-hidden"
      style={{ height: COLLAPSED_HEIGHT }}
    >
      <header className="studio-ledger-head">
        <span className="studio-glyph" aria-hidden>
          <Wand2 className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="studio-ledger-title">
            Changes to apply
            {entries.length > 0 ? (
              <span className="studio-ledger-count tabular-nums">{entries.length}</span>
            ) : null}
          </p>
          <p className="studio-ledger-sub">
            {entries.length === 0
              ? 'Every proposed edit lands here before it touches the file.'
              : `${entries.length} proposed, nothing written yet`}
          </p>
        </div>
        {entries.length > 0 && !applying ? (
          <button type="button" onClick={onDiscardAll} className="studio-text-btn">
            Discard all
          </button>
        ) : null}
      </header>

      <div className="studio-ledger-body" ref={bodyRef}>
        {blockedCount > 0 ? (
          <div
            data-testid="ai-edit-blocked"
            data-motion-id="blocked-card"
            role="alert"
            className="studio-blocked"
          >
            <div className="flex items-start gap-2">
              <ShieldX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">
                  The engine refused {blockedCount === 1 ? 'this change' : `${blockedCount} changes`} on
                  the last apply
                </p>
                <p className="mt-0.5 text-[0.7rem] leading-snug opacity-80">
                  Nothing was written. Discard the refused changes and the rest can still be applied.
                </p>
              </div>
            </div>
            <ul className="mt-2 space-y-1">
              {blocked!.map((change) => {
                const Icon = KIND_ICON[change.entry.kind];
                return (
                  <li
                    key={change.entry.id}
                    data-motion-id={`blocked:${change.entry.id}`}
                    className="studio-blocked-row"
                  >
                    <Icon className="h-3 w-3 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.7rem] font-medium">{change.entry.title}</p>
                      <p className="text-[0.68rem] leading-snug opacity-75">{change.reason}</p>
                    </div>
                    {!applying ? (
                      <button
                        type="button"
                        onClick={() => onDiscard(change.entry.id)}
                        aria-label={`Discard: ${change.entry.title}`}
                        className="studio-blocked-x"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <details className="mt-2">
              <summary className="flex cursor-pointer items-center gap-1 text-[0.68rem] font-medium">
                <AlertTriangle className="h-3 w-3" /> Why was it refused?
              </summary>
              <p className="studio-blocked-detail">{blockedDetail}</p>
            </details>
            {!applying && onRetryWithoutFailed ? (
              <div className="mt-2 flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 flex-1 border-amber-500/40 text-[0.7rem] text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                  onClick={onRetryWithoutFailed}
                  data-testid="ai-edit-retry-without-failed"
                >
                  <Wand2 className="mr-1.5 h-3 w-3" />
                  {remaining > 0
                    ? `Discard failed & apply ${remaining}`
                    : `Discard the refused change${blockedCount === 1 ? '' : 's'}`}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-[0.7rem]" onClick={onDiscardAll}>
                  <Trash2 className="mr-1 h-3 w-3" /> All
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {entries.length === 0 ? null : (
          <ul className="space-y-px">
            {entries.map((entry) => {
              const Icon = KIND_ICON[entry.kind];
              const isBlocked = blocked?.some((change) => change.entry.id === entry.id);
              return (
                <li
                  key={entry.id}
                  data-motion-id={`entry:${entry.id}`}
                  className={cn('studio-change group', isBlocked && 'is-blocked')}
                >
                  <span className="studio-change-glyph" aria-hidden>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="studio-change-title">{entry.title}</p>
                      <span className="studio-change-pages">
                        {entry.pages.slice(0, 4).map((page) => (
                          <button
                            key={page}
                            type="button"
                            onClick={() => onShowPage(page)}
                            className="studio-page-chip tabular-nums"
                            title={`Show page ${page}`}
                          >
                            p.{page}
                          </button>
                        ))}
                        {entry.pages.length > 4 ? (
                          <span className="text-[0.65rem] text-muted-foreground">
                            +{entry.pages.length - 4}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <p className="studio-change-detail" title={entry.detail}>
                      {entry.detail}
                    </p>
                  </div>
                  {!applying ? (
                    <button
                      type="button"
                      onClick={() => onDiscard(entry.id)}
                      aria-label={`Discard: ${entry.title}`}
                      className="studio-change-discard"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="studio-ledger-foot">
        {error ? (
          <p className="studio-error mb-2" role="alert">
            {error}
          </p>
        ) : null}

        {applying ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[0.72rem] text-muted-foreground">
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
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
            <div
              className="studio-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <span style={{ transform: `scaleX(${Math.max(0.02, progress)})` }} />
            </div>
          </div>
        ) : (
          <Button
            ref={applyRef}
            className="studio-apply w-full"
            disabled={entries.length === 0}
            onClick={onApply}
            data-testid="ai-edit-apply"
          >
            <span>
              {entries.length === 0
                ? 'No changes queued'
                : `Apply ${entries.length} change${entries.length === 1 ? '' : 's'} & download`}
            </span>
            <ArrowUpRight className="ml-auto h-4 w-4" />
          </Button>
        )}
      </footer>
    </section>
  );
}
