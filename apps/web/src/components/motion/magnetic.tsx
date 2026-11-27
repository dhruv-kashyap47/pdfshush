import type { PointerEvent, ReactNode } from 'react';
import { useRef } from 'react';
import { useMotionScope } from '@/hooks/use-motion';
import { dur, EASE, prefersReducedMotion } from '@/lib/motion';

/**
 * Magnetic hover, after ReactBits' Magnetic button.
 *
 * The child moves a few pixels toward the pointer, never enough to move the hit
 * target out from under the cursor. Touch and reduced motion are left alone.
 */
export function Magnetic({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useMotionScope();

  function follow(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || prefersReducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = (event.clientX - (rect.left + rect.width / 2)) * 0.12;
    const dy = (event.clientY - (rect.top + rect.height / 2)) * 0.18;
    motion.animate(el, {
      translateX: Math.max(-8, Math.min(8, dx)),
      translateY: Math.max(-6, Math.min(6, dy)),
      duration: dur(180),
      ease: EASE.soft,
    });
  }

  function release() {
    if (!ref.current) return;
    motion.animate(ref.current, {
      translateX: 0,
      translateY: 0,
      duration: dur(320),
      ease: EASE.out,
    });
  }

  return (
    <div ref={ref} onPointerMove={follow} onPointerLeave={release} className="w-full">
      {children}
    </div>
  );
}
