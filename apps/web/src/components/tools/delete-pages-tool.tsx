import { useState } from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { timeoutForPageCount, type OrganizeJobOutput } from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { useJobRunner } from '@/hooks/use-job-runner';
import { usePageThumbnails } from '@/hooks/use-page-thumbnails';
import { checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { readAsInputFiles, totalBytes } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

/**
 * Delete Pages: click pages to mark them, one button removes the marked set,
 * then save what remains. The engine call is plain Organize with the kept refs.
 */
export function DeletePagesTool() {
  const { files, tiles, setTiles, busy, progress, prepare, reset, cancel } = usePageThumbnails();
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const runner = useJobRunner<OrganizeJobOutput>('organize');

  const running = busy || runner.state.status === 'running';

  const toggle = (id: string) =>
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const removeMarked = () => {
    setTiles((prev) => prev.filter((tile) => !marked.has(tile.id)));
    setMarked(new Set());
  };

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

    const outcome = await runner.run(
      await readAsInputFiles(files),
      { pageOrder: tiles.map((tile) => ({ docIndex: tile.docIndex, pageIndex: tile.pageIndex })) },
      { timeoutMs: timeoutForPageCount(tiles.length) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'delete-pages',
      toolName: 'Delete Pages',
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
          setMarked(new Set());
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => {
          setMarked(new Set());
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
              page{tiles.length === 1 ? '' : 's'} — click the pages you want to remove.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={running}
                onClick={() => setMarked(new Set(tiles.map((tile) => tile.id)))}
              >
                Mark all
              </Button>
              <Button variant="ghost" size="sm" disabled={running || marked.size === 0} onClick={() => setMarked(new Set())}>
                Clear marks
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {tiles.map((tile, index) => {
              const isMarked = marked.has(tile.id);
              return (
                <button
                  key={tile.id}
                  type="button"
                  aria-label={`Mark page ${index + 1} for deletion`}
                  aria-pressed={isMarked}
                  disabled={running}
                  onClick={() => toggle(tile.id)}
                  className={`group relative overflow-hidden rounded-lg border bg-card text-left transition-colors disabled:opacity-60 ${
                    isMarked ? 'border-red-500 ring-2 ring-red-500/60' : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div
                    className="w-full overflow-hidden bg-muted"
                    style={{ aspectRatio: `${tile.width} / ${tile.height}` }}
                  >
                    <img
                      src={tile.url}
                      alt={`Page ${index + 1}`}
                      loading="lazy"
                      className={`h-full w-full object-cover transition-opacity ${isMarked ? 'opacity-40' : ''}`}
                      draggable={false}
                    />
                  </div>
                  <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
                    {index + 1}
                  </span>
                  {isMarked && (
                    <span className="pointer-events-none absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white">
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              {marked.size > 0 ? (
                <>
                  <span className="font-medium text-foreground">{marked.size}</span> page
                  {marked.size === 1 ? '' : 's'} marked for deletion ·{' '}
                  <span className="font-medium text-foreground">{tiles.length - marked.size}</span> will
                  remain
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">{tiles.length}</span> pages loaded —
                  none marked yet
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" disabled={running || marked.size === 0} onClick={removeMarked}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete selected{marked.size > 0 ? ` (${marked.size})` : ''}
              </Button>
              <Button size="lg" disabled={running || tiles.length === 0} onClick={() => void save()}>
                {runner.state.status === 'running' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building…
                  </>
                ) : (
                  <>
                    <RotateCcw className="mr-2 hidden h-4 w-4 sm:block" />
                    Save {tiles.length} page{tiles.length === 1 ? '' : 's'}
                  </>
                )}
              </Button>
            </div>
          </div>
        </>
      )}

      {tiles.length === 0 && files.length > 0 && !busy && (
        <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          Every page was deleted. Re-add the file to start over.
        </div>
      )}

      {runner.state.status === 'running' && (
        <JobProgressPanel progress={runner.state.progress} onCancel={runner.cancel} />
      )}
    </div>
  );
}
