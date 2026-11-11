/**
 * Streaming a stored result file at a request.
 *
 * Shared between the anonymous download route and `/api/v1` -- the error
 * handling here was learned the hard way: the janitor may delete a job's
 * files the moment its TTL passes, including while this download is starting,
 * and a read stream that errors with no listener attached resets the socket
 * instead of answering a clean 404.
 */

import type { NextFunction, Request, Response } from 'express';
import type { WorkDirStore } from '../files/store.js';
import { safeFileName } from '../files/paths.js';
import type { Logger } from '../logger.js';

/**
 * A job's data is reachable only through a capability sent as a request header,
 * so the URL itself carries no secret. That is exactly why a response must not
 * be storable: a shared cache keyed on the URL would replay the document to a
 * caller that never presented the token, and would keep replaying it after the
 * job expired or was revoked. `Vary` is the second line of defence for any
 * cache that ignores `no-store` but honours the key.
 */
export const NO_STORE = 'private, no-store';

function markPrivate(response: Response): void {
  response.setHeader('Cache-Control', NO_STORE);
  response.setHeader('Vary', 'x-job-token');
}

/** Mounted on every job route, so refusals and 404s are uncacheable too. */
export function noStoreResponses(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  markPrivate(response);
  next();
}

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
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
  // The name crosses a process boundary (the queue reported it), so the header
  // boundary re-applies the basename rule instead of trusting that invariant:
  // a `"` would break the RFC 6266 quoted-string, and a CR/LF would make
  // `setHeader` throw after the stat had already succeeded.
  const name = safeFileName(args.name);
  markPrivate(args.response);
  args.response.setHeader('Content-Type', contentTypeFor(name));
  args.response.setHeader('Content-Length', String(args.bytes));
  // RFC 6266: the name goes in a quoted-string, and a safe basename cannot
  // contain the characters that would need escaping.
  args.response.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  const stream = args.store.openResult(args.jobId, name);
  stream.on('error', (error: unknown) => {
    if (!args.response.headersSent) {
      args.response.status(500).json({ error: 'Result could not be read', code: 'internal_error' });
      return;
    }
    args.logger.error({ jobId: args.jobId, error: String(error) }, 'result stream failed');
    args.response.destroy();
  });
  stream.pipe(args.response);
  // `pipe` unpipes when the client disconnects mid-download but never destroys
  // the source, so the read stream's file descriptor lingers until GC. On
  // Windows that open handle makes the janitor's later `rm` fail with EPERM,
  // so release it as soon as the response closes (finished or aborted).
  args.response.on('close', () => {
    if (!stream.destroyed) stream.destroy();
  });
}
