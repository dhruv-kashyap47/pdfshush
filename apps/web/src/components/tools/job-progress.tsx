import { Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatPercent } from '@/lib/format';
import type { JobProgress } from '@pdfshush/pdf-core';

interface JobProgressPanelProps {
  progress: JobProgress | null;
  onCancel: () => void;
}

/** Live progress for a running job: phase label, bar (or spinner) + cancel. */
export function JobProgressPanel({ progress, onCancel }: JobProgressPanelProps) {
  const ratio = progress?.ratio;

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
          {ratio !== undefined ? formatPercent(ratio) : ''}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Progress value={ratio !== undefined ? ratio * 100 : null} className="flex-1" />
        <Button variant="outline" size="sm" onClick={onCancel}>
          <XCircle className="mr-1.5 h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
