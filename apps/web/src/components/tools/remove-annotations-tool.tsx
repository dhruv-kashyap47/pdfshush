import { useState } from 'react';
import { Eraser, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { timeoutForPageCount, type AnnotationsJobOutput } from '@pdfshush/pdf-core';
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
 * Remove Annotations: one pass, one file, no options to get wrong. The count
 * comes back from the job so the result says what actually happened.
 */
export function RemoveAnnotationsTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [ready, setReady] = useState(false);
  const runner = useJobRunner<AnnotationsJobOutput>('remove-annotations');
  const running = runner.state.status === 'running';

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
    void recordRecent({
      toolSlug: 'remove-annotations',
      toolName: 'Remove Annotations',
      fileName: outcome.result.fileName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  };

  if (runner.state.status === 'done') {
    const { result } = runner.state;
    return (
      <div className="space-y-4">
        <ResultPanel
          fileName={result.fileName}
          pageCount={result.pageCount}
          sizeBytes={result.data.byteLength}
          onDownload={() => downloadBytes(result.data, result.fileName)}
          onReset={() => {
            runner.reset();
            setFiles([]);
            setReady(false);
          }}
          footerNote={
            result.removed === 0
              ? 'No annotations were found — nothing needed removing.'
              : `${result.removed} annotation${result.removed === 1 ? '' : 's'} removed across ${result.pages} page${result.pages === 1 ? '' : 's'}. Form fields were kept so the document stays fillable.`
          }
        />
        {result.removed > 0 && (
          <Button asChild variant="outline" className="w-full">
            <a href="/tools/flatten-pdf">Flatten form fields too</a>
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
      />

      {ready && files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{shortName(files[0]!.name)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Strips comments, highlights, ink and links. Page content and form fields are
                untouched.
              </p>
            </div>
            <Button size="lg" disabled={running} onClick={() => void run()}>
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Removing…
                </>
              ) : (
                <>
                  <Eraser className="mr-2 h-4 w-4" /> Remove annotations
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
