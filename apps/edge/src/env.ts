/**
 * Bindings and the minimum Workers surface this Worker actually touches.
 *
 * These are structural declarations rather than `@cloudflare/workers-types`:
 * the repo does not depend on that package yet, and guessing a version would
 * make `pnpm install` the thing that breaks. Replace this file with the output
 * of `wrangler types` when wrangler becomes a pinned devDependency.
 */

export interface D1Meta {
  changes: number;
  last_row_id: number;
  duration: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(sql: string): D1Statement;
  batch<T = Record<string, unknown>>(statements: D1Statement[]): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<{ count: number; duration: number }>;
}

/** Static Assets binding. Serving from it is free and unlimited. */
export interface AssetBinding {
  fetch(request: Request): Promise<Response>;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  /** Hono's own ExecutionContext requires this field; it is unused here. */
  props: unknown;
}

export interface Env {
  ASSETS: AssetBinding;
  DB: D1Database;

  /** Google OIDC. Sign-in is disabled until all three are present. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;

  /** Canonical origin of the SPA. Used to build absolute redirect targets. */
  WEB_ORIGIN?: string;
  /** `false` only for a deployment deliberately serving over plain http. */
  SESSION_COOKIE_SECURE?: string;

  /**
   * Managed AI. Off unless a key *and* a model resolve, so a deploy with neither
   * behaves exactly like the pre-AI shape.
   */
  AI_MANAGED_API_KEY?: string;
  AI_MANAGED_MODEL?: string;
  AI_MANAGED_PROVIDER?: string;
  AI_MANAGED_MAX_OUTPUT_TOKENS?: string;
}
