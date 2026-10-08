import { zipSync, type Zippable } from 'fflate';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Packs entries into a zip archive. Deterministic for a given input set. */
export function createZip(entries: ZipEntry[]): Uint8Array {
  // Names are made unique here, not by callers: a repeated name used to overwrite
  // the earlier entry with no error, silently dropping a file from the archive.
  const names = dedupeNames(entries.map((entry) => entry.name));
  const payload: Zippable = {};
  entries.forEach((entry, i) => {
    payload[names[i]!] = [entry.data, { level: 6 }];
  });
  return zipSync(payload, { level: 6 });
}

/** `report.pdf` -> `report` */
export function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/**
 * Zero-padded page numbering so extracted files sort correctly: page-7.jpg of a
 * 100 page document becomes page-007.jpg, and lexical sort matches numeric sort.
 */
export function pageFileName(prefix: string, pageNumber: number, total: number, extension: string): string {
  const width = String(Math.max(1, total)).length;
  const index = String(pageNumber).padStart(width, '0');
  return `${prefix}-${index}.${extension}`;
}

/** Collapses duplicate names so a zip can never contain two identical paths. */
export function dedupeNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    return `${stem}-${count + 1}${ext}`;
  });
}
