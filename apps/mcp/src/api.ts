/**
 * The v1 REST client. This module is the package's entire network surface:
 * four calls against the configured base URL with the user's key in the
 * `x-api-key` header, mirroring the OpenAPI document (§25.3). No other file
 * here is allowed to `fetch`.
 */

import type { McpConfig } from './config.js';

export class ApiError extends Error {
  readonly status: number;
  /** The stable v1 error code, when the body carried one. */
  readonly code?: string;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface Decoded {
  status?: number;
  code?: string;
  error?: string;
  message?: string;
}

function apiPath(baseUrl: URL, path: string): string {
  const base = baseUrl.toString().replace(/\/+$/, '');
  return `${base}${path}`;
}

async function call(
  config: McpConfig,
  path: string,
  init: { method: 'GET' | 'POST'; body?: string } = { method: 'GET' },
): Promise<{ status: number; body: string; contentType: string }> {
  let response: Response;
  try {
    response = await fetch(apiPath(config.baseUrl, path), {
      method: init.method,
      headers: {
        'x-api-key': config.apiKey,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body,
    });
  } catch (err) {
    throw new ApiError(
      0,
      'network_error',
      `Cannot reach ${apiPath(config.baseUrl, path)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  if (!response.ok) {
    let decoded: Decoded = {};
    try {
      decoded = JSON.parse(body) as Decoded;
    } catch {
      /* non-JSON error body: keep the defaults */
    }
    throw new ApiError(
      response.status,
      decoded.code ?? `http_${response.status}`,
      decoded.error ?? decoded.message ?? (body.slice(0, 300) || `HTTP ${response.status}`),
    );
  }
  return { status: response.status, body, contentType };
}

/** `GET /api/v1/tools` -- the deployment's catalog; needs a valid key, no scope. */
export async function fetchCatalog(config: McpConfig): Promise<{
  slugs: string[];
  tools: { slug: string; label?: string }[];
  limits?: Record<string, number>;
}> {
  const { body } = await call(config, '/api/v1/tools');
  return JSON.parse(body);
}

/** `POST /api/v1/jobs` with the inline JSON body already validated by the caller. */
export async function submitJob(config: McpConfig, payload: unknown): Promise<{
  jobId: string;
  statusUrl: string;
  token: string;
  files: { name: string; bytes: number }[];
}> {
  const { body } = await call(config, '/api/v1/jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return JSON.parse(body);
}

/** `GET /api/v1/jobs/:id` -- one status snapshot. */
export async function fetchJobState(config: McpConfig, jobId: string): Promise<{
  status: string;
  files?: { name: string; bytes: number }[];
  pageCount?: number;
  error?: { message: string; code?: string };
}> {
  const { body } = await call(config, `/api/v1/jobs/${encodeURIComponent(jobId)}`);
  return JSON.parse(body);
}

/** `GET /api/v1/jobs/:id/result` -- single-file jobs answer the bytes; multi-file answer JSON. */
export async function fetchResult(
  config: McpConfig,
  jobId: string,
): Promise<{ kind: 'file'; contentType: string; bytes: Buffer } | { kind: 'listing'; files: { name: string; bytes: number; url: string }[] }> {
  const { body, contentType } = await call(config, `/api/v1/jobs/${encodeURIComponent(jobId)}/result`);
  if (contentType.includes('application/json')) {
    const listing = JSON.parse(body) as { files: { name: string; bytes: number; url: string }[] };
    return { kind: 'listing', files: listing.files };
  }
  return { kind: 'file', contentType: contentType.split(';')[0] ?? 'application/pdf', bytes: Buffer.from(body) };
}
