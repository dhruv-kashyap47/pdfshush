/**
 * Accounts, sessions and half-finished logins, on D1.
 *
 * This is the port of `apps/api/src/auth/store.ts`. The security properties are
 * deliberately identical:
 *
 *   - the raw session token never reaches the database; the row is keyed by its
 *     SHA-256, so a dump cannot be replayed as live sessions;
 *   - expiry is checked in the query, not only by the sweeper, so a row that
 *     outlives its window is already inert;
 *   - `takeTransaction` deletes and reads in one statement, which is what makes
 *     a replayed `state` a miss rather than a second login.
 */

import type { D1Database } from '../env.js';
import type { GoogleProfile } from '../auth/oidc.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';

export interface Account {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  createdAt: Date;
  /** 'free' | 'pro'. Drives the AI allowance and whether the SPA shows ads. */
  plan: 'free' | 'pro';
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

interface AccountRow {
  id: string;
  google_sub: string;
  email: string | null;
  email_verified: number;
  name: string | null;
  picture: string | null;
  created_at: number;
  last_login_at: number;
  plan: string;
}

interface TransactionRow {
  state: string;
  code_verifier: string;
  nonce: string;
  return_to: string;
  expires_at: number;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified === 1,
    name: row.name,
    picture: row.picture,
    createdAt: new Date(row.created_at),
    // Anything that is not exactly 'pro' is treated as free: a typo in a future
    // webhook must fail closed, not hand out the paid allowance.
    plan: row.plan === 'pro' ? 'pro' : 'free',
  };
}

export class D1AuthStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Keyed on Google's `sub`, never on email: an address can be reassigned
   * between accounts, and linking on it would hand one person another's data.
   */
  async upsertAccount(profile: GoogleProfile): Promise<Account> {
    const timestamp = this.now().getTime();
    const row = await this.db
      .prepare(
        `INSERT INTO accounts
           (id, google_sub, email, email_verified, name, picture, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(google_sub) DO UPDATE SET
           email = excluded.email,
           email_verified = excluded.email_verified,
           name = excluded.name,
           picture = excluded.picture,
           last_login_at = excluded.last_login_at
         RETURNING *`,
      )
      .bind(
        randomToken(16),
        profile.sub,
        profile.email,
        profile.emailVerified ? 1 : 0,
        profile.name,
        profile.picture,
        timestamp,
        timestamp,
      )
      .first<AccountRow>();

    if (!row) throw new Error('Account upsert returned no row');
    return toAccount(row);
  }

  async createSession(accountId: string, ttlMs: number): Promise<IssuedSession> {
    const token = randomToken(32);
    const createdAt = this.now().getTime();
    const expiresAt = createdAt + ttlMs;

    await this.db
      .prepare(
        `INSERT INTO sessions (token_hash, account_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(await sha256Hex(token), accountId, createdAt, expiresAt)
      .run();

    return { token, expiresAt: new Date(expiresAt) };
  }

  async resolveSession(token: string): Promise<Account | undefined> {
    if (!token) return undefined;

    const row = await this.db
      .prepare(
        `SELECT a.*
           FROM sessions s
           JOIN accounts a ON a.id = s.account_id
          WHERE s.token_hash = ?
            AND s.revoked_at IS NULL
            AND s.expires_at > ?`,
      )
      .bind(await sha256Hex(token), this.now().getTime())
      .first<AccountRow>();

    return row ? toAccount(row) : undefined;
  }

  /** Idempotent: signing out twice is not an error. */
  async revokeSession(token: string): Promise<void> {
    if (!token) return;
    await this.db
      .prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
      .bind(this.now().getTime(), await sha256Hex(token))
      .run();
  }

  /** "Sign out everywhere". Returns how many were still live. */
  async revokeAllSessions(accountId: string): Promise<number> {
    const result = await this.db
      .prepare(`UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL`)
      .bind(this.now().getTime(), accountId)
      .run();
    return result.meta.changes;
  }

  async startTransaction(transaction: AuthTransaction): Promise<void> {
    const createdAt = this.now().getTime();
    await this.db
      .prepare(
        `INSERT INTO auth_transactions (state, code_verifier, nonce, return_to, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        transaction.state,
        transaction.codeVerifier,
        transaction.nonce,
        transaction.returnTo,
        createdAt,
        createdAt + 10 * 60 * 1000,
      )
      .run();
  }

  /**
   * Reads and deletes in one statement. `RETURNING` is what makes the `state`
   * single-use; the expiry check then runs in code, exactly as the Mongo
   * `findOneAndDelete` path did.
   */
  async takeTransaction(state: string): Promise<AuthTransaction | undefined> {
    if (!state) return undefined;

    const row = await this.db
      .prepare(
        `DELETE FROM auth_transactions
          WHERE state = ?
          RETURNING state, code_verifier, nonce, return_to, expires_at`,
      )
      .bind(state)
      .first<TransactionRow>();

    if (!row) return undefined;
    if (row.expires_at <= this.now().getTime()) return undefined;

    return {
      state: row.state,
      codeVerifier: row.code_verifier,
      nonce: row.nonce,
      returnTo: row.return_to,
    };
  }

  /** Housekeeping for the cron trigger; correctness never depends on it. */
  async purgeExpired(now = this.now().getTime()): Promise<{ sessions: number; transactions: number }> {
    const [sessions, transactions] = await this.db.batch([
      this.db
        .prepare(`DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL`)
        .bind(now),
      this.db.prepare(`DELETE FROM auth_transactions WHERE expires_at <= ?`).bind(now),
    ]);

    return {
      sessions: sessions?.meta.changes ?? 0,
      transactions: transactions?.meta.changes ?? 0,
    };
  }
}
