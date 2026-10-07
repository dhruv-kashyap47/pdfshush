/**
 * Path safety.
 *
 * Uploaded filenames and job ids both arrive from outside the server, so every
 * path in the work directory is built here and nowhere else. `resolveWithin`
 * is the last line of defence against `../` and absolute paths.
 */

import path from 'node:path';

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const UNSAFE_CHARS = /[^A-Za-z0-9._-]+/g;
const MAX_BASE_LENGTH = 96;

export class UnsafePathError extends Error {
  constructor(input: string) {
    super(`Refusing to use path outside the work directory: ${JSON.stringify(input)}`);
    this.name = 'UnsafePathError';
  }
}

/**
 * Turns an attacker-supplied filename into a boring, safe basename:
 * no directories, no control characters, no leading dots, bounded length.
 */
export function safeFileName(input: string, fallback = 'upload'): string {
  const base = input.split(/[\\/]/).pop() ?? '';
  let cleaned = base
    .replace(CONTROL_CHARS, '')
    .replace(UNSAFE_CHARS, '_')
    .replace(/^\.+/, '')
    .trim();
  if (cleaned.length === 0) cleaned = fallback;

  if (cleaned.length > MAX_BASE_LENGTH) {
    const extension = path.extname(cleaned).slice(0, 12);
    const stem = cleaned.slice(0, MAX_BASE_LENGTH - extension.length);
    cleaned = `${stem}${extension}`;
  }
  return cleaned;
}

/** Same as `safeFileName`, but guarantees the given extension suffix. */
export function withExtension(name: string, extension: string): string {
  const safe = safeFileName(name);
  return safe.toLowerCase().endsWith(extension.toLowerCase()) ? safe : `${safe}${extension}`;
}

/** Job ids come from URL params; keep them to a safe alphabet and length. */
export function safeJobId(input: string): string {
  const cleaned = input.replace(UNSAFE_CHARS, '');
  if (!/^[A-Za-z0-9]{8,64}$/.test(cleaned)) throw new UnsafePathError(input);
  return cleaned;
}

/** Joins segments under `root` and refuses anything that escapes it. */
export function resolveWithin(root: string, ...segments: string[]): string {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, ...segments);
  const rootWithSep = absoluteRoot.endsWith(path.sep)
    ? absoluteRoot
    : absoluteRoot + path.sep;
  if (target !== absoluteRoot && !target.startsWith(rootWithSep)) {
    throw new UnsafePathError(segments.join('/'));
  }
  return target;
}