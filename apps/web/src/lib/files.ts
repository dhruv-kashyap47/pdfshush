import type { JobInputFile } from '@pdfshush/pdf-core';
import { toast } from 'sonner';

export const PDF_MIME = 'application/pdf';

/** Accept attribute: PDFs by extension and mime (Windows ignores one or the other). */
export const PDF_ACCEPT = '.pdf,application/pdf';

export function isPdfLike(file: File): boolean {
  return file.type === PDF_MIME || file.name.toLowerCase().endsWith('.pdf');
}

/**
 * Reads fresh bytes for a run.
 *
 * The worker pool TRANSFERS input buffers (they are detached on the main
 * thread), so tools must re-read from the original `File` for every run --
 * thumbnails first, then the real job.
 */
export async function readAsInputFiles(files: File[]): Promise<JobInputFile[]> {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      type: file.type || PDF_MIME,
      data: new Uint8Array(await file.arrayBuffer()),
    })),
  );
}

/**
 * `readAsInputFiles` with a user-facing failure instead of an unhandled
 * rejection.
 *
 * A picked file can become unreadable between the picker and the read: it was
 * renamed or deleted, is locked by another program, or lives on a volume that
 * went away (`NotReadableError`). Callers that evaluate the read inline --
 * `runner.run(await readAsInputFiles(files), ...)` -- throw before the runner's
 * own error handling ever sees it, leaving the tool silent. This variant
 * returns `null` after showing one toast, so the caller only has to bail.
 */
export async function readAsInputFilesOrToast(
  files: File[],
): Promise<JobInputFile[] | null> {
  try {
    return await readAsInputFiles(files);
  } catch (error) {
    console.warn('[files] reading the picked file failed:', error);
    toast.error('Could not read the selected file. Try picking it again.');
    return null;
  }
}

export function totalBytes(files: File[]): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}

export function largestBytes(files: File[]): number {
  return files.reduce((max, file) => Math.max(max, file.size), 0);
}

/** Short display name: keeps the extension but trims very long names. */
export function shortName(name: string, max = 42): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  return `${name.slice(0, max - ext.length - 1)}…${ext}`;
}
