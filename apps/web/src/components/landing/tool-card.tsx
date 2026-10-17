import { Link } from 'react-router-dom';
import type { ToolDef } from '@/tools/registry';

interface ToolCardProps {
  tool: ToolDef;
  compact?: boolean;
}

/**
 * A typographic catalog card: the name and the one-line description carry the
 * card; no pictorial element tops it. Availability is a plain word on the
 * right. Hover is a tone step, not a lift-off glow or an outline.
 */
export function ToolCard({ tool, compact = false }: ToolCardProps) {
  return (
    <Link
      to={`/tools/${tool.slug}`}
      className="group flex flex-col justify-between gap-3 rounded-xl bg-secondary p-4 transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-accent"
      title={tool.description}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-semibold leading-tight text-foreground transition-colors group-hover:text-primary">
          {tool.name}
        </p>
        {tool.status === 'planned' && (
          <span className="mt-0.5 shrink-0 text-[11px] font-medium text-muted-foreground/70">soon</span>
        )}
        {tool.status === 'live' && (
          <span className="mt-0.5 shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            live
          </span>
        )}
      </div>
      {!compact && (
        <p className="text-base leading-snug text-muted-foreground">{tool.description}</p>
      )}
    </Link>
  );
}
