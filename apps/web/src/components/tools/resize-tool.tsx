import { useState } from 'react';
import { Loader2, Ruler } from 'lucide-react';
import { toast } from 'sonner';
import {
  timeoutForPageCount,
  type InspectOutput,
  type ResizeJobOutput,
  type ResizeRequest,
} from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity, announceCapacityWarning } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, shortName, totalBytes } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

type Choice = { kind: 'preset'; preset: 'a4' | 'letter' } | { kind: 'percent'; percent: number };

const PRESETS: { preset: 'a4' | 'letter'; title: string; detail: string }[] = [
  { preset: 'a4', title: 'A4', detail: '210 × 297 mm — international' },
  { preset: 'letter', title: 'Letter', detail: '8.5 × 11 in — US' },
];

/**
 * Resize PDF: fit every page to a paper size or scale by a percentage. The
 * engine re-packs content with a real transform, so text stays text. Pages
 * keep their proportions — fitting letterboxes rather than stretching.
 */
export function ResizeTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [choice, setChoice] = useState<Choice>({ kind: 'preset', preset: 'a4' });
  const [percent, setPercent] = useState(100);
  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const runner = useJobRunner<ResizeJobOutput>('resize');

  const running = inspectRunner.state.status === 'running' || runner.state.status === 'running';

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
    announceCapacityWarning(verdict);

    const outcome = await inspectRunner.run(await readAsInputFiles([file]));
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    const doc = outcome.result.documents[0];
    if (!doc) return;
    setFiles([file]);
    setPageCount(doc.pageCount);
  };

  const request = (): ResizeRequest => {
    if (choice.kind === 'preset') return choice;
    return { kind: 'percent', percent };
  };

  const describe = (): string => {
    if (choice.kind === 'preset') {
      return choice.preset === 'a4' ? 'fit to A4' : 'fit to Letter';
    }
    return `scale to ${percent}%`;
  };

  const save = async () => {
    if (files.length === 0 || runner.state.status === 'running') return;
    if (choice.kind === 'percent' && (percent < 25 || percent > 400)) {
      toast.error('Custom scale must be between 25% and 400%.');
      return;
    }
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: totalBytes(files),
      pageCount: pageCount ?? undefined,
      largestFileBytes: largestBytes(files),
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }

    const outcome = await runner.run(
      await readAsInputFiles(files),
      {
        request: request(),
        outputName: `${files[0]!.name.replace(/\.pdf$/i, '')}-resized`,
      },
      { timeoutMs: timeoutForPageCount(pageCount ?? 30) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'resize-pdf',
      toolName: 'Resize PDF',
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
        }}
        footerNote={`${result.pageCount} page${result.pageCount === 1 ? '' : 's'} scaled. Content is re-fitted with a real transform — text stays selectable and sharp at any zoom.`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => void handleFiles(next)}
        multiple={false}
        disabled={running}
        hint="one PDF; every page gets the same treatment"
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
              <p className="text-xs text-muted-foreground">{pageCount.toLocaleString()} pages</p>
            </div>
            <Ruler className="h-5 w-5 shrink-0 text-primary" />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {PRESETS.map((preset) => {
              const selected = choice.kind === 'preset' && choice.preset === preset.preset;
              return (
                <button
                  key={preset.preset}
                  type="button"
                  aria-pressed={selected}
                  disabled={running}
                  onClick={() => setChoice({ kind: 'preset', preset: preset.preset })}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    selected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <span className="block text-sm font-medium">{preset.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {preset.detail}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-2 rounded-lg border border-border p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="text-sm font-medium">Custom scale</p>
                <p className="text-xs text-muted-foreground">
                  Percentage of the current page size, 25–400%.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={25}
                  max={400}
                  value={percent}
                  disabled={running}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    setPercent(Number.isFinite(next) ? next : 100);
                  }}
                  onClick={() => setChoice({ kind: 'percent', percent })}
                  className="w-24 tabular-nums"
                  aria-label="Custom scale percent"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            {choice.kind === 'percent' && (percent < 25 || percent > 400) && (
              <p className="mt-2 text-xs text-destructive">Keep the scale between 25% and 400%.</p>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Output: <span className="font-medium text-foreground">{describe()}</span>
            </p>
            <Button size="lg" disabled={running} onClick={() => void save()}>
              {runner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Resizing…
                </>
              ) : (
                <>Resize {pageCount.toLocaleString()} pages</>
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
