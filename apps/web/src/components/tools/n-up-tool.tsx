import { useState } from 'react';
import { Loader2, Rows2 } from 'lucide-react';
import { toast } from 'sonner';
import { type InspectOutput, type NUpJobOutput, type NupCount, type NupSheet } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
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

const N_OPTIONS: { value: NupCount; label: string; detail: string }[] = [
  { value: 2, label: '2-up', detail: '1 × 2 — readable at a glance' },
  { value: 4, label: '4-up', detail: '2 × 2 — the print standard' },
  { value: 8, label: '8-up', detail: '4 × 2 — compact overviews' },
];

const SHEET_OPTIONS: { value: NupSheet; label: string }[] = [
  { value: 'source', label: 'Match the page size' },
  { value: 'a4', label: 'A4 landscape' },
  { value: 'letter', label: 'US Letter landscape' },
];

/** N-up: imposition of 2/4/8 source pages onto each output sheet. */
export function NUpTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [n, setN] = useState<NupCount>(2);
  const [sheet, setSheet] = useState<NupSheet>('source');

  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const runner = useJobRunner<NUpJobOutput>('n-up');
  const busy = inspectRunner.state.status === 'running' || runner.state.status === 'running';

  const sheetCount = pageCount !== null ? Math.ceil(pageCount / n) : null;

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
    // Second capacity pass: the byte check above cannot see the page count, and
    // a 600-page document is exactly what the client page cap exists to refuse.
    const pageVerdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: file.size,
      pageCount: doc.pageCount,
    });
    if (!pageVerdict.ok) {
      toast.error(pageVerdict.message);
      return;
    }
    setFiles([file]);
    setPageCount(doc.pageCount);
  };

  const runImpose = async () => {
    if (files.length === 0 || runner.state.status === 'running') return;
    const outcome = await runner.run(
      await readAsInputFiles(files),
      { n, sheet },
      { timeoutMs: 60_000 },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'n-up',
      toolName: 'N-up',
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
          setPageCount(null);
          setN(2);
        }}
        footerNote={`${result.pageCount} sheet${result.pageCount === 1 ? '' : 's'}, ${n} source pages each.`}
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
        hint="one PDF gets imposed"
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
                {sheetCount !== null && (
                  <>
                    {' '}· {sheetCount} sheet{sheetCount === 1 ? '' : 's'} at {n}-up
                  </>
                )}
              </p>
            </div>
            <Rows2 className="h-5 w-5 shrink-0 text-primary" />
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Pages per sheet</span>
              <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Pages per sheet">
                {N_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={n === option.value}
                    onClick={() => setN(option.value)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      n === option.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">{option.detail}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sheet-size">Sheet size</Label>
              <Select value={sheet} onValueChange={(value) => setSheet(value as NupSheet)}>
                <SelectTrigger id="sheet-size" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHEET_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button size="lg" disabled={busy} onClick={() => void runImpose()}>
              {runner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Imposing…
                </>
              ) : (
                <>Make {sheetCount ?? '…'} sheet{sheetCount === 1 ? '' : 's'}</>
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
