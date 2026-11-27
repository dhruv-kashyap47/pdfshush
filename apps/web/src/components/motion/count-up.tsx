import { useEffect, useRef } from 'react';
import { animateUI, EASE, onEnterViewport, prefersReducedMotion } from '@/lib/motion';

/**
 * Counts a price up when it scrolls into view, after ReactBits' CountUp.
 *
 * The initial markup carries the final value, so the prerendered HTML and a
 * no-JS visitor always see the real price. The effect is what rewinds it to 0.
 */
export function CountUp({
  value,
  prefix = '',
  suffix = '',
  decimals = 0,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const format = (next: number) => `${prefix}${next.toFixed(decimals)}${suffix}`;
    if (prefersReducedMotion()) {
      el.textContent = format(value);
      return;
    }

    const state = { v: 0 };
    el.textContent = format(0);
    let animation: ReturnType<typeof animateUI> | undefined;

    const stop = onEnterViewport(el, () => {
      animation = animateUI(state, {
        v: value,
        duration: 1_150,
        ease: EASE.out,
        onUpdate: () => {
          el.textContent = format(state.v);
        },
      });
    });

    return () => {
      stop();
      animation?.pause();
    };
  }, [value, prefix, suffix, decimals]);

  return (
    <span ref={ref}>
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
}
