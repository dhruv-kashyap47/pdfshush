/**
 * Edit PDF -- the Phase 2 editor.
 *
 * Hybrid by design: page rasters and text runs come from read-only jobs (cached
 * per page), edits live entirely in React state (see `lib/editor-state.ts`), and
 * the `edit` job applies them atomically and re-parses its own output before a
 * download is offered.
 *
 * Performance rules that matter at 200+ pages:
 * - rasters are fetched through a bounded queue (never 20 copies of the file at
 *   once), and text runs are requested in chunks;
 * - pages receive their own object/widget slices and are memoized, so a drag on
 *   one page re-renders that page only;
 * - a save freezes editing (`readOnly`) so the snapshot sent to the worker is
 *   provably the document the user sees, and nothing is silently dropped.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  JobAbortedError,
  LIMITS,
  timeoutForPageCount,
  type EditorObject,
  type EditJobOutput,
  type FormWidgetInfo,
  type InspectOutput,
  type TextRun,
  type TextRunsOutput,
  type ThumbnailsOutput,
} from '@pdfshush/pdf-core';
import { EditorInspector } from '@/components/editor/editor-inspector';
import { EditorPage } from '@/components/editor/editor-page';
import { EditorToolbar, type EditorTool } from '@/components/editor/editor-toolbar';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { readAsInputFiles } from '@/lib/files';
import { useEditorDoc } from '@/lib/editor-state';
import { jobPool } from '@/lib/job-pool';
import { recordRecent } from '@/tools/recent';

type DocInfo = InspectOutput['documents'][number];

/** Render scale: page bitmap pixels per CSS px (crisp on hi-dpi screens). */
const RASTER_SCALE = Math.min(2, (globalThis.devicePixelRatio ?? 1) * 1.5);
/**
 * Hard ceiling on one page bitmap, in pixels (~4 RGBA bytes each).
 *
 * `min(scale, 2)` is not a memory bound on its own: a poster or CAD drawing
 * page is 2000+ pt wide, so at 200% zoom on a hi-dpi screen the naive
 * calculation asks for 8000 × 11000 = 88 megapixels — 350 MB for a single
 * page, which is a tab crash, not a slow render. Budget the *area* and derive
 * the width from it. (Lesson borrowed from the GenOffice donor, which caps the
 * same way with `sqrt(MAX_PX / (w * h))`.)
 */
const MAX_RASTER_PIXELS = 12_000_000;
/** Cap inserted images so a phone photo doesn't take over the page. */
const MAX_IMAGE_WIDTH_PT = 300;
/** Pages whose text runs are warmed in the background as the editor opens. */
const WARM_RUN_PAGES = 10;
/** Pages whose rasters are fetched immediately; the rest lazy-load on scroll. */
const WARM_RASTER_PAGES = 20;
/** How many page bitmaps may be in flight at once (each holds a file copy). */
const MAX_PARALLEL_RASTERS = 2;
/** Held arrow keys coalesce into one undo step. */
const NUDGE_COALESCE_MS = 400;

/** Text-run requests are chunked so a 500-page document is not one giant job. */
const RUN_PAGE_CHUNK = 40;
/** Shared empty props so untouched pages never re-render. */
const NO_OBJECTS: EditorObject[] = [];
const NO_WIDGETS: FormWidgetInfo[] = [];
const NO_FORM_VALUES: Record<string, string | boolean> = {};

const KEY_TOOLS: Record<string, EditorTool> = { s: 'select', t: 'text', i: 'image', h: 'highlight' };

let objectCounter = 0;
function newObjectId(): string {
  objectCounter += 1;
  return `u${Date.now().toString(36)}${objectCounter.toString(36)}`;
}

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(2, Math.max(0.25, Math.round(value * 20) / 20));
}

/** Cancelled work, not a failure worth reporting to the user. */
function isAbort(error: unknown): boolean {
  return (
    error instanceof JobAbortedError ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'JobAbortedError'))
  );
}

interface PageBinding {
  onSeedReplace: (run: TextRun) => void;
  onImageRequested: (point: { x: number; y: number }) => void;
  onVisible: () => void;
  onHidden: () => void;
}

/**
 * How many page bitmaps stay resident.
 *
 * Decoded RGBA is ~4 bytes per pixel, so a 1300x1800 page costs roughly 9 MB
 * once the browser has decoded it -- the blob URL is the cheap part. A long
 * document scrolled end to end would otherwise hold every page it ever touched,
 * which is a tab crash rather than a slow render. Keeping a window of pages
 * around the viewport costs a handful of bitmaps and makes scrolling back
 * instant.
 */
const RESIDENT_RASTERS = 12;
/**
 * Rasters loaded eagerly on open, and the furthest-from-viewport distance at which
 * one is kept. The window has to be wider than RESIDENT_RASTERS, otherwise pages
 * sitting in the scroll margin get evicted and immediately re-fetched -- which is
 * worse than keeping them, because each miss re-reads the whole source file.
 */
const RETAIN_MARGIN_PAGES = 4;

function probeImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('unreadable image'));
    image.src = url;
  });
}

/**
 * Groups items by page while keeping untouched groups referentially identical,
 * which is what lets the memoized `EditorPage` skip pages it does not own.
 */
function usePageBuckets<T extends { pageIndex: number }>(items: readonly T[]): Map<number, T[]> {
  const previous = useRef(new Map<number, T[]>());
  return useMemo(() => {
    const next = new Map<number, T[]>();
    for (const item of items) {
      const bucket = next.get(item.pageIndex);
      if (bucket) bucket.push(item);
      else next.set(item.pageIndex, [item]);
    }
    for (const [pageIndex, bucket] of next) {
      const before = previous.current.get(pageIndex);
      if (before && before.length === bucket.length && before.every((item, i) => item === bucket[i])) {
        next.set(pageIndex, before);
      }
    }
    previous.current = next;
    return next;
  }, [items]);
}

export function EditPdfTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<DocInfo | null>(null);
  const [stage, setStage] = useState<'idle' | 'preparing' | 'editing'>('idle');
  const editor = useEditorDoc();
  const [tool, setTool] = useState<EditorTool>('select');
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rasters, setRasters] = useState<Record<number, { url: string; widthPx: number }>>({});
  const [runsByPage, setRunsByPage] = useState<Record<number, TextRun[]>>({});

  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const editRunner = useJobRunner<EditJobOutput>('edit');

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<File | null>(null);
  const infoRef = useRef<DocInfo | null>(null);
  const zoomRef = useRef(zoom);
  const toolRef = useRef(tool);
  const rastersRef = useRef(rasters);
  const zoomTouchedRef = useRef(false);
  /** Doc snapshot handed to the last save: the "unsaved changes" baseline. */
  const savedDocRef = useRef<typeof editor.doc | null>(null);
  /** Monotonic id for file-selection requests; a stale one must not win. */
  const loadSequence = useRef(0);
  /** Timestamp of the last arrow-key nudge, and whether its tx is still open. */
  const lastNudgeAt = useRef(0);
  const nudgeTxOpen = useRef(false);
  const nudgeCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  zoomRef.current = zoom;
  toolRef.current = tool;
  rastersRef.current = rasters;
  /** Mirror of `runsByPage` for the eviction pass, which must not re-run on it. */
  const runsByPageRef = useRef(runsByPage);
  runsByPageRef.current = runsByPage;

  const rasterPending = useRef(new Set<number>());
  const rasterRequested = useRef(new Map<number, number>());
  const rasterQueue = useRef<number[]>([]);
  const rasterActive = useRef(0);
  const runsFetched = useRef(new Set<number>());
  const runsInflight = useRef(new Set<number>());
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImageRef = useRef<{ pageIndex: number; x: number; y: number } | null>(null);

  /**
   * Incremented every time the source document changes. Page-index-keyed caches
   * (rasters, text runs, in-flight queues) are only meaningful *within* one
   * document: page 3 of one PDF has nothing to do with page 3 of the next, and
   * nearly every real PDF shares geometry, so a width-based cache check happily
   * serves the previous document's image for the new one. Every async path
   * captures the generation it started under and drops its result if the
   * document changed while it was in flight -- otherwise swapping files
   * mid-render paints the old pages over the new ones.
   */
  const docGeneration = useRef(0);
  /** Cached raster width is only reusable if it is close enough not to look soft. */
  const RASTER_REUSE_TOLERANCE = 0.25;

  /**
   * Bitmap width for one page: what we want for sharpness, clamped so the
   * decoded bitmap stays inside `MAX_RASTER_PIXELS`. Pure, so it is unit
   * testable without a browser and so every caller agrees on the budget.
   */
  const rasterWidthPx = (page: { displayWidthPt: number; displayHeightPt: number }): number => {
    const widthPt = page.displayWidthPt || 1;
    const heightPt = page.displayHeightPt || 1;
    const wanted = Math.round(widthPt * zoomRef.current * RASTER_SCALE);
    if (!Number.isFinite(wanted) || wanted <= 0) return 1;
    const budgeted = Math.sqrt(MAX_RASTER_PIXELS / (widthPt * heightPt)) * zoomRef.current * RASTER_SCALE;
    return Math.max(1, Math.round(Math.min(wanted, budgeted)));
  };

  const inspectState = inspectRunner.state;
  const editState = editRunner.state;
  const saving = editState.status === 'running';

  /* ------------------------------------------------------------ rasters */

  const ensureRaster = useCallback(async (pageIndex: number): Promise<void> => {
    const file = fileRef.current;
    const page = infoRef.current?.pages[pageIndex];
    if (!file || !page) return;
    const generation = docGeneration.current;
    const desired = rasterWidthPx({
      displayWidthPt: page.displayWidthPt || page.widthPt,
      displayHeightPt: page.displayHeightPt || page.heightPt,
    });
    const cached = rastersRef.current[pageIndex];
    if (rasterRequested.current.get(pageIndex) === desired) return;
    if (cached && Math.abs(cached.widthPx - desired) <= desired * RASTER_REUSE_TOLERANCE) {
      rasterRequested.current.set(pageIndex, desired);
      return;
    }
    // `pending` covers both queued and running pages, so a page asked for twice
    // (IntersectionObserver + eager warm-up) is only fetched once.
    if (rasterPending.current.has(pageIndex)) return;
    rasterPending.current.add(pageIndex);

    if (rasterActive.current >= MAX_PARALLEL_RASTERS) {
      // Bounded concurrency: every in-flight raster holds its own copy of the
      // source file, and 20 of those is how a 50 MB PDF eats a gigabyte.
      rasterQueue.current.push(pageIndex);
      return;
    }
    // Recorded only once the render actually starts. A page bounced to the
    // queue has not been drawn yet, and claiming otherwise satisfied the guard
    // above forever, so that page never rendered at all.
    rasterRequested.current.set(pageIndex, desired);
    rasterActive.current += 1;
    try {
      const input = [{ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }];
      const result = await jobPool.run<ThumbnailsOutput>('thumbnails', input, {
        targetWidthPx: desired,
        pageIndexes: [pageIndex],
      });
      // The user swapped files (or hit start over) while this render was in
      // flight. Its image belongs to a document nobody is looking at any more.
      if (generation !== docGeneration.current) return;
      const thumb = result.documents[0]?.thumbnails[0];
      if (thumb) {
        const url = URL.createObjectURL(new Blob([thumb.data], { type: thumb.mimeType }));
        setRasters((prev) => {
          const old = prev[pageIndex];
          if (old) URL.revokeObjectURL(old.url);
          return { ...prev, [pageIndex]: { url, widthPx: desired } };
        });
        if (toolRef.current === 'text') void ensureRunsRef.current([pageIndex]);
      }
    } catch (error) {
      // A cancelled job is the expected consequence of swapping files or
      // navigating away; only a genuine render failure is worth a toast.
      if (generation === docGeneration.current && !isAbort(error)) {
        toast.error(`Could not render page ${pageIndex + 1}`);
      }
    } finally {
      rasterPending.current.delete(pageIndex);
      rasterActive.current -= 1;
      // Re-check this page before moving on. The opening zoom is decided by a
      // layout effect that runs while these renders are still in flight, and a
      // request made in that window was rejected as "already pending" -- so no
      // other pass would ever ask for this page again and it would keep its
      // initial, half-resolution bitmap for the rest of the session. This is
      // the only place that can notice; the requested-width guard makes the call a
      // a no-op when the zoom has not moved, so it cannot spin.
      void ensureRaster(pageIndex);
      const next = rasterQueue.current.shift();
      if (next !== undefined) {
        // Clear the marker before re-entering, or the dequeued page looks busy.
        rasterPending.current.delete(next);
        void ensureRaster(next);
      }
    }
  }, []);

  /**
   * Releases the page bitmaps furthest from the viewport.
   *
   * Called when a page scrolls well out of view. Distance is measured in page
   * indexes, a good proxy for scroll distance in a single document and free to
   * maintain. Pages carrying overlay objects or cached text runs are pinned:
   * they are the ones the user is most likely to come back to, and their
   * overlays are cheap compared with a decoded bitmap.
   */
  const releaseDistantRasters = useCallback(
    (anchorPage: number) => {
      const keys = Object.keys(rastersRef.current).map(Number);
      if (keys.length <= RESIDENT_RASTERS) return;
      // Keep a window around the anchor rather than the N nearest, so a page
      // sitting just outside the observer margin is not evicted and then
      // re-fetched on the very next scroll step.
      const evict = keys.filter((index) => Math.abs(index - anchorPage) > RETAIN_MARGIN_PAGES);
      if (evict.length === 0) return;

      const pinned = new Set<number>();
      for (const object of editor.doc.objects) pinned.add(object.pageIndex);
      for (const index of Object.keys(runsByPageRef.current)) pinned.add(Number(index));

      let released = 0;
      setRasters((prev) => {
        const next = { ...prev };
        for (const pageIndex of evict) {
          if (pinned.has(pageIndex)) continue;
          const entry = next[pageIndex];
          if (!entry) continue;
          URL.revokeObjectURL(entry.url);
          delete next[pageIndex];
          released += 1;
          // Forget the requested width so a return visit re-renders cleanly
          // rather than trusting a cache entry that no longer exists.
          rasterRequested.current.delete(pageIndex);
        }
        return released > 0 ? next : prev;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor.doc.objects],
  );

  /* --------------------------------------------------------- text runs */

  const ensureRuns = useCallback(async (indexes: number[]): Promise<void> => {
    const file = fileRef.current;
    const generation = docGeneration.current;
    const wanted = indexes.filter(
      (index) => !runsFetched.current.has(index) && !runsInflight.current.has(index),
    );
    if (!file || wanted.length === 0) return;
    for (const index of wanted) runsInflight.current.add(index);
    try {
      for (let offset = 0; offset < wanted.length; offset += RUN_PAGE_CHUNK) {
        const chunk = wanted.slice(offset, offset + RUN_PAGE_CHUNK);
        const input = [{ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }];
        const result = await jobPool.run<TextRunsOutput>('text-runs', input, {
          pageIndexes: chunk,
        });
        // Runs belong to the document they were read from; writing them into a
        // newer one would let "click to replace" quote a different PDF.
        if (generation !== docGeneration.current) return;
        setRunsByPage((prev) => ({
          ...prev,
          ...Object.fromEntries(chunk.map((page, i) => [page, result.runs[i] ?? []])),
        }));
        for (const index of chunk) runsFetched.current.add(index);
      }
    } catch {
      // Runs only power the "click text to replace it" affordance; the text
      // tool still adds new boxes without them. Mark them settled either way so
      // a persistent failure is not retried on every scroll.
      if (generation === docGeneration.current) {
        for (const index of wanted) runsFetched.current.add(index);
      }
    } finally {
      for (const index of wanted) runsInflight.current.delete(index);
    }
  }, []);

  // Indirection so `ensureRaster` can stay referentially stable while still
  // calling the latest `ensureRuns`.
  const ensureRunsRef = useRef(ensureRuns);
  ensureRunsRef.current = ensureRuns;

  /* ------------------------------------------------------------- setup */

  /**
 * Drops every page-indexed cache and invalidates in-flight work.
   *
   * Called on "start over", on unload, and -- critically -- before a new
   * document's state is installed. Rasters and text runs are keyed by page index
   * alone; because almost all PDFs share page geometry, a new document's page 1
   * would otherwise hit the previous document's cache entry and render its
   * image. Bumping the generation makes every in-flight render and text-run
   * request discard its result instead of painting it onto the new document.
   */
  const invalidateDocumentCaches = useCallback(() => {
    docGeneration.current += 1;
    for (const raster of Object.values(rastersRef.current)) URL.revokeObjectURL(raster.url);
    rastersRef.current = {};
    setRasters({});
    setRunsByPage({});
    runsFetched.current.clear();
    runsInflight.current.clear();
    rasterRequested.current.clear();
    rasterPending.current.clear();
    rasterQueue.current = [];
    rasterActive.current = 0;
  }, []);

  const resetAll = useCallback(() => {
    invalidateDocumentCaches();
    if (nudgeCloseTimer.current !== undefined) {
      clearTimeout(nudgeCloseTimer.current);
      nudgeCloseTimer.current = undefined;
    }
    nudgeTxOpen.current = false;
    setFiles([]);
    setInfo(null);
    fileRef.current = null;
    infoRef.current = null;
    setStage('idle');
    setSelectedId(null);
    setEditingId(null);
    pendingImageRef.current = null;
    setTool('select');
    setZoom(1);
    zoomTouchedRef.current = false;
    savedDocRef.current = null;
    // Without this, the next document would inherit the previous one's objects
    // (and their page indexes).
    editor.reset();
    editRunner.reset();
    inspectRunner.reset();
  }, [editor.reset, editRunner.reset, inspectRunner.reset, invalidateDocumentCaches]);

  // Blob URLs die with the component even if nobody pressed "start over".
  useEffect(
    () => () => {
      docGeneration.current += 1;
      if (nudgeCloseTimer.current !== undefined) clearTimeout(nudgeCloseTimer.current);
      for (const raster of Object.values(rastersRef.current)) URL.revokeObjectURL(raster.url);
    },
    [],
  );

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      resetAll();
      return;
    }
    const file = incoming[0]!;
    const verdict = checkClientCapacity({ fileCount: 1, totalBytes: file.size });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    // A second selection while the first is still inspecting must not have its
    // results overwritten by the slower of the two.
    const request = ++loadSequence.current;
    setStage('preparing');
    const outcome = await inspectRunner.run(await readAsInputFiles([file]));
    if (request !== loadSequence.current) return; // superseded by a newer pick
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      setStage('idle');
      return;
    }
    const doc = outcome.result.documents[0];
    if (!doc) {
      toast.error('That PDF could not be read.');
      setStage('idle');
      return;
    }
    // A new file means a new document: drop the previous one's caches, rasters
    // and objects before anything reads them, or page 1 keeps showing the old
    // file's page 1.
    invalidateDocumentCaches();
    editor.reset();
    savedDocRef.current = null;
    setFiles(incoming);
    fileRef.current = file;
    infoRef.current = doc;
    setInfo(doc);
    setStage('editing');
    setSelectedId(null);
    setEditingId(null);
    pendingImageRef.current = null;
    // First batch up front; deeper pages load when they scroll into view.
    const eager = Math.min(WARM_RASTER_PAGES, doc.pageCount);
    for (let index = 0; index < eager; index += 1) void ensureRaster(index);
    void ensureRuns(
      Array.from({ length: Math.min(WARM_RUN_PAGES, doc.pageCount) }, (_, index) => index),
    );
  };

  // Re-request cached pages when the zoom changes, and reconcile after any raster lands. Both dependencies are load-bearing: the fit-width zoom is applied in a *layout* effect, which runs before the eager rasters have arrived, so at that instant there is nothing cached to re-request and every eagerly loaded page silently kept its initial (half-resolution) bitmap until the user touched the zoom again. Watching `rasters` closes that window; the requested-width guard inside `ensureRaster` stops it becoming a loop.
  const onZoomChange = useCallback((next: number) => {
    zoomTouchedRef.current = true;
    setZoom(clampZoom(next));
  }, []);

  useEffect(() => {
    if (stage !== 'editing') return;
    for (const key of Object.keys(rastersRef.current)) void ensureRaster(Number(key));
  }, [zoom, stage, ensureRaster, rasters]);

  // Open at fit-width (the default in every desktop PDF editor) unless the user
  // has already chosen a zoom level. Layout effect: the container must be laid
  // out before it can be measured.
  useLayoutEffect(() => {
    if (stage !== 'editing' || !info || zoomTouchedRef.current) return;
    const container = scrollRef.current;
    if (!container || container.clientWidth === 0) return;
    const widest = Math.max(
      1,
      ...info.pages.map((page) => page.displayWidthPt ?? page.widthPt),
    );
    setZoom(clampZoom((container.clientWidth - 40) / widest));
  }, [stage, info]);

  // Warm run boxes for every page the first time the text tool is picked.
  useEffect(() => {
    if (stage !== 'editing' || tool !== 'text' || !info) return;
    void ensureRuns(Array.from({ length: info.pageCount }, (_, index) => index));
  }, [tool, stage, info, ensureRuns]);

  /* ----------------------------------------------------------- editing */

  const objectCount = editor.doc.objects.length;
  const atObjectLimit = objectCount >= LIMITS.tool.maxEditObjects;

  const createObject = useCallback(
    (object: EditorObject) => {
      if (atObjectLimit) {
        toast.error(`This document already has ${LIMITS.tool.maxEditObjects.toLocaleString()} objects`);
        return;
      }
      editor.apply((doc) => ({ ...doc, objects: [...doc.objects, object] }));
      setSelectedId(object.id);
    },
    [atObjectLimit, editor.apply],
  );

  const patchObject = useCallback(
    (patch: Record<string, unknown>) => {
      if (!selectedId) return;
      editor.apply((doc) => ({
        ...doc,
        objects: doc.objects.map((object) =>
          object.id === selectedId ? ({ ...object, ...patch } as EditorObject) : object,
        ),
      }));
    },
    [selectedId, editor.apply],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    editor.apply((doc) => ({ ...doc, objects: doc.objects.filter((o) => o.id !== selectedId) }));
    setSelectedId(null);
    setEditingId(null);
    editor.endTx();
  }, [selectedId, editor.apply, editor.endTx]);

  const moveLive = useCallback(
    (id: string, x: number, y: number) => {
      editor.live((doc) => ({
        ...doc,
        objects: doc.objects.map((object) => (object.id === id ? { ...object, x, y } : object)),
      }));
    },
    [editor.live],
  );

  const resizeLive = useCallback(
    (id: string, rect: { x: number; y: number; width: number; height: number }) => {
      editor.live((doc) => ({
        ...doc,
        objects: doc.objects.map((object) => (object.id === id ? { ...object, ...rect } : object)),
      }));
    },
    [editor.live],
  );

  const autoHeight = useCallback(
    (id: string, height: number) => {
      editor.live((doc) => ({
        ...doc,
        objects: doc.objects.map((object) =>
          object.id === id && object.kind === 'text' ? { ...object, height } : object,
        ),
      }));
    },
    [editor.live],
  );

  const startEdit = useCallback(
    (id: string) => {
      setSelectedId(id);
      setEditingId(id);
      editor.beginTx();
    },
    [editor.beginTx],
  );

  const endEdit = useCallback(() => {
    setEditingId(null);
    editor.endTx();
  }, [editor.endTx]);

  const editText = useCallback(
    (id: string, text: string) => {
      editor.live((doc) => ({
        ...doc,
        objects: doc.objects.map((object) =>
          object.id === id && object.kind === 'text' ? { ...object, text } : object,
        ),
      }));
    },
    [editor.live],
  );

  const select = useCallback((id: string | null) => setSelectedId(id), []);

  // Undo and redo move objects in and out of the document; a selection pointing
  // at an object that no longer exists would leave the inspector and z-order
  // buttons describing something invisible.
  useEffect(() => {
    if (!selectedId) return;
    if (!editor.doc.objects.some((object) => object.id === selectedId)) setSelectedId(null);
  }, [editor.doc.objects, selectedId]);

  /** Replace an existing line: whiteout + prefilled text, one undo step. */
  const seedReplace = useCallback(
    (pageIndex: number, run: TextRun) => {
      if (atObjectLimit) {
        toast.error(`This document already has ${LIMITS.tool.maxEditObjects.toLocaleString()} objects`);
        return;
      }
      const whiteout: EditorObject = {
        id: newObjectId(),
        kind: 'whiteout',
        pageIndex,
        x: run.x - 1,
        y: run.y - 1,
        width: run.width + 2,
        height: run.height + 2,
      };
      const text: EditorObject = {
        id: newObjectId(),
        kind: 'text',
        pageIndex,
        x: run.x,
        y: run.y,
        width: Math.max(run.width, 40) + 4,
        height: run.height,
        text: run.text,
        fontSize: Math.min(72, Math.max(4, Math.round(run.fontSize * 2) / 2)),
        color: '#111827',
      };
      editor.apply((doc) => ({ ...doc, objects: [...doc.objects, whiteout, text] }));
      setSelectedId(text.id);
      setEditingId(text.id);
      editor.beginTx();
    },
    [atObjectLimit, editor.apply, editor.beginTx],
  );

  const setFormValue = useCallback(
    (name: string, value: string | boolean) => {
      editor.live((doc) => ({ ...doc, formValues: { ...doc.formValues, [name]: value } }));
    },
    [editor.live],
  );

  /** Nudge / duplicate / z-order -- the keyboard affordances editors expect. */
  const transformSelected = useCallback(
    (kind: 'forward' | 'backward' | 'duplicate' | 'nudge', dx = 0, dy = 0) => {
      if (!selectedId || saving) return;
      if (kind === 'duplicate') {
        if (atObjectLimit) return;
        // Build the copy outside the state updater: updaters must stay pure, and
        // the new id has to exist before we can select it.
        const source = editor.doc.objects.find((object) => object.id === selectedId);
        if (!source) return;
        const copy = {
          ...source,
          id: newObjectId(),
          x: source.x + 8,
          y: source.y + 8,
        } as EditorObject;
        editor.apply((doc) => ({ ...doc, objects: [...doc.objects, copy] }));
        setSelectedId(copy.id);
        return;
      }
      if (kind === 'nudge') {
        // A held arrow key fires keydown per repeat. Pushing a checkpoint for
        // each one buried real edits under dozens of one-pixel steps, so a burst
        // is coalesced into a single undo step: the first nudge opens a
        // transaction, the rest mutate inside it, and a pause closes it.
        const now = Date.now();
        const burst = now - lastNudgeAt.current < NUDGE_COALESCE_MS;
        lastNudgeAt.current = now;
        const move = (doc: typeof editor.doc) => ({
          ...doc,
          objects: doc.objects.map((object) =>
            object.id === selectedId ? { ...object, x: object.x + dx, y: object.y + dy } : object,
          ),
        });
        if (burst && nudgeTxOpen.current) {
          editor.live(move);
        } else {
          nudgeTxOpen.current = true;
          editor.beginTx();
          editor.apply(move);
        }
        // Close the transaction once the burst stops, so the next burst (and
        // anything else that changes the document) starts a fresh one.
        if (nudgeCloseTimer.current !== undefined) clearTimeout(nudgeCloseTimer.current);
        nudgeCloseTimer.current = setTimeout(() => {
          nudgeCloseTimer.current = undefined;
          nudgeTxOpen.current = false;
          editor.endTx();
        }, NUDGE_COALESCE_MS);
        return;
      }
      editor.apply((doc) => {
        const index = doc.objects.findIndex((object) => object.id === selectedId);
        const target = kind === 'forward' ? index + 1 : index - 1;
        if (index < 0 || target < 0 || target >= doc.objects.length) return doc;
        const objects = [...doc.objects];
        const [moved] = objects.splice(index, 1);
        objects.splice(target, 0, moved!);
        return { ...doc, objects };
      });
    },
    [selectedId, saving, atObjectLimit, editor.apply],
  );

  const selectedIndex = selectedId
    ? editor.doc.objects.findIndex((object) => object.id === selectedId)
    : -1;
  const canReorder =
    selectedIndex >= 0 && selectedIndex < editor.doc.objects.length - 1 && !saving;
  const canSendBack = selectedIndex > 0 && !saving;

  /* -------------------------------------------------------- insert image */

  const onImageRequested = useCallback((pageIndex: number, point: { x: number; y: number }) => {
    pendingImageRef.current = { pageIndex, ...point };
    imageInputRef.current?.click();
  }, []);

  const onImageFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const pending = pendingImageRef.current;
    if (!file || !pending) return;
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      toast.error('Images must be PNG or JPEG.');
      return;
    }
    if (file.size > LIMITS.tool.maxImageBytes) {
      toast.error(`That image is larger than the ${Math.round(LIMITS.tool.maxImageBytes / 1048576)} MB limit.`);
      return;
    }
    try {
      const url = URL.createObjectURL(file);
      let size: { width: number; height: number };
      try {
        size = await probeImageSize(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const scale = Math.min(1, MAX_IMAGE_WIDTH_PT / Math.max(1, size.width));
      const object: EditorObject = {
        id: newObjectId(),
        kind: 'image',
        pageIndex: pending.pageIndex,
        x: Math.round(pending.x),
        y: Math.round(pending.y),
        width: Math.max(16, Math.round(size.width * scale)),
        height: Math.max(16, Math.round(size.height * scale)),
        data: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type,
      };
      createObject(object);
    } catch {
      toast.error('Could not read that image.');
    }
  };

  /* --------------------------------------------------------------- save */

  const onSave = useCallback(async () => {
    const file = fileRef.current;
    if (!file || editRunner.state.status === 'running') return;
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: file.size,
      pageCount: infoRef.current?.pageCount,
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    setEditingId(null);
    editor.endTx();
    // Freeze from here: this snapshot is what the worker will write. The
    // "unsaved changes" baseline only advances once the write succeeds --
    // marking it up front meant a failed save silently disabled the
    // beforeunload guard, so the user's edits could be lost on navigation.
    const snapshot = editor.doc;
    const outcome = await editRunner.run(
      await readAsInputFiles([file]),
      { objects: snapshot.objects, formValues: snapshot.formValues },
      { timeoutMs: timeoutForPageCount(infoRef.current?.pageCount ?? 1) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    // A newer document may have been loaded while the save was in flight; that
    // one's edits are still unsaved.
    if (fileRef.current === file && infoRef.current !== null) {
      savedDocRef.current = snapshot;
    }
    void recordRecent({
      toolSlug: 'edit-pdf',
      toolName: 'Edit PDF',
      fileName: outcome.result.name,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  }, [editor, editRunner]);

  const continueEditing = useCallback(() => {
    editRunner.reset();
    setStage('editing');
  }, [editRunner.reset]);

  /**
   * Undo/redo wrappers that also retire an in-flight nudge transaction.
   *
   * The editor-state module drops its own transaction on undo, but the nudge
   * coalescer holds a second piece of state (`nudgeTxOpen`) that nothing else
   * knew about. Undo during a nudge burst used to leave it set, so the *next*
   * nudge -- potentially seconds later -- took the `live` path with no open
   * snapshot and silently became an un-undoable move. Resetting it here keeps
   * the coalescer and the history in agreement.
   */
  const closeNudgeTx = useCallback(() => {
    if (nudgeCloseTimer.current !== undefined) {
      clearTimeout(nudgeCloseTimer.current);
      nudgeCloseTimer.current = undefined;
    }
    nudgeTxOpen.current = false;
  }, []);

  const undo = useCallback(() => {
    closeNudgeTx();
    editor.undo();
  }, [editor.undo, closeNudgeTx]);

  const redo = useCallback(() => {
    closeNudgeTx();
    editor.redo();
  }, [editor.redo, closeNudgeTx]);

  /* ----------------------------------------------------------- keyboard */

  useEffect(() => {
    if (stage !== 'editing') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        Boolean(target) &&
        (target!.tagName === 'INPUT' || target!.tagName === 'TEXTAREA' || target!.isContentEditable);
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      // Text editing keeps its native undo. Document-level undo while typing is
      // not merely surprising: text edits are applied with live (no history
      // entry of their own), so Ctrl+Z inside a text box would skip past the
      // keystrokes and delete the whole object instead of the last character.
      if (typing && mod) {
        if (key === 's') {
          event.preventDefault();
          void onSave();
        }
        return;
      }

      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void onSave();
        return;
      }
      if (mod && key === 'd' && !typing) {
        event.preventDefault();
        transformSelected('duplicate');
        return;
      }
      if (event.key === 'Escape') {
        if (editingId) endEdit();
        else setSelectedId(null);
        return;
      }
      if (typing) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (event.key.startsWith('Arrow') && selectedId && !saving) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
        const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
        transformSelected('nudge', dx, dy);
        return;
      }
      const next = KEY_TOOLS[event.key.toLowerCase()];
      if (next && !mod && !event.altKey) setTool(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    stage,
    selectedId,
    editingId,
    saving,
    editor,
    onSave,
    deleteSelected,
    endEdit,
    transformSelected,
  ]);

  /* --------------------------------------------- unsaved-changes guard */

  useEffect(() => {
    if (stage !== 'editing') return;
    const hasWork =
      editor.doc.objects.length > 0 || Object.keys(editor.doc.formValues).length > 0;
    if (!hasWork || editor.doc === savedDocRef.current) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [stage, editor.doc]);

  /* -------------------------------------------------------------- views */

  // Derived page data lives above the early return below: hooks must run in the
  // same order on every render, including after "continue editing" comes back
  // from the result panel.
  const objectsByPage = usePageBuckets(editor.doc.objects);
  const widgetsByPage = usePageBuckets<FormWidgetInfo>(info?.fields ?? NO_WIDGETS);
  const selectedObject = editor.doc.objects.find((object) => object.id === selectedId) ?? null;

  // Page-bound callbacks, stable per page: an inline arrow would change identity
  // on every parent render and defeat the memoized pages entirely.
  const pageBindings = useMemo(() => {
    const map = new Map<number, PageBinding>();
    for (const page of info?.pages ?? []) {
      map.set(page.index, {
        onSeedReplace: (run: TextRun) => seedReplace(page.index, run),
        onImageRequested: (point: { x: number; y: number }) => onImageRequested(page.index, point),
        onVisible: () => void ensureRaster(page.index),
        onHidden: () => releaseDistantRasters(page.index),
      });
    }
    return map;
  }, [info, seedReplace, onImageRequested, ensureRaster, releaseDistantRasters]);

  if (editState.status === 'done') {
    const { result } = editState;
    return (
      <ResultPanel
        fileName={result.name}
        pageCount={result.pageCount}
        sizeBytes={result.data.byteLength}
        onDownload={() => downloadBytes(result.data, result.name)}
        onReset={resetAll}
        onContinue={continueEditing}
        continueLabel="Continue editing"
        footerNote={
          <>
            Saved, re-parsed and verified ({result.pageCount} page
            {result.pageCount === 1 ? '' : 's'}) before this download was enabled.
          </>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => void handleFiles(next)}
        disabled={stage === 'preparing'}
        hint="one PDF to edit"
        multiple={false}
      />

      {stage === 'preparing' && inspectState.status === 'running' && (
        <JobProgressPanel progress={inspectState.progress} onCancel={inspectRunner.cancel} />
      )}

      {stage === 'editing' && info && (
        <div className="overflow-hidden rounded-xl border border-border bg-card" data-testid="editor">
          <EditorToolbar
            tool={tool}
            onToolChange={setTool}
            zoom={zoom}
            onZoomChange={onZoomChange}
            canUndo={editor.canUndo}
            canRedo={editor.canRedo}
            onUndo={undo}
            onRedo={redo}
            hasSelection={selectedObject !== null}
            onDelete={deleteSelected}
            onSave={() => void onSave()}
            saving={saving}
            canReorder={canReorder}
            canSendBack={canSendBack}
            onReorder={(direction) => transformSelected(direction)}
            showSave
          />

          <div
            ref={scrollRef}
            className="max-h-[72vh] overflow-y-auto bg-muted/40 p-4"
            data-testid="editor-scroll"
          >
            {info.pages.map((page) => {
              const widgets = widgetsByPage.get(page.index) ?? NO_WIDGETS;
              const binding = pageBindings.get(page.index);
              if (!binding) return null;
              return (
                <EditorPage
                  key={page.index}
                  pageIndex={page.index}
                  width={page.displayWidthPt ?? page.widthPt}
                  height={page.displayHeightPt ?? page.heightPt}
                  zoom={zoom}
                  rasterUrl={rasters[page.index]?.url ?? null}
                  objects={objectsByPage.get(page.index) ?? NO_OBJECTS}
                  selectedId={selectedId}
                  editingId={editingId}
                  tool={tool}
                  runs={runsByPage[page.index] ?? null}
                  widgets={widgets}
                  // Only pages that actually own a field care about form values,
                  // so keystrokes in one field cannot re-render the whole book.
                  formValues={widgets.length > 0 ? editor.doc.formValues : NO_FORM_VALUES}
                  readOnly={saving}
                  onSelect={select}
                  onStartEdit={startEdit}
                  onEndEdit={endEdit}
                  onEditText={editText}
                  onAutoHeight={autoHeight}
                  onCreate={createObject}
                  onSeedReplace={binding.onSeedReplace}
                  onImageRequested={binding.onImageRequested}
                  onVisible={binding.onVisible}
                  onHidden={binding.onHidden}
                  onMoveLive={moveLive}
                  onResizeLive={resizeLive}
                  onFormValue={setFormValue}
                  onBeginTx={editor.beginTx}
                  onEndTx={editor.endTx}
                />
              );
            })}
          </div>

          {saving && (
            <JobProgressPanel progress={editState.progress} onCancel={editRunner.cancel} />
          )}
        </div>
      )}

      {selectedObject && stage === 'editing' && !saving && (
        <EditorInspector object={selectedObject} onPatch={patchObject} onDelete={deleteSelected} />
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => void onImageFile(event)}
      />
    </div>
  );
}