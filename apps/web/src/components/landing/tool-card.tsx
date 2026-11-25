import { Link } from 'react-router-dom';
import { AvailabilityMark } from '@/components/tool-status';
import type { ToolDef } from '@/tools/registry';

interface ToolCardProps {
  tool: ToolDef;
  compact?: boolean;
}

/**
 * Catalog entry, built like an integration directory row rather than a landing
 * page tile: a small tinted glyph for recognition, the tool name, a quiet
 * description in the reading colour, and a compact status box at the foot.
 *
 * The tinted glyph is the tool's permanent accent; the border picks the same
 * accent up on hover. Nothing glows, nothing lifts more than a hair, and the
 * card is a flat surface separated by tone and a single hairline. That is the
 * whole ornament budget.
 */
export function ToolCard({ tool, compact = false }: ToolCardProps) {
  const Icon = tool.icon;
  return (
    <Link
      to={`/tools/${tool.slug}`}
      data-accent={tool.accent}
      className="tool-card group flex h-full flex-col gap-3 rounded-xl p-4"
      title={tool.description}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="tool-card-icon flex size-7 shrink-0 items-center justify-center rounded-[7px]"
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="tool-card-title text-sm font-semibold leading-5 tracking-[-0.01em] text-foreground">
            {tool.name}
          </p>
          {compact ? <AvailabilityMark status={tool.status} className="mt-1.5" /> : null}
          {!compact ? (
            <p className="mt-1.5 line-clamp-3 text-[13px] leading-[1.5] text-muted-foreground">
              {tool.description}
            </p>
          ) : null}
        </div>
      </div>
      {!compact ? (
        <div className="mt-auto pl-10">
          <AvailabilityMark status={tool.status} />
        </div>
      ) : null}
    </Link>
  );
}
