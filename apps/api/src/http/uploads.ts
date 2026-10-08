/**
 * Multipart upload handling.
 *
 * Uploads stream straight to disk (never buffered in memory) and stop the
 * moment they exceed the cap -- a 500 MB limit must not become a 500 MB heap.
 * Nothing about the request is trusted: filenames are sanitised, and the number
 * of files is bounded before anything is written.
 */

import busboy from 'busboy';
import type { Request } from 'express';
import type { WorkDirStore, StoredFile } from '../files/store.js';
import { UploadTooLargeError } from '../files/store.js';
import { safeFileName } from '../files/paths.js';

export interface UploadResult {
  files: StoredFile[];
  fields: Record<string, string>;
  totalBytes: number;
}

export interface UploadLimits {
  /** Cap for a single file. */
  maxBytes: number;
  /** Cap for every file in one request combined. Defaults to `maxBytes`. */
  maxTotalBytes?: number;
  maxFiles: number;
  /** Optional allowlist on the original extension. */
  allowedExtensions?: string[];
}

export class InvalidUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUploadError';
  }
}

/** The body itself is not parseable multipart: a client error, so 400 not 500. */
export class BadMultipartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadMultipartError';
  }
}

const FIELD_KEYS = new Set(['slug', 'password', 'options']);

/**
 * Ceiling on a single text field. `options` is the only field that can grow with
 * the document (a 500-page page order), so an oversized one is refused with the
 * real reason rather than silently truncated: truncation turns a big page order
 * into invalid JSON, and the caller is told "not valid JSON" for what is
 * actually an over-limit request.
 */
const MAX_FIELD_CHARS = 8_192;

export function receiveUpload(
  request: Request,
  store: WorkDirStore,
  jobId: string,
  limits: UploadLimits,
): Promise<UploadResult> {
  return new Promise<UploadResult>((resolve, reject) => {
    const contentType = request.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      reject(new InvalidUploadError('Expected multipart/form-data'));
      return;
    }

    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: request.headers,
        limits: {
          files: limits.maxFiles,
          fileSize: limits.maxBytes,
          fields: 8,
          fieldSize: 64 * 1024,
        },
      });
    } catch (error) {
      reject(new BadMultipartError(error instanceof Error ? error.message : 'Bad multipart body'));
      return;
    }

    const files: StoredFile[] = [];
    const fields: Record<string, string> = {};
    const maxTotalBytes = limits.maxTotalBytes ?? limits.maxBytes;
    /**
     * Bytes committed by finished files -- the running total charged to quota.
     */
    let totalBytes = 0;
    /**
     * Bytes seen so far across *every* file, including in-flight ones. This has
     * to be shared: files are written concurrently, so per-file counters each
     * start at zero and a request of `maxFiles` small files sails under any
     * per-file cap no matter how large it gets.
     */
    let streamedBytes = 0;
    let settled = false;
    const pending: Promise<void>[] = [];

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      request.unpipe(parser);
      // Awaited, not fire-and-forget: "a rejected request leaves nothing on
      // disk" has to hold when the response is written, or a caller that
      // immediately uploads again races its own leftovers.
      const cleanup = store.removeJob(jobId);
      // The client may still be uploading. Let the error handler write the
      // response first, then close the socket instead of leaving a half-read
      // request hanging -- which is what made this path flaky. Cleanup is
      // awaited before rejecting so a caller that immediately retries cannot
      // race its own leftovers.
      cleanup
        .catch(() => undefined)
        .then(() => {
          if (!request.complete) request.destroy();
          reject(error);
        });
    };

    parser.on('field', (name, value) => {
      // Ignore unexpected field names entirely rather than storing them.
      if (!FIELD_KEYS.has(name)) return;
      if (value.length > MAX_FIELD_CHARS) {
        fail(
          new InvalidUploadError(
            `The "${name}" field is ${value.length} characters; the limit is ${MAX_FIELD_CHARS}.`,
          ),
        );
        return;
      }
      fields[name] = value;
    });

    parser.on('file', (_fieldName, stream, info) => {
      const originalName = info.filename ?? '';
      if (originalName.length === 0) {
        stream.resume();
        return;
      }
      const sanitised = safeFileName(originalName);
      const extension = sanitised.toLowerCase();
      if (
        limits.allowedExtensions &&
        !limits.allowedExtensions.some((allowed) => extension.endsWith(allowed))
      ) {
        stream.resume();
        fail(new InvalidUploadError(`Unsupported file type: ${extension}`));
        return;
      }
      // Two parts whose names sanitise to the same basename would resolve to one
      // path and the second write would truncate the first -- merge then silently
      // returned the same document twice with one upload missing.
      const taken = new Set(files.filter((file) => file.name).map((file) => file.name));
      let name = sanitised;
      for (let suffix = 2; taken.has(name); suffix += 1) {
        const dot = sanitised.lastIndexOf('.');
        name =
          dot > 0
            ? `${sanitised.slice(0, dot)}-${suffix}${sanitised.slice(dot)}`
            : `${sanitised}-${suffix}`;
      }

      stream.on('limit', () => {
        fail(new UploadTooLargeError(limits.maxBytes, totalBytes));
      });

      // The per-file cap alone does not bound a *request*: 50 files of 500 MB
      // each is 25 GB of anonymous disk writes, and the daily byte quota is only
      // charged once the whole body has landed. Counting as bytes arrive (not
      // when a file finishes) is what makes the total a real ceiling.
      stream.on('data', (chunk: Buffer | string) => {
        if (settled) return;
        streamedBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
        if (streamedBytes > maxTotalBytes) {
          // Destroying the stream unwinds the in-flight write, so the partial
          // file never reaches the disk in the first place.
          stream.destroy();
          fail(new UploadTooLargeError(maxTotalBytes, streamedBytes));
        }
      });

      // Files are written concurrently, so completion order is not upload
      // order -- and merge (and anything else positional) depends on the order
      // the client sent. Reserve a slot now and fill it when the write lands.
      const slot = files.length;
      files.push({ name: '', path: '', bytes: 0 });
      pending.push(
        store
          .writeInput(jobId, name, stream, limits.maxBytes)
          .then((stored) => {
            if (settled) return;
            totalBytes += stored.bytes;
            files[slot] = stored;
          })
          .catch((error: unknown) => {
            files.length = slot; // drop the placeholder
            throw error;
          }),
      );
    });

    parser.on('error', (error: unknown) => {
      fail(new BadMultipartError(error instanceof Error ? error.message : 'Bad multipart body'));
    });

    parser.on('close', () => {
      if (settled) return;
      void Promise.all(pending)
        .then(() => {
          if (files.length === 0) {
            fail(new InvalidUploadError('No files were uploaded'));
            return;
          }
          settled = true;
          resolve({ files, fields, totalBytes });
        })
        .catch(fail);
    });

    request.pipe(parser);
  });
}
