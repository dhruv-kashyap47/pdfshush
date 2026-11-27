import { useEffect, useRef } from 'react';
import { useMotionScope } from '@/hooks/use-motion';
import { dur, EASE, onEnterViewport, prefersReducedMotion } from '@/lib/motion';

/**
 * The handwritten note on the Pro card.
 *
 * A drawn arrow beats a pill badge: it points at the plan instead of sitting in
 * the corner like a status chip. The stroke is drawn with anime.js the first
 * time the card is seen, then the note settles into a slow, tiny rock.
 */
export function PopularNote() {
  const ref = useRef<HTMLDivElement>(null);
  const stroke = useRef<SVGPathElement>(null);
  const motion = useMotionScope();

  useEffect(() => {
    const el = ref.current;
    const path = stroke.current;
    if (!el || !path) return;

    if (prefersReducedMotion()) {
      path.style.strokeDasharray = '1';
      path.style.strokeDashoffset = '0';
      return;
    }

    path.style.strokeDasharray = '1';
    path.style.strokeDashoffset = '1';

    return onEnterViewport(el, () => {
      motion.animate(el, {
        opacity: [0, 1],
        translateY: [-5, 0],
        duration: dur(480),
        ease: EASE.out,
      });
      motion.animate(path, {
        strokeDashoffset: [1, 0],
        duration: dur(900),
        delay: dur(220),
        ease: EASE.soft,
      });
      motion.animate(el, {
        rotate: [-6, -2.5, -6],
        duration: dur(2_600),
        delay: dur(1_300),
        ease: 'inOutQuad',
      });
    });
  }, [motion]);

  return (
    <div ref={ref} className="pricing-popular-note">
      <span className="pricing-note-text">most popular</span>
      <svg viewBox="0 0 84 46" className="pricing-note-arrow" fill="none" aria-hidden="true">
        <path
          ref={stroke}
          d="M80 4 C72 27 53 39 16 34 M16 34 L28 28 M16 34 L24 44"
          pathLength={1}
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
