import { useState } from 'react';
import { Columns2, Loader2, Rows2 } from 'lucide-react';
import { toast } from 'sonner';
import { type SplitHalfOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

type Orientation = 'vertical' | 'horizontal';

/** Split in half: cut every page down the middle into left/right or top/bottom. */
export function SplitHalfTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [orientation, setOrientation] = useState<Orientation>('vertical');

  const runner = useJobRunner<SplitHalfOutput>('split-in-half');
  const busy = runner.state.status === 'running';

  const handleFiles = (incoming: File[]) => {
    if (incoming.length === 0) {
      setFiles([]);
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
    setFiles([file]);
  };

  const runSplit = async () => {
    if (files.length === 0 || runner.state.status === 'running') return;
    const outcome = await runner.run(
      await readAsInputFiles(files),
      { orientation },
      { timeoutMs: 60_000 },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'split-in-half',
      toolName: 'Split in half',
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
        }}
        footerNote={`Two PDFs inside: ${result.parts.map((part) => part.name).join(' and ')}.`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone files={files} onFiles={handleFiles} multiple={false} disabled={busy} hint="one PDF to cut" />

      {files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{shortName(files[0]!.name)}</p>
              <p className="text-xs text-muted-foreground">Every page gets cut into two halves.</p>
            </div>
            <Columns2 className="h-5 w-5 shrink-0 text-primary" />
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">Cut direction</span>
            <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Cut direction">
              <button
                type="button"
                aria-pressed={orientation === 'vertical'}
                onClick={() => setOrientation('vertical')}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  orientation === 'vertical'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <Columns2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-medium">Vertical — left / right</span>
                  <span className="block text-xs text-muted-foreground">
                    Produces one PDF of left halves and one of right halves.
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-pressed={orientation === 'horizontal'}
                onClick={() => setOrientation('horizontal')}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  orientation === 'horizontal'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <Rows2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-medium">Horizontal — top / bottom</span>
                  <span className="block text-xs text-muted-foreground">
                    Produces one PDF of top halves and one of bottom halves.
                  </span>
                </span>
              </button>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button size="lg" disabled={busy} onClick={() => void runSplit()}>
              {runner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cutting…
                </>
              ) : (
                <>Split in half</>
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
