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
  maxBytes: number;
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

const FIELD_KEYS = new Set(['slug', 'password', 'options']);

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
      reject(new InvalidUploadError(error instanceof Error ? error.message : 'Bad multipart body'));
      return;
    }

    const files: StoredFile[] = [];
    const fields: Record<string, string> = {};
    let totalBytes = 0;
    let settled = false;
    const pending: Promise<void>[] = [];

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      request.unpipe(parser);
      void store.removeJob(jobId);
      reject(error);
      // The client may still be uploading. Let the error handler write the
      // response first, then close the socket instead of leaving a half-read
      // request hanging -- which is what made this path flaky.
      setImmediate(() => {
        if (!request.complete) request.destroy();
      });
    };

    parser.on('field', (name, value) => {
      // Ignore unexpected field names entirely rather than storing them.
      if (FIELD_KEYS.has(name)) fields[name] = value.slice(0, 8_192);
    });

    parser.on('file', (_fieldName, stream, info) => {
      const originalName = info.filename ?? '';
      if (originalName.length === 0) {
        stream.resume();
        return;
      }
      const extension = safeFileName(originalName).toLowerCase();
      if (
        limits.allowedExtensions &&
        !limits.allowedExtensions.some((allowed) => extension.endsWith(allowed))
      ) {
        stream.resume();
        fail(new InvalidUploadError(`Unsupported file type: ${extension}`));
        return;
      }

      stream.on('limit', () => {
        fail(new UploadTooLargeError(limits.maxBytes, totalBytes));
      });

      // Files are written concurrently, so completion order is not upload
      // order -- and merge (and anything else positional) depends on the order
      // the client sent. Reserve a slot now and fill it when the write lands.
      const slot = files.length;
      files.push({ name: '', path: '', bytes: 0 });
      pending.push(
        store
          .writeInput(jobId, originalName, stream, limits.maxBytes)
          .then((stored) => {
            totalBytes += stored.bytes;
            files[slot] = stored;
          })
          .catch((error: unknown) => {
            files.length = slot; // drop the placeholder
            throw error;
          }),
      );
    });

    parser.on('error', (error: unknown) => fail(error));

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