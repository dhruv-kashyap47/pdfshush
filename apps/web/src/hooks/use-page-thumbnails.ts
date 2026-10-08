import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  timeoutForPageCount,
  type InspectOutput,
  type ThumbnailsOutput,
} from '@pdfshush/pdf-core';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity, announceCapacityWarning } from '@/lib/client-capacity';
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

  /**
   * Monotonic id for `prepare` calls. A grid tool can be re-entered while the
   * previous prepare is still rendering (the user picks a second set of files,
   * or hits "clear" mid-load), and without this the slower request installs its
   * tiles and file list over the newer one -- the grid then shows pages from a
   * document that is no longer loaded, which is the same class of bug as the
   * editor's stale page cache.
   */
  const loadSequence = useRef(0);

  /** True while this call is still the newest request. */
  const isCurrent = (id: number) => id === loadSequence.current;

  const prepare = useCallback(
    async (incoming: File[], options: PrepareOptions = {}): Promise<boolean> => {
      const request = ++loadSequence.current;
      if (incoming.length === 0) {
        revokeUrls();
        setTiles([]);
        setFiles([]);
        setPreparing(false);
        return true;
      }

      const byteVerdict = checkClientCapacity({
        fileCount: incoming.length,
        totalBytes: totalBytes(incoming),
        largestFileBytes: largestBytes(incoming),
      });
      if (!byteVerdict.ok) {
        if (isCurrent(request)) setPreparing(false);
        toast.error(byteVerdict.message);
        return false;
      }
      announceCapacityWarning(byteVerdict);

      setPreparing(true);
      // Old object URLs are revoked only after the new ones exist (below):
      // revoking up-front meant a failed re-upload left the previous grid
      // pointing at dead blob URLs -- broken thumbnails with no explanation.

      // Inspect first: page count decides whether rendering previews is safe.
      const inspected = await inspectRunner.run(await readAsInputFiles(incoming));
      if (!isCurrent(request)) return false; // superseded mid-inspect
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
      announceCapacityWarning(pageVerdict);
      options.onInspected?.(inspected.result);

      // Thumbnail width degradation for huge documents lives in the engine
      // (LIMITS.client.thumbnailDegradeAtPages) -- one source of truth.
      const outcome = await thumbsRunner.run(
        await readAsInputFiles(incoming),
        options.pageIndexes ? { pageIndexes: options.pageIndexes } : {},
        { timeoutMs: timeoutForPageCount(Math.max(pageCount, 60)) },
      );
      if (!isCurrent(request)) return false; // superseded mid-render
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
      // Swap only now: the fresh URLs exist, so the previous grid is replaced
      // rather than broken.
      revokeUrls();
      urlsRef.current = created;
      setFiles(incoming);
      setTiles(next);
      return true;
    },
    [inspectRunner, thumbsRunner, revokeUrls],
  );

  const reset = useCallback(() => {
    // Bump the sequence so a prepare that is still rendering cannot reinstall
    // its tiles after the user has cleared the grid.
    loadSequence.current += 1;
    inspectRunner.cancel();
    thumbsRunner.cancel();
    revokeUrls();
    setTiles([]);
    setFiles([]);
    setPreparing(false);
  }, [revokeUrls, inspectRunner.cancel, thumbsRunner.cancel]);

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
