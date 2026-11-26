/**
 * One ad unit. Renders nothing at all — no wrapper, no reserved space — unless
 * every gate passes, because a reserved gap with no ad is worse than no gap.
 *
 * The height is reserved *before* AdSense fills it (fixed `min-h`) so the unit
 * cannot shift the article under the reader's thumb. That is the whole CLS
 * strategy: one known height, no auto-format collapse.
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { adConfig, adEligible, adPlacementFor, shouldRenderAd, slotIdFor } from '@/lib/ads';
import {
  currentConsent,
  loadAdSense,
  loadCmp,
  onConsentChange,
  pushSlot,
} from '@/lib/ad-loader';
import { cn } from '@/lib/utils';

export function AdSlot({
  surface = 'top',
  only,
  className,
}: {
  /** Articles carry two units; every other placement carries one. */
  surface?: 'top' | 'end';
  /** Restrict to these placements. The shell uses it to cover home and tools only. */
  only?: ReadonlyArray<'home' | 'tool' | 'article'>;
  className?: string;
}) {
  const config = adConfig(import.meta.env);
  const { pathname } = useLocation();
  const { account, loading } = useAuth();
  const [consent, setConsent] = useState(currentConsent);

  useEffect(() => onConsentChange(setConsent), []);

  const placement = adPlacementFor(pathname);
  const slot = placement ? slotIdFor(config, placement, surface) : '';

  const decision = {
    config,
    pathname,
    // `undefined` while the session is loading, which the gate reads as "wait".
    plan: loading ? undefined : (account?.plan ?? 'free'),
    consent,
  };

  // Eligible means "this page and this visitor could show an ad". It is decided
  // before consent, because the CMP has to be loaded to learn what consent is.
  const eligible = adEligible(decision);
  const allowed = shouldRenderAd(decision);

  const active =
    allowed && slot !== '' && (only === undefined || (placement !== undefined && only.includes(placement)));

  // Ask for consent as soon as the slot is eligible. Waiting for `allowed` here
  // would deadlock: `allowed` needs a decision that only the CMP can give.
  useEffect(() => {
    if (!eligible || !config.cmpId || consent !== 'unknown') return;
    void loadCmp();
  }, [eligible, config.cmpId, consent]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    // The script is fetched only once consent permits an ad request, and the
    // slot is pushed only after the script has actually loaded.
    void loadAdSense()
      .then(() => {
        if (!cancelled) pushSlot();
      })
      .catch(() => {
        // A blocked or failed script is not a page error.
      });

    return () => {
      cancelled = true;
    };
  }, [active, slot]);

  if (!active) return null;

  return (
    <aside
      aria-label="Advertisement"
      className={cn('mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8', className)}
      data-ad-placement={placement}
    >
      <p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        Advertisement
      </p>
      <div className="min-h-[250px] w-full">
        <ins
          className="adsbygoogle"
          style={{ display: 'block', minHeight: '250px' }}
          data-ad-client={config.client}
          data-ad-slot={slot}
          data-ad-format="auto"
          data-full-width-responsive="false"
        />
      </div>
    </aside>
  );
}
