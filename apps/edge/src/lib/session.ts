/**
 * The one way a route asks "who is this?".
 *
 * Every account route resolves the session itself and filters by the resolved
 * id; no route accepts an account id from the client, so a caller cannot address
 * another account. Keeping that in one function means a new route cannot
 * accidentally trust a body field instead of the cookie.
 */

import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AppEnv } from '../app-env.js';
import { D1AuthStore, type Account } from '../db/auth-store.js';
import { SESSION_COOKIE, fail } from './http.js';

export async function requireAccount(c: Context<AppEnv>): Promise<Account | Response> {
  const token = getCookie(c, SESSION_COOKIE) ?? '';
  const account = token ? await new D1AuthStore(c.env.DB).resolveSession(token) : undefined;
  if (!account) return fail(c, 401, 'unauthenticated', 'Sign in required.');
  return account;
}
