import { useState } from 'react';
import { Hash, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatBatesNumber,
  BATES_LIMITS,
  type BatesJobOutput,
  type StampPosition,
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
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

const POSITIONS: { value: StampPosition; label: string }[] = [
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'bottom-center', label: 'Bottom center' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'top-center', label: 'Top center' },
  { value: 'top-left', label: 'Top left' },
];

const PREVIEW_POSITION: Record<StampPosition, string> = {
  'top-left': 'left-4 top-3',
  'top-center': 'left-1/2 top-3 -translate-x-1/2',
  'top-right': 'right-4 top-3',
  'bottom-left': 'left-4 bottom-3',
  'bottom-center': 'left-1/2 bottom-3 -translate-x-1/2',
  'bottom-right': 'right-4 bottom-3',
};

/**
 * Bates numbering: a legal sequence, not a page count. The preview shows the
 * user's own prefix, starting number and padding on a stand-in page so the one
 * detail that matters -- how the number reads -- is verified before the run.
 */
export function BatesNumberingTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [prefix, setPrefix] = useState('ABC-');
  const [start, setStart] = useState(1);
  const [digits, setDigits] = useState(6);
  const [position, setPosition] = useState<StampPosition>('bottom-right');
  const [fontSize, setFontSize] = useState(10);
  const runner = useJobRunner<BatesJobOutput>('bates-numbering');
  const running = runner.state.status === 'running';

  const handleFiles = (incoming: File[]) => {
    if (incoming.length === 0) {
      setFiles([]);
      return;
    }
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: incoming[0]!.size,
      largestFileBytes: largestBytes([incoming[0]!]),
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    announceCapacityWarning(verdict);
    setFiles([incoming[0]!]);
  };

  const sample = formatBatesNumber(prefix, start, digits);

  const run = async () => {
    if (files.length === 0 || running) return;
    const outcome = await runner.run(await readAsInputFiles(files), {
      prefix,
      start,
      digits,
      position,
      fontSize,
    });
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'bates-numbering',
      toolName: 'Bates Numbering',
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
        }}
        footerNote={`Numbers ${formatBatesNumber(prefix, result.start, digits)} through ${formatBatesNumber(
          prefix,
          result.end,
          digits,
        )}, one per page.`}
      >
        <p className="text-sm text-muted-foreground">
          The sequence ran across {result.pageCount} page{result.pageCount === 1 ? '' : 's'}. To
          continue a set, start the next document at{' '}
          <span className="font-mono font-medium text-foreground">
            {formatBatesNumber(prefix, result.end + 1, digits)}
          </span>
          .
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
        hint="one PDF; every page gets the next number"
      />

      {files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="space-y-3 sm:flex-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bates-prefix">Prefix</Label>
                  <Input
                    id="bates-prefix"
                    value={prefix}
                    disabled={running}
                    maxLength={BATES_LIMITS.maxPrefixChars}
                    onChange={(event) => setPrefix(event.target.value)}
                    className="font-mono"
                    placeholder="ABC-"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bates-start">Start at</Label>
                  <Input
                    id="bates-start"
                    type="number"
                    min={1}
                    max={BATES_LIMITS.maxStart}
                    value={start}
                    disabled={running}
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10);
                      setStart(Number.isFinite(next) ? Math.max(1, next) : 1);
                    }}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bates-digits">Digits</Label>
                  <Input
                    id="bates-digits"
                    type="number"
                    min={BATES_LIMITS.minDigits}
                    max={BATES_LIMITS.maxDigits}
                    value={digits}
                    disabled={running}
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10);
                      setDigits(
                        Number.isFinite(next)
                          ? Math.min(BATES_LIMITS.maxDigits, Math.max(1, next))
                          : 6,
                      );
                    }}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bates-size">Font size (pt)</Label>
                  <Input
                    id="bates-size"
                    type="number"
                    min={4}
                    max={72}
                    value={fontSize}
                    disabled={running}
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10);
                      setFontSize(Number.isFinite(next) ? Math.min(72, Math.max(4, next)) : 10);
                    }}
                    className="tabular-nums"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bates-position">Position</Label>
                <Select
                  value={position}
                  disabled={running}
                  onValueChange={(value) => setPosition(value as StampPosition)}
                >
                  <SelectTrigger id="bates-position" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POSITIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-muted/30 p-4">
              <div className="relative h-44 w-32 rounded-md border border-border bg-white shadow-sm">
                <span className="absolute left-4 right-4 top-6 h-1 rounded-full bg-muted" />
                <span className="absolute left-4 right-8 top-10 h-1 rounded-full bg-muted" />
                <span className="absolute left-4 right-12 top-14 h-1 rounded-full bg-muted" />
                <span
                  className={`absolute whitespace-nowrap font-mono text-[10px] font-semibold text-foreground ${PREVIEW_POSITION[position]}`}
                >
                  {sample}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">First page</p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Hash className="h-3.5 w-3.5" />
              {shortName(files[0]!.name, 34)} · next {sample}
            </p>
            <Button size="lg" disabled={running} onClick={() => void run()}>
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Numbering…
                </>
              ) : (
                <>Add Bates numbers</>
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
