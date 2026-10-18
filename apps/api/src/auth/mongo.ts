/**
 * Mongo connection and collections for accounts, sessions and auth state.
 *
 * Mongo is the store of record for account data only (PLAN.md §18.1). Redis
 * stays what it is -- queue, quota counters, job state -- and job metadata stays
 * temporary, so nothing durable is ever built on top of a janitor-swept job.
 *
 * The connection is opened lazily and failures are surfaced as a disabled auth
 * layer rather than a failed boot: the anonymous tools are the product, and a
 * Mongo outage must not take them down.
 */

import { MongoClient, type Collection, type Db, type MongoClientOptions } from 'mongodb';

export const ACCOUNTS = 'accounts';
export const SESSIONS = 'sessions';
export const AUTH_TRANSACTIONS = 'authTransactions';
export const PREFERENCES = 'preferences';
export const HISTORY = 'history';
export const WORKFLOWS = 'workflows';
export const JOB_OWNERS = 'jobOwners';
export const API_KEYS = 'apiKeys';

export interface AccountDoc {
  /** Mongo's own id. */
  _id: string;
  /** Google's stable subject claim. The only identifier we trust for linking. */
  googleSub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  createdAt: Date;
  lastLoginAt: Date;
}

export interface SessionDoc {
  /** SHA-256 of the session token. The raw token is never stored. */
  _id: string;
  accountId: string;
  createdAt: Date;
  expiresAt: Date;
  /** Set instead of deleted, so "sign out everywhere" is auditable. */
  revokedAt?: Date;
}

/**
 * One in-flight login: the PKCE verifier and the `nonce` we minted, keyed by the
 * `state` we sent. Server-side rather than a cookie, which is what makes the
 * state a genuine single-use CSRF token instead of a value the client asserts
 * about itself.
 */
export interface AuthTransactionDoc {
  /** The `state` value; `_id` also makes reuse a duplicate-key error. */
  _id: string;
  codeVerifier: string;
  nonce: string;
  /** Same-origin path to return to, already validated. */
  returnTo: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface AuthCollections {
  accounts: Collection<AccountDoc>;
  sessions: Collection<SessionDoc>;
  transactions: Collection<AuthTransactionDoc>;
  preferences: Collection<PreferencesDoc>;
  history: Collection<HistoryDoc>;
  workflows: Collection<WorkflowDoc>;
  jobOwners: Collection<JobOwnerDoc>;
  apiKeys: Collection<ApiKeyDoc>;
}

/** One document per account. `_id` is the account id. */
export interface PreferencesDoc {
  _id: string;
  values: Record<string, unknown>;
  updatedAt: Date;
}

/**
 * History is deliberately small and metadata-only.
 *
 * A filename is user data, so this collection never holds page content, and the
 * SPA only writes here when the user opts in.
 */
export interface HistoryDoc {
  _id: string;
  accountId: string;
  toolSlug: string;
  toolName: string;
  fileName: string;
  pageCount?: number;
  sizeBytes?: number;
  createdAt: number;
}

export interface WorkflowDoc {
  _id: string;
  accountId: string;
  name: string;
  version: number;
  steps: unknown[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Which account submitted a job.
 *
 * Kept here rather than in Redis because BullMQ prunes its own completed jobs,
 * and "list my jobs" must survive that. TTL'd to the same retention as the files
 * so this cannot outlive the artefacts it points at.
 */
export interface JobOwnerDoc {
  _id: string;
  accountId: string;
  slug: string;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * One document per public-API key. `_id` is the SHA-256 of the full token --
 * see `keys/store.ts` for why the raw token is never stored.
 */
export interface ApiKeyDoc {
  _id: string;
  accountId: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
}

export interface AuthDb extends AuthCollections {
  db: Db;
  close(): Promise<void>;
}

/**
 * A `mongodb+srv://` URI normally carries credentials. Only pass the separate
 * username/password when it does not, or the driver is given two conflicting
 * sources for the same thing.
 */
function uriHasCredentials(uri: string): boolean {
  const schemeEnd = uri.indexOf('://');
  if (schemeEnd === -1) return false;
  const afterScheme = uri.slice(schemeEnd + 3);
  const authorityEnd = afterScheme.search(/[/?]/);
  const authority = authorityEnd === -1 ? afterScheme : afterScheme.slice(0, authorityEnd);
  return authority.includes('@');
}

export interface CreateAuthDbOptions {
  uri: string;
  dbName: string;
  username?: string | undefined;
  password?: string | undefined;
}

export async function createAuthDb(options: CreateAuthDbOptions): Promise<AuthDb> {
  const auth: MongoClientOptions['auth'] =
    options.username && options.password && !uriHasCredentials(options.uri)
      ? { username: options.username, password: options.password }
      : undefined;

  const client = new MongoClient(options.uri, {
    ...(auth ? { auth } : {}),
    // Bounded, so a Mongo that is unreachable fails a login attempt quickly
    // instead of holding the request until the platform timeout.
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
  });
  await client.connect();
  const db = client.db(options.dbName);

  const collections: AuthCollections = {
    accounts: db.collection<AccountDoc>(ACCOUNTS),
    sessions: db.collection<SessionDoc>(SESSIONS),
    transactions: db.collection<AuthTransactionDoc>(AUTH_TRANSACTIONS),
    preferences: db.collection<PreferencesDoc>(PREFERENCES),
    history: db.collection<HistoryDoc>(HISTORY),
    workflows: db.collection<WorkflowDoc>(WORKFLOWS),
    jobOwners: db.collection<JobOwnerDoc>(JOB_OWNERS),
    apiKeys: db.collection<ApiKeyDoc>(API_KEYS),
  };

  await Promise.all([
    collections.accounts.createIndex({ googleSub: 1 }, { unique: true }),
    collections.sessions.createIndex({ accountId: 1 }),
    // Both TTL indexes are housekeeping, not security: expiry is also checked in
    // code, because a TTL monitor runs about once a minute and a stale session
    // must not be usable in the gap.
    collections.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.transactions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    // Newest-first per account is the only read pattern for history and jobs.
    collections.history.createIndex({ accountId: 1, createdAt: -1 }),
    collections.workflows.createIndex({ accountId: 1, updatedAt: -1 }),
    collections.jobOwners.createIndex({ accountId: 1, createdAt: -1 }),
    collections.jobOwners.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    // apiKeys is keyed by its own `_id` (the token hash); this index is only the
    // dashboard listing pattern.
    collections.apiKeys.createIndex({ accountId: 1, createdAt: -1 }),
  ]);

  return {
    ...collections,
    db,
    close: () => client.close(),
  };
}
