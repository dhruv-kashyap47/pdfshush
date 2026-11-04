/**
 * The trust page (PLAN.md §31.4, bets D1 and D2).
 *
 * The product's strongest claims were prose. This page makes three of them
 * checkable in the browser without installing anything or reading source:
 *
 *  1. the policy the app is actually running under, read from the meta tag the
 *     build injected (not a second, hand-written copy);
 *  2. whether the service worker is active, i.e. whether this build really can
 *     run with the network off;
 *  3. a live assertion: run a real job with every page-level network API
 *     instrumented and report requests, uploads and cross-origin traffic.
 *
 * The page also says what the proof cannot see. A proof with unstated limits is
 * marketing.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Fingerprint,
  Loader2,
  ShieldCheck,
  WifiOff,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { parseConnectSrc } from '@/lib/csp';
import { proveLocality, type LocalityProof } from '@/lib/locality-proof';
import { getServiceWorkerStatus, type ServiceWorkerStatus } from '@/lib/service-worker';

const DATA_PATHS = [
  {
    title: 'The 49 client tools',
    body: 'The file is read into this tab, parsed by a worker, and written back by the same tab. There is no upload endpoint to call, and the policy below forbids one.',
    tone: 'local' as const,
  },
  {
    title: 'AI features',
    body: 'Only the text or image you ask about is sent, and only to the provider you configure or to the managed endpoint after you choose it. A BYOK key stays in this browser.',
    tone: 'conditional' as const,
  },
  {
    title: 'Workflows, REST API, MCP',
    body: 'These are server-backed by design. Each step uploads the file to the PDFShush API, which deletes it within an hour of the job finishing. The tool page says so before you start.',
    tone: 'remote' as const,
  },
  {
    title: 'Analytics and telemetry',
    body: 'None. No third-party scripts, no tracking cookies, no content-bearing logs. The only thing the app logs is a stable error code when a job fails.',
    tone: 'local' as const,
  },
];

function useContentSecurityPolicy() {
  const [policy, setPolicy] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[http-equiv="Content-Security-Policy"]',
    );
    setPolicy(meta?.content ?? null);
    setChecked(true);
  }, []);

  return { policy, checked };
}

function useServiceWorkerStatus() {
  const [status, setStatus] = useState<ServiceWorkerStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const read = async () => {
      const next = await getServiceWorkerStatus();
      if (!cancelled) setStatus(next);
    };

    void read();
    // Registration is scheduled for idle time after load, so the first read can
    // legitimately be "not yet". One retry, then report what is true.
    timer = setTimeout(() => void read(), 2_500);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return status;
}

function Verdict({ proof }: { proof: LocalityProof }) {
  const clean =
    proof.uploads === 0 && proof.crossOrigin === 0 && proof.crossOriginResources === 0;
  return (
    <div
      className="space-y-3"
      data-testid="trust-proof-result"
      data-uploads={proof.uploads}
      data-cross-origin={proof.crossOrigin}
      data-cross-origin-resources={proof.crossOriginResources}
      data-requests={proof.requests}
      data-resources={proof.resources}
    >
      <div
        className={`flex items-start gap-2.5 rounded-lg border p-3 ${
          clean ? 'border-primary/40 bg-primary/5' : 'border-amber-500/50 bg-amber-500/10'
        }`}
      >
        {clean ? (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        ) : (
          <X className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        )}
        <div>
          <p className="text-sm font-medium">
            {clean
              ? 'The job ran with zero uploads and zero cross-origin requests.'
              : 'This run made a request that is not local. The numbers are below.'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {proof.pageCount} page{proof.pageCount === 1 ? '' : 's'} inspected in {proof.durationMs}{' '}
            ms, with the network instruments in place.
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        {[
          { label: 'Page-API calls', value: proof.requests },
          { label: 'Resources loaded', value: proof.resources },
          { label: 'Body-bearing', value: proof.uploads },
          { label: 'Cross-origin', value: proof.crossOrigin + proof.crossOriginResources },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-border/70 bg-muted/20 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {item.label}
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Page-API calls counts <code className="text-[11px]">fetch</code>,{' '}
        <code className="text-[11px]">XMLHttpRequest</code>, <code className="text-[11px]">sendBeacon</code>,{' '}
        <code className="text-[11px]">WebSocket</code> and <code className="text-[11px]">EventSource</code>;
        module and worker loads are counted separately from Resource Timing. Body-bearing is the
        number that matters: it counts every request carrying a payload, so a document upload cannot
        be hidden by calling it something else.
      </p>
    </div>
  );
}

export function TrustPage() {
  const { policy, checked } = useContentSecurityPolicy();
  const sw = useServiceWorkerStatus();
  const [proof, setProof] = useState<LocalityProof | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runProof = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      setProof(await proveLocality());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }, []);

  const connectSrc = policy ? parseConnectSrc(policy) : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Trust</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
        Privacy you can check, not just read.
      </h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground">
        Every privacy claim on this site has a way to falsify it on this page: the policy the app is
        running under, whether the build really works offline, and a live job with every
        page-level network API instrumented.
      </p>

      {/* ------------------------------------------------------ data paths */}
      <section className="mt-10" aria-labelledby="data-paths">
        <h2 id="data-paths" className="text-lg font-semibold">
          What leaves this device
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {DATA_PATHS.map((entry) => (
            <div
              key={entry.title}
              className="rounded-lg border border-border/70 bg-card p-4"
              data-path={entry.tone}
            >
              <p className="flex items-center gap-2 text-sm font-medium">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${
                    entry.tone === 'local'
                      ? 'bg-emerald-500'
                      : entry.tone === 'remote'
                        ? 'bg-amber-500'
                        : 'bg-sky-500'
                  }`}
                />
                {entry.title}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{entry.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Green is local. Amber is server-backed by design. Blue is conditional on a provider you
          choose.
        </p>
      </section>

      {/* ------------------------------------------------------------ CSP */}
      <section className="mt-10" aria-labelledby="policy">
        <Card data-testid="trust-csp">
          <CardHeader>
            <CardTitle id="policy" className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" />
              The policy this build is running
            </CardTitle>
            <CardDescription>
              Read from the <code className="text-[11px]">Content-Security-Policy</code> meta tag in
              this page, not from a copy. The browser blocks any request to an origin that is not
              listed here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!checked ? null : policy ? (
              <>
                <div>
                  <p className="text-xs font-medium text-foreground">
                    Network destinations (<code className="text-[11px]">connect-src</code>)
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5" data-testid="trust-connect-src">
                    {connectSrc.map((source) => (
                      <Badge key={source} variant="secondary" className="font-mono text-[11px]">
                        {source}
                      </Badge>
                    ))}
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <code className="text-[11px]">form-action 'self'</code> closes the other way to
                  POST a file off-origin. There is no analytics origin in the list because there is
                  no analytics.
                </p>
                <details className="rounded-md border border-border/70 bg-muted/20 p-3">
                  <summary className="cursor-pointer text-xs font-medium">
                    Show the full policy
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {policy}
                  </pre>
                </details>
                <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                  Honest limit: this is an egress policy, not a full XSS defence. The theme
                  bootstrap is inline, so scripts allow <code className="text-[11px]">unsafe-inline</code>.
                  A custom AI endpoint outside the list above is blocked by the browser; a
                  self-hosted build can add one with{' '}
                  <code className="text-[11px]">VITE_CSP_CONNECT_EXTRA</code>.
                </p>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-border p-3">
                <p className="text-sm font-medium">No policy in this build</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  This is the development server, which needs its own inline HMR client and
                  websocket. The policy is injected into production builds only; the offline end-to-end
                  suite asserts it against <code className="text-[11px]">vite preview</code>.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* -------------------------------------------------------- offline */}
      <section className="mt-4" aria-labelledby="offline">
        <Card data-testid="trust-sw">
          <CardHeader>
            <CardTitle id="offline" className="flex items-center gap-2 text-base">
              <WifiOff className="h-4 w-4 text-primary" />
              Works with the network off
            </CardTitle>
            <CardDescription>
              A service worker keeps the app shell and the tools you have opened, including their
              WebAssembly, so a client tool runs offline. Server-backed tools correctly fail.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge
                variant={sw?.active ? 'default' : 'secondary'}
                data-testid="trust-sw-status"
                data-active={sw?.active ? 'true' : 'false'}
              >
                {sw === null
                  ? 'Checking'
                  : !sw.supported
                    ? 'Not supported by this browser'
                    : sw.active
                      ? sw.controlled
                        ? 'Active and serving this page'
                        : 'Active'
                      : 'Not registered'}
              </Badge>
              {sw?.scriptUrl ? (
                <code className="text-[11px] text-muted-foreground">
                  {new URL(sw.scriptUrl).pathname}
                </code>
              ) : null}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              The cache is versioned by the build. A deploy installs a fresh cache and deletes the
              old one, so an update can never serve yesterday's engine. A new version waits for you
              to accept it; nothing reloads under your cursor.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ---------------------------------------------------- prove it now */}
      <section className="mt-4" aria-labelledby="prove">
        <Card data-testid="trust-prove">
          <CardHeader>
            <CardTitle id="prove" className="flex items-center gap-2 text-base">
              <Fingerprint className="h-4 w-4 text-primary" />
              Prove it now
            </CardTitle>
            <CardDescription>
              Runs a real <code className="text-[11px]">inspect</code> job on a one-page PDF built in
              memory, with <code className="text-[11px]">fetch</code>,{' '}
              <code className="text-[11px]">XMLHttpRequest</code>,{' '}
              <code className="text-[11px]">sendBeacon</code>, <code className="text-[11px]">WebSocket</code>{' '}
              and <code className="text-[11px]">EventSource</code> instrumented.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void runProof()} disabled={running} data-testid="trust-prove-run">
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Running the job
                  </>
                ) : (
                  'Run the proof'
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                No file picker. The sample never leaves memory.
              </span>
            </div>

            {error ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                The proof could not run: {error}
              </p>
            ) : null}

            {proof ? <Verdict proof={proof} /> : null}

            <details className="rounded-md border border-border/70 bg-muted/20 p-3">
              <summary className="cursor-pointer text-xs font-medium">
                What this proof can and cannot see
              </summary>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                <li>It sees requests made by this tab, with the instrument attached at the moment the job starts.</li>
                <li>
                  It sees calls this page makes through those five APIs, plus the resources the
                  document loads (module chunks, worker scripts, WebAssembly) from Resource Timing.
                  A worker's own internal fetches are not visible to the page; they cannot leave the
                  origin under the production policy.
                </li>
                <li>
                  It records whether a request carried a body, never the body itself. The proof
                  carries no document data.
                </li>
                <li>
                  It is a runtime assertion for this tab, not a guarantee about code you have not
                  loaded. The policy and the source are the structural guarantee.
                </li>
              </ul>
            </details>
          </CardContent>
        </Card>
      </section>

      {/* -------------------------------------------------------- verify CTA */}
      <section className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Verify a redaction
            </CardTitle>
            <CardDescription>
              The Redact tool refuses to export a file that fails independent verification. You can
              run that same verifier on any PDF, including one you did not make here, and keep the
              digest receipt.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/verify">
                Open the verifier <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      <p className="mt-8 text-xs text-muted-foreground">
        Prefer the source? The policy is{' '}
        <code className="text-[11px]">apps/web/src/lib/csp.ts</code> and the verifier is{' '}
        <code className="text-[11px]">packages/pdf-core/src/redact/verify.ts</code>. This page
        reports only what it can read from the running build.
      </p>
    </div>
  );
}
