/**
 * The assistant, inside the shared editor.
 *
 * This is not a second PDF workspace: it receives the workspace's own file,
 * current page and page navigation, and it reports proposals back to that same
 * viewport so affected regions are visible before anything is written. The
 * proposal ledger is the only path to the engine, and Apply is explicit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyRound, Loader2, Settings2, ShieldCheck, Sparkles } from 'lucide-react';
import type { AiSettings } from '@pdfshush/ai-provider/browser';
import { AiChat } from '@/components/ai/ai-chat';
import { AiSettingsCard } from '@/components/ai/ai-settings-card';
import { AiWelcomeOverlay } from '@/components/ai/ai-welcome-overlay';
import { EditPlanPanel, type BlockedEditChange } from '@/components/ai/edit-plan-panel';
import { CountUp } from '@/components/reactbits/count-up';
import { SpotlightCard } from '@/components/reactbits/spotlight-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { extractEditDocument, type AiDocument } from '@/lib/ai/pdf-session';
import {
  applyEditPlan,
  createPdfEditSkill,
  editPlanIsEmpty,
  type AiPlanApplyResult,
  type ApplyStep,
} from '@/lib/ai/edit-skill';
import { managedAvailable } from '@/lib/ai/managed';
import { loadAiMode, saveAiMode, type AiMode } from '@/lib/ai/mode';
import type { EditorProposalMarker } from '@/lib/editor-tools';
import {
  aiReady,
  clearAiSettings,
  loadAiSettings,
  loadAiState,
  saveAiSettings,
  storedKeyPresent,
} from '@/lib/ai/settings';
import { aiWelcomeAnswered, markAiWelcomeAnswered } from '@/lib/ai/welcome';
import { UI, dur } from '@/lib/motion';

export interface EditorAiPanelProps {
  file: File;
  pageCount: number;
  /** Zero-based current page. */
  currentPage: number;
  onShowPage: (pageIndex: number) => void;
  onProposalsChange: (markers: EditorProposalMarker[], changedPages: number[], count: number) => void;
  onApplyResult: (result: AiPlanApplyResult, pageCount: number) => void;
  /** The editor's current text/paragraph selection, offered as model context. */
  selection?: { label: string; text: string } | null;
  disabled?: boolean;
}

const SUGGESTIONS = [
  'Highlight every date on page 1',
  'Add page numbers',
  'Delete the last page',
];

export function EditorAiPanel({
  file,
  pageCount,
  currentPage,
  onShowPage,
  onProposalsChange,
  onApplyResult,
  selection,
}: EditorAiPanelProps) {
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
  const [mode, setMode] = useState<AiMode>(() => loadAiMode());
  const [managedOk, setManagedOk] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  const [doc, setDoc] = useState<AiDocument | null>(null);
  const [reading, setReading] = useState(true);
  const [readProgress, setReadProgress] = useState(0);
  const [readError, setReadError] = useState<string | null>(null);

  const [version, setVersion] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyStep, setApplyStep] = useState<ApplyStep | null>(null);
  const [applyProgress, setApplyProgress] = useState(0);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ failed: Map<string, string>; message: string } | null>(null);
  const applyAbort = useRef<AbortController | null>(null);
  const runId = useRef(0);
  const showPageRef = useRef(onShowPage);
  showPageRef.current = onShowPage;
  const proposalsRef = useRef(onProposalsChange);
  proposalsRef.current = onProposalsChange;

  /* ------------------------------------------------------------ settings */

  useEffect(() => {
    let alive = true;
    void loadAiState().then((state) => {
      if (!alive) return;
      setSettings(state.settings);
      setMode(state.mode);
    });
    void managedAvailable().then((ok) => {
      if (alive) setManagedOk(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const effectiveMode: AiMode = mode === 'managed' && managedOk ? 'managed' : 'byok';
  const ready = effectiveMode === 'managed' ? true : aiReady(settings);

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

  /* ---------------------------------------------------------- extraction */

  useEffect(() => {
    const run = (runId.current += 1);
    const controller = new AbortController();
    setReading(true);
    setReadProgress(0);
    setReadError(null);
    setDoc(null);
    extractEditDocument(
      file,
      (ratio) => {
        if (runId.current === run) setReadProgress(ratio);
      },
      controller.signal,
    )
      .then((next) => {
        if (runId.current !== run) return;
        setDoc(next);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || runId.current !== run) return;
        setReadError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (runId.current === run) setReading(false);
      });
    return () => controller.abort();
  }, [file]);

  useEffect(() => () => applyAbort.current?.abort(), []);

  const editor = useMemo(
    () =>
      doc
        ? createPdfEditSkill(doc, {
            onChange: () => setVersion((value) => value + 1),
            onGotoPage: (page) => showPageRef.current(page - 1),
          })
        : null,
    [doc],
  );

  const entries = useMemo(
    () => editor?.plan().entries ?? [],
    // The skill mutates its plan in place; `version` is its change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, version],
  );

  /**
   * The skill's own context plus the editor's current selection. The model is
   * told what the user has selected; it is still responsible for quoting the
   * document verbatim in its tools.
   */
  const aiSkill = useMemo(() => {
    if (!editor) return undefined;
    const base = editor.skill;
    return {
      ...base,
      buildContext: () => {
        const context = base.buildContext?.() ?? '';
        const text = selection?.text.trim();
        if (!text) return context;
        return `${context}\n\nThe user has selected ${selection?.label ?? 'content'} in the editor:\n"""\n${text.slice(0, 1500)}\n"""`;
      },
    };
  }, [editor, selection]);

  useEffect(() => {
    if (!editor) {
      proposalsRef.current([], [], 0);
      return;
    }
    const plan = editor.plan();
    const markers: EditorProposalMarker[] = plan.objects.map((object) => ({
      id: object.id,
      pageIndex: object.pageIndex,
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      tone: object.kind === 'whiteout' ? 'erase' : object.kind === 'text' ? 'text' : 'mark',
    }));
    const pages = new Set<number>();
    for (const entry of plan.entries) for (const page of entry.pages) pages.add(page - 1);
    proposalsRef.current(markers, [...pages].sort((a, b) => a - b), plan.entries.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, version]);

  const classifyRefusal = useCallback((message: string): Map<string, string> => {
    const failed = new Map<string, string>();
    for (const line of message.split('\n')) {
      const match = line.match(/^\s*-\s*[\w-]+:\s*edit "([^"]+)"\s*(.+)$/);
      if (match) failed.set(match[1]!, match[2]!.trim());
    }
    return failed;
  }, []);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, refused, version]);

  const apply = useCallback(async () => {
    const active = editor;
    if (!active || !doc) return;
    const plan = active.plan();
    if (editPlanIsEmpty(plan)) return;
    const controller = new AbortController();
    applyAbort.current = controller;
    setApplying(true);
    setApplyProgress(0);
    setApplyStep(null);
    setApplyError(null);
    try {
      const output = await applyEditPlan(file, plan, {
        pageCount,
        signal: controller.signal,
        onProgress: setApplyProgress,
        onStep: setApplyStep,
      });
      const outputPages = plan.order ? plan.order.length : doc.pages.length;
      active.clear();
      setRefused(null);
      onApplyResult(output, outputPages);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      const failed = classifyRefusal(message);
      if (failed.size > 0) setRefused({ failed, message });
      else setApplyError(message);
    } finally {
      setApplying(false);
      applyAbort.current = null;
      setApplyStep(null);
    }
  }, [classifyRefusal, doc, editor, file, onApplyResult]);

  const retryWithoutFailed = useCallback(() => {
    const active = editor;
    const failed = refused?.failed;
    if (!active || !failed || failed.size === 0) return;
    for (const entry of active.plan().entries) {
      if (entry.objectIds.some((id) => failed.has(id))) active.discard(entry.id);
    }
    setRefused(null);
    void apply();
  }, [apply, editor, refused]);

  const saveSettings = (next: AiSettings) => {
    setSettings(saveAiSettings(next));
    setSettingsOpen(false);
  };

  const settingsCard = (showHead: boolean) => (
    <AiSettingsCard
      settings={settings}
      onSave={saveSettings}
      mode={effectiveMode}
      onModeChange={(next) => {
        setMode(next);
        saveAiMode(next);
      }}
      managedAvailable={managedOk}
      surface="plain"
      showHead={showHead}
      {...(storedKeyPresent(settings)
        ? {
            onForget: () => {
              void clearAiSettings().then((next) => {
                setSettings(next);
                setSettingsOpen(false);
              });
            },
          }
        : {})}
    />
  );

  const settingsTrigger = (
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="editor-ai-settings" aria-label="AI provider settings">
          <Settings2 className="size-3.5" />
          <span>{ready ? 'Model' : 'Connect'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="studio-settings-pop w-[min(27rem,calc(100vw-2rem))] p-0">
        {settingsCard(true)}
      </PopoverContent>
    </Popover>
  );

  const changeCount = entries.length;

  return (
    <div className="editor-ai-panel" data-testid="editor-ai-panel">
      <header className="editor-ai-head">
        <span className="editor-ai-glyph" aria-hidden>
          <Sparkles className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="editor-ai-title">Assistant</p>
          <p className="editor-ai-sub">
            {reading
              ? `Reading page text, ${Math.round(readProgress * 100)}%`
              : readError
                ? 'Could not read the document'
                : changeCount > 0
                  ? `${changeCount} proposed change${changeCount === 1 ? '' : 's'}`
                  : 'Describe a change. Nothing is written until you apply.'}
          </p>
        </div>
        {changeCount > 0 ? (
          <span className="editor-ai-count" data-testid="ai-change-count">
            <CountUp to={changeCount} duration={dur(UI.standard)} />
          </span>
        ) : null}
        {settingsTrigger}
      </header>

      {reading ? (
        <div className="editor-ai-reading" role="status" aria-live="polite">
          <div className="editor-ai-reading-rule">
            <span style={{ transform: `scaleX(${Math.max(0.03, readProgress)})` }} />
          </div>
          <p>
            <Loader2 className="mr-1.5 inline size-3 animate-spin" />
            Extracting the text the assistant may quote, on this device.
          </p>
        </div>
      ) : readError ? (
        <div className="editor-ai-error" role="alert">
          <p className="font-medium">That document could not be read.</p>
          <p className="mt-1 text-xs leading-relaxed opacity-80">{readError}</p>
        </div>
      ) : !ready ? (
        <SpotlightCard className="editor-ai-gate" intensity={0.06} borderGlow={0.4}>
          <span className="editor-ai-glyph" aria-hidden>
            <KeyRound className="size-3.5" />
          </span>
          <p className="mt-2 text-sm font-medium">The document is open. The assistant needs a model.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Add a provider key, or use the trial. Your key stays in this browser. The editor itself
            uploads nothing.
          </p>
          <div className="mt-3">{settingsCard(false)}</div>
        </SpotlightCard>
      ) : doc && editor ? (
        <div className="editor-ai-body">
          <div className="editor-ai-chat">
            {selection?.text.trim() ? (
              <div className="editor-ai-selection" data-testid="ai-selection-context">
                <span className="editor-ai-selection-label">Context: {selection.label}</span>
                <span className="editor-ai-selection-text">{selection.text.trim().slice(0, 160)}</span>
              </div>
            ) : null}
            <AiChat
              key={file.name + file.size}
              doc={doc}
              settings={settings}
              mode={effectiveMode}
              skill={aiSkill}
              activePage={currentPage + 1}
              onShowPage={(page) => onShowPage(page - 1)}
              placeholder="Describe a change, for example: highlight every date on page 1."
              suggestions={SUGGESTIONS}
              title="Instructions"
              hint="The assistant proposes; you decide."
              emptyLead="Describe the change you want."
              emptyCopy={`It reads ${doc.fileName} page by page. Every proposed change waits for your approval.`}
            />
            <div className="editor-ai-trust">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
              <p>
                Parsed here. Only the text needed for your request reaches your provider. Page changes
                are applied through the same verified engine as manual edits.
              </p>
            </div>
          </div>
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
            onShowPage={(page) => onShowPage(page - 1)}
          />
        </div>
      ) : null}

      {welcomeOpen ? (
        <AiWelcomeOverlay
          settings={settings}
          onSave={saveSettings}
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
