/**
 * API-key management for the account dashboard (PLAN.md §25.3).
 *
 * Sessions + CSRF like every other account route; the keys themselves are
 * bearer credentials for the public `/api/v1` surface, so nothing here trusts
 * a CSRF-protected browser call to mint or revoke more than that account's
 * own keys.
 */

import type { Express, Request, Response } from 'express';
import type { AuthStore, Account } from '../auth/store.js';
import { SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER } from '../auth/routes.js';
import { tokensMatch } from '../quota/quota.js';
import type { ApiKeyStore, ApiKeyScope, CreatedApiKey } from '../keys/store.js';
import { API_KEY_SCOPES } from '../keys/store.js';

export interface ApiKeyRoutesDeps {
  enabled: boolean;
  auth?: AuthStore;
  keys?: ApiKeyStore;
  maxKeysPerAccount: number;
  logger: { warn: (obj: unknown, msg: string) => void };
}

/** Creation response: the full token appears here, and never anywhere again. */
export interface CreatedKeyResponse {
  key: {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    createdAt: number;
  };
  token: string;
}

function readCookies(request: Request): Record<string, unknown> {
  return (request as Request & { cookies?: Record<string, unknown> }).cookies ?? {};
}

export function registerApiKeyRoutes(app: Express, deps: ApiKeyRoutesDeps): void {
  const unavailable = (response: Response) =>
    response.status(503).json({ error: 'Accounts are not enabled on this deployment.', code: 'auth_disabled' });

  /** Resolves the session or answers 401, and returns the account on success. */
  const requireAccount = async (
    request: Request,
    response: Response,
  ): Promise<Account | undefined> => {
    if (!deps.enabled || !deps.auth) {
      unavailable(response);
      return undefined;
    }
    const token = readCookies(request)[SESSION_COOKIE];
    const account = typeof token === 'string' ? await deps.auth.resolveSession(token) : undefined;
    if (!account) {
      response.status(401).json({ error: 'Sign in required.', code: 'unauthenticated' });
      return undefined;
    }
    return account;
  };

  const requireCsrf = (request: Request, response: Response): boolean => {
    const cookies = readCookies(request);
    const expected = cookies[CSRF_COOKIE];
    const supplied = request.header(CSRF_HEADER);
    // Same constant-time compare as the account routes: a real value
    // comparison, length-checked first, never a structural guess.
    if (
      typeof expected !== 'string' ||
      typeof supplied !== 'string' ||
      !tokensMatch(supplied, expected)
    ) {
      response.status(403).json({ error: 'Missing or invalid CSRF token.', code: 'csrf' });
      return false;
    }
    return true;
  };

  app.get('/api/account/api-keys', async (request, response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.keys) return;
    response.json({ keys: await deps.keys.list(account.id) });
  });

  app.post('/api/account/api-keys', async (request, response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.keys) return;
    if (!requireCsrf(request, response)) return;

    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length === 0 || name.length > 80) {
      response
        .status(400)
        .json({ error: 'A key needs a name of 1-80 characters.', code: 'validation_failed' });
      return;
    }
    let scopes: string[] | undefined;
    if (body.scopes !== undefined) {
      if (!Array.isArray(body.scopes) || body.scopes.some((scope) => typeof scope !== 'string')) {
        response
          .status(400)
          .json({ error: '`scopes` must be an array of strings.', code: 'validation_failed' });
        return;
      }
      const allowed = new Set<string>(API_KEY_SCOPES);
      // An unknown scope name is repaired nowhere else: the request must name
      // real scopes, or fail loudly, even though most callers may simply
      // accept all of them by default.
      if (body.scopes.length > 0 && body.scopes.some((scope) => !allowed.has(scope))) {
        response.status(400).json({
          error: `Unknown scope. Valid scopes: ${API_KEY_SCOPES.join(', ')}.`,
          code: 'validation_failed',
        });
        return;
      }
      scopes = [...new Set(body.scopes as string[])];
    }

    const live = await deps.keys.countLive(account.id);
    if (live >= deps.maxKeysPerAccount) {
      response.status(409).json({
        error: `A maximum of ${deps.maxKeysPerAccount} keys per account.`,
        code: 'limit',
      });
      return;
    }

    const created: CreatedApiKey = await deps.keys.create(account.id, {
      name,
      ...(scopes ? { scopes: scopes as ApiKeyScope[] } : {}),
    });
    deps.logger.warn({ accountId: account.id, keyId: created.id }, 'API key created');
    response.status(201).json({
      key: {
        id: created.id,
        name: created.name,
        prefix: created.prefix,
        scopes: created.scopes,
        createdAt: created.createdAt,
      },
      token: created.token,
    });
  });

  app.delete('/api/account/api-keys/:id', async (request, response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.keys) return;
    if (!requireCsrf(request, response)) return;
    // Filtered by account, so "nobody else's key id" and "no such key" are
    // the same 404 by construction.
    const removed = await deps.keys.revoke(account.id, String(request.params.id ?? ''));
    if (!removed) {
      response.status(404).json({ error: 'No such key.', code: 'not_found' });
      return;
    }
    deps.logger.warn({ accountId: account.id, keyId: String(request.params.id) }, 'API key revoked');
    response.status(204).end();
  });
}
