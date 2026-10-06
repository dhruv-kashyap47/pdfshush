import { useEffect, useRef, useState } from 'react';
import { Download, ImageIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  LIMITS,
  parsePageRanges,
  timeoutForPageCount,
  type InspectOutput,
  type PdfToImagesOutput,
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
import { checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

const WIDTH_OPTIONS = [
  { value: '960', label: '960 px — small, for web' },
  { value: '1600', label: '1600 px — medium (recommended)' },
  { value: '2560', label: '2560 px — print quality' },
];

const MAX_PREVIEW_TILES = 24;

type RangeResult = { ok: true; indexes?: number[] } | { ok: false; error: string };

export function PdfToImagesTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [rangeText, setRangeText] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg');
  const [width, setWidth] = useState('1600');
  const [previews, setPreviews] = useState<string[]>([]);
  const urlsRef = useRef<string[]>([]);

  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const renderRunner = useJobRunner<PdfToImagesOutput>('pdf-to-images');

  const revokeUrls = () => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
  };
  useEffect(() => () => revokeUrls(), []);

  /** Pure: never sets state, so it is safe to call during render. */
  const parseRange = (text: string, total: number | null): RangeResult => {
    if (total === null) return { ok: false, error: 'Select a file first' };
    const trimmed = text.trim();
    if (trimmed === '') return { ok: true }; // all pages
    try {
      const indexes = parsePageRanges(trimmed, total);
      if (indexes.length === 0) return { ok: false, error: 'That range matches no pages.' };
      return { ok: true, indexes };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Cannot read that range.' };
    }
  };

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      setFiles([]);
      setPageCount(null);
      return;
    }
    const file = incoming[0]!;
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: file.size,
      largestFileBytes: largestBytes([file]),
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }

    setRangeError(null);
    const outcome = await inspectRunner.run(await readAsInputFiles([file]));
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      setFiles([]);
      setPageCount(null);
      return;
    }
    const doc = outcome.result.documents[0];
    if (!doc) return;
    if (doc.encrypted) {
      toast.error('That PDF is password protected — unlock it first.');
      return;
    }

    const pageVerdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: file.size,
      pageCount: doc.pageCount,
    });
    if (!pageVerdict.ok) {
      toast.error(pageVerdict.message);
      return;
    }

    revokeUrls();
    setPreviews([]);
    setFiles([file]);
    setPageCount(doc.pageCount);
  };

  const runRender = async () => {
    if (files.length === 0 || renderRunner.state.status === 'running' || pageCount === null) return;

    const range = parseRange(rangeText, pageCount);
    if (!range.ok) {
      setRangeError(range.error);
      return;
    }
    setRangeError(null);
    const pageIndexes = range.indexes;

    const effectivePages = pageIndexes?.length ?? pageCount;
    const targetWidth = Number.parseInt(width, 10);
    const roughBytes = files[0]!.size + effectivePages * targetWidth * targetWidth * 4;
    if (roughBytes > 1.5 * 1024 * 1024 * 1024) {
      toast.error(
        'That combination would need over 1.5 GB of memory. Choose a smaller width or a shorter page range.',
      );
      return;
    }

    const outcome = await renderRunner.run(
      await readAsInputFiles(files),
      {
        // The job's ImageFormat is 'png' | 'jpeg'; the UI says 'jpg'.
        format: format === 'png' ? 'png' : 'jpeg',
        targetWidthPx: targetWidth,
        ...(pageIndexes ? { pageIndexes } : {}),
      },
      { timeoutMs: timeoutForPageCount(effectivePages) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }

    // Blob URLs are the source of truth for cleanup (ref) and rendering (state).
    const urls = outcome.result.images.map((image) =>
      URL.createObjectURL(new Blob([image.data], { type: image.mimeType })),
    );
    revokeUrls();
    urlsRef.current = urls;
    setPreviews(urls);

    void recordRecent({
      toolSlug: 'pdf-to-jpg',
      toolName: 'PDF to JPG',
      fileName: outcome.result.zipName.replace(/-images\.zip$/, `.${outcome.result.format === 'png' ? 'png' : 'jpg'}`),
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.zip.byteLength,
    });
  };

  const busy = inspectRunner.state.status === 'running' || renderRunner.state.status === 'running';

  if (renderRunner.state.status === 'done') {
    const { result } = renderRunner.state;
    const slice = result.images.slice(0, MAX_PREVIEW_TILES);

    return (
      <div className="space-y-4">
        <ResultPanel
          fileName={result.zipName}
          pageCount={result.pageCount}
          sizeBytes={result.zip.byteLength}
          downloadLabel="Download ZIP"
          onDownload={() => downloadBytes(result.zip, result.zipName, 'application/zip')}
          onReset={() => {
            renderRunner.reset();
            revokeUrls();
            setPreviews([]);
            setFiles([]);
            setPageCount(null);
            setRangeText('');
          }}
          footerNote={
            result.images.length > slice.length
              ? `Showing the first ${slice.length} of ${result.images.length} images — the ZIP contains every page.`
              : 'Individual downloads below; the ZIP bundles all of them.'
          }
        >
          {previews.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {slice.map((image, index) => (
                <figure
                  key={image.name}
                  className="group relative overflow-hidden rounded-lg border border-border bg-card"
                >
                  <img
                    src={previews[index]}
                    alt={`Page ${index + 1}`}
                    loading="lazy"
                    className="aspect-[3/4] w-full object-cover"
                  />
                  <figcaption className="flex items-center justify-between gap-1 px-2 py-1.5 text-[11px] text-muted-foreground">
                    <span className="truncate" title={image.name}>
                      {shortName(image.name, 18)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Download ${image.name}`}
                      className="shrink-0 rounded p-1 transition-colors hover:bg-accent hover:text-foreground"
                      onClick={() => downloadBytes(image.data, image.name, image.mimeType)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </ResultPanel>
        <p className="text-xs text-muted-foreground">
          Tip: JPG is smaller and lossy; PNG is lossless — pick PNG for text-heavy pages.
        </p>
      </div>
    );
  }

  const liveRange = parseRange(rangeText, pageCount);
  const outputCount = pageCount === null ? 0 : liveRange.ok ? (liveRange.indexes?.length ?? pageCount) : null;

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => void handleFiles(next)}
        multiple={false}
        disabled={busy}
        hint="renders every page as an image"
      />

      {files.length === 0 && inspectRunner.state.status === 'running' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading document…
        </p>
      )}

      {pageCount !== null && files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{shortName(files[0]!.name)}</p>
              <p className="text-xs text-muted-foreground">
                {pageCount.toLocaleString()} pages
                {outputCount !== null && (
                  <>
                    {' '}· will produce {outputCount} image{outputCount === 1 ? '' : 's'}
                  </>
                )}
              </p>
            </div>
            <ImageIcon className="h-5 w-5 shrink-0 text-primary" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pages-range">Pages</Label>
              <Input
                id="pages-range"
                placeholder={`All ${pageCount} pages — or e.g. 1-3, 7`}
                value={rangeText}
                onChange={(event) => {
                  setRangeText(event.target.value);
                  setRangeError(null);
                }}
                aria-invalid={rangeError !== null}
              />
              {rangeError && <p className="text-xs text-destructive">{rangeError}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="image-width">Image width</Label>
              <Select value={width} onValueChange={setWidth}>
                <SelectTrigger id="image-width" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WIDTH_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Format</span>
              <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Image format">
                <button
                  type="button"
                  onClick={() => setFormat('jpg')}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    format === 'jpg'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  JPG
                </button>
                <button
                  type="button"
                  onClick={() => setFormat('png')}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    format === 'png'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  PNG
                </button>
              </div>
            </div>
            <Button size="lg" disabled={busy} onClick={() => void runRender()}>
              {renderRunner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rendering…
                </>
              ) : (
                <>Convert to {format.toUpperCase()}</>
              )}
            </Button>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            In-browser cap: {LIMITS.client.maxPages.toLocaleString()} pages per run. Larger documents
            get server processing in a later phase.
          </p>
        </div>
      )}

      {renderRunner.state.status === 'running' && (
        <JobProgressPanel progress={renderRunner.state.progress} onCancel={renderRunner.cancel} />
      )}
    </div>
  );
}
