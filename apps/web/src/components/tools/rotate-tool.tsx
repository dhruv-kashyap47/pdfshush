import { useState } from 'react';
import { Loader2, RotateCcw, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { timeoutForPageCount, type OrganizeJobOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { useJobRunner } from '@/hooks/use-job-runner';
import { usePageThumbnails, type PageTile } from '@/hooks/use-page-thumbnails';
import { checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { readAsInputFiles, totalBytes } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

type Turn = 0 | 90 | 180 | 270;

/**
 * Rotate PDF: per-page rotation with live visual feedback (CSS rotate), plus
 * rotate-all shortcuts. The saved rotation rides on PageRef.rotateDegrees.
 */
export function RotateTool() {
  const { files, tiles, busy, progress, prepare, reset, cancel } = usePageThumbnails();
  const [turns, setTurns] = useState<Record<string, Turn>>({});
  const runner = useJobRunner<OrganizeJobOutput>('organize');

  const running = busy || runner.state.status === 'running';
  const turned = tiles.filter((tile) => (turns[tile.id] ?? 0) !== 0).length;

  const turnTile = (id: string, delta: 90 | -90) =>
    setTurns((prev) => {
      const current = prev[id] ?? 0;
      const next = (((current + delta) % 360) + 360) % 360;
      return { ...prev, [id]: next as Turn };
    });

  const turnAll = (delta: 90 | -90) =>
    setTurns((prev) => {
      const next: Record<string, Turn> = {};
      for (const tile of tiles) {
        const current = prev[tile.id] ?? 0;
        next[tile.id] = ((((current + delta) % 360) + 360) % 360) as Turn;
      }
      return next;
    });

  const save = async () => {
    if (tiles.length === 0 || runner.state.status === 'running') return;
    const verdict = checkClientCapacity({
      fileCount: files.length,
      totalBytes: totalBytes(files),
      pageCount: tiles.length,
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }

    const pageOrder = tiles.map((tile) => {
      const rotateDegrees = turns[tile.id] ?? 0;
      return rotateDegrees === 0
        ? { docIndex: tile.docIndex, pageIndex: tile.pageIndex }
        : { docIndex: tile.docIndex, pageIndex: tile.pageIndex, rotateDegrees };
    });

    const outcome = await runner.run(
      await readAsInputFiles(files),
      {
        pageOrder,
        // Without this the shared `organize` job fell back to its own default
        // and every tool downloaded as "-organized.pdf".
        outputName: `${files[0]!.name.replace(/\.pdf$/i, '')}-rotated`,
      },
      { timeoutMs: timeoutForPageCount(tiles.length) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'rotate-pdf',
      toolName: 'Rotate PDF',
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
          reset();
          setTurns({});
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => {
          setTurns({});
          return prepare(next);
        }}
        disabled={running}
        hint="one PDF to start"
        multiple={false}
      />

      {busy && <JobProgressPanel progress={progress} onCancel={cancel} />}

      {tiles.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{tiles.length.toLocaleString()}</span>{' '}
              page{tiles.length === 1 ? '' : 's'}
              {turned > 0 && (
                <>
                  {' '}· <span className="font-medium text-foreground">{turned}</span> rotated
                </>
              )}{' '}
              — use the arrows on each page, or rotate everything at once.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={running} onClick={() => turnAll(-90)} aria-label="Rotate all pages left">
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                All left
              </Button>
              <Button variant="outline" size="sm" disabled={running} onClick={() => turnAll(90)} aria-label="Rotate all pages right">
                <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                All right
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {tiles.map((tile, index) => (
              <RotateTileCard
                key={tile.id}
                tile={tile}
                displayNumber={index + 1}
                turn={turns[tile.id] ?? 0}
                disabled={running}
                onChange={(delta) => turnTile(tile.id, delta)}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              Output: <span className="font-medium text-foreground">{tiles.length} pages</span>
              {turned > 0 ? ` · ${turned} rotated` : ' · nothing rotated yet'}
            </p>
            <Button size="lg" disabled={running || tiles.length === 0} onClick={() => void save()}>
              {runner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building…
                </>
              ) : (
                <>Save {tiles.length} page{tiles.length === 1 ? '' : 's'}</>
              )}
            </Button>
          </div>
        </>
      )}

      {runner.state.status === 'running' && (
        <JobProgressPanel progress={runner.state.progress} onCancel={runner.cancel} />
      )}
    </div>
  );
}

function RotateTileCard({
  tile,
  displayNumber,
  turn,
  disabled,
  onChange,
}: {
  tile: PageTile;
  displayNumber: number;
  turn: Turn;
  disabled: boolean;
  onChange: (delta: 90 | -90) => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-card hover:border-primary/50">
      <div
        className="w-full overflow-hidden bg-muted"
        style={{ aspectRatio: `${tile.width} / ${tile.height}` }}
      >
        <img
          src={tile.url}
          alt={`Page ${displayNumber}`}
          loading="lazy"
          draggable={false}
          className="h-full w-full object-contain transition-transform duration-150"
          style={{ transform: `rotate(${turn}deg)` }}
        />
      </div>

      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
        {displayNumber}
        {turn > 0 ? ` · ${turn}°` : ''}
      </span>

      <div className="absolute right-1 top-1 flex gap-1">
        <button
          type="button"
          aria-label={`Rotate page ${displayNumber} left`}
          disabled={disabled}
          onClick={() => onChange(-90)}
          className="rounded-md bg-black/55 p-1.5 text-white transition-colors hover:bg-black/80 disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Rotate page ${displayNumber} right`}
          disabled={disabled}
          onClick={() => onChange(90)}
          className="rounded-md bg-black/55 p-1.5 text-white transition-colors hover:bg-black/80 disabled:opacity-40"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
