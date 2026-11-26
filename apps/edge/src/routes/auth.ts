/**
 * Auth HTTP surface: start, callback, me, logout.
 *
 * Same routes, same status codes and same error codes as the Express surface —
 * the SPA and its tests already depend on them. What is *not* here is the
 * anonymous-first framing: it is preserved structurally, because these routes
 * are the only ones that ever touch a session.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../app-env.js';
import { D1AuthStore } from '../db/auth-store.js';
import { GoogleOidc, GoogleOidcError, googleConfig } from '../auth/oidc.js';
import { randomToken } from '../lib/crypto.js';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  cookieSecure,
  fail,
  requireCsrf,
  safeReturnTo,
  webOrigin,
} from '../lib/http.js';

export const authRoutes = new Hono<AppEnv>();

// OAuth transactions carry state/nonce/code-verifier, and `/api/auth/me` is
// cookie-scoped account data. Neither belongs in any cache: a shared or
// heuristic cache must not replay a login redirect or hand one visitor another
// visitor's session answer.
authRoutes.use('*', async (c, next) => {
  c.header('cache-control', 'private, no-store');
  await next();
});

const disabled = (c: Context<AppEnv>) =>
  fail(c, 503, 'auth_disabled', 'Accounts are not enabled on this deployment.');

/** Begins a login: mints state/verifier/nonce and stores the transaction. */
authRoutes.get('/api/auth/google/start', async (c) => {
  const config = googleConfig(c.env);
  if (!config) return disabled(c);

  const state = randomToken(32);
  const codeVerifier = randomToken(32);
  const nonce = randomToken(16);
  const returnTo = safeReturnTo(c.req.query('returnTo'));

  try {
    await new D1AuthStore(c.env.DB).startTransaction({ state, codeVerifier, nonce, returnTo });
  } catch (error) {
    console.error('could not store the auth transaction', error);
    return fail(c, 503, 'auth_store', 'Sign-in is temporarily unavailable.');
  }

  const oidc = new GoogleOidc(config);
  return c.redirect(await oidc.authorizationUrl({ state, codeVerifier, nonce }), 302);
});

/** Google redirects here. This is the URL registered in Cloud Console. */
authRoutes.get('/api/auth/callback', async (c) => {
  const config = googleConfig(c.env);
  if (!config) return disabled(c);

  const store = new D1AuthStore(c.env.DB);
  const origin = webOrigin(c.env, c.req.url);
  const state = c.req.query('state') ?? '';

  // Taking it consumes it, so a cancelled or failed callback cannot be replayed.
  // Its stored return path is still the best destination: a failed sign-in from
  // /tools/edit-pdf should not dump the user on the homepage.
  const transaction = state
    ? await store.takeTransaction(state).catch((error: unknown) => {
        console.error('could not read the auth transaction', error);
        return undefined;
      })
    : undefined;

  const failTo = (reason: string, returnTo = '/') => {
    const url = new URL(safeReturnTo(returnTo), origin);
    url.searchParams.set('auth', 'error');
    url.searchParams.set('reason', reason);
    return c.redirect(url.toString(), 302);
  };

  if (c.req.query('error')) return failTo('cancelled', transaction?.returnTo ?? '/');

  const code = c.req.query('code') ?? '';
  if (!code || !state) return failTo('invalid_request', transaction?.returnTo ?? '/');
  if (!transaction) return failTo('expired');

  let profile;
  try {
    const oidc = new GoogleOidc(config);
    const idToken = await oidc.exchangeCode({ code, codeVerifier: transaction.codeVerifier });
    profile = await oidc.verifyIdToken(idToken, transaction.nonce);
  } catch (error) {
    // The reason stays in the log; the browser gets an opaque code so a failure
    // cannot be turned into an oracle about this deployment's configuration.
    const reason = error instanceof GoogleOidcError ? error.code : 'unexpected';
    console.warn('sign-in failed', reason);
    return failTo('signin_failed', transaction.returnTo);
  }

  const account = await store.upsertAccount(profile);
  const session = await store.createSession(account.id, SESSION_TTL_MS);
  const secure = cookieSecure(c.env);
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);

  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true,
    // Lax, not Strict: the callback arrives as a top-level navigation from
    // Google, and Strict would withhold the cookie on that first request.
    sameSite: 'Lax',
    secure,
    path: '/',
    maxAge,
  });

  // Not HttpOnly: the SPA has to read it to echo it back. Sound for a
  // double-submit token — its only job is proving the request came from a page
  // on this origin, which a cross-site attacker cannot read.
  setCookie(c, CSRF_COOKIE, randomToken(16), {
    httpOnly: false,
    sameSite: 'Lax',
    secure,
    path: '/',
    maxAge,
  });

  const destination = new URL(safeReturnTo(transaction.returnTo), origin);
  // A full navigation back to the SPA is the reload, but the marker lets the
  // header refresh the session (and consume the parameter) without waiting for
  // a second mount. Re-login with a different Google account or photo then
  // updates the header immediately instead of showing the previous identity.
  destination.searchParams.set('auth', 'success');
  return c.redirect(destination.toString(), 302);
});

/** The SPA asks who is signed in. 204 = nobody, and that is not an error. */
authRoutes.get('/api/auth/me', async (c) => {
  const token = getCookie(c, SESSION_COOKIE) ?? '';
  const account = token
    ? await new D1AuthStore(c.env.DB).resolveSession(token).catch(() => undefined)
    : undefined;

  if (!account) return c.body(null, 204);
  return c.json({ account });
});

authRoutes.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE) ?? '';

  if (token) {
    // Logging out revokes a live session, so a cookie alone must not be enough:
    // a cross-site POST would otherwise be able to sign the victim out. A caller
    // without the header gets 403 and keeps its session — the safe direction.
    const denied = requireCsrf(c);
    if (denied) return denied;
    await new D1AuthStore(c.env.DB).revokeSession(token).catch((error: unknown) => {
      console.error('could not revoke the session', error);
    });
  }

  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  deleteCookie(c, CSRF_COOKIE, { path: '/' });
  return c.body(null, 204);
});
