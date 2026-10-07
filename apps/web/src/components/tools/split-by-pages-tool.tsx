import { useState } from 'react';
import { FileArchive, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { type InspectOutput, type SplitByPagesOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

const MAX_PARTS = 200;

/** Split by pages: break the document into fixed-size chunks, shipped as a ZIP. */
export function SplitByPagesTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [chunkText, setChunkText] = useState('1');

  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const runner = useJobRunner<SplitByPagesOutput>('split-by-pages');
  const busy = inspectRunner.state.status === 'running' || runner.state.status === 'running';

  const chunk = Number.parseInt(chunkText, 10);
  const chunkValid = Number.isInteger(chunk) && chunk >= 1;
  const partCount = pageCount !== null && chunkValid ? Math.ceil(pageCount / chunk) : null;

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

    const outcome = await inspectRunner.run(await readAsInputFiles([file]));
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    const doc = outcome.result.documents[0];
    if (!doc) return;
    if (doc.encrypted) {
      toast.error('That PDF is password protected — unlock it first.');
      return;
    }
    setFiles([file]);
    setPageCount(doc.pageCount);
  };

  const runSplit = async () => {
    if (files.length === 0 || runner.state.status === 'running') return;
    if (!chunkValid) {
      toast.error('Enter a whole number of pages per file (1 or more).');
      return;
    }
    if (partCount !== null && partCount > MAX_PARTS) {
      toast.error(`That would create ${partCount} files (limit ${MAX_PARTS}). Use a larger chunk size.`);
      return;
    }

    const outcome = await runner.run(
      await readAsInputFiles(files),
      { chunkSize: chunk },
      { timeoutMs: 60_000 },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'split-by-pages',
      toolName: 'Split by pages',
      fileName: outcome.result.zipName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.zip.byteLength,
    });
  };

  if (runner.state.status === 'done') {
    const { result } = runner.state;
    return (
      <ResultPanel
        fileName={result.zipName}
        pageCount={result.pageCount}
        sizeBytes={result.zip.byteLength}
        downloadLabel="Download ZIP"
        onDownload={() => downloadBytes(result.zip, result.zipName, 'application/zip')}
        onReset={() => {
          runner.reset();
          setFiles([]);
          setPageCount(null);
          setChunkText('1');
        }}
        footerNote={`${result.parts.length} files in the archive: ${result.parts
          .slice(0, 4)
          .map((part) => part.name)
          .join(', ')}${result.parts.length > 4 ? ', …' : ''}`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => void handleFiles(next)}
        multiple={false}
        disabled={busy}
        hint="one PDF gets cut into chunks"
      />

      {inspectRunner.state.status === 'running' && (
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
                {partCount !== null && (
                  <>
                    {' '}·{' '}
                    {partCount > MAX_PARTS ? (
                      <span className="text-destructive">
                        {partCount} parts — over the {MAX_PARTS} limit, raise the chunk size
                      </span>
                    ) : (
                      <>will produce {partCount} file{partCount === 1 ? '' : 's'}</>
                    )}
                  </>
                )}
              </p>
            </div>
            <FileArchive className="h-5 w-5 shrink-0 text-primary" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="chunk-size">Pages per file</Label>
              <Input
                id="chunk-size"
                type="number"
                min={1}
                max={pageCount ?? 9999}
                value={chunkText}
                onChange={(event) => setChunkText(event.target.value)}
                aria-invalid={!chunkValid}
              />
              {!chunkValid && <p className="text-xs text-destructive">Enter 1 or more.</p>}
            </div>
            <div className="flex items-end">
              <p className="text-xs text-muted-foreground">
                1 = every page becomes its own PDF · 5 = five pages per file · leave-as-is chunks are
                joined by page order, bookmarks are not used.
              </p>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              size="lg"
              disabled={busy || !chunkValid || (partCount !== null && partCount > MAX_PARTS)}
              onClick={() => void runSplit()}
            >
              {runner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Splitting…
                </>
              ) : (
                <>Split into {partCount ?? '…'} file{partCount === 1 ? '' : 's'}</>
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
