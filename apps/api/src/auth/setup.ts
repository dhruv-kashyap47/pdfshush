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
    oidc: new GoogleOidc({
      clientId: auth.googleClientId,
      clientSecret: auth.googleClientSecret,
      redirectUri: auth.redirectUri,
    }),
    close: () => db.close(),
  };
}
