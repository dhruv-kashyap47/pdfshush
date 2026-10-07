/**
 * Edit PDF -- the Phase 2 editor.
 *
 * Hybrid by design: page rasters and text runs come from read-only jobs (one
 * per page, cached), edits live entirely in React state (see
 * `lib/editor-state.ts`), and the `edit` job applies them atomically and
 * re-parses its own output before a download is offered.
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  timeoutForPageCount,
  type EditorObject,
  type EditJobOutput,
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

const KEY_TOOLS: Record<string, EditorTool> = { s: 'select', t: 'text', i: 'image', h: 'highlight' };

let objectCounter = 0;
function newObjectId(): string {
  objectCounter += 1;
  return `u${Date.now().toString(36)}${objectCounter.toString(36)}`;
}

function probeImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('unreadable image'));
    image.src = url;
  });
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

  const fileRef = useRef<File | null>(null);
  const infoRef = useRef<DocInfo | null>(null);
  const zoomRef = useRef(zoom);
  const toolRef = useRef(tool);
  const rastersRef = useRef(rasters);
  zoomRef.current = zoom;
  toolRef.current = tool;
  rastersRef.current = rasters;

  const rasterInflight = useRef(new Set<number>());
  const runsFetched = useRef(new Set<number>());
  const runsInflight = useRef(new Set<number>());
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImageRef = useRef<{ pageIndex: number; x: number; y: number } | null>(null);

  /* ------------------------------------------------------------ rasters */

  const ensureRaster = async (pageIndex: number): Promise<void> => {
    const file = fileRef.current;
    const page = infoRef.current?.pages[pageIndex];
    if (!file || !page) return;
    const desired = Math.round(
      (page.displayWidthPt ?? page.widthPt) * zoomRef.current * RASTER_SCALE,
    );
    const cached = rastersRef.current[pageIndex];
    if (cached && Math.abs(cached.widthPx - desired) <= desired * 0.25) return;
    if (rasterInflight.current.has(pageIndex)) return;
    rasterInflight.current.add(pageIndex);
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
        if (toolRef.current === 'text') void ensureRuns([pageIndex]);
      }
    } catch {
      toast.error(`Could not render page ${pageIndex + 1}`);
    } finally {
      rasterInflight.current.delete(pageIndex);
    }
  };

  /* --------------------------------------------------------- text runs */

  const ensureRuns = async (indexes: number[]): Promise<void> => {
    const file = fileRef.current;
    const wanted = indexes.filter(
      (index) => !runsFetched.current.has(index) && !runsInflight.current.has(index),
    );
    if (!file || wanted.length === 0) return;
    for (const index of wanted) runsInflight.current.add(index);
    try {
      const input = [{ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }];
      const result = await jobPool.run<TextRunsOutput>('text-runs', input, { pageIndexes: wanted });
      setRunsByPage((prev) => ({
        ...prev,
        ...Object.fromEntries(wanted.map((page, i) => [page, result.runs[i] ?? []])),
      }));
      for (const index of wanted) runsFetched.current.add(index);
    } catch {
      // Runs only power the "click text to replace it" affordance; the text
      // tool still adds new boxes without them.
    } finally {
      for (const index of wanted) runsInflight.current.delete(index);
    }
  };

  /* ------------------------------------------------------------- setup */

  const resetAll = () => {
    Object.values(rastersRef.current).forEach((raster) => URL.revokeObjectURL(raster.url));
    setRasters({});
    setRunsByPage({});
    runsFetched.current.clear();
    runsInflight.current.clear();
    rasterInflight.current.clear();
    setFiles([]);
    setInfo(null);
    fileRef.current = null;
    infoRef.current = null;
    setStage('idle');
    setSelectedId(null);
    setEditingId(null);
    setTool('select');
    setZoom(1);
    editRunner.reset();
    inspectRunner.reset();
  };

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
  useEffect(() => {
    if (stage !== 'editing') return;
    for (const key of Object.keys(rastersRef.current)) void ensureRaster(Number(key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // Warm run boxes for every page the first time the text tool is picked.
  useEffect(() => {
    if (stage !== 'editing' || tool !== 'text' || !info) return;
    void ensureRuns(Array.from({ length: info.pageCount }, (_, index) => index));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, stage, info]);

  /* ----------------------------------------------------------- editing */

  const createObject = (object: EditorObject) => {
    editor.apply((doc) => ({ ...doc, objects: [...doc.objects, object] }));
    setSelectedId(object.id);
  };

  const patchObject = (patch: Record<string, unknown>) => {
    if (!selectedId) return;
    editor.apply((doc) => ({
      ...doc,
      objects: doc.objects.map((object) =>
        object.id === selectedId ? ({ ...object, ...patch } as EditorObject) : object,
      ),
    }));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    editor.apply((doc) => ({ ...doc, objects: doc.objects.filter((o) => o.id !== selectedId) }));
    setSelectedId(null);
    setEditingId(null);
    editor.endTx();
  };

  const moveLive = (id: string, x: number, y: number) => {
    editor.live((doc) => ({
      ...doc,
      objects: doc.objects.map((object) => (object.id === id ? { ...object, x, y } : object)),
    }));
  };

  const resizeLive = (id: string, rect: { x: number; y: number; width: number; height: number }) => {
    editor.live((doc) => ({
      ...doc,
      objects: doc.objects.map((object) => (object.id === id ? { ...object, ...rect } : object)),
    }));
  };

  const startEdit = (id: string) => {
    setSelectedId(id);
    setEditingId(id);
    editor.beginTx();
  };

  const endEdit = () => {
    setEditingId(null);
    editor.endTx();
  };

  const editText = (id: string, text: string) => {
    editor.live((doc) => ({
      ...doc,
      objects: doc.objects.map((object) =>
        object.id === id && object.kind === 'text' ? { ...object, text } : object,
      ),
    }));
  };

  /** Replace an existing line: whiteout + prefilled text, one undo step. */
  const seedReplace = (pageIndex: number, run: TextRun) => {
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
  };

  const setFormValue = (name: string, value: string | boolean) => {
    editor.live((doc) => ({ ...doc, formValues: { ...doc.formValues, [name]: value } }));
  };

  /* -------------------------------------------------------- insert image */

  const onImageRequested = (pageIndex: number, point: { x: number; y: number }) => {
    pendingImageRef.current = { pageIndex, ...point };
    imageInputRef.current?.click();
  };

  const onImageFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const pending = pendingImageRef.current;
    if (!file || !pending) return;
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      toast.error('Images must be PNG or JPEG.');
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

  const onSave = async () => {
    const file = fileRef.current;
    if (!file || editRunner.state.status === 'running') return;
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: file.size,
      pageCount: info?.pageCount,
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    setEditingId(null);
    editor.endTx();
    const outcome = await editRunner.run(
      await readAsInputFiles([file]),
      { objects: editor.doc.objects, formValues: editor.doc.formValues },
      { timeoutMs: timeoutForPageCount(info?.pageCount ?? 1) },
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
  };

  /* ----------------------------------------------------------- keyboard */

  useEffect(() => {
    if (stage !== 'editing') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        Boolean(target) &&
        (target!.tagName === 'INPUT' || target!.tagName === 'TEXTAREA' || target!.isContentEditable);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        editor.redo();
        return;
      }
      if (event.key === 'Escape') {
        if (editingId) endEdit();
        else setSelectedId(null);
        return;
      }
      if (typing) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedId) {
          event.preventDefault();
          deleteSelected();
        }
        return;
      }
      const next = KEY_TOOLS[event.key.toLowerCase()];
      if (next && !event.ctrlKey && !event.metaKey && !event.altKey) setTool(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, selectedId, editingId, editor]);

  /* -------------------------------------------------------------- views */

  const inspectState = inspectRunner.state;
  const editState = editRunner.state;

  if (editState.status === 'done') {
    const { result } = editState;
    return (
      <ResultPanel
        fileName={result.name}
        pageCount={result.pageCount}
        sizeBytes={result.data.byteLength}
        onDownload={() => downloadBytes(result.data, result.name)}
        onReset={resetAll}
        footerNote={
          <>
            Saved, re-parsed and verified ({result.pageCount} page
            {result.pageCount === 1 ? '' : 's'}) before this download was enabled.
          </>
        }
      />
    );
  }

  const selectedObject = editor.doc.objects.find((object) => object.id === selectedId) ?? null;
  const saving = editState.status === 'running';

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
            onZoomChange={setZoom}
            canUndo={editor.canUndo}
            canRedo={editor.canRedo}
            onUndo={editor.undo}
            onRedo={editor.redo}
            hasSelection={selectedObject !== null}
            onDelete={deleteSelected}
            onSave={() => void onSave()}
            saving={saving}
            showSave
          />

          <div className="max-h-[72vh] overflow-y-auto bg-muted/40 p-4" data-testid="editor-scroll">
            {info.pages.map((page) => (
              <EditorPage
                key={page.index}
                pageIndex={page.index}
                width={page.displayWidthPt ?? page.widthPt}
                height={page.displayHeightPt ?? page.heightPt}
                zoom={zoom}
                rasterUrl={rasters[page.index]?.url ?? null}
                objects={editor.doc.objects}
                selectedId={selectedId}
                editingId={editingId}
                tool={tool}
                runs={runsByPage[page.index] ?? null}
                widgets={info.fields}
                formValues={editor.doc.formValues}
                onSelect={setSelectedId}
                onStartEdit={startEdit}
                onEndEdit={endEdit}
                onEditText={editText}
                onCreate={createObject}
                onSeedReplace={(run) => seedReplace(page.index, run)}
                onImageRequested={(point) => onImageRequested(page.index, point)}
                onVisible={() => void ensureRaster(page.index)}
                onBeginTx={editor.beginTx}
                onEndTx={editor.endTx}
                onMoveLive={moveLive}
                onResizeLive={resizeLive}
                onFormValue={setFormValue}
              />
            ))}
          </div>

          {saving && editState.status === 'running' && (
            <JobProgressPanel progress={editState.progress} onCancel={editRunner.cancel} />
          )}
        </div>
      )}

      {selectedObject && stage === 'editing' && (
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
