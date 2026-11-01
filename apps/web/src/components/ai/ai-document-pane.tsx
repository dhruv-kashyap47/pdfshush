/**
 * The document stage.
 *
 * One legible page on an opaque mat, with a quiet filmstrip of folios beside it.
 * Everything here is in service of reading the page: the chrome is a single
 * hairline bar, the rail carries only numbers and two kinds of mark (a pending
 * change, a page the answer cited), and pending overlays are positioned as
 * percentages of the page box so they stay true at any zoom or render scale.
 *
 * Zoom is real: it changes the page's rendered width and lets the stage scroll.
 * Page changes crossfade with a small rise, and pending marks draw in once.
 */

import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Minus,
  Plus,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMotionScope } from '@/hooks/use-motion';
import { cn } from '@/lib/utils';
import { EASE, dur, prefersReducedMotion, staggerUI } from '@/lib/motion';

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
  /** Pages the latest answer cited. */
  cited?: number[];
  /** A page render is in flight. */
  loading?: boolean;
}

const TONE: Record<OverlayMarker['tone'], string> = {
  mark: 'studio-mark studio-mark--highlight',
  text: 'studio-mark studio-mark--insert',
  erase: 'studio-mark studio-mark--erase',
};

const ZOOM_STEPS = [0.85, 1, 1.2, 1.45] as const;

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
  const motion = useMotionScope();
  const stageRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLElement>(null);
  const [zoomIndex, setZoomIndex] = useState(1);
  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;
  const changedSet = useMemo(() => new Set(changedPages), [changedPages]);
  const citedSet = useMemo(() => new Set(cited), [cited]);
  const markersReady = Boolean(pageSize && pageSize.width > 0 && pageSize.height > 0);
  const markerKey = markers.map((marker) => marker.id).join('|');

  const pageLabel = `${page} of ${pageCount}`;

  // Keep the active folio visible in both rails without scrolling the window.
  useEffect(() => {
    const rail = railRef.current;
    const strip = stripRef.current;
    const activeInRail = rail?.querySelector<HTMLElement>('[aria-current="page"]');
    if (rail && activeInRail) {
      rail.scrollTop =
        activeInRail.offsetTop - rail.clientHeight / 2 + activeInRail.clientHeight / 2;
    }
    const activeInStrip = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (strip && activeInStrip) {
      strip.scrollLeft =
        activeInStrip.offsetLeft - strip.clientWidth / 2 + activeInStrip.clientWidth / 2;
    }
  }, [page]);

  // A new page render arrives: lift it in, never snap. The image's own opacity
  // is written to 0 before the first paint of a fresh URL so the transition
  // starts from the hidden state rather than flashing the new page in.
  useLayoutEffect(() => {
    if (!imageUrl) return;
    const node = stageRef.current?.querySelector<HTMLElement>('[data-page-image]');
    if (!node) return;
    if (prefersReducedMotion()) {
      node.style.opacity = '1';
      return;
    }
    node.style.opacity = '0';
    motion.animate(node, {
      opacity: [0, 1],
      translateY: [7, 0],
      duration: dur(380),
      ease: EASE.out,
    });
  }, [imageUrl, motion]);

  // Pending marks draw in as the assistant proposes them. Only genuinely new
  // ids move; re-renders of settled marks stay still.
  const seenMarkers = useRef<Set<string>>(new Set());
  useEffect(() => {
    const root = stageRef.current;
    if (!root || prefersReducedMotion()) return;
    const fresh: HTMLElement[] = [];
    for (const node of root.querySelectorAll<HTMLElement>('[data-marker-id]')) {
      const id = `${page}:${node.dataset.markerId}`;
      if (seenMarkers.current.has(id)) continue;
      seenMarkers.current.add(id);
      fresh.push(node);
    }
    if (fresh.length === 0) return;
    for (const node of fresh) node.style.opacity = '0';
    motion.animate(fresh, {
      opacity: [0, 1],
      scale: [0.97, 1],
      duration: dur(360),
      ease: EASE.out,
      delay: staggerUI(55),
    });
  }, [markerKey, page, motion]);
  useEffect(() => () => seenMarkers.current.clear(), []);

  const zoomOut = () => setZoomIndex((index) => Math.max(0, index - 1));
  const zoomIn = () => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1));

  return (
    <section
      data-ai-enter
      aria-label="Document preview"
      className="studio-doc flex h-full min-h-0 flex-col overflow-hidden"
    >
      <header className="studio-doc-bar">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="studio-file-glyph" aria-hidden>
            <FileText className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="studio-file-name" title={fileName}>
              {fileName}
            </p>
            <p className="studio-meta tabular-nums">
              {pageCount} page{pageCount === 1 ? '' : 's'}
              <span aria-hidden>, </span>
              {changedPages.length > 0
                ? `${changedPages.length} marked`
                : 'no changes queued'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="studio-icon-btn"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="studio-page-counter tabular-nums" aria-live="polite" aria-label={pageLabel}>
            {String(page).padStart(2, '0')}
            <span className="studio-page-counter-total">/ {String(pageCount).padStart(2, '0')}</span>
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
            className="studio-icon-btn"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Desktop folio rail. Numbers only, with the two meaningful marks. */}
        <nav
          ref={railRef}
          aria-label="Pages"
          className="studio-rail hidden w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border/60 py-3 sm:flex"
        >
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => {
            const active = number === page;
            const changed = changedSet.has(number);
            const isCited = citedSet.has(number);
            return (
              <button
                key={number}
                type="button"
                onClick={() => onPageChange(number)}
                aria-label={`Show page ${number}`}
                aria-current={active ? 'page' : undefined}
                title={
                  changed
                    ? `Page ${number} has a pending change`
                    : isCited
                      ? `Page ${number} is cited in the answer`
                      : `Page ${number}`
                }
                className={cn('studio-rail-page tabular-nums', active && 'is-active')}
              >
                <span>{number}</span>
                {changed ? (
                  <span data-testid="ai-changed-page" className="studio-rail-dot is-changed" />
                ) : isCited ? (
                  <span className="studio-rail-dot is-cited" />
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Phone folio strip: same information, one row. */}
          {pageCount > 1 ? (
            <nav
              ref={stripRef}
              aria-label="Pages"
              className="studio-rail-scroll flex gap-1.5 overflow-x-auto border-b border-border/60 px-3 py-2 sm:hidden"
            >
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
                <button
                  key={number}
                  type="button"
                  onClick={() => onPageChange(number)}
                  aria-label={`Show page ${number}`}
                  aria-current={number === page ? 'page' : undefined}
                  className={cn(
                    'studio-rail-page studio-rail-page--wide tabular-nums',
                    number === page && 'is-active',
                  )}
                >
                  <span>{number}</span>
                  {changedSet.has(number) ? (
                    <span data-testid="ai-changed-page" className="studio-rail-dot is-changed" />
                  ) : citedSet.has(number) ? (
                    <span className="studio-rail-dot is-cited" />
                  ) : null}
                </button>
              ))}
            </nav>
          ) : null}

          <div ref={stageRef} className="studio-stage min-h-0 flex-1 overflow-auto">
            <div className="studio-stage-cushion">
              <div
                className="studio-paper"
                style={{
                  width: zoom <= 1 ? 'min(100%, 40rem)' : `${zoom * 100}%`,
                  maxWidth: `${40 * zoom}rem`,
                  ...(pageSize
                    ? { aspectRatio: `${pageSize.width} / ${pageSize.height}` }
                    : { minHeight: '26rem' }),
                }}
              >
                {imageUrl ? (
                  <img
                    key={imageUrl}
                    data-page-image
                    src={imageUrl}
                    alt={`Page ${page} of ${fileName}`}
                    draggable={false}
                    className="studio-paper-image"
                  />
                ) : (
                  <PageSkeleton page={page} loading={loading} />
                )}

                {markersReady
                  ? markers.map((marker) => (
                      <span
                        key={marker.id}
                        data-marker-id={marker.id}
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

          <div className="studio-stage-foot">
            <p className="studio-stage-note">
              {markersReady && markers.length > 0 ? (
                <>
                  <span className="studio-state-dot is-change" aria-hidden />
                  {markers.length} pending on this page
                </>
              ) : (
                pageSize
                  ? `${Math.round(pageSize.width)} × ${Math.round(pageSize.height)} pt`
                  : 'Preparing page'
              )}
            </p>

              <div className="studio-zoom" role="group" aria-label="Zoom">
                <button
                  type="button"
                  aria-label="Zoom out"
                  onClick={zoomOut}
                  disabled={zoomIndex === 0}
                  className="studio-zoom-btn"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="studio-zoom-value tabular-nums">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  aria-label="Zoom in"
                  onClick={zoomIn}
                  disabled={zoomIndex === ZOOM_STEPS.length - 1}
                  className="studio-zoom-btn"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
    </section>
  );
}

/** The reading state: a page-shaped sheet with a single scanning rule. */
function PageSkeleton({ page, loading }: { page: number; loading: boolean }) {
  return (
    <div className="studio-skeleton" aria-hidden={!loading}>
      <span className="studio-skeleton-line" style={{ width: '42%', height: 10 }} />
      <span className="studio-skeleton-line" style={{ width: '86%' }} />
      <span className="studio-skeleton-line" style={{ width: '92%' }} />
      <span className="studio-skeleton-line" style={{ width: '78%' }} />
      <span className="studio-skeleton-line" style={{ width: '88%' }} />
      <span className="studio-skeleton-line" style={{ width: '54%' }} />
      <span className="studio-skeleton-gap" />
      <span className="studio-skeleton-line" style={{ width: '84%' }} />
      <span className="studio-skeleton-line" style={{ width: '90%' }} />
      <span className="studio-skeleton-line" style={{ width: '66%' }} />
      <span className="studio-skeleton-scan" />
      {loading ? (
        <span className="studio-skeleton-label">
          <Loader2 className="h-3 w-3 animate-spin" /> Rendering page {page}
        </span>
      ) : null}
    </div>
  );
}
