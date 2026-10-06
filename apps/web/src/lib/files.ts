import type { JobInputFile } from '@pdfshush/pdf-core';

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
