/**
 * CountUp — React Bits interface, anime.js implementation.
 *
 * Used only for real counts (queued changes, selected pages). It is not a
 * decorative odometer: the rendered value is always the actual state, and
 * reduced motion prints the final number immediately.
 */

import { useEffect, useRef } from 'react';
import { EASE, UI, animateUI, prefersReducedMotion } from '@/lib/motion';

export interface CountUpProps {
  to: number;
  from?: number;
  duration?: number;
  className?: string;
  /** Prefix/suffix are real text, not animated. */
  prefix?: string;
  suffix?: string;
}

export function CountUp({
  to,
  from = 0,
  duration = UI.standard,
  className,
  prefix = '',
  suffix = '',
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const value = useRef(from);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (prefersReducedMotion()) {
      value.current = to;
      node.textContent = String(to);
      return undefined;
    }
    const proxy = { value: value.current };
    const animation = animateUI(proxy, {
      value: to,
      duration,
      ease: EASE.soft,
      onUpdate: () => {
        node.textContent = String(Math.round(proxy.value));
      },
      onComplete: () => {
        value.current = to;
        node.textContent = String(to);
      },
    });
    return () => {
      animation.pause();
    };
  }, [duration, to]);

  return (
    <span className={className}>
      {prefix}
      <span ref={ref}>{Math.round(value.current)}</span>
      {suffix}
    </span>
  );
}

export default CountUp;
