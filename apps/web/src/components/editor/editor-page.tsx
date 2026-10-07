/**
 * One PDF page inside the editor: raster underneath, DOM overlay of editable
 * objects and live form inputs above it, all in display-space coordinates
 * (top-left origin, y down) scaled by `zoom` (1 = 100% = 1pt per px).
 *
 * Gestures (create / move / resize) run against window listeners so a drag
 * keeps working when the pointer leaves the page. Live updates flow through
 * `onMoveLive` / `onResizeLive`; history checkpoints are taken by the owner
 * (`onBeginTx` at gesture start, `onEndTx` at release).
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { EditorObject, FormWidgetInfo, TextRun } from '@pdfshush/pdf-core';
import { Skeleton } from '@/components/ui/skeleton';
import type { EditorTool } from '@/components/editor/editor-toolbar';
import { cn } from '@/lib/utils';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorPageProps {
  pageIndex: number;
  /** Display size in pt (from inspect). */
  width: number;
  height: number;
  zoom: number;
  rasterUrl: string | null;
  objects: EditorObject[];
  selectedId: string | null;
  editingId: string | null;
  tool: EditorTool;
  runs: TextRun[] | null;
  widgets: FormWidgetInfo[];
  formValues: Record<string, string | boolean>;

  onSelect: (id: string | null) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: () => void;
  onEditText: (id: string, text: string) => void;
  onCreate: (object: EditorObject) => void;
  onSeedReplace: (run: TextRun) => void;
  onImageRequested: (point: { x: number; y: number }) => void;
  /** Fired once when the page scrolls near the viewport (lazy raster load). */
  onVisible?: () => void;
  onBeginTx: () => void;
  onEndTx: () => void;
  onMoveLive: (id: string, x: number, y: number) => void;
  onResizeLive: (id: string, rect: Rect) => void;
  onFormValue: (name: string, value: string | boolean) => void;
}

type Gesture =
  | { kind: 'create'; startX: number; startY: number }
  | { kind: 'move'; id: string; startLocalX: number; startLocalY: number; origX: number; origY: number }
  | { kind: 'resize'; id: string; corner: 'nw' | 'ne' | 'sw' | 'se'; orig: Rect };

const MIN_SIZE = 8;
const MIN_DRAG = 6;

const DEFAULT_COLORS = {
  text: '#121212',
  highlight: '#ffe066',
  strikeout: '#d92b2b',
  underline: '#1a57e6',
  ink: '#1f293b',
} as const;

let idCounter = 0;
function newObjectId(): string {
  idCounter += 1;
  return `o${Date.now().toString(36)}${idCounter.toString(36)}`;
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return { x, y, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

function objectForTool(tool: EditorTool, pageIndex: number, rect: Rect): EditorObject | null {
  const base = { id: newObjectId(), pageIndex, ...rect };
  switch (tool) {
    case 'text':
      return {
        ...base,
        kind: 'text',
        text: '',
        fontSize: 16,
        color: DEFAULT_COLORS.text,
        width: Math.max(rect.width, 60),
        height: Math.max(rect.height, 20),
      };
    case 'highlight':
    case 'strikeout':
    case 'underline':
    case 'whiteout':
      // Marks hug their target line: a thin horizontal drag still paints a bar
      // tall enough to see and hit.
      return {
        ...base,
        kind: tool,
        ...(tool === 'highlight' ? { color: DEFAULT_COLORS.highlight } : {}),
        width: Math.max(rect.width, 20),
        height: Math.max(rect.height, 8),
      } as EditorObject;
    case 'rect':
    case 'ellipse':
      return {
        ...base,
        kind: tool,
        stroke: DEFAULT_COLORS.ink,
        strokeWidth: 1.5,
        width: Math.max(rect.width, 40),
        height: Math.max(rect.height, 30),
      };
    case 'line':
    case 'arrow':
      return { ...base, kind: tool, stroke: DEFAULT_COLORS.ink, strokeWidth: 1.5 };
    default:
      return null;
  }
}

function defaultRectFor(tool: EditorTool, x: number, y: number): Rect {
  switch (tool) {
    case 'text':
      return { x, y, width: 220, height: 22 };
    case 'highlight':
    case 'strikeout':
    case 'underline':
    case 'whiteout':
      return { x, y, width: 150, height: 16 };
    case 'rect':
    case 'ellipse':
      return { x, y, width: 120, height: 80 };
    case 'line':
    case 'arrow':
      return { x, y, width: 140, height: 0 };
    default:
      return { x, y, width: 1, height: 1 };
  }
}

function hitRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** Converts `#rrggbb` to an 8-digit hex with the given alpha (highlight preview). */
function hexWithAlpha(hex: string | undefined, alpha: number, fallback: string): string {
  const source = hex ?? fallback;
  const short = /^#[0-9a-f]{3}$/i.test(source)
    ? source
        .split('')
        .map((c) => c + c)
        .join('')
    : source;
  const alphaHex = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return /^#[0-9a-f]{6}$/i.test(short) ? `${short}${alphaHex}` : fallback;
}

export function EditorPage(props: EditorPageProps) {
  const {
    pageIndex,
    width,
    height,
    zoom,
    rasterUrl,
    objects,
    selectedId,
    editingId,
    tool,
    runs,
    widgets,
    formValues,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [ghost, setGhost] = useState<Rect | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const displayW = width * zoom;
  const displayH = height * zoom;

  const toLocal = (clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
  };

  const startGesture = (gesture: Gesture) => {
    const p = propsRef.current;
    gestureRef.current = gesture;
    if (gesture.kind !== 'create') p.onBeginTx();
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);
    window.addEventListener('blur', onWindowBlur);
  };

  const stopGesture = () => {
    gestureRef.current = null;
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    window.removeEventListener('pointercancel', onWindowUp);
    window.removeEventListener('blur', onWindowBlur);
  };

  /** Pointer released outside the window: commit what moved, cancel ghosts. */
  function onWindowBlur() {
    const gesture = gestureRef.current;
    const p = propsRef.current;
    stopGesture();
    setGhost(null);
    if (gesture && gesture.kind !== 'create') p.onEndTx();
  }

  function onWindowMove(event: PointerEvent) {
    const gesture = gestureRef.current;
    const p = propsRef.current;
    if (!gesture || !containerRef.current) return;
    const point = toLocal(event.clientX, event.clientY);

    if (gesture.kind === 'create') {
      setGhost(normalizeRect(gesture.startX, gesture.startY, point.x, point.y));
      return;
    }
    if (gesture.kind === 'move') {
      p.onMoveLive(
        gesture.id,
        Math.round(gesture.origX + (point.x - gesture.startLocalX)),
        Math.round(gesture.origY + (point.y - gesture.startLocalY)),
      );
      return;
    }
    // resize: rebuild the rect from the original box and the active corner.
    const { orig, corner } = gesture;
    let left = orig.x;
    let top = orig.y;
    let right = orig.x + orig.width;
    let bottom = orig.y + orig.height;
    if (corner === 'nw' || corner === 'ne') top = point.y;
    if (corner === 'sw' || corner === 'se') bottom = point.y;
    if (corner === 'nw' || corner === 'sw') left = point.x;
    if (corner === 'ne' || corner === 'se') right = point.x;
    const next = normalizeRect(left, top, right, bottom);
    p.onResizeLive(gesture.id, {
      x: next.x,
      y: next.y,
      width: Math.max(MIN_SIZE, next.width),
      height: Math.max(MIN_SIZE, next.height),
    });
  }

  function onWindowUp(event: PointerEvent) {
    const gesture = gestureRef.current;
    const p = propsRef.current;
    stopGesture();
    if (!gesture) return;

    if (gesture.kind === 'create') {
      const point = toLocal(event.clientX, event.clientY);
      const dragged = normalizeRect(gesture.startX, gesture.startY, point.x, point.y);
      const useDefault = dragged.width < MIN_DRAG && dragged.height < MIN_DRAG;
      const rect = useDefault
        ? defaultRectFor(p.tool, gesture.startX, gesture.startY)
        : dragged;
      setGhost(null);
      if (p.tool === 'line' || p.tool === 'arrow') {
        const dx = point.x - gesture.startX;
        const dy = point.y - gesture.startY;
        const object = objectForTool(p.tool, p.pageIndex, rect);
        if (object && (object.kind === 'line' || object.kind === 'arrow')) {
          object.reverse = dx * dy < 0;
        }
        if (object) p.onCreate(object);
        return;
      }
      const object = objectForTool(p.tool, p.pageIndex, rect);
      if (!object) return;
      p.onCreate(object);
      if (object.kind === 'text') p.onStartEdit(object.id);
      return;
    }
    p.onEndTx();
  }

  useEffect(() => stopGesture, []);

  // Lazy raster loading: ask the owner for this page's bitmap once it is near
  // the viewport (deduped on the owner's side).
  const visibleRef = useRef(props.onVisible);
  visibleRef.current = props.onVisible;
  useEffect(() => {
    const element = containerRef.current;
    const callback = visibleRef.current;
    if (!element || !callback) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          callback();
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const onPagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const p = propsRef.current;
    const point = toLocal(event.clientX, event.clientY);

    if (p.tool === 'select') {
      p.onSelect(null);
      return;
    }
    if (p.tool === 'image') {
      p.onImageRequested(point);
      return;
    }
    if (p.tool === 'text') {
      // Topmost existing text object wins over a run; runs win over empty space.
      const topText = [...p.objects].reverse().find(
        (object) => object.kind === 'text' && hitRect(object, point.x, point.y),
      );
      if (topText) {
        p.onSelect(topText.id);
        p.onStartEdit(topText.id);
        return;
      }
      const run = findRunAt(p.runs, point.x, point.y);
      if (run) {
        p.onSeedReplace(run);
        return;
      }
    }
    startGesture({ kind: 'create', startX: point.x, startY: point.y });
  };

  const pageObjects = useMemo(
    () => objects.filter((object) => object.pageIndex === pageIndex),
    [objects, pageIndex],
  );
  const pageWidgets = useMemo(
    () => widgets.filter((widget) => widget.pageIndex === pageIndex),
    [widgets, pageIndex],
  );

  return (
    <div className="mx-auto mb-6" data-testid={`editor-page-${pageIndex}`}>
      <div
        ref={containerRef}
        className="relative select-none overflow-hidden border bg-white shadow-sm"
        style={{ width: displayW, height: displayH, cursor: tool === 'select' ? 'default' : 'crosshair' }}
        onPointerDown={onPagePointerDown}
        data-testid="editor-page"
        data-page-index={pageIndex}
      >
        {rasterUrl ? (
          <img
            src={rasterUrl}
            alt={`Page ${pageIndex + 1}`}
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full"
            data-testid="editor-page-raster"
          />
        ) : (
          <Skeleton className="absolute inset-0 h-full w-full rounded-none" data-testid="editor-page-loading" />
        )}

        {/* Live AcroForm inputs, laid over their widget rectangles. */}
        {pageWidgets.map((widget, index) => (
          <FormWidget
            key={`${widget.name}-${widget.type}-${index}`}
            widget={widget}
            zoom={zoom}
            value={formValues[widget.name] ?? widget.value}
            onChange={props.onFormValue}
          />
        ))}

        {/* Text-tool affordance: show the clickable runs. */}
        {tool === 'text' && runs
          ? runs.map((run, index) => (
              <div
                key={`run-${index}`}
                className="pointer-events-none absolute border border-dashed border-blue-500/60 bg-blue-500/5"
                style={{ left: run.x * zoom, top: run.y * zoom, width: run.width * zoom, height: run.height * zoom }}
                data-testid="editor-run"
              />
            ))
          : null}

        {pageObjects.map((object) => (
          <ObjectView
            key={object.id}
            object={object}
            zoom={zoom}
            selected={object.id === selectedId}
            editing={object.id === editingId}
            interactive={tool === 'select'}
            onSelect={props.onSelect}
            onStartEdit={props.onStartEdit}
            onEditText={props.onEditText}
            onEndEdit={props.onEndEdit}
            startGesture={startGesture}
          />
        ))}

        {ghost ? (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-blue-500 bg-blue-500/10"
            style={{ left: ghost.x * zoom, top: ghost.y * zoom, width: ghost.width * zoom, height: ghost.height * zoom }}
            data-testid="editor-ghost"
          />
        ) : null}
      </div>
      <div className="mt-1 text-center text-xs text-muted-foreground">Page {pageIndex + 1}</div>
    </div>
  );
}

function findRunAt(runs: TextRun[] | null, x: number, y: number): TextRun | null {
  if (!runs) return null;
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i]!;
    if (hitRect(run, x, y)) return run;
  }
  return null;
}

/* ------------------------------------------------------------------ objects */

interface ObjectViewProps {
  object: EditorObject;
  zoom: number;
  selected: boolean;
  editing: boolean;
  interactive: boolean;
  onSelect: (id: string | null) => void;
  onStartEdit: (id: string) => void;
  onEditText: (id: string, text: string) => void;
  onEndEdit: () => void;
  startGesture: (gesture: Gesture) => void;
}

function ObjectView({
  object,
  zoom,
  selected,
  editing,
  interactive,
  onSelect,
  onStartEdit,
  onEditText,
  onEndEdit,
  startGesture,
}: ObjectViewProps) {
  const box: CSSProperties = {
    left: object.x * zoom,
    top: object.y * zoom,
    width: object.width * zoom,
    height: object.height * zoom,
  };

  const imageUrl = useMemo(() => {
    if (object.kind !== 'image') return null;
    const buffer = object.data instanceof Uint8Array ? object.data : new Uint8Array(object.data);
    return URL.createObjectURL(new Blob([buffer as BlobPart], { type: object.mimeType }));
    // Keyed on the buffer itself so moving/resizing doesn't churn blob URLs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object.kind === 'image' ? object.data : null, object.kind === 'image' ? object.mimeType : '']);
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive || editing) return;
    event.stopPropagation();
    onSelect(object.id);
    const rect = containerPoint(event);
    startGesture({
      kind: 'move',
      id: object.id,
      startLocalX: rect.x,
      startLocalY: rect.y,
      origX: object.x,
      origY: object.y,
    });
  };

  function containerPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const parent = (event.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect();
    if (!parent) return { x: object.x, y: object.y };
    return { x: (event.clientX - parent.left) / zoom, y: (event.clientY - parent.top) / zoom };
  }

  const style: CSSProperties = { ...box, pointerEvents: interactive ? 'auto' : 'none' };

  return (
    <div
      className={cn('absolute', selected && 'outline-2 outline-blue-500 outline-offset-2')}
      style={style}
      data-testid={`editor-object-${object.kind}`}
      data-object-id={object.id}
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        if (interactive && object.kind === 'text') onStartEdit(object.id);
      }}
    >
      {renderBody()}
      {selected && interactive ? (
        <>
          <ResizeHandle corner="nw" cursor="nwse-resize" object={object} startGesture={startGesture} />
          <ResizeHandle corner="ne" cursor="nesw-resize" object={object} startGesture={startGesture} />
          <ResizeHandle corner="sw" cursor="nesw-resize" object={object} startGesture={startGesture} />
          <ResizeHandle corner="se" cursor="nwse-resize" object={object} startGesture={startGesture} />
        </>
      ) : null}
    </div>
  );

  function renderBody() {
    switch (object.kind) {
      case 'text': {
        if (editing) {
          return (
            <textarea
              value={object.text}
              autoFocus
              spellCheck={false}
              data-testid="editor-text-input"
              className="absolute inset-0 resize-none border-2 border-blue-500 bg-white p-0.5 text-left outline-none"
              style={{
                fontSize: object.fontSize * zoom,
                fontFamily: 'Arial, Helvetica, sans-serif',
                lineHeight: 1.2,
                fontWeight: object.bold ? 700 : 400,
                color: object.color ?? DEFAULT_COLORS.text,
                textAlign: object.align ?? 'left',
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => onEditText(object.id, event.target.value)}
              onBlur={onEndEdit}
            />
          );
        }
        return (
          <div
            className="absolute inset-0 overflow-hidden whitespace-pre-wrap break-words"
            style={{
              fontSize: object.fontSize * zoom,
              fontFamily: 'Arial, Helvetica, sans-serif',
              lineHeight: 1.2,
              fontWeight: object.bold ? 700 : 400,
              color: object.color ?? DEFAULT_COLORS.text,
              textAlign: object.align ?? 'left',
              cursor: interactive ? 'move' : 'default',
            }}
          >
            {object.text}
          </div>
        );
      }
      case 'image':
        return imageUrl ? (
          <img src={imageUrl} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-fill" />
        ) : null;
      case 'whiteout':
        return <div className="absolute inset-0 bg-white" />;
      case 'highlight':
        return (
          <div
            className="absolute inset-0"
            style={{ backgroundColor: hexWithAlpha(object.color, 0.45, DEFAULT_COLORS.highlight) }}
          />
        );
      case 'strikeout':
      case 'underline': {
        const thickness = Math.max(1, (object.strokeWidth ?? 1.5) * zoom);
        const barY =
          object.kind === 'strikeout'
            ? (object.height / 2 - (object.strokeWidth ?? 1.5) / 2) * zoom
            : (object.height - 1 - (object.strokeWidth ?? 1.5) / 2) * zoom;
        return (
          <div
            className="absolute right-0 left-0"
            style={{
              top: barY,
              height: thickness,
              backgroundColor: object.color ?? DEFAULT_COLORS[object.kind],
            }}
          />
        );
      }
      case 'rect':
      case 'ellipse': {
        const stroke = object.stroke ?? DEFAULT_COLORS.ink;
        const strokeWidth = object.strokeWidth ?? 1.5;
        return (
          <div
            className="absolute inset-0"
            style={{
              border: strokeWidth > 0 ? `${strokeWidth * zoom}px solid ${stroke}` : 'none',
              background: object.fill ?? 'transparent',
              borderRadius: object.kind === 'ellipse' ? '50%' : undefined,
            }}
          />
        );
      }
      case 'line':
      case 'arrow': {
        const thickness = object.strokeWidth ?? 1.5;
        const stroke = object.stroke ?? DEFAULT_COLORS.ink;
        const w = object.width * zoom;
        const h = object.height * zoom;
        const start = object.reverse ? { x: 0, y: h } : { x: 0, y: 0 };
        const end = object.reverse ? { x: w, y: 0 } : { x: w, y: h };
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const barb = Math.max(6, thickness * 4) * zoom;
        return (
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={w} height={h}>
            <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={stroke} strokeWidth={thickness * zoom} />
            {object.kind === 'arrow'
              ? [0.45, -0.45].map((delta) => (
                  <line
                    key={delta}
                    x1={end.x}
                    y1={end.y}
                    x2={end.x - Math.cos(angle + delta) * barb}
                    y2={end.y - Math.sin(angle + delta) * barb}
                    stroke={stroke}
                    strokeWidth={thickness * zoom}
                  />
                ))
              : null}
          </svg>
        );
      }
    }
  }
}

function ResizeHandle({
  corner,
  cursor,
  object,
  startGesture,
}: {
  corner: 'nw' | 'ne' | 'sw' | 'se';
  cursor: string;
  object: EditorObject;
  startGesture: (gesture: Gesture) => void;
}) {
  const positions: Record<string, CSSProperties> = {
    nw: { left: 0, top: 0 },
    ne: { left: '100%', top: 0 },
    sw: { left: 0, top: '100%' },
    se: { left: '100%', top: '100%' },
  };
  return (
    <div
      className="absolute z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-500 bg-white shadow"
      style={{ ...positions[corner], cursor }}
      data-testid={`editor-handle-${corner}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        startGesture({
          kind: 'resize',
          id: object.id,
          corner,
          orig: { x: object.x, y: object.y, width: object.width, height: object.height },
        });
      }}
      // NB: no pointerup/click handlers here -- the window-level gesture
      // listener must receive those, or the drag would never end.
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}

/* ------------------------------------------------------------ form widgets */

function FormWidget({
  widget,
  zoom,
  value,
  onChange,
}: {
  widget: FormWidgetInfo;
  zoom: number;
  value: string | boolean | undefined;
  onChange: (name: string, value: string | boolean) => void;
}) {
  const box: CSSProperties = {
    position: 'absolute',
    left: widget.rect.x * zoom,
    top: widget.rect.y * zoom,
    width: widget.rect.width * zoom,
    height: widget.rect.height * zoom,
  };
  const stop = (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation();
  const fontSize = Math.max(9, Math.min(widget.rect.height * zoom * 0.68, 18));

  if (widget.type === 'checkbox' || widget.type === 'radio') {
    return (
      <label
        className="flex cursor-pointer items-center justify-center"
        style={box}
        data-testid={`editor-form-${widget.type}`}
        onPointerDown={stop}
      >
        <input
          type={widget.type}
          name={widget.type === 'radio' ? widget.name : undefined}
          checked={widget.type === 'radio' ? value === widget.option : Boolean(value)}
          onChange={(event) =>
            widget.type === 'radio'
              ? onChange(widget.name, widget.option ?? event.target.value)
              : onChange(widget.name, event.target.checked)
          }
          className="cursor-pointer accent-blue-600"
        />
      </label>
    );
  }

  if (widget.type === 'dropdown' || widget.type === 'optionlist') {
    return (
      <select
        className="absolute border bg-white px-1 text-neutral-900 outline-none"
        style={{ ...box, fontSize }}
        value={typeof value === 'string' ? value : ''}
        onPointerDown={stop}
        onChange={(event) => onChange(widget.name, event.target.value)}
        data-testid="editor-form-select"
      >
        <option value="">—</option>
        {(widget.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (widget.type === 'text') {
    return (
      <input
        type="text"
        className="absolute border bg-white px-1 text-neutral-900 outline-none focus:border-blue-500"
        style={{ ...box, fontSize }}
        value={typeof value === 'string' ? value : ''}
        onPointerDown={stop}
        onChange={(event) => onChange(widget.name, event.target.value)}
        data-testid="editor-form-input"
        aria-label={widget.label ?? widget.name}
      />
    );
  }

  return null;
}
