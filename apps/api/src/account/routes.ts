/**
 * Account HTTP surface: preferences, synced history, saved workflows, job
 * ownership, and erasure.
 *
 * Every route here requires a session, and every query is filtered by the
 * resolved `accountId`. There is no route that takes an account id from the
 * client, so a caller cannot address another account at all.
 *
 * State-changing routes additionally require a CSRF header matching the
 * double-submit cookie. `SameSite=Lax` already blocks cross-site POSTs in a
 * modern browser; the token is the second lock, and it also covers the case
 * where a deployment relaxes the cookie to `SameSite=None`.
 */

import type { Express, Request, Response } from 'express';
import { validateWorkflow, type Workflow } from '@pdfshush/pdf-core/node';
import type { AccountStore } from './store.js';
import { MAX_WORKFLOWS } from './store.js';
import type { Account, AuthStore } from '../auth/store.js';
import { CSRF_COOKIE, SESSION_COOKIE, safeReturnTo } from '../auth/routes.js';
import { readCookie, requireCsrf } from '../http/csrf.js';
import type { JobQueue } from '../jobs/queue.js';

export interface AccountRoutesDeps {
  enabled: boolean;
  auth?: AuthStore;
  account?: AccountStore;
  /**
   * Only the live queue is needed. Ownership is decided by the job token, not by
   * the session, so there is no "does this account own it" question to ask here.
   */
  jobs?: { queue: JobQueue };
  logger: { warn: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void };
}

/** Shape sent to the SPA. Never includes session material. */
export interface AccountView {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

function view(account: Account): AccountView {
  return {
    id: account.id,
    email: account.email,
    emailVerified: account.emailVerified,
    name: account.name,
    picture: account.picture,
  };
}

export function registerAccountRoutes(app: Express, deps: AccountRoutesDeps): void {
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
    const token = readCookie(request, SESSION_COOKIE);
    const account = token ? await deps.auth.resolveSession(token) : undefined;
    if (!account) {
      response.status(401).json({ error: 'Sign in required.', code: 'unauthenticated' });
      return undefined;
    }
    return account;
  };

  /** Sessions, preferences, history counts -- what the account page opens with. */
  app.get('/api/account', async (request: Request, response: Response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.account) return;
    // One query per collection. This used to fetch history twice -- once to test
    // for emptiness and again to count it -- which is a second round trip for a
    // number the first result already had.
    const [preferences, history, workflows, jobs] = await Promise.all([
      deps.account.getPreferences(account.id),
      deps.account.listHistory(account.id),
      deps.account.listWorkflows(account.id),
      deps.account.listJobs(account.id, 200),
    ]);
    response.json({
      account: view(account),
      preferences,
      counts: { history: history.length, workflows: workflows.length, jobs: jobs.length },
    });
  });

  /* ------------------------------------------------------- preferences */

  app.get('/api/account/preferences', async (request: Request, response: Response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.account) return;
    response.json({ preferences: await deps.account.getPreferences(account.id) });
  });

  app.put('/api/account/preferences', async (request: Request, response: Response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.account) return;
    if (!requireCsrf(request, response)) return;
    const body = request.body as unknown;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      response.status(400).json({ error: 'Preferences must be an object.', code: 'validation_failed' });
      return;
    }
    const values = (body as { values?: unknown }).values;
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      response.status(400).json({ error: '`values` must be an object.', code: 'validation_failed' });
      return;
    }
    // Bounded so a settings blob cannot become a storage abuse vector.
    if (JSON.stringify(values).length > 8_000) {
      response.status(413).json({ error: 'Preferences are too large.', code: 'too_large' });
      return;
    }
    response.json({ preferences: await deps.account.setPreferences(account.id, values as Record<string, unknown>) });
  });

  /* ----------------------------------------------------------- history */

  app.get('/api/account/history', async (request: Request, response: Response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.account) return;
    response.json({ history: await deps.account.listHistory(account.id) });
  });

  app.post('/api/account/history', async (request: Request, response: Response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.account) return;
    if (!requireCsrf(request, response)) return;
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (typeof body.toolSlug !== 'string' || typeof body.toolName !== 'string' || typeof body.fileName !== 'string') {
      response.status(400).json({ error: 'toolSlug, toolName and fileName are required.', code: 'validation_failed' });
      return;
    }
    const entry = await deps.account.addHistory(account.id, {
      toolSlug: body.toolSlug,
      toolName: body.toolName,
      fileName: body.fileName,
      ...(typeof body.pageCount === 'number' ? { pageCount: body.pageCount } : {}),
      ...(typeof body.sizeBytes === 'number' ? { sizeBytes: body.sizeBytes } : {}),
    });
    response.status(201).json({ entry });
  });

  app.delete('/api/account/history', async (request: Request, response: Response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.account) return;
    if (!requireCsrf(request, response)) return;
    response.json({ removed: await deps.account.clearHistory(account.id) });
  });

  /* --------------------------------------------------------- workflows */

  app.get('/api/account/workflows', async (request: Request, response: Response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.account) return;
    response.json({ workflows: await deps.account.listWorkflows(account.id) });
  });

  app.post('/api/account/workflows', async (request: Request, response: Response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.account) return;
    if (!requireCsrf(request, response)) return;
    const recipe = parseRecipe(request, response);
    if (!recipe) return;
    const existing = await deps.account.listWorkflows(account.id);
    if (existing.length >= MAX_WORKFLOWS) {
      response.status(409).json({ error: `A maximum of ${MAX_WORKFLOWS} workflows is allowed.`, code: 'limit' });
      return;
    }
    response.status(201).json({ workflow: await deps.account.createWorkflow(account.id, recipe) });
  });

  app.put('/api/account/workflows/:id', async (request: Request, response: Response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.account) return;
    if (!requireCsrf(request, response)) return;
    const recipe = parseRecipe(request, response);
    if (!recipe) return;
    const updated = await deps.account.updateWorkflow(account.id, String(request.params.id), recipe);
    // Not-found and not-yours are the same answer on purpose: distinguishing them
    // would confirm that someone else's workflow id exists.
    if (!updated) {
      response.status(404).json({ error: 'No such workflow.', code: 'not_found' });
      return;
    }
    response.json({ workflow: updated });
  });

  app.delete('/api/account/workflows/:id', async (request: Request, response: Response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.account) return;
    if (!requireCsrf(request, response)) return;
    const removed = await deps.account.deleteWorkflow(account.id, String(request.params.id));
    if (!removed) {
      response.status(404).json({ error: 'No such workflow.', code: 'not_found' });
      return;
    }
    response.status(204).end();
  });

  /* -------------------------------------------------------------- jobs */

  app.get('/api/account/jobs', async (request: Request, response: Response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.account) return;
    const jobs = await deps.account.listJobs(account.id);
    // Status comes from the live queue, ownership from our own index: the queue
    // prunes finished jobs, so it cannot be the source of "which are mine".
    const withStatus = await Promise.all(
      jobs.map(async (job) => {
        const snapshot = deps.jobs ? await deps.jobs.queue.state(job.jobId).catch(() => undefined) : undefined;
        return { ...job, status: snapshot?.status ?? 'expired' };
      }),
    );
    response.json({ jobs: withStatus });
  });

  /* ----------------------------------------------------------- erasure */

  /**
   * Deletes the account and everything held about it. Irreversible by design --
   * §18.3 promises real deletion, so there is no soft-delete flag to leak.
   */
  app.delete('/api/account', async (request: Request, response: Response) => {
    const account = await requireAccount(request, response);
    if (!account || !deps.account) return;
    if (!requireCsrf(request, response)) return;
    const removed = await deps.account.deleteAccountData(account.id);
    deps.logger.warn({ accountId: account.id, removed }, 'account deleted on request');
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    response.json({ deleted: true, removed });
  });
}

/**
 * Validates a recipe with the engine's own rules before storing it, so an
 * invalid recipe cannot be saved and then fail at run time.
 */
function parseRecipe(
  request: Request,
  response: Response,
): { name: string; steps: Workflow['steps'] } | undefined {
  const body = (request.body ?? {}) as Record<string, unknown>;
  const candidate = { version: 1, name: body.name, steps: body.steps };
  const verdict = validateWorkflow(candidate);
  if (!verdict.ok) {
    response.status(400).json({
      error: 'That workflow is not valid.',
      code: 'validation_failed',
      issues: verdict.issues,
    });
    return undefined;
  }
  return {
    name: String(body.name).trim(),
    steps: body.steps as Workflow['steps'],
  };
}

/** Re-exported so `app.ts` does not need to know the auth internals. */
export { SESSION_COOKIE, CSRF_COOKIE, safeReturnTo };
