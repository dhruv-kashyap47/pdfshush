import type { PointerEvent, ReactNode } from 'react';
import { useRef } from 'react';
import { useMotionScope } from '@/hooks/use-motion';
import { dur, EASE } from '@/lib/motion';
import './spotlight.css';

/**
 * Pointer-following highlight and a small lift, after ReactBits' SpotlightCard.
 *
 * The highlight is painted by a CSS pseudo-element reading `--mx`/`--my`, so a
 * pointer move never touches React state and never re-renders the card. The
 * lift is a transform through the shared motion scope, which means unmounting
 * the route cancels it.
 */
export function SpotlightCard({
  children,
  className = '',
  popular = false,
}: {
  children: ReactNode;
  className?: string;
  popular?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useMotionScope();

  function trackPointer(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse') return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    el.style.setProperty('--my', `${event.clientY - rect.top}px`);
  }

  function lift(to: number) {
    if (!ref.current) return;
    motion.animate(ref.current, {
      translateY: to,
      duration: dur(to === 0 ? 300 : 240),
      ease: EASE.soft,
    });
  }

  return (
    <div
      ref={ref}
      onPointerMove={trackPointer}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') lift(-4);
      }}
      onPointerLeave={() => lift(0)}
      className={`spotlight-card h-full rounded-2xl border transition-colors duration-300 ${
        popular ? 'pricing-popular border-primary/30' : 'border-border/70'
      } ${className}`}
    >
      {children}
    </div>
  );
}
