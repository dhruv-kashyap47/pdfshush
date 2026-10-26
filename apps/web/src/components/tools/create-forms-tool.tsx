/**
 * Create Forms: turn a flat PDF into a fillable one.
 *
 * The preview is a real render of the page, and every box is stored in display
 * points -- the same frame the engine receives -- so what the user drags is
 * exactly what lands in the AcroForm. A numeric panel edits the same values for
 * keyboard users and for pixel-level placement.
 *
 * Only text fields and checkboxes are offered. They cover the overwhelming
 * majority of forms and both round-trip through every mainstream reader.
 */

import { useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  CheckSquare,
  FormInput,
  Loader2,
  Plus,
  Trash2,
  Type,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  timeoutForPageCount,
  type CreateFormsJobOutput,
  type InspectOutput,
  type NewFormField,
} from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import { usePageThumbnails } from '@/hooks/use-page-thumbnails';
import {
  announceCapacityWarning,
  checkClientCapacity,
} from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { readAsInputFiles, totalBytes } from '@/lib/files';
import { cn } from '@/lib/utils';
import { recordRecent } from '@/tools/recent';

type FieldType = 'text' | 'checkbox';

interface DraftField {
  id: string;
  type: FieldType;
  name: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  required: boolean;
}

const MIN_SIZE: Record<FieldType, { width: number; height: number }> = {
  text: { width: 20, height: 10 },
  checkbox: { width: 8, height: 8 },
};

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;
const MAX_NAME_CHARS = 64;
const FONT_MIN = 4;
const FONT_MAX = 48;

interface DragState {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  original: DraftField;
  scaleX: number;
  scaleY: number;
  page: { width: number; height: number };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function pageSize(info: InspectOutput | null, pageIndex: number) {
  const page = info?.documents[0]?.pages[pageIndex];
  if (!page) return null;
  return { width: page.displayWidthPt, height: page.displayHeightPt };
}

function nameIssue(field: DraftField, fields: DraftField[], existing: Set<string>): string | null {
  const name = field.name.trim();
  if (!name) return 'Every field needs a name.';
  if (name.length > MAX_NAME_CHARS) return `Keep names to ${MAX_NAME_CHARS} characters.`;
  if (!NAME_PATTERN.test(name)) {
    return 'Use letters, digits, spaces, dots, underscores or dashes, starting with a letter or digit.';
  }
  if (existing.has(name)) return 'The PDF already has a field with this name.';
  if (fields.some((other) => other.id !== field.id && other.name.trim() === name)) {
    return 'Two fields cannot share a name.';
  }
  return null;
}

export function CreateFormsTool() {
  const { files, tiles, busy, progress, prepare, reset, cancel } = usePageThumbnails();
  const [info, setInfo] = useState<InspectOutput | null>(null);
  const [fields, setFields] = useState<DraftField[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState(0);
  const [tool, setTool] = useState<FieldType>('text');

  const runner = useJobRunner<CreateFormsJobOutput>('create-forms');
  const idRef = useRef(0);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const pageCount = info?.documents[0]?.pageCount ?? 0;
  const size = pageSize(info, activePage);
  const tile = tiles.find((candidate) => candidate.pageIndex === activePage) ?? null;
  const selected = fields.find((field) => field.id === selectedId) ?? null;
  const existingNames = new Set(
    (info?.documents[0]?.fields ?? []).map((field) => field.name),
  );
  const fieldIssues = fields
    .map((field) => nameIssue(field, fields, existingNames))
    .filter((issue): issue is string => issue !== null);
  const ready = files.length === 1 && fields.length > 0 && fieldIssues.length === 0;
  const running = runner.state.status === 'running';

  const clearAll = () => {
    reset();
    setInfo(null);
    setFields([]);
    setSelectedId(null);
    setActivePage(0);
  };

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      clearAll();
      return;
    }
    setFields([]);
    setSelectedId(null);
    setActivePage(0);
    setTool('text');
    const ok = await prepare(incoming, {
      targetWidthPx: 900,
      onInspected: (inspected) => setInfo(inspected),
    });
    if (!ok) {
      clearAll();
    }
  };

  const nextName = (type: FieldType): string => {
    const base = type === 'text' ? 'text' : 'checkbox';
    const used = new Set([...existingNames, ...fields.map((field) => field.name)]);
    for (let index = 1; index < 10_000; index += 1) {
      const candidate = `${base}_${index}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${base}_${Date.now()}`;
  };

  const updateField = (id: string, changes: Partial<DraftField>) => {
    setFields((previous) =>
      previous.map((field) => (field.id === id ? { ...field, ...changes } : field)),
    );
  };

  const addField = (type: FieldType, pageIndex: number, point?: { x: number; y: number }) => {
    const bounds = pageSize(info, pageIndex);
    if (!bounds) return;
    const preferredWidth = type === 'text' ? Math.min(220, Math.max(60, bounds.width - 48)) : 16;
    const preferredHeight = type === 'text' ? 24 : 16;
    const width = Math.min(preferredWidth, bounds.width);
    const height = Math.min(preferredHeight, bounds.height);
    const x = clamp(point?.x ?? 32, 0, Math.max(0, bounds.width - width));
    const y = clamp(point?.y ?? 32, 0, Math.max(0, bounds.height - height));

    const field: DraftField = {
      id: `field-${(idRef.current += 1)}`,
      type,
      name: nextName(type),
      pageIndex,
      x: round1(x),
      y: round1(y),
      width: round1(width),
      height: round1(height),
      fontSize: 10,
      required: false,
    };
    setFields((previous) => [...previous, field]);
    setSelectedId(field.id);
    setActivePage(pageIndex);
    setTool(type);
  };

  const removeField = (id: string) => {
    const index = fields.findIndex((field) => field.id === id);
    const next = fields.filter((field) => field.id !== id);
    setFields(next);
    setSelectedId((current) =>
      current === id ? (next[Math.min(index, next.length - 1)]?.id ?? null) : current,
    );
  };

  const handlePageClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!size || running) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    addField(tool, activePage, {
      x: ((event.clientX - rect.left) / rect.width) * size.width,
      y: ((event.clientY - rect.top) / rect.height) * size.height,
    });
  };

  const startDrag = (
    event: ReactPointerEvent<HTMLElement>,
    field: DraftField,
    mode: 'move' | 'resize',
  ) => {
    event.stopPropagation();
    event.preventDefault();
    const element = pageRef.current;
    const bounds = pageSize(info, field.pageIndex);
    if (!element || !bounds) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: field.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      original: { ...field },
      scaleX: bounds.width / rect.width,
      scaleY: bounds.height / rect.height,
      page: bounds,
    };
    setSelectedId(field.id);
  };

  const handleDragMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) * drag.scaleX;
    const dy = (event.clientY - drag.startY) * drag.scaleY;
    const minimum = MIN_SIZE[drag.original.type];

    setFields((previous) =>
      previous.map((field) => {
        if (field.id !== drag.id) return field;
        if (drag.mode === 'move') {
          return {
            ...field,
            x: round1(clamp(drag.original.x + dx, 0, Math.max(0, drag.page.width - field.width))),
            y: round1(clamp(drag.original.y + dy, 0, Math.max(0, drag.page.height - field.height))),
          };
        }
        return {
          ...field,
          width: round1(
            clamp(drag.original.width + dx, minimum.width, Math.max(minimum.width, drag.page.width - field.x)),
          ),
          height: round1(
            clamp(drag.original.height + dy, minimum.height, Math.max(minimum.height, drag.page.height - field.y)),
          ),
        };
      }),
    );
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const setGeometry = (field: DraftField, key: 'x' | 'y' | 'width' | 'height', raw: string) => {
    const bounds = pageSize(info, field.pageIndex);
    const value = Number.parseFloat(raw);
    if (!bounds || !Number.isFinite(value)) return;
    const minimum = MIN_SIZE[field.type];

    let { x, y, width, height } = field;
    if (key === 'x') x = clamp(value, 0, Math.max(0, bounds.width - width));
    if (key === 'y') y = clamp(value, 0, Math.max(0, bounds.height - height));
    if (key === 'width') width = clamp(value, minimum.width, Math.max(minimum.width, bounds.width - x));
    if (key === 'height') {
      height = clamp(value, minimum.height, Math.max(minimum.height, bounds.height - y));
    }
    updateField(field.id, {
      x: round1(x),
      y: round1(y),
      width: round1(width),
      height: round1(height),
    });
  };

  const changeType = (field: DraftField, type: FieldType) => {
    const bounds = pageSize(info, field.pageIndex);
    if (!bounds) return;
    const minimum = MIN_SIZE[type];
    const width =
      type === 'checkbox'
        ? Math.min(16, bounds.width)
        : Math.min(Math.max(field.width, 120), Math.max(minimum.width, bounds.width - field.x));
    const height =
      type === 'checkbox'
        ? Math.min(16, bounds.height)
        : Math.min(Math.max(field.height, 24), Math.max(minimum.height, bounds.height - field.y));
    updateField(field.id, {
      type,
      width: round1(width),
      height: round1(height),
      ...(type === 'text' ? { fontSize: field.fontSize || 10 } : {}),
    });
  };

  const moveToPage = (field: DraftField, pageIndex: number) => {
    const bounds = pageSize(info, pageIndex);
    if (!bounds) return;
    const minimum = MIN_SIZE[field.type];
    const width = Math.min(Math.max(field.width, minimum.width), bounds.width);
    const height = Math.min(Math.max(field.height, minimum.height), bounds.height);
    updateField(field.id, {
      pageIndex,
      width: round1(width),
      height: round1(height),
      x: round1(clamp(field.x, 0, Math.max(0, bounds.width - width))),
      y: round1(clamp(field.y, 0, Math.max(0, bounds.height - height))),
    });
    setActivePage(pageIndex);
  };

  const run = async () => {
    if (!ready || running || files.length !== 1) return;
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: totalBytes(files),
      pageCount,
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    announceCapacityWarning(verdict);

    const specs: NewFormField[] = fields.map((field) => ({
      type: field.type,
      name: field.name.trim(),
      pageIndex: field.pageIndex,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
      ...(field.type === 'text' ? { fontSize: field.fontSize } : {}),
      ...(field.required ? { required: true } : {}),
    }));

    const stem = files[0]!.name.replace(/\.pdf$/i, '') || 'document';
    const outcome = await runner.run(
      await readAsInputFiles(files),
      { fields: specs, outputName: `${stem}-fillable` },
      { timeoutMs: timeoutForPageCount(pageCount) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'create-forms',
      toolName: 'Create Forms',
      fileName: outcome.result.fileName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  };

  if (runner.state.status === 'done') {
    const { result } = runner.state;
    return (
      <ResultPanel
        fileName={result.fileName}
        pageCount={result.pageCount}
        sizeBytes={result.data.byteLength}
        onDownload={() => downloadBytes(result.data, result.fileName)}
        onReset={() => {
          runner.reset();
          clearAll();
        }}
        footerNote={
          <>
            {result.fieldCount} standard AcroForm field
            {result.fieldCount === 1 ? '' : 's'} added. Page content is untouched, and the
            file stays fillable in Acrobat, Preview, Chrome, Firefox and Edge.
          </>
        }
      >
        {existingNames.size > 0 && (
          <p className="text-xs text-muted-foreground">
            The {existingNames.size} field{existingNames.size === 1 ? '' : 's'} that were already
            in this PDF are still there; the new ones sit alongside them.
          </p>
        )}
      </ResultPanel>
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(incoming) => void handleFiles(incoming)}
        disabled={busy || running}
        hint="one PDF to turn into a fillable form"
        multiple={false}
      />

      {(busy || running) && (
        <JobProgressPanel
          progress={runner.state.status === 'running' ? runner.state.progress : progress}
          onCancel={running ? runner.cancel : cancel}
        />
      )}

      {tile && size && info && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_370px]">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  Page {activePage + 1} of {pageCount}
                </p>
                <p className="text-xs text-muted-foreground">
                  {Math.round(size.width)} × {Math.round(size.height)} pt · click to place the
                  selected field
                </p>
              </div>
              <div className="flex items-center gap-1.5" role="group" aria-label="Field to place">
                <Button
                  size="sm"
                  variant={tool === 'text' ? 'default' : 'outline'}
                  aria-pressed={tool === 'text'}
                  onClick={() => setTool('text')}
                  data-testid="create-forms-tool-text"
                >
                  <Type className="h-3.5 w-3.5" />
                  Text
                </Button>
                <Button
                  size="sm"
                  variant={tool === 'checkbox' ? 'default' : 'outline'}
                  aria-pressed={tool === 'checkbox'}
                  onClick={() => setTool('checkbox')}
                  data-testid="create-forms-tool-checkbox"
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                  Checkbox
                </Button>
              </div>
            </div>

            <div className="mx-auto w-full max-w-[720px]">
              <div
                ref={pageRef}
                data-testid="create-forms-page"
                onClick={handlePageClick}
                className="relative touch-none select-none overflow-hidden rounded-lg bg-white ring-1 ring-border"
                style={{ aspectRatio: `${size.width} / ${size.height}`, cursor: 'crosshair' }}
              >
                <img
                  src={tile.url}
                  alt={`Page ${activePage + 1}`}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  draggable={false}
                />
                {fields
                  .filter((field) => field.pageIndex === activePage)
                  .map((field) => {
                    const isSelected = field.id === selectedId;
                    return (
                      <div
                        key={field.id}
                        data-testid={`form-field-${field.id}`}
                        role="presentation"
                        onPointerDown={(event) => startDrag(event, field, 'move')}
                        onPointerMove={handleDragMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onClick={(event) => event.stopPropagation()}
                        className={cn(
                          'absolute flex cursor-move items-center justify-center rounded-[2px] border text-[9px] font-medium leading-none',
                          field.type === 'text'
                            ? 'border-amber-600 bg-amber-400/25 text-amber-950'
                            : 'border-sky-600 bg-sky-400/25 text-sky-950',
                          isSelected
                            ? 'ring-2 ring-primary ring-offset-1'
                            : 'hover:border-primary',
                        )}
                        style={{
                          left: `${(field.x / size.width) * 100}%`,
                          top: `${(field.y / size.height) * 100}%`,
                          width: `${(field.width / size.width) * 100}%`,
                          height: `${(field.height / size.height) * 100}%`,
                        }}
                      >
                        {field.type === 'text' ? (
                          <span className="pointer-events-none truncate px-1">{field.name}</span>
                        ) : (
                          <CheckSquare className="pointer-events-none h-3 w-3" />
                        )}
                        {isSelected && (
                          <span
                            aria-hidden
                            onPointerDown={(event) => startDrag(event, field, 'resize')}
                            onPointerMove={handleDragMove}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize rounded-sm border border-primary bg-primary"
                          />
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Pages">
              {tiles.map((candidate) => {
                const count = fields.filter(
                  (field) => field.pageIndex === candidate.pageIndex,
                ).length;
                const isActive = candidate.pageIndex === activePage;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    aria-label={`Page ${candidate.pageIndex + 1}`}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setActivePage(candidate.pageIndex)}
                    className={cn(
                      'relative h-16 w-12 shrink-0 overflow-hidden rounded border-2 bg-muted',
                      isActive
                        ? 'border-primary'
                        : 'border-transparent hover:border-border',
                    )}
                  >
                    <img
                      src={candidate.url}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                    <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[10px] leading-4 text-white">
                      {candidate.pageIndex + 1}
                    </span>
                    {count > 0 && (
                      <span className="absolute right-0.5 top-0.5 rounded-full bg-primary px-1 text-[9px] font-semibold leading-4 text-primary-foreground">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <FormInput className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Add fields</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => addField('text', activePage)}
                  data-testid="create-forms-add-text"
                >
                  <Type className="h-4 w-4" />
                  Text
                </Button>
                <Button
                  variant="outline"
                  onClick={() => addField('checkbox', activePage)}
                  data-testid="create-forms-add-checkbox"
                >
                  <CheckSquare className="h-4 w-4" />
                  Checkbox
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Click the page to place one at that spot, or use these buttons. Fields can be
                dragged and resized.
              </p>
              {existingNames.size > 0 && (
                <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs">
                  This PDF already has {existingNames.size} field
                  {existingNames.size === 1 ? '' : 's'}. New fields are added alongside them.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">
                  Fields <span className="text-muted-foreground">({fields.length})</span>
                </p>
                {fields.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {new Set(fields.map((field) => field.pageIndex)).size} page
                    {new Set(fields.map((field) => field.pageIndex)).size === 1 ? '' : 's'}
                  </span>
                )}
              </div>

              {fields.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  No fields yet. Add one to get started.
                </p>
              ) : (
                <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
                  {fields.map((field, index) => (
                    <button
                      key={field.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(field.id);
                        setActivePage(field.pageIndex);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
                        field.id === selectedId
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-accent',
                      )}
                      data-testid={`field-row-${index}`}
                    >
                      {field.type === 'text' ? (
                        <Type className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                      ) : (
                        <CheckSquare className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {field.name.trim() || 'Unnamed field'}
                      </span>
                      <span className="shrink-0 text-muted-foreground">p.{field.pageIndex + 1}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selected && (
              <div className="rounded-xl border border-border bg-card p-4" data-testid="field-panel">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium">Selected field</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeField(selected.id)}
                    data-testid="create-forms-remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="field-name">Name</Label>
                    <Input
                      id="field-name"
                      value={selected.name}
                      maxLength={MAX_NAME_CHARS}
                      onChange={(event) =>
                        updateField(selected.id, { name: event.target.value })
                      }
                      aria-invalid={
                        nameIssue(selected, fields, existingNames) !== null || undefined
                      }
                      data-testid="field-name"
                    />
                    {nameIssue(selected, fields, existingNames) && (
                      <p className="text-xs text-destructive">
                        {nameIssue(selected, fields, existingNames)}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant={selected.type === 'text' ? 'default' : 'outline'}
                        aria-pressed={selected.type === 'text'}
                        onClick={() => changeType(selected, 'text')}
                      >
                        <Type className="h-3.5 w-3.5" />
                        Text
                      </Button>
                      <Button
                        size="sm"
                        variant={selected.type === 'checkbox' ? 'default' : 'outline'}
                        aria-pressed={selected.type === 'checkbox'}
                        onClick={() => changeType(selected, 'checkbox')}
                      >
                        <CheckSquare className="h-3.5 w-3.5" />
                        Checkbox
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="field-page">Page</Label>
                    <select
                      id="field-page"
                      value={selected.pageIndex}
                      onChange={(event) => moveToPage(selected, Number(event.target.value))}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    >
                      {Array.from({ length: pageCount }, (_, index) => (
                        <option key={index} value={index}>
                          Page {index + 1}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {(['x', 'y', 'width', 'height'] as const).map((key) => (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor={`field-${key}`} className="capitalize">
                          {key}
                        </Label>
                        <Input
                          id={`field-${key}`}
                          type="number"
                          step={0.5}
                          value={selected[key]}
                          onChange={(event) => setGeometry(selected, key, event.target.value)}
                        />
                      </div>
                    ))}
                  </div>

                  {selected.type === 'text' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="field-font">Font size</Label>
                      <Input
                        id="field-font"
                        type="number"
                        min={FONT_MIN}
                        max={FONT_MAX}
                        step={0.5}
                        value={selected.fontSize}
                        onChange={(event) => {
                          const value = Number.parseFloat(event.target.value);
                          if (!Number.isFinite(value)) return;
                          updateField(selected.id, {
                            fontSize: round1(clamp(value, FONT_MIN, FONT_MAX)),
                          });
                        }}
                      />
                    </div>
                  )}

                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.required}
                      onCheckedChange={(value) =>
                        updateField(selected.id, { required: value === true })
                      }
                    />
                    Required
                  </label>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Button
                size="lg"
                className="w-full"
                disabled={!ready || running}
                onClick={() => void run()}
                data-testid="create-forms-run"
              >
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Building the form…
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Create fillable PDF
                  </>
                )}
              </Button>
              {!ready && fields.length > 0 && fieldIssues.length > 0 && (
                <p className="text-xs text-destructive">{fieldIssues[0]}</p>
              )}
              {fields.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Add at least one field to create the form.
                </p>
              )}
              {fields.some((field) => field.pageIndex !== activePage) && (
                <p className="text-xs text-muted-foreground">
                  Fields placed on other pages are kept exactly where you put them.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
