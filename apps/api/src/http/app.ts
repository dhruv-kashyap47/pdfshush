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
import { receiveUpload, InvalidUploadError } from './uploads.js';
import { UploadTooLargeError } from '../files/store.js';
import { createJobSchema, JOB_ERROR_CODES, SERVER_SLUGS, type JobPayload } from '../jobs/payload.js';
import { UnsafePathError, safeJobId } from '../files/paths.js';
import { requestCancel } from '../jobs/cancel.js';

export function createApp(context: ApiContext): Express {
  const app = express();

  app.disable('x-powered-by');
  if (context.config.http.trustProxy) app.set('trust proxy', true);

  app.use(
    helmet({
      // The API serves JSON and file downloads, never HTML, so a strict CSP
      // costs nothing and closes off the injection footgun.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.get('/api/health', async (_request: Request, response: Response) => {
    const [counts, usage] = await Promise.all([
      context.queue.counts().catch(() => undefined),
      context.store.usage().catch(() => ({ jobDirs: 0, bytes: 0 })),
    ]);
    response.json({
      status: 'ok',
      queue: counts ?? { state: 'unavailable' },
      workDir: { jobDirs: usage.jobDirs, bytes: usage.bytes },
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

    const jobId = newJobId();
    await context.store.prepareJob(jobId);

    const upload = await receiveUpload(request, context.store, jobId, {
      maxBytes: context.config.quota.maxUploadBytes,
      maxFiles: 50,
      allowedExtensions: ['.pdf'],
    });

    // Now that the byte count is known, spend the budget.
    const verdict = await context.quota.consume(subject, upload.totalBytes);
    if (!verdict.allowed) {
      await context.store.removeJob(jobId);
      response.setHeader('Retry-After', String(verdict.retryAfterSeconds));
      response.status(429).json({ error: verdict.reason, code: JOB_ERROR_CODES.quota });
      return;
    }

    const options = parseOptionsField(upload.fields.options);
    const parsed = createJobSchema.safeParse({
      slug: upload.fields.slug,
      files: upload.files.map((file) => file.name),
      ...(upload.fields.password ? { password: upload.fields.password } : {}),
      ...(options ? { options } : {}),
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

    await context.queue.enqueue(payload);
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
      response.status(404).json({ error: 'Unknown job', code: 'unknown_job' });
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
      response.status(404).json({ error: 'Result not found', code: 'result_not_found' });
      return;
    }
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Length', String(file.bytes));
    response.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    context.store.openResult(auth.jobId, file.name).pipe(response);
  });

  app.delete('/api/jobs/:id', async (request: Request, response: Response) => {
    const auth = authorize(request, response, context);
    if (!auth) return;
    const removed = await context.queue.cancel(auth.jobId);
    if (!removed) {
      // Not queued anymore -- ask the worker to stop it cooperatively.
      await requestCancel(context.store, auth.jobId);
      response.status(202).json({ status: 'cancelling' });
      return;
    }
    response.status(200).json({ status: 'cancelled' });
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
      response.status(400).json({ error: 'Malformed job id' });
      return undefined;
    }
    throw error;
  }
  const token = request.header('x-job-token') ?? '';
  if (!tokensMatch(token, jobToken(context.pepper, jobId))) {
    response.status(403).json({ error: 'Job token required' });
    return undefined;
  }
  return { jobId };
}

function subjectFor(request: Request, context: ApiContext): string {
  // Express resolves the client IP honouring `trust proxy`; we never store it.
  const ip = request.ip || request.socket.remoteAddress || 'unknown';
  return subjectId(ip, context.pepper);
}

function parseOptionsField(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
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