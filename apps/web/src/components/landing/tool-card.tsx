import { Link } from 'react-router-dom';
import { ComingSoonBadge, LiveBadge } from '@/components/tool-status';
import type { ToolDef } from '@/tools/registry';

interface ToolCardProps {
  tool: ToolDef;
  compact?: boolean;
}

/**
 * A typographic catalog card: the name and the one-line description carry
 * the card; no pictorial element tops it. Availability is a plain word on the
 * right. Hover is a tone step, not a lift-off glow or an outline.
 *
 * The hairline is drawn with an inset ring rather than a border: a border
 * would add two pixels to the box, and the card's geometry (padding, the
 * gap between rows, the type sizes, the radius, the availability mark) is
 * the one thing that must never move.
 */
export function ToolCard({ tool, compact = false }: ToolCardProps) {
  return (
    <Link
      to={`/tools/${tool.slug}`}
      className="tool-card group flex flex-col justify-between gap-3 rounded-xl bg-secondary p-4 transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-accent"
      title={tool.description}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-semibold leading-tight text-foreground transition-colors group-hover:text-primary">
          {tool.name}
        </p>
        {tool.status === 'declined' && <ComingSoonBadge className="mt-0.5" />}
        {tool.status === 'live' && <LiveBadge className="mt-0.5" />}
      </div>
      {!compact && (
        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground transition-colors group-hover:text-foreground/80">
          {tool.description}
        </p>
      )}
    </Link>
  );
}
