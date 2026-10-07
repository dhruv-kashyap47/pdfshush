import { useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FileText, GripVertical, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  timeoutForPageCount,
  type InspectOutput,
  type MergeJobOutput,
} from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import { announceCapacityWarning, checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { formatBytes } from '@/lib/format';
import { largestBytes, readAsInputFiles, shortName, totalBytes } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

interface Entry {
  id: string;
  file: File;
  status: 'loading' | 'ok' | 'error';
  pageCount?: number;
  error?: string;
}

export function MergeTool() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [reverse, setReverse] = useState(false);
  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const mergeRunner = useJobRunner<MergeJobOutput>('merge');
  const busyRef = useRef(false);

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      setEntries([]);
      return;
    }
    if (busyRef.current) return;

    const verdict = checkClientCapacity({
      fileCount: incoming.length,
      totalBytes: totalBytes(incoming),
      largestFileBytes: largestBytes(incoming),
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    announceCapacityWarning(verdict);

    busyRef.current = true;
    setEntries(incoming.map((file) => ({ id: crypto.randomUUID(), file, status: 'loading' as const })));

    const outcome = await inspectRunner.run(await readAsInputFiles(incoming));
    busyRef.current = false;

    if (!outcome.ok) {
      // Aborted runs must not leave rows stuck on "reading…" -- that state
      // permanently blocks merging with a confusing "remove files" toast.
      setEntries((prev) =>
        prev.map((entry) =>
          entry.status === 'loading'
            ? { ...entry, status: 'error' as const, error: 'Reading was interrupted — re-add the file' }
            : entry,
        ),
      );
      if (!outcome.aborted) {
        toast.error(outcome.message);
        setEntries([]);
      }
      return;
    }

    setEntries((prev) =>
      prev.map((entry, index) => {
        const doc = outcome.result.documents[index];
        if (!doc) return { ...entry, status: 'error' as const, error: 'Could not read file' };
        if (doc.encrypted) {
          return { ...entry, status: 'error' as const, error: 'Password protected — not supported yet' };
        }
        return { ...entry, status: 'ok' as const, pageCount: doc.pageCount };
      }),
    );
  };

  const runMerge = async () => {
    if (entries.length === 0 || mergeRunner.state.status === 'running') return;
    const failed = entries.filter((entry) => entry.status !== 'ok');
    if (failed.length > 0) {
      toast.error('Remove files that could not be read before merging.');
      return;
    }

    const pages = entries.reduce((sum, entry) => sum + (entry.pageCount ?? 20), 0);
    const outcome = await mergeRunner.run(
      await readAsInputFiles(entries.map((entry) => entry.file)),
      { reverse },
      { timeoutMs: timeoutForPageCount(pages) },
    );

    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }

    void recordRecent({
      toolSlug: 'merge-pdf',
      toolName: 'Merge PDF files',
      fileName: outcome.result.fileName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  };

  const removeEntry = (id: string) => setEntries((prev) => prev.filter((entry) => entry.id !== id));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setEntries((prev) => {
      const oldIndex = prev.findIndex((entry) => entry.id === active.id);
      const newIndex = prev.findIndex((entry) => entry.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const running = mergeRunner.state.status === 'running' || inspectRunner.state.status === 'running';

  if (mergeRunner.state.status === 'done') {
    const { result } = mergeRunner.state;
    return (
      <ResultPanel
        fileName={result.fileName}
        pageCount={result.pageCount}
        sizeBytes={result.data.byteLength}
        onDownload={() => downloadBytes(result.data, result.fileName)}
        onReset={() => {
          mergeRunner.reset();
          setEntries([]);
        }}
        footerNote={
          result.sources.length > 1 ? (
            <span>
              {result.sources.length} documents merged:{' '}
              {result.sources.map((source) => `${source.name} (${source.pageCount}p)`).join(', ')}
            </span>
          ) : null
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone files={entries.map((entry) => entry.file)} onFiles={handleFiles} disabled={running} />

      {entries.length > 1 && mergeRunner.state.status !== 'running' && (
        <p className="text-xs text-muted-foreground">
          Drag files to set the order — pages are concatenated top to bottom.
        </p>
      )}

      {entries.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={entries.map((entry) => entry.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {entries.map((entry, index) => (
                <MergeRow
                  key={entry.id}
                  entry={entry}
                  index={index}
                  disabled={running}
                  onRemove={() => removeEntry(entry.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {entries.length > 0 && (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Checkbox id="merge-reverse" checked={reverse} onCheckedChange={(value) => setReverse(value === true)} />
            <Label htmlFor="merge-reverse" className="text-sm font-normal cursor-pointer">
              Reverse order
            </Label>
            <span className="ml-2 text-xs text-muted-foreground">
              {entries.length} file{entries.length === 1 ? '' : 's'}
              {entries.every((entry) => entry.pageCount !== undefined)
                ? ` · ${entries.reduce((sum, entry) => sum + (entry.pageCount ?? 0), 0)} pages`
                : ''}
            </span>
          </div>
          <Button size="lg" disabled={running || entries.length === 0} onClick={() => void runMerge()}>
            {mergeRunner.state.status === 'running' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Merging…
              </>
            ) : (
              <>Merge {entries.length} file{entries.length === 1 ? '' : 's'}</>
            )}
          </Button>
        </div>
      )}

      {mergeRunner.state.status === 'running' && (
        <JobProgressPanel progress={mergeRunner.state.progress} onCancel={mergeRunner.cancel} />
      )}
      {inspectRunner.state.status === 'running' && entries.some((e) => e.status === 'loading') && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading documents…
        </p>
      )}
    </div>
  );
}

function MergeRow({
  entry,
  index,
  disabled,
  onRemove,
}: {
  entry: Entry;
  index: number;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 ${
        isDragging ? 'border-primary shadow-lg z-10 relative' : 'border-border'
      }`}
    >
      <button
        type="button"
        className={`cursor-grab touch-none text-muted-foreground hover:text-foreground ${disabled ? 'opacity-40' : ''}`}
        aria-label="Drag to reorder"
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <FileText className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          <span className="mr-2 text-muted-foreground">{index + 1}.</span>
          {shortName(entry.file.name)}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(entry.file.size)}
          {entry.status === 'ok' && entry.pageCount !== undefined && ` · ${entry.pageCount} pages`}
          {entry.status === 'loading' && ' · reading…'}
          {entry.status === 'error' && <span className="text-destructive"> · {entry.error}</span>}
        </p>
      </div>
      {entry.status === 'loading' && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        aria-label={`Remove ${entry.file.name}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <X className="h-4 w-4" />
      </Button>
    </li>
  );
}
