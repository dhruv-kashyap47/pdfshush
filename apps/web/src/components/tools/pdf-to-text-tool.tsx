import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { timeoutForPageCount, type TextJobOutput } from '@pdfshush/pdf-core';
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
 * PDF to Text: extracts the page text into one .txt, with a reading preview in
 * the result panel. Same reading order as the editor's click-to-edit lines.
 */
export function PdfToTextTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [ready, setReady] = useState(false);
  const runner = useJobRunner<TextJobOutput>('pdf-to-text');
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
      { timeoutMs: timeoutForPageCount(150) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'pdf-to-text',
      toolName: 'PDF to Text',
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
          downloadLabel="Download .txt"
          onDownload={() => downloadBytes(result.data, result.fileName, 'text/plain')}
          onReset={() => {
            runner.reset();
            setFiles([]);
            setReady(false);
          }}
          footerNote={`${result.charCount.toLocaleString()} characters from ${result.pageCount} page${result.pageCount === 1 ? '' : 's'}. Scanned pages come out empty: there is no OCR layer.`}
        >
          {result.text.trim().length > 0 ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-4 text-sm leading-relaxed">
              {result.text}
            </pre>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
              No embedded text was found on these pages — the PDF is likely a scan. The{' '}
              <a className="underline underline-offset-2" href="/tools/ocr-pdf">
                OCR tool
              </a>{' '}
              is the one that unlocks that.
            </div>
          )}
        </ResultPanel>
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
        hint="one PDF → one .txt"
      />

      {ready && files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{shortName(files[0]!.name)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                One line per visual text line, blank line between pages.
              </p>
            </div>
            <Button size="lg" disabled={running} onClick={() => void run()}>
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Extracting…
                </>
              ) : (
                <>
                  <FileText className="mr-2 h-4 w-4" /> Extract text
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
