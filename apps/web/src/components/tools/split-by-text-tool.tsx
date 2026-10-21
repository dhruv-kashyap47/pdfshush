import { useState } from 'react';
import { Loader2, Scissors } from 'lucide-react';
import { toast } from 'sonner';
import type { SplitByTextOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useJobRunner } from '@/hooks/use-job-runner';
import { announceCapacityWarning, checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { formatBytes } from '@/lib/format';
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

/**
 * Split by text: each page where the marker appears becomes the first page of a
 * new file. Useful for statements and case files where every section begins
 * with the same line. Matching runs on extracted text, so the marker must be
 * real text -- a scanned page has none until it is OCR'd.
 */
export function SplitByTextTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [needle, setNeedle] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const runner = useJobRunner<SplitByTextOutput>('split-by-text');
  const running = runner.state.status === 'running';

  const handleFiles = (incoming: File[]) => {
    if (incoming.length === 0) {
      setFiles([]);
      return;
    }
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: incoming[0]!.size,
      largestFileBytes: largestBytes([incoming[0]!]),
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    announceCapacityWarning(verdict);
    setFiles([incoming[0]!]);
  };

  const run = async () => {
    if (files.length === 0 || running) return;
    if (needle.trim().length === 0) {
      toast.error('Type the text that starts each new part.');
      return;
    }
    const outcome = await runner.run(await readAsInputFiles(files), {
      needle: needle.trim(),
      caseSensitive,
    });
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'split-by-text',
      toolName: 'Split by text',
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
        downloadLabel="Download parts (ZIP)"
        onDownload={() => downloadBytes(result.zip, result.zipName, 'application/zip')}
        onReset={() => {
          runner.reset();
          setFiles([]);
          setNeedle('');
          setCaseSensitive(false);
        }}
        footerNote={`${result.parts.length} parts. Matched text on page${result.matchedPages.length === 1 ? '' : 's'} ${result.matchedPages.join(', ')}.`}
      >
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Part</th>
                <th className="px-3 py-2 text-right font-medium">Pages</th>
                <th className="px-3 py-2 text-right font-medium">Size</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {result.parts.map((part) => (
                <tr key={part.name} className="border-b border-border/60 last:border-0">
                  <td className="max-w-[16rem] truncate px-3 py-1.5" title={part.name}>
                    {part.name}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      p{part.startPage}–{part.endPage}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right">{part.pageCount}</td>
                  <td className="px-3 py-1.5 text-right">{formatBytes(part.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ResultPanel>
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={handleFiles}
        multiple={false}
        disabled={running}
        hint="one PDF with real, selectable text"
      />

      {files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_15rem]">
            <div>
              <div className="space-y-1.5">
                <Label htmlFor="split-text-needle">Text that starts a new part</Label>
                <Input
                  id="split-text-needle"
                  value={needle}
                  disabled={running}
                  maxLength={120}
                  placeholder="e.g. Statement of Account"
                  onChange={(event) => setNeedle(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  A page containing this text begins a new file. Page 1 always starts the first part.
                </p>
              </div>

              <div className="mt-4 flex items-center gap-2.5">
                <Switch
                  id="split-text-case"
                  checked={caseSensitive}
                  disabled={running}
                  onCheckedChange={setCaseSensitive}
                />
                <Label htmlFor="split-text-case" className="cursor-pointer text-sm font-normal">
                  Match case
                </Label>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">How matching works</p>
              <p>The match page opens its new part, so the marker line stays with its section.</p>
              <p>Every page that starts with the same line becomes its own part — the statement case.</p>
              <p>Only real text is searched; scanned pages need OCR first.</p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Scissors className="h-3.5 w-3.5" />
              {shortName(files[0]!.name, 34)}
            </p>
            <Button size="lg" disabled={running || needle.trim().length === 0} onClick={() => void run()}>
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading pages…
                </>
              ) : (
                <>Split PDF</>
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
