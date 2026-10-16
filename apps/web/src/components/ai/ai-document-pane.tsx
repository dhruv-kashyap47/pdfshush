/**
 * The document pane: one legible page at a time, with the pending AI changes
 * drawn on top of it.
 *
 * Renders through the same worker pipeline every other tool uses (`thumbnails`),
 * one page per render, so a legible preview costs one page of work rather than
 * one document's worth. Overlay boxes are stored in display-space points and
 * positioned as percentages of the page, so they stay correct at any render
 * scale — exactly the contract the redaction tool uses.
 */

import { ChevronLeft, ChevronRight, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** One pending AI change, positioned in display-space points on its page. */
export interface OverlayMarker {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tone: 'mark' | 'text' | 'erase';
}

interface AiDocumentPaneProps {
  fileName: string;
  pageCount: number;
  /** Active page, 1-based. */
  page: number;
  onPageChange(page: number): void;
  /** Legible render of the active page, once the worker has produced it. */
  imageUrl?: string | undefined;
  /** Display-space page size in points, needed to place overlay boxes. */
  pageSize?: { width: number; height: number } | undefined;
  /** Pending changes on the active page. */
  markers?: OverlayMarker[];
  /** Pages with a queued change anywhere in the document. */
  changedPages?: number[];
  /** Pages the latest answer cited — marked with a dot on the rail. */
  cited?: number[];
  /** A page render is in flight. */
  loading?: boolean;
}

const TONE: Record<OverlayMarker['tone'], string> = {
  mark: 'border border-amber-500/80 bg-amber-400/40',
  text: 'border border-primary/80 bg-primary/10',
  erase: 'border border-dashed border-rose-500/80 bg-rose-500/15',
};

/** Preview + navigation for the loaded document. */
export function AiDocumentPane({
  fileName,
  pageCount,
  page,
  onPageChange,
  imageUrl,
  pageSize,
  markers = [],
  changedPages = [],
  cited = [],
  loading = false,
}: AiDocumentPaneProps) {
  const citedSet = new Set(cited);
  const changedSet = new Set(changedPages);
  const markersReady = Boolean(pageSize && pageSize.width > 0 && pageSize.height > 0);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{fileName}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="w-16 text-center text-xs tabular-nums text-muted-foreground">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-14 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-muted/20 p-2">
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
            <button
              key={number}
              type="button"
              onClick={() => onPageChange(number)}
              aria-label={`Show page ${number}`}
              aria-current={number === page ? 'page' : undefined}
              className={cn(
                'relative flex h-7 w-full items-center justify-center rounded-md text-xs tabular-nums transition-colors',
                number === page
                  ? 'bg-primary font-medium text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {number}
              {changedSet.has(number) ? (
                <span
                  data-testid="ai-changed-page"
                  title={`Page ${number} has a pending change`}
                  className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500"
                />
              ) : citedSet.has(number) && number !== page ? (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-violet-500" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-muted/30 p-4">
          <div
            className="relative w-full max-w-md overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-black/5"
            style={pageSize ? { aspectRatio: `${pageSize.width} / ${pageSize.height}` } : undefined}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={`Page ${page}`}
                className="block h-full w-full select-none object-contain"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-white text-muted-foreground">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              </div>
            )}

            {markersReady
              ? markers.map((marker) => (
                  <span
                    key={marker.id}
                    aria-hidden
                    className={cn('absolute rounded-[2px]', TONE[marker.tone])}
                    style={{
                      left: `${(marker.x / pageSize!.width) * 100}%`,
                      top: `${(marker.y / pageSize!.height) * 100}%`,
                      width: `${(marker.width / pageSize!.width) * 100}%`,
                      height: `${(marker.height / pageSize!.height) * 100}%`,
                    }}
                  />
                ))
              : null}
          </div>
        </div>
      </div>
    </div>
  );
}
