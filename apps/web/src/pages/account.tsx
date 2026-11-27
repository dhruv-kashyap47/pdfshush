/**
 * Account dashboard.
 *
 * Signed out, the page explains that accounts are optional and shows what this
 * browser remembers. Signed in, it answers four questions without a dig:
 * what am I paying for, how much AI is left, what have I been charged, and how
 * do I get help.
 *
 * One request: `/api/account` returns the plan, usage counters, synced history
 * and the current page of Dodo payments together, which keeps a dashboard load
 * at one Worker request plus one provider subrequest. The archived server
 * surfaces (jobs, the public API) are deliberately absent.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Coins,
  CreditCard,
  Download,
  HeartHandshake,
  History,
  LogOut,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { AccountAvatar } from '@/components/account/account-avatar';
import { UsageMeter } from '@/components/account/usage-meter';
import { CountUp } from '@/components/motion/count-up';
import { Reveal } from '@/components/motion/reveal';
import { SpotlightCard } from '@/components/motion/spotlight-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { purchaseRequest, type PurchaseKind } from '@/lib/billing';
import { serverDeployed } from '@/lib/deployment';
import { downloadBytes } from '@/lib/download';
import { setHistorySyncEnabled } from '@/lib/history-sync';
import { CONTACT_EMAIL } from '@/lib/site-info';
import { clearRecent, getRecent } from '@/tools/recent';
import { timeAgo } from '@/lib/format';
import './account.css';

interface HistoryRow {
  id?: string;
  toolSlug: string;
  toolName: string;
  fileName: string;
  createdAt: number;
}

interface PaymentRow {
  id: string;
  createdAt: string;
  amount: number;
  currency: string;
  status: string;
  refundStatus: string | null;
  kind: string | null;
  chargeType: string | null;
  invoiceUrl: string | null;
}

interface UsageSnapshot {
  plan: 'free' | 'pro';
  used: number;
  limit: number;
  resetsAt: number;
  daily: { used: number; limit: number; resetsAt: number };
}

interface Dashboard {
  account: {
    id: string;
    email: string | null;
    emailVerified: boolean;
    name: string | null;
    picture: string | null;
    plan: 'free' | 'pro';
    planExpiresAt: number | null;
    credits: number;
  };
  preferences: { syncHistory?: boolean };
  counts: { history?: number };
  billing: { enabled?: boolean; subscription?: boolean; portal?: boolean };
  usage: UsageSnapshot;
  payments: PaymentRow[];
  paymentsUnavailable?: boolean;
}

const PAYMENT_LABELS: Record<string, string> = {
  pro: 'Pro subscription',
  pass: '30-day pass',
  credits: '1,000 AI credits',
  donation: 'Donation',
  sponsor: 'Sponsorship',
};

function firstNameOf(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.split('@')[0] || 'there';
  return source.split(/\s+/)[0] ?? source;
}

function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function monthYear(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function money(amount: number, currency: string): string {
  try {
    const format = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(amount / 10 ** digits);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
}

function paymentLabel(payment: PaymentRow): string {
  const label = payment.kind ? PAYMENT_LABELS[payment.kind] : undefined;
  if (label) return label;
  if (payment.chargeType === 'renewal') return 'Pro renewal';
  if (payment.chargeType === 'plan_change') return 'Plan change';
  return 'Payment';
}

function paymentStatus(payment: PaymentRow): string {
  if (payment.refundStatus === 'full') return 'Refunded';
  if (payment.refundStatus === 'partial') return 'Partly refunded';
  return payment.status;
}

function statusTone(status: string): string {
  const key = status.toLowerCase();
  if (key === 'succeeded' || key === 'active') {
    return 'border-primary/35 bg-primary/10 text-primary';
  }
  if (key === 'refunded' || key === 'partly refunded' || key === 'pending') {
    return 'border-amber-500/35 bg-amber-500/10 text-amber-300';
  }
  if (key === 'failed' || key === 'declined') {
    return 'border-destructive/40 bg-destructive/10 text-destructive';
  }
  return 'border-border/70 bg-muted/40 text-muted-foreground';
}

function Feature({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2 text-sm text-muted-foreground">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

export function AccountPage() {
  const { account, loading, accountsEnabled, signIn, signOut, refresh } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [localHistory, setLocalHistory] = useState<HistoryRow[]>([]);
  const [buying, setBuying] = useState<PurchaseKind | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
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
        setLocalHistory(local);
        setData(null);
        setHistorySyncEnabled(false);
      }
      return;
    }

    try {
      const overview = await api<Dashboard>('/api/account');
      if (!current()) return;
      setData(overview ?? null);
      setHistorySyncEnabled(Boolean(overview?.preferences?.syncHistory));
    } catch {
      if (!current()) return;
      setLoadError('Could not load your dashboard. Check the connection and retry.');
    }
  }, [account]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Returning from Dodo. The webhook can land a beat after the redirect, so the
  // session and the overview are refreshed a few times instead of once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');
    const paid = params.get('payment_id') ?? params.get('subscription_id');
    if (status !== 'credits' && status !== 'pass' && status !== 'pro' && !paid) return;

    toast.success(
      status === 'credits'
        ? 'Payment received. Your credits update in a few seconds.'
        : 'Payment received. Your plan updates in a few seconds.',
    );
    const timers = [0, 2_000, 6_000].map((delay) =>
      window.setTimeout(() => void refresh(), delay),
    );

    params.delete('status');
    params.delete('payment_id');
    params.delete('subscription_id');
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${params.toString() ? `?${params}` : ''}`,
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [refresh]);

  const toggleSync = async (next: boolean) => {
    if (!account) return;
    const previous = Boolean(data?.preferences?.syncHistory);
    if (data) setData({ ...data, preferences: { syncHistory: next } });
    try {
      await api('/api/account/preferences', { method: 'PUT', body: { values: { syncHistory: next } } });
      setHistorySyncEnabled(next);
      if (next) {
        const importKey = `pdfshush.history-imported.${account.id}`;
        let alreadyImported = false;
        try {
          alreadyImported = window.localStorage.getItem(importKey) === '1';
        } catch {
          // Storage unavailable: importing again is harmless, just noisy.
        }
        if (!alreadyImported) {
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
              // The write-through path still works; only the marker is lost.
            }
          }
        }
      }
      await reload();
      toast.success(next ? 'History sync on.' : 'History sync off.');
    } catch {
      if (data) setData({ ...data, preferences: { syncHistory: previous } });
      toast.error('Could not change that setting.');
    }
  };

  const exportData = async () => {
    try {
      const [historyPayload, prefsPayload] = await Promise.all([
        api<{ history: HistoryRow[] }>('/api/account/history'),
        api<{ preferences: unknown }>('/api/account/preferences'),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        account: data?.account ?? account,
        history: historyPayload?.history ?? [],
        preferences: prefsPayload?.preferences ?? data?.preferences ?? {},
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
    if (!window.confirm('Delete your account and its synced history? An active subscription is cancelled first. This cannot be undone.')) {
      return;
    }
    setBusy(true);
    try {
      await api('/api/account', { method: 'DELETE' });
      await clearRecent();
      toast.success('Account deleted.');
      await signOut();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the account.');
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

  const openPortal = async () => {
    setPortalBusy(true);
    try {
      const result = await api<{ url: string }>('/api/billing/portal', { method: 'POST' });
      if (!result?.url) throw new Error('The billing portal did not return a link.');
      window.location.assign(result.url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not open the billing portal. Try again.',
      );
      setPortalBusy(false);
    }
  };

  if (loading) {
    return (
      <div role="status" className="mx-auto max-w-6xl px-4 py-16 text-sm text-muted-foreground sm:px-6">
        Loading your dashboard…
      </div>
    );
  }

  if (!account) {
    return (
      <div className="account-page">
        <div className="account-ambient" aria-hidden="true">
          <div className="account-blob" />
          <div className="account-grid-lines" />
        </div>
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
          <Reveal>
            <Card className="overflow-hidden border-border/60 bg-card/50">
              <CardContent className="p-7 sm:p-9">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Account
                </p>
                <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                  Your tools stay here. Your plan can follow you.
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
                  {accountsEnabled
                    ? 'Accounts are optional. Signing in keeps a paid plan attached to you and can sync your tool history between devices. Files never leave this device.'
                    : serverDeployed
                      ? 'This deployment has no account system. Every tool works, and history stays in this browser.'
                      : 'This browser-only deployment has no account system. Every tool works, and history stays in this browser.'}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  {accountsEnabled ? (
                    <Button onClick={signIn}>
                      <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" /> Sign in with Google
                    </Button>
                  ) : null}
                  <Button asChild variant="outline">
                    <Link to="/pricing">See plans</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Reveal>

          <Reveal className="mt-4" delay={90}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  History on this device
                </CardTitle>
                <CardDescription>
                  Tool name, file name and time only. Never the document.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {localHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing yet.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {localHistory.slice(0, 5).map((entry) => (
                      <li key={`${entry.toolSlug}-${entry.createdAt}`} className="flex gap-2">
                        <Link
                          to={`/tools/${entry.toolSlug}`}
                          className="truncate underline underline-offset-4"
                        >
                          {entry.toolName}
                        </Link>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {timeAgo(entry.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </Reveal>
        </div>
      </div>
    );
  }

  const view = data?.account ?? account;
  const isPro = view.plan === 'pro';
  const billingEnabled = Boolean(data?.billing?.enabled);
  const subscription = Boolean(data?.billing?.subscription);
  const portal = Boolean(data?.billing?.portal);
  const credits = view.credits ?? 0;
  const usage = data?.usage;
  const payments = data?.payments ?? [];
  const isDonor = payments.some((payment) => payment.kind === 'donation');
  const wasCustomer = payments.some(
    (payment) => payment.kind === 'pro' || payment.kind === 'pass',
  );
  const daysLeft = view.planExpiresAt
    ? Math.max(0, Math.ceil((view.planExpiresAt - Date.now()) / 86_400_000))
    : null;
  const created = account.createdAt ? new Date(account.createdAt) : null;
  const memberSince =
    created && !Number.isNaN(created.getTime()) ? monthYear(created.getTime()) : null;

  const planName = isPro ? 'Pro' : isDonor ? 'Supporter' : 'Free';
  const planCopy = isPro
    ? subscription
      ? 'Subscription. Renews automatically.'
      : 'One-time pass. Nothing renews.'
    : isDonor
      ? 'Thank you for funding the tools.'
      : wasCustomer
        ? 'Your last plan ended. Start again whenever you need it.'
        : 'Every tool, with a small daily AI allowance.';

  return (
    <div className="account-page">
      <div className="account-ambient" aria-hidden="true">
        <div className="account-blob" />
        <div className="account-blob account-blob-b" />
        <div className="account-grid-lines" />
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6 lg:px-8">
        <Reveal>
          <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="account-avatar-ring">
                <AccountAvatar
                  picture={account.picture}
                  name={account.name}
                  email={account.email}
                  size="md"
                  className="h-14 w-14 text-lg"
                  alt={account.name ? `${account.name} profile picture` : 'Profile picture'}
                  loading="eager"
                />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Account
                </p>
                <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">
                  Welcome back, {firstNameOf(account.name, account.email)}
                </h1>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                  <span className="truncate">{account.email}</span>
                  {memberSince ? (
                    <>
                      <span aria-hidden="true" className="text-border">
                        /
                      </span>
                      <span>Member since {memberSince}</span>
                    </>
                  ) : null}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`account-plan-badge ${isPro || isDonor ? '' : 'account-plan-badge-free'}`}>
                {isPro ? (
                  <>
                    <span className="account-live-dot" aria-hidden="true" /> Pro active
                  </>
                ) : isDonor ? (
                  <>
                    <HeartHandshake className="h-3.5 w-3.5" aria-hidden="true" /> Supporter
                  </>
                ) : (
                  'Free plan'
                )}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                <LogOut className="mr-1.5 h-4 w-4" /> Sign out
              </Button>
            </div>
          </header>
        </Reveal>

        {loadError ? (
          <div
            role="alert"
            className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
          >
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              Retry
            </Button>
          </div>
        ) : null}

        <div className="mt-8 grid gap-4 lg:grid-cols-12">
          <Reveal className="lg:col-span-8" delay={60} distance={22}>
            <SpotlightCard className="account-plan-card h-full bg-card/60">
              <div className="relative overflow-hidden p-6 sm:p-8">
                <span
                  className="pointer-events-none absolute -right-3 -top-8 select-none text-[9rem] font-bold leading-none tracking-tighter text-foreground/[0.035]"
                  aria-hidden="true"
                >
                  {isPro ? 'PRO' : isDonor ? '♥' : 'FREE'}
                </span>

                <div className="relative flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Your plan
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      <h2 className="text-3xl font-bold tracking-tight">{planName}</h2>
                      <span className={`account-plan-badge ${isPro || isDonor ? '' : 'account-plan-badge-free'}`}>
                        {isPro ? (
                          <>
                            <span className="account-live-dot" aria-hidden="true" /> Active
                          </>
                        ) : isDonor ? (
                          <>
                            <HeartHandshake className="h-3.5 w-3.5" aria-hidden="true" /> Thank you
                          </>
                        ) : (
                          'No active plan'
                        )}
                      </span>
                    </div>
                    <p className="mt-1 max-w-md text-sm text-muted-foreground">{planCopy}</p>
                  </div>
                  <Link
                    to="/pricing"
                    className="relative inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Compare plans
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>

                {isPro ? (
                  <div className="relative mt-7 flex flex-wrap items-end gap-x-10 gap-y-5">
                    <div>
                      <p className="text-5xl font-bold leading-none tracking-tight tabular-nums">
                        {daysLeft === null ? (
                          <Sparkles className="h-9 w-9 text-primary" aria-hidden="true" />
                        ) : (
                          <CountUp value={daysLeft} />
                        )}
                      </p>
                      <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        {daysLeft === null ? 'No end date' : daysLeft === 1 ? 'day left' : 'days left'}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="flex items-center gap-2 text-sm">
                        <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        {view.planExpiresAt
                          ? `Access until ${longDate(view.planExpiresAt)}`
                          : 'Access with no end date'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {subscription
                          ? portal
                            ? 'Manage the card or cancel in the billing portal.'
                            : 'Cancel any time from the Dodo receipt.'
                          : 'No card on file and nothing renews.'}
                      </p>
                    </div>
                  </div>
                ) : isDonor ? (
                  <div className="relative mt-6 flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
                    <HeartHandshake className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <p className="text-sm leading-6 text-muted-foreground">
                      Your donation bought no plan and unlocked nothing, and that is the point. It
                      keeps the tools free for the next person. Your support is in the history
                      below.
                    </p>
                  </div>
                ) : (
                  <p className="relative mt-6 max-w-xl text-sm leading-7 text-muted-foreground">
                    Free covers every PDF tool and three managed AI messages a day. Pro raises the
                    AI allowance to 500 a month, hides sponsor cards, and keeps the site
                    independent.
                  </p>
                )}

                <ul className="relative mt-7 grid gap-2.5 sm:grid-cols-2">
                  {isPro ? (
                    <>
                      <Feature>500 managed AI messages a month</Feature>
                      <Feature>Every PDF tool, no watermark</Feature>
                      <Feature>No sponsor cards anywhere</Feature>
                      <Feature>Credits never expire</Feature>
                    </>
                  ) : (
                    <>
                      <Feature>Every PDF tool, no watermark</Feature>
                      <Feature>3 managed AI messages a day</Feature>
                      <Feature>Bring your own AI provider key</Feature>
                      <Feature>No file uploads, ever</Feature>
                    </>
                  )}
                </ul>

                <div className="relative mt-7 flex flex-wrap gap-2">
                  {isPro ? (
                    <>
                      {portal ? (
                        <Button disabled={portalBusy} onClick={() => void openPortal()}>
                          <CreditCard className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          {portalBusy ? 'Opening portal…' : 'Manage billing'}
                        </Button>
                      ) : null}
                      {billingEnabled ? (
                        <Button
                          variant="outline"
                          disabled={buying !== null}
                          onClick={() => void buy('credits')}
                        >
                          <Coins className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          {buying === 'credits' ? 'Opening checkout…' : 'Buy 1,000 credits, $5'}
                        </Button>
                      ) : null}
                    </>
                  ) : !data ? (
                    <p className="text-sm text-muted-foreground">Loading plan details…</p>
                  ) : billingEnabled ? (
                    <>
                      <Button disabled={buying !== null} onClick={() => void buy('pro-monthly')}>
                        <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
                        {buying === 'pro-monthly' ? 'Opening checkout…' : 'Pro, $6 a month'}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={buying !== null}
                        onClick={() => void buy('pro-yearly')}
                      >
                        {buying === 'pro-yearly' ? 'Opening checkout…' : 'Pro, $48 a year'}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={buying !== null}
                        onClick={() => void buy('pass')}
                      >
                        {buying === 'pass' ? 'Opening checkout…' : '30 days for $3'}
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Purchases are not enabled on this deployment.
                    </p>
                  )}
                </div>

                <p className="relative mt-4 text-xs leading-relaxed text-muted-foreground">
                  Dodo Payments handles the card, the tax and the receipt. Prices exclude tax.
                </p>
              </div>
            </SpotlightCard>
          </Reveal>

          <Reveal className="lg:col-span-4" delay={120} distance={22}>
            <Card className="h-full border-border/60 bg-card/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wand2 className="h-4 w-4 text-primary" aria-hidden="true" />
                  AI usage
                </CardTitle>
                <CardDescription>
                  {isPro ? 'Managed messages this month' : 'Managed messages today'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {usage ? (
                  <>
                    <UsageMeter
                      used={usage.used}
                      limit={usage.limit}
                      label={isPro ? 'This month' : 'Today'}
                      caption={`Resets ${longDate(usage.resetsAt)}`}
                    />
                    {isPro ? (
                      <UsageMeter
                        used={usage.daily.used}
                        limit={usage.daily.limit}
                        label="Today"
                        caption={`Daily ceiling, resets ${longDate(usage.daily.resetsAt)}`}
                      />
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Reading your allowance…</p>
                )}

                <div className="border-t border-border/60 pt-4">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                        One-time credits
                      </p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums">
                        <CountUp value={credits} />
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">never expire</span>
                  </div>
                  {billingEnabled ? (
                    <Button
                      variant="outline"
                      className="mt-4 w-full"
                      disabled={buying !== null}
                      onClick={() => void buy('credits')}
                    >
                      {buying === 'credits' ? 'Opening checkout…' : 'Add 1,000 messages, $5'}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </Reveal>
        </div>

        <div className="mt-4 grid items-start gap-4 lg:grid-cols-12">
          <Reveal className="lg:col-span-8" delay={60} distance={20}>
            <Card className="h-full border-border/60 bg-card/50">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      Payment history
                    </CardTitle>
                    <CardDescription>Charges, refunds and receipts from Dodo.</CardDescription>
                  </div>
                  {portal ? (
                    <Button variant="outline" size="sm" disabled={portalBusy} onClick={() => void openPortal()}>
                      {portalBusy ? 'Opening…' : 'Billing portal'}
                      <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                {!data ? (
                  <p className="text-sm text-muted-foreground">Loading receipts…</p>
                ) : data.paymentsUnavailable ? (
                  <p className="text-sm text-muted-foreground">
                    Billing history is temporarily unavailable. Your plan is unaffected.
                  </p>
                ) : payments.length === 0 ? (
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {isPro
                        ? 'No payments on this billing profile yet.'
                        : 'No payments yet. Your first receipt appears here.'}
                    </p>
                    {isPro ? null : (
                      <Button asChild variant="outline" size="sm" className="mt-4">
                        <Link to="/pricing">See plans</Link>
                      </Button>
                    )}
                  </div>
                ) : (
                  <ul className="divide-y divide-border/50">
                    {payments.map((payment) => {
                      const status = paymentStatus(payment);
                      return (
                        <li
                          key={payment.id}
                          className="account-row flex flex-wrap items-center gap-3 rounded-lg px-2 py-3"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {paymentLabel(payment)}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {shortDate(payment.createdAt)}
                            </span>
                          </span>
                          <span className="text-sm font-medium tabular-nums">
                            {money(payment.amount, payment.currency)}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone(status)}`}
                          >
                            {status}
                          </span>
                          {payment.invoiceUrl ? (
                            <a
                              href={payment.invoiceUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                            >
                              Receipt
                            </a>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </Reveal>

          <Reveal className="lg:col-span-4" delay={120} distance={20}>
            <Card className="h-full border-border/60 bg-card/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
                  Support
                </CardTitle>
                <CardDescription>One person reads every email.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-6 text-muted-foreground">
                  A charge that looks wrong, a plan that should have renewed, or a document that
                  will not open: write in and describe what you see.
                </p>
                <Button asChild variant="outline" className="w-full">
                  <a href={`mailto:${CONTACT_EMAIL}`}>
                    <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" /> {CONTACT_EMAIL}
                  </a>
                </Button>
                <Button asChild variant="ghost" className="w-full">
                  <Link to="/contact">Contact page</Link>
                </Button>
              </CardContent>
            </Card>
          </Reveal>
        </div>

        <Reveal className="mt-4" distance={16}>
          <Card className="border-border/60 bg-card/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                Data and privacy
              </CardTitle>
              <CardDescription>
                Files never leave this device. These rows are the only things stored.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-3">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Label htmlFor="sync-history">Sync history</Label>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Tool, file name, page count and time. No document bytes.
                    </p>
                  </div>
                  <Switch
                    id="sync-history"
                    checked={Boolean(data?.preferences?.syncHistory)}
                    onCheckedChange={(next) => void toggleSync(next)}
                  />
                </div>
              </div>
              <div>
                <p className="text-sm font-medium">Export</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Download your account, synced history and preferences as JSON.
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => void exportData()}>
                  <Download className="mr-1.5 h-4 w-4" aria-hidden="true" /> Export my data
                </Button>
              </div>
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                  <ShieldAlert className="h-4 w-4" aria-hidden="true" /> Delete account
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  An active subscription is cancelled first, then the account and its synced
                  history are removed. This cannot be undone.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  className="mt-3"
                  disabled={busy}
                  onClick={() => void deleteAccount()}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {busy ? 'Deleting…' : 'Delete everything'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </Reveal>
      </div>
    </div>
  );
}
