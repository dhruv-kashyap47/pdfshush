/**
 * The small HTTP contract shared by every route: cookie names, the double-submit
 * CSRF check, and the error body the SPA already knows how to read
 * (`{ error, code }`, see apps/web/src/lib/api.ts).
 */

import { getCookie } from 'hono/cookie';
import type { Context, Env } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { tokensMatch } from './crypto.js';

export const SESSION_COOKIE = 'pdfshush_session';
export const CSRF_COOKIE = 'pdfshush_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Every non-2xx body in this Worker. `code` is the stable field callers branch
 * on; `error` is prose for humans. Same shape as the Express surface.
 */
export function fail<E extends Env>(
  c: Context<E>,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) {
  return c.json({ error: message, code }, status);
}

/**
 * Double-submit check: the cookie must exist and the header must match it.
 * `SameSite=Lax` is the first lock; this is the one that still holds if a
 * deployment ever relaxes the cookie.
 */
export function csrfOk<E extends Env>(c: Context<E>): boolean {
  const expected = getCookie(c, CSRF_COOKIE) ?? '';
  const supplied = c.req.header(CSRF_HEADER) ?? '';
  return expected.length > 0 && supplied.length > 0 && tokensMatch(supplied, expected);
}

export function requireCsrf<E extends Env>(c: Context<E>): Response | undefined {
  if (csrfOk(c)) return undefined;
  return fail(c, 403, 'csrf', 'Missing or invalid CSRF token.');
}

/**
 * Only ever a same-origin path: `//evil.com`, `https://evil.com` and `/\evil.com`
 * are all refused, and control characters cannot smuggle a header split.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/';
  return value.slice(0, 512);
}

/** Cookies are `Secure` unless a deployment explicitly says otherwise. */
export function cookieSecure(env: { SESSION_COOKIE_SECURE?: string }): boolean {
  return env.SESSION_COOKIE_SECURE !== 'false';
}

/** Absolute SPA origin, defaulting to whatever the request already arrived on. */
export function webOrigin(env: { WEB_ORIGIN?: string }, requestUrl: string): string {
  const configured = env.WEB_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(requestUrl).origin;
}
