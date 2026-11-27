import { useEffect, useRef } from 'react';
import { animateUI, dur, EASE, onEnterViewport, prefersReducedMotion } from '@/lib/motion';

/**
 * A meter that paints instantly for no-JS and screen readers, then rewinds and
 * grows on first view. The bar scales on the X axis, so the animation never
 * touches layout.
 */
export function UsageMeter({
  used,
  limit,
  label,
  caption,
}: {
  used: number;
  limit: number;
  label: string;
  caption?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const fraction = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.style.transform = `scaleX(${fraction})`;
      return;
    }
    el.style.transform = 'scaleX(0)';
    return onEnterViewport(el, () => {
      animateUI(el, { scaleX: fraction, duration: dur(900), ease: EASE.out });
    });
  }, [fraction]);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {used.toLocaleString('en-US')} / {limit.toLocaleString('en-US')}
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        aria-label={label}
      >
        <div
          ref={bar}
          className="h-full origin-left rounded-full bg-primary"
          style={{ transform: `scaleX(${fraction})` }}
        />
      </div>
      {caption ? <p className="mt-1.5 text-xs text-muted-foreground">{caption}</p> : null}
    </div>
  );
}
