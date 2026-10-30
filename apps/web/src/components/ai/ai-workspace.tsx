/**
 * The AI workspace: the shell every AI tool shares.
 *
 * Two panes: the document on the left (one legible page, with pending changes
 * drawn on it) and the assistant on the right (streaming answers, an activity
 * timeline, clickable page citations), plus the review/apply panel for the
 * editor. Text extraction and page rendering run through the same worker pool as
 * every other tool; the model never sees bytes, only the text this layer hands
 * it, and only the path the user chose (their key in this tab, or the trial).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  KeyRound,
  Loader2,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wand2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AiSettings } from '@pdfshush/ai-provider/browser';
import { AiChat } from '@/components/ai/ai-chat';
import { AiDocumentPane, type OverlayMarker } from '@/components/ai/ai-document-pane';
import { AiSettingsCard } from '@/components/ai/ai-settings-card';
import { AiWelcomeOverlay } from '@/components/ai/ai-welcome-overlay';
import { EditPlanPanel, type BlockedEditChange } from '@/components/ai/edit-plan-panel';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useMotionScope } from '@/hooks/use-motion';
import { usePageThumbnails } from '@/hooks/use-page-thumbnails';
import { downloadBytes } from '@/lib/download';
import { aiReady, clearAiSettings, loadAiSettings, loadAiState, saveAiSettings, storedKeyPresent } from '@/lib/ai/settings';
import { managedAvailable } from '@/lib/ai/managed';
import { aiWelcomeAnswered, markAiWelcomeAnswered } from '@/lib/ai/welcome';
import { loadAiMode, saveAiMode, type AiMode } from '@/lib/ai/mode';
import {
  applyEditPlan,
  createPdfEditSkill,
  editPlanIsEmpty,
  type AiPlanApplyResult,
  type ApplyStep,
} from '@/lib/ai/edit-skill';
import { extractDocumentText, extractEditDocument, type AiDocument } from '@/lib/ai/pdf-session';
import { EASE, DUR, dur, staggerUI } from '@/lib/motion';
import { recordRecent } from '@/tools/recent';

/** Which AI surface this is; only the copy, the skill and the extra panel differ. */
export type AiToolVariant = 'summarize' | 'chat' | 'edit';

/** Preview render width: legible enough to read a clause, cheap because it is one page. */
const PREVIEW_WIDTH_PX = 900;

interface VariantCopy {
  title: string;
  blurb: string;
  bullets: [string, string, string];
  placeholder: string;
  suggestions?: string[];
}

const COPY: Record<AiToolVariant, VariantCopy> = {
  summarize: {
    title: 'Summarize any PDF in seconds',
    blurb: 'A grounded summary with page citations; every claim points at the page it came from.',
    bullets: ['Read straight from the page text', 'Citations you can click', 'Your key stays in this browser'],
    placeholder: 'Ask a follow-up about this document…',
  },
  chat: {
    title: 'Chat with your PDF',
    blurb: 'Ask anything. The assistant reads the document page by page and cites what it used.',
    bullets: ['Multi-step reading, not one guess', 'Citations jump the preview', 'Nothing is stored on a server'],
    placeholder: 'Ask a question about this PDF…',
    suggestions: [
      'What is this document about?',
      'List every date, amount and name.',
      'Summarize the key points.',
    ],
  },
  edit: {
    title: 'Edit a PDF by describing it',
    blurb: 'Ask in plain language, review exactly what will change, then apply it in one click.',
    bullets: ['Highlight, rewrite, erase, insert', 'Reorder, rotate, stamp', 'Nothing is written until you apply'],
    placeholder: 'Describe a change, e.g. “Highlight every date on page 1”.',
    suggestions: ['Highlight every date on page 1', 'Add page numbers', 'Delete the last page'],
  },
};

interface AiWorkspaceProps {
  variant: AiToolVariant;
  /** Instruction run once the document is ready (summarize). */
  autoPrompt?: string | undefined;
}

/** Shared shell for the three AI tools: load a PDF, then summarize / chat / edit. */
export function AiWorkspace({ variant, autoPrompt }: AiWorkspaceProps) {
  const copy = COPY[variant];

  const [file, setFile] = useState<File | null>(null);
  const [doc, setDoc] = useState<AiDocument | null>(null);
  const [docKey, setDocKey] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<AiMode>(() => loadAiMode());
  const [managedOk, setManagedOk] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  const [activePage, setActivePage] = useState(1);
  const [pageSizes, setPageSizes] = useState<{ width: number; height: number }[] | null>(null);
  const [cited, setCited] = useState<number[]>([]);

  const [planVersion, setPlanVersion] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyStep, setApplyStep] = useState<ApplyStep | null>(null);
  const [applyProgress, setApplyProgress] = useState(0);
  const [applyError, setApplyError] = useState<string | null>(null);
  /**
   * What the last apply refused, keyed by the engine's edit ids. A refusal is
   * not an error state: nothing was written, each refused edit keeps its card
   * (flagged amber, with its reason), and the plan is still triageable —
   * discard the failed entries and the rest applies. Cleared by a successful
   * apply, by picking another file, and by starting over.
   */
  const [refused, setRefused] = useState<{ failed: Map<string, string>; message: string } | null>(
    null,
  );
  const [result, setResult] = useState<AiPlanApplyResult | null>(null);
  const applyAbort = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  const {
    tiles,
    prepare: preparePreview,
    reset: resetPreview,
  } = usePageThumbnails();

  // `prepare` closes over the two job runners, so its identity changes every
  // render. The preview effect reaches it through a ref instead of re-running on
  // that churn (which would otherwise re-render a page on every render).
  const prepareRef = useRef(preparePreview);
  prepareRef.current = preparePreview;

  useEffect(() => {
    let alive = true;
    // Hydrate once from IndexedDB (or the legacy localStorage pair, migrated on
    // first read). Both halves arrive together so mode and settings agree.
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

  useEffect(() => () => applyAbort.current?.abort(), []);

  /* ------------------------------------------------------------- document */

  const pick = useCallback(
    (files: File[]) => {
      const next = files[0];
      if (!next) return;
      setFile(next);
      setDoc(null);
      setResult(null);
      setError(null);
      setApplyError(null);
      setRefused(null);
      setPageSizes(null);
      setCited([]);
      setActivePage(1);
      setPlanVersion((version) => version + 1);
      setDocKey((key) => key + 1);
    },
    [],
  );

  useEffect(() => {
    if (!file) return;
    const runId = (runIdRef.current += 1);
    const current = () => runIdRef.current === runId;
    setExtracting(true);
    setExtractProgress(0);
    setError(null);
    const extract = variant === 'edit' ? extractEditDocument : extractDocumentText;
    extract(file, (ratio) => {
      if (current()) setExtractProgress(ratio);
    })
      .then((next) => {
        if (!current()) return;
        setDoc(next);
        if (next.pageSizes) setPageSizes(next.pageSizes);
      })
      .catch((cause: unknown) => {
        if (current()) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (current()) setExtracting(false);
      });
  }, [file, variant]);

  // One legible render of the active page. `prepare` supersedes in flight work,
  // so a fast page flip never installs a stale image.
  useEffect(() => {
    if (!file) return;
    let alive = true;
    void prepareRef.current([file], {
      pageIndexes: [Math.max(0, activePage - 1)],
      targetWidthPx: PREVIEW_WIDTH_PX,
      onInspected: (info) => {
        if (!alive) return;
        const sizes = (info.documents[0]?.pages ?? []).map((page) => ({
          width: page.displayWidthPt ?? page.widthPt,
          height: page.displayHeightPt ?? page.heightPt,
        }));
        if (sizes.length > 0) setPageSizes(sizes);
      },
    });
    return () => {
      alive = false;
    };
  }, [file, activePage]);

  const reset = useCallback(() => {
    resetPreview();
    applyAbort.current?.abort();
    setFile(null);
    setDoc(null);
    setResult(null);
    setError(null);
    setApplyError(null);
    setRefused(null);
    setPageSizes(null);
    setCited([]);
    setActivePage(1);
    setApplyStep(null);
    setApplying(false);
  }, [resetPreview]);

  /* --------------------------------------------------------------- editor */

  const bumpPlan = useCallback(() => setPlanVersion((version) => version + 1), []);

  const editor = useMemo(
    () =>
      variant === 'edit' && doc
        ? createPdfEditSkill(doc, { onChange: bumpPlan, onGotoPage: setActivePage })
        : null,
    [variant, doc, bumpPlan],
  );

  const entries = useMemo(
    () => editor?.plan().entries ?? [],
    // `planVersion` is the change signal the skill's tools fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, planVersion],
  );

  const markers: OverlayMarker[] = useMemo(() => {
    if (!editor) return [];
    return editor
      .plan()
      .objects.filter((object) => object.pageIndex === activePage - 1)
      .map((object) => ({
        id: object.id,
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        tone: object.kind === 'whiteout' ? 'erase' : object.kind === 'text' ? 'text' : 'mark',
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, activePage, planVersion]);

  /**
   * Pages with a queued change. The overlay markers only cover the page on
   * screen, so this is what tells the page rail, and the user, that a change
   * is waiting somewhere else in the document.
   */
  const changedPages: number[] = useMemo(() => {
    if (!editor) return [];
    const pages = new Set<number>();
    for (const entry of editor.plan().entries) for (const page of entry.pages) pages.add(page);
    return [...pages].sort((a, b) => a - b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, planVersion]);

  /**
   * The engine's refusal report, parsed back into one reason per refused edit.
   * The format is the engine's own stable shape ("  - kind: edit "id" detail"),
   * and each quoted edit id is an overlay object id an additive entry owns —
   * so id → entry is a membership check, and ids no queued entry claims (from
   * a stale or unrelated failure) simply contribute nothing.
   */
  const classifyRefusal = useCallback((message: string): Map<string, string> => {
    const failed = new Map<string, string>();
    for (const line of message.split('\n')) {
      const match = line.match(/^\s*-\s*[\w-]+:\s*edit "([^"]+)"\s*(.+)$/);
      if (match) failed.set(match[1]!, match[2]!.trim());
    }
    return failed;
  }, []);

  /** Derived from the *current* entries, so manual discards shrink it live. */
  const blockedChanges: BlockedEditChange[] = useMemo(() => {
    if (!editor || !refused || refused.failed.size === 0) return [];
    const out: BlockedEditChange[] = [];
    for (const entry of editor.plan().entries) {
      const failedId = entry.objectIds.find((id) => refused.failed.has(id));
      if (failedId !== undefined) {
        const reason = refused.failed.get(failedId);
        if (reason) out.push({ entry, reason });
      }
    }
    return out;
    // `plan()` mutates in place; planVersion gates the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, refused, planVersion]);

  const apply = useCallback(async () => {
    const target = file;
    const active = editor;
    if (!target || !active || !doc) return;
    const plan = active.plan();
    if (editPlanIsEmpty(plan)) return;
    const controller = new AbortController();
    applyAbort.current = controller;
    setApplying(true);
    setApplyProgress(0);
    setApplyStep(null);
    setApplyError(null);
    try {
      const pageCount = doc.pages.length;
      const output = await applyEditPlan(target, plan, {
        pageCount,
        signal: controller.signal,
        onProgress: setApplyProgress,
        onStep: setApplyStep,
      });
      setResult(output);
      active.clear();
      setRefused(null);
      void recordRecent({
        toolSlug: 'edit-pdf-with-ai',
        toolName: 'Edit PDF with AI',
        fileName: output.name,
        pageCount,
        sizeBytes: output.data.byteLength,
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      // A parseable refusal becomes per-entry triage (amber card + reasons),
      // not a dead end. Anything unparseable stays a plain error.
      const failed = classifyRefusal(message);
      if (failed.size > 0) setRefused({ failed, message });
      else setApplyError(message);
    } finally {
      setApplying(false);
      applyAbort.current = null;
      setApplyStep(null);
    }
  }, [editor, file, doc, classifyRefusal]);

  /** One click forward: drop every refused change, then apply what remains. */
  const retryWithoutFailed = useCallback(() => {
    const active = editor;
    const failed = refused?.failed;
    if (!active || !failed || failed.size === 0) return;
    for (const entry of active.plan().entries) {
      if (entry.objectIds.some((id) => failed.has(id))) active.discard(entry.id);
    }
    setRefused(null);
    void apply();
  }, [editor, refused, apply]);

  const onSaveSettings = (next: AiSettings) => {
    setSettings(saveAiSettings(next));
    setShowSettings(false);
  };

  const onForgetKey = () => {
    void clearAiSettings().then((next) => {
      setSettings(next);
      setShowSettings(false);
      toast.success('Key removed', { description: 'The stored key was erased from this browser.' });
    });
  };

  const changeMode = (next: AiMode) => {
    setMode(next);
    saveAiMode(next);
  };

  // A stored "managed" choice is ignored on a deployment that does not offer it.
  const effectiveMode: AiMode = mode === 'managed' && managedOk ? 'managed' : 'byok';
  const ready = effectiveMode === 'managed' ? true : aiReady(settings);

  /**
   * The two panes enter with the shared choreography, once per document. The
   * hidden base is applied here rather than in markup so a run cut short —
   * or a reduced-motion browser — can never strand the panes invisible: if
   * this effect never completes, nothing was ever hidden.
   */
  const motion = useMotionScope();
  const panesRef = useRef<HTMLDivElement>(null);
  const enteredFor = useRef(-1);
  useLayoutEffect(() => {
    const root = panesRef.current;
    if (!root || !doc || !ready || enteredFor.current === docKey) return;
    enteredFor.current = docKey;
    const nodes = root.querySelectorAll<HTMLElement>('[data-ai-enter]');
    for (const node of nodes) node.style.opacity = '0';
    motion.animate(nodes, {
      translateY: [12, 0],
      opacity: [0, 1],
      duration: dur(DUR.slow),
      ease: EASE.out,
      delay: staggerUI(80),
    });
  }, [doc, ready, docKey, motion]);

  /* ------------------------------------------------------------- welcome */
  //
  // The first-run walkthrough opens only where BYOK is genuinely unusable
  // (no key anywhere, started in BYOK mode) and only once per browser: the
  // open itself writes the answered marker, so dismissing or completing keeps
  // it away even after the key is forgotten later. The short delay lets the
  // IndexedDB hydration race win — a browser that already had a key never
  // sees the overlay blink open and shut. Placed after `effectiveMode`, whose
  // value its dependency array reads on the very first render.
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

  const dismissWelcome = useCallback(() => setWelcomeOpen(false), []);
  const pageCount = doc?.pages.length ?? 0;
  const previewTile = tiles.find((tile) => tile.pageIndex === activePage - 1);
  const activeSize = pageSizes?.[activePage - 1];

  if (result) {
    return (
      <ResultPanel
        fileName={result.name}
        pageCount={pageCount}
        sizeBytes={result.data.byteLength}
        onDownload={() => downloadBytes(result.data, result.name)}
        onReset={reset}
        footerNote="Applied through the editing engine: replaced and erased text was rewritten in the document's own runs (covered and redrawn only where a rewrite was impossible), overlay edits were drawn, page changes were rebuilt, and the result was re-parsed and re-extracted before being offered for download."
      />
    );
  }

  if (!file) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-primary/[0.06] via-card to-card">
        <div className="mx-auto max-w-xl px-6 pb-2 pt-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="h-6 w-6" />
          </span>
          <h2 className="mt-4 text-xl font-semibold tracking-tight">{copy.title}</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{copy.blurb}</p>
        </div>

        <div className="px-6 pb-6 pt-4">
          <FileDropzone
            files={[]}
            onFiles={pick}
            multiple={false}
            hint="one PDF to work on"
            note="Parsed on this device; no file is ever uploaded"
          />
        </div>

        <ul className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
          {copy.bullets.map((bullet, index) => (
            <li key={bullet} className="flex items-start gap-2.5 bg-card px-5 py-4">
              {index === 0 ? (
                <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              ) : index === 1 ? (
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              ) : (
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              )}
              <span className="text-xs text-muted-foreground">{bullet}</span>
            </li>
          ))}
        </ul>

        {!ready ? (
          <div className="border-t border-border px-6 py-5">
            <AiSettingsCard
              settings={settings}
              onSave={onSaveSettings}
              mode={effectiveMode}
              onModeChange={changeMode}
              managedAvailable={managedOk}
              {...(storedKeyPresent(settings) ? { onForget: onForgetKey } : {})}
            />
          </div>
        ) : null}

        {welcomeOpen ? (
          <AiWelcomeOverlay
            settings={settings}
            onSave={onSaveSettings}
            managedAvailable={managedOk}
            onUseManaged={() => changeMode('managed')}
            onDismiss={dismissWelcome}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{file.name}</span>
          {doc ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {doc.pages.length} page{doc.pages.length === 1 ? '' : 's'}
            </span>
          ) : null}
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[0.7rem] text-muted-foreground">
            {effectiveMode === 'managed' ? (
              <>
                <Sparkles className="h-3 w-3" /> PDFShush trial
              </>
            ) : (
              <>
                <KeyRound className="h-3 w-3" /> Your key
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => setShowSettings((open) => !open)}
          >
            <Settings2 className="mr-1.5 h-4 w-4" /> AI settings
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={reset}>
            <RotateCcw className="mr-1.5 h-4 w-4" /> New file
          </Button>
        </div>
      </div>

      {extracting ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Reading the document…
          <div className="ml-auto w-40">
            <Progress value={Math.round(extractProgress * 100)} />
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Could not read {file.name}: {error}
        </p>
      ) : null}

      {showSettings || !ready ? (
        <AiSettingsCard
          settings={settings}
          onSave={onSaveSettings}
          mode={effectiveMode}
          onModeChange={changeMode}
          managedAvailable={managedOk}
          {...(storedKeyPresent(settings) ? { onForget: onForgetKey } : {})}
        />
      ) : null}

      {doc && ready ? (
        <div ref={panesRef} className="grid gap-4 lg:grid-cols-2">
          <div data-ai-enter className="h-[34rem]">
            <AiDocumentPane
              fileName={doc.fileName}
              pageCount={pageCount}
              page={activePage}
              onPageChange={setActivePage}
              imageUrl={previewTile?.url}
              pageSize={activeSize}
              markers={markers}
              changedPages={changedPages}
              cited={cited}
              loading={!previewTile}
            />
          </div>

          <div data-ai-enter className="flex h-[34rem] flex-col gap-4">
            <div className="min-h-0 flex-1">
              <AiChat
                key={docKey}
                doc={doc}
                settings={settings}
                mode={effectiveMode}
                skill={editor?.skill}
                activePage={activePage}
                onShowPage={setActivePage}
                onCitedPages={setCited}
                autoPrompt={autoPrompt}
                placeholder={copy.placeholder}
                suggestions={copy.suggestions}
              />
            </div>
            {variant === 'edit' && editor ? (
              <EditPlanPanel
                entries={entries}
                applying={applying}
                step={applyStep}
                progress={applyProgress}
                error={applyError}
                blocked={blockedChanges.length > 0 ? blockedChanges : undefined}
                blockedDetail={refused?.message ?? null}
                onDiscard={(id) => editor.discard(id)}
                onDiscardAll={() => editor.clear()}
                onApply={() => void apply()}
                onRetryWithoutFailed={retryWithoutFailed}
                onStop={() => applyAbort.current?.abort()}
                onShowPage={setActivePage}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {doc && !ready ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Wand2 className="h-3.5 w-3.5" /> Add a provider above to start. Your key is stored in this
          browser only.
        </p>
      ) : null}

      {welcomeOpen ? (
        <AiWelcomeOverlay
          settings={settings}
          onSave={onSaveSettings}
          managedAvailable={managedOk}
          onUseManaged={() => changeMode('managed')}
          onDismiss={dismissWelcome}
        />
      ) : null}
    </div>
  );
}
