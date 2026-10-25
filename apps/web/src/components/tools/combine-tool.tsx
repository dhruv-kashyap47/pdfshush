import { useState } from 'react';
import { ArrowDown, ArrowUp, FileImage, FileText, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  LIMITS,
  type CombineJobOutput,
  type ImageOrientation,
  type ImagePageSize,
} from '@pdfshush/pdf-core';
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
import { announceCapacityWarning, checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { formatBytes } from '@/lib/format';
import { isPdfLike, largestBytes, readAsInputFiles, shortName, totalBytes } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
const IMAGE_EXT = /\.(jpe?g|png)$/i;
/** Mirrors `MAX_IMAGE_MARGIN_PT` without importing the pdf-lib-backed module. */
const MAX_IMAGE_MARGIN_PT = 72;

function isSupported(file: File): boolean {
  return isPdfLike(file) || IMAGE_TYPES.has(file.type) || IMAGE_EXT.test(file.name);
}

function kindOf(file: File): 'pdf' | 'image' {
  return isPdfLike(file) ? 'pdf' : 'image';
}

/**
 * Combine: PDFs and images in one ordered document.
 *
 * The order is the whole point, so the list is explicit and movable rather
 * than "whatever the picker returned". Office formats are refused up front:
 * they need a converter, and silently skipping them would drop pages the user
 * selected.
 */
export function CombineFilesTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [pageSize, setPageSize] = useState<ImagePageSize>('a4');
  const [orientation, setOrientation] = useState<ImageOrientation>('auto');
  const [margin, setMargin] = useState(24);
  const runner = useJobRunner<CombineJobOutput>('combine');
  const running = runner.state.status === 'running';

  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) {
      setFiles([]);
      return;
    }
    const supported = incoming.filter(isSupported);
    if (supported.length < incoming.length) {
      toast.error('Only PDFs, JPEGs and PNGs can be combined.');
    }
    if (supported.length === 0) return;

    // `FileDropzone` already merged the pick into the current list, so the
    // incoming array *is* the desired order. Appending again here would list
    // every file twice after "Add more".
    const next = supported;
    if (next.length > LIMITS.tool.maxCombineFiles) {
      toast.error(`At most ${LIMITS.tool.maxCombineFiles} files fit in one document.`);
      return;
    }
    const verdict = checkClientCapacity({
      fileCount: next.length,
      totalBytes: totalBytes(next),
      largestFileBytes: largestBytes(next),
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    announceCapacityWarning(verdict);
    setFiles(next);
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= files.length) return;
    const next = [...files];
    const [item] = next.splice(index, 1);
    if (item) next.splice(target, 0, item);
    setFiles(next);
  };

  const remove = (index: number) => setFiles(files.filter((_, i) => i !== index));

  const run = async () => {
    if (files.length === 0 || running) return;
    const outcome = await runner.run(await readAsInputFiles(files), {
      pageSize,
      orientation,
      margin,
    });
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'combine-pdf',
      toolName: 'Combine files',
      fileName: outcome.result.fileName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  };

  if (runner.state.status === 'done') {
    const { result } = runner.state;
    const pdfCount = result.parts.filter((part) => part.kind === 'pdf').length;
    const imageCount = result.parts.length - pdfCount;
    return (
      <ResultPanel
        fileName={result.fileName}
        pageCount={result.pageCount}
        sizeBytes={result.data.byteLength}
        onDownload={() => downloadBytes(result.data, result.fileName)}
        onReset={() => {
          runner.reset();
          setFiles([]);
        }}
        footerNote={`${pdfCount} PDF${pdfCount === 1 ? '' : 's'} and ${imageCount} image${
          imageCount === 1 ? '' : 's'
        } in the order you chose.`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={addFiles}
        multiple
        disabled={running}
        accept=".pdf,application/pdf,image/jpeg,image/png"
        accepts={isSupported}
        kind="PDF or image"
        hint="PDFs and JPEG/PNG images, in the order listed below"
      />

      {files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <ul className="space-y-2" data-testid="combine-list">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  {kindOf(file) === 'pdf' ? (
                    <FileText className="h-4 w-4" />
                  ) : (
                    <FileImage className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {index + 1}. {shortName(file.name, 38)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {kindOf(file) === 'pdf' ? 'PDF' : 'Image'} · {formatBytes(file.size)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Move up"
                    disabled={running || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Move down"
                    disabled={running || index === files.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Remove"
                    disabled={running}
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="combine-size">Image page size</Label>
              <Select
                value={pageSize}
                disabled={running}
                onValueChange={(value) => setPageSize(value as ImagePageSize)}
              >
                <SelectTrigger id="combine-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a4">A4</SelectItem>
                  <SelectItem value="letter">Letter</SelectItem>
                  <SelectItem value="image">Image&apos;s own size</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="combine-orientation">Orientation</Label>
              <Select
                value={orientation}
                disabled={running || pageSize === 'image'}
                onValueChange={(value) => setOrientation(value as ImageOrientation)}
              >
                <SelectTrigger id="combine-orientation">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="portrait">Portrait</SelectItem>
                  <SelectItem value="landscape">Landscape</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="combine-margin">Image margin (pt)</Label>
              <input
                id="combine-margin"
                type="number"
                min={0}
                max={MAX_IMAGE_MARGIN_PT}
                value={margin}
                disabled={running || pageSize === 'image'}
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10);
                  setMargin(
                    Number.isFinite(next)
                      ? Math.min(MAX_IMAGE_MARGIN_PT, Math.max(0, next))
                      : 24,
                  );
                }}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm tabular-nums shadow-sm"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {files.length} file{files.length === 1 ? '' : 's'} ·{' '}
              {formatBytes(files.reduce((sum, file) => sum + file.size, 0))}
            </p>
            <Button size="lg" disabled={running} onClick={() => void run()} data-testid="combine-run">
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Combining…
                </>
              ) : (
                'Combine into one PDF'
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
