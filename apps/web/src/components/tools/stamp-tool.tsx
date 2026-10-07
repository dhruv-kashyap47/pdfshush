import { useState } from 'react';
import { Hash, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { type InspectOutput, type StampJobOutput, type StampPosition } from '@pdfshush/pdf-core';
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
import { checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

const POSITIONS: { value: StampPosition; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-center', label: 'Top center' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-center', label: 'Bottom center' },
  { value: 'bottom-right', label: 'Bottom right' },
];

const NUMBER_FORMATS: { value: string; label: string }[] = [
  { value: '{n}', label: '1, 2, 3 …' },
  { value: 'Page {n} of {N}', label: 'Page 1 of 12' },
  { value: '{n} / {N}', label: '1 / 12' },
  { value: '- {n} -', label: '- 1 -' },
];

type Mode = 'numbers' | 'header-footer';

/**
 * One engine path for both stamp tools: Page Numbers exposes the footer with
 * number presets, Header & Footer exposes free text for both regions.
 */
export function StampTool({ mode }: { mode: Mode }) {
  const [files, setFiles] = useState<File[]>([]);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [headerText, setHeaderText] = useState('');
  const [footerText, setFooterText] = useState(
    mode === 'numbers' ? 'Page {n} of {N}' : '',
  );
  const [headerPos, setHeaderPos] = useState<StampPosition>('top-center');
  const [footerPos, setFooterPos] = useState<StampPosition>(
    mode === 'numbers' ? 'bottom-center' : 'bottom-center',
  );
  const [fontSize, setFontSize] = useState('10');
  const [margin, setMargin] = useState('24');

  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const runner = useJobRunner<StampJobOutput>('stamp');
  const busy = inspectRunner.state.status === 'running' || runner.state.status === 'running';

  const effectiveFooter = footerText;
  const hasText = headerText.trim().length > 0 || effectiveFooter.trim().length > 0;

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

    const outcome = await inspectRunner.run(await readAsInputFiles([file]));
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    const doc = outcome.result.documents[0];
    if (!doc) return;
    if (doc.encrypted) {
      toast.error('That PDF is password protected — unlock it first.');
      return;
    }
    setFiles([file]);
    setPageCount(doc.pageCount);
  };

  const runStamp = async () => {
    if (files.length === 0 || runner.state.status === 'running') return;
    if (!hasText) {
      toast.error(mode === 'numbers' ? 'Choose or type a page-number format.' : 'Enter a header or footer.');
      return;
    }

    const size = Number.parseInt(fontSize, 10);
    const pad = Number.parseInt(margin, 10);
    const options = {
      ...(headerText.trim() ? { header: { text: headerText.trim(), position: headerPos } } : {}),
      ...(effectiveFooter.trim() ? { footer: { text: effectiveFooter.trim(), position: footerPos } } : {}),
      style: {
        fontSize: Number.isFinite(size) ? Math.min(Math.max(size, 4), 72) : 10,
        margin: Number.isFinite(pad) ? Math.max(pad, 0) : 24,
      },
      outputName: `${files[0]!.name.replace(/\.pdf$/i, '')}${
        mode === 'numbers' ? '-numbered' : '-header-footer'
      }`,
    };

    const outcome = await runner.run(
      await readAsInputFiles(files),
      options,
      { timeoutMs: 60_000 },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: mode === 'numbers' ? 'page-numbers' : 'header-footer',
      toolName: mode === 'numbers' ? 'Page Numbers' : 'Header & Footer',
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
          setHeaderText('');
          setFooterText(mode === 'numbers' ? 'Page {n} of {N}' : '');
        }}
        footerNote="Text is drawn as real vector type — still selectable and searchable."
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => void handleFiles(next)}
        multiple={false}
        disabled={busy}
        hint={mode === 'numbers' ? 'numbers land on every page' : 'text repeats on every page'}
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
              <p className="text-xs text-muted-foreground">
                {pageCount.toLocaleString()} pages
                {hasText && ' · stamping every page'}
              </p>
            </div>
            {mode === 'numbers' ? (
              <Hash className="h-5 w-5 shrink-0 text-primary" />
            ) : (
              <Printer className="h-5 w-5 shrink-0 text-primary" />
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {mode === 'header-footer' && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="header-text">Header text</Label>
                <Input
                  id="header-text"
                  placeholder="Quarterly report — confidential"
                  value={headerText}
                  onChange={(event) => setHeaderText(event.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-xs text-muted-foreground">Position</span>
                  <Select value={headerPos} onValueChange={(value) => setHeaderPos(value as StampPosition)}>
                    <SelectTrigger className="h-8 w-[140px]" aria-label="Header position">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {POSITIONS.filter((p) => p.value.startsWith('top')).map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="footer-text">
                {mode === 'numbers' ? 'Number format' : 'Footer text'}
              </Label>
              {mode === 'numbers' ? (
                <>
                  <Select value={NUMBER_FORMATS.some((f) => f.value === footerText) ? footerText : 'custom'} onValueChange={(value) => { if (value !== 'custom') setFooterText(value); }}>
                    <SelectTrigger id="footer-text" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NUMBER_FORMATS.map((format) => (
                        <SelectItem key={format.value} value={format.value}>
                          {format.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">Custom template…</SelectItem>
                    </SelectContent>
                  </Select>
                  {!NUMBER_FORMATS.some((f) => f.value === footerText) && (
                    <Input
                      aria-label="Custom number template"
                      placeholder="Page {n} of {N}"
                      value={footerText}
                      onChange={(event) => setFooterText(event.target.value)}
                      className="mt-2"
                    />
                  )}
                </>
              ) : (
                <Input
                  id="footer-text"
                  placeholder="Page {n} of {N}"
                  value={footerText}
                  onChange={(event) => setFooterText(event.target.value)}
                />
              )}
              <p className="pt-1 text-xs text-muted-foreground">
                <code>{'{n}'}</code> = page number · <code>{'{N}'}</code> = total pages
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="footer-position">Position</Label>
              <Select value={footerPos} onValueChange={(value) => setFooterPos(value as StampPosition)}>
                <SelectTrigger id="footer-position" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="stamp-size">Font size (pt)</Label>
              <Input
                id="stamp-size"
                type="number"
                min={4}
                max={72}
                value={fontSize}
                onChange={(event) => setFontSize(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="stamp-margin">Margin from edge (pt)</Label>
              <Input
                id="stamp-margin"
                type="number"
                min={0}
                max={200}
                value={margin}
                onChange={(event) => setMargin(event.target.value)}
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button size="lg" disabled={busy || !hasText} onClick={() => void runStamp()}>
              {runner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Stamping…
                </>
              ) : (
                <>{mode === 'numbers' ? 'Add page numbers' : 'Apply header & footer'}</>
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

export function PageNumbersTool() {
  return <StampTool mode="numbers" />;
}

export function HeaderFooterTool() {
  return <StampTool mode="header-footer" />;
}
