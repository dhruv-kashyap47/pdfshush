import { Link } from 'react-router-dom';
import type { Accent, ToolDef } from '@/tools/registry';

const ACCENT_CLASSES: Record<Accent, string> = {
  green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  blue: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  cyan: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
};

interface ToolCardProps {
  tool: ToolDef;
  compact?: boolean;
}

export function ToolCard({ tool, compact = false }: ToolCardProps) {
  const Icon = tool.icon;

  return (
    <Link
      to={`/tools/${tool.slug}`}
      className="group relative flex flex-col justify-between gap-3 rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-xs"
      title={tool.description}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105 ${
            ACCENT_CLASSES[tool.accent]
          }`}
        >
          <Icon className="h-4 w-4" />
        </span>
        {tool.status === 'planned' && (
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            soon
          </span>
        )}
        {tool.status === 'live' && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            live
          </span>
        )}
      </div>
      <div>
        <p className="text-sm font-semibold leading-tight text-foreground transition-colors group-hover:text-primary">
          {tool.name}
        </p>
        {!compact && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>
        )}
      </div>
    </Link>
  );
}
