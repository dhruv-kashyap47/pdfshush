/**
 * HTTP surface.
 *
 * Deliberately small and boring: create a job, poll it, fetch its output,
 * cancel it, check that we are alive. Everything that can be validated without
 * touching the queue happens before the bytes are accepted.
 */

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { ApiContext, jobToken, newJobId } from '../context.js';
import { subjectId, tokensMatch } from '../quota/quota.js';
import { receiveUpload, InvalidUploadError, BadMultipartError } from './uploads.js';
import { UploadTooLargeError } from '../files/store.js';
import {
  createJobSchema,
  JOB_ERROR_CODES,
  MAX_UPLOAD_FILES,
  SERVER_SLUGS,
  type JobPayload,
} from '../jobs/payload.js';
import { UnsafePathError, safeJobId } from '../files/paths.js';
import { requestCancel } from '../jobs/cancel.js';

export function createApp(context: ApiContext): Express {
  const app = express();

  app.disable('x-powered-by');
  // A hop count, not `true`: trusting every `X-Forwarded-For` let a client pick
  // its own quota identity.
  if (context.config.http.trustProxy > 0) app.set('trust proxy', context.config.http.trustProxy);

  app.use(
    helmet({
      // The API serves JSON and file downloads, never HTML, so a strict CSP
      // costs nothing and closes off the injection footgun.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  /**
   * Measures the work directory on every read.
   *
   * This was briefly cached for 30 seconds, because the container healthcheck
   * calls it every 15 seconds and a leaked directory made each probe slower.
   * But a cached answer is wrong exactly when it matters: the number is how
   * callers tell "my output is on disk" from "it is gone", and a probe landing
   * between a job completing and the next read reported the directory as
   * empty. Correctness of a reported number beats the walk.
   */
  const measureUsage = async () => context.store.usage().catch(() => ({ jobDirs: 0, bytes: 0 }));

  app.get('/api/health', async (_request: Request, response: Response) => {
    const [counts, usage] = await Promise.all([
      context.queue.counts().catch(() => undefined),
      measureUsage(),
    ]);
    response.json({
      status: 'ok',
      queue: counts ?? { state: 'unavailable' },
      workDir: { jobDirs: usage.jobDirs, bytes: usage.bytes },
      // Published because "why was my result gone?" is otherwise unanswerable,
      // and because a deployment that silently kept the defaults is invisible.
      retentionMs: context.config.retentionMs,
      janitorIntervalMs: context.config.janitorIntervalMs,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get('/api/tools', (_request: Request, response: Response) => {
    response.json({
      slugs: SERVER_SLUGS,
      maxUploadBytes: context.config.quota.maxUploadBytes,
      quota: {
        tasksPerMinute: context.config.quota.tasksPerMinute,
        tasksPerDay: context.config.quota.tasksPerDay,
      },
    });
  });

  app.get('/api/quota', async (request: Request, response: Response) => {
    const subject = subjectFor(request, context);
    response.json(await context.quota.peek(subject));
  });

  app.post('/api/jobs', async (request: Request, response: Response) => {
    const subject = subjectFor(request, context);

    // Refuse before the upload: no point receiving 500 MB for a rejected task.
    const precheck = await context.quota.precheck(subject);
    if (!precheck.allowed) {
      response.setHeader('Retry-After', String(precheck.retryAfterSeconds));
      response.status(429).json({ error: precheck.reason, code: JOB_ERROR_CODES.quota });
      return;
    }

    // The job directory is created here, after every check that can fail without
    // touching the disk, and removed again on ANY failure below. Creating it up
    // front meant a request rejected at the content-type check -- which never
    // reached the quota -- left an empty directory tree behind for good.
    const jobId = newJobId();
    await context.store.prepareJob(jobId);

    let upload: Awaited<ReturnType<typeof receiveUpload>>;
    try {
      upload = await receiveUpload(request, context.store, jobId, {
        maxBytes: context.config.quota.maxUploadBytes,
        // Per request, not per file: one anonymous POST must not be able to write
        // maxFiles x maxBytes to disk before any quota is charged.
        maxTotalBytes: context.config.quota.maxUploadBytes,
        maxFiles: MAX_UPLOAD_FILES,
        allowedExtensions: ['.pdf'],
      });
    } catch (error) {
      await context.store.removeJob(jobId);
      throw error;
    }

    // Now that the byte count is known, spend the budget.
    const verdict = await context.quota.consume(subject, upload.totalBytes);
    if (!verdict.allowed) {
      await context.store.removeJob(jobId);
      response.setHeader('Retry-After', String(verdict.retryAfterSeconds));
      response.status(429).json({ error: verdict.reason, code: JOB_ERROR_CODES.quota });
      return;
    }

    const fieldOptions = parseOptionsField(upload.fields.options);
    if (fieldOptions.error) {
      await context.store.removeJob(jobId);
      response.status(400).json({ error: fieldOptions.error, code: JOB_ERROR_CODES.validation });
      return;
    }
    const parsed = createJobSchema.safeParse({
      slug: upload.fields.slug,
      files: upload.files.map((file) => file.name),
      ...(upload.fields.password ? { password: upload.fields.password } : {}),
      ...(fieldOptions.value ? { options: fieldOptions.value } : {}),
    });
    if (!parsed.success) {
      await context.store.removeJob(jobId);
      response.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid job request',
        code: JOB_ERROR_CODES.validation,
      });
      return;
    }

    const payload: JobPayload = {
      jobId,
      slug: parsed.data.slug,
      files: parsed.data.files,
      ...(parsed.data.password ? { password: parsed.data.password } : {}),
      ...(parsed.data.options ? { options: parsed.data.options } : {}),
      subject,
      requestedAt: Date.now(),
    };

    try {
      await context.queue.enqueue(payload);
    } catch (error) {
      // Nothing will ever run this job, so its uploads must not be left behind.
      await context.store.removeJob(jobId);
      throw error;
    }
    context.logger.info(
      { jobId, slug: payload.slug, files: payload.files.length, bytes: upload.totalBytes },
      'job queued',
    );

    response.status(202).json({
      jobId,
      token: jobToken(context.pepper, jobId),
      status: 'queued',
      files: upload.files.map((file) => ({ name: file.name, bytes: file.bytes })),
    });
  });

  app.get('/api/jobs/:id', async (request: Request, response: Response) => {
    const auth = authorize(request, response, context);
    if (!auth) return;
    const state = await context.queue.state(auth.jobId);
    if (!state) {
      response.status(404).json({ error: 'Unknown job', code: JOB_ERROR_CODES.unknownJob });
      return;
    }
    response.json(state);
  });

  app.get('/api/jobs/:id/files/:name', async (request: Request, response: Response) => {
    const auth = authorize(request, response, context);
    if (!auth) return;
    const name = String(request.params.name ?? '');
    const state = await context.queue.state(auth.jobId);
    const file = state?.files?.find((entry) => entry.name === name);
    if (!file) {
      response.status(404).json({ error: 'Result not found', code: JOB_ERROR_CODES.resultNotFound });
      return;
    }
    // The janitor may delete a job's files the moment its TTL passes -- including
    // while this very download is starting. Without this check the read stream
    // errors with no listener attached and the socket is reset instead of the
    // caller getting a clean 404.
    const onDisk = await context.store.statResult(auth.jobId, file.name);
    if (!onDisk) {
      response.status(404).json({
        error: 'Result expired or removed',
        code: JOB_ERROR_CODES.resultNotFound,
      });
      return;
    }
    response.setHeader('Content-Type', contentTypeFor(file.name));
    response.setHeader('Content-Length', String(onDisk.bytes));
    // RFC 6266: the name goes in a quoted-string, and a safe basename cannot
    // contain the characters that would need escaping.
    response.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    const stream = context.store.openResult(auth.jobId, file.name);
    stream.on('error', (error: unknown) => {
      if (!response.headersSent) {
        response
          .status(500)
          .json({ error: 'Result could not be read', code: JOB_ERROR_CODES.internal });
        return;
      }
      context.logger.error({ jobId: auth.jobId, error: String(error) }, 'result stream failed');
      response.destroy();
    });
    stream.pipe(response);
  });

  app.delete('/api/jobs/:id', async (request: Request, response: Response) => {
    const auth = authorize(request, response, context);
    if (!auth) return;
    const outcome = await context.queue.cancel(auth.jobId);
    switch (outcome) {
      case 'removed':
        response.status(200).json({ status: 'cancelled' });
        return;
      case 'running':
        // The worker observes a marker; the job stops at its next checkpoint.
        await requestCancel(context.store, auth.jobId);
        response.status(202).json({ status: 'cancelling' });
        return;
      case 'unknown':
        response.status(404).json({ error: 'Unknown job', code: JOB_ERROR_CODES.unknownJob });
        return;
      default:
        // Already finished. Reporting "cancelling" here told the caller to keep
        // polling for a change that could never come, and used to write a cancel
        // marker that nothing would ever clear.
        response.status(409).json({
          error: 'Job has already finished',
          code: JOB_ERROR_CODES.notCancellable,
        });
    }
  });

  app.use((_request: Request, response: Response) => {
    response.status(404).json({ error: 'Not found' });
  });

  app.use(errorHandler(context));

  return app;
}

/* ----------------------------------------------------------------- helpers */

interface Auth {
  jobId: string;
}

/**
 * Anonymous-first ownership: the caller proves they created the job with the
 * token handed out at creation. Derived from the pepper, so nothing is stored.
 */
function authorize(request: Request, response: Response, context: ApiContext): Auth | undefined {
  let jobId: string;
  try {
    jobId = safeJobId(String(request.params.id ?? ''));
  } catch (error) {
    if (error instanceof UnsafePathError) {
      response.status(400).json({ error: 'Malformed job id', code: JOB_ERROR_CODES.validation });
      return undefined;
    }
    throw error;
  }
  const token = request.header('x-job-token') ?? '';
  if (!tokensMatch(token, jobToken(context.pepper, jobId))) {
    response.status(403).json({ error: 'Job token required', code: JOB_ERROR_CODES.forbidden });
    return undefined;
  }
  return { jobId };
}

function subjectFor(request: Request, context: ApiContext): string {
  // Express resolves the client IP honouring `trust proxy`; we never store it.
  const ip = request.ip || request.socket.remoteAddress || 'unknown';
  return subjectId(ip, context.pepper);
}

/**
 * Result content type from the stored name. Not every job produces a PDF:
 * `inspect` returns `<slug>-result.json`, and labelling that `application/pdf`
 * makes strict clients (and every browser extension) choke on a valid download.
 */
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

function contentTypeFor(name: string): string {
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

function parseOptionsField(raw: string | undefined): { value?: Record<string, unknown>; error?: string } {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Silently dropping the options ran the job with defaults instead -- a
    // truncation produced "No pages selected" rather than a diagnosable 400.
    return { error: 'The "options" field is not valid JSON (it may be too large)' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'The "options" field must be a JSON object' };
  }
  return { value: parsed as Record<string, unknown> };
}

function errorHandler(context: ApiContext) {
  return (error: unknown, request: Request, response: Response, _next: NextFunction): void => {
    if (error instanceof UploadTooLargeError) {
      response.status(413).json({ error: error.message, code: JOB_ERROR_CODES.tooLarge });
      return;
    }
    if (error instanceof InvalidUploadError) {
      response.status(400).json({ error: error.message, code: JOB_ERROR_CODES.validation });
      return;
    }
    // A malformed multipart body is the client's error, not ours.
    if (error instanceof BadMultipartError) {
      response.status(400).json({ error: error.message, code: JOB_ERROR_CODES.validation });
      return;
    }
    if (error instanceof UnsafePathError) {
      response.status(400).json({ error: 'Malformed path', code: JOB_ERROR_CODES.validation });
      return;
    }
    if (error instanceof ZodError) {
      response.status(400).json({
        error: error.issues[0]?.message ?? 'Invalid request',
        code: JOB_ERROR_CODES.validation,
      });
      return;
    }
    context.logger.error(
      { path: request.path, error: error instanceof Error ? error.message : String(error) },
      'unhandled request error',
    );
    response.status(500).json({ error: 'Internal error', code: JOB_ERROR_CODES.internal });
  };
}
