/**
 * Deskew: straighten crooked scans.
 *
 * A crooked scan cannot be fixed by a PDF page rotation (which only turns whole
 * pages by 90°), so the engine rasterizes each page, estimates the skew from the
 * text rows, rotates the pixels back to level, and rebuilds the document. The
 * output is an image PDF; the tool says so before the run instead of letting the
 * user discover it when copy-and-paste stops working.
 *
 * The manual override exists because automatic detection is deliberately
 * conservative (±10°). A page beyond that range is a rotation decision, not a
 * deskew guess, and the UI names the ceiling.
 */

import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  LIMITS,
  SKEW_LIMITS,
  timeoutForPageCount,
  type DeskewJobOutput,
  type InspectOutput,
} from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity, announceCapacityWarning } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFilesOrToast, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

/** `+4.0°` / `−3.5°`; the sign is the direction the page was turned. */
function formatAngle(angle: number): string {
  const rounded = Math.round(angle * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}°`;
}

export function DeskewTool() {
  const [file, setFile] = useState<File | null>(null);
  const [inspect, setInspect] = useState<InspectOutput['documents'][number] | null>(null);
  const [override, setOverride] = useState('');

  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const runner = useJobRunner<DeskewJobOutput>('deskew');

  const running = inspectRunner.state.status === 'running' || runner.state.status === 'running';
  const overCap = inspect !== null && inspect.pageCount > LIMITS.tool.maxRedactPages;

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      inspectRunner.cancel();
      setFile(null);
      setInspect(null);
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
    setInspect(null);
    const input = await readAsInputFilesOrToast([candidate]);
    if (!input) return;
    const inspected = await inspectRunner.run(input);
    if (!inspected.ok) {
      if (!inspected.aborted) toast.error(inspected.message);
      setFile(null);
      return;
    }
    const doc = inspected.result.documents[0];
    if (doc) setInspect(doc);
  };

  const run = async () => {
    if (!file || running || overCap) return;
    let angle: number | undefined;
    if (override.trim().length > 0) {
      const parsed = Number(override);
      if (!Number.isFinite(parsed) || Math.abs(parsed) > SKEW_LIMITS.maxOverrideDeg) {
        toast.error(`Enter an angle between −${SKEW_LIMITS.maxOverrideDeg}° and +${SKEW_LIMITS.maxOverrideDeg}°, or leave it blank to detect.`);
        return;
      }
      angle = parsed;
    }
    const input = await readAsInputFilesOrToast([file]);
    if (!input) return;
    const outcome = await runner.run(
      input,
      { ...(angle !== undefined ? { overrideAngle: angle } : {}) },
      { timeoutMs: timeoutForPageCount(inspect?.pageCount ?? 60) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'deskew',
      toolName: 'Deskew',
      fileName: outcome.result.fileName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  };

  if (runner.state.status === 'done') {
    const { result } = runner.state;
    const shown = result.angles.slice(0, 12).map(formatAngle).join(', ');
    const suffix = result.angles.length > 12 ? ', …' : '';
    return (
      <ResultPanel
        fileName={result.fileName}
        pageCount={result.pageCount}
        sizeBytes={result.data.byteLength}
        onDownload={() => downloadBytes(result.data, result.fileName)}
        onReset={() => {
          runner.reset();
          setFile(null);
          setInspect(null);
          setOverride('');
        }}
        footerNote="Every page was rebuilt as a straightened image. Keep the original if you need selectable text."
      >
        <p className="text-sm text-muted-foreground" data-testid="deskew-angles">
          {`Angle applied: ${shown}${suffix}.`}
          {result.angles.every((angle) => angle === 0)
            ? ' No skew was found; the pages were rebuilt without rotation.'
            : ''}
        </p>
      </ResultPanel>
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={file ? [file] : []}
        onFiles={(next) => void handleFiles(next)}
        multiple={false}
        disabled={running}
        hint="one PDF"
      />

      {inspectRunner.state.status === 'running' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the document…
        </p>
      )}

      {file && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border p-4">
            <label className="block text-sm font-medium" htmlFor="deskew-override">
              Manual angle (optional)
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Leave blank to detect each page automatically ({SKEW_LIMITS.minDeg}° to +{SKEW_LIMITS.maxDeg}°).
              Use an override when you already know the angle, up to ±{SKEW_LIMITS.maxOverrideDeg}°.
            </p>
            <Input
              id="deskew-override"
              data-testid="deskew-override"
              className="mt-2 max-w-40"
              type="number"
              inputMode="decimal"
              min={-SKEW_LIMITS.maxOverrideDeg}
              max={SKEW_LIMITS.maxOverrideDeg}
              step={0.1}
              placeholder="Auto-detect"
              value={override}
              disabled={running}
              onChange={(event) => setOverride(event.target.value)}
            />
          </div>

          {overCap && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <strong className="block">{inspect!.pageCount.toLocaleString()} pages</strong>
              <span className="text-muted-foreground">
                Deskew rebuilds each page as an image, and the engine caps rasterized rebuilds at{' '}
                {LIMITS.tool.maxRedactPages} pages (the same gate secure redaction uses). Split the
                document first and straighten the parts.
              </span>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Pages are rasterized, straightened, and saved back as high-quality JPEG. Expect{' '}
            <strong className="text-foreground">non-selectable text</strong> and thin white wedges
            where a rotated page kept its corners. Keep the original for copy-and-paste and archiving.
          </p>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{shortName(file.name)}</p>
              <p className="text-xs text-muted-foreground">
                {inspect ? `${inspect.pageCount.toLocaleString()} page${inspect.pageCount === 1 ? '' : 's'}` : 'Reading…'}
                {' · '}
                {override.trim() ? `manual ${formatAngle(Number(override))}` : 'auto-detect'}
              </p>
            </div>
            <Button size="lg" disabled={running || overCap} onClick={() => void run()}>
              {runner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Straightening.
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" /> Straighten pages
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
