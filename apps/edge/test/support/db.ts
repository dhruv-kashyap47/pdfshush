/**
 * A D1-shaped database backed by `node:sqlite`, with the real migrations
 * applied. Tests exercise the actual SQL — `RETURNING`, the partial unique
 * index on `accounts.dodo_subscription_id`, `MAX()` scalar semantics — rather
 * than a mock that only agrees with itself.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { D1Database, D1Result, D1Statement } from '../../src/env.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

function migrationSql(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(migrationsDir, name), 'utf8'));
}

class TestStatement implements D1Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1Statement {
    return new TestStatement(this.db, this.sql, values);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.params as never[]));
    return (row as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const rows = this.db.prepare(this.sql).all(...(this.params as never[]));
    return { results: rows as T[], success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = this.db.prepare(this.sql).run(...(this.params as never[]));
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
        duration: 0,
      },
    };
  }
}

export class TestD1 implements D1Database {
  readonly sqlite: DatabaseSync;

  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    for (const sql of migrationSql()) this.sqlite.exec(sql);
  }

  prepare(sql: string): D1Statement {
    return new TestStatement(this.sqlite, sql);
  }

  async batch<T = Record<string, unknown>>(statements: D1Statement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const statement of statements) results.push(await statement.run<T>());
    return results;
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.sqlite.exec(sql);
    return { count: 0, duration: 0 };
  }

  /** Test-only escape hatch for setup and assertions. */
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    return this.sqlite.prepare(sql).get(...(params as never[])) as T | undefined;
  }
}
