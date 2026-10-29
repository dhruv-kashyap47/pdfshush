/**
 * Dark Mode PDF: pages are rasterized, remapped, and rebuilt as JPEGs, so the
 * tool is honest up front (flat page images, like secure redaction) and shows a
 * live before/after wipe preview before any work happens on the real document.
 *
 * The preview runs the SAME pure transforms the worker engine runs
 * (`darkModes.ts`, imported without dependencies) over a `thumbnails`-job
 * render of page 1: what the user wipes across first is exactly what they
 * download. The wipe slider is a real range input, so the preview is keyboard
 * reachable, and paint always starts from the pristine cached pixels.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Moon } from 'lucide-react';
import { toast } from 'sonner';
import {
  DARK_MODE_DEFAULT_THEME,
  DARK_MODE_THEMES,
  LIMITS,
  applyDarkModeRgba,
  darkModeTheme,
  timeoutForPageCount,
  type DarkModeJobOutput,
  type DarkModeKind,
  type DarkModeThemeId,
  type InspectOutput,
  type ThumbnailsOutput,
} from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity, announceCapacityWarning } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

const KINDS: { id: DarkModeKind; name: string; blurb: string }[] = [
  {
    id: 'theme',
    name: 'Theme',
    blurb: 'White paper becomes the chosen theme, ink becomes light. Best for text documents.',
  },
  {
    id: 'smart',
    name: 'Smart',
    blurb: 'Flips lightness while keeping every hue, so charts and photos stay recognisable.',
  },
  {
    id: 'invert',
    name: 'Invert',
    blurb: 'The classic negative: every channel flips to its opposite. Harsh but predictable.',
  },
];

export function DarkModePdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [inspect, setInspect] = useState<InspectOutput['documents'][number] | null>(null);
  const [kind, setKind] = useState<DarkModeKind>('theme');
  const [themeId, setThemeId] = useState<DarkModeThemeId>(DARK_MODE_DEFAULT_THEME);
  const [wipePercent, setWipePercent] = useState(50);
  const [previewReady, setPreviewReady] = useState(false);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);

  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const previewRunner = useJobRunner<ThumbnailsOutput>('thumbnails');
  const runner = useJobRunner<DarkModeJobOutput>('dark-mode');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const urlRef = useRef<string | null>(null);
  /** Pristine page-1 pixels; every transform repaints from this copy. */
  const sourcePixelsRef = useRef<ImageData | null>(null);

  const running =
    inspectRunner.state.status === 'running' ||
    previewRunner.state.status === 'running' ||
    runner.state.status === 'running';
  const overCap = inspect !== null && inspect.pageCount > LIMITS.tool.maxRedactPages;

  const resetPreview = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setOriginalUrl(null);
    sourcePixelsRef.current = null;
    setPreviewReady(false);
  }, []);

  useEffect(() => () => resetPreview(), [resetPreview]);

  /** Paints the visible canvas from pristine pixels + the current settings. */
  const paint = useCallback((desired: { kind: DarkModeKind; themeId: DarkModeThemeId }) => {
    const canvas = canvasRef.current;
    const source = sourcePixelsRef.current;
    if (!canvas || !source || canvas.width !== source.width) {
      if (canvas && source) {
        canvas.width = source.width;
        canvas.height = source.height;
      }
    }
    if (!canvas || !source) return;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.putImageData(
      new ImageData(
        (() => {
          const data = new Uint8ClampedArray(source.data);
          applyDarkModeRgba(data, desired.kind, darkModeTheme(desired.themeId));
          return data;
        })(),
        source.width,
        source.height,
      ),
      0,
      0,
    );
  }, []);

  // Live preview: repaint whenever the mode or theme changes (and once the
  // page-1 pixels first land). The preview never touches pdf.js or pdf-lib.
  useEffect(() => {
    if (!previewReady) return;
    paint({ kind, themeId });
  }, [kind, themeId, previewReady, paint]);

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      setFile(null);
      setInspect(null);
      resetPreview();
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
    resetPreview();

    const inspected = await inspectRunner.run(await readAsInputFiles([candidate]));
    if (!inspected.ok) {
      if (!inspected.aborted) toast.error(inspected.message);
      return;
    }
    const doc = inspected.result.documents[0];
    if (!doc) return;
    setInspect(doc);

    const pageVerdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: candidate.size,
      pageCount: doc.pageCount,
    });
    if (!pageVerdict.ok) {
      toast.error(pageVerdict.message);
    }

    // Page 1 render for the live wipe preview, at a width sharp enough to read.
    const outcome = await previewRunner.run(
      await readAsInputFiles([candidate]),
      { pageIndexes: [0], targetWidthPx: 1000 },
      { timeoutMs: timeoutForPageCount(Math.max(doc.pageCount, 60)) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    const thumb = outcome.result.documents[0]?.thumbnails[0];
    if (!thumb) return;

    // The worker pool transfers buffers; copy before the bits go stale, then
    // build the original layer and the pristine pixel cache from that copy.
    const bytes = new Uint8Array(thumb.data.slice(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: thumb.mimeType }));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: thumb.mimeType }));

    const stage = new OffscreenCanvas(bitmap.width, bitmap.height);
    const stageContext = stage.getContext('2d', { willReadFrequently: true });
    if (!stageContext) return;
    stageContext.drawImage(bitmap, 0, 0);
    const pristine = stageContext.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();

    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setOriginalUrl(url);
    sourcePixelsRef.current = pristine;
    setPreviewReady(true);
  };

  const run = async () => {
    if (!file || running || overCap) return;
    const outcome = await runner.run(
      await readAsInputFiles([file]),
      {
        kind,
        ...(kind === 'theme' ? { themeId } : {}),
      },
      { timeoutMs: timeoutForPageCount(inspect?.pageCount ?? 60) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'dark-mode-pdf',
      toolName: 'Dark Mode PDF',
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
          setFile(null);
          setInspect(null);
          setKind('theme');
          setThemeId(DARK_MODE_DEFAULT_THEME);
          setWipePercent(50);
          resetPreview();
        }}
        footerNote={`${result.pageCount} page${result.pageCount === 1 ? '' : 's'} rebuilt for night reading. Keep the original too: text in this copy is part of the page image.`}
      />
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

      {(inspectRunner.state.status === 'running' || previewRunner.state.status === 'running') && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Rendering page 1 for the live preview…
        </p>
      )}

      {file && (
        <div className="space-y-4">
          {previewReady && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="relative mx-auto max-w-2xl overflow-hidden rounded-lg border border-border">
                {originalUrl && <img src={originalUrl} alt="" className="block h-auto w-full" aria-hidden />}
                <canvas
                  ref={canvasRef}
                  data-testid="dark-preview-canvas"
                  className="absolute inset-0 h-full w-full"
                  style={{ clipPath: `inset(0 0 0 ${wipePercent}%)` }}
                />
                <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                  Before
                </span>
                <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                  After
                </span>
              </div>
              <label className="mt-3 block text-xs font-medium text-muted-foreground">
                <span className="mb-1.5 flex items-center justify-between">
                  <span>Original</span>
                  <span>Dark</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={wipePercent}
                  aria-label="Preview wipe position"
                  onChange={(event) => setWipePercent(Number(event.target.value))}
                  className="w-full"
                />
              </label>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Conversion mode">
            {KINDS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={kind === entry.id}
                data-testid={`dark-kind-${entry.id}`}
                onClick={() => setKind(entry.id)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  kind === entry.id ? 'border-violet-500 bg-violet-500/5' : 'border-border hover:border-violet-300'
                }`}
              >
                <span className="block text-sm font-medium">{entry.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{entry.blurb}</span>
              </button>
            ))}
          </div>

          {kind === 'theme' && (
            <fieldset className="rounded-xl border border-border bg-card p-4">
              <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Theme
              </legend>
              <div className="flex flex-wrap gap-2">
                {DARK_MODE_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    aria-pressed={themeId === theme.id}
                    data-testid={`dark-theme-${theme.id}`}
                    title={theme.label}
                    onClick={() => setThemeId(theme.id)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      themeId === theme.id
                        ? 'border-violet-500 text-violet-400'
                        : 'border-border text-muted-foreground hover:border-violet-300'
                    }`}
                  >
                    <span
                      aria-hidden
                      className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle border border-white/20"
                      style={{ backgroundColor: `rgb(${theme.r} ${theme.g} ${theme.b})` }}
                    />
                    {theme.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {overCap && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <strong className="block">{inspect!.pageCount.toLocaleString()} pages</strong>
              <span className="text-muted-foreground">
                Dark mode rebuilds each page as an image, and the engine caps rasterized rebuilds at{' '}
                {LIMITS.tool.maxRedactPages} pages (the same gate secure redaction uses). Split the
                document first and convert the halves.
              </span>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            This tool works like secure redaction: pages are rasterized, remapped, and saved back as
            JPEG at high quality. Expect{' '}
            <strong className="text-foreground">bigger files and non-selectable text</strong>, which
            is what makes night reading work. Keep the original for copy-and-paste and archiving.
          </p>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{shortName(file.name)}</p>
              <p className="text-xs text-muted-foreground">
                {inspect ? inspect.pageCount.toLocaleString() : '…'} pages ·{' '}
                {kind === 'theme' ? `${darkModeTheme(themeId).label} theme` : `${kind} conversion`}
              </p>
            </div>
            <Button size="lg" disabled={running || overCap} onClick={() => void run()}>
              {runner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Converting…
                </>
              ) : (
                <>
                  <Moon className="mr-2 h-4 w-4" /> Convert to dark mode
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
