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
/**
 * Output filename from an untrusted request: no directories, no traversal, no
 * control characters, always `.pdf`. Every job that accepts an `outputName`
 * uses this -- the name is written to disk on the server, so it must be safe.
 */
export function safeOutputName(requested: string | undefined, fallbackStem: string): string {
  const fallback = `${fallbackStem}.pdf`;
  if (typeof requested !== 'string') return fallback;
  const trimmed = requested.trim();
  if (!trimmed) return fallback;
  const base = trimmed.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  if (!cleaned) return fallback;
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}
