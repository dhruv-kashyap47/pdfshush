/**
 * The REST API reference page (`/tools/api`, PLAN.md §25.3).
 *
 * Reads the deployed OpenAPI document live and renders the working catalog
 * from it, so the page can only ever promise slugs this deployment actually
 * runs -- the §25.3 "docs must not claim slugs the API cannot run" gate, as a
 * property rather than a hope. Key management lives on the account page.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BookOpen, KeyRound, ShieldCheck, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatBytes } from '@pdfshush/pdf-core';

interface Spec {
  components: {
    schemas: {
      Catalog?: {
        properties?: {
          limits?: {
            properties?: {
              tasksPerMinute?: { const?: number };
              tasksPerDay?: { const?: number };
              bytesPerDay?: { const?: number };
              accountTasksPerDay?: { const?: number };
              accountBytesPerDay?: { const?: number };
              maxUploadBytes?: { const?: number };
              maxInlineFileBytes?: { const?: number };
              resultRetentionMs?: { const?: number };
              readsPerMinute?: { const?: number };
            };
          };
        };
      };
    };
  };
  'x-tool-labels'?: Record<string, string>;
  paths?: Record<string, unknown>;
}

const SPEC_URL = '/api/v1/openapi.json';

export function ApiToolPage() {
  const [spec, setSpec] = useState<Spec | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(SPEC_URL);
        if (!response.ok) throw new Error(`status ${response.status}`);
        if (!cancelled) setSpec((await response.json()) as Spec);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const limits = spec?.components.schemas.Catalog?.properties?.limits?.properties;
  const labels = spec?.['x-tool-labels'] ?? {};
  const slugs = Object.keys(labels);

  const snippet = [
    '# 1. pick an inline-capable tool (see the catalog below),',
    '# 2. send its PDF as base64, then poll until `completed`.',
    'curl -sX POST https://your-instance.example/api/v1/jobs \\',
    '  -H "x-api-key: pshk_paste-your-key" \\',
    '  -H "content-type: application/json" \\',
    "  -d '{\"slug\":\"inspect\",\"files\":[{\"name\":\"doc.pdf\",\"data\":\"JVBER…\"}]}'",
    '',
    'curl -H "x-api-key: pshk_…" \\',
    '  https://your-instance.example/api/v1/jobs/<jobId>',
    '',
    '# one output: the bytes themselves; several: a JSON file list',
    'curl -H "x-api-key: pshk_…" https://your-instance.example/api/v1/jobs/<jobId>/result',
  ].join('\n');

  return (
    <div className="space-y-8">
      {/* Hero ---------------------------------------------------------- */}
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="secondary">
          <Link to="/account">
            <KeyRound className="mr-1.5 h-4 w-4" /> Manage API keys
          </Link>
        </Button>
        <Button asChild variant="outline">
          <a href={SPEC_URL} target="_blank" rel="noreferrer">
            <BookOpen className="mr-1.5 h-4 w-4" /> OpenAPI spec <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
          </a>
        </Button>
      </div>

      {/* What it is ---------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>One pipeline, open front door</CardTitle>
          <CardDescription>
            Everything below submits into the same BullMQ pipeline the web app uses — the same
            admission control, quotas and janitor. Jobs are keyed by <code className="font-mono">x-api-key</code>{' '}
            (keys start with <code className="font-mono">pshk_</code>, minted from{' '}
            <Link className="underline" to="/account">
              your account
            </Link>
            ); each request is charged against the key with your account as the ceiling.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium">End-to-end flow</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
              <li>
                <span className="font-mono text-foreground">POST /api/v1/jobs</span> — body with
                inline base64 (≤ {limits?.maxInlineFileBytes?.const ? formatBytes(limits.maxInlineFileBytes.const) : '10 MB'} per
                file) or multipart for larger uploads; returns <code>jobId</code>
              </li>
              <li>
                <span className="font-mono text-foreground">GET /api/v1/jobs/:id</span> — poll until
                <code> completed</code>
              </li>
              <li>
                <span className="font-mono text-foreground">GET /api/v1/jobs/:id/result</span> — single
                file streams; several return a JSON list, download each by name.
              </li>
            </ol>
          </div>
          <div className="rounded-lg border p-4">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" /> Scopes
            </p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>
                <code className="text-foreground">jobs:write</code> — submit jobs
              </li>
              <li>
                <code className="text-foreground">jobs:read</code> — poll status
              </li>
              <li>
                <code className="text-foreground">results:read</code> — download outputs
              </li>
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Revoked and never-existing keys answer identically; nothing about a revoked key leaks
              the fact it existed.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Quota tier ---------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-key quota tier</CardTitle>
          <CardDescription>
            Machine quotas, deliberately cheaper than anonymous browsing — they are for automation,
            not substitutes for a person.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Submissions / minute / key" value={limits?.tasksPerMinute?.const} suffix="no wait window past it" />
          <Metric label="Tasks / day / key" value={limits?.tasksPerDay?.const} />
          <Metric label="Uploads / day / key" value={limits?.bytesPerDay?.const ? formatBytes(limits.bytesPerDay.const) : undefined} />
          <Metric label="Task ceiling / account / day" value={limits?.accountTasksPerDay?.const} />
          <Metric
            label="Bytes / account / day"
            value={limits?.accountBytesPerDay?.const ? formatBytes(limits.accountBytesPerDay.const) : undefined}
          />
          <Metric label="Status reads / minute / key" value={limits?.readsPerMinute?.const} />
          <Metric
            label="Max upload (multipart)"
            value={limits?.maxUploadBytes?.const ? formatBytes(limits.maxUploadBytes.const) : undefined}
          />
          <Metric
            label="Result retention"
            value={limits?.resultRetentionMs?.const ? `${Math.round(limits.resultRetentionMs.const / 60_000)} min` : undefined}
          />
        </CardContent>
      </Card>

      {/* curl ---------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="h-4 w-4 text-primary" /> curl
          </CardTitle>
          <CardDescription>
            Keep this paste-friendly: keys are bearer credentials, so examples never type a real one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg bg-muted px-4 py-3 text-[13px] leading-relaxed">
            {snippet}
          </pre>
        </CardContent>
      </Card>

      {/* Catalog ------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runnable slugs</CardTitle>
          <CardDescription>
            Served from <code className="font-mono">{SPEC_URL}</code> live, so this list is exactly
            what the API accepts — rendering/route-tools that need a browser canvas never appear.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {failed ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Could not reach the API right now, so no slug list will show up.</span>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          ) : !spec ? (
            <p className="text-sm text-muted-foreground">Reading the deployment's catalog…</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {slugs.map((slug) => (
                <li
                  key={slug}
                  className="flex min-w-0 items-baseline gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <code className="shrink-0 font-mono text-xs text-muted-foreground">{slug}</code>
                  <span className="truncate">{labels[slug]}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, suffix }: { label: string; value?: number | string; suffix?: string }) {
  return (
    <div className="rounded-lg border px-3 py-5">
      <p className="text-2xl font-semibold tabular-nums">{value ?? '—'}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {label}
        {suffix ? ` · ${suffix}` : ''}
      </p>
    </div>
  );
}
