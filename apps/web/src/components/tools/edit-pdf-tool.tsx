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
/** Cap inserted images so a phone photo doesn't take over the page. */
const MAX_IMAGE_WIDTH_PT = 300;
/** Pages whose text runs are warmed in the background as the editor opens. */
const WARM_RUN_PAGES = 10;
/** Pages whose rasters are fetched immediately; the rest lazy-load on scroll. */
const WARM_RASTER_PAGES = 20;
/** How many page bitmaps may be in flight at once (each holds a file copy). */
const MAX_PARALLEL_RASTERS = 2;
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

interface PageBinding {
  onSeedReplace: (run: TextRun) => void;
  onImageRequested: (point: { x: number; y: number }) => void;
  onVisible: () => void;
}

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
  zoomRef.current = zoom;
  toolRef.current = tool;
  rastersRef.current = rasters;

  const rasterPending = useRef(new Set<number>());
  const rasterQueue = useRef<number[]>([]);
  const rasterActive = useRef(0);
  const runsFetched = useRef(new Set<number>());
  const runsInflight = useRef(new Set<number>());
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImageRef = useRef<{ pageIndex: number; x: number; y: number } | null>(null);

  const inspectState = inspectRunner.state;
  const editState = editRunner.state;
  const saving = editState.status === 'running';

  /* ------------------------------------------------------------ rasters */

  const ensureRaster = useCallback(async (pageIndex: number): Promise<void> => {
    const file = fileRef.current;
    const page = infoRef.current?.pages[pageIndex];
    if (!file || !page) return;
    const desired = Math.round(
      (page.displayWidthPt ?? page.widthPt) * zoomRef.current * RASTER_SCALE,
    );
    const cached = rastersRef.current[pageIndex];
    if (cached && Math.abs(cached.widthPx - desired) <= desired * 0.25) return;
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
    rasterActive.current += 1;
    try {
      const input = [{ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }];
      const result = await jobPool.run<ThumbnailsOutput>('thumbnails', input, {
        targetWidthPx: desired,
        pageIndexes: [pageIndex],
      });
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
    } catch {
      toast.error(`Could not render page ${pageIndex + 1}`);
    } finally {
      rasterPending.current.delete(pageIndex);
      rasterActive.current -= 1;
      const next = rasterQueue.current.shift();
      if (next !== undefined) {
        // Clear the marker before re-entering, or the dequeued page looks busy.
        rasterPending.current.delete(next);
        void ensureRaster(next);
      }
    }
  }, []);

  /* --------------------------------------------------------- text runs */

  const ensureRuns = useCallback(async (indexes: number[]): Promise<void> => {
    const file = fileRef.current;
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
        setRunsByPage((prev) => ({
          ...prev,
          ...Object.fromEntries(chunk.map((page, i) => [page, result.runs[i] ?? []])),
        }));
        for (const index of chunk) runsFetched.current.add(index);
      }
    } catch {
      // Runs only power the "click text to replace it" affordance; the text
      // tool still adds new boxes without them.
      for (const index of wanted) runsFetched.current.add(index);
    } finally {
      for (const index of wanted) runsInflight.current.delete(index);
    }
  }, []);

  // Indirection so `ensureRaster` can stay referentially stable while still
  // calling the latest `ensureRuns`.
  const ensureRunsRef = useRef(ensureRuns);
  ensureRunsRef.current = ensureRuns;

  /* ------------------------------------------------------------- setup */

  const resetAll = useCallback(() => {
    for (const raster of Object.values(rastersRef.current)) URL.revokeObjectURL(raster.url);
    setRasters({});
    setRunsByPage({});
    runsFetched.current.clear();
    runsInflight.current.clear();
    rasterPending.current.clear();
    rasterQueue.current = [];
    rasterActive.current = 0;
    setFiles([]);
    setInfo(null);
    fileRef.current = null;
    infoRef.current = null;
    setStage('idle');
    setSelectedId(null);
    setEditingId(null);
    setTool('select');
    setZoom(1);
    zoomTouchedRef.current = false;
    savedDocRef.current = null;
    // Without this, the next document would inherit the previous one's objects
    // (and their page indexes).
    editor.reset();
    editRunner.reset();
    inspectRunner.reset();
  }, [editor.reset, editRunner.reset, inspectRunner.reset]);

  // Blob URLs die with the component even if nobody pressed "start over".
  useEffect(
    () => () => {
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
    setStage('preparing');
    const outcome = await inspectRunner.run(await readAsInputFiles([file]));
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
    // A new file means a new document: never keep the previous overlay.
    editor.reset();
    savedDocRef.current = null;
    setFiles(incoming);
    fileRef.current = file;
    infoRef.current = doc;
    setInfo(doc);
    setStage('editing');
    // First batch up front; deeper pages load when they scroll into view.
    const eager = Math.min(WARM_RASTER_PAGES, doc.pageCount);
    for (let index = 0; index < eager; index += 1) void ensureRaster(index);
    void ensureRuns(
      Array.from({ length: Math.min(WARM_RUN_PAGES, doc.pageCount) }, (_, index) => index),
    );
  };

  // Re-render cached pages when the zoom level changes.
  const onZoomChange = useCallback((next: number) => {
    zoomTouchedRef.current = true;
    setZoom(clampZoom(next));
  }, []);

  useEffect(() => {
    if (stage !== 'editing') return;
    for (const key of Object.keys(rastersRef.current)) void ensureRaster(Number(key));
  }, [zoom, stage, ensureRaster]);

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
        editor.apply((doc) => ({
          ...doc,
          objects: doc.objects.map((object) =>
            object.id === selectedId ? { ...object, x: object.x + dx, y: object.y + dy } : object,
          ),
        }));
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
    // Freeze from here: this snapshot is what the worker will write.
    savedDocRef.current = editor.doc;
    const outcome = await editRunner.run(
      await readAsInputFiles([file]),
      { objects: editor.doc.objects, formValues: editor.doc.formValues },
      { timeoutMs: timeoutForPageCount(infoRef.current?.pageCount ?? 1) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
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

  /* ----------------------------------------------------------- keyboard */

  useEffect(() => {
    if (stage !== 'editing') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        Boolean(target) &&
        (target!.tagName === 'INPUT' || target!.tagName === 'TEXTAREA' || target!.isContentEditable);
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        editor.redo();
        return;
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void onSave();
        return;
      }
      if (mod && event.key.toLowerCase() === 'd' && !typing) {
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
      });
    }
    return map;
  }, [info, seedReplace, onImageRequested, ensureRaster]);

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
            onUndo={editor.undo}
            onRedo={editor.redo}
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