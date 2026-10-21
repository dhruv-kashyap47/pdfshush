import { useState } from 'react';
import { Loader2, Type } from 'lucide-react';
import { toast } from 'sonner';
import {
  expandRenamePattern,
  RENAME_LIMITS,
  RENAME_TOKENS,
  type InspectOutput,
  type RenameJobOutput,
} from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import { announceCapacityWarning, checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, shortName, totalBytes } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Rename PDF: a pattern applied to a batch, previewed live.
 *
 * The preview is the point: `{title}` only becomes honest once the documents
 * have been read, so the tool inspects them on upload rather than showing a
 * placeholder that the real run then contradicts.
 */
export function RenamePdfTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [titles, setTitles] = useState<ReadonlyMap<File, string>>(new Map());
  const [pattern, setPattern] = useState('{name}');
  const [digits, setDigits] = useState(2);
  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const runner = useJobRunner<RenameJobOutput>('rename');
  const inspecting = inspectRunner.state.status === 'running';
  const renaming = runner.state.status === 'running';
  const running = inspecting || renaming;

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      setFiles([]);
      setTitles(new Map());
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
    setFiles(incoming);

    const outcome = await inspectRunner.run(await readAsInputFiles(incoming));
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    const next = new Map<File, string>();
    outcome.result.documents.forEach((doc, index) => {
      const file = incoming[index];
      if (file && doc.metadata.title) next.set(file, doc.metadata.title);
    });
    setTitles(next);
  };

  const previewNames = files.map((file, index) =>
    expandRenamePattern(
      pattern,
      {
        name: stemOf(file.name),
        title: titles.get(file),
        index: index + 1,
        total: files.length,
      },
      digits,
    ),
  );

  const run = async () => {
    if (files.length === 0 || running) return;
    const outcome = await runner.run(await readAsInputFiles(files), {
      pattern,
      digits,
    });
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'rename-pdf',
      toolName: 'Rename PDF',
      fileName: outcome.result.zipName ?? outcome.result.files[0]?.name ?? 'renamed.pdf',
      pageCount: outcome.result.pageCount,
      sizeBytes:
        outcome.result.zip?.byteLength ??
        outcome.result.files.reduce((sum, file) => sum + file.bytes, 0),
    });
  };

  if (runner.state.status === 'done') {
    const { result } = runner.state;
    const download = () => {
      if (result.zip && result.zipName) {
        downloadBytes(result.zip, result.zipName, 'application/zip');
      } else if (result.files[0]) {
        downloadBytes(result.files[0].data, result.files[0].name);
      }
    };
    return (
      <ResultPanel
        fileName={result.zipName ?? result.files[0]?.name ?? 'renamed.pdf'}
        pageCount={result.pageCount}
        sizeBytes={
          result.zip?.byteLength ?? result.files.reduce((sum, file) => sum + file.bytes, 0)
        }
        downloadLabel={result.zip ? 'Download renamed files (ZIP)' : 'Download renamed PDF'}
        onDownload={download}
        onReset={() => {
          runner.reset();
          setFiles([]);
          setTitles(new Map());
          setPattern('{name}');
          setDigits(2);
        }}
        footerNote="The bytes were copied, not re-encoded: every renamed file is the original document."
      >
        {result.renamed.length > 1 && (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Original</th>
                  <th className="px-3 py-2 font-medium">Renamed to</th>
                </tr>
              </thead>
              <tbody>
                {result.renamed.map((entry) => (
                  <tr key={entry.from} className="border-b border-border/60 last:border-0">
                    <td className="max-w-[15rem] truncate px-3 py-1.5" title={entry.from}>
                      {entry.from}
                    </td>
                    <td className="max-w-[15rem] truncate px-3 py-1.5 font-medium" title={entry.to}>
                      {entry.to}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ResultPanel>
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => void handleFiles(next)}
        disabled={running}
        hint={`up to ${RENAME_LIMITS.maxFiles} PDFs`}
      />

      {files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-1.5">
              <Label htmlFor="rename-pattern">Name pattern</Label>
              <Input
                id="rename-pattern"
                value={pattern}
                disabled={running}
                maxLength={RENAME_LIMITS.maxPatternChars}
                onChange={(event) => setPattern(event.target.value)}
                className="font-mono text-sm"
                placeholder="{name}-{n}"
              />
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {RENAME_TOKENS.map((token) => (
                  <button
                    key={token.token}
                    type="button"
                    disabled={running}
                    title={token.label}
                    onClick={() => setPattern((value) => `${value}${token.token}`)}
                    className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    {token.token}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rename-digits">Sequence width</Label>
              <Input
                id="rename-digits"
                type="number"
                min={1}
                max={RENAME_LIMITS.maxDigits}
                value={digits}
                disabled={running}
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10);
                  setDigits(
                    Number.isFinite(next)
                      ? Math.min(RENAME_LIMITS.maxDigits, Math.max(1, next))
                      : 2,
                  );
                }}
                className="tabular-nums"
              />
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Original</th>
                  <th className="px-3 py-2 font-medium">New name</th>
                </tr>
              </thead>
              <tbody>
                {files.slice(0, 8).map((file, index) => (
                  <tr key={`${file.name}-${index}`} className="border-b border-border/60 last:border-0">
                    <td className="max-w-[14rem] truncate px-3 py-1.5" title={file.name}>
                      {shortName(file.name, 36)}
                    </td>
                    <td
                      className="max-w-[14rem] truncate px-3 py-1.5 font-medium text-primary"
                      title={previewNames[index]}
                    >
                      {previewNames[index]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {files.length > 8 && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              and {files.length - 8} more with the same pattern
            </p>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Type className="h-3.5 w-3.5" />
              {files.length} file{files.length === 1 ? '' : 's'}
              {inspecting ? ' · reading titles…' : ''}
            </p>
            <Button size="lg" disabled={running} onClick={() => void run()}>
              {renaming ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Renaming…
                </>
              ) : inspecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading titles…
                </>
              ) : (
                <>Rename {files.length === 1 ? 'PDF' : `${files.length} files`}</>
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
