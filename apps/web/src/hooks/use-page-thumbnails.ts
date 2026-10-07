import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  timeoutForPageCount,
  type InspectOutput,
  type ThumbnailsOutput,
} from '@pdfshush/pdf-core';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity } from '@/lib/client-capacity';
import { largestBytes, readAsInputFiles, totalBytes } from '@/lib/files';

export interface PageTile {
  id: string;
  docIndex: number;
  pageIndex: number;
  url: string;
  width: number;
  height: number;
}

interface PrepareOptions {
  /** Limit preview rendering to these page indexes (Crop only needs page 1). */
  pageIndexes?: number[];
  /** Also passed to the real job later, so tools can re-run inspect cheaply. */
  onInspected?: (info: InspectOutput) => void;
}

/**
 * Shared pipeline for grid tools (Organize, Delete, Rotate, Crop): capacity
 * check -> inspect -> thumbnails -> object-URL tiles, with cleanup on unmount.
 *
 * Extracted so every grid tool gets the same guard rails (encrypted-file
 * rejection, page caps, small-thumb degradation for huge docs) for free.
 */
export function usePageThumbnails() {
  const [files, setFiles] = useState<File[]>([]);
  const [tiles, setTiles] = useState<PageTile[]>([]);
  const [preparing, setPreparing] = useState(false);
  const urlsRef = useRef<string[]>([]);

  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const thumbsRunner = useJobRunner<ThumbnailsOutput>('thumbnails');

  const revokeUrls = useCallback(() => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
  }, []);
  useEffect(() => () => revokeUrls(), [revokeUrls]);

  const prepare = useCallback(
    async (incoming: File[], options: PrepareOptions = {}): Promise<boolean> => {
      if (incoming.length === 0) {
        revokeUrls();
        setTiles([]);
        setFiles([]);
        return true;
      }

      const byteVerdict = checkClientCapacity({
        fileCount: incoming.length,
        totalBytes: totalBytes(incoming),
        largestFileBytes: largestBytes(incoming),
      });
      if (!byteVerdict.ok) {
        toast.error(byteVerdict.message);
        return false;
      }

      setPreparing(true);
      revokeUrls();

      // Inspect first: page count decides whether rendering previews is safe.
      const inspected = await inspectRunner.run(await readAsInputFiles(incoming));
      if (!inspected.ok) {
        setPreparing(false);
        if (!inspected.aborted) toast.error(inspected.message);
        return false;
      }
      const pageCount = inspected.result.documents.reduce((sum, doc) => sum + doc.pageCount, 0);
      const encrypted = inspected.result.documents.find((doc) => doc.encrypted);
      if (encrypted) {
        setPreparing(false);
        toast.error(`"${encrypted.name}" is password protected — remove it or unlock it first.`);
        return false;
      }

      const pageVerdict = checkClientCapacity({
        fileCount: incoming.length,
        totalBytes: totalBytes(incoming),
        pageCount,
      });
      if (!pageVerdict.ok) {
        setPreparing(false);
        toast.error(pageVerdict.message);
        return false;
      }
      options.onInspected?.(inspected.result);

      const renderedCount = options.pageIndexes?.length ?? pageCount;
      const targetWidthPx = renderedCount > 250 ? 110 : undefined;
      const outcome = await thumbsRunner.run(
        await readAsInputFiles(incoming),
        {
          ...(targetWidthPx ? { targetWidthPx } : {}),
          ...(options.pageIndexes ? { pageIndexes: options.pageIndexes } : {}),
        },
        { timeoutMs: timeoutForPageCount(Math.max(pageCount, 60)) },
      );
      setPreparing(false);

      if (!outcome.ok) {
        if (!outcome.aborted) toast.error(outcome.message);
        return false;
      }

      const created: string[] = [];
      const next: PageTile[] = [];
      outcome.result.documents.forEach((doc, docIndex) => {
        doc.thumbnails.forEach((thumb, thumbIndex) => {
          const pageIndex = options.pageIndexes?.[thumbIndex] ?? thumbIndex;
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
      return true;
    },
    [inspectRunner, thumbsRunner, revokeUrls],
  );

  const reset = useCallback(() => {
    revokeUrls();
    setTiles([]);
    setFiles([]);
    setPreparing(false);
  }, [revokeUrls]);

  const busy =
    preparing ||
    inspectRunner.state.status === 'running' ||
    thumbsRunner.state.status === 'running';

  const cancel = useCallback(() => {
    thumbsRunner.cancel();
    inspectRunner.cancel();
  }, [thumbsRunner, inspectRunner]);

  const progress =
    thumbsRunner.state.status === 'running'
      ? thumbsRunner.state.progress
      : inspectRunner.state.status === 'running'
        ? inspectRunner.state.progress
        : null;

  return {
    files,
    tiles,
    setTiles,
    preparing,
    busy,
    progress,
    prepare,
    reset,
    cancel,
    inspectRunner,
  } as const;
}
