/**
 * Public-API keys (PLAN.md §25.3, decision D5).
 *
 * A key is a bearer credential that belongs to an account and is presented via
 * the `x-api-key` header. Three properties carry the whole design:
 *
 * - **Hashed at rest.** The stored `_id` is the SHA-256 of the full token, so a
 *   database leak yields nothing usable -- the same posture session tokens use.
 *   It also makes lookup a single indexed `findOne({_id})` with no scan.
 * - **Shown exactly once.** Only the first characters are kept as `prefix` for
 *   display; the raw token exists solely in the creation response.
 * - **Never the account itself.** Quota and job ownership are attributed per
 *   key id, so a compromised key can be revoked without touching the account,
 *   and one key's usage never counts against its siblings.
 */

import { createHash, randomBytes } from 'node:crypto';
import { API_KEY_SCOPES, type ApiKeyScope } from '@pdfshush/api-contracts';
import type { ApiKeyDoc, AuthCollections } from '../auth/mongo.js';

export type { ApiKeyDoc };
/** Re-exported for the account routes and the OpenAPI document. */
export { API_KEY_SCOPES };
export type { ApiKeyScope };

/** Every API key starts with this, so prefix confusion cannot happen. */
export const API_KEY_PREFIX = 'pshk_';

/** Human-identifiable prefix kept for display (16 chars incl. the scheme). */
const DISPLAY_PREFIX_LENGTH = 16;

/**
 * Scopes a key may hold. The list lives in `@pdfshush/api-contracts` (D5:
 * no AI scope by design -- the managed-AI budget is an interaction-cost
 * guard, not something a programmatic key should silently spend).
 */

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: boolean;
}

export interface CreatedApiKey extends ApiKeyView {
  /** The full token, present only in the creation response. */
  token: string;
}

export interface CreateApiKeyRequest {
  name: string;
  scopes?: readonly string[];
}

function toView(doc: ApiKeyDoc): ApiKeyView {
  return {
    id: doc._id,
    name: doc.name,
    prefix: doc.prefix,
    scopes: doc.scopes,
    createdAt: doc.createdAt.getTime(),
    ...(doc.lastUsedAt ? { lastUsedAt: doc.lastUsedAt.getTime() } : {}),
    ...(doc.revokedAt ? { revokedAt: true } : {}),
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class ApiKeyStore {
  constructor(
    private readonly collections: AuthCollections,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Mints a token and stores only its hash. 32 random bytes, base64url --
   * 43 characters that are safe in a header and never need quoting.
   */
  async create(accountId: string, request: CreateApiKeyRequest): Promise<CreatedApiKey> {
    const scopes = this.normaliseScopes(request.scopes);
    const token = API_KEY_PREFIX + randomBytes(32).toString('base64url');
    const doc: ApiKeyDoc = {
      _id: hashToken(token),
      accountId,
      name: request.name.slice(0, 80),
      prefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
      scopes,
      createdAt: this.now(),
    };
    await this.collections.apiKeys.insertOne(doc);
    return { ...toView(doc), token };
  }

  async list(accountId: string): Promise<ApiKeyView[]> {
    const docs = await this.collections.apiKeys
      .find({ accountId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map(toView);
  }

  /** Revocation is a mark, not a delete: "when was this used?" stays answerable. */
  async revoke(accountId: string, keyId: string): Promise<boolean> {
    const result = await this.collections.apiKeys.updateOne(
      { _id: keyId, accountId },
      { $set: { revokedAt: this.now() } },
    );
    return result.modifiedCount > 0;
  }

  /**
   * Resolves a presented token. Returns the document only when it is found and
   * not revoked; a revoked key is indistinguishable from an invalid one, which
   * is exactly what a caller should be able to learn.
   * Touches `lastUsedAt` best-effort so the dashboard can show activity.
   */
  async resolve(token: string): Promise<ApiKeyDoc | undefined> {
    if (typeof token !== 'string' || !token.startsWith(API_KEY_PREFIX)) return undefined;
    const doc = await this.collections.apiKeys.findOne({ _id: hashToken(token) });
    if (!doc || doc.revokedAt) return undefined;
    await this.collections.apiKeys
      .updateOne({ _id: doc._id }, { $set: { lastUsedAt: this.now() } })
      .catch(() => undefined);
    return doc;
  }

  /** How many live keys an account holds, for the per-account cap. */
  async countLive(accountId: string): Promise<number> {
    return this.collections.apiKeys.countDocuments({ accountId, revokedAt: { $exists: false } });
  }

  private normaliseScopes(scopes?: readonly string[]): ApiKeyScope[] {
    if (!scopes || scopes.length === 0) return [...API_KEY_SCOPES];
    const allowed = new Set<string>(API_KEY_SCOPES);
    const picked = scopes.filter((scope): scope is ApiKeyScope => allowed.has(scope));
    // Silent intersection hid typos ("jobs:Write") behind an over-permissive
    // default. An unknown scope is a client error and must be repaired by the
    // caller, not forgiven here.
    if (picked.length !== scopes.length) {
      throw new Error('Unknown scope requested');
    }
    return [...new Set(picked)];
  }
}
