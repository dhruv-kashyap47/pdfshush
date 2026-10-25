import { useState } from 'react';
import { Loader2, ShieldAlert, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import type { RepairJobOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import { announceCapacityWarning, checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { readAsInputFiles } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

/**
 * Repair: rebuild the cross-reference table and trailer by parsing and
 * re-serializing the document.
 *
 * The page is explicit about the ceiling of that technique. A truthful "this
 * file was already structurally valid" is more useful than a green check that
 * implies data recovery we cannot perform.
 */
export function RepairPdfTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const runner = useJobRunner<RepairJobOutput>('repair');
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
      toolSlug: 'repair-pdf',
      toolName: 'Repair PDF',
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
          setPassword('');
        }}
        footerNote={
          result.rebuilt
            ? 'Rebuilt: the original failed a strict structural check, and this copy was written from a lenient parse. Open it before deleting the original.'
            : 'The original already passed a strict structural check. This copy is a clean re-serialization — useful for normalising a file, not a data-recovery tool.'
        }
      >
        <p className="text-sm text-muted-foreground">
          {result.rebuilt
            ? 'The cross-reference table, trailer and object graph were rebuilt. Missing content streams, fonts or images are not reconstructed.'
            : 'Nothing was structurally wrong with this file. It was rewritten with a fresh cross-reference table anyway.'}
        </p>
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
        hint="one PDF; badly truncated files may still be unrecoverable"
      />

      {files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-xs text-muted-foreground">
              <p className="font-medium text-foreground">What this can and cannot fix</p>
              <p className="mt-1">
                It rebuilds the file structure (cross-reference table, trailer, object graph).
                It cannot recover objects that are missing from the file entirely. An encrypted
                PDF needs its open password: the repaired copy is written unencrypted, so keep
                the original if the password has to survive.
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
                <Label htmlFor="repair-password">Password</Label>
                <Input
                  id="repair-password"
                  type="password"
                  autoComplete="off"
                  value={password}
                  disabled={running}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Only needed to open the document"
                />
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              A repaired copy is written; your original file is never modified.
            </p>
            <Button size="lg" disabled={running} onClick={() => void run()} data-testid="repair-run">
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rebuilding…
                </>
              ) : (
                <>
                  <Wrench className="mr-2 h-4 w-4" /> Repair PDF
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
