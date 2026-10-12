/**
 * Account page: profile, synced history, job list, and erasure.
 *
 * Signed out this page is a sign-in prompt rather than a redirect, because
 * anonymous is a supported state everywhere else in the product and bouncing the
 * user away would be the one place it is treated as a problem.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, LogOut, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { downloadBytes } from '@/lib/download';
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
  const { account, loading, signIn, signOut } = useAuth();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [syncHistory, setSyncHistory] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!account) {
      setHistory(await getRecent());
      setJobs([]);
      return;
    }
    try {
      const [prefs, remoteHistory, remoteJobs] = await Promise.all([
        api<{ preferences: { syncHistory?: boolean } }>('/api/account/preferences'),
        api<{ history: HistoryRow[] }>('/api/account/history'),
        api<{ jobs: JobRow[] }>('/api/account/jobs'),
      ]);
      setSyncHistory(Boolean(prefs?.preferences?.syncHistory));
      setHistory(remoteHistory?.history ?? []);
      setJobs(remoteJobs?.jobs ?? []);
    } catch {
      toast.error('Could not load your account data.');
    }
  }, [account]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggleSync = async (next: boolean) => {
    setSyncHistory(next);
    try {
      await api('/api/account/preferences', { method: 'PUT', body: { values: { syncHistory: next } } });
      if (next) {
        // One-way push of what this browser already has. Metadata only: a
        // filename and a tool, never a document.
        for (const entry of await getRecent()) {
          await api('/api/account/history', {
            method: 'POST',
            body: {
              toolSlug: entry.toolSlug,
              toolName: entry.toolName,
              fileName: entry.fileName,
              ...(entry.pageCount !== undefined ? { pageCount: entry.pageCount } : {}),
              ...(entry.sizeBytes !== undefined ? { sizeBytes: entry.sizeBytes } : {}),
            },
          }).catch(() => undefined);
        }
      }
      await reload();
      toast.success(next ? 'History sync on.' : 'History sync off.');
    } catch {
      toast.error('Could not change that setting.');
    }
  };

  const exportData = async () => {
    try {
      const payload = await api<Record<string, unknown>>('/api/account');
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

  if (loading) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-muted-foreground">Loading…</div>;
  }

  if (!account) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Accounts are optional</CardTitle>
            <CardDescription>
              Every tool works without signing in. An account only adds saved workflows, history
              that follows you between devices, and (later) API keys.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={signIn}>Sign in with Google</Button>
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            {account.picture && (
              <img src={account.picture} alt="" className="h-9 w-9 rounded-full" referrerPolicy="no-referrer" />
            )}
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
          <CardTitle className="text-base">Privacy</CardTitle>
          <CardDescription>
            Documents are never uploaded to keep history. Only the tool name, file name, page count
            and time are stored — and only if you turn this on.
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
