/**
 * Auth HTTP surface: start, callback, me, logout.
 *
 * Anonymous-first is preserved structurally: these routes never touch the job
 * pipeline, no other route consults a session, and when credentials are absent
 * (`auth.enabled === false`) they degrade to a clear 503 while every tool keeps
 * working exactly as before.
 */

import type { Express, Request, Response } from 'express';
import { GoogleOidc, GoogleOidcError, codeChallengeFor, randomToken } from './google.js';
import type { AuthStore } from './store.js';

export const SESSION_COOKIE = 'pdfshush_session';
/**
 * Double-submit CSRF token. Readable by design -- the SPA has to echo it back in
 * `CSRF_HEADER`, which is exactly what a cross-site attacker cannot do.
 */
export const CSRF_COOKIE = 'pdfshush_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Only ever a same-origin path: `//evil.com` and `https://evil.com` are not. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  // Reject anything with a scheme, an authority, or a backslash (browsers
  // normalise `\` to `/`, so `/\evil.com` is a protocol-relative URL too).
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  // Control characters can smuggle a header split past a naive check.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/';
  return value.slice(0, 512);
}

export interface AuthRoutesDeps {
  enabled: boolean;
  store?: AuthStore;
  oidc?: GoogleOidc;
  webOrigin: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
  logger: { warn: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void };
}

function cookieOptions(deps: AuthRoutesDeps, maxAgeMs: number) {
  return {
    httpOnly: true,
    // Lax, not Strict: the callback arrives as a top-level navigation from
    // Google, and Strict would withhold the cookie on that very first request.
    sameSite: 'lax' as const,
    secure: deps.cookieSecure,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function registerAuthRoutes(app: Express, deps: AuthRoutesDeps): void {
  const unavailable = (response: Response) => {
    response.status(503).json({
      error: 'Accounts are not enabled on this deployment.',
      code: 'auth_disabled',
    });
  };

  const ready = (response: Response): boolean => {
    if (!deps.enabled || !deps.store || !deps.oidc) {
      unavailable(response);
      return false;
    }
    return true;
  };

  /** Begins a login: mints state/verifier/nonce and stores the transaction. */
  app.get('/api/auth/google/start', async (request: Request, response: Response) => {
    if (!ready(response)) return;
    const deps2 = deps as Required<Pick<AuthRoutesDeps, 'store' | 'oidc'>> & AuthRoutesDeps;

    const state = randomToken(32);
    const codeVerifier = randomToken(32);
    const nonce = randomToken(16);
    const returnTo = safeReturnTo(request.query.returnTo);

    try {
      await deps2.store.startTransaction({ state, codeVerifier, nonce, returnTo });
    } catch (error) {
      deps.logger.error({ error: String(error) }, 'could not store the auth transaction');
      response.status(503).json({ error: 'Sign-in is temporarily unavailable.', code: 'auth_store' });
      return;
    }

    response.redirect(
      302,
      deps2.oidc.authorizationUrl({ state, codeChallenge: codeChallengeFor(codeVerifier), nonce }),
    );
  });

  /** Google redirects here. This is the URL registered in Cloud Console. */
  app.get('/api/auth/callback', async (request: Request, response: Response) => {
    const fail = (reason: string) => {
      const url = new URL(deps.webOrigin);
      url.searchParams.set('auth', 'error');
      url.searchParams.set('reason', reason);
      response.redirect(302, url.toString());
    };

    if (!ready(response)) return;
    const deps2 = deps as Required<Pick<AuthRoutesDeps, 'store' | 'oidc'>> & AuthRoutesDeps;

    if (typeof request.query.error === 'string') return fail('cancelled');

    const code = typeof request.query.code === 'string' ? request.query.code : '';
    const state = typeof request.query.state === 'string' ? request.query.state : '';
    if (!code || !state) return fail('invalid_request');

    // Single-use: taking it consumes it, so a replayed callback finds nothing.
    const transaction = await deps2.store.takeTransaction(state).catch((error: unknown) => {
      deps.logger.error({ error: String(error) }, 'could not read the auth transaction');
      return undefined;
    });
    if (!transaction) return fail('expired');

    let profile;
    try {
      const idToken = await deps2.oidc.exchangeCode({
        code,
        codeVerifier: transaction.codeVerifier,
      });
      profile = await deps2.oidc.verifyIdToken(idToken, transaction.nonce);
    } catch (error) {
      // The reason stays in the log; the browser gets an opaque code so a failure
      // cannot be turned into an oracle about our configuration.
      const reason = error instanceof GoogleOidcError ? error.code : 'unexpected';
      deps.logger.warn({ reason, error: String(error) }, 'sign-in failed');
      return fail('signin_failed');
    }

    const account = await deps2.store.upsertAccount(profile);
    const session = await deps2.store.createSession(account.id, deps.sessionTtlMs);

    response.cookie(SESSION_COOKIE, session.token, cookieOptions(deps, deps.sessionTtlMs));
    // Not HttpOnly: the SPA must be able to read it in order to echo it back.
    // That is sound for a double-submit token -- its only job is to prove the
    // request came from a page on this origin, which a cross-site attacker
    // cannot read even though they can make the browser send the cookie.
    response.cookie(CSRF_COOKIE, randomToken(16), {
      httpOnly: false,
      sameSite: 'lax',
      secure: deps.cookieSecure,
      path: '/',
      maxAge: deps.sessionTtlMs,
    });
    // Already validated when the transaction was written; re-validated here so a
    // row that predates a tightening of the rule still cannot open a redirect.
    response.redirect(302, new URL(safeReturnTo(transaction.returnTo), deps.webOrigin).toString());
  });

  /** The SPA asks who is signed in. 204 = nobody, and that is not an error. */
  app.get('/api/auth/me', async (request: Request, response: Response) => {
    if (!deps.enabled || !deps.store) {
      response.status(204).end();
      return;
    }
    const token = readSessionCookie(request);
    const account = token
      ? await deps.store.resolveSession(token).catch(() => undefined)
      : undefined;
    if (!account) {
      response.status(204).end();
      return;
    }
    response.json({ account });
  });

  app.post('/api/auth/logout', async (request: Request, response: Response) => {
    if (!deps.enabled || !deps.store) {
      response.status(204).end();
      return;
    }
    const token = readSessionCookie(request);
    if (token) {
      await deps.store.revokeSession(token).catch((error: unknown) => {
        deps.logger.error({ error: String(error) }, 'could not revoke the session');
      });
    }
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    response.clearCookie(CSRF_COOKIE, { path: '/' });
    response.status(204).end();
  });
}

function readSessionCookie(request: Request): string {
  const jar = (request as Request & { cookies?: Record<string, unknown> }).cookies;
  const value = jar?.[SESSION_COOKIE];
  return typeof value === 'string' ? value : '';
}
