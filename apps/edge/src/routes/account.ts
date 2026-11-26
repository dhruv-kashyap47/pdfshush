/**
 * Account HTTP surface on D1: preferences, synced history, saved workflows, and
 * erasure. Mirrors `apps/api/src/account/routes.ts` endpoint-for-endpoint.
 *
 * Every handler resolves the session itself and filters by the resolved account
 * id; no route accepts an account id from the client, so a caller cannot address
 * another account. State-changing routes require the double-submit header.
 *
 * One endpoint differs on purpose: `/api/account/jobs` answers an empty list.
 * The free shape runs no server-side jobs, so "you have no jobs" is the truthful
 * answer, and a 503 there would only make the account page render an error.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { AppEnv } from '../app-env.js';
import { D1AccountStore, MAX_WORKFLOWS, type NewHistoryEntry } from '../db/account-store.js';
import { D1AuthStore, type Account } from '../db/auth-store.js';
import { LIMITS } from '@pdfshush/pdf-core/limits';
import { validateWorkflow, type Workflow } from '@pdfshush/pdf-core/workflow';
import { SESSION_COOKIE, fail, requireCsrf } from '../lib/http.js';

export const accountRoutes = new Hono<AppEnv>();

/**
 * Structural ceiling for a synced history row's page count. A merged document's
 * count is a sum, so a per-document cap would reject legitimate rows; this
 * exists only to keep NaN/Infinity/1e15 out of the database.
 */
const MAX_HISTORY_PAGE_COUNT = 100_000;
const MAX_HISTORY_BYTES = LIMITS.server.maxUploadBytes;

async function requireAccount(c: Context<AppEnv>): Promise<Account | Response> {
  const token = getCookie(c, SESSION_COOKIE) ?? '';
  const account = token ? await new D1AuthStore(c.env.DB).resolveSession(token) : undefined;
  if (!account) return fail(c, 401, 'unauthenticated', 'Sign in required.');
  return account;
}

/** A JSON object body, or `{}` for anything else. Never throws. */
async function bodyOf(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const parsed = await c.req.json().catch(() => undefined);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/**
 * `undefined` = absent (omit the field), `null` = present but not storable.
 * Only plain non-negative integers inside `max` qualify: these counters are
 * display metadata, so a negative, fraction, NaN or Infinity is a client bug.
 */
function historyCount(value: unknown, max: number): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    return null;
  }
  return value;
}

/* ------------------------------------------------------------- overview */

accountRoutes.get('/api/account', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;

  const store = new D1AccountStore(c.env.DB);
  const [preferences, history, workflows] = await Promise.all([
    store.getPreferences(account.id),
    store.listHistory(account.id),
    store.listWorkflows(account.id),
  ]);

  return c.json({
    account: {
      id: account.id,
      email: account.email,
      emailVerified: account.emailVerified,
      name: account.name,
      picture: account.picture,
      // The SPA uses this to hide ads and to show the right AI allowance.
      plan: account.plan,
    },
    preferences,
    counts: { history: history.length, workflows: workflows.length, jobs: 0 },
  });
});

/* --------------------------------------------------------- preferences */

accountRoutes.get('/api/account/preferences', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;

  const preferences = await new D1AccountStore(c.env.DB).getPreferences(account.id);
  return c.json({ preferences });
});

accountRoutes.put('/api/account/preferences', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;

  const denied = requireCsrf(c);
  if (denied) return denied;

  const body = await bodyOf(c);
  const values = body.values;
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    return fail(c, 400, 'validation_failed', '`values` must be an object.');
  }

  // Preference keys are plain names, not a second query language.
  if (Object.keys(values).some((key) => !/^[A-Za-z0-9_-]{1,64}$/.test(key))) {
    return fail(
      c,
      400,
      'validation_failed',
      'Preference keys must be 1-64 letters, digits, underscores or dashes.',
    );
  }

  // Bounded so a settings blob cannot become a storage-abuse vector.
  if (JSON.stringify(values).length > 8_000) {
    return fail(c, 413, 'too_large', 'Preferences are too large.');
  }

  const preferences = await new D1AccountStore(c.env.DB).setPreferences(
    account.id,
    values as Record<string, unknown>,
  );
  return c.json({ preferences });
});

/* ------------------------------------------------------------- history */

accountRoutes.get('/api/account/history', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;

  const history = await new D1AccountStore(c.env.DB).listHistory(account.id);
  return c.json({ history });
});

accountRoutes.post('/api/account/history', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;

  const denied = requireCsrf(c);
  if (denied) return denied;

  const body = await bodyOf(c);
  if (
    typeof body.toolSlug !== 'string' ||
    typeof body.toolName !== 'string' ||
    typeof body.fileName !== 'string'
  ) {
    return fail(c, 400, 'validation_failed', 'toolSlug, toolName and fileName are required.');
  }

  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : undefined;
  if (clientId !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(clientId)) {
    return fail(
      c,
      400,
      'validation_failed',
      '`clientId` must be 1-80 letters, digits, underscores or dashes.',
    );
  }

  const createdAt =
    typeof body.createdAt === 'number' &&
    Number.isFinite(body.createdAt) &&
    body.createdAt > 0 &&
    body.createdAt <= Date.now() + 5 * 60_000
      ? body.createdAt
      : undefined;

  const pageCount = historyCount(body.pageCount, MAX_HISTORY_PAGE_COUNT);
  if (pageCount === null) {
    return fail(
      c,
      400,
      'validation_failed',
      `pageCount must be a whole number between 0 and ${MAX_HISTORY_PAGE_COUNT}.`,
    );
  }

  const sizeBytes = historyCount(body.sizeBytes, MAX_HISTORY_BYTES);
  if (sizeBytes === null) {
    return fail(
      c,
      400,
      'validation_failed',
      `sizeBytes must be a whole number between 0 and ${MAX_HISTORY_BYTES}.`,
    );
  }

  const entry: NewHistoryEntry = {
    toolSlug: body.toolSlug,
    toolName: body.toolName,
    fileName: body.fileName,
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(clientId !== undefined ? { clientId } : {}),
    ...(pageCount !== undefined ? { pageCount } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
  };

  const saved = await new D1AccountStore(c.env.DB).addHistory(account.id, entry);
  return c.json({ entry: saved }, 201);
});

accountRoutes.delete('/api/account/history', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;

  const denied = requireCsrf(c);
  if (denied) return denied;

  return c.json({ removed: await new D1AccountStore(c.env.DB).clearHistory(account.id) });
});

/* ----------------------------------------------------------- workflows */

accountRoutes.get('/api/account/workflows', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;

  const workflows = await new D1AccountStore(c.env.DB).listWorkflows(account.id);
  return c.json({ workflows });
});

accountRoutes.post('/api/account/workflows', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;

  const denied = requireCsrf(c);
  if (denied) return denied;

  const parsed = await parseRecipe(c);
  if (!parsed.ok) {
    return c.json(
      { error: 'That workflow is not valid.', code: 'validation_failed', issues: parsed.issues },
      400,
    );
  }
  const recipe = parsed.recipe;

  const store = new D1AccountStore(c.env.DB);
  if ((await store.countWorkflows(account.id)) >= MAX_WORKFLOWS) {
    return fail(c, 409, 'limit', `A maximum of ${MAX_WORKFLOWS} workflows is allowed.`);
  }

  return c.json({ workflow: await store.createWorkflow(account.id, recipe) }, 201);
});

accountRoutes.put('/api/account/workflows/:id', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;

  const denied = requireCsrf(c);
  if (denied) return denied;

  const parsed = await parseRecipe(c);
  if (!parsed.ok) {
    return c.json(
      { error: 'That workflow is not valid.', code: 'validation_failed', issues: parsed.issues },
      400,
    );
  }
  const recipe = parsed.recipe;

  const updated = await new D1AccountStore(c.env.DB).updateWorkflow(
    account.id,
    c.req.param('id'),
    recipe,
  );
  // Not-found and not-yours are the same answer on purpose: distinguishing them
  // would confirm that someone else's workflow id exists.
  if (!updated) return fail(c, 404, 'not_found', 'No such workflow.');
  return c.json({ workflow: updated });
});

accountRoutes.delete('/api/account/workflows/:id', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;

  const denied = requireCsrf(c);
  if (denied) return denied;

  const removed = await new D1AccountStore(c.env.DB).deleteWorkflow(
    account.id,
    c.req.param('id'),
  );
  if (!removed) return fail(c, 404, 'not_found', 'No such workflow.');
  return c.body(null, 204);
});

/* ---------------------------------------------------------------- jobs */

accountRoutes.get('/api/account/jobs', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;

  // No server-side execution on this deployment, so there is nothing to list.
  return c.json({ jobs: [] });
});

/* ------------------------------------------------------------- erasure */

/** Irreversible by design: real deletion, no soft-delete flag to leak. */
accountRoutes.delete('/api/account', async (c) => {
  const account = await requireAccount(c);
  if (account instanceof Response) return account;

  const denied = requireCsrf(c);
  if (denied) return denied;

  const removed = await new D1AccountStore(c.env.DB).deleteAccountData(account.id);
  console.warn('account deleted on request', account.id, removed);

  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ deleted: true, removed });
});

/**
 * Validates a recipe with the engine's own rules before storing it, so an
 * invalid recipe cannot be saved and then fail at run time.
 */
async function parseRecipe(
  c: Context<AppEnv>,
): Promise<
  | { ok: true; recipe: { name: string; steps: Workflow['steps'] } }
  | { ok: false; issues: unknown }
> {
  const body = await bodyOf(c);
  const verdict = validateWorkflow({ version: 1, name: body.name, steps: body.steps });
  if (!verdict.ok) return { ok: false, issues: verdict.issues };

  return {
    ok: true,
    recipe: {
      name: String(body.name).trim(),
      steps: body.steps as Workflow['steps'],
    },
  };
}
