/**
 * The public REST API surface (`/api/v1`, PLAN.md §25.3).
 *
 * Same pipeline, different front door: keys are bearer credentials bound to an
 * account, quota is measured per key (with the account as a ceiling), and
 * submission deliberately walks the *same* admission path as the anonymous
 * route -- reserve before the body arrives, remove the job directory on any
 * failure, settle the real byte count afterwards. Anonymous limits are
 * untouched; keys are an additional subject namespace, not a policy change.
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { Readable } from 'node:stream';
import { jobToken, newJobId } from '../../context.js';
import type { Logger } from '../../logger.js';
import type { WorkDirStore } from '../../files/store.js';
import type { JobQueue } from '../../jobs/queue.js';
import {
  createJobSchema,
  JOB_ERROR_CODES,
  MAX_UPLOAD_FILES,
  SERVER_SLUGS,
  type JobPayload,
} from '../../jobs/payload.js';
import { UnsafePathError, safeJobId } from '../../files/paths.js';
import { receiveUpload, PDF_SIGNATURE } from '../uploads.js';
import { QuotaService, subjectId, tokensMatch, type QuotaCounter } from '../../quota/quota.js';
import type { ApiKeyStore, ApiKeyDoc } from '../../keys/store.js';
import type { AccountStore } from '../../account/store.js';
import { NODE_JOBS, type JobDefinition } from '@pdfshush/pdf-core/node';
import { parseOptionsField } from '../options.js';
import { sendResultFile } from '../result-stream.js';
import { buildOpenApiDocument } from './openapi.js';
import { apiCreateJobSchema, V1_ERROR_CODES } from './schemas.js';

/** Reads the key the authenticate middleware attached, without a type bleed. */
type AuthedRequest = Request & { apiKey?: ApiKeyDoc };

/**
 * Deployment shape the routes need. `enabled` is false whenever accounts are:
 * a key cannot exist without an account to belong to, so the whole surface
 * answers 503 rather than hinting that no key would ever be accepted.
 */
export interface V1RoutesDeps {
  enabled: boolean;
  keys?: ApiKeyStore;
  account?: AccountStore;
  queue: JobQueue;
  store: WorkDirStore;
  logger: Logger;
  pepper: string;
  counters: QuotaCounter;
  maxUploadBytes: number;
  retentionMs: number;
  limits: {
    key: {
      tasksPerMinute: number;
      tasksPerDay: number;
      bytesPerDay: number;
      readsPerMinute: number;
      maxInlineFileBytes: number;
    };
    account: { tasksPerDay: number; bytesPerDay: number };
    maxKeysPerAccount: number;
  };
}

/** The per-key and per-account services, built once at mount time. */
function quotaServices(deps: V1RoutesDeps) {
  const key = new QuotaService(deps.counters, {
    tasksPerMinute: deps.limits.key.tasksPerMinute,
    tasksPerDay: deps.limits.key.tasksPerDay,
    bytesPerDay: deps.limits.key.bytesPerDay,
  });
  // The account ceiling has no burst rate of its own -- the per-key minute
  // limit already bounds concurrency -- but `QuotaService` always runs the
  // minute check, so it gets a bound it can never trip.
  const account = new QuotaService(deps.counters, {
    tasksPerMinute: Number.MAX_SAFE_INTEGER,
    tasksPerDay: deps.limits.account.tasksPerDay,
    bytesPerDay: deps.limits.account.bytesPerDay,
  });
  return { key, account };
}

/** A body (either form) once its bytes are all decoded or already on disk. */
interface CollectedJob {
  files: { name: string; bytes: number }[];
  slug?: string;
  password?: string;
  /** A JSON string from multipart (still encoded); an object from the JSON body. */
  options?: string | Record<string, unknown>;
  totalBytes: number;
}

export function registerV1Routes(app: Express, deps: V1RoutesDeps): void {
  const quotas = quotaServices(deps);
  const keyQuotaSubject = (keyId: string) => `apikey:${keyId}`;
  const accountQuotaSubject = (accountId: string) => `apikeyacct:${accountId}`;

  const unavailable = (response: Response) =>
    response.status(503).json({
      error: 'Public API is not enabled on this deployment (accounts are disabled).',
      code: V1_ERROR_CODES.authDisabled,
    });

  /**
   * The per-key ceiling on status/result reads.
   *
   * Poll loops are the main v1 traffic, and an unbounded `queue.state()` read
   * is a Redis command per request. Fails **open** on a counter outage, like
   * the sign-in limiter: a Redis blink must not become a 429 storm on the very
   * routes whose backing store is the thing that just went away.
   */
  const allowRead = async (key: ApiKeyDoc): Promise<boolean> => {
    try {
      const used = await deps.counters.increment(`v1:read:${key._id}`, 60);
      return used <= deps.limits.key.readsPerMinute;
    } catch (error) {
      deps.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'API read-rate limiter unavailable; allowing the request',
      );
      return true;
    }
  };

  /** Resolves the presented key or writes the 401 itself. */
  const authenticate = async (request: Request, response: Response, next: NextFunction) => {
    if (!deps.enabled || !deps.keys) {
      unavailable(response);
      return;
    }
    try {
      const presented = request.header('x-api-key') ?? '';
      if (!presented) {
        response.status(401).json({
          error: 'API key required. Pass your key as the `x-api-key` header.',
          code: V1_ERROR_CODES.unauthorized,
        });
        return;
      }
      const key = await deps.keys.resolve(presented);
      if (!key) {
        // Invalid and revoked are deliberately the same answer (§25.3): a
        // revoked key must not confirm it ever existed.
        response
          .status(401)
          .json({ error: 'Invalid or revoked API key.', code: V1_ERROR_CODES.unauthorized });
        return;
      }
      if (request.method === 'GET' && !(await allowRead(key))) {
        response.setHeader('Retry-After', '60');
        response.status(429).json({
          error: 'Too many status reads for this key. Wait a minute.',
          code: JOB_ERROR_CODES.quota,
        });
        return;
      }
      (request as AuthedRequest).apiKey = key;
      next();
    } catch (error) {
      next(error);
    }
  };

  /** Answers `forbidden` unless the key carries `scope`. */
  const requireScope = (key: ApiKeyDoc, scope: string, response: Response): boolean => {
    if (key.scopes.includes(scope as (typeof key.scopes)[number])) return true;
    response.status(403).json({
      error: `This key lacks the "${scope}" scope.`,
      code: V1_ERROR_CODES.insufficientScope,
    });
    return false;
  };

  const parseJobId = (request: Request, response: Response): string | undefined => {
    try {
      return safeJobId(String(request.params.id ?? ''));
    } catch (error) {
      if (error instanceof UnsafePathError) {
        response.status(400).json({ error: 'Malformed job id', code: JOB_ERROR_CODES.validation });
        return undefined;
      }
      throw error;
    }
  };

  /**
   * Key-holder ownership. A key belongs to an account, and a key that did not
   * create a job may still poll or download it if the *account* did: jobs are
   * recorded to the account (the P4 ownership row), not to individual keys,
   * which lets one key manage another key's results after a rotation. The
   * `x-job-token` fallback covers the accepted-but-unrecorded window -- an
   * ownership-write failure is logged at submission time, never fatal, and
   * must not orphan a job its owner already paid quota for.
   */
  const authorizeJob = async (
    jobId: string,
    key: ApiKeyDoc,
    request: Request,
    response: Response,
  ): Promise<boolean> => {
    if (deps.account && (await deps.account.ownsJob(key.accountId, jobId))) return true;
    const presented = request.header('x-job-token') ?? '';
    if (tokensMatch(presented, jobToken(deps.pepper, jobId))) return true;
    response.status(403).json({
      error: 'This job does not belong to your account.',
      code: JOB_ERROR_CODES.forbidden,
    });
    return false;
  };

  const withOptions = (raw: CollectedJob['options']): ReturnType<typeof parseOptionsField> => {
    if (raw === undefined) return {};
    if (typeof raw === 'string') return parseOptionsField(raw);
    if (typeof raw === 'object' && !Array.isArray(raw)) return { value: raw };
    return { error: 'The "options" field must be a JSON object' };
  };

  /* -- public spec first: it is how integrators learn the surface, and it
     carries no key material, only shapes and the documented limits. -------- */
  app.get('/api/v1/openapi.json', (_request: Request, response: Response) => {
    response.json(
      buildOpenApiDocument({
        tasksPerMinute: deps.limits.key.tasksPerMinute,
        tasksPerDay: deps.limits.key.tasksPerDay,
        bytesPerDay: deps.limits.key.bytesPerDay,
        readsPerMinute: deps.limits.key.readsPerMinute,
        maxUploadBytes: deps.maxUploadBytes,
        maxInlineFileBytes: deps.limits.key.maxInlineFileBytes,
        retentionMs: deps.retentionMs,
        accountTasksPerDay: deps.limits.account.tasksPerDay,
        accountBytesPerDay: deps.limits.account.bytesPerDay,
      }),
    );
  });

  // Inline JSON bodies only; multipart requests pass through untouched by
  // content-type, and the GET routes carry no body. The 16 MB bound is what a
  // fully inline request can legally occupy without tripping any other cap.
  app.use('/api/v1', express.json({ limit: '16mb' }));

  app.use('/api/v1', authenticate);

  /* -------------------------------------------------------------- catalog */

  app.get('/api/v1/tools', (_request: Request, response: Response) => {
    const tools = SERVER_SLUGS.map((slug) => {
      const definition: JobDefinition | undefined = NODE_JOBS[slug];
      return {
        slug,
        ...(definition ? { label: definition.label } : {}),
        input: {
          files: `1-${MAX_UPLOAD_FILES} PDF files`,
          password: 'optional, for encrypted documents',
          options: 'tool-specific JSON; see the OpenAPI document',
        },
      };
    });
    response.json({
      version: 1,
      slugs: [...SERVER_SLUGS],
      tools,
      scopes: ['jobs:write', 'jobs:read', 'results:read'],
      limits: {
        tasksPerMinute: deps.limits.key.tasksPerMinute,
        tasksPerDay: deps.limits.key.tasksPerDay,
        bytesPerDay: deps.limits.key.bytesPerDay,
        accountTasksPerDay: deps.limits.account.tasksPerDay,
        accountBytesPerDay: deps.limits.account.bytesPerDay,
        readsPerMinute: deps.limits.key.readsPerMinute,
        maxUploadBytes: deps.maxUploadBytes,
        maxInlineFileBytes: deps.limits.key.maxInlineFileBytes,
        resultRetentionMs: deps.retentionMs,
      },
      openapi: '/api/v1/openapi.json',
    });
  });

  /* ------------------------------------------------------------ submit job */

  app.post('/api/v1/jobs', async (request: Request, response: Response) => {
    const key = (request as AuthedRequest).apiKey as ApiKeyDoc;
    if (!requireScope(key, 'jobs:write', response)) return;

    // Two-stage reservation: the key's own counters first, then the account
    // ceiling over every key it owns. The account reservation runs only on
    // keys that passed theirs -- the exact property the per-key-isolation
    // gate asserts.
    const ceiling = deps.maxUploadBytes;
    const keySubject = keyQuotaSubject(key._id);
    const acctSubject = accountQuotaSubject(key.accountId);
    const keyVerdict = await quotas.key.reserveUpload(keySubject, ceiling);
    if (!keyVerdict.allowed) {
      response.setHeader('Retry-After', String(keyVerdict.retryAfterSeconds));
      response.status(429).json({ error: keyVerdict.reason, code: JOB_ERROR_CODES.quota });
      return;
    }
    const acctVerdict = await quotas.account.reserveUpload(acctSubject, ceiling);
    if (!acctVerdict.allowed) {
      // Nothing was accepted, so both reservations are released. Task
      // counters stand (the no-window-resetting rule, as on every surface).
      await Promise.allSettled([
        quotas.key.settleUpload(keySubject, ceiling, 0),
        quotas.account.settleUpload(acctSubject, ceiling, 0),
      ]);
      response.setHeader('Retry-After', String(acctVerdict.retryAfterSeconds));
      response.status(429).json({ error: acctVerdict.reason, code: JOB_ERROR_CODES.quota });
      return;
    }

    const jobId = newJobId();
    /** The actual byte count once the reservation was replaced with it. */
    let settledReal: number | undefined;

    try {
      await deps.store.prepareJob(jobId);

      let collected: CollectedJob;
      if ((request.headers['content-type'] ?? '')
        .toLowerCase()
        .startsWith('multipart/form-data')) {
        // Large files ride the same multipart stream as the anonymous
        // surface: straight to disk, capped while streaming, never buffered.
        const upload = await receiveUpload(request, deps.store, jobId, {
          maxBytes: ceiling,
          maxTotalBytes: ceiling,
          maxFiles: MAX_UPLOAD_FILES,
          allowedExtensions: ['.pdf'],
          magic: PDF_SIGNATURE,
        });
        collected = {
          files: upload.files.map((file) => ({ name: file.name, bytes: file.bytes })),
          slug: upload.fields.slug,
          ...(upload.fields.password ? { password: upload.fields.password } : {}),
          ...(upload.fields.options !== undefined
            ? { options: upload.fields.options }
            : {}),
          totalBytes: upload.totalBytes,
        };
      } else {
        const inline = collectInline(request, response, {
          maxInlineFileBytes: deps.limits.key.maxInlineFileBytes,
          totalCeiling: ceiling,
        });
        if (!inline) {
          // Refused before any byte was written: the prepared job directory
          // came earlier so a valid request could not be rejected after a
          // disk touch, and the reservations must be released instead of
          // billed.
          await Promise.allSettled([
            deps.store.removeJob(jobId),
            quotas.key.settleUpload(keySubject, ceiling, 0),
            quotas.account.settleUpload(acctSubject, ceiling, 0),
          ]);
          return;
        }
        const files: { name: string; bytes: number }[] = [];
        for (const file of inline.files) {
          const stored = await deps.store.writeInput(
            jobId,
            file.name,
            Readable.from([file.data]),
            ceiling,
          );
          files.push({ name: stored.name, bytes: stored.bytes });
        }
        collected = {
          files,
          slug: inline.slug,
          ...(inline.password ? { password: inline.password } : {}),
          ...(inline.options ? { options: inline.options } : {}),
          totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
        };
      }

      // The real byte count is now known; replace both reservations with it.
      // Later validation failures keep the charge, as on the anonymous path.
      settledReal = collected.totalBytes;
      await Promise.all([
        quotas.key.settleUpload(keySubject, ceiling, collected.totalBytes),
        quotas.account.settleUpload(acctSubject, ceiling, collected.totalBytes),
      ]);

      const fieldOptions = withOptions(collected.options);
      if (fieldOptions.error) {
        await deps.store.removeJob(jobId);
        response.status(400).json({ error: fieldOptions.error, code: JOB_ERROR_CODES.validation });
        return;
      }

      const names = collected.files.map((file) => file.name);
      const parsed = createJobSchema.safeParse({
        slug: collected.slug,
        files: names,
        ...(collected.password ? { password: collected.password } : {}),
        ...(fieldOptions.value ? { options: fieldOptions.value } : {}),
      });
      if (!parsed.success) {
        await deps.store.removeJob(jobId);
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
        // The worker sees the same opaque subject shape as the anonymous
        // path; neither the key id nor the account id enters Redis.
        subject: subjectId(`apikey:${key._id}`, deps.pepper),
        requestedAt: Date.now(),
      };

      try {
        await deps.queue.enqueue(payload);
      } catch (error) {
        // Nothing will ever run this job, so its uploads must not be left
        // behind. The catch below releases the settled reservations.
        await deps.store.removeJob(jobId);
        throw error;
      }

      // Ownership is recorded against the account, not the key (§25.3): keys
      // rotate, accounts persist. A failed write never fails an accepted job,
      // and the x-job-token fallback keeps the job pollable.
      if (deps.account) {
        await deps.account
          .recordJob(key.accountId, jobId, payload.slug, deps.retentionMs)
          .catch((error: unknown) => {
            deps.logger.warn(
              { jobId, error: String(error) },
              'could not record API job ownership',
            );
          });
      }

      deps.logger.info(
        { jobId, slug: payload.slug, files: payload.files.length, bytes: collected.totalBytes },
        'API job queued',
      );

      response.status(202).json({
        jobId,
        status: 'queued',
        statusUrl: `/api/v1/jobs/${jobId}`,
        token: jobToken(deps.pepper, jobId),
        files: collected.files,
      });
    } catch (error) {
      // Collectively covers every throw above: a request that fails between
      // reservation and enqueue must leave neither a directory nor a byte
      // claim behind. The refund base differs by where the failure happened
      // -- still reserved (the ceiling), or already settled to real bytes.
      await Promise.allSettled([
        deps.store.removeJob(jobId),
        quotas.key.settleUpload(keySubject, settledReal ?? ceiling, 0),
        quotas.account.settleUpload(acctSubject, settledReal ?? ceiling, 0),
      ]);
      throw error;
    }
  });

  /* ----------------------------------------------------------- job reads */

  app.get('/api/v1/jobs/:id', async (request: Request, response: Response) => {
    const key = (request as AuthedRequest).apiKey as ApiKeyDoc;
    if (!requireScope(key, 'jobs:read', response)) return;
    const jobId = parseJobId(request, response);
    if (!jobId) return;
    // Authorisation before state: a foreign key must not be able to tell an
    // unknown id from somebody else's id, matching the anonymous route's
    // token-first ordering.
    if (!(await authorizeJob(jobId, key, request, response))) return;
    const state = await deps.queue.state(jobId);
    if (!state) {
      response
        .status(404)
        .json({ error: 'Unknown or expired job', code: JOB_ERROR_CODES.unknownJob });
      return;
    }
    response.json(state);
  });

  app.get('/api/v1/jobs/:id/result', async (request: Request, response: Response) => {
    const key = (request as AuthedRequest).apiKey as ApiKeyDoc;
    if (!requireScope(key, 'results:read', response)) return;
    const jobId = parseJobId(request, response);
    if (!jobId) return;
    if (!(await authorizeJob(jobId, key, request, response))) return;
    const state = await deps.queue.state(jobId);
    const files = state?.files;
    if (!state || !files || files.length === 0) {
      // Not finished, or queue history pruned: the caller can tell those two
      // apart by continuing to poll status.
      response
        .status(404)
        .json({ error: 'Result not found', code: JOB_ERROR_CODES.resultNotFound });
      return;
    }
    if (files.length === 1) {
      await streamResult(jobId, files[0]!, response);
    } else {
      response.status(200).json({
        jobId,
        files: files.map((file) => ({
          name: file.name,
          bytes: file.bytes,
          url: `/api/v1/jobs/${jobId}/result/files/${encodeURIComponent(file.name)}`,
        })),
      });
    }
  });

  app.get('/api/v1/jobs/:id/result/files/:name', async (request: Request, response: Response) => {
    const key = (request as AuthedRequest).apiKey as ApiKeyDoc;
    if (!requireScope(key, 'results:read', response)) return;
    const jobId = parseJobId(request, response);
    if (!jobId) return;
    if (!(await authorizeJob(jobId, key, request, response))) return;
    const name = String(request.params.name ?? '');
    const state = await deps.queue.state(jobId);
    const file = state?.files?.find((entry) => entry.name === name);
    if (!file) {
      response.status(404).json({ error: 'Result not found', code: JOB_ERROR_CODES.resultNotFound });
      return;
    }
    await streamResult(jobId, file, response);
  });

  /** The janitor may delete the moment the TTL passes -- including mid-read. */
  const streamResult = async (
    jobId: string,
    file: { name: string; bytes: number },
    response: Response,
  ): Promise<void> => {
    const onDisk = await deps.store.statResult(jobId, file.name);
    if (!onDisk) {
      response
        .status(404)
        .json({ error: 'Result expired or removed', code: JOB_ERROR_CODES.resultNotFound });
      return;
    }
    sendResultFile({
      response,
      store: deps.store,
      logger: deps.logger,
      jobId,
      name: file.name,
      bytes: onDisk.bytes,
    });
  };
}

/* ------------------------------------------------------- inline JSON body */

interface InlineFile {
  name: string;
  data: Buffer;
}

interface InlineRequest {
  slug: string;
  password?: string;
  options?: Record<string, unknown>;
  files: InlineFile[];
}

/**
 * Validates an inline JSON submission completely *before* any disk write.
 *
 * Capped per file (D7: agents pay with context, not just bandwidth) and per
 * request (the upload ceiling the key quota reserved against); the
 * magic-byte check keeps the extension from being advisory here too. Returns
 * `undefined` after writing the response for a rejected body.
 */
function collectInline(
  request: Request,
  response: Response,
  limits: { maxInlineFileBytes: number; totalCeiling: number },
): InlineRequest | undefined {
  const body = (request as { body?: unknown }).body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    response
      .status(400)
      .json({ error: 'The request body must be a JSON object', code: JOB_ERROR_CODES.validation });
    return undefined;
  }
  const parsed = apiCreateJobSchema.safeParse(body);
  if (!parsed.success) {
    response.status(400).json({
      error: parsed.error.issues[0]?.message ?? 'Invalid job request',
      code: JOB_ERROR_CODES.validation,
    });
    return undefined;
  }

  const files: InlineFile[] = [];
  let total = 0;
  for (const file of parsed.data.files) {
    const data = Buffer.from(file.data, 'base64');
    if (data.length > limits.maxInlineFileBytes) {
      response.status(413).json({
        error:
          `Inline file "${file.name}" exceeds the ${limits.maxInlineFileBytes} byte inline cap. ` +
          'Use multipart/form-data for larger uploads.',
        code: JOB_ERROR_CODES.tooLarge,
      });
      return undefined;
    }
    total += data.length;
    if (total > limits.totalCeiling) {
      response.status(413).json({
        error: `Inline upload exceeds the ${limits.totalCeiling} byte request ceiling.`,
        code: JOB_ERROR_CODES.tooLarge,
      });
      return undefined;
    }
    if (!data.subarray(0, 1024).includes(PDF_SIGNATURE.bytes)) {
      response.status(400).json({
        error: `"${file.name}" is not a ${PDF_SIGNATURE.label} file`,
        code: JOB_ERROR_CODES.validation,
      });
      return undefined;
    }
    files.push({ name: file.name, data });
  }

  // Two part names that sanitise to the same basename would truncate each
  // other -- the multipart path guards this in `receiveUpload`; the inline
  // path guards it here, before anything is written.
  const reserved = new Set<string>();
  for (const file of files) {
    let name = file.name;
    for (let suffix = 2; reserved.has(name); suffix += 1) {
      const dot = file.name.lastIndexOf('.');
      name =
        dot > 0
          ? `${file.name.slice(0, dot)}-${suffix}${file.name.slice(dot)}`
          : `${file.name}-${suffix}`;
    }
    reserved.add(name);
    file.name = name;
  }

  return {
    slug: parsed.data.slug,
    ...(parsed.data.password ? { password: parsed.data.password } : {}),
    ...(parsed.data.options ? { options: parsed.data.options } : {}),
    files,
  };
}
