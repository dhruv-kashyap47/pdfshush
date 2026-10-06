import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ShieldCheck, Zap } from 'lucide-react';
import { TOOL_CATEGORIES, type ToolDef } from '@/tools/registry';

interface ToolFrameProps {
  tool: ToolDef;
  children: ReactNode;
}

/** Standard chrome for every tool page: breadcrumb, heading, body, trust notes. */
export function ToolFrame({ tool, children }: ToolFrameProps) {
  const Icon = tool.icon;
  const categoryLabel =
    TOOL_CATEGORIES.find((category) => category.id === tool.category)?.label ?? tool.category;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-10">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/" className="transition-colors hover:text-foreground">
          Home
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span>{categoryLabel}</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground">{tool.name}</span>
      </nav>

      <div className="mb-6 flex items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{tool.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">{tool.description}</p>
        </div>
      </div>

      {children}

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/20 p-3.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Private by construction.</span> The file is
            parsed inside this browser tab. Nothing is uploaded, nothing is stored on a server.
          </p>
        </div>
        <div className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/20 p-3.5">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">No limits.</span> No account, no watermarks,
            no “3 tasks per hour”. In-browser processing is capped at 500 pages / 250 MB per run.
          </p>
        </div>
      </div>
    </div>
  );
}
