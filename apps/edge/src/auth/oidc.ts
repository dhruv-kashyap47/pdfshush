/**
 * Google OIDC, Authorization Code flow with PKCE — the Worker port of
 * `apps/api/src/auth/google.ts`.
 *
 * Only the two Node-specific lines changed: `randomBytes`/`createHash` became
 * WebCrypto. `jose` already runs unmodified on Workers, and Google's JWKS is
 * cached per isolate, so key rotation still needs no handling here.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { codeChallengeFor, randomToken } from '../lib/crypto.js';

export const GOOGLE_ISSUER = 'https://accounts.google.com';
const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';

/** Module scope: one key set per isolate, not one per request. */
const jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));

export interface GoogleProfile {
  /** `sub`: stable and never reused. The only key accounts are linked on. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export class GoogleOidcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GoogleOidcError';
    this.code = code;
  }
}

export interface GoogleOidcConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Sign-in is off unless all three values resolve, same rule as the Express API. */
export function googleConfig(env: {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
}): GoogleOidcConfig | undefined {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return undefined;
  return { clientId, clientSecret, redirectUri };
}

export class GoogleOidc {
  private readonly config: GoogleOidcConfig;

  constructor(config: GoogleOidcConfig) {
    this.config = config;
  }

  /**
   * Where to send the browser. `access_type=offline` is deliberately absent: we
   * hold no Google refresh tokens, so asking for offline access would collect a
   * durable credential with no use.
   */
  async authorizationUrl(params: {
    state: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<string> {
    const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', params.state);
    url.searchParams.set('nonce', params.nonce);
    url.searchParams.set('code_challenge', await codeChallengeFor(params.codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
    // Always let the user pick the account: silently reusing the last session is
    // how people end up signed into the wrong Google account on a shared machine.
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  /** Server-to-server exchange. Returns the raw `id_token` for verification. */
  async exchangeCode(params: { code: string; codeVerifier: string }): Promise<string> {
    const body = new URLSearchParams({
      code: params.code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: params.codeVerifier,
    });

    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      // The response can echo the request, so only the status is surfaced.
      throw new GoogleOidcError('token_exchange_failed', 'Google rejected the sign-in attempt.');
    }

    const payload = (await response.json()) as { id_token?: unknown };
    if (typeof payload.id_token !== 'string' || payload.id_token.length === 0) {
      throw new GoogleOidcError('no_id_token', 'Google did not return an identity token.');
    }
    return payload.id_token;
  }

  /**
   * `jwtVerify` checks signature, `exp` and `nbf` against Google's key set, and
   * the options check `iss` and `aud`. The `nonce` is checked here because it is
   * ours rather than Google's: it proves the token answers the request this
   * deployment started.
   */
  async verifyIdToken(idToken: string, expectedNonce: string): Promise<GoogleProfile> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, jwks, {
        issuer: [GOOGLE_ISSUER, 'accounts.google.com'],
        audience: this.config.clientId,
      }));
    } catch {
      throw new GoogleOidcError(
        'invalid_id_token',
        'Google returned an identity token we could not verify.',
      );
    }

    if (typeof payload.nonce !== 'string' || payload.nonce !== expectedNonce) {
      throw new GoogleOidcError('nonce_mismatch', 'The sign-in response did not match this request.');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new GoogleOidcError('missing_subject', 'Google returned no subject identifier.');
    }

    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      // Google sends this as a boolean; anything else means absent, not true.
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === 'string' ? payload.name : null,
      picture: typeof payload.picture === 'string' ? payload.picture : null,
    };
  }
}

/** Exported for the callback's tests and for `randomToken` re-use. */
export { randomToken };
