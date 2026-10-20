import { useState } from 'react';
import { Layers, Loader2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { timeoutForPageCount, type FlattenJobOutput } from '@pdfshush/pdf-core';
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
 * Flatten PDF: bake form fields into page content so the document renders
 * identically everywhere and nothing is editable. Destructive by nature, so
 * the run card says exactly what is lost before the job happens.
 */
export function FlattenTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [ready, setReady] = useState(false);
  const runner = useJobRunner<FlattenJobOutput>('flatten');
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
      toolSlug: 'flatten-pdf',
      toolName: 'Flatten PDF',
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
          setReady(false);
        }}
        footerNote={
          result.fieldsFlattened > 0
            ? `${result.fieldsFlattened} form field${result.fieldsFlattened === 1 ? '' : 's'} baked into the pages. The result is no longer fillable — keep the original if you may need to edit it.`
            : 'No form fields were found; the document passed through unchanged in substance.'
        }
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
        hint="one PDF; form fields become fixed page content"
      />

      {ready && files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{shortName(files[0]!.name)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Fields, checkboxes and signatures become part of the page.
              </p>
            </div>
            <Layers className="h-5 w-5 shrink-0 text-primary" />
          </div>

          <div className="mt-4 flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">This cannot be undone.</strong> After flattening,
              the form is no longer fillable and field values cannot be recovered. Downloading keeps
              your original file on this device — nothing is uploaded either way.
            </p>
          </div>

          <div className="mt-4 flex items-center justify-end">
            <Button size="lg" disabled={running} onClick={() => void run()}>
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Flattening…
                </>
              ) : (
                <>
                  <Layers className="mr-2 h-4 w-4" /> Flatten PDF
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
