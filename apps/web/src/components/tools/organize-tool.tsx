import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Copy, Grip, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  LIMITS,
  timeoutForPageCount,
  type InspectOutput,
  type OrganizeJobOutput,
  type ThumbnailsOutput,
} from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, totalBytes } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

interface PageTile {
  id: string;
  docIndex: number;
  pageIndex: number;
  url: string;
  width: number;
  height: number;
}

export function OrganizeTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [tiles, setTiles] = useState<PageTile[]>([]);
  const [preparing, setPreparing] = useState(false);
  const urlsRef = useRef<string[]>([]);

  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const thumbsRunner = useJobRunner<ThumbnailsOutput>('thumbnails');
  const organizeRunner = useJobRunner<OrganizeJobOutput>('organize');

  const revokeUrls = () => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
  };
  useEffect(() => () => revokeUrls(), []);

  const prepare = async (incoming: File[]) => {
    if (incoming.length === 0) {
      revokeUrls();
      setTiles([]);
      setFiles([]);
      return;
    }

    const byteVerdict = checkClientCapacity({
      fileCount: incoming.length,
      totalBytes: totalBytes(incoming),
      largestFileBytes: largestBytes(incoming),
    });
    if (!byteVerdict.ok) {
      toast.error(byteVerdict.message);
      return;
    }

    setPreparing(true);
    revokeUrls();

    // Inspect first: page count decides whether rendering previews is safe at all.
    const inspected = await inspectRunner.run(await readAsInputFiles(incoming));
    if (!inspected.ok) {
      setPreparing(false);
      if (!inspected.aborted) toast.error(inspected.message);
      return;
    }
    const pageCount = inspected.result.documents.reduce((sum, doc) => sum + doc.pageCount, 0);
    const encrypted = inspected.result.documents.find((doc) => doc.encrypted);
    if (encrypted) {
      setPreparing(false);
      toast.error(`"${encrypted.name}" is password protected — remove it or unlock it first.`);
      return;
    }

    const pageVerdict = checkClientCapacity({
      fileCount: incoming.length,
      totalBytes: totalBytes(incoming),
      pageCount,
    });
    if (!pageVerdict.ok) {
      setPreparing(false);
      toast.error(pageVerdict.message);
      return;
    }

    const targetWidthPx = pageCount > 250 ? 110 : undefined;
    const outcome = await thumbsRunner.run(
      await readAsInputFiles(incoming),
      targetWidthPx ? { targetWidthPx } : undefined,
      { timeoutMs: timeoutForPageCount(Math.max(pageCount, 60)) },
    );
    setPreparing(false);

    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }

    const created: string[] = [];
    const next: PageTile[] = [];
    outcome.result.documents.forEach((doc, docIndex) => {
      doc.thumbnails.forEach((thumb, pageIndex) => {
        const url = URL.createObjectURL(new Blob([thumb.data], { type: thumb.mimeType }));
        created.push(url);
        next.push({
          id: `${docIndex}:${pageIndex}`,
          docIndex,
          pageIndex,
          url,
          width: thumb.width,
          height: thumb.height,
        });
      });
    });
    urlsRef.current = created;
    setFiles(incoming);
    setTiles(next);
  };

  const running =
    preparing || organizeRunner.state.status === 'running';

  const deleteTile = (id: string) => setTiles((prev) => prev.filter((tile) => tile.id !== id));

  const duplicateTile = (id: string) =>
    setTiles((prev) => {
      const index = prev.findIndex((tile) => tile.id === id);
      if (index < 0) return prev;
      const source = prev[index]!;
      const clone: PageTile = { ...source, id: `${source.id}#${crypto.randomUUID()}` };
      return [...prev.slice(0, index + 1), clone, ...prev.slice(index + 1)];
    });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setTiles((prev) => {
      const oldIndex = prev.findIndex((tile) => tile.id === active.id);
      const newIndex = prev.findIndex((tile) => tile.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const runOrganize = async () => {
    if (tiles.length === 0 || organizeRunner.state.status === 'running') return;
    const verdict = checkClientCapacity({
      fileCount: files.length,
      totalBytes: totalBytes(files),
      pageCount: tiles.length,
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }

    const outcome = await organizeRunner.run(
      await readAsInputFiles(files),
      { pageOrder: tiles.map((tile) => ({ docIndex: tile.docIndex, pageIndex: tile.pageIndex })) },
      { timeoutMs: timeoutForPageCount(tiles.length) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'organize-pdf',
      toolName: 'Organize pages',
      fileName: outcome.result.fileName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  };

  if (organizeRunner.state.status === 'done') {
    const { result } = organizeRunner.state;
    return (
      <ResultPanel
        fileName={result.fileName}
        pageCount={result.pageCount}
        sizeBytes={result.data.byteLength}
        onDownload={() => downloadBytes(result.data, result.fileName)}
        onReset={() => {
          organizeRunner.reset();
          revokeUrls();
          setTiles([]);
          setFiles([]);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone files={files} onFiles={(next) => void prepare(next)} disabled={running} hint="one PDF to start" multiple={false} />

      {(preparing || thumbsRunner.state.status === 'running') && (
        <JobProgressPanel
          progress={
            thumbsRunner.state.status === 'running'
              ? thumbsRunner.state.progress
              : inspectRunner.state.status === 'running'
                ? inspectRunner.state.progress
                : null
          }
          onCancel={() => {
            thumbsRunner.cancel();
            inspectRunner.cancel();
          }}
        />
      )}

      {tiles.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{tiles.length.toLocaleString()}</span>{' '}
              page{tiles.length === 1 ? '' : 's'} — drag to reorder, delete or duplicate below.
              {files.length > 1 && ' Multi-file order: document by document.'}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" disabled={running} onClick={() => void prepare(files)}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Restore original order
              </Button>
            </div>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={tiles.map((tile) => tile.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                {tiles.map((tile, index) => (
                  <PageTileCard
                    key={tile.id}
                    tile={tile}
                    displayNumber={index + 1}
                    disabled={running}
                    onDelete={() => deleteTile(tile.id)}
                    onDuplicate={() => duplicateTile(tile.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              Output: <span className="font-medium text-foreground">{tiles.length} pages</span>
              {tiles.length > LIMITS.client.maxPages && (
                <span className="text-destructive"> — over the {LIMITS.client.maxPages} page limit</span>
              )}
            </p>
            <Button size="lg" disabled={running || tiles.length === 0} onClick={() => void runOrganize()}>
              {organizeRunner.state.status === 'running' ? (
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

      {tiles.length === 0 && files.length > 0 && !preparing && (
        <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          All pages were removed. Re-add the file to start over.
        </div>
      )}

      {organizeRunner.state.status === 'running' && (
        <JobProgressPanel progress={organizeRunner.state.progress} onCancel={organizeRunner.cancel} />
      )}
    </div>
  );
}

function PageTileCard({
  tile,
  displayNumber,
  disabled,
  onDelete,
  onDuplicate,
}: {
  tile: PageTile;
  displayNumber: number;
  disabled: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tile.id,
  });

  const stop = (event: ReactPointerEvent) => event.stopPropagation();

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative overflow-hidden rounded-lg border bg-card ${
        isDragging ? 'z-20 relative border-primary shadow-xl' : 'border-border hover:border-primary/50'
      }`}
      {...attributes}
      {...listeners}
    >
      <div
        className="w-full overflow-hidden bg-muted"
        style={{ aspectRatio: `${tile.width} / ${tile.height}` }}
      >
        <img src={tile.url} alt={`Page ${displayNumber}`} loading="lazy" className="h-full w-full object-cover" draggable={false} />
      </div>

      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
        {displayNumber}
      </span>

      <div className="absolute right-1 top-1 flex gap-1">
        <button
          type="button"
          aria-label="Duplicate page"
          disabled={disabled}
          onPointerDown={stop}
          onClick={onDuplicate}
          className="rounded-md bg-black/55 p-1.5 text-white transition-colors hover:bg-black/80 disabled:opacity-40"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Delete page"
          disabled={disabled}
          onPointerDown={stop}
          onClick={onDelete}
          className="rounded-md bg-black/55 p-1.5 text-white transition-colors hover:bg-red-600 disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/55 p-1 text-white/80 opacity-0 transition-opacity group-hover:opacity-100">
        <Grip className="h-3 w-3" />
      </span>
    </div>
  );
}
