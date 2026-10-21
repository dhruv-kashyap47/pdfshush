import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, FileImage, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import type {
  ImageOrientation,
  ImagePageSize,
  JpgToPdfJobOutput,
} from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { largestBytes, readAsInputFiles, shortName, totalBytes } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

const PAGE_SIZES: { value: ImagePageSize; label: string }[] = [
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'US Letter' },
  { value: 'image', label: 'Same as the image' },
];

const ORIENTATIONS: { value: ImageOrientation; label: string }[] = [
  { value: 'auto', label: 'Follow the image' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

interface ImageEntry {
  id: string;
  file: File;
  preview: string;
}

const IMAGE_ACCEPT = '.jpg,.jpeg,.png,image/jpeg,image/png';

function isImageFile(file: File): boolean {
  return /^image\/(jpeg|png)$/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name);
}

/**
 * JPG to PDF: one page per photo, in the order shown. JPEG and PNG bytes are
 * embedded as they are (no re-compression), so the size estimate in the list is
 * the size that ships.
 */
export function JpgToPdfTool() {
  const [entries, setEntries] = useState<ImageEntry[]>([]);
  const [pageSize, setPageSize] = useState<ImagePageSize>('a4');
  const [orientation, setOrientation] = useState<ImageOrientation>('auto');
  const [margin, setMargin] = useState(24);
  const runner = useJobRunner<JpgToPdfJobOutput>('jpg-to-pdf');
  const running = runner.state.status === 'running';

  // Object URLs are created once per file and revoked on every exit path: a
  // batch of 60 phone photos otherwise pins 60 decoded blobs for the session.
  const urls = useRef(new Set<string>());
  const entriesRef = useRef<ImageEntry[]>([]);
  useEffect(() => {
    const live = urls.current;
    return () => {
      for (const url of live) URL.revokeObjectURL(url);
      live.clear();
    };
  }, []);

  /** Keeps the ref and state in step, outside any state updater (StrictMode
   *  invokes updaters twice, and creating/revoking URLs there leaks). */
  const commit = (next: ImageEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
  };

  const release = (preview: string) => {
    URL.revokeObjectURL(preview);
    urls.current.delete(preview);
  };

  const handleFiles = (incoming: File[]) => {
    if (incoming.length === 0) {
      clearAll();
      return;
    }
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

    // The dropzone hands back the whole selection, so keep existing previews
    // (and their object URLs) for files that were already in the list.
    const prev = entriesRef.current;
    const existing = new Map(prev.map((entry) => [entry.file, entry]));
    const next = incoming.map((file) => {
      const kept = existing.get(file);
      if (kept) return kept;
      const preview = URL.createObjectURL(file);
      urls.current.add(preview);
      return { id: crypto.randomUUID(), file, preview };
    });
    for (const entry of prev) {
      if (!next.includes(entry)) release(entry.preview);
    }
    commit(next);
  };

  const removeEntry = (id: string) => {
    const entry = entriesRef.current.find((item) => item.id === id);
    if (entry) release(entry.preview);
    commit(entriesRef.current.filter((item) => item.id !== id));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    const current = entriesRef.current;
    if (target < 0 || target >= current.length) return;
    const copy = [...current];
    const [entry] = copy.splice(index, 1);
    copy.splice(target, 0, entry!);
    commit(copy);
  };

  const clearAll = () => {
    for (const entry of entriesRef.current) release(entry.preview);
    commit([]);
  };

  const run = async () => {
    if (entries.length === 0 || running) return;
    const verdict = checkClientCapacity({
      fileCount: entries.length,
      totalBytes: totalBytes(entries.map((entry) => entry.file)),
      pageCount: entries.length,
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    const outcome = await runner.run(await readAsInputFiles(entries.map((entry) => entry.file)), {
      pageSize,
      orientation,
      margin: pageSize === 'image' ? 0 : margin,
    });
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'jpg-to-pdf',
      toolName: 'JPG to PDF',
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
          clearAll();
        }}
        footerNote={`${result.pageCount} image${result.pageCount === 1 ? '' : 's'} placed one per page. The photos were embedded, not re-compressed.`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={entries.map((entry) => entry.file)}
        onFiles={handleFiles}
        accept={IMAGE_ACCEPT}
        accepts={isImageFile}
        kind="image"
        disabled={running}
        hint="JPEG and PNG, in the order shown"
      />

      {entries.length > 0 && (
        <>
          <ul className="space-y-2" data-testid="image-list">
            {entries.map((entry, index) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
              >
                <span className="w-6 text-center text-xs tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <img
                  src={entry.preview}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded border border-border object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{shortName(entry.file.name, 52)}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(entry.file.size)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Move ${entry.file.name} up`}
                    disabled={running || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Move ${entry.file.name} down`}
                    disabled={running || index === entries.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Remove ${entry.file.name}`}
                    disabled={running}
                    onClick={() => removeEntry(entry.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="jpg-page-size">Page size</Label>
                <Select
                  value={pageSize}
                  disabled={running}
                  onValueChange={(value) => setPageSize(value as ImagePageSize)}
                >
                  <SelectTrigger id="jpg-page-size" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="jpg-orientation">Orientation</Label>
                <Select
                  value={orientation}
                  disabled={running || pageSize === 'image'}
                  onValueChange={(value) => setOrientation(value as ImageOrientation)}
                >
                  <SelectTrigger id="jpg-orientation" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORIENTATIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="jpg-margin">Margin (pt)</Label>
                <Input
                  id="jpg-margin"
                  type="number"
                  min={0}
                  max={72}
                  step={6}
                  value={margin}
                  disabled={running || pageSize === 'image'}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    setMargin(Number.isFinite(next) ? Math.min(72, Math.max(0, next)) : 24);
                  }}
                  className="tabular-nums"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileImage className="h-3.5 w-3.5" />
                {entries.length} image{entries.length === 1 ? '' : 's'} ·{' '}
                {formatBytes(totalBytes(entries.map((entry) => entry.file)))}
              </p>
              <Button size="lg" disabled={running} onClick={() => void run()}>
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building…
                  </>
                ) : (
                  <>Create PDF</>
                )}
              </Button>
            </div>
          </div>
        </>
      )}

      {runner.state.status === 'running' && (
        <JobProgressPanel progress={runner.state.progress} onCancel={runner.cancel} />
      )}
    </div>
  );
}
