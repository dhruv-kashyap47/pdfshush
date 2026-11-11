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

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Settings2,
  ShieldAlert,
  Sparkles,
  Type as TypeIcon,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  JobAbortedError,
  LIMITS,
  TextEditSession,
  rasterWidthWithinBudget,
  timeoutForPageCount,
  type EditorObject,
  type EditTextObject,
  type FormWidgetInfo,
  type InspectOutput,
  type OrganizeJobOutput,
  type PageLayout,
  type PageRef,
  type PageTextCapability,
  type Paragraph,
  type RedactJobOutput,
  type TextEdit,
  type TextEditJobOutput,
  type TextRun,
  type TextRunsOutput,
  type ThumbnailsOutput,
} from '@pdfshush/pdf-core';
import {
  EditorContextBar,
  EditorMobileNav,
  EditorPageRail,
  EditorStatusBar,
  EditorToolRail,
  EditorTopBar,
  editorStepZoom,
  type EditorMobileTab,
} from '@/components/editor/editor-chrome';
import { EditorAiPanel } from '@/components/editor/editor-ai-panel';
import { AnimatedContent } from '@/components/reactbits/animated-content';
import { AiCover } from '@/components/ai/ai-cover';
import { AiExport } from '@/components/ai/ai-export';
import { AI_EDIT_COPY } from '@/components/ai/tool-copy';
import { AiSettingsCard } from '@/components/ai/ai-settings-card';
import { AiSetupSection } from '@/components/ai/ai-setup-section';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AiSettings } from '@pdfshush/ai-provider/browser';
import { proposeSensitiveRegions } from '@/lib/ai/redaction-propose';
import { managedAsk } from '@/lib/ai/ask';
import { managedAvailable } from '@/lib/ai/managed';
import {
  aiReady,
  clearAiSettings,
  loadAiSettings,
  loadAiState,
  saveAiSettings,
  storedKeyPresent,
} from '@/lib/ai/settings';
import { loadAiMode, saveAiMode, type AiMode } from '@/lib/ai/mode';
import { EditorInspector } from '@/components/editor/editor-inspector';
import { ExportReceipt } from '@/components/editor/export-receipt';
import { StructurePanel } from '@/components/editor/structure-panel';
import { EditorPage } from '@/components/editor/editor-page';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { useJobRunner } from '@/hooks/use-job-runner';
import { Button } from '@/components/ui/button';
import {
  buildAuditSidecar,
  sidecarFileNameFor,
  type AuditPlacement,
} from '@/lib/audit-sidecar';
import { checkClientCapacity } from '@/lib/client-capacity';
import { downloadBlob, downloadBytes } from '@/lib/download';
import { readAsInputFiles, PDF_ACCEPT } from '@/lib/files';
import { useEditorSession } from '@/lib/editor-session';
import { editorIsDirty } from '@/lib/editor-dirty';
import type { EditorDoc } from '@/lib/editor-state';
import {
  defaultToolForMode,
  toolsForMode,
  type EditorMode,
  type EditorProposalMarker,
  type EditorTool,
} from '@/lib/editor-tools';
import { jobPool } from '@/lib/job-pool';
import { UI } from '@/lib/motion';
import type { AiPlanApplyResult } from '@/lib/ai/edit-skill';
import {
  SIGNATURE_LABEL_MAX_CHARS,
  sanitizeSignatureLabel,
} from '@/lib/signature-assets';
import {
  bodySelectionToDisplay,
  buildParagraphEditObjects,
  mutateParagraphText,
  paragraphDisplayText,
  paragraphEditKey,
  type ParagraphEditState,
  type ParagraphTextMutation,
  type TextSelectionState,
} from '@/lib/text-editing';
import { recordRecent } from '@/tools/recent';
import { TEXT_MODEL_LIMITS } from '@/lib/text-model-limits';
import { totalEdits } from '@/lib/edit-receipt';
import type { SignatureCapture } from '@/components/signature/signature-pad-dialog';

/**
 * The signature pad is a lazy chunk (`signature_pad` + Caveat faces ride it);
 * this module itself stays in the main bundle.
 */
const SignaturePadDialog = lazy(
  () =>
    import('@/components/signature/signature-pad-dialog').then((m) => ({
      default: m.SignaturePadDialog,
    })),
);

type DocInfo = InspectOutput['documents'][number];

/** Render scale: page bitmap pixels per CSS px (crisp on hi-dpi screens). */
const RASTER_SCALE = Math.min(2, (globalThis.devicePixelRatio ?? 1) * 1.5);
/**
 * Hard ceiling on one page bitmap, in pixels (~4 RGBA bytes each).
 *
 * `min(scale, 2)` is not a memory bound on its own: a poster or CAD drawing
 * page is 2000+ pt wide, so at 200% zoom on a hi-dpi screen the naive
 * calculation asks for 8000 × 11000 = 88 megapixels (about 350 MB for a single
 * page), which is a tab crash, not a slow render. Budget the *area* and derive
 * the width from it. (Lesson borrowed from the GenOffice donor, which caps the
 * same way with `sqrt(MAX_PX / (w * h))`.)
 */
const MAX_RASTER_PIXELS = 12_000_000;
/** Cap inserted images so a phone photo doesn't take over the page. */
const MAX_IMAGE_WIDTH_PT = 300;
/** A placed signature reads as a signature, not a stamp: cap it nearer ~2". */
const SIGNATURE_WIDTH_PT = 150;
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
const NO_PARAGRAPHS: Paragraph[] = [];

const KEY_TOOLS: Record<string, EditorTool> = {
  v: 'select',
  s: 'select',
  t: 'text',
  i: 'image',
  h: 'highlight',
  a: 'ai',
  r: 'redact',
};

let objectCounter = 0;
function newObjectId(): string {
  objectCounter += 1;
  return `u${Date.now().toString(36)}${objectCounter.toString(36)}`;
}

function measureTextLine(
  object: Extract<EditorObject, { kind: 'text' }>,
  line: string,
): number {
  if (typeof document === 'undefined') return line.length * object.fontSize * 0.5;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return line.length * object.fontSize * 0.5;
  const family =
    object.fontFamily === 'times'
      ? "'Times New Roman', Times, serif"
      : object.fontFamily === 'courier'
        ? "'Courier New', Courier, monospace"
        : 'Arial, Helvetica, sans-serif';
  context.font = `${object.italic ? 'italic ' : ''}${object.bold ? '700 ' : ''}${object.fontSize}px ${family}`;
  return context.measureText(line.length > 0 ? line : ' ').width;
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
  onTextBlockSelect: (blockId: string | null) => void;
  onParagraphEdit: (
    paragraphId: string,
    selection: { start: number; end: number } | null,
  ) => void;
  onTextSelectionChange: (selection: TextSelectionState | null) => void;
  onImageRequested: (point: { x: number; y: number }) => void;
  onSignatureRequested: (point: { x: number; y: number }) => void;
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
  return <PdfEditorWorkspace mode="edit" />;
}

export function FillSignTool() {
  return <PdfEditorWorkspace mode="sign" />;
}

export function RedactPdfTool() {
  return <PdfEditorWorkspace mode="redact" />;
}

export function OrganizePdfTool() {
  return <PdfEditorWorkspace mode="organize" />;
}

/**
 * The one PDF editor workspace in the product.
 *
 * `mode` selects which capability set is active and which export pipeline the
 * final action uses. The document session, viewport, selection, history and
 * page model are identical in every mode.
 */
export function PdfEditorWorkspace({ mode: initialMode }: { mode: EditorMode }) {
  const [mode, setMode] = useState<EditorMode>(initialMode);
  // Fill & Sign is the same editor wearing its signing hat: signature mode
  // opens first, the save action exports with an audit note, and the copy
  // speaks honestly about what signing attests to (D1).
  const isSign = mode === 'sign';
  const isRedact = mode === 'redact';
  const isOrganize = mode === 'organize';
  const isAi = mode === 'ai';
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<DocInfo | null>(null);
  const [stage, setStage] = useState<'idle' | 'preparing' | 'editing'>('idle');
  /** Opened from the structure panel so the limits are one click from a low score. */
  const [limitsOpen, setLimitsOpen] = useState(false);
  const editor = useEditorSession(initialMode);
  const {
    tool,
    setTool,
    zoom,
    currentPage,
    setCurrentPage,
    selectedId,
    setSelectedId,
    editingId,
    setEditingId,
    setZoom,
  } = editor;
  const [rasters, setRasters] = useState<Record<number, { url: string; widthPx: number }>>({});
  const [runsByPage, setRunsByPage] = useState<Record<number, TextRun[]>>({});
  /** Structured page layouts, fetched alongside the legacy runs. */
  const [layoutsByPage, setLayoutsByPage] = useState<Record<number, PageLayout>>({});
  /** PDFium capability snapshot per page (fonts, OCR layer, scans). */
  const [capabilitiesByPage, setCapabilitiesByPage] = useState<
    Record<number, PageTextCapability>
  >({});
  const [textSelection, setTextSelection] = useState<TextSelectionState | null>(null);
  const [selectedTextBlock, setSelectedTextBlock] = useState<{
    pageIndex: number;
    blockId: string;
  } | null>(null);
  const [paragraphEdit, setParagraphEdit] = useState<ParagraphEditState | null>(null);
  /** Redaction review confirmation: never run the destructive job without it. */
  const [confirmRedact, setConfirmRedact] = useState(false);
  /** Mobile back/close guard: leaving mid-edit must not silently drop changes. */
  const [confirmExit, setConfirmExit] = useState(false);
  /** Phone properties sheet. Closed by default so the canvas keeps its height. */
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  /** Page rail multi-selection (organise mode). */
  const [selectedPages, setSelectedPages] = useState<Set<number>>(() => new Set());
  /** AI proposals are read-only overlays until the ledger is applied. */
  const [aiMarkers, setAiMarkers] = useState<EditorProposalMarker[]>([]);
  const [aiChangedPages, setAiChangedPages] = useState<number[]>([]);
  const [aiChangeCount, setAiChangeCount] = useState(0);
  const [aiResult, setAiResult] = useState<AiPlanApplyResult | null>(null);
  const [aiResultPages, setAiResultPages] = useState<number | null>(null);
  const [redactAiSettings, setRedactAiSettings] = useState<AiSettings>(() => loadAiSettings());
  const [redactAiMode, setRedactAiMode] = useState<AiMode>(() => loadAiMode());
  const [redactAiManaged, setRedactAiManaged] = useState(false);
  const [redactAiOpen, setRedactAiOpen] = useState(false);
  const [findingSensitive, setFindingSensitive] = useState(false);
  const [sensitiveError, setSensitiveError] = useState<string | null>(null);
  const findAbort = useRef<AbortController | null>(null);
  const pageOrder = editor.pageOrder;
  const setPageOrder = editor.setPageOrder;
  const pageOrderDirty = editor.pageOrderDirty;

  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const editRunner = useJobRunner<TextEditJobOutput>('text-edit');
  const redactRunner = useJobRunner<RedactJobOutput>('redact');
  const organizeRunner = useJobRunner<OrganizeJobOutput>('organize');

  const scrollRef = useRef<HTMLDivElement>(null);
  const pageScrollFrame = useRef<number | null>(null);
  const fileRef = useRef<File | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
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
  useEffect(() => () => {
    if (nudgeCloseTimer.current !== undefined) clearTimeout(nudgeCloseTimer.current);
    if (pageScrollFrame.current !== null) cancelAnimationFrame(pageScrollFrame.current);
  }, []);
  zoomRef.current = zoom;
  toolRef.current = tool;
  rastersRef.current = rasters;
  /** Mirror of `runsByPage` for the eviction pass, which must not re-run on it. */
  const runsByPageRef = useRef(runsByPage);
  runsByPageRef.current = runsByPage;
  /** Mirror of the structured layouts for pointer/keyboard callbacks. */
  const layoutsByPageRef = useRef(layoutsByPage);
  layoutsByPageRef.current = layoutsByPage;
  const capabilitiesByPageRef = useRef(capabilitiesByPage);
  capabilitiesByPageRef.current = capabilitiesByPage;
  /**
   * Active inline paragraph session. Kept in a ref as well as state because a
   * blur can arrive in the same tick as a save, and commit must read the latest
   * text rather than whatever React last rendered.
   */
  const paragraphEditRef = useRef<{
    key: string;
    token: number;
    session: TextEditSession;
    baseline: string;
    paragraph: Paragraph;
    layout: PageLayout;
    pageIndex: number;
  } | null>(null);
  /** Objects created for each paragraph edit, so a re-edit replaces its own. */
  const paragraphObjectIds = useRef(new Map<string, string[]>());
  const editToken = useRef(0);
  const textSelectionRef = useRef(textSelection);
  textSelectionRef.current = textSelection;
  const savingRef = useRef(false);
  /**
   * Latest overlay document for callbacks that must read it without taking a
   * dependency on every keystroke (which would rebuild every page binding).
   */
  const editorDocRef = useRef(editor.doc);
  editorDocRef.current = editor.doc;

  const rasterPending = useRef(new Set<number>());
  const rasterRequested = useRef(new Map<number, number>());
  const rasterQueue = useRef<number[]>([]);
  const rasterActive = useRef(0);
  const runsFetched = useRef(new Set<number>());
  const runsInflight = useRef(new Set<number>());
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImageRef = useRef<{ pageIndex: number; x: number; y: number } | null>(null);

  /* ------------------------------------------------ fill & sign (P6.1) */

  /** Where the signature insertion lands: set when the pad opens. */
  const pendingSignatureRef = useRef<{ pageIndex: number; x: number; y: number } | null>(null);
  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);
  /** D2 signer label: optional, sanitized at save time, never a secret. */
  const [signerLabel, setSignerLabel] = useState('');
  /** Render kind/method of the latest placed signature, for the audit note. */
  const lastSignatureMethodRef = useRef<'drawn' | 'typed'>('drawn');
  /** The produced sidecar, offered as a second download on the result panel. */
  const [auditNote, setAuditNote] = useState<{ fileName: string; json: string } | null>(null);
  const [auditNoteError, setAuditNoteError] = useState<string | null>(null);

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
   * Consecutive render failures per page.
   *
   * A failed page used to be poisoned for the rest of the session: its
   * requested-width marker was already recorded before the job ran, so the
   * re-check in `finally` saw it as satisfied and nothing ever asked again --
   * the page sat on its loading placeholder forever. Failures are now counted,
   * the marker is cleared so a later zoom or scroll-into-view can ask again,
   * and the count caps the retries so a page that reliably fails stops
   * re-entering the queue instead of looping.
   */
  const rasterFailures = useRef(new Map<number, number>());
  const MAX_RASTER_ATTEMPTS = 2;

  /**
   * Bitmap width for one page: what we want for sharpness, clamped so the
   * decoded bitmap stays inside `MAX_RASTER_PIXELS`. Pure, so it is unit
   * testable without a browser and so every caller agrees on the budget.
   *
   * The clamp lives in the engine (`rasterWidthWithinBudget`) because getting the
   * units wrong here is silent: comparing the area budget against a pixel width
   * asked for ~7 px pages, which `scaleForWidth`'s floor stretched into a 29 px
   * bitmap blown up across the whole column -- every page looked blank.
   *
   * `displayWidthPt`/`displayHeightPt` are post-rotation dimensions, so a rotated
   * page is budgeted in the orientation it is actually painted at.
   */
  const rasterWidthPx = (page: { displayWidthPt: number; displayHeightPt: number }): number =>
    rasterWidthWithinBudget(
      page.displayWidthPt,
      page.displayHeightPt,
      zoomRef.current * RASTER_SCALE,
      MAX_RASTER_PIXELS,
    );

  const inspectState = inspectRunner.state;
  const editState = editRunner.state;
  const redactState = redactRunner.state;
  const organizeState = organizeRunner.state;
  const saving =
    editState.status === 'running' ||
    redactState.status === 'running' ||
    organizeState.status === 'running';
  savingRef.current = saving;

  // Redaction's AI assist uses the same connection settings as the assistant.
  // Hydration is asynchronous (IndexedDB), so the panel starts with the
  // synchronous snapshot and adopts the stored state when it arrives.
  useEffect(() => {
    let alive = true;
    void loadAiState().then((state) => {
      if (!alive) return;
      setRedactAiSettings(state.settings);
      setRedactAiMode(state.mode);
    });
    void managedAvailable().then((ok) => {
      if (alive) setRedactAiManaged(ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => () => findAbort.current?.abort(), []);

  // On a phone the page rail is an overlay. Start it closed so the document is
  // the first thing on screen; the rail button opens it.
  useEffect(() => {
    if (window.matchMedia?.('(max-width: 1099px)').matches) editor.toggleRail(false);
  }, [editor.toggleRail]);

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
    if ((rasterFailures.current.get(pageIndex) ?? 0) >= MAX_RASTER_ATTEMPTS) return;
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
    let attemptFailed = false;
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
      rasterFailures.current.delete(pageIndex);
    } catch (error) {
      attemptFailed = true;
      const attempts = (rasterFailures.current.get(pageIndex) ?? 0) + 1;
      rasterFailures.current.set(pageIndex, attempts);
      // The requested-width marker was written before the job started, so it
      // still claims this page is done. Leaving it there would mean the re-check
      // in `finally` -- and every later zoom change -- treated a blank page as
      // cached. Clearing it is what makes the page retryable at all.
      rasterRequested.current.delete(pageIndex);
      // A cancelled job is the expected consequence of swapping files or
      // navigating away; only a genuine render failure is worth a toast.
      if (generation === docGeneration.current && !isAbort(error)) {
        // The toast has to stay one short line, but the cause cannot be thrown
        // away: the worker serialised it across a thread boundary and this is
        // the only place left holding it. Only the error itself is logged -- no
        // file bytes, page contents or paths.
        console.error(
          `[edit-pdf] page ${pageIndex + 1} could not be rendered ` +
            `(attempt ${attempts}/${MAX_RASTER_ATTEMPTS}, target ${desired}px, document ${generation}):`,
          error,
        );
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
      //
      // Skipped after a failure: the point of this pass was to catch a *stale
      // width* on a page that rendered, and re-entering a page that just threw
      // would retry immediately and forever. Its marker is cleared above, so the
      // next zoom or scroll-into-view picks it up, capped by MAX_RASTER_ATTEMPTS.
      if (!attemptFailed) void ensureRaster(pageIndex);
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
          // One pdf.js pass produces both the legacy runs (click-to-replace
          // fallback) and the structured layout the text overlay uses.
          includeLayout: true,
          // PDFium capability inspection runs alongside the layout so the
          // editor can say "native", "OCR layer" or "scan/review" before a save.
          includeCapabilities: true,
        });
        // Runs belong to the document they were read from; writing them into a
        // newer one would let "click to replace" quote a different PDF.
        if (generation !== docGeneration.current) return;
        setRunsByPage((prev) => ({
          ...prev,
          ...Object.fromEntries(chunk.map((page, i) => [page, result.runs[i] ?? []])),
        }));
        if (result.layouts) {
          setLayoutsByPage((prev) => {
            const next = { ...prev };
            chunk.forEach((page, i) => {
              const layout = result.layouts?.[i];
              if (layout) next[page] = layout;
            });
            return next;
          });
        }
        if (result.capabilities) {
          setCapabilitiesByPage((prev) => {
            const next = { ...prev };
            chunk.forEach((page, i) => {
              const capability = result.capabilities?.[i];
              if (capability) next[page] = capability;
            });
            return next;
          });
        }
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
    setLayoutsByPage({});
    layoutsByPageRef.current = {};
    setCapabilitiesByPage({});
    capabilitiesByPageRef.current = {};
    setTextSelection(null);
    setSelectedTextBlock(null);
    setParagraphEdit(null);
    paragraphEditRef.current = null;
    paragraphObjectIds.current.clear();
    runsFetched.current.clear();
    runsInflight.current.clear();
    rasterRequested.current.clear();
    rasterPending.current.clear();
    rasterFailures.current.clear();
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
    setCurrentPage(0);
    zoomTouchedRef.current = false;
    savedDocRef.current = null;
    pendingSignatureRef.current = null;
    setSignatureDialogOpen(false);
    setSignerLabel('');
    lastSignatureMethodRef.current = 'drawn';
    setAuditNote(null);
    setAuditNoteError(null);
    setConfirmRedact(false);
    setSelectedPages(new Set());
    setAiMarkers([]);
    setAiChangedPages([]);
    setAiChangeCount(0);
    setAiResult(null);
    setAiResultPages(null);
    editor.resetPageOrder(0);
    // Without this, the next document would inherit the previous one's objects
    // (and their page indexes).
    editor.reset();
    editor.setTool(defaultToolForMode(mode));
    editRunner.reset();
    redactRunner.reset();
    organizeRunner.reset();
    inspectRunner.reset();
  }, [
    editor.reset,
    editor.resetPageOrder,
    editor.setTool,
    mode,
    editRunner.reset,
    redactRunner.reset,
    organizeRunner.reset,
    inspectRunner.reset,
    invalidateDocumentCaches,
  ]);

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
    // Second capacity pass. The editor rasterises pages on demand, so the byte
    // check above cannot bound a document with thousands of tiny pages.
    const pageVerdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: file.size,
      pageCount: doc.pageCount,
    });
    if (!pageVerdict.ok) {
      toast.error(pageVerdict.message);
      setStage('idle');
      return;
    }
    // A new file means a new document: drop the previous one's caches, rasters
    // and objects before anything reads them, or page 1 keeps showing the old
    // file's page 1.
    invalidateDocumentCaches();
    editor.reset();
    editor.resetPageOrder(doc.pageCount);
    editor.setTool(defaultToolForMode(mode));
    setAiMarkers([]);
    setAiChangedPages([]);
    setAiChangeCount(0);
    setAiResult(null);
    setAiResultPages(null);
    setSelectedPages(new Set());
    savedDocRef.current = null;
    setFiles(incoming);
    fileRef.current = file;
    infoRef.current = doc;
    setInfo(doc);
    setStage('editing');
    setSelectedId(null);
    setEditingId(null);
    setCurrentPage(0);
    pendingImageRef.current = null;
    // First batch up front; deeper pages load when they scroll into view.
    const eager = Math.min(WARM_RASTER_PAGES, doc.pageCount);
    for (let index = 0; index < eager; index += 1) void ensureRaster(index);
    void ensureRuns(
      Array.from({ length: Math.min(WARM_RUN_PAGES, doc.pageCount) }, (_, index) => index),
    );
  };

  /**
   * A width-fit zoom from the canvas' real content box. The old calculation
   * subtracted a hard-coded 40px while the canvas pads by up to 36px per side,
   * so the page opened wider than its column and immediately had a horizontal
   * scrollbar. Read the padding instead of guessing it.
   */
  const computeFitZoom = useCallback(
    (container: HTMLElement, pages: ReadonlyArray<{ displayWidthPt: number; widthPt: number }>) => {
      const styles = getComputedStyle(container);
      const padding =
        (Number.parseFloat(styles.paddingLeft) || 0) +
        (Number.parseFloat(styles.paddingRight) || 0);
      const widest = Math.max(
        1,
        ...pages.map((page) => page.displayWidthPt ?? page.widthPt),
      );
      return clampZoom((container.clientWidth - padding - 2) / widest);
    },
    [],
  );

  // Re-request cached pages when the zoom changes, and reconcile after any raster lands. Both dependencies are load-bearing: the fit-width zoom is applied in a *layout* effect, which runs before the eager rasters have arrived, so at that instant there is nothing cached to re-request and every eagerly loaded page silently kept its initial (half-resolution) bitmap until the user touched the zoom again. Watching `rasters` closes that window; the requested-width guard inside `ensureRaster` stops it becoming a loop.
  const onZoomChange = useCallback((next: number) => {
    zoomTouchedRef.current = true;
    setZoom(clampZoom(next));
  }, []);

  /** Explicit "fit width" action from the toolbar or Ctrl+0. */
  const fitWidth = useCallback(() => {
    const container = scrollRef.current;
    const pages = infoRef.current?.pages;
    if (!container || !pages) return;
    zoomTouchedRef.current = true;
    setZoom(computeFitZoom(container, pages));
  }, [computeFitZoom]);

  /** Jump to a page by index, moving only the document canvas. */
  const goToPage = useCallback((pageIndex: number) => {
    const canvas = scrollRef.current;
    const pageCount = infoRef.current?.pages.length ?? 0;
    if (!canvas || pageCount === 0) return;
    const target = Math.min(pageCount - 1, Math.max(0, pageIndex));
    const anchor = canvas.querySelector<HTMLElement>(`[data-page-anchor="${target}"]`);
    if (!anchor) return;
    const delta = anchor.getBoundingClientRect().top - canvas.getBoundingClientRect().top;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    canvas.scrollTo({
      top: canvas.scrollTop + delta - 8,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
    setCurrentPage(target);
  }, []);

  /**
   * Current page for the status bar. One rAF-throttled pass over the page
   * wrappers per scroll frame; it never touches React state unless the page
   * actually changed.
   */
  const syncCurrentPage = useCallback(() => {
    if (pageScrollFrame.current !== null) return;
    pageScrollFrame.current = requestAnimationFrame(() => {
      pageScrollFrame.current = null;
      const canvas = scrollRef.current;
      if (!canvas) return;
      const probe = canvas.getBoundingClientRect().top + 16;
      let next = 0;
      for (const anchor of canvas.querySelectorAll<HTMLElement>('[data-page-anchor]')) {
        if (anchor.getBoundingClientRect().top <= probe) {
          next = Number(anchor.dataset.pageAnchor);
        } else {
          break;
        }
      }
      setCurrentPage(next);
    });
  }, []);

  useEffect(() => {
    if (stage !== 'editing') return;
    for (const key of Object.keys(rastersRef.current)) void ensureRaster(Number(key));
    // Pages that *failed* have to be in this pass too. Clearing their
    // requested-width marker only makes them retryable; something still has to
    // ask, and iterating the raster cache cannot -- a page that never produced a
    // bitmap is not in it. Without this the retry budget below was unreachable
    // and a failed page stayed blank for the rest of the session. `ensureRaster`
    // caps the attempts, so this converges instead of spinning: each failure
    // leaves `rasters` untouched, so it cannot re-trigger this effect either.
    for (const [pageIndex, attempts] of rasterFailures.current) {
      if (attempts < MAX_RASTER_ATTEMPTS) void ensureRaster(pageIndex);
    }
  }, [zoom, stage, ensureRaster, rasters]);

  // Open at fit-width (the default in every desktop PDF editor) unless the user
  // has already chosen a zoom level. Layout effect: the container must be laid
  // out before it can be measured.
  useLayoutEffect(() => {
    if (stage !== 'editing' || !info || zoomTouchedRef.current) return;
    const container = scrollRef.current;
    if (!container || container.clientWidth === 0) return;
    setZoom(computeFitZoom(container, info.pages));
  }, [stage, info, computeFitZoom, editor.railOpen]);

  /**
   * Touch pinch-to-zoom on the document surface. A two-finger gesture owns the
   * canvas; one-finger taps, pans and drawing keep their existing pointer
   * handlers. The listener is non-passive because the browser's page zoom must
   * not fight the document zoom, and it is rebuilt only when a document opens.
   */
  useEffect(() => {
    if (stage !== 'editing') return undefined;
    const element = scrollRef.current;
    if (!element) return undefined;
    let startDistance = 0;
    let startZoom = 1;
    let pinching = false;

    const distance = (touches: TouchList) => {
      const first = touches[0];
      const second = touches[1];
      if (!first || !second) return 0;
      return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      pinching = true;
      startDistance = distance(event.touches);
      startZoom = zoomRef.current;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!pinching || event.touches.length !== 2 || startDistance <= 0) return;
      event.preventDefault();
      const scale = distance(event.touches) / startDistance;
      zoomTouchedRef.current = true;
      setZoom(clampZoom(startZoom * scale));
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        pinching = false;
        startDistance = 0;
      }
    };

    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd, { passive: true });
    element.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [stage, setZoom]);

  /**
   * Rotation and window resizes should re-fit a document that the user has not
   * zoomed by hand. Without this, a phone rotated to landscape keeps the
   * portrait fit and wastes half the canvas.
   */
  useEffect(() => {
    if (stage !== 'editing') return undefined;
    let frame = 0;
    const onResize = () => {
      if (zoomTouchedRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const container = scrollRef.current;
        const pages = infoRef.current?.pages;
        if (container && pages && container.clientWidth > 0) {
          setZoom(computeFitZoom(container, pages));
        }
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [stage, computeFitZoom, setZoom]);

  // Warm the structured text model around the current page. Extraction is
  // incremental by page: opening a 500-page book must not parse every page just
  // because the Select or Text tool is active. Pages near the viewport are
  // requested by the IntersectionObserver as well.
  useEffect(() => {
    if (stage !== 'editing' || !info) return;
    if (tool !== 'select' && tool !== 'text') return;
    const wanted = [currentPage - 1, currentPage, currentPage + 1, currentPage + 2].filter(
      (index) => index >= 0 && index < info.pageCount,
    );
    void ensureRuns(wanted);
  }, [tool, currentPage, stage, info, ensureRuns]);

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
      setTextSelection(null);
      setSelectedTextBlock(null);
      // A fresh mark should not slam a half-screen properties sheet over the
      // page the user is annotating; the context bar already carries its quick
      // controls, and Properties is one tap away.
      setMobileInspectorOpen(false);
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
      setTextSelection(null);
      setSelectedTextBlock(null);
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
      editor.live((doc) => {
        const object = doc.objects.find((item) => item.id === id && item.kind === 'text');
        if (!object || object.kind !== 'text') {
          return {
            ...doc,
            objects: doc.objects.map((item) =>
              item.id === id && item.kind === 'text' ? { ...item, text } : item,
            ),
          };
        }
        const page = infoRef.current?.pages[object.pageIndex];
        const pageWidth = page?.displayWidthPt ?? page?.widthPt ?? 1000;
        const availableWidth = Math.max(80, pageWidth - object.x);
        // Grow the box to fit the longest edited line instead of prematurely
        // wrapping or clipping, but never past the page's right edge.
        const longestLine = text
          .split('\n')
          .reduce((max, line) => Math.max(max, measureTextLine(object, line)), 0);
        const nextWidth = Math.max(object.width, Math.min(availableWidth, longestLine + 12));
        return {
          ...doc,
          objects: doc.objects.map((item) =>
            item.id === id && item.kind === 'text'
              ? { ...item, text, width: nextWidth }
              : item,
          ),
        };
      });
    },
    [editor.live],
  );

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    // An object and a text block are never selected at the same time: the
    // inspector would otherwise describe two things and Delete would be
    // ambiguous. Clicking empty page space also lands here with `null`.
    setTextSelection(null);
    setSelectedTextBlock(null);
  }, []);

  /* ------------------------------------------------------ structured text */

  /**
   * Applies paragraph mutations to a snapshot, replacing any objects a previous
   * edit of the same paragraph produced.
   *
   * This is the single place text edits enter the overlay document. Commit,
   * cut, paste and Delete all go through it, so they all become one undo step
   * and a paragraph can be edited repeatedly without stacking whiteouts.
   */
  const appendMutationObjects = useCallback(
    (doc: EditorDoc, mutations: readonly ParagraphTextMutation[]): EditorDoc | null => {
      const additions: EditorObject[] = [];
      const removed = new Set<string>();
      const pendingIds: Array<[string, string[]]> = [];
      for (const mutation of mutations) {
        const layout = layoutsByPageRef.current[mutation.pageIndex];
        const paragraph = layout?.paragraphs.find((item) => item.id === mutation.paragraphId);
        if (!layout || !paragraph) continue;
        const key = paragraphEditKey(mutation.pageIndex, mutation.paragraphId);
        for (const id of paragraphObjectIds.current.get(key) ?? []) removed.add(id);
        const capability = capabilitiesByPageRef.current[mutation.pageIndex];
        let strategy:
          | 'native-object'
          | 'content-stream'
          | 'localized-reconstruction'
          | 'manual-review'
          | undefined;
        if (capability?.likelyScanned) {
          strategy = 'manual-review';
        } else if (capability && capability.textObjects.length > 0) {
          const normalized = (value: string): string => value.replace(/\s+/gu, ' ').trim();
          const matched = layout.lines
            .filter((line) => paragraph.lineIds.includes(line.id))
            .every((line) =>
              capability.textObjects.some(
                (object) => normalized(object.text) === normalized(line.text),
              ),
            );
          if (!matched) strategy = 'localized-reconstruction';
        }
        const built = buildParagraphEditObjects(paragraph, layout, mutation.text, {
          makeId: newObjectId,
          ...(strategy ? { strategy } : {}),
        });
        additions.push(...built.whiteouts);
        if (built.textObject) additions.push(built.textObject);
        pendingIds.push([
          key,
          [
            ...built.whiteouts.map((object) => object.id),
            ...(built.textObject ? [built.textObject.id] : []),
          ],
        ]);
      }
      if (additions.length === 0 && removed.size === 0) return null;
      const remaining = doc.objects.filter((object) => !removed.has(object.id));
      if (remaining.length + additions.length > LIMITS.tool.maxEditObjects) {
        toast.error(
          `This document already has ${LIMITS.tool.maxEditObjects.toLocaleString()} objects`,
        );
        return null;
      }
      // Only record the new objects once the document is certain to receive
      // them; otherwise a rejected edit would make the next edit try to remove
      // ids that were never added.
      for (const [key, ids] of pendingIds) paragraphObjectIds.current.set(key, ids);
      return { ...doc, objects: [...remaining, ...additions] };
    },
    [],
  );

  const applyTextMutations = useCallback(
    (mutations: readonly ParagraphTextMutation[]) => {
      const next = appendMutationObjects(editorDocRef.current, mutations);
      if (next) editor.apply(next);
    },
    [appendMutationObjects, editor.apply],
  );

  const commitParagraphEdit = useCallback(
    (text?: string, paragraphId?: string, token?: number) => {
      const active = paragraphEditRef.current;
      if (!active) return;
      // A stale blur from a textarea that has already been replaced must not
      // commit into the new session. The token identifies the mount.
      if (
        paragraphId !== undefined &&
        (active.paragraph.id !== paragraphId || active.token !== token)
      ) {
        return;
      }
      // Clear first: a blur caused by the commit itself must not commit twice.
      paragraphEditRef.current = null;
      setParagraphEdit(null);
      const finalText = text ?? active.session.text;
      if (finalText === active.baseline) return;
      applyTextMutations([
        {
          pageIndex: active.pageIndex,
          paragraphId: active.paragraph.id,
          text: finalText,
        },
      ]);
      // The paragraph is now represented by an object; let the object inspector
      // take over instead of showing two overlapping selections.
      setSelectedTextBlock(null);
    },
    [applyTextMutations],
  );

  const cancelParagraphEdit = useCallback((paragraphId?: string, token?: number) => {
    const active = paragraphEditRef.current;
    if (paragraphId !== undefined) {
      if (!active || active.paragraph.id !== paragraphId || active.token !== token) return;
    }
    paragraphEditRef.current = null;
    setParagraphEdit(null);
  }, []);

  /**
   * Opens the inline editor for one extracted paragraph.
   *
   * `selection` is in body offsets. List paragraphs get their marker prepended
   * for display, so the offsets are shifted before they reach the textarea.
   */
  const startParagraphEdit = useCallback(
    (pageIndex: number, paragraphId: string, selection: { start: number; end: number } | null) => {
      if (savingRef.current) return;
      const layout = layoutsByPageRef.current[pageIndex];
      const paragraph = layout?.paragraphs.find((item) => item.id === paragraphId);
      if (!layout || !paragraph) return;
      // The overlay/save path can place upright text only (the exporter has no
      // per-object rotation). Text that is rotated in *display* space -- a
      // rotated page, or rotated content on an upright page -- stays
      // selectable/copyable, but opening the editor would replace it with
      // horizontal text at the same box. Defer that to the Phase 2 native
      // rewrite instead of silently damaging the page.
      const rotation = ((paragraph.typography.rotationDeg % 360) + 360) % 360;
      const displayRotated = layout.rotation !== 0 || (rotation > 1 && rotation < 359);
      if (displayRotated) {
        toast.error('Rotated text can be selected and copied, but editing it is not supported yet.');
        return;
      }
      const key = paragraphEditKey(pageIndex, paragraphId);
      if (paragraphEditRef.current?.key === key) return;
      if (paragraphEditRef.current) commitParagraphEdit();

      const displayText = paragraphDisplayText(paragraph);
      const displaySelection = selection
        ? bodySelectionToDisplay(paragraph, selection)
        : { start: 0, end: displayText.length };
      const session = TextEditSession.fromParagraph(paragraph, {
        selection: displaySelection,
      });
      if (displayText !== paragraph.text) {
        // `Paragraph.text` omits the list marker; the editor shows it and must
        // commit it, or a list item would lose its bullet.
        session.setText(displayText);
        session.setSelection(displaySelection.start, displaySelection.end);
      }
      editToken.current += 1;
      const token = editToken.current;
      paragraphEditRef.current = {
        key,
        token,
        session,
        baseline: displayText,
        paragraph,
        layout,
        pageIndex,
      };
      setParagraphEdit({
        pageIndex,
        paragraphId,
        initialText: displayText,
        initialSelection: displaySelection,
        token,
      });
      setTextSelection(null);
      setSelectedId(null);
    },
    [commitParagraphEdit],
  );

  const handleParagraphTextInput = useCallback(
    (text: string, paragraphId?: string, token?: number) => {
      const active = paragraphEditRef.current;
      if (!active) return;
      if (
        paragraphId !== undefined &&
        (active.paragraph.id !== paragraphId || active.token !== token)
      ) {
        return;
      }
      active.session.setText(text);
    },
    [],
  );

  const changeTextSelection = useCallback((selection: TextSelectionState | null) => {
    setTextSelection(selection);
  }, []);

  const selectTextBlock = useCallback((pageIndex: number, blockId: string | null) => {
    setSelectedTextBlock(blockId ? { pageIndex, blockId } : null);
    if (blockId) setSelectedId(null);
  }, []);

  /** Deletes the current non-edit selection, used by Delete/Backspace and Cut. */
  const deleteTextSelection = useCallback(() => {
    const selection = textSelectionRef.current;
    if (!selection || selection.ranges.length === 0) return;
    const layout = layoutsByPageRef.current[selection.pageIndex];
    if (!layout) return;
    const paragraphs = new Map(layout.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
    const mutations = mutateParagraphText(selection.ranges, paragraphs, '');
    applyTextMutations(mutations);
    setTextSelection(null);
    setSelectedTextBlock(null);
  }, [applyTextMutations]);

  /** Replaces the current selection with clipboard text (Paste). */
  const replaceTextSelection = useCallback(
    (replacement: string) => {
      const selection = textSelectionRef.current;
      if (!selection || selection.ranges.length === 0 || replacement.length === 0) return;
      const layout = layoutsByPageRef.current[selection.pageIndex];
      if (!layout) return;
      const paragraphs = new Map(layout.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
      const mutations = mutateParagraphText(selection.ranges, paragraphs, replacement);
      applyTextMutations(mutations);
      setTextSelection(null);
      setSelectedTextBlock(null);
    },
    [applyTextMutations],
  );

  const copyTextSelection = useCallback(async (): Promise<boolean> => {
    const selection = textSelectionRef.current;
    if (!selection || selection.text.length === 0) return false;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(selection.text);
      return true;
    } catch {
      toast.error('Could not copy the selected text.');
      return false;
    }
  }, []);

  const cutTextSelection = useCallback(async () => {
    if (!(await copyTextSelection())) return;
    deleteTextSelection();
  }, [copyTextSelection, deleteTextSelection]);

  const pasteTextSelection = useCallback(async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard unavailable');
      const text = await navigator.clipboard.readText();
      if (text) replaceTextSelection(text);
    } catch {
      toast.error('Could not read the clipboard.');
    }
  }, [replaceTextSelection]);

  // Leaving the text tools retires any transient selection. An open paragraph
  // editor unmounts with the overlay, so commit it rather than losing the last
  // typed characters to an unmounted textarea.
  useEffect(() => {
    if (tool === 'select' || tool === 'text') return;
    setTextSelection(null);
    setSelectedTextBlock(null);
    if (paragraphEditRef.current) {
      commitParagraphEdit(paragraphEditRef.current.session.text);
    }
  }, [tool, commitParagraphEdit]);

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
      const text: EditTextObject = {
        id: newObjectId(),
        kind: 'text',
        pageIndex,
        x: run.x,
        y: run.y,
        width: Math.max(run.width, 40) + 4,
        height: run.height,
        text: run.text,
        fontSize: Math.min(72, Math.max(4, Math.round(run.fontSize * 2) / 2)),
        bold: run.bold,
        italic: run.italic,
        fontFamily: run.fontFamily,
        color: '#111827',
        // Remember the run being replaced so the save can rewrite it in place
        // instead of whiteouting and redrawing. The whiteout is kept only as the
        // fallback and is excluded from the overlay pass when the rewrite works.
        inPlace: {
          find: run.text,
          box: { x: run.x, y: run.y, width: run.width, height: run.height },
          coverId: whiteout.id,
        },
      };
      editor.apply((doc) => ({ ...doc, objects: [...doc.objects, whiteout, text] }));
      setSelectedId(text.id);
      setEditingId(text.id);
      setTextSelection(null);
      setSelectedTextBlock(null);
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
          // `beginTx` already snapshots the pre-gesture document; using `apply`
          // here would push a second checkpoint and make one undo a no-op.
          editor.beginTx();
          editor.live(move);
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

  /* ------------------------------------------------------- shared capabilities */

  /**
   * Switching workspace keeps the same document session. Only the capability
   * surface changes: the file, viewport, zoom, history and overlay document are
   * untouched, so a tool hand-off never re-parses or loses work.
   */
  const changeMode = useCallback(
    (next: EditorMode) => {
      if (saving || next === mode) return;
      setMode(next);
      setTool(defaultToolForMode(next));
      setConfirmRedact(false);
      setSelectedPages(new Set());
      // Pages is a workspace, not a hidden panel: on tablet and phone the rail
      // is an overlay, so entering it must reveal the rail explicitly.
      if (next === 'organize') editor.toggleRail(true);
    },
    [mode, saving, setTool, editor],
  );

  /** The page order the viewport paints. Falls back to source order while loading. */
  const displayPages = useMemo(() => {
    const pages = info?.pages ?? [];
    if (pageOrder.length === 0) return pages;
    const mapped = pageOrder
      .map((index) => pages[index])
      .filter((page): page is DocInfo['pages'][number] => Boolean(page));
    return mapped.length > 0 ? mapped : pages;
  }, [info, pageOrder]);

  const currentDisplayPosition = Math.max(
    0,
    displayPages.findIndex((page) => page.index === currentPage),
  );

  const reorderPages = useCallback(
    (from: number, to: number) => {
      if (saving) return;
      const next = [...pageOrder];
      const [moved] = next.splice(from, 1);
      if (moved === undefined) return;
      next.splice(to, 0, moved);
      setPageOrder(next);
    },
    [pageOrder, saving, setPageOrder],
  );

  const deletePages = useCallback(
    (indexes: number[]) => {
      if (saving) return;
      const drop = new Set(indexes);
      const next = pageOrder.filter((index) => !drop.has(index));
      if (next.length === 0) {
        toast.error('A document needs at least one page.');
        return;
      }
      setPageOrder(next);
      setSelectedPages((previous) => {
        const copy = new Set(previous);
        for (const index of drop) copy.delete(index);
        return copy;
      });
      if (drop.has(currentPage)) setCurrentPage(next[0]!);
    },
    [currentPage, pageOrder, saving, setCurrentPage, setPageOrder],
  );

  const duplicatePage = useCallback(
    (index: number) => {
      if (saving) return;
      const position = pageOrder.indexOf(index);
      if (position < 0) return;
      const next = [...pageOrder];
      next.splice(position + 1, 0, index);
      setPageOrder(next);
    },
    [pageOrder, saving, setPageOrder],
  );

  const togglePageSelected = useCallback((index: number) => {
    setSelectedPages((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  /** Rect objects are the review geometry for the redaction pipeline. */
  const redactMarks = useMemo(
    () =>
      editor.doc.objects.filter(
        (object): object is Extract<EditorObject, { kind: 'rect' | 'ellipse' }> =>
          object.kind === 'rect',
      ),
    [editor.doc.objects],
  );

  const runRedact = useCallback(async () => {
    const file = fileRef.current;
    if (!file || redactRunner.state.status === 'running' || redactMarks.length === 0) return;
    const regions = redactMarks.map((mark) => ({
      pageIndex: mark.pageIndex,
      x: mark.x,
      y: mark.y,
      width: mark.width,
      height: mark.height,
    }));
    const pageCount = infoRef.current?.pageCount ?? 0;
    const verdict = checkClientCapacity({ fileCount: 1, totalBytes: file.size, pageCount });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    setConfirmRedact(false);
    const outcome = await redactRunner.run(
      await readAsInputFiles([file]),
      {
        regions,
        outputName: `${file.name.replace(/\.pdf$/i, '')}-redacted`,
      },
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
  }, [redactMarks, redactRunner]);

  const effectiveRedactAiMode: AiMode =
    redactAiMode === 'managed' && redactAiManaged ? 'managed' : 'byok';
  const redactAiUsable =
    effectiveRedactAiMode === 'managed' ? true : aiReady(redactAiSettings);

  // The frontispiece's connect-a-model card writes the same connection record
  // the assistant and the redaction assist read, so one saved key serves all
  // three surfaces.
  const saveCoverAiSettings = (next: AiSettings) => {
    setRedactAiSettings(saveAiSettings(next));
  };
  const changeCoverAiMode = (next: AiMode) => {
    setRedactAiMode(next);
    saveAiMode(next);
  };
  const forgetCoverAiKey = () => {
    void clearAiSettings().then((next) => {
      setRedactAiSettings(next);
      toast.success('Key removed', { description: 'The stored key was erased from this browser.' });
    });
  };

  /**
   * AI-assisted redaction keeps the old contract: the model only proposes
   * regions from document text, those regions enter the review surface as
   * ordinary marks, and nothing is destroyed until the explicit confirmation.
   */
  const findSensitive = useCallback(async () => {
    const file = fileRef.current;
    if (!file || findingSensitive || savingRef.current) return;
    if (!redactAiUsable) {
      setRedactAiOpen(true);
      return;
    }
    setFindingSensitive(true);
    setSensitiveError(null);
    const controller = new AbortController();
    findAbort.current = controller;
    try {
      const runs = await jobPool.run<TextRunsOutput>(
        'text-runs',
        await readAsInputFiles([file]),
        {},
        { signal: controller.signal },
      );
      const outcome = await proposeSensitiveRegions(runs.runs, {
        settings: redactAiSettings,
        ...(effectiveRedactAiMode === 'managed' ? { ask: managedAsk } : {}),
        signal: controller.signal,
      });
      if (outcome.error) {
        setSensitiveError(outcome.error);
        return;
      }
      if (outcome.regions.length === 0) {
        toast.info('AI found no sensitive data in this document.');
        return;
      }
      const additions: EditorObject[] = [];
      const existing = editor.doc.objects;
      for (const region of outcome.regions) {
        const duplicate = existing.some(
          (object) =>
            object.kind === 'rect' &&
            object.pageIndex === region.pageIndex &&
            Math.abs(object.x - region.x) < 1 &&
            Math.abs(object.y - region.y) < 1 &&
            Math.abs(object.width - region.width) < 1,
        );
        if (duplicate) continue;
        additions.push({
          id: newObjectId(),
          kind: 'rect',
          pageIndex: region.pageIndex,
          x: region.x,
          y: region.y,
          width: Math.max(6, region.width),
          height: Math.max(6, region.height),
          fill: '#000000',
          stroke: '#b91c1c',
          strokeWidth: 1,
        });
      }
      if (existing.length + additions.length > LIMITS.tool.maxEditObjects) {
        toast.error(`This document already has ${LIMITS.tool.maxEditObjects.toLocaleString()} objects`);
        return;
      }
      if (additions.length > 0) {
        editor.apply((doc) => ({ ...doc, objects: [...doc.objects, ...additions] }));
      }
      toast.success(
        `AI proposed ${additions.length} area${additions.length === 1 ? '' : 's'} from ${outcome.offered} text runs. Review, then redact.`,
      );
    } catch (cause) {
      if (!controller.signal.aborted) {
        setSensitiveError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setFindingSensitive(false);
      findAbort.current = null;
    }
  }, [
    editor,
    effectiveRedactAiMode,
    findingSensitive,
    redactAiSettings,
    redactAiUsable,
  ]);

  const runOrganize = useCallback(async () => {
    const file = fileRef.current;
    if (!file || organizeRunner.state.status === 'running') return;
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: file.size,
      pageCount: pageOrder.length,
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    const refs: PageRef[] = pageOrder.map((pageIndex) => ({ docIndex: 0, pageIndex }));
    const outcome = await organizeRunner.run(
      await readAsInputFiles([file]),
      {
        pageOrder: refs,
        outputName: `${file.name.replace(/\.pdf$/i, '')}-organized`,
      },
      { timeoutMs: timeoutForPageCount(pageOrder.length) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'organize-pdf',
      toolName: 'Organize pages',
      fileName: outcome.result.fileName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  }, [organizeRunner, pageOrder]);

  const goToDisplayPage = useCallback(
    (position: number) => {
      const page = displayPages[Math.min(displayPages.length - 1, Math.max(0, position))];
      if (page) goToPage(page.index);
    },
    [displayPages, goToPage],
  );

  const [aiMounted, setAiMounted] = useState(initialMode === 'ai');
  useEffect(() => {
    if ((mode === 'ai' || tool === 'ai') && !aiMounted) setAiMounted(true);
  }, [mode, tool, aiMounted]);

  const onAiProposals = useCallback(
    (markers: EditorProposalMarker[], changedPages: number[], count: number) => {
      setAiMarkers(markers);
      setAiChangedPages(changedPages);
      setAiChangeCount(count);
    },
    [],
  );

  const onAiApplyResult = useCallback(
    (result: AiPlanApplyResult, pageCount: number) => {
      setAiResult(result);
      setAiResultPages(pageCount);
      void recordRecent({
        toolSlug: 'edit-pdf-with-ai',
        toolName: 'Edit PDF with AI',
        fileName: result.name,
        pageCount,
        sizeBytes: result.data.byteLength,
      });
    },
    [],
  );


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

  /* --------------------------------------------------- insert signature */

  const onSignatureRequested = useCallback((pageIndex: number, point: { x: number; y: number }) => {
    pendingSignatureRef.current = { pageIndex, ...point };
    setSignatureDialogOpen(true);
  }, []);

  /**
   * The pad's "Use signature" verdict: place it where the user first clicked,
   * sized like a real signature stroke (never wider than ~2 inches of paper).
   * Aspect comes from the trimmed PNG, so placement matches what they saw.
   */
  const onSignatureChosen = useCallback(
    async (capture: SignatureCapture) => {
      const pending = pendingSignatureRef.current;
      if (!pending) return;
      const page = infoRef.current?.pages.find((candidate) => candidate.index === pending.pageIndex);
      const pageWidthPt = page?.displayWidthPt ?? page?.widthPt ?? 612;
      const width = Math.min(SIGNATURE_WIDTH_PT, Math.max(24, Math.round(capture.width)));
      const height = Math.max(20, Math.round(width * (capture.height / Math.max(1, capture.width))));
      const clamped = { ...pending };
      // The click seeds the top-left; keep the placement on the page.
      // Clamping reuses the same bounds rule the engine validates with.
      clamped.x = Math.min(clamped.x, Math.max(0, pageWidthPt - width));
      clamped.y = Math.max(0, clamped.y);
      lastSignatureMethodRef.current = capture.method;
      const object: EditorObject = {
        id: newObjectId(),
        kind: 'image',
        pageIndex: pending.pageIndex,
        x: Math.round(clamped.x),
        y: Math.round(clamped.y),
        width,
        height,
        data: new Uint8Array(await capture.png.arrayBuffer()),
        mimeType: 'image/png',
      };
      pendingSignatureRef.current = null;
      createObject(object);
    },
    [createObject],
  );

  /* --------------------------------------------------------------- save */

  const onSave = useCallback(async () => {
    if (
      isAi &&
      editor.doc.objects.length === 0 &&
      Object.keys(editor.doc.formValues).length === 0
    ) {
      return;
    }
    if (isRedact) {
      if (redactMarks.length === 0) {
        toast.error('Drag on the page to mark content first.');
        return;
      }
      setConfirmRedact(true);
      return;
    }
    if (isOrganize) {
      await runOrganize();
      return;
    }
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
    let snapshot = editor.doc;
    // An inline paragraph edit is intentionally not in the document until it
    // commits. Saving while a textarea still has focus must not drop the last
    // typed sentence, so fold it into the snapshot synchronously.
    const activeParagraphEdit = paragraphEditRef.current;
    if (activeParagraphEdit) {
      paragraphEditRef.current = null;
      setParagraphEdit(null);
      const finalText = activeParagraphEdit.session.text;
      if (finalText !== activeParagraphEdit.baseline) {
        const committed = appendMutationObjects(snapshot, [
          {
            pageIndex: activeParagraphEdit.pageIndex,
            paragraphId: activeParagraphEdit.paragraph.id,
            text: finalText,
          },
        ]);
        if (committed) {
          snapshot = committed;
          editor.apply(committed);
        }
      }
    }
    // Text boxes that replace an existing run become in-place edit intents. Their
    // whiteout and the box itself are excluded from the overlay pass, because the
    // job applies them only if the in-place rewrite does not work.
    const edits: TextEdit[] = [];
    const linked = new Set<string>();
    // Paragraph edits carry a native reflow plan. Prefer PDFium (original font,
    // created/removed lines); the whiteouts + preview text are only the fallback.
    for (const object of snapshot.objects) {
      if (object.kind !== 'text' && object.kind !== 'whiteout') continue;
      const plan = object.native;
      if (!plan) continue;
      const covers = (plan.coverIds ?? [])
        .map((id) => snapshot.objects.find((candidate) => candidate.id === id))
        .filter((candidate): candidate is EditorObject => Boolean(candidate));
      const fallback = [...covers];
      if (object.kind === 'text') fallback.push(object);
      const xs = plan.beforeLines.map((line) => line.box.x);
      const ys = plan.beforeLines.map((line) => line.box.y);
      const rights = plan.beforeLines.map((line) => line.box.x + line.box.width);
      const bottoms = plan.beforeLines.map((line) => line.box.y + line.box.height);
      edits.push({
        id: object.id,
        pageIndex: object.pageIndex,
        find: plan.before,
        replace: plan.after,
        ...(xs.length > 0
          ? {
              box: {
                x: Math.min(...xs),
                y: Math.min(...ys),
                width: Math.max(...rights) - Math.min(...xs),
                height: Math.max(...bottoms) - Math.min(...ys),
              },
            }
          : {}),
        layout: {
          ...(plan.paragraphId ? { paragraphId: plan.paragraphId } : {}),
          ...(plan.fontFamily ? { fontFamily: plan.fontFamily } : {}),
          beforeLines: plan.beforeLines,
          reflow: plan.reflow,
        },
        ...(plan.strategy ? { strategy: plan.strategy } : {}),
        ...(fallback.length > 0 ? { fallback } : {}),
      });
      linked.add(object.id);
      for (const cover of covers) linked.add(cover.id);
    }
    for (const object of snapshot.objects) {
      if (object.kind !== 'text' || !object.inPlace) continue;
      const cover = object.inPlace.coverId
        ? snapshot.objects.find((candidate) => candidate.id === object.inPlace!.coverId)
        : undefined;
      edits.push({
        id: object.id,
        pageIndex: object.pageIndex,
        find: object.inPlace.find,
        replace: object.text,
        box: object.inPlace.box,
        fallback: cover ? [cover, object] : [object],
      });
      linked.add(object.id);
      if (cover) linked.add(cover.id);
    }
    const objects = snapshot.objects.filter((object) => !linked.has(object.id));
    const outcome = await editRunner.run(
      await readAsInputFiles([file]),
      {
        edits,
        objects,
        formValues: snapshot.formValues,
        // Fill & Sign says what happened; the default "-edited" would lie.
        outputName: isSign
          ? `${file.name.replace(/\.pdf$/i, '')}-signed`
          : undefined,
      },
      { timeoutMs: timeoutForPageCount(infoRef.current?.pageCount ?? 1) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    // Tell the user honestly which edits were genuine rewrites and which were
    // overlays, rather than implying every edit replaced the original text.
    const report = outcome.result.report;
    if (report.inPlace > 0 || report.contentStream > 0 || report.fallback > 0) {
      const parts: string[] = [];
      if (report.inPlace > 0) parts.push(`${report.inPlace} replaced in place`);
      if (report.contentStream > 0) parts.push(`${report.contentStream} via content stream`);
      if (report.fallback > 0) parts.push(`${report.fallback} drawn as an overlay`);
      toast.success(`Text edits: ${parts.join(', ')}`, {
        description:
          report.fallback > 0
            ? 'Overlaid text leaves the original words selectable underneath. The export receipt says so, and Redact is the tool that removes them.'
            : 'The export receipt on the result screen records how each edit was applied.',
      });
    }
    // A newer document may have been loaded while the save was in flight; that
    // one's edits are still unsaved.
    if (fileRef.current === file && infoRef.current !== null) {
      savedDocRef.current = snapshot;
    }
    if (isSign) {
      // D2: the audit sidecar is produced here, entirely on the device, and
      // fails closed -- no digests means no note, with a visible reason.
      const sourceDigestSeed = await file.arrayBuffer();
      const placements: AuditPlacement[] = [];
      for (const object of snapshot.objects) {
        if (object.kind !== 'image') continue;
        placements.push({
          pageIndex: object.pageIndex,
          x: object.x,
          y: object.y,
          width: object.width,
          height: object.height,
        });
      }
      const built = await buildAuditSidecar({
        sourceName: file.name,
        sourceBytes: sourceDigestSeed,
        outputName: outcome.result.name,
        outputBytes: outcome.result.data,
        renderKind: 'raster',
        method: lastSignatureMethodRef.current,
        label: sanitizeSignatureLabel(signerLabel),
        placements,
      });
      if ('sidecar' in built) {
        setAuditNote({
          fileName: sidecarFileNameFor(outcome.result.name),
          json: JSON.stringify(built.sidecar, null, 2),
        });
        setAuditNoteError(null);
      } else {
        setAuditNote(null);
        setAuditNoteError(built.error);
      }
    }
    void recordRecent({
      toolSlug: isSign ? 'fill-sign' : 'edit-pdf',
      toolName: isSign ? 'Fill & Sign' : 'Edit PDF',
      fileName: outcome.result.name,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  }, [
    editor,
    editRunner,
    isAi,
    isRedact,
    isOrganize,
    isSign,
    redactMarks.length,
    runOrganize,
    signerLabel,
    appendMutationObjects,
  ]);

  const continueEditing = useCallback(() => {
    editRunner.reset();
    setAuditNote(null);
    setAuditNoteError(null);
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
      // Desktop-editor zoom shortcuts. Relative to the current level, so they
      // work from a fit-width zoom that is not one of the presets.
      if (mod && (key === '=' || event.key === '+')) {
        event.preventDefault();
        const next = editorStepZoom(zoomRef.current, 'in');
        if (next !== null) onZoomChange(next);
        return;
      }
      if (mod && key === '-') {
        event.preventDefault();
        const next = editorStepZoom(zoomRef.current, 'out');
        if (next !== null) onZoomChange(next);
        return;
      }
      if (mod && key === '0') {
        event.preventDefault();
        fitWidth();
        return;
      }
      if (event.key === 'Escape') {
        if (paragraphEditRef.current) {
          cancelParagraphEdit();
          return;
        }
        // Escape closes the object text editor even though focus is in its
        // textarea. Other form fields and the AI composer keep their own Escape.
        if (editingId) {
          endEdit();
          return;
        }
        if (typing) return;
        if (textSelectionRef.current) {
          setTextSelection(null);
          setSelectedTextBlock(null);
          return;
        }
        setSelectedId(null);
        return;
      }
      // Everything below acts on the document. While a form field, composer or
      // inline text editor has focus, its own keyboard handling owns the keys.
      if (typing) return;
      if (event.key === 'PageDown' || event.key === 'PageUp') {
        event.preventDefault();
        goToPage(currentPage + (event.key === 'PageDown' ? 1 : -1));
        return;
      }
      if (mod && key === 'd') {
        event.preventDefault();
        transformSelected('duplicate');
        return;
      }
      // Structured text selection: clipboard operations act on the extracted
      // text, not on the overlay objects. Editing a paragraph uses native
      // textarea clipboard handling above.
      if (mod && textSelectionRef.current) {
        if (key === 'c') {
          event.preventDefault();
          void copyTextSelection();
          return;
        }
        if (key === 'x') {
          event.preventDefault();
          void cutTextSelection();
          return;
        }
        if (key === 'v') {
          event.preventDefault();
          void pasteTextSelection();
          return;
        }
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && textSelectionRef.current) {
        event.preventDefault();
        deleteTextSelection();
        return;
      }
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
      if (
        next &&
        !mod &&
        !event.altKey &&
        toolsForMode(mode).some((entry) => entry.id === next)
      ) {
        setTool(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    stage,
    selectedId,
    editingId,
    saving,
    currentPage,
    editor,
    onSave,
    deleteSelected,
    endEdit,
    transformSelected,
    onZoomChange,
    fitWidth,
    goToPage,
    cancelParagraphEdit,
    copyTextSelection,
    cutTextSelection,
    pasteTextSelection,
    deleteTextSelection,
    mode,
  ]);

  /* --------------------------------------------- unsaved-changes guard */

  useEffect(() => {
    if (stage !== 'editing') return;
    const hasWork =
      editor.doc.objects.length > 0 ||
      Object.keys(editor.doc.formValues).length > 0 ||
      paragraphEdit !== null ||
      (stage === 'editing' && pageOrderDirty);
    if (!hasWork || editor.doc === savedDocRef.current) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [stage, editor.doc, editor.pageOrderDirty, paragraphEdit, pageOrderDirty]);

  /* -------------------------------------------------------------- views */

  const showingResult =
    editState.status === 'done' ||
    redactState.status === 'done' ||
    organizeState.status === 'done' ||
    aiResult !== null;

  /**
   * The editor is rendered through a portal into <body>, so while it is open the
   * route's marketing chrome is hidden and the window cannot scroll behind the
   * fixed application surface. The result panel is not portalled, so this is
   * released before it renders.
   */
  useEffect(() => {
    if (stage !== 'editing' || showingResult || !info) return;
    document.body.classList.add('editor-app-active');
    return () => document.body.classList.remove('editor-app-active');
  }, [stage, showingResult, info]);

  // Derived page data lives above the early return below: hooks must run in the
  // same order on every render, including after "continue editing" comes back
  // from the result panel.
  const objectsByPage = usePageBuckets(editor.doc.objects);
  const widgetsByPage = usePageBuckets<FormWidgetInfo>(info?.fields ?? NO_WIDGETS);
  const selectedObject = editor.doc.objects.find((object) => object.id === selectedId) ?? null;
  const selectedBlockLayout = selectedTextBlock
    ? layoutsByPage[selectedTextBlock.pageIndex] ?? null
    : null;
  const selectedBlockModel = selectedTextBlock
    ? selectedBlockLayout?.blocks.find((block) => block.id === selectedTextBlock.blockId) ?? null
    : null;
  const selectedBlockParagraphs = selectedBlockModel
    ? selectedBlockModel.paragraphIds
        .map((id) => selectedBlockLayout?.paragraphs.find((paragraph) => paragraph.id === id))
        .filter((paragraph): paragraph is Paragraph => Boolean(paragraph))
    : NO_PARAGRAPHS;
  const selectedBlockPreview = selectedBlockParagraphs
    .slice(0, 4)
    .map((paragraph) => paragraphDisplayText(paragraph))
    .join(' ')
    .slice(0, 220);

  // The phone sheet follows the selection instead of pinning itself to the
  // canvas. It also retires on a workspace change, so no stale panel survives
  // a mode switch.
  useEffect(() => {
    if (!selectedObject && !selectedBlockModel && !isRedact) {
      setMobileInspectorOpen(false);
    }
  }, [selectedObject, selectedBlockModel, isRedact]);
  useEffect(() => {
    setMobileInspectorOpen(false);
  }, [mode]);
  const selectedBlockCapability = selectedTextBlock
    ? capabilitiesByPage[selectedTextBlock.pageIndex] ?? null
    : null;
  const selectedBlockEditStatus = selectedBlockCapability
    ? selectedBlockCapability.likelyScanned
      ? 'Manual review: image-only page has no text layer'
      : selectedBlockCapability.textLayer === 'ocr'
        ? 'Native edit: invisible OCR text layer (render mode preserved)'
        : selectedBlockCapability.textLayer === 'mixed'
          ? 'Native edit: mixed visible/invisible text layer'
          : 'Native edit: document text objects and fonts'
    : 'Inspecting fonts and page objects…';

  // Page-bound callbacks, stable per page: an inline arrow would change identity
  // on every parent render and defeat the memoized pages entirely.
  const pageBindings = useMemo(() => {
    const map = new Map<number, PageBinding>();
    for (const page of info?.pages ?? []) {
      map.set(page.index, {
        onSeedReplace: (run: TextRun) => seedReplace(page.index, run),
        onTextBlockSelect: (blockId: string | null) => selectTextBlock(page.index, blockId),
        onParagraphEdit: (
          paragraphId: string,
          selection: { start: number; end: number } | null,
        ) => startParagraphEdit(page.index, paragraphId, selection),
        onTextSelectionChange: changeTextSelection,
        onImageRequested: (point: { x: number; y: number }) => onImageRequested(page.index, point),
        onSignatureRequested: (point: { x: number; y: number }) =>
          onSignatureRequested(page.index, point),
        onVisible: () => {
          void ensureRaster(page.index);
          // Layouts are needed before the first click, so fetch this page's
          // text model when it approaches the viewport rather than eagerly
          // parsing a 500-page book.
          if (toolRef.current === 'select' || toolRef.current === 'text') {
            void ensureRunsRef.current([page.index]);
          }
        },
        onHidden: () => releaseDistantRasters(page.index),
      });
    }
    return map;
  }, [
    info,
    seedReplace,
    selectTextBlock,
    startParagraphEdit,
    changeTextSelection,
    onImageRequested,
    onSignatureRequested,
    ensureRaster,
    releaseDistantRasters,
  ]);

  const railItems = useMemo(
    () =>
      displayPages.map((page, position) => ({
        pageIndex: page.index,
        position,
        displayNumber: position + 1,
        width: page.displayWidthPt ?? page.widthPt,
        height: page.displayHeightPt ?? page.heightPt,
        url: rasters[page.index]?.url ?? null,
      })),
    [displayPages, rasters],
  );

  const aiSelection = useMemo(
    () =>
      textSelection?.text.trim()
        ? {
            label: `page ${currentPage + 1}, ${textSelection.text.length.toLocaleString()} characters`,
            text: textSelection.text,
          }
        : selectedTextBlock && selectedBlockPreview
          ? { label: 'selected text block', text: selectedBlockPreview }
          : selectedObject?.kind === 'text' && selectedObject.text.trim()
            ? { label: 'selected text box', text: selectedObject.text }
            : null,
    [currentPage, selectedBlockPreview, selectedObject, selectedTextBlock, textSelection],
  );

  if (aiResult) {
    return (
      <AiExport
        fileName={aiResult.name}
        pageCount={aiResultPages ?? info?.pageCount ?? 0}
        sizeBytes={aiResult.data.byteLength}
        onDownload={() => downloadBytes(aiResult.data, aiResult.name)}
        onReset={resetAll}
        footerNote="Applied through the editing engine. Rewritten text was replaced in the document's own runs where possible; overlays were drawn only where a rewrite could not be verified. The result was re-parsed before this download was enabled."
      />
    );
  }

  if (redactState.status === 'done') {
    const { result } = redactState;
    const marked = result.report.pages.reduce(
      (total, page) => total + page.markedPixels,
      0,
    );
    return (
      <ResultPanel
        fileName={result.name}
        pageCount={result.pageCount}
        sizeBytes={result.data.byteLength}
        onDownload={() => downloadBytes(result.data, result.name)}
        onReset={resetAll}
        footerNote={`Verified: the output was reopened and checked; no text layer, annotations, attachments or metadata remain, and every page is a single image. ${marked.toLocaleString()} pixels were destroyed.`}
      />
    );
  }

  if (organizeState.status === 'done') {
    const { result } = organizeState;
    return (
      <ResultPanel
        fileName={result.fileName}
        pageCount={result.pageCount}
        sizeBytes={result.data.byteLength}
        onDownload={() => downloadBytes(result.data, result.fileName)}
        onReset={resetAll}
        footerNote="Pages were rebuilt in the order shown and the output was re-parsed before this download was enabled."
      />
    );
  }

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
            {isSign && ' The audit note is a local record: it never certifies identity, and it'
              + ' is not our server acknowledging anything.'}
          </>
        }
      >
        <div className="space-y-3">
          {(totalEdits(result.report) > 0 || result.report.warnings.length > 0) && (
            <ExportReceipt
              fileName={result.name}
              pageCount={result.pageCount}
              sizeBytes={result.data.byteLength}
              report={result.report}
            />
          )}
          {isSign && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="download-audit-note"
                disabled={!auditNote}
                onClick={() => {
                  if (!auditNote) return;
                  downloadBlob(
                    new Blob([auditNote.json], { type: 'application/json' }),
                    auditNote.fileName,
                  );
                }}
              >
                {auditNote ? 'Download audit note (JSON)' : 'Audit note unavailable'}
              </Button>
              {auditNoteError && (
                <span className="text-xs text-muted-foreground" data-testid="audit-note-error">
                  {auditNoteError}
                </span>
              )}
            </div>
          )}
        </div>
      </ResultPanel>
    );
  }

  const hasEdits =
    objectCount > 0 ||
    Object.keys(editor.doc.formValues).length > 0 ||
    (isOrganize && pageOrderDirty) ||
    (isRedact && redactMarks.length > 0);
  const dirty = editorIsDirty({
    doc: editor.doc,
    saved: savedDocRef.current,
    paragraphEditActive: paragraphEdit !== null,
    pageOrderDirty: isOrganize && pageOrderDirty,
    redactMarkCount: isRedact ? redactMarks.length : 0,
  });
  const assistantActive = mode === 'ai' || tool === 'ai';
  const pageCount = displayPages.length || info?.pageCount || 0;
  const saveLabel = isOrganize
    ? `Save ${pageOrder.length} page${pageOrder.length === 1 ? '' : 's'}`
    : isRedact
      ? 'Redact & rebuild'
      : isSign
        ? 'Sign & export'
        : isAi
          ? 'Save edits'
          : 'Save changes';
  const saveProgress = isRedact
    ? redactState.status === 'running'
      ? redactState.progress
      : null
    : isOrganize
      ? organizeState.status === 'running'
        ? organizeState.progress
        : null
      : editState.status === 'running'
        ? editState.progress
        : null;
  const cancelSave = isRedact
    ? redactRunner.cancel
    : isOrganize
      ? organizeRunner.cancel
      : editRunner.cancel;

  /**
   * Phone navigation maps four thumb-sized destinations onto the same
   * workspaces the desktop tab strip owns. "Annotate" opens Edit with the
   * highlighter already armed, so no second editing model exists.
   */
  const handleMobileTab = (tab: EditorMobileTab) => {
    if (saving) return;
    switch (tab) {
      case 'edit':
        if (mode !== 'edit') changeMode('edit');
        setTool('select');
        break;
      case 'annotate':
        if (mode !== 'edit' && mode !== 'sign') changeMode('edit');
        setTool('highlight');
        break;
      case 'pages':
        if (mode !== 'organize') changeMode('organize');
        break;
      case 'ai':
        if (mode === 'sign') setTool('ai');
        else if (mode !== 'ai') changeMode('ai');
        break;
      case 'sign':
        if (mode !== 'sign') changeMode('sign');
        else setTool('signature');
        break;
      case 'redact':
        if (mode !== 'redact') changeMode('redact');
        break;
    }
  };

  /** Close the document; unsaved work gets an explicit, reversible gate. */
  const requestExit = () => {
    if (dirty || aiChangeCount > 0) {
      setConfirmExit(true);
      return;
    }
    resetAll();
  };
  const selectionLabel = selectedObject
    ? isRedact && selectedObject.kind === 'rect'
      ? 'Redaction mark selected'
      : `${selectedObject.kind[0]!.toUpperCase()}${selectedObject.kind.slice(1)} selected`
    : textSelection
      ? `${textSelection.text.length.toLocaleString()} characters selected`
      : isOrganize && selectedPages.size > 0
        ? `${selectedPages.size} page${selectedPages.size === 1 ? '' : 's'} selected`
        : null;
  const pageCapability = capabilitiesByPage[currentPage] ?? null;
  const pageEditStatus = pageCapability
    ? pageCapability.likelyScanned
      ? 'Image-only page. Text can be marked, but there is no text layer to rewrite.'
      : pageCapability.textLayer === 'ocr'
        ? 'Invisible OCR text layer. Native edits preserve the render mode.'
        : pageCapability.textLayer === 'mixed'
          ? 'Mixed visible and invisible text layer. Native edits are available.'
          : 'Document text objects and fonts. Edits are rewritten in place where possible.'
    : 'Inspecting fonts and page objects.';
  const currentMetaPage = displayPages[currentDisplayPosition];
  const toolHint = isRedact
    ? 'Marks are destructive'
    : isOrganize
      ? 'Drag pages to reorder'
      : assistantActive
        ? 'Review before applying'
        : 'Ready';
  const handleDelete = () => {
    if (textSelection) {
      deleteTextSelection();
      return;
    }
    if (selectedId) {
      deleteSelected();
      return;
    }
    if (isOrganize && selectedPages.size > 0) deletePages([...selectedPages]);
  };

  const editorView =
    stage === 'editing' && info ? (
      <div className="editor-route-shell" data-testid="editor-route-shell">
        <div className="editor-shell" data-testid="editor" aria-busy={saving} data-mode={mode}>
          <EditorTopBar
            fileName={files[0]?.name ?? 'Document'}
            mode={mode}
            pageCount={pageCount}
            dirty={dirty || aiChangeCount > 0}
            saving={saving}
            saveLabel={saveLabel}
            showSave={!isAi || hasEdits}
            onSave={() => void onSave()}
            onChangeFile={() => pdfInputRef.current?.click()}
            onReset={resetAll}
            onBack={requestExit}
            modes={
              initialMode === 'sign'
                ? undefined
                : [
                    { id: 'edit', label: 'Edit' },
                    { id: 'ai', label: 'Assistant' },
                    { id: 'redact', label: 'Redact' },
                    { id: 'organize', label: 'Pages' },
                  ]
            }
            {...(initialMode === 'sign' ? {} : { onModeChange: changeMode })}
          />

          {isSign && (
            <div className="editor-signer-strip" data-testid="signer-strip">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="whitespace-nowrap">
                  Signer name <span className="text-muted-foreground/70">(optional)</span>
                </span>
                <input
                  type="text"
                  value={signerLabel}
                  maxLength={SIGNATURE_LABEL_MAX_CHARS}
                  onChange={(event) => setSignerLabel(event.target.value)}
                  data-testid="signer-label-input"
                  className="h-7 w-48 rounded-md border bg-background px-2.5 text-sm text-foreground shadow-xs outline-none transition-shadow focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
              <span className="hidden text-[11px] text-muted-foreground md:inline">
                Recorded in the local audit note; it does not certify identity.
              </span>
            </div>
          )}

          <div className="editor-body">
            <EditorToolRail
              mode={mode}
              tool={tool}
              onToolChange={setTool}
              disabled={saving}
              railOpen={editor.railOpen}
              onToggleRail={editor.toggleRail}
            />

            <div className="editor-main">
              <EditorContextBar
                mode={mode}
                tool={tool}
                selectedObject={selectedObject}
                hasSelection={
                  selectedObject !== null ||
                  textSelection !== null ||
                  (isOrganize && selectedPages.size > 0)
                }
                canUndo={editor.canUndo}
                canRedo={editor.canRedo}
                canReorder={canReorder}
                canSendBack={canSendBack}
                onPatch={patchObject}
                onUndo={undo}
                onRedo={redo}
                onDelete={handleDelete}
                onReorder={(direction) => transformSelected(direction)}
                onDuplicate={() => {
                  if (isOrganize && selectedPages.size > 0) {
                    duplicatePage([...selectedPages][0]!);
                    return;
                  }
                  transformSelected('duplicate');
                }}
                zoom={zoom}
                onZoomChange={onZoomChange}
                onZoomIn={() => {
                  const next = editorStepZoom(zoom, 'in');
                  if (next !== null) onZoomChange(next);
                }}
                onZoomOut={() => {
                  const next = editorStepZoom(zoom, 'out');
                  if (next !== null) onZoomChange(next);
                }}
                onFitWidth={fitWidth}
                onOpenInspector={() => setMobileInspectorOpen((open) => !open)}
                inspectorOpen={mobileInspectorOpen}
                disabled={saving}
                redactCount={redactMarks.length}
                onRedactReview={() => setConfirmRedact(true)}
                pageCount={pageOrder.length}
                orderDirty={pageOrderDirty}
                onRestoreOrder={() => {
                  if (!info) return;
                  editor.resetPageOrder(info.pageCount);
                }}
                aiChangeCount={aiChangeCount}
                onOpenAssistant={() => setTool('ai')}
              />

              <div
                className="editor-workspace"
                data-rail={editor.railOpen ? 'open' : 'closed'}
                data-inspector={mobileInspectorOpen ? 'open' : 'closed'}
                data-panel={
                  assistantActive
                    ? 'ai'
                    : isRedact
                      ? 'redact'
                      : isOrganize
                        ? 'pages'
                        : 'properties'
                }
              >
                <EditorPageRail
                  open={editor.railOpen}
                  mode={mode}
                  items={railItems}
                  currentPage={currentPage}
                  onSelect={goToPage}
                  selected={selectedPages}
                  onToggleSelected={togglePageSelected}
                  {...(isOrganize
                    ? {
                        onDelete: deletePages,
                        onDuplicate: duplicatePage,
                        onReorder: reorderPages,
                      }
                    : {})}
                  changedPages={aiChangedPages}
                  saving={saving}
                />

                <div
                  ref={scrollRef}
                  className="editor-canvas"
                  data-testid="editor-scroll"
                  tabIndex={0}
                  aria-label="PDF document canvas"
                  onScroll={syncCurrentPage}
                >
                  {displayPages.map((page, position) => {
                    const widgets = widgetsByPage.get(page.index) ?? NO_WIDGETS;
                    const binding = pageBindings.get(page.index);
                    if (!binding) return null;
                    return (
                      <EditorPage
                        key={`${page.index}:${position}`}
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
                        layout={layoutsByPage[page.index] ?? null}
                        textSelection={
                          textSelection?.pageIndex === page.index ? textSelection : null
                        }
                        selectedTextBlockId={
                          selectedTextBlock?.pageIndex === page.index
                            ? selectedTextBlock.blockId
                            : null
                        }
                        paragraphEdit={
                          paragraphEdit?.pageIndex === page.index ? paragraphEdit : null
                        }
                        widgets={widgets}
                        formValues={widgets.length > 0 ? editor.doc.formValues : NO_FORM_VALUES}
                        readOnly={saving}
                        proposals={aiMarkers}
                        redactMode={isRedact}
                        active={page.index === currentPage}
                        onSelect={select}
                        onStartEdit={startEdit}
                        onEndEdit={endEdit}
                        onEditText={editText}
                        onAutoHeight={autoHeight}
                        onCreate={createObject}
                        onSeedReplace={binding.onSeedReplace}
                        onTextBlockSelect={binding.onTextBlockSelect}
                        onParagraphEdit={binding.onParagraphEdit}
                        onTextSelectionChange={binding.onTextSelectionChange}
                        onParagraphTextInput={handleParagraphTextInput}
                        onParagraphCommit={commitParagraphEdit}
                        onParagraphCancel={cancelParagraphEdit}
                        onImageRequested={binding.onImageRequested}
                        onSignatureRequested={binding.onSignatureRequested}
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
                  {displayPages.length === 0 ? (
                    <p className="editor-canvas-empty" role="status">
                      No pages remain. Restore the order or open another file.
                    </p>
                  ) : null}
                </div>

                {/*
                  Phone HUD: page navigation and zoom stay on the canvas instead
                  of taking a permanent row of their own. Large enough for a
                  thumb, translucent enough that the sheet below stays legible.
                */}
                <div className="editor-mobile-hud" data-testid="editor-mobile-hud">
                  <div className="editor-mobile-hud-group" aria-label="Page navigation">
                    <button
                      type="button"
                      className="editor-mobile-hud-btn"
                      aria-label="Previous page"
                      data-testid="mobile-prev-page"
                      disabled={currentDisplayPosition <= 0}
                      onClick={() => goToDisplayPage(currentDisplayPosition - 1)}
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <span className="editor-mobile-hud-readout" data-testid="mobile-page-status">
                      {Math.min(currentDisplayPosition + 1, pageCount || 1)}
                      <span className="text-muted-foreground/70"> / </span>
                      {pageCount}
                    </span>
                    <button
                      type="button"
                      className="editor-mobile-hud-btn"
                      aria-label="Next page"
                      data-testid="mobile-next-page"
                      disabled={currentDisplayPosition >= pageCount - 1}
                      onClick={() => goToDisplayPage(currentDisplayPosition + 1)}
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                  <span className="editor-mobile-hud-sep" aria-hidden />
                  <div className="editor-mobile-hud-group" aria-label="Zoom">
                    <button
                      type="button"
                      className="editor-mobile-hud-btn"
                      aria-label="Zoom out"
                      data-testid="mobile-zoom-out"
                      onClick={() => {
                        const next = editorStepZoom(zoom, 'out');
                        if (next !== null) onZoomChange(next);
                      }}
                    >
                      <ZoomOut className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="editor-mobile-hud-readout editor-mobile-hud-fit"
                      aria-label={`${Math.round(zoom * 100)}% — fit page width`}
                      title="Fit page width"
                      data-testid="mobile-zoom-level"
                      onClick={fitWidth}
                    >
                      {Math.round(zoom * 100)}%
                    </button>
                    <button
                      type="button"
                      className="editor-mobile-hud-btn"
                      aria-label="Zoom in"
                      data-testid="mobile-zoom-in"
                      onClick={() => {
                        const next = editorStepZoom(zoom, 'in');
                        if (next !== null) onZoomChange(next);
                      }}
                    >
                      <ZoomIn className="size-4" />
                    </button>
                  </div>
                </div>

                <aside
                  className="editor-inspector-rail"
                  data-empty={!selectedObject && !assistantActive && !isRedact && !isOrganize}
                  aria-label="Properties inspector"
                >
                  <div className="h-full min-h-0" hidden={!assistantActive}>
                    {aiMounted && files[0] ? (
                      <EditorAiPanel
                        file={files[0]}
                        pageCount={pageCount}
                        currentPage={currentPage}
                        onShowPage={goToPage}
                        onProposalsChange={onAiProposals}
                        onApplyResult={onAiApplyResult}
                        selection={aiSelection}
                        disabled={saving}
                      />
                    ) : null}
                  </div>

                  {!assistantActive && saving ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                      <Loader2 className="size-4 animate-spin text-primary" />
                      <p className="text-sm font-medium">Saving changes</p>
                      <p className="max-w-[15rem] text-xs leading-relaxed text-muted-foreground">
                        Editing resumes when the verified copy is ready.
                      </p>
                    </div>
                  ) : !assistantActive && isRedact ? (
                    <div className="editor-panel" data-testid="editor-redact-inspector">
                      <p className="editor-panel-kicker">Redaction</p>
                      <p className="editor-panel-title">
                        {redactMarks.length} area{redactMarks.length === 1 ? '' : 's'} marked
                      </p>
                      <p className="editor-panel-copy">
                        Marks are permanent and destructive. Redaction rebuilds every page as an
                        image, so text selection, search, links, form fields, accessibility and
                        vector quality are lost. The original text is not covered; it is not in the
                        file.
                      </p>
                      {selectedObject?.kind === 'rect' ? (
                        <>
                          <dl className="editor-panel-facts">
                            <div>
                              <dt>Page</dt>
                              <dd>{selectedObject.pageIndex + 1}</dd>
                            </div>
                            <div>
                              <dt>Position</dt>
                              <dd>
                                {Math.round(selectedObject.x)}, {Math.round(selectedObject.y)} pt
                              </dd>
                            </div>
                            <div>
                              <dt>Size</dt>
                              <dd>
                                {Math.round(selectedObject.width)} x{' '}
                                {Math.round(selectedObject.height)} pt
                              </dd>
                            </div>
                          </dl>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-2"
                            onClick={deleteSelected}
                          >
                            Remove this mark
                          </Button>
                        </>
                      ) : null}
                      <div className="mt-3 flex flex-col gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid="redact-ai-find"
                          disabled={saving || findingSensitive}
                          onClick={() => void findSensitive()}
                        >
                          {findingSensitive ? (
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="mr-1.5 size-3.5" />
                          )}
                          {findingSensitive ? 'Finding sensitive data' : 'Find sensitive data with AI'}
                        </Button>
                        <Popover open={redactAiOpen} onOpenChange={setRedactAiOpen}>
                          <PopoverTrigger asChild>
                            <Button type="button" variant="ghost" size="sm">
                              <Settings2 className="mr-1.5 size-3.5" /> AI settings
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="end"
                            className="studio-settings-pop w-[min(27rem,calc(100vw-2rem))] p-0"
                          >
                            <AiSettingsCard
                              settings={redactAiSettings}
                              mode={effectiveRedactAiMode}
                              onModeChange={(next) => {
                                setRedactAiMode(next);
                                saveAiMode(next);
                              }}
                              managedAvailable={redactAiManaged}
                              onSave={(next) => {
                                setRedactAiSettings(saveAiSettings(next));
                                setRedactAiOpen(false);
                              }}
                              surface="plain"
                            />
                          </PopoverContent>
                        </Popover>
                        {sensitiveError ? (
                          <p className="text-xs leading-relaxed text-destructive">{sensitiveError}</p>
                        ) : null}
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={redactMarks.length === 0 || saving}
                          onClick={() => setConfirmRedact(true)}
                        >
                          Review and redact
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={redactMarks.length === 0 || saving}
                          onClick={() =>
                            editor.apply((doc) => ({
                              ...doc,
                              objects: doc.objects.filter((object) => object.kind !== 'rect'),
                            }))
                          }
                        >
                          Clear all marks
                        </Button>
                      </div>
                    </div>
                  ) : !assistantActive && isOrganize ? (
                    <div className="editor-panel" data-testid="editor-pages-inspector">
                      <p className="editor-panel-kicker">Page organisation</p>
                      <p className="editor-panel-title">
                        {pageOrder.length} page{pageOrder.length === 1 ? '' : 's'}
                      </p>
                      <p className="editor-panel-copy">
                        Drag a page in the rail to change its position. Selection works with
                        Ctrl/Cmd-click. Duplicated pages point at the same source page; the output
                        is rebuilt from the order you see.
                      </p>
                      {objectCount > 0 ? (
                        <>
                          <p className="editor-panel-note">
                            {objectCount} pending edit{objectCount === 1 ? '' : 's'} will not be part
                            of this page-only export. Save them in the Edit workspace first.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-2"
                            onClick={() => changeMode('edit')}
                          >
                            Go to Edit
                          </Button>
                        </>
                      ) : null}
                      <div className="mt-3 flex flex-col gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!pageOrderDirty || saving}
                          onClick={() => editor.resetPageOrder(info.pageCount)}
                        >
                          Restore original order
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={selectedPages.size === 0 || saving}
                          onClick={() => deletePages([...selectedPages])}
                        >
                          Delete selected
                        </Button>
                      </div>
                    </div>
                  ) : !assistantActive && selectedObject ? (
                    <AnimatedContent
                      key={`inspector-${selectedObject.id}`}
                      className="h-full"
                      distance={6}
                      direction="horizontal"
                      duration={UI.fast}
                      trigger="mount"
                    >
                      <EditorInspector
                        object={selectedObject}
                        onPatch={patchObject}
                        onDelete={deleteSelected}
                        onClose={() => select(null)}
                        docked
                      />
                    </AnimatedContent>
                  ) : !assistantActive && selectedBlockModel ? (
                    <div
                      className="flex h-full flex-col gap-3 overflow-auto px-4 py-4"
                      data-testid="editor-text-inspector"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Text block</p>
                        <p className="text-xs capitalize text-muted-foreground">
                          {selectedBlockModel.kind} · {selectedBlockParagraphs.length} paragraph
                          {selectedBlockParagraphs.length === 1 ? '' : 's'}
                        </p>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {selectedBlockEditStatus}
                        </p>
                      </div>
                      {selectedBlockPreview && (
                        <p className="line-clamp-5 text-xs leading-relaxed text-muted-foreground">
                          {selectedBlockPreview}
                        </p>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        data-testid="editor-edit-block-text"
                        disabled={selectedBlockParagraphs.length === 0}
                        onClick={() => {
                          const first = selectedBlockParagraphs[0];
                          if (!first || !selectedTextBlock) return;
                          startParagraphEdit(selectedTextBlock.pageIndex, first.id, null);
                        }}
                      >
                        Edit text
                      </Button>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Double-click a paragraph to edit it. Drag across text to select and copy.
                      </p>
                    </div>
                  ) : !assistantActive ? (
                    <div className="editor-panel" data-testid="editor-inspector-empty">
                      <p className="editor-panel-kicker">Document</p>
                      <p className="editor-panel-title">
                        {currentMetaPage
                          ? `Page ${currentDisplayPosition + 1} of ${pageCount}`
                          : 'No page selected'}
                      </p>
                      <p className="editor-panel-copy">{pageEditStatus}</p>

                      <div className="editor-panel-actions">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setTool('text')}
                        >
                          <TypeIcon /> Add text
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setTool('ai')}
                        >
                          <Sparkles className="size-3.5" /> Edit with AI
                        </Button>
                      </div>

                      <dl className="editor-panel-facts">
                        <div>
                          <dt>Page size</dt>
                          <dd>
                            {currentMetaPage
                              ? `${Math.round(currentMetaPage.displayWidthPt ?? currentMetaPage.widthPt)} x ${Math.round(
                                  currentMetaPage.displayHeightPt ?? currentMetaPage.heightPt,
                                )} pt`
                              : 'Unknown'}
                          </dd>
                        </div>
                        <div>
                          <dt>Objects</dt>
                          <dd>{objectCount.toLocaleString()}</dd>
                        </div>
                        <div>
                          <dt>Zoom</dt>
                          <dd>{Math.round(zoom * 100)}%</dd>
                        </div>
                        {info.fields.length > 0 ? (
                          <div>
                            <dt>Form fields</dt>
                            <dd>{info.fields.length.toLocaleString()}</dd>
                          </div>
                        ) : null}
                      </dl>

                      <StructurePanel
                        layout={
                          currentMetaPage ? layoutsByPage[currentMetaPage.index] ?? null : null
                        }
                        pageNumber={currentDisplayPosition + 1}
                        onRequestStructure={
                          currentMetaPage
                            ? () => void ensureRunsRef.current([currentMetaPage.index])
                            : undefined
                        }
                        onShowLimits={() => setLimitsOpen(true)}
                      />

                      <div className="editor-panel-keys">
                        <p className="editor-panel-kicker">Keyboard</p>
                        <ul>
                          <li>
                            <kbd>V</kbd> Select <kbd>T</kbd> Text <kbd>H</kbd> Highlight
                          </li>
                          <li>
                            <kbd>Ctrl</kbd> <kbd>Z</kbd> Undo <kbd>Ctrl</kbd> <kbd>Shift</kbd>{' '}
                            <kbd>Z</kbd> Redo
                          </li>
                          <li>
                            <kbd>Del</kbd> Remove selection <kbd>Ctrl</kbd> <kbd>D</kbd> Duplicate
                          </li>
                          <li>
                            <kbd>Ctrl</kbd> <kbd>0</kbd> Fit width <kbd>+</kbd> <kbd>-</kbd> Zoom
                          </li>
                        </ul>
                      </div>

                      {/*
                        The measured text-model limits (PLAN.md 29.6 / 30.10).
                        Collapsed by default: a user who is mid-edit should not
                        read a disclaimer first, but a user whose paragraph
                        behaved strangely needs somewhere to find out why. The
                        scanned/OCR boundary is already stated in the status
                        line above; it is repeated here so this one list is
                        complete on its own.
                      */}
                      <details
                        className="editor-panel-limits mt-4"
                        data-testid="editor-limits"
                        open={limitsOpen}
                        onToggle={(event) => setLimitsOpen(event.currentTarget.open)}
                      >
                        <summary className="cursor-pointer text-xs font-medium text-foreground">
                          What this editor does not do yet
                        </summary>
                        <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
                          {TEXT_MODEL_LIMITS.map((limit) => (
                            <li key={limit.id}>{limit.text}</li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  ) : null}
                </aside>
              </div>
            </div>
          </div>

          <EditorMobileNav
            mode={mode}
            tool={tool}
            disabled={saving}
            onSelect={handleMobileTab}
          />

          <EditorStatusBar
            fileName={files[0]?.name ?? 'Document'}
            mode={mode}
            pageCount={pageCount}
            currentPage={currentDisplayPosition}
            zoom={zoom}
            dirty={dirty}
            hasEdits={hasEdits}
            saving={saving}
            progressLabel={saveProgress?.phase}
            progressRatio={saveProgress?.ratio}
            onCancelSave={cancelSave}
            onPrevPage={() => goToDisplayPage(currentDisplayPosition - 1)}
            onNextPage={() => goToDisplayPage(currentDisplayPosition + 1)}
            selectionLabel={selectionLabel}
            toolHint={toolHint}
            objectCount={objectCount}
          />

          {confirmRedact ? (
            <div
              className="editor-confirm-layer"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setConfirmRedact(false);
                }
              }}
            >
              <div
                className="editor-confirm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="editor-confirm-title"
              >
                <span className="editor-confirm-glyph" aria-hidden>
                  <ShieldAlert className="size-4" />
                </span>
                <h2 id="editor-confirm-title" className="editor-confirm-title">
                  Destroy {redactMarks.length} area{redactMarks.length === 1 ? '' : 's'} and rebuild{' '}
                  {pageCount} page{pageCount === 1 ? '' : 's'}?
                </h2>
                <p className="editor-confirm-copy">
                  This cannot be undone. Text selection, search, links, form fields, accessibility
                  and vector quality will not survive. Documents over the page limit are refused
                  rather than partially processed.
                </p>
                <div className="editor-confirm-actions">
                  <Button
                    variant="destructive"
                    size="sm"
                    data-testid="redact-confirm"
                    autoFocus
                    onClick={() => void runRedact()}
                  >
                    <ShieldAlert className="mr-1.5 size-3.5" /> Redact and rebuild
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmRedact(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {confirmExit ? (
            <div
              className="editor-confirm-layer"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setConfirmExit(false);
                }
              }}
            >
              <div
                className="editor-confirm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="editor-exit-title"
              >
                <span className="editor-confirm-glyph" aria-hidden>
                  <ChevronLeft className="size-4" />
                </span>
                <h2 id="editor-exit-title" className="editor-confirm-title">
                  Close this document?
                </h2>
                <p className="editor-confirm-copy">
                  You have unsaved changes. Closing now discards them and returns to the file
                  picker; saving first keeps the verified copy.
                </p>
                <div className="editor-confirm-actions">
                  <Button variant="ghost" size="sm" autoFocus onClick={() => setConfirmExit(false)}>
                    Keep editing
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    data-testid="editor-confirm-exit"
                    onClick={() => {
                      setConfirmExit(false);
                      resetAll();
                    }}
                  >
                    Discard and close
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <input
            ref={pdfInputRef}
            type="file"
            accept={PDF_ACCEPT}
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(event) => {
              const picked = event.target.files?.[0];
              event.target.value = '';
              if (picked) void handleFiles([picked]);
            }}
          />

          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(event) => void onImageFile(event)}
          />

          {signatureDialogOpen && (
            <Suspense fallback={null}>
              <SignaturePadDialog
                open
                onOpenChange={setSignatureDialogOpen}
                mode="insert"
                onUse={(capture) => void onSignatureChosen(capture)}
              />
            </Suspense>
          )}
        </div>
      </div>
    ) : null;

  return (
    <>
      {stage !== 'editing' && (
        mode === 'ai' ? (
          <div className="studio editor-ai-cover-shell" data-testid="editor-ai-cover">
            <div className="studio-cover-wrap">
              <AiCover
                title={AI_EDIT_COPY.title}
                lead={AI_EDIT_COPY.lead}
                quote={AI_EDIT_COPY.quote}
                marginTitle={AI_EDIT_COPY.marginTitle}
                marks={AI_EDIT_COPY.marks}
                onFiles={(next) => void handleFiles(next)}
                note={AI_EDIT_COPY.note}
              />
              {stage === 'idle' && !redactAiUsable ? (
                <AiSetupSection
                  settings={redactAiSettings}
                  mode={effectiveRedactAiMode}
                  managedAvailable={redactAiManaged}
                  onSave={saveCoverAiSettings}
                  onModeChange={changeCoverAiMode}
                  {...(storedKeyPresent(redactAiSettings) ? { onForget: forgetCoverAiKey } : {})}
                />
              ) : null}
            </div>
            {stage === 'preparing' && inspectState.status === 'running' && (
              <div className="mt-4">
                <JobProgressPanel progress={inspectState.progress} onCancel={inspectRunner.cancel} />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <FileDropzone
              files={files}
              onFiles={(next) => void handleFiles(next)}
              disabled={stage === 'preparing'}
              hint={isSign ? 'one PDF to sign' : 'one PDF to edit'}
              multiple={false}
            />

            {stage === 'preparing' && inspectState.status === 'running' && (
              <JobProgressPanel progress={inspectState.progress} onCancel={inspectRunner.cancel} />
            )}
          </div>
        )
      )}

      {editorView ? createPortal(editorView, document.body) : null}
    </>
  );
}
