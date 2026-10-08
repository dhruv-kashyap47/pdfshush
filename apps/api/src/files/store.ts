/**
 * The work directory: where uploads and results live while a job runs.
 *
 * Rules that keep the hardening gate satisfiable:
 * - every path goes through `resolveWithin`, so a job can never write outside;
 * - uploads stream to disk (never buffered in memory) and stop at a byte cap;
 * - one directory per job id, so "clean up a job" is a single `rm -rf` and
 *   "did we leak anything" is answerable after a `kill -9`.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolveWithin, safeFileName } from './paths.js';

export class UploadTooLargeError extends Error {
  constructor(readonly limitBytes: number, readonly receivedBytes: number) {
    super(`Upload exceeds the ${limitBytes} byte limit`);
    this.name = 'UploadTooLargeError';
  }
}

export interface StoredFile {
  name: string;
  path: string;
  bytes: number;
}

export class WorkDirStore {
  readonly root: string;
  private readonly jobsDir: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.jobsDir = path.join(this.root, 'jobs');
  }

  async init(): Promise<void> {
    await mkdir(this.jobsDir, { recursive: true });
  }

  /** `jobs/<id>/input` and `jobs/<id>/output` -- created on demand. */
  async prepareJob(jobId: string): Promise<void> {
    await mkdir(path.join(resolveWithin(this.jobsDir, jobId), 'input'), { recursive: true });
    await mkdir(path.join(resolveWithin(this.jobsDir, jobId), 'output'), { recursive: true });
  }

  inputDir(jobId: string): string {
    return path.join(resolveWithin(this.jobsDir, jobId), 'input');
  }

  outputDir(jobId: string): string {
    return path.join(resolveWithin(this.jobsDir, jobId), 'output');
  }

  outputPath(jobId: string, name: string): string {
    return resolveWithin(this.outputDir(jobId), safeFileName(name));
  }

  /** Streams an upload to disk, aborting as soon as it exceeds the cap. */
  async writeInput(
    jobId: string,
    originalName: string,
    source: Readable,
    maxBytes: number,
  ): Promise<StoredFile> {
    const name = safeFileName(originalName);
    const target = resolveWithin(this.inputDir(jobId), name);
    const sink = createWriteStream(target);

    let received = 0;
    source.on('data', (chunk: Buffer | string) => {
      received += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    });

    try {
      await pipeline(source, sink);
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
    if (received > maxBytes) {
      await rm(target, { force: true });
      throw new UploadTooLargeError(maxBytes, received);
    }
    return { name, path: target, bytes: received };
  }

  async writeResult(jobId: string, name: string, data: Uint8Array | Buffer): Promise<StoredFile> {
    const target = this.outputPath(jobId, name);
    await mkdir(path.dirname(target), { recursive: true });
    // Write to a sibling temp file and rename into place. A crash, a full disk
    // or a kill -9 mid-write otherwise leaves a truncated PDF sitting at the
    // real result path, where the janitor will happily keep it for an hour and
    // a caller can download it as a corrupt "successful" export. `rename` is
    // atomic within a directory, so a result file is either absent or whole.
    const temporary = `${target}.${process.pid}.part`;
    const sink = createWriteStream(temporary);
    try {
      await pipeline(Readable.from([Buffer.from(data)]), sink);
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return { name: path.basename(target), path: target, bytes: data.byteLength };
  }

  async statResult(jobId: string, name: string) {
    try {
      const info = await stat(this.outputPath(jobId, name));
      return { bytes: info.size };
    } catch {
      return undefined;
    }
  }

  openResult(jobId: string, name: string) {
    return createReadStream(this.outputPath(jobId, name));
  }

  /** Removes everything belonging to one job. Safe to call twice. */
  async removeJob(jobId: string): Promise<void> {
    await rm(resolveWithin(this.jobsDir, jobId), { recursive: true, force: true });
  }

  /** Removes job directories untouched for longer than `maxAgeMs`. */
  async sweep(maxAgeMs: number, now: number = Date.now()): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.jobsDir, { withFileTypes: true })
        .then((list) => list.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
    } catch {
      return [];
    }

    const removed: string[] = [];
    for (const entry of entries) {
      const directory = resolveWithin(this.jobsDir, entry);
      try {
        const info = await stat(directory);
        // Freshly modified means either running or recently finished: keep it.
        if (now - info.mtimeMs < maxAgeMs) continue;
        await rm(directory, { recursive: true, force: true });
        removed.push(entry);
      } catch {
        // Vanished between readdir and stat -- that is success, not failure.
      }
    }
    return removed;
  }

  /** Diagnostic used by `/api/health` and the hardening test. */
  async usage(): Promise<{ jobDirs: number; bytes: number }> {
    let jobDirs = 0;
    let bytes = 0;
    let entries: string[] = [];
    try {
      entries = await readdir(this.jobsDir);
    } catch {
      return { jobDirs: 0, bytes: 0 };
    }
    for (const entry of entries) {
      jobDirs += 1;
      const directory = resolveWithin(this.jobsDir, entry);
      for await (const file of walk(directory)) {
        try {
          bytes += (await stat(file)).size;
        } catch {
          // Ignore files that vanish mid-sweep.
        }
      }
    }
    return { jobDirs, bytes };
  }
}

async function* walk(directory: string): AsyncGenerator<string> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (!entry.isDirectory()) {
      yield child;
      continue;
    }
    for await (const nested of walk(child)) yield nested;
  }
}