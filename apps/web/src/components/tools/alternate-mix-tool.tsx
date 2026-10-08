import { useState } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { timeoutForPageCount, type InspectOutput, type OrganizeJobOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, shortName, totalBytes } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

/**
 * Alternate & Mix: pages of file A and file B interleaved (A1, B1, A2, B2 …).
 * Pure page-order construction -- the engine call is the same Organize job.
 */
export function AlternateMixTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [counts, setCounts] = useState<number[]>([]);
  const [startWith, setStartWith] = useState<'first' | 'second'>('first');

  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const runner = useJobRunner<OrganizeJobOutput>('organize');
  const busy = inspectRunner.state.status === 'running' || runner.state.status === 'running';

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      setFiles([]);
      setCounts([]);
      return;
    }
    if (incoming.length > 2) {
      toast.error('Alternate & Mix takes exactly two PDFs — extra files were ignored.');
    }
    const picked = incoming.slice(0, 2);
    const verdict = checkClientCapacity({
      fileCount: picked.length,
      totalBytes: totalBytes(picked),
      largestFileBytes: largestBytes(picked),
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }

    const outcome = await inspectRunner.run(await readAsInputFiles(picked));
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    const docs = outcome.result.documents;
    if (docs.some((doc) => doc.encrypted)) {
      toast.error('One of those PDFs is password protected — unlock it first.');
      return;
    }
    // Second capacity pass: mixing copies every page of both files, so the cap has
    // to see the combined page count, not just the bytes.
    const pageVerdict = checkClientCapacity({
      fileCount: picked.length,
      totalBytes: totalBytes(picked),
      pageCount: docs.reduce((sum, doc) => sum + doc.pageCount, 0),
    });
    if (!pageVerdict.ok) {
      toast.error(pageVerdict.message);
      return;
    }
    setFiles(picked);
    setCounts(docs.map((doc) => doc.pageCount));
  };

  const [a, b] = files;
  const [countA = 0, countB = 0] = counts;
  const ready = Boolean(a && b && countA > 0 && countB > 0);

  const runMix = async () => {
    if (!ready || runner.state.status === 'running') return;

    const first = startWith === 'first' ? 0 : 1;
    const second = first === 0 ? 1 : 0;
    const firstCount = first === 0 ? countA : countB;
    const secondCount = second === 0 ? countA : countB;

    const pageOrder: { docIndex: number; pageIndex: number }[] = [];
    const rounds = Math.max(firstCount, secondCount);
    for (let i = 0; i < rounds; i += 1) {
      if (i < firstCount) pageOrder.push({ docIndex: first, pageIndex: i });
      if (i < secondCount) pageOrder.push({ docIndex: second, pageIndex: i });
    }

    const outcome = await runner.run(
      await readAsInputFiles(files),
      {
        pageOrder,
        outputName: `${(startWith === 'first' ? a! : b!).name.replace(/\.pdf$/i, '')}-mixed`,
      },
      { timeoutMs: timeoutForPageCount(pageOrder.length) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'alternate-mix',
      toolName: 'Alternate & Mix',
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
          setCounts([]);
        }}
      />
    );
  }

  const pattern = ready
    ? startWith === 'first'
      ? 'A1, B1, A2, B2, A3, …'
      : 'B1, A1, B2, A2, B3, …'
    : null;

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => void handleFiles(next)}
        disabled={busy}
        hint="exactly two PDFs to interleave"
      />

      {inspectRunner.state.status === 'running' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading documents…
        </p>
      )}

      {files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              {files.map((file, index) => (
                <p key={file.name + index} className="truncate text-sm">
                  <span className="font-semibold">{index === 0 ? 'A' : 'B'}</span>{' '}
                  <span className="text-muted-foreground">·</span> {shortName(file.name, 34)}
                  {counts[index] !== undefined && (
                    <span className="text-xs text-muted-foreground"> — {counts[index]} pages</span>
                  )}
                </p>
              ))}
            </div>
            <ArrowRightLeft className="h-5 w-5 shrink-0 text-primary" />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Start with</span>
              <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Mix order">
                {(['first', 'second'] as const).map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setStartWith(slot)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      startWith === slot
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {slot === 'first' ? 'File A' : 'File B'}
                  </button>
                ))}
              </div>
            </div>
            {pattern && (
              <p className="text-xs text-muted-foreground">
                Pattern: <span className="font-medium text-foreground">{pattern}</span>
                {countA !== countB && ' — the shorter file runs out and the longer one finishes alone.'}
              </p>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <Button size="lg" disabled={busy || !ready} onClick={() => void runMix()}>
              {runner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Mixing…
                </>
              ) : (
                <>Mix {ready ? countA + countB : '…'} pages</>
              )}
            </Button>
          </div>
          {!ready && files.length < 2 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Add a second PDF — mixing interleaves exactly two documents.
            </p>
          )}
        </div>
      )}

      {runner.state.status === 'running' && (
        <JobProgressPanel progress={runner.state.progress} onCancel={runner.cancel} />
      )}
    </div>
  );
}
