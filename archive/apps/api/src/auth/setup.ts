/**
 * Builds the auth services from configuration.
 *
 * Deliberately non-fatal. Accounts are an addition to a product whose tools are
 * all anonymous, so an unreachable Mongo or a typo'd client id must downgrade to
 * "sign-in unavailable" rather than stop the API from booting.
 */

import type { ApiConfig } from '../config.js';
import type { AuthServices } from '../context.js';
import type { Logger } from '../logger.js';
import { GoogleOidc } from './google.js';
import { createAuthDb } from './mongo.js';
import { AuthStore } from './store.js';
import { AccountStore } from '../account/store.js';
import { ApiKeyStore } from '../keys/store.js';

/**
 * The auth downgrade logs this message verbatim, so it must read as a
 * diagnosis, not a stack trace. Most failures (bad URI, auth failure, timeout)
 * describe themselves; the one that does not is TLS:
 *
 * MongoDB aborts the handshake with "tlsv1 alert internal error" (alert 80) --
 * a *server-side* alert, which is why the wording is so unhelpful. For Atlas
 * clusters this almost always means the server refuses to talk to this
 * machine: its public IP is missing from the project's Network Access list.
 * Not a cipher, TLS-version or certificate problem -- those fail later, and
 * differently -- and reproducible from any client TLS stack, which is what
 * makes the cause sing.
 */
function describeAuthDbFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (/tlsv1 alert internal error|ssl alert number 80/i.test(detail)) {
    return (
      'MongoDB aborted the TLS handshake (server alert 80). With Atlas this almost always means ' +
      "this machine's public IP is not on the cluster's Network Access list: add it at " +
      'cloud.mongodb.com -> Network Access (or 0.0.0.0/0 for a development machine with a ' +
      `roaming IP) and restart this process. All other tools keep working anonymous. ` +
      `Underlying error: ${detail}`
    );
  }
  return detail;
}

export async function setupAuth(config: ApiConfig, logger: Logger): Promise<AuthServices | undefined> {
  const { auth } = config;
  if (!auth.enabled) return undefined;
  // `enabled` already implies all three, but re-checking keeps the types honest
  // without a non-null assertion.
  if (!auth.mongoUri || !auth.googleClientId || !auth.googleClientSecret) return undefined;

  const db = await createAuthDb({
    uri: auth.mongoUri,
    dbName: auth.mongoDb,
    username: auth.mongoUsername,
    password: auth.mongoPassword,
  }).catch((error: unknown) => {
    // The server.ts catch logs this message's text; point it at today's most
    // common Atlas misconfiguration rather than an OpenSSL library string. The
    // original error stays attached as `cause` for anyone debugging further.
    throw new Error(describeAuthDbFailure(error), { cause: error });
  });

  logger.info(
    { db: auth.mongoDb, redirectUri: auth.redirectUri, webOrigin: auth.webOrigin },
    'accounts enabled',
  );

  // Two misconfigurations that fail silently in the browser rather than loudly
  // here: a `Secure` cookie is dropped on a plain-http origin (except localhost,
  // which browsers treat as trustworthy), so sign-in would appear to succeed and
  // then behave as if signed out.
  const secureCookie = config.auth.cookieSecure;
  const plainHttp = /^http:\/\//i.test(auth.webOrigin);
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(auth.webOrigin);
  if (secureCookie && plainHttp && !isLocalhost) {
    logger.warn(
      { webOrigin: auth.webOrigin },
      'SESSION_COOKIE_SECURE is on but WEB_ORIGIN is plain http: session cookies will be ' +
        'rejected by the browser. Serve over https, or set SESSION_COOKIE_SECURE=false for ' +
        'local development.',
    );
  }
  if (config.isProduction && plainHttp) {
    logger.warn(
      { webOrigin: auth.webOrigin },
      'production WEB_ORIGIN is plain http: OAuth redirects and session cookies need https',
    );
  }

  return {
    store: new AuthStore(db),
    account: new AccountStore(db),
    keys: new ApiKeyStore(db),
    oidc: new GoogleOidc({
      clientId: auth.googleClientId,
      clientSecret: auth.googleClientSecret,
      redirectUri: auth.redirectUri,
    }),
    close: () => db.close(),
  };
}
