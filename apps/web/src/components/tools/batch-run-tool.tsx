import { useEffect, useRef, useState } from 'react';
import { Archive, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { JobInputFile, ZipJobOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
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
import { formatBytes } from '@/lib/format';
import { jobPool } from '@/lib/job-pool';
import { announceCapacityWarning, checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, totalBytes } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

type BatchOp = 'compress' | 'grayscale' | 'flatten' | 'remove-annotations' | 'flip' | 'repair';

const OPERATIONS: { id: BatchOp; label: string; slug: string; hint: string }[] = [
  { id: 'compress', label: 'Compress', slug: 'compress', hint: 'Repack, or rasterize for a smaller file' },
  { id: 'grayscale', label: 'Grayscale', slug: 'grayscale', hint: 'Rebuild pages in black and white' },
  { id: 'flatten', label: 'Flatten forms', slug: 'flatten', hint: 'Bake fields and annotations into the page' },
  { id: 'remove-annotations', label: 'Remove annotations', slug: 'remove-annotations', hint: 'Strip comments, highlights and ink' },
  { id: 'flip', label: 'Flip horizontally', slug: 'flip', hint: 'Mirror every page across the vertical axis' },
  { id: 'repair', label: 'Repair structure', slug: 'repair', hint: 'Rebuild the cross-reference table' },
];

interface PdfResult {
  data: ArrayBuffer;
  fileName: string;
  pageCount: number;
}

interface BatchResult {
  zip: ArrayBuffer;
  zipName: string;
  sizeBytes: number;
  count: number;
}

/**
 * Batch run: one operation, many files, one archive.
 *
 * Runs sequentially through the same bounded pool every other tool uses --
 * launching five raster compressions at once is how a tab runs out of heap.
 * A file that fails is named and skipped rather than aborting the batch, and
 * the archive is built in the worker so `fflate` stays out of the app bundle.
 */
export function BatchRunTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [op, setOp] = useState<BatchOp>('compress');
  const [strongCompress, setStrongCompress] = useState(false);
  const [running, setRunning] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [ratio, setRatio] = useState(0);
  const [failures, setFailures] = useState<string[]>([]);
  const [result, setResult] = useState<BatchResult | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) {
      setFiles([]);
      return;
    }
    // `FileDropzone` hands us the complete desired list (it merges picks into
    // its `files` prop and calls `onFiles([])` to clear), so this must not
    // append again -- doing so doubled every file added with "Add more".
    const verdict = checkClientCapacity({
      fileCount: incoming.length,
      totalBytes: totalBytes(incoming),
      largestFileBytes: largestBytes(incoming),
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    announceCapacityWarning(verdict);
    setFiles(incoming);
    setResult(null);
    setFailures([]);
  };

  const optionsFor = (): Record<string, unknown> => {
    if (op === 'compress') return { mode: strongCompress ? 'raster' : 'lossless' };
    if (op === 'flip') return { horizontal: true };
    return {};
  };

  const run = async () => {
    if (files.length === 0 || running) return;
    const operation = OPERATIONS.find((entry) => entry.id === op);
    if (!operation) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setFailures([]);
    setResult(null);
    setRatio(0);

    const collected: { name: string; data: ArrayBuffer; sizeBytes: number }[] = [];
    const problems: string[] = [];

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]!;
        if (controller.signal.aborted) return;
        setLabel(`${operation.label} · ${index + 1} of ${files.length}`);

        const inputs: JobInputFile[] = await readAsInputFiles([file]);
        try {
          const output = await jobPool.run<PdfResult>(operation.slug, inputs, optionsFor(), {
            signal: controller.signal,
            onProgress: (progress) => {
              const within = progress.ratio ?? 0;
              setRatio((index + within) / (files.length + 1));
            },
          });
          collected.push({
            name: output.fileName,
            data: output.data,
            sizeBytes: output.data.byteLength,
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          problems.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
        setRatio((index + 1) / (files.length + 1));
      }

      setFailures(problems);
      if (collected.length === 0) {
        toast.error('Every file failed. Nothing was written.');
        return;
      }

      setLabel('Packing the results');
      const zip = await jobPool.run<ZipJobOutput>(
        'zip',
        collected.map((entry) => ({ name: entry.name, type: 'application/pdf', data: new Uint8Array(entry.data) })),
        { zipName: `${operation.id}-batch`, fallbackName: 'pdfshush-batch' },
        { signal: controller.signal },
      );
      setRatio(1);
      setResult({
        zip: zip.zip,
        zipName: zip.zipName,
        sizeBytes: zip.zip.byteLength,
        count: zip.entries.length,
      });
      void recordRecent({
        toolSlug: 'batch-run',
        toolName: 'Batch run',
        fileName: zip.zipName,
        pageCount: 0,
        sizeBytes: zip.zip.byteLength,
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(error instanceof Error ? error.message : 'The batch failed.');
      }
    } finally {
      setRunning(false);
      setLabel(null);
      setRatio(0);
    }
  };

  if (result) {
    return (
      <ResultPanel
        fileName={result.zipName}
        sizeBytes={result.sizeBytes}
        onDownload={() => downloadBytes(result.zip, result.zipName)}
        onReset={() => {
          setResult(null);
          setFiles([]);
          setFailures([]);
        }}
        footerNote={`${result.count} file${result.count === 1 ? '' : 's'} packed into one archive.`}
      >
        <p className="text-sm text-muted-foreground">
          The archive holds one output per successful input, named after the operation that
          produced it.
        </p>
        {failures.length > 0 && <FailureList failures={failures} />}
      </ResultPanel>
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={addFiles}
        multiple
        disabled={running}
        hint="one operation is applied to every PDF in the list"
      />

      {files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="batch-op">Operation</Label>
              <Select value={op} disabled={running} onValueChange={(value) => setOp(value as BatchOp)}>
                <SelectTrigger id="batch-op">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATIONS.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {OPERATIONS.find((entry) => entry.id === op)?.hint}
              </p>
            </div>

            {op === 'compress' ? (
              <div className="space-y-1.5">
                <Label htmlFor="batch-mode">Compression</Label>
                <select
                  id="batch-mode"
                  value={strongCompress ? 'raster' : 'lossless'}
                  disabled={running}
                  onChange={(event) => setStrongCompress(event.target.value === 'raster')}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="lossless">Repack only (keeps text and vectors)</option>
                  <option value="raster">Strong (rasterizes every page)</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  Strong compression trades text selection for a smaller file.
                </p>
              </div>
            ) : (
              <div className="flex items-end">
                <p className="text-xs text-muted-foreground">
                  {files.length} file{files.length === 1 ? '' : 's'} ·{' '}
                  {formatBytes(files.reduce((sum, file) => sum + file.size, 0))} total
                </p>
              </div>
            )}
          </div>

          {running && (
            <div className="mt-4 space-y-2" data-testid="batch-progress">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{label}</span>
                <span>{Math.round(ratio * 100)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${Math.max(2, ratio * 100)}%` }}
                />
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Archive className="h-3.5 w-3.5" />
              Results are packed into one ZIP.
            </p>
            <div className="flex items-center gap-2">
              {running && (
                <Button variant="outline" onClick={() => controllerRef.current?.abort()}>
                  Cancel
                </Button>
              )}
              <Button size="lg" disabled={running} onClick={() => void run()} data-testid="batch-run">
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running…
                  </>
                ) : (
                  `Run on ${files.length} file${files.length === 1 ? '' : 's'}`
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {failures.length > 0 && !running && <FailureList failures={failures} />}
    </div>
  );
}

function FailureList({ failures }: { failures: string[] }) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" data-testid="batch-failures">
      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <XCircle className="h-3.5 w-3.5" />
        {failures.length} file{failures.length === 1 ? '' : 's'} could not be processed
      </p>
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
        {failures.map((failure) => (
          <li key={failure} className="truncate">
            {failure}
          </li>
        ))}
      </ul>
    </div>
  );
}
