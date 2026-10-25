import { useState } from 'react';
import { BookMarked, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SplitByBookmarksOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import { announceCapacityWarning, checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

/**
 * Split by bookmarks: cut a PDF at the sections its own outline defines.
 *
 * The composition of the split is shown before download -- each part's title and
 * page count -- because an outline is the user's document, not ours: a
 * mis-nested bookmark tree should be visible in the result, not discovered
 * after unzipping.
 */
export function SplitByBookmarksTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const runner = useJobRunner<SplitByBookmarksOutput>('split-by-bookmarks');
  const running = runner.state.status === 'running';

  const handleFiles = (incoming: File[]) => {
    if (incoming.length === 0) {
      setFiles([]);
      return;
    }
    const file = incoming[0]!;
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: file.size,
      largestFileBytes: file.size,
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    announceCapacityWarning(verdict);
    setFiles([file]);
  };

  const run = async () => {
    if (files.length === 0 || running) return;
    const outcome = await runner.run(await readAsInputFiles(files), {
      ...(password ? { password } : {}),
    });
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'split-by-bookmarks',
      toolName: 'Split by bookmarks',
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
        onDownload={() => downloadBytes(result.zip, result.zipName)}
        onReset={() => {
          runner.reset();
          setFiles([]);
          setPassword('');
        }}
        footerNote={`${result.parts.length} section${
          result.parts.length === 1 ? '' : 's'
        } from ${result.bookmarkCount} bookmark${result.bookmarkCount === 1 ? '' : 's'}.`}
      >
        <ul className="divide-y divide-border rounded-lg border border-border" data-testid="bookmark-parts">
          {result.parts.map((part) => (
            <li key={part.name} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{part.title}</p>
                <p className="truncate text-xs text-muted-foreground">{part.name}</p>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {part.pageCount} page{part.pageCount === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
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
        hint="one PDF with bookmarks; each top-level bookmark starts a new file"
      />

      {files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <BookMarked className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="text-xs text-muted-foreground">
              <p className="font-medium text-foreground">How the split is chosen</p>
              <p className="mt-1">
                The tool uses the shallowest bookmark level that actually contains sections. Pages
                before the first bookmark become a <span className="font-medium">Front matter</span>{' '}
                file rather than being dropped.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <button
              type="button"
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? 'Hide password field' : 'This PDF opens with a password'}
            </button>
            {showPassword && (
              <div className="space-y-1.5">
                <Label htmlFor="bookmarks-password">Password</Label>
                <Input
                  id="bookmarks-password"
                  type="password"
                  autoComplete="off"
                  value={password}
                  disabled={running}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="truncate text-xs text-muted-foreground">
              {shortName(files[0]!.name, 40)}
            </p>
            <Button size="lg" disabled={running} onClick={() => void run()} data-testid="bookmarks-run">
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Splitting…
                </>
              ) : (
                'Split at bookmarks'
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
