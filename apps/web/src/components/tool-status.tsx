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

/**
 * The catalog-card status mark: a small, quiet box.
 *
 * Live is neutral; Coming soon is a restrained amber. No dots, no green: the
 * tool's own accent is the only colour that identifies the card, and status is
 * read from the label.
 */
export function AvailabilityMark({
  status,
  className,
}: {
  status: 'live' | 'declined' | 'archived';
  className?: string;
}) {
  const live = status === 'live';
  const archived = status === 'archived';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-[5px] border px-1.5 py-[3px] text-[10px] font-medium leading-none tracking-[0.01em]',
        live
          ? 'border-white/[0.08] bg-white/[0.04] text-foreground/60'
          : archived
            ? 'border-white/[0.08] bg-white/[0.04] text-muted-foreground'
            : 'border-amber-400/20 bg-amber-400/[0.07] text-amber-200/90',
        className,
      )}
    >
      {live ? 'Live' : archived ? 'Archived' : 'Coming soon'}
    </span>
  );
}
