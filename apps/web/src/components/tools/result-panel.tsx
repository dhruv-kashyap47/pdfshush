import type { ReactNode } from 'react';
import { CheckCircle2, Download, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format';

interface ResultPanelProps {
  fileName: string;
  pageCount?: number;
  sizeBytes: number;
  onDownload: () => void;
  onReset: () => void;
  downloadLabel?: string;
  children?: ReactNode;
  footerNote?: ReactNode;
}

/** Success state: what was produced, how big it is, download + start over. */
export function ResultPanel({
  fileName,
  pageCount,
  sizeBytes,
  onDownload,
  onReset,
  downloadLabel = 'Download',
  children,
  footerNote,
}: ResultPanelProps) {
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <CheckCircle2 className="h-8 w-8 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{fileName}</p>
            <p className="text-sm text-muted-foreground">
              {pageCount !== undefined ? `${pageCount.toLocaleString()} page${pageCount === 1 ? '' : 's'} · ` : ''}
              {formatBytes(sizeBytes)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={onReset}>
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Start over
          </Button>
          <Button onClick={onDownload}>
            <Download className="mr-1.5 h-4 w-4" />
            {downloadLabel}
          </Button>
        </div>
      </div>
      {children && <div className="mt-4">{children}</div>}
      {footerNote && <div className="mt-3 text-xs text-muted-foreground">{footerNote}</div>}
    </div>
  );
}
