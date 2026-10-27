import { useState } from 'react';
import {
  FileArchive,
  Gauge,
  ImageDown,
  Loader2,
  Minimize2,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  LIMITS,
  timeoutForPageCount,
  type CompressJobOutput,
  type CompressMode,
  type InspectOutput,
} from '@pdfshush/pdf-core';
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
import { announceCapacityWarning, checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { formatBytes } from '@/lib/format';
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

const MODES: { value: CompressMode; label: string; detail: string; icon: typeof Minimize2 }[] = [
  {
    value: 'smart',
    label: 'Smart compression',
    detail: 'Re-encodes images while keeping text, links and forms.',
    icon: Sparkles,
  },
  {
    value: 'raster',
    label: 'Strong compression',
    detail: 'Rebuilds pages as JPEGs. Best for scans and photos.',
    icon: Minimize2,
  },
  {
    value: 'lossless',
    label: 'Repack only',
    detail: 'Keeps text and images exactly as they are. May save nothing.',
    icon: FileArchive,
  },
];

const DPI_OPTIONS = [110, 150, 200, 300];

/**
 * Compress PDF. The three strategies are stated plainly because they mean
 * different things: smart preserves the document and re-encodes only images,
 * repack preserves everything and may save nothing, and strong compression
 * reliably shrinks scans but turns text into pixels. The tool never presents
 * one as the other.
 */
export function CompressPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [inspect, setInspect] = useState<InspectOutput['documents'][number] | null>(null);
  const [mode, setMode] = useState<CompressMode>('smart');
  const [quality, setQuality] = useState(72);
  const [dpi, setDpi] = useState(150);
  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const runner = useJobRunner<CompressJobOutput>('compress');
  const inspecting = inspectRunner.state.status === 'running';
  const compressing = runner.state.status === 'running';
  const running = inspecting || compressing;

  const overCap =
    mode === 'raster' && inspect !== null && inspect.pageCount > LIMITS.tool.maxRedactPages;

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      setFile(null);
      setInspect(null);
      return;
    }
    const candidate = incoming[0]!;
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: candidate.size,
      largestFileBytes: largestBytes([candidate]),
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    announceCapacityWarning(verdict);
    inspectRunner.reset();
    setFile(candidate);
    setInspect(null);

    const outcome = await inspectRunner.run(await readAsInputFiles([candidate]));
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    const doc = outcome.result.documents[0];
    if (!doc) return;
    setInspect(doc);

    // Unlock first: a password-protected source would fail mid-run instead of
    // here, and this tool happily re-saves an opened document.
    const pageVerdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: candidate.size,
      pageCount: doc.pageCount,
    });
    if (!pageVerdict.ok) toast.error(pageVerdict.message);
  };

  const run = async () => {
    if (!file || running || overCap) return;
    const outcome = await runner.run(
      await readAsInputFiles([file]),
      { mode, quality: quality / 100, dpi },
      { timeoutMs: timeoutForPageCount(inspect?.pageCount ?? 60) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'compress-pdf',
      toolName: 'Compress PDF',
      fileName: outcome.result.fileName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  };

  if (runner.state.status === 'done') {
    const { result } = runner.state;
    const before = result.originalBytes;
    const after = result.data.byteLength;
    const savedPercent = before > 0 ? (1 - after / before) * 100 : 0;
    const saved = Math.round(savedPercent);
    const savedLabel =
      savedPercent >= 1 ? `${saved}% smaller` : savedPercent > 0 ? '<1% smaller' : 'no saving';
    const optimized = result.imagesOptimized;
    const skipped = result.imagesSkipped;
    const imageBefore = result.imageBytesBefore;
    const imageAfter = result.imageBytesAfter;
    const footerNote =
      result.mode === 'raster'
        ? 'Rebuilt as JPEG images: smaller for scans, but text in this copy is no longer selectable or searchable.'
        : result.mode === 'smart'
          ? optimized > 0
            ? `Re-encoded ${optimized} embedded image${optimized === 1 ? '' : 's'} while leaving text, links, forms and vector art untouched.${skipped > 0 ? ` ${skipped} image${skipped === 1 ? ' was' : 's were'} left as-is (masked, unusual colour, oversized or not enough gain).` : ''}`
            : skipped > 0
              ? `No embedded image produced a safe replacement that was at least 3% smaller, so all ${skipped} image${skipped === 1 ? ' was' : 's were'} left untouched and the file was repacked cleanly. Text, links and forms are unchanged.`
              : 'This document has no embedded images, so it was repacked cleanly. Text, links and forms are untouched.'
          : 'Repacked without touching text or images. The original layout and text layer are intact.';

    return (
      <ResultPanel
        fileName={result.fileName}
        pageCount={result.pageCount}
        sizeBytes={after}
        onDownload={() => downloadBytes(result.data, result.fileName)}
        onReset={() => {
          runner.reset();
          setFile(null);
          setInspect(null);
          setMode('smart');
          setQuality(72);
          setDpi(150);
        }}
        footerNote={footerNote}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="text-muted-foreground">
            Before <strong className="text-foreground">{formatBytes(before)}</strong>
          </span>
          <span className="text-muted-foreground">
            After <strong className="text-foreground">{formatBytes(after)}</strong>
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              savedPercent > 0
                ? 'bg-primary/10 text-primary'
                : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
            }`}
          >
            {savedLabel}
          </span>
          {result.mode !== 'raster' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <Sparkles className="h-3 w-3" /> text preserved
            </span>
          )}
        </div>
        {result.mode === 'smart' && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <ImageDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            {optimized > 0
              ? `${optimized} image${optimized === 1 ? '' : 's'} re-encoded · image payload ${formatBytes(imageBefore)} → ${formatBytes(imageAfter)}`
              : 'No image payload was replaced; the file was repacked cleanly instead.'}
          </p>
        )}
        {savedPercent <= 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            {result.mode === 'smart'
              ? 'Smart compression only replaces an image when the new copy is at least 3% smaller. This document was already compact, so keep the original if size is the only reason you are here.'
              : result.mode === 'raster'
                ? 'This document was already compact, so the rebuild did not make it smaller. Keep the original if size is the only reason you are here.'
                : 'Repacking changes the container, not the content. This document was already compact, so keep the original if size is the only reason you are here.'}
          </p>
        )}
      </ResultPanel>
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={file ? [file] : []}
        onFiles={(next) => void handleFiles(next)}
        multiple={false}
        disabled={running}
        hint="one PDF; compress on this device"
      />

      {file && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{shortName(file.name)}</p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(file.size)}
                {inspect ? ` · ${inspect.pageCount.toLocaleString()} pages` : ''}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {MODES.map((option) => {
              const Icon = option.icon;
              const active = mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  disabled={running}
                  onClick={() => setMode(option.value)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-muted/30'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="h-4 w-4 text-primary" />
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{option.detail}</span>
                </button>
              );
            })}
          </div>

          {mode === 'smart' && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs text-foreground">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p>
                Re-encodes JPEG and Flate photo images at the quality you choose. Text, links,
                forms, annotations and vector art stay exactly as they are. Images with masks or
                unusual colour spaces are left alone rather than risk breaking them.
              </p>
            </div>
          )}

          {mode === 'raster' && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Pages are rasterized and re-encoded. Links, forms and selectable text do not
                survive. Use Smart or Repack when you need the text layer.
              </p>
            </div>
          )}

          {mode !== 'lossless' && (
            <div
              className={`mt-4 grid max-w-md gap-4 ${mode === 'raster' ? 'sm:grid-cols-2' : ''}`}
            >
              <div className="space-y-1.5">
                <Label htmlFor="compress-quality">Image quality (%)</Label>
                <Input
                  id="compress-quality"
                  type="number"
                  min={30}
                  max={100}
                  step={5}
                  value={quality}
                  disabled={running}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    setQuality(Number.isFinite(next) ? Math.min(100, Math.max(30, next)) : 72);
                  }}
                  className="tabular-nums"
                />
                {mode === 'smart' && (
                  <p className="text-[11px] text-muted-foreground">
                    72% is a good balance for photos and scans.
                  </p>
                )}
              </div>
              {mode === 'raster' && (
                <div className="space-y-1.5">
                  <Label htmlFor="compress-dpi">Resolution</Label>
                  <Select
                    value={String(dpi)}
                    disabled={running}
                    onValueChange={(value) => setDpi(Number.parseInt(value, 10))}
                  >
                    <SelectTrigger id="compress-dpi" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DPI_OPTIONS.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {option} dpi
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {overCap && (
            <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <strong className="block">{inspect!.pageCount.toLocaleString()} pages</strong>
              <span className="text-muted-foreground">
                Strong compression rebuilds each page as an image, and the engine caps that at{' '}
                {LIMITS.tool.maxRedactPages} pages (the same gate secure redaction uses). Split the
                document first, or choose Smart compression or Repack only.
              </span>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" />
              {inspecting
                ? 'Reading the document…'
                : mode === 'raster'
                  ? `${dpi} dpi · ${quality}% quality`
                  : mode === 'smart'
                    ? `${quality}% image quality · text preserved`
                    : 'text and images untouched'}
            </p>
            <Button size="lg" disabled={running || overCap} onClick={() => void run()}>
              {compressing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Compressing…
                </>
              ) : inspecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading pages…
                </>
              ) : (
                <>
                  <Minimize2 className="mr-1.5 h-4 w-4" /> Compress PDF
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {runner.state.status === 'running' && (
        <JobProgressPanel progress={runner.state.progress} onCancel={runner.cancel} />
      )}
    </div>
  );
}
