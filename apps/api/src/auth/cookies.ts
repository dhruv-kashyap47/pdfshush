/**
 * Cookie names shared by every surface that reads a browser session.
 *
 * Kept in their own module so `http/csrf.ts` can use them without importing the
 * auth routes (which import the CSRF helper in turn).
 */

export const SESSION_COOKIE = 'pdfshush_session';
/**
 * Double-submit CSRF token. Readable by design -- the SPA has to echo it back in
 * `CSRF_HEADER`, which is exactly what a cross-site attacker cannot do.
 */
export const CSRF_COOKIE = 'pdfshush_csrf';
export const CSRF_HEADER = 'x-csrf-token';
