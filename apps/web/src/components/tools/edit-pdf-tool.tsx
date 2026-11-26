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
import { useBlocker, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  Loader2,
  Maximize2,
  Settings2,
  ShieldAlert,
  Sparkles,
  Type as TypeIcon,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  JobAbortedError,
  LIMITS,
  PageInteractionModel,
  TextEditSession,
  findInLayouts,
  rasterWidthWithinBudget,
  replaceMatches,
  timeoutForPageCount,
  ocrTimeoutForPageCount,
  type EditorObject,
  type EditTextNativePlan,
  type EditTextObject,
  type FormWidgetInfo,
  type InspectOutput,
  type OrganizeJobOutput,
  type OcrTextLayerJobOutput,
  type PageLayout,
  type PageRef,
  type PageTextCapability,
  type Paragraph,
  type RedactJobOutput,
  type SearchMatch,
  type TextEdit,
  type TextEditJobOutput,
  type TextEditOutcome,
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
import { EditorParagraphDetails } from '@/components/editor/editor-paragraph-details';
import { EditorFindPanel } from '@/components/editor/editor-find-panel';
import { EditorShortcutsDialog } from '@/components/editor/editor-shortcuts-dialog';
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
import { readAsInputFiles, readAsInputFilesOrToast, PDF_ACCEPT } from '@/lib/files';
import { useEditorSession } from '@/lib/editor-session';
import { editorIsDirty } from '@/lib/editor-dirty';
import type { EditorDoc } from '@/lib/editor-state';
import {
  defaultToolForMode,
  TOOL_HELP,
  toolsForMode,
  type EditorMode,
  type EditorProposalMarker,
} from '@/lib/editor-tools';
import {
  CAPABILITY_SNAPSHOT_NOTE,
  describePageEditStatus,
  describeParagraphEditStatus,
} from '@/lib/page-capability-copy';
import { matchEditorShortcut, type ShortcutContext } from '@/lib/editor-shortcuts';
import { clampToPage, offsetOnPage } from '@/lib/object-placement';
import { cloneObjectForPaste, detachEditIntent } from '@/lib/object-copy';
import { scaleInkPoints } from '@/lib/ink';
import {
  DEFAULT_STAMP_PRESET,
  type StampPreset,
} from '@/lib/stamp-presets';
import { clampZoom, fitZoom } from '@/lib/zoom';
import { jobPool } from '@/lib/job-pool';
import { UI } from '@/lib/motion';
import type { AiPlanApplyResult } from '@/lib/ai/edit-skill';
import {
  SIGNATURE_LABEL_MAX_CHARS,
  sanitizeSignatureLabel,
  scaledSignatureSize,
  type SignatureMethod,
} from '@/lib/signature-assets';
import {
  bodySelectionToDisplay,
  buildParagraphEditObjects,
  displayTextForBody,
  mutateParagraphText,
  offsetNativePlan,
  paragraphDisplayText,
  paragraphDisplayPrefix,
  paragraphEditKey,
  paragraphLineHeightRatio,
  paragraphStyleDiff,
  selectionFromAnchors,
  singleRunDeletion,
  type ParagraphEditRecord,
  type ParagraphEditState,
  type ParagraphTextMutation,
  type TextSelectionState,
} from '@/lib/text-editing';
import { recordRecent } from '@/tools/recent';
import { TEXT_MODEL_LIMITS } from '@/lib/text-model-limits';
import {
  DRAFT_DEBOUNCE_MS,

  DRAFT_SCHEMA,
  DRAFT_STORE_KEY,
  deleteDraft,
  draftSignature,
  loadDraft,
  saveDraft,
  type StoredDraft,
} from '@/lib/editor-draft';
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
  onParagraphFocus: (paragraphId: string | null) => void;
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
  /**
   * O-04: confidence for pages OCR'd in this session. The capability snapshot
   * proves a page has an invisible layer; only this map knows how confident the
   * recognizer was. It is deliberately session-local: a reload keeps the layer
   * and says the confidence was not recorded, rather than inventing one.
   */
  const [ocrProvenance, setOcrProvenance] = useState<
    Record<number, { confidence: number; wordCount: number; paragraphCount: number }>
  >({});
  const [textSelection, setTextSelection] = useState<TextSelectionState | null>(null);
  const [selectedTextBlock, setSelectedTextBlock] = useState<{
    pageIndex: number;
    blockId: string;
  } | null>(null);
  const [paragraphEdit, setParagraphEdit] = useState<ParagraphEditState | null>(null);
  /** Paragraph under the last click, for the detection-details drawer. */
  const [focusedParagraph, setFocusedParagraph] = useState<{
    pageIndex: number;
    paragraphId: string;
  } | null>(null);
  /** True while the inspector is showing per-paragraph detection details. */
  const [paragraphDetailsOpen, setParagraphDetailsOpen] = useState(false);
  /** Post-save outcome keyed by `pageIndex:paragraphId`. */
  const [lastOutcomes, setLastOutcomes] = useState<Record<string, TextEditOutcome>>({});
  /** Find & replace state. Layouts answer the query; no second parser. */
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findReplacement, setFindReplacement] = useState('');
  const [findCase, setFindCase] = useState(false);
  const [findWholeWord, setFindWholeWord] = useState(false);
  const [findMatches, setFindMatches] = useState<SearchMatch[]>([]);
  const [findActive, setFindActive] = useState(0);
  const [findSearching, setFindSearching] = useState(false);
  const [findFailedPages, setFindFailedPages] = useState<number[]>([]);
  const [findError, setFindError] = useState<string | null>(null);
  /** The newest autosaved draft, or the one the idle banner offers. */
  const [draft, setDraft] = useState<StoredDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftRestoring, setDraftRestoring] = useState(false);
  /** Redaction review confirmation: never run the destructive job without it. */
  const [confirmRedact, setConfirmRedact] = useState(false);
  /** Mobile back/close guard: leaving mid-edit must not silently drop changes. */
  const [leaveIntent, setLeaveIntent] = useState<
    'close' | 'change-file' | 'start-over' | { navigate: string } | { history: true } | null
  >(null);
  const navigate = useNavigate();
  /** Phone properties sheet. Closed by default so the canvas keeps its height. */
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  /** Keyboard reference generated from the one shortcut registry. */
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Desktop document panel; the empty inspector no longer occupies a column. */
  const [documentPanelOpen, setDocumentPanelOpen] = useState(false);
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
  const ocrLayerRunner = useJobRunner<OcrTextLayerJobOutput>('ocr-text-layer');

  const scrollRef = useRef<HTMLDivElement>(null);
  const pageScrollFrame = useRef<number | null>(null);
  const fileRef = useRef<File | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  /** E-09: pages from another PDF, appended without discarding edits. */
  const insertPagesInputRef = useRef<HTMLInputElement>(null);
  const [insertingPages, setInsertingPages] = useState(false);
  const infoRef = useRef<DocInfo | null>(null);
  const zoomRef = useRef(zoom);
  const toolRef = useRef(tool);
  const rastersRef = useRef(rasters);
  const zoomTouchedRef = useRef(false);
  /** Doc snapshot handed to the last save: the "unsaved changes" baseline. */
  const savedDocRef = useRef<typeof editor.doc | null>(null);
  /** O-02/E-09: the working source bytes changed (OCR text layer or inserted pages). */
  const [sourceDirty, setSourceDirty] = useState(false);
  const sourceDirtyRef = useRef(false);
  sourceDirtyRef.current = sourceDirty;
  /** X-03: verification refused only because an untouched page's text changed. */
  const [untouchedBlocked, setUntouchedBlocked] = useState<string | null>(null);
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
  /** Source bytes kept for draft autosave; cleared with the document. */
  const sourceBytesRef = useRef<Uint8Array | null>(null);
  /** Draft write serialisation, so two debounced writes cannot interleave. */
  const draftWriteSeq = useRef(0);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** A document over the cap stays too large for the session. */
  const draftDisabled = useRef(false);
  /** Search request generation; a stale query must not replace newer results. */
  const findSequence = useRef(0);
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
  const capabilitiesFetched = useRef(new Set<number>());
  const colorsFetched = useRef(new Set<number>());
  const runFailures = useRef(new Map<number, number>());
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImageRef = useRef<{ pageIndex: number; x: number; y: number } | null>(null);

  /* ------------------------------------------------ fill & sign (P6.1) */

  /** Where the signature insertion lands: set when the pad opens. */
  const pendingSignatureRef = useRef<{ pageIndex: number; x: number; y: number } | null>(null);
  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);
  /** Preset applied to the next stamp placed, chosen from the context bar. */
  const [stampPreset, setStampPreset] = useState<StampPreset>(DEFAULT_STAMP_PRESET);
  /** Debug overlay: outlines the detected text model. Never affects export. */
  const [showTextOutlines, setShowTextOutlines] = useState(false);
  /** D2 signer label: optional, sanitized at save time, never a secret. */
  const [signerLabel, setSignerLabel] = useState('');
  /** Render kind/method of the latest placed signature, for the audit note. */
  const lastSignatureMethodRef = useRef<SignatureMethod>('drawn');
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

  const ensureRuns = useCallback(
    async (
      indexes: number[],
      options: { capabilities?: boolean; colors?: boolean } = {},
    ): Promise<void> => {
      const file = fileRef.current;
      const generation = docGeneration.current;
      const wantCapabilities = options.capabilities ?? true;
      const wantColors = options.colors !== false;
      const wanted = indexes.filter((index) => {
        if (runsInflight.current.has(index)) return false;
        if (!runsFetched.current.has(index)) return true;
        if (wantColors && !colorsFetched.current.has(index)) return true;
        return wantCapabilities && !capabilitiesFetched.current.has(index);
      });
      if (!file || wanted.length === 0) return;
      for (const index of wanted) runsInflight.current.add(index);
      try {
        for (let offset = 0; offset < wanted.length; offset += RUN_PAGE_CHUNK) {
          const chunk = wanted.slice(offset, offset + RUN_PAGE_CHUNK);
          try {
          // Capability inspection is PDFium work. Find & replace asks for
          // layouts only, so a 40-page search does not pay for font and object
          // inspection it will never read.
          const includeCapabilities =
            wantCapabilities && chunk.some((page) => !capabilitiesFetched.current.has(page));
          const includeColors =
            wantColors && chunk.some((page) => !colorsFetched.current.has(page));
          const input = [{ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }];
          const result = await jobPool.run<TextRunsOutput>('text-runs', input, {
            pageIndexes: chunk,
            // One pdf.js pass produces both the legacy runs (click-to-replace
            // fallback) and the structured layout the text overlay uses.
            includeLayout: true,
            includeCapabilities,
            // C-11: one bounded render per page supplies the document's ink
            // colour, so a replacement starts from the real colour rather than
            // a near-black default. Find/replace opts out, and a page whose
            // colour is already known is not re-rendered for capabilities.
            includeColors,
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
              layoutsByPageRef.current = next;
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
              capabilitiesByPageRef.current = next;
              return next;
            });
          }
          for (const index of chunk) {
            runsFetched.current.add(index);
            runFailures.current.delete(index);
            if (wantColors) colorsFetched.current.add(index);
            if (result.capabilities) capabilitiesFetched.current.add(index);
          }
          } catch {
            // Only this chunk failed. The rest of the document must still load,
            // and a failed page stays retryable until the small budget is spent.
            if (generation !== docGeneration.current) return;
            for (const index of chunk) {
              const failures = (runFailures.current.get(index) ?? 0) + 1;
              runFailures.current.set(index, failures);
              if (failures >= 2) runsFetched.current.add(index);
            }
          }
        }
      } finally {
        for (const index of wanted) runsInflight.current.delete(index);
      }
    },
    [],
  );

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
    setOcrProvenance({});
    setTextSelection(null);
    setSelectedTextBlock(null);
    setParagraphEdit(null);
    paragraphEditRef.current = null;
    paragraphEditRef.current = null;
    setLastOutcomes({});
    setFocusedParagraph(null);
    setParagraphDetailsOpen(false);
    runsFetched.current.clear();
    runsInflight.current.clear();
    capabilitiesFetched.current.clear();
    colorsFetched.current.clear();
    runFailures.current.clear();
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
    sourceBytesRef.current = null;
    setStage('idle');
    setSelectedId(null);
    setEditingId(null);
    pendingImageRef.current = null;
    setTool('select');
    setZoom(1);
    setCurrentPage(0);
    zoomTouchedRef.current = false;
    savedDocRef.current = null;
    setSourceDirty(false);
    setUntouchedBlocked(null);
    pendingSignatureRef.current = null;
    setSignatureDialogOpen(false);
    setSignerLabel('');
    lastSignatureMethodRef.current = 'drawn';
    setAuditNote(null);
    setAuditNoteError(null);
    setConfirmRedact(false);
    setSelectedPages(new Set());
    setDocumentPanelOpen(false);
    setShortcutsOpen(false);
    setMobileInspectorOpen(false);
    setFindOpen(false);
    setFindMatches([]);
    setFindError(null);
    setFindFailedPages([]);
    if (draftTimer.current !== undefined) {
      clearTimeout(draftTimer.current);
      draftTimer.current = undefined;
    }
    void deleteDraft();
    draftWriteSeq.current += 1;
    draftDisabled.current = false;
    setDraft(null);
    setDraftError(null);
    setDraftSavedAt(null);
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
    ocrLayerRunner.reset();
  }, [
    editor.reset,
    editor.resetPageOrder,
    editor.setTool,
    mode,
    editRunner.reset,
    redactRunner.reset,
    organizeRunner.reset,
    inspectRunner.reset,
    ocrLayerRunner.reset,
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

  const handleFiles = async (incoming: File[], restore?: StoredDraft) => {
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
    if (!restore) {
      // Choosing a different file discards the previous document's draft; the
      // confirmed change-file sheet already told the user so.
      draftWriteSeq.current += 1;
      void deleteDraft();
    }
    setStage('preparing');
    // The read can reject (a file that turned unreadable between the picker
    // and the read); left unguarded it stranded stage='preparing' and kept the
    // dropzone disabled forever with no error.
    const input = await readAsInputFilesOrToast([file]);
    if (!input) {
      setStage('idle');
      return;
    }
    // Keep one copy of the source for draft autosave. The worker transfer
    // detaches `input` buffers, so this slice must happen before the run.
    const draftBytes = restore ? new Uint8Array(restore.bytes) : input[0]!.data.slice();
    const outcome = await inspectRunner.run(input);
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
    ocrLayerRunner.reset();
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
    setSourceDirty(false);
    setUntouchedBlocked(null);
    setFiles(incoming);
    fileRef.current = file;
    infoRef.current = doc;
    sourceBytesRef.current = draftBytes;
    draftDisabled.current = false;
    setInfo(doc);
    setStage('editing');
    setSelectedId(null);
    setEditingId(null);
    setDocumentPanelOpen(false);
    setShortcutsOpen(false);
    setMobileInspectorOpen(false);
    setCurrentPage(0);
    pendingImageRef.current = null;
    if (restore) {
      // Hydrate the autosaved session on top of the freshly inspected source.
      // `resetTo` installs the restored document as the baseline, so the first
      // Ctrl+Z cannot erase the draft and leave an empty editor.
      editor.resetTo(restore.doc);
      const validOrder =
        restore.pageOrder.length === doc.pageCount &&
        restore.pageOrder.every((index) => index >= 0 && index < doc.pageCount);
      if (validOrder) editor.setPageOrder(restore.pageOrder);
      const page = Math.min(
        Math.max(0, restore.currentPage),
        Math.max(0, doc.pageCount - 1),
      );
      setCurrentPage(page);
      zoomTouchedRef.current = true;
      setZoom(clampZoom(restore.zoom));
      setMode(restore.mode);
      setTool(restore.tool);
      setLastOutcomes({});
      savedDocRef.current = null;
      setDraft(restore);
      setDraftSavedAt(restore.updatedAt);
      setDraftError(null);
      setDraftRestoring(false);
    } else {
      setDraft(null);
      setDraftSavedAt(null);
      setDraftError(null);
      setDraftRestoring(false);
    }
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
      return fitZoom(
        { width: container.clientWidth, height: container.clientHeight, paddingX: padding },
        { width: widest, height: 1 },
        'width',
      );
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

  /**
   * Fit the whole page (width *and* height), which centres a landscape page
   * instead of letting its height overflow the viewport.
   */
  const fitPage = useCallback(() => {
    const container = scrollRef.current;
    const pages = infoRef.current?.pages;
    if (!container || !pages || pages.length === 0) return;
    // A hidden/zero-height viewport cannot fit a page; width fit is the sane
    // fallback instead of jumping to the minimum zoom.
    if (container.clientHeight <= 0) {
      fitWidth();
      return;
    }
    const styles = getComputedStyle(container);
    const paddingX =
      (Number.parseFloat(styles.paddingLeft) || 0) +
      (Number.parseFloat(styles.paddingRight) || 0);
    const paddingY =
      (Number.parseFloat(styles.paddingTop) || 0) +
      (Number.parseFloat(styles.paddingBottom) || 0);
    const widest = Math.max(
      1,
      ...pages.map((page) => page.displayWidthPt ?? page.widthPt),
    );
    const tallest = Math.max(
      1,
      ...pages.map((page) => page.displayHeightPt ?? page.heightPt),
    );
    zoomTouchedRef.current = true;
    setZoom(
      fitZoom(
        {
          width: container.clientWidth,
          height: container.clientHeight,
          paddingX,
          paddingY,
        },
        { width: widest, height: tallest },
        'page',
      ),
    );
  }, [fitWidth]);

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

  /** Display-space page box for placement clamps; safe before a page loads. */
  const pageBoxFor = useCallback((pageIndex: number) => {
    const page = infoRef.current?.pages.find((candidate) => candidate.index === pageIndex);
    return {
      width: page?.displayWidthPt ?? page?.widthPt ?? 612,
      height: page?.displayHeightPt ?? page?.heightPt ?? 792,
    };
  }, []);

  const createObjects = useCallback(
    (objects: EditorObject[]) => {
      if (objects.length === 0) return;
      if (objectCount + objects.length > LIMITS.tool.maxEditObjects) {
        toast.error(`This document already has ${LIMITS.tool.maxEditObjects.toLocaleString()} objects`);
        return;
      }
      editor.apply((doc) => ({ ...doc, objects: [...doc.objects, ...objects] }));
      const last = objects[objects.length - 1] ?? null;
      setSelectedId(last?.id ?? null);
      setTextSelection(null);
      setSelectedTextBlock(null);
      setMobileInspectorOpen(false);
    },
    [objectCount, editor.apply],
  );

  const createObject = useCallback(
    (object: EditorObject) => createObjects([object]),
    [createObjects],
  );

  const patchObject = useCallback(
    (patch: Record<string, unknown>) => {
      if (!selectedId) return;
      const source = editorDocRef.current.objects.find((object) => object.id === selectedId);
      if (!source) return;
      const next = { ...source, ...patch } as EditorObject;
      let nextRecords: ParagraphEditRecord[] | null = null;
      if (next.kind === 'text' && next.native?.paragraphId) {
        const layout = layoutsByPageRef.current[next.pageIndex];
        const paragraph = layout?.paragraphs.find(
          (candidate) => candidate.id === next.native!.paragraphId,
        );
        if (layout && paragraph) {
          // T-06 (UI half): the engine's native reflow keeps the document's own
          // size, weight, colour and alignment. If the user asks for a different
          // style, say so in the plan so the save can use the overlay path and
          // the receipt can name it -- never silently ignore the control.
          const diff = paragraphStyleDiff(paragraph, next);
          const ratio = paragraphLineHeightRatio(paragraph, layout);
          if (diff.family || diff.bold || diff.italic) {
            // The overlay must honour the chosen face/weight. Keeping the
            // document font key would make drawText prefer the original face
            // and quietly ignore "bold" or "serif" when the native path falls
            // back.
            delete (next as { fontKey?: string }).fontKey;
          }
          next.native = {
            ...next.native,
            styled: diff.any,
            reflow: {
              ...next.native.reflow,
              lineHeight: Math.max(1, next.fontSize * ratio),
            },
          };
          const key = paragraphEditKey(next.pageIndex, paragraph.id);
          const records = editorDocRef.current.paragraphRecords ?? [];
          nextRecords = records.map((record) =>
            paragraphEditKey(record.pageIndex, record.paragraphId) === key
              ? { ...record, plan: next.native!, styled: diff.any }
              : record,
          );
        }
      }
      editor.apply((doc) => ({
        ...doc,
        ...(nextRecords ? { paragraphRecords: nextRecords } : {}),
        objects: doc.objects.map((object) => (object.id === selectedId ? next : object)),
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
      const source = editorDocRef.current.objects.find((object) => object.id === id);
      const box = pageBoxFor(source?.pageIndex ?? 0);
      // Keep every gesture inside the page. A paragraph also carries a native
      // reflow origin; moving the object without it would make the export snap
      // back to where the glyphs were removed (T-02).
      const clampedX = Math.max(0, Math.min(box.width - (source?.width ?? 0), x));
      const clampedY = Math.max(0, Math.min(box.height - (source?.height ?? 0), y));
      editor.live((doc) => {
        // The delta is measured inside the updater, against the same snapshot
        // that is being changed. Measuring it against a possibly stale ref made
        // a held drag run away by adding the cumulative distance twice.
        const target = doc.objects.find((object) => object.id === id);
        const dx = clampedX - (target?.x ?? clampedX);
        const dy = clampedY - (target?.y ?? clampedY);
        const moved = doc.objects.map((object) => {
          if (object.id !== id) return object;
          if (object.kind === 'text' && object.native) {
            return {
              ...object,
              x: clampedX,
              y: clampedY,
              native: offsetNativePlan(object.native, dx, dy),
            };
          }
          return { ...object, x: clampedX, y: clampedY };
        });
        const key =
          target?.kind === 'text' && target.native?.paragraphId
            ? paragraphEditKey(target.pageIndex, target.native.paragraphId)
            : null;
        const paragraphRecords = key
          ? (doc.paragraphRecords ?? []).map((record) =>
              paragraphEditKey(record.pageIndex, record.paragraphId) === key
                ? { ...record, plan: offsetNativePlan(record.plan, dx, dy) }
                : record,
            )
          : doc.paragraphRecords;
        return {
          ...doc,
          objects: moved,
          ...(paragraphRecords ? { paragraphRecords } : {}),
        };
      });
    },
    [editor.live, pageBoxFor],
  );

  const resizeLive = useCallback(
    (id: string, rect: { x: number; y: number; width: number; height: number }) => {
      editor.live((doc) => ({
        ...doc,
        objects: doc.objects.map((object) => {
          if (object.id !== id) return object;
          // Ink points are stored relative to the box, so a resize must scale
          // them with it or the stroke would stay the old size in a new frame.
          if (object.kind === 'ink') {
            return {
              ...object,
              ...rect,
              points: scaleInkPoints(
                object.points,
                { width: object.width, height: object.height },
                { width: rect.width, height: rect.height },
              ),
            };
          }
          return { ...object, ...rect };
        }),
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
    // Finishing a text box returns to the pointer: the object is already
    // selected, and the direct-manipulation handles (move grip and edge dots)
    // only exist for the pointer tool. Staying armed with Text after every
    // commit made a freshly typed box look unselected.
    setTool('select');
  }, [editor.endTx, setTool]);

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
    if (id) setDocumentPanelOpen(false);
    // An object and a text block are never selected at the same time: the
    // inspector would otherwise describe two things and Delete would be
    // ambiguous. Clicking empty page space also lands here with `null`.
    setTextSelection(null);
    setSelectedTextBlock(null);
    setFocusedParagraph(null);
    setParagraphDetailsOpen(false);
  }, []);

  /* ------------------------------------------------------ structured text */

  /**
   * Applies paragraph mutations to a snapshot, replacing any objects a previous
   * edit of the same paragraph produced.
   *
   * `buildParagraphMutationObjects` is the pure half: draft autosave needs the
   * same objects without touching the live editor's bookkeeping. `append` adds
   * the ids/records only once the document is certain to receive them.
   */
  const buildParagraphMutationObjects = useCallback(
    (
      doc: EditorDoc,
      mutations: readonly ParagraphTextMutation[],
    ): { doc: EditorDoc; built: ParagraphEditRecord[]; removed: Set<string> } | null => {
      const additions: EditorObject[] = [];
      const removed = new Set<string>();
      const builtRecords: ParagraphEditRecord[] = [];
      for (const mutation of mutations) {
        const layout = layoutsByPageRef.current[mutation.pageIndex];
        const paragraph = layout?.paragraphs.find((item) => item.id === mutation.paragraphId);
        if (!layout || !paragraph) continue;
        const key = paragraphEditKey(mutation.pageIndex, mutation.paragraphId);
        const existingRecord = (doc.paragraphRecords ?? []).find(
          (record) => paragraphEditKey(record.pageIndex, record.paragraphId) === key,
        );
        for (const id of existingRecord?.objectIds ?? []) removed.add(id);
        const capability = capabilitiesByPageRef.current[mutation.pageIndex];
        let strategy:
          | 'native-object'
          | 'content-stream'
          | 'localized-reconstruction'
          | 'manual-review'
          | undefined;
        let fontKey: string | undefined;
        if (capability?.likelyScanned) {
          strategy = 'manual-review';
        } else if (capability && capability.textObjects.length > 0) {
          const normalized = (value: string): string => value.replace(/\s+/gu, ' ').trim();
          const paragraphLines = layout.lines.filter((line) =>
            paragraph.lineIds.includes(line.id),
          );
          const matches = paragraphLines.map((line) =>
            capability.textObjects.find(
              (object) => normalized(object.text) === normalized(line.text),
            ),
          );
          if (!matches.every(Boolean)) {
            strategy = 'localized-reconstruction';
          } else {
            fontKey = matches.find((match) => match)?.font?.baseName;
          }
        }
        const built = buildParagraphEditObjects(paragraph, layout, mutation.text, {
          makeId: newObjectId,
          ...(strategy ? { strategy } : {}),
          ...(fontKey ? { fontKey } : {}),
        });
        // Re-editing a paragraph keeps the style the user already chose. The
        // builder always starts from the extracted typography, which is correct
        // for a first edit but would silently reset a styled replacement on the
        // second one.
        if (existingRecord && built.textObject) {
          const previous = doc.objects.find(
            (object) =>
              object.kind === 'text' && existingRecord.objectIds.includes(object.id),
          );
          if (previous?.kind === 'text') {
            built.textObject.fontSize = previous.fontSize;
            built.textObject.bold = previous.bold;
            built.textObject.italic = previous.italic;
            built.textObject.fontFamily = previous.fontFamily;
            built.textObject.color = previous.color;
            built.textObject.align = previous.align;
            if (previous.fontKey) built.textObject.fontKey = previous.fontKey;
            if (built.textObject.native) {
              const diff = paragraphStyleDiff(paragraph, built.textObject);
              const ratio = paragraphLineHeightRatio(paragraph, layout);
              built.textObject.native = {
                ...built.textObject.native,
                styled: diff.any,
                reflow: {
                  ...built.textObject.native.reflow,
                  lineHeight: Math.max(1, built.textObject.fontSize * ratio),
                },
              };
            }
          }
        }
        additions.push(...built.whiteouts);
        if (built.textObject) additions.push(built.textObject);
        const plan =
          built.textObject?.native ??
          (built.whiteouts[0] as { native?: EditTextNativePlan } | undefined)?.native;
        if (plan) {
          builtRecords.push({
            pageIndex: mutation.pageIndex,
            paragraphId: paragraph.id,
            before: paragraphDisplayText(paragraph),
            after: mutation.text,
            objectIds: [
              ...built.whiteouts.map((object) => object.id),
              ...(built.textObject ? [built.textObject.id] : []),
            ],
            plan,
            styled: Boolean(plan.styled),
            savedAt: Date.now(),
          });
        }
      }
      if (additions.length === 0 && removed.size === 0) return null;
      const remaining = doc.objects.filter((object) => !removed.has(object.id));
      if (remaining.length + additions.length > LIMITS.tool.maxEditObjects) {
        toast.error(
          `This document already has ${LIMITS.tool.maxEditObjects.toLocaleString()} objects`,
        );
        return null;
      }
      const records = [
        ...(doc.paragraphRecords ?? []).filter(
          (record) =>
            !builtRecords.some(
              (next) =>
                paragraphEditKey(next.pageIndex, next.paragraphId) ===
                paragraphEditKey(record.pageIndex, record.paragraphId),
            ),
        ),
        ...builtRecords,
      ];
      return {
        doc: { ...doc, objects: [...remaining, ...additions], paragraphRecords: records },
        built: builtRecords,
        removed,
      };
    },
    [],
  );

  const appendMutationObjects = useCallback(
    (doc: EditorDoc, mutations: readonly ParagraphTextMutation[]): EditorDoc | null => {
      const built = buildParagraphMutationObjects(doc, mutations);
      if (!built) return null;
      if (built.built.length > 0) {
        // A changed paragraph no longer has the outcome the last export
        // reported; the details drawer must not quote a stale result.
        setLastOutcomes((previous) => {
          const next = { ...previous };
          for (const record of built.built) {
            delete next[paragraphEditKey(record.pageIndex, record.paragraphId)];
          }
          return next;
        });
      }
      return built.doc;
    },
    [buildParagraphMutationObjects],
  );

  const applyTextMutations = useCallback(
    (mutations: readonly ParagraphTextMutation[]) => {
      const next = appendMutationObjects(editorDocRef.current, mutations);
      if (next) editor.apply(next);
    },
    [appendMutationObjects, editor.apply],
  );

  /**
   * Writes the crash-safe draft. An in-flight paragraph edit is folded into the
   * *draft snapshot* (not the live document), so a reload restores the exact
   * typed sentence without closing the textarea while the user is still typing.
   */
  const saveDraftSnapshot = useCallback(async () => {
    const file = fileRef.current;
    const bytes = sourceBytesRef.current;
    if (!file || !bytes || draftDisabled.current || savingRef.current) return;
    if (
      editorDocRef.current.objects.length === 0 &&
      Object.keys(editorDocRef.current.formValues).length === 0 &&
      (editorDocRef.current.paragraphRecords ?? []).length === 0 &&
      !editor.pageOrderDirty &&
      !sourceDirtyRef.current
    ) {
      return;
    }
    const sequence = ++draftWriteSeq.current;
    let snapshot = editorDocRef.current;
    const active = paragraphEditRef.current;
    if (active) {
      const text = active.session.text;
      if (text !== active.baseline) {
        const built = buildParagraphMutationObjects(snapshot, [
          { pageIndex: active.pageIndex, paragraphId: active.paragraph.id, text },
        ]);
        if (built) snapshot = built.doc;
      }
    }
    const updatedAt = Date.now();
    const record: StoredDraft = {
      id: DRAFT_STORE_KEY,
      schema: DRAFT_SCHEMA,
      updatedAt,
      signature: draftSignature(file),
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      bytes,
      doc: snapshot,
      pageOrder: editor.pageOrder,
      currentPage,
      zoom,
      mode,
      tool,
      orderDirty: editor.pageOrderDirty,
    };
    const result = await saveDraft(record);
    if (sequence !== draftWriteSeq.current) return;
    if (result.ok) {
      setDraft(record);
      setDraftSavedAt(result.updatedAt);
      setDraftError(null);
    } else {
      if (result.reason === 'too-large') draftDisabled.current = true;
      setDraftError(result.message);
    }
  }, [
    buildParagraphMutationObjects,
    currentPage,
    editor.pageOrder,
    editor.pageOrderDirty,
    mode,
    sourceDirty,
    tool,
    zoom,
  ]);

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
      // The paragraph is now represented by an object; keep its block selected
      // so the detection-details drawer and Revert stay reachable instead of
      // dropping the user into an unrelated empty inspector.
      setFocusedParagraph({ pageIndex: active.pageIndex, paragraphId: active.paragraph.id });
      const block = active.layout.blocks.find((candidate) =>
        candidate.paragraphIds.includes(active.paragraph.id),
      );
      setSelectedTextBlock(
        block ? { pageIndex: active.pageIndex, blockId: block.id } : null,
      );
      setParagraphDetailsOpen(false);
    },
    [applyTextMutations],
  );

  const cancelParagraphEdit = useCallback((paragraphId?: string, token?: number) => {
    const active = paragraphEditRef.current;
    if (paragraphId !== undefined) {
      if (!active || active.paragraph.id !== paragraphId || active.token !== token) return;
    }
    const discardedText = Boolean(active && active.session.text !== active.baseline);
    paragraphEditRef.current = null;
    setParagraphEdit(null);
    if (!discardedText) return;
    // The draft may already contain the text that was just cancelled. Replace
    // it with the committed document (or drop it when there is nothing else to
    // recover), so a reload cannot resurrect discarded typing.
    const doc = editorDocRef.current;
    const hasWork =
      doc.objects.length > 0 ||
      (doc.paragraphRecords ?? []).length > 0 ||
      editor.pageOrderDirty;
    if (hasWork) {
      void saveDraftSnapshot();
    } else {
      draftWriteSeq.current += 1;
      void deleteDraft();
      setDraft(null);
      setDraftSavedAt(null);
      setDraftError(null);
    }
  }, [editor.pageOrderDirty, saveDraftSnapshot]);

  /**
   * Reverts one committed paragraph edit.
   *
   * The editor always saves from the original source bytes, so removing the
   * replacement and its covers is a true revert -- there is no rewritten source
   * to undo. The record lives in the document snapshot, which makes the whole
   * operation one undo step and restores the record on redo.
   */
  const revertParagraph = useCallback(
    (pageIndex: number, paragraphId: string): boolean => {
      const key = paragraphEditKey(pageIndex, paragraphId);
      const record = (editorDocRef.current.paragraphRecords ?? []).find(
        (candidate) => paragraphEditKey(candidate.pageIndex, candidate.paragraphId) === key,
      );
      if (!record) return false;
      const ids = new Set(record.objectIds);
      editor.apply((doc) => ({
        ...doc,
        objects: doc.objects.filter((object) => !ids.has(object.id)),
        paragraphRecords: (doc.paragraphRecords ?? []).filter(
          (candidate) => paragraphEditKey(candidate.pageIndex, candidate.paragraphId) !== key,
        ),
      }));
      const active = paragraphEditRef.current;
      if (active?.key === key) cancelParagraphEdit();
      setLastOutcomes((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
      setSelectedId(null);
      setTextSelection(null);
      setSelectedTextBlock(null);
      setParagraphDetailsOpen(true);
      toast.success('Paragraph reverted to the original text.', {
        description: 'The replacement and its covers were removed in one step.',
      });
      return true;
    },
    [cancelParagraphEdit, editor.apply],
  );

  const focusParagraph = useCallback((pageIndex: number, paragraphId: string | null) => {
    setFocusedParagraph(paragraphId ? { pageIndex, paragraphId } : null);
    setParagraphDetailsOpen(false);
  }, []);

  const revertFocusedParagraph = useCallback(() => {
    if (!focusedParagraph) return;
    revertParagraph(focusedParagraph.pageIndex, focusedParagraph.paragraphId);
  }, [focusedParagraph, revertParagraph]);

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
      setFocusedParagraph({ pageIndex, paragraphId });
      setParagraphDetailsOpen(false);
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
    if (blockId) {
      setSelectedId(null);
      setDocumentPanelOpen(false);
    } else {
      setFocusedParagraph(null);
      setParagraphDetailsOpen(false);
    }
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

  /* ------------------------------------------------------- find & replace */

  /**
   * Layouts with already-committed paragraph text applied.
   *
   * The extracted model is the immutable original, so a search run after an
   * edit would otherwise quote words that are no longer on the page. Only the
   * paragraph text is substituted; span geometry stays the extracted geometry,
   * which is what the overlay still uses for hit testing.
   */
  const searchLayouts = useCallback((): Map<number, PageLayout> => {
    const map = new Map<number, PageLayout>();
    for (const [index, layout] of Object.entries(layoutsByPageRef.current)) {
      map.set(Number(index), layout);
    }
    const records = editorDocRef.current.paragraphRecords ?? [];
    if (records.length === 0) return map;
    const overrides = new Map<number, Map<string, string>>();
    for (const record of records) {
      const page = overrides.get(record.pageIndex) ?? new Map<string, string>();
      page.set(record.paragraphId, record.after);
      overrides.set(record.pageIndex, page);
    }
    for (const [pageIndex, pageOverrides] of overrides) {
      const layout = map.get(pageIndex);
      if (!layout) continue;
      map.set(pageIndex, {
        ...layout,
        paragraphs: layout.paragraphs.map((paragraph) => {
          const after = pageOverrides.get(paragraph.id);
          if (after === undefined) return paragraph;
          return { ...paragraph, text: after.slice(paragraphDisplayPrefix(paragraph)) };
        }),
      });
    }
    return map;
  }, []);

  const selectionForMatch = useCallback((match: SearchMatch): TextSelectionState | null => {
    const layout = layoutsByPageRef.current[match.pageIndex];
    if (!layout) return null;
    const paragraph = layout.paragraphs.find((candidate) => candidate.id === match.paragraphId);
    if (!paragraph) return null;
    const model = new PageInteractionModel(layout);
    const max = paragraph.text.length;
    const start = Math.max(0, Math.min(max, match.start));
    const end = Math.max(start, Math.min(max, match.end));
    return selectionFromAnchors(
      model,
      match.pageIndex,
      { paragraphId: paragraph.id, offset: start },
      { paragraphId: paragraph.id, offset: end },
    );
  }, []);

  const jumpToFindMatch = useCallback(
    (index: number) => {
      if (findMatches.length === 0) return;
      const wrapped = ((index % findMatches.length) + findMatches.length) % findMatches.length;
      const match = findMatches[wrapped]!;
      setFindActive(wrapped);
      setTool('select');
      setSelectedId(null);
      setSelectedTextBlock(null);
      goToPage(match.pageIndex);
      setTextSelection(selectionForMatch(match));
    },
    [findMatches, goToPage, selectionForMatch, setTool],
  );

  const closeFind = useCallback(() => {
    findSequence.current += 1;
    setFindOpen(false);
    setFindMatches([]);
    setFindSearching(false);
    setFindError(null);
    setTextSelection(null);
  }, []);

  const openFind = useCallback(() => {
    setFindOpen(true);
    setTool('select');
    setSelectedId(null);
    setSelectedTextBlock(null);
  }, [setTool]);

  const replaceAllMatches = useCallback(() => {
    if (findMatches.length === 0) return;
    const replacements = replaceMatches(findMatches, findReplacement);
    const mutations: ParagraphTextMutation[] = [];
    for (const replacement of replacements) {
      const layout = layoutsByPageRef.current[replacement.pageIndex];
      const paragraph = layout?.paragraphs.find(
        (candidate) => candidate.id === replacement.paragraphId,
      );
      if (!paragraph) continue;
      mutations.push({
        pageIndex: replacement.pageIndex,
        paragraphId: replacement.paragraphId,
        text: displayTextForBody(paragraph, replacement.text),
      });
    }
    if (mutations.length === 0) return;
    const count = findMatches.length;
    applyTextMutations(mutations);
    setFindMatches([]);
    setFindActive(0);
    setTextSelection(null);
    toast.success(`Replaced ${count} occurrence${count === 1 ? '' : 's'}.`, {
      description: 'One undo step. The search list refreshes against the edited text.',
    });
  }, [applyTextMutations, findMatches, findReplacement]);

  // Search runs over the layouts the overlay already owns; it never asks PDFium
  // for capability data (a 40-page search would otherwise pay for font/object
  // inspection it does not read). Pages that failed stay retryable and are
  // reported instead of being silently skipped.
  useEffect(() => {
    if (!findOpen) return undefined;
    const query = findQuery;
    if (query.length === 0) {
      findSequence.current += 1;
      setFindMatches([]);
      setFindActive(0);
      setFindSearching(false);
      setFindError(null);
      setFindFailedPages([]);
      return undefined;
    }
    const sequence = ++findSequence.current;
    let cancelled = false;
    setFindSearching(true);
    setFindError(null);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const pageCount = infoRef.current?.pageCount ?? 0;
          if (pageCount > 0) {
            await ensureRuns(
              Array.from({ length: pageCount }, (_, index) => index),
              { capabilities: false, colors: false },
            );
          }
          if (cancelled || sequence !== findSequence.current) return;
          const layouts = searchLayouts();
          const failed = Array.from({ length: pageCount }, (_, index) => index).filter(
            (index) => !layouts.has(index),
          );
          setFindFailedPages(failed);
          const matches = findInLayouts(layouts, query, {
            caseSensitive: findCase,
            wholeWord: findWholeWord,
          });
          setFindMatches(matches);
          setFindActive(0);
          setTextSelection(matches[0] ? selectionForMatch(matches[0]) : null);
        } catch (error) {
          if (!cancelled && sequence === findSequence.current) {
            setFindError(error instanceof Error ? error.message : 'Search failed.');
            setFindMatches([]);
          }
        } finally {
          if (!cancelled && sequence === findSequence.current) setFindSearching(false);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    findOpen,
    findQuery,
    findCase,
    findWholeWord,
    ensureRuns,
    searchLayouts,
    selectionForMatch,
    editor.doc.paragraphRecords,
    layoutsByPage,
  ]);

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
      // C-11: start from the colour the page actually uses when the model has
      // sampled it, rather than a near-black default.
      const sampledColor = layoutsByPageRef.current[pageIndex]?.paragraphs.find(
        (paragraph) => paragraph.text.includes(run.text) || run.text.includes(paragraph.text),
      )?.typography.color;
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
        color: sampledColor ?? '#111827',
        rasterFallback: true,
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
        const placed = offsetOnPage(
          { x: source.x, y: source.y, width: source.width, height: source.height },
          pageBoxFor(source.pageIndex),
          8,
          8,
        );
        const copy = detachEditIntent({
          ...source,
          id: newObjectId(),
          ...placed,
        } as EditorObject);
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
    [selectedId, saving, atObjectLimit, editor.apply, pageBoxFor],
  );

  /* ----------------------------------------------------- object clipboard */

  /** Last copied object; survives undo and page changes, per editor session. */
  const objectClipboard = useRef<EditorObject | null>(null);

  const copySelectedObject = useCallback((): boolean => {
    if (!selectedId) return false;
    const source = editorDocRef.current.objects.find((object) => object.id === selectedId);
    if (!source) return false;
    objectClipboard.current = structuredClone(source) as EditorObject;
    toast.success('Object copied');
    return true;
  }, [selectedId]);

  const cutSelectedObject = useCallback((): boolean => {
    if (!copySelectedObject()) return false;
    deleteSelected();
    return true;
  }, [copySelectedObject, deleteSelected]);

  /**
   * Pastes onto the page in view, offset like every other editor's paste and
   * clamped so the copy always lands inside the page.
   */
  const pasteObject = useCallback((): boolean => {
    const clipboard = objectClipboard.current;
    if (!clipboard) return false;
    const pageIndex = Math.min(
      Math.max(0, currentPage),
      Math.max(0, (infoRef.current?.pageCount ?? 1) - 1),
    );
    const placed = offsetOnPage(
      { x: clipboard.x, y: clipboard.y, width: clipboard.width, height: clipboard.height },
      pageBoxFor(pageIndex),
      12,
      12,
    );
    // `createObject` owns the object-limit check and its visible message, so a
    // paste at the limit explains itself instead of silently doing nothing.
    createObject({
      ...cloneObjectForPaste(clipboard),
      id: newObjectId(),
      pageIndex,
      ...placed,
    });
    return true;
  }, [createObject, currentPage, pageBoxFor]);

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

  /** Redaction marks are review geometry explicitly tagged by the tool. */
  const redactMarks = useMemo(
    () =>
      editor.doc.objects.filter(
        (object): object is Extract<EditorObject, { kind: 'rect' | 'ellipse' }> =>
          object.kind === 'rect' && object.role === 'redaction',
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
    const input = await readAsInputFilesOrToast([file]);
    if (!input) return;
    const outcome = await redactRunner.run(
      input,
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
            // Only another redaction mark can be a duplicate; a decorative
            // black rectangle at the same coordinates is a different thing.
            object.role === 'redaction' &&
            object.pageIndex === region.pageIndex &&
            Math.abs(object.x - region.x) < 1 &&
            Math.abs(object.y - region.y) < 1 &&
            Math.abs(object.width - region.width) < 1,
        );
        if (duplicate) continue;
        additions.push({
          id: newObjectId(),
          kind: 'rect',
          role: 'redaction',
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
        createObjects(additions);
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
    createObjects,
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
    const input = await readAsInputFilesOrToast([file]);
    if (!input) return;
    const outcome = await organizeRunner.run(
      input,
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

  /**
   * E-09: append pages from other PDFs without discarding the session.
   *
   * The composed document is rebuilt in the rail's current order, so every
   * object's `pageIndex` is remapped from its original page to its new position,
   * and the rail order becomes identity. Old rasters/layouts stay valid because
   * their pages are copied unchanged; only the new pages need fetching.
   */
  const insertPagesFromPdf = useCallback(
    async (incoming: File[]) => {
      const file = fileRef.current;
      const currentBytes = sourceBytesRef.current;
      if (!file || !currentBytes || incoming.length === 0 || insertingPages) return;
      setInsertingPages(true);
      try {
        const extraInput = await readAsInputFilesOrToast(incoming);
        if (!extraInput) return;
        const extraInfo = await inspectRunner.run(extraInput);
        if (!extraInfo.ok) {
          if (!extraInfo.aborted) toast.error(extraInfo.message);
          return;
        }
        const refs: PageRef[] = pageOrder.map((pageIndex) => ({ docIndex: 0, pageIndex }));
        const extraIndexes: number[] = [];
        for (const [index, doc] of extraInfo.result.documents.entries()) {
          for (let pageIndex = 0; pageIndex < doc.pageCount; pageIndex += 1) {
            refs.push({ docIndex: index + 1, pageIndex });
            extraIndexes.push(refs.length - 1);
          }
        }
        const currentInput = await readAsInputFilesOrToast([file]);
        const extraBytes = await readAsInputFilesOrToast(incoming);
        if (!currentInput || !extraBytes) return;
        const composed = await organizeRunner.run(
          [currentInput[0]!, ...extraBytes],
          {
            pageOrder: refs,
            outputName: file.name,
          },
          { timeoutMs: timeoutForPageCount(refs.length) },
        );
        // `organize` is also the page-organise tool's result runner; leaving it
        // in `done` would replace the editor with its download panel after an
        // insert. The composed bytes are local now, so clear the runner state.
        organizeRunner.reset();
        if (!composed.ok) {
          if (!composed.aborted) toast.error(composed.message);
          return;
        }
        const nextBytes = new Uint8Array(composed.result.data);
        const inspected = await inspectRunner.run([
          { name: file.name, type: 'application/pdf', data: nextBytes.slice() },
        ]);
        if (!inspected.ok) {
          if (!inspected.aborted) toast.error(inspected.message);
          return;
        }
        const nextDoc = inspected.result.documents[0];
        if (!nextDoc) {
          toast.error('The document with inserted pages could not be read.');
          return;
        }
        const nextFile = new File([nextBytes], file.name, {
          type: 'application/pdf',
          lastModified: file.lastModified,
        });
        // Rasters/runs/layouts are keyed by the old page indices. After a
        // compose in rail order those keys no longer point at the same pages
        // (especially when the rail was reordered), so let them reload against
        // the new document rather than showing the wrong page.
        const priorProvenance = ocrProvenance;
        invalidateDocumentCaches();
        fileRef.current = nextFile;
        setFiles([nextFile]);
        infoRef.current = nextDoc;
        setInfo(nextDoc);
        sourceBytesRef.current = nextBytes;
        setSourceDirty(true);
        // Map each original page index to its position after composition. An
        // object on a page the rail reordered follows that page, not its old
        // number. Duplicates map to their first occurrence.
        const positionByOriginal = new Map<number, number>();
        pageOrder.forEach((original, position) => {
          if (!positionByOriginal.has(original)) positionByOriginal.set(original, position);
        });
        const remapPage = (index: number): number => positionByOriginal.get(index) ?? index;
        // OCR provenance follows the same page remap as objects: a reordered
        // OCR'd page keeps its confidence, and a removed page's entry is dropped.
        const nextProvenance: typeof ocrProvenance = {};
        for (const [index, value] of Object.entries(priorProvenance)) {
          const position = positionByOriginal.get(Number(index));
          if (position !== undefined) nextProvenance[position] = value;
        }
        setOcrProvenance(nextProvenance);
        // A page remap is not an editing action; keeping it out of the undo
        // stack means Undo cannot desync object page indexes from the file.
        editor.live((doc) => ({
          ...doc,
          // Objects on a page the rail already removed have no position in the
          // composed file; drop them rather than pointing them at a different
          // page. Live pages keep their edits through the remap.
          objects: doc.objects
            .filter((object) => positionByOriginal.has(object.pageIndex))
            .map((object) => ({
              ...object,
              pageIndex: remapPage(object.pageIndex),
            })),
          ...(doc.paragraphRecords
            ? {
                paragraphRecords: doc.paragraphRecords
                  .filter((record) => positionByOriginal.has(record.pageIndex))
                  .map((record) => ({
                    ...record,
                    pageIndex: remapPage(record.pageIndex),
                  })),
              }
            : {}),
        }));
        // Page order is session state, not part of the editable document. The
        // composed file is already in the rail's old order, so its identity
        // becomes the new baseline (not a dirty reorder).
        editor.resetPageOrder(refs.length);
        // Save outcomes are keyed by the object ids that just changed page
        // indices; stale page numbers in the details drawer would be wrong.
        setLastOutcomes({});
        savedDocRef.current = null;
        setCurrentPage(pageOrder.length);
        const eager = Math.min(WARM_RASTER_PAGES, nextDoc.pageCount);
        for (let index = pageOrder.length; index < eager + pageOrder.length; index += 1) {
          if (index < nextDoc.pageCount) void ensureRaster(index);
        }
        void ensureRuns(
          Array.from(
            { length: Math.min(WARM_RUN_PAGES, extraIndexes.length) },
            (_, offset) => pageOrder.length + offset,
          ),
        );
        toast.success(
          `Inserted ${extraIndexes.length} page${extraIndexes.length === 1 ? '' : 's'} from ${incoming.length} PDF${incoming.length === 1 ? '' : 's'}.`,
        );
      } finally {
        setInsertingPages(false);
        if (insertPagesInputRef.current) insertPagesInputRef.current.value = '';
      }
    },
    [
      editor.live,
      editor.resetPageOrder,
      ensureRaster,
      ensureRuns,
      insertingPages,
      inspectRunner,
      invalidateDocumentCaches,
      organizeRunner,
      ocrProvenance,
      pageOrder,
    ],
  );

  /**
   * O-01/O-02/O-04: run the text-layer OCR pass for the current page or every
   * scanned page. The original pages stay in place; only invisible text is
   * appended, so objects, paragraph ids and page indices survive.
   */
  const runOcrLayer = useCallback(
    async (scope: 'page' | 'document') => {
      const file = fileRef.current;
      const bytes = sourceBytesRef.current;
      if (!file || !bytes || ocrLayerRunner.state.status === 'running') return;
      if (savingRef.current) {
        toast.info('Wait for the save to finish before running OCR.');
        return;
      }
      const pageIndexes = scope === 'page' ? [currentPage] : [];
      const pageCount = infoRef.current?.pageCount ?? 1;
      const input = [
        { name: file.name, type: 'application/pdf', data: bytes.slice() },
      ];
      const outcome = await ocrLayerRunner.run(
        input,
        {
          ...(pageIndexes.length > 0 ? { pageIndexes } : {}),
          quality: 0.9,
        },
        { timeoutMs: ocrTimeoutForPageCount(pageIndexes.length || pageCount) },
      );
      if (!outcome.ok) {
        if (!outcome.aborted) toast.error(outcome.message);
        return;
      }
      const result = outcome.result;
      if (result.ocrPages.length === 0) {
        if (result.skippedPages.length > 0) {
          toast.info('Those pages already have a searchable text layer.');
        } else {
          toast.warning('OCR found no readable words on that page.', {
            description:
              result.warnings[0]?.message ??
              'Try a sharper scan; the page was left unchanged.',
          });
        }
        return;
      }
      const nextBytes = new Uint8Array(result.data);
      const nextFile = new File([nextBytes], file.name, {
        type: 'application/pdf',
        lastModified: file.lastModified,
      });
      // Preserve provenance from earlier OCR runs in this document: the cache
      // invalidation below clears the state, but page 1's confidence is still
      // true after page 2 is recognized.
      const nextProvenance = { ...ocrProvenance };
      for (const page of result.pages) {
        if (!result.ocrPages.includes(page.pageIndex + 1)) continue;
        nextProvenance[page.pageIndex] = {
          confidence: page.confidence,
          wordCount: page.wordCount,
          paragraphCount: page.paragraphCount,
        };
      }
      invalidateDocumentCaches();
      fileRef.current = nextFile;
      sourceBytesRef.current = nextBytes;
      setFiles([nextFile]);
      setSourceDirty(true);
      setOcrProvenance(nextProvenance);
      const inspected = await inspectRunner.run([
        { name: nextFile.name, type: 'application/pdf', data: nextBytes.slice() },
      ]);
      if (inspected.ok) {
        const doc = inspected.result.documents[0];
        if (doc) {
          infoRef.current = doc;
          setInfo(doc);
        }
      }
      const touched = result.ocrPages.map((pageNumber) => pageNumber - 1);
      for (const index of touched) void ensureRaster(index);
      void ensureRuns(touched, { colors: false });
      toast.success(
        `Searchable text added to ${result.ocrPages.length} page${result.ocrPages.length === 1 ? '' : 's'}`,
        {
          description: `Mean confidence ${Math.round(result.averageConfidence)}%. Check the text before relying on it — the page is still the scan you supplied.`,
        },
      );
    },
    [
      currentPage,
      ensureRaster,
      ensureRuns,
      inspectRunner,
      invalidateDocumentCaches,
      ocrLayerRunner,
      ocrProvenance,
    ],
  );

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
      const { width, height } = scaledSignatureSize(
        capture.width,
        capture.height,
        SIGNATURE_WIDTH_PT,
      );
      // The click seeds the top-left; keep the whole placement on the page.
      const placed = clampToPage(
        { x: pending.x, y: pending.y, width, height },
        pageBoxFor(pending.pageIndex),
      );
      lastSignatureMethodRef.current = capture.method;
      const object: EditorObject = {
        id: newObjectId(),
        kind: 'image',
        pageIndex: pending.pageIndex,
        x: Math.round(placed.x),
        y: Math.round(placed.y),
        width,
        height,
        data: new Uint8Array(await capture.png.arrayBuffer()),
        mimeType: 'image/png',
      };
      pendingSignatureRef.current = null;
      createObject(object);
    },
    [createObject, pageBoxFor],
  );

  /* --------------------------------------------------------------- save */

  const onSave = useCallback(async (acceptUntouched = false) => {
    if (
      isAi &&
      editor.doc.objects.length === 0 &&
      Object.keys(editor.doc.formValues).length === 0
    ) {
      return;
    }
    // A source-byte change (OCR) and a save must not overlap: the save would
    // either export the pre-OCR bytes or clear the dirty flag for them.
    if (ocrLayerRunner.state.status === 'running') {
      toast.info('Wait for OCR to finish before saving.');
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
    // X-05: a no-change export is not a document operation. The button is
    // disabled for the same reason, but keyboard and mobile paths reach this
    // guard directly. This runs before the organize branch so a no-op page
    // export cannot slip through the keyboard shortcut.
    const hasChanges =
      editorIsDirty({
        doc: editor.doc,
        saved: savedDocRef.current,
        paragraphEditActive: paragraphEditRef.current !== null,
        pageOrderDirty: isOrganize && editor.pageOrderDirty,
        redactMarkCount: isRedact ? redactMarks.length : 0,
      }) || sourceDirty;
    if (!hasChanges && aiChangeCount === 0) {
      toast.info('There are no changes to save.');
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
    /** Edit id → paragraph, so a save outcome can reach the details drawer. */
    const editParagraphs = new Map<string, { pageIndex: number; paragraphId: string }>();
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
      // The object and its native reflow origin move together (see `moveLive`);
      // the `moved` flag is what tells the engine to reposition the rewritten
      // text objects instead of keeping their original matrices. The original
      // beforeLines anchors stay fixed, so they are the reliable comparison.
      const moved =
        xs.length > 0 &&
        object.kind === 'text' &&
        (Math.abs(object.x - Math.min(...xs)) > 0.25 ||
          Math.abs(object.y - Math.min(...ys)) > 0.25);
      const reflow = moved ? { ...plan.reflow, moved: true } : plan.reflow;
      const base: TextEdit = {
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
        ...(fallback.length > 0 ? { fallback } : {}),
      };
      // C-05: a pure deletion inside one original line is a stream deletion,
      // not a paragraph rewrite. It removes only the selected word and never
      // needs a cosmetic cover; if the stream cannot anchor it, the engine
      // refuses rather than hiding the text.
      const deletion = plan.styled
        ? null
        : singleRunDeletion(plan.before, plan.after, plan.beforeLines);
      if (deletion) {
        edits.push({
          id: object.id,
          pageIndex: object.pageIndex,
          find: deletion.text,
          replace: '',
          box: deletion.line.box,
          // A partial deletion must be anchored by its text, not by the whole
          // line box: the native box-only erase fallback would remove the entire
          // run. Content-stream surgery is the only path that removes just the
          // selected glyphs; if it cannot anchor them, the engine refuses.
          strategy: 'content-stream',
          coverPolicy: 'leftover-cover',
        });
        linked.add(object.id);
        for (const cover of covers) linked.add(cover.id);
        if (plan.paragraphId) {
          editParagraphs.set(object.id, {
            pageIndex: object.pageIndex,
            paragraphId: plan.paragraphId,
          });
        }
        continue;
      }

      // T-06: a style change is now carried into the native layout edit. The
      // engine applies size/colour/alignment and substitutes a standard face
      // only when the document face has no matching weight/style; the overlay
      // remains the fallback and still shows exactly what the user chose.
      const alignChanged =
        object.kind === 'text' &&
        object.align !== undefined &&
        (plan.originalAlign
          ? object.align !== plan.originalAlign
          : object.align !== 'left');
      const familyChanged =
        object.kind === 'text' &&
        object.fontFamily !== undefined &&
        (plan.originalFontFamily
          ? object.fontFamily !== plan.originalFontFamily
          : object.fontFamily !== 'helvetica');
      const style =
        plan.styled && object.kind === 'text'
          ? {
              fontSize: object.fontSize,
              color: object.color,
              bold: Boolean(object.bold),
              italic: Boolean(object.italic),
              ...(familyChanged ? { fontFamily: object.fontFamily } : {}),
              ...(alignChanged ? { align: object.align } : {}),
              ...(object.rotationDeg !== undefined ? { rotationDeg: object.rotationDeg } : {}),
            }
          : undefined;
      edits.push({
        ...base,
        coverPolicy: 'leftover-cover',
        layout: {
          ...(plan.paragraphId ? { paragraphId: plan.paragraphId } : {}),
          ...(plan.fontFamily ? { fontFamily: plan.fontFamily } : {}),
          beforeLines: plan.beforeLines,
          reflow,
          ...(style ? { style } : {}),
        },
        ...(plan.strategy ? { strategy: plan.strategy } : {}),
      });
      if (plan.paragraphId) {
        editParagraphs.set(object.id, {
          pageIndex: object.pageIndex,
          paragraphId: plan.paragraphId,
        });
      }
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
    const input = await readAsInputFilesOrToast([file]);
    if (!input) return;
    const outcome = await editRunner.run(
      input,
      {
        edits,
        objects,
        formValues: snapshot.formValues,
        ...(acceptUntouched ? { acceptUntouchedPageChanges: true } : {}),
        ...(Object.keys(ocrProvenance).length > 0
          ? { ocrPages: Object.keys(ocrProvenance).length }
          : {}),
        // Fill & Sign says what happened; the default "-edited" would lie.
        outputName: isSign
          ? `${file.name.replace(/\.pdf$/i, '')}-signed`
          : undefined,
      },
      { timeoutMs: timeoutForPageCount(infoRef.current?.pageCount ?? 1) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) {
        // X-03: a mismatch on a page the edit did not touch is the one refusal
        // a user may knowingly override. Everything else stays a hard stop.
        if (!acceptUntouched && /untouched[- ]page/i.test(outcome.detail)) {
          setUntouchedBlocked(outcome.detail);
          return;
        }
        toast.error(outcome.message);
      }
      return;
    }
    setUntouchedBlocked(null);
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
      setSourceDirty(false);
      // The saved artifact now contains these outcomes; the details drawer can
      // say what actually happened instead of predicting it.
      const mapped: Record<string, TextEditOutcome> = {};
      for (const result of report.outcomes) {
        const target = editParagraphs.get(result.id);
        if (target) {
          mapped[paragraphEditKey(target.pageIndex, target.paragraphId)] = result;
        }
      }
      setLastOutcomes(mapped);
      // The export is the durable copy now; a stale draft must not offer to
      // resurrect superseded edits on the next visit. Bump the write sequence
      // first so an autosave already in flight cannot recreate it afterwards.
      draftWriteSeq.current += 1;
      void deleteDraft();
      setDraft(null);
      setDraftError(null);
      setDraftSavedAt(null);
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
    aiChangeCount,
    sourceDirty,
    ocrProvenance,
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

      // Escape is context-sensitive: it must be able to close Find, cancel an
      // inline edit or clear a selection even while a field has focus.
      if (event.key === 'Escape') {
        if (findOpen) {
          event.preventDefault();
          closeFind();
          return;
        }
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
        setDocumentPanelOpen(false);
        return;
      }

      // Find belongs to the document, not the focused field: Ctrl/Cmd+F opens
      // it even from the paragraph textarea (where the browser's own find would
      // search the DOM textarea, not the PDF).
      if (mod && key === 'f') {
        if (saving) return;
        event.preventDefault();
        openFind();
        return;
      }

      // Text editing keeps its native undo. Document-level undo while typing is
      // not merely surprising: text edits are applied with live (no history
      // entry of their own), so Ctrl+Z inside a text box would skip past the
      // keystrokes and delete the whole object instead of the last character.
      if (typing && mod) {
        if (key === 's' && !saving) {
          event.preventDefault();
          void onSave();
        }
        return;
      }

      const shortcut = matchEditorShortcut(event, {
        typing,
        hasObject: Boolean(selectedId),
        hasTextSelection: Boolean(textSelectionRef.current),
        hasObjectClipboard: Boolean(objectClipboard.current),
        findOpen,
        saving,
        canEdit: true,
      } satisfies ShortcutContext);
      if (!shortcut) {
        if (event.key.startsWith('Arrow') && selectedId && !saving) {
          event.preventDefault();
          const step = event.shiftKey ? 10 : 1;
          const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
          const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
          transformSelected('nudge', dx, dy);
        }
        return;
      }

      // Saving freezes the document. The visible controls disable in this state;
      // the keyboard path must not reach a mutation the UI hides.
      if (saving) {
        if (
          shortcut.tool ||
          shortcut.id === 'save' ||
          shortcut.id === 'find' ||
          shortcut.id === 'undo' ||
          shortcut.id === 'redo' ||
          shortcut.id === 'redo-alt' ||
          shortcut.id === 'duplicate' ||
          shortcut.id === 'cut' ||
          shortcut.id === 'paste' ||
          shortcut.id === 'delete'
        ) {
          return;
        }
      }

      switch (shortcut.id) {
        case 'find':
          event.preventDefault();
          openFind();
          return;
        case 'save':
          event.preventDefault();
          void onSave();
          return;
        case 'undo':
          event.preventDefault();
          undo();
          return;
        case 'redo':
        case 'redo-alt':
          event.preventDefault();
          redo();
          return;
        case 'duplicate':
          event.preventDefault();
          transformSelected('duplicate');
          return;
        case 'copy':
          event.preventDefault();
          if (textSelectionRef.current) void copyTextSelection();
          else copySelectedObject();
          return;
        case 'cut':
          event.preventDefault();
          if (textSelectionRef.current) void cutTextSelection();
          else cutSelectedObject();
          return;
        case 'paste':
          event.preventDefault();
          if (textSelectionRef.current) void pasteTextSelection();
          else pasteObject();
          return;
        case 'delete':
          event.preventDefault();
          if (textSelectionRef.current) deleteTextSelection();
          else deleteSelected();
          return;
        case 'zoom-in': {
          event.preventDefault();
          const next = editorStepZoom(zoomRef.current, 'in');
          if (next !== null) onZoomChange(next);
          return;
        }
        case 'zoom-out': {
          event.preventDefault();
          const next = editorStepZoom(zoomRef.current, 'out');
          if (next !== null) onZoomChange(next);
          return;
        }
        case 'fit-width':
          event.preventDefault();
          fitWidth();
          return;
        case 'fit-page':
          event.preventDefault();
          fitPage();
          return;
        case 'prev-page':
          event.preventDefault();
          goToDisplayPage(currentDisplayPosition - 1);
          return;
        case 'next-page':
          event.preventDefault();
          goToDisplayPage(currentDisplayPosition + 1);
          return;
        case 'help':
          event.preventDefault();
          setShortcutsOpen(true);
          return;
        default:
          if (
            shortcut.tool &&
            toolsForMode(mode).some((entry) => entry.id === shortcut.tool)
          ) {
            event.preventDefault();
            setTool(shortcut.tool);
          }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    stage,
    selectedId,
    editingId,
    saving,
    currentDisplayPosition,
    editor,
    onSave,
    deleteSelected,
    endEdit,
    transformSelected,
    onZoomChange,
    fitWidth,
    fitPage,
    goToDisplayPage,
    cancelParagraphEdit,
    copyTextSelection,
    cutTextSelection,
    pasteTextSelection,
    deleteTextSelection,
    copySelectedObject,
    cutSelectedObject,
    pasteObject,
    mode,
    findOpen,
    openFind,
    closeFind,
  ]);

  /* --------------------------------------------- unsaved-changes guard */

  useEffect(() => {
    if (stage !== 'editing') return;
    const hasWork =
      editor.doc.objects.length > 0 ||
      Object.keys(editor.doc.formValues).length > 0 ||
      paragraphEdit !== null ||
      sourceDirty ||
      (stage === 'editing' && pageOrderDirty);
    const unsaved =
      editor.doc !== savedDocRef.current ||
      sourceDirty ||
      paragraphEdit !== null ||
      (stage === 'editing' && pageOrderDirty);
    if (!hasWork || !unsaved) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [stage, editor.doc, editor.pageOrderDirty, paragraphEdit, pageOrderDirty, sourceDirty, saving]);

  const dirty =
    editorIsDirty({
      doc: editor.doc,
      saved: savedDocRef.current,
      paragraphEditActive: paragraphEdit !== null,
      pageOrderDirty: isOrganize && pageOrderDirty,
      redactMarkCount: isRedact ? redactMarks.length : 0,
    }) || sourceDirty;

  const leaveDirtyRef = useRef(false);
  leaveDirtyRef.current = dirty || aiChangeCount > 0;
  /**
   * S-06: the data-router blocker covers browser Back/Forward. The existing
   * document click interceptor covers in-app links because it can prevent the
   * click before React Router sees it; this handles the history API path,
   * which cannot be prevented once the browser has moved.
   */
  const allowHistoryLeave = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (allowHistoryLeave.current) return false;
    if (!leaveDirtyRef.current) return false;
    return (
      currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search
    );
  });

  useEffect(() => {
    if (blocker.state === 'blocked') {
      setLeaveIntent({ history: true });
    }
  }, [blocker.state]);

  useEffect(() => {
    if (stage !== 'editing') allowHistoryLeave.current = false;
  }, [stage]);


  // Offer the last draft at idle. The banner is the only place that can restore
  // it, so it loads once on mount and never fights a document being opened.
  useEffect(() => {
    let alive = true;
    void loadDraft().then((value) => {
      if (!alive || !value) return;
      setDraft(value);
      setDraftSavedAt(value.updatedAt);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Debounced autosave. Only a document with changes is worth a draft: opening
  // a PDF and closing it again should not leave an autosave behind.
  useEffect(() => {
    if (stage !== 'editing' || !info) return undefined;
    if (!dirty && !pageOrderDirty) return undefined;
    if (draftTimer.current !== undefined) {
      clearTimeout(draftTimer.current);
      draftTimer.current = undefined;
    }
    draftTimer.current = setTimeout(() => {
      draftTimer.current = undefined;
      void saveDraftSnapshot();
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimer.current !== undefined) {
        clearTimeout(draftTimer.current);
        draftTimer.current = undefined;
      }
    };
  }, [
    stage,
    info,
    editor.doc,
    editor.pageOrder,
    currentPage,
    zoom,
    tool,
    mode,
    dirty,
    pageOrderDirty,
    saveDraftSnapshot,
  ]);

  /**
   * Restores the autosaved session through the same inspect path a fresh file
   * takes, then hydrates the overlay document on top. Keeping one path means a
   * restored draft is validated against the bytes that are actually opened.
   */
  const restoreDraft = useCallback(async () => {
    if (!draft || draftRestoring) return;
    setDraftRestoring(true);
    setDraftError(null);
    try {
      const file = new File([draft.bytes.slice()], draft.name, {
        type: 'application/pdf',
        lastModified: draft.lastModified,
      });
      await handleFiles([file], draft);
    } catch (error) {
      setDraftError(
        error instanceof Error
          ? `The draft could not be restored: ${error.message}`
          : 'The draft could not be restored.',
      );
      setStage('idle');
    } finally {
      setDraftRestoring(false);
    }
  }, [draft, draftRestoring]);

  const discardDraft = useCallback(async () => {
    await deleteDraft();
    setDraft(null);
    setDraftError(null);
    setDraftSavedAt(null);
  }, []);


  useEffect(() => {
    if (stage !== 'editing' || !info) return;
    const onClick = (event: MouseEvent) => {
      if (!leaveDirtyRef.current) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }
      event.preventDefault();
      setLeaveIntent({ navigate: `${url.pathname}${url.search}${url.hash}` });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [stage, info]);

  /* -------------------------------------------------------------- views */

  const showingResult =
    editState.status === 'done' ||
    redactState.status === 'done' ||
    organizeState.status === 'done' ||
    aiResult !== null;

  // Opening the Pages workspace from any entry point (route, mode tab or a
  // restored draft) needs the rail: page reorder, duplicate and delete live
  // there. The effect runs on mode changes only, so the user can still collapse
  // it while staying in Pages.
  useEffect(() => {
    if (stage !== 'editing') return;
    if (mode === 'organize') editor.toggleRail(true);
  }, [stage, mode, editor.toggleRail]);

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

  const focusedLayout = focusedParagraph
    ? layoutsByPage[focusedParagraph.pageIndex] ?? null
    : null;
  const focusedParagraphModel = focusedParagraph
    ? focusedLayout?.paragraphs.find(
        (paragraph) => paragraph.id === focusedParagraph.paragraphId,
      ) ?? null
    : null;
  const focusedParagraphKey = focusedParagraph
    ? paragraphEditKey(focusedParagraph.pageIndex, focusedParagraph.paragraphId)
    : null;
  const focusedRecord =
    focusedParagraphKey !== null
      ? (editor.doc.paragraphRecords ?? []).find(
          (record) =>
            paragraphEditKey(record.pageIndex, record.paragraphId) === focusedParagraphKey,
        ) ?? null
      : null;
  const focusedOutcome =
    focusedParagraphKey !== null ? lastOutcomes[focusedParagraphKey] ?? null : null;

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
  const selectedBlockEditStatus = describeParagraphEditStatus(selectedBlockCapability);

  // Page-bound callbacks, stable per page: an inline arrow would change identity
  // on every parent render and defeat the memoized pages entirely.
  const pageBindings = useMemo(() => {
    const map = new Map<number, PageBinding>();
    for (const page of info?.pages ?? []) {
      map.set(page.index, {
        onSeedReplace: (run: TextRun) => seedReplace(page.index, run),
        onTextBlockSelect: (blockId: string | null) => selectTextBlock(page.index, blockId),
        onParagraphFocus: (paragraphId: string | null) => focusParagraph(page.index, paragraphId),
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
    focusParagraph,
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
          result.report.verification.ok ? (
            <>
              Saved, re-parsed and verified ({result.pageCount} page
              {result.pageCount === 1 ? '' : 's'}) before this download was enabled.
              {isSign && ' The audit note is a local record: it never certifies identity, and it'
                + ' is not our server acknowledging anything.'}
            </>
          ) : (
            <>
              Saved, but {result.report.verification.checks.filter((check) => !check.ok).length} of{' '}
              {result.report.verification.checks.length} verification check
              {result.report.verification.checks.length === 1 ? '' : 's'} failed. This download was
              only offered after you accepted the difference; the receipt names every check.
            </>
          )
        }
      >
        <div className="space-y-3">
          <ExportReceipt
            fileName={result.name}
            pageCount={result.pageCount}
            sizeBytes={result.data.byteLength}
            report={result.report}
          />
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
    sourceDirty ||
    (isOrganize && pageOrderDirty) ||
    (isRedact && redactMarks.length > 0);
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
    if (saving) return;
    if (dirty || aiChangeCount > 0) {
      setLeaveIntent('close');
      return;
    }
    resetAll();
  };
  const requestChangeFile = () => {
    if (saving) return;
    if (dirty || aiChangeCount > 0) {
      setLeaveIntent('change-file');
      return;
    }
    pdfInputRef.current?.click();
  };
  const requestStartOver = () => {
    if (saving) return;
    if (dirty || aiChangeCount > 0) {
      setLeaveIntent('start-over');
      return;
    }
    resetAll();
  };
  const cancelLeave = () => {
    setLeaveIntent(null);
    if (blocker.state === 'blocked') blocker.reset();
  };
  const confirmLeave = () => {
    if (saving) return;
    const intent = leaveIntent;
    setLeaveIntent(null);
    if (!intent) return;
    if (intent === 'change-file') {
      // Keep the editor mounted while the native picker is open. If the user
      // cancels, nothing is lost; if they choose a file, handleFiles performs
      // the reset with the new document in hand. Resetting first used to unmount
      // the input before the picker returned, dropping the chosen file.
      pdfInputRef.current?.click();
      return;
    }
    if (intent === 'close' || intent === 'start-over') {
      resetAll();
      return;
    }
    // A confirmed leave is allowed to pass the same blocker that stopped it.
    allowHistoryLeave.current = true;
    resetAll();
    if (blocker.state === 'blocked') {
      blocker.proceed();
    } else if ('navigate' in intent) {
      navigate(intent.navigate);
    } else {
      navigate(-1);
    }
  };
  const leaveCopy =
    leaveIntent === 'change-file'
      ? {
          title: 'Open a different PDF?',
          body: 'Your edits to this document will be discarded. Save the current file first if you want to keep them.',
          action: 'Discard and choose a file',
          testId: 'editor-confirm-change-file',
        }
      : leaveIntent === 'start-over'
        ? {
            title: 'Start over with this PDF?',
            body: 'This clears every text edit, mark and page change from the current document. Save first if you want a copy.',
            action: 'Discard changes and start over',
            testId: 'editor-confirm-start-over',
          }
        : leaveIntent && typeof leaveIntent === 'object'
          ? {
              title: 'Leave this document?',
              body: 'Your unsaved edits will be discarded when you leave this page. Save first if you want to keep them.',
              action: 'Discard and leave',
              testId:
                'history' in leaveIntent
                  ? 'editor-confirm-history'
                  : 'editor-confirm-navigate',
            }
          : {
              title: 'Close this document?',
              body: 'You have unsaved changes. Closing now discards them and returns to the file picker; save first to keep the verified copy.',
              action: 'Discard and close',
              testId: 'editor-confirm-exit',
            };
  const selectionLabel = selectedObject
    ? selectedObject.role === 'redaction'
      ? 'Redaction mark selected'
      : `${selectedObject.kind[0]!.toUpperCase()}${selectedObject.kind.slice(1)} selected`
    : textSelection
      ? `${textSelection.text.length.toLocaleString()} characters selected`
      : selectedBlockModel
        ? `Text block selected · ${selectedBlockParagraphs.length} paragraph${
            selectedBlockParagraphs.length === 1 ? '' : 's'
          }`
        : isOrganize && selectedPages.size > 0
          ? `${selectedPages.size} page${selectedPages.size === 1 ? '' : 's'} selected`
          : null;
  const inspectorHasContent =
    assistantActive ||
    isRedact ||
    isOrganize ||
    saving ||
    Boolean(selectedObject) ||
    paragraphDetailsOpen ||
    Boolean(selectedBlockModel) ||
    documentPanelOpen;
  const pageCapability = capabilitiesByPage[currentPage] ?? null;
  const ocrRunning = ocrLayerRunner.state.status === 'running';
  const currentOcr = ocrProvenance[currentPage] ?? null;
  const pageEditStatus = describePageEditStatus(pageCapability, currentOcr);
  const currentMetaPage = displayPages[currentDisplayPosition];
  const toolHint = isRedact
    ? TOOL_HELP.redact
    : isOrganize
      ? 'Drag pages to reorder'
      : assistantActive
        ? 'Review proposals before applying'
        : TOOL_HELP[tool];
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

  const toggleDocumentPanel = () => {
    const next = !documentPanelOpen;
    setDocumentPanelOpen(next);
    setMobileInspectorOpen(next);
    // The inspector has one subject. Opening document details closes any object,
    // text-range or block inspector instead of flipping a pressed button with
    // no visible change.
    setSelectedId(null);
    setSelectedTextBlock(null);
    setTextSelection(null);
    setFocusedParagraph(null);
    setParagraphDetailsOpen(false);
  };

  const editorView =
    stage === 'editing' && info ? (
      <div className="editor-route-shell" data-testid="editor-route-shell">
        <div className="editor-shell" data-testid="editor" aria-busy={saving} data-mode={mode}>
          <EditorTopBar
            fileName={files[0]?.name ?? 'Document'}
            mode={mode}
            pageCount={pageCount}
            currentPage={currentDisplayPosition + 1}
            dirty={dirty || aiChangeCount > 0}
            saving={saving}
            saveLabel={saveLabel}
            saveDisabled={ocrRunning || (!dirty && aiChangeCount === 0)}
            saveDisabledReason={
              ocrRunning ? 'wait for OCR to finish' : 'no changes to save'
            }
            showSave={!isAi || hasEdits}
            onSave={() => void onSave()}
            onChangeFile={requestChangeFile}
            onReset={requestStartOver}
            onBack={requestExit}
            onPrevPage={() => goToDisplayPage(currentDisplayPosition - 1)}
            onNextPage={() => goToDisplayPage(currentDisplayPosition + 1)}
            onGoToPage={(pageNumber) => goToDisplayPage(pageNumber - 1)}
            canUndo={editor.canUndo}
            canRedo={editor.canRedo}
            onUndo={undo}
            onRedo={redo}
            onFind={openFind}
            onShortcuts={() => setShortcutsOpen(true)}
            onDocumentInfo={toggleDocumentPanel}
            documentInfoOpen={documentPanelOpen}
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

          {untouchedBlocked && (
            <div
              role="alert"
              data-testid="untouched-pages-block"
              className="mx-3 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                A page this edit did not touch changed its text, so the export was
                blocked. Review the PDF before accepting that difference.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setUntouchedBlocked(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setUntouchedBlocked(null);
                  void onSave(true);
                }}
              >
                Download anyway
              </Button>
            </div>
          )}

          {pageCapability?.likelyScanned && !ocrRunning && (
            <div
              data-testid="ocr-scan-banner"
              className="mx-3 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                This page is a scan — it has no text layer. Read it with OCR? The
                page stays exactly as supplied; only invisible, searchable text is
                added, and nothing leaves this device.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="ocr-read-page"
                onClick={() => void runOcrLayer('page')}
              >
                Read this page
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="ocr-read-document"
                onClick={() => void runOcrLayer('document')}
              >
                Read scanned pages
              </Button>
            </div>
          )}

          {ocrRunning && (
            <div
              role="status"
              aria-live="polite"
              data-testid="ocr-progress"
              className="mx-3 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                {ocrLayerRunner.state.status === 'running' && ocrLayerRunner.state.progress
                  ? `${ocrLayerRunner.state.progress.phase}${
                      ocrLayerRunner.state.progress.ratio !== undefined
                        ? ` — ${Math.round(ocrLayerRunner.state.progress.ratio * 100)}%`
                        : ''
                    }`
                  : 'Reading the scan'}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="ocr-cancel"
                onClick={ocrLayerRunner.cancel}
              >
                Cancel
              </Button>
            </div>
          )}

          {!ocrRunning &&
            (currentOcr ||
              pageCapability?.textLayer === 'ocr' ||
              pageCapability?.textLayer === 'mixed') && (
              <div
                data-testid="ocr-provenance"
                className="mx-3 mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
              >
                {currentOcr
                  ? `OCR text layer added in this session: ${Math.round(currentOcr.confidence)}% mean confidence, ${currentOcr.wordCount.toLocaleString()} words read. Check the text before relying on it.`
                  : 'Invisible OCR text layer. Confidence was not recorded in this session; check the text before relying on it.'}
              </div>
            )}

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
                canInspectSelection={
                  selectedObject !== null ||
                  textSelection !== null ||
                  selectedBlockModel !== null ||
                  (isOrganize && selectedPages.size > 0)
                }
                canReorder={canReorder}
                canSendBack={canSendBack}
                onPatch={patchObject}
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
                onFitPage={fitPage}
                stampPreset={stampPreset}
                onStampPreset={setStampPreset}
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

              <EditorFindPanel
                open={findOpen}
                query={findQuery}
                replacement={findReplacement}
                caseSensitive={findCase}
                wholeWord={findWholeWord}
                matches={findMatches}
                activeIndex={findActive}
                searching={findSearching}
                pagesSearched={Object.keys(layoutsByPage).length}
                pagesMissing={findFailedPages.length}
                failedPages={findFailedPages}
                totalPages={info.pageCount}
                error={findError}
                disabled={saving}
                onQueryChange={setFindQuery}
                onReplacementChange={setFindReplacement}
                onToggleCase={() => setFindCase((value) => !value)}
                onToggleWholeWord={() => setFindWholeWord((value) => !value)}
                onNext={() => jumpToFindMatch(findActive + 1)}
                onPrev={() => jumpToFindMatch(findActive - 1)}
                onJump={jumpToFindMatch}
                onReplaceAll={replaceAllMatches}
                onClose={closeFind}
              />

              {draftError ? (
                <p
                  className="shrink-0 border-b border-amber-300/60 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
                  role="alert"
                  data-testid="editor-draft-error"
                >
                  Autosave: {draftError}
                </p>
              ) : null}

              <div
                className="editor-workspace"
                data-rail={editor.railOpen ? 'open' : 'closed'}
                data-inspector={mobileInspectorOpen ? 'open' : 'closed'}
                data-inspector-empty={inspectorHasContent ? 'false' : 'true'}
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
                        stampPreset={stampPreset}
                        debugOutline={showTextOutlines}
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
                        onParagraphFocus={binding.onParagraphFocus}
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
                    <button
                      type="button"
                      className="editor-mobile-hud-btn"
                      aria-label="Fit page"
                      title="Fit page"
                      data-testid="mobile-fit-page"
                      onClick={fitPage}
                    >
                      <Maximize2 className="size-4" />
                    </button>
                  </div>
                </div>

                <aside
                  className="editor-inspector-rail"
                  data-empty={inspectorHasContent ? 'false' : 'true'}
                  aria-label="Properties inspector"
                >
                  <div className="h-full min-h-0" hidden={!assistantActive}>
                    {aiMounted && files[0] ? (
                      <EditorAiPanel
                        file={files[0]}
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
                              objects: doc.objects.filter((object) => object.role !== 'redaction'),
                            }))
                          }
                        >
                          Clear all marks
                        </Button>
                      </div>
                    </div>
                  ) : !assistantActive && isOrganize ? (
                    <div className="editor-panel" data-testid="editor-pages-inspector">
                      <p className="editor-panel-title">
                        {pageOrder.length} page{pageOrder.length === 1 ? '' : 's'}
                      </p>
                      <p className="editor-panel-copy">
                        Drag pages in the rail to reorder. Ctrl/Cmd-click selects more than one;
                        duplicated pages reuse the same source until you save.
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
                          data-testid="insert-pages-button"
                          disabled={saving || insertingPages}
                          onClick={() => insertPagesInputRef.current?.click()}
                        >
                          <FilePlus2 className="mr-1.5 size-3.5" />
                          {insertingPages ? 'Inserting pages' : 'Insert pages from PDF'}
                        </Button>
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
                        onClose={() => {
                          // On a phone the sheet is dismissible and the object
                          // stays selected, so the next drag keeps working. On
                          // a docked desktop inspector, Close means deselect.
                          if (window.matchMedia?.('(max-width: 599px)').matches) {
                            setMobileInspectorOpen(false);
                          } else {
                            select(null);
                          }
                        }}
                        docked
                      />
                    </AnimatedContent>
                  ) : !assistantActive &&
                    paragraphDetailsOpen &&
                    focusedParagraphModel &&
                    focusedParagraph &&
                    focusedLayout ? (
                    <EditorParagraphDetails
                      paragraph={focusedParagraphModel}
                      layout={focusedLayout}
                      capability={capabilitiesByPage[focusedParagraph.pageIndex] ?? null}
                      record={focusedRecord}
                      outcome={focusedOutcome}
                      ocrConfidence={ocrProvenance[focusedParagraph.pageIndex]?.confidence ?? null}
                      disabled={saving}
                      onBack={() => setParagraphDetailsOpen(false)}
                      onEdit={() =>
                        startParagraphEdit(
                          focusedParagraph.pageIndex,
                          focusedParagraph.paragraphId,
                          null,
                        )
                      }
                      onRevert={revertFocusedParagraph}
                    />
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
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {CAPABILITY_SNAPSHOT_NOTE}
                        </p>
                      </div>
                      {selectedBlockPreview && (
                        <p className="line-clamp-5 text-xs leading-relaxed text-muted-foreground">
                          {selectedBlockPreview}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
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
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          data-testid="editor-paragraph-details-open"
                          disabled={
                            !focusedParagraph ||
                            !selectedBlockModel.paragraphIds.includes(
                              focusedParagraph.paragraphId,
                            ) ||
                            !focusedParagraphModel
                          }
                          onClick={() => setParagraphDetailsOpen(true)}
                        >
                          Detection details
                        </Button>
                        {focusedRecord ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            data-testid="editor-paragraph-revert"
                            disabled={saving}
                            onClick={revertFocusedParagraph}
                          >
                            Revert edit
                          </Button>
                        ) : null}
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Double-click a paragraph to edit it. Drag across text to select and copy.
                      </p>
                    </div>
                  ) : !assistantActive && documentPanelOpen ? (
                    <div className="editor-panel" data-testid="editor-inspector-empty">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="editor-panel-kicker">Document</p>
                          <p className="editor-panel-title">
                            {currentMetaPage
                              ? `Page ${currentDisplayPosition + 1} of ${pageCount}`
                              : 'No page selected'}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="editor-topbar-icon"
                          aria-label="Close document details"
                          onClick={() => {
                            setDocumentPanelOpen(false);
                            setMobileInspectorOpen(false);
                          }}
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                      <p className="editor-panel-copy">{pageEditStatus}</p>
                      <p className="editor-panel-copy text-[11px] text-muted-foreground">
                        {CAPABILITY_SNAPSHOT_NOTE}
                      </p>

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

                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={showTextOutlines}
                          onChange={(event) => setShowTextOutlines(event.target.checked)}
                          data-testid="editor-outline-toggle"
                          className="size-3.5 accent-blue-600"
                        />
                        Outline detected text
                      </label>

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

                      <div className="editor-panel-actions">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setShortcutsOpen(true)}
                        >
                          Keyboard shortcuts
                        </Button>
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
            pageCount={pageCount}
            currentPage={currentDisplayPosition}
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
          <span className="sr-only" data-testid="editor-draft-saved" aria-live="polite">
            {draftSavedAt ? 'Draft saved' : ''}
          </span>
          <span className="sr-only" data-testid="editor-live-status" aria-live="polite">
            {ocrRunning
              ? 'Reading the scan'
              : findSearching
                ? 'Searching the document'
                : saving
                  ? 'Saving a verified copy'
                  : (selectionLabel ?? '')}
          </span>

          <EditorShortcutsDialog
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
            mode={mode}
            tools={toolsForMode(mode)}
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

          {leaveIntent ? (
            <div
              className="editor-confirm-layer"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  cancelLeave();
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
                  {leaveCopy.title}
                </h2>
                <p className="editor-confirm-copy">{leaveCopy.body}</p>
                <div className="editor-confirm-actions">
                  <Button variant="ghost" size="sm" autoFocus onClick={cancelLeave}>
                    Keep editing
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    data-testid={leaveCopy.testId}
                    onClick={confirmLeave}
                  >
                    {leaveCopy.action}
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
            ref={insertPagesInputRef}
            type="file"
            accept={PDF_ACCEPT}
            multiple
            className="hidden"
            aria-hidden
            tabIndex={-1}
            data-testid="insert-pages-input"
            onChange={(event) => {
              const picked = event.target.files ? [...event.target.files] : [];
              if (picked.length > 0) void insertPagesFromPdf(picked);
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
        <div className="space-y-4">
          {draft ? (
            <div
              className="rounded-lg border bg-card px-4 py-3 shadow-sm"
              role="status"
              data-testid="editor-draft-banner"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Unsaved draft found</p>
                  <p className="truncate text-xs text-muted-foreground" data-testid="editor-draft-meta">
                    {draft.name}
                    {draftSavedAt ? ` · saved ${new Date(draftSavedAt).toLocaleString()}` : ''}
                    {` · ${draft.doc.objects.length} edit${draft.doc.objects.length === 1 ? '' : 's'}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    data-testid="editor-draft-restore"
                    disabled={draftRestoring}
                    onClick={() => void restoreDraft()}
                  >
                    {draftRestoring ? 'Restoring…' : 'Restore draft'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="editor-draft-discard"
                    disabled={draftRestoring}
                    onClick={() => void discardDraft()}
                  >
                    Discard
                  </Button>
                </div>
              </div>
              {draftError ? (
                <p
                  className="mt-2 text-xs leading-relaxed text-destructive"
                  role="alert"
                  data-testid="editor-draft-error"
                >
                  {draftError}
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Drafts are stored on this device only and are cleared when you save.
                </p>
              )}
              <span className="sr-only" aria-live="polite">
                {draftRestoring ? 'Restoring the draft.' : ''}
              </span>
            </div>
          ) : null}

          {mode === 'ai' ? (
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
          )}
        </div>
      )}

      {editorView ? createPortal(editorView, document.body) : null}
    </>
  );
}
