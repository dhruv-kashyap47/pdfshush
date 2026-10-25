import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  Crop,
  Download,
  FlipHorizontal,
  FlipVertical,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Undo2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import { announceCapacityWarning, checkClientCapacity } from '@/lib/client-capacity';
import { downloadBlob, downloadBytes } from '@/lib/download';
import { formatBytes } from '@/lib/format';
import {
  DEFAULT_FILTERS,
  MAX_EDIT_PIXELS,
  filterString,
  rectFromDrag,
  selectionToCrop,
  sizeAfterOps,
  type ImageFilters,
  type ImageOp,
  type NormalizedRect,
} from '@/lib/image-ops';
import { recordRecent } from '@/tools/recent';

interface PdfOutput {
  data: ArrayBuffer;
  fileName: string;
  pageCount: number;
}

interface Source {
  bitmap: ImageBitmap;
  name: string;
  sizeBytes: number;
}

const ACCEPT = 'image/jpeg,image/png,image/webp';
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function isImage(file: File): boolean {
  return IMAGE_TYPES.has(file.type) || (file.type === '' && IMAGE_EXT.test(file.name));
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name).replace(/[\\/:*?"<>|]+/g, '-') || 'image';
}

/** Draws the source once, then replays the operation list in order. */
function renderWorking(bitmap: ImageBitmap, ops: ImageOp[]): HTMLCanvasElement {
  let canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const base = canvas.getContext('2d');
  if (!base) throw new Error('This browser cannot open a 2D canvas');
  base.imageSmoothingQuality = 'high';
  base.drawImage(bitmap, 0, 0);

  for (const op of ops) {
    if (op.kind === 'rotate') {
      const swapped = op.turns % 2 === 1;
      const out = document.createElement('canvas');
      out.width = swapped ? canvas.height : canvas.width;
      out.height = swapped ? canvas.width : canvas.height;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('This browser cannot open a 2D canvas');
      ctx.translate(out.width / 2, out.height / 2);
      ctx.rotate((op.turns * Math.PI) / 2);
      ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      canvas = out;
    } else if (op.kind === 'flip') {
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('This browser cannot open a 2D canvas');
      ctx.translate(op.axis === 'horizontal' ? out.width : 0, op.axis === 'vertical' ? out.height : 0);
      ctx.scale(op.axis === 'horizontal' ? -1 : 1, op.axis === 'vertical' ? -1 : 1);
      ctx.drawImage(canvas, 0, 0);
      canvas = out;
    } else {
      const out = document.createElement('canvas');
      out.width = op.rect.width;
      out.height = op.rect.height;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('This browser cannot open a 2D canvas');
      ctx.drawImage(canvas, -op.rect.x, -op.rect.y);
      canvas = out;
    }
  }
  return canvas;
}

/** Applies brightness/contrast/grayscale to a copy; used for both preview and export. */
function renderFiltered(source: HTMLCanvasElement, filters: ImageFilters): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('This browser cannot open a 2D canvas');
  ctx.filter = filterString(filters);
  ctx.drawImage(source, 0, 0);
  return out;
}

/**
 * Image editor: rotate, flip, crop and tone-correct a bitmap, then hand back a
 * PNG, a JPEG, or a PDF built through the normal jpg-to-pdf pipeline.
 *
 * Every edit is an entry in an operation list replayed from the original
 * bitmap, so "undo" is exact and repeated edits never stack resampling loss.
 * There is no server call until the user asks for a PDF, and that PDF is
 * produced by the same local worker as every other tool.
 */
export function ImageEditorTool() {
  const [source, setSource] = useState<Source | null>(null);
  const [ops, setOps] = useState<ImageOp[]>([]);
  const [filters, setFilters] = useState<ImageFilters>(DEFAULT_FILTERS);
  const [selection, setSelection] = useState<NormalizedRect | null>(null);
  const [drag, setDrag] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(
    null,
  );
  const [pdf, setPdf] = useState<PdfOutput | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const runner = useJobRunner<PdfOutput>('jpg-to-pdf');
  const running = runner.state.status === 'running';

  useEffect(
    () => () => {
      bitmapRef.current?.close();
      bitmapRef.current = null;
    },
    [],
  );

  // Re-render whenever the bitmap, operations or tone settings change.
  useEffect(() => {
    if (!source || !canvasRef.current) return;
    try {
      const working = renderWorking(source.bitmap, ops);
      const canvas = canvasRef.current;
      canvas.width = working.width;
      canvas.height = working.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.filter = filterString(filters);
      ctx.drawImage(working, 0, 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The preview could not be drawn.');
    }
  }, [source, ops, filters]);

  const handleFiles = useCallback(async (incoming: File[]) => {
    if (incoming.length === 0) {
      setSource(null);
      setOps([]);
      setSelection(null);
      return;
    }
    const file = incoming[0]!;
    if (!isImage(file)) {
      toast.error('Choose a JPEG, PNG or WebP image.');
      return;
    }
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: file.size,
      largestFileBytes: file.size,
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > MAX_EDIT_PIXELS) {
        bitmap.close();
        toast.error('That image is too large for the editor (limit about 80 megapixels).');
        return;
      }
      announceCapacityWarning(verdict);
      bitmapRef.current?.close();
      bitmapRef.current = bitmap;
      setSource({ bitmap, name: file.name, sizeBytes: file.size });
      setOps([]);
      setSelection(null);
      setFilters(DEFAULT_FILTERS);
      setPdf(null);
    } catch {
      toast.error('That image could not be decoded.');
    }
  }, []);

  const bounds = source
    ? sizeAfterOps({ width: source.bitmap.width, height: source.bitmap.height }, ops)
    : { width: 0, height: 0 };
  const dragRect = drag ? rectFromDrag(drag.start, drag.end) : null;
  const shown = dragRect ?? selection;

  const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const pushOp = (op: ImageOp) => {
    setOps((current) => [...current, op]);
    setSelection(null);
  };

  const applyCrop = () => {
    if (!source || !selection) return;
    const rect = selectionToCrop(selection, bounds);
    if (!rect) {
      toast.error('Drag a larger area to crop.');
      return;
    }
    pushOp({ kind: 'crop', rect });
  };

  const exportAs = async (type: 'image/png' | 'image/jpeg'): Promise<Blob | null> => {
    if (!source) return null;
    try {
      const working = renderWorking(source.bitmap, ops);
      const filtered = renderFiltered(working, filters);
      if (type === 'image/jpeg') {
        // JPEG has no alpha: composite onto white so transparent pixels do not
        // become black in the exported file.
        const flattened = document.createElement('canvas');
        flattened.width = filtered.width;
        flattened.height = filtered.height;
        const ctx = flattened.getContext('2d');
        if (!ctx) throw new Error('This browser cannot open a 2D canvas');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, flattened.width, flattened.height);
        // `filtered` already carries the tone change; draw it without applying
        // the filter twice.
        ctx.filter = 'none';
        ctx.drawImage(filtered, 0, 0);
        return await new Promise((resolve) => flattened.toBlob(resolve, type, 0.92));
      }
      return await new Promise((resolve) => filtered.toBlob(resolve, type));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The image could not be rendered.');
      return null;
    }
  };

  const downloadImage = async (type: 'image/png' | 'image/jpeg') => {
    if (!source) return;
    const blob = await exportAs(type);
    if (!blob) {
      toast.error('The image could not be encoded.');
      return;
    }
    const extension = type === 'image/png' ? 'png' : 'jpg';
    downloadBlob(blob, `${stemOf(source.name)}-edited.${extension}`);
  };

  const createPdf = async () => {
    if (!source || running) return;
    const blob = await exportAs('image/jpeg');
    if (!blob) {
      toast.error('The image could not be encoded.');
      return;
    }
    const data = new Uint8Array(await blob.arrayBuffer());
    const outcome = await runner.run(
      [{ name: `${stemOf(source.name)}.jpg`, type: 'image/jpeg', data }],
      { pageSize: 'a4', orientation: 'auto', margin: 24 },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    setPdf(outcome.result);
    void recordRecent({
      toolSlug: 'image-editor',
      toolName: 'Image editor',
      fileName: outcome.result.fileName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  };

  if (pdf) {
    return (
      <ResultPanel
        fileName={pdf.fileName}
        pageCount={pdf.pageCount}
        sizeBytes={pdf.data.byteLength}
        onDownload={() => downloadBytes(pdf.data, pdf.fileName)}
        onReset={() => {
          runner.reset();
          setPdf(null);
          setSource(null);
          setOps([]);
          setSelection(null);
          setFilters(DEFAULT_FILTERS);
        }}
        onContinue={() => {
          runner.reset();
          setPdf(null);
        }}
        continueLabel="Back to the editor"
        footerNote="The PDF contains the edited image on an A4 page, with a 24 pt margin."
      />
    );
  }

  return (
    <div className="space-y-4">
      {!source ? (
        <FileDropzone
          files={[]}
          onFiles={(files) => void handleFiles(files)}
          multiple={false}
          disabled={running}
          accept={ACCEPT}
          accepts={isImage}
          kind="image"
          hint="one JPEG, PNG or WebP; everything stays on this device"
          note="Your image is decoded and edited in this tab. Nothing is uploaded."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                <ImageIcon className="mr-1 inline h-3.5 w-3.5" />
                {source.name} · {bounds.width}×{bounds.height}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {selection ? 'Selection ready' : 'Drag to crop'}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={running}
                  onClick={() => {
                    bitmapRef.current?.close();
                    bitmapRef.current = null;
                    setSource(null);
                    setOps([]);
                    setSelection(null);
                    setFilters(DEFAULT_FILTERS);
                  }}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" /> Replace
                </Button>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-xl overflow-hidden rounded-lg border border-border bg-[repeating-conic-gradient(#e5e5e5_0%_25%,#ffffff_0%_50%)] bg-[length:16px_16px]">
              <canvas ref={canvasRef} className="block h-auto w-full" data-testid="image-canvas" />
              <div
                className="absolute inset-0 cursor-crosshair touch-none"
                onPointerDown={(event) => {
                  if (running) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const point = pointFromEvent(event);
                  setSelection(null);
                  setDrag({ start: point, end: point });
                }}
                onPointerMove={(event) => {
                  if (!drag) return;
                  setDrag({ start: drag.start, end: pointFromEvent(event) });
                }}
                onPointerUp={() => {
                  if (!drag) return;
                  const rect = rectFromDrag(drag.start, drag.end);
                  setSelection(rect);
                  setDrag(null);
                }}
                onPointerCancel={() => setDrag(null)}
              >
                {shown && (
                  <span
                    className="pointer-events-none absolute border-2 border-primary bg-primary/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
                    style={{
                      left: `${shown.x * 100}%`,
                      top: `${shown.y * 100}%`,
                      width: `${shown.width * 100}%`,
                      height: `${shown.height * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {ops.length} edit{ops.length === 1 ? '' : 's'} ·{' '}
                {formatBytes(source.sizeBytes)}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={!selection || running}
                onClick={applyCrop}
                data-testid="image-crop"
              >
                <Crop className="mr-1.5 h-4 w-4" /> Apply crop
              </Button>
            </div>
          </div>

          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Transform</Label>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Rotate left"
                  disabled={running}
                  onClick={() => pushOp({ kind: 'rotate', turns: 3 })}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Rotate right"
                  disabled={running}
                  onClick={() => pushOp({ kind: 'rotate', turns: 1 })}
                  data-testid="image-rotate"
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Flip horizontally"
                  disabled={running}
                  onClick={() => pushOp({ kind: 'flip', axis: 'horizontal' })}
                >
                  <FlipHorizontal className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Flip vertically"
                  disabled={running}
                  onClick={() => pushOp({ kind: 'flip', axis: 'vertical' })}
                >
                  <FlipVertical className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div>
              <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                <SlidersHorizontal className="h-3.5 w-3.5" /> Tone
              </Label>
              <div className="mt-2 space-y-3">
                <label className="block space-y-1 text-xs text-muted-foreground">
                  <span className="flex justify-between">
                    <span>Brightness</span>
                    <span className="tabular-nums">{filters.brightness}%</span>
                  </span>
                  <input
                    type="range"
                    min={40}
                    max={160}
                    value={filters.brightness}
                    disabled={running}
                    onChange={(event) =>
                      setFilters({ ...filters, brightness: Number(event.target.value) })
                    }
                    className="w-full accent-[hsl(var(--primary))]"
                  />
                </label>
                <label className="block space-y-1 text-xs text-muted-foreground">
                  <span className="flex justify-between">
                    <span>Contrast</span>
                    <span className="tabular-nums">{filters.contrast}%</span>
                  </span>
                  <input
                    type="range"
                    min={40}
                    max={160}
                    value={filters.contrast}
                    disabled={running}
                    onChange={(event) =>
                      setFilters({ ...filters, contrast: Number(event.target.value) })
                    }
                    className="w-full accent-[hsl(var(--primary))]"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.grayscale}
                    disabled={running}
                    onChange={(event) => setFilters({ ...filters, grayscale: event.target.checked })}
                    className="h-4 w-4"
                  />
                  Grayscale
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
              <Button
                variant="outline"
                size="sm"
                disabled={ops.length === 0 || running}
                onClick={() => {
                  setOps((current) => current.slice(0, -1));
                  setSelection(null);
                }}
              >
                <Undo2 className="mr-1.5 h-4 w-4" /> Undo
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(ops.length === 0 && !selection) || running}
                onClick={() => {
                  setOps([]);
                  setSelection(null);
                  setFilters(DEFAULT_FILTERS);
                }}
              >
                Reset
              </Button>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Export</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={running}
                  onClick={() => void downloadImage('image/png')}
                  data-testid="image-download-png"
                >
                  <Download className="mr-1.5 h-4 w-4" /> PNG
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={running}
                  onClick={() => void downloadImage('image/jpeg')}
                  data-testid="image-download-jpeg"
                >
                  <Download className="mr-1.5 h-4 w-4" /> JPEG
                </Button>
              </div>
              <Button className="w-full" disabled={running} onClick={() => void createPdf()} data-testid="image-to-pdf">
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building PDF…
                  </>
                ) : (
                  'Create a PDF'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {runner.state.status === 'running' && (
        <JobProgressPanel progress={runner.state.progress} onCancel={runner.cancel} />
      )}
    </div>
  );
}
