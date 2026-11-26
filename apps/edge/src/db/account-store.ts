/**
 * Account-scoped data on D1: preferences, synced history, saved workflows, and
 * erasure. The port of `apps/api/src/account/store.ts`.
 *
 * Every statement is filtered by `account_id`, and no route takes an account id
 * from the client — that is the whole authorisation model for this layer, the
 * same one the Mongo version relied on.
 *
 * There is no job-ownership table here: the free shape runs no server-side jobs,
 * so there is nothing to own. `/api/account/jobs` answers an empty list rather
 * than a 503 so the account page does not show an error panel.
 */

import type { D1Database } from '../env.js';
import type { Workflow } from '@pdfshush/pdf-core/workflow';
import { randomToken } from '../lib/crypto.js';

export interface HistoryEntry {
  id: string;
  toolSlug: string;
  toolName: string;
  fileName: string;
  pageCount?: number;
  sizeBytes?: number;
  createdAt: number;
}

export interface StoredWorkflow {
  id: string;
  name: string;
  steps: Workflow['steps'];
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface NewHistoryEntry {
  toolSlug: string;
  toolName: string;
  fileName: string;
  createdAt?: number;
  clientId?: string;
  pageCount?: number;
  sizeBytes?: number;
}

/** Mirrors the SPA's local list so the two never disagree. */
export const MAX_HISTORY_ENTRIES = 100;
export const MAX_WORKFLOWS = 50;

interface HistoryRow {
  id: string;
  tool_slug: string;
  tool_name: string;
  file_name: string;
  page_count: number | null;
  size_bytes: number | null;
  created_at: number;
}

interface WorkflowRow {
  id: string;
  name: string;
  version: number;
  steps: string;
  created_at: number;
  updated_at: number;
}

function toHistory(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    toolSlug: row.tool_slug,
    toolName: row.tool_name,
    fileName: row.file_name,
    ...(row.page_count !== null ? { pageCount: row.page_count } : {}),
    ...(row.size_bytes !== null ? { sizeBytes: row.size_bytes } : {}),
    createdAt: row.created_at,
  };
}

function toWorkflow(row: WorkflowRow): StoredWorkflow {
  return {
    id: row.id,
    name: row.name,
    steps: JSON.parse(row.steps) as Workflow['steps'],
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class D1AccountStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /* ------------------------------------------------------- preferences */

  async getPreferences(accountId: string): Promise<Record<string, unknown>> {
    const row = await this.db
      .prepare(`SELECT data FROM preferences WHERE account_id = ?`)
      .bind(accountId)
      .first<{ data: string }>();
    if (!row) return {};
    try {
      const parsed = JSON.parse(row.data) as unknown;
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      // A corrupt blob must not break the account page; empty is the safe read.
      return {};
    }
  }

  /** Shallow merge: a settings panel sends only the keys it owns. */
  async setPreferences(
    accountId: string,
    values: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const existing = await this.getPreferences(accountId);
    const merged = { ...existing, ...values };

    await this.db
      .prepare(
        `INSERT INTO preferences (account_id, updated_at, data)
         VALUES (?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET
           updated_at = excluded.updated_at,
           data = excluded.data`,
      )
      .bind(accountId, this.now().getTime(), JSON.stringify(merged))
      .run();

    return merged;
  }

  /* ----------------------------------------------------------- history */

  async listHistory(accountId: string, limit = MAX_HISTORY_ENTRIES): Promise<HistoryEntry[]> {
    const capped = Math.min(Math.max(limit, 1), MAX_HISTORY_ENTRIES);
    const { results } = await this.db
      .prepare(
        `SELECT id, tool_slug, tool_name, file_name, page_count, size_bytes, created_at
           FROM history
          WHERE account_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
      )
      .bind(accountId, capped)
      .all<HistoryRow>();

    return results.map(toHistory);
  }

  async addHistory(accountId: string, entry: NewHistoryEntry): Promise<HistoryEntry> {
    const createdAt = entry.createdAt ?? this.now().getTime();
    // A client-supplied id makes retries and imports idempotent.
    const id = entry.clientId
      ? `${accountId}:client:${entry.clientId}`
      : `${accountId}:${createdAt}:${randomToken(6)}`;

    const row = await this.db
      .prepare(
        `INSERT INTO history
           (id, account_id, tool_slug, tool_name, file_name, page_count, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           tool_slug = excluded.tool_slug,
           tool_name = excluded.tool_name,
           file_name = excluded.file_name,
           page_count = excluded.page_count,
           size_bytes = excluded.size_bytes
         RETURNING *`,
      )
      .bind(
        id,
        accountId,
        entry.toolSlug.slice(0, 64),
        entry.toolName.slice(0, 120),
        entry.fileName.slice(0, 255),
        entry.pageCount ?? null,
        entry.sizeBytes ?? null,
        createdAt,
      )
      .first<HistoryRow>();

    // Keep the newest MAX_HISTORY_ENTRIES. The Mongo version did this with a
    // `$slice` on the array; here it is one statement after the insert.
    await this.db
      .prepare(
        `DELETE FROM history
          WHERE account_id = ?
            AND id NOT IN (
              SELECT id FROM history
               WHERE account_id = ?
               ORDER BY created_at DESC, id DESC
               LIMIT ?
            )`,
      )
      .bind(accountId, accountId, MAX_HISTORY_ENTRIES)
      .run();

    if (!row) throw new Error('History insert returned no row');
    return toHistory(row);
  }

  async clearHistory(accountId: string): Promise<number> {
    const result = await this.db
      .prepare(`DELETE FROM history WHERE account_id = ?`)
      .bind(accountId)
      .run();
    return result.meta.changes;
  }

  /* --------------------------------------------------------- workflows */

  async listWorkflows(accountId: string): Promise<StoredWorkflow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, name, version, steps, created_at, updated_at
           FROM workflows
          WHERE account_id = ?
          ORDER BY updated_at DESC`,
      )
      .bind(accountId)
      .all<WorkflowRow>();

    return results.map(toWorkflow);
  }

  async countWorkflows(accountId: string): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM workflows WHERE account_id = ?`)
      .bind(accountId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async createWorkflow(
    accountId: string,
    recipe: { name: string; steps: Workflow['steps'] },
  ): Promise<StoredWorkflow> {
    const timestamp = this.now().getTime();
    const row = await this.db
      .prepare(
        `INSERT INTO workflows (id, account_id, name, version, steps, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        randomToken(12),
        accountId,
        recipe.name,
        1,
        JSON.stringify(recipe.steps),
        timestamp,
        timestamp,
      )
      .first<WorkflowRow>();

    if (!row) throw new Error('Workflow insert returned no row');
    return toWorkflow(row);
  }

  async updateWorkflow(
    accountId: string,
    id: string,
    recipe: { name: string; steps: Workflow['steps'] },
  ): Promise<StoredWorkflow | undefined> {
    const row = await this.db
      .prepare(
        `UPDATE workflows
            SET name = ?, steps = ?, updated_at = ?
          WHERE id = ? AND account_id = ?
          RETURNING *`,
      )
      .bind(recipe.name, JSON.stringify(recipe.steps), this.now().getTime(), id, accountId)
      .first<WorkflowRow>();

    return row ? toWorkflow(row) : undefined;
  }

  async deleteWorkflow(accountId: string, id: string): Promise<boolean> {
    const result = await this.db
      .prepare(`DELETE FROM workflows WHERE id = ? AND account_id = ?`)
      .bind(id, accountId)
      .run();
    return result.meta.changes > 0;
  }

  /* ----------------------------------------------------------- erasure */

  /**
   * Real deletion, not a soft-delete flag. Counts are read first so the response
   * can report what went, and the deletes run as one batch so a partial erasure
   * is not a state anyone can observe.
   */
  async deleteAccountData(accountId: string): Promise<Record<string, number>> {
    const counts = await this.db.batch([
      this.db.prepare(`SELECT COUNT(*) AS n FROM preferences WHERE account_id = ?`).bind(accountId),
      this.db.prepare(`SELECT COUNT(*) AS n FROM history WHERE account_id = ?`).bind(accountId),
      this.db.prepare(`SELECT COUNT(*) AS n FROM workflows WHERE account_id = ?`).bind(accountId),
      this.db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?`).bind(accountId),
    ]);

    const value = (index: number): number => {
      const row = counts[index]?.results[0] as { n?: unknown } | undefined;
      return typeof row?.n === 'number' ? row.n : 0;
    };

    await this.db.batch([
      this.db.prepare(`DELETE FROM preferences WHERE account_id = ?`).bind(accountId),
      this.db.prepare(`DELETE FROM history WHERE account_id = ?`).bind(accountId),
      this.db.prepare(`DELETE FROM workflows WHERE account_id = ?`).bind(accountId),
      this.db.prepare(`DELETE FROM sessions WHERE account_id = ?`).bind(accountId),
      this.db.prepare(`DELETE FROM accounts WHERE id = ?`).bind(accountId),
    ]);

    return {
      preferences: value(0),
      history: value(1),
      workflows: value(2),
      sessions: value(3),
    };
  }
}
