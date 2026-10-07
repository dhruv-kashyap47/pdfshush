/**
 * Editor toolbar: the three edit modes (Edit / Insert / Annotate), history
 * controls, zoom, and the save button. Purely presentational -- every control
 * is a callback the owning tool wires up.
 */

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
  Redo2,
  Save,
  SendToBack,
  Square,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type EditorTool =
  | 'select'
  | 'text'
  | 'image'
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

const INSERT_TOOLS: ToolButton[] = [{ id: 'image', label: 'Insert image (I)', Icon: ImagePlus }];

const ANNOTATE_TOOLS: ToolButton[] = [
  { id: 'highlight', label: 'Highlight (H)', Icon: Highlighter },
  { id: 'strikeout', label: 'Strike out', Icon: Strikethrough },
  { id: 'underline', label: 'Underline', Icon: Underline },
  { id: 'whiteout', label: 'Whiteout / erase text', Icon: Eraser },
];

const SHAPE_TOOLS: ToolButton[] = [
  { id: 'rect', label: 'Rectangle', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', Icon: Circle },
  { id: 'line', label: 'Line', Icon: Minus },
  { id: 'arrow', label: 'Arrow', Icon: ArrowRight },
];

export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export interface EditorToolbarProps {
  tool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
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
    <span className="hidden select-none text-[10px] font-medium tracking-wide text-muted-foreground uppercase lg:block">
      {children}
    </span>
  );
}

export function EditorToolbar({
  tool,
  onToolChange,
  zoom,
  onZoomChange,
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
}: EditorToolbarProps) {
  // Relative steps: the editor also opens at a fit-width zoom that is not one
  // of the presets, so +/- walk the preset list from wherever we actually are.
  const zoomIn = () => {
    const next = ZOOM_LEVELS.find((level) => level > zoom + 0.001);
    if (next) onZoomChange(next);
  };
  const zoomOut = () => {
    const previous = [...ZOOM_LEVELS].reverse().find((level) => level < zoom - 0.001);
    if (previous) onZoomChange(previous);
  };
  const locked = saving;

  return (
    <div
      className="sticky top-0 z-20 flex flex-wrap items-center gap-1 border-b bg-background/95 px-2 py-1.5 backdrop-blur"
      data-testid="editor-toolbar"
      role="toolbar"
      aria-label="Editor tools"
    >
      <GroupLabel>Edit</GroupLabel>
      {EDIT_TOOLS.map((entry) => (
        <ToolButtonView
          key={entry.id}
          tool={entry}
          active={tool === entry.id}
          disabled={locked}
          onToolChange={onToolChange}
        />
      ))}

      <Separator orientation="vertical" className="mx-1 h-6" />
      <GroupLabel>Insert</GroupLabel>
      {INSERT_TOOLS.map((entry) => (
        <ToolButtonView
          key={entry.id}
          tool={entry}
          active={tool === entry.id}
          disabled={locked}
          onToolChange={onToolChange}
        />
      ))}

      <Separator orientation="vertical" className="mx-1 h-6" />
      <GroupLabel>Annotate</GroupLabel>
      {ANNOTATE_TOOLS.map((entry) => (
        <ToolButtonView
          key={entry.id}
          tool={entry}
          active={tool === entry.id}
          disabled={locked}
          onToolChange={onToolChange}
        />
      ))}
      <Separator orientation="vertical" className="mx-1 h-6" />
      {SHAPE_TOOLS.map((entry) => (
        <ToolButtonView
          key={entry.id}
          tool={entry}
          active={tool === entry.id}
          disabled={locked}
          onToolChange={onToolChange}
        />
      ))}

      <Separator orientation="vertical" className="mx-1 h-6" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Undo"
            data-testid="editor-undo"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Undo2 className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Redo"
            data-testid="editor-redo"
            disabled={!canRedo}
            onClick={onRedo}
          >
            <Redo2 className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-destructive hover:text-destructive"
            aria-label="Delete selected object"
            data-testid="editor-delete"
            disabled={!hasSelection}
            onClick={onDelete}
          >
            <Trash2 className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete (Del)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Bring forward"
            data-testid="editor-bring-forward"
            disabled={!canReorder}
            onClick={() => onReorder?.('forward')}
          >
            <BringToFront className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Bring forward</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Send backward"
            data-testid="editor-send-backward"
            disabled={!canSendBack}
            onClick={() => onReorder?.('backward')}
          >
            <SendToBack className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Send backward</TooltipContent>
      </Tooltip>

      <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Zoom out"
              data-testid="editor-zoom-out"
              disabled={zoom <= ZOOM_LEVELS[0]!}
              onClick={zoomOut}
            >
              <span className="text-sm leading-none">−</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom out</TooltipContent>
        </Tooltip>
        <span
          className="w-11 text-center text-xs text-muted-foreground tabular-nums"
          data-testid="editor-zoom-level"
        >
          {Math.round(zoom * 100)}%
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Zoom in"
              data-testid="editor-zoom-in"
              disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!}
              onClick={zoomIn}
            >
              <span className="text-sm leading-none">+</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom in</TooltipContent>
        </Tooltip>

        {showSave && (
          <>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <Button
              type="button"
              size="sm"
              className="h-8"
              data-testid="editor-save"
              disabled={saving || saveDisabled}
              onClick={onSave}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
