import type { JobInputBase, JobInputFile } from '../job.js';
import type { SourceDocument } from '../ops/compose.js';

export function toSources(files: JobInputFile[]): SourceDocument[] {
  return files.map((file) => ({
    name: file.name,
    data: file.data,
    ...(file.password ? { password: file.password } : {}),
  }));
}

export function totalInputBytes(input: JobInputBase): number {
  let total = 0;
  for (const file of input.files) total += file.data.byteLength;
  return total;
}

export function baseName(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const file = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

/**
 * Returns a buffer the host can transfer (zero-copy) rather than
 * structured-clone. Copies only when the view is a window onto a larger buffer.
 */
export function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer as ArrayBuffer;
  }
  return view.slice().buffer as ArrayBuffer;
}