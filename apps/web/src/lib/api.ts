/**
 * Thin client for the PDFShush API.
 *
 * The SPA talks to `/api` on its own origin (the Vite dev server proxies it, and
 * a reverse proxy does the same in production), so the session cookie rides
 * along without CORS. State-changing calls echo the double-submit CSRF cookie in
 * a header, which is the one thing a cross-site request cannot forge.
 */

export const CSRF_COOKIE = 'pdfshush_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  /** Job calls carry their own ownership token rather than a session. */
  jobToken?: string;
  signal?: AbortSignal;
  /** Set for multipart uploads, where the browser must choose the boundary. */
  formData?: FormData;
}

/**
 * Returns `undefined` for 204 (the API's "no content, and that is fine").
 * Throws `ApiError` for anything else non-2xx, so callers branch on `code`
 * rather than parsing prose.
 */
export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T | undefined> {
  const method = options.method ?? (options.formData || options.body ? 'POST' : 'GET');
  const headers: Record<string, string> = {};

  if (options.jobToken) headers['x-job-token'] = options.jobToken;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers[CSRF_HEADER] = csrf;
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(options.formData ? { body: options.formData } : {}),
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 204) return undefined;

  if (!response.ok) {
    let code = 'http_error';
    let message = `Request failed (${response.status})`;
    let details: unknown;
    try {
      const payload = (await response.json()) as { error?: string; code?: string; issues?: unknown };
      if (payload.error) message = payload.error;
      if (payload.code) code = payload.code;
      if (payload.issues) details = payload.issues;
    } catch {
      // Non-JSON error body: keep the generic message rather than throwing.
    }
    throw new ApiError(response.status, code, message, details);
  }

  const text = await response.text();
  return text ? (JSON.parse(text) as T) : undefined;
}
