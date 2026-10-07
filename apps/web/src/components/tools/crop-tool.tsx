import { useState } from 'react';
import { Crop as CropIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { timeoutForPageCount, type InspectOutput, type OrganizeJobOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import { usePageThumbnails } from '@/hooks/use-page-thumbnails';
import { checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { readAsInputFiles, totalBytes } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

interface PageSize {
  width: number;
  height: number;
}

const DEFAULT_MARGINS = { top: '0', bottom: '0', left: '0', right: '0' };

/**
 * Crop PDF: numeric margins drive a live overlay on page 1's preview; the same
 * rectangle is applied to every page (page coordinates, clamped by the engine).
 */
export function CropTool() {
  const { files, tiles, busy, progress, prepare, reset, cancel } = usePageThumbnails();
  const [pageSize, setPageSize] = useState<PageSize | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [margins, setMargins] = useState(DEFAULT_MARGINS);
  const runner = useJobRunner<OrganizeJobOutput>('organize');

  const running = busy || runner.state.status === 'running';

  const parseMargin = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };

  const top = parseMargin(margins.top);
  const bottom = parseMargin(margins.bottom);
  const left = parseMargin(margins.left);
  const right = parseMargin(margins.right);

  const sizeError =
    pageSize === null
      ? null
      : left + right >= pageSize.width
        ? `Left + right must stay under ${Math.round(pageSize.width)} pt.`
        : top + bottom >= pageSize.height
          ? `Top + bottom must stay under ${Math.round(pageSize.height)} pt.`
          : null;
  const ready = Boolean(pageSize && pageCount > 0 && sizeError === null && files.length > 0);

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      setPageSize(null);
      setPageCount(0);
      setMargins(DEFAULT_MARGINS);
      reset();
      return;
    }
    const ok = await prepare(incoming, {
      pageIndexes: [0],
      onInspected: (info: InspectOutput) => {
        const doc = info.documents[0];
        if (!doc) return;
        setPageCount(doc.pageCount);
        const first = doc.pages[0];
        if (first) setPageSize({ width: first.widthPt, height: first.heightPt });
      },
    });
    if (!ok) {
      setPageSize(null);
      setPageCount(0);
    }
  };

  const runCrop = async () => {
    if (!ready || runner.state.status === 'running' || pageSize === null) return;
    const verdict = checkClientCapacity({
      fileCount: files.length,
      totalBytes: totalBytes(files),
      pageCount,
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }

    const outcome = await runner.run(
      await readAsInputFiles(files),
      {
        pageOrder: Array.from({ length: pageCount }, (_, pageIndex) => ({ docIndex: 0, pageIndex })),
        crop: {
          x: left,
          y: bottom,
          width: pageSize.width - left - right,
          height: pageSize.height - top - bottom,
        },
        outputName: `${files[0]!.name.replace(/\.pdf$/i, '')}-cropped`,
      },
      { timeoutMs: timeoutForPageCount(pageCount) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'crop-pdf',
      toolName: 'Crop PDF',
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
          setPageSize(null);
          setPageCount(0);
          setMargins(DEFAULT_MARGINS);
        }}
        footerNote="The crop hides what is outside the rectangle — it never re-renders, so text stays vector."
      />
    );
  }

  const setMargin = (key: keyof typeof DEFAULT_MARGINS, value: string) =>
    setMargins((prev) => ({ ...prev, [key]: value }));

  const tile = tiles[0];

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => void handleFiles(next)}
        disabled={running}
        hint="one PDF to crop"
        multiple={false}
      />

      {busy && <JobProgressPanel progress={progress} onCancel={cancel} />}

      {tile && pageSize && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Preview — page 1 of {pageCount}</p>
              <span className="text-xs text-muted-foreground">
                {Math.round(pageSize.width)} × {Math.round(pageSize.height)} pt
              </span>
            </div>
            <div
              className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-lg border border-border bg-muted"
              style={{ aspectRatio: `${tile.width} / ${tile.height}` }}
            >
              <img
                src={tile.url}
                alt="Page 1 crop preview"
                className="h-full w-full object-contain"
                draggable={false}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute border-2 border-dashed border-emerald-500 bg-black/5 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
                style={{
                  left: `${(left / pageSize.width) * 100}%`,
                  top: `${(top / pageSize.height) * 100}%`,
                  right: `${(right / pageSize.width) * 100}%`,
                  bottom: `${(bottom / pageSize.height) * 100}%`,
                }}
              />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <CropIcon className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium">Margins (points)</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {(['top', 'bottom', 'left', 'right'] as const).map((key) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`margin-${key}`} className="capitalize">
                    {key}
                  </Label>
                  <Input
                    id={`margin-${key}`}
                    type="number"
                    min={0}
                    value={margins[key]}
                    onChange={(event) => setMargin(key, event.target.value)}
                    aria-invalid={sizeError !== null}
                  />
                </div>
              ))}
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              The same rectangle is applied to every page. {pageCount > 1 && 'Pages with different sizes get clamped to their own edges.'}
            </p>
            {sizeError && <p className="mt-2 text-xs text-destructive">{sizeError}</p>}

            <div className="mt-4">
              <Button size="lg" className="w-full" disabled={running || !ready} onClick={() => void runCrop()}>
                {runner.state.status === 'running' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cropping…
                  </>
                ) : (
                  <>Crop {pageCount} page{pageCount === 1 ? '' : 's'}</>
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
