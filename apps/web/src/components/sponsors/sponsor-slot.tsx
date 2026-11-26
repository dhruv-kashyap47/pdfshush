/**
 * One sponsor card.
 *
 * Renders nothing at all — no wrapper, no reserved space — unless the route is
 * allowlisted, the session is known and free, and a live sponsor holds the slot.
 * That is the same gate the old ad unit used, minus every third-party origin: a
 * sponsor is first-party markup with a same-origin logo, so the Content Security
 * Policy does not change.
 */

import { ArrowUpRight } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import {
  sponsorPlacementFor,
  sponsorVisible,
  useSponsorInventory,
  type SponsorPlacement,
} from '@/lib/sponsors';
import { cn } from '@/lib/utils';

export function SponsorSlot({
  only,
  className,
}: {
  /** Restrict to these placements. The shell uses it for the home page only. */
  only?: readonly SponsorPlacement[];
  className?: string;
}) {
  const { pathname } = useLocation();
  const { account, loading } = useAuth();
  const { inventory } = useSponsorInventory();

  const sponsor = sponsorVisible({
    placement: sponsorPlacementFor(pathname),
    // `undefined` while the session loads: wait rather than flash a card at Pro.
    plan: loading ? undefined : (account?.plan ?? 'free'),
    only,
    inventory,
  });

  if (!sponsor) return null;

  return (
    <aside
      aria-label="Sponsor"
      className={cn('mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8', className)}
      data-sponsor-slot
    >
      <p className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        Sponsored
      </p>
      <a
        href={sponsor.url}
        target="_blank"
        rel="sponsored nofollow noopener noreferrer"
        className="group flex items-center gap-3 rounded-xl border border-l-2 border-border/70 bg-card px-4 py-3 transition-colors hover:border-foreground/20"
        style={sponsor.brandColor ? { borderLeftColor: sponsor.brandColor } : undefined}
      >
        {sponsor.hasLogo ? (
          <img
            src={`/api/sponsors/${sponsor.id}/logo`}
            alt=""
            width={36}
            height={36}
            loading="lazy"
            decoding="async"
            className="h-9 w-9 shrink-0 rounded-lg object-contain"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold"
            style={sponsor.brandColor ? { color: sponsor.brandColor } : undefined}
          >
            {sponsor.name.slice(0, 1).toUpperCase()}
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-tight">{sponsor.name}</span>
          <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
            {sponsor.blurb}
          </span>
        </span>

        <ArrowUpRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
        />
      </a>
    </aside>
  );
}
