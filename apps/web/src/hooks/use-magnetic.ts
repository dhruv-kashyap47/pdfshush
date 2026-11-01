import { useEffect, useRef } from 'react';
import { animateUI, prefersReducedMotion } from '@/lib/motion';

/**
 * Magnetic pull for primary actions.
 *
 * A deliberate affordance, not decoration: only the two or three controls that
 * commit something (apply, download, choose a file) are magnetic. The element
 * leans toward the pointer by a few pixels and returns on leave with the
 * product's shared outExpo language. Pointer-fine and motion-welcome only —
 * touch, keyboard and reduced-motion users get the untouched element.
 *
 * Motion is written straight to the element (no React state), and every frame
 * scheduled here is cancelled on unmount.
 */
export function useMagnetic<T extends HTMLElement = HTMLButtonElement>(strength = 4) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion()) return;
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;

    let rect: DOMRect | null = null;
    let frame = 0;
    let x = 0;
    let y = 0;
    let animation: ReturnType<typeof animateUI> | null = null;

    const pull = () => {
      frame = 0;
      if (node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true') return;
      animation?.pause();
      animation = animateUI(node, {
        translateX: x,
        translateY: y,
        duration: 260,
        ease: 'outCubic',
      });
    };

    const onMove = (event: PointerEvent) => {
      rect ??= node.getBoundingClientRect();
      // Normalised -1..1 from the centre, scaled to a barely-there offset.
      const nx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const ny = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      x = Math.max(-1, Math.min(1, nx)) * strength;
      y = Math.max(-1, Math.min(1, ny)) * strength;
      if (!frame) frame = requestAnimationFrame(pull);
    };

    const release = () => {
      rect = null;
      x = 0;
      y = 0;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      animation?.pause();
      animation = animateUI(node, {
        translateX: 0,
        translateY: 0,
        duration: 420,
        ease: 'outExpo',
      });
    };

    node.addEventListener('pointerenter', onMove);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerleave', release);
    node.addEventListener('blur', release);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      animation?.pause();
      node.removeEventListener('pointerenter', onMove);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', release);
      node.removeEventListener('blur', release);
    };
  }, [strength]);

  return ref;
}
