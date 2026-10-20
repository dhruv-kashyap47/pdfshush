import { useState } from 'react';
import { Contrast, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  LIMITS,
  timeoutForPageCount,
  type GrayscaleJobOutput,
  type InspectOutput,
} from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity, announceCapacityWarning } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

/**
 * Grayscale PDF: every page is rasterized, converted to luma, and rebuilt.
 * That makes this tool honest about what it produces (flat page images, like
 * secure redaction), so the pre-run card says it before the job, not after.
 */
export function GrayscaleTool() {
  const [file, setFile] = useState<File | null>(null);
  const [inspect, setInspect] = useState<InspectOutput['documents'][number] | null>(null);
  const [holdingOriginal, setHoldingOriginal] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const runner = useJobRunner<GrayscaleJobOutput>('grayscale');

  const running = inspectRunner.state.status === 'running' || runner.state.status === 'running';
  const overCap = inspect !== null && inspect.pageCount > LIMITS.tool.maxRedactPages;

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      setFile(null);
      setInspect(null);
      setHoldingOriginal(false);
      setShowPreview(false);
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
    setFile(candidate);
    setHoldingOriginal(true);
    setShowPreview(true);
    setInspect(null);

    const outcome = await inspectRunner.run(await readAsInputFiles([candidate]));
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    const doc = outcome.result.documents[0];
    if (!doc) return;
    setInspect(doc);
    const pageVerdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: candidate.size,
      pageCount: doc.pageCount,
    });
    if (!pageVerdict.ok) {
      toast.error(pageVerdict.message);
    }
  };

  const run = async () => {
    if (!file || running || overCap) return;
    const outcome = await runner.run(
      await readAsInputFiles([file]),
      undefined,
      { timeoutMs: timeoutForPageCount(inspect?.pageCount ?? 60) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'grayscale-pdf',
      toolName: 'Grayscale PDF',
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
          setFile(null);
          setInspect(null);
          setHoldingOriginal(false);
          setShowPreview(false);
        }}
        footerNote={`${result.pageCount} page${result.pageCount === 1 ? '' : 's'} rebuilt in black and white. Keep the colour original: text in this copy is part of the page image.`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={file ? [file] : []}
        onFiles={(next) => void handleFiles(next)}
        multiple={false}
        disabled={running}
        hint="one PDF"
      />

      {inspectRunner.state.status === 'running' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading document…
        </p>
      )}

      {file && holdingOriginal && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Colour original
            </p>
            <div className="mx-auto flex aspect-[3/4] w-full max-w-[260px] items-center justify-center rounded-lg border border-border bg-muted">
              <div className="grid w-32 grid-cols-3 gap-1 p-3">
                {['bg-red-400', 'bg-green-400', 'bg-blue-500', 'bg-amber-400', 'bg-violet-400', 'bg-pink-400'].map(
                  (swatch) => (
                    <span key={swatch} className={`aspect-square rounded ${swatch}`} />
                  ),
                )}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Grayscale result
            </p>
            <div className="mx-auto flex aspect-[3/4] w-full max-w-[260px] items-center justify-center rounded-lg border border-border bg-muted">
              <div
                className={`grid w-32 grid-cols-3 gap-1 p-3 transition-[filter] duration-300 ${
                  showPreview ? 'grayscale' : ''
                }`}
              >
                {['bg-red-400', 'bg-green-400', 'bg-blue-500', 'bg-amber-400', 'bg-violet-400', 'bg-pink-400'].map(
                  (swatch) => (
                    <span key={swatch} className={`aspect-square rounded ${swatch}`} />
                  ),
                )}
              </div>
            </div>
          </div>

          {overCap && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm sm:col-span-2">
              <strong className="block">{inspect!.pageCount.toLocaleString()} pages</strong>
              <span className="text-muted-foreground">
                Grayscale rebuilds each page as an image, and the engine caps rasterized rebuilds at{' '}
                {LIMITS.tool.maxRedactPages} pages (the same gate secure redaction uses). Split the
                document first and convert the halves.
              </span>
            </div>
          )}

          <div className="space-y-3 sm:col-span-2">
            <p className="text-sm text-muted-foreground">
              This tool works like secure redaction: pages are rasterized, reduced to luma, and
              saved back as JPEG. Expect{' '}
              <strong className="text-foreground">bigger files and non-selectable text</strong> — for
              print or e-signing scans it is exactly what you want; for archival PDFs, wait for the
              vector-preserving upgrade.
            </p>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{shortName(file.name)}</p>
                <p className="text-xs text-muted-foreground">
                  {inspect ? inspect.pageCount.toLocaleString() : '…'} pages
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPreview((value) => !value)}
                  aria-pressed={showPreview}
                >
                  <Contrast className="mr-1.5 h-3.5 w-3.5" />
                  {showPreview ? 'Hide preview' : 'Preview'}
                </Button>
                <Button size="lg" disabled={running || overCap} onClick={() => void run()}>
                  {runner.state.status === 'running' ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Converting…
                    </>
                  ) : (
                    <>
                      <Contrast className="mr-2 h-4 w-4" /> Convert to grayscale
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {runner.state.status === 'running' && !inspectRunner.state.status.startsWith('running') && (
        <JobProgressPanel progress={runner.state.progress} onCancel={runner.cancel} />
      )}
    </div>
  );
}
