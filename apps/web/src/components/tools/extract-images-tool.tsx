import { useEffect, useState } from 'react';
import { FileImage, Images, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { timeoutForPageCount, type ImagesJobOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity, announceCapacityWarning } from '@/lib/client-capacity';
import { downloadBlob, downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

/** An extracted image made previewable while the result panel is open. */
interface GalleryItem {
  name: string;
  url: string;
  width: number;
  height: number;
  size: number;
}

/**
 * Extract Images: pulls every embedded raster out of the document as real
 * image files (JPEGs pass through byte-identical), previews them as a grid,
 * and ships the lot as one ZIP. Skipped images (CMYK, JBIG2, …) are counted
 * honestly rather than silently dropped.
 */
export function ExtractImagesTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [ready, setReady] = useState(false);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const runner = useJobRunner<ImagesJobOutput>('extract-images');
  const running = runner.state.status === 'running';

  // The gallery owns object URLs; revoke them when it unmounts or refills.
  useEffect(() => {
    return () => {
      for (const item of gallery) URL.revokeObjectURL(item.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revoke only on unmount; refills revoke in-place below
  }, []);

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      setFiles([]);
      setReady(false);
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
    announceCapacityWarning(verdict);
    setFiles([file]);
    setReady(true);
  };

  const run = async () => {
    if (files.length === 0 || running) return;
    const outcome = await runner.run(
      await readAsInputFiles(files),
      undefined,
      { timeoutMs: timeoutForPageCount(120) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    // Fresh result: drop the previous URLs before replacing the gallery.
    for (const item of gallery) URL.revokeObjectURL(item.url);
    setGallery(
      outcome.result.files.map((image) => ({
        name: image.name,
        url: URL.createObjectURL(new Blob([image.data as BlobPart], { type: mimeFor(image.ext) })),
        width: image.width,
        height: image.height,
        size: image.size,
      })),
    );
    void recordRecent({
      toolSlug: 'extract-images',
      toolName: 'Extract Images',
      fileName: outcome.result.zipName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.zip.byteLength,
    });
  };

  if (runner.state.status === 'done') {
    const { result } = runner.state;
    return (
      <div className="space-y-4">
        <ResultPanel
          fileName={result.zipName}
          pageCount={result.pageCount}
          sizeBytes={result.zip.byteLength}
          downloadLabel="Download all (ZIP)"
          onDownload={() => downloadBytes(result.zip, result.zipName, 'application/zip')}
          onReset={() => {
            for (const item of gallery) URL.revokeObjectURL(item.url);
            setGallery([]);
            runner.reset();
            setFiles([]);
            setReady(false);
          }}
          footerNote={
            result.skipped > 0
              ? `${result.extracted} image${result.extracted === 1 ? '' : 's'} extracted; ${result.skipped} skipped (CMYK, JBIG2 or unusual encodings the browser cannot decode).`
              : `${result.extracted} image${result.extracted === 1 ? '' : 's'} extracted at original quality — JPEGs pass through untouched.`
          }
        >
          {gallery.length > 0 && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {gallery.map((item) => (
                <figure key={item.name} className="overflow-hidden rounded-lg border border-border bg-card">
                  <a href={item.url} download={item.name} className="block">
                    <img
                      src={item.url}
                      alt={item.name}
                      loading="lazy"
                      className="h-32 w-full bg-[repeating-conic-gradient(#f4f4f5_0%_25%,#ffffff_0%_50%)] bg-[length:16px_16px] object-contain"
                    />
                  </a>
                  <figcaption className="flex items-baseline justify-between gap-2 px-2 py-1.5">
                    <span className="truncate text-xs" title={item.name}>
                      {item.name}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                      {item.width}×{item.height}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          {gallery.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
              No extractable images in this document — text-based PDFs often have none.
            </div>
          )}
        </ResultPanel>
        {result.extracted > 0 && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              downloadBlob(
                new Blob([result.zip as BlobPart], { type: 'application/zip' }),
                result.zipName,
              )
            }
          >
            <Images className="mr-2 h-4 w-4" /> Save all {result.extracted} images
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => void handleFiles(next)}
        multiple={false}
        disabled={running}
        hint="one PDF; embedded JPEGs and PNGs come out as files"
      />

      {ready && files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{shortName(files[0]!.name)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Every raster image on every page, at original resolution.
              </p>
            </div>
            <Button size="lg" disabled={running} onClick={() => void run()}>
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Extracting…
                </>
              ) : (
                <>
                  <FileImage className="mr-2 h-4 w-4" /> Extract images
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

function mimeFor(ext: 'jpg' | 'png'): string {
  return ext === 'jpg' ? 'image/jpeg' : 'image/png';
}
