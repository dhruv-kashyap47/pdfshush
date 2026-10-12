/**
 * Account, session and auth-transaction persistence.
 *
 * Two rules shape this file:
 *
 *  - the raw session token never reaches the database. The row is keyed by its
 *    SHA-256, so a database dump cannot be replayed as a set of live sessions.
 *  - expiry is enforced in code, not only by the TTL index. A TTL monitor runs
 *    about once a minute, and a session that outlives its expiry by 59 seconds
 *    is still a valid session.
 */

import { createHash } from 'node:crypto';
import type { GoogleProfile } from './google.js';
import { randomToken } from './google.js';
import type { AccountDoc, AuthCollections, SessionDoc } from './mongo.js';

export interface Account {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  createdAt: Date;
}

export interface IssuedSession {
  /** Returned once, to be set as a cookie; only its hash is stored. */
  token: string;
  expiresAt: Date;
}

export interface AuthTransaction {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toAccount(doc: AccountDoc): Account {
  return {
    id: doc._id,
    email: doc.email,
    emailVerified: doc.emailVerified,
    name: doc.name,
    picture: doc.picture,
    createdAt: doc.createdAt,
  };
}

/** How long a half-finished login stays valid. Short: it is one round trip. */
export const AUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;

export class AuthStore {
  constructor(
    private readonly collections: AuthCollections,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Creates or updates the account for a Google subject.
   *
   * Keyed on `sub`, never on email: an email can be reassigned between Google
   * accounts, and linking on it would hand one person another's history.
   */
  async upsertAccount(profile: GoogleProfile): Promise<Account> {
    const timestamp = this.now();
    const doc = await this.collections.accounts.findOneAndUpdate(
      { googleSub: profile.sub },
      {
        $set: {
          email: profile.email,
          emailVerified: profile.emailVerified,
          name: profile.name,
          picture: profile.picture,
          lastLoginAt: timestamp,
        },
        $setOnInsert: { _id: randomToken(16), googleSub: profile.sub, createdAt: timestamp },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (!doc) throw new Error('Account upsert returned no document');
    return toAccount(doc);
  }

  async createSession(accountId: string, ttlMs: number): Promise<IssuedSession> {
    const token = randomToken(32);
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + ttlMs);
    await this.collections.sessions.insertOne({
      _id: hashToken(token),
      accountId,
      createdAt,
      expiresAt,
    });
    return { token, expiresAt };
  }

  /** Resolves a cookie value to its account, or `undefined` if not valid now. */
  async resolveSession(token: string): Promise<Account | undefined> {
    if (!token) return undefined;
    const session: SessionDoc | null = await this.collections.sessions.findOne({
      _id: hashToken(token),
    });
    if (!session || session.revokedAt) return undefined;
    // Code-side expiry check: the TTL index is housekeeping, not the gate.
    if (session.expiresAt.getTime() <= this.now().getTime()) return undefined;

    const account = await this.collections.accounts.findOne({ _id: session.accountId });
    return account ? toAccount(account) : undefined;
  }

  /** Marks a session revoked. Idempotent: signing out twice is not an error. */
  async revokeSession(token: string): Promise<void> {
    if (!token) return;
    await this.collections.sessions.updateOne(
      { _id: hashToken(token), revokedAt: { $exists: false } },
      { $set: { revokedAt: this.now() } },
    );
  }

  /** "Sign out everywhere". */
  async revokeAllSessions(accountId: string): Promise<number> {
    const result = await this.collections.sessions.updateMany(
      { accountId, revokedAt: { $exists: false } },
      { $set: { revokedAt: this.now() } },
    );
    return result.modifiedCount;
  }

  async startTransaction(transaction: AuthTransaction): Promise<void> {
    const createdAt = this.now();
    await this.collections.transactions.insertOne({
      _id: transaction.state,
      codeVerifier: transaction.codeVerifier,
      nonce: transaction.nonce,
      returnTo: transaction.returnTo,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + AUTH_TRANSACTION_TTL_MS),
    });
  }

  /**
   * Reads and deletes in one atomic step, so a replayed `state` is a miss rather
   * than a second successful login. `findOneAndDelete` is what makes that
   * single-use rather than merely short-lived.
   */
  async takeTransaction(state: string): Promise<AuthTransaction | undefined> {
    if (!state) return undefined;
    const doc = await this.collections.transactions.findOneAndDelete({ _id: state });
    if (!doc) return undefined;
    if (doc.expiresAt.getTime() <= this.now().getTime()) return undefined;
    return {
      state: doc._id,
      codeVerifier: doc.codeVerifier,
      nonce: doc.nonce,
      returnTo: doc.returnTo,
    };
  }
}
