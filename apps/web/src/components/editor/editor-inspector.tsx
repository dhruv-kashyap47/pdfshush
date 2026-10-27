/**
 * Inspector: contextual controls for the selected object. Style changes are
 * discrete `apply` operations (each one is its own undo step), unlike drag
 * gestures which checkpoint once at release.
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  Eraser,
  GripHorizontal,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Minus,
  Square,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import type { EditorObject } from '@pdfshush/pdf-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const SWATCHES = ['#111827', '#6b7280', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ffe066'];
const FILL_SWATCHES = ['none', '#dbeafe', '#dcfce7', '#fef3c7', '#fee2e2', '#f3e8ff', '#ffffff'];

export interface EditorInspectorProps {
  object: EditorObject;
  onPatch: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  /** Render inside the workspace rail instead of over the document. */
  docked?: boolean;
  /** Escape hatch for the docked rail; deselects the object. */
  onClose?: () => void;
}

const OBJECT_TITLES: Record<EditorObject['kind'], string> = {
  text: 'Text',
  image: 'Image',
  whiteout: 'Whiteout',
  highlight: 'Highlight',
  strikeout: 'Strikeout',
  underline: 'Underline',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
};

const OBJECT_ICONS: Record<EditorObject['kind'], typeof Type> = {
  text: Type,
  image: ImageIcon,
  whiteout: Eraser,
  highlight: Highlighter,
  strikeout: Highlighter,
  underline: Highlighter,
  rect: Square,
  ellipse: Square,
  line: Minus,
  arrow: Minus,
};

/** Dark check mark on light swatches, white on dark ones. */
function checkInk(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#ffffff';
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111827' : '#ffffff';
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Label className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </Label>
  );
}

function Swatches({
  colors,
  active,
  onPick,
  label,
}: {
  colors: string[];
  active: string | undefined;
  onPick: (color: string | undefined) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={label}>
      {colors.map((color) => {
        const selected = active === color || (color === 'none' && !active);
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color === 'none' ? `${label}: none` : color}
            title={color === 'none' ? 'No fill' : color}
            data-testid={`inspector-swatch-${color}`}
            className={cn(
              'flex size-6 items-center justify-center rounded-full border shadow-sm transition-transform hover:scale-110',
              selected && 'ring-2 ring-blue-600 ring-offset-2 ring-offset-background',
            )}
            style={
              color === 'none'
                ? {
                    backgroundImage:
                      'linear-gradient(45deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)',
                    backgroundColor: '#fff',
                  }
                : { backgroundColor: color }
            }
            onClick={() => onPick(color === 'none' ? undefined : color)}
          >
            {selected && color !== 'none' ? (
              <Check className="size-3" strokeWidth={3} style={{ color: checkInk(color) }} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function IconAction({
  label,
  testId,
  onClick,
  children,
  destructive = false,
}: {
  label: string;
  testId?: string;
  onClick: () => void;
  children: ReactNode;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'size-7',
            destructive
              ? 'text-muted-foreground hover:text-destructive'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-label={label}
          data-testid={testId}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function EditorInspector({
  object,
  onPatch,
  onDelete,
  docked = false,
  onClose,
}: EditorInspectorProps) {
  const kind = object.kind;
  const panelRef = useRef<HTMLElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const title = OBJECT_TITLES[kind];
  const Icon = OBJECT_ICONS[kind];

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const onMove = (moveEvent: PointerEvent) => {
      const width = panelRef.current?.offsetWidth ?? 288;
      const height = panelRef.current?.offsetHeight ?? 288;
      const nextX = Math.max(8, Math.min(window.innerWidth - width - 8, moveEvent.clientX - dragOffset.current.x));
      const nextY = Math.max(8, Math.min(window.innerHeight - height - 8, moveEvent.clientY - dragOffset.current.y));
      setPosition({ x: nextX, y: nextY });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    event.preventDefault();
  };

  return (
    <aside
      ref={panelRef}
      className={cn(
        'flex min-h-0 min-w-0 flex-col bg-card',
        docked
          ? 'h-full w-full'
          : 'fixed z-30 max-h-[80vh] w-72 max-w-[calc(100vw-1rem)] rounded-lg border shadow-xl',
      )}
      data-testid="editor-inspector"
      role="region"
      aria-label={`${title} properties`}
      style={
        !docked && position
          ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' }
          : docked
            ? undefined
            : { right: 16, bottom: 16 }
      }
    >
      <div
        className={cn(
          'flex h-12 shrink-0 items-center gap-2',
          docked ? 'border-b px-4' : 'border-b px-3',
        )}
      >
        {!docked && (
          <button
            type="button"
            aria-label="Drag properties panel"
            data-testid="editor-inspector-drag-handle"
            onPointerDown={startDrag}
            className="touch-none cursor-move rounded p-1 text-muted-foreground hover:bg-muted"
          >
            <GripHorizontal className="size-4" />
          </button>
        )}
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" data-testid="editor-inspector-title">
          {title}
        </span>
        <IconAction label="Delete object" testId="inspector-delete" onClick={onDelete} destructive>
          <Trash2 className="size-4" />
        </IconAction>
        {onClose && (
          <IconAction label="Close properties" testId="inspector-close" onClick={onClose}>
            <X className="size-4" />
          </IconAction>
        )}
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto', docked ? 'p-4' : 'max-h-[60vh] p-3')}>
        <div className="flex flex-col gap-5">
          {kind === 'text' ? (
            <>
              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2.5">
                <div className="flex flex-col gap-1.5">
                  <SectionLabel>Size</SectionLabel>
                  <div className="relative">
                    <FontSizeInput value={object.fontSize} onCommit={(fontSize) => onPatch({ fontSize })} />
                    <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground">
                      pt
                    </span>
                  </div>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <SectionLabel>Font</SectionLabel>
                  <select
                    id="inspector-font-family"
                    aria-label="Font family"
                    data-testid="inspector-font-family"
                    className="h-8 w-full rounded-md border bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    value={object.fontFamily ?? 'helvetica'}
                    onChange={(event) => onPatch({ fontFamily: event.target.value })}
                  >
                    <option value="helvetica">Sans-serif</option>
                    <option value="times">Serif</option>
                    <option value="courier">Monospace</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <SectionLabel>Style & alignment</SectionLabel>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-0.5 rounded-md border p-0.5">
                    <Button
                      type="button"
                      variant={object.bold ? 'default' : 'ghost'}
                      size="icon"
                      className="size-7"
                      aria-label="Bold"
                      aria-pressed={Boolean(object.bold)}
                      data-testid="inspector-bold"
                      onClick={() => onPatch({ bold: !object.bold })}
                    >
                      <Bold className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant={object.italic ? 'default' : 'ghost'}
                      size="icon"
                      className="size-7"
                      aria-label="Italic"
                      aria-pressed={Boolean(object.italic)}
                      data-testid="inspector-italic"
                      onClick={() => onPatch({ italic: !object.italic })}
                    >
                      <Italic className="size-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-0.5 rounded-md border p-0.5">
                    {(['left', 'center', 'right'] as const).map((align) => {
                      const AlignIcon =
                        align === 'left' ? AlignLeft : align === 'center' ? AlignCenter : AlignRight;
                      return (
                        <Button
                          key={align}
                          type="button"
                          variant={(object.align ?? 'left') === align ? 'default' : 'ghost'}
                          size="icon"
                          className="size-7"
                          aria-label={`Align ${align}`}
                          aria-pressed={(object.align ?? 'left') === align}
                          data-testid={`inspector-align-${align}`}
                          onClick={() => onPatch({ align })}
                        >
                          <AlignIcon className="size-3.5" />
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <SectionLabel>Text color</SectionLabel>
                <Swatches
                  label="Text color"
                  colors={SWATCHES}
                  active={object.color}
                  onPick={(color) => onPatch({ color: color ?? '#111827' })}
                />
              </div>
            </>
          ) : null}

          {kind === 'rect' || kind === 'ellipse' || kind === 'line' || kind === 'arrow' ? (
            <>
              <div className="flex flex-col gap-2">
                <SectionLabel>Stroke</SectionLabel>
                <Swatches
                  label="Stroke color"
                  colors={SWATCHES}
                  active={object.stroke}
                  onPick={(color) => onPatch({ stroke: color ?? '#1f293b' })}
                />
              </div>
              {kind === 'rect' || kind === 'ellipse' ? (
                <div className="flex flex-col gap-2">
                  <SectionLabel>Fill</SectionLabel>
                  <Swatches
                    label="Fill color"
                    colors={FILL_SWATCHES}
                    active={object.fill}
                    onPick={(color) => onPatch({ fill: color })}
                  />
                </div>
              ) : null}
              <StrokeWidthPicker
                value={object.strokeWidth ?? 1.5}
                onChange={(strokeWidth) => onPatch({ strokeWidth })}
              />
            </>
          ) : null}

          {kind === 'strikeout' || kind === 'underline' ? (
            <>
              <div className="flex flex-col gap-2">
                <SectionLabel>Mark color</SectionLabel>
                <Swatches
                  label="Mark color"
                  colors={SWATCHES}
                  active={object.color}
                  onPick={(color) => onPatch({ color })}
                />
              </div>
              <StrokeWidthPicker
                value={object.strokeWidth ?? 1.5}
                onChange={(strokeWidth) => onPatch({ strokeWidth })}
              />
            </>
          ) : null}

          {kind === 'highlight' ? (
            <div className="flex flex-col gap-2">
              <SectionLabel>Highlight color</SectionLabel>
              <Swatches
                label="Highlight color"
                colors={SWATCHES}
                active={object.color}
                onPick={(color) => onPatch({ color: color ?? '#ffe066' })}
              />
            </div>
          ) : null}

          {kind === 'image' ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Drag to move the image. Use the corner handles to resize it proportionally.
            </p>
          ) : null}
        </div>
      </div>

      <div className={cn('flex shrink-0 items-center justify-between gap-2 border-t', docked ? 'px-4 py-2.5' : 'px-3 py-2')}>
        <span className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Size
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {Math.round(object.width)} × {Math.round(object.height)} pt
        </span>
      </div>
    </aside>
  );
}

/**
 * Font size edits are typed, not stepped -- but each keystroke must not become
 * its own undo entry, so the value is committed on blur or Enter.
 */
function FontSizeInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (fontSize: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) onCommit(Math.min(72, Math.max(4, parsed)));
    setDraft(null);
  };

  return (
    <Input
      id="inspector-font-size"
      type="number"
      min={4}
      max={72}
      className="h-8 pr-7 tabular-nums"
      data-testid="inspector-font-size"
      value={draft ?? String(Math.round(value))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit((event.target as HTMLInputElement).value);
          (event.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function StrokeWidthPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>Stroke width</SectionLabel>
      <div className="flex items-center gap-0.5 self-start rounded-md border p-0.5">
        {[1, 1.5, 2, 3, 5].map((width) => (
          <Button
            key={width}
            type="button"
            variant={value === width ? 'default' : 'ghost'}
            size="sm"
            className="h-7 min-w-8 px-2 text-xs tabular-nums"
            aria-pressed={value === width}
            data-testid={`inspector-stroke-${width}`}
            onClick={() => onChange(width)}
          >
            {width}
          </Button>
        ))}
      </div>
    </div>
  );
}
