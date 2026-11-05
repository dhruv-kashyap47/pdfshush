/**
 * The AI studio: the shell every AI tool shares.
 *
 * The document is the work. One stage holds a legible page on a mat; the margin
 * beside it holds instructions, the assistant's reading and — for the editor —
 * a ledger of every proposed change. Nothing is written until the ledger is
 * applied, and the success state is a receipt rather than a toast.
 *
 * Text extraction and page rendering run through the same worker pool as every
 * other tool; the model never sees bytes, only the text this layer hands it,
 * and only the path the user chose (their key in this tab, or the trial).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FileWarning, Loader2, RotateCcw, Settings2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { AiSettings } from '@pdfshush/ai-provider/browser';
import { AiChat } from '@/components/ai/ai-chat';
import { AiCover } from '@/components/ai/ai-cover';
import { AiDocumentPane, type OverlayMarker } from '@/components/ai/ai-document-pane';
import { AiExport } from '@/components/ai/ai-export';
import { AiSettingsCard } from '@/components/ai/ai-settings-card';
import { AiSetupSection } from '@/components/ai/ai-setup-section';
import { AiWelcomeOverlay } from '@/components/ai/ai-welcome-overlay';
import { EditPlanPanel, type BlockedEditChange } from '@/components/ai/edit-plan-panel';
import { StudioMasthead } from '@/components/ai/studio-masthead';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMotionScope } from '@/hooks/use-motion';
import { usePageThumbnails } from '@/hooks/use-page-thumbnails';
import { downloadBytes } from '@/lib/download';
import { formatBytes } from '@/lib/format';
import { getTool } from '@/tools/registry';
import { useToolSlug } from '@/tools/tool-context';
import {
  aiReady,
  clearAiSettings,
  loadAiSettings,
  loadAiState,
  saveAiSettings,
  storedKeyPresent,
} from '@/lib/ai/settings';
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
import { DUR, EASE, dur, prefersReducedMotion, staggerUI } from '@/lib/motion';
import { recordRecent } from '@/tools/recent';

import { COPY, type AiToolVariant } from '@/components/ai/tool-copy';

/** Preview render width: legible enough to read a clause, cheap because it is one page. */
const PREVIEW_WIDTH_PX = 900;

interface AiWorkspaceProps {
  variant: AiToolVariant;
  /** Instruction run once the document is ready (summarize). */
  autoPrompt?: string | undefined;
}

/** Shared shell for the three AI tools: load a PDF, then summarize / chat / edit. */
export function AiWorkspace({ variant, autoPrompt }: AiWorkspaceProps) {
  const copy = COPY[variant];
  const slug = useToolSlug();
  const toolName = (slug ? getTool(slug)?.name : undefined) ?? 'AI PDF editor';

  const [file, setFile] = useState<File | null>(null);
  const [doc, setDoc] = useState<AiDocument | null>(null);
  const [docKey, setDocKey] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<AiMode>(() => loadAiMode());
  const [managedOk, setManagedOk] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  const [activePage, setActivePage] = useState(1);
  const [pageSizes, setPageSizes] = useState<{ width: number; height: number }[] | null>(null);
  const [cited, setCited] = useState<number[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

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
  /** The output's page count: plan.order is the final structure when pages moved. */
  const [resultPageCount, setResultPageCount] = useState<number | null>(null);
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

  const pick = useCallback((files: File[]) => {
    const next = files[0];
    if (!next) return;
    setFile(next);
    setDoc(null);
    setResult(null);
    setResultPageCount(null);
    setError(null);
    setApplyError(null);
    setRefused(null);
    setPageSizes(null);
    setCited([]);
    setPreviewError(null);
    setActivePage(1);
    setPlanVersion((version) => version + 1);
    setDocKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (!file) return;
    const runId = (runIdRef.current += 1);
    const controller = new AbortController();
    const current = () => runIdRef.current === runId && !controller.signal.aborted;
    setExtracting(true);
    setExtractProgress(0);
    setError(null);
    const extract = variant === 'edit' ? extractEditDocument : extractDocumentText;
    extract(
      file,
      (ratio) => {
        if (current()) setExtractProgress(ratio);
      },
      controller.signal,
    )
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
    return () => controller.abort();
  }, [file, variant]);

  // One legible render of the active page. `prepare` supersedes in flight work,
  // so a fast page flip never installs a stale image.
  useEffect(() => {
    if (!file) return;
    let alive = true;
    setPreviewError(null);
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
    }).then((ok) => {
      if (!alive || ok) return;
      setPreviewError('This page could not be rendered. The document is still open.');
    }).catch((cause: unknown) => {
      if (!alive) return;
      setPreviewError(cause instanceof Error ? cause.message : 'This page could not be rendered.');
    });
    return () => {
      alive = false;
    };
  }, [file, activePage, previewNonce]);

  const reset = useCallback(() => {
    resetPreview();
    applyAbort.current?.abort();
    setFile(null);
    setDoc(null);
    setResult(null);
    setResultPageCount(null);
    setError(null);
    setApplyError(null);
    setRefused(null);
    setPageSizes(null);
    setCited([]);
    setPreviewError(null);
    setActivePage(1);
    setApplyStep(null);
    setApplying(false);
    setSettingsOpen(false);
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
      const outputPages = plan.order ? plan.order.length : pageCount;
      setResult(output);
      setResultPageCount(outputPages);
      active.clear();
      setRefused(null);
      void recordRecent({
        toolSlug: 'edit-pdf-with-ai',
        toolName: 'Edit PDF with AI',
        fileName: output.name,
        pageCount: outputPages,
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
    setSettingsOpen(false);
  };

  const onForgetKey = () => {
    void clearAiSettings().then((next) => {
      setSettings(next);
      setSettingsOpen(false);
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
   * The document and its margin enter together, once per document. The hidden
   * base is applied here rather than in markup so a run cut short — or a
   * reduced-motion browser — can never strand the panes invisible.
   */
  const motion = useMotionScope();
  const panesRef = useRef<HTMLDivElement>(null);
  const enteredFor = useRef(-1);
  useLayoutEffect(() => {
    const root = panesRef.current;
    if (!root || !doc || !ready || enteredFor.current === docKey) return;
    enteredFor.current = docKey;
    if (prefersReducedMotion()) return;
    const nodes = root.querySelectorAll<HTMLElement>('[data-ai-enter]');
    for (const node of nodes) node.style.opacity = '0';
    motion.animate(nodes, {
      translateY: [12, 0],
      opacity: [0, 1],
      duration: dur(DUR.slow),
      ease: EASE.out,
      delay: staggerUI(90),
    });
    const paper = root.querySelector<HTMLElement>('.studio-paper');
    if (paper) {
      motion.animate(paper, {
        scale: [0.988, 1],
        duration: dur(DUR.slow + 180),
        ease: EASE.out,
      });
    }
  }, [doc, ready, docKey, motion]);

  /* ------------------------------------------------------------- welcome */
  //
  // The first-run walkthrough opens only where BYOK is genuinely unusable
  // (no key anywhere, started in BYOK mode) and only once per browser: the
  // open itself writes the answered marker, so dismissing or completing keeps
  // it away even after the key is forgotten later. The short delay lets the
  // IndexedDB hydration race win — a browser that already had a key never
  // sees the overlay blink open and shut.
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

  const settingsCard = (showHead: boolean) => (
    <AiSettingsCard
      settings={settings}
      onSave={onSaveSettings}
      mode={effectiveMode}
      onModeChange={changeMode}
      managedAvailable={managedOk}
      surface="plain"
      showHead={showHead}
      {...(storedKeyPresent(settings) ? { onForget: onForgetKey } : {})}
    />
  );

  const settingsTrigger = (
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="studio-action"
          aria-label={ready ? 'Model: AI provider settings' : 'Connect model: connect an AI model'}
          aria-expanded={settingsOpen}
        >
          <Settings2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{ready ? 'Model' : 'Connect model'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="studio-settings-pop w-[min(27rem,calc(100vw-2rem))] p-0">
        {settingsCard(true)}
      </PopoverContent>
    </Popover>
  );

  /* ------------------------------------------------------------- export */

  if (result) {
    const outputPages = resultPageCount ?? pageCount;
    return (
      <div className="studio">
        <StudioMasthead
          heading={toolName}
          documentTitle={result.name}
          meta={`${outputPages.toLocaleString()} page${outputPages === 1 ? '' : 's'}, ${formatBytes(result.data.byteLength)}`}
          onNewFile={reset}
          settingsTrigger={settingsTrigger}
        />
        <AiExport
          fileName={result.name}
          pageCount={outputPages}
          sizeBytes={result.data.byteLength}
          onDownload={() => downloadBytes(result.data, result.name)}
          onReset={reset}
          footerNote="Applied through the editing engine: replaced and erased text was rewritten in the document's own runs (covered and redrawn only where a rewrite was impossible), overlay edits were drawn, page changes were rebuilt, and the result was re-parsed and re-extracted before being offered for download."
        />
      </div>
    );
  }

  return (
    <div className="studio">
      <StudioMasthead
        heading={toolName}
        {...(file ? { documentTitle: file.name } : {})}
        meta={
          file && error
            ? 'Could not read'
            : file && doc
              ? `${pageCount} page${pageCount === 1 ? '' : 's'}, ${formatBytes(file.size)}`
              : file
                ? `Reading, ${formatBytes(file.size)}`
                : undefined
        }
        titleAs={file ? 'h1' : 'p'}
        {...(file ? { onNewFile: reset } : {})}
        settingsTrigger={settingsTrigger}
      />

      {!file ? (
        <div className="studio-cover-wrap">
          <AiCover
            title={copy.title}
            lead={copy.lead}
            quote={copy.quote}
            marginTitle={copy.marginTitle}
            marks={copy.marks}
            onFiles={pick}
            note={copy.note}
          />

          {!ready ? (
            <AiSetupSection
              settings={settings}
              mode={effectiveMode}
              managedAvailable={managedOk}
              onSave={onSaveSettings}
              onModeChange={changeMode}
              {...(storedKeyPresent(settings) ? { onForget: onForgetKey } : {})}
            />
          ) : null}
        </div>
      ) : error && !doc ? (
        <section className="studio-unreadable" role="alert">
          <span className="studio-unreadable-glyph" aria-hidden>
            <FileWarning className="h-5 w-5" />
          </span>
          <h2 className="studio-unreadable-title">That file could not be opened.</h2>
          <p className="studio-unreadable-copy">
            <span className="font-medium text-foreground">{file.name}:</span> {error}
          </p>
          <p className="studio-unreadable-note">
            If the document has a password, unlock it first. A repaired copy usually opens.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={reset} variant="outline">
              <RotateCcw className="mr-1.5 h-4 w-4" /> Choose another PDF
            </Button>
          </div>
        </section>
      ) : doc ? (
        <div
          ref={panesRef}
          className="studio-grid"
          aria-busy={extracting || applying || undefined}
        >
          <div className="studio-col-doc">
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
              loading={!previewTile && !previewError}
              error={previewError}
              onRetry={() => setPreviewNonce((value) => value + 1)}
            />
          </div>

          <div className="studio-col-rail">
            {ready ? (
              <>
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
                  title={copy.rail.title}
                  hint={copy.rail.hint}
                  emptyLead={copy.rail.emptyLead}
                  emptyCopy={
                    variant === 'edit'
                      ? `It reads ${doc.fileName} page by page. Every proposed change waits for your approval.`
                      : `It reads ${doc.fileName} page by page, and cites the pages it used.`
                  }
                />
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
              </>
            ) : (
              <section className="studio-gate" aria-labelledby="studio-gate-title">
                <span className="studio-gate-glyph" aria-hidden>
                  <Sparkles className="h-4 w-4" />
                </span>
                <h2 id="studio-gate-title" className="studio-gate-title">
                  The document is open. The assistant needs a model.
                </h2>
                <p className="studio-gate-copy">
                  Add a provider key and the assistant can read this document. Nothing is uploaded
                  by the editor itself.
                </p>
                {settingsCard(false)}
              </section>
            )}
          </div>
        </div>
      ) : (
        <section className="studio-reading" aria-busy>
          <div className="studio-reading-stage" aria-hidden>
            <div className="studio-reading-paper">
              <span className="studio-skeleton-line" style={{ width: '46%', height: 10 }} />
              <span className="studio-skeleton-line" style={{ width: '88%' }} />
              <span className="studio-skeleton-line" style={{ width: '94%' }} />
              <span className="studio-skeleton-line" style={{ width: '76%' }} />
              <span className="studio-skeleton-gap" />
              <span className="studio-skeleton-line" style={{ width: '90%' }} />
              <span className="studio-skeleton-line" style={{ width: '84%' }} />
              <span className="studio-skeleton-line" style={{ width: '58%' }} />
              <span className="studio-skeleton-scan" />
            </div>
          </div>
          <div className="studio-reading-panel">
            <p className="studio-reading-kicker">Reading</p>
            <p className="studio-reading-name" title={file.name}>
              {file.name}
            </p>
            <p className="studio-reading-copy">
              Extracting the page text the assistant can read and quote.
            </p>
            <div className="studio-reading-line">
              <span
                style={{ transform: `scaleX(${Math.max(0.04, extractProgress)})` }}
                aria-hidden
              />
            </div>
            <div className="studio-reading-foot">
              <span className="tabular-nums">{Math.round(extractProgress * 100)}%</span>
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> on this device
              </span>
            </div>
            <button type="button" onClick={reset} className="studio-text-link mt-5">
              <RotateCcw className="h-3.5 w-3.5" /> Choose another file
            </button>
          </div>
        </section>
      )}

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
