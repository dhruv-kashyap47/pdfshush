import { cn } from '@/lib/utils';

/**
 * Availability marks, shared by the mega menu, the mobile sheet and the catalog
 * cards so "Live" and "Coming soon" never drift apart.
 *
 * Amber is deliberately the only warm tone here: an unshipped tool must read as
 * different from a ready one at a glance, without looking like an error.
 */
export function ComingSoonBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-200',
        className,
      )}
    >
      Coming soon
    </span>
  );
}

export function LiveBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium leading-none text-emerald-300',
        className,
      )}
    >
      Live
    </span>
  );
}
