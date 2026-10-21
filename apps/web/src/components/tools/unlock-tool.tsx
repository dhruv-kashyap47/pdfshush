import { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, LockOpen, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { UnlockJobOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import { announceCapacityWarning, checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

/**
 * Unlock PDF: decrypts with the password the user already has and saves a plain
 * copy. The card is explicit that this is not a cracker -- a tool that implied
 * otherwise would invite the wrong files and promise work it cannot do.
 */
export function UnlockTool() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const runner = useJobRunner<UnlockJobOutput>('unlock');
  const running = runner.state.status === 'running';

  const handleFiles = (incoming: File[]) => {
    if (incoming.length === 0) {
      setFile(null);
      setPassword('');
      return;
    }
    const candidate = incoming[0]!;
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: candidate.size,
      largestFileBytes: largestBytes([candidate]),
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    announceCapacityWarning(verdict);
    setFile(candidate);
  };

  const run = async () => {
    if (!file || running) return;
    const outcome = await runner.run(await readAsInputFiles([file]), {
      ...(password.length > 0 ? { password } : {}),
    });
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'unlock-pdf',
      toolName: 'Unlock PDF',
      fileName: outcome.result.fileName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
    setPassword('');
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
          setFile(null);
          setPassword('');
        }}
        footerNote={
          result.wasEncrypted
            ? 'The password is gone from this copy. Keep the original locked file if you still need it.'
            : 'This document was not password protected, so you received a fresh, clean copy.'
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={file ? [file] : []}
        onFiles={handleFiles}
        multiple={false}
        disabled={running}
        hint="one password-protected PDF you can already open"
      />

      {file && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <KeyRound className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{shortName(file.name)}</p>
              <p className="text-xs text-muted-foreground">
                The current password is needed once, on this device.
              </p>
            </div>
          </div>

          <div className="mt-4 max-w-sm space-y-1.5">
            <Label htmlFor="unlock-password">Current password</Label>
            <div className="relative">
              <Input
                id="unlock-password"
                type={reveal ? 'text' : 'password'}
                value={password}
                autoComplete="off"
                placeholder="Leave empty if it only restricts editing"
                disabled={running}
                onChange={(event) => setPassword(event.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label={reveal ? 'Hide password' : 'Show password'}
                onClick={() => setReveal((value) => !value)}
              >
                {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              PDFShush cannot guess or crack a password. If you do not know it, the file stays
              locked. PDFs that only restrict printing or copying open with the field empty.
            </p>
          </div>

          <div className="mt-4 flex items-center justify-end">
            <Button size="lg" disabled={running} onClick={() => void run()}>
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Unlocking…
                </>
              ) : (
                <>
                  <LockOpen className="mr-1.5 h-4 w-4" /> Unlock PDF
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
