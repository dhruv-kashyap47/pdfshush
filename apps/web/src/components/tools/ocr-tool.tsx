/**
 * OCR: make scans searchable and selectable.
 *
 * The visible page is not reconstructed. Recognition adds an invisible text
 * layer over the original scan, so searching and copy-and-paste work while the
 * page still looks exactly like the document the user supplied. The UI says
 * that plainly, and names the two costs up front: the first run downloads a
 * ~15 MB recognizer, and recognition is English-only.
 *
 * Pages that already carry a text layer are copied untouched by the engine.
 * That is why the result reports recognized pages and kept pages separately:
 * re-OCR-ing a searchable PDF would only degrade its text.
 */

import { useState } from 'react';
import { Loader2, ScanText, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  OCR_LIMITS,
  ocrTimeoutForPageCount,
  type InspectOutput,
  type OcrJobOutput,
} from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity, announceCapacityWarning } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

/** Render-width presets. Recognition accuracy falls off below ~1500 px. */
const QUALITY_PRESETS = [
  {
    id: 'fast',
    label: 'Fast — 1600 px wide',
    hint: 'Smallest output and quickest recognition. Fine for clean, typed scans.',
    targetWidthPx: 1600,
    quality: 0.82,
  },
  {
    id: 'balanced',
    label: 'Balanced — 2200 px wide',
    hint: 'Roughly 250 dpi at A4. The right default for letters and forms.',
    targetWidthPx: OCR_LIMITS.defaultWidthPx,
    quality: 0.9,
  },
  {
    id: 'sharp',
    label: 'Sharp — 3200 px wide',
    hint: 'Best for small print and faxes. Produces a larger PDF and takes longer.',
    targetWidthPx: 3200,
    quality: 0.92,
  },
] as const;

type PresetId = (typeof QUALITY_PRESETS)[number]['id'];

export function OcrTool() {
  const [file, setFile] = useState<File | null>(null);
  const [inspect, setInspect] = useState<InspectOutput['documents'][number] | null>(null);
  const [presetId, setPresetId] = useState<PresetId>('balanced');
  /**
   * Owner-restricted PDFs (permissions set, empty user password) are opened
   * with an empty password. The rebuild drops those restrictions, so the UI
   * has to say so before the run.
   */
  const [ownerRestricted, setOwnerRestricted] = useState(false);

  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const runner = useJobRunner<OcrJobOutput>('ocr');

  const running = inspectRunner.state.status === 'running' || runner.state.status === 'running';
  const overCap = inspect !== null && inspect.pageCount > OCR_LIMITS.maxPages;
  const preset = QUALITY_PRESETS.find((entry) => entry.id === presetId) ?? QUALITY_PRESETS[1];

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      inspectRunner.cancel();
      setFile(null);
      setInspect(null);
      setOwnerRestricted(false);
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
    setOwnerRestricted(false);

    const inspected = await inspectRunner.run(await readAsInputFiles([candidate]));
    const inspectionFailure = inspected.ok ? null : inspected;
    let accepted = inspected;
    if (inspectionFailure && !inspectionFailure.aborted && inspectionFailure.code === 'encrypted') {
      // pdf-lib only takes its decrypt path when a password is defined, and
      // an owner-restricted file has an empty user password. A real open
      // password still fails here, so only permission-only files get through.
      const retry = await inspectRunner.run(
        (await readAsInputFiles([candidate])).map((input) => ({ ...input, password: '' })),
      );
      if (retry.ok) {
        accepted = retry;
        setOwnerRestricted(true);
      } else if (retry.aborted) {
        // A newer file selection superseded this one; do not clear its state.
        return;
      }
    }
    if (!accepted.ok && accepted.aborted) return;
    if (!accepted.ok) {
      // Report the first inspection failure: the empty-password retry's
      // "incorrect password" would blame the user for a password they never
      // entered.
      if (inspectionFailure && !inspectionFailure.aborted) {
        toast.error(inspectionFailure.message);
      }
      setFile(null);
      return;
    }
    const doc = accepted.result.documents[0];
    if (doc) setInspect(doc);
  };

  const run = async () => {
    if (!file || running || overCap) return;
    const inputs = await readAsInputFiles([file]);
    if (ownerRestricted) {
      for (const input of inputs) input.password = '';
    }
    const outcome = await runner.run(
      inputs,
      { targetWidthPx: preset.targetWidthPx, quality: preset.quality },
      { timeoutMs: ocrTimeoutForPageCount(inspect?.pageCount ?? 1) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'ocr-pdf',
      toolName: 'OCR',
      fileName: outcome.result.fileName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  };

  if (runner.state.status === 'done') {
    const { result } = runner.state;
    const recognized = result.ocrPages.length;
    const kept = result.textPages.length;
    return (
      <ResultPanel
        fileName={result.fileName}
        pageCount={result.pageCount}
        sizeBytes={result.data.byteLength}
        warnings={result.warnings}
        onDownload={() => downloadBytes(result.data, result.fileName)}
        onReset={() => {
          runner.reset();
          setFile(null);
          setInspect(null);
          setOwnerRestricted(false);
          setPresetId('balanced');
        }}
        footerNote={
          recognized > 0
            ? 'Every recognized page was re-parsed and checked for selectable text before this download was enabled. The visible page is still the original scan; the text is an invisible layer, so proofread anything you quote.'
            : 'No page needed recognition, so the output was re-opened and its page count verified before this download was enabled.'
        }
      >
        <div className="space-y-1 text-sm text-muted-foreground" data-testid="ocr-summary">
          <p>
            {recognized > 0
              ? `Recognized ${recognized.toLocaleString()} page${recognized === 1 ? '' : 's'}`
              : 'No page needed recognition'}
            {kept > 0
              ? `, kept ${kept.toLocaleString()} page${kept === 1 ? '' : 's'} that already had selectable text`
              : ''}
            .
          </p>
          {recognized > 0 && (
            <p>
              {result.wordCount.toLocaleString()} words ·{' '}
              {result.characterCount.toLocaleString()} characters · average confidence{' '}
              {Math.round(result.averageConfidence)}%
            </p>
          )}
          {recognized > 0 && (
            <p className="text-xs">
              Search and copy-and-paste now work. If a word was misread, retry at Sharp —
              recognition is probabilistic, not a proofread transcript.
            </p>
          )}
        </div>
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
            <Label htmlFor="ocr-quality">Recognition quality</Label>
            <select
              id="ocr-quality"
              data-testid="ocr-quality"
              value={presetId}
              disabled={running}
              onChange={(event) => setPresetId(event.target.value as PresetId)}
              className="mt-2 flex h-9 w-full max-w-sm rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              {QUALITY_PRESETS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted-foreground">{preset.hint}</p>
          </div>

          {overCap && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <strong className="block">{inspect!.pageCount.toLocaleString()} pages</strong>
              <span className="text-muted-foreground">
                OCR recognizes each scanned page and rebuilds it as an image, and this build caps a
                run at {OCR_LIMITS.maxPages} pages. Split the document first and recognize the parts.
              </span>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            The page keeps its scanned look. A hidden text layer is added so search and copy work.
            Pages that already contain selectable text are copied unchanged. Recognition is
            English-only, and the first run downloads about 15 MB of engine and language data once —
            then it works offline.
          </p>

          {ownerRestricted && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-muted-foreground">
                <strong className="text-foreground">This PDF carries permission restrictions.</strong>{' '}
                OCR opens it with its empty user password and rebuilds it, so the result is written{' '}
                <strong className="text-foreground">without those restrictions</strong>. Use Protect
                PDF on the result if that protection still matters.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{shortName(file.name)}</p>
              <p className="text-xs text-muted-foreground">
                {inspect
                  ? `${inspect.pageCount.toLocaleString()} page${inspect.pageCount === 1 ? '' : 's'}`
                  : 'Reading…'}
                {' · '}
                {preset.label.replace(' — ', ' · ')}
              </p>
            </div>
            <Button size="lg" disabled={running || overCap} onClick={() => void run()}>
              {runner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Recognizing.
                </>
              ) : (
                <>
                  <ScanText className="mr-2 h-4 w-4" /> Make searchable
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
