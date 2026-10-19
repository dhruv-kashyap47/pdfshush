/**
 * The landing MCP reveal (PLAN.md §25.4): one button in the hero opens a
 * console that answers the three questions an integrator actually has
 * (how do I connect it, what does a call look like on the wire, what is it
 * honest about) without leaving the page.
 *
 * Everything shown is authored from the server's own shapes. The tool list
 * comes from the deployed OpenAPI document through `useMcpCatalog`, so it can
 * never promise a slug this deployment cannot run, and every sample
 * request/response below is the literal JSON the MCP server and `/api/v1`
 * exchange today (`apps/mcp/src/run.ts`, `apps/api/src/http/v1`).
 *
 * Structure note: everything animated lives inside `DialogPanels`, which
 * mounts with the Radix portal content. The shell only holds state. That is
 * not cosmetic: an effect in the shell can run before the portal exists, and
 * a panel left at `opacity: 0` is content that never arrives.
 *
 * Copy rule for this file: no em dashes anywhere in the user-facing strings.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Plug,
  Terminal,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { formatBytes } from '@/lib/format';
import { EASE, DUR, dur, staggerUI, timelineUI } from '@/lib/motion';
import { mcpToolName, type McpCatalog, useMcpCatalog } from '@/lib/mcp-catalog';

/* --------------------------------------------------------------- samples */

interface WireCase {
  /** The API slug exactly as `/api/v1` names it (dashes included). */
  slug: string;
  /** What a person says to their agent. */
  ask: string;
  /** The `tools/call` the client sends, slug folded into the tool name. */
  request: string;
  /** The envelope the tool returns as its first content block. */
  response: string;
  /** What rides along with the envelope. */
  blocks: string;
  /** The detail that keeps a reader from guessing wrong later. */
  note: string;
}

const JOB_ID = '9f2c41a7b0de4c5f8a1d2e3f4a5b6c7d';

const WIRE_CASES: WireCase[] = [
  {
    slug: 'inspect',
    ask: 'How many pages is this contract, and does it have selectable text?',
    request: `{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "pdfshush_inspect",
    "arguments": {
      "files": [{ "name": "contract.pdf", "data": "<base64>" }]
    }
  }
}`,
    response: `{
  "jobId": "${JOB_ID}",
  "status": "completed",
  "files": [{ "name": "contract-inspect.json", "bytes": 214, "inline": true }],
  "pageCount": 32
}`,
    blocks: 'Structure only, so the attachment is a small JSON summary rather than a PDF.',
    note: 'The cheapest first call: the agent learns the page count before it edits anything.',
  },
  {
    slug: 'merge',
    ask: 'Merge these three signed pages into one file, newest first.',
    request: `{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "pdfshush_merge",
    "arguments": {
      "files": [
        { "name": "q1.pdf", "data": "<base64>" },
        { "name": "q2.pdf", "data": "<base64>" },
        { "name": "q3.pdf", "data": "<base64>" }
      ],
      "options": { "reverse": true }
    }
  }
}`,
    response: `{
  "jobId": "${JOB_ID}",
  "status": "completed",
  "files": [{ "name": "signed-pages-merged.pdf", "bytes": 1736, "inline": true }],
  "pageCount": 6
}`,
    blocks: 'One output, so the finished PDF rides back as an embedded resource the agent can read.',
    note: 'Files are concatenated in the order given; reverse flips them the other way round.',
  },
  {
    slug: 'organize',
    ask: 'Drop pages 2 and 5 from this report and keep the rest in order.',
    request: `{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "pdfshush_organize",
    "arguments": {
      "files": [{ "name": "report.pdf", "data": "<base64>" }],
      "options": {
        "pageOrder": [
          { "docIndex": 0, "pageIndex": 0 },
          { "docIndex": 0, "pageIndex": 2 },
          { "docIndex": 0, "pageIndex": 3 }
        ],
        "outputName": "report-trimmed.pdf"
      }
    }
  }
}`,
    response: `{
  "jobId": "${JOB_ID}",
  "status": "completed",
  "files": [{ "name": "report-trimmed.pdf", "bytes": 4820, "inline": true }],
  "pageCount": 3
}`,
    blocks: 'The same job powers page deletion, extraction and rotation, all through one page list.',
    note: 'Page indexes are zero based. Leave pageOrder out and every page is kept unchanged.',
  },
  {
    slug: 'stamp',
    ask: 'Put "Page 3 of 12" in the footer of every page.',
    request: `{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "pdfshush_stamp",
    "arguments": {
      "files": [{ "name": "manual.pdf", "data": "<base64>" }],
      "options": {
        "footer": { "text": "Page {n} of {N}", "position": "bottom-center" },
        "style": { "fontSize": 9 }
      }
    }
  }
}`,
    response: `{
  "jobId": "${JOB_ID}",
  "status": "completed",
  "files": [{ "name": "manual-stamped.pdf", "bytes": 91240, "inline": true }],
  "pageCount": 12
}`,
    blocks: 'Headers and footers use the same tool, so the agent picks one call and sets the side.',
    note: '{n} is the page number and {N} the page count, written straight into the text.',
  },
  {
    slug: 'split-by-pages',
    ask: 'Cut this 40 page manual into five PDFs of eight pages.',
    request: `{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "pdfshush_split_by_pages",
    "arguments": {
      "files": [{ "name": "manual.pdf", "data": "<base64>" }],
      "options": { "chunkSize": 8 }
    }
  }
}`,
    response: `{
  "jobId": "${JOB_ID}",
  "status": "completed",
  "files": [
    { "name": "manual-001.pdf", "bytes": 241100, "inline": true },
    { "name": "manual-002.pdf", "bytes": 238400, "inline": true },
    { "name": "manual-003.pdf", "bytes": 240050, "inline": true },
    { "name": "manual-004.pdf", "bytes": 237900, "inline": true },
    { "name": "manual-005.pdf", "bytes": 239600, "inline": true }
  ],
  "pageCount": 40
}`,
    blocks: 'Five outputs arrive as a listing, one resource per part.',
    note: 'Past the inline budget the same listing carries download links instead of bytes, and says so.',
  },
  {
    slug: 'split-in-half',
    ask: 'Split this folded brochure into its two halves.',
    request: `{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "pdfshush_split_in_half",
    "arguments": {
      "files": [{ "name": "brochure.pdf", "data": "<base64>" }]
    }
  }
}`,
    response: `{
  "jobId": "${JOB_ID}",
  "status": "completed",
  "files": [
    { "name": "brochure-left.pdf", "bytes": 61140, "inline": true },
    { "name": "brochure-right.pdf", "bytes": 60980, "inline": true }
  ],
  "pageCount": 2
}`,
    blocks: 'Two outputs, the same listing shape as any multi-file result.',
    note: 'No options: the cut follows the page boxes the document actually uses.',
  },
  {
    slug: 'n-up',
    ask: 'Print these 16 slides four to a page.',
    request: `{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "pdfshush_n_up",
    "arguments": {
      "files": [{ "name": "deck.pdf", "data": "<base64>" }],
      "options": { "n": 4, "sheet": { "x": 842, "y": 595 } }
    }
  }
}`,
    response: `{
  "jobId": "${JOB_ID}",
  "status": "completed",
  "files": [{ "name": "deck-4up.pdf", "bytes": 154300, "inline": true }],
  "pageCount": 4
}`,
    blocks: 'Sixteen source pages become four imposed sheets, in reading order.',
    note: 'n takes 2, 4, 6, 8, 9 or 16. The sheet override is in PDF points.',
  },
  {
    slug: 'edit',
    ask: 'Fill the applicant name field and stamp "Approved" in the top right.',
    request: `{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "pdfshush_edit",
    "arguments": {
      "files": [{ "name": "permit.pdf", "data": "<base64>" }],
      "options": {
        "objects": [
          {
            "id": "approved-1",
            "type": "text",
            "pageIndex": 0,
            "x": 430, "y": 96, "width": 180, "height": 36,
            "text": "Approved",
            "fontSize": 22,
            "color": "#0f172a"
          }
        ],
        "formValues": { "applicant.name": "Ada Lovelace" },
        "outputName": "permit-approved.pdf"
      }
    }
  }
}`,
    response: `{
  "jobId": "${JOB_ID}",
  "status": "completed",
  "files": [{ "name": "permit-approved.pdf", "bytes": 88410, "inline": true }],
  "pageCount": 4
}`,
    blocks: 'The same engine the web editor exports through, driven from JSON.',
    note: 'Coordinates are display space in PDF points from the top left. Image objects are not expressible over JSON; text and vectors are.',
  },
];

const CONFIG_SNIPPET = `{
  "mcpServers": {
    "pdfshush": {
      "command": "npx",
      "args": ["-y", "@pdfshush/mcp"],
      "env": {
        "PDFSHUSH_API_URL": "https://your-deployment.example.com",
        "PDFSHUSH_API_KEY": "pshk_."
      }
    }
  }
}`;

interface Step {
  title: string;
  body: string;
  icon: LucideIcon;
  snippet?: string;
  snippetLabel?: string;
  action?: { label: string; to: string };
}

const STEPS: Step[] = [
  {
    title: 'Create a key',
    body:
      'One key from your account page, shown once and stored only as a hash. It is scoped, revocable in a click, and every key spends its own quota, so one stolen key never spends the rest.',
    icon: KeyRound,
    action: { label: 'Open the account page', to: '/account' },
  },
  {
    title: 'Point any MCP client at it',
    body:
      'Paste this into your client config and restart it. The server ships no PDF engine and writes no files: every tool call is one REST round trip against the deployment you name.',
    icon: Plug,
    snippet: CONFIG_SNIPPET,
    snippetLabel: 'Client config',
  },
  {
    title: 'Then just ask',
    body:
      'Your agent discovers the tools on its own, reads the option vocabulary for each one from a pdfshush://guide resource, and returns the finished PDFs into the conversation.',
    icon: Wand2,
    snippet:
      'Read pdfshush://guide/stamp, then stamp "Page {n} of {N}"\nonto the footer of every page in report.pdf.',
    snippetLabel: 'A prompt you can paste straight in',
  },
];

/* ---------------------------------------------------------------- helpers */

function copy(text: string, what: string): void {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success(`${what} copied to the clipboard.`),
    () => toast.error('The clipboard refused the copy. Select the text instead.'),
  );
}

function JsonBlock({
  code,
  tone,
  lineAttr,
}: {
  code: string;
  tone: 'request' | 'response';
  lineAttr: string;
}) {
  return (
    <pre
      className={`max-h-64 overflow-auto rounded-lg border p-4 font-mono text-[12px] leading-relaxed ${
        tone === 'request'
          ? 'border-border/70 bg-background/80'
          : 'border-primary/25 bg-primary/[0.06]'
      }`}
    >
      {code.split('\n').map((line, index) => (
        // The request is on screen before anything is sent, so it must read
        // without an animation; the response mounts with the round trip and is
        // revealed line by line then.
        <span
          key={`${line}-${index}`}
          data-mcp-line={lineAttr}
          className={`block ${tone === 'response' ? 'opacity-0' : ''}`}
        >
          {line || ' '}
        </span>
      ))}
    </pre>
  );
}

/* ----------------------------------------------------------------- shell */

export function McpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { status, catalog } = useMcpCatalog();
  const [activeSlug, setActiveSlug] = useState<string>(WIRE_CASES[0]!.slug);
  const [sent, setSent] = useState(false);

  /** The live catalog decides the chip order; authored samples stay the content. */
  const cases = useMemo(() => {
    const bySlug = new Map(WIRE_CASES.map((item) => [item.slug, item]));
    const live = (catalog?.slugs ?? [])
      .map((slug) => bySlug.get(slug))
      .filter((item): item is WireCase => Boolean(item));
    return live.length ? live : WIRE_CASES;
  }, [catalog]);

  const active = cases.find((item) => item.slug === activeSlug) ?? cases[0]!;

  const pickTool = useCallback((slug: string) => {
    setActiveSlug(slug);
    setSent(false);
  }, []);

  const setOpen = useCallback(
    (next: boolean) => {
      if (!next) setSent(false);
      onOpenChange(next);
    },
    [onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton
        className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-6xl"
      >
        <DialogPanels
          status={status}
          catalog={catalog}
          cases={cases}
          active={active}
          sent={sent}
          onPlay={() => setSent(true)}
          onReset={() => setSent(false)}
          onPick={pickTool}
        />
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- panels */

function DialogPanels({
  status,
  catalog,
  cases,
  active,
  sent,
  onPlay,
  onReset,
  onPick,
}: {
  status: ReturnType<typeof useMcpCatalog>['status'];
  catalog: McpCatalog | undefined;
  cases: WireCase[];
  active: WireCase;
  sent: boolean;
  onPlay: () => void;
  onReset: () => void;
  onPick: (slug: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const wireRef = useRef<HTMLElement>(null);

  /* Entrance: header, the three steps, the console and the footer arrive as
     one move, staggered, so the dialog reads as assembled rather than dumped.
     This component mounts with the dialog content, so the refs exist here. */
  useEffect(() => {
    const root = panelRef.current;
    if (!root) return;
    const find = <T extends Element>(selector: string): T | null => root.querySelector<T>(selector);
    const many = (selector: string): Element[] => Array.from(root.querySelectorAll(selector));

    const tl = timelineUI({ defaults: { ease: EASE.out, duration: DUR.base } });
    const title = find('[data-mcp="title"]');
    const lede = find('[data-mcp="lede"]');
    const steps = many('[data-mcp="step"]');
    const chips = many('[data-mcp="chip"]');
    const consolePanel = find('[data-mcp="console"]');
    const footer = find('[data-mcp="footer"]');

    if (title) tl.add(title, { opacity: [0, 1], y: [-12, 0] }, 0);
    if (lede) tl.add(lede, { opacity: [0, 1], y: [10, 0] }, 90);
    if (steps.length) {
      tl.add(steps, { opacity: [0, 1], y: [18, 0], duration: DUR.base, delay: staggerUI(70) }, 160);
    }
    if (chips.length) {
      tl.add(chips, { opacity: [0, 1], y: [8, 0], duration: DUR.fast, delay: staggerUI(26) }, 340);
    }
    if (consolePanel) {
      tl.add(consolePanel, { opacity: [0, 1], y: [20, 0], duration: DUR.slow }, 260);
    }
    if (footer) tl.add(footer, { opacity: [0, 1], duration: DUR.fast }, 520);
    return () => {
      tl.pause();
    };
  }, []);

  /* The round trip, on demand: the request lines, then the three legs of the
     lifecycle, then the response. Under reduced motion every duration and
     delay collapses to zero and the whole thing lands at once. */
  useEffect(() => {
    if (!sent) return;
    const root = wireRef.current;
    if (!root) return;
    const requestLines = root.querySelectorAll('[data-mcp-line="request"]');
    const response = root.querySelector<HTMLElement>('[data-mcp="response"]');
    const responseLines = root.querySelectorAll('[data-mcp-line="response"]');
    const legs = root.querySelectorAll('[data-mcp="leg"]');

    const tl = timelineUI({ defaults: { ease: EASE.out } });
    if (requestLines.length) {
      tl.add(
        requestLines,
        { opacity: [0, 1], y: [6, 0], duration: DUR.fast, delay: staggerUI(24) },
        0,
      );
    }
    if (legs[0]) tl.add(legs[0], { opacity: [0.35, 1], scaleX: [0.5, 1], duration: DUR.fast }, dur(160));
    if (legs[1]) tl.add(legs[1], { opacity: [0.35, 1], scaleX: [0.5, 1], duration: DUR.fast }, dur(430));
    if (legs[2]) tl.add(legs[2], { opacity: [0.35, 1], scaleX: [0.5, 1], duration: DUR.fast }, dur(720));
    if (response) tl.add(response, { opacity: [0, 1], y: [12, 0], duration: DUR.base }, dur(580));
    if (responseLines.length) {
      tl.add(
        responseLines,
        { opacity: [0, 1], y: [6, 0], duration: DUR.fast, delay: staggerUI(20) },
        dur(660),
      );
    }
    return () => {
      tl.pause();
    };
  }, [sent, active.slug]);

  const labels = catalog?.labels ?? {};
  const limits = catalog?.limits ?? {};
  const label = labels[active.slug] ?? active.slug;
  // formatBytes prints "10.0 MB"; the round number reads better in prose.
  const inlineCap = limits.maxInlineFileBytes
    ? formatBytes(limits.maxInlineFileBytes).replace('.0 ', ' ')
    : '10 MB';
  const perMinute = limits.tasksPerMinute ?? 30;
  const retention = limits.resultRetentionMs
    ? `${Math.round(limits.resultRetentionMs / 60_000)} minutes`
    : 'an hour';

  return (
    <div ref={panelRef} className="max-h-[92dvh] overflow-y-auto">
      {/* Header ---------------------------------------------------------- */}
      <div className="border-b border-border/70 px-6 py-6 sm:px-8">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Terminal className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          PDFShush speaks the Model Context Protocol
        </p>
        <DialogTitle
          data-mcp="title"
          className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
        >
          Hand your agent the whole PDF bench
        </DialogTitle>
        <DialogDescription
          data-mcp="lede"
          className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground"
        >
          One small local server turns every PDF tool into an MCP tool, using your own API key. The
          job runs in the same queue, under the same quotas and the same retention window this page
          uses, and the finished PDFs come back into the conversation.
        </DialogDescription>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        {/* The guide ---------------------------------------------------- */}
        <section
          className="min-w-0 px-6 py-6 sm:px-8 lg:pr-8"
          aria-label="How to connect"
        >
          <ol className="space-y-7">
            {STEPS.map((step) => {
              const Icon = step.icon;
              return (
                <li key={step.title} data-mcp="step" className="opacity-0">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                  </div>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{step.body}</p>
                  {step.snippet ? (
                    <div className="mt-3 rounded-lg border border-border/70 bg-muted/40">
                      <div className="flex items-center justify-between px-3 py-2">
                        <p className="text-[12px] font-medium text-muted-foreground">
                          {step.snippetLabel}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-md px-2 text-[12px]"
                          onClick={() => copy(step.snippet!, 'Snippet')}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy
                        </Button>
                      </div>
                      <pre className="overflow-x-auto border-t border-border/70 px-3 py-3 font-mono text-[12px] leading-relaxed text-foreground/90">
                        {step.snippet}
                      </pre>
                    </div>
                  ) : null}
                  {step.action ? (
                    <Button variant="outline" size="sm" className="mt-3 rounded-md" asChild>
                      <Link to={step.action.to}>
                        {step.action.label}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>

          <p className="mt-8 text-[13px] leading-relaxed text-muted-foreground">
            The base URL must be https. Plain http is refused unless the host is loopback or you
            accept the risk explicitly with <code className="font-mono">PDFSHUSH_ALLOW_HTTP=1</code>,
            because your key travels on that connection.
          </p>
        </section>

        {/* The wire ----------------------------------------------------- */}
        <section
          ref={wireRef}
          data-mcp="console"
          className="min-w-0 border-t border-border/70 bg-muted/35 px-6 py-6 opacity-0 sm:px-8 lg:border-l lg:border-t-0"
          aria-label="What a tool call looks like"
          data-ui
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold text-foreground">What a call looks like</h3>
            <p className="text-[12px] text-muted-foreground">
              {status === 'ready'
                ? `${cases.length} tools live on this deployment`
                : status === 'loading'
                  ? 'reading the deployment catalog'
                  : 'catalog unreachable, showing the shipped tool set'}
            </p>
          </div>

          {/* Tool picker: the chips are the tools, not decoration. */}
          <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label="MCP tools">
            {cases.map((item) => {
              const selected = item.slug === active.slug;
              return (
                <button
                  key={item.slug}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-mcp="chip"
                  onClick={() => onPick(item.slug)}
                  className={`rounded-md px-2.5 py-1.5 font-mono text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
                    selected
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background/70 text-muted-foreground hover:bg-background hover:text-foreground'
                  }`}
                >
                  {mcpToolName(item.slug)}
                </button>
              );
            })}
          </div>

          <p className="mt-4 text-[15px] leading-relaxed text-foreground">You say: {active.ask}</p>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-[12px] font-medium text-muted-foreground">
              Request: tools/call against {label}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-md px-2 text-[12px]"
              onClick={() => copy(active.request, 'Request')}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
          <div className="mt-1.5">
            <JsonBlock code={active.request} tone="request" lineAttr="request" />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button className="rounded-md px-4 font-semibold" onClick={onPlay} disabled={sent}>
              {sent ? (
                <>
                  <Check className="h-4 w-4" /> Round trip complete
                </>
              ) : (
                'Send it'
              )}
            </Button>
            {sent ? (
              <Button variant="ghost" size="sm" className="h-8 rounded-md" onClick={onReset}>
                Reset
              </Button>
            ) : null}
            <p className="text-[12px] text-muted-foreground">
              One call, one finished job, up to four minutes of waiting inside the server.
            </p>
          </div>

          {/* Lifecycle rail */}
          <div className="mt-4 grid grid-cols-3 gap-2" aria-hidden>
            {['submit', 'poll', 'attach'].map((leg) => (
              <div key={leg} className="space-y-1.5">
                <span
                  data-mcp="leg"
                  className="block h-1 w-full origin-left scale-x-50 rounded-full bg-primary opacity-35"
                />
                <span className="block font-mono text-[11px] text-muted-foreground">{leg}</span>
              </div>
            ))}
          </div>

          {sent ? (
            <div data-mcp="response" className="mt-4 opacity-0">
              <p className="text-[12px] font-medium text-muted-foreground">
                Response: the envelope, then the file blocks
              </p>
              <div className="mt-1.5">
                <JsonBlock code={active.response} tone="response" lineAttr="response" />
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-foreground">{active.blocks}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{active.note}</p>
            </div>
          ) : null}
        </section>
      </div>

      {/* Footer: the honest frame, then the real docs -------------------- */}
      <div
        data-mcp="footer"
        className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border/70 px-6 py-4 opacity-0 sm:px-8"
      >
        <p className="text-[13px] text-muted-foreground">
          Per key: {perMinute} tasks a minute, {inlineCap} per inline file. Results are deleted after{' '}
          {retention}.
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 rounded-md" asChild>
            <Link to="/tools/mcp">
              Full MCP reference
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="h-8 rounded-md" asChild>
            <Link to="/tools/api">REST surface</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- trigger */

/**
 * The hero affordance: a real button that opens the console. The caret is a
 * CSS loop (the global prefers-reduced-motion rule nullifies it) and every
 * other move in here is a response to the click.
 */
export function McpShowcaseButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="lg"
        onClick={() => setOpen(true)}
        className={`h-11 rounded-md px-5 text-sm font-medium shadow-none ${className ?? ''}`}
      >
        <Terminal className="mr-2 h-4 w-4 text-cyan-600 dark:text-cyan-400" />
        Wire up an agent
        <span aria-hidden className="ml-2.5 inline-block h-3.5 w-2 animate-pulse bg-primary/70" />
        <span className="sr-only">opens the MCP setup guide</span>
      </Button>
      <McpDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
