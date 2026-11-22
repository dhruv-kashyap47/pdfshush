/**
 * Shared editor chrome: top bar, vertical tool rail, contextual controls,
 * page rail and status bar.
 *
 * Every element here is presentational. The owning workspace passes the shared
 * editor session in; no component in this file creates a document, viewport or
 * save path of its own.
 */

import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BringToFront,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  FileUp,
  GripVertical,
  Highlighter,
  Italic,
  Keyboard,
  LayoutGrid,
  Loader2,
  Maximize2,
  Minus,
  MoreVertical,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Scan,
  Search,
  SendToBack,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { EditorObject } from '@pdfshush/pdf-core';
import { AnimatedContent } from '@/components/reactbits/animated-content';
import { SpotlightCard } from '@/components/reactbits/spotlight-card';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMotionScope } from '@/hooks/use-motion';
import {
  TOOL_GROUP_LABELS,
  TOOL_HELP,
  toolsForMode,
  type EditorMode,
  type EditorTool,
  type ToolGroup,
} from '@/lib/editor-tools';
import { formatPercent } from '@/lib/format';
import { EASE, UI, dur } from '@/lib/motion';
import { STAMP_PRESETS, type StampPreset } from '@/lib/stamp-presets';
import { parseZoomPercent } from '@/lib/zoom';
import { cn } from '@/lib/utils';

/* --------------------------------------------------------------- top bar */

export interface EditorTopBarProps {
  fileName: string;
  mode: EditorMode;
  pageCount: number;
  currentPage: number;
  dirty: boolean;
  saving: boolean;
  saveDisabled?: boolean;
  /** Why Save is disabled; used for the accessible name and tooltip. */
  saveDisabledReason?: string;
  saveLabel: string;
  onSave: () => void;
  onChangeFile: () => void;
  onReset: () => void;
  /** Mobile back affordance: closes the document and returns to the picker. */
  onBack?: () => void;
  showSave?: boolean;
  modes?: Array<{ id: EditorMode; label: string }>;
  onModeChange?: (mode: EditorMode) => void;
  status?: ReactNode;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onGoToPage?: (pageNumber: number) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onFind?: () => void;
  onShortcuts?: () => void;
  onDocumentInfo?: () => void;
  documentInfoOpen?: boolean;
}

export function EditorTopBar({
  fileName,
  mode,
  pageCount,
  currentPage,
  dirty,
  saving,
  saveDisabled,
  saveDisabledReason,
  saveLabel,
  onSave,
  onChangeFile,
  onReset,
  onBack,
  showSave = true,
  modes,
  onModeChange,
  status,
  onPrevPage,
  onNextPage,
  onGoToPage,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onFind,
  onShortcuts,
  onDocumentInfo,
  documentInfoOpen,
}: EditorTopBarProps) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const cancelPageCommit = useRef(false);
  const run = (action: () => void) => {
    setActionsOpen(false);
    action();
  };
  const commitPage = (raw: string) => {
    if (cancelPageCommit.current) {
      cancelPageCommit.current = false;
      setPageDraft(null);
      return;
    }
    const next = Number.parseInt(raw, 10);
    if (Number.isFinite(next)) onGoToPage?.(Math.min(pageCount, Math.max(1, next)));
    setPageDraft(null);
  };

  return (
    <header className="editor-topbar" data-testid="editor-topbar">
      <div className="editor-topbar-left">
        <button
          type="button"
          className="editor-mobile-icon editor-mobile-back"
          aria-label="Close document and return to the file picker"
          disabled={saving}
          onClick={onBack ?? onReset}
        >
          <ChevronLeft className="size-5" />
        </button>

        <span className="editor-doc-glyph" aria-hidden>
          <FileText className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="editor-doc-name" title={fileName}>
            {fileName}
          </p>
          <p className="editor-doc-meta" title={dirty ? 'Unsaved changes' : 'Up to date'}>
            {pageCount.toLocaleString()} page{pageCount === 1 ? '' : 's'}
            {dirty ? <span className="editor-doc-edited">Edited</span> : null}
            <span className="sr-only" data-testid="editor-dirty-state">
              {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Up to date'}
            </span>
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="editor-topbar-action ml-1"
          aria-label="Change file"
          title="Open another PDF"
          disabled={saving}
          onClick={onChangeFile}
        >
          <FileUp className="size-3.5" />
          <span className="hidden lg:inline">Change</span>
        </Button>
      </div>

      <div className="editor-topbar-center">
        {onPrevPage && onNextPage ? (
          <div className="editor-page-nav" role="group" aria-label="Document page">
            <button
              type="button"
              className="editor-page-nav-button"
              aria-label="Previous page"
              data-testid="editor-top-prev-page"
              disabled={currentPage <= 1}
              onClick={onPrevPage}
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <input
              type="text"
              inputMode="numeric"
              className="editor-page-nav-input"
              aria-label="Page number"
              data-testid="editor-page-input"
              value={pageDraft ?? String(Math.min(currentPage, Math.max(1, pageCount)))}
              onChange={(event) => setPageDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) => commitPage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitPage((event.target as HTMLInputElement).value);
                  (event.target as HTMLInputElement).blur();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelPageCommit.current = true;
                  setPageDraft(null);
                  (event.target as HTMLInputElement).blur();
                }
              }}
            />
            <span className="editor-page-nav-total">/ {pageCount}</span>
            <button
              type="button"
              className="editor-page-nav-button"
              aria-label="Next page"
              data-testid="editor-top-next-page"
              disabled={currentPage >= pageCount}
              onClick={onNextPage}
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        ) : null}

        {modes && modes.length > 1 && onModeChange ? (
          <nav className="editor-mode-switcher" aria-label="Workspace">
            {modes.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="editor-mode-tab"
                aria-current={entry.id === mode ? 'page' : undefined}
                data-testid={`editor-mode-${entry.id}`}
                disabled={saving}
                onClick={() => onModeChange(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        ) : (
          <span className="editor-mode-label">{modeLabel(mode)}</span>
        )}
      </div>

      <div className="editor-topbar-actions">
        {status}
        {onFind ? (
          <button
            type="button"
            className="editor-topbar-icon editor-topbar-icon--find"
            aria-label="Find and replace"
            title="Find and replace (Ctrl+F)"
            data-testid="editor-find-open"
            disabled={saving}
            onClick={onFind}
          >
            <Search className="size-4" />
          </button>
        ) : null}
        {onUndo ? (
          <button
            type="button"
            className="editor-topbar-icon"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            data-testid="editor-undo"
            disabled={saving || !canUndo}
            onClick={onUndo}
          >
            <Undo2 className="size-4" />
          </button>
        ) : null}
        {onRedo ? (
          <button
            type="button"
            className="editor-topbar-icon"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            data-testid="editor-redo"
            disabled={saving || !canRedo}
            onClick={onRedo}
          >
            <Redo2 className="size-4" />
          </button>
        ) : null}
        {onDocumentInfo ? (
          <button
            type="button"
            className="editor-topbar-icon"
            aria-label={documentInfoOpen ? 'Hide document details' : 'Document details'}
            aria-pressed={documentInfoOpen}
            title="Document details"
            data-testid="editor-document-info"
            onClick={onDocumentInfo}
          >
            <Info className="size-4" />
          </button>
        ) : null}
        {onShortcuts ? (
          <button
            type="button"
            className="editor-topbar-icon editor-topbar-icon--help"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            data-testid="editor-shortcuts-open"
            onClick={onShortcuts}
          >
            <Keyboard className="size-4" />
          </button>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="editor-topbar-reset size-7 text-muted-foreground"
              aria-label="Start over"
              disabled={saving}
              onClick={onReset}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Start over</TooltipContent>
        </Tooltip>
        <Button
          type="button"
          size="sm"
          className="editor-save-button"
          data-testid="editor-save"
          disabled={saving || saveDisabled}
          aria-label={
            saving
              ? 'Saving'
              : saveDisabled
                ? `${saveLabel} (${saveDisabledReason ?? 'unavailable'})`
                : saveLabel
          }
          title={saveDisabled && !saving ? (saveDisabledReason ?? 'Saving is unavailable') : undefined}
          onClick={onSave}
          hidden={!showSave}
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          <span>{saving ? 'Saving...' : saveLabel}</span>
        </Button>
        <button
          type="button"
          className="editor-mobile-icon editor-mobile-more"
          aria-label="Document actions"
          aria-haspopup="dialog"
          onClick={() => setActionsOpen(true)}
        >
          <MoreVertical className="size-5" />
        </button>
      </div>

      <Sheet open={actionsOpen} onOpenChange={setActionsOpen}>
        <SheetContent side="bottom" className="editor-action-sheet">
          <SheetHeader>
            <SheetTitle>Document</SheetTitle>
            <SheetDescription className="truncate">{fileName}</SheetDescription>
          </SheetHeader>
          <div className="editor-action-list">
            {showSave ? (
              <button
                type="button"
                className="editor-action-row"
                disabled={saving || saveDisabled}
                aria-label={
                  saveDisabled && !saving
                    ? `${saveLabel} (${saveDisabledReason ?? 'unavailable'})`
                    : saveLabel
                }
                title={
                  saveDisabled && !saving
                    ? (saveDisabledReason ?? 'Saving is unavailable')
                    : undefined
                }
                onClick={() => run(onSave)}
              >
                <span className="editor-action-glyph" aria-hidden>
                  <Save className="size-4" />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="editor-action-title">
                    {saving ? 'Saving…' : saveLabel}
                  </span>
                  <span className="editor-action-detail">
                    {dirty ? 'Writes a verified copy to your device.' : 'No pending changes.'}
                  </span>
                </span>
                {saving ? <Loader2 className="size-4 animate-spin text-primary" /> : null}
              </button>
            ) : null}

            <button type="button" className="editor-action-row" disabled={saving} onClick={() => run(onChangeFile)}>
              <span className="editor-action-glyph" aria-hidden>
                <FileUp className="size-4" />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="editor-action-title">Open another file</span>
                <span className="editor-action-detail">Replace this document.</span>
              </span>
            </button>

            {modes && onModeChange ? (
              <div className="editor-action-group">
                <p className="editor-action-group-label">Workspaces</p>
                <div className="editor-action-chips">
                  {modes.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="editor-action-chip"
                      aria-current={entry.id === mode ? 'page' : undefined}
                      disabled={saving}
                      onClick={() => run(() => onModeChange(entry.id))}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <button type="button" className="editor-action-row" disabled={saving} onClick={() => run(onReset)}>
              <span className="editor-action-glyph" aria-hidden>
                <RotateCcw className="size-4" />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="editor-action-title">Start over</span>
                <span className="editor-action-detail">Discard this session and reopen a file.</span>
              </span>
            </button>

            {onBack ? (
              <button type="button" className="editor-action-row" disabled={saving} onClick={() => run(onBack)}>
                <span className="editor-action-glyph" aria-hidden>
                  <ChevronLeft className="size-4" />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="editor-action-title">Close document</span>
                  <span className="editor-action-detail">Return to the file picker.</span>
                </span>
              </button>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}

function modeLabel(mode: EditorMode): string {
  switch (mode) {
    case 'sign':
      return 'Fill & Sign';
    case 'ai':
      return 'Assistant';
    case 'redact':
      return 'Redaction';
    case 'organize':
      return 'Pages';
    default:
      return 'Editing';
  }
}

/* ---------------------------------------------------------- mobile nav */

export type EditorMobileTab = 'edit' | 'annotate' | 'pages' | 'ai' | 'sign' | 'redact';

export interface EditorMobileNavProps {
  mode: EditorMode;
  tool: EditorTool;
  disabled?: boolean;
  onSelect: (tab: EditorMobileTab) => void;
}

/**
 * The phone's primary navigation. Four destinations, thumb-height targets, and
 * the same workspace state the desktop tabs drive. "Annotate" is not a separate
 * mode: it opens the Edit workspace with the highlighter ready, so the document
 * session never forks.
 */
export function EditorMobileNav({ mode, tool, disabled, onSelect }: EditorMobileNavProps) {
  const annotating =
    (mode === 'edit' || mode === 'sign') &&
    (tool === 'highlight' || tool === 'strikeout' || tool === 'underline' || tool === 'whiteout');

  const tabs =
    mode === 'sign'
      ? [
          { id: 'sign' as const, label: 'Sign', icon: PenLine },
          { id: 'annotate' as const, label: 'Annotate', icon: Highlighter },
          { id: 'pages' as const, label: 'Pages', icon: LayoutGrid },
          { id: 'ai' as const, label: 'AI', icon: Sparkles },
        ]
      : mode === 'redact'
        ? [
            { id: 'redact' as const, label: 'Redact', icon: ShieldAlert },
            { id: 'edit' as const, label: 'Edit', icon: PenLine },
            { id: 'pages' as const, label: 'Pages', icon: LayoutGrid },
            { id: 'ai' as const, label: 'AI', icon: Sparkles },
          ]
        : [
            { id: 'edit' as const, label: 'Edit', icon: PenLine },
            { id: 'annotate' as const, label: 'Annotate', icon: Highlighter },
            { id: 'pages' as const, label: 'Pages', icon: LayoutGrid },
            { id: 'ai' as const, label: 'AI', icon: Sparkles },
          ];

  const active: EditorMobileTab =
    mode === 'ai' || tool === 'ai'
      ? 'ai'
      : mode === 'organize'
        ? 'pages'
        : mode === 'redact'
          ? 'redact'
          : mode === 'sign'
            ? annotating
              ? 'annotate'
              : 'sign'
            : annotating
              ? 'annotate'
              : 'edit';

  return (
    <nav
      className="editor-mobile-nav"
      aria-label="PDF workspace"
      data-testid="editor-mobile-nav"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            className="editor-mobile-tab"
            aria-current={active === tab.id ? 'page' : undefined}
            data-testid={`editor-mobile-tab-${tab.id}`}
            disabled={disabled}
            onClick={() => onSelect(tab.id)}
          >
            <span className="editor-mobile-tab-icon" aria-hidden>
              <Icon className="size-4" strokeWidth={1.9} />
            </span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------- tool rail */

export interface EditorToolRailProps {
  mode: EditorMode;
  tool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  disabled?: boolean;
  railOpen?: boolean;
  onToggleRail?: () => void;
}

export const EditorToolRail = memo(function EditorToolRail({
  mode,
  tool,
  onToolChange,
  disabled,
  railOpen,
  onToggleRail,
}: EditorToolRailProps) {
  const tools = useMemo(() => toolsForMode(mode), [mode]);
  const motion = useMotionScope();
  const buttonRefs = useRef(new Map<EditorTool, HTMLButtonElement>());
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  const previousTop = useRef<number | null>(null);

  useLayoutEffect(() => {
    const active = buttonRefs.current.get(tool);
    const indicator = indicatorRef.current;
    if (!active || !indicator) return;
    const top = active.offsetTop;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (previousTop.current === null || reduce) {
      indicator.style.transform = `translateY(${top}px)`;
      indicator.style.opacity = '1';
      previousTop.current = top;
      setReady(true);
      return;
    }
    motion.animate(indicator, {
      translateY: top,
      opacity: [0.55, 1],
      duration: dur(UI.fast),
      ease: EASE.out,
    });
    previousTop.current = top;
  }, [motion, tool, mode]);

  const groups: ToolGroup[] = ['edit', 'insert', 'markup', 'shape'];
  const focusTool = (id: EditorTool) => {
    buttonRefs.current.get(id)?.focus();
    onToolChange(id);
  };
  const onToolKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const last = tools.length - 1;
    let next = index;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = index >= last ? 0 : index + 1;
    else next = index <= 0 ? last : index - 1;
    const target = tools[next];
    if (target) focusTool(target.id);
  };
  return (
    <aside className="editor-tool-rail" aria-label="Editor tools" data-testid="editor-toolbar">
      <div
        className="relative flex flex-col items-center gap-1 pt-2"
        role="toolbar"
        aria-label="Editor tools"
        aria-orientation="vertical"
      >
        <span
          ref={indicatorRef}
          aria-hidden
          className={cn('editor-tool-indicator', !ready && 'opacity-0')}
        />
        {groups.map((group) => {
          const entries = tools.filter((entry) => entry.group === group);
          if (entries.length === 0) return null;
          return (
            <div
              key={group}
              className="contents"
              role="group"
              aria-label={TOOL_GROUP_LABELS[group] ?? undefined}
            >
              {entries.map((entry) => {
                const Icon = entry.icon;
                const active = tool === entry.id;
                const index = tools.findIndex((candidate) => candidate.id === entry.id);
                return (
                  <Tooltip key={entry.id}>
                    <TooltipTrigger asChild>
                      <button
                        ref={(node) => {
                          if (node) buttonRefs.current.set(entry.id, node);
                          else buttonRefs.current.delete(entry.id);
                        }}
                        type="button"
                        className="editor-tool-button"
                        data-active={active || undefined}
                        data-testid={`editor-tool-${entry.id}`}
                        aria-label={
                          entry.shortcut ? `${entry.label} (${entry.shortcut.toUpperCase()})` : entry.label
                        }
                        aria-pressed={active}
                        tabIndex={active ? 0 : -1}
                        disabled={disabled}
                        onClick={() => onToolChange(entry.id)}
                        onKeyDown={(event) => onToolKeyDown(event, index)}
                      >
                        <Icon className="size-[17px]" strokeWidth={1.75} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-56">
                      <span className="flex items-center gap-1.5 font-medium">
                        {entry.label}
                        {entry.shortcut ? (
                          <kbd className="rounded border border-white/20 px-1 text-[10px] opacity-70">
                            {entry.shortcut.toUpperCase()}
                          </kbd>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug opacity-70">
                        {TOOL_HELP[entry.id]}
                      </span>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
              {group !== 'shape' ? <span className="editor-rail-divider" aria-hidden /> : null}
            </div>
          );
        })}
      </div>

      {onToggleRail ? (
        <div className="mt-auto flex flex-col items-center gap-1 pb-2">
          <span className="editor-rail-divider mb-1" aria-hidden />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="editor-rail-footer-button"
                aria-label={railOpen ? 'Collapse page rail' : 'Show page rail'}
                aria-pressed={railOpen}
                data-testid="editor-toggle-rail"
                onClick={onToggleRail}
              >
                {railOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {railOpen ? 'Collapse pages' : 'Show pages'}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </aside>
  );
});

/* -------------------------------------------------------- contextual bar */

const TEXT_SWATCHES = ['#121212', '#475569', '#dc2626', '#d97706', '#15803d', '#1d4ed8'];
const MARK_SWATCHES = ['#ffe066', '#fca5a5', '#93c5fd', '#86efac', '#f0abfc', '#fde68a'];
const STROKE_SWATCHES = ['#1f293b', '#b91c1c', '#1d4ed8', '#15803d', '#7c3aed', '#000000'];

export interface EditorContextBarProps {
  mode: EditorMode;
  tool: EditorTool;
  selectedObject: EditorObject | null;
  hasSelection: boolean;
  /** The inspector can describe a text block even when no object is selected. */
  canInspectSelection?: boolean;
  canReorder?: boolean;
  canSendBack?: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onReorder?: (direction: 'forward' | 'backward') => void;
  onDuplicate?: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  /** Preset the stamp tool places, chosen from the context bar. */
  stampPreset?: StampPreset;
  onStampPreset?: (preset: StampPreset) => void;
  /** Phone-only properties sheet toggle. */
  onOpenInspector?: () => void;
  inspectorOpen?: boolean;
  disabled?: boolean;
  /** Redaction-only actions. */
  redactCount?: number;
  onRedactReview?: () => void;
  /** Organise-only actions. */
  pageCount?: number;
  orderDirty?: boolean;
  onRestoreOrder?: () => void;
  /** AI-only summary. */
  aiChangeCount?: number;
  onOpenAssistant?: () => void;
}

export function EditorContextBar(props: EditorContextBarProps) {
  const {
    mode,
    tool,
    selectedObject,
    hasSelection,
    canInspectSelection,
    canReorder,
    canSendBack,
    onPatch,
    onDelete,
    onReorder,
    onDuplicate,
    zoom,
    onZoomChange,
    onZoomIn,
    onZoomOut,
    onFitWidth,
    onFitPage,
    stampPreset,
    onStampPreset,
    onOpenInspector,
    inspectorOpen,
    disabled,
    redactCount = 0,
    onRedactReview,
    pageCount = 0,
    orderDirty,
    onRestoreOrder,
    aiChangeCount = 0,
    onOpenAssistant,
  } = props;

  return (
    <div className="editor-context-bar" role="toolbar" aria-label="Tool options">
      <div className="min-w-0 flex-1">
        <AnimatedContent
          key={`${mode}-${tool}-${selectedObject?.id ?? 'none'}`}
          direction="horizontal"
          distance={6}
          duration={UI.fast}
          trigger="mount"
          className="flex min-w-0 items-center gap-1.5 overflow-hidden"
        >
          <ToolContext
            mode={mode}
            tool={tool}
            object={selectedObject}
            onPatch={onPatch}
            disabled={disabled}
            stampPreset={stampPreset}
            onStampPreset={onStampPreset}
            redactCount={redactCount}
            onRedactReview={onRedactReview}
            pageCount={pageCount}
            orderDirty={orderDirty}
            onRestoreOrder={onRestoreOrder}
            aiChangeCount={aiChangeCount}
            onOpenAssistant={onOpenAssistant}
          />
        </AnimatedContent>
      </div>

      <div className="editor-context-actions">
        {onOpenInspector ? (
          <ContextIcon
            label={inspectorOpen ? 'Hide properties' : 'Show properties'}
            testId="editor-toggle-inspector"
            className="editor-context-mobile"
            disabled={!canInspectSelection && mode !== 'redact'}
            onClick={onOpenInspector}
          >
            <SlidersHorizontal className="size-3.5" />
          </ContextIcon>
        ) : null}
        {onDuplicate ? (
          <ContextIcon
            label="Duplicate (Ctrl+D)"
            testId="editor-duplicate"
            disabled={disabled || (!selectedObject && !(mode === 'organize' && hasSelection))}
            onClick={onDuplicate}
          >
            <Copy className="size-3.5" />
          </ContextIcon>
        ) : null}
        <ContextIcon
          label="Delete (Del)"
          testId="editor-delete"
          disabled={disabled || !hasSelection}
          onClick={onDelete}
          destructive
        >
          <Trash2 className="size-3.5" />
        </ContextIcon>
        {onReorder ? (
          <>
            <ContextIcon
              label="Bring forward"
              testId="editor-bring-forward"
              className="editor-context-reorder"
              disabled={disabled || !canReorder}
              onClick={() => onReorder('forward')}
            >
              <BringToFront className="size-3.5" />
            </ContextIcon>
            <ContextIcon
              label="Send backward"
              testId="editor-send-backward"
              className="editor-context-reorder"
              disabled={disabled || !canSendBack}
              onClick={() => onReorder('backward')}
            >
              <SendToBack className="size-3.5" />
            </ContextIcon>
          </>
        ) : null}
        <span className="editor-context-divider editor-context-zoom" aria-hidden />
        <ContextIcon
          label="Zoom out (Ctrl+-)"
          testId="editor-zoom-out"
          className="editor-context-zoom"
          onClick={onZoomOut}
        >
          <ZoomOut className="size-3.5" />
        </ContextIcon>
        <ZoomReadout zoom={zoom} onCommit={onZoomChange} />
        <ContextIcon
          label="Zoom in (Ctrl++)"
          testId="editor-zoom-in"
          className="editor-context-zoom"
          onClick={onZoomIn}
        >
          <ZoomIn className="size-3.5" />
        </ContextIcon>
        <ContextIcon
          label="Fit width (Ctrl+0)"
          testId="editor-fit-width"
          className="editor-context-zoom"
          onClick={onFitWidth}
        >
          <Maximize2 className="size-3.5" />
        </ContextIcon>
        <ContextIcon
          label="Fit page"
          testId="editor-fit-page"
          className="editor-context-zoom"
          onClick={onFitPage}
        >
          <Scan className="size-3.5" />
        </ContextIcon>
      </div>
    </div>
  );
}

/**
 * Editable zoom readout: type a percentage and press Enter (or blur) to apply.
 * Committed in one step so a typed number is one viewport change, and clamped
 * to the same 25–400% window the step controls use.
 */
function ZoomReadout({ zoom, onCommit }: { zoom: number; onCommit: (zoom: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelCommit = useRef(false);
  const commit = (raw: string) => {
    if (cancelCommit.current) {
      cancelCommit.current = false;
      setDraft(null);
      return;
    }
    const next = parseZoomPercent(raw);
    if (next !== null) onCommit(next);
    setDraft(null);
  };
  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        className="editor-zoom-readout editor-context-zoom"
        data-testid="editor-zoom-level"
        aria-label="Zoom level, percent"
        aria-describedby="editor-zoom-live"
        title="Zoom level — type a percentage and press Enter"
        value={draft ?? String(Math.round(zoom * 100))}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit((event.target as HTMLInputElement).value);
            (event.target as HTMLInputElement).blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelCommit.current = true;
            setDraft(null);
            (event.target as HTMLInputElement).blur();
          }
        }}
        style={{ width: '3rem', textAlign: 'center', background: 'transparent' }}
      />
      {/* Step/fit changes do not move focus, so announce the level explicitly. */}
      <span id="editor-zoom-live" className="sr-only" aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
    </>
  );
}

function ContextIcon({
  label,
  testId,
  disabled,
  onClick,
  destructive,
  pressed,
  className,
  children,
}: {
  label: string;
  testId?: string;
  disabled?: boolean;
  onClick: () => void;
  destructive?: boolean;
  pressed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'editor-context-icon',
            destructive && 'editor-context-icon--danger',
            pressed && 'editor-context-icon--active',
            className,
          )}
          aria-label={label}
          aria-pressed={pressed}
          data-testid={testId}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="editor-context-hint" data-testid="editor-context-hint">
      {children}
    </p>
  );
}

function ToolContext({
  mode,
  tool,
  object,
  onPatch,
  disabled,
  stampPreset,
  onStampPreset,
  redactCount,
  onRedactReview,
  pageCount,
  orderDirty,
  onRestoreOrder,
  aiChangeCount,
  onOpenAssistant,
}: {
  mode: EditorMode;
  tool: EditorTool;
  object: EditorObject | null;
  onPatch: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
  stampPreset?: StampPreset;
  onStampPreset?: (preset: StampPreset) => void;
  redactCount: number;
  onRedactReview?: () => void;
  pageCount: number;
  orderDirty?: boolean;
  onRestoreOrder?: () => void;
  aiChangeCount: number;
  onOpenAssistant?: () => void;
}) {
  if (mode === 'redact') {
    return (
      <>
        <Hint>
          Drag on a page to mark content for destruction. Marks are permanent.
        </Hint>
        <span className="editor-context-count" data-testid="redact-mark-count">
          {redactCount} mark{redactCount === 1 ? '' : 's'}
        </span>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="h-7"
          data-testid="redact-start"
          disabled={disabled || redactCount === 0}
          onClick={onRedactReview}
        >
          <ShieldAlert className="mr-1.5 size-3.5" />
          Review and redact
        </Button>
      </>
    );
  }

  if (mode === 'organize') {
    return (
      <>
        <Hint>Drag pages in the rail to reorder. Delete or duplicate from each page.</Hint>
        <span className="editor-context-count" data-testid="organize-page-count">
          {pageCount} page{pageCount === 1 ? '' : 's'}
        </span>
        {orderDirty && onRestoreOrder ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={disabled}
            onClick={onRestoreOrder}
          >
            <RotateCcw className="mr-1.5 size-3.5" /> Restore order
          </Button>
        ) : null}
      </>
    );
  }

  if (tool === 'ai') {
    return (
      <>
        <Hint>The assistant proposes changes. Nothing is written until you apply.</Hint>
        {aiChangeCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7"
            onClick={onOpenAssistant}
            data-testid="editor-ai-review"
          >
            Review {aiChangeCount} change{aiChangeCount === 1 ? '' : 's'}
          </Button>
        ) : null}
      </>
    );
  }

  if (object?.kind === 'stamp') {
    return (
      <>
        <span className="editor-context-label">Stamp</span>
        {STAMP_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="editor-context-chip"
            aria-pressed={object.text.toUpperCase() === preset.label}
            data-testid={`editor-stamp-preset-${preset.id}`}
            disabled={disabled}
            onClick={() => {
              onPatch({ text: preset.label, color: preset.color });
              // Keep the next placement in step with the preset the user just
              // applied to this stamp.
              onStampPreset?.(preset);
            }}
          >
            {preset.label}
          </button>
        ))}
      </>
    );
  }

  // Chosen before the selected-object controls: arming the stamp tool must
  // always expose the preset picker, even while an unrelated object is still
  // selected from the previous placement.
  if (tool === 'stamp') {
    return (
      <>
        {STAMP_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="editor-context-chip"
            aria-pressed={stampPreset?.id === preset.id}
            data-testid={`editor-stamp-preset-${preset.id}`}
            disabled={disabled}
            onClick={() => onStampPreset?.(preset)}
          >
            {preset.label}
          </button>
        ))}
        <Hint>Choose a stamp, then click the page.</Hint>
      </>
    );
  }

  if (object?.kind === 'text') {
    return <TextControls object={object} onPatch={onPatch} disabled={disabled} />;
  }

  if (tool === 'text') {
    return <Hint>{TOOL_HELP.text}</Hint>;
  }

  if (object?.kind === 'highlight' || object?.kind === 'strikeout' || object?.kind === 'underline') {
    return (
      <>
        <span className="editor-context-label">Marker</span>
        {MARK_SWATCHES.map((color) => (
          <SwatchButton
            key={color}
            color={color}
            active={object.color === color}
            onPick={() => onPatch({ color })}
            disabled={disabled}
          />
        ))}
      </>
    );
  }

  if (
    object?.kind === 'rect' ||
    object?.kind === 'ellipse' ||
    object?.kind === 'line' ||
    object?.kind === 'arrow' ||
    object?.kind === 'ink' ||
    object?.kind === 'check' ||
    object?.kind === 'cross'
  ) {
    return (
      <>
        <span className="editor-context-label">Stroke</span>
        {STROKE_SWATCHES.map((color) => (
          <SwatchButton
            key={color}
            color={color}
            active={object.stroke === color}
            onPick={() => onPatch({ stroke: color })}
            disabled={disabled}
          />
        ))}
        <span className="editor-context-divider" aria-hidden />
        {(object.kind === 'ink' ? [1, 2, 3, 5] : [1, 1.5, 2, 3]).map((width) => (
          <button
            key={width}
            type="button"
            className="editor-context-chip"
            aria-pressed={(object.strokeWidth ?? 1.5) === width}
            data-testid={`editor-stroke-${width}`}
            disabled={disabled}
            onClick={() => onPatch({ strokeWidth: width })}
          >
            {width}
          </button>
        ))}
      </>
    );
  }

  if (object?.kind === 'image') {
    return <Hint>{TOOL_HELP.image}</Hint>;
  }

  if (tool === 'pen') {
    return <Hint>{TOOL_HELP.pen}</Hint>;
  }

  if (tool === 'check' || tool === 'cross') {
    return <Hint>{TOOL_HELP[tool]}</Hint>;
  }

  if (tool === 'date') {
    return <Hint>{TOOL_HELP.date}</Hint>;
  }

  if (mode === 'sign') {
    return <Hint>Click where the signature should go, then draw or type it.</Hint>;
  }

  if (tool === 'select') {
    return <Hint>Select text or an object. Drag to move, double-click to edit.</Hint>;
  }

  return <Hint>{TOOL_HELP[tool]}</Hint>;
}

function TextControls({
  object,
  onPatch,
  disabled,
}: {
  object: Extract<EditorObject, { kind: 'text' }>;
  onPatch: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const [size, setSize] = useState(String(Math.round(object.fontSize)));
  const cancelSizeCommit = useRef(false);
  useEffect(
    () => setSize(String(Math.round(object.fontSize))),
    [object.fontSize, object.id],
  );
  const commitSize = () => {
    if (cancelSizeCommit.current) {
      cancelSizeCommit.current = false;
      setSize(String(Math.round(object.fontSize)));
      return;
    }
    const value = Number(size);
    if (Number.isFinite(value)) onPatch({ fontSize: Math.min(72, Math.max(4, value)) });
    else setSize(String(Math.round(object.fontSize)));
  };
  const stepSize = (delta: number) => {
    const next = Math.min(72, Math.max(4, object.fontSize + delta));
    setSize(String(Math.round(next)));
    onPatch({ fontSize: next });
  };

  return (
    <>
      <select
        className="editor-context-select"
        aria-label="Font family"
        data-testid="editor-font-family"
        value={object.fontFamily ?? 'helvetica'}
        disabled={disabled}
        onChange={(event) => onPatch({ fontFamily: event.target.value })}
      >
        <option value="helvetica">Sans</option>
        <option value="times">Serif</option>
        <option value="courier">Mono</option>
      </select>
      <div className="editor-size-stepper">
        <button
          type="button"
          className="editor-size-step"
          aria-label="Decrease font size"
          data-testid="editor-font-size-down"
          disabled={disabled || object.fontSize <= 4}
          onClick={() => stepSize(-1)}
        >
          <Minus className="size-3" />
        </button>
        <input
          className="editor-context-size"
          aria-label="Font size"
          data-testid="editor-font-size"
          type="number"
          min={4}
          max={72}
          value={size}
          disabled={disabled}
          onChange={(event) => setSize(event.target.value)}
          onBlur={commitSize}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitSize();
              (event.target as HTMLInputElement).blur();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelSizeCommit.current = true;
              setSize(String(Math.round(object.fontSize)));
              (event.target as HTMLInputElement).blur();
            }
          }}
        />
        <button
          type="button"
          className="editor-size-step"
          aria-label="Increase font size"
          data-testid="editor-font-size-up"
          disabled={disabled || object.fontSize >= 72}
          onClick={() => stepSize(1)}
        >
          <Plus className="size-3" />
        </button>
      </div>
      <ContextIcon
        label="Bold"
        testId="editor-bold"
        disabled={disabled}
        pressed={Boolean(object.bold)}
        onClick={() => onPatch({ bold: !object.bold })}
      >
        <Bold className="size-3.5" />
      </ContextIcon>
      <ContextIcon
        label="Italic"
        testId="editor-italic"
        disabled={disabled}
        pressed={Boolean(object.italic)}
        onClick={() => onPatch({ italic: !object.italic })}
      >
        <Italic className="size-3.5" />
      </ContextIcon>
      <span className="editor-context-divider" aria-hidden />
      {(['left', 'center', 'right'] as const).map((align) => {
        const Icon = align === 'left' ? AlignLeft : align === 'center' ? AlignCenter : AlignRight;
        return (
          <ContextIcon
            key={align}
            label={`Align ${align}`}
            testId={`editor-align-${align}`}
            disabled={disabled}
            pressed={(object.align ?? 'left') === align}
            onClick={() => onPatch({ align })}
          >
            <Icon className="size-3.5" />
          </ContextIcon>
        );
      })}
      <span className="editor-context-divider" aria-hidden />
      {TEXT_SWATCHES.map((color) => (
        <SwatchButton
          key={color}
          color={color}
          active={object.color === color}
          onPick={() => onPatch({ color })}
          disabled={disabled}
        />
      ))}
    </>
  );
}

function SwatchButton({
  color,
  active,
  onPick,
  disabled,
}: {
  color: string;
  active: boolean;
  onPick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="editor-swatch"
      style={{ backgroundColor: color }}
      aria-label={`Color ${color}`}
      aria-pressed={active}
      data-testid={`editor-swatch-${color}`}
      disabled={disabled}
      onClick={onPick}
    >
      {active ? <Check className="size-2.5 text-white" strokeWidth={3} /> : null}
    </button>
  );
}

/* -------------------------------------------------------------- page rail */

export interface PageRailItem {
  pageIndex: number;
  /** Position in the rail (0-based); unique even when a page is duplicated. */
  position: number;
  displayNumber: number;
  width: number;
  height: number;
  url: string | null;
}

export interface EditorPageRailProps {
  open: boolean;
  mode: EditorMode;
  items: PageRailItem[];
  currentPage: number;
  onSelect: (pageIndex: number) => void;
  selected: ReadonlySet<number>;
  onToggleSelected: (pageIndex: number) => void;
  /** Page removal is a page-organisation capability; navigation-only rails omit it. */
  onDelete?: (pageIndexes: number[]) => void;
  onDuplicate?: (pageIndex: number) => void;
  onReorder?: (from: number, to: number) => void;
  changedPages?: ReadonlyArray<number>;
  saving?: boolean;
}

export const EditorPageRail = memo(function EditorPageRail({
  open,
  mode,
  items,
  currentPage,
  onSelect,
  selected,
  onToggleSelected,
  onDelete,
  onDuplicate,
  onReorder,
  changedPages,
  saving,
}: EditorPageRailProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const changed = useMemo(() => new Set(changedPages ?? []), [changedPages]);
  const [menu, setMenu] = useState<{ x: number; y: number; pageIndex: number } | null>(null);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    // Move focus into the menu so the context action just opened from the
    // keyboard is actually operable from the keyboard.
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.editor-page-menu')?.focus();
    });
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const onDragEnd = (event: DragEndEvent) => {
    const from = Number(event.active.id);
    const to = Number(event.over?.id);
    if (!onReorder || Number.isNaN(from) || Number.isNaN(to) || from === to) return;
    onReorder(from, to);
  };

  return (
    <aside
      className="editor-page-rail"
      data-open={open}
      aria-label="Pages"
      aria-hidden={!open}
      inert={!open ? true : undefined}
      data-testid="editor-page-rail"
      data-mode={mode}
    >
      <div className="editor-page-rail-head">
        <span>
          {items.length === 0
            ? 0
            : (items.find((item) => item.pageIndex === currentPage)?.displayNumber ??
              currentPage + 1)}{' '}
          / {items.length}
        </span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={items.map((item) => String(item.position))}
          strategy={verticalListSortingStrategy}
        >
          <div className="editor-page-rail-list">
            {items.map((item) => (
              <PageRailThumb
                key={item.position}
                item={item}
                active={item.pageIndex === currentPage}
                selected={selected.has(item.pageIndex)}
                changed={changed.has(item.pageIndex)}
                reorderable={mode === 'organize'}
                saving={saving}
                onSelect={onSelect}
                onToggleSelected={onToggleSelected}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                onOpenActions={(pageIndex, x, y) => {
                  setMenu({ x, y, pageIndex });
                }}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {menu ? (
        <div
          className="editor-page-menu"
          role="menu"
          tabIndex={-1}
          style={{ left: Math.min(menu.x, window.innerWidth - 176), top: Math.min(menu.y, window.innerHeight - 96) }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <p className="editor-page-menu-label">
            Page {items.find((item) => item.pageIndex === menu.pageIndex)?.displayNumber ?? ''}
          </p>
          {onDuplicate ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDuplicate(menu.pageIndex);
                setMenu(null);
              }}
            >
              <Copy className="size-3.5" /> Duplicate page
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => {
                onDelete([menu.pageIndex]);
                setMenu(null);
              }}
            >
              <Trash2 className="size-3.5" /> Delete page
            </button>
          ) : null}
          {!onDuplicate && !onDelete ? (
            <p className="px-2 pb-1 text-[11px] text-muted-foreground">
              Page actions are available in the Pages workspace.
            </p>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
});

function PageRailThumb({
  item,
  active,
  selected,
  changed,
  reorderable,
  saving,
  onSelect,
  onToggleSelected,
  onDelete,
  onDuplicate,
  onOpenActions,
}: {
  item: PageRailItem;
  active: boolean;
  selected: boolean;
  changed: boolean;
  reorderable: boolean;
  saving?: boolean;
  onSelect: (pageIndex: number) => void;
  onToggleSelected: (pageIndex: number) => void;
  onDelete?: (pageIndexes: number[]) => void;
  onDuplicate?: (pageIndex: number) => void;
  onOpenActions?: (pageIndex: number, x: number, y: number) => void;
}) {
  const sortable = useSortable({
    id: String(item.position),
    disabled: !reorderable || saving,
  });
  const style: CSSProperties = reorderable
    ? { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }
    : {};

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        'editor-page-thumb',
        active && 'is-active',
        selected && 'is-selected',
        sortable.isDragging && 'is-dragging',
      )}
      data-testid={`editor-page-thumb-${item.pageIndex}`}
      data-page-index={item.pageIndex}
      {...(reorderable ? sortable.attributes : {})}
      {...(reorderable ? sortable.listeners : {})}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenActions?.(item.pageIndex, event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        className="editor-page-thumb-hit"
        aria-label={`Page ${item.displayNumber}`}
        onKeyDown={(event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenActions?.(item.pageIndex, rect.left, rect.bottom);
        }}
        aria-current={active ? 'page' : undefined}
        onClick={(event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey) onToggleSelected(item.pageIndex);
          else onSelect(item.pageIndex);
        }}
        onDoubleClick={() => onToggleSelected(item.pageIndex)}
      >
        <span
          className="editor-page-thumb-frame"
          style={{ aspectRatio: `${item.width} / ${item.height}` }}
        >
          {item.url ? (
            <img
              src={item.url}
              alt={`Page ${item.displayNumber}`}
              loading="lazy"
              draggable={false}
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="editor-page-thumb-skeleton" aria-hidden />
          )}
          <span className="editor-page-thumb-number">{item.displayNumber}</span>
          {changed ? (
            <span
              className="editor-page-thumb-change"
              data-testid="ai-changed-page"
              title="The assistant has a proposed change on this page"
              aria-label="Proposed change on this page"
            >
              <Sparkles className="size-2" strokeWidth={2.5} />
            </span>
          ) : null}
        </span>
      </button>

      <div className="editor-page-thumb-actions">
        {reorderable ? (
          <span className="editor-page-thumb-grip" aria-hidden>
            <GripVertical className="size-3" />
          </span>
        ) : null}
        {onDuplicate ? (
          <button
            type="button"
            className="editor-page-thumb-action"
            aria-label="Duplicate page"
            title="Duplicate page"
            disabled={saving}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onDuplicate(item.pageIndex)}
          >
            <Copy className="size-3" />
          </button>
        ) : null}
        <button
          type="button"
          className="editor-page-thumb-action editor-page-thumb-action--danger"
          aria-label="Delete page"
          title="Delete page"
          disabled={saving}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onDelete?.([item.pageIndex])}
          hidden={!onDelete}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ status bar */

export interface EditorStatusBarProps {
  pageCount: number;
  currentPage: number;
  dirty: boolean;
  hasEdits: boolean;
  saving: boolean;
  progressLabel?: string | undefined;
  progressRatio?: number | undefined;
  onCancelSave?: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  selectionLabel?: string | null;
  toolHint?: string | null;
  objectCount?: number;
}

export function EditorStatusBar({
  pageCount,
  currentPage,
  dirty,
  hasEdits,
  saving,
  progressLabel,
  progressRatio,
  onCancelSave,
  onPrevPage,
  onNextPage,
  selectionLabel,
  toolHint,
  objectCount = 0,
}: EditorStatusBarProps) {
  const statusKey = saving ? 'saving' : dirty ? 'dirty' : hasEdits ? 'saved' : 'idle';
  return (
    <footer className="editor-status-bar" data-testid="editor-status-bar">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate" data-testid="editor-selection-status">
          {selectionLabel ?? toolHint ?? 'Select text or an object'}
        </span>
        {objectCount > 0 ? (
          <span className="editor-status-muted tabular-nums">
            {objectCount} object{objectCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      <nav aria-label="Page navigation" className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className="editor-status-icon"
          aria-label="Previous page"
          data-testid="editor-prev-page"
          disabled={currentPage <= 0}
          onClick={onPrevPage}
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <span
          className="min-w-24 text-center tabular-nums"
          data-testid="editor-page-status"
          aria-live="polite"
        >
          Page {Math.min(currentPage + 1, pageCount)} of {pageCount}
        </span>
        <button
          type="button"
          className="editor-status-icon"
          aria-label="Next page"
          data-testid="editor-next-page"
          disabled={currentPage >= pageCount - 1}
          onClick={onNextPage}
        >
          <ChevronRight className="size-3.5" />
        </button>
      </nav>

      <div
        className="ml-auto flex min-w-0 items-center gap-1.5"
        role="status"
        aria-live="polite"
        data-testid="editor-save-status"
      >
        <AnimatedContent
          key={statusKey}
          direction="horizontal"
          distance={4}
          duration={UI.fast}
          trigger="mount"
          className="flex min-w-0 items-center gap-1.5"
        >
          {saving ? (
          <>
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />
            <span className="hidden max-w-52 truncate md:inline">
              {progressLabel ?? 'Saving and verifying'}
            </span>
            {progressRatio !== undefined ? (
              <span className="tabular-nums">{formatPercent(progressRatio)}</span>
            ) : null}
            {onCancelSave ? (
              <button
                type="button"
                className="editor-status-icon text-muted-foreground"
                aria-label="Cancel save"
                data-testid="editor-cancel-save"
                onClick={onCancelSave}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </>
        ) : dirty ? (
          <>
            <span className="truncate">Unsaved changes</span>
          </>
        ) : hasEdits ? (
          <>
            <Check className="size-3.5 shrink-0 text-foreground/60" aria-hidden />
            <span className="truncate">All changes saved</span>
          </>
        ) : (
          <span className="truncate">No changes</span>
        )}
        </AnimatedContent>
      </div>
    </footer>
  );
}

/* ---------------------------------------------------------- selection UI */

export interface SelectionChipProps {
  label: string;
  detail?: string;
  onClear?: () => void;
}

export function SelectionChip({ label, detail, onClear }: SelectionChipProps) {
  return (
    <SpotlightCard
      className="editor-selection-chip"
      intensity={0.06}
      borderGlow={0.5}
      spotlightSize={140}
    >
      <span className="min-w-0 truncate">{label}</span>
      {detail ? <span className="editor-status-muted truncate">{detail}</span> : null}
      {onClear ? (
        <button type="button" className="editor-selection-clear" aria-label="Clear selection" onClick={onClear}>
          <X className="size-3" />
        </button>
      ) : null}
    </SpotlightCard>
  );
}

/** Tiny step controls shared by the status bar and keyboard zoom. */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4] as const;

export function editorStepZoom(zoom: number, direction: 'in' | 'out'): number | null {
  if (direction === 'in') return ZOOM_STEPS.find((level) => level > zoom + 0.001) ?? null;
  return [...ZOOM_STEPS].reverse().find((level) => level < zoom - 0.001) ?? null;
}
