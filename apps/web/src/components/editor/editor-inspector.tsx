/**
 * Inspector: contextual controls for the selected object. Style changes are
 * discrete `apply` operations (each one is its own undo step), unlike drag
 * gestures which checkpoint once at release.
 */

import { useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, GripHorizontal, Italic, Trash2 } from 'lucide-react';
import type { EditorObject } from '@pdfshush/pdf-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const SWATCHES = ['#111827', '#6b7280', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ffe066'];
const FILL_SWATCHES = ['none', '#dbeafe', '#dcfce7', '#fef3c7', '#fee2e2', '#f3e8ff', '#ffffff'];

export interface EditorInspectorProps {
  object: EditorObject;
  onPatch: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
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
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label={label}>
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={active === color || (color === 'none' && !active)}
          aria-label={color === 'none' ? `${label}: none` : color}
          data-testid={`inspector-swatch-${color}`}
          className={cn(
            'size-5 rounded-full border shadow-sm transition-transform hover:scale-110',
            (active === color || (color === 'none' && !active)) && 'ring-2 ring-blue-500 ring-offset-1',
          )}
          style={
            color === 'none'
              ? { backgroundImage: 'linear-gradient(45deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)', backgroundColor: '#fff' }
              : { backgroundColor: color }
          }
          onClick={() => onPick(color === 'none' ? undefined : color)}
        />
      ))}
    </div>
  );
}

export function EditorInspector({ object, onPatch, onDelete }: EditorInspectorProps) {
  const kind = object.kind;
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const onMove = (moveEvent: PointerEvent) => {
      const width = panelRef.current?.offsetWidth ?? 256;
      const height = panelRef.current?.offsetHeight ?? 256;
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
    <div
      ref={panelRef}
      className="fixed z-30 w-64 max-w-[calc(100vw-1rem)] rounded-lg border bg-background p-3 shadow-lg"
      data-testid="editor-inspector"
      role="region"
      aria-label="Object properties"
      style={
        position
          ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' }
          : { right: 16, bottom: 16 }
      }
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Drag properties panel"
          data-testid="editor-inspector-drag-handle"
          onPointerDown={startDrag}
          className="touch-none cursor-move rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <GripHorizontal className="size-4" />
        </button>
        <span className="flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {kind === 'text' ? 'Text' : kind === 'image' ? 'Image' : kind === 'line' || kind === 'arrow' ? 'Line' : kind === 'rect' || kind === 'ellipse' ? 'Shape' : kind === 'whiteout' ? 'Whiteout' : 'Annotation'}
        </span>
        <Button
          onPointerDown={(event) => event.stopPropagation()}

          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-destructive hover:text-destructive"
          aria-label="Delete object"
          data-testid="inspector-delete"
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
        {kind === 'text' ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="inspector-font-size" className="text-[11px]">
                  Size
                </Label>
                <FontSizeInput value={object.fontSize} onCommit={(fontSize) => onPatch({ fontSize })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Style</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant={object.bold ? 'default' : 'outline'}
                    size="icon"
                    className="h-7 w-7"
                    aria-pressed={Boolean(object.bold)}
                    data-testid="inspector-bold"
                    onClick={() => onPatch({ bold: !object.bold })}
                  >
                    <Bold className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant={object.italic ? 'default' : 'outline'}
                    size="icon"
                    className="h-7 w-7"
                    aria-pressed={Boolean(object.italic)}
                    data-testid="inspector-italic"
                    onClick={() => onPatch({ italic: !object.italic })}
                  >
                    <Italic className="size-4" />
                  </Button>
                  {(['left', 'center', 'right'] as const).map((align) => {
                    const Icon = align === 'left' ? AlignLeft : align === 'center' ? AlignCenter : AlignRight;
                    return (
                      <Button
                        key={align}
                        type="button"
                        variant={(object.align ?? 'left') === align ? 'default' : 'outline'}
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Align ${align}`}
                        data-testid={`inspector-align-${align}`}
                        onClick={() => onPatch({ align })}
                      >
                        <Icon className="size-4" />
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Font</Label>
              <select
                data-testid="inspector-font-family"
                className="h-7 rounded-md border bg-background px-2 text-xs"
                value={object.fontFamily ?? 'helvetica'}
                onChange={(event) => onPatch({ fontFamily: event.target.value })}
              >
                <option value="helvetica">Sans-serif</option>
                <option value="times">Serif</option>
                <option value="courier">Monospace</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Color</Label>
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
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Stroke</Label>
              <Swatches
                label="Stroke color"
                colors={SWATCHES}
                active={object.stroke}
                onPick={(color) => onPatch({ stroke: color ?? '#1f293b' })}
              />
            </div>
            {kind === 'rect' || kind === 'ellipse' ? (
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Fill</Label>
                <Swatches
                  label="Fill color"
                  colors={FILL_SWATCHES}
                  active={object.fill}
                  onPick={(color) => onPatch({ fill: color })}
                />
              </div>
            ) : null}
            <StrokeWidthPicker value={object.strokeWidth ?? 1.5} onChange={(strokeWidth) => onPatch({ strokeWidth })} />
          </>
        ) : null}

        {kind === 'strikeout' || kind === 'underline' ? (
          <>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Color</Label>
              <Swatches
                label="Mark color"
                colors={SWATCHES}
                active={object.color}
                onPick={(color) => onPatch({ color })}
              />
            </div>
            <StrokeWidthPicker value={object.strokeWidth ?? 1.5} onChange={(strokeWidth) => onPatch({ strokeWidth })} />
          </>
        ) : null}

        {kind === 'highlight' ? (
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Color</Label>
            <Swatches
              label="Highlight color"
              colors={SWATCHES}
              active={object.color}
              onPick={(color) => onPatch({ color: color ?? '#ffe066' })}
            />
          </div>
        ) : null}

        {kind === 'image' ? (
          <p className="text-xs text-muted-foreground">
            Drag to move, corner handles to resize.
          </p>
        ) : null}

        <Separator />
        <div className="text-[11px] text-muted-foreground">
          {Math.round(object.width)} × {Math.round(object.height)} pt
        </div>
      </div>
    </div>
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
      className="h-7"
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
    <div className="flex flex-col gap-1">
      <Label className="text-[11px]">Width</Label>
      <div className="flex gap-1">
        {[1, 1.5, 2, 3, 5].map((width) => (
          <Button
            key={width}
            type="button"
            variant={value === width ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2 text-xs"
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
