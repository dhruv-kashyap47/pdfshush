import { useState } from 'react';
import { FileOutput, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  parsePageRanges,
  timeoutForPageCount,
  type InspectOutput,
  type OrganizeJobOutput,
} from '@pdfshush/pdf-core';
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

type RangeResult = { ok: true; indexes: number[] } | { ok: false; error: string };

/** Pure range parser -- never sets state, safe during render. */
function parseRange(text: string, total: number | null): RangeResult {
  if (total === null) return { ok: false, error: 'Select a file first' };
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, indexes: Array.from({ length: total }, (_, i) => i) };
  try {
    const indexes = parsePageRanges(trimmed, total);
    if (indexes.length === 0) return { ok: false, error: 'That range matches no pages.' };
    return { ok: true, indexes };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Cannot read that range.' };
  }
}

/** Extract Pages: pick a range, get one new PDF containing just those pages. */
export function ExtractPagesTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [rangeText, setRangeText] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);

  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const runner = useJobRunner<OrganizeJobOutput>('organize');
  const busy = inspectRunner.state.status === 'running' || runner.state.status === 'running';

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

    setRangeError(null);
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

  const runExtract = async () => {
    if (files.length === 0 || runner.state.status === 'running' || pageCount === null) return;
    const range = parseRange(rangeText, pageCount);
    if (!range.ok) {
      setRangeError(range.error);
      return;
    }
    setRangeError(null);

    const outcome = await runner.run(
      await readAsInputFiles(files),
      {
        pageOrder: range.indexes.map((pageIndex) => ({ docIndex: 0, pageIndex })),
        outputName: `${files[0]!.name.replace(/\.pdf$/i, '')}-extracted`,
      },
      { timeoutMs: timeoutForPageCount(range.indexes.length) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'extract-pages',
      toolName: 'Extract Pages',
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
          setRangeText('');
        }}
      />
    );
  }

  const liveRange = parseRange(rangeText, pageCount);
  const outputCount = pageCount === null ? 0 : liveRange.ok ? liveRange.indexes.length : null;

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => void handleFiles(next)}
        multiple={false}
        disabled={busy}
        hint="the pages come out of this file"
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
                {outputCount !== null && (
                  <>
                    {' '}· will extract {outputCount} page{outputCount === 1 ? '' : 's'}
                  </>
                )}
              </p>
            </div>
            <FileOutput className="h-5 w-5 shrink-0 text-primary" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="extract-range">Pages to extract</Label>
            <Input
              id="extract-range"
              placeholder={`e.g. 1-3, 7 — or leave empty for all ${pageCount}`}
              value={rangeText}
              onChange={(event) => {
                setRangeText(event.target.value);
                setRangeError(null);
              }}
              aria-invalid={rangeError !== null}
            />
            {rangeError && <p className="text-xs text-destructive">{rangeError}</p>}
          </div>

          <div className="mt-4 flex justify-end">
            <Button size="lg" disabled={busy} onClick={() => void runExtract()}>
              {runner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Extracting…
                </>
              ) : (
                <>Extract {outputCount ?? '…'} page{outputCount === 1 ? '' : 's'}</>
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
