import { useState } from 'react';
import { FlipHorizontal, FlipVertical, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { timeoutForPageCount, type FlipJobOutput } from '@pdfshush/pdf-core';
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

type Axis = 'h' | 'v' | 'both';

/**
 * Flip PDF: mirror pages horizontally or vertically with live visual feedback
 * (CSS scale transforms), mirroring the rotate tool's interaction. Mirrors are
 * sent to the engine as explicit page lists, so no boolean array travels over
 * postMessage.
 */
export function FlipTool() {
  const { files, tiles, busy, progress, prepare, reset, cancel } = usePageThumbnails();
  const [mirrors, setMirrors] = useState<Record<string, Axis>>({});
  const runner = useJobRunner<FlipJobOutput>('flip');

  const running = busy || runner.state.status === 'running';
  const flipped = tiles.filter((tile) => (mirrors[tile.id] ?? null) !== null).length;

  const cycleTile = (id: string, axis: Axis) =>
    setMirrors((prev) => {
      const current = prev[id] ?? null;
      // Cycle stays on the same axis so a tile stays interactive and
      // predictable: click horizontal again clears it.
      let next: Axis | null;
      if (axis === 'h') next = current === 'h' ? null : 'h';
      else if (axis === 'v') next = current === 'v' ? null : 'v';
      else next = current === 'both' ? null : 'both';
      return next !== null ? { ...prev, [id]: next } : omitKey(prev, id);
    });

  const flipAll = (axis: Axis) =>
    setMirrors(() => {
      const next: Record<string, Axis> = {};
      for (const tile of tiles) next[tile.id] = axis;
      return next;
    });

  const indexesFor = (axis: Axis): number[] =>
    tiles.filter((tile) => mirrors[tile.id] === axis).map((tile) => tile.pageIndex);

  const save = async () => {
    if (tiles.length === 0 || runner.state.status === 'running') return;
    if (flipped === 0) {
      toast.error('Flip at least one page first.');
      return;
    }
    const verdict = checkClientCapacity({
      fileCount: files.length,
      totalBytes: totalBytes(files),
      pageCount: tiles.length,
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }

    const horizontal = indexesFor('h');
    const vertical = indexesFor('v');
    const both = indexesFor('both');

    const outcome = await runner.run(
      await readAsInputFiles(files),
      {
        horizontal: [...horizontal, ...both],
        vertical: [...vertical, ...both],
        outputName: `${files[0]!.name.replace(/\.pdf$/i, '')}-flipped`,
      },
      { timeoutMs: timeoutForPageCount(tiles.length) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'flip-pdf',
      toolName: 'Flip PDF',
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
          setMirrors({});
        }}
        footerNote={`${result.flipped} of ${result.pageCount} pages mirrored. Text stays selectable: flipping uses a mirror transform, not a screenshot.`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => {
          setMirrors({});
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
              {flipped > 0 && (
                <>
                  {' '}· <span className="font-medium text-foreground">{flipped}</span> mirrored
                </>
              )}{' '}
              : flip individually, or mirror everything at once.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={running} onClick={() => flipAll('h')}>
                <FlipHorizontal className="mr-1.5 h-3.5 w-3.5" />
                Flip all H
              </Button>
              <Button variant="outline" size="sm" disabled={running} onClick={() => flipAll('v')}>
                <FlipVertical className="mr-1.5 h-3.5 w-3.5" />
                Flip all V
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {tiles.map((tile, index) => (
              <FlipTileCard
                key={tile.id}
                tile={tile}
                displayNumber={index + 1}
                mirror={mirrors[tile.id] ?? null}
                disabled={running}
                onToggle={(axis) => cycleTile(tile.id, axis)}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              Output: <span className="font-medium text-foreground">{tiles.length} pages</span>
              {flipped > 0 ? ` · ${flipped} mirrored` : ' · nothing mirrored yet'}
            </p>
            <Button size="lg" disabled={running || flipped === 0} onClick={() => void save()}>
              {runner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building…
                </>
              ) : (
                <>Mirror {flipped} page{flipped === 1 ? '' : 's'}</>
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

function FlipTileCard({
  tile,
  displayNumber,
  mirror,
  disabled,
  onToggle,
}: {
  tile: PageTile;
  displayNumber: number;
  mirror: Axis | null;
  disabled: boolean;
  onToggle: (axis: Axis) => void;
}) {
  const transform = [
    mirror === 'h' || mirror === 'both' ? 'scaleX(-1)' : '',
    mirror === 'v' || mirror === 'both' ? 'scaleY(-1)' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={`group relative overflow-hidden rounded-lg border bg-card transition-colors ${
        mirror ? 'border-primary/60' : 'border-border hover:border-primary/50'
      }`}
    >
      <div
        className="w-full overflow-hidden bg-muted"
        style={{ aspectRatio: `${tile.width} / ${tile.height}` }}
      >
        <img
          src={tile.url}
          alt={`Page ${displayNumber}`}
          loading="lazy"
          draggable={false}
          className="h-full w-full object-contain transition-transform duration-200"
          style={{ transform }}
        />
      </div>

      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
        {displayNumber}
        {mirror ? ' · flipped' : ''}
      </span>

      <div className="absolute right-1 top-1 flex gap-1">
        <button
          type="button"
          aria-pressed={mirror === 'h' || mirror === 'both'}
          aria-label={`Flip page ${displayNumber} horizontally`}
          disabled={disabled}
          onClick={() => onToggle('h')}
          className={`rounded-md p-1.5 transition-colors disabled:opacity-40 ${
            mirror === 'h' || mirror === 'both'
              ? 'bg-primary text-primary-foreground'
              : 'bg-black/55 text-white hover:bg-black/80'
          }`}
        >
          <FlipHorizontal className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-pressed={mirror === 'v' || mirror === 'both'}
          aria-label={`Flip page ${displayNumber} vertically`}
          disabled={disabled}
          onClick={() => onToggle('v')}
          className={`rounded-md p-1.5 transition-colors disabled:opacity-40 ${
            mirror === 'v' || mirror === 'both'
              ? 'bg-primary text-primary-foreground'
              : 'bg-black/55 text-white hover:bg-black/80'
          }`}
        >
          <FlipVertical className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function omitKey(
  record: Record<string, Axis>,
  id: string,
): Record<string, Axis> {
  const { [id]: _removed, ...rest } = record;
  void _removed;
  return rest;
}
