/**
 * API-keys management for the account page (PLAN.md §25.3).
 *
 * The one rule that shapes this panel: the full token exists exactly once --
 * in the dialog right after creation. It is never fetched again, never listed,
 * and the copy affordance exists because a key that leaves the clipboard
 * mid-paste means minting another one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, EyeOff, KeyRound, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { timeAgo } from '@/lib/format';

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: boolean;
}

const SCOPE_LABELS: Record<string, string> = {
  'jobs:write': 'submit jobs',
  'jobs:read': 'poll status',
  'results:read': 'download results',
};

export function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyRow[] | undefined>(undefined);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [freshToken, setFreshToken] = useState<{ token: string; prefix: string; name: string } | undefined>(
    undefined,
  );
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `undefined` = not loaded yet; `false` = this deployment has no accounts.
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
  }, []);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await api<{ keys: ApiKeyRow[] }>('/api/account/api-keys');
      setKeys(data?.keys ?? []);
      setAvailable(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        // Accounts disabled is a permanent state here, not an error: the deploy
        // simply never turned them on, so the whole panel stays inert.
        setKeys([]);
        setAvailable(false);
        return;
      }
      setKeys([]);
      setAvailable(true);
      setLoadError(
        error instanceof Error ? error.message : 'Could not load your API keys.',
      );
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    try {
      const data = await api<{ key: { prefix: string; name: string }; token: string }>(
        '/api/account/api-keys',
        { method: 'POST', body: { name: trimmed } },
      );
      if (data) {
        setFreshToken({ token: data.token, prefix: data.key.prefix, name: data.key.name });
        setName('');
      }
      await reload();
      toast.success('Key created. Copy it now — it is shown only once.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the key.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (key: ApiKeyRow) => {
    if (!window.confirm(`Revoke "${key.name}"? Anything using it stops working immediately.`)) return;
    try {
      await api(`/api/account/api-keys/${key.id}`, { method: 'DELETE' });
      await reload();
      toast.success('Key revoked.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not revoke the key.');
    }
  };

  const copyToken = async () => {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken.token);
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('The clipboard refused the copy. Select the key text instead.');
    }
  };

  const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 text-primary" /> API keys
        </CardTitle>
        <CardDescription>
          Call the public REST API (<span className="font-mono">/api/v1</span>) with your own key.
          See{' '}
          <a className="underline" href="/tools/api">
            the API reference
          </a>{' '}
          for endpoints and the quota tier.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            aria-label="Key name"
            placeholder="Key name — e.g. «ci-pipeline»"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
            }}
            className="flex-1"
          />
          <Button disabled={busy || name.trim().length === 0} onClick={() => void create()}>
            <Plus className="mr-1 h-4 w-4" /> Create key
          </Button>
        </div>

        {loadError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              Retry
            </Button>
          </div>
        ) : available === false ? (
          <p className="text-sm text-muted-foreground">
            API keys are not enabled on this deployment (accounts are off), so there is nothing to
            create here.
          </p>
        ) : (
          keys !== undefined && (
            <ul className="space-y-2">
              {keys.length === 0 ? (
                <li className="text-sm text-muted-foreground">No keys yet.</li>
              ) : (
                keys.map((key) => (
                  <li
                    key={key.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm"
                  >
                    <span className="truncate font-medium">{key.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{key.prefix}…</span>
                    <span className="flex gap-1.5">
                      {key.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                          title={SCOPE_LABELS[scope] ?? scope}
                        >
                          {scope}
                        </span>
                      ))}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {key.lastUsedAt ? `last used ${timeAgo(key.lastUsedAt)}` : `created ${dateFormatter.format(key.createdAt)}`}
                    </span>
                    {key.revokedAt ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <EyeOff className="h-3.5 w-3.5" /> revoked
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-destructive"
                        aria-label={`Revoke ${key.name}`}
                        onClick={() => void revoke(key)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </li>
                ))
              )}
            </ul>
          )
        )}
      </CardContent>

      <Dialog
        open={Boolean(freshToken)}
        onOpenChange={(open) => {
          if (!open) setFreshToken(undefined);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {freshToken ? (
            <>
              <DialogHeader>
                <DialogTitle>Copy your key now</DialogTitle>
                <DialogDescription>
                  <span className="font-medium text-foreground">{freshToken.name}</span> is a bearer
                  credential. It is shown exactly once: if it leaves this screen without being
                  copied, the only fix is minting another key.
                </DialogDescription>
              </DialogHeader>
              <code className="block select-all break-all rounded-lg bg-muted px-3 py-2.5 font-mono text-sm">
                {freshToken.token}
              </code>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => void copyToken()}>
                  {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy key'}
                </Button>
                <Button onClick={() => setFreshToken(undefined)}>Done</Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
