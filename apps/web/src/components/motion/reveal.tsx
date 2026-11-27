import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { useMotionScope } from '@/hooks/use-motion';
import { dur, EASE, onEnterViewport, prefersReducedMotion, staggerUI } from '@/lib/motion';

/**
 * Scroll-gated entrance, after ReactBits' AnimatedContent.
 *
 * Children marked `data-stagger` enter in sequence; without any, the wrapper
 * itself enters. Under reduced motion nothing is hidden and nothing animates,
 * so the page is fully readable with the preference on (or JS off).
 */
export function Reveal({
  children,
  className,
  delay = 0,
  distance = 18,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  distance?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useMotionScope();

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-stagger]'));
    if (items.length > 0) {
      for (const item of items) {
        item.style.opacity = '0';
        item.style.transform = `translateY(${distance}px)`;
      }
    } else {
      el.style.opacity = '0';
      el.style.transform = `translateY(${distance}px)`;
    }

    const play = () => {
      if (items.length > 0) {
        motion.animate(items, {
          opacity: [0, 1],
          translateY: [distance, 0],
          duration: dur(620),
          delay: staggerUI(70),
          ease: EASE.out,
        });
        return;
      }
      motion.animate(el, {
        opacity: [0, 1],
        translateY: [distance, 0],
        duration: dur(620),
        delay: dur(delay),
        ease: EASE.out,
      });
    };

    return onEnterViewport(el, play);
  }, [motion, delay, distance]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
