import { useMemo, useState } from 'react';
import { Loader2, Stamp } from 'lucide-react';
import { toast } from 'sonner';
import { timeoutForPageCount, type WatermarkJobOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import { announceCapacityWarning, checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

type Placement = 'center' | 'tile';

const PRESETS = [
  { text: 'APPROVED', color: 'green' },
  { text: 'DRAFT', color: 'grey' },
  { text: 'CONFIDENTIAL', color: 'red' },
  { text: 'REVIEWED', color: 'blue' },
  { text: 'VOID', color: 'red' },
  { text: 'PAID', color: 'green' },
] as const;

const COLORS = {
  grey: { label: 'Grey', rgb: { r: 0.45, g: 0.45, b: 0.45 }, css: 'rgb(115,115,115)' },
  black: { label: 'Black', rgb: { r: 0.1, g: 0.1, b: 0.1 }, css: 'rgb(26,26,26)' },
  red: { label: 'Red', rgb: { r: 0.82, g: 0.16, b: 0.2 }, css: 'rgb(209,41,51)' },
  blue: { label: 'Blue', rgb: { r: 0.16, g: 0.38, b: 0.8 }, css: 'rgb(41,97,204)' },
  green: { label: 'Green', rgb: { r: 0.09, g: 0.55, b: 0.3 }, css: 'rgb(23,140,77)' },
} as const;

type ColorKey = keyof typeof COLORS;

/**
 * Stamp: the one-click marks people actually need (APPROVED, DRAFT, PAID).
 *
 * Deliberately a preset surface over the existing watermark job rather than a
 * second drawing engine: text, rotation, opacity and centre/tile placement are
 * exactly what a stamp is, and the watermark op already clamps every numeric
 * option before it reaches a content stream.
 */
export function StampMarkTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('APPROVED');
  const [colorKey, setColorKey] = useState<ColorKey>('green');
  const [size, setSize] = useState(64);
  const [rotation, setRotation] = useState(-20);
  const [opacity, setOpacity] = useState(30);
  const [placement, setPlacement] = useState<Placement>('center');
  const runner = useJobRunner<WatermarkJobOutput>('watermark');
  const running = runner.state.status === 'running';

  const color = COLORS[colorKey];
  const marks = useMemo(() => {
    if (placement === 'center') return [{ left: 50, top: 50 }];
    return Array.from({ length: 12 }, (_, index) => ({
      left: 12 + (index % 3) * 38,
      top: 12 + Math.floor(index / 3) * 26,
    }));
  }, [placement]);

  const handleFiles = (incoming: File[]) => {
    if (incoming.length === 0) {
      setFiles([]);
      return;
    }
    const file = incoming[0]!;
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: file.size,
      largestFileBytes: file.size,
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    announceCapacityWarning(verdict);
    setFiles([file]);
  };

  const run = async () => {
    const value = text.trim();
    if (!value) {
      toast.error('Enter the stamp text.');
      return;
    }
    if (files.length === 0 || running) return;

    const outcome = await runner.run(
      await readAsInputFiles(files),
      {
        outputName: `${files[0]!.name.replace(/\.[^.]+$/, '')}-stamped`,
        spec: {
          mode: 'text',
          text: value,
          fontSize: size,
          rotation,
          opacity: opacity / 100,
          placement,
          color: color.rgb,
        },
      },
      { timeoutMs: timeoutForPageCount(120) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'stamp',
      toolName: 'Stamp',
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
          setFiles([]);
        }}
        footerNote="The mark is drawn over the page content. Keep the original if you may need a clean copy later."
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={handleFiles}
        multiple={false}
        disabled={running}
        hint="one PDF; the stamp lands on every page"
      />

      {files.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Preview · page 1
            </p>
            <div className="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-lg border border-border bg-white shadow-sm">
              <span className="absolute left-8 right-8 top-10 h-1.5 rounded-full bg-muted" />
              <span className="absolute left-8 right-16 top-16 h-1.5 rounded-full bg-muted" />
              <span className="absolute left-8 right-24 top-[5.5rem] h-1.5 rounded-full bg-muted" />
              <span className="absolute left-8 right-14 top-28 h-1.5 rounded-full bg-muted" />
              {marks.map((mark, index) => (
                <span
                  key={index}
                  className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-bold tracking-wide"
                  style={{
                    left: `${mark.left}%`,
                    top: `${mark.top}%`,
                    color: color.css,
                    opacity: opacity / 100,
                    fontSize: placement === 'center' ? `${Math.max(10, size * 0.32)}px` : '9px',
                    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                  }}
                >
                  {text.trim() || 'STAMP'}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Approximate CSS preview; the downloaded bytes are the authority.
            </p>
          </div>

          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div className="space-y-2">
              <Label>Preset</Label>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <Button
                    key={preset.text}
                    type="button"
                    size="sm"
                    variant={text === preset.text ? 'default' : 'outline'}
                    disabled={running}
                    onClick={() => {
                      setText(preset.text);
                      setColorKey(preset.color);
                    }}
                  >
                    {preset.text}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="stamp-text">Stamp text</Label>
              <Input
                id="stamp-text"
                value={text}
                maxLength={40}
                disabled={running}
                onChange={(event) => setText(event.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="stamp-size">Size (pt)</Label>
                <Input
                  id="stamp-size"
                  type="number"
                  min={12}
                  max={144}
                  value={size}
                  disabled={running}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    setSize(Number.isFinite(next) ? Math.min(144, Math.max(12, next)) : 64);
                  }}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stamp-angle">Angle (°)</Label>
                <Input
                  id="stamp-angle"
                  type="number"
                  min={-180}
                  max={180}
                  value={rotation}
                  disabled={running}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    setRotation(Number.isFinite(next) ? Math.min(180, Math.max(-180, next)) : 0);
                  }}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stamp-opacity">Opacity (%)</Label>
                <Input
                  id="stamp-opacity"
                  type="number"
                  min={2}
                  max={100}
                  value={opacity}
                  disabled={running}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    setOpacity(Number.isFinite(next) ? Math.min(100, Math.max(2, next)) : 30);
                  }}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stamp-placement">Placement</Label>
                <select
                  id="stamp-placement"
                  value={placement}
                  disabled={running}
                  onChange={(event) => setPlacement(event.target.value as Placement)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="center">Centred</option>
                  <option value="tile">Tiled</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Colour</Label>
              <div className="flex gap-2">
                {(Object.keys(COLORS) as ColorKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-label={COLORS[key].label}
                    aria-pressed={colorKey === key}
                    disabled={running}
                    onClick={() => setColorKey(key)}
                    className={`h-7 w-7 rounded-full ring-2 transition-transform hover:scale-110 ${
                      colorKey === key ? 'ring-primary' : 'ring-transparent'
                    }`}
                    style={{ background: COLORS[key].css }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Stamp className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{shortName(files[0]!.name, 28)}</span>
              </p>
              <Button size="lg" disabled={running} onClick={() => void run()} data-testid="stamp-run">
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Stamping…
                  </>
                ) : (
                  'Apply stamp'
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
