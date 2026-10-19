/**
 * The MCP server reference page (`/tools/mcp`, PLAN.md §25.4).
 *
 * The quota tier and the tool list come from the deployed OpenAPI document
 * (same property-not-hope rule as `/tools/api`): nothing is promised here
 * that the deployment cannot run. The config snippet is copy-pasteable for
 * Claude Desktop-style clients; keys stay out of it.
 */

import { Link } from 'react-router-dom';
import { ArrowUpRight, BookOpen, KeyRound, ServerCog, ShieldCheck, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatBytes } from '@pdfshush/pdf-core';
import { mcpToolName, useMcpCatalog } from '@/lib/mcp-catalog';

const SPEC_URL = '/api/v1/openapi.json';

export function McpToolPage() {
  const { status, catalog, reload } = useMcpCatalog();
  const failed = status === 'failed';
  const limits = catalog?.limits ?? {};
  const labels = catalog?.labels ?? {};
  const slugs = catalog?.slugs ?? [];
  const inlineCap = limits.maxInlineFileBytes ? formatBytes(limits.maxInlineFileBytes) : '10 MB';

  const snippet = JSON.stringify(
    {
      mcpServers: {
        pdfshush: {
          command: 'npx',
          args: ['-y', '@pdfshush/mcp'],
          env: {
            PDFSHUSH_API_URL: 'https://your-deployment.example.com',
            PDFSHUSH_API_KEY: 'pshk_paste-your-key',
          },
        },
      },
    },
    null,
    2,
  );

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
        <Button asChild variant="outline">
          <Link to="/tools/api">
            <Wand2 className="mr-1.5 h-4 w-4" /> The REST surface behind it
          </Link>
        </Button>
      </div>

      {/* What it is ---------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Your agent speaks, the pipeline answers</CardTitle>
          <CardDescription>
            <code className="font-mono">@pdfshush/mcp</code> is a small local server that talks the Model
            Context Protocol over stdio and turns every tool call into the same{' '}
            <code className="font-mono">/api/v1</code> round-trip the REST reference documents — the same
            queue, the same quotas, the same janitor. It ships no PDF engine and stores nothing: your key
            rides in memory, your files ride to the deployment and back.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <ServerCog className="h-4 w-4 text-primary" /> How a call runs
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
              <li>Files travel inline as base64 (≤ {inlineCap} per file, ≤ 50 files) — no disk at all.</li>
              <li>The call submits, polls, and waits: one tool call is one finished job.</li>
              <li>Outputs come back as embedded files when they fit the context, download URLs otherwise.</li>
            </ol>
          </div>
          <div className="rounded-lg border p-4">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" /> Keep it honest
            </p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>
                Every slug's option vocabulary lives in a <code className="text-foreground">pdfshush://guide/…</code>{' '}
                resource — read it before inventing <code>options</code>.
              </li>
              <li>
                The base URL must be https (plain http is loopback-only, or an explicit
                <code className="text-foreground"> PDFSHUSH_ALLOW_HTTP=1</code> risk acceptance).
              </li>
              <li>One tool per runnable slug; a slug the deployment cannot run does not exist here.</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Config -------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">MCP client config</CardTitle>
          <CardDescription>
            Claude-Desktop-shaped; any stdio client takes the same shape. Create the key on your{' '}
            <Link className="underline" to="/account">
              account page
            </Link>{' '}
            and never commit it — it is a bearer credential.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg bg-muted px-4 py-3 text-[13px] leading-relaxed">
            {snippet}
          </pre>
        </CardContent>
      </Card>

      {/* Quota tier ---------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What the key carries</CardTitle>
          <CardDescription>
            The MCP server spends the same per-key quota as the REST surface — served live from{' '}
            <code className="font-mono">{SPEC_URL}</code> so it cannot claim more than the deployment grants.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Submissions / minute / key" value={limits.tasksPerMinute} />
          <Metric label="Tasks / day / key" value={limits.tasksPerDay} />
          <Metric label="Uploads / day / key" value={limits.bytesPerDay ? formatBytes(limits.bytesPerDay) : undefined} />
          <Metric label="Inline file ceiling" value={limits.maxInlineFileBytes ? formatBytes(limits.maxInlineFileBytes) : undefined} />
          <Metric
            label="Result retention"
            value={limits.resultRetentionMs ? `${Math.round(limits.resultRetentionMs / 60_000)} min` : undefined}
          />
        </CardContent>
      </Card>

      {/* Tools + resources ---------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tools and resources</CardTitle>
          <CardDescription>
            One MCP tool per runnable slug — <code className="font-mono">pdfshush_inspect</code>,{' '}
            <code className="font-mono">pdfshush_merge</code>, … — plus the{' '}
            <code className="font-mono">pdfshush://tools</code> catalog resource and a{' '}
            <code className="font-mono">pdfshush://guide/&lt;slug&gt;</code> per tool.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {failed ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Could not reach the API right now, so the live tool list is not shown.</span>
              <Button variant="outline" size="sm" onClick={reload}>
                Retry
              </Button>
            </div>
          ) : status === 'loading' ? (
            <p className="text-sm text-muted-foreground">Reading the deployment's catalog…</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {slugs.map((slug) => (
                <li
                  key={slug}
                  className="flex min-w-0 items-baseline gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <code className="shrink-0 font-mono text-xs text-muted-foreground">{mcpToolName(slug)}</code>
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

function Metric({ label, value }: { label: string; value?: number | string }) {
  return (
    <div className="rounded-lg border px-3 py-5">
      <p className="text-2xl font-semibold tabular-nums">{value ?? '—'}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
