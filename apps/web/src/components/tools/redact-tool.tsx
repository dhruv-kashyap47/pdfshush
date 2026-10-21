/**
 * Redact PDF: mark areas, review, and rebuild the document without them.
 *
 * Review happens on a legible render (not a 160px thumbnail), because a
 * redaction you cannot aim is a redaction you cannot trust. Regions are stored in
 * display-space points and converted from the pointer position through the image's
 * measured scale, so they survive any CSS scaling of the preview.
 *
 * Confirmation is explicit and discloses what is lost, because the engine
 * rebuilds every page as an image: text selection, search, links, accessibility
 * and vector quality do not survive. That is a real trade, not a footnote.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Settings2, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  timeoutForPageCount,
  type InspectOutput,
  type PageReport,
  type RedactRegion,
  type RedactJobOutput,
  type TextRunsOutput,
} from '@pdfshush/pdf-core';
import type { AiSettings } from '@pdfshush/ai-provider/browser';
import { AiSettingsCard } from '@/components/ai/ai-settings-card';
import { AiWelcomeOverlay } from '@/components/ai/ai-welcome-overlay';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { useJobRunner } from '@/hooks/use-job-runner';
import { usePageThumbnails } from '@/hooks/use-page-thumbnails';
import { checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { readAsInputFiles, totalBytes } from '@/lib/files';
import { jobPool } from '@/lib/job-pool';
import { proposeSensitiveRegions, type ProposedRegion } from '@/lib/ai/redaction-propose';
import { managedAsk } from '@/lib/ai/ask';
import { managedAvailable } from '@/lib/ai/managed';
import { aiWelcomeAnswered, markAiWelcomeAnswered } from '@/lib/ai/welcome';
import { loadAiMode, saveAiMode, type AiMode } from '@/lib/ai/mode';
import { aiReady, clearAiSettings, loadAiSettings, loadAiState, saveAiSettings, storedKeyPresent } from '@/lib/ai/settings';
import { recordRecent } from '@/tools/recent';

/** A committed mark, in display-space points. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The minimum drag that counts as a mark, in CSS pixels. */
const MIN_DRAG_PX = 6;

/** Merge AI-proposed rectangles into the manual ones, skipping near-duplicates. */
function mergeRegions(prev: Record<number, Rect[]>, incoming: ProposedRegion[]): Record<number, Rect[]> {
  const next: Record<number, Rect[]> = { ...prev };
  for (const region of incoming) {
    const list = [...(next[region.pageIndex] ?? [])];
    const rect: Rect = { x: region.x, y: region.y, width: region.width, height: region.height };
    const duplicate = list.some(
      (existing) =>
        Math.abs(existing.x - rect.x) < 1 &&
        Math.abs(existing.y - rect.y) < 1 &&
        Math.abs(existing.width - rect.width) < 1,
    );
    if (!duplicate) list.push(rect);
    next[region.pageIndex] = list;
  }
  return next;
}

export function RedactTool() {
  const { files, tiles, busy, progress, prepare, reset, cancel } = usePageThumbnails();
  const [info, setInfo] = useState<InspectOutput | null>(null);
  const [regions, setRegions] = useState<Record<number, Rect[]>>({});
  const [draft, setDraft] = useState<{ pageIndex: number; rect: Rect } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<AiMode>(() => loadAiMode());
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [managedOk, setManagedOk] = useState(false);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const findAbort = useRef<AbortController | null>(null);
  const runner = useJobRunner<RedactJobOutput>('redact');

  const running = busy || runner.state.status === 'running';

  useEffect(() => {
    let alive = true;
    void loadAiState().then((state) => {
      if (!alive) return;
      setSettings(state.settings);
      setMode(state.mode);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void managedAvailable().then((ok) => {
      if (alive) setManagedOk(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const effectiveMode: AiMode = mode === 'managed' && managedOk ? 'managed' : 'byok';
  const aiUsable = effectiveMode === 'managed' ? true : aiReady(settings);

  /* ------------------------------------------------------------ welcome */
  //
  // Same first-run walkthrough as the AI workspace (see ai-workspace.tsx):
  // once per browser, only while BYOK has no key, opened slightly late so the
  // IndexedDB hydration race decides before it ever blinks.
  useEffect(() => {
    const missing = effectiveMode === 'byok' && !storedKeyPresent(settings);
    if (aiWelcomeAnswered() || !missing) {
      setWelcomeOpen(false);
      return;
    }
    const timer = window.setTimeout(() => {
      markAiWelcomeAnswered();
      setWelcomeOpen(true);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [effectiveMode, settings]);

  /** Page size in points, per page index. */
  const pageSize = (pageIndex: number): { width: number; height: number } | null => {
    const page = info?.documents[0]?.pages[pageIndex];
    if (!page) return null;
    return {
      width: page.displayWidthPt ?? page.widthPt,
      height: page.displayHeightPt ?? page.heightPt,
    };
  };

  const markCount = Object.values(regions).reduce((total, list) => total + list.length, 0);

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      setInfo(null);
      setRegions({});
      reset();
      return;
    }
    const ok = await prepare(incoming, {
      // A legible render: a redaction target has to be aimable.
      targetWidthPx: 900,
      onInspected: setInfo,
    });
    if (!ok) {
      reset();
      setInfo(null);
      setRegions({});
    }
  };

  /* ------------------------------------------------------------- dragging */

  const dragStart = useRef<{ pageIndex: number; x: number; y: number } | null>(null);

  const toPoints = useCallback(
    (pageIndex: number, element: HTMLElement, clientX: number, clientY: number) => {
      const size = pageSize(pageIndex);
      if (!size) return null;
      const rect = element.getBoundingClientRect();
      // Measured rather than assumed, so any CSS scaling of the preview is undone.
      const scaleX = size.width / rect.width;
      const scaleY = size.height / rect.height;
      return {
        x: Math.min(Math.max((clientX - rect.left) * scaleX, 0), size.width),
        y: Math.min(Math.max((clientY - rect.top) * scaleY, 0), size.height),
      };
    },
    [info],
  );

  const onPointerDown = (pageIndex: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (running) return;
    const point = toPoints(pageIndex, event.currentTarget, event.clientX, event.clientY);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { pageIndex, x: point.x, y: point.y };
    setDraft({ pageIndex, rect: { x: point.x, y: point.y, width: 0, height: 0 } });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const point = toPoints(start.pageIndex, event.currentTarget, event.clientX, event.clientY);
    if (!point) return;
    setDraft({
      pageIndex: start.pageIndex,
      rect: {
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
      },
    });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    const box = draft;
    setDraft(null);
    if (!start || !box) return;
    const size = pageSize(start.pageIndex);
    if (!size) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const pxPerPt = rect.width / size.width;
    if (box.rect.width * pxPerPt < MIN_DRAG_PX || box.rect.height * pxPerPt < MIN_DRAG_PX) return;
    setRegions((prev) => ({
      ...prev,
      [box.pageIndex]: [...(prev[box.pageIndex] ?? []), box.rect],
    }));
  };

  const removeRegion = (pageIndex: number, index: number) => {
    setRegions((prev) => {
      const list = [...(prev[pageIndex] ?? [])];
      list.splice(index, 1);
      const next = { ...prev };
      if (list.length === 0) delete next[pageIndex];
      else next[pageIndex] = list;
      return next;
    });
  };

  /* ---------------------------------------------------- AI-assisted finding */

  const findSensitive = async () => {
    if (finding || running || files.length === 0) return;
    if (!aiUsable) {
      // No usable path yet: open the settings form instead of failing silently.
      setShowSettings(true);
      return;
    }
    setFinding(true);
    setFindError(null);
    const controller = new AbortController();
    findAbort.current = controller;
    try {
      const runs = await jobPool.run<TextRunsOutput>(
        'text-runs',
        await readAsInputFiles(files),
        {},
        { signal: controller.signal },
      );
      const outcome = await proposeSensitiveRegions(runs.runs, {
        settings,
        ...(effectiveMode === 'managed' ? { ask: managedAsk } : {}),
        signal: controller.signal,
      });
      if (outcome.error) {
        setFindError(outcome.error);
        return;
      }
      if (outcome.regions.length === 0) {
        toast.info('AI found no sensitive data in this document.');
        return;
      }
      setRegions((prev) => mergeRegions(prev, outcome.regions));
      toast.success(
        `AI proposed ${outcome.regions.length} area${outcome.regions.length === 1 ? '' : 's'} from ${outcome.offered} text runs. Review, then redact.`,
      );
    } catch (cause) {
      if (!controller.signal.aborted) {
        setFindError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setFinding(false);
      findAbort.current = null;
    }
  };

  /* ---------------------------------------------------------------- run */

  const runRedact = async () => {
    if (running || markCount === 0) return;
    const pageCount = info?.documents[0]?.pageCount ?? 0;
    const verdict = checkClientCapacity({
      fileCount: files.length,
      totalBytes: totalBytes(files),
      pageCount,
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }

    const flat: RedactRegion[] = Object.entries(regions).flatMap(([page, list]) =>
      list.map((rect) => ({
        pageIndex: Number(page),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      })),
    );
    setConfirming(false);

    const outcome = await runner.run(
      await readAsInputFiles(files),
      { regions: flat, outputName: `${files[0]!.name.replace(/\.pdf$/i, '')}-redacted` },
      { timeoutMs: timeoutForPageCount(pageCount) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'redact-pdf',
      toolName: 'Redact PDF',
      fileName: outcome.result.name,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  };

  if (runner.state.status === 'done') {
    const { result } = runner.state;
    const marked = result.report.pages.reduce(
      (total: number, page: PageReport) => total + page.markedPixels,
      0,
    );
    return (
      <ResultPanel
        fileName={result.name}
        pageCount={result.pageCount}
        sizeBytes={result.data.byteLength}
        onDownload={() => downloadBytes(result.data, result.name)}
        onReset={() => {
          runner.reset();
          reset();
          setInfo(null);
          setRegions({});
        }}
        footerNote={`Verified: the output was reopened and checked; no text layer, annotations, attachments or metadata remain, and every page is a single image. ${marked.toLocaleString()} pixels were destroyed.`}
      />
    );
  }

  const pages = info?.documents[0]?.pages.length ?? 0;

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => void handleFiles(next)}
        disabled={running}
        hint="one PDF to redact"
        multiple={false}
      />

      {busy && <JobProgressPanel progress={progress} onCancel={cancel} />}

      {tiles.length > 0 && (
        <>
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
            <p className="font-medium">Marks are permanent and destructive</p>
            <p className="mt-1 text-muted-foreground">
              Drag on a page to mark an area. Redaction <strong>rebuilds every page as an
              image</strong>, so text selection, search, links, form fields, accessibility and
              vector quality are lost. The original text is not merely covered; it is not in the
              file.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {markCount} area{markCount === 1 ? '' : 's'} marked across {Object.keys(regions).length} page
              {Object.keys(regions).length === 1 ? '' : 's'}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void findSensitive()}
              disabled={running || finding}
              data-testid="redact-ai-find"
            >
              {finding ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-4 w-4" />
              )}
              {finding ? 'Finding sensitive data…' : 'Find sensitive data with AI'}
            </Button>
            {finding ? (
              <Button variant="ghost" size="sm" onClick={() => findAbort.current?.abort()}>
                Stop
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSettings((shown) => !shown)}
              disabled={running}
            >
              <Settings2 className="mr-1.5 h-4 w-4" /> AI settings
            </Button>
            {markCount > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setRegions({})} disabled={running}>
                <Trash2 className="mr-1.5 h-4 w-4" /> Clear all
              </Button>
            )}
          </div>

          {findError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {findError}
            </p>
          ) : null}

          <p className="text-xs text-muted-foreground">
            AI only <strong>proposes</strong> marks from the document text; nothing is redacted until
            you review and confirm. Your key stays in this browser, and the document is sent only to
            your chosen provider.
          </p>

          {showSettings ? (
            <AiSettingsCard
              settings={settings}
              mode={effectiveMode}
              onModeChange={(next) => {
                setMode(next);
                saveAiMode(next);
              }}
              managedAvailable={managedOk}
              onSave={(next) => {
                setSettings(saveAiSettings(next));
                setShowSettings(false);
              }}
              {...(storedKeyPresent(settings)
                ? {
                    onForget: () => {
                      void clearAiSettings().then((next) => {
                        setSettings(next);
                        setShowSettings(false);
                      });
                    },
                  }
                : {})}
            />
          ) : null}

          <div className="space-y-6">
            {tiles.map((tile) => {
              const size = pageSize(tile.pageIndex);
              if (!size) return null;
              const pageRegions = regions[tile.pageIndex] ?? [];
              const active = draft?.pageIndex === tile.pageIndex ? draft.rect : null;
              const pct = (rect: Rect) => ({
                left: `${(rect.x / size.width) * 100}%`,
                top: `${(rect.y / size.height) * 100}%`,
                width: `${(rect.width / size.width) * 100}%`,
                height: `${(rect.height / size.height) * 100}%`,
              });

              return (
                <div key={tile.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium">Page {tile.pageIndex + 1}</p>
                    <span className="text-xs text-muted-foreground">
                      {pageRegions.length} mark{pageRegions.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div
                    data-testid={`redact-page-${tile.pageIndex}`}
                    className="relative mx-auto w-full max-w-[720px] cursor-crosshair touch-none select-none overflow-hidden rounded-lg border border-border bg-white"
                    style={{ aspectRatio: `${size.width} / ${size.height}` }}
                    onPointerDown={(event) => onPointerDown(tile.pageIndex, event)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                  >
                    <img
                      src={tile.url}
                      alt={`Page ${tile.pageIndex + 1}`}
                      className="pointer-events-none absolute inset-0 h-full w-full object-fill"
                      draggable={false}
                    />
                    {pageRegions.map((rect, index) => (
                      <div
                        key={`${rect.x}-${rect.y}-${index}`}
                        data-testid={`redact-mark-${tile.pageIndex}-${index}`}
                        className="absolute border border-red-300/70 bg-black"
                        style={pct(rect)}
                      />
                    ))}
                    {active && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute border-2 border-dashed border-red-500 bg-black/40"
                        style={pct(active)}
                      />
                    )}
                  </div>
                  {pageRegions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {pageRegions.map((rect, index) => (
                        <button
                          key={`remove-${index}`}
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                          onClick={() => removeRegion(tile.pageIndex, index)}
                          disabled={running}
                        >
                          <X className="h-3 w-3" />
                          {Math.round(rect.width)}×{Math.round(rect.height)} pt
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {confirming ? (
            <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-4">
              <p className="text-sm font-medium">
                Destroy {markCount} area{markCount === 1 ? '' : 's'} and rebuild {pages} page
                {pages === 1 ? '' : 's'}?
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                This cannot be undone. Text selection, search, links, form fields, accessibility and
                vector quality will not survive. Documents over the page limit are refused rather
                than partially processed.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="destructive" onClick={() => void runRedact()} data-testid="redact-confirm">
                  <ShieldCheck className="mr-1.5 h-4 w-4" /> Redact and rebuild
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="lg"
              className="w-full"
              disabled={running || markCount === 0}
              onClick={() => setConfirming(true)}
              data-testid="redact-start"
            >
              {runner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Redacting…
                </>
              ) : (
                <>Review and redact {markCount} area{markCount === 1 ? '' : 's'}</>
              )}
            </Button>
          )}
        </>
      )}

      {runner.state.status === 'running' && (
        <JobProgressPanel progress={runner.state.progress} onCancel={runner.cancel} />
      )}

      {/* Rendered at the root of every state of this page (the AI workspace
          does the same): the walkthrough belongs to opening the tool, not to
          loading a document — a keyless first visit must be able to dismiss it
          before files come in. */}
      {welcomeOpen ? (
        <AiWelcomeOverlay
          settings={settings}
          onSave={(next) => setSettings(saveAiSettings(next))}
          managedAvailable={managedOk}
          onUseManaged={() => {
            setMode('managed');
            saveAiMode('managed');
          }}
          onDismiss={() => setWelcomeOpen(false)}
        />
      ) : null}
    </div>
  );
}
