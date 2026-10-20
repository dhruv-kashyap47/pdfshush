import { useState } from 'react';
import { FileArchive, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { type SplitBySizeOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity, announceCapacityWarning } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

const MB = 1024 * 1024;
const MIN_TARGET_MB = 0.1;

/**
 * Split by Size: breaks a PDF into parts that each fit under a size budget —
 * the email-attachment workflow. The plan is estimated up-front from the file
 * size (so the preview is honest about being an estimate) and the real part
 * boundaries are measured after serialization.
 */
export function SplitBySizeTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [ready, setReady] = useState(false);
  const [targetMb, setTargetMb] = useState(10);
  const runner = useJobRunner<SplitBySizeOutput>('split-by-size');
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

  const targetBytes = () => Math.max(MIN_TARGET_MB * MB, Math.round(targetMb * MB));

  const roughParts = () => {
    if (files.length === 0 || targetMb <= 0) return null;
    const estimate = files[0]!.size / targetBytes();
    return estimate < 1 ? 1 : Math.ceil(estimate);
  };

  const run = async () => {
    if (files.length === 0 || running) return;
    if (targetMb < MIN_TARGET_MB) {
      toast.error(`Set a target of at least ${MIN_TARGET_MB} MB.`);
      return;
    }
    const outcome = await runner.run(await readAsInputFiles(files), {
      targetBytes: targetBytes(),
    });
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'split-by-size',
      toolName: 'Split by Size',
      fileName: outcome.result.zipName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.zip.byteLength,
    });
  };

  if (runner.state.status === 'done') {
    const { result } = runner.state;
    return (
      <div className="space-y-4">
        <ResultPanel
          fileName={result.zipName}
          pageCount={result.pageCount}
          sizeBytes={result.zip.byteLength}
          downloadLabel="Download parts (ZIP)"
          onDownload={() => downloadBytes(result.zip, result.zipName, 'application/zip')}
          onReset={() => {
            runner.reset();
            setFiles([]);
            setReady(false);
          }}
          footerNote={`${result.parts.length} part${result.parts.length === 1 ? '' : 's'}, measured after building — not estimated. Sizes can drift a little between parts; each one opens on its own.`}
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
                    </td>
                    <td className="px-3 py-1.5 text-right">{part.pageCount}</td>
                    <td className="px-3 py-1.5 text-right">{formatMb(part.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ResultPanel>
      </div>
    );
  }

  const preview = roughParts();

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => void handleFiles(next)}
        multiple={false}
        disabled={running}
        hint="one PDF, split to fit a size budget"
      />

      {ready && files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{shortName(files[0]!.name)}</p>
              <p className="text-xs text-muted-foreground">
                {formatMb(files[0]!.size)} total
                {preview !== null &&
                  ` · roughly ${preview} part${preview === 1 ? '' : 's'} at this budget`}
              </p>
            </div>
            <FileArchive className="h-5 w-5 shrink-0 text-primary" />
          </div>

          <div className="mt-4 max-w-xs space-y-1.5">
            <Label htmlFor="split-size-target">Target size per part (MB)</Label>
            <Input
              id="split-size-target"
              type="number"
              min={MIN_TARGET_MB}
              step={0.5}
              value={targetMb}
              disabled={running}
              onChange={(event) => {
                const next = Number.parseFloat(event.target.value);
                setTargetMb(Number.isFinite(next) ? next : 10);
              }}
              className="tabular-nums"
            />
            <p className="text-xs text-muted-foreground">
              25 MB is the classic email cap; 2 MB fits most web forms.
            </p>
          </div>

          <div className="mt-4 flex items-center justify-end">
            <Button size="lg" disabled={running} onClick={() => void run()}>
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Splitting…
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

function formatMb(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
