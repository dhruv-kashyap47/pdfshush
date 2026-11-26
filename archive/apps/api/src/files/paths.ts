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

/**
 * A name that is both safe and unused, computed from the *final* sanitised form.
 *
 * Upload parts are written concurrently, so two parts must never resolve to the
 * same path. Sanitising after choosing a suffix is not enough: `a b.pdf` and
 * `a_b.pdf` sanitise to one name, and a `-2` suffix appended to a maximum-length
 * name is truncated straight back off by `safeFileName`. Both cases overwrote an
 * earlier upload, and the job then ran with one document twice.
 *
 * The candidate is verified through `safeFileName` so a second sanitisation
 * (the store's own defence) cannot change it back into a collision.
 */
export function uniqueFileName(sanitised: string, taken: ReadonlySet<string>): string {
  if (!taken.has(sanitised)) return sanitised;

  const dot = sanitised.lastIndexOf('.');
  // `safeFileName` only preserves 12 extension characters when it truncates.
  const extension = dot > 0 ? sanitised.slice(dot).slice(0, 12) : '';
  const stem = dot > 0 ? sanitised.slice(0, dot) : sanitised;

  for (let suffix = 2; suffix <= MAX_BASE_LENGTH + 2; suffix += 1) {
    const tail = `-${suffix}`;
    const room = Math.max(1, MAX_BASE_LENGTH - extension.length - tail.length);
    const candidate = `${stem.slice(0, room)}${tail}${extension}`;
    if (!taken.has(candidate) && safeFileName(candidate) === candidate) return candidate;
  }
  throw new UnsafePathError(`${sanitised} (no unique name available)`);
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