import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Download, Pencil, RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format';
import { announceLocalProcessing } from '@/lib/privacy';
import { nextFor } from '@/tools/registry';
import { useToolSlug } from '@/tools/tool-context';

interface ResultPanelProps {
  fileName: string;
  pageCount?: number;
  sizeBytes: number;
  onDownload: () => void;
  onReset: () => void;
  downloadLabel?: string;
  /** Optional third action: the editor keeps the document open after a save. */
  onContinue?: () => void;
  continueLabel?: string;
  children?: ReactNode;
  footerNote?: ReactNode;
}

/**
 * Success state: what was produced, how big it is, download + start over.
 * Also the cross-pollination surface: suggests the next live tools for this
 * one, and fires the one-time "processed on this device" confirmation.
 */
export function ResultPanel({
  fileName,
  pageCount,
  sizeBytes,
  onDownload,
  onReset,
  downloadLabel = 'Download',
  onContinue,
  continueLabel = 'Continue',
  children,
  footerNote,
}: ResultPanelProps) {
  const slug = useToolSlug();
  const next = slug ? nextFor(slug) : [];

  useEffect(() => {
    announceLocalProcessing(pageCount);
  }, [pageCount]);

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
          {onContinue && (
            <Button variant="ghost" onClick={onContinue} data-testid="result-continue">
              <Pencil className="mr-1.5 h-4 w-4" />
              {continueLabel}
            </Button>
          )}
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
      {next.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="next-tools">
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            What&apos;s next
          </span>
          {next.map((def) => (
            <Link
              key={def.slug}
              to={`/tools/${def.slug}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
              data-testid={`next-chip-${def.slug}`}
            >
              <def.icon className="h-3.5 w-3.5" />
              {def.name}
            </Link>
          ))}
        </div>
      )}
      {footerNote && <div className="mt-3 text-xs text-muted-foreground">{footerNote}</div>}
    </div>
  );
}
