/**
 * Editor toolbar: the edit / insert / annotate / shape tools, history, object
 * arrangement, zoom and save. Purely presentational -- every control is a
 * callback the owning tool wires up.
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  BringToFront,
  Circle,
  Eraser,
  Highlighter,
  ImagePlus,
  Loader2,
  Minus,
  MousePointer2,
  MoveHorizontal,
  PenLine,
  Redo2,
  Save,
  SendToBack,
  Square,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type EditorTool =
  | 'select'
  | 'text'
  | 'image'
  | 'signature'
  | 'highlight'
  | 'strikeout'
  | 'underline'
  | 'whiteout'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow';

interface ToolButton {
  id: EditorTool;
  label: string;
  Icon: typeof MousePointer2;
}

const EDIT_TOOLS: ToolButton[] = [
  { id: 'select', label: 'Select & move (S)', Icon: MousePointer2 },
  { id: 'text', label: 'Add or edit text (T)', Icon: Type },
];

const INSERT_TOOLS: ToolButton[] = [
  { id: 'image', label: 'Insert image (I)', Icon: ImagePlus },
  { id: 'signature', label: 'Insert signature', Icon: PenLine },
];

const ANNOTATE_TOOLS: ToolButton[] = [
  { id: 'highlight', label: 'Highlight (H)', Icon: Highlighter },
  { id: 'strikeout', label: 'Strike out', Icon: Strikethrough },
  { id: 'underline', label: 'Underline', Icon: Underline },
  // Deliberately not called "erase" and not grouped near anything that sounds
  // permanent: this paints white over the page and leaves the text underneath
  // fully recoverable. Real removal is the Redact tool, which rebuilds the page.
  { id: 'whiteout', label: 'Whiteout (cosmetic cover)', Icon: Eraser },
];

const SHAPE_TOOLS: ToolButton[] = [
  { id: 'rect', label: 'Rectangle', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', Icon: Circle },
  { id: 'line', label: 'Line', Icon: Minus },
  { id: 'arrow', label: 'Arrow', Icon: ArrowRight },
];

export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/**
 * Next preset in the requested direction. Shared with the owner's keyboard
 * shortcuts so the buttons and Ctrl +/- can never disagree about the steps.
 */
export function stepZoom(zoom: number, direction: 'in' | 'out'): number | null {
  if (direction === 'in') {
    return ZOOM_LEVELS.find((level) => level > zoom + 0.001) ?? null;
  }
  return [...ZOOM_LEVELS].reverse().find((level) => level < zoom - 0.001) ?? null;
}

export interface EditorToolbarProps {
  tool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** Reset the zoom so the widest page fits the canvas. */
  onFitWidth?: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  hasSelection: boolean;
  onDelete: () => void;
  onSave: () => void;
  saving: boolean;
  saveDisabled?: boolean;
  /** Z-order controls: only meaningful with a selected object. */
  canReorder?: boolean;
  canSendBack?: boolean;
  onReorder?: (direction: 'forward' | 'backward') => void;
  /** Show the save button (hidden until the document is loaded). */
  showSave: boolean;
  /** Label variation for the save action (Fill & Sign says "Sign & export"). */
  saveLabel?: string;
}

function ToolButtonView({
  tool,
  active,
  disabled,
  onToolChange,
}: {
  tool: ToolButton;
  active: boolean;
  disabled?: boolean;
  onToolChange: (tool: EditorTool) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? 'default' : 'ghost'}
          size="icon"
          className="size-8"
          aria-pressed={active}
          aria-label={tool.label}
          data-testid={`editor-tool-${tool.id}`}
          disabled={disabled}
          onClick={() => onToolChange(tool.id)}
        >
          <tool.Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tool.label}</TooltipContent>
    </Tooltip>
  );
}

function GroupLabel({ children }: { children: string }) {
  return (
    <span className="hidden shrink-0 select-none pl-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/80 uppercase min-[1400px]:block">
      {children}
    </span>
  );
}

function ToolGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label={`${label} tools`}>
      <GroupLabel>{label}</GroupLabel>
      {children}
    </div>
  );
}

function ToolbarButton({
  label,
  testId,
  disabled,
  onClick,
  destructive = false,
  children,
}: {
  label: string;
  testId?: string;
  disabled?: boolean;
  onClick: () => void;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={destructive ? 'size-8 text-destructive hover:text-destructive' : 'size-8'}
          aria-label={label}
          data-testid={testId}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function EditorToolbar({
  tool,
  onToolChange,
  zoom,
  onZoomChange,
  onFitWidth,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasSelection,
  onDelete,
  onSave,
  saving,
  saveDisabled = false,
  canReorder = false,
  canSendBack = false,
  onReorder,
  showSave,
  saveLabel = 'Save changes',
}: EditorToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Relative steps: the editor also opens at a fit-width zoom that is not one
  // of the presets, so +/- walk the preset list from wherever we actually are.
  const zoomIn = () => {
    const next = stepZoom(zoom, 'in');
    if (next !== null) onZoomChange(next);
  };
  const zoomOut = () => {
    const next = stepZoom(zoom, 'out');
    if (next !== null) onZoomChange(next);
  };
  const locked = saving;

  /**
   * Arrow-key traversal over the real buttons. Without stopping propagation the
   * document-level handler would treat the same arrow press as an object nudge.
   */
  const onToolbarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      toolbarRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [],
    );
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    let next = index;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (forward) next = (index + 1) % buttons.length;
    else if (backward) next = (index - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div
      ref={toolbarRef}
      className="relative z-20 flex min-h-14 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b bg-card px-3 py-1.5"
      data-testid="editor-toolbar"
      role="toolbar"
      aria-label="Editor tools"
      aria-orientation="horizontal"
      onKeyDown={onToolbarKeyDown}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
        <ToolGroup label="Edit">
          {EDIT_TOOLS.map((entry) => (
            <ToolButtonView
              key={entry.id}
              tool={entry}
              active={tool === entry.id}
              disabled={locked}
              onToolChange={onToolChange}
            />
          ))}
        </ToolGroup>

        <Separator orientation="vertical" className="mx-0.5 hidden h-6 lg:block" />

        <ToolGroup label="Insert">
          {INSERT_TOOLS.map((entry) => (
            <ToolButtonView
              key={entry.id}
              tool={entry}
              active={tool === entry.id}
              disabled={locked}
              onToolChange={onToolChange}
            />
          ))}
        </ToolGroup>

        <Separator orientation="vertical" className="mx-0.5 hidden h-6 lg:block" />

        <ToolGroup label="Annotate">
          {ANNOTATE_TOOLS.map((entry) => (
            <ToolButtonView
              key={entry.id}
              tool={entry}
              active={tool === entry.id}
              disabled={locked}
              onToolChange={onToolChange}
            />
          ))}
        </ToolGroup>

        <Separator orientation="vertical" className="mx-0.5 hidden h-6 lg:block" />

        <ToolGroup label="Shapes">
          {SHAPE_TOOLS.map((entry) => (
            <ToolButtonView
              key={entry.id}
              tool={entry}
              active={tool === entry.id}
              disabled={locked}
              onToolChange={onToolChange}
            />
          ))}
        </ToolGroup>

        <Separator orientation="vertical" className="mx-0.5 hidden h-6 lg:block" />

        <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="History and arrangement">
          <ToolbarButton label="Undo (Ctrl+Z)" testId="editor-undo" disabled={!canUndo} onClick={onUndo}>
            <Undo2 className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Redo (Ctrl+Shift+Z)"
            testId="editor-redo"
            disabled={!canRedo}
            onClick={onRedo}
          >
            <Redo2 className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Delete (Del)"
            testId="editor-delete"
            disabled={!hasSelection}
            onClick={onDelete}
            destructive
          >
            <Trash2 className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Bring forward"
            testId="editor-bring-forward"
            disabled={!canReorder}
            onClick={() => onReorder?.('forward')}
          >
            <BringToFront className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Send backward"
            testId="editor-send-backward"
            disabled={!canSendBack}
            onClick={() => onReorder?.('backward')}
          >
            <SendToBack className="size-4" />
          </ToolbarButton>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5 max-[1023px]:w-full max-[1023px]:justify-end max-[1023px]:border-t max-[1023px]:pt-1">
        <ToolbarButton
          label="Zoom out (Ctrl+-)"
          testId="editor-zoom-out"
          disabled={zoom <= ZOOM_LEVELS[0]!}
          onClick={zoomOut}
        >
          <ZoomOut className="size-4" />
        </ToolbarButton>
        <span
          className="w-10 text-center text-xs text-muted-foreground tabular-nums"
          data-testid="editor-zoom-level"
          aria-live="polite"
        >
          {Math.round(zoom * 100)}%
        </span>
        <ToolbarButton
          label="Zoom in (Ctrl++)"
          testId="editor-zoom-in"
          disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!}
          onClick={zoomIn}
        >
          <ZoomIn className="size-4" />
        </ToolbarButton>
        {onFitWidth && (
          <ToolbarButton
            label="Fit width (Ctrl+0)"
            testId="editor-fit-width"
            onClick={onFitWidth}
          >
            <MoveHorizontal className="size-4" />
          </ToolbarButton>
        )}

        {showSave && (
          <>
            <Separator orientation="vertical" className="mx-1.5 h-6" />
            <Button
              type="button"
              size="sm"
              className="h-8"
              data-testid="editor-save"
              disabled={saving || saveDisabled}
              onClick={onSave}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              <span>{saving ? 'Saving…' : saveLabel}</span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
