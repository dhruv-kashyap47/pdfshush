import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ShieldCheck, Zap } from 'lucide-react';
import { TOOL_CATEGORIES, type ToolDef } from '@/tools/registry';
import { ToolSlugContext } from '@/tools/tool-context';
import { mark } from '@/lib/marks';
import { limitNoteFor } from '@/lib/tool-limits';
import { cn } from '@/lib/utils';

/**
 * The three tool surfaces whose data path is not "parse in this tab".
 *
 * The shared card used to claim "nothing is uploaded" on all of them, which was
 * false for workflows (server-run), the API (server-side by design) and the MCP
 * server (a local process that calls the API). Saying that out loud is cheaper
 * than a user discovering it from a network tab.
 */
const REMOTE_TRUST: Record<string, { label: string; body: string }> = {
  workflows: {
    label: 'Server-run by design.',
    body: 'Each step uploads the file to the PDFShush API, which deletes it within an hour of the job finishing. This runner is the one place that does not stay in the tab.',
  },
  api: {
    label: 'Server-side by design.',
    body: 'An API call uploads the file to the endpoint, and the result is deleted after the retention window. Nothing on this docs page stores a document.',
  },
  mcp: {
    label: 'Runs on your machine.',
    body: 'The MCP server is a local process you launch. It sends each tool call to the PDFShush API, so a document passed to it is uploaded for that call and deleted within an hour.',
  },
};

interface ToolFrameProps {
  tool: ToolDef;
  children: ReactNode;
  /** Wider container for app-like tool surfaces (the AI workspace). */
  wide?: boolean;
  /** Replace the default trust notes (used by tools that disclose a different data path). */
  notes?: ReactNode;
  /**
   * `default` is the catalog chrome: breadcrumb, icon, title, body. `studio`
   * hands the identity to the workspace itself (which owns its h1 and actions)
   * and keeps only an aria breadcrumb, so the editor reads as an application.
   */
  chrome?: 'default' | 'studio';
}

/** Standard chrome for every tool page: breadcrumb, heading, body, trust notes. */
export function ToolFrame({
  tool,
  children,
  wide = false,
  notes,
  chrome = 'default',
}: ToolFrameProps) {
  const Icon = tool.icon;
  const categoryLabel =
    TOOL_CATEGORIES.find((category) => category.id === tool.category)?.label ?? tool.category;
  const studio = chrome === 'studio';
  const remoteTrust = REMOTE_TRUST[tool.slug];
  const metered = remoteTrust !== undefined;
  const limitNote = limitNoteFor(tool.slug);

  // Route-level readiness mark for the M5.0 baseline (PLAN.md §31.6). Re-marked
  // on SPA navigation so each tool page gets its own measurement.
  useEffect(() => {
    mark('tool-ready', { slug: tool.slug });
  }, [tool.slug]);

  return (
    <div
      className={cn(
        'mx-auto px-4 sm:px-6 lg:px-10',
        studio ? 'max-w-[86rem] pb-10 pt-4 sm:pt-5' : wide ? 'max-w-6xl py-8' : 'max-w-5xl py-8',
      )}
    >
      <nav
        aria-label="Breadcrumb"
        className={cn(
          'flex items-center gap-1.5 text-muted-foreground',
          studio ? 'mb-3 text-xs' : 'mb-4 text-sm',
        )}
      >
        <Link to="/" className="transition-colors hover:text-foreground">
          Home
        </Link>
        <ChevronRight className={studio ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        <span>{categoryLabel}</span>
        <ChevronRight className={studio ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        <span className={studio ? 'text-foreground/80' : 'text-foreground'}>{tool.name}</span>
      </nav>

      {!studio ? (
        <div className="mb-6 flex items-start gap-3">
          <span className="tool-frame-icon mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{tool.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">{tool.description}</p>
          </div>
        </div>
      ) : null}

      <ToolSlugContext.Provider value={tool.slug}>{children}</ToolSlugContext.Provider>

      {notes ?? (
        <div className={cn('grid gap-3 sm:grid-cols-2', studio ? 'mt-5' : 'mt-8')}>
          <div className="trust-note flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/20 p-3.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {remoteTrust?.label ?? 'Private by construction.'}
              </span>{' '}
              {remoteTrust?.body ??
                'The file is parsed inside this browser tab. Nothing is uploaded, nothing is stored on a server.'}
            </p>
          </div>
          <div className="trust-note flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/20 p-3.5">
            <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {metered ? 'Quotas are explicit.' : 'No account or quota.'}
              </span>{' '}
              {metered ? '' : 'No sign-up, no watermarks, no “3 tasks per hour”. '}
              {limitNote}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
