import { createElement, useEffect, useRef, type ElementType, type Ref } from 'react';
import { animateUI, EASE, DUR, onEnterViewport, staggerUI } from '@/lib/motion';

interface RevealTextProps {
  text: string;
  /** Rendered element. Defaults to a span. */
  as?: ElementType;
  className?: string;
  /** Milliseconds between adjacent words. */
  stagger?: number;
}

/**
 * Word-by-word entrance for marketing copy. Each word starts at zero opacity
 * and lifts into place once the line enters the viewport. Reduced motion and
 * phones skip the staging: the words are simply there.
 */
export function RevealText({ text, as = 'span', className, stagger = 26 }: RevealTextProps) {
  const ref = useRef<HTMLElement | null>(null);
  const words = text.split(' ');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return onEnterViewport(el, () => {
      const targets = el.querySelectorAll<HTMLElement>('[data-word]');
      if (!targets.length) return;
      animateUI(targets, {
        opacity: [0, 1],
        y: [16, 0],
        duration: DUR.slow,
        delay: staggerUI(stagger),
        ease: EASE.out,
      });
    });
  }, [stagger]);

  return createElement(
    as,
    { ref: ref as Ref<HTMLElement>, className },
    words.map((word, index) => (
      <span
        key={`${word}-${index}`}
        data-word
        className="inline-block will-change-transform"
        style={{ opacity: 0 }}
      >
        {word}
        {index < words.length - 1 ? '\u00A0' : ''}
      </span>
    )),
  );
}
