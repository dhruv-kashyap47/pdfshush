/**
 * Account-scoped data: preferences, synced history, saved workflows and job
 * ownership.
 *
 * Everything here is keyed by `accountId`, and every read filters on it. That is
 * the whole authorisation model for this layer: there is no query in this file
 * that can return another account's row, so a route cannot accidentally widen
 * the scope by forgetting a check.
 *
 * `deleteAccountData` is the erasure path §18.3 promises: it removes the account,
 * its sessions, preferences, history, workflows and job ownership in one place,
 * so "delete my account" cannot leave an orphan behind in a collection someone
 * forgot to add.
 */

import type { AuthCollections, HistoryDoc, WorkflowDoc } from '../auth/mongo.js';
import type { Workflow } from '@pdfshush/pdf-core/node';

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

/** Mirrors `MAX_ENTRIES` in the SPA's local history, so the two lists agree. */
export const MAX_HISTORY_ENTRIES = 100;
export const MAX_WORKFLOWS = 50;

function toHistory(doc: HistoryDoc): HistoryEntry {
  return {
    id: doc._id,
    toolSlug: doc.toolSlug,
    toolName: doc.toolName,
    fileName: doc.fileName,
    ...(doc.pageCount !== undefined ? { pageCount: doc.pageCount } : {}),
    ...(doc.sizeBytes !== undefined ? { sizeBytes: doc.sizeBytes } : {}),
    createdAt: doc.createdAt,
  };
}

function toWorkflow(doc: WorkflowDoc): StoredWorkflow {
  return {
    id: doc._id,
    name: doc.name,
    steps: doc.steps as Workflow['steps'],
    version: doc.version,
    createdAt: doc.createdAt.getTime(),
    updatedAt: doc.updatedAt.getTime(),
  };
}

export class AccountStore {
  constructor(
    private readonly collections: AuthCollections,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /* ------------------------------------------------------- preferences */

  async getPreferences(accountId: string): Promise<Record<string, unknown>> {
    const doc = await this.collections.preferences.findOne({ _id: accountId });
    return doc?.values ?? {};
  }

  /** Shallow merge: a settings panel sends only the keys it owns. */
  async setPreferences(
    accountId: string,
    values: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const doc = await this.collections.preferences.findOneAndUpdate(
      { _id: accountId },
      { $set: { values, updatedAt: this.now() } },
      { upsert: true, returnDocument: 'after' },
    );
    return doc?.values ?? {};
  }

  /* ----------------------------------------------------------- history */

  async listHistory(accountId: string, limit = MAX_HISTORY_ENTRIES): Promise<HistoryEntry[]> {
    const docs = await this.collections.history
      .find({ accountId })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, MAX_HISTORY_ENTRIES))
      .toArray();
    return docs.map(toHistory);
  }

  async addHistory(
    accountId: string,
    entry: Omit<HistoryEntry, 'id' | 'createdAt'> & { createdAt?: number },
  ): Promise<HistoryEntry> {
    const doc: HistoryDoc = {
      _id: `${accountId}:${entry.createdAt ?? this.now().getTime()}:${Math.random().toString(36).slice(2, 10)}`,
      accountId,
      toolSlug: entry.toolSlug.slice(0, 64),
      toolName: entry.toolName.slice(0, 120),
      fileName: entry.fileName.slice(0, 255),
      createdAt: entry.createdAt ?? this.now().getTime(),
      ...(entry.pageCount !== undefined ? { pageCount: entry.pageCount } : {}),
      ...(entry.sizeBytes !== undefined ? { sizeBytes: entry.sizeBytes } : {}),
    };
    await this.collections.history.insertOne(doc);
    return toHistory(doc);
  }

  async clearHistory(accountId: string): Promise<number> {
    const result = await this.collections.history.deleteMany({ accountId });
    return result.deletedCount;
  }

  /* --------------------------------------------------------- workflows */

  async listWorkflows(accountId: string): Promise<StoredWorkflow[]> {
    const docs = await this.collections.workflows
      .find({ accountId })
      .sort({ updatedAt: -1 })
      .limit(MAX_WORKFLOWS)
      .toArray();
    return docs.map(toWorkflow);
  }

  async getWorkflow(accountId: string, id: string): Promise<StoredWorkflow | undefined> {
    const doc = await this.collections.workflows.findOne({ _id: id, accountId });
    return doc ? toWorkflow(doc) : undefined;
  }

  async createWorkflow(
    accountId: string,
    workflow: { name: string; steps: Workflow['steps'] },
  ): Promise<StoredWorkflow> {
    const timestamp = this.now();
    const doc: WorkflowDoc = {
      _id: `wf-${timestamp.getTime()}-${Math.random().toString(36).slice(2, 10)}`,
      accountId,
      name: workflow.name,
      version: 1,
      steps: workflow.steps,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.collections.workflows.insertOne(doc);
    return toWorkflow(doc);
  }

  /** Returns undefined when the id belongs to nobody, or to someone else. */
  async updateWorkflow(
    accountId: string,
    id: string,
    workflow: { name: string; steps: Workflow['steps'] },
  ): Promise<StoredWorkflow | undefined> {
    const doc = await this.collections.workflows.findOneAndUpdate(
      { _id: id, accountId },
      { $set: { name: workflow.name, steps: workflow.steps, updatedAt: this.now() } },
      { returnDocument: 'after' },
    );
    return doc ? toWorkflow(doc) : undefined;
  }

  async deleteWorkflow(accountId: string, id: string): Promise<boolean> {
    const result = await this.collections.workflows.deleteOne({ _id: id, accountId });
    return result.deletedCount === 1;
  }

  /* ------------------------------------------------------- job owners */

  /**
   * Records that an account submitted a job. TTL'd to the file retention: an
   * ownership row for a job whose output has been swept is a dead link.
   */
  async recordJob(accountId: string, jobId: string, slug: string, ttlMs: number): Promise<void> {
    const createdAt = this.now();
    await this.collections.jobOwners.updateOne(
      { _id: jobId },
      { $set: { accountId, slug, createdAt, expiresAt: new Date(createdAt.getTime() + ttlMs) } },
      { upsert: true },
    );
  }

  async listJobs(
    accountId: string,
    limit = 50,
  ): Promise<{ jobId: string; slug: string; createdAt: number }[]> {
    const docs = await this.collections.jobOwners
      .find({ accountId })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 200))
      .toArray();
    return docs.map((doc) => ({
      jobId: doc._id,
      slug: doc.slug,
      createdAt: doc.createdAt.getTime(),
    }));
  }

  /** Anyone may read their own job's ownership; nobody else may. */
  async ownsJob(accountId: string, jobId: string): Promise<boolean> {
    return (await this.collections.jobOwners.countDocuments({ _id: jobId, accountId }, { limit: 1 })) > 0;
  }

  /* ----------------------------------------------------------- erasure */

  /**
   * Deletes everything held about one account, including the account row.
   *
   * Sessions are removed rather than revoked because the account they point at
   * is going away. Returns per-collection counts so the caller can prove the
   * sweep actually happened rather than assume it.
   */
  async deleteAccountData(accountId: string): Promise<Record<string, number>> {
    const [sessions, preferences, history, workflows, jobOwners, apiKeys, accounts] = await Promise.all([
      this.collections.sessions.deleteMany({ accountId }),
      this.collections.preferences.deleteMany({ _id: accountId }),
      this.collections.history.deleteMany({ accountId }),
      this.collections.workflows.deleteMany({ accountId }),
      this.collections.jobOwners.deleteMany({ accountId }),
      // Keys die with the account: a bearer credential must not outlive
      // the identity it belongs to.
      this.collections.apiKeys.deleteMany({ accountId }),
      this.collections.accounts.deleteOne({ _id: accountId }),
    ]);
    return {
      sessions: sessions.deletedCount,
      preferences: preferences.deletedCount,
      history: history.deletedCount,
      workflows: workflows.deletedCount,
      jobOwners: jobOwners.deletedCount,
      apiKeys: apiKeys.deletedCount,
      accounts: accounts.deletedCount,
    };
  }
}
