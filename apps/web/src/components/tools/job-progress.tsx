import { useEffect, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatPercent } from '@/lib/format';
import type { JobProgress } from '@pdfshush/pdf-core';

interface JobProgressPanelProps {
  progress: JobProgress | null;
  onCancel: () => void;
}

/**
 * After this long the panel stops being a spinner and says out loud that the
 * job is still going. A spinner with no clock is indistinguishable from a hang,
 * and "wait longer" is not advice a user can act on; the elapsed time plus a
 * visible Cancel is.
 */
const STILL_WORKING_AFTER_MS = 8_000;

/** Live progress for a running job: phase label, bar, elapsed time + cancel. */
export function JobProgressPanel({ progress, onCancel }: JobProgressPanelProps) {
  const ratio = progress?.ratio;
  // The panel mounts when a run starts, so mount time is run start time. A
  // second run unmounts it between runs, which resets the clock honestly.
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsedMs = Math.max(0, now - startedAt);
  const stillWorking = elapsedMs >= STILL_WORKING_AFTER_MS;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{progress?.phase ?? 'Working…'}</p>
            {progress?.message && (
              <p className="truncate text-xs text-muted-foreground">{progress.message}</p>
            )}
          </div>
        </div>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {ratio !== undefined ? `${formatPercent(ratio)} · ` : ''}
          {/* A screen reader should hear the phase, not a counter ticking every
              second; the visible clock is for sighted users watching for a hang. */}
          <span aria-hidden="true">{formatElapsed(elapsedMs)}</span>
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Progress value={ratio !== undefined ? ratio * 100 : null} className="flex-1" />
        <Button variant="outline" size="sm" onClick={onCancel}>
          <XCircle className="mr-1.5 h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>

      {stillWorking && (
        <p className="mt-3 text-xs text-muted-foreground">
          Still working — large documents can take a minute. Cancel stops it immediately and keeps
          your files here.
        </p>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
