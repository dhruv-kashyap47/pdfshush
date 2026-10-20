import { useEffect, useMemo, useState } from 'react';
import { Droplets, Image as ImageIcon, Loader2, Type } from 'lucide-react';
import { toast } from 'sonner';
import { timeoutForPageCount, type WatermarkJobOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useJobRunner } from '@/hooks/use-job-runner';
import { usePageThumbnails } from '@/hooks/use-page-thumbnails';
import { checkClientCapacity, announceCapacityWarning } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, totalBytes } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

type Mode = 'text' | 'image';
type Placement = 'center' | 'tile';

const SWATCHES = [
  { key: 'grey', label: 'Grey', rgb: { r: 0.5, g: 0.5, b: 0.5 } },
  { key: 'black', label: 'Black', rgb: { r: 0.1, g: 0.1, b: 0.1 } },
  { key: 'red', label: 'Red', rgb: { r: 0.86, g: 0.2, b: 0.25 } },
  { key: 'blue', label: 'Blue', rgb: { r: 0.2, g: 0.42, b: 0.82 } },
] as const;

/**
 * Watermark: one mark (text or image) over every page, rotated, translucent.
 * The first page renders as a live preview with the same angle, opacity and
 * colour the job will draw -- a CSS approximation, never the authority, and
 * the result panel always follows the real bytes.
 */
export function WatermarkTool() {
  const { files, tiles, busy, progress, prepare, reset, cancel } = usePageThumbnails();
  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('DRAFT');
  const [colorKey, setColorKey] = useState<(typeof SWATCHES)[number]['key']>('grey');
  const [image, setImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [rotation, setRotation] = useState(-45);
  const [opacity, setOpacity] = useState(20); // percent
  const [size, setSize] = useState(48);
  const [placement, setPlacement] = useState<Placement>('center');
  const runner = useJobRunner<WatermarkJobOutput>('watermark');

  const running = busy || runner.state.status === 'running';
  const preview = tiles[0] ?? null;
  const previewStyle = useMemo(() => {
    const rgb = SWATCHES.find((entry) => entry.key === colorKey)!.rgb;
    return {
      rotation,
      opacity: opacity / 100,
      color: `rgb(${rgb.r * 255}, ${rgb.g * 255}, ${rgb.b * 255})`,
      size,
      placement,
      text: text.trim(),
    };
  }, [colorKey, opacity, placement, rotation, size, text]);

  useEffect(() => {
    if (!image) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      setImage(null);
      return;
    }
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: totalBytes(incoming.slice(0, 1)),
      largestFileBytes: largestBytes(incoming.slice(0, 1)),
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    announceCapacityWarning(verdict);
    // Preview only needs the first page.
    void prepare(incoming, { pageIndexes: [0], targetWidthPx: 640 });
  };

  const pickImage = (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('The watermark must be a PNG or JPEG image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Keep the watermark image under 5 MB.');
      return;
    }
    setImage(file);
    setMode('image');
  };

  const asControlSpec = (): { spec: Record<string, unknown> } | null => {
    if (mode === 'image') {
      if (!image) {
        toast.error('Choose a watermark image first.');
        return null;
      }
      return { spec: { mode: 'image', imageScale: 0.35, rotation, opacity: opacity / 100, placement } };
    }
    if (!text.trim()) {
      toast.error('Enter watermark text.');
      return null;
    }
    const rgb = SWATCHES.find((entry) => entry.key === colorKey)!.rgb;
    return {
      spec: {
        mode: 'text',
        text: text.trim(),
        fontSize: size,
        rotation,
        opacity: opacity / 100,
        color: rgb,
        placement,
      },
    };
  };

  const save = async () => {
    if (files.length === 0 || runner.state.status === 'running') return;
    const payload = asControlSpec();
    if (!payload) return;
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: totalBytes(files) + (image?.size ?? 0),
      largestFileBytes: largestBytes(files),
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }

    const inputFile = await readAsInputFiles(files);
    if (image && mode === 'image') {
      payload.spec.image = {
        data: new Uint8Array(await image.arrayBuffer()),
        type: image.type || 'image/png',
      };
    }

    const outcome = await runner.run(inputFile, payload, {
      timeoutMs: timeoutForPageCount(120),
    });
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'watermark',
      toolName: 'Watermark',
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
          reset();
        }}
        footerNote="Applied over content on every page, so the mark still shows on dense pages. Removing it later is not trivial: keep the original."
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => void handleFiles(next)}
        multiple={false}
        disabled={running}
        hint="drop a PDF, then an optional watermark image"
      />

      {busy && <JobProgressPanel progress={progress} onCancel={cancel} />}

      {preview && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Live preview ------------------------------------------------ */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Preview · page 1
            </p>
            <div
              className="relative mx-auto w-full max-w-md overflow-hidden rounded-lg border border-border bg-muted"
              style={{ aspectRatio: `${preview.width} / ${preview.height}` }}
            >
              <img src={preview.url} alt="Page 1 preview" className="h-full w-full object-contain" />
              <WatermarkOverlay spec={previewStyle} imageUrl={mode === 'image' ? imageUrl : null} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {previewStyle.placement === 'tile'
                ? 'Tiled approximation; the finished mark places itself the same way on every page.'
                : 'Approximate preview; the saved file is the authority.'}
            </p>
          </div>

          {/* Controls ---------------------------------------------------- */}
          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={mode === 'text' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMode('text')}
              >
                <Type className="mr-1.5 h-3.5 w-3.5" /> Text
              </Button>
              <Button
                type="button"
                variant={mode === 'image' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (!image) {
                    toast.error('Choose a watermark image first.');
                    return;
                  }
                  setMode('image');
                }}
              >
                <ImageIcon className="mr-1.5 h-3.5 w-3.5" /> Image
              </Button>
            </div>

            {mode === 'text' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="watermark-text">Watermark text</Label>
                  <Input
                    id="watermark-text"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    maxLength={100}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Colour</Label>
                  <div className="flex gap-2">
                    {SWATCHES.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        aria-pressed={colorKey === entry.key}
                        aria-label={entry.label}
                        onClick={() => setColorKey(entry.key)}
                        className={`h-7 w-7 rounded-full ring-2 transition-transform hover:scale-110 ${
                          colorKey === entry.key ? 'ring-primary' : 'ring-transparent'
                        }`}
                        style={{ background: entryCSS(entry.key) }}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="watermark-size">Text size (pt)</Label>
                  <Input
                    id="watermark-size"
                    type="number"
                    min={12}
                    max={144}
                    value={size}
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10);
                      setSize(Number.isFinite(next) ? Math.min(144, Math.max(12, next)) : 48);
                    }}
                    className="tabular-nums"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="watermark-image">Watermark image</Label>
                {image ? (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-2">
                    {imageUrl && (
                      <img src={imageUrl} alt="" className="h-10 w-10 rounded object-contain" />
                    )}
                    <p className="min-w-0 flex-1 truncate text-xs">{image.name}</p>
                    <Button size="sm" variant="ghost" onClick={() => setImage(null)}>
                      Remove
                    </Button>
                  </div>
                ) : (
                  <label
                    htmlFor="watermark-image"
                    className="flex h-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border bg-background text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <Droplets className="mr-1.5 h-3.5 w-3.5" /> choose a PNG or JPEG (≤ 5 MB)
                  </label>
                )}
                <input
                  id="watermark-image"
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(event) => {
                    pickImage(event.target.files);
                    event.target.value = '';
                  }}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="watermark-angle">Angle (°)</Label>
                <Input
                  id="watermark-angle"
                  type="number"
                  min={-180}
                  max={180}
                  value={rotation}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    setRotation(Number.isFinite(next) ? Math.min(180, Math.max(-180, next)) : -45);
                  }}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="watermark-opacity">Opacity (%)</Label>
                <Input
                  id="watermark-opacity"
                  type="number"
                  min={2}
                  max={100}
                  value={opacity}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    setOpacity(Number.isFinite(next) ? Math.min(100, Math.max(2, next)) : 20);
                  }}
                  className="tabular-nums"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Placement</Label>
              <Select value={placement} onValueChange={(value) => setPlacement(value as Placement)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="center">Centred, once per page</SelectItem>
                  <SelectItem value="tile">Tiled, across the page</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              {runner.state.status === 'running' ? (
                <Button disabled size="lg">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Applying…
                </Button>
              ) : (
                <Button size="lg" onClick={() => void save()} disabled={running}>
                  <Droplets className="mr-2 h-4 w-4" /> Watermark
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {runner.state.status === 'running' && !busy && (
        <JobProgressPanel progress={runner.state.progress} onCancel={runner.cancel} />
      )}
    </div>
  );
}

/** CSS approximation of the drawn mark; layout only, never authoritative. */
function WatermarkOverlay({
  spec,
  imageUrl,
}: {
  spec: { rotation: number; opacity: number; color: string; size: number; placement: Placement; text: string };
  imageUrl: string | null;
}) {
  const mark: React.CSSProperties = {
    transform: `rotate(${spec.rotation}deg)`,
    opacity: spec.opacity,
  };
  const label = spec.text || 'MARK';
  if (spec.placement === 'center') {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="max-w-[45%] select-none"
            style={{ ...mark, opacity: spec.opacity, filter: 'grayscale(1)' }}
          />
        ) : (
          <span
            className="select-none whitespace-nowrap font-bold"
            style={{ ...mark, color: spec.color, fontSize: `${spec.size * 0.75}pt` }}
          >
            {label}
          </span>
        )}
      </div>
    );
  }
  const cells = [
    'top-[16%] left-[20%]',
    'top-[16%] left-[60%]',
    'top-[40%] left-[10%]',
    'top-[40%] left-[50%]',
    'top-[64%] left-[25%]',
    'top-[64%] left-[65%]',
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {cells.map((position) =>
        imageUrl ? (
          <img
            key={position}
            src={imageUrl}
            alt=""
            className={`absolute w-[22%] select-none ${position}`}
            style={{ ...mark, filter: 'grayscale(1)' }}
          />
        ) : (
          <span
            key={position}
            className={`absolute select-none whitespace-nowrap font-bold ${position}`}
            style={{ ...mark, color: spec.color, fontSize: `${spec.size * 0.6}pt` }}
          >
            {label}
          </span>
        ),
      )}
    </div>
  );
}

function entryCSS(key: (typeof SWATCHES)[number]['key']): string {
  const rgb = SWATCHES.find((entry) => entry.key === key)!.rgb;
  return `rgb(${rgb.r * 255}, ${rgb.g * 255}, ${rgb.b * 255})`;
}
