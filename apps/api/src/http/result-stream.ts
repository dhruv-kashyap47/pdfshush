/**
 * Streaming a stored result file at a request.
 *
 * Shared between the anonymous download route and `/api/v1` -- the error
 * handling here was learned the hard way: the janitor may delete a job's
 * files the moment its TTL passes, including while this download is starting,
 * and a read stream that errors with no listener attached resets the socket
 * instead of answering a clean 404.
 */

import type { Response } from 'express';
import type { WorkDirStore } from '../files/store.js';
import type { Logger } from '../logger.js';

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

/**
 * Result content type from the stored name. Not every job produces a PDF:
 * `inspect` returns `<slug>-result.json`, and labelling that
 * `application/pdf` makes strict clients (and every browser extension)
 * choke on a valid download.
 */
export function contentTypeFor(name: string): string {
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

export function sendResultFile(args: {
  response: Response;
  store: WorkDirStore;
  logger: Logger;
  jobId: string;
  /** Basename only -- `safeFileName` guarantees this for stored results. */
  name: string;
  bytes: number;
}): void {
  args.response.setHeader('Content-Type', contentTypeFor(args.name));
  args.response.setHeader('Content-Length', String(args.bytes));
  // RFC 6266: the name goes in a quoted-string, and a safe basename cannot
  // contain the characters that would need escaping.
  args.response.setHeader('Content-Disposition', `attachment; filename="${args.name}"`);
  const stream = args.store.openResult(args.jobId, args.name);
  stream.on('error', (error: unknown) => {
    if (!args.response.headersSent) {
      args.response.status(500).json({ error: 'Result could not be read', code: 'internal_error' });
      return;
    }
    args.logger.error({ jobId: args.jobId, error: String(error) }, 'result stream failed');
    args.response.destroy();
  });
  stream.pipe(args.response);
}
