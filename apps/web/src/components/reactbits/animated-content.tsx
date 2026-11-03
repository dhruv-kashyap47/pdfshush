/**
 * AnimatedContent — React Bits interface, anime.js implementation.
 *
 * React Bits ships this component on GSAP/ScrollTrigger. PDFShush already owns
 * one motion engine (anime.js via `lib/motion.ts`) and the brief forbids a new
 * dependency, so the public surface is kept while the tween is expressed with
 * the existing engine. Transform + opacity only, reduced-motion aware, and
 * every observer/animation is cleaned up on unmount.
 */

import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { EASE, UI, animateUI, prefersReducedMotion } from '@/lib/motion';

export interface AnimatedContentProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onAnimationStart'> {
  children?: ReactNode;
  direction?: 'vertical' | 'horizontal';
  distance?: number;
  reverse?: boolean;
  duration?: number;
  delay?: number;
  initialOpacity?: number;
  scale?: number;
  threshold?: number;
  trigger?: 'mount' | 'view';
  once?: boolean;
  /** Animate direct children one after another. */
  stagger?: number;
}

export function AnimatedContent({
  children,
  className = '',
  direction = 'vertical',
  distance = 10,
  reverse = false,
  duration = UI.standard,
  delay = 0,
  initialOpacity = 0,
  scale = 0.995,
  threshold = 0.15,
  trigger = 'mount',
  stagger = 0,
  ...rest
}: AnimatedContentProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    if (prefersReducedMotion()) {
      root.style.opacity = '1';
      return undefined;
    }
    const targets = stagger > 0 ? Array.from(root.children) : [root];
    const axis = direction === 'vertical' ? 'translateY' : 'translateX';
    const offset = distance * (reverse ? -1 : 1);
    let animation: ReturnType<typeof animateUI> | null = null;

    const play = () => {
      animation = animateUI(targets, {
        opacity: [initialOpacity, 1],
        [axis]: [offset, 0],
        scale: [scale, 1],
        duration,
        delay: (index: number) => delay + index * stagger,
        ease: EASE.out,
      });
    };

    root.style.opacity = String(initialOpacity);
    if (trigger === 'mount') {
      play();
      return () => {
        animation?.pause();
      };
    }
    if (typeof IntersectionObserver === 'undefined') {
      play();
      return () => {
        animation?.pause();
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          play();
        }
      },
      { threshold },
    );
    observer.observe(root);
    return () => {
      observer.disconnect();
      animation?.pause();
    };
  }, [
    delay,
    direction,
    distance,
    duration,
    initialOpacity,
    reverse,
    scale,
    stagger,
    threshold,
    trigger,
  ]);

  return (
    <div ref={ref} className={className} {...rest}>
      {children}
    </div>
  );
}

export default AnimatedContent;
