/**
 * Google OIDC: Authorization Code flow with PKCE.
 *
 * The verifier, the `state` and the `nonce` are all minted here and validated
 * here. `state` and `nonce` are checked against the server-side transaction that
 * `/start` wrote, never against a value the client supplies about itself.
 *
 * Endpoints are Google's documented, stable ones rather than a discovery
 * round-trip on the first login. They are injectable so tests can point at a
 * local key set and token stub instead of the network.
 *
 * Reference: Google's OpenID Connect discovery document,
 * https://accounts.google.com/.well-known/openid-configuration
 */

import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export const GOOGLE_ISSUER = 'https://accounts.google.com';
export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';

/** URL-safe base64 without padding, per RFC 7636. */
export function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function randomToken(bytes = 32): string {
  return base64Url(randomBytes(bytes));
}

/** RFC 7636 S256 challenge. */
export function codeChallengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export interface GoogleProfile {
  /** `sub`: stable and never reused. The only key we link accounts on. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface GoogleOidcOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksUri?: string;
  fetchImpl?: typeof fetch;
}

export class GoogleOidcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GoogleOidcError';
    this.code = code;
  }
}

export class GoogleOidc {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly issuer: string;
  private readonly authorizationEndpoint: string;
  private readonly tokenEndpoint: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoogleOidcOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri;
    this.issuer = options.issuer ?? GOOGLE_ISSUER;
    this.authorizationEndpoint = options.authorizationEndpoint ?? GOOGLE_AUTHORIZATION_ENDPOINT;
    this.tokenEndpoint = options.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    // jose caches the key set internally and refetches on an unknown `kid`, so
    // key rotation needs no handling here. Only the URL is injectable: tests
    // serve a key set over a local HTTP listener rather than stubbing fetch
    // inside jose.
    this.jwks = createRemoteJWKSet(new URL(options.jwksUri ?? GOOGLE_JWKS_URI));
  }

  /**
   * Where to send the browser. `access_type=offline` is deliberately absent: we
   * are not holding Google refresh tokens, so asking for offline access would
   * collect a durable credential we have no use for.
   */
  authorizationUrl(params: { state: string; codeChallenge: string; nonce: string }): string {
    const url = new URL(this.authorizationEndpoint);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', params.state);
    url.searchParams.set('nonce', params.nonce);
    url.searchParams.set('code_challenge', params.codeChallenge);
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
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: params.codeVerifier,
    });

    const response = await this.fetchImpl(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      // The response body can echo the request, so only the status is surfaced.
      throw new GoogleOidcError('token_exchange_failed', 'Google rejected the sign-in attempt.');
    }

    const payload = (await response.json()) as { id_token?: unknown };
    if (typeof payload.id_token !== 'string' || payload.id_token.length === 0) {
      throw new GoogleOidcError('no_id_token', 'Google did not return an identity token.');
    }
    return payload.id_token;
  }

  /**
   * Verifies the ID token and binds it to this login.
   *
   * `jwtVerify` checks the signature against Google's JWKS plus `exp`/`nbf`,
   * and the `issuer`/`audience` options check `iss` and `aud`. The `nonce` is
   * checked here because it is the one claim that is ours rather than Google's:
   * it proves the token answers the request *we* started, which is what stops a
   * token minted for another session being replayed into this one.
   */
  async verifyIdToken(idToken: string, expectedNonce: string): Promise<GoogleProfile> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.jwks, {
        issuer: [this.issuer, 'accounts.google.com'],
        audience: this.clientId,
      }));
    } catch {
      throw new GoogleOidcError('invalid_id_token', 'Google returned an identity token we could not verify.');
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
      // Google sends these as booleans; anything else means absent, not true.
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === 'string' ? payload.name : null,
      picture: typeof payload.picture === 'string' ? payload.picture : null,
    };
  }
}
