/**
 * Double-submit CSRF check, shared by every cookie-authenticated surface.
 *
 * The token in the cookie is readable by the SPA (not HttpOnly, by design) and
 * must be echoed in `CSRF_HEADER`. A cross-site page can make the browser send
 * the cookie but cannot read it, so it cannot produce the header. `SameSite=Lax`
 * is the first lock; this is the second, and the one that still holds if a
 * deployment relaxes the cookie to `SameSite=None`.
 *
 * The comparison is constant-time: `tokensMatch` length-checks and then uses
 * `timingSafeEqual`, so a wrong-length input cannot throw.
 */

import type { Request, Response } from 'express';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../auth/cookies.js';
import { tokensMatch } from '../quota/quota.js';

/** A cookie value, or `''` when the cookie is absent or not a string. */
export function readCookie(request: Request, name: string): string {
  const jar = (request as Request & { cookies?: Record<string, unknown> }).cookies;
  const value = jar?.[name];
  return typeof value === 'string' ? value : '';
}

/** Whether this request carries a browser session cookie at all. */
export function hasSessionCookie(request: Request): boolean {
  return readCookie(request, SESSION_COOKIE).length > 0;
}

/**
 * Answers 403 and returns `false` when the double-submit token is missing or
 * wrong. Callers return immediately on `false`; nothing has been mutated yet.
 */
export function requireCsrf(request: Request, response: Response): boolean {
  const expected = readCookie(request, CSRF_COOKIE);
  const supplied = request.header(CSRF_HEADER);
  if (!expected || !supplied || !tokensMatch(supplied, expected)) {
    response.status(403).json({ error: 'Missing or invalid CSRF token.', code: 'csrf' });
    return false;
  }
  return true;
}
