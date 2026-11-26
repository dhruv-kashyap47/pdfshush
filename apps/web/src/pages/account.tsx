/**
 * Account page: profile, synced history, job list, and erasure.
 *
 * Signed out this page is a sign-in prompt rather than a redirect, because
 * anonymous is a supported state everywhere else in the product and bouncing the
 * user away would be the one place it is treated as a problem.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Coins, Download, LogOut, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ApiKeysPanel } from '@/components/account/api-keys';
import { AccountAvatar } from '@/components/account/account-avatar';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { purchaseRequest, type PurchaseKind } from '@/lib/billing';
import { serverDeployed } from '@/lib/deployment';
import { downloadBytes } from '@/lib/download';
import { setHistorySyncEnabled } from '@/lib/history-sync';
import { clearRecent, getRecent } from '@/tools/recent';
import { getTool } from '@/tools/registry';
import { timeAgo } from '@/lib/format';

interface HistoryRow {
  id?: string;
  toolSlug: string;
  toolName: string;
  fileName: string;
  createdAt: number;
}

interface JobRow {
  jobId: string;
  slug: string;
  createdAt: number;
  status: string;
}

export function AccountPage() {
  const { account, loading, accountsEnabled, signIn, signOut, refresh } = useAuth();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [syncHistory, setSyncHistory] = useState(false);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [buying, setBuying] = useState<PurchaseKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const reload = useCallback(async () => {
    const request = (loadSequence.current += 1);
    const current = () => request === loadSequence.current;
    setLoadError(null);
    if (!account) {
      const local = await getRecent();
      if (current()) {
        setHistory(local);
        setJobs([]);
        setSyncHistory(false);
        setHistorySyncEnabled(false);
      }
      return;
    }
    try {
      const [prefs, remoteHistory, remoteJobs, overview] = await Promise.all([
        api<{ preferences: { syncHistory?: boolean } }>('/api/account/preferences'),
        api<{ history: HistoryRow[] }>('/api/account/history'),
        api<{ jobs: JobRow[] }>('/api/account/jobs'),
        api<{ billing?: { enabled?: boolean } }>('/api/account'),
      ]);
      if (!current()) return;
      const syncing = Boolean(prefs?.preferences?.syncHistory);
      setSyncHistory(syncing);
      setHistorySyncEnabled(syncing);
      setHistory(remoteHistory?.history ?? []);
      setJobs(remoteJobs?.jobs ?? []);
      setBillingEnabled(Boolean(overview?.billing?.enabled));
    } catch {
      if (!current()) return;
      setLoadError('Could not load your account data.');
    }
  }, [account]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Returning from Dodo. The webhook can land a beat after the redirect, so the
  // session is refreshed a few times instead of assuming one immediate write.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');
    if (status !== 'credits' && status !== 'pass' && status !== 'pro') return;

    toast.success(
      status === 'credits'
        ? 'Payment received. Your credit balance updates in a few seconds.'
        : 'Payment received. Pro updates in a few seconds.',
    );
    const timers = [0, 2_000, 6_000].map((delay) =>
      window.setTimeout(() => void refresh(), delay),
    );

    params.delete('status');
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${params.toString() ? `?${params}` : ''}`,
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [refresh]);

  const toggleSync = async (next: boolean) => {
    if (!account) return;
    const previous = syncHistory;
    setSyncHistory(next);
    try {
      await api('/api/account/preferences', { method: 'PUT', body: { values: { syncHistory: next } } });
      setHistorySyncEnabled(next);
      if (next) {
        // One-time import of what this browser already has. A marker prevents
        // every off/on flip from re-posting the same rows to the server.
        const importKey = `pdfshush.history-imported.${account.id}`;
        let alreadyImported = false;
        try {
          alreadyImported = window.localStorage.getItem(importKey) === '1';
        } catch {
          // Storage unavailable: importing again is harmless, just noisy.
        }
        if (!alreadyImported) {
          // One-way push of what this browser already has. Metadata only: a
          // filename and a tool, never a document.
          let importFailed = false;
          for (const entry of await getRecent()) {
            await api('/api/account/history', {
              method: 'POST',
              body: {
                toolSlug: entry.toolSlug,
                toolName: entry.toolName,
                fileName: entry.fileName,
                createdAt: entry.createdAt,
                clientId: entry.id,
                ...(entry.pageCount !== undefined ? { pageCount: entry.pageCount } : {}),
                ...(entry.sizeBytes !== undefined ? { sizeBytes: entry.sizeBytes } : {}),
              },
            }).catch(() => {
              importFailed = true;
            });
          }
          if (!importFailed) {
            try {
              window.localStorage.setItem(importKey, '1');
            } catch {
              // The write-through path still works; only the import marker is lost.
            }
          }
        }
      }
      await reload();
      toast.success(next ? 'History sync on.' : 'History sync off.');
    } catch {
      // The switch is optimistic; a failed PUT must not keep showing a value
      // the server never stored.
      setSyncHistory(previous);
      setHistorySyncEnabled(previous);
      toast.error('Could not change that setting.');
    }
  };

  const exportData = async () => {
    try {
      const [accountPayload, historyPayload, workflowsPayload, jobsPayload] = await Promise.all([
        api<Record<string, unknown>>('/api/account'),
        api<{ history: HistoryRow[] }>('/api/account/history'),
        api<{ workflows: unknown[] }>('/api/account/workflows'),
        api<{ jobs: JobRow[] }>('/api/account/jobs'),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        ...accountPayload,
        history: historyPayload?.history ?? [],
        workflows: workflowsPayload?.workflows ?? [],
        jobs: jobsPayload?.jobs ?? [],
      };
      downloadBytes(
        new TextEncoder().encode(JSON.stringify(payload, null, 2)),
        'pdfshush-account.json',
        'application/json',
      );
    } catch {
      toast.error('Could not export your data.');
    }
  };

  const deleteAccount = async () => {
    if (!window.confirm('Delete your account and everything stored with it? This cannot be undone.')) {
      return;
    }
    setBusy(true);
    try {
      await api('/api/account', { method: 'DELETE' });
      await clearRecent();
      toast.success('Account deleted.');
      await signOut();
    } catch {
      toast.error('Could not delete the account.');
    } finally {
      setBusy(false);
    }
  };

  const buy = async (kind: PurchaseKind) => {
    setBuying(kind);
    try {
      const request = purchaseRequest(kind);
      const result = await api<{ url: string }>(request.path, {
        method: 'POST',
        ...(request.body ? { body: request.body } : {}),
      });
      if (!result?.url) throw new Error('The checkout did not return a link.');
      window.location.assign(result.url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not start checkout. Try again.',
      );
      setBuying(null);
    }
  };

  if (loading) {
    return (
      <div role="status" className="mx-auto max-w-3xl px-4 py-16 text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!account) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="sr-only">Account</h1>
        <Card>
          <CardHeader>
            <CardTitle>
              {accountsEnabled ? 'Accounts are optional' : 'Accounts are not enabled here'}
            </CardTitle>
            <CardDescription>
              {accountsEnabled
                ? 'Every tool works without signing in. An account only adds saved workflows, history that follows you between devices, and API keys for programmatic access.'
                : serverDeployed
                  ? 'This deployment keeps every tool local and has no account system. Your history stays in this browser.'
                  : 'This deployment ships the browser tools only — the pdfshush server is not deployed here, so there is no account system. Your history stays in this browser.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {accountsEnabled ? (
              <Button onClick={signIn}>Sign in with Google</Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                {serverDeployed
                  ? 'Accounts are not enabled on this deployment. Every tool still works, and history stays in this browser.'
                  : 'There is no account system on this deployment, because the server that hosts it is not deployed here. Every tool still works, and history stays in this browser.'}
              </p>
            )}
            <div>
              <p className="mb-2 text-sm font-medium">History on this device</p>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {history.slice(0, 5).map((entry) => (
                    <li key={`${entry.toolSlug}-${entry.createdAt}`} className="flex gap-2">
                      <Link to={`/tools/${entry.toolSlug}`} className="truncate underline">
                        {entry.toolName}
                      </Link>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {timeAgo(entry.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-12 sm:px-6">
      <h1 className="sr-only">Account</h1>
      {loadError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
        >
          <span>{loadError}</span>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <AccountAvatar
              picture={account.picture}
              name={account.name}
              email={account.email}
              size="md"
              alt={account.name ? `${account.name} profile picture` : 'Profile picture'}
              loading="lazy"
            />
            {account.name ?? account.email ?? 'Your account'}
          </CardTitle>
          <CardDescription>{account.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void exportData()}>
            <Download className="mr-1.5 h-4 w-4" /> Export my data
          </Button>
          <Button variant="ghost" onClick={() => void signOut()}>
            <LogOut className="mr-1.5 h-4 w-4" /> Sign out
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan and AI credits</CardTitle>
          <CardDescription>
            {account.plan === 'pro'
              ? account.planExpiresAt
                ? `Pro — access until ${new Date(account.planExpiresAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}.`
                : 'Pro — no end date.'
              : 'Free — 3 managed AI messages a day, and every tool.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="flex items-center gap-2 text-sm">
            <Coins className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>
              <strong className="tabular-nums">{account.credits ?? 0}</strong> one-time AI messages
            </span>
          </p>

          {billingEnabled ? (
            <div className="space-y-3">
              {account.plan === 'pro' ? null : (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={buying !== null} onClick={() => void buy('pro-monthly')}>
                    {buying === 'pro-monthly' ? 'Opening checkout…' : 'Pro — $6/month'}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={buying !== null}
                    onClick={() => void buy('pro-yearly')}
                  >
                    {buying === 'pro-yearly' ? 'Opening checkout…' : 'Pro — $48/year'}
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={buying !== null} onClick={() => void buy('credits')}>
                  {buying === 'credits' ? 'Opening checkout…' : 'Buy 1,000 messages — $5'}
                </Button>
                {account.plan === 'pro' ? null : (
                  <Button variant="outline" disabled={buying !== null} onClick={() => void buy('pass')}>
                    {buying === 'pass' ? 'Opening checkout…' : 'Get 30 days of Pro — $3'}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Purchases are not enabled on this deployment.
            </p>
          )}

          <p className="text-xs leading-relaxed text-muted-foreground">
            Dodo Payments handles the card and the receipt. A monthly or yearly Pro subscription
            renews until you cancel it from the Dodo receipt; access still runs to the end of the
            month you paid for. Credits are spent only after the monthly Pro allowance is gone, and
            they never expire while the account exists.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Privacy</CardTitle>
          <CardDescription>
            Documents are never uploaded to keep history. Only the tool name, file name, page count
            and time are stored, and only if you turn this on.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="sync-history" className="flex-1">
              Sync history to my account
            </Label>
            <Switch id="sync-history" checked={syncHistory} onCheckedChange={(next) => void toggleSync(next)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {history.slice(0, 25).map((entry) => (
                <li key={entry.id ?? `${entry.toolSlug}-${entry.createdAt}`} className="flex items-center gap-3">
                  <Link to={`/tools/${entry.toolSlug}`} className="truncate underline">
                    {getTool(entry.toolSlug)?.name ?? entry.toolName}
                  </Link>
                  <span className="truncate text-xs text-muted-foreground">{entry.fileName}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {timeAgo(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent server jobs</CardTitle>
          <CardDescription>Outputs are deleted automatically after the retention window.</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs submitted while signed in.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {jobs.slice(0, 20).map((job) => (
                <li key={job.jobId} className="flex items-center gap-3">
                  <span className="truncate">{getTool(job.slug)?.name ?? job.slug}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{job.status}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(job.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ApiKeysPanel />

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-destructive" /> Delete account
          </CardTitle>
          <CardDescription>
            Removes your account, saved workflows, synced history and job records immediately.
            This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" disabled={busy} onClick={() => void deleteAccount()}>
            <Trash2 className="mr-1.5 h-4 w-4" /> Delete everything
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
